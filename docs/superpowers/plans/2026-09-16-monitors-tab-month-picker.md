# Monitors Tab Month Picker & County Choropleth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Monitors tab's free-form date-range picker with a
year/month selector (defaulting to the current month), switch the map's
per-monitor averaging and the new county-fill data to always use monthly
summaries, and replace the selected-county border outline with a
semi-transparent fill (all counties when none is selected, only the
selected county otherwise) colored by each county's monthly average level.

**Architecture:** `MonitorsTab.svelte` gains two new `Select`s (Year,
Month) that compute a `{ start, end }` range spanning exactly that
calendar month and write it into the existing `manager.dateRange` — the
manager's `refreshMapAverages()`/`refreshCalendar()` methods are unchanged
in shape, just always monthly now instead of daily-or-monthly. A new
`MonitorsTabManager.refreshCountyFill()` method fetches monthly region
summaries (all counties, or just the selected one) and buckets each into a
level color via a new pure helper; a new map effect renders that as a fill
layer, replacing the old border-outline effect.

**Tech Stack:** Svelte 5 (runes), TypeScript, `sv-router`, `@sjvair/sdk`,
`@sjvair/monitor-map` (`MapShell`, `mapManager`, `MonitorsMapIntegration`),
shadcn-svelte `Select`, Vitest, `date-fns`.

**Spec:**
`docs/superpowers/specs/2026-09-16-monitors-tab-month-picker-design.md`

## Global Constraints

- Tabs for indentation, double quotes, no trailing commas, 100-character
  print width — run `npm run format` after any change.
- Svelte 5 runes only (`$state`, `$derived`, `$props`, `$effect`) — no
  legacy `$:`.
- The tab's entry-type selector stays restricted to `"pm25" | "o3"` — no
  change to that scope.
- Year dropdown offers the current year plus the 4 prior (5 total,
  descending). Month dropdown offers all 12 months.
- Calendar view is unchanged mechanically: always daily resolution, always
  only the selected county, just always called with exactly one month's
  range now instead of an arbitrary one.
- Monitor markers and county-based monitor filtering are unchanged — only
  the county *fill* visualization and the summary resolution change.
- County fill: every county filled when no county is selected; only the
  selected county filled when one is chosen. No new data source outside
  `getRegionSummariesMonthly`/the existing `getRegionsList`/`levels`.
- No changes to `sdk-js`, `monitor-map`, or the `sjvair.com` backend.

---

### Task 1: Year and month URL-state codecs

**Files:**
- Modify: `src/lib/url-state.ts`
- Modify: `src/lib/url-state.test.ts`

**Interfaces:**
- Produces: `encodeYear(year: number): string`,
  `decodeYear(value: string | number | boolean | null | undefined): number | null`,
  `encodeMonth(month: number): string`,
  `decodeMonth(value: string | number | boolean | null | undefined): number | null`.
  Consumed by Task 6's `MonitorsTab.svelte` for reading/writing the `year`
  and `month` URL search params. `decodeMonth` only accepts integers
  1–12 inclusive; both decoders only accept string input (matching how
  `decodePollutant`/`decodeCounty` already behave) and return `null` for
  anything else, including numbers/booleans directly (route.search values
  are typed `string | number | boolean` but in practice URL params always
  arrive as strings).

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/url-state.test.ts`:

```ts
describe("year codec", () => {
	it("round-trips a valid year", () => {
		expect(decodeYear(encodeYear(2026))).toBe(2026);
	});

	it("decodes a non-numeric string as null", () => {
		expect(decodeYear("not-a-year")).toBeNull();
	});

	it("decodes null and undefined as null", () => {
		expect(decodeYear(null)).toBeNull();
		expect(decodeYear(undefined)).toBeNull();
	});

	it("decodes a non-string value as null", () => {
		expect(decodeYear(2026)).toBeNull();
		expect(decodeYear(true)).toBeNull();
	});
});

