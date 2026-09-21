import {
	getMonitorsList,
	getMonitorSummariesBulkMonthly,
	getMonitorsMeta,
	getRegionDetails,
	getRegionsList,
	getRegionsMeta,
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkMonthly,
	type MonitorData,
	type MonitorLatestType,
	type MonitorsMeta,
	type RegionBoundary,
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
import { pruneSelection } from "$lib/monitors/region-narrowing";
import { buildRegionFillColors } from "$lib/monitors/region-fill";
import { buildMonitorsLatest, type SupportedPollutant } from "$lib/monitors/monitor-latest";

export interface DateRange {
	start: string;
	end: string;
}

const DEFAULT_REGION_TYPE: RegionType = "county";

// Mirrors the same in-scope category filter the parent-type dropdown uses
// (see CATEGORIES in MonitorsTab.svelte) — getRegionsMeta() reports all 15
// backend Region.Type values, but this feature is only scoped to these 3
// categories (9 types). The rest (urban_area, land_use, protected, place,
// mtrs, custom) are out of scope, and two of them are unsafe to include on
// the dev backend: land_use never responds at all (confirmed hanging past
// 60s), and mtrs, while it does respond, takes ~12s — either one sitting in
// refreshChildren()'s Promise.all alongside the fast in-scope fetches would
// stall the whole child refresh behind it.
const IN_SCOPE_CATEGORIES = ["administrative", "census", "district"];

class MonitorsTabManager implements MonitorsDataSource {
	initialized: boolean = $state(false);

	monitors: Array<MonitorData> | null = $state(null);
	meta: MonitorsMeta | null = $state(null);
	regionTypes: RegionsMeta | null = $state(null);

	pollutant: SupportedPollutant | null = $state(null);
	dateRange: DateRange = $state({ start: "", end: "" });

	parentType: RegionType = $state(DEFAULT_REGION_TYPE);
	parentRegions: Array<RegionData> | null = $state(null);
	// Always reassigned wholesale (this.parentSelection = new Set(...)) —
	// $state field reassignment triggers reactivity regardless of the
	// assigned value's type, so this doesn't need SvelteSet.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- always reassigned wholesale, see above
	parentSelection: Set<string> = $state(new Set());

	// Both maps below are updated via .set() on the same long-lived map
	// instance (one entry per child type) rather than reassigned wholesale —
	// that requires SvelteMap, since a plain Map's .set() doesn't propagate
	// reactively under Svelte 5 $state(). The *values* inside
	// childSelectionsByType (individual Sets) are still always freshly built
	// and handed to childSelectionsByType.set(type, next) — never mutated
	// in place — so they stay plain Set.
	childRegionsByType: SvelteMap<RegionType, Array<RegionData>> = $state(new SvelteMap());
	childSelectionsByType: SvelteMap<RegionType, Set<string>> = $state(new SvelteMap());

	// RegionList (what populates parentRegions/childRegionsByType) omits
	// `boundary.geometry` -- serializing every candidate's full polygon is
	// what made narrowing to a large `within=` selection take ~1.7s; `bbox`
	// alone covers the picker/fitBounds use cases those lists exist for.
	// Full geometry (needed for the map fill layer and point-in-region
	// monitor filtering) is fetched lazily per region only once it's
	// actually selected, and kept here for the rest of the session -- these
	// are static boundaries a user selects a handful of at a time, not worth
	// evicting.
	selectedRegionBoundaries: SvelteMap<string, RegionBoundary> = $state(new SvelteMap());

	lastError: string | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	regionCalendars: Array<{ region: RegionData; days: Array<CalendarDay> }> | null = $state(null);
	regionFillColors: Map<string, string> | null = $state(null);
	// The raw monthly-average mean behind each entry in regionFillColors —
	// kept alongside it (rather than derived from it) so the region tooltip
	// can show the actual value, not just the level color derived from it.
	regionFillMeans: Map<string, number> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	// Every in-scope region type except the current parent — always 8
	// entries once `regionTypes` has loaded (9 in-scope types total).
	childTypes: Array<RegionType> = $derived.by(() => {
		if (!this.regionTypes) return [];
		return this.regionTypes.asIter.types
			.filter((t) => IN_SCOPE_CATEGORIES.includes(t.category) && t.type !== this.parentType)
			.map((t) => t.type);
	});

	// Every currently-selected region across the parent AND all 8 child
	// types, flattened into one list — this is what every map/calendar/fill/
	// marker computation reads from, replacing the old single-active-type
	// selectedRegionIds/activeRegions pair.
	//
	// parentRegions/childRegionsByType come from RegionList, which omits
	// `boundary.geometry` (see selectedRegionBoundaries above) — withBoundary()
	// overlays the lazily-fetched full boundary once it's available, and
	// falls back to the list-provided (bbox-only) boundary until then, so
	// fitBounds still has something to work with immediately.
	selectedRegions: Array<RegionData> = $derived.by(() => {
		const withBoundary = (region: RegionData): RegionData => {
			const boundary = this.selectedRegionBoundaries.get(region.id);
			return boundary ? { ...region, boundary } : region;
		};

		const result: Array<RegionData> = [];

		if (this.parentRegions) {
			for (const region of this.parentRegions) {
				if (this.parentSelection.has(region.id)) result.push(withBoundary(region));
			}
		}

		for (const type of this.childTypes) {
			const regions = this.childRegionsByType.get(type);
			const selection = this.childSelectionsByType.get(type);
			if (!regions || !selection || selection.size === 0) continue;

			for (const region of regions) {
				if (selection.has(region.id)) result.push(withBoundary(region));
			}
		}

		return result;
	});

	// Fetches and caches a region's full boundary (including geometry) the
	// first time it's selected — see selectedRegionBoundaries above for why
	// this is needed. Safe to call repeatedly for the same id; only the
	// first call for a given id does any work.
	async #ensureBoundary(regionId: string): Promise<void> {
		if (this.selectedRegionBoundaries.has(regionId)) return;

		try {
			const region = await getRegionDetails(regionId);
			if (region.boundary) this.selectedRegionBoundaries.set(regionId, region.boundary);
		} catch {
			// Non-fatal: the region stays selected with its bbox-only boundary
			// from the list response, so fitBounds/selection state are still
			// correct -- only the map fill polygon and point-in-region monitor
			// filtering are affected, and only for this one region.
		}
	}

	// Snapshotted once per recompute, not read reactively inside the hot loop:
	// monitorInRegions() runs @turf/boolean-point-in-polygon, which does exhaustive
	// nested-array traversal over every polygon vertex (up to ~9,600 per region) for
	// every monitor. Touching that many array/property accesses through Svelte 5's
	// $state reactive proxy (each one pays proxy-trap dependency-tracking overhead)
	// measured ~44x slower than running the identical algorithm on a plain,
	// unwrapped snapshot — a ~10s main-thread stall vs. ~200ms.
	visibleMonitors: Array<MonitorData> = $derived.by(() => {
		if (!this.monitors || this.selectedRegions.length === 0) return [];

		const plainMonitors = $state.snapshot(this.monitors);
		const plainRegions = $state.snapshot(this.selectedRegions);
		return plainMonitors.filter((monitor) => monitorInRegions(monitor, plainRegions));
	});

	#parentRegionsFetchToken = 0;
	#childRegionsFetchToken = 0;
	#mapAveragesFetchToken = 0;
	#calendarFetchToken = 0;
	#regionFillFetchToken = 0;

	// Memoizes already-fetched summary data so toggling a region on/off only
	// fetches what's actually new — deselecting never needs a network call at
	// all, since it can only shrink the set of ids we already have data for.
	// Region ids are unique across every region type (single Region table,
	// sqid per row), so these are safe to reuse across a parent-type switch
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
		[this.monitors, this.meta, this.regionTypes, this.parentRegions] = await Promise.all([
			getMonitorsList(),
			getMonitorsMeta(),
			getRegionsMeta(),
			getRegionsList({ type: county })
		]);

		// Default: all counties selected, matching today's "All Counties" default.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned wholesale, see field comment
		this.parentSelection = new Set(this.parentRegions.map((r) => r.id));
		for (const region of this.parentRegions) void this.#ensureBoundary(region.id);

		// Deliberately does NOT await refreshChildren() here: MonitorsTab.svelte's
		// onMount already calls it explicitly, right after setting dateRange/
		// pollutant/URL overrides. Awaiting it in init() too would make init()'s
		// promise (and everything onMount does after awaiting it, including
		// setting dateRange) block on all 8 child-type region fetches completing
		// first -- with nothing else changed, that adds ~1-2s where the year/
		// month selects render "0"/blank before dateRange is ever set.
		this.initialized = true;
	}

	async refreshParentRegions(): Promise<void> {
		const token = ++this.#parentRegionsFetchToken;

		try {
			const regions = await getRegionsList({ type: this.parentType });

			if (token !== this.#parentRegionsFetchToken) return;

			this.parentRegions = regions;
			this.lastError = null;
		} catch {
			if (token !== this.#parentRegionsFetchToken) return;
			this.parentRegions = null;
			this.lastError = "Failed to load region data.";
		}
	}

	// Fetches every child type's region list narrowed by the current parent
	// selection, and prunes each child type's existing selection down to
	// whatever's still in its newly-narrowed list — a child selection can
	// only ever shrink as a result of a parent-selection change, never grow.
	async refreshChildren(): Promise<void> {
		const token = ++this.#childRegionsFetchToken;
		const types = this.childTypes;
		const withinIds = this.parentSelection.size > 0 ? Array.from(this.parentSelection) : undefined;

		try {
			const results = await Promise.all(
				types.map((type) => getRegionsList({ type, within: withinIds }))
			);

			if (token !== this.#childRegionsFetchToken) return;

			for (let i = 0; i < types.length; i++) {
				const type = types[i];
				const regions = results[i];
				this.childRegionsByType.set(type, regions);

				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
				const availableIds = new Set(regions.map((r) => r.id));
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
				const currentSelection = this.childSelectionsByType.get(type) ?? new Set<string>();
				this.childSelectionsByType.set(type, pruneSelection(currentSelection, availableIds));
			}
			this.lastError = null;
		} catch {
			if (token !== this.#childRegionsFetchToken) return;
			this.lastError = "Failed to load region data.";
		}
	}

	async setParentType(type: RegionType): Promise<void> {
		this.parentType = type;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned wholesale, see field comment
		this.parentSelection = new Set();
		this.childRegionsByType.clear();
		this.childSelectionsByType.clear();

		await this.refreshParentRegions();
		// refreshChildren() runs concurrently with the map/calendar/fill refresh,
		// not before it -- child selections were just cleared above, so there's
		// nothing for refreshChildren()'s pruning step to affect yet, and the map
		// doesn't need the (currently all-collapsed) child lists to be freshly
		// re-fetched before it can render the parent's own selection correctly.
		// Measured: refreshChildren()'s 8 parallel per-type fetches can take
		// several seconds; blocking the visibly-faster map update behind them
		// made switching parent type feel far slower than it needs to.
		await Promise.all([
			this.refreshChildren(),
			this.refreshMapAverages(),
			this.refreshCalendar(),
			this.refreshRegionFill()
		]);
	}

	toggleParentRegion(regionId: string): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- reassigned wholesale, see field comment
		const next = new Set(this.parentSelection);
		if (next.has(regionId)) {
			next.delete(regionId);
		} else {
			next.add(regionId);
			void this.#ensureBoundary(regionId);
		}
		this.parentSelection = next;
	}

	toggleChildRegion(type: RegionType, regionId: string): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
		const current = this.childSelectionsByType.get(type) ?? new Set<string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch set
		const next = new Set(current);
		if (next.has(regionId)) {
			next.delete(regionId);
		} else {
			next.add(regionId);
			void this.#ensureBoundary(regionId);
		}
		this.childSelectionsByType.set(type, next);
	}

	// Ensures every currently selected region (parent + every child type) has
	// its full boundary cached, regardless of how the selection got to its
	// current state (toggle, a bookmarked URL restoring parentSelection
	// directly, pruning, setParentType's reset+reseed, etc.) -- centralizing
	// this here, rather than depending on every selection-mutation call site
	// remembering to await it, is what makes refreshMapAverages() below safe
	// to call right after any of them.
	async #ensureSelectedBoundaries(): Promise<void> {
		const ids = new Set(this.parentSelection);
		for (const selection of this.childSelectionsByType.values()) {
			for (const id of selection) ids.add(id);
		}
		await Promise.all([...ids].map((id) => this.#ensureBoundary(id)));
	}

	async refreshMapAverages(): Promise<void> {
		const token = ++this.#mapAveragesFetchToken;
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) return;

		// visibleMonitors depends on selectedRegions having full boundary
		// geometry (see selectedRegionBoundaries) -- without this, a region
		// selected moments ago (still mid-fetch) would look empty here, this
		// function would cache `this.latest` as empty, and nothing would ever
		// re-trigger it once the boundary actually loads (this function is
		// call-and-forget, not reactive to visibleMonitors changing later).
		await this.#ensureSelectedBoundaries();
		if (token !== this.#mapAveragesFetchToken) return;

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
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) {
			this.regionCalendars = null;
			return;
		}

		const pollutant = this.pollutant;
		const start = this.dateRange.start;
		const end = this.dateRange.end;
		const selectedRegions = [...this.selectedRegions].sort((a, b) => a.name.localeCompare(b.name));

		if (selectedRegions.length === 0) {
			if (token === this.#calendarFetchToken) this.regionCalendars = null;
			return;
		}

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
			this.regionCalendars = null;
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}

	async refreshRegionFill(): Promise<void> {
		const token = ++this.#regionFillFetchToken;
		if (!this.pollutant || !this.dateRange.start) {
			this.regionFillColors = null;
			this.regionFillMeans = null;
			return;
		}

		const regions = this.selectedRegions;
		if (regions.length === 0) {
			this.regionFillColors = null;
			this.regionFillMeans = null;
			return;
		}

		const pollutant = this.pollutant;
		const start = this.dateRange.start;
		const monthKey = start.slice(0, 7);

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
			this.regionFillMeans = means;
			this.lastError = null;
		} catch {
			if (token !== this.#regionFillFetchToken) return;
			this.regionFillColors = null;
			this.regionFillMeans = null;
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
