import { onDestroy, untrack } from "svelte";
import { getMetadata, getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import { currentInput, hourlyReading, type CurrentReading } from "$lib/data/now/current";
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { QueryState, UnavailableReason } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { entryMeta, mainLayer } from "./input";

type Levels = Level[] | { error: unknown } | undefined;

/**
 * The current reading of a widget's first layer's place, with its levels. Used by the two "now"
 * tiles and the threshold watcher. Call during component initialization (it registers effects and
 * cleanup). Polling follows `!widget().minimized` unless `opts.polling` says otherwise.
 */
export class CurrentConditions {
	#levels = $state.raw<Levels>();
	#levelsTry = $state(0);
	readonly #query: LiveQuery;

	readonly levels: Level[];
	/** The catalog entry (and dataset) the widget reads, once the catalog has loaded. */
	readonly meta: ReturnType<typeof entryMeta>;
	/** The query's state, held as loading until the levels are in, or an error if they failed. */
	readonly shown: QueryState;
	readonly state: "loading" | "ready" | "error" | { unavailable: UnavailableReason };
	readonly reading: CurrentReading | undefined;

	constructor(widget: () => WidgetInstance, opts?: { polling?: () => boolean }) {
		const metadata = getMetadata();
		// A local, not a class field: the compiler reads a field untracked in the constructor's
		// `const … = $derived(…)`, so the layer and `meta` would never see the catalog arrive.
		let catalog = $state.raw<CatalogEntry[] | undefined>();
		void metadata.catalog().then((c) => {
			if (c !== "unavailable") catalog = c;
		});

		const layer = $derived(mainLayer(widget().data, catalog));
		const input = $derived(layer && (layer.place || layer.selection) ? currentInput(layer) : null);
		const meta = $derived(entryMeta(catalog, layer));
		const entryTypeId = $derived(layer?.entryType);

		const query = new LiveQuery(
			getQueryClient(),
			untrack(() => input)
		);
		this.#query = query;
		$effect(() => query.set(input));
		$effect(() => query.setPolling(opts?.polling ? opts.polling() : !widget().minimized));
		onDestroy(() => query.destroy());

		$effect(() => {
			const id = entryTypeId;
			void this.#levelsTry;
			if (!id) return;
			const abort = new AbortController();
			this.#levels = undefined;
			metadata.levels(id, abort.signal).then(
				(l) => (this.#levels = l),
				(error: unknown) => {
					if (!abort.signal.aborted) this.#levels = { error };
				}
			);
			return () => abort.abort();
		});

		this.levels = $derived(Array.isArray(this.#levels) ? this.#levels : []);

		this.meta = $derived(meta);
		this.shown = $derived.by((): QueryState => {
			const s = query.state;
			if (s.status !== "ready" && s.status !== "error") return s;
			const levels = this.#levels;
			if (levels === undefined) return { status: "loading", data: s.data };
			if (!Array.isArray(levels) && s.status === "ready") {
				return { status: "error", error: levels.error, data: s.data };
			}
			return s;
		});
		this.state = $derived.by(() => {
			const s = query.state;
			if (s.status === "unavailable") return { unavailable: s.reason };
			if (s.status === "error") return "error";
			if (this.#levels && !Array.isArray(this.#levels)) return "error";
			if (s.status === "ready" && Array.isArray(this.#levels)) return "ready";
			return "loading";
		});

		this.reading = $derived.by(() => {
			const s = query.state;
			if (s.status !== "ready" || !Array.isArray(this.#levels)) return undefined;
			// A plain Date: the reading re-derives on each poll, which is when staleness can change.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			return hourlyReading(s.data, this.#levels, new Date(), meta?.entryType.precision ?? null);
		});
	}

	retry = (): void => {
		if (this.#levels && !Array.isArray(this.#levels)) this.#levelsTry++;
		this.#query.retry();
	};
}
