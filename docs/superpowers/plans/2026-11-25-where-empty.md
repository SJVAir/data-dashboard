# An empty Where means nothing (and six smaller changes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A widget with no Where shows nothing from Where (and says what to add), the raw-resolution
reason names the place, Forecast → calendars is offered, the nav's "Data Portal" is a ghost button,
the Map legend starts folded, the starter takes the user's layout, and a fullscreen Map zooms
without Ctrl.

**Architecture:** One seam decides what ticked types draw (`drawnMonitors` / `idleTypes` in
`src/lib/widgets/shared/input.ts`): with no Where they draw nothing. `Target` loses its
`{ kind: "all" }` member, so the compiler finds every "everywhere" branch to delete. Notes for
ticks that draw nothing share one rule across Chart, Table, Map and the Data Portal.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest (unit + browser mode), Playwright, Paraglide.

**Spec:** `docs/superpowers/specs/2026-11-25-where-empty-design.md` (approved 2026-11-25).

## Global Constraints

- Work only in `.worktrees/where-empty` (branch `where-empty`). Never `git stash`; stage by path.
- No Claude/AI attribution in commits or the PR (leave out `Co-Authored-By`, `Claude-Session` and
  "Generated with Claude Code" lines).
- **Speed (the user, 2026-11-25):** per task run only the touched test files
  (`npx vitest run <files>` or `npx vitest related --run <src files>`; narrow with `-t`), then
  `npm run check` and `npm run lint`. No full `test:unit` / `test:browser` / `test:e2e` per task;
  full suites only if needed at the end. CI's `e2e-full` on a pushed head covers the gap. Vitest
  runs one at a time, never in parallel. `npm run check` doesn't type-check `e2e/`: run the touched
  E2E spec files (`npx playwright test <file>`) when a task changes them.
- All UI strings through Paraglide (`messages/en.json`), whole sentences, no concatenation; labels,
  levels and entry types from the catalog, never hardcoded.
- Theme tokens only; WCAG 2.2 AA; never colour alone.
- No compatibility code for old document shapes; every saved document must still open.
- No changes to sibling repos.
- Pins: `@sjvair/sdk` `5.0.0-beta.17`; `@sjvair/map-sdk` `0.1.0-beta.23` until Task 12.
- Prettier mangles conflict markers: resolve merges before formatting.

## Review Focus

1. A saved Chart with ticked types and no Where (e.g. from before this change) opens with the empty
   message, not an error or a stuck "Loading…" → Task 1 test "ticked types alone with no Where ask
   for nothing and say what to add".
2. A Map with ticked types, searched monitors and smoke, and no Where draws the searched monitors
   and smoke, plus the ticks note → Task 4 browser test.
3. A shared link with an air-quality overlay at a region and `resolution: "raw"` gets the area
   misfit note, not the dataset one → Task 7 test.
4. Clear then pick a place in the Data Portal: the preview's title follows (no stale place) →
   Task 6 browser test.
5. Forecast with a monitor (no Where) → Month calendar keeps the monitor and shows PM2.5 with the
   forecast note → Task 8 test.

---

### Task 1: Ticked types draw only inside a Where

**Files:**
- Modify: `src/lib/widgets/shared/input.ts` (`widgetMonitors` stays raw; `hasPlaces`,
  `widgetPlaceKind`, `queryLayer`, `chartInput` change)
- Test: `src/lib/widgets/shared/input.test.ts`

**Interfaces:**
- Produces:
  - `drawnMonitors(data: WidgetDataConfig, catalog?: CatalogEntry[]): { monitors: string[]; types: string[] }`:
    `widgetMonitors` with `types` emptied when `!hasWhere(data)`.
  - `idleTypes(data: WidgetDataConfig, catalog?: CatalogEntry[]): string[]`: the ticked types
    that draw nothing (`!hasWhere(data)` → `widgetMonitors(data, catalog).types`, else `[]`).
  - `hasPlaces(data)`: `hasWhere(data) || drawnMonitors(data).monitors.length > 0`.
  - `widgetPlaceKind(data)`: reads `drawnMonitors`, so ticked types with no Where give `monitors`
    (with searched monitors) or `none`.
  - `queryLayer(data, layer, catalog)`: carries `monitorTypes` only when `hasWhere(data)`.
  - `chartInput`: the `drawnWithNoWhere` exception is gone: no places → `empty: "add-where-or-monitors"`.

