# Step 4, spec 1: widget groundwork, Chart, and Data table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two real widget types (Chart, Data table) on a widget frame every later step 4 widget
reuses, with a cache-friendly data layer, the new resolution rule, the worst hour, CSV downloads
on every data widget, and the initial bundle back under 200 KB.

**Architecture:** The data layer (`src/lib/data/`) gains calendar-aligned requests, the worst
hour, place names and retirement, and an idle state; it stays out of the initial bundle (only
lazily loaded widget code imports it). Widget types split into an always-loaded descriptor and a
lazily loaded module (component, title, data). The Chart is uPlot plus Svelte markup for the key
and readout; the Data table is plain markup. One CSV module serves every data widget.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, uPlot 1.6.32 (MIT, new), `@sjvair/sdk`
4.8.0-beta.5, Paraglide, Tailwind v4 tokens, Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-step-4-spec-1-groundwork-chart-table-design.md`
(read it first; this plan argues from it).

**Branch:** `step-4-spec-1` (already exists, with the spec commit), PR into `step-4`.

## Global Constraints

- Resolution rule: ≤ 3 days raw, ≤ 7 days hour, ≤ 365 days day, longer month.
- Worst hour: daily views of ≤ 92 days, single place only; the highest **hourly mean** of the
  Pacific day, with its hour; averages still come from daily summaries.
- Request units: a month for hour and day (and the worst hour's hourly fetch), a year for month,
  quarter, season; one call for year. Past units are their own requests.
- Chart: at most 5 places (`maxPlaces: 5`); Data table at most 10 (`maxPlaces: 10`).
- Level names are the full `label` from the scale; never abbreviated; the level key always shows.
- Default new widget: `{ dataset: "air-quality", entryType: "pm25", place: { kind: "region",
type: "county", code: "06019" } }`, date range `{ kind: "trailing", amount: 30, unit: "day" }`.
- Default widget size about 3 of 12 columns (`defaultSize.w = 3`).
- All UI text through Paraglide (`messages/en.json`); formatting through `$lib/format`; Pacific
  time; weeks start Sunday.
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`); level colors from metadata;
  swatches outlined (`LevelSwatch.svelte`); `readableColor` for text on level colors.
- Browser storage and downloads only through the platform adapter (`platform.files.save` or the
  app's `platform`).
- `src/lib/data/index.ts` (and anything importing the data layer) is imported only from lazily
  loaded code. Menu actions in the initial bundle reach it with dynamic `import()`.
- Browser tests: `animationsSettled(el)` from `src/test/animations.ts`; `page.viewport(1280,
800)` for desktop; formatted times match an optional `" PT"`; time-sensitive unit tests also
  pass under `npm run test:unit:tz`.
- No AI attribution in commits or PRs. Run `npm run format` before each commit.

## Review Focus

1. **DST days.** A Pacific day with 23 or 25 hours (2026-03-08, 2026-11-01): worst hour picks the
   right day and labels the right hour; month units still start at local midnight. (Task 5,
   Task 6.)
2. **A rolling range crossing midnight or a month boundary.** "Last 30 days" on the 1st of a
   month asks for the previous month whole plus the new month, and yesterday's past-month URL is
   identical to the day before's. (Task 4.)
3. **A shared document with junk in it.** More than 5 places on a Chart, an unknown entry type, a
   region code the server doesn't know: the widget shows the right state, never a crash. (Task
   10, Task 12.)
4. **Empty or partial data.** A place with no rows, a range entirely in the future, today's
   partial day: "No data for this range", gaps not lines, a hollow last dot. (Task 10, Task 12.)
5. **A metadata scale missing or with an open top level** (`max: null`): bands still draw to the
   axis top, the key still lists every level. (Task 2, Task 11.)

---

### Task 1: Bump `@sjvair/sdk` to 4.8.0-beta.5

**Files:**

- Modify: `package.json` (`"@sjvair/sdk": "npm:@jsr/sjvair__sdk@4.8.0-beta.5"`),
  `package-lock.json`
- Modify: whatever `npm run check` flags (expected: `MonitorData.grade` is `string | null`;
  monitor type unions include `"cimis"`)

- [ ] **Step 1:** `npm install @sjvair/sdk@npm:@jsr/sjvair__sdk@4.8.0-beta.5`
- [ ] **Step 2:** `npm run check` — fix each type error at its use site (no casts to `any`).
- [ ] **Step 3:** `npm run test` — Expected: all pass.
- [ ] **Step 4:** Commit `chore: bump @sjvair/sdk to 4.8.0-beta.5`.

### Task 2: The resolution rule and levels from the scale

**Files:**

