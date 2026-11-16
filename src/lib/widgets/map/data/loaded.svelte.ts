import { untrack } from "svelte";
import type {
	DataSource,
	DataStatus,
	FireFeatureProperties,
	MonitorFeatureProperties
} from "@sjvair/map-sdk/data";
import type { MonitorLatest, RegionSummaryBulkType } from "@sjvair/sdk";
import type { NowClient, NowSource, NowState } from "$lib/data/now/client";
import { NowQuery } from "$lib/data/now/now-query.svelte";
import type { Layer } from "$lib/data/schema";
import type { Snapshot, SnapshotAt } from "$lib/data/snapshot";
import type { UnavailableReason } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import { hasSmokeAndFire } from "$lib/get-data/map";
import { mapMessages } from "../host/messages";
import { monitorIds } from "../sources";
import { filterMonitors, placeMonitors, type MonitorFilters } from "../toolbar/values";
import { fillEntry, fillScale, type FillData, type FillSource } from "./fill";
import { hmsEntry, type HmsData } from "./hms";
import {
	monitorsEntry,
	toDayFeatures,
	toMonitorFeatures,
	type DayRating,
	type DaySource
} from "./monitors";
import type { MonitorScope } from "./scope";

/** What the data blocks read from the widget, each time they run. */
export type MapDataInput = {
	widget: WidgetInstance;
	layer: Layer | undefined;
	/** The pollutant drawn now. */
	entryType: string | undefined;
	/** Whether the tile loads its data: a map is (or will be) drawn. */
	loads: boolean;
	/** What the drawn monitors are filtered by (the toolbar's); null filters nothing. */
	filters: MonitorFilters | null;
	/** Now, or the day showing. */
	at: SnapshotAt;
	/** The days fetched ahead of a step (the neighbouring day stops); none on now. */
	ahead: readonly string[];
	/** The region type filled (one the metadata lists); null for no fill. */
	fill: RegionSummaryBulkType | null;
};

/** A day's monitors: the list (names, positions) and the day's figures. */
type DayValue = { list: MonitorLatest[]; day: Snapshot };

/** How many neighbouring days are fetched ahead (one each side). */
const AHEAD = 2;

const EMPTY_SNAPSHOT: Snapshot = { figures: new Map(), final: true, unrated: false };

/**
 * A now state as map-sdk's data status. Errors are the widget's to show (its error state or
 * its notes, each with one Retry), so map-sdk never sees one: held data reads as ready.
 */
function dataStatus(state: NowState<unknown>): DataStatus {
	return state.data === undefined && state.status !== "error"
		? { state: "loading" }
		: { state: "ready" };
}

/** The list's and the day's states as one: an error if either failed, ready once both are. */
function combined(list: NowState<MonitorLatest[]>, day: NowState<Snapshot>): NowState<DayValue> {
	const data =
		list.data !== undefined && day.data !== undefined
			? { list: list.data, day: day.data }
			: undefined;
	const failed = list.status === "error" ? list : day.status === "error" ? day : null;
	if (failed) return { status: "error", error: failed.error, ...(data && { data }) };
	if (list.status === "ready" && day.status === "ready" && data) {
		return { status: "ready", data, fetchedAt: Math.min(list.fetchedAt, day.fetchedAt) };
	}
	return { status: "loading", ...(data && { data }) };
}

/** One source for the monitors plugin, reading the query's current state. */
function monitorsSourceOf(d: MapData): DataSource<MonitorFeatureProperties> {
	return {
		get status(): DataStatus {
			return d.monitorsCurrent ? dataStatus(d.monitorsState) : { state: "loading" };
		},
		get features() {
			return d.monitorsShown;
		},
		get scale() {
			return d.monitorsDrawn?.scale ?? null;
		}
	};
}

/** One source per smoke and fire plugin source, reading the query's current state. */
function hmsSourceOf<P extends FireFeatureProperties>(
	d: MapData,
	key: "smoke" | "fireGroups" | "fireHotspots"
): DataSource<P> {
	return {
		get status() {
			return dataStatus(d.hmsState);
		},
		get features() {
			return d.hmsState.data === undefined
				? null
				: (d.hmsDrawn[key].features as DataSource<P>["features"]);
		},
		get scale() {
			return d.hmsDrawn[key].scale;
		}
	};
}

