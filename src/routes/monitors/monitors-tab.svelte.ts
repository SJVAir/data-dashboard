import {
	getMonitorsList,
	getMonitorSummariesBulkMonthly,
	getMonitorsMeta,
	getRegionsList,
	getRegionsMeta,
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkMonthly,
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
import { SvelteMap } from "svelte/reactivity";
import { buildCalendarDays, type CalendarDay } from "$lib/calendar";
import { monitorInRegions } from "$lib/monitors/region-scoping";
import { shouldNarrow, unionOfOtherTypeSelections } from "$lib/monitors/region-narrowing";
import { buildRegionFillColors } from "$lib/monitors/region-fill";
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
	// Persistent selection state read by `selectedRegionIds` below and mutated in place by
	// toggleRegion()/disableNarrowing() — must be a real reactive collection (not a plain
	// Map) for those mutations to propagate to derived/template reads.
	regionSelections: SvelteMap<RegionType, Set<string>> = $state(new SvelteMap());
	narrowingEnabled: SvelteMap<RegionType, boolean> = $state(new SvelteMap());
	activeRegions: Array<RegionData> | null = $state(null);
	lastError: string | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	calendarDays: Array<CalendarDay> | null = $state(null);
	regionCalendars: Array<{ region: RegionData; days: Array<CalendarDay> }> | null = $state(null);
	regionFillColors: Map<string, string> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	selectedRegionIds: Set<string> = $derived(
		this.regionSelections.get(this.selectedRegionType) ??
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
			new Set()
	);

	// Snapshotted once per recompute, not read reactively inside the hot loop:
	// monitorInRegions() runs @turf/boolean-point-in-polygon, which does exhaustive
	// nested-array traversal over every polygon vertex (up to ~9,600 per region) for
	// every monitor. Touching that many array/property accesses through Svelte 5's
	// $state reactive proxy (each one pays proxy-trap dependency-tracking overhead)
	// measured ~44x slower than running the identical algorithm on a plain,
	// unwrapped snapshot — a ~10s main-thread stall vs. ~200ms. $state.snapshot()
	// still tracks `this.monitors`/`this.activeRegions` as reactive dependencies
	// (read before snapshotting), so this recomputes correctly when either changes;
	// only the expensive inner loop operates on de-proxied data.
	visibleMonitors: Array<MonitorData> = $derived.by(() => {
		if (!this.monitors || !this.activeRegions || this.selectedRegionIds.size === 0) return [];

		const selectedRegions = this.activeRegions.filter((region) =>
			this.selectedRegionIds.has(region.id)
		);
		if (selectedRegions.length === 0) return [];

		const plainMonitors = $state.snapshot(this.monitors);
		const plainRegions = $state.snapshot(selectedRegions);
		return plainMonitors.filter((monitor) => monitorInRegions(monitor, plainRegions));
	});

	#activeRegionsFetchToken = 0;
	#mapAveragesFetchToken = 0;
	#calendarFetchToken = 0;
	#regionFillFetchToken = 0;

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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
		this.regionSelections.set(county, new Set(this.activeRegions.map((r) => r.id)));

		this.initialized = true;
	}

	async refreshActiveRegions(): Promise<void> {
		const token = ++this.#activeRegionsFetchToken;
		const type = this.selectedRegionType;

		try {
			const withinIds = shouldNarrow(this.regionSelections, type, this.narrowingEnabled)
				? Array.from(unionOfOtherTypeSelections(this.regionSelections, type))
				: undefined;

			const regions = await getRegionsList({ type, within: withinIds });

			// A newer call (from a subsequent region-type switch) has already
			// landed — this response is stale, discard it rather than racing.
			if (token !== this.#activeRegionsFetchToken) return;

			this.activeRegions = regions;
			if (!this.regionSelections.has(type)) {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
				this.regionSelections.set(type, new Set());
			}
			this.lastError = null;
		} catch {
			if (token !== this.#activeRegionsFetchToken) return;
			this.activeRegions = null;
			this.lastError = "Failed to load region data.";
		}
	}

	async refreshMapAverages(): Promise<void> {
		const token = ++this.#mapAveragesFetchToken;
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) return;

		const monitors = this.visibleMonitors;
		if (monitors.length === 0) {
			this.latest = new XMap();
			return;
		}

		const pollutant = this.pollutant;

		try {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
			const averages = new Map<string, number>();

			const results = await getMonitorSummariesBulkMonthly({
				entryType: pollutant,
				start: this.dateRange.start,
				end: this.dateRange.end
			});

			if (token !== this.#mapAveragesFetchToken) return;

			for (const monitor of results) {
				const inRange = monitor.summaries.filter((row) => {
					const date = row.timestamp.slice(0, 10);
					return date >= this.dateRange.start && date <= this.dateRange.end;
				});
				if (inRange.length === 0) continue;

				const mean = inRange.reduce((sum, row) => sum + row.mean, 0) / inRange.length;
				averages.set(monitor.id, mean);
			}

			this.latest = buildMonitorsLatest(monitors, averages, pollutant, this.dateRange.end);
			this.lastError = null;
		} catch {
			if (token !== this.#mapAveragesFetchToken) return;
			this.latest = new XMap();
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}

	async refreshCalendar(): Promise<void> {
		const token = ++this.#calendarFetchToken;
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end || !this.activeRegions) {
			this.calendarDays = null;
			this.regionCalendars = null;
			return;
		}

		const pollutant = this.pollutant;
		const selectedRegions = this.activeRegions
			.filter((region) => this.selectedRegionIds.has(region.id))
			.sort((a, b) => a.name.localeCompare(b.name));

		if (selectedRegions.length === 0) {
			if (token === this.#calendarFetchToken) {
				this.calendarDays = null;
				this.regionCalendars = null;
			}
			return;
		}

		try {
			const results = await getRegionSummariesBulkDaily({
				entryType: pollutant,
				start: this.dateRange.start,
				end: this.dateRange.end,
				region: selectedRegions.map((r) => r.id)
			});

			if (token !== this.#calendarFetchToken) return;

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
			const daysByRegion = new Map<string, Map<string, number>>();
			for (const region of results) {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
				const valuesByDate = new Map<string, number>();
				for (const row of region.summaries) {
					const date = row.timestamp.slice(0, 10);
					if (date < this.dateRange.start || date > this.dateRange.end) continue;
					valuesByDate.set(date, row.mean);
				}
				daysByRegion.set(region.id, valuesByDate);
			}

			this.calendarDays = null;
			this.regionCalendars = selectedRegions.map((region) => ({
				region,
				days: buildCalendarDays(
					this.dateRange.start,
					this.dateRange.end,
					// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
					daysByRegion.get(region.id) ?? new Map(),
					this.levels
				)
			}));
			this.lastError = null;
		} catch {
			if (token !== this.#calendarFetchToken) return;
			this.calendarDays = null;
			this.regionCalendars = null;
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}

	async refreshRegionFill(): Promise<void> {
		const token = ++this.#regionFillFetchToken;
		if (!this.pollutant || !this.dateRange.start || !this.activeRegions) {
			this.regionFillColors = null;
			return;
		}

		const selectedIds = this.selectedRegionIds;
		if (selectedIds.size === 0) {
			this.regionFillColors = null;
			return;
		}

		const pollutant = this.pollutant;
		const monthKey = this.dateRange.start.slice(0, 7);
		const regions = this.activeRegions.filter((region) => selectedIds.has(region.id));

		if (regions.length === 0) {
			if (token === this.#regionFillFetchToken) this.regionFillColors = null;
			return;
		}

		try {
			const results = await getRegionSummariesBulkMonthly({
				entryType: pollutant,
				start: this.dateRange.start,
				end: this.dateRange.start,
				region: regions.map((r) => r.id)
			});

			if (token !== this.#regionFillFetchToken) return;

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
			const means = new Map<string, number>();
			for (const region of results) {
				const row = region.summaries.find((r) => r.timestamp.slice(0, 7) === monthKey);
				if (row) means.set(region.id, row.mean);
			}

			this.regionFillColors = buildRegionFillColors(means, this.levels);
			this.lastError = null;
		} catch {
			if (token !== this.#regionFillFetchToken) return;
			this.regionFillColors = null;
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}

	async setRegionType(type: RegionType): Promise<void> {
		this.selectedRegionType = type;
		await this.refreshActiveRegions();
		await Promise.all([
			this.refreshMapAverages(),
			this.refreshCalendar(),
			this.refreshRegionFill()
		]);
	}

	toggleRegion(regionId: string): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
		const current = this.regionSelections.get(this.selectedRegionType) ?? new Set<string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
		const next = new Set(current);
		if (next.has(regionId)) {
			next.delete(regionId);
		} else {
			next.add(regionId);
		}
		this.regionSelections.set(this.selectedRegionType, next);
	}

	disableNarrowing(type: RegionType): void {
		this.narrowingEnabled.set(type, false);
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