- Modify: `src/lib/data/resolution.ts` (`ladder`), `src/lib/data/resolution.test.ts`
- Modify: `src/lib/data/metadata.ts` (`Level`, `levels()`), `src/lib/data/metadata.test.ts`,
  `src/lib/data/testing/fixtures.ts`, `src/routes/dev/DevData.svelte`

**Interfaces:**

- Produces:
  ```ts
  export type Level = {
  	key: string;
  	label: string;
  	color: string | null;
  	opacity: number | null;
  	tier: number | null;
  	min: number; // a missing min is 0
  	max: number | null; // null = open top
  };
  // MetadataSource.levels(entryType, signal?): Promise<Level[]>  — ordered by min; [] if no scale
  export function levelFor(levels: Level[], value: number): Level | undefined; // in metadata.ts
  ```

- [ ] **Step 1: Failing tests** in `resolution.test.ts`: `ladder` via `chooseResolution` with all
      levels offered: `spanDays` 3 → `"raw"`, 3.01 → `"hour"`, 7 → `"hour"`, 8 → `"day"`, 365 →
      `"day"`, 366 → `"month"`. In `metadata.test.ts`: `levels("pm25")` reads
      `getMonitorsMeta().entries.pm25.scale.levels` (mock the SDK as the file already does) and maps
      `{ key, label, color, opacity, tier, min, max }`; an entry with `scale: null` gives `[]`;
      `levelFor` returns the level whose `[min, max)` holds the value (the top level when
      `max === null`), `undefined` below the first.
- [ ] **Step 2:** `npm run test:unit -- src/lib/data/resolution src/lib/data/metadata` — FAIL.
- [ ] **Step 3:** Change `ladder` (≤ 3 raw, ≤ 7 hour, ≤ 365 day, else month); rewrite `levels()`
      to read `scale` (the old `levels` field is no longer read); add `levelFor`. Update
      `FIXTURE_LEVELS` to the new shape with four PM2.5 levels (Good 0–9, Moderate 9–35.4,
      Unhealthy for Sensitive Groups 35.4–55.4, Unhealthy 55.4–`null`) and DevData's use of
      `Level`.
- [ ] **Step 4:** Tests PASS; `npm run check` clean.
- [ ] **Step 5:** Commit `feat(data): new resolution rule; levels from the scale metadata`.

### Task 3: Place names and retirement in the data layer

**Files:**

- Modify: `src/lib/data/adapters/registry.ts` (`RegionResolver`, `createWebRegionResolver`),
  `src/lib/data/adapters/targets.ts`, `src/lib/data/adapters/air-quality.ts`,
  `src/lib/data/types.ts`, the fake resolvers in tests (`registry.test.ts`,
  `air-quality.test.ts`, `client.test.ts`), `src/lib/data/testing/fixtures.ts`

**Interfaces:**

- Produces:

  ```ts
  // registry.ts
  export type ResolvedRegion = {
  	id: string; // sqid
  	name: string;
  	retired?: { since: string; replacedBy: { type: string; code: string } | null };
  };
  // RegionResolver.resolve(type, code, signal?): Promise<ResolvedRegion | "unsupported" | null>

  // types.ts
  export type PlaceInfo = {
  	place: string; // same key as Series.place
  	name: string;
  	retired?: ResolvedRegion["retired"];
  };
  // QueryData gains: places: PlaceInfo[]  (one per requested place, in request order)
  ```

  Monitor names come from `ctx.metadata.monitors()`; an unknown monitor's name is its id.

- [ ] **Step 1: Failing tests.** `registry.test.ts`: a retired region resolves to
      `{ id, name, retired: { since, replacedBy: { type: "zipcode", code: "93721" } } }` from
      `getRegionsByCode`'s `retired: { since, replaced_by: { type, external_id } }`; a current
      region has no `retired`. `air-quality.test.ts`: `fetch` returns `places` with names for a
      region and a monitor, and carries a region's `retired`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. `resolveRegionKeys` returns `Array<ResolvedRegion | null>`; callers
      use `.id`.
- [ ] **Step 4:** `npm run test:unit -- src/lib/data` PASS; `npm run check` clean.
- [ ] **Step 5:** Commit `feat(data): place names and region retirement in query results`.

### Task 4: Calendar-aligned requests

**Files:**

- Modify: `src/lib/data/chunks.ts`, `src/lib/data/chunks.test.ts`,
  `src/lib/data/adapters/air-quality-fetch.ts`, `src/lib/data/adapters/air-quality.test.ts`

**Interfaces:**

- Produces (in `chunks.ts`):
  ```ts
  export type Unit = { fetchStart: Date; fetchEnd: Date; start: Date; end: Date };
  /** Whole Pacific calendar units overlapping `seg`: `fetch*` is the whole unit, `start`/`end`
   *  the part inside `seg`. Unit: month for raw/hour/day, year for month/quarter/season, one
   *  unit spanning everything for year. */
  export function calendarUnits(seg: Segment): Unit[];
  ```
