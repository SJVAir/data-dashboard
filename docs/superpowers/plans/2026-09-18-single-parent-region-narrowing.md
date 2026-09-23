# Single-Parent Region Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-region selector's current N-to-N narrowing model
(any region type's selection can narrow any other type's, toggled per-type
via a "show all" escape hatch) with a fixed single-parent hierarchy: one
region type is the "parent," every other type is a simultaneously-visible,
independently-multi-selectable "child" whose list is always narrowed to
what's inside the current parent selection.

**Architecture:** `MonitorsTabManager` gets a flat `parentType`/
`parentRegions`/`parentSelection` for the one parent driver, plus
`childRegionsByType`/`childSelectionsByType` maps (one entry per non-parent
type, always 8 entries) for the simultaneously-selectable children. A new
`selectedRegions` derived aggregates parent + all children into one flat
list that every map/calendar/fill/marker computation already reads from.
`MonitorsTab.svelte` renders the parent as today's dropdown + checkbox list,
and children as one collapsible `<details>` section per type, grouped under
the existing Administrative/Census/District category headings.

**Tech Stack:** Svelte 5 runes, `svelte/reactivity` (`SvelteMap`), `@sjvair/sdk`
(`getRegionsList` with `within=`, `getRegionSummariesBulk*`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-single-parent-region-narrowing-design.md`

## Global Constraints

- Tabs for indentation, double quotes, no trailing commas, 100-char print
  width — run `npm run format` before committing.
- Svelte 5 runes only (`$state`, `$derived`, `$derived.by`, `$effect`) — no
  legacy `$:` reactive statements.
- `Set`/`Map` fields under `$state()` that get mutated via `.set()`/`.add()`/
  `.delete()` on the *same retained instance* must be `SvelteMap`/`SvelteSet`
  (from `svelte/reactivity`) — plain `Map`/`Set` do not propagate those
  mutations reactively under Svelte 5. Fields that are always *reassigned
  wholesale* (`this.field = new Set(...)`) don't need this — reassignment of
  a `$state` field always triggers reactivity regardless of the assigned
  value's type. This plan's field-by-field notes below say which is which;
  don't guess.
- No backend or SDK changes — this only changes how already-existing
  `data-dashboard` code calls and composes `getRegionsList`/
  `getRegionSummariesBulk*`.
- Never commit to main — stay on `feature/multi-region-selector-ui-atoms`
  (already the correct branch, PR #4 open against main).

---

### Task 1: Add `pruneSelection` pure helper to `region-narrowing.ts`

Adds the new pruning primitive the manager rewrite (Task 2) needs, without
touching or removing the existing `shouldNarrow`/`unionOfOtherTypeSelections`
functions yet — they're still imported by the current (not-yet-rewritten)
`monitors-tab.svelte.ts`, so removing them now would break the build before
Task 2 replaces their only caller. This task is purely additive.

**Files:**
- Modify: `src/lib/monitors/region-narrowing.ts`
- Test: `src/lib/monitors/region-narrowing.test.ts`

**Interfaces:**
- Produces: `pruneSelection(selection: Set<string>, availableIds: Set<string>): Set<string>`
  — returns a new `Set` containing only the ids from `selection` that are
  also present in `availableIds`. Framework-agnostic (works on raw string
  sets, not `RegionData`), matching this file's existing style.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/monitors/region-narrowing.test.ts`, above or below the
existing `describe` blocks (leave those untouched — Task 2 deletes them,
not this one):

```ts
import { describe, expect, it } from "vitest";
import { pruneSelection, shouldNarrow, unionOfOtherTypeSelections } from "./region-narrowing";

describe("pruneSelection", () => {
	it("keeps only ids that are present in availableIds", () => {
		const selection = new Set(["a", "b", "c"]);
		const availableIds = new Set(["a", "c", "d"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set(["a", "c"]));
	});

	it("returns an empty set when nothing in the selection is available", () => {
		const selection = new Set(["a", "b"]);
		const availableIds = new Set(["x", "y"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set());
	});

	it("returns everything unchanged when all ids are available", () => {
		const selection = new Set(["a", "b"]);
		const availableIds = new Set(["a", "b", "c"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set(["a", "b"]));
	});

	it("handles an empty selection", () => {
		expect(pruneSelection(new Set(), new Set(["a"]))).toEqual(new Set());
	});

	it("returns a new Set instance, not the same reference as the input", () => {
		const selection = new Set(["a"]);
		const result = pruneSelection(selection, new Set(["a"]));
		expect(result).not.toBe(selection);
	});
});
```

(The `import` line above adds `pruneSelection` to the existing import — update
the file's top import statement rather than duplicating it, since
`shouldNarrow`/`unionOfOtherTypeSelections` are already imported there by the
existing tests.)

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd /home/alex/workspace/sjvair/data-dashboard
npm run test -- region-narrowing
```

Expected: FAIL — `pruneSelection` is not exported.

- [ ] **Step 3: Implement `pruneSelection`**

Add to `src/lib/monitors/region-narrowing.ts` (leave the existing two
functions in place, untouched):

```ts
export function pruneSelection(selection: Set<string>, availableIds: Set<string>): Set<string> {
	const pruned = new Set<string>();
	for (const id of selection) {
		if (availableIds.has(id)) pruned.add(id);
	}
	return pruned;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm run test -- region-narrowing
```

Expected: PASS — all `pruneSelection` cases plus the existing
`shouldNarrow`/`unionOfOtherTypeSelections` cases (unchanged, still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitors/region-narrowing.ts src/lib/monitors/region-narrowing.test.ts
git commit -m "Add pruneSelection helper for single-parent narrowing"
```

---

### Task 2: Rewrite `MonitorsTabManager`'s data model and fetch orchestration

This is the largest task — replaces the entire narrowing-related state and
fetch logic in `monitors-tab.svelte.ts`. `MonitorsTab.svelte` still
references the OLD API this task removes (`selectedRegionType`,
`activeRegions`, `regionSelections`, `narrowingEnabled`, `selectedRegionIds`,
`toggleRegion`, `setRegionType`, `disableNarrowing`) — it will fail to
compile after this task, **deliberately**: Task 3 rewrites it. Verify
`npm run check`'s errors are scoped entirely to `MonitorsTab.svelte`, not to
`monitors-tab.svelte.ts` itself — that scoping is this task's actual
compile gate, not a project-wide green check.

**Files:**
- Modify: `src/routes/monitors/monitors-tab.svelte.ts`
- Modify: `src/lib/monitors/region-narrowing.ts` (delete `shouldNarrow`/
  `unionOfOtherTypeSelections` — this task is what makes them unused)
- Modify: `src/lib/monitors/region-narrowing.test.ts` (delete their tests)

**Interfaces:**
- Consumes: `pruneSelection(selection, availableIds)` from Task 1.
- Produces (read by Task 3):
  - State: `parentType: RegionType`, `parentRegions: Array<RegionData> | null`,
    `parentSelection: Set<string>`, `childTypes: Array<RegionType>` (derived),
    `childRegionsByType: SvelteMap<RegionType, Array<RegionData>>`,
    `childSelectionsByType: SvelteMap<RegionType, Set<string>>`,
    `selectedRegions: Array<RegionData>` (derived, aggregates parent +
    all children), `lastError: string | null` (unchanged), `latest`,
    `regionCalendars`, `regionFillColors` (unchanged shapes).
  - Methods: `init(): Promise<void>`, `refreshParentRegions(): Promise<void>`,
    `refreshChildren(): Promise<void>`, `setParentType(type: RegionType): Promise<void>`,
    `toggleParentRegion(regionId: string): void`,
    `toggleChildRegion(type: RegionType, regionId: string): void`,
    `refreshMapAverages(): Promise<void>`, `refreshCalendar(): Promise<void>`,
    `refreshRegionFill(): Promise<void>` (same names/signatures as before,
    rewritten bodies).
  - Removed entirely: `selectedRegionType`, `activeRegions`,
    `regionSelections`, `narrowingEnabled`, `selectedRegionIds`,
    `calendarDays` (confirmed dead — declared, always set to `null`, never
    read anywhere including the template; removing it as part of this
    rewrite rather than carrying it forward), `toggleRegion`,
    `setRegionType`, `disableNarrowing`, `refreshActiveRegions`.

- [ ] **Step 1: Read the current file in full**

```bash
cat src/routes/monitors/monitors-tab.svelte.ts
```

You're replacing most of this file's body. `#regionDailyCache`/
`#regionMonthlyCache`/`#monitorAveragesCache` and the three private cache
fields' logic inside `refreshMapAverages`/`refreshCalendar`/
`refreshRegionFill` stay conceptually the same (same caching-by-id
approach) — only *which list of regions* they iterate changes, from the old
single `activeRegions`-filtered set to the new `selectedRegions` aggregate.

- [ ] **Step 2: Replace the class body**

Replace `src/routes/monitors/monitors-tab.svelte.ts` from the `class
MonitorsTabManager` declaration through the end of the class (keep the
imports block's non-narrowing imports; update as shown):

```ts
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
import { pruneSelection } from "$lib/monitors/region-narrowing";
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

	parentType: RegionType = $state(DEFAULT_REGION_TYPE);
	parentRegions: Array<RegionData> | null = $state(null);
	// Always reassigned wholesale (this.parentSelection = new Set(...)) —
	// $state field reassignment triggers reactivity regardless of the
	// assigned value's type, so this doesn't need SvelteSet.
	parentSelection: Set<string> = $state(new Set());

	// Both maps below are updated via .set() on the same long-lived map
	// instance (one entry per child type) rather than reassigned wholesale —
	// that requires SvelteMap, since a plain Map's .set() doesn't propagate
	// reactively under Svelte 5 $state(). The *values* inside
	// childSelectionsByType (individual Sets) are still always freshly built
	// and handed to childSelectionsByType.set(type, next) — never mutated
	// in place — so they stay plain Set.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above, mutated via SvelteMap.set() which IS reactive
	childRegionsByType: SvelteMap<RegionType, Array<RegionData>> = $state(new SvelteMap());
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above, mutated via SvelteMap.set() which IS reactive
	childSelectionsByType: SvelteMap<RegionType, Set<string>> = $state(new SvelteMap());

	lastError: string | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	regionCalendars: Array<{ region: RegionData; days: Array<CalendarDay> }> | null = $state(null);
	regionFillColors: Map<string, string> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	// Every in-scope region type except the current parent — always 8
	// entries once `regionTypes` has loaded (9 in-scope types total).
	childTypes: Array<RegionType> = $derived.by(() => {
		if (!this.regionTypes) return [];
		return Object.keys(this.regionTypes.types).filter(
			(type) => type !== this.parentType
		) as Array<RegionType>;
	});

	// Every currently-selected region across the parent AND all 8 child
	// types, flattened into one list — this is what every map/calendar/fill/
	// marker computation reads from, replacing the old single-active-type
	// selectedRegionIds/activeRegions pair.
	selectedRegions: Array<RegionData> = $derived.by(() => {
		const result: Array<RegionData> = [];

		if (this.parentRegions) {
			for (const region of this.parentRegions) {
				if (this.parentSelection.has(region.id)) result.push(region);
			}
		}

		for (const type of this.childTypes) {
			const regions = this.childRegionsByType.get(type);
			const selection = this.childSelectionsByType.get(type);
			if (!regions || !selection || selection.size === 0) continue;

			for (const region of regions) {
				if (selection.has(region.id)) result.push(region);
			}
		}

		return result;
	});

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
		this.parentSelection = new Set(this.parentRegions.map((r) => r.id));

		await this.refreshChildren();
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

				const availableIds = new Set(regions.map((r) => r.id));
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
		this.parentSelection = new Set();

		await this.refreshParentRegions();
		await this.refreshChildren();
		await Promise.all([
			this.refreshMapAverages(),
			this.refreshCalendar(),
			this.refreshRegionFill()
		]);
	}

	toggleParentRegion(regionId: string): void {
		const next = new Set(this.parentSelection);
		if (next.has(regionId)) {
			next.delete(regionId);
		} else {
			next.add(regionId);
		}
		this.parentSelection = next;
	}

	toggleChildRegion(type: RegionType, regionId: string): void {
		const current = this.childSelectionsByType.get(type) ?? new Set<string>();
		const next = new Set(current);
		if (next.has(regionId)) {
			next.delete(regionId);
		} else {
			next.add(regionId);
		}
		this.childSelectionsByType.set(type, next);
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
			return;
		}

		const regions = this.selectedRegions;
		if (regions.length === 0) {
			this.regionFillColors = null;
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
			this.lastError = null;
		} catch {
			if (token !== this.#regionFillFetchToken) return;
			this.regionFillColors = null;
			this.lastError = "Failed to load region data — try a narrower date range or fewer regions.";
		}
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
```

- [ ] **Step 3: Delete the now-unused old functions and their tests**

In `src/lib/monitors/region-narrowing.ts`, delete `unionOfOtherTypeSelections`
and `shouldNarrow` in full (keep `pruneSelection` from Task 1).

In `src/lib/monitors/region-narrowing.test.ts`, delete the
`describe("unionOfOtherTypeSelections", ...)` and `describe("shouldNarrow",
...)` blocks in full (keep `describe("pruneSelection", ...)` from Task 1),
and update the top `import` line to only import `pruneSelection`.

- [ ] **Step 4: Run the region-narrowing tests**

```bash
npm run test -- region-narrowing
```

Expected: PASS — only the `pruneSelection` tests remain, all green.

- [ ] **Step 5: Run `npm run check` and confirm errors are scoped correctly**

```bash
npm run check
```

Expected: errors ONLY in `src/routes/MonitorsTab.svelte` (it still
references the removed `selectedRegionType`/`activeRegions`/
`regionSelections`/etc. — Task 3's job). `monitors-tab.svelte.ts` itself
must show zero errors. If you see errors in `monitors-tab.svelte.ts`, fix
them before moving on — that file must compile clean on its own.

- [ ] **Step 6: Run the full test suite**

```bash
npm run test
```

Expected: PASS (the manager class itself has no test precedent in this
repo, consistent with the rest of `MonitorsTabManager` — verified manually
in Task 3's browser check, not here).

- [ ] **Step 7: Commit**

```bash
git add src/routes/monitors/monitors-tab.svelte.ts src/lib/monitors/region-narrowing.ts src/lib/monitors/region-narrowing.test.ts
git commit -m "Rewrite MonitorsTabManager for single-parent region narrowing"
```

---

### Task 3: Rewrite `MonitorsTab.svelte` and verify end-to-end

Wires the new manager API into the template: parent dropdown + checkbox
list (mostly unchanged), 8 collapsible child sections grouped by category,
new URL state scheme, and map effects (fitBounds, region-fill) updated to
read `manager.selectedRegions` instead of the old single-active-type
filtering. This is the task that makes `npm run check` fully clean again
project-wide.

**Files:**
- Modify: `src/routes/MonitorsTab.svelte`

**Interfaces:**
- Consumes everything Task 2 produces: `manager.parentType`,
  `manager.parentRegions`, `manager.parentSelection`, `manager.childTypes`,
  `manager.childRegionsByType`, `manager.childSelectionsByType`,
  `manager.selectedRegions`, `manager.setParentType(type)`,
  `manager.toggleParentRegion(id)`, `manager.toggleChildRegion(type, id)`,
  `manager.refreshChildren()`, `manager.refreshParentRegions()`,
  `manager.refreshMapAverages()`, `manager.refreshCalendar()`,
  `manager.refreshRegionFill()`.
- Consumes `encodeRegionType`/`decodeRegionType`/`encodeRegionSelection`/
  `decodeRegionSelection` from `$lib/url-state` (unchanged codecs, new
  call pattern — once for the parent, once per child type with a
  selection).

- [ ] **Step 1: Read the current file in full**

```bash
cat src/routes/MonitorsTab.svelte
```

- [ ] **Step 2: Replace the `<script>` block**

Replace the entire `<script lang="ts">...</script>` block with:

```svelte
<script lang="ts">
	import { onMount } from "svelte";
	import { endOfMonth, format, startOfMonth } from "date-fns";
	import {
		MapShell,
		mapManager,
		monitorsMapIntegration as defaultMonitorsMapIntegration,
		MonitorsMapIntegration
	} from "@sjvair/monitor-map";
	import type { RegionType } from "@sjvair/sdk";
	import Calendar from "$lib/components/Calendar.svelte";
	import RegionCheckboxList from "$lib/components/RegionCheckboxList.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { type Bounds, unionBounds } from "$lib/monitors/region-bounds";
	import {
		decodeMonth,
		decodePollutant,
		decodeRegionSelection,
		decodeRegionType,
		decodeYear,
		encodeMonth,
		encodePollutant,
		encodeRegionSelection,
		encodeRegionType,
		encodeYear,
		type MonitorsPollutantParam
	} from "$lib/url-state";
	import { route, searchParams } from "../router";
	import { monitorsTabManager } from "./monitors/monitors-tab.svelte";

	const manager = monitorsTabManager;
	const mapIntegration = new MonitorsMapIntegration(manager);
	mapIntegration.clustered = false;
	mapIntegration.tooltipManager.enabled = false;

	// @sjvair/monitor-map exports a module-level default MonitorsMapIntegration
	// singleton (constructed as a side effect of importing anything from the
	// package) that self-applies onto the shared map as soon as it exists,
	// independent of the mapIntegration instance we construct and pass to
	// MapShell above. Left alone, it collides with ours on the same "monitors"
	// layer id with its own (default: tooltip-enabled) TooltipManager, so it
	// needs the same overrides.
	defaultMonitorsMapIntegration.clustered = false;
	defaultMonitorsMapIntegration.tooltipManager.enabled = false;

	const MONTH_NAMES = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	];

	const CATEGORIES = ["administrative", "census", "district"] as const;

	function currentYearMonth(): { year: number; month: number } {
		const now = new Date();
		return { year: now.getFullYear(), month: now.getMonth() + 1 };
	}

	function monthRange(year: number, month: number) {
		const first = startOfMonth(new Date(year, month - 1, 1));
		const last = endOfMonth(first);
		return {
			start: format(first, "yyyy-MM-dd"),
			end: format(last, "yyyy-MM-dd")
		};
	}

	// Writes the parentType/parent/<child-type> query params from the
	// manager's current state. Called after any action that can change
	// parent or child selections, since a parent-selection change prunes
	// child selections too (see MonitorsTabManager.refreshChildren) and the
	// URL needs to reflect the post-prune result, not just the action that
	// triggered it.
	function syncSelectionToUrl() {
		searchParams.set("parentType", encodeRegionType(manager.parentType), { replace: true });
		searchParams.set("parent", encodeRegionSelection(manager.parentSelection), { replace: true });
		for (const type of manager.childTypes) {
			const selection = manager.childSelectionsByType.get(type) ?? new Set<string>();
			searchParams.set(type, encodeRegionSelection(selection), { replace: true });
		}
	}

	onMount(async () => {
		await manager.init();

		// route.search values come from sv-router, which parses numeric-looking query
		// values (e.g. "?year=2026") into a JS number rather than a string — each
		// decode* function already accepts string | number | boolean, so pass its raw
		// value straight through rather than pre-filtering to strings only.
		const urlYear = decodeYear(route.search.year);
		const urlMonth = decodeMonth(route.search.month);
		const urlPollutant = decodePollutant(route.search.pollutant);
		const urlParentType = decodeRegionType(route.search.parentType);
		const urlParentSelection = decodeRegionSelection(route.search.parent);

		const defaults = currentYearMonth();
		const year = urlYear ?? defaults.year;
		const month = urlMonth ?? defaults.month;
		const pollutant = urlPollutant ?? "pm25";
		const parentType = (urlParentType as RegionType | null) ?? "county";

		manager.dateRange = monthRange(year, month);
		manager.pollutant = pollutant;

		if (parentType !== manager.parentType) {
			manager.parentType = parentType;
			// Reset before checking the URL for an explicit override below —
			// otherwise a URL with a new parentType but no `parent` param would
			// leave manager.init()'s "all counties" selection stuck on the new
			// parentType, which is wrong for any type other than county.
			manager.parentSelection = new Set();
			await manager.refreshParentRegions();
		}
		if (urlParentSelection.size > 0) {
			manager.parentSelection = urlParentSelection;
		}
		// If `parent` was absent from the URL and parentType is still the
		// default "county", manager.init() already seeded "all counties".

		// Child-type selections from the URL, applied per type using that
		// type's own query param name — refreshChildren() below fetches each
		// child type's narrowed list and prunes these against it, so a
		// bookmarked child selection that doesn't actually fall within the
		// bookmarked parent selection is correctly dropped, not kept.
		for (const type of manager.childTypes) {
			const urlChildSelection = decodeRegionSelection(route.search[type]);
			if (urlChildSelection.size > 0) {
				manager.childSelectionsByType.set(type, urlChildSelection);
			}
		}

		if (!urlYear) searchParams.set("year", encodeYear(year), { replace: true });
		if (!urlMonth) searchParams.set("month", encodeMonth(month), { replace: true });
		if (!urlPollutant) searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });

		await manager.refreshChildren();
		syncSelectionToUrl();

		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	});

	async function handleParentTypeChange(value: string | undefined) {
		if (!value) return;
		await manager.setParentType(value as RegionType);
		syncSelectionToUrl();
	}

	async function handleParentToggle(regionId: string) {
		manager.toggleParentRegion(regionId);
		await manager.refreshChildren();
		syncSelectionToUrl();
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleChildToggle(type: RegionType, regionId: string) {
		manager.toggleChildRegion(type, regionId);
		syncSelectionToUrl();
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handlePollutantChange(pollutant: MonitorsPollutantParam) {
		manager.pollutant = pollutant;
		searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleYearMonthChange(year: number, month: number) {
		const nextRange = monthRange(year, month);
		manager.dateRange = nextRange;
		searchParams.set("year", encodeYear(year), { replace: true });
		searchParams.set("month", encodeMonth(month), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleYearChange(value: string | undefined) {
		if (!value) return;
		await handleYearMonthChange(Number(value), selectedMonth);
	}

	async function handleMonthChange(value: string | undefined) {
		if (!value) return;
		await handleYearMonthChange(selectedYear, Number(value));
	}

	let selectedYear = $derived(Number(manager.dateRange.start.slice(0, 4)));
	let selectedMonth = $derived(Number(manager.dateRange.start.slice(5, 7)));
	let yearOptions = $derived.by(() => {
		const current = currentYearMonth().year;
		return Array.from({ length: 5 }, (_, i) => current - i);
	});

	// Zod's tuple inference types `RegionBoundary.bbox` as
	// `[number, number, number, number, ...unknown[]]` rather than a clean
	// 4-tuple, even though the schema (and the server) always sends exactly
	// 4 numbers. Also, reading it off manager state (a `$state` array) hands
	// back a Svelte reactive Proxy wrapping the array, not a plain array —
	// MapLibre's bounds parsing doesn't handle that correctly, so
	// `$state.snapshot()` unwraps it into a real array before we hand it off.
	function toBounds(bbox: unknown): Bounds {
		return $state.snapshot(bbox) as Bounds;
	}

	// Pan/zoom the map to the union of every selected region's bounds
	// (parent + all children), or back out to cover the full parent list
	// when nothing is selected anywhere. Re-runs whenever the selection
	// changes and also once the map itself becomes ready (mapManager.map is
	// reactive), so it self-corrects if this effect ran before the map
	// finished initializing.
	$effect(() => {
		if (!mapManager.map) return;

		const targetRegions =
			manager.selectedRegions.length > 0 ? manager.selectedRegions : (manager.parentRegions ?? []);

		const allBounds = targetRegions
			.map((region) => region.boundary?.bbox)
			.filter((bbox) => bbox != null)
			.map(toBounds);
		const bounds = unionBounds(allBounds);
		if (bounds) {
			mapManager.map.fitBounds(bounds, { padding: 40 });
		}
	});

	// MapShell only calls map.resize() for its own internal panel transition,
	// not for host-driven layout changes -- the map's flex-1 wrapper here
	// grows/shrinks depending on whether the calendar block below it is
	// present, and without an explicit resize() after that, MapLibre's canvas
	// keeps stale internal dimensions and renders against the wrong bounds.
	let mapWrapper: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!mapWrapper) return;

		const observer = new ResizeObserver(() => {
			mapManager.map?.resize();
		});
		observer.observe(mapWrapper);

		return () => observer.disconnect();
	});

	const REGION_FILL_SOURCE_ID = "region-fill";
	const REGION_FILL_LAYER_ID = "region-fill-polygons";
	const REGION_FILL_BORDER_LAYER_ID = "region-fill-border";

	// Fill each selected region (parent or any child type) with a
	// semi-transparent version of its monthly average's level color — no
	// fill at all when nothing is selected anywhere (manager.regionFillColors
	// already reflects that scoping, computed in
	// MonitorsTabManager.refreshRegionFill()). A solid-color border (same
	// color as the fill, full opacity) traces each filled region so its
	// boundary stays legible against neighbors.
	$effect(() => {
		if (!mapManager.map) return;

		if (!mapManager.map.getSource(REGION_FILL_SOURCE_ID)) {
			mapManager.map.addSource(REGION_FILL_SOURCE_ID, {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			mapManager.map.addLayer({
				id: REGION_FILL_LAYER_ID,
				type: "fill",
				source: REGION_FILL_SOURCE_ID,
				paint: {
					"fill-color": ["get", "color"],
					"fill-opacity": 0.35
				}
			});
			mapManager.map.addLayer({
				id: REGION_FILL_BORDER_LAYER_ID,
				type: "line",
				source: REGION_FILL_SOURCE_ID,
				paint: {
					"line-color": ["get", "color"],
					"line-width": 2
				}
			});
		}

		const colors = manager.regionFillColors;
		const features = manager.selectedRegions.flatMap((region) => {
			const color = colors?.get(region.id);
			if (!color || !region.boundary?.geometry) return [];
			return [
				{
					type: "Feature" as const,
					properties: { color },
					geometry: $state.snapshot(region.boundary.geometry)
				}
			];
		});

		mapManager.setDataSource(REGION_FILL_SOURCE_ID, features);
	});
</script>
```

- [ ] **Step 3: Replace the template**

Replace everything from `<div class="flex h-full flex-col gap-4 p-4">`
onward:

```svelte
<div class="flex h-full flex-col gap-4 p-4">
	<div class="flex flex-wrap items-center gap-4">
		<div class="flex items-center gap-2" role="radiogroup" aria-label="Pollutant">
			<Button
				variant={manager.pollutant === "pm25" ? "default" : "outline"}
				size="sm"
				aria-pressed={manager.pollutant === "pm25"}
				onclick={() => handlePollutantChange("pm25")}
			>
				PM2.5
			</Button>
			<Button
				variant={manager.pollutant === "o3" ? "default" : "outline"}
				size="sm"
				aria-pressed={manager.pollutant === "o3"}
				onclick={() => handlePollutantChange("o3")}
			>
				Ozone
			</Button>
		</div>

		<Select.Root type="single" value={String(selectedYear)} onValueChange={handleYearChange}>
			<Select.Trigger class="w-28">{selectedYear}</Select.Trigger>
			<Select.Content>
				{#each yearOptions as year (year)}
					<Select.Item value={String(year)} label={String(year)}>{year}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" value={String(selectedMonth)} onValueChange={handleMonthChange}>
			<Select.Trigger class="w-36">{MONTH_NAMES[selectedMonth - 1]}</Select.Trigger>
			<Select.Content>
				{#each MONTH_NAMES as name, index (name)}
					<Select.Item value={String(index + 1)} label={name}>{name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={manager.parentType}
			onValueChange={handleParentTypeChange}
		>
			<Select.Trigger class="w-56">
				{manager.regionTypes?.type(manager.parentType)?.label ?? manager.parentType}
			</Select.Trigger>
			<Select.Content>
				{#each CATEGORIES as category (category)}
					<Select.Group>
						<Select.GroupHeading class="text-muted-foreground px-2 text-xs uppercase">
							{category}
						</Select.GroupHeading>
						{#each manager.regionTypes?.asIter.types.filter((t) => t.category === category) ?? [] as regionType (regionType.type)}
							<Select.Item value={regionType.type} label={regionType.label}>
								{regionType.label}
							</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<RegionCheckboxList
		regions={manager.parentRegions ?? []}
		selected={manager.parentSelection}
		onToggle={handleParentToggle}
	/>

	<div class="flex flex-col gap-4">
		{#each CATEGORIES as category (category)}
			{@const typesInCategory = manager.childTypes.filter(
				(type) => manager.regionTypes?.type(type)?.category === category
			)}
			{#if typesInCategory.length > 0}
				<div>
					<h3 class="text-muted-foreground mb-1 text-xs uppercase">{category}</h3>
					<div class="flex flex-col gap-2">
						{#each typesInCategory as type (type)}
							{@const childRegions = manager.childRegionsByType.get(type) ?? []}
							{@const childSelection = manager.childSelectionsByType.get(type) ?? new Set()}
							<details open={childSelection.size > 0}>
								<summary class="cursor-pointer text-sm font-medium">
									{manager.regionTypes?.type(type)?.label ?? type}
									{#if childSelection.size > 0}
										({childSelection.size} selected)
									{/if}
								</summary>
								<div class="mt-2 pl-4">
									<RegionCheckboxList
										regions={childRegions}
										selected={childSelection}
										onToggle={(id) => handleChildToggle(type, id)}
									/>
								</div>
							</details>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	</div>

	{#if manager.lastError}
		<p class="text-destructive text-sm">{manager.lastError}</p>
	{/if}

	<!-- min-h-[400px] (not min-h-0) since this container's flex parent no longer has a
		bounded height once the region checkbox lists and per-region calendar grid below can
		both grow past the viewport — without a floor, "flex-1" computes its size against an
		unconstrained container and collapses the map to 0 instead of giving it real screen
		space. The page scrolls as a whole (via the app shell's <main class="overflow-auto">)
		once content exceeds the viewport, rather than trying to keep the map pinned in a
		fixed-height layout. -->
	<div class="min-h-[400px] flex-1" bind:this={mapWrapper}>
		<MapShell
			integrations={[mapIntegration]}
			ready={manager.initialized}
			panelOpen={false}
			routerEscapeHatch={false}
		/>
	</div>

	{#if manager.regionCalendars}
		<div class="flex flex-row flex-wrap gap-6">
			{#each manager.regionCalendars as { region, days } (region.id)}
				<div>
					<h3 class="mb-1 text-sm font-medium">{region.name}</h3>
					<Calendar {days} />
				</div>
			{/each}
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Run `npm run check`, `npm run lint`, `npm run test`**

```bash
npm run check
npm run lint
npm run test
```

Expected: ALL CLEAN — 0 errors project-wide (this is the task that must
leave the whole project green), lint clean, all tests passing. Fix anything
that doesn't match before proceeding.

- [ ] **Step 5: Manual browser verification**

```bash
npm run dev
```

Using the `run` skill's launch pattern for this project (or claude-in-chrome
if driving a browser directly), open the Monitors tab and verify, at
minimum:

- Default load: parent type is County, all counties checked, no child
  sections have a selection (all collapsed).
- Switching parent type (e.g. to City): parent checkbox list repopulates
  unfiltered for City, parent selection resets to empty, all 8 child
  sections re-fetch narrowed by the (now-empty) parent selection — which
  means every child list should come back full/unfiltered too, since an
  empty parent selection means no `within=` scoping.
- Check some parent regions (e.g. 2 counties): child sections' lists
  narrow to what's within those 2 counties. Toggling a checkbox in, say,
  the City section does NOT re-fetch any region list (only map/calendar/
  fill refresh) and does NOT affect the ZIP Code section's list or
  selection.
- Uncheck a parent region that a child selection depended on: that child's
  out-of-scope selection is pruned (its checkbox becomes unchecked/
  disappears from the now-narrower list) automatically, without a page
  reload.
- Multiple child types can hold selections simultaneously (e.g. a City and
  a Census Tract both checked at once) and both contribute to the map fill,
  calendar grid, and visible monitor markers together.
- A child section with a non-empty selection is expanded by default; a
  section with an empty selection is collapsed. Manually collapsing a
  section that has a selection doesn't get forced back open on an
  unrelated interaction.
- URL round-trip: reload the page with a URL like
  `?parentType=county&parent=<id>&city=<id>` (grab real ids from your
  session) and confirm the same state re-renders, including any pruning
  that a stale/mismatched bookmark should trigger.
- URL with a changed `parentType` but NO `parent` param (e.g.
  `?parentType=city` alone): confirm the parent selection starts empty
  (not carrying over "all counties" from the default-county bootstrap) —
  this is a real bug this plan's own self-review caught and fixed in
  `onMount`'s ordering; verify the fix actually holds in the browser, not
  just in the diff.
- No `console.error` output for a typical interaction sequence (switch
  parent type, toggle a few parent and child regions, change pollutant,
  change month).

- [ ] **Step 6: Commit**

```bash
git add src/routes/MonitorsTab.svelte
git commit -m "Wire single-parent narrowing UI into MonitorsTab"
```

- [ ] **Step 7: Push**

```bash
git push
```

(This branch already has an open PR — `data-dashboard#4` — so this just
adds commits to it; no new PR needed.)

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 2), UI layout (Task 3), fetching/data
  flow (Task 2's `refreshChildren`/`setParentType`), selection pruning
  (Task 2's `pruneSelection` integration in `refreshChildren`, Task 1's
  helper), what drives the map (Task 2's `selectedRegions` aggregate, used
  throughout), URL state (Task 3's `syncSelectionToUrl`/`onMount`), error
  handling (unchanged `lastError` pattern, carried through Task 2's
  rewritten refresh methods), testing (Task 1's `pruneSelection` tests;
  manager-level behavior explicitly called out in the spec as
  manually-verified, covered by Task 3 Step 5) — every spec section maps to
  a task.
- **Placeholder scan:** no TBD/TODO; Task 2's removed-fields list is
  explicit and complete; no step describes an action without showing the
  code.
- **Type consistency:** `RegionType`, `RegionData`, method names
  (`refreshParentRegions`, `refreshChildren`, `setParentType`,
  `toggleParentRegion`, `toggleChildRegion`, `refreshMapAverages`,
  `refreshCalendar`, `refreshRegionFill`) and field names (`parentType`,
  `parentRegions`, `parentSelection`, `childTypes`, `childRegionsByType`,
  `childSelectionsByType`, `selectedRegions`) are used identically across
  Task 2 (where they're defined) and Task 3 (where they're consumed) —
  cross-checked term by term while writing this plan.
- **`calendarDays` removal:** confirmed via `grep` against the live
  codebase (not assumed) that this field was already fully dead before this
  plan — declared, always set to `null`, never read in the template or
  anywhere else — so removing it in Task 2 is a safe, in-scope cleanup, not
  a behavior change.
- **UI primitive choice:** the spec calls for "collapsible sections" without
  mandating a specific component. This plan uses plain HTML `<details>`/
  `<summary>` rather than wrapping bits-ui's `Accordion` primitive (which
  exists in `node_modules` but has no `ui/` wrapper in this repo yet, unlike
  `Checkbox`/`Select`) — `<details>` has native open/closed semantics,
  needs no new wrapper-component task, and nothing in the spec calls for
  the coordinated single-open-item behavior `Accordion` is for (every child
  section is independently collapsible, matching bits-ui's `type="multiple"`
  mode anyway, which is no simpler than plain `<details>` for this case).
