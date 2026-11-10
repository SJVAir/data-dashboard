import { getContext, onDestroy, untrack } from "svelte";
import { getMetadata, getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import type { QueryState } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { DEFAULT_RANGE } from "../defaults";
import { dataTitle } from "../title";
import { setGeneratedTitle } from "../titles.svelte";
import { chartInput, entryMeta } from "./input";
import { layerKind } from "$lib/data/layer-kind";
import { MAX_OVERLAYS, overlayInput, overlayLayers } from "./overlays";
import { PLACE_VIEWER_KEY, type PlaceViewer } from "./viewer";

/** An overlay's levels: `undefined` until loaded, an error if they couldn't be. */
type Levels = Level[] | { error: unknown } | undefined;

/** What a widget asks the query client for: the shape `chartInput` returns. */
export type WidgetInputBuilder = (
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number
) => ReturnType<typeof chartInput>;

/** One overlay layer: its catalog entry, its scale, and its own query at the main's places. */
export type WidgetOverlay = {
	layer: Layer;
	meta: ReturnType<typeof entryMeta>;
	levels: Level[];
	state: QueryState;
};

/** A query's state held as loading until `levels` are in, or an error if they failed. */
function withLevels(s: QueryState, levels: Levels): QueryState {
	if (s.status !== "ready" && s.status !== "error") return s;
	if (levels === undefined) return { status: "loading", data: s.data };
	if (!Array.isArray(levels) && s.status === "ready") {
		return { status: "error", error: levels.error, data: s.data };
	}
	return s;
}

/**
 * What a widget that shows one pollutant for up to `maxPlaces` places over a date range needs:
 * the live query, its entry type's levels, the retirement notice, and the generated title. Call
 * during component initialization (it registers effects and cleanup).
 */
export class DataWidget {
	catalog = $state.raw<CatalogEntry[] | undefined>();
	/** The entry type's levels; `undefined` until loaded, an error if they couldn't be. */
	levels = $state.raw<Levels>();
	#levelsTry = $state(0);
	readonly #query: LiveQuery;
	/** One query per overlay slot (idle when the widget has fewer overlays). */
	readonly #overlayQueries: LiveQuery[] = [];
	#overlayLevels = $state.raw<Levels[]>([]);

	/** Who is looking: labels for points read "your location" or "shared location". */
	readonly viewer: PlaceViewer;
	readonly picked;
	readonly meta;
	/** The query's state, held as loading until the levels are in, or an error if they failed. */
	readonly shown;
	readonly retired;
	readonly levelList;
	/**
	 * The overlay layers (at most `MAX_OVERLAYS`), each queried at the main layer's places. An
	 * overlay's error or unavailability is its own: it never changes `shown`.
	 */
	readonly overlays: WidgetOverlay[];

	/** `opts.input` builds the main query (default `chartInput`). */
	constructor(
		widget: () => WidgetInstance,
		maxPlaces: number,
		opts: { input?: WidgetInputBuilder } = {}
	) {
		const build = opts.input ?? chartInput;
		const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
		this.viewer = viewer;
		const metadata = getMetadata();
		// Never rejects (an unreachable catalog is "unavailable", which the query reports itself).
		void metadata.catalog().then((c) => {
			if (c !== "unavailable") this.catalog = c;
		});

		this.picked = $derived(build(widget().data, this.catalog, maxPlaces));
		this.meta = $derived(entryMeta(this.catalog, this.picked.layer));
		const entryTypeId = $derived(this.picked.layer?.entryType);

		this.#query = new LiveQuery(
			getQueryClient(),
			untrack(() => this.picked.input)
		);
		const query = this.#query;
		$effect(() => query.set(this.picked.input));
		$effect(() => query.setPolling(!widget().minimized));
		onDestroy(() => query.destroy());

		$effect(() => {
			const id = entryTypeId;
			void this.#levelsTry;
			if (!id) return;
			const abort = new AbortController();
			this.levels = undefined;
			metadata.levels(id, abort.signal).then(
				(l) => (this.levels = l),
				(error: unknown) => {
					if (!abort.signal.aborted) this.levels = { error };
				}
			);
			return () => abort.abort();
		});

		this.shown = $derived(withLevels(query.state, this.levels));

		const layers = $derived(overlayLayers(widget().data, this.catalog));
		const inputs = $derived.by(() => {
			const main = this.picked.input;
			if (!main) return [];
			const state = query.state;
			// A number overlay is pinned to the main data's resolution, so it waits for it: while
			// the main loads, and when it failed or is unavailable (nothing is drawn, so nothing is
			// fetched).
			const data = "data" in state ? state.data : undefined;
			const waiting = !data;
			const resolution = data?.resolution;
			return layers.map((l) =>
				waiting && layerKind(l, this.catalog) === "number"
					? null
					: overlayInput(main, l, resolution, this.catalog)
			);
		});
		const client = getQueryClient();
		for (let i = 0; i < MAX_OVERLAYS; i++) {
			const q = new LiveQuery(
				client,
				untrack(() => inputs[i] ?? null)
			);
			this.#overlayQueries.push(q);
			$effect(() => q.set(inputs[i] ?? null));
			$effect(() => q.setPolling(!widget().minimized));
			onDestroy(() => q.destroy());

			const dataset = $derived(layers[i]?.dataset);
			const entryType = $derived(layers[i]?.entryType);
			$effect(() => {
				const [d, e] = [dataset, entryType];
				void this.#levelsTry;
				const set = (l: Levels) => {
					const next = [...untrack(() => this.#overlayLevels)];
					next[i] = l;
					this.#overlayLevels = next;
				};
				if (!d || !e) return;
				const abort = new AbortController();
				set(undefined);
				metadata.datasetLevels(d, e, abort.signal).then(set, (error: unknown) => {
					if (!abort.signal.aborted) set({ error });
				});
				return () => abort.abort();
			});
		}
		this.overlays = $derived(
			layers.map((layer, i) => {
				const levels = this.#overlayLevels[i];
				return {
					layer,
					meta: entryMeta(this.catalog, layer),
					levels: Array.isArray(levels) ? levels : [],
					state: withLevels(this.#overlayQueries[i].state, levels)
				};
			})
		);

		this.retired = $derived.by(() => {
			const meta = this.meta;
			if (!meta) return undefined;
			const r = meta.entryType.retired ?? meta.dataset.retired;
			if (!r) return undefined;
			const name = meta.entryType.retired ? meta.entryType.label : meta.dataset.label;
			return { name, since: r.since };
		});

		this.levelList = $derived(Array.isArray(this.levels) ? this.levels : []);

		$effect(() => {
			// Only from ready data: while a new input loads, the old places would pair with the new range.
			const s = query.state;
			const meta = this.meta;
			if (s.status !== "ready" || !meta) return;
			setGeneratedTitle(
				widget().id,
				dataTitle({
					entryLabel: meta.entryType.label,
					places: s.data.places,
					viewer,
					range: widget().data.dateRange ?? DEFAULT_RANGE
				})
			);
		});
	}

	retry = (): void => {
		const failed = [this.levels, ...this.#overlayLevels].some((l) => l && !Array.isArray(l));
		if (failed) this.#levelsTry++;
		this.#query.retry();
		for (const q of this.#overlayQueries) q.retry();
	};
}