- `splitChunks` stays only for raw entries (`rawTasks`), which are never cached long.

- [ ] **Step 1: Failing tests.** `chunks.test.ts`: a daily segment 2026-10-06 → 2026-11-05
      (Pacific) gives two units, `fetchStart` 2026-10-01 / `fetchEnd` 2026-11-01 and 2026-11-01 /
      2026-12-01, clipped `start`/`end` equal to the segment's; a monthly segment 2025-03 →
      2026-02 gives two year units; units start at Pacific midnight across 2026-11-01 (DST).
      `air-quality.test.ts` (with the SDK mocked, recording calls):
  - a region "last 30 days" daily query at `now` 2026-11-04T12:00 PT and again at 2026-11-05T12:00
    PT makes the **same** bulk call for October (`start: "2026-10-01", end: "2026-10-31"`);
  - a single-monitor daily query calls `getMonitorSummariesDaily` with `{ year, month }` per month,
    never `{ year }` alone;
  - at `now` 2026-12-01T09:00 PT, "last 30 days" asks for November whole and December;
  - rows outside the clipped range are dropped.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement `calendarUnits`; `bulkSummaryTasks` requests each unit's whole
      `fetchStart..fetchEnd` (inclusive Pacific dates) and filters with `start..end`;
      `pathConfigs` gives `{ year, month }` per month for `day` (and `hour`), `{ year }` per year for
      month/quarter/season, `{}` for year. Keep the existing one-day hourly path (`{ year, month,
day }`) for a segment inside one day (the open hour fill).
- [ ] **Step 4:** `npm run test:unit -- src/lib/data` PASS, and `npm run test:unit:tz` PASS.
- [ ] **Step 5:** Commit `feat(data): request whole calendar months and years so past ones cache`.

### Task 5: The rollup-lag backfill, fixed

Closes `DEFERRED.md` → "The rollup-lag backfill is one level deep and fetched on every poll".

**Files:**

- Modify: `src/lib/data/periods.ts`, `src/lib/data/periods.test.ts`,
  `src/lib/data/adapters/air-quality.ts`, `src/lib/data/adapters/air-quality.test.ts`

- [ ] **Step 1: Failing tests** (`air-quality.test.ts`, SDK mocked):
  - when the coarse (daily) response already has yesterday, no hourly backfill call is made;
  - when it lacks yesterday and the hourly backfill lacks yesterday's last hour, that hour comes from
    raw entries (monitors) and the backfilled day's `count` includes it;
  - for regions (no raw), the backfilled day is built from the hours there are.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** In `summarySeries`, fetch complete and fill first; fetch the backfill segment
      only for places whose coarse series lacks the last completed period. When the backfill's own
      response lacks its last period, fetch that one period from the next finer offered level
      (`FINER` in `periods.ts`, one more level only) and aggregate it in.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `fix(data): skip the backfill once the rollup exists; backfill its last period`.

### Task 6: The worst hour

**Files:**

- Create: `src/lib/data/worst-hour.ts`, `src/lib/data/worst-hour.test.ts`
- Modify: `src/lib/data/types.ts` (`SeriesPoint`, `QueryInput`),
  `src/lib/data/adapters/registry.ts` (`AdapterRequest`), `src/lib/data/query/client.ts`
  (`plan`), `src/lib/data/query/key.ts` (`queryKey`), `src/lib/data/adapters/air-quality.ts`,
  their tests

**Interfaces:**

- Produces:
  ```ts
  // types.ts
  // SeriesPoint gains: worstHour?: { t: number; value: number }  (t = the hour's start, epoch ms)
  // QueryInput gains:  worstHour?: boolean
  // registry.ts — AdapterRequest gains: worstHour: boolean
  // worst-hour.ts
  export const WORST_HOUR_MAX_DAYS = 92;
  /** The highest hourly mean per Pacific day, keyed by the day's start (epoch ms). */
  export function worstHours(hourly: SeriesPoint[]): Map<number, { t: number; value: number }>;
  ```
- The client sets `request.worstHour` only when the input asks, the chosen resolution is `"day"`,
  `rangeSpanDays ≤ 92`, and the target is one place (`monitors` with one id or `regions` with one
  key). `worstHour` goes into the cache key only when effective.

- [ ] **Step 1: Failing tests.** `worst-hour.test.ts`: picks the max hourly mean per day and its
      hour; days on 2026-03-08 (23 h) and 2026-11-01 (25 h, the repeated 1 AM hour) group by Pacific
      day; a day with no hours has no entry. `client.test.ts`: `worstHour: true` is dropped (and the
      key is the same as without it) for two places, for a 93-day range, and for hourly
      resolution. `air-quality.test.ts`: a single-region 30-day query with `worstHour` makes hourly
      bulk calls by month and sets `worstHour` on each day point; the daily `mean` still comes from
      the daily call.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. The adapter runs `summarySeries` a second time with
      `resolution: "hour"` over the same range (calendar-aligned by Task 4) and attaches
      `worstHours(...)` to day points by `t`.
