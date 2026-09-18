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

	// Memoizes already-fetched summary data so toggling a region on/off only
	// fetches what's actually new — deselecting never needs a network call at
	// all, since it can only shrink the set of ids we already have data for.
	// Region ids are unique across every region type (single Region table,
	// sqid per row), so these are safe to reuse across a region-type switch
	// too. Keyed by pollutant + date range (+ region id) rather than proactively
	// invalidated on pollutant/date-range change — a stale key is simply never
	// looked up again, and a session only ever touches a handful of distinct
	// (pollutant, month) combinations, so unbounded growth isn't a real concern.
	// Plain (non-$state) fields: purely internal memoization, never read by the
	// template.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain cache, not read by the template
	#regionDailyCache = new Map<string, Array<{ timestamp: string; mean: number }>>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain cache, not read by the template
	#regionMonthlyCache = new Map<string, number | undefined>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain cache, not read by the template
	#monitorAveragesCache = new Map<string, Map<string, number>>();

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
		const start = this.dateRange.start;
		const end = this.dateRange.end;

		// This fetch isn't scoped by region at all (it always covers every
		// published monitor), so a region toggle never needs to re-issue it —
		// only the pollutant/date range can invalidate it.
		const cacheKey = `${pollutant}|${start}|${end}`;

		try {
			let averages = this.#monitorAveragesCache.get(cacheKey);

			if (!averages) {
				const results = await getMonitorSummariesBulkMonthly({ entryType: pollutant, start, end });

				if (token !== this.#mapAveragesFetchToken) return;

				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain cache value, not read by the template
				averages = new Map<string, number>();
				for (const monitor of results) {
					const inRange = monitor.summaries.filter((row) => {
						const date = row.timestamp.slice(0, 10);
						return date >= start && date <= end;
					});
					if (inRange.length === 0) continue;

					const mean = inRange.reduce((sum, row) => sum + row.mean, 0) / inRange.length;
					averages.set(monitor.id, mean);
				}
				this.#monitorAveragesCache.set(cacheKey, averages);
			}

			if (token !== this.#mapAveragesFetchToken) return;

			this.latest = buildMonitorsLatest(monitors, averages, pollutant, end);
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
		const start = this.dateRange.start;
		const end = this.dateRange.end;
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

		// Deselecting a region only shrinks `selectedRegions` — it never needs
		// data we don't already have. Only fetch for regions this exact
		// (pollutant, date range) combination hasn't already cached.
		const cacheKeyPrefix = `${pollutant}|${start}|${end}|`;
		const missingRegions = selectedRegions.filter(
			(region) => !this.#regionDailyCache.has(cacheKeyPrefix + region.id)
		);

		try {
			if (missingRegions.length > 0) {
				const results = await getRegionSummariesBulkDaily({
					entryType: pollutant,
					start,
					end,
					region: missingRegions.map((r) => r.id)
				});

				if (token !== this.#calendarFetchToken) return;

				for (const region of results) {
					this.#regionDailyCache.set(cacheKeyPrefix + region.id, region.summaries);
				}
				// The bulk endpoint omits a region entirely when it has zero matching
				// rows, rather than including it with an empty array — seed a cache
				// entry for those too, or we'd refetch a data-less region every time.
				for (const region of missingRegions) {
					const cacheKey = cacheKeyPrefix + region.id;
					if (!this.#regionDailyCache.has(cacheKey)) {
						this.#regionDailyCache.set(cacheKey, []);
					}
				}
			}

			if (token !== this.#calendarFetchToken) return;

			this.calendarDays = null;
			this.regionCalendars = selectedRegions.map((region) => {
				const rows = this.#regionDailyCache.get(cacheKeyPrefix + region.id) ?? [];
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
				const valuesByDate = new Map<string, number>();
				for (const row of rows) {
					const date = row.timestamp.slice(0, 10);
					if (date < start || date > end) continue;
					valuesByDate.set(date, row.mean);
				}
				return { region, days: buildCalendarDays(start, end, valuesByDate, this.levels) };
			});
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
		const start = this.dateRange.start;
		const monthKey = start.slice(0, 7);
		const regions = this.activeRegions.filter((region) => selectedIds.has(region.id));

		if (regions.length === 0) {
			if (token === this.#regionFillFetchToken) this.regionFillColors = null;
			return;
		}

		const cacheKeyPrefix = `${pollutant}|${monthKey}|`;
		const missingRegions = regions.filter(
			(region) => !this.#regionMonthlyCache.has(cacheKeyPrefix + region.id)
		);

		try {
			if (missingRegions.length > 0) {
				const results = await getRegionSummariesBulkMonthly({
					entryType: pollutant,
					start,
					end: start,
					region: missingRegions.map((r) => r.id)
				});

				if (token !== this.#regionFillFetchToken) return;

				for (const region of results) {
					const row = region.summaries.find((r) => r.timestamp.slice(0, 7) === monthKey);
					this.#regionMonthlyCache.set(cacheKeyPrefix + region.id, row?.mean);
				}
				// Same reasoning as refreshCalendar: a region with no matching row is
				// omitted by the endpoint entirely, so seed `undefined` explicitly or
				// we'd refetch it on every subsequent toggle.
				for (const region of missingRegions) {
					const cacheKey = cacheKeyPrefix + region.id;
					if (!this.#regionMonthlyCache.has(cacheKey)) {
						this.#regionMonthlyCache.set(cacheKey, undefined);
					}
				}
			}

			if (token !== this.#regionFillFetchToken) return;

			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
			const means = new Map<string, number>();
			for (const region of regions) {
				const mean = this.#regionMonthlyCache.get(cacheKeyPrefix + region.id);
				if (mean !== undefined) means.set(region.id, mean);
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
