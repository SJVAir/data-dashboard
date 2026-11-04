import { onDestroy, untrack } from "svelte";
import { getMetadata, getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { QueryState } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { DEFAULT_RANGE } from "../defaults";
import { dataTitle } from "../title";
import { setGeneratedTitle } from "../titles.svelte";
import { chartInput, entryMeta } from "./input";

/**
 * What a widget that shows one pollutant for up to `maxPlaces` places over a date range needs:
 * the live query, its entry type's levels, the retirement notice, and the generated title. Call
 * during component initialization (it registers effects and cleanup).
 */
export class DataWidget {
	catalog = $state.raw<CatalogEntry[] | undefined>();
	/** The entry type's levels; `undefined` until loaded, an error if they couldn't be. */
	levels = $state.raw<Level[] | { error: unknown } | undefined>();
	#levelsTry = $state(0);
	readonly #query: LiveQuery;

	readonly picked;
	readonly meta;
	/** The query's state, held as loading until the levels are in, or an error if they failed. */
	readonly shown;
	readonly retired;
	readonly levelList;

	constructor(widget: () => WidgetInstance, maxPlaces: number) {
		const metadata = getMetadata();
		// Never rejects (an unreachable catalog is "unavailable", which the query reports itself).
		void metadata.catalog().then((c) => {
			if (c !== "unavailable") this.catalog = c;
		});

		this.picked = $derived(chartInput(widget().data, this.catalog, maxPlaces));
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

		this.shown = $derived.by<QueryState>(() => {
			const s = query.state;
			if (s.status !== "ready" && s.status !== "error") return s;
			if (this.levels === undefined) return { status: "loading", data: s.data };
			if (!Array.isArray(this.levels) && s.status === "ready") {
				return { status: "error", error: this.levels.error, data: s.data };
			}
			return s;
		});

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
					range: widget().data.dateRange ?? DEFAULT_RANGE
				})
			);
		});
	}

	retry = (): void => {
		if (this.levels && !Array.isArray(this.levels)) this.#levelsTry++;
		this.#query.retry();
	};
}