- [ ] **Step 4:** `npm run test:unit -- src/lib/data` and `npm run test:unit:tz` PASS.
- [ ] **Step 5:** Commit `feat(data): each day's worst hourly average`.

### Task 7: Query client fixes — idle state, resolution re-pick, cache cap by size

Closes three `DEFERRED.md` items: "`LiveQuery` has no idle state for a null input", "Refetch
keeps the resolution chosen at creation", "The idle cache cap counts entries, not bytes". Leaves
"Updating a subscription to an input with the same key detaches first" deferred unless the
Duplicate or Chart browser tests show the flash.

**Files:**

- Modify: `src/lib/data/types.ts` (`QueryState`), `src/lib/data/live-query.svelte.ts`,
  `src/lib/data/query/client.ts`, tests `live-query.svelte.test.ts`, `client.test.ts`

**Interfaces:**

- Produces: `QueryState` gains `{ status: "idle" }`; `LiveQuery.set(null)` → `idle`.
  `QueryClientOptions` gains `maxIdlePoints?: number` (default `500_000`).

- [ ] **Step 1: Failing tests.** `new LiveQuery(client, null).state` is `{ status: "idle" }`; a
      `to-date week` subscription created on Tuesday (2-day span, `raw`) moves to `hour` when the
      poller's refetch runs on Thursday (4 days); idle entries are evicted oldest-first once their
      total points exceed `maxIdlePoints`, even under `maxIdleEntries`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. `refetch(key)` re-runs `chooseResolution` for the new range; when it
      differs, each subscriber is requested again (`request(sub, sub.input)` with `inputJson`
      cleared) so it moves to the new key.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `fix(data): idle state, resolution re-pick on refetch, idle cap by points`.

### Task 8: A `setWidgetData` change

"Switch to the replacement" (Task 10) and the Data Explorer's Save changes (spec 3) edit a
widget's data as one undoable change.

**Files:**

- Modify: `src/lib/changes/types.ts`, `src/lib/changes/apply.ts`, `src/lib/changes/undo.ts`,
  `src/lib/changes/overlap.ts`, `src/lib/changes/rebase.ts` (if it switches on `op`),
  `src/lib/documents/migrate-changes.ts` (if it validates ops); tests `apply.test.ts`,
  `undo.test.ts`, `overlap.test.ts`

**Interfaces:**

- Produces:
  ```ts
  { op: "setWidgetData"; target: { widgetId: string }; from: WidgetDataConfig; to: WidgetDataConfig }
  ```
  Validated with `WidgetDataConfigSchema`. It touches the widget like `setField` on its title
  does for overlap detection.

- [ ] **Step 1: Failing tests.** Apply replaces `widgets[i].data` without mutating the input
      document; undo restores `from`; applying to a missing widget throws `ChangeTargetMissing`; a
      concurrent `removeWidget` of the same widget overlaps; a `setWidgetData` on another widget
      doesn't. Also strengthen the existing weak tests (`DEFERRED.md` → "Weak tests in the widget
      registry and `applyChange`", the `applyChange` half): index clamping on `addWidget` and
      that no op mutates its input.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement in each switch on `op`.
- [ ] **Step 4:** `npm run test` PASS (sync tests replay changes, so run the whole suite).
- [ ] **Step 5:** Commit `feat(changes): setWidgetData`.

### Task 9: Lazy widget types, generated titles, and Add widget

**Files:**