describe("month codec", () => {
	it("round-trips a valid month", () => {
		expect(decodeMonth(encodeMonth(9))).toBe(9);
	});

	it("decodes an out-of-range month as null", () => {
		expect(decodeMonth("0")).toBeNull();
		expect(decodeMonth("13")).toBeNull();
	});

	it("decodes a non-numeric string as null", () => {
		expect(decodeMonth("september")).toBeNull();
	});

	it("decodes null and undefined as null", () => {
		expect(decodeMonth(null)).toBeNull();
		expect(decodeMonth(undefined)).toBeNull();
	});
});
```

Update the existing `import` line at the top of the test file to also pull
in `decodeYear`, `encodeYear`, `decodeMonth`, `encodeMonth`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/url-state.test.ts`
Expected: FAIL — the new imports don't exist yet.

- [ ] **Step 3: Implement**

Append to `src/lib/url-state.ts`:

```ts
export function encodeYear(year: number): string {
	return String(year);
}

export function decodeYear(
	value: string | number | boolean | null | undefined
): number | null {
	if (typeof value !== "string") return null;
	const year = Number(value);
	return Number.isInteger(year) ? year : null;
}

export function encodeMonth(month: number): string {
	return String(month);
}

export function decodeMonth(
	value: string | number | boolean | null | undefined
): number | null {
	if (typeof value !== "string") return null;
	const month = Number(value);
	return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/url-state.test.ts`