- [ ] **Step 1: Write the failing tests** (rewrite the everywhere tests the inventory lists in
  `input.test.ts`: `:105`, `:201`, `:266`, `:359`–`:410`):
  - "ticked types alone with no Where ask for nothing and say what to add":
    `chartInput({ layers: [{ dataset: "air-quality", entryType: "pm25", monitorTypes: ["airnow"] }] }, catalog, "day")`
    → `{ input: null, empty: "add-where-or-monitors" }`.
  - "ticked types and searched monitors with no Where ask for the monitors only":
    `queryLayer` has `monitors: ["m1"]` and no `monitorTypes`.
  - "weather or pesticide use with no Where asks for nothing and says what to add" (replaces `:377`).
  - `widgetPlaceKind`: types + monitors, no Where → `"monitors"`; types alone, no Where → `"none"`;
    types with a county → `"monitor-types"`.
  - `idleTypes`: `["airnow"]` with no Where; `[]` with a county; `[]` with the pollutant on None.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/shared/input.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above in `input.ts`. Update doc comments (no
  "everywhere"). Delete `drawnWithNoWhere` from `src/lib/data/adapters/offered.ts` if this was its
  only use (it was: `input.ts:258`).
- [ ] **Step 4: Run** `npx vitest related --run src/lib/widgets/shared/input.ts src/lib/data/adapters/offered.ts`
  → PASS (fix tests that asserted everywhere behaviour, to the new rule), then `npm run check`,
  `npm run lint`.
- [ ] **Step 5: Commit** `git add <files> && git commit -m "Ticked monitor types draw only inside a Where"`.

### Task 2: No "everywhere" in the data layer

**Files:**
- Modify: `src/lib/data/types.ts` (`Target`), `src/lib/data/adapters/targets.ts`,
  `air-quality.ts`, `air-quality-fetch.ts`, `weather.ts`, `pesticides.ts`, `forecasts.ts`,
  `smoke.ts`, `src/lib/data/query/client.ts`, `query/key.ts`, `src/lib/data/messages.ts`,
  `src/lib/data/now/forecast-days.ts`, `src/lib/data/now/heat.ts`,
  `src/lib/data/snapshot/types.ts`, `snapshot/monitors.ts`,
  `src/lib/widgets/shared/WidgetState.svelte`, `messages/en.json`
- Test: the matching `*.test.ts` files (`targets`, `air-quality`, `weather`, `pesticides`,
  `forecasts`, `smoke`, `client`, `key`, `snapshot/monitors`), `src/lib/data/csv.test.ts` if it
  covers the valley series

**Interfaces:**
- Consumes: Task 1 (`queryLayer` never carries `monitorTypes` without a Where).
- Produces:
  - `Target` has no `{ kind: "all" }` member; `monitor-set.regionKeys: string[]` (never null).
  - `layerTarget` with no Where and no monitors returns `{ unavailable: "place-unsupported" }`
    (unreachable from widgets; keeps the function total).
  - The air-quality adapter's internal bulk request (`bulkReq` in `fetchMonitorSet`) uses a
    private target kind local to `air-quality.ts` (e.g. `{ kind: "bulk" }` on an internal request
    type), not part of `Target`.
  - `UNAVAILABLE_REASONS` loses `"whole-layer-raw"` (and its two message keys,
    `data_unavailable_whole_layer_raw`, `widget_state_unavailable_whole_layer_raw`).
  - Snapshot `MonitorScope` loses `{ kind: "all" }`; `monitor-set.regionIds: string[]`.