- Modify: `src/lib/widgets/registry.ts`, `src/lib/widgets/placeholder/index.ts`,
  `src/lib/components/dashboard/WidgetFrame.svelte` (body at about line 592),
  `src/lib/actions/widget.ts` (`widgetTitle`, rename's generated title at about line 65),
  `src/lib/actions/dashboard.ts` (`addWidget`), `src/lib/components/dashboard/AddWidgetButton.svelte`,
  `src/lib/store/app.svelte.ts` (`initApp` registration), `messages/en.json`
- Create: `src/lib/widgets/titles.svelte.ts`, `src/lib/widgets/registry.test.ts`,
  `src/lib/widgets/defaults.ts`

**Interfaces:**

- Produces:
  ```ts
  // registry.ts
  export type WidgetModule = {
  	component: Component<{ widget: WidgetInstance; fullscreen?: boolean }>;
  };
  export type WidgetType = {
  	type: string;
  	label: () => string;
  	icon: Component;
  	minSize: { w: number; h: number };
  	defaultSize: { w: number; h: number };
  	time: "range" | "now" | "none";
  	thresholds: boolean;
  	analyzable: boolean;
  	downloadable: boolean; // offers "Download data (CSV)"
  	accepts?: { datasets?: string[]; maxPollutantLayers?: number; maxPlaces?: number };
  	placePicker?: boolean;
  	resolution?: Resolution;
  	dateMethods?: DateRangeSpec["kind"][];
  	span?: { minDays?: number; maxDays?: number };
  	menu: MenuProvider;
  	load: () => Promise<WidgetModule>; // a dynamic import(); cached after the first call
  	/** Offered in Add widget until the Data Explorer (spec 3). */
  	addable?: () => WidgetDataConfig;
  };
  export function registerWidgetType(t: WidgetType): void;
  export function getWidgetType(type: string): WidgetType | undefined;
  export function addableWidgetTypes(): WidgetType[];
  export function loadWidget(type: WidgetType): Promise<WidgetModule>; // memoized per type
  // titles.svelte.ts
  export function setGeneratedTitle(widgetId: string, title: string): void;
  export function generatedTitle(widgetId: string): string | undefined;
  // defaults.ts
  export const DEFAULT_LAYER: Layer; // the Global Constraints default
  export const DEFAULT_RANGE: DateRangeSpec;
  // dashboard.ts
  export function addWidget(app: AppContext, type: string): void;
  ```
  `defaultTitle` leaves the type: the lazily loaded component computes its title (it may need
  metadata) and calls `setGeneratedTitle`. `widgetTitle(widget)` = `widget.title ??
generatedTitle(widget.id) ?? type.label()`.

- [ ] **Step 1: Failing tests.** `registry.test.ts`: register/lookup; `addableWidgetTypes` lists
      only types with `addable`; `loadWidget` calls `load` once for two calls. Browser test in
      `dashboard.browser.test.ts`: "Add widget" opens a menu listing the addable types by label;
      choosing one adds a widget of that type with `addable()`'s data at `defaultSize` (one undo
      step); the frame shows the type label as the title until the component sets one.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. `WidgetFrame` renders `{#await loadWidget(type)}` (the shared
      loading state from Task 10 while pending; an error state if the import fails). "Add widget"
      becomes a dropdown (shadcn `dropdown-menu`) of `addableWidgetTypes()`. The placeholder type
      keeps registering (tests use it) but has no `addable`; its `load` returns the existing
      component. Existing tests that relied on "Add widget" adding a placeholder call
      `addWidget(app, "placeholder")` or pick it from a test-only registration.
- [ ] **Step 4:** `npm run test` PASS; `npm run check` clean.
- [ ] **Step 5:** Commit `feat(widgets): lazily loaded widget types, generated titles, Add widget menu`.

### Task 10: Shared widget states

**Files:**