Expected: PASS (all prior tests plus the new ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-state.ts src/lib/url-state.test.ts
git commit -m "Add year and month URL-state codecs"
```

---

### Task 2: Replace preferences' date-range field with a month field

**Files:**
- Modify: `src/lib/preferences.ts`
- Modify: `src/lib/preferences.test.ts`

**Interfaces:**
- Produces: `TabPreferences.month?: { year: number; month: number }`
  (replacing `TabPreferences.dateRange?: { start: string; end: string }`).
  Consumed by Task 6's `MonitorsTab.svelte` `onMount` to seed the
  last-selected month when no URL params are present.

This task only changes the `TabPreferences` interface shape and the
existing test file's fixture data — `getTabPreferences`/`setTabPreferences`/
`clearAllPreferences` themselves are generic (`Record<string,
TabPreferences>`-shaped) and need no code changes.

- [ ] **Step 1: Update the interface**

In `src/lib/preferences.ts`, replace:

```ts
export interface TabPreferences {
	dateRange?: { start: string; end: string };
	views?: ViewToggles;
}
```

with:

```ts
export interface TabPreferences {
	month?: { year: number; month: number };
	views?: ViewToggles;
}
```

- [ ] **Step 2: Update the existing tests to use the new field**

In `src/lib/preferences.test.ts`, replace every occurrence of
`{ dateRange: { start: "2026-01-01", end: "2026-01-02" } }` with
`{ month: { year: 2026, month: 1 } }`, and every assertion that expects
`dateRange: { start: "2026-01-01", end: "2026-01-02" }` in a returned
object with `month: { year: 2026, month: 1 }`. There are 6 occurrences
(the `it` blocks: "persists and retrieves preferences for a tab", "merges
partial updates instead of overwriting the whole tab" — both the `set`
call and the two spots inside the expected object — "clearAllPreferences
removes all stored data", and "behaves safely when localStorage itself is
unavailable"). The full updated file:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllPreferences, getTabPreferences, setTabPreferences } from "./preferences";

function createMemoryStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: (index) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size;
		}
	};
}

beforeEach(() => {
	globalThis.localStorage = createMemoryStorage();
});

describe("preferences", () => {
	it("returns an empty object for a tab with no stored preferences", () => {
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("persists and retrieves preferences for a tab", () => {
		setTabPreferences("monitors", { month: { year: 2026, month: 1 } });
		expect(getTabPreferences("monitors")).toEqual({
			month: { year: 2026, month: 1 }
		});
	});

	it("keeps preferences for different tabs independent", () => {
		setTabPreferences("monitors", { views: { map: true, chart: false, spreadsheet: false } });
		setTabPreferences("hms", { views: { map: false, chart: true, spreadsheet: true } });
		expect(getTabPreferences("monitors").views).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
		expect(getTabPreferences("hms").views).toEqual({ map: false, chart: true, spreadsheet: true });
	});

	it("merges partial updates instead of overwriting the whole tab", () => {
		setTabPreferences("monitors", { month: { year: 2026, month: 1 } });
		setTabPreferences("monitors", { views: { map: true, chart: true, spreadsheet: false } });
		expect(getTabPreferences("monitors")).toEqual({
			month: { year: 2026, month: 1 },
			views: { map: true, chart: true, spreadsheet: false }
		});
	});

	it("clearAllPreferences removes all stored data", () => {
		setTabPreferences("monitors", { month: { year: 2026, month: 1 } });
		clearAllPreferences();
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("recovers from corrupted JSON in storage instead of throwing", () => {
		localStorage.setItem("sjvair-dashboard-preferences", "{not json");
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("recovers from a stored tabs value that isn't an object", () => {
		localStorage.setItem("sjvair-dashboard-preferences", JSON.stringify({ tabs: null }));
		expect(getTabPreferences("monitors")).toEqual({});
	});

	it("behaves safely when localStorage itself is unavailable", () => {
		// @ts-expect-error - simulating an environment without localStorage
		delete globalThis.localStorage;

		expect(() => getTabPreferences("monitors")).not.toThrow();
		expect(getTabPreferences("monitors")).toEqual({});

		expect(() =>
			setTabPreferences("monitors", { month: { year: 2026, month: 1 } })
		).not.toThrow();
		expect(getTabPreferences("monitors")).toEqual({});

		expect(() => clearAllPreferences()).not.toThrow();
	});
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run src/lib/preferences.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: 0 errors (nothing outside `preferences.ts` references `dateRange`
yet at this point in the plan — `MonitorsTab.svelte` is updated in Task 6).
If `npm run check` reports an error in `MonitorsTab.svelte` about a missing
`dateRange` field, that's expected until Task 6 — note it and continue;
do not fix it in this task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferences.ts src/lib/preferences.test.ts
git commit -m "Replace preferences date-range field with a month field"
```

---

### Task 3: Remove the daily/monthly summary-resolution helper

**Files:**
- Delete: `src/lib/monitors/summary-resolution.ts`
- Delete: `src/lib/monitors/summary-resolution.test.ts`

**Interfaces:**
- Removes: `SummaryResolution`, `pickSummaryResolution` — no longer
  consumed by anything once Task 5 removes its one call site. This task
  only deletes the files; Task 5 removes the corresponding import and call
  site in `monitors-tab.svelte.ts`. Deleting the files first means Task 5's
  `npm run check` will show a real "module not found" error if it forgets
  to remove the usage — a useful ordering, not a mistake.

- [ ] **Step 1: Delete the files**

```bash
git rm src/lib/monitors/summary-resolution.ts src/lib/monitors/summary-resolution.test.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "Remove summary-resolution helper (map data is always monthly now)"
```

---

### Task 4: County-fill color helper

**Files:**
- Create: `src/lib/monitors/county-fill.ts`
- Test: `src/lib/monitors/county-fill.test.ts`

**Interfaces:**
- Consumes: `SJVAirEntryLevel` from `@sjvair/sdk`, `getCurrentLevel` from
  `$lib/calendar` (already exported there — `getCurrentLevel(value: number,
  levels: Array<SJVAirEntryLevel>): SJVAirEntryLevel | undefined`).
- Produces: `buildCountyFillColors(regionMeans: Map<string, number>, levels:
  Array<SJVAirEntryLevel> | null): Map<string, string>` — maps each
  region's mean value into its level's `color`, omitting any region whose
  mean doesn't fall into any level (or when `levels` is `null`). Consumed
  by Task 5's `MonitorsTabManager.refreshCountyFill()`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/monitors/county-fill.test.ts
import { describe, expect, it } from "vitest";
import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { buildCountyFillColors } from "./county-fill";

const levels: Array<SJVAirEntryLevel> = [
	{ name: "good", label: "Good", color: "#00e400", range: [0, 9], guidance: null },
	{ name: "moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4], guidance: null }
];

describe("buildCountyFillColors", () => {
	it("buckets each region's mean into its level color", () => {
		const means = new Map([
			["fresno", 5],
			["kern", 20]
		]);
		const colors = buildCountyFillColors(means, levels);
		expect(colors.get("fresno")).toBe("#00e400");
		expect(colors.get("kern")).toBe("#ffff00");
	});

	it("omits regions whose mean doesn't match any level", () => {
		const means = new Map([["fresno", 1000]]);
		const colors = buildCountyFillColors(means, levels);
		expect(colors.has("fresno")).toBe(false);
	});

	it("returns an empty map when levels is null", () => {
		const means = new Map([["fresno", 5]]);
		expect(buildCountyFillColors(means, null).size).toBe(0);
	});

	it("returns an empty map for an empty input", () => {
		expect(buildCountyFillColors(new Map(), levels).size).toBe(0);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/monitors/county-fill.test.ts`
Expected: FAIL — `Cannot find module './county-fill'`

- [ ] **Step 3: Implement**

```ts
// src/lib/monitors/county-fill.ts
import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { getCurrentLevel } from "$lib/calendar";

export function buildCountyFillColors(
	regionMeans: Map<string, number>,
	levels: Array<SJVAirEntryLevel> | null
): Map<string, string> {
	const colors = new Map<string, string>();
	if (!levels) return colors;

	for (const [regionId, mean] of regionMeans) {
		const level = getCurrentLevel(mean, levels);
		if (level) colors.set(regionId, level.color);
	}

	return colors;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/monitors/county-fill.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitors/county-fill.ts src/lib/monitors/county-fill.test.ts
git commit -m "Add county-fill color bucketing helper"
```

---

### Task 5: Update `MonitorsTabManager` — always-monthly map averages, county fill

**Files:**
- Modify: `src/routes/monitors/monitors-tab.svelte.ts`

**Interfaces:**
- Consumes: `buildCountyFillColors` (Task 4), `getRegionSummariesMonthly`
  and `getMonitorSummariesMonthly` from `@sjvair/sdk` (the latter already
  imported; the former is new — same param shape as
  `getRegionSummariesDaily`, just `resolution: "monthly"` in the URL, config
  `{ regionId: string; entryType: MonitorEntryType; year: number; page?:
  number }`, returning `Array<RegionSummary>` with fields `{ timestamp,
  entry_type, resolution, count, expected_count, minimum, maximum, mean,
  stddev, p25, p75, station_count }` — identical shape to
  `getRegionSummariesDaily`'s rows, just monthly-bucketed).
- Produces: `MonitorsTabManager.countyFillColors: Map<string, string> |
  null` (`$state`), `MonitorsTabManager.refreshCountyFill(): Promise<void>`.
  Also changes `refreshMapAverages()` to always call
  `getMonitorSummariesMonthly` (no more `pickSummaryResolution`/daily
  branch). Consumed by Task 6's `MonitorsTab.svelte`.

This task has no dedicated unit test for `refreshCountyFill()` itself —
it's fetch-orchestration glue over the already-tested pure
`buildCountyFillColors` helper (Task 4), matching this repo's existing
boundary between tested pure logic and manually-verified orchestration
(the sibling `refreshMapAverages()`/`refreshCalendar()` methods have no
tests either). It's verified manually in Task 6's dev-server check.

- [ ] **Step 1: Update the imports**

At the top of `src/routes/monitors/monitors-tab.svelte.ts`, replace:

```ts
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
```

with:

```ts
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
```

- [ ] **Step 2: Add the `countyFillColors` field**

Immediately after the existing `calendarDays` field:

```ts
	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	calendarDays: Array<CalendarDay> | null = $state(null);
	countyFillColors: Map<string, string> | null = $state(null);
```

- [ ] **Step 3: Simplify `refreshMapAverages()` to always use monthly summaries**

Replace the whole method:

```ts
	async refreshMapAverages(): Promise<void> {
		if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) return;

		const monitors = this.visibleMonitors;
		const pollutant = this.pollutant;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const startYear = new Date(this.dateRange.start).getFullYear();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const endYear = new Date(this.dateRange.end).getFullYear();
		const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive scratch map
		const averages = new Map<string, number>();

		await Promise.all(
			monitors.map(async (monitor) => {
				const rowsByYear = await Promise.all(
					years.map((year) =>
						getMonitorSummariesMonthly({ monitorId: monitor.id, entryType: pollutant, year })
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

		this.latest = buildMonitorsLatest(monitors, averages, pollutant, this.dateRange.end);
	}
```

(Only the `resolution === "daily" ? getMonitorSummariesDaily(...) :
getMonitorSummariesMonthly(...)` ternary from the old version is gone,
replaced with an unconditional `getMonitorSummariesMonthly(...)` call. The
multi-year loop is left as-is — with a year/month picker a single selected
month can never span two years, so `years` is always a 1-element array in
practice, but the loop still behaves correctly and there's no reason to
special-case it away.)

- [ ] **Step 4: Add `refreshCountyFill()`**

Add this new method after `refreshCalendar()`, before the closing brace of
the class:

```ts
	async refreshCountyFill(): Promise<void> {
		if (!this.pollutant || !this.dateRange.start || !this.counties) {
			this.countyFillColors = null;
			return;
		}

		const pollutant = this.pollutant;
		const monthKey = this.dateRange.start.slice(0, 7);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const year = new Date(this.dateRange.start).getFullYear();
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
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: 0 errors. If `getRegionSummariesMonthly`'s config type doesn't
match (e.g. field name differs from `regionId`/`entryType`/`year`), fix the
call in this file to match the actual exported type — do not guess further
without checking `node_modules/@sjvair/sdk`'s type declarations for
`RegionSummaryYearRequestConfig`.

- [ ] **Step 6: Format**

```bash
npm run format
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/monitors/monitors-tab.svelte.ts
git commit -m "MonitorsTabManager: always-monthly map averages, add county fill"
```

---

### Task 6: Wire up the year/month picker and county-fill map layer

**Files:**
- Modify: `src/routes/MonitorsTab.svelte`

**Interfaces:**
- Consumes: `encodeYear`/`decodeYear`/`encodeMonth`/`decodeMonth` (Task 1),
  `TabPreferences.month` (Task 2), `manager.countyFillColors`/
  `manager.refreshCountyFill()` (Task 5), everything already used in this
  file (`mapManager`, `MonitorsMapIntegration`, `MapShell`, `Calendar`,
  `Button`, `Select.*`, `unionBounds`/`Bounds` from `$lib/monitors/region-bounds`,
  `getTabPreferences`/`setTabPreferences`, `decodeCounty`/`encodeCounty`/
  `decodePollutant`/`encodePollutant`/`type MonitorsPollutantParam`, `route`/
  `searchParams`, `monitorsTabManager`).
- Removes: the `range` URL param and its codecs (`decodeDateRange`/
  `encodeDateRange` stay exported from `url-state.ts` for potential reuse
  elsewhere — only their *usage in this file* is removed), the two date
  `<input>` elements, `defaultDateRange()`, `handleDateRangeChange()`,
  `MAX_CALENDAR_DAYS` import, the county-border source/layer/effect
  (`COUNTY_BORDER_SOURCE_ID`, `COUNTY_BORDER_LAYER_ID`,
  `COUNTY_BORDER_COLOR`).
- Produces: a new county-fill map effect that later tasks (none in this
  plan) would build on if the fill needs further behavior.

- [ ] **Step 1: Replace the whole file**

```svelte
<!-- src/routes/MonitorsTab.svelte -->
<script lang="ts">
	import { onMount } from "svelte";
	import { endOfMonth, format, startOfMonth } from "date-fns";
	import { MapShell, mapManager, MonitorsMapIntegration } from "@sjvair/monitor-map";
	import Calendar from "$lib/components/Calendar.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { type Bounds, unionBounds } from "$lib/monitors/region-bounds";
	import { getTabPreferences, setTabPreferences } from "$lib/preferences";
	import {
		decodeCounty,
		decodeMonth,
		decodePollutant,
		decodeYear,
		encodeCounty,
		encodeMonth,
		encodePollutant,
		encodeYear,
		type MonitorsPollutantParam
	} from "$lib/url-state";
	import { route, searchParams } from "../router";
	import { monitorsTabManager } from "./monitors/monitors-tab.svelte";

	const manager = monitorsTabManager;
	const mapIntegration = new MonitorsMapIntegration(manager);

	// Sentinel value for the county Select's "All counties" item — bits-ui's Select
	// doesn't accept an empty string as an item value, so a real county id can never
	// collide with this.
	const ALL_COUNTIES_VALUE = "all";

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

	function asString(value: string | number | boolean | undefined): string | undefined {
		return typeof value === "string" ? value : undefined;
	}

	onMount(async () => {
		await manager.init();

		const prefs = getTabPreferences("monitors");
		const urlYear = decodeYear(asString(route.search.year));
		const urlMonth = decodeMonth(asString(route.search.month));
		const urlPollutant = decodePollutant(asString(route.search.pollutant));
		const urlCounty = decodeCounty(asString(route.search.county));

		const defaults = currentYearMonth();
		const year = urlYear ?? prefs.month?.year ?? defaults.year;
		const month = urlMonth ?? prefs.month?.month ?? defaults.month;
		const pollutant = urlPollutant ?? "pm25";

		manager.dateRange = monthRange(year, month);
		manager.pollutant = pollutant;
		manager.selectedCountyId = urlCounty;

		if (!urlYear) {
			searchParams.set("year", encodeYear(year), { replace: true });
		}
		if (!urlMonth) {
			searchParams.set("month", encodeMonth(month), { replace: true });
		}
		if (!urlPollutant) {
			searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		}

		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
		]);
	});

	async function handleCountyChange(value: string | undefined) {
		const regionId = value && value !== ALL_COUNTIES_VALUE ? value : null;
		manager.selectedCountyId = regionId;
		searchParams.set("county", regionId ? encodeCounty(regionId) : "", { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
		]);
	}

	async function handlePollutantChange(pollutant: MonitorsPollutantParam) {
		manager.pollutant = pollutant;
		searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
		]);
	}

	async function handleYearMonthChange(year: number, month: number) {
		const nextRange = monthRange(year, month);
		manager.dateRange = nextRange;
		searchParams.set("year", encodeYear(year), { replace: true });
		searchParams.set("month", encodeMonth(month), { replace: true });
		setTabPreferences("monitors", { month: { year, month } });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
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

	let selectedCountyName = $derived(
		manager.counties?.find((county) => county.id === manager.selectedCountyId)?.name ??
			"All counties"
	);

	// Zod's tuple inference types `RegionBoundary.bbox` as
	// `[number, number, number, number, ...unknown[]]` rather than a clean
	// 4-tuple, even though the schema (and the server) always sends exactly
	// 4 numbers. Also, reading it off `manager.counties` (a `$state` array)
	// hands back a Svelte reactive Proxy wrapping the array, not a plain
	// array — MapLibre's bounds parsing doesn't handle that correctly, so
	// `$state.snapshot()` unwraps it into a real array before we hand it off.
	function toBounds(bbox: unknown): Bounds {
		return $state.snapshot(bbox) as Bounds;
	}

	// Pan/zoom the map to the selected county's bounds, or back out to cover
	// every county when none is selected. Re-runs whenever the selection or
	// the county list changes, and also once the map itself becomes ready
	// (mapManager.map is reactive), so it self-corrects if this effect ran
	// before the map finished initializing.
	$effect(() => {
		if (!mapManager.map || !manager.counties) return;

		if (manager.selectedCountyId) {
			const region = manager.counties.find((county) => county.id === manager.selectedCountyId);
			if (region?.boundary?.bbox) {
				mapManager.map.fitBounds(toBounds(region.boundary.bbox), { padding: 40 });
			}
			return;
		}

		const allBounds = manager.counties
			.map((county) => county.boundary?.bbox)
			.filter((bbox) => bbox != null)
			.map(toBounds);
		const bounds = unionBounds(allBounds);
		if (bounds) {
			mapManager.map.fitBounds(bounds, { padding: 40 });
		}
	});

	const COUNTY_FILL_SOURCE_ID = "county-fill";
	const COUNTY_FILL_LAYER_ID = "county-fill-polygons";

	// Fill each county with a semi-transparent version of its monthly
	// average's level color — every county when none is selected, only the
	// selected one otherwise (manager.countyFillColors already reflects
	// that scoping, computed in MonitorsTabManager.refreshCountyFill()).
	$effect(() => {
		if (!mapManager.map || !manager.counties) return;

		if (!mapManager.map.getSource(COUNTY_FILL_SOURCE_ID)) {
			mapManager.map.addSource(COUNTY_FILL_SOURCE_ID, {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			mapManager.map.addLayer({
				id: COUNTY_FILL_LAYER_ID,
				type: "fill",
				source: COUNTY_FILL_SOURCE_ID,
				paint: {
					"fill-color": ["get", "color"],
					"fill-opacity": 0.35
				}
			});
		}

		const counties = manager.counties;
		const colors = manager.countyFillColors;
		const entries = colors ? Array.from(colors.entries()) : [];
		const features = entries.flatMap(([regionId, color]) => {
			const county = counties.find((c) => c.id === regionId);
			if (!county?.boundary?.geometry) return [];
			return [
				{
					type: "Feature" as const,
					properties: { color },
					geometry: $state.snapshot(county.boundary.geometry)
				}
			];
		});

		mapManager.setDataSource(COUNTY_FILL_SOURCE_ID, features);
	});
</script>

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
			value={manager.selectedCountyId ?? ALL_COUNTIES_VALUE}
			onValueChange={handleCountyChange}
		>
			<Select.Trigger class="w-56">{selectedCountyName}</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_COUNTIES_VALUE} label="All counties">All counties</Select.Item>
				{#each manager.counties ?? [] as county (county.id)}
					<Select.Item value={county.id} label={county.name}>{county.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="h-96 shrink-0">
		<MapShell
			integrations={[mapIntegration]}
			ready={manager.initialized}
			panelOpen={false}
			routerEscapeHatch={false}
		/>
	</div>

	{#if manager.calendarDays}
		<div class="self-start">
			<Calendar days={manager.calendarDays} />
		</div>
	{/if}
</div>
```

If Task 1's `Select` export names differ from `Root`/`Trigger`/`Content`/
`Item` (they shouldn't — confirmed already installed and used this way
elsewhere in this file), substitute the actual names.

- [ ] **Step 2: Format**

```bash
npm run format
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: 0 errors. Pay particular attention to:
- `mapManager.map.addLayer({ ..., paint: { "fill-color": ["get", "color"], ... } })`
  — a standard MapLibre GL style-spec data-driven expression; if the
  installed `@maptiler/sdk` types reject the array literal, try
  `"fill-color": ["get", "color"] as const` or consult
  `node_modules/@maptiler/sdk`'s `AddLayerObject`/`FillLayerSpecification`
  paint type before working around it with `any`.
- `manager.dateRange.start.slice(0, 4)` / `.slice(5, 7)` — `dateRange.start`
  is always a `yyyy-MM-dd` string produced by `monthRange()`, so this is
  safe, but confirm `manager.dateRange.start` is never empty at the point
  `selectedYear`/`selectedMonth` are read (it starts as `""` per
  `MonitorsTabManager`'s field default, before `onMount` sets it — `Number("")`
  is `0`, so `selectedYear`/`selectedMonth` would briefly be `0` during
  initial render before `onMount` resolves; this matches the existing
  pattern where `manager.dateRange` starts empty and the UI briefly renders
  with default/empty values before `onMount` populates it — not a new
  problem introduced by this task, but confirm the `Select.Trigger`s don't
  throw when `MONTH_NAMES[selectedMonth - 1]` is `MONTH_NAMES[-1]` (`undefined`)
  during that brief window; if `npm run check` or manual testing shows an
  issue, guard with `MONTH_NAMES[selectedMonth - 1] ?? ""`).

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS (all tests from Tasks 1, 2, 4, plus the pre-existing
`calendar.test.ts`, `county-match.test.ts`, `region-bounds.test.ts`,
`monitor-latest.test.ts` — unaffected by this change)

- [ ] **Step 5: Manual verification in the dev server**

```bash
npm run dev
```

Open the app in a browser at the printed local URL. Confirm:
- The Monitors tab loads with a Year `Select` and Month `Select` showing
  the current year/month, no console errors.
- Changing the Year or Month `Select` updates the URL's `year`/`month`
  params and re-renders the map/calendar for the new month.
- With no county selected, every county on the map shows a semi-transparent
  fill colored by its own monthly average level (a real color, not all the
  same — confirm by picking a month where counties plausibly differ, or by
  checking the network tab shows one `getRegionSummariesMonthly` call per
  county).
- Selecting a specific county: only that county keeps its fill (others lose
  theirs), the map zooms to it, monitor markers narrow to that county, and
  the calendar appears showing the selected month's days.
- Reloading the page with `year`/`month`/`pollutant`/`county` URL params
  present reproduces the same view.
- Navigating to the tab with no URL params at all (clear the URL down to
  just `/`) reopens on the last-selected month (from `localStorage`), not
  necessarily the current month — confirm by picking a different month
  first, then reloading with a bare URL.

If any of these fail, fix the underlying code (manager, component, or
wiring) before proceeding — do not commit a broken manual-verification
result.

- [ ] **Step 6: Commit**

```bash
git add src/routes/MonitorsTab.svelte
git commit -m "Add year/month picker and county-fill choropleth"
```

---

### Task 7: Final check and TODO update

**Files:**
- Modify: `TODO.md`

**Interfaces:** None — this task only updates project status tracking.

- [ ] **Step 1: Run the full verification suite**

```bash
npm run check
npm run test
npm run lint
```

Expected: all three pass with no errors or warnings.

- [ ] **Step 2: Update `TODO.md`**

Read the current `TODO.md`. Update its Monitors tab description (in both
the "Start here" section and the "Done" section's Monitors tab bullet) to
reflect:
- The date-range picker is now a Year/Month picker (current year + 4 prior,
  all 12 months), defaulting to the current month and remembering the
  last-selected month in preferences.
- The map's per-monitor averaging always uses monthly summaries now (no
  more daily/monthly threshold — `summary-resolution.ts` was removed).
- Counties are now filled with a semi-transparent color matching their
  monthly average's level (all counties when none is selected, only the
  selected county otherwise), replacing the blue border outline.
- The calendar is unchanged in behavior, just always scoped to exactly the
  picked month.
- Point at this plan
  (`docs/superpowers/plans/2026-09-16-monitors-tab-month-picker.md`) and its
  spec (`docs/superpowers/specs/2026-09-16-monitors-tab-month-picker-design.md`).
- The map-camera zoom-precision issue (globe projection under-zooming for
  large counties) is still open and unaffected by this change — keep that
  note if already present, don't remove it.

Follow the existing file's style (bold lead-in, indented description,
`Plan:`/`Spec:` file pointers in the "Done" section, as established by
prior entries).

- [ ] **Step 3: Commit**

```bash
git add TODO.md
git commit -m "Update TODO: month picker and county-fill choropleth shipped"
```