- [ ] **Step 1: Write/rewrite the failing tests**:
  - `targets.test.ts`: "no Where and no monitors is unavailable (place-unsupported)" (replaces
    `:278`); delete "no Where and types give a monitor-set with regionKeys null" (`:78`).
  - `snapshot/monitors.test.ts`: delete the `"all"` and null-region cases (`:46`, `:103`,
    `:153`, `:223`); keep "a monitor set asks for its types in its regions, and its searched
    monitors" (`:77`).
  - Delete weather's, pesticides', client's and key's whole-layer tests (inventory §9).
- [ ] **Step 2: Run** `npx vitest run src/lib/data/adapters/targets.test.ts` → FAIL.
- [ ] **Step 3: Remove `{ kind: "all" }` from `Target`** and let `npm run check` list every
  branch; delete each dead one: weather's `fetchEveryStation` / `stationTypes`; pesticides'
  `VALLEY_PLACE`, `useOf(null)` and the `"all"` series naming, and the `data_place_valley` key;
  forecasts/smoke/heat/forecast-days `"all"` refusals and the `"everywhere"` key; client's
  `whole-layer-raw`; key's default. Make `whereRegionKeys` return `string[] | { unavailable }`
  (no Where → `{ unavailable: "place-unsupported" }`). Remove snapshot `"all"` and null
  `regionIds` (`scopeRequests` keeps the per-region request plus the searched ids').
- [ ] **Step 4: Run** `npx vitest related --run <each src file changed>` → PASS; `npm run check`;
  `npm run lint`. Run `npx playwright test e2e/get-data.spec.ts -g "with no Where"` and rewrite
  those three tests to the new rule (no Where: the empty message; no "Whole valley"); remove the
  valley-wide fixture from `e2e/fixtures.ts` / bulk no-region answer from `e2e/map-data-server.ts`
  if nothing uses them after Task 4.
- [ ] **Step 5: Commit** `"No everywhere target: a widget with no Where asks for nothing"`.

### Task 3: Chart and Table: overlays and the ticks note

**Files:**
- Modify: `src/lib/widgets/shared/overlays.ts` (`everywhereMain` and its branch in
  `overlayInputsFor` go), `src/lib/widgets/shared/misfit-notes.ts` (`noWhereNotes` goes;
  `idleTypesNote` added), `src/lib/widgets/chart/ChartWidget.svelte`,
  `src/lib/widgets/table/DataTable.svelte`, `messages/en.json` (`widget_overlay_needs_place` goes)
- Test: `overlays.test.ts`, `misfit-notes.test.ts` (create if absent),
  `chart-widget.browser.test.ts`, `data-table.browser.test.ts`

**Interfaces:**
- Consumes: `idleTypes`, `drawnMonitors` (Task 1).
- Produces: `idleTypesNote(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined, editable: boolean): string | null`:
  a note only when `idleTypes(data, catalog).length > 0` and the widget draws something
  (`drawnMonitors(...).monitors.length > 0`); with nothing drawn the empty message covers it.
  Keys: `widget_types_need_place` "Add a place to show ticked monitor types." and
  `widget_types_need_place_view` "Ticked monitor types aren't shown: this has no place." Reused
  by the Map (Task 4).

- [ ] **Step 1: Failing tests:** `idleTypesNote` returns the editor text for types + a monitor
  and no Where, the viewer text with `editable: false`, `null` with a county, `null` with types
  alone (nothing drawn). Chart browser test "a Chart with ticked types and a searched monitor and
  no Where shows the monitor and the ticks note". Delete `overlays.test.ts:260` ("an everywhere
  main's overlays are never fetched").
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/shared/misfit-notes.test.ts` → FAIL.
- [ ] **Step 3: Implement**; Chart and Table render the note where `noWhereNotes` rendered.
- [ ] **Step 4: Run** the four test files (`-t` narrowed for the browser ones) → PASS; check; lint.
- [ ] **Step 5: Commit** `"Chart and Table say when ticked types need a place"`.

### Task 4: The Map with no Where

**Files:**
- Modify: `src/lib/widgets/map/data/scope.ts` (`whereRegionIds` no `null`; `monitorScope` no
  `"*"`), `map/data/monitors.ts` (`scopeReadings` null branch goes),
  `map/data/locations.ts` (`"everywhere"`, `VALLEY`, valley cache entry go; no Where → `[]`, no
  request), `map/MapWidget.svelte` (`mapNotes`, idle message), `messages/en.json`
- Test: `scope.test.ts`, `monitors.test.ts`, `locations.test.ts`, `map-widget.browser.test.ts`,
  `e2e/map.spec.ts` (`:2277` child care valley test)

**Interfaces:**
- Consumes: `idleTypes`, `idleTypesNote` keys (Tasks 1, 3).
- Produces: `locationAreas` returns `string[] | { unavailable }` (`[]` with no Where).
  New keys: `map_sites_need_place` "Add a place to show {layers}." (`layers`: the ticked groups'
  labels, `formatList`), `map_sites_need_place_view` "{layers} aren't shown: this map has no
  place.", `map_empty_add_place` "Choose a place for this map in Edit data." (and a viewer form if
  the idle message has one today).

- [ ] **Step 1: Failing tests:**
  - `locations.test.ts`: "no Where loads no sites and makes no request" (replaces `:206`, `:244`,
    `:253`).
  - `scope.test.ts`: replace "ticked types with no Where are everywhere" (`:56`) with
    "searched monitors with no Where are the monitors" (types never reach it: `queryLayer`).
  - `map-widget.browser.test.ts`: replace `:614` with "with no Where, ticked types draw nothing
    and the ticks note shows; smoke still draws"; "with no Where and Child care ticked, the sites
    note shows and nothing loads"; "a Map whose only layers need a place, with no Where, asks for
    a place" (`map_empty_add_place`); keep `:550`.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/data/locations.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The Map is idle only when nothing at all draws; the idle text is
  `map_empty_add_place` when some ticked layer would draw with a place, else today's
  `map_empty_add_layers`. Notes go in `mapNotes` (editor/viewer forms by the Map's existing
  editable flag).
- [ ] **Step 4: Run** the four unit/browser files (`-t` narrowed), then
  `npx playwright test e2e/map.spec.ts -g "Child care"` (rewritten: no Where → the sites note, no
  valley request); check; lint.
- [ ] **Step 5: Commit** `"The Map with no Where: place-less layers draw, the rest say what to add"`.

### Task 5: The Data Portal's Where reads "None"; the ticks hint

**Files:**
- Modify: `src/lib/get-data/GetDataView.svelte` (`whereEmptyText` for every type),
  `src/lib/get-data/WhereControl.svelte` (doc for `emptyText`/`clearable`; the
  `get_data_where_everywhere` fallback goes), `src/lib/get-data/AirQualitySection.svelte` (hint),
  `messages/en.json`
- Test: `get-data-view.browser.test.ts` (`:935`, `:944`, `:972`, `:1001`, `:1178`),
  `air-quality-section.browser.test.ts`, `e2e/show-in.spec.ts:266`

**Interfaces:**
- Consumes: `idleTypes` (Task 1).
- Produces: keys `get_data_where_none` "None", `get_data_where_none_monitors` "None: showing the
  monitors chosen in What", `get_data_types_need_place` "Ticked types show only inside Where's
  places. Add a place to show them."; `get_data_where_everywhere` removed. "Places cleared." stays.

- [ ] **Step 1: Failing tests:** "Where with no places reads None" (`:935`); "Clear goes back to
  None, focuses Change places, says so" (`:944`); "searched monitors with no Where read None:
  showing the monitors chosen in What" (`:972`); "Reference-grade ticked with no Where reads None
  and the ticks hint shows under the types" (`:1001`); `:1178` expects "None".
- [ ] **Step 2: Run** `npx vitest run src/lib/get-data/get-data-view.browser.test.ts -t "None"` → FAIL.
- [ ] **Step 3: Implement.** Single-place types keep `get_data_where_one_monitor` /
  `get_data_where_place_or_monitor`. The hint sits under the monitor-type ticks (muted `text-xs`,
  like the section's other hints), only while `idleTypes(draft.data)` is non-empty.
- [ ] **Step 4: Run** the two browser files (`-t` narrowed) and
  `npx playwright test e2e/show-in.spec.ts -g "viewer's Show in a chart"`; check; lint.
- [ ] **Step 5: Commit** `"Data Portal: an empty Where reads None; ticks without a place say so"`.

### Task 6: No stale title on an empty widget

**Files:**
- Modify: `src/lib/widgets/shared/data-widget.svelte.ts` (title effect); any other
  `setGeneratedTitle` writer that sets only from ready data (`current/CurrentWidget.svelte`,
  `outside/OutsideWidget.svelte`, `forecast/ForecastWidget.svelte`, `map/map-title.svelte.ts`:
  check each)
- Test: `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Produces: with `input === null` (empty), `DataWidget` sets
  `dataTitle({ entryLabel, places: [], range, viewer })` (`widget_title_no_place`).

- [ ] **Step 1: Failing test:** "Clear drops the place from the preview's title, and a new place
  brings it back": default Chart → Clear → preview heading lacks "Fresno County" → pick a county
  → heading names it.
- [ ] **Step 2: Run** it → FAIL (title keeps "Fresno County").
- [ ] **Step 3: Implement** in the title effect; for the other writers, fix the same way only if
  they show the stale case.
- [ ] **Step 4: Run** the test file `-t "title"`; check; lint.
- [ ] **Step 5: Commit** `"An empty widget's title drops its old place"`.

### Task 7: The raw reason names the place

**Files:**
- Modify: `src/lib/data/dataset-rules.ts`, `src/lib/get-data/DataResolutionControl.svelte`,
  `src/lib/get-data/dataset-offer.ts`, `src/lib/widgets/shared/misfit-notes.ts`, their callers
  (`GetDataView.svelte`, `ChartWidget.svelte`, `DataTable.svelte`), `messages/en.json`
- Test: `dataset-rules.test.ts`, `dataset-offer.test.ts`, `misfit-notes.test.ts`,
  `resolution-offer.test.ts` or the Data Resolution browser test that covers the reason

**Interfaces:**
- Produces: `rawCause(layer: Layer, catalog: CatalogEntry[], place: PlaceKind): "area" | "monitor-types" | "dataset" | null`
  (`null` when raw is offered): `area` / `monitor-types` when the dataset offers raw but `noRaw`
  removes it, else `dataset`. Callers pass the place kind (`widgetPlaceKind`).
  `misfitNotes(overlays, effective, editable, place: PlaceKind)`.
  Keys (approved wording; "by the hour" only when the finest level offered there is `hour`, else
  the level-free sentence):
  - `get_data_resolution_raw_area_hour` "Air quality for an area is summarized by the hour.
    Search for monitors in What to see every measurement." / `get_data_resolution_raw_area`
    "Air quality for an area is summarized. Search for monitors in What to see every measurement."
  - `get_data_resolution_raw_types_hour` / `get_data_resolution_raw_types`: the same with
    "Ticked monitor types are summarized…".
  - `get_data_dataset_raw_area` "Air quality for an area is summarized. Set the data resolution
    to {level} to add it." / `get_data_dataset_raw_types` "Ticked monitor types are summarized.
    Set the data resolution to {level} to add it."
  - `widget_layer_raw_area` "{dataset} isn't shown: air quality for an area is summarized, with
    no individual measurements. Change the data resolution in the Data Portal." and
    `widget_layer_raw_area_view` (without the last sentence); `widget_layer_raw_types` /
    `_view` with "ticked monitor types".
  - `dataset` keeps today's keys.

- [ ] **Step 1: Failing tests:** `rawCause` for PM2.5 at `regions` → `"area"`, at
  `monitor-types` → `"monitor-types"`, at `monitors` → `null`; weather at `regions` →
  `"dataset"`. `dataset-offer`: adding PM2.5 at a county with resolution raw gives the area
  sentence. `misfitNotes`: a PM2.5 overlay at `regions`, effective raw, editable → the area
  sentence; viewer → the view form. Data Resolution: the greyed raw radio at a county reads the
  `_hour` area sentence.
- [ ] **Step 2: Run** `npx vitest run src/lib/data/dataset-rules.test.ts` → FAIL.
- [ ] **Step 3: Implement**; finest offered level from `layerOffers(...)[0]`-style data, not
  hardcoded.
- [ ] **Step 4: Run** the touched test files; check; lint.
- [ ] **Step 5: Commit** `"The raw-resolution reason names the place"`.

### Task 8: Forecast → the calendars

**Files:**
- Modify: `src/lib/get-data/GetDataView.svelte` (`showAs` block data), `src/lib/get-data/now.ts`
  (`NowDropped` gains `"forecast"`; `rangeDraftOf` adds it when it turns a strip layer into
  PM2.5), `GetDataView.svelte` notes, `messages/en.json`
- Test: `now.test.ts`, `get-data-view.browser.test.ts`

**Interfaces:**
- Produces: `fromNowDraft(draft, type)` returns `dropped` containing `"forecast"` when a Forecast
  strip's layer became PM2.5. Key `get_data_forecast_as_pollutant` "{forecast} has no pollutant
  of its own, so this shows {pollutant}. Change the pollutant in What." (`forecast`: the
  `forecasts` dataset's catalog label; `pollutant`: PM2.5's).
  Show as: for a draft whose type `offersNow` and isn't the Map, a range type is checked with
  `typeBlock(t, fromNowDraft(plain, t).draft.data, known, now)`.