- Create: `src/lib/widgets/shared/WidgetState.svelte`, `src/lib/widgets/shared/retired.ts`,
  `src/lib/widgets/shared/widget-state.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**

- Consumes: `QueryState` (Task 7), `PlaceInfo` (Task 3), `setWidgetData` (Task 8).
- Produces:
  ```svelte
  <!-- Renders children only when there is data to show. -->
  <WidgetState state={QueryState} places={PlaceInfo[] | undefined} {widget} onretry={() => void}>
    {#snippet children(data: QueryData)}…{/snippet}
  </WidgetState>
  ```
  ```ts
  // retired.ts
  /** The widget's data with each retired region swapped for its replacement (null if none has one). */
  export function withReplacements(
  	data: WidgetDataConfig,
  	places: PlaceInfo[]
  ): WidgetDataConfig | null;
  ```
- States and messages (one key each; wording follows the design pass: plain, "this browser"):
  `idle` → "Choose a place to show data." (no Choose button until spec 2); `loading` → a quiet
  skeleton in the widget's shape, shown only after 300 ms; `ready` with every series empty →
  "No data for this range."; `error` → "Couldn't load this data." + Retry; `unavailable` → one
  message per `UnavailableReason`, and `region-unresolved` → the "no longer available" card
  (Remove; "Choose another" hidden until spec 3); `ready` with a retired place → a note above the
  content, "{place} stopped reporting on {date}.", plus "Switch to the replacement" when
  `replacedBy` is set (applies `setWidgetData` with `withReplacements`). A retired **dataset or
  entry type** (the widget reads `retired` from the catalog and passes it as a `retired` prop)
  shows "{dataset} stopped updating on {date}." over the data it still has. Stale data during
  `loading`/`error` keeps showing with the note or Retry over it.

- [ ] **Step 1: Failing tests** for each state above (render with a fake state; assert text via
      messages, Retry calls `onretry`, Switch applies one `setWidgetData` change and undo reverts
      it, Remove removes the widget), plus an axe check of the "no longer available" card.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run test:browser -- widget-state` PASS.
- [ ] **Step 5:** Commit `feat(widgets): shared loading, empty, error, unavailable, and retired states`.

### Task 11: The shared chart module (uPlot)

**Files:**

- Modify: `package.json` (add `"uplot": "1.6.32"` as a dependency; MIT passes
  `vite-plugins/licenses.ts`)
- Create: `src/lib/charts/series.ts`, `src/lib/charts/bands.ts`, `src/lib/charts/sticks.ts`,
  `src/lib/charts/TimeChart.svelte`, `src/lib/charts/LevelKey.svelte`,
  `src/lib/charts/Readout.svelte`, `src/lib/charts/series.test.ts`,
  `src/lib/charts/bands.test.ts`, `src/lib/charts/time-chart.browser.test.ts`
- Modify: `src/app.css` only if a token is missing (add tokens, never raw colors in components)

**Interfaces:**

- Consumes: `Level`, `levelFor` (Task 2); `QueryData`, `SeriesPoint.worstHour` (Task 6).
- Produces:

  ```ts
  // series.ts
  export type SeriesStyle = { color: string; dash: number[]; marker: "circle" | "square" | "triangle" | "diamond" | "cross" };
  /** Style for the i-th place: --chart-(i+1) read from CSS, plus a distinct dash and marker. */
  export function seriesStyle(i: number, css: CSSStyleDeclaration): SeriesStyle;
  // bands.ts
  export type BandBox = { level: Level; top: number; bottom: number; label: string[] | null };
  /** Band rectangles (in px) for a value scale, with the label wrapped into ≤ 2 lines that fit
   *  `width`, or null when the band is too thin or the label doesn't fit. */
  export function layoutBands(levels: Level[], scale: { min: number; max: number; height: number },
    measure: (text: string) => number, width: number, lineHeight: number): BandBox[];
  ```

  ```svelte
  <TimeChart data={QueryData} levels={Level[]} unit={string} placeNames={Map<string, string>} />
  ```

  `TimeChart` draws the bands, the line(s) with dots (hollow when `partial`), the sticks (only
  when `data.series.length === 1` and points carry `worstHour`), gaps for missing periods
  (`null` values at expected period starts, from `nextPeriodStart`), Pacific-time axes with
  `tabular-nums` and the unit, the `LevelKey` (always), a series key, and the `Readout`. It is
  focusable (`tabindex="0"`, `role="group"`, an `aria-label` naming the chart); ← / → step
  points, Home / End jump; the readout is an `aria-live="polite"` region. It redraws on
  `ResizeObserver` only after the frame's resize transition ends (`transitionend`, or at once
  under reduced motion). The y-axis top is the larger of the data max (incl. worst hours) and
  the top of the level that holds it.

- [ ] **Step 1: Failing unit tests.** `series.test.ts`: styles 0–4 differ in color **and** dash
      or marker; reads `--chart-1…5`. `bands.test.ts`: Good (0–9) on a 0–100 scale 190 px tall is
      `label: null`; "Unhealthy for Sensitive Groups" in a 30 px band, 80 px wide, wraps to two
      lines; an open top level (`max: null`) extends to `scale.max`; no level is ever abbreviated.
- [ ] **Step 2: Failing browser tests** (`time-chart.browser.test.ts`, fixture data with a gap and
      a partial last day): the level key lists all four full labels with outlined swatches; a
      pointer hover on a day shows the readout with date, value + unit, level label, and "Worst
      hour" with its hour (optional " PT"); focusing the chart and pressing → moves the readout;
      End jumps to the last point; two places render two series styles; with two places no
      sticks are drawn; axe passes in light and dark.
- [ ] **Step 3:** Run — FAIL.
- [ ] **Step 4:** Implement (bands, sticks, and hollow dots as uPlot `hooks.draw*`; key and
      readout as Svelte markup).
- [ ] **Step 5:** PASS; `npm run check` clean.
- [ ] **Step 6:** Commit `feat(charts): shared uPlot time chart with level bands, worst hour, and readout`.

### Task 12: The Chart widget

**Files:**

- Create: `src/lib/widgets/chart/index.ts` (descriptor), `src/lib/widgets/chart/ChartWidget.svelte`,
  `src/lib/widgets/chart/module.ts` (`load` target), `src/lib/widgets/title.ts`,
  `src/lib/widgets/title.test.ts`, `src/lib/widgets/chart/chart-widget.browser.test.ts`
- Modify: `src/lib/store/app.svelte.ts` (register), `messages/en.json`

**Interfaces:**