/** The fill's source for the regions plugin, reading the query's current state. */
function fillSourceOf(d: MapData): DataSource {
	// map-sdk matches a resolved scale to its source's by identity: one ScaleRef per pollutant.
	let known: { entryType: string; scale: ReturnType<typeof fillScale> } | undefined;
	return {
		get status() {
			return dataStatus(d.fillState);
		},
		get features() {
			return d.fillState.data?.features ?? null;
		},
		get scale() {
			const entryType = d.fillFor;
			if (!entryType) return null;
			if (known?.entryType !== entryType) known = { entryType, scale: fillScale(entryType) };
			return known.scale;
		}
	};
}

/**
 * The map widget's loaded data: the monitors (the pollutant showing's readings, or the day
 * showing's figures, limited by the places), the region fill (the day's figures, or today's so
 * far on now; over the whole map) and smoke and fire (now's or the day's). Its effects
 * run in their own root; `destroy()` ends them and the queries. Give the input as an object of
 * getters, so each field is read on its own (the filters follow the loaded monitors: reading them
 * with the places would be a cycle).
 *
 * On a day the monitors list (names, positions; the same on every day, so not polled) is joined
 * to the day's figures (polled hourly only while they aren't all final), and the neighbouring
 * days are fetched ahead.
 */
export class MapData {
	readonly monitorsQuery: NowQuery<MonitorLatest[]>;
	readonly dayQuery: NowQuery<Snapshot>;
	readonly hmsQuery: NowQuery<HmsData>;
	readonly fillQuery: NowQuery<FillData>;
	/** The neighbouring days, fetched ahead and never polled. */
	readonly #dayAhead: NowQuery<Snapshot>[];
	readonly #hmsAhead: NowQuery<HmsData>[];
	readonly #fillAhead: NowQuery<FillData>[];

	#getInput: () => MapDataInput;
	#rating: DayRating;
	#now: NowClient;
	#stopEffects: () => void;

	/** The pollutant the monitors query loads (the readings' scale). */
	#monitorsFor = $state<string | undefined>();
	/** Why the places can't be scoped to monitors, if they can't. */
	#monitorsUnavailable = $state.raw<UnavailableReason | null>(null);
	/** What the monitors query was resolved for; while it isn't `wantedKey`, its data is stale. */
	#resolvedFor = $state<string | null>(null);
	/** The places' scope, and the `wantedKey` it was resolved for (a day's figures need it). */
	#scope = $state.raw<{ for: string; scope: MonitorScope } | null>(null);
	/** What the day query was set for; while it isn't `#wantedDayKey`, its data is stale. */
	#dayResolvedFor = $state<string | null>(null);
	#daySource = $state.raw<DaySource | null>(null);
	#fillSource = $state.raw<FillSource | null>(null);
	/** The pollutant the fill query loads (its scale). */
	#fillFor = $state<string | undefined>();
	/** Whether the map is worth drawing (on screen, the page visible). */
	#polling = $state(true);

