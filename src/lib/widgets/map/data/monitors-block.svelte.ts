import { untrack } from "svelte";
import type { DataSource, DataStatus, MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { MonitorLatest } from "@sjvair/sdk";
import type { NowClient, NowSource, NowState } from "$lib/data/now/client";
import { NowQuery } from "$lib/data/now/now-query.svelte";
import { atKey, atOfKey, type Snapshot } from "$lib/data/snapshot";
import type { UnavailableReason } from "$lib/data/types";
import { todayPacific } from "$lib/format";
import { mapMessages } from "../host/messages";
import { monitorIds } from "../sources";
import { filterMonitors, placeMonitors } from "../toolbar/values";
import { AHEAD } from "./day-layer.svelte";
import type { MapDataInput } from "./loaded.svelte";
import {
	monitorsEntry,
	toDayFeatures,
	toMonitorFeatures,
	type DayRating,
	type DaySource
} from "./monitors";
import type { MonitorScope } from "./scope";
import { dataStatus } from "./status";
import { switchQueries } from "./switch";

/** A day's monitors: the list (names, positions) and the day's figures. */
type DayValue = { list: MonitorLatest[]; day: Snapshot };

const EMPTY_SNAPSHOT: Snapshot = { figures: new Map(), final: true, unrated: false };

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
function monitorsSourceOf(b: MonitorsBlock): DataSource<MonitorFeatureProperties> {
	return {
		get status(): DataStatus {
			return b.monitorsCurrent ? dataStatus(b.monitorsState) : { state: "loading" };
		},
		get features() {
			return b.monitorsShown;
		},
		get scale() {
			return b.monitorsDrawn?.scale ?? null;
		}
	};
}

/**
 * The map's monitors: the list (the pollutant showing's readings, limited by the places) and, on a
 * day, the day's figures joined to it, with the neighbouring days fetched ahead. The list (the
 * same on every day) polls only on now; the day's figures hourly while they aren't all final. Its
 * effects run in their own root; `destroy()` ends them and the queries.
 */
export class MonitorsBlock {
	readonly monitorsQuery: NowQuery<MonitorLatest[]>;
	readonly dayQuery: NowQuery<Snapshot>;
	/** The neighbouring days, fetched ahead and never polled. */
	readonly #dayAhead: NowQuery<Snapshot>[];

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
	/** Whether the map is worth drawing (on screen, the page visible). */
	#polling = $state(true);

	/** The places, as a key: the monitors' scope is resolved again only when they change. */
	readonly #placesKey = $derived.by(() => {
		const { layer, widget } = this.#getInput();
		const { place, selection } = widget.data;
		return layer ? JSON.stringify([place ?? null, selection ?? null]) : "";
	});
	/** Narrow deriveds, so an effect re-runs only when the one value it needs changes. */
	readonly #entryType = $derived.by(() => this.#getInput().entryType);
	readonly #loads = $derived.by(() => this.#getInput().loads);
	/** `"now"`, the day showing's date key, or the month or year showing's (`atKey`). */
	readonly #day = $derived.by(() => atKey(this.#getInput().at));
	readonly #aheadKey = $derived.by(() => this.#getInput().ahead.join(","));
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
	/** On a day, its figures poll: they aren't all final (smoke and fire follow them). */
	readonly dayPolls = $derived(
		this.onDay && !!this.#daySource && this.#daySource.poll(this.dayState.data)
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
		return untrack(() => {
			const { layer, widget } = this.#getInput();
			return placeMonitors(layer ? widget.data : undefined);
		});
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
		const { layer, widget } = this.#getInput();
		const place = layer ? widget.data.place : undefined;
		const state = this.listState;
		if (!this.monitorsCurrent || state.status !== "ready" || place?.kind !== "monitor") {
			return false;
		}
		return !state.data.some((reading) => reading.id === place.id);
	});

	constructor(getInput: () => MapDataInput, deps: { now: NowClient; rating: DayRating }) {
		this.#getInput = getInput;
		this.#rating = deps.rating;
		this.#now = deps.now;
		this.monitorsQuery = new NowQuery<MonitorLatest[]>(deps.now);
		this.dayQuery = new NowQuery<Snapshot>(deps.now);
		this.#dayAhead = Array.from({ length: AHEAD }, () => {
			const query = new NowQuery<Snapshot>(deps.now);
			query.setPolling(false);
			return query;
		});
		this.monitorsSource = monitorsSourceOf(this);
		this.#stopEffects = $effect.root(() => {
			this.#resolveMonitors();
			this.#resolveDay();
			this.#poll();
		});
	}

	/** Why the places can't be scoped to monitors, if they can't. */
	get monitorsUnavailable(): UnavailableReason | null {
		return this.#monitorsUnavailable;
	}

	/** Polls the list (on now) and a day's figures not final yet, only while `on`. */
	setPolling(on: boolean): void {
		this.#polling = on;
	}

	/** Fetches again what failed: the list, the day's figures, or both. */
	retry(): void {
		const day = this.onDay && this.dayState.status === "error";
		if (!day || this.listState.status === "error") this.monitorsQuery.retry();
		if (day) this.dayQuery.retry();
	}

	destroy(): void {
		this.#stopEffects();
		this.monitorsQuery.destroy();
		this.dayQuery.destroy();
		for (const query of this.#dayAhead) query.destroy();
	}

	#poll(): void {
		$effect(() => {
			// Now: the live readings every 3 minutes. A day: its figures hourly while they aren't
			// all final; its list never.
			const on = this.#polling;
			const day = this.onDay;
			const dayPolls = this.dayPolls;
			this.monitorsQuery.setPolling(on && !day);
			this.dayQuery.setPolling(on && dayPolls);
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
			const ahead = this.#aheadKey ? this.#aheadKey.split(",").slice(0, AHEAD) : [];
			if (!loads || !type || !scope || scope.for !== wanted) {
				// Nothing stale stands for the day wanted while its scope resolves.
				this.#daySource = null;
				this.#dayResolvedFor = null;
				this.dayQuery.set(null);
				for (const query of this.#dayAhead) query.set(null);
				return;
			}
			const sourceFor = (key: string) => {
				const at = atOfKey(key);
				return at === "now"
					? null
					: monitorsEntry.stopSource({
							scope: scope.scope,
							entryType: type,
							at,
							rating: this.#rating,
							today: () => todayPacific()
						});
			};
			// On the Now stop only the day before it is fetched ahead; at Monthly and Yearly nothing.
			const source = sourceFor(day);
			this.#daySource = source;
			this.#dayResolvedFor = source ? `${wanted}|${day}` : null;
			switchQueries<Snapshot>(this.#now, [
				[this.dayQuery, source],
				...this.#dayAhead.map((query, i): [NowQuery<Snapshot>, NowSource<Snapshot> | null] => [
					query,
					ahead[i] ? sourceFor(ahead[i]) : null
				])
			]);
		});
	}
}