- Consumes: Tasks 2, 3, 6, 7, 9, 10, 11.
- Produces:
  ```ts
  // title.ts — "PM2.5 · Fresno County · Last 30 days"; several places: "PM2.5 · 3 places · …"
  export function dataTitle(parts: { entryLabel: string; places: PlaceInfo[]; range: DateRangeSpec }): string;
  /** "Last 30 days", "October 2026", "This month so far", "Oct 1 – Oct 14, 2026", … */
  export function rangeLabel(spec: DateRangeSpec): string;
  ```
  Descriptor: `type: "chart"`, `time: "range"`, `analyzable: true`, `downloadable: true`,
  `defaultSize: { w: 3, h: 4 }`, `accepts: { maxPollutantLayers: 1, maxPlaces: 5 }`,
  `addable: () => ({ dateRange: DEFAULT_RANGE, layers: [DEFAULT_LAYER] })`.
- The component builds `QueryInput` from the widget's first pollutant layer and `data.dateRange`,
  with `worstHour: true` (the client drops it where it doesn't apply); `LiveQuery` with polling
  off while minimized; `places` beyond 5 are cut from the selection before querying and a note
  says how many aren't drawn; the entry type's `label` and `units` come from the catalog.

- [ ] **Step 1: Failing tests.** `title.test.ts`: the examples above for each `DateRangeSpec` kind
      (Pacific dates); no string concatenation (each shape is one message). Browser test with the
      query client faked: renders a `TimeChart`; sets the generated title; a document with 7
      places shows 5 series and the "2 more places aren't shown" note; a minimized widget's query
      stops polling.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run test` PASS.
- [ ] **Step 5:** Commit `feat(widgets): Chart widget`.

### Task 13: The Data table widget

**Files:**

- Create: `src/lib/widgets/table/index.ts`, `src/lib/widgets/table/module.ts`,
  `src/lib/widgets/table/DataTable.svelte`, `src/lib/widgets/table/rows.ts`,
  `src/lib/widgets/table/rows.test.ts`, `src/lib/widgets/table/data-table.browser.test.ts`
- Modify: `src/lib/store/app.svelte.ts`, `messages/en.json`

**Interfaces:**

- Produces:
  ```ts
  // rows.ts — wide rows: one per period, one value column per place
  export type TableRow = { t: number; partial: boolean; cells: Array<SeriesPoint | null> };
  export function wideRows(data: QueryData): TableRow[];
  export function sortRows(rows: TableRow[], column: "t" | number, dir: "asc" | "desc"): TableRow[];
  ```
  Descriptor: `type: "data-table"`, like Chart but `accepts.maxPlaces: 10`.
- Columns: Date (formatted for the resolution), then per place: value + `LevelSwatch` label;
  when one place and wide enough (container ≥ 6 columns' width, measured with a
  `ResizeObserver`): worst hour (value and hour), min, max. Header row sticky; body scrolls
  inside the widget. Sort by clicking or Enter/Space on a header button; `aria-sort` on the
  `th`. A caption line: the resolution used and "computed from raw data" where `fromRaw`. A
  "Download CSV" button (Task 14's function).

- [ ] **Step 1: Failing tests.** `rows.test.ts`: two places with different missing periods give
      `null` cells; sorting by a place column puts `null`s last both ways. Browser test: headers
      sort by keyboard with `aria-sort` updating; the level label shows beside each value; at the
      default width only Date/value/level show, at 6 columns worst hour/min/max appear; numbers use
      `tabular-nums`; axe passes.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(widgets): Data table widget`.

### Task 14: CSV export and "Download data (CSV)"

**Files:**

- Create: `src/lib/data/csv.ts`, `src/lib/data/csv.test.ts`
- Modify: `src/lib/actions/widget.ts` (the menu item, for types with `downloadable`),
  `src/lib/sharing/file-names.ts` (+ test), `messages/en.json`

**Interfaces:**

- Produces:
  ```ts
  // csv.ts
  export const CSV_COLUMNS = ["period_start", "period_end", "place_kind", "place_id", "place_name",
    "entry_type", "entry_type_label", "unit", "mean", "min", "max", "worst_hour_mean",
    "worst_hour_start", "count", "resolution", "partial", "computed_from_raw"] as const;
  export function toCsv(data: QueryData, meta: { entryType: string; entryLabel: string; unit: string }): string;
  /** Runs the widget's own query once (no polling), then saves through the platform. */
  export async function downloadWidgetCsv(widget: WidgetInstance, save: FileAccess["save"]): Promise<void>;
  // file-names.ts
  export function dataFileName(parts: { entryLabel: string; placeLabel: string; firstDate: string; lastDate: string }): string;
  ```
- Times as `2026-10-25T00:00:00-07:00` (Pacific with offset; use `@date-fns/tz`); booleans
  `true`/`false`; place kind `monitor`/`region`; place id the monitor id or `type:code`; RFC 4180
  quoting; `\r\n` line ends; no comment lines. The menu action does `await
import("$lib/data/csv")` so the data layer stays out of the initial bundle; failures show a
  toast.

- [ ] **Step 1: Failing tests.** `csv.test.ts`: the header is `CSV_COLUMNS`; a daily region row
      on 2026-11-01 has `period_start` `2026-11-01T00:00:00-07:00` and `period_end`
      `2026-11-02T00:00:00-08:00`; worst-hour columns filled for one place, empty for two; a place
      name with a comma is quoted; `partial` true for today. `file-names.test.ts`: a name like
      `pm25-fresno-county-2026-10-06-to-2026-11-04.csv` (slugged, no spaces). Browser: the ⋯ menu of
      a Chart and a Data table has "Download data (CSV)" and choosing it calls `save` with
      `text/csv`; a placeholder widget's menu doesn't have it.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run test` and `npm run test:unit:tz` PASS.
- [ ] **Step 5:** Commit `feat(data): CSV export and Download data on every data widget`.

### Task 15: Trim the initial bundle under 200 KB

**Files:**

- Modify: `src/App.svelte` (dialog mounts), the dialogs in `src/lib/components/dialogs/` that are
  moved, their callers' imports (`openShare`, `openRestoreVersion`, `askExistingCopy`, …),
  `src/router.ts` (`"/dashboards"` lazy)
- Create: `src/lib/components/dialogs/lazy.svelte.ts` (open state per lazy dialog)

**Interfaces:**

- Produces: each moved dialog's `open…()` function lives in `lazy.svelte.ts` (same name and
  signature as today, so callers change only their import path); `App.svelte` mounts a moved
  dialog with `{#await import(...)}` only once it has first been opened, and keeps it mounted.

- [ ] **Step 1:** `npm run build && npm run check:budget` on this branch before any change in this
      task; note the figure (it includes Tasks 1–14).
- [ ] **Step 2:** Move, in order of measured size, until under 200 KB with at least 3 KB to
      spare: Share, Restore version, Move to account, Conflict, Remote decision, Clear data,
      Privacy, Sign out; and make `/dashboards` a lazy route. Keep Rename, Confirm, and Existing
      copy eager if they're needed on first interaction anyway (builder decides by size).
- [ ] **Step 3:** `npm run test` and `npm run test:e2e` PASS (the dialogs' existing tests cover
      opening; add a browser test that the Share dialog opens on the first click with focus in
      it).
- [ ] **Step 4:** `npm run build && npm run check:budget` — Expected: ≤ 197 KB, no warning.
- [ ] **Step 5:** Commit `perf: load rarely used dialogs and the dashboards list on demand`.

### Task 16: End to end, accessibility, and docs

**Files:**

- Create: `e2e/widgets.spec.ts`
- Modify: `e2e/a11y.spec.ts`, `DEFERRED.md`, `TODO.md` (step 4 section), `ARCHITECTURE.md` (only
  if the build changed a decision)

- [ ] **Step 1:** `e2e/widgets.spec.ts` (fake server as the other E2E specs do): add a Chart and a
      Data table, see data, step the chart's readout with the keyboard, download a CSV (assert the
      download's file name and header row), duplicate the Chart, reload and see both. Add both
      widgets to the a11y spec in light and dark.
- [ ] **Step 2:** `npm run test:e2e` PASS; `npm run test:e2e:podman` PASS (all engines).
- [ ] **Step 3: Stack check** (local sjvair.com on `develop`, `npm run dev`): add a Chart for
      Fresno County PM2.5; if days are missing, rebuild a **scoped** range first
      (`podman exec sjvaircom_web_1 python manage.py rebuild_summaries <start> <end> --region <id>
--regions-only`). In devtools, reloading the next day isn't possible, so check instead that
      the October request's response has `Cache-Control: private, max-age=86400` and the
      November one `max-age=60`. Message the coordinator before restarting containers.
- [ ] **Step 4: `DEFERRED.md`:** remove the items this spec closed (the `LiveQuery` idle state;
      refetch resolution; idle cap; backfill; the widget-registry half and the `applyChange` half
      of the weak tests; chart redraw during resize; bundle item (4)); add "**The initial bundle
      over 200 KB again.** _Trimmed 2026-11-04 (step 4 spec 1)_ … **Revisit when** `check:budget`
      warns again (the user: decide then, rather than trimming every time)." Mark step 4 spec 1 as
      built in `TODO.md`.
- [ ] **Step 5:** `npm run lint`, `npm run check`, `npm run test` all clean; commit
      `test: widgets end to end; docs: step 4 spec 1 built`.
- [ ] **Step 6:** Push; open the PR into `step-4` (description: what's built, the budget before
      and after, the stack check); `gh pr checks` until green.
