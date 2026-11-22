import { getContext, onDestroy, untrack } from "svelte";
import { getMetadata, getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import type { Level as DatasetLevel } from "$lib/data/dataset-rules";
import { figureState } from "$lib/data/figure-values";
import type { CatalogEntry, Figure, Level } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import type { QueryData, QueryInput, QueryState } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { DEFAULT_RANGE } from "../defaults";
import { dataTitle } from "../title";
import { setGeneratedTitle } from "../titles.svelte";
import { entryMeta, widgetInputs, widgetPlaceKind, type WidgetInputs } from "./input";
import { MAX_OVERLAYS, overlayLayers } from "./overlays";
import { PLACE_VIEWER_KEY, type PlaceViewer } from "./viewer";

/** An overlay's levels: `undefined` until loaded, an error if they couldn't be. */
type Levels = Level[] | { error: unknown } | undefined;

/**
 * What a widget asks the query client for: its main layer, the main query (`input`), the places
 * cut, and one query per overlay (`null`: not fetched), all at the dataset's resolution.
 */
export type WidgetPicked = {
	layer: Layer | undefined;
	input: QueryInput | null;
	hidden: number;
	/** What to add when the widget asks for nothing (`WidgetInputs.empty`). */
	empty?: WidgetInputs["empty"];
	overlays: (QueryInput | null)[];
	effective?: WidgetInputs["effective"];
	/** The figure the main needs (`WidgetInputs.figureFor`); absent or null: the plain mean. */
	figureFor?: WidgetInputs["figureFor"];
	/** The main waits for its figure's lookup (`input` is null meanwhile). */
	figurePending?: boolean;
};

/**
 * A looked-up figure for an entry type at a resolution: the `Figure` (`null`: the plain mean), or
 * `undefined` while it isn't known yet (still loading, or the lookup failed).
 */
export type FigureOf = (entryType: string, resolution: DatasetLevel) => Figure | null | undefined;

/**
 * Builds a widget's queries (default: `widgetInputs` at the widget's places). `now` (epoch ms)
 * is the widget's clock, so Automatic is chosen again as a growing range (`to-date`) crosses the range
 * ladder. `figureOf` gives the figures looked up so far.
 */
export type WidgetInputBuilder = (
	widget: WidgetInstance,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number,
	now: number,
	figureOf: FigureOf
) => WidgetPicked;

/**
 * `widgetInputs`, always with the main's figure: until it is looked up, the main isn't asked for
 * (`figurePending`), so it is fetched once, with the right figure and cache key.
 */
function defaultInputs(
	widget: WidgetInstance,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number,
	now: number,
	figureOf: FigureOf
): WidgetPicked {
	const place = widgetPlaceKind(widget.data);
	const plain = widgetInputs(widget, catalog, place, maxPlaces, now);
	const need = plain.figureFor;
	if (!need) return { ...plain, input: plain.main };
	const figure = figureOf(need.entryType, need.resolution);
	if (figure === undefined) return { ...plain, input: null, figurePending: true };
	const got = widgetInputs(widget, catalog, place, maxPlaces, now, figure);
	return { ...got, input: got.main };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

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
	/** The last figure lookup: its entry type and resolution, and its figure or error. */
	#figure = $state.raw<
		{ key: string; resolution: DatasetLevel; figure?: Figure | null; error?: unknown } | undefined
	>();
	#figureTry = $state(0);
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
	 * The main's figure (`MetadataSource.figure`) and the resolution it is for; `null` when it
	 * reads the plain mean or its lookup isn't in yet. Labels name it ("24-hour average").
	 */
	readonly figure: { figure: Figure; resolution: DatasetLevel } | null;
	/**
	 * The overlay layers (at most `MAX_OVERLAYS`), each queried at the main layer's places. An
	 * overlay's error or unavailability is its own: it never changes `shown`.
	 */
	readonly overlays: WidgetOverlay[];

	/** `opts.input` builds the queries (default `widgetInputs`). */
	constructor(
		widget: () => WidgetInstance,
		maxPlaces: number,
		opts: { input?: WidgetInputBuilder } = {}
	) {
		const build = opts.input ?? defaultInputs;
		const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
		this.viewer = viewer;
		const metadata = getMetadata();
		// Never rejects (an unreachable catalog is "unavailable", which the query reports itself).
		void metadata.catalog().then((c) => {
			if (c !== "unavailable") this.catalog = c;
		});

		// A coarse clock: read each minute, but `hour` only changes on the hour (Pacific hours start
		// on UTC hours), so the queries are rebuilt at most hourly; an equal input is a no-op.
		let clock = $state(Date.now());
		$effect(() => {
			const timer = setInterval(() => (clock = Date.now()), MINUTE_MS);
			return () => clearInterval(timer);
		});
		const hour = $derived(Math.floor(clock / HOUR_MS));
		const figureOf: FigureOf = (entryType, resolution) => {
			const f = this.#figure;
			return f && f.key === `${entryType}/${resolution}` ? f.figure : undefined;
		};
		this.picked = $derived(build(widget(), this.catalog, maxPlaces, hour * HOUR_MS, figureOf));
		const figureFor = $derived(this.picked.figureFor);
		const figureKey = $derived(
			figureFor ? `${figureFor.entryType}/${figureFor.resolution}` : undefined
		);
		$effect(() => {
			const key = figureKey;
			void this.#figureTry;
			const need = untrack(() => figureFor);
			if (!key || !need) return;
			const abort = new AbortController();
			const { resolution } = need;
			metadata.figure(need.entryType, resolution, abort.signal).then(
				(figure) => {
					if (!abort.signal.aborted) this.#figure = { key, resolution, figure };
				},
				(error: unknown) => {
					if (!abort.signal.aborted) this.#figure = { key, resolution, error };
				}
			);
			return () => abort.abort();
		});
		this.figure = $derived.by(() => {
			const f = this.#figure;
			return f?.figure && f.key === figureKey
				? { figure: f.figure, resolution: f.resolution }
				: null;
		});
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

		// The main shows its figure as each point's value (`figureValues`). While its figure is
		// looked up the main is held as loading, and a failed lookup is an error (retry looks again):
		// it never falls back to the plain mean, which would be a second number for the same period.
		this.shown = $derived.by((): QueryState => {
			// A stored level the widget doesn't offer (untrusted input): the same state as one the
			// main layer doesn't offer, which the query client reports itself.
			if (this.picked.effective?.unusable)
				return { status: "unavailable", reason: "no-resolution" };
			if (this.picked.figurePending) {
				const f = this.#figure;
				const failed = f && f.key === figureKey && f.error !== undefined;
				return failed ? { status: "error", error: f.error } : { status: "loading" };
			}
			return figureState(withLevels(query.state, this.levels));
		});

		const layers = $derived(overlayLayers(widget().data, this.catalog));
		// Every overlay is fetched at the dataset's resolution alongside the main, not after it.
		const inputs = $derived(this.picked.overlays);
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

	/**
	 * The name of the figure `data`'s values are (`daily_statistic_label` or
	 * `period_statistic_label`), or `null` when they are plain values: no figure at its resolution,
	 * the server has no label, or the values were computed from raw measurements.
	 */
	figureLabel = (data: QueryData): string | null => {
		const f = this.figure;
		return f && f.resolution === data.resolution && !data.fromRaw ? f.figure.label : null;
	};

	retry = (): void => {
		const failed = [this.levels, ...this.#overlayLevels].some((l) => l && !Array.isArray(l));
		if (failed) this.#levelsTry++;
		if (this.#figure?.error !== undefined) this.#figureTry++;
		this.#query.retry();
		for (const q of this.#overlayQueries) q.retry();
	};
}
