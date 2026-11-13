import { untrack } from "svelte";
import type {
	DataSource,
	DataStatus,
	FireFeatureProperties,
	MonitorFeatureProperties
} from "@sjvair/map-sdk/data";
import type { MonitorLatest } from "@sjvair/sdk";
import type { NowClient, NowState } from "$lib/data/now/client";
import { NowQuery } from "$lib/data/now/now-query.svelte";
import type { Layer } from "$lib/data/schema";
import type { UnavailableReason } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { hasSmokeAndFire } from "$lib/get-data/map";
import { mapMessages } from "../host/messages";
import { hmsEntry, type HmsData } from "./hms";
import { monitorsEntry } from "./monitors";

/** What the data blocks read from the widget, each time they run. */
export type MapDataInput = {
	widget: WidgetInstance;
	layer: Layer | undefined;
	/** The pollutant drawn now. */
	entryType: string | undefined;
	/** Whether the tile loads its data: a map is (or will be) drawn. */
	loads: boolean;
};

/**
 * A now state as map-sdk's data status. Errors are the widget's to show (its error state or
 * its notes, each with one Retry), so map-sdk never sees one: held data reads as ready.
 */
function dataStatus(state: NowState<unknown>): DataStatus {
	return state.data === undefined && state.status !== "error"
		? { state: "loading" }
		: { state: "ready" };
}

/**
 * The map widget's loaded data: the monitors (the pollutant showing's readings, limited by the
 * places) and smoke and fire. Its effects run in their own root; `destroy()` ends them and the
 * queries.
 */
export class MapData {
	readonly monitorsQuery: NowQuery<MonitorLatest[]>;
	readonly hmsQuery: NowQuery<HmsData>;

	#getInput: () => MapDataInput;
	#stopEffects: () => void;

	/** The pollutant the monitors query loads (the readings' scale). */
	#monitorsFor = $state<string | undefined>();
	/** Why the places can't be scoped to monitors, if they can't. */
	#monitorsUnavailable = $state.raw<UnavailableReason | null>(null);
	/** What the monitors query was resolved for; while it isn't `wantedKey`, its data is stale. */
	#resolvedFor = $state<string | null>(null);

	/** The places, as a key: the monitors' scope is resolved again only when they change. */
	readonly #placesKey = $derived.by(() => {
		const layer = this.#getInput().layer;
		return layer ? JSON.stringify([layer.place ?? null, layer.selection ?? null]) : "";
	});
	/** Narrow deriveds, so an effect re-runs only when the one value it needs changes. */
	readonly #entryType = $derived.by(() => this.#getInput().entryType);
	readonly #loads = $derived.by(() => this.#getInput().loads);
	/** What the monitors are wanted for now: the places and the pollutant showing. */
	readonly #wantedKey = $derived(`${this.#placesKey}|${this.#entryType ?? ""}`);

	/**
	 * Whether the query is for the places and pollutant wanted now. After a change, until the new
	 * scope resolves, the old readings are neither drawn nor counted.
	 */
	readonly monitorsCurrent = $derived(this.#resolvedFor === this.#wantedKey);
	readonly monitorsState = $derived.by(() => this.monitorsQuery.state);
	readonly monitorsData = $derived(this.monitorsState.data);
	/** The monitors as map-sdk data; before they load, with no features but the scale. */
	readonly monitorsDrawn = $derived.by(() => {
		const entryType = this.#entryType;
		const type = this.monitorsCurrent ? (this.#monitorsFor ?? entryType) : entryType;
		if (!type) return null;
		return monitorsEntry.toDataSources(this.monitorsData ?? [], {
			messages: mapMessages,
			entryType: type
		}).monitors;
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
		const state = this.monitorsState;
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

	constructor(getInput: () => MapDataInput, deps: { now: NowClient }) {
		this.#getInput = getInput;
		this.monitorsQuery = new NowQuery<MonitorLatest[]>(deps.now);
		this.hmsQuery = new NowQuery<HmsData>(deps.now);

		const self = this;
		this.monitorsSource = {
			get status(): DataStatus {
				return self.monitorsCurrent ? dataStatus(self.monitorsState) : { state: "loading" };
			},
			get features() {
				return !self.monitorsCurrent || self.monitorsData === undefined
					? null
					: (self.monitorsDrawn?.features ?? null);
			},
			get scale() {
				return self.monitorsDrawn?.scale ?? null;
			}
		};
		this.smokeSource = this.#hmsSource("smoke");
		this.fireSource = this.#hmsSource("fireGroups");
		this.hotspotsSource = this.#hmsSource("fireHotspots");

		this.#stopEffects = $effect.root(() => {
			this.#resolveMonitors();
			this.#resolveHms();
		});
	}

	/** Why the places can't be scoped to monitors, if they can't. */
	get monitorsUnavailable(): UnavailableReason | null {
		return this.#monitorsUnavailable;
	}

	/** Polls the live data only while the map is worth drawing. */
	setPolling(on: boolean): void {
		this.monitorsQuery.setPolling(on);
		this.hmsQuery.setPolling(on);
	}

	retryMonitors(): void {
		this.monitorsQuery.retry();
	}

	retryHms(): void {
		this.hmsQuery.retry();
	}

	destroy(): void {
		this.#stopEffects();
		this.monitorsQuery.destroy();
		this.hmsQuery.destroy();
	}

	#hmsSource<P extends FireFeatureProperties>(
		key: "smoke" | "fireGroups" | "fireHotspots"
	): DataSource<P> {
		const self = this;
		return {
			get status() {
				return dataStatus(self.hmsState);
			},
			get features() {
				return self.hmsState.data === undefined
					? null
					: (self.hmsDrawn[key].features as DataSource<P>["features"]);
			},
			get scale() {
				return self.hmsDrawn[key].scale;
			}
		};
	}

	#resolveMonitors(): void {
		$effect(() => {
			const wanted = this.#wantedKey;
			const type = this.#entryType;
			const loads = this.#loads;
			const widget = untrack(() => this.#getInput().widget);
			if (!loads || !type) {
				this.#monitorsUnavailable = null;
				this.monitorsQuery.set(null);
				return;
			}
			const data = untrack(() => $state.snapshot(widget.data));
			let cancelled = false;
			const abort = new AbortController();
			const resolve = (signal?: AbortSignal) =>
				monitorsEntry.source({ data, entryType: type }, signal);
			resolve(abort.signal).then(
				(source) => {
					if (cancelled) return;
					this.#monitorsUnavailable = source && "unavailable" in source ? source.unavailable : null;
					this.#monitorsFor = type;
					this.#resolvedFor = wanted;
					this.monitorsQuery.set(source && "fetch" in source ? source : null);
				},
				(error: unknown) => {
					if (cancelled) return;
					this.#monitorsUnavailable = null;
					this.#monitorsFor = type;
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

	#resolveHms(): void {
		$effect(() => {
			if (!this.#loads || !this.smokeAndFire) {
				this.hmsQuery.set(null);
				return;
			}
			const input = untrack(() => ({
				data: $state.snapshot(this.#getInput().widget.data),
				entryType: this.#entryType ?? ""
			}));
			let cancelled = false;
			void hmsEntry.source(input).then((source) => {
				if (!cancelled) this.hmsQuery.set(source && "fetch" in source ? source : null);
			});
			return () => {
				cancelled = true;
			};
		});
	}
}
