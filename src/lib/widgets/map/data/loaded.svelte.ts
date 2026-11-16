import { untrack } from "svelte";
import type {
	DataSource,
	FireFeatureProperties,
	MonitorFeatureProperties
} from "@sjvair/map-sdk/data";
import type { RegionSummaryBulkType } from "@sjvair/sdk";
import type { NowClient } from "$lib/data/now/client";
import type { Layer } from "$lib/data/schema";
import type { SnapshotAt } from "$lib/data/snapshot";
import type { WidgetInstance } from "$lib/documents/schema";
import { hasSmokeAndFire } from "$lib/get-data/map";
import { mapMessages } from "../host/messages";
import type { MonitorFilters } from "../toolbar/values";
import { AHEAD, DayLayer } from "./day-layer.svelte";
import { fillEntry, fillPolls, fillSourceOf, type FillData, type FillSource } from "./fill";
import { hmsEntry, hmsPolls, hmsSourceOf, type HmsData } from "./hms";
import { MonitorsBlock } from "./monitors-block.svelte";
import type { DayRating } from "./monitors";

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
	/** Today's Pacific date key: Now's smoke and fill are remade when it turns over. */
	today: string;
	/** The region type filled (one the metadata lists); null for no fill. */
	fill: RegionSummaryBulkType | null;
};

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
	readonly #monitors: MonitorsBlock;
	readonly #hms: DayLayer<HmsData>;
	readonly #fill: DayLayer<FillData>;

	#getInput: () => MapDataInput;
	#stopEffects: () => void;

	/** The pollutant the fill query loads (its scale). */
	#fillFor = $state<string | undefined>();

	/** Narrow deriveds, so an effect re-runs only when the one value it needs changes. */
	readonly #entryType = $derived.by(() => this.#getInput().entryType);
	readonly #loads = $derived.by(() => this.#getInput().loads);
	/** `"now"`, or the day showing's date key. */
	readonly #day = $derived.by(() => {
		const at = this.#getInput().at;
		return at === "now" ? "now" : at.day;
	});
	readonly #aheadKey = $derived.by(() => this.#getInput().ahead.join(","));
	readonly #today = $derived.by(() => this.#getInput().today);
	readonly #regionType = $derived.by(() => this.#getInput().fill);

	/** Whether smoke and fire are on. */
	readonly smokeAndFire = $derived.by(() => hasSmokeAndFire(this.#getInput().widget.data));
	/** Smoke and fire as map-sdk data; before they load, with no features but the scales. */
	readonly hmsDrawn = $derived(
		hmsEntry.toDataSources(this.hmsState.data ?? { smoke: [], fires: [] }, {
			messages: mapMessages,
			entryType: this.#entryType ?? ""
		})
	);
	readonly hmsFailed = $derived(this.hmsState.status === "error");
	/** The fill failed to load. */
	readonly fillFailed = $derived(this.fillState.status === "error");

	readonly monitorsSource: DataSource<MonitorFeatureProperties>;
	readonly smokeSource: DataSource<FireFeatureProperties>;
	readonly fireSource: DataSource<FireFeatureProperties>;
	readonly hotspotsSource: DataSource<FireFeatureProperties>;
	/** The fill's source for the regions plugin; no features until it loads. */
	readonly fillSource: DataSource;

	constructor(getInput: () => MapDataInput, deps: { now: NowClient; rating: DayRating }) {
		this.#getInput = getInput;
		this.#monitors = new MonitorsBlock(getInput, deps);
		this.#hms = new DayLayer<HmsData>(deps.now, {
			sourceFor: async (at) => {
				const input = untrack(() => ({
					data: $state.snapshot(this.#getInput().widget.data),
					entryType: this.#entryType ?? ""
				}));
				const source = await hmsEntry.source({ ...input, at });
				return source && "fetch" in source ? source : null;
			},
			// Now: hourly. A day: hourly while its monitors' figures aren't all final.
			polls: (at) => hmsPolls(at, this.#monitors.dayPolls)
		});
		this.#fill = new DayLayer<FillData>(deps.now, {
			sourceFor: (at) => {
				const entryType = this.#entryType;
				const regionType = this.#regionType;
				return entryType && regionType ? fillEntry.source({ regionType, entryType, at }) : null;
			},
			// Every source the fill holds is one `fillEntry` made.
			polls: (_at, value, source) => fillPolls(source as FillSource | null, value)
		});

		this.monitorsSource = this.#monitors.monitorsSource;
		this.smokeSource = hmsSourceOf(this, "smoke");
		this.fireSource = hmsSourceOf(this, "fireGroups");
		this.hotspotsSource = hmsSourceOf(this, "fireHotspots");
		this.fillSource = fillSourceOf(this);

		this.#stopEffects = $effect.root(() => {
			$effect(() => {
				// Now's source is keyed by today's date: remade at Pacific midnight.
				this.#hms.update({
					on: this.#loads && this.smokeAndFire,
					at: this.#at(),
					ahead: this.#ahead(),
					today: this.#today
				});
			});
			$effect(() => {
				const type = this.#entryType;
				const on = this.#loads && !!type && !!this.#regionType;
				this.#fillFor = on ? type : undefined;
				this.#fill.update({ on, at: this.#at(), ahead: this.#ahead(), today: this.#today });
			});
		});
	}

	/** The monitors' members, as the block holds them. */
	get monitorsQuery(): MonitorsBlock["monitorsQuery"] {
		return this.#monitors.monitorsQuery;
	}
	get dayQuery(): MonitorsBlock["dayQuery"] {
		return this.#monitors.dayQuery;
	}
	/** A day shows (not now). */
	get onDay(): boolean {
		return this.#monitors.onDay;
	}
	get monitorsCurrent(): boolean {
		return this.#monitors.monitorsCurrent;
	}
	get listState(): MonitorsBlock["listState"] {
		return this.#monitors.listState;
	}
	get dayState(): MonitorsBlock["dayState"] {
		return this.#monitors.dayState;
	}
	get monitorsState(): MonitorsBlock["monitorsState"] {
		return this.#monitors.monitorsState;
	}
	get monitorsData(): MonitorsBlock["monitorsData"] {
		return this.#monitors.monitorsData;
	}
	get monitorsDrawn(): MonitorsBlock["monitorsDrawn"] {
		return this.#monitors.monitorsDrawn;
	}
	get monitorsLoaded(): MonitorsBlock["monitorsLoaded"] {
		return this.#monitors.monitorsLoaded;
	}
	get placesLoaded(): MonitorsBlock["placesLoaded"] {
		return this.#monitors.placesLoaded;
	}
	get inPlaces(): MonitorsBlock["inPlaces"] {
		return this.#monitors.inPlaces;
	}
	get dayDrawn(): MonitorsBlock["dayDrawn"] {
		return this.#monitors.dayDrawn;
	}
	get dayUnrated(): boolean {
		return this.#monitors.dayUnrated;
	}
	get dayNotFinal(): boolean {
		return this.#monitors.dayNotFinal;
	}
	get dayNoFigures(): boolean {
		return this.#monitors.dayNoFigures;
	}
	get exempt(): MonitorsBlock["exempt"] {
		return this.#monitors.exempt;
	}
	get monitorsShown(): MonitorsBlock["monitorsShown"] {
		return this.#monitors.monitorsShown;
	}
	get monitorsLoading(): boolean {
		return this.#monitors.monitorsLoading;
	}
	get monitorsRefreshFailed(): boolean {
		return this.#monitors.monitorsRefreshFailed;
	}
	get unlisted(): boolean {
		return this.#monitors.unlisted;
	}
	/** Why the places can't be scoped to monitors, if they can't. */
	get monitorsUnavailable(): MonitorsBlock["monitorsUnavailable"] {
		return this.#monitors.monitorsUnavailable;
	}

	get hmsQuery(): DayLayer<HmsData>["query"] {
		return this.#hms.query;
	}
	get hmsState(): DayLayer<HmsData>["state"] {
		return this.#hms.state;
	}
	get fillQuery(): DayLayer<FillData>["query"] {
		return this.#fill.query;
	}
	get fillState(): DayLayer<FillData>["state"] {
		return this.#fill.state;
	}
	/** The pollutant the fill loads (its scale); undefined with no fill. */
	get fillFor(): string | undefined {
		return this.#fillFor;
	}

	/** Polls the live data (and a day's figures not final yet) only while the map is worth drawing. */
	setPolling(on: boolean): void {
		this.#monitors.setPolling(on);
		this.#hms.setPolling(on);
		this.#fill.setPolling(on);
	}

	/** Fetches again what failed: the list, the day's figures, or both. */
	retryMonitors(): void {
		this.#monitors.retry();
	}

	retryHms(): void {
		this.#hms.retry();
	}

	retryFill(): void {
		this.#fill.retry();
	}

	destroy(): void {
		this.#stopEffects();
		this.#monitors.destroy();
		this.#hms.destroy();
		this.#fill.destroy();
	}

	/** Now, or the day showing (built from the day's key). */
	#at(): SnapshotAt {
		const day = this.#day;
		return day === "now" ? "now" : { day };
	}

	/** The days to fetch ahead, as the input names them. */
	#ahead(): string[] {
		const key = this.#aheadKey;
		return key ? key.split(",").slice(0, AHEAD) : [];
	}
}
