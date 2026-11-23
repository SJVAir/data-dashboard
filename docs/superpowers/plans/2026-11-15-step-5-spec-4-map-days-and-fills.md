# Step 5 spec 4: the Map's days and region fills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map tile shows "Now" or steps through the days of a date range (with a "Now" stop
when the range includes today), saves the day it's on, and can fill one region type under its
monitors.

**Architecture:** A general **snapshot query** in the data layer (one figure per place for one day
or now) feeds the Map's data entries through the now client's cache. The calendars' day rules move
into the data layer and are shared. The Map becomes a `time: "range"` type with a new `now` flag;
the day is a tile option (`day`), stepped through a strip under the map, and changed through the
tile-options layer so viewers step for themselves. Fills are a tile option (`fill`) drawn with
map-sdk's `regionsPlugin` under the focus area.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (unit + browser), Playwright, Paraglide,
bits-ui/shadcn-svelte, `@sjvair/sdk`, `@sjvair/map-sdk`.

**Spec:** `docs/superpowers/specs/2026-11-15-step-5-spec-4-map-days-and-fills-design.md` (read it
first; this plan argues from it and doesn't repeat its reasons).

## Global Constraints

- Branch `step-5-spec-4` from `step-5`; PR into `step-5`. Never merge without the user's yes.
- Pins stay exact. `@sjvair/sdk` `5.0.0-beta.10` until Task 11; `@sjvair/map-sdk` `0.1.0-beta.13`
  until Task 12. Name packages with full versions in docs and commits.
- **Tasks 11 and 12 are blocked** on the coordinator (`data-dashboard-2b`): `@sjvair/sdk` `5.0.0-beta.11`
  (the whole-type region scope; published after the server PR merges into `develop`), and `@sjvair/map-sdk` `0.1.0-beta.15` (no-figure regions, one shared
  legend section). Do Tasks 1–10 and 13's non-fill parts first; never work around a missing beta.
- Server shape for Task 11 (final: the user approved sjvair.com's spec, 2026-11-15): `type=<Region.Type>` on `/regions/<entry_type>/summaries/<res>/` and
  `/regions/<entry_type>/summaries/daily/open/`; exactly one of `type` or `region` (both or
  neither: 400); `land_use` and unknown types 400; current regions only (matches
  `/regions/geojson/`); empty type is an empty 200; paging (168 rows), shape and cache headers
  unchanged.
- Map code stays in the lazy map chunk; the snapshot module is imported only by lazy chunks.
  Report `npm run check:budget` against 250 KB (212.6 KB before).
- Svelte 5 runes only; class effects in `$effect.root` with cleanup in `destroy()`; no `this`
  aliasing; key deriveds on primitives.
- All UI text through Paraglide (`messages/en.json`), no concatenated sentences, `sentence_join`
  to fold sentences. Theme tokens only. Pacific dates through `$lib/format` (`todayPacific`,
  `toKey`, `TIME_ZONE`); weeks start Sunday.
- WCAG 2.2 AA; standard slider pattern; every drag has a keyboard and button alternative;
  `prefers-reduced-motion`.
- "Missing means default, a default is never written; a fallback is drawn, never saved; a saved
  value applies only while its row is offered" for every new option.
- Run `npm run lint`, `npm run check` and the touched tests before every commit. Commits are
  GPG-signed; if signing times out ("No passphrase given"), ask the user to unlock and retry.
  Never commit unsigned. No AI attribution.
- Record every deferral in `DEFERRED.md` in the same change.

## Review Focus

1. **A rolling range moves past the saved day** (a "last 7 days" tile saved on day 1, opened a
   week later; or a live-link viewer whose held day leaves the owner's edited range): opens on
   the last stop and writes nothing. Tests in Task 6 (`openStop`) and Task 9 (browser, no write).
2. **A range with no stops yet** (a custom range wholly after today): the strip shows no slider and
   the map says there are no days to show yet; no fetches. Test in Task 6 and Task 9.
3. **Not on Pacific time** (CI, a viewer in New York): stops, "today" and the Now stop are Pacific
   dates. Run Task 6's tests with `TZ=America/New_York` too.
4. **Fast stepping** (holding an arrow key, dragging the slider): only the day showing is drawn;
   an older day's response that lands late is never drawn, and the run is one undo step. Tests
   in Task 7 and Task 9.
5. **Switching pollutant or places while on a day**: the day stays; the new pollutant's or
   places' figures load for that day; no earlier figures drawn while pending. Test in Task 9.

---

### Task 1: Spec 3's leftovers

**Files:**
- Modify: `src/lib/widgets/map/MapWidget.svelte` (~483, the hidden-marks note), `src/app.css`
  (`--map-icon-fire`, `:root` only), `src/lib/theme/contrast.test.ts`,
  `src/lib/widgets/map/toolbar/values.ts` (`activeFilters`), its callers, `DEFERRED.md`
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`, `src/lib/widgets/map/toolbar/values.test.ts`

**Interfaces:**
- Produces: `activeFilters(options, offer, rows, defaults: OptionValues): MonitorFilters` (no
  default).

- [ ] **Step 1: Failing tests.**
  - Browser: with no entry label for the pollutant, the note reads the "aren't shown" line, never
    "doesn't report " with an empty name.
  - Browser: while the monitors lookup is pending, no hidden-marks note shows; after it settles the
    reasons show; when it fails, the "aren't shown" line shows.
  - Contrast: `--map-icon-fire` (light) is at least 3:1 against `--accent` (the hovered row), and
    the test also checks every `--map-icon-*` against the menu surface and `--accent`.
- [ ] **Step 2:** Run them; they fail.
- [ ] **Step 3:** Fix: fall back to the "aren't shown" line when the label is missing; hold the
  note until the lookup settles; darken the light fire value one step until it meets 3:1 (dark
  blocks unchanged and identical); make `defaults` required and pass it at every call site.
- [ ] **Step 4:** `npm run test:unit` and `npx vitest run --project browser src/lib/widgets/map`
  pass; `npm run check` passes (a forgotten `defaults` is now a type error).
- [ ] **Step 5:** Remove the four "Do at the start of spec 4" items from `DEFERRED.md` → "Step 5
  spec 3 review leftovers". Lint, commit: `fix(map): spec 3 leftovers (note label, fire contrast,
  note timing, required defaults)`.

### Task 2: Day rules in the data layer

**Files:**
- Create: `src/lib/data/day-state.ts` (moved from `src/lib/calendars/day-state.ts`),
  `src/lib/data/day-state.test.ts` (moved)
- Modify: every importer (`git grep -l day-state`: `WeekGrid`, `MonthGrid`, `CalendarLegend`,
  `CalendarShell`, `calendar-data.svelte.ts`, `day-label.ts`, `DayGrid`, `calendars/summary.ts`
  and tests)

**Interfaces:**
- Produces (in `$lib/data/day-state`): the existing `DayKind`, `DayState`, `dayStates`,
  `ratedForCount`, `thresholdCount`, plus
  `dayState(args: { date: string; today: string; row: { figure: number | null; final?: boolean } | undefined; figure: DailyFigure | null; levels: Level[] }): DayState`
  — one day's state, which `dayStates` now calls per date.

- [ ] **Step 1:** `git mv` the file and its test; update imports. Add a test for `dayState`:
  no row → `none`; row with `figure: null` → `thin`; `final: false` → `pending`; `figure` null
  scale → `unrated` (`today` on today); a future date → `future`.
- [ ] **Step 2:** Run `day-state.test.ts`; the new test fails.
- [ ] **Step 3:** Extract `dayState` from the loop in `dayStates`; `dayStates` maps points by date
  and calls it.
- [ ] **Step 4:** All calendar tests (unit and browser) pass unchanged.
- [ ] **Step 5:** Lint, check, commit: `refactor(data): share the calendars' day rules`.

### Task 3: The snapshot query (monitors, and its shape)

**Files:**
- Create: `src/lib/data/snapshot/types.ts`, `src/lib/data/snapshot/monitors.ts`,
  `src/lib/data/snapshot/index.ts`, tests beside them

**Interfaces:**
- Consumes: Task 2's `dayState`; `DailyFigure` and `MetadataSource.dailyFigure`;
  `getMonitorSummariesBulkDaily`; `NowSource` (`src/lib/data/now/client.ts`).
- Produces:
  ```ts
  export type SnapshotAt = "now" | { day: string }; // a Pacific date key
  export type SnapshotFigure = { value: number | null; level: Level | null; kind: DayKind };
  export type Snapshot = {
  	/** Keyed by monitor id, or by region `type:code`. */
  	figures: Map<string, SnapshotFigure>;
  	/** Every figure final (a day only); false makes the source poll hourly. */
  	final: boolean;
  	/** The scale has no daily_statistic: every figure is unrated. */
  	unrated: boolean;
  };
  export type MonitorScope = { kind: "regions"; ids: string[] } | { kind: "monitors"; ids: string[] } | { kind: "all" };
  export function monitorDaySource(args: { entryType: string; day: string; scope: MonitorScope; scopeKey: string; figure: DailyFigure | null; levels: Level[]; today: () => string }): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean };
  ```
  Key: `snapshot:monitors:<entryType>:<scopeKey>:<day>`; cadence `"hour"`; `poll` is true until
  the snapshot is final.

- [ ] **Step 1: Failing tests** (`monitors.test.ts`, the SDK call stubbed):
  - one request for the day (`start` = `end` = the day), `region` = scope ids for a regions
    scope, none for `all`; a monitors scope filters the response to its ids;
  - a monitor's figure reads the `figure.field` (`mean_24h` for PM2.5 in the fixture), its level
    from `levels`; `is_final: false` → `kind: "pending"` and `final: false`; a null field →
    `thin`; a monitor absent from the response is absent from `figures` (`none`);
  - `figure: null` → `unrated: true`, every figure `unrated`, no level;
  - `poll(final snapshot)` is false, `poll(non-final)` true, `poll(undefined)` true.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement with Task 2's `dayState` per monitor (`today` from the arg, so a
  test can fix it). Page through the SDK's result as it returns it (it fetches all pages).
- [ ] **Step 4:** Pass. Also run with `TZ=America/New_York`.
- [ ] **Step 5:** Lint, check, commit: `feat(data): snapshot query for a day of monitors`.

### Task 4: The widget contract's `now` flag, and the Map as a range type

**Files:**
- Modify: `src/lib/widgets/registry.ts` (`now?: boolean` on `WidgetType`, doc comment),
  `src/lib/widgets/map/index.ts`, and every `time === "now"` site: `src/lib/sharing/points.ts:87`,
  `src/lib/places/PlacePickerDialog.svelte:296`, `src/lib/get-data/map.ts:176`,
  `src/lib/get-data/now.ts:157,210`, `src/lib/get-data/GetDataView.svelte:154,179,435,479,485,521`,
  `src/lib/thresholds/watched.ts:10` (re-check with `git grep -n 'time === "now"\|time !== "now"'`)
- Create: `src/lib/widgets/time.ts` with the two helpers below, `time.test.ts`
- Modify: `src/lib/get-data/WhenControl.svelte` (a "Now" choice when `type.now`)
- Test: `src/lib/widgets/registry.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`,
  `src/lib/get-data/map.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Whether the type's widgets can show now (a now type, or a range type with `now`). */
  export function offersNow(type: WidgetType): boolean;
  /** Whether this widget shows now: a now type, or a `now` type with no dateRange. */
  export function showsNow(type: WidgetType, data: WidgetDataConfig): boolean;
  ```
- Map registration: `time: "range"`, `now: true`, `resolution: "day"`,
  `span: { minDays: 1, maxDays: 366 }`, no `dateMethods` (all), no `defaultRange`; `addable`
  unchanged (no `dateRange`, so Now).

- [ ] **Step 1: Failing tests.**
  - `time.test.ts`: `showsNow` true for a now type, true for the Map with no range, false with a
    range; `offersNow` true for Current conditions and the Map, false for Chart.
  - `registry.test.ts`: the Map is `time: "range"`, `now: true`, `resolution: "day"`,
    `maxDays: 366`.
  - Get data browser: for a Map, When shows "Now" (selected for a new Map) and the date methods;
    choosing a method sets `dateRange`; choosing Now removes it. No resolution override shows.
  - `map.test.ts`: `isMapShaped` accepts a Map draft with a range (no `timeSubRange`);
    `fromMapDraft` to Chart keeps the range; a Map on Now to Chart takes Chart's default range;
    `toMapDraft` from a Chart keeps its range, drops `timeSubRange`, and cuts a 400-day range to
    its last 366 days with a `"range-cut"` dropped note.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. At each `time === "now"` site, decide "now type" vs "showing now"
  and use the helper. Places and their privacy rules don't change with a range. Add the
  `"range-cut"` member to `NowDropped` and its note message.
- [ ] **Step 4:** `npm run test` passes (every existing now-type test unchanged).
- [ ] **Step 5:** Lint, check, commit: `feat(widgets): the Map shows now or a date range`.

### Task 5: The Map's new options

**Files:**
- Modify: `src/lib/widgets/map/options.ts`, `src/lib/widgets/map/toolbar/values.ts`,
  `src/lib/widgets/map/toolbar/values.test.ts`, `src/lib/widgets/map/options.test.ts`

**Interfaces:**
- Produces, in `MapOptionsSchema`:
  `day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()` (missing: the last stop),
  `fill: SafeIdSchema.optional()` (a region type id; missing: no fill),
  `fillShown: z.literal(false).optional()` (missing: shown).
  `MAP_TOOLBAR_KEYS` gains `"fillShown"` (not `day`, not `fill`).
  `MapOffer` gains `fill: boolean` (the tile has a drawable fill); value key `"regions"` ↔ option
  `fillShown`.

- [ ] **Step 1: Failing tests.** Schema: a bad `day` string and `fillShown: true` are rejected
  (so a document can never hold the default). `toOptions`: `regions: true` removes `fillShown`,
  `false` stores `false`. `toValues` gives `regions: true` with no saved value. `withoutToolbar`
  clears `fillShown`, keeps `day` and `fill`. `groupsShown(...).layers` is true with a fill and no
  smoke and fire.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Lint, check, commit: `feat(map): day, fill and fillShown options`.

### Task 6: Day stops (pure)

**Files:**
- Create: `src/lib/widgets/map/days.ts`, `src/lib/widgets/map/days.test.ts`

**Interfaces:**
- Consumes: `resolveRange` (`$lib/format/range`), `todayPacific`.
- Produces:
  ```ts
  export type Stop = { day: string } | "now";
  /** The range's stops: each Pacific day up to today, then "now" if the range includes today. */
  export function dayStops(range: DateRangeSpec, today: string): Stop[];
  /** The stop to show: the saved day when it is a stop, else the last stop (null: no stops). */
  export function openStop(saved: string | undefined, stops: Stop[]): Stop | null;
  /** The option value for a stop: the last stop is stored as missing. */
  export function dayOption(stop: Stop, stops: Stop[]): string | undefined;
  /** The stop a key moves to (slider pattern); null for keys it doesn't handle. */
  export function stepKey(key: string, at: number, count: number): number | null;
  ```
  `stepKey`: ArrowLeft/ArrowDown −1, ArrowRight/ArrowUp +1, PageDown −7, PageUp +7, Home 0,
  End count−1; clamped.

- [ ] **Step 1: Failing tests.**
  - `{ kind: "custom", start: "2026-09-07", end: "2026-09-09" }`, today `2026-11-15` →
    three day stops, no "now".
  - `{ kind: "trailing", amount: 7, unit: "day" }`, today `2026-11-15` → six past days then
    "now" (match `resolveRange`'s trailing rule; assert from its output, not a guess).
  - `{ kind: "to-date", unit: "month" }` on `2026-11-01` → `["now"]`.
  - A custom range wholly after today → `[]`; `openStop(undefined, [])` → null.
  - `openStop("2026-09-08", stops)` → that day; `openStop("2026-08-01", stops)` → last stop;
    `openStop(undefined, stops)` → last stop.
  - `dayOption(last, stops)` → undefined; `dayOption(first, stops)` → its date.
  - `stepKey` for each key at both ends.
  - The whole file also passes under `TZ=America/New_York` and across the November DST change
    (`2026-11-01`).
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass (both time zones).
- [ ] **Step 5:** Lint, commit: `feat(map): day stops`.

### Task 7: A run of steps is one undo step

**Files:**
- Modify: `src/lib/widgets/shared/tile-options.svelte.ts`
- Create: `src/lib/widgets/map/step-run.ts`, `step-run.test.ts`
- Test: `src/lib/widgets/shared/tile-options.svelte.test.ts` (or the file's existing test)

**Interfaces:**
- Produces:
  - `changeTileOptions(ctx, widget, next, changedKeys, opts?: { amend?: boolean })`: edit mode
    uses `session.amend(change)` when `amend` is set; view mode ignores it.
  - `class StepRun { constructor(windowMs = 1000, now = () => Date.now()); next(): { amend: boolean }; end(): void }`:
    the first call in a run returns `amend: false`, later calls within `windowMs` of the last
    `amend: true`; `end()` (a slider drag's end) closes the run.

- [ ] **Step 1: Failing tests.**
  - `StepRun`: first false; within 1000 ms true; after 1000 ms false; after `end()` false.
  - Tile options with a real `DocumentSession`: three steps (apply, amend, amend) from day A to
    B, C, D → one Undo restores A; Redo gives D. **If Redo gives B**, stop and report to the user
    before changing the mechanism (the spec asks for D).
  - View mode: the same three steps write nothing to the session and hold `day` as D.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Lint, check, commit: `feat(map): one undo step per run of day steps`.

### Task 8: The day stepper strip

**Files:**
- Create: `src/lib/widgets/map/DayStepper.svelte`, `day-stepper.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: Task 6's `Stop`, `stepKey`; shadcn-svelte's `Slider` (add it with the shadcn CLI if
  it isn't in `src/lib/components/ui/`).
- Produces: `<DayStepper stops={Stop[]} at={number} notFinal={boolean} narrow={boolean} readOnly={boolean} onstep={(index: number, via: "button" | "key" | "slider") => void} ondragend={() => void} />`
- Messages (new): `map_day_previous` "Previous day", `map_day_next` "Next day",
  `map_day_slider` "Day", `map_day_now` "Now", `map_day_not_final` "Not final yet",
  `map_day_none_yet` "No days to show yet".

- [ ] **Step 1: Failing browser tests.**
  - Shows the stop's date through `format` (a long Pacific date) or "Now"; "Not final yet" beside
    it when `notFinal`.
  - Previous is disabled at the first stop, Next at the last; each calls `onstep`.
  - The slider's `aria-valuetext` is the date (or "Now"); Arrow keys, Page Up/Down, Home and End
    move as `stepKey` says.
  - `narrow`: no slider, the buttons and date remain.
  - `stops = []`: "No days to show yet", no buttons or slider.
  - axe: no violations.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement with theme tokens; no animation of the camera;
  any transition guarded by `prefers-reduced-motion`. **Step 4:** Pass.
- [ ] **Step 5:** Lint, check, commit: `feat(map): the day stepper`.

### Task 9: The Map on a day

**Files:**
- Modify: `src/lib/widgets/map/data/types.ts` (`MapDataInput` gains `at: SnapshotAt`),
  `data/monitors.ts` (a day uses Task 3's source), `data/hms.ts` (a day uses
  `getHMSSmoke({ date })` / `getHMSFire({ date })`, key `map-hms:<day>`, never polled once final),
  `data/loaded.svelte.ts`, `MapWidget.svelte`, `toolbar/toolbar.svelte.ts` (Inactive row not
  offered on a day stop), `marks.ts`, `messages/en.json`
- Test: `map-widget.browser.test.ts`, `data/monitors.test.ts`, `data/hms.test.ts`,
  `marks.test.ts`, `toolbar/toolbar.svelte.browser.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7, 8.
- Produces: `HiddenReason` gains `"day"` (in `HIDDEN_REASON_ORDER` after `"pollutant"`);
  `hiddenReasons(..., dayDrawn?: ReadonlySet<string>)`: on a day, a mark that is in the places but
  has no row that day is `"day"`. Message `map_marks_hidden_day` ("{count} marked monitors have no
  figure for this day", with plural forms as the existing marks messages do) and
  `map_day_unrated` ("{pollutant}'s days can't be rated").

- [ ] **Step 1: Failing tests.**
  - On a past day, monitors draw the day's figures. A monitor with no row isn't drawn; a `thin`
    one draws with no level and its list row reads "Not enough data"; the pollutant with no
    `daily_statistic` draws no levels and the note says once that its days can't be rated.
  - The neighbouring days are requested ahead (one each side); stepping to one draws without a
    new request.
  - Fast stepping: a late response for an earlier day is never drawn (assert the drawn day after
    a delayed fixture).
  - Changing pollutant on a day keeps the day and draws nothing stale while pending.
  - Smoke and fire for the day; the Fire & Smoke row still hides them.
  - The Inactive row isn't offered on a day stop, and a saved `inactive` doesn't filter there; it
    returns on the Now stop.
  - A hidden mark with no row that day gives the "no figure for this day" line.
  - Refresh: a final past day makes no second request after an hour (fake timers); a non-final
    day does; the Now stop keeps the 3-minute monitors poll.
  - Saved `day` outside the range opens on the last stop with no write; a range with no stops
    shows "No days to show yet" and requests nothing.
  - Edit mode: stepping writes `day` (the last stop removes it); read-only view (live link):
    stepping writes nothing (method-based check) and "Make a copy" keeps the day.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement. `MapData` reads `at` as its own primitive `$derived` (a day string or
  `"now"`); the monitors entry's key includes it. The Map polls a day source only while `poll`
  says so. Put the strip under the map inside the tile (`DayStepper` only when the tile has a
  range); `narrow` follows the toolbar's 48rem breakpoint.
- [ ] **Step 4:** `npm run test` passes.
- [ ] **Step 5:** Lint, check, commit: `feat(map): step through a range's days`.

### Task 10: Get data's "Fill regions by"

**Files:**
- Modify: `src/lib/get-data/MapSections.svelte`, `src/lib/get-data/map.ts`, `messages/en.json`
- Test: `src/lib/get-data/map.test.ts`, `get-data-view.browser.test.ts`

**Interfaces:**
- Consumes: the place directory's `regionTypes()` (`src/lib/places/directory.ts:122`, the
  `browsable && count > 0` rule) for the choices and labels.
- Produces: `setMapFill(draft: Draft, type: string | undefined): void` (writes or removes
  `options.fill`); `NowDropped` gains `"fill"` (with a note message) when converting away.
  Messages: `getdata_map_fill` "Fill regions by", `getdata_map_fill_none` "None",
  `getdata_note_fill_dropped`.

- [ ] **Step 1: Failing tests.** The section lists None plus the directory's types (no `mtrs`),
  None selected by default; choosing ZIP codes saves `options.fill: "zipcode"`; None removes it;
  converting the Map to a Chart drops `fill` and `day` with the fill note; converting back
  doesn't invent a fill.
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Lint, check, commit: `feat(get-data): a Map's region fill`.

### Task 11 (blocked on `@sjvair/sdk` `5.0.0-beta.11`): region snapshots

**Files:**
- Modify: `package.json` / lockfile (`@sjvair/sdk` exact pin `npm:@jsr/sjvair__sdk@5.0.0-beta.11`)
- Create: `src/lib/data/snapshot/regions.ts`, `regions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function regionDaySource(args: { entryType: string; regionType: string; day: string; figure: DailyFigure | null; levels: Level[]; today: () => string; codes: (sqid: string) => string | undefined }): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean };
  export function regionTodaySource(args: Omit<Parameters<typeof regionDaySource>[0], "day">): NowSource<Snapshot> & { poll: () => true };
  ```
  Days: the bulk daily summaries with `type` (Task 3's rules). Today: `daily/open` with `type`,
  reading only today's row, cadence `"hour"`. Figures are keyed `type:code` through `codes`
  (sqid → external id, from the type's GeoJSON features); a region with no external id is left
  out.

- [ ] **Step 1:** Move the pin; `npm run check` and `npm run test` pass. The SDK's names (sdk-js
  #63, from `@sjvair/sdk/regions`): `RegionSummaryBulkType = Exclude<RegionType, "land_use">` (`place` is gone from `RegionType` itself in 5.0.0-beta.11; delete `place: true` from `src/lib/data/adapters/registry.ts`'s `CODED_REGION_TYPES` in the re-pin commit);
  `RegionSummaryBulkScope = { region: string | string[]; type?: never } | { type:
  RegionSummaryBulkType; region?: never }`; `RegionSummaryBulkRequestConfig = { entryType; start;
  end } & RegionSummaryBulkScope`; `RegionSummaryBulkOpenRequestConfig = { entryType } &
  RegionSummaryBulkScope`. Fetchers unchanged, e.g. `getRegionSummariesBulkDaily({ entryType:
  "pm25", start, end, type: "tract" })`, `getRegionSummariesBulkDailyOpen({ entryType, type })`.
  Narrow the `fill` option's string to `RegionSummaryBulkType` with a type guard (an unknown or
  `land_use` or `place` value draws no fill, as the spec says) so it type-checks without a cast.
- [ ] **Step 2: Failing tests:** one request per day with `type` and no `region`; today's row only
  from open days; sqid → `type:code`; non-final day polls, final doesn't.
- [ ] **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Lint, check, commit: `feat(data): region snapshots (@sjvair/sdk 5.0.0-beta.11)`.

### Task 12 (blocked on `@sjvair/map-sdk` `0.1.0-beta.15`): the fill on the map

**Files:**
- Modify: `package.json` / lockfile (exact pin), `src/lib/widgets/map/regions.ts` (whole-type
  geometry: `getRegionsGeoJSON({ type, simplify })` with `simplify` for county, zipcode and tract,
  cached page-wide with the outline cache), `src/lib/widgets/map/data/` (a `fill` entry),
  `loaded.svelte.ts`, `MapWidget.svelte`, `toolbar/toolbar.svelte.ts` (the Layers fill row),
  `host/messages.ts` (any new `mapsdk_*` keys), `messages/en.json`
- Test: `data/fill.test.ts`, `map-widget.browser.test.ts`, `toolbar/toolbar.svelte.browser.test.ts`

**Interfaces:**
- Consumes: Task 11's sources; `@sjvair/map-sdk` `0.1.0-beta.15` (designed, not yet built; names
  may change in its review): `regionsPlugin({ id: "fill", source, layerLabel, selectable: false,
  noFigure: "outline", fillOpacity?, outline? })` (`noFigure` default `"neutral"`; `"outline"`
  draws a no-level feature unfilled with a `--foreground` outline). `Legend` merges scale
  sections whose sources share a **ScaleRef** (same dataset + entryType; a literal `Scale` never
  merges), titled with the pollutant label, placed at the fill's slot, with a "No data" row
  (new key `mapsdk_legend_no_figure`, map it in `host/messages.ts`) while a feature has no
  figure. Both the monitors source and the fill must pass the ScaleRef `{ dataset:
  "air-quality", entryType }` (the monitors entry already does, `data/monitors.ts:84`).
- Messages: `map_fill_today_so_far` "{regionType}, today so far", `map_fill_row` (the Layers
  row's label, from the region type's plural label), `map_fill_no_data` "No data".

- [ ] **Step 1:** Move the pin; the map-sdk messages-table test passes (map every new key).
- [ ] **Step 2: Failing tests.**
  - The fill draws under the focus area (`addPlugin(fill, { before: "focus" })` or the order
    map-sdk documents) and over the basemap; features are `region:<type>:<code>` with the scale
    `{ dataset: "air-quality", entryType: <drawn> }`.
  - A region with no figure is outlined with no fill and reads "No data".
  - One legend section for the pollutant, with the no-data entry.
  - On Now the layer label reads "ZIP codes, today so far"; on a day, the day's figures.
  - The Layers group shows with a fill and no smoke and fire; its row hides the fill without a
    new request; Reset shows it again.
  - A saved `fill` the regions meta doesn't list draws no fill, offers no row, writes nothing.
  - Clicking a region shows its card with no Select button.
- [ ] **Step 3:** Implement. **Step 4:** `npm run test` passes.
- [ ] **Step 5:** Lint, check, commit: `feat(map): region fills (@sjvair/map-sdk 0.1.0-beta.15)`.

### Task 13: E2E, docs, budget

**Files:**
- Modify: `e2e/map.spec.ts`, `e2e/map-data-server.ts` (day and region fixtures),
  `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`

- [ ] **Step 1: E2E** (Chromium; then `npm run test:e2e:all`):
  - step through a past custom range (fixtures for monitors, smoke for the day) with keys and
    buttons;
  - a range with today opens on Now;
  - a live link where the viewer steps with no non-GET to `/api/2.0/documents/`, and a positive
    control after "Make a copy";
  - after Task 12: a ZIP fill with a no-data region.
- [ ] **Step 2:** `ARCHITECTURE.md` and `DEFERRED.md` changes exactly as the spec's two sections
  list them; `TODO.md` step 5 status.
- [ ] **Step 3:** `npm run build && npm run check:build && npm run check:budget`; record the
  initial bundle number in the PR description.
- [ ] **Step 4:** Full `npm run test` and `npm run lint` pass (rerun a timing failure alone before
  calling it a bug; check `gh pr checks` after pushing).
- [ ] **Step 5:** Commit: `docs: step 5 spec 4`. Merge `origin/step-5` in before pushing (resolve
  `TODO.md`'s table per row, then Prettier). Open the PR into `step-5`; tell the coordinator.