	/** The places, as a key: the monitors' scope is resolved again only when they change. */
	readonly #placesKey = $derived.by(() => {
		const layer = this.#getInput().layer;
		return layer ? JSON.stringify([layer.place ?? null, layer.selection ?? null]) : "";
	});
	/** Narrow deriveds, so an effect re-runs only when the one value it needs changes. */
	readonly #entryType = $derived.by(() => this.#getInput().entryType);
	readonly #loads = $derived.by(() => this.#getInput().loads);
	/** `"now"`, or the day showing's date key. */
	readonly #day = $derived.by(() => {
		const at = this.#getInput().at;
		return at === "now" ? "now" : at.day;
	});
	readonly #aheadKey = $derived.by(() => this.#getInput().ahead.join(","));
	readonly #fill = $derived.by(() => this.#getInput().fill);
	/** What the monitors are wanted for now: the places and the pollutant showing. */
	readonly #wantedKey = $derived(`${this.#placesKey}|${this.#entryType ?? ""}`);
	/** What the day's figures are wanted for: the places, the pollutant and the day. */
	readonly #wantedDayKey = $derived(`${this.#wantedKey}|${this.#day}`);

	/** A day shows (not now). */
	readonly onDay = $derived(this.#day !== "now");
	/**
	 * Whether the query is for the places and pollutant (and day) wanted now. After a change,
	 * until the new scope resolves, the old readings are neither drawn nor counted.
	 */
	readonly monitorsCurrent = $derived(
		this.#resolvedFor === this.#wantedKey &&
			(!this.onDay || this.#dayResolvedFor === this.#wantedDayKey)
	);
	readonly listState = $derived.by(() => this.monitorsQuery.state);
	readonly dayState = $derived.by(() => this.dayQuery.state);
	/** The monitors' state: the list's on now; on a day, the list's and the day's as one. */
	readonly monitorsState = $derived<NowState<MonitorLatest[] | DayValue>>(
		this.onDay ? combined(this.listState, this.dayState) : this.listState
	);
	readonly monitorsData = $derived(this.monitorsState.data);
	/** The monitors as map-sdk data; before they load, with no features but the scale. */
	readonly monitorsDrawn = $derived.by(() => {
		const entryType = this.#entryType;
		const type = this.monitorsCurrent ? (this.#monitorsFor ?? entryType) : entryType;
		if (!type) return null;
		const list = this.listState.data ?? [];
		const drawn = monitorsEntry.toDataSources(list, {
			messages: mapMessages,
			entryType: type
		}).monitors;
		if (!this.onDay) return drawn;
		const day = this.dayState.data;
		return { ...drawn, features: toDayFeatures(day ? list : [], day ?? EMPTY_SNAPSHOT) };
	});
	/**
	 * The monitors loaded for the places and pollutant (and day) wanted now, before the toolbar's
	 * filters; null until they load. Like `monitorsDrawn`, unfiltered ("no monitors here" isn't
	 * "all filtered out", and the camera doesn't follow the filters).
	 */
	readonly monitorsLoaded = $derived(
		!this.monitorsCurrent || this.monitorsData === undefined
			? null
			: (this.monitorsDrawn?.features ?? null)
	);
	/**
	 * The monitors in the places (with a position) for the pollutant showing, before the filters;
	 * null until they load. On now, those loaded; on a day, every listed one, with a figure that
	 * day or not (the same on every day, so the camera doesn't move with a step).
	 */
	readonly placesLoaded = $derived.by(() => {
		if (!this.onDay) return this.monitorsLoaded;
		const list = this.listState.data;
		return this.#resolvedFor === this.#wantedKey && list ? toMonitorFeatures(list) : null;
	});
	/** The ids of `placesLoaded`. */
	readonly inPlaces = $derived.by<ReadonlySet<string> | null>(() => {
		const loaded = this.placesLoaded;
		return loaded ? monitorIds(loaded) : null;
	});
	/** On a day, the monitors with a figure that day (before the filters); undefined on now. */
	readonly dayDrawn = $derived.by<ReadonlySet<string> | undefined>(() => {
		const loaded = this.monitorsLoaded;
		return this.onDay && loaded ? monitorIds(loaded) : undefined;
	});
	/** The day's figures can't be rated (the pollutant's scale has no daily figure). */
	readonly dayUnrated = $derived(
		this.onDay && this.monitorsCurrent && this.dayState.data?.unrated === true
	);
	/** The day's figures aren't all final yet. */
	readonly dayNotFinal = $derived(
		this.onDay && this.monitorsCurrent && this.dayState.data?.final === false
	);
	/**
	 * The day has loaded, and no monitor in the places has a figure that day (there are monitors
	 * in the places: with none, "no monitors here" says so). Never while the day loads.
	 */
	readonly dayNoFigures = $derived(
		this.onDay &&
			this.monitorsCurrent &&
			this.monitorsState.status === "ready" &&
			(this.monitorsLoaded?.features.length ?? 0) === 0 &&
			(this.inPlaces?.size ?? 0) > 0
	);
	readonly #filters = $derived.by(() => this.#getInput().filters);
	/** The monitors that are the tile's own places: the filters never hide them. */
	readonly exempt = $derived.by(() => {
		// Keyed by the places, so a new layer object with the same places changes nothing.
		void this.#placesKey;
		return untrack(() => placeMonitors(this.#getInput().layer));
	});
	/** The monitors drawn: those loaded, after the toolbar's filters (the places' own kept). */
	readonly monitorsShown = $derived.by(() => {
		const features = this.monitorsLoaded;
		const filters = this.#filters;
		return filters ? filterMonitors(features, filters, this.exempt) : features;
	});
	/** One source for the monitors plugin, reading the query's current state. */
	readonly monitorsSource: DataSource<MonitorFeatureProperties>;
	/** Loading the monitors for the first time (the skeleton shows over the map). */
	readonly monitorsLoading = $derived(
		this.#loads &&
			!this.#monitorsUnavailable &&
			this.monitorsData === undefined &&
			this.monitorsState.status !== "error"
	);
	/** A refresh failed: the earlier readings stay drawn, with a note and Retry. */
	readonly monitorsRefreshFailed = $derived(
		this.monitorsCurrent && this.monitorsState.status === "error" && this.monitorsData !== undefined
	);
	/** A monitor place the loaded readings don't list (retired, say): the map still draws. */
	readonly unlisted = $derived.by(() => {
		const place = this.#getInput().layer?.place;
		const state = this.listState;
		if (!this.monitorsCurrent || state.status !== "ready" || place?.kind !== "monitor") {
			return false;
		}
		return !state.data.some((reading) => reading.id === place.id);
	});

	/** Whether smoke and fire are on. */
	readonly smokeAndFire = $derived.by(() => hasSmokeAndFire(this.#getInput().widget.data));
	readonly hmsState = $derived.by(() => this.hmsQuery.state);
	/** Smoke and fire as map-sdk data; before they load, with no features but the scales. */
	readonly hmsDrawn = $derived(
		hmsEntry.toDataSources(this.hmsState.data ?? { smoke: [], fires: [] }, {
			messages: mapMessages,
			entryType: this.#entryType ?? ""
		})
	);
	readonly smokeSource: DataSource<FireFeatureProperties>;
	readonly fireSource: DataSource<FireFeatureProperties>;
	readonly hotspotsSource: DataSource<FireFeatureProperties>;
	readonly hmsFailed = $derived(this.hmsState.status === "error");

	readonly fillState = $derived.by(() => this.fillQuery.state);
	/** The fill's source for the regions plugin; no features until it loads. */
	readonly fillSource: DataSource;
	/** The fill failed to load. */
	readonly fillFailed = $derived(this.fillState.status === "error");

	constructor(getInput: () => MapDataInput, deps: { now: NowClient; rating: DayRating }) {
		this.#getInput = getInput;
		this.#rating = deps.rating;
		this.#now = deps.now;
		this.monitorsQuery = new NowQuery<MonitorLatest[]>(deps.now);
		this.dayQuery = new NowQuery<Snapshot>(deps.now);
		this.hmsQuery = new NowQuery<HmsData>(deps.now);
		this.fillQuery = new NowQuery<FillData>(deps.now);
		const ahead = <T>() =>
			Array.from({ length: AHEAD }, () => {
				const query = new NowQuery<T>(deps.now);
				query.setPolling(false);
				return query;
			});
		this.#dayAhead = ahead<Snapshot>();
		this.#hmsAhead = ahead<HmsData>();
		this.#fillAhead = ahead<FillData>();

		this.monitorsSource = monitorsSourceOf(this);
		this.smokeSource = hmsSourceOf(this, "smoke");
		this.fireSource = hmsSourceOf(this, "fireGroups");
		this.hotspotsSource = hmsSourceOf(this, "fireHotspots");
		this.fillSource = fillSourceOf(this);

		this.#stopEffects = $effect.root(() => {
			this.#resolveMonitors();
			this.#resolveDay();
			this.#resolveHms();
			this.#resolveFill();
			this.#poll();
		});
	}

	/** Why the places can't be scoped to monitors, if they can't. */
	get monitorsUnavailable(): UnavailableReason | null {
		return this.#monitorsUnavailable;
	}

	/** Polls the live data (and a day's figures not final yet) only while the map is worth drawing. */
	setPolling(on: boolean): void {
		this.#polling = on;
	}

	/** Fetches again what failed: the list, the day's figures, or both. */
	retryMonitors(): void {
		const day = this.onDay && this.dayState.status === "error";
		if (!day || this.listState.status === "error") this.monitorsQuery.retry();
		if (day) this.dayQuery.retry();
	}

	retryHms(): void {
		this.hmsQuery.retry();
	}

	retryFill(): void {
		this.fillQuery.retry();
	}

	/** The pollutant the fill loads (its scale); undefined with no fill. */
	get fillFor(): string | undefined {
		return this.#fillFor;
	}

	destroy(): void {
		this.#stopEffects();
		this.monitorsQuery.destroy();
		this.dayQuery.destroy();
		this.hmsQuery.destroy();
		this.fillQuery.destroy();
		for (const query of [...this.#dayAhead, ...this.#hmsAhead, ...this.#fillAhead]) {
			query.destroy();
		}
	}

	/**
	 * Sets each query to its source, holding every wanted source while they switch, so a key one
	 * query lets go and another takes up (a day stepped back to, still wanted ahead) is never
	 * dropped, and its fetch in flight never aborted and asked for again.
	 */
	#switch<T>(pairs: [NowQuery<T>, NowSource<T> | null][]): void {
		const holds = pairs.flatMap(([, source]) => {
			if (!source) return [];
			const hold = this.#now.subscribe(source, () => {});
			hold.setPolling(false);
			return [hold];
		});
		for (const [query, source] of pairs) query.set(source);
		for (const hold of holds) hold.unsubscribe();
	}

	/** The days to fetch ahead, as the input names them. */
	#ahead(): string[] {
		const key = this.#aheadKey;
		return key ? key.split(",").slice(0, AHEAD) : [];
	}

	#poll(): void {
		$effect(() => {
			const on = this.#polling;
			const day = this.onDay;
			const figures = this.dayState.data;
			const source = this.#daySource;
			// Now: the live readings every 3 minutes, smoke and fire hourly. A day: its figures
			// (and its smoke and fire) hourly while they aren't all final; its list never.
			const dayPolls = day && !!source && source.poll(figures);
			this.monitorsQuery.setPolling(on && !day);
			this.dayQuery.setPolling(on && dayPolls);
			this.hmsQuery.setPolling(on && (!day || dayPolls));
		});
		$effect(() => {
			// The fill: today so far hourly on now; a day's hourly while it isn't all final.
			const on = this.#polling;
			const source = this.#fillSource;
			const value = this.fillState.data;
			this.fillQuery.setPolling(on && !!source && source.poll(value));
		});
	}

	#resolveMonitors(): void {
		$effect(() => {
			const wanted = this.#wantedKey;
			const type = this.#entryType;
			const loads = this.#loads;
			const widget = untrack(() => this.#getInput().widget);
			if (!loads || !type) {
				this.#monitorsUnavailable = null;
				this.#scope = null;
				this.monitorsQuery.set(null);
				return;
			}
			const data = untrack(() => $state.snapshot(widget.data));
			let cancelled = false;
			const abort = new AbortController();
			// The list is the same on every day: its scope never depends on the day.
			const resolve = (signal?: AbortSignal) =>
				monitorsEntry.source({ data, entryType: type, at: "now" }, signal);
			resolve(abort.signal).then(
				(source) => {
					if (cancelled) return;
					const found = source && "fetch" in source ? source : null;
					this.#monitorsUnavailable = source && "unavailable" in source ? source.unavailable : null;
					this.#monitorsFor = type;
					this.#scope = found ? { for: wanted, scope: found.scope } : null;
					this.#resolvedFor = wanted;
					this.monitorsQuery.set(found);
				},
				(error: unknown) => {
					if (cancelled) return;
					this.#monitorsUnavailable = null;
					this.#monitorsFor = type;
					this.#scope = null;
					this.#resolvedFor = wanted;
					// The scope couldn't be resolved: keyed by widget (never by the places), and Retry
					// resolves it again before fetching.
					let failedOnce = false;
					this.monitorsQuery.set({
						key: `map-monitors:unresolved:${widget.id}`,
						cadence: "raw",
						fetch: async (signal) => {
							// The first fetch reports the failure that got us here; later ones try again.
							if (!failedOnce) {
								failedOnce = true;
								throw error;
							}
							const source = await resolve(signal);
							if (!source || "unavailable" in source) {
								this.#monitorsUnavailable = source?.unavailable ?? null;
								return [];
							}
							if (!cancelled) this.#scope = { for: wanted, scope: source.scope };
							return source.fetch(signal);
						}
					});
				}
			);
			return () => {
				cancelled = true;
				abort.abort();
			};
		});
	}

	#resolveDay(): void {
		$effect(() => {
			const day = this.#day;
			const type = this.#entryType;
			const loads = this.#loads;
			const wanted = this.#wantedKey;
			const scope = this.#scope;
			const ahead = this.#ahead();
			if (!loads || !type || !scope || scope.for !== wanted) {
				// Nothing stale stands for the day wanted while its scope resolves.
				this.#daySource = null;
				this.#dayResolvedFor = null;
				this.dayQuery.set(null);
				for (const query of this.#dayAhead) query.set(null);
				return;
			}
			const sourceFor = (d: string) =>
				monitorsEntry.daySource({
					scope: scope.scope,
					entryType: type,
					day: d,
					rating: this.#rating,
					today: () => todayPacific()
				});
			// On the Now stop only the day before it is fetched ahead.
			const source = day === "now" ? null : sourceFor(day);
			this.#daySource = source;
			this.#dayResolvedFor = source ? `${wanted}|${day}` : null;
			this.#switch<Snapshot>([
				[this.dayQuery, source],
				...this.#dayAhead.map((query, i): [NowQuery<Snapshot>, NowSource<Snapshot> | null] => [
					query,
					ahead[i] ? sourceFor(ahead[i]) : null
				])
			]);
		});
	}

	#resolveHms(): void {
		$effect(() => {
			const day = this.#day;
			const ahead = this.#ahead();
			if (!this.#loads || !this.smokeAndFire) {
				this.hmsQuery.set(null);
				for (const query of this.#hmsAhead) query.set(null);
				return;
			}
			const input = untrack(() => ({
				data: $state.snapshot(this.#getInput().widget.data),
				entryType: this.#entryType ?? ""
			}));
			let cancelled = false;
			const sourceFor = (at: SnapshotAt) => hmsEntry.source({ ...input, at });
			const found = (source: Awaited<ReturnType<typeof sourceFor>>) =>
				source && "fetch" in source ? source : null;
			void Promise.all([
				sourceFor(day === "now" ? "now" : { day }),
				...this.#hmsAhead.map((_, i) => (ahead[i] ? sourceFor({ day: ahead[i] }) : null))
			]).then(([main, ...next]) => {
				if (cancelled) return;
				this.#switch<HmsData>([
					[this.hmsQuery, found(main)],
					...this.#hmsAhead.map((query, i): [NowQuery<HmsData>, NowSource<HmsData> | null] => [
						query,
						next[i] ? found(next[i]) : null
					])
				]);
			});
			return () => {
				cancelled = true;
			};
		});
	}

	#resolveFill(): void {
		$effect(() => {
			const day = this.#day;
			const type = this.#entryType;
			const regionType = this.#fill;
			const ahead = this.#ahead();
			if (!this.#loads || !type || !regionType) {
				this.#fillSource = null;
				this.#fillFor = undefined;
				this.fillQuery.set(null);
				for (const query of this.#fillAhead) query.set(null);
				return;
			}
			const sourceFor = (at: SnapshotAt) => fillEntry.source({ regionType, entryType: type, at });
			const source = sourceFor(day === "now" ? "now" : { day });
			this.#fillSource = source;
			this.#fillFor = type;
			this.#switch<FillData>([
				[this.fillQuery, source],
				...this.#fillAhead.map((query, i): [NowQuery<FillData>, NowSource<FillData> | null] => [
					query,
					ahead[i] ? sourceFor({ day: ahead[i] }) : null
				])
			]);
		});
	}
}