- [ ] **Step 1: Failing tests:** `now.test.ts` "a Forecast strip as a Month calendar shows PM2.5
  at its place, noting the forecast" (`dropped` has `"forecast"`; layer `air-quality/pm25`) and
  "…with its monitor and no Where keeps the monitor". Browser: "with Forecast chosen, the month
  and year calendars are offered; choosing one notes the pollutant".
- [ ] **Step 2: Run** `npx vitest run src/lib/get-data/now.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files (`-t` narrowed); check; lint.
- [ ] **Step 5: Commit** `"Forecast converts to the calendars, with a note"`.

### Task 9: "Data Portal" as a ghost button

**Files:**
- Modify: `src/lib/components/shell/TopNav.svelte`
- Test: `src/lib/components/shell/shell.browser.test.ts`

- [ ] **Step 1: Failing test:** "the Data Portal link has the picker's button height and keeps
  aria-current with its underline": same `getBoundingClientRect().height` as the picker trigger;
  `aria-current="page"` on `/data`.
- [ ] **Step 2: Run** `npx vitest run src/lib/components/shell/shell.browser.test.ts -t "Data Portal"` → FAIL.
- [ ] **Step 3: Implement:** `class={[buttonVariants({ variant: "ghost" }), "aria-[current=page]:shadow-[inset_0_-2px_var(--color-primary)] dark:aria-[current=page]:shadow-[inset_0_-2px_var(--color-highlight)]"]}`.
- [ ] **Step 4: Run** the test; check; lint. Screenshot the top bar at 1280 px and 375 px, light
  and dark, with the scratchpad Playwright script, and look at them.
- [ ] **Step 5: Commit** `"Nav: Data Portal matches the dashboard picker"`.

### Task 10: The legend starts folded

**Files:**
- Modify: `src/lib/widgets/map/MapLegendOverlay.svelte` (`shown = open ?? false`; drop `narrow`
  and its caller's prop if unused)
- Test: `map-widget.browser.test.ts` (the legend tests)

- [ ] **Step 1: Failing test:** "the legend starts folded on a wide Map; Legend opens it and the
  choice is kept".
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS (update tests expecting it open on wide);
  check; lint.
- [ ] **Step 5: Commit** `"Map legend starts folded"`.

### Task 11: The starter layout

**Files:**
- Modify: `src/lib/starter/starter.ts` (`starterWidgets` rects, order by reading order)
- Test: `src/lib/starter/starter.test.ts`; E2E relying on the starter (`e2e/starter.spec.ts`,
  `arranging.spec.ts`, `finish-line.spec.ts`, `a11y.spec.ts`: grep for widget order/rows)

**Interfaces:**
- Rects (spec): Note 0,0,12,2; Map 0,2,6,7; Current 6,2,3,3; Forecast 6,5,3,4; Outside 9,2,3,7;
  Chart 0,9,6,7; Month calendar 6,9,6,7. Data and options unchanged.

- [ ] **Step 1: Failing test:** "the starter's rects are the 2026-11-25 layout, in reading order,
  16 rows".
- [ ] **Step 2–4:** run → FAIL; implement; run → PASS; check; lint; run the grep-found E2E specs
  (`npx playwright test <files>`). Screenshot the starter at 1280 px and 375 px and check Current
  conditions (3×3) and the Forecast strip (3×4) read well.
- [ ] **Step 5: Commit** `"Starter: the new layout"`.

### Task 12: Fullscreen Map zooms without Ctrl (after `@sjvair/map-sdk` `0.1.0-beta.26` is published)

**Files:**
- Modify: `package.json`, `package-lock.json` (exact `0.1.0-beta.26`),
  `src/lib/widgets/map/MapWidget.svelte` (effect), `map/test-harness/fake-map.svelte.ts`,
  `CLAUDE.md` / `ARCHITECTURE.md` pins
- Test: `map-widget.browser.test.ts`

**Interfaces:**
- Consumes: `MapContext.setCooperativeGestures(on: boolean): void`,
  `MapContext.cooperativeGestures: boolean` (readonly, reactive).

- [ ] **Step 1:** wait for the coordinator's "published" message; `npm install --save-exact @sjvair/map-sdk@0.1.0-beta.26`.
- [ ] **Step 2: Failing test:** "fullscreen turns cooperative gestures off; leaving turns them on"
  (fake map records calls).
- [ ] **Step 3: Implement:** `$effect(() => map?.setCooperativeGestures(!fullscreen))`; fake map
  gains both members. Check beta.24/25 changes: the Map toolbar, the `Record<MessageKey>` table,
  `npm run check`.
- [ ] **Step 4: Run** `npx vitest related --run src/lib/widgets/map/MapWidget.svelte`; check; lint;
  `npm run build && npm run check:budget`.
- [ ] **Step 5: Commit** `"Map: no Ctrl needed while fullscreen; map-sdk 0.1.0-beta.26"`.

### Task 13: Docs

**Files:** `ARCHITECTURE.md` (`:179`, `:1580`, `:1632`, `:1980–2035`, `:2676`, `:3917–3919` and
the raw/Forecast/nav/legend/starter mentions), `DEFERRED.md`, `TODO.md`, `ROADMAP.md`

- [ ] Rewrite "No Where means everywhere" → "No Where means nothing from Where" and the What/Where
  section to the spec's rule (searched monitors still show; ticked types only inside Where;
  place-less Map layers draw; notes explain idle ticks).
- [ ] `DEFERRED.md`: add "Data Portal preview didn't update after Clear → Fresno County (not
  reproduced)" with why (not reproduced on dev or stack, 2026-11-25; set aside by the user since
  the empty Where changed) and revisit (seen again after this ships); remove "Overlays with no
  Where" (done: no everywhere main remains; say so in the commit);
  update "The Map's schools and child care sites are kept for the session" (no valley-wide list)
  and the spec 7a leftovers (`replace.test` no-Where line, `scopeRequests` second request) as
  they now read. Add any deferral the build makes.
- [ ] `TODO.md` / `ROADMAP.md`: this work's status.
- [ ] Commit `"Docs: an empty Where means nothing"` (can run beside Tasks 9–11).

### Task 14: Finish

- [ ] Push; dispatch CI `e2e-full` on the head after Task 8 (`gh workflow run` as the repo's CI
  docs say) and read results by `headRefOid`.
- [ ] `git fetch origin && git merge origin/main` (resolve before formatting); `npm run check`,
  `npm run lint`, `npm run build`, `npm run check:budget` (report the number).
- [ ] Fresh whole-branch review on the most capable model (report to a file, brief reply); fix
  its findings; rerun touched tests.
- [ ] Full local suites only if CI or the review calls for them (the user, 2026-11-25).
- [ ] Open the PR into `main` (no AI attribution); read its `headRefOid`; check CI on it. Merge
  only on the user's own yes in this session.
