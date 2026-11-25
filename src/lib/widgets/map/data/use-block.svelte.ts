import { untrack } from "svelte";
import { geometryBbox, type Bounds } from "@sjvair/map-sdk";
import {
	decodeRef,
	encodeRef,
	type DataSource,
	type DataStatus,
	type ScaleRef
} from "@sjvair/map-sdk/data";
import type { PesticideUseClasses } from "@sjvair/sdk";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { pesticideMeta } from "$lib/data/pesticide-meta";
import { m } from "$lib/paraglide/messages.js";
import { periodLabel, periodListed } from "../use-period";
import {
	sectionsFor,
	TooLarge,
	townshipsFor,
	useClassesOf,
	useFiltersGone,
	useQueryKey,
	withFigure,
	type UseLoaded,
	type UseProps,
	type UseQuery
} from "./use";
import { BBOX_PAD, contains, padBounds, townshipBlock, unionBounds } from "./use-geometry";
import { registerUseScale, useScaleRef, type UseLevel } from "./use-scale";

/** What the use block reads from the widget, each time it runs. */
export type UseBlockInput = {
	/** Whether use loads: the tile has the layer and a map is drawn. */
	on: boolean;
	/** What to draw; null when the figure isn't known yet. */
	query: UseQuery | null;
	/** The map's view; null before the map has one. */
	bounds: Bounds | null;
	zoom: number;
	/** The zoom from which sections are drawn (with any refused zoom added). */
	sectionZoom: number;
	/** The township refKey the lens is centred on, or null. */
	lensCenter: string | null;
};

export type UseState = "loading" | "ready" | "error" | "no-data" | "filter-gone";

/** Loaded features for one query key, with the classes they came with. */
type Held = {
	key: string;
	classes: PesticideUseClasses;
	features: Feature<Geometry, UseProps>[];
};

/** How long the view rests before its sections are asked for. */
const SECTIONS_WAIT = 300;
/** How long the lens rests on a township before its block is asked for. */
const LENS_WAIT = 50;

const NO_CLASSES: PesticideUseClasses = {
	lbs_chemical: { breaks: [], min: null, colors: [] },
	acres_treated: { breaks: [], min: null, colors: [] },
	applications: { breaks: [], min: null, colors: [] }
};

const TOWNSHIP = "township:";

const townshipRef = (id: string) => encodeRef({ kind: "feature", id: `${TOWNSHIP}${id}` });

/** The township id a township refKey names, or null. */
function townshipIdOf(refKey: string): string | null {
	const ref = decodeRef(refKey);
	return ref?.kind === "feature" && ref.id.startsWith(TOWNSHIP)
		? ref.id.slice(TOWNSHIP.length)
		: null;
}

const collection = (
	features: Feature<Geometry, UseProps>[]
): FeatureCollection<Geometry, UseProps> => ({ type: "FeatureCollection", features });

