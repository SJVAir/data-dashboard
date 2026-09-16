import {
	getMonitorsList,
	getMonitorSummariesDaily,
	getMonitorSummariesMonthly,
	getMonitorsMeta,
	getRegionsList,
	getRegionSummariesDaily,
	type MonitorData,
	type MonitorLatestType,
	type MonitorsMeta,
	type RegionData,
	type SJVAirEntryLevel
} from "@sjvair/sdk";
import type { MonitorsDataSource } from "@sjvair/monitor-map";
import { XMap } from "@tstk/builtin-extensions";
import { buildCalendarDays, type CalendarDay } from "$lib/calendar";
import { countyMatches } from "$lib/county-match";
import { buildMonitorsLatest, type SupportedPollutant } from "$lib/monitors/monitor-latest";
import { pickSummaryResolution } from "$lib/monitors/summary-resolution";

export interface DateRange {
	start: string;
	end: string;
}

class MonitorsTabManager implements MonitorsDataSource {
	initialized: boolean = $state(false);

	monitors: Array<MonitorData> | null = $state(null);
	meta: MonitorsMeta | null = $state(null);
	counties: Array<RegionData> | null = $state(null);

	pollutant: SupportedPollutant | null = $state(null);
	dateRange: DateRange = $state({ start: "", end: "" });
	selectedCountyId: string | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	calendarDays: Array<CalendarDay> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	visibleMonitors: Array<MonitorData> = $derived.by(() => {
		if (!this.monitors) return [];
		if (!this.selectedCountyId || !this.counties) return this.monitors;

		const region = this.counties.find((county) => county.id === this.selectedCountyId);
		if (!region) return this.monitors;

		return this.monitors.filter((monitor) => countyMatches(monitor.county, region.name));
	});

	async init(): Promise<void> {
		if (this.initialized) return;

		[this.monitors, this.meta, this.counties] = await Promise.all([
			getMonitorsList(),
			getMonitorsMeta(),
			getRegionsList({ type: "county" })
		]);

		this.initialized = true;
	}

	async refreshMapAverages(): Promise<void> {
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) return;

		const pollutant = this.pollutant;
		const resolution = pickSummaryResolution(this.dateRange.start, this.dateRange.end);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const startYear = new Date(this.dateRange.start).getFullYear();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const endYear = new Date(this.dateRange.end).getFullYear();
		const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
		const averages = new Map<string, number>();

		await Promise.all(
			this.visibleMonitors.map(async (monitor) => {
				const rowsByYear = await Promise.all(
					years.map((year) =>
						resolution === "daily"
							? getMonitorSummariesDaily({ monitorId: monitor.id, entryType: pollutant, year })
							: getMonitorSummariesMonthly({ monitorId: monitor.id, entryType: pollutant, year })
					)
				);
				const rows = rowsByYear.flat();

				const inRange = rows.filter((row) => {
					const date = row.timestamp.slice(0, 10);
					return date >= this.dateRange.start && date <= this.dateRange.end;
				});
				if (inRange.length === 0) return;

				const mean = inRange.reduce((sum, row) => sum + row.mean, 0) / inRange.length;
				averages.set(monitor.id, mean);
			})
		);

		this.latest = buildMonitorsLatest(
			this.visibleMonitors,
			averages,
			pollutant,
			this.dateRange.end
		);
	}

	async refreshCalendar(): Promise<void> {
		if (!this.selectedCountyId || !this.pollutant || !this.dateRange.start || !this.dateRange.end) {
			this.calendarDays = null;
			return;
		}

		const regionId = this.selectedCountyId;
		const pollutant = this.pollutant;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const startYear = new Date(this.dateRange.start).getFullYear();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const endYear = new Date(this.dateRange.end).getFullYear();
		const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

		const rows = (
			await Promise.all(
				years.map((year) => getRegionSummariesDaily({ regionId, entryType: pollutant, year }))
			)
		).flat();

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
		const valuesByDate = new Map<string, number>();
		for (const row of rows) {
			const date = row.timestamp.slice(0, 10);
			if (date < this.dateRange.start || date > this.dateRange.end) continue;
			valuesByDate.set(date, row.mean);
		}

		this.calendarDays = buildCalendarDays(
			this.dateRange.start,
			this.dateRange.end,
			valuesByDate,
			this.levels
		);
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
