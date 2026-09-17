import {
	getMonitorsList,
	getMonitorSummariesBulkMonthly,
	getMonitorsMeta,
	getRegionsList,
	getRegionsMeta,
	type MonitorData,
	type MonitorLatestType,
	type MonitorsMeta,
	type RegionData,
	type RegionsMeta,
	type RegionType,
	type SJVAirEntryLevel
} from "@sjvair/sdk";
import type { MonitorsDataSource } from "@sjvair/monitor-map";
import { XMap } from "@tstk/builtin-extensions";
import { buildCalendarDays, type CalendarDay } from "$lib/calendar";
import { monitorInRegions } from "$lib/monitors/region-scoping";
import { shouldNarrow, unionOfOtherTypeSelections } from "$lib/monitors/region-narrowing";
import { buildCountyFillColors } from "$lib/monitors/county-fill";
import { buildMonitorsLatest, type SupportedPollutant } from "$lib/monitors/monitor-latest";

export interface DateRange {
	start: string;
	end: string;
}

const DEFAULT_REGION_TYPE: RegionType = "county";

class MonitorsTabManager implements MonitorsDataSource {
	initialized: boolean = $state(false);

	monitors: Array<MonitorData> | null = $state(null);
	meta: MonitorsMeta | null = $state(null);
	regionTypes: RegionsMeta | null = $state(null);

	pollutant: SupportedPollutant | null = $state(null);
	dateRange: DateRange = $state({ start: "", end: "" });

	selectedRegionType: RegionType = $state(DEFAULT_REGION_TYPE);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- keys are stable per-type sentinels, not reactive per-entry state
	regionSelections: Map<RegionType, Set<string>> = $state(new Map());
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- same as above
	narrowingEnabled: Map<RegionType, boolean> = $state(new Map());
	activeRegions: Array<RegionData> | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	calendarDays: Array<CalendarDay> | null = $state(null);
	regionCalendars: Array<{ region: RegionData; days: Array<CalendarDay> }> | null = $state(null);
	regionFillColors: Map<string, string> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	selectedRegionIds: Set<string> = $derived(
		this.regionSelections.get(this.selectedRegionType) ?? new Set()
	);

	visibleMonitors: Array<MonitorData> = $derived.by(() => {
		if (!this.monitors || !this.activeRegions || this.selectedRegionIds.size === 0) return [];

		const selectedRegions = this.activeRegions.filter((region) =>
			this.selectedRegionIds.has(region.id)
		);
		if (selectedRegions.length === 0) return [];

		return this.monitors.filter((monitor) => monitorInRegions(monitor, selectedRegions));
	});

	// init()/refresh*() bodies land in Task 15 — this task only establishes the
	// field shapes so `npm run check` passes with the rest of the class stubbed:

	async init(): Promise<void> {
		if (this.initialized) return;

		const county: RegionType = DEFAULT_REGION_TYPE;
		[this.monitors, this.meta, this.regionTypes, this.activeRegions] = await Promise.all([
			getMonitorsList(),
			getMonitorsMeta(),
			getRegionsMeta(),
			getRegionsList({ type: county })
		]);

		// Default: all counties selected, matching today's "All Counties" default.
		this.regionSelections.set(county, new Set(this.activeRegions.map((r) => r.id)));

		this.initialized = true;
	}

	async refreshMapAverages(): Promise<void> {
		/* rewritten in Task 15 */
	}

	async refreshCalendar(): Promise<void> {
		/* rewritten in Task 15 */
	}

	async refreshRegionFill(): Promise<void> {
		/* rewritten in Task 15 */
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
