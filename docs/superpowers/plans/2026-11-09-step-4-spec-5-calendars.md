# Step 4 spec 5: the calendars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two calendar widget types (day-colored month calendar and GitHub-style contribution
calendar) for one place and one air-quality pollutant, each day colored by the server's daily
figure, with threshold marks and counts, day-range selection with a summary, and "Open these days
in a chart".

**Architecture:** Pure calendar logic (date grids in `$lib/format`, day states, counts, selection)
sits in `src/lib/calendars/`, tested without a browser. The data layer gains one optional request
field (`dailyFigure`, the summary field to read) and two point fields (`figure`, `final`), mirroring
how `worstHour` is threaded today. Both widget types share a calendar shell (count line, legend,
selection summary, notes) and differ only in their grid. Everything that needs `@sjvair/sdk`
5.0.0-beta.8 (the metadata's `daily_statistic`, its label, and the open-day rows) is the last task,
gated on the coordinator pinning beta.8.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind v4 theme tokens, Paraglide, zod, Vitest
(unit + browser mode), Playwright + axe, `@date-fns/tz` through `$lib/format`.

**Spec:** `docs/superpowers/specs/2026-11-09-step-4-spec-5-calendars-design.md` (approved
2026-11-09). Read it first; this plan argues from it.

## Global Constraints

- Branch `step-4-spec-5` (from `step-4`); the PR goes into `step-4`. Never merge without the
  user's own yes. No Claude or AI attribution in commits, PRs or docs.
- SDK pin `npm:@jsr/sjvair__sdk@5.0.0-beta.7` until the coordinator pins beta.8 (Task 13 only).
  No SDK workarounds; anything missing goes to the coordinator (`data-dashboard-a2`).
- Metadata is the source of truth: which field colors a day (`scale.daily_statistic`), its label
  (`scale.daily_statistic_label`), levels, colors, tiers, units, precision. No pollutant ids in
  calendar logic. The dashboard never computes a daily figure from hourly data.
- The calendar's rule: the `daily_statistic` field is a number → rated; null → "Not enough data";
  no row → "No data"; `is_final: false` on today → "so far"; `is_final: false` on an earlier day →
  "Not final yet"; a date after today → still to come; a scale with levels but no
  `daily_statistic` → every day unrated, with one note.
- Pacific dates (`YYYY-MM-DD`) everywhere; weeks start on Sunday from `$lib/format`'s constant;
  every date/number formatting helper lives in `$lib/format`, never in a component.
- Paraglide messages for every string, keys matching their text, no concatenation; server labels
  (`daily_statistic_label`, level labels) go into message placeholders as given. Only a missing
  figure label falls back to the dashboard message "Daily value".
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`); level colors from metadata; text
  on level colors through `readableColor`; cells and swatches outlined.
- WCAG 2.2 AA: never meaning by color alone (month cells show label or tier; contribution cells
  show patterns unless the viewer turned them off); every drag has a keyboard alternative;
  reduced motion respected.
- Preferences through the platform adapter (`p.preferences`, per space).
- Initial bundle: 202.1 KB accepted against the 200 KB soft budget. Run `npm run check:budget`
  after every task that touches a descriptor, the registry, Get data or `app.svelte.ts`; report
  growth past +0.5 KB to the user before going on.
- Style: tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- New English strings: a fresh-eyes copy review (Task 12), then every new key and its English
  listed in the PR for the user's approval. `get_data_*` notes: the reason, then the consequence,
  then what to do.
- Every deferral goes into `DEFERRED.md` in the same commit, with why and what triggers
  revisiting it. Re-read a doc right before editing it (other sessions edit docs here).
- Known flaky tests (in `DEFERRED.md`): note, don't chase, if one fails under load and passes
  alone.

## Review Focus

1. **Daylight-saving and year boundaries in the grids:** a range across 2026-11-01 (25-hour day)
   or 2026-03-08 (23-hour day), and across Dec 31 → Jan 1, must give one cell per Pacific date,
   Sunday-first weeks and correct month labels (Task 1 tests both changes and a year boundary,
   run under `test:unit:tz`).
2. **A viewer in another time zone at 11 pm–1 am Pacific:** "today" is the Pacific date, never
   the browser's (Task 3 test with `today` from `todayPacific(now)` at 2026-11-10T07:30Z, which is
   Nov 9 in Pacific).
3. **A rolling range moving on its own** ("This month" on the 1st) with a stored selection from
   last month: no selection shown, no error, nothing saved (Task 4 test for `visibleSelection`).
4. **A stored threshold key the scale doesn't have, or a pollutant whose scale has no levels:**
   no marks, the missing-level note, no crash (Task 7 browser test).
5. **Clicking or dragging on future days, outside the range, or on the padding cells:** never
   selectable; a drag that ends on one clamps to the last selectable day (Task 4 test for
   `clampSelectable`; Task 8 browser test drags past today).

---

### Task 1: Calendar date helpers in `$lib/format`

**Files:**
- Create: `src/lib/format/calendar.ts`
- Test: `src/lib/format/calendar.test.ts`
- Modify: `src/lib/format/index.ts` (re-export)

**Interfaces:**
- Consumes: `toKey`, `parseDateKey`, `pacificDay`, `startOfPacificWeek` from `$lib/format`; the
  week-start constant already there.
- Produces:
  - `addDays(date: string, n: number): string`
  - `daysInclusive(start: string, end: string): number`
  - `dayOfWeek(date: string): number` (0 = Sunday)
  - `monthStarts(start: string, end: string): string[]` (first-of-month keys covering the range)
  - `monthGrid(month: string): (string | null)[][]` (weeks as rows, Sunday first, `null` outside
    the month; `month` is a first-of-month key)
  - `weekColumns(start: string, end: string): (string | null)[][]` (one column per week from the
    Sunday on or before `start` to the Saturday on or after `end`; `null` outside `[start, end]`)
  - `weekColumnMonthLabels(columns: (string | null)[][]): (string | null)[]` (a first-of-month
    key on the column where a month's first in-range day falls, else `null`; the first column
    always carries its month)

- [ ] **Step 1: Write the failing tests**

```ts
describe("calendar date helpers", () => {
	it("adds days across the fall-back change", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
		expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
	});
	it("counts days inclusive", () => {
		expect(daysInclusive("2026-11-01", "2026-11-30")).toBe(30);
		expect(daysInclusive("2026-11-09", "2026-11-09")).toBe(1);
	});
	it("builds November 2026 with Sunday first", () => {
		const g = monthGrid("2026-11-01");
		expect(g[0]).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
		expect(g.at(-1)).toEqual(["2026-11-29", "2026-11-30", null, null, null, null, null]);
		expect(g.length).toBe(5);
	});
	it("pads October 2026 (starts on a Thursday)", () => {
		expect(monthGrid("2026-10-01")[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
	});
	it("builds week columns across a year boundary", () => {
		const cols = weekColumns("2026-12-29", "2027-01-05");
		expect(cols[0]).toEqual([null, null, "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
		expect(cols[1][0]).toBe("2027-01-03");
		expect(cols[1][3]).toBe(null); // Jan 6 is after the end
		expect(weekColumnMonthLabels(cols)).toEqual(["2026-12-01", "2027-01-01"]);
	});
	it("lists month starts", () => {
		expect(monthStarts("2026-10-15", "2026-12-02")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
	});
});
```

(`weekColumnMonthLabels`: a column whose first in-range day of a new month is in it gets that
month; when two months start within one column, the later one wins.)

- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/format/calendar.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** the functions in `src/lib/format/calendar.ts` with date-key arithmetic
  through `pacificDay`/`toKey` (never `Date` local fields), and re-export from `index.ts`.
- [ ] **Step 4: Run** the test, then `npm run test:unit:tz` — PASS both.
- [ ] **Step 5: Commit** `feat: calendar date helpers in the format module`

### Task 2: The daily figure in the data layer

**Files:**
- Modify: `src/lib/data/types.ts` (`SeriesPoint`, `QueryInput`)
- Modify: `src/lib/data/query/key.ts`, `src/lib/data/query/client.ts`
- Modify: `src/lib/data/adapters/registry.ts` (`AdapterRequest`)
- Modify: `src/lib/data/adapters/air-quality.ts`, `src/lib/data/adapters/air-quality-fetch.ts`
- Modify: `src/lib/data/metadata.ts` (`MetadataSource.dailyFigure`; web impl returns `null` until
  Task 13), the memory/test metadata sources under `src/lib/data/testing/` and wherever
  `withCatalog` wraps a source
- Test: `src/lib/data/adapters/air-quality.test.ts`, `src/lib/data/query/key.test.ts`,
  `src/lib/data/metadata.test.ts`

**Interfaces:**
- Produces:
  - `SeriesPoint.figure?: number | null` (the `dailyFigure` field's value; `null` when the row
    has it null; absent when not asked)
  - `SeriesPoint.final?: boolean` (the row's `is_final`; absent when the row has none)
  - `QueryInput.dailyFigure?: string` and `AdapterRequest.dailyFigure?: string` (a summary field
    name; honored only at resolution `"day"` by the air-quality adapter; part of the cache key
    when set)
  - `type DailyFigure = { field: string; label: string | null }`
  - `MetadataSource.dailyFigure(entryType: string, signal?: AbortSignal): Promise<DailyFigure | null>`

- [ ] **Step 1: Write the failing tests**
  - key: `queryKey` differs for the same input with and without `dailyFigure: "mean_24h"`, and
    is unchanged when it's absent (existing keys stay stable).
  - adapter (monitor and region-bulk paths, daily): fixture rows with
    `{ mean: 12, mean_24h: 11.5, is_final: true }`, `{ mean: 5, mean_24h: null, is_final: true }`,
    `{ mean: 9, mean_24h: 9.4, is_final: false }` and a row without `mean_24h` give points with
    `figure` 11.5, `null`, 9.4 and `null` and `final` `true`, `true`, `false`, `undefined` when
    asked with `dailyFigure: "mean_24h"`; without `dailyFigure` the points have no `figure` key.
    `partial` keeps its current meaning.
  - metadata: the memory source returns the fixture's `{ field: "max_1h", label: "Highest 1-hour
    average" }` for `o3` and `null` for an entry type without one; the web source returns `null`
    (until Task 13).
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/data` — the new tests FAIL.
- [ ] **Step 3: Implement.** Thread `dailyFigure` like `worstHour` (input → key part → client
  `Choice` → `AdapterRequest`). In `air-quality-fetch.ts`, give `toPoints` an option
  `figure?: string` that reads `(row as Record<string, unknown>)[figure]` (a finite number, else
  `null`) into `figure`, and `row.is_final` (when boolean) into `final`, on both the single and
  bulk paths. Add `is_final?: boolean` to its `SummaryRow`. Test metadata fixtures gain an optional
  `dailyFigure` per entry type.
- [ ] **Step 4: Run** `npm run test:unit` and `npm run test:unit:tz` — PASS.
- [ ] **Step 5: Commit** `feat: data layer reads a daily figure and is_final when asked`

### Task 3: Day states, counts and the selection summary

**Files:**
- Create: `src/lib/calendars/day-state.ts`, `src/lib/calendars/summary.ts`
- Test: `src/lib/calendars/day-state.test.ts`, `src/lib/calendars/summary.test.ts`
- Modify: `package.json` `test:unit:tz` paths (add `src/lib/calendars`)

**Interfaces:**
- Consumes: `SeriesPoint` (`figure`, `final`), `DailyFigure`, `Level`, `levelFor`, Task 1 helpers.
- Produces:
  - `type DayKind = "rated" | "thin" | "none" | "today" | "pending" | "future" | "unrated"`
    (`thin` = not enough data; `pending` = not final yet; `unrated` = the scale has no
    `daily_statistic`)
  - `type DayState = { date: string; kind: DayKind; value: number | null; level: Level | null }`
  - `dayStates(args: { points: SeriesPoint[]; dates: string[]; today: string; figure: DailyFigure | null; levels: Level[] }): Map<string, DayState>`
    — `points` are keyed by their Pacific date (`toKey` of `t`); `dates` are the cells to fill.
  - `ratedForCount(s: DayState): boolean` (rated, or today with a value)
  - `thresholdCount(states: DayState[], level: Level): { at: number; rated: number }`
  - `type SelectionSummary = { start: string; end: string; days: number; unrated: number; average: number | null; worst: DayState | null; atOrAbove: number | null }`
  - `selectionSummary(states: DayState[], level: Level | null): SelectionSummary` (states already
    limited to the selection, in date order)

- [ ] **Step 1: Write the failing tests** (fixture levels: Good 0, Moderate 9.1 tier 1, USG 35.5
  tier 2; figure `{ field: "mean_24h", label: "24-hour average" }`; today `"2026-11-09"`)
  - rated: figure 31.9, final → `{ kind: "rated", value: 31.9, level.key: "moderate" }`; 9.1 is
    Moderate, 9.09 Good (half-open).
  - thin: figure `null`, final → `kind: "thin"`, `value: null`.
  - none: no point for a past date → `"none"`.
  - today: today's point, `final: false`, figure 19.9 → `"today"`, Moderate; today with no point
    → `"today"`, `value: null`.
  - pending: `"2026-11-08"`, `final: false`, figure 19.5 → `"pending"`, level Moderate.
  - future: `"2026-11-10"` → `"future"` even when a point exists.
  - unrated: `figure: null` (no `daily_statistic`) → every past day `"unrated"`, today `"today"`
    with `value: null`, future `"future"`.
  - Pacific today: `today = todayPacific(new Date("2026-11-10T07:30:00Z"))` is `"2026-11-09"`.
  - `thresholdCount` over [rated Moderate, rated Good, thin, today Moderate, none] at Moderate
    → `{ at: 2, rated: 3 }`.
  - `selectionSummary` over Nov 5–8 fixture (21.7, 31.9, 28.8, 19.5) with Moderate →
    `{ days: 4, unrated: 0, average: 25.5, worst.date: "2026-11-06", atOrAbove: 4 }`; with one
    `thin` day: `unrated: 1`, average over the rest; a tie on worst → the earlier date; no
    threshold → `atOrAbove: null`; all unrated → `average: null, worst: null`.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/calendars` — FAIL.
- [ ] **Step 3: Implement** both modules (average rounded only at display; `worst` by value).
- [ ] **Step 4: Run** `npm run test:unit` and `npm run test:unit:tz` — PASS.
- [ ] **Step 5: Commit** `feat: calendar day states, threshold counts and selection summary`

### Task 4: The selection model and keyboard moves

**Files:**
- Create: `src/lib/calendars/selection.ts`
- Test: `src/lib/calendars/selection.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `TimeSubRange` (`$lib/data/schema`).
- Produces:
  - `type Layout = "month" | "weeks"`
  - `type Selectable = { first: string; last: string }` (range start to `min(range end, today)`)
  - `clampSelectable(date: string, s: Selectable): string`
  - `spanOf(anchor: string, to: string): { start: string; end: string }` (ordered)
  - `moveFocus(date: string, key: string, layout: Layout, s: Selectable): string` (keys:
    ArrowLeft/Right/Up/Down, Home, End, PageUp, PageDown; month: Left/Right ±1, Up/Down ±7;
    weeks: Up/Down ±1, Left/Right ±7; Home/End the week's Sunday/Saturday; PageUp/PageDown ±1
    month, same day-of-month clamped to the month's length; always clamped to `s`)
  - `visibleSelection(sel: TimeSubRange | undefined, s: Selectable, rangeEnd: string): { start: string; end: string } | null`
    (date-only sub-ranges clipped to `[s.first, rangeEnd]`; `null` when none of it is inside or
    `sel` holds date-times)
  - `fitsRange(sel: TimeSubRange, first: string, last: string): boolean`

- [ ] **Step 1: Write the failing tests**: `spanOf("2026-11-08", "2026-11-05")` →
  `{ start: "2026-11-05", end: "2026-11-08" }`; month ArrowDown from `"2026-11-25"` with last
  `"2026-11-09"` → `"2026-11-09"`; weeks ArrowRight from `"2026-11-01"` → `"2026-11-08"`; PageDown
  from `"2026-10-31"` → `"2026-11-30"` clamped to last; Home from `"2026-11-05"` →
  `"2026-11-01"`; `clampSelectable("2026-11-20", s)` → s.last; `visibleSelection` of Oct 3–8 with
  a "this month" range starting Nov 1 → `null`; of Oct 30–Nov 2 → `{ start: "2026-11-01", end:
  "2026-11-02" }`; date-time sub-range → `null`.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/calendars/selection.test.ts` — FAIL.
- [ ] **Step 3: Implement** with Task 1 helpers only.
- [ ] **Step 4: Run** — PASS (also under `test:unit:tz`).
- [ ] **Step 5: Commit** `feat: calendar selection model and keyboard moves`

### Task 5: The two types, their input, the menu environment, and the place spots

**Files:**
- Create: `src/lib/calendars/input.ts` (+ `input.test.ts`)
- Create: `src/lib/widgets/calendars/month/index.ts`, `src/lib/widgets/calendars/contribution/index.ts`
  (descriptors; `module.ts` files point at a placeholder component until Tasks 8 and 9)
- Modify: `src/lib/widgets/registry.ts` (`defaultRange`, `WidgetMenuEnv`, `menu` signature)
- Modify: every existing descriptor's `menu` (signature only), `src/lib/components/dashboard/WidgetFrame.svelte`
  (passes `{ app, widget: () => widget }`)
- Modify: `src/lib/store/app.svelte.ts` (register both types after the Chart)
- Modify: `src/lib/sharing/points.ts` (`lookupInput`), `src/lib/places/PlacePickerDialog.svelte` (`regionOf`)
- Test: `src/lib/widgets/registry.test.ts`, `src/lib/sharing/points.test.ts` (or its existing test file), a place-picker browser test if one covers `regionOf`

**Interfaces:**
- Consumes: `mainLayer` (`widgets/shared/input.ts`), `QueryInput`.
- Produces:
  - `MONTH_CALENDAR_TYPE = "calendar-month"`, `CONTRIBUTION_CALENDAR_TYPE = "calendar-contribution"`
  - `isCalendarType(type: string): boolean` (in `src/lib/calendars/input.ts`, light, no data imports)
  - `calendarInput(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): QueryInput | null`
    — main layer, `dateRange` (or the type default), `pin: "day"`, no `timeSubRange`, no
    `worstHour`; `null` without a place.
  - `WidgetType.defaultRange?: DateRangeSpec`
  - `type WidgetMenuEnv = { app: AppContext; widget: () => WidgetInstance | null }`;
    `WidgetType.menu: (ctx: MenuContext, env: WidgetMenuEnv) => MenuItem[]` (type-only import of
    `AppContext`)
  - Descriptor values (spec "Defaults", "Spans"): month `defaultRange: { kind: "to-date", unit:
    "month" }`, `span: { minDays: 1, maxDays: 366 }`, `defaultSize: { w: 4, h: 6 }`; contribution
    `defaultRange: { kind: "trailing", amount: 12, unit: "month" }`, `span: { minDays: 7,
    maxDays: 731 }`, `defaultSize: { w: 12, h: 3 }`, `minSize.w: 3`. Both: `time: "range"`,
    `resolution: "day"`, `thresholds: true`, `analyzable: true`, `downloadable: true`,
    `accepts: { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces: 1, onlyPollutant: true }`
    (the new `accepts.onlyPollutant` is used in Task 6), lucide icons like the other types
    (`calendar-days`, `calendar-range`), labels `widget_calendar_month_title` /
    `widget_calendar_contribution_title`.

- [ ] **Step 1: Write the failing tests**: `calendarInput` gives `pin: "day"`, drops a draft's
  `timeSubRange` and never sets `worstHour`; `lookupInput` for a calendar with a point place uses
  the calendar input (the region lookup is asked with `pin: "day"`); `regionOf` likewise; both
  types are in `dataTypes()` after registration with their spans and default ranges.
- [ ] **Step 2: Run** the tests — FAIL.
- [ ] **Step 3: Implement.** In `lookupInput` and `regionOf`, branch on `isCalendarType(type)`
  before the Chart path. Change `menu` to the two-argument form everywhere (existing types ignore
  `env`).
- [ ] **Step 4: Run** `npm run check`, `npm run test:unit`, the touched browser tests, and
  `npm run build && npm run check:budget` (report the size).
- [ ] **Step 5: Commit** `feat: register the two calendar types; calendar input in the place spots`

### Task 6: Get data for calendars

**Files:**
- Modify: `src/lib/get-data/offer.ts` (`TypeBlock` gains `"pollutant"`; `typeBlock` checks
  `accepts.onlyPollutant`), `src/lib/get-data/ShowAs.svelte` (its reason text)
- Modify: `src/lib/get-data/GetDataView.svelte` `setType` (range → range: default range and the
  selection), `src/lib/get-data/now.ts` (`NowDropped` gains `"selection"`; `fromNowDraft` uses
  `type.defaultRange ?? DEFAULT_RANGE`)
- Modify: `src/lib/widgets/registry.ts` (`accepts.onlyPollutant?: boolean`)
- Modify: `src/lib/data/csv.ts` callers only if `saveDataCsv` must learn the draft's type (Task 11 does the CSV)
- Test: `src/lib/get-data/offer.test.ts`, `src/lib/get-data/now.test.ts`,
  `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Consumes: Task 5 descriptors and `isCalendarType`.
- Produces: `typeBlock(...)` returning `"pollutant"` when `accepts.onlyPollutant` and the data
  isn't exactly one layer whose catalog kind is `"pollutant"`; message
  `get_data_show_as_needs_one_pollutant` (reason → consequence → what to do).

- [ ] **Step 1: Write the failing tests**
  - `typeBlock(monthType, { layers: [pm25, humidity] })` → `"pollutant"`; a temperature-only
    layer → `"pollutant"`; two places → `"places"`; a weather layer → `"dataset"`; a 400-day
    range → `"span"` for the month calendar but not the contribution calendar; PM2.5 at one
    place → `null`.
  - Switching Chart → month calendar keeps a Chart's non-default range when the span allows; a
    draft still on the Chart's default range (`DEFAULT_RANGE`) gets `{ kind: "to-date", unit:
    "month" }`; a stored threshold is kept both ways.
  - Switching month calendar (with `timeSubRange`) → Chart deletes `timeSubRange` and shows the
    "left out" note naming the selected days; calendar → calendar keeps it.
  - `fromNowDraft(currentTileDraft, contributionType)` gives `dateRange: { kind: "trailing",
    amount: 12, unit: "month" }`, the same place, pollutant and threshold.
  - A month calendar draft's date range changed in Get data so the stored selection no longer
    fits (`fitsRange` false) drops `timeSubRange` in the same edit.
- [ ] **Step 2: Run** the unit and browser tests — FAIL.
- [ ] **Step 3: Implement** (the "left out" note reuses `noteConversion` with the new dropped kind).
- [ ] **Step 4: Run** `npm run test:unit`, `npx vitest run --project browser src/lib/get-data`,
  `npm run check:budget` — PASS; report the size.
- [ ] **Step 5: Commit** `feat: Get data offers the calendars with their own block reason and defaults`

### Task 7: The calendar shell (shared by both types)

**Files:**
- Create: `src/lib/widgets/calendars/shared/calendar-data.svelte.ts` (the widget's state: wraps
  `DataWidget` with `calendarInput` plus `dailyFigure`, the figure from
  `getMetadata().dailyFigure`, `dayStates`, the threshold via `resolveThreshold`)
- Create: `src/lib/widgets/calendars/shared/CalendarShell.svelte` (count line, grid slot, summary
  line, legend, notes, one polite live region)
- Create: `src/lib/widgets/calendars/shared/CalendarLegend.svelte`
- Test: `src/lib/widgets/calendars/shared/calendar-shell.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: Tasks 2–4; `DataWidget` (it must accept an input builder: add a constructor option
  `input?: (data, catalog) => QueryInput | null`, defaulting to today's `chartInput`); `LevelChip`;
  `WidgetState`.
- Produces:
  - `class CalendarData { states: Map<string, DayState>; figure: DailyFigure | null; threshold: Level | null; thresholdMissing: boolean; range: { first: string; last: string }; today: string; selectable: Selectable; shown: QueryState; levels: Level[] }`
    constructed as `new CalendarData(() => widget)`
  - `figureName(figure: DailyFigure | null): string` (the server label, else `m.calendar_daily_value()`)
  - `CalendarShell` props: `{ data: CalendarData; widget: WidgetInstance; selection: { start: string; end: string } | null; grid: Snippet; patterns?: boolean }`

- [ ] **Step 1: Write the failing browser tests** (fixture data through the test harness)
  - count line "▲ 36 of 39 rated days at or above Moderate" (message with `at`, `rated`,
    `level` placeholders, plural-aware); a second count "8 of 9 in November so far" only when the
    range spans several months and includes today's month.
  - no threshold → no count line; a stored key the scale lacks → no marks and
    `m.calendar_level_missing()`; a pollutant with no levels → the no-levels note.
  - `figure: null` → `m.calendar_figure_unknown()` note once, every past day unrated.
  - summary line for a Nov 5–8 selection: "Nov 5 – 8 · 4 days · {figure label}: average 25.5
    µg/m³ · worst day Fri, Nov 6, 31.9 µg/m³" + Moderate chip + "4 days at or above Moderate";
    "2 days not rated" when two are thin; announced through the live region after the selection
    settles; "Esc clears" hint.
  - legend: a swatch per scale level up to one above the highest shown, "Not enough data", "No
    data", and the threshold mark when a threshold is set.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/widgets/calendars/shared` — FAIL.
- [ ] **Step 3: Implement**; formatting through `$lib/format` (`formatDateRange`,
  `formatWeekdayDate`, `formatValue`, `formatNumber`); live-region text set after pointer-up or
  keyboard selection, not on every drag step.
- [ ] **Step 4: Run** — PASS; `npm run check`.
- [ ] **Step 5: Commit** `feat: calendar shell: counts, legend, selection summary and notes`

### Task 8: The day-colored (month) calendar

**Files:**
- Create: `src/lib/widgets/calendars/month/MonthCalendarWidget.svelte`, `MonthGrid.svelte`,
  `src/lib/widgets/calendars/shared/DayGrid.svelte` (the shared `role="grid"` keyboard and pointer
  handling: roving tabindex, `moveFocus`, click / Shift-click / drag, Escape, writes)
- Create: `src/lib/widgets/calendars/shared/write-selection.ts`
- Modify: `src/lib/widgets/calendars/month/module.ts`
- Test: `src/lib/widgets/calendars/month/month-calendar.browser.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 7; `applyChange` through the app context (`op: "setWidgetData"`).
- Produces:
  - `writeSelection(app: AppContext, widget: WidgetInstance, sel: { start: string; end: string } | null): void`
    (one `setWidgetData` change: `timeSubRange` set or removed; read-only views keep the selection
    in component state instead and never call it)
  - `DayGrid` props: `{ layout: Layout; rows: (string | null)[][]; data: CalendarData; selection; onselect(sel | null): void; cell: Snippet<[DayState, { focused: boolean; selected: boolean }]>; label: string }`

- [ ] **Step 1: Write the failing browser tests**
  - November 2026 with fixtures: Nov 6 cell shows "6", "31.9", "Moderate", has the level color,
    an outline, and `readableColor` text; its accessible name is "Friday, November 6: 24-hour
    average 31.9 µg/m³, Moderate" (+ ", at or above Moderate" with the threshold, + ", selected").
  - states: thin → stripes and "Not enough data"; none → "—" and "No data"; today → dashed
    outline and "Moderate · so far"; pending → "Not final yet"; future → day number only.
  - at a small size the label is replaced by the tier number (`tier` from metadata).
  - "This month" draws all 30 days; Nov 10–30 future; Oct and Nov side by side for a custom
    range, stacked at phone width.
  - pointer: click Nov 5 then Shift-click Nov 8 → one `setWidgetData` with `timeSubRange:
    { start: "2026-11-05", end: "2026-11-08" }`; drag Nov 5 → Nov 20 clamps to today; clicking the
    only selected day clears; Escape clears; one undo step per gesture.
  - keyboard: Tab focuses one cell; arrows, Shift+arrows, Home/End, Page Up/Down, Space/Enter;
    focus ring distinct from the selection ring.
  - read-only view: selection shows, no change is written.
  - reduced motion: no transition classes active.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/widgets/calendars/month` — FAIL.
- [ ] **Step 3: Implement**; the selection ring, focus ring, stripes and outlines from theme
  tokens (add tokens in `src/app.css` if missing, both modes).
- [ ] **Step 4: Run** — PASS; `npm run check`; `npm run check:budget`.
- [ ] **Step 5: Commit** `feat: the day-colored month calendar`

### Task 9: The contribution calendar and "Show patterns"

**Files:**
- Create: `src/lib/widgets/calendars/contribution/ContributionCalendarWidget.svelte`, `WeekGrid.svelte`
- Create: `src/lib/widgets/calendars/shared/patterns.ts` (tier → CSS background pattern in the
  readable ink) and `src/lib/widgets/calendars/shared/patterns-pref.svelte.ts`
- Modify: `src/lib/widgets/calendars/contribution/module.ts`
- Test: `src/lib/widgets/calendars/contribution/contribution-calendar.browser.test.ts`,
  `src/lib/widgets/calendars/shared/patterns.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 7, 8 (`DayGrid` with `layout: "weeks"`), platform preferences.
- Produces:
  - `PATTERNS_KEY = "calendarPatterns"`; `patternsOn(): boolean` (reactive, default `true`, one
    shared state per tab loaded from `p.preferences.get(space, PATTERNS_KEY)`) and
    `setPatternsOn(on: boolean): Promise<void>`
  - `tierPattern(tier: number | null, ink: string): string | null` (tier 0 / null → `null`;
    1 dots on a 5 px grid; 2 diagonal stripes; 3 cross-hatch; 4 horizontal lines)

- [ ] **Step 1: Write the failing tests**
  - `tierPattern(1, "0,0,0")` contains `5px 5px`; tier 0 → `null`.
  - "Last 12 months" ending Mon 2026-11-09: 53 week columns, Sunday on top, month labels from
    `weekColumnMonthLabels`, weekday labels Sun/Tue/Thu/Sat; opens scrolled to the latest week.
  - a Moderate cell has the level color and, with patterns on, the dot pattern; the "Show
    patterns" switch in the legend row turns patterns off for this and another contribution
    calendar on the page, and stores `false` under `calendarPatterns`; a fresh space reads on.
  - corner triangle on days at or above the threshold; today dashed; thin striped; none grey.
  - keyboard: ArrowRight moves a week, ArrowDown a day; Shift+ArrowRight extends by a week.
  - the switch is a labeled switch, reachable by keyboard; its state is announced.
- [ ] **Step 2: Run** the tests — FAIL.
- [ ] **Step 3: Implement**; the switch sits in the legend row (spec allows a visible place other
  than the menu); cells about 12–16 px, sized from the widget's width.
- [ ] **Step 4: Run** — PASS; `npm run check`; `npm run check:budget`.
- [ ] **Step 5: Commit** `feat: the contribution calendar with a Show patterns switch`

### Task 10: "Open these days in a chart"

**Files:**
- Create: `src/lib/widgets/calendars/shared/open-in-chart.ts`
- Modify: both calendar descriptors' `menu`
- Test: `src/lib/widgets/calendars/shared/open-in-chart.test.ts`, a case in the month browser test

**Interfaces:**
- Consumes: `WidgetMenuEnv` (Task 5), `copyPlacement` (`src/lib/layout/windowing.ts`), `CHART_TYPE`.
- Produces: `openDaysInChart(app: AppContext, widgetId: string): void` — adds one Chart widget
  `{ type: CHART_TYPE, data: { dateRange: { kind: "custom", start, end }, layers: [the calendar's
  layer without resolution] }, thresholds: the calendar's }`, placed with `copyPlacement`, in one
  `addWidget` change. The descriptor's item (`calendar_open_in_chart`, group like the type items
  of other widgets) is present only when `env.widget()?.data.timeSubRange` holds dates, and its
  `run` dynamically imports `open-in-chart.ts` so the descriptor stays light.

- [ ] **Step 1: Write the failing tests**: with `timeSubRange` Nov 5–8 the menu lists the item and
  running it adds a Chart with `dateRange: { kind: "custom", start: "2026-11-05", end:
  "2026-11-08" }`, the same layer and `thresholds`, no `timeSubRange`, `resolution` absent; one
  undo removes it; without a selection the item is absent; read-only frames don't show it (their
  provider skips type items).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; `npm run check:budget`.
- [ ] **Step 5: Commit** `feat: open a calendar's selected days in a new chart`

### Task 11: The calendars' CSV

**Files:**
- Modify: `src/lib/data/csv.ts` (`downloadDataCsv` and `saveDataCsv` take the widget type;
  `downloadWidgetCsv`/`saveWidgetCsv` pass `widget.type`; for a calendar type they use
  `calendarInput` plus `dailyFigure`, and `toCsv` adds two columns)
- Modify: Get data's draft download call to pass the draft's type
- Test: `src/lib/data/csv.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 7 (`figureName`).
- Produces: daily CSV rows gain the columns `{figure label}` and `m.csv_rated()` ("Rated") with
  values `formatValue`-plain number / `m.csv_rated_yes()` or `m.csv_rated_not_enough()` /
  empty for today ("so far" → `m.csv_rated_so_far()`), only when the points carry `figure`.

- [ ] **Step 1: Write the failing tests**: a calendar CSV for fixtures (`figure` 31.9 final, `null`
  final, 19.9 not final today) has header `…,24-hour average,Rated` and rows `31.9,Yes`,
  `,Not enough data`, `19.9,So far`; a Chart's CSV is unchanged (no new columns).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:unit` — PASS.
- [ ] **Step 5: Commit** `feat: calendar CSV carries the day's figure and whether it was rated`

### Task 12: E2E, accessibility, docs and copy review (before beta.8)

**Files:**
- Create: `e2e/calendars.spec.ts`; Modify: `e2e/summaries-server.ts` (daily fixture rows with
  `mean_24h`, `max_1h`, `is_final`), `e2e/a11y.spec.ts`
- Modify: `ARCHITECTURE.md`, `TODO.md`/`ROADMAP.md` (step 4 sections only), `DEFERRED.md`
- Create: `copy-review.md` in the scratchpad (not committed)

- [ ] **Step 1: Write the E2E tests**: Get data → Show as → each calendar → preview → Add;
  greyed reasons for two places and for a weather layer; a share link with a point place swaps
  to its region for a calendar; select days and "Open these days in a chart"; axe on both
  calendars in light and dark, including a Moderate (yellow) cell. The e2e metadata fixture
  declares `daily_statistic` so cells color (the app reads it only after Task 13; until then
  this spec runs with the fixture metadata source the e2e server already serves — if the web
  metadata can't read it before beta.8, mark the coloring assertions `test.fixme` with a pointer
  to Task 13).
- [ ] **Step 2: Run** `npm run test:e2e` — the new spec passes (or fixme'd as above).
- [ ] **Step 3: Docs** (re-read each file first): `ARCHITECTURE.md` "Widget catalog" (both
  calendars as built, the day's figure and the EPA reason), "Widget-type contract" (`defaultRange`,
  `menu(ctx, env)`, `accepts.onlyPollutant`), "Accessibility" (the "Show patterns" exception);
  step 4 status in `TODO.md`/`ROADMAP.md`; any new deferral in `DEFERRED.md`.
- [ ] **Step 4: Copy review**: a fresh subagent reads every new message where it renders and
  checks voice, the `get_data_*` order, plural forms and placeholder use; apply the findings,
  renaming keys to match their text.
- [ ] **Step 5: Run** `npm run lint && npm run check && npm run test && npm run build && npm run check:build && npm run check:budget`.
- [ ] **Step 6: Commit** `test: calendars e2e and a11y; docs and copy review`

### Task 13: beta.8 (gated: start only when the coordinator says beta.8 is pinned)

**Files:**
- Modify: `src/lib/data/metadata.ts` (web `dailyFigure` reads `scale.daily_statistic` and
  `scale.daily_statistic_label` from `monitors/meta/` through the SDK types)
- Modify: `src/lib/data/adapters/air-quality-fetch.ts` (daily requests with `dailyFigure` use the
  SDK's range-plus-open-days helper for monitors, regions and bulk; names from beta.8)
- Modify: `ARCHITECTURE.md` "Metadata as source of truth" (`averaging_hours`,
  `daily_statistic`, `daily_statistic_label`, `mean_24h`, `max_1h`, `max_8h`, `is_final`, open-day
  rows)
- Test: `src/lib/data/metadata.test.ts`, `src/lib/data/adapters/air-quality.test.ts`

- [ ] **Step 1:** `git fetch`; merge whatever the coordinator's pin commit is (do not change the pin
  yourself). Read the beta.8 SDK names the coordinator sends.
- [ ] **Step 2: Write the failing tests**: the web source maps `daily_statistic: "max_1h"`,
  `daily_statistic_label: "Highest 1-hour average"` to `{ field: "max_1h", label: "Highest 1-hour
  average" }`, a null `daily_statistic` to `null`, a null label to `label: null`; a daily request
  with `dailyFigure` calls the open-days helper once and returns today's row with `final: false`.
- [ ] **Step 3: Implement**; remove any `test.fixme` from Task 12.
- [ ] **Step 4: Stack check** (avoid :40–:50 past the hour): an ozone monitor's month calendar
  colored by `max_1h`, a PM2.5 VOZBox's by `mean_24h`, a day under 18 hours as "Not enough data",
  today "so far", yesterday before 3 am "Not final yet" if the timing allows, CO if any local CO
  exists. Local data is incomplete; rule out downtime before calling a gap a bug. Screenshots to
  the user as images.
- [ ] **Step 5: Full verification**: `npm run lint && npm run check && npm run test && npm run test:e2e && npm run test:e2e:podman && npm run build && npm run check:build && npm run check:budget`.
- [ ] **Step 6: Commit** `feat: calendars read the daily figure, its label and open days (SDK beta.8)`
- [ ] **Step 7: PR** into `step-4` listing every new message key and its English; `gh pr checks`
  after pushing; tell the coordinator the PR number. Merge only on the user's own yes, then check
  every pushed commit landed (`git cherry`).
