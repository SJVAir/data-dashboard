import {
	getMonitorsList,
	getMonitorSummariesMonthly,
	getMonitorsMeta,
	getRegionsList,
	getRegionSummariesDaily,
	getRegionSummariesMonthly,
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
import { buildCountyFillColors } from "$lib/monitors/county-fill";
import { buildMonitorsLatest, type SupportedPollutant } from "$lib/monitors/monitor-latest";

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
	countyFillColors: Map<string, string> | null = $state(null);

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

		const monitors = this.visibleMonitors;
		const pollutant = this.pollutant;
		const year = Number(this.dateRange.start.slice(0, 4));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
		const averages = new Map<string, number>();

		await Promise.all(
			monitors.map(async (monitor) => {
				const rows = await getMonitorSummariesMonthly({
					monitorId: monitor.id,
					entryType: pollutant,
					year
				});

				const inRange = rows.filter((row) => {
					const date = row.timestamp.slice(0, 10);
					return date >= this.dateRange.start && date <= this.dateRange.end;
				});
				if (inRange.length === 0) return;

				const mean = inRange.reduce((sum, row) => sum + row.mean, 0) / inRange.length;
				averages.set(monitor.id, mean);
			})
		);

		this.latest = buildMonitorsLatest(monitors, averages, pollutant, this.dateRange.end);
	}

	async refreshCalendar(): Promise<void> {
		if (!this.selectedCountyId || !this.pollutant || !this.dateRange.start || !this.dateRange.end) {
			this.calendarDays = null;
			return;
		}

		const regionId = this.selectedCountyId;
		const pollutant = this.pollutant;
		const year = Number(this.dateRange.start.slice(0, 4));

		const rows = await getRegionSummariesDaily({ regionId, entryType: pollutant, year });

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

	async refreshCountyFill(): Promise<void> {
		if (!this.pollutant || !this.dateRange.start || !this.counties) {
			this.countyFillColors = null;
			return;
		}

		const pollutant = this.pollutant;
		const monthKey = this.dateRange.start.slice(0, 7);
		const year = Number(this.dateRange.start.slice(0, 4));
		const regions = this.selectedCountyId
			? this.counties.filter((county) => county.id === this.selectedCountyId)
			: this.counties;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
		const means = new Map<string, number>();

		await Promise.all(
			regions.map(async (region) => {
				const rows = await getRegionSummariesMonthly({
					regionId: region.id,
					entryType: pollutant,
					year
				});
				const row = rows.find((r) => r.timestamp.slice(0, 7) === monthKey);
				if (row) means.set(region.id, row.mean);
			})
		);

		this.countyFillColors = buildCountyFillColors(means, this.levels);
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