/** A data source whose fields are read, each on its own, from `read`. */
function sourceOf(read: {
	status: () => DataStatus;
	features: () => FeatureCollection<Geometry, UseProps> | null;
	scale: () => ScaleRef | null;
}): DataSource<UseProps> {
	return {
		get status() {
			return read.status();
		},
		get features() {
			return read.features();
		},
		get scale() {
			return read.scale();
		}
	};
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * The pesticide use layer's data: the valley's townships for the query, the sections in the
 * (padded) view from the section zoom, and the lens's 3 × 3 block of sections. Each source's
 * scale is registered from its response's classes before the source exposes it. Use never
 * polls: the data changes at most once a year. Its effects run in their own root; `destroy()`
 * ends them and every request.
 */
export class UseBlock {
	readonly #getInput: () => UseBlockInput;
	readonly #stop: () => void;
	/** Aborted on destroy: the lens's loads. */
	readonly #abort = new AbortController();

	#townships = $state.raw<Held | null>(null);
	#sections = $state.raw<(Held & { bounds: Bounds }) | null>(null);
	#lens = $state.raw<(Held & { blocks: ReadonlySet<string> }) | null>(null);
	/** The townships' scale shown last, kept while a new key loads so the legend stays. */
	#lastTownshipsRef = $state.raw<ScaleRef | null>(null);
	#lastSectionsRef = $state.raw<ScaleRef | null>(null);
	#retries = $state(0);
	#sectionsRetries = $state(0);

	#townshipsRun = 0;
	#townshipsLoad: AbortController | null = null;
	#sectionsRun = 0;
	#sectionsLoad: AbortController | null = null;
	/** The key of the sections load in flight; null with none. */
	#sectionsFor: string | null = null;
	#sectionsTimer: ReturnType<typeof setTimeout> | undefined;
	#lensTimer: ReturnType<typeof setTimeout> | undefined;
	/** Lens blocks in flight, as `key|center`. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
	readonly #lensPending = new Set<string>();

	townshipsState = $state<UseState>("loading");
	sectionsFailed = $state(false);
	/** How many zooms past the section zoom the server's refusals have pushed the sections. */
	refusedZoom = $state(0);

	/** Narrow deriveds, so an effect re-runs only when the one value it needs changes. */
	readonly #on = $derived.by(() => this.#getInput().on);
	readonly #key = $derived.by(() => {
		const q = this.#getInput().query;
		return q ? useQueryKey(q) : null;
	});
	readonly #figure = $derived.by(() => this.#getInput().query?.figure ?? null);
	/** The scale info, as a key (the label, units and precision). */
	readonly #infoKey = $derived.by(() => JSON.stringify(this.#getInput().query?.info ?? null));
	readonly #atSections = $derived.by(() => {
		const input = this.#getInput();
		return input.zoom >= input.sectionZoom;
	});
	readonly #boundsKey = $derived.by(() => {
		const b = this.#getInput().bounds;
		return b ? `${b.west},${b.south},${b.east},${b.north}` : null;
	});
	readonly #center = $derived.by(() => this.#getInput().lensCenter);
	/** Whether the townships for the current key are loaded (sections and the lens wait for it). */
	readonly #ready = $derived(this.#townships !== null && this.#townships.key === this.#key);

	/** Each loaded township's bounds, for the lens's block. */
	readonly #townshipBounds = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built here, never changed after
		const bounds = new Map<string, [number, number, number, number]>();
		for (const f of this.#townships?.features ?? []) {
			const box = geometryBbox(f.geometry);
			if (box) bounds.set(f.properties.id, box);
		}
		return bounds;
	});

	/** The held features for the current key, shown with the current figure and its scale. */
	readonly #townshipsShown = $derived.by(() =>
		this.#shown(this.#townships, "township", this.townshipsState === "no-data")
	);
	readonly #sectionsShown = $derived.by(() => this.#shown(this.#sections, "section"));
	readonly #lensShown = $derived.by(() => this.#shown(this.#lens, "section"));
	/**
	 * When the key's townships failed, a filter is gone or the period isn't listed, nothing will
	 * load for it: an empty scale under the key's own ref, never the previous key's classes.
	 */
	readonly #unloadable = $derived(
		this.townshipsState === "error" ||
			this.townshipsState === "filter-gone" ||
			this.townshipsState === "no-data"
	);
	readonly #townshipsEmpty = $derived.by(() =>
		this.#unloadable ? this.#shown(null, "township", true) : null
	);
	readonly #sectionsEmpty = $derived.by(() =>
		this.#unloadable || this.sectionsFailed ? this.#shown(null, "section", true) : null
	);
	/**
	 * The sections' and the lens's one scale: whichever has loaded for the key; while they load,
	 * the last one shown (no legend flicker on a pan).
	 */
	readonly #sectionsRef = $derived(
		this.#sectionsShown?.ref ??
			this.#lensShown?.ref ??
			this.#sectionsEmpty?.ref ??
			this.#lastSectionsRef
	);

	readonly townships: DataSource<UseProps>;
	readonly sections: DataSource<UseProps>;
	readonly lens: DataSource<UseProps>;

	constructor(getInput: () => UseBlockInput) {
		this.#getInput = getInput;
		this.townships = sourceOf({
			status: () => {
				const unavailable = this.#unavailable();
				if (unavailable) return unavailable;
				// Errors are the widget's to show (a note with Retry), as the other layers do.
				return this.townshipsState === "loading" ? { state: "loading" } : { state: "ready" };
			},
			features: () => this.#townshipsShown?.features ?? null,
			// While the key loads, the last scale shown (the legend reads loading meanwhile).
			scale: () =>
				this.#townshipsShown?.ref ??
				this.#townshipsEmpty?.ref ??
				(this.townshipsState === "loading" ? this.#lastTownshipsRef : null)
		});
		this.sections = sourceOf({
			// From the section zoom (where the townships hide) the sections carry the same row; the
			// zoom ranges don't overlap, so the legend shows it once. The lens adds none.
			status: () => this.#unavailable() ?? { state: "ready" },
			features: () => this.#sectionsShown?.features ?? null,
			scale: () => this.#sectionsRef
		});
		this.lens = sourceOf({
			status: () => ({ state: "ready" }),
			features: () => this.#lensShown?.features ?? null,
			scale: () => this.#sectionsRef
		});

		this.#stop = $effect.root(() => {
			$effect(() => {
				const shown = this.#townshipsShown;
				if (shown) untrack(() => (this.#lastTownshipsRef = shown.ref));
			});
			$effect(() => {
				const ref = this.#sectionsShown?.ref ?? this.#lensShown?.ref;
				if (ref) untrack(() => (this.#lastSectionsRef = ref));
			});
			$effect(() => this.#townshipsEffect());
			$effect(() => this.#sectionsEffect());
			$effect(() => this.#lensEffect());
		});
	}

	/**
	 * Why nothing can load for the key, as the legend's status row (the map's banner says so too,
	 * with Edit data, for a gone filter): a gone filter, or a period the server doesn't list (an
	 * empty scale would make no legend section, and so no note). Null otherwise.
	 */
	#unavailable(): Extract<DataStatus, { state: "unavailable" }> | null {
		const state = this.townshipsState;
		if (state === "filter-gone")
			return { state: "unavailable", reason: "filter-gone", message: m.map_use_filter_gone() };
		if (state === "no-data") {
			const period = this.#getInput().query?.period;
			return {
				state: "unavailable",
				reason: "no-data",
				...(period && { message: m.map_use_none_yet({ period: periodLabel(period) }) })
			};
		}
		return null;
	}

	/** The township refKeys of the block centred on `refKey` (itself included). */
	blockOf(refKey: string): string[] {
		const id = townshipIdOf(refKey);
		return id ? townshipBlock(id, this.#townshipBounds).map(townshipRef) : [];
	}

	/**
	 * Whether the lens source already holds every section of the township `refKey` names, so the
	 * lens can keep it drawn while it arrives instead of clearing it. False for a section ref, with
	 * no lens, or for a lens of another key. Reads the reactive lens, so the lens re-checks when
	 * a block lands.
	 */
	childrenLoaded(refKey: string): boolean {
		const id = townshipIdOf(refKey);
		const lens = this.#lens;
		if (!id || !lens || lens.key !== this.#key) return false;
		return [...lens.blocks].some((b) => townshipBlock(b, this.#townshipBounds).includes(id));
	}

	/** A section's township refKey; null for a township. */
	parentOf(props: UseProps): string | null {
		return props.level === "section" ? townshipRef(props.township) : null;
	}

	/** Asks again for what failed: the townships, the sections or the lens. */
	retry(): void {
		if (this.townshipsState === "error") this.#retries++;
		if (this.sectionsFailed) {
			this.sectionsFailed = false;
			this.#sectionsRetries++;
		}
	}

	destroy(): void {
		this.#stop();
		clearTimeout(this.#sectionsTimer);
		clearTimeout(this.#lensTimer);
		this.#townshipsLoad?.abort();
		this.#sectionsLoad?.abort();
		this.#abort.abort();
	}

	/**
	 * `held` with the current figure's values and its scale ref, registered from `held`'s classes
	 * before it is returned; null when nothing is held for the current key. With `empty`, an empty
	 * scale and no features (a period the server doesn't list).
	 */
	#shown(
		held: Held | null,
		level: UseLevel,
		empty = false
	): { ref: ScaleRef; features: FeatureCollection<Geometry, UseProps> } | null {
		const key = this.#key;
		const figure = this.#figure;
		void this.#infoKey;
		const query = untrack(() => this.#getInput().query);
		if (key === null || figure === null || !query) return null;
		if (empty) {
			const ref = useScaleRef(figure, level, key);
			registerUseScale(ref, useClassesOf(NO_CLASSES, figure), query.info);
			return { ref, features: collection([]) };
		}
		if (!held || held.key !== key) return null;
		const ref = useScaleRef(figure, level, key);
		registerUseScale(ref, useClassesOf(held.classes, figure), query.info);
		return { ref, features: collection(withFigure(held.features, figure)) };
	}

	#townshipsEffect(): void {
		const on = this.#on;
		const key = this.#key;
		void this.#retries;
		const run = ++this.#townshipsRun;
		this.#townshipsLoad?.abort();
		this.#townshipsLoad = null;
		if (!on || key === null) return;
		const query = untrack(() => $state.snapshot(this.#getInput().query) as UseQuery);
		untrack(() => {
			if (this.#townships?.key === key && this.townshipsState === "ready") return;
			if (this.#townships && this.#townships.key !== key) {
				this.#townships = null;
				this.#sections = null;
				this.#lens = null;
			}
			this.townshipsState = "loading";
			const load = new AbortController();
			this.#townshipsLoad = load;
			void this.#loadTownships(query, key, run, load.signal);
		});
	}

	async #loadTownships(query: UseQuery, key: string, run: number, signal: AbortSignal) {
		const current = () => run === this.#townshipsRun && !signal.aborted;
		try {
			const meta = await pesticideMeta(signal);
			if (!current()) return;
			// A year the server doesn't list has no use reported yet: never ask for one.
			if (!periodListed(query.period, meta.years)) {
				this.townshipsState = "no-data";
				return;
			}
			if (await useFiltersGone(query.filters)) {
				if (current()) this.townshipsState = "filter-gone";
				return;
			}
			if (!current()) return;
			const loaded = await townshipsFor(query, signal);
			if (!current()) return;
			this.#townships = { key, ...loaded };
			this.townshipsState = "ready";
		} catch (error) {
			if (!current() || isAbort(error)) return;
			this.townshipsState = "error";
		}
	}

	#sectionsEffect(): void {
		const on = this.#on;
		const key = this.#key;
		const atSections = this.#atSections;
		const boundsKey = this.#boundsKey;
		const ready = this.#ready;
		void this.#sectionsRetries;
		clearTimeout(this.#sectionsTimer);
		// Off, or another key: a load in flight is for a query no longer shown, so it writes nothing.
		if (this.#sectionsLoad && (!on || key !== this.#sectionsFor)) this.#dropSections();
		if (!on || key === null || !atSections || boundsKey === null || !ready) return;
		untrack(() => {
			const bounds = this.#getInput().bounds as Bounds;
			const held = this.#sections;
			if (held?.key === key && contains(held.bounds, bounds)) return;
			const query = $state.snapshot(this.#getInput().query) as UseQuery;
			this.#sectionsTimer = setTimeout(() => {
				void this.#loadSections(query, key, bounds);
			}, SECTIONS_WAIT);
		});
	}

	/** Stops the sections load in flight, if any, so it writes nothing. */
	#dropSections(): void {
		this.#sectionsRun++;
		this.#sectionsLoad?.abort();
		this.#sectionsLoad = null;
		this.#sectionsFor = null;
	}

	async #loadSections(query: UseQuery, key: string, view: Bounds) {
		const run = ++this.#sectionsRun;
		this.#sectionsLoad?.abort();
		this.#sectionsFor = key;
		const load = new AbortController();
		this.#sectionsLoad = load;
		const signal = load.signal;
		const current = () => run === this.#sectionsRun && !signal.aborted;
		const padded = padBounds(view, BBOX_PAD);
		try {
			let loaded: UseLoaded;
			let bounds = padded;
			try {
				loaded = await sectionsFor(query, padded, signal);
			} catch (error) {
				if (!(error instanceof TooLarge)) throw error;
				if (!current()) return;
				// Padded is too much: the view alone, then give up and raise the section zoom.
				bounds = view;
				loaded = await sectionsFor(query, view, signal);
			}
			if (!current()) return;
			this.#sections = { key, ...loaded, bounds };
			this.sectionsFailed = false;
		} catch (error) {
			if (!current() || isAbort(error)) return;
			if (error instanceof TooLarge) this.refusedZoom++;
			else this.sectionsFailed = true;
		} finally {
			if (this.#sectionsLoad === load) {
				this.#sectionsLoad = null;
				this.#sectionsFor = null;
			}
		}
	}

	#lensEffect(): void {
		const on = this.#on;
		const key = this.#key;
		const center = this.#center;
		const ready = this.#ready;
		void this.#sectionsRetries;
		clearTimeout(this.#lensTimer);
		if (!on || key === null || center === null || !ready) return;
		const id = townshipIdOf(center);
		if (id === null) return;
		untrack(() => {
			const blockKey = `${key}|${id}`;
			if (this.#lens?.key === key && this.#lens.blocks.has(id)) return;
			if (this.#lensPending.has(blockKey)) return;
			const query = $state.snapshot(this.#getInput().query) as UseQuery;
			this.#lensTimer = setTimeout(() => {
				void this.#loadLens(query, key, id);
			}, LENS_WAIT);
		});
	}

	async #loadLens(query: UseQuery, key: string, id: string) {
		const all = this.#townshipBounds;
		const boxes = townshipBlock(id, all).flatMap((t) => {
			const b = all.get(t);
			return b ? [{ west: b[0], south: b[1], east: b[2], north: b[3] }] : [];
		});
		if (boxes.length === 0) return;
		const blockKey = `${key}|${id}`;
		this.#lensPending.add(blockKey);
		const signal = this.#abort.signal;
		try {
			const loaded = await sectionsFor(query, unionBounds(boxes), signal);
			if (signal.aborted || this.#key !== key) return;
			// Earlier blocks' sections stay: the lens may come back to them.
			const prior = this.#lens?.key === key ? this.#lens : null;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local merge, not state
			const byId = new Map((prior?.features ?? []).map((f) => [f.properties.id, f]));
			for (const f of loaded.features) byId.set(f.properties.id, f);
			this.#lens = {
				key,
				classes: loaded.classes,
				features: [...byId.values()],
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced, never changed
				blocks: new Set([...(prior?.blocks ?? []), id])
			};
		} catch (error) {
			// Off, or another key: the failure is for a query no longer shown.
			if (signal.aborted || isAbort(error) || this.#key !== key || !this.#on) return;
			this.sectionsFailed = true;
		} finally {
			this.#lensPending.delete(blockKey);
		}
	}
}
