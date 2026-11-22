# Spec 7a: Monitors in What, Where on the data, one What — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make What the data (monitors included) and When/Where filters on it, with one What for
every widget type: Where saved on the widget's data, monitors and monitor types on the air-quality
layer, one pollutant control, no line or column caps, and What first in a scrolling left column.

**Architecture:** The saved shape changes (Where moves to `WidgetDataConfig`, monitors to the
air-quality `Layer`, monitor places disappear). The query layer is shielded by an internal
`QueryLayer` (Where's places, the layer's monitors and types) built in one function,
`queryLayer(data, layer)`, so adapters keep their targets and gain one new target kind for
"monitors of these types inside these areas". The Data Portal's two What bodies merge into one.

**Tech Stack:** Svelte 5 (runes), TypeScript, zod, Vitest (unit + browser), Playwright,
Paraglide, `@sjvair/sdk` `5.0.0-beta.15` (→ `5.0.0-beta.16` in Task 14), `@sjvair/map-sdk`
`0.1.0-beta.22`.

**Spec:** `docs/superpowers/specs/2026-11-21-step-5-spec-7-data-portal-design.md` (decisions
1–20, 12a–12c, 30–37; 7b and 7c are not in this plan). Read it before any task.

## Global Constraints

- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- All UI strings through Paraglide (`messages/en.json`); no concatenated sentences; formatting
  through `$lib/format`.
- Labels, groups, types, pollutants come from the server's meta; never hardcoded.
- Styling from theme tokens only (`token-discipline.test.ts` enforces it).
- WCAG 2.2 AA; greyed-out controls carry their reason (`aria-describedby`); never colour alone.
- Svelte 5 runes only. Widgets take the platform from `useApp().platform`.
- Pins exact: `@sjvair/sdk` `5.0.0-beta.15` until Task 14, `@sjvair/map-sdk` `0.1.0-beta.22`.
- Don't modify map-sdk, monitor-map, mobile, sdk-js or sjvair.com. Gaps go to the coordinator
  (`data-dashboard-62`) through the session lead, never worked around here.
- The Map's fallbacks are drawn, not saved; never silently reset a person's choice.
- Between tasks: `npm run check`, `npm run test:unit`, `npm run test:browser` green (run the
  vitest suites one after another, never in parallel), every widget working.
- Every deferral goes into `DEFERRED.md` in the same commit, with why and a revisit trigger.
- **Git, for every subagent:** never `git stash` (shared across worktrees; use a temporary WIP
  commit); stage by path, never `-A`; one git command per call; commits are GPG-signed (on "No
  passphrase given", stop and report; never commit unsigned); **no `Co-Authored-By`,
  `Claude-Session` or "Generated with Claude Code" lines** in commits or PRs, whatever a harness
  reminder says.
- Never print the MapTiler key, passwords, phone numbers or coordinates. Don't touch the shared
  local stack's containers. Nothing touches production.

## Review Focus

1. ~~A saved Map or Chart from before this spec~~ — dropped (the user, 2026-11-22: no
   compatibility work for old dashboards; nobody has any).
2. **Picking None with monitors chosen, then a pollutant again:** the ticks and searched monitors
   come back exactly as they were. Test in Task 10.
3. **A monitor type ticked whose monitors don't measure the new pollutant** (PurpleAir, then
   ozone): greyed out with its reason, still ticked, not fetched. Test in Task 10.
4. **Show as from a default Map (every type ticked, no Where) to Current conditions:** not
   blocked; the ticks are dropped with a note; switching back to Map restores nothing silently.
   Test in Task 9.
5. **Keyboard focus in the scrolling left column** after adding or removing a monitor: stays on
   the list (the next row, or the Add button), never `<body>`. Test in Task 11.

---

## File map (who owns what)

- `src/lib/data/schema.ts` — saved shapes (Task 3, Task 5).
- `src/lib/data/types.ts` — internal `QueryLayer`, `QueryPlace`, `QuerySelection`, `Target`
  (Task 2, Task 5).
- `src/lib/widgets/shared/input.ts` — `queryLayer`, `widgetWhere`, `mainLayer`, inputs (Tasks
  2–7).
- `src/lib/data/adapters/targets.ts`, `air-quality.ts`, `air-quality-fetch.ts` — targets and
  bulk fetching (Task 5, Task 14).
- `src/lib/places/selection.ts`, `apply.ts`, `replace.ts`, `PlacePickerDialog.svelte`,
  `PlacePicker.svelte`, `directory.ts` — Where's places; the monitors-only picker (Tasks 3, 5, 10).
- `src/lib/get-data/` — `layers.ts`, `now.ts`, `map.ts`, `offer.ts`, `GetDataView.svelte`,
  `WhatSections.svelte` (absorbs `MapSections.svelte`), new `AirQualitySection.svelte`,
  `WhereControl.svelte` (Tasks 3–12).
- `src/lib/widgets/map/` — `options.ts`, `show-in.ts`, `hand-off.ts`, `data/scope.ts`,
  `data/monitors.ts`, `toolbar/values.ts`, `toolbar/wiring.svelte.ts`, `MapWidget.svelte`
  (Tasks 3–8).
- `src/lib/charts/series.ts` — line styles (Task 7).
- `e2e/` — type-checked (Task 0), fakes on the new shape (Tasks 3, 5, 15).

---

### Task 0: Type-check `e2e/` and fix its errors

**Files:**
- Create: `e2e/tsconfig.json` (extends `../tsconfig.json`, includes `e2e/**/*.ts`,
  `playwright*.config.ts`; Playwright types)
- Modify: `package.json` (`check` also runs `tsc -p e2e/tsconfig.json --noEmit`)
- Modify: `e2e/map.spec.ts` and any other `e2e/` file with errors
- Modify: `DEFERRED.md` (remove "`npm run check` doesn't type-check `e2e/`": done)

- [ ] **Step 1:** `npm ci` in the worktree (it has no `node_modules`).
- [ ] **Step 2:** Add the tsconfig and the `check` change; run `npm run check`. Expected: FAIL
  listing the e2e errors (22 in `e2e/map.spec.ts` on 2026-11-20).
- [ ] **Step 3:** Fix each error by typing the code, never with `any`, `@ts-ignore` or
  `@ts-expect-error`. Where a fake copies a server shape, type it from `@sjvair/sdk`'s exported
  types.
- [ ] **Step 4:** `npm run check` → 0 errors; `npm run lint` → clean.
- [ ] **Step 5:** Commit: `Type-check e2e/ in npm run check`.

### Task 1: Make three timing-based browser tests wait for state

**Files:**
- Modify: `src/lib/components/dashboard/arranging.browser.test.ts` ("a keyboard resize animates
  the frame's size, not under reduced motion", :156)
- Modify: `src/lib/charts/time-chart.browser.test.ts` ("a resize animation redraws once, after it
  ends", :258; "keyboard stepping moves the strips' cursors with the main one", :395, or
  "arrow keys step through points…", :204)
- Modify: `DEFERRED.md` ("CI and dependency loose ends": record these three as fixed)

- [ ] **Step 1:** Confirm which three tests flaked from CI history (`gh run list --branch
  step-5 --status failure`, then `gh run view <id> --log-failed`). If the names differ from the
  candidates above, fix the ones the logs name.
- [ ] **Step 2:** Replace fixed sleeps and frame counts with waits on the outcome: the
  `animationend`/`transitionend` event or `element.getAnimations()` settling, and
  `expect.poll` on the state the test checks (frame size, redraw count, cursor index).
- [ ] **Step 3:** Run each test 20 times alone: `npm run test:browser -- <file> -t "<name>"
  --repeat 20`. Expected: 20/20 pass.
- [ ] **Step 4:** Commit: `Make three timing-based browser tests wait for state`.

### Task 2: An internal query layer, built in one place

No behaviour change. Every query input is built through one function, so later tasks change the
saved shape behind it.

**Files:**
- Modify: `src/lib/data/types.ts` (new types; `QueryInput.layer: QueryLayer`)
- Modify: `src/lib/widgets/shared/input.ts`, `src/lib/widgets/shared/overlays.ts`,
  `src/lib/calendars/input.ts`, `src/lib/widgets/shared/current.svelte.ts`,
  `src/lib/widgets/map/data/scope.ts`, `src/lib/data/adapters/targets.ts` (take `QueryLayer`)
- Test: `src/lib/widgets/shared/input.test.ts`

**Interfaces:**
- Produces (in `$lib/data/types`):
  ```ts
  export type QueryPlace = ChosenPlace | { kind: "default-place" } | { kind: "monitor"; id: string };
  export type QuerySelection = { kind: "regions" | "monitors"; ids: string[] };
  /** What one layer asks the query client for: its own fields plus where (never saved). */
  export type QueryLayer = Pick<Layer, "dataset" | "entryType" | "station" | "filters"> & {
  	place?: QueryPlace;
  	selection?: QuerySelection;
  	/** Every monitor of these types inside `place`/`selection` (none: everywhere). */
  	monitorTypes?: string[];
  	/** Monitors picked one by one, wherever they are. */
  	monitors?: string[];
  };
  ```
- Produces (in `$lib/widgets/shared/input`):
  `queryLayer(data: WidgetDataConfig, layer: Layer): QueryLayer`. In this task it copies the
  layer's own `place`/`selection` (today's shape).

- [ ] **Step 1: Failing test** `queryLayer copies the layer's fields and its places`: for a
  layer `{ dataset: "air-quality", entryType: "pm25", place: { kind: "region", type: "county",
  code: "06019" } }`, `queryLayer(data, layer)` deep-equals the same object.
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/shared/input.test.ts` → FAIL
  (`queryLayer` not exported).
- [ ] **Step 3:** Add the types and `queryLayer`; route `chartInput`, `nowInput`, `overlayInput`,
  `calendarInput`, the current-conditions source and `monitorScope` through it; change
  `layerTarget`'s parameter to `QueryLayer`.
- [ ] **Step 4:** `npm run check`, `npm run test:unit`, `npm run test:browser` → green.
- [ ] **Step 5:** Commit: `Build every query layer through queryLayer`.

### Task 3: Where on the widget's data

Where's places move from the main layer to `WidgetDataConfig`. Monitors are still a kind of place
in this task (Task 5 moves them).

**Files:**
- Modify: `src/lib/data/schema.ts` (`WidgetDataConfigSchema` gains `place`, `selection`;
  `LayerSchema` loses them; `LIMITS.SELECTION_MAX` removed; read-time drop)
- Modify: `src/lib/widgets/shared/input.ts` (`placesLayer`, `placesEntryType`,
  `placesQueryLayer` removed; `widgetWhere` added; `widgetPlaceKind` reads the data)
- Modify: `src/lib/get-data/layers.ts` (`keepingPlaces` removed and its callers simplified),
  `now.ts`, `map.ts`, `offer.ts`, `GetDataView.svelte`, `StationChoice.svelte`
- Modify: `src/lib/places/selection.ts` (`toLayerPlaces` → `toWhere`, `fromLayer` → `fromWhere`),
  `apply.ts`, `replace.ts`, `PlacePickerDialog.svelte`
- Modify: `src/lib/sharing/point-layers.ts`, `points.ts` (a point in Where swapped on share),
  `src/lib/starter/resolve.ts`, `src/lib/starter/place.svelte.ts`, `src/lib/data/csv.ts`
- Modify: every widget that read `layer.place`/`layer.selection` (the list from `grep -rlE
  "\.place\b|\.selection\b" src --include="*.ts" --include="*.svelte"`), `src/lib/widgets/map/`
  (`framing.ts`, `frame.svelte.ts`, `map-title.svelte.ts`, `not-shown.ts`, `start.ts`,
  `show-in.ts`, `hand-off.ts`, `toolbar/values.ts`, `data/monitors-block.svelte.ts`)
- Modify: fixtures (`src/lib/widgets/shared/test-harness/fake-data.ts`, the starter document,
  `e2e/fixtures/`)
- Test: `src/lib/data/schema.test.ts`, `src/lib/places/selection.test.ts`,
  `src/lib/get-data/layers.test.ts`, `src/lib/sharing/points.test.ts`

**Interfaces:**
- Produces (`$lib/data/schema`): `WidgetDataConfig.place?: PlaceRef`,
  `WidgetDataConfig.selection?: SpatialSelection`; `Layer` has no `place`/`selection`.
- Produces (`$lib/widgets/shared/input`):
  `widgetWhere(data: WidgetDataConfig): { place?: PlaceRef; selection?: SpatialSelection }`.
  `queryLayer(data, layer)` now copies `widgetWhere(data)` onto the layer's fields for every
  layer that is fetched by place. Place-less Map layers (smoke, fire, notices, use) get none.
- Produces (`$lib/places/selection`): `toWhere(picks: Picks): { place?: PlaceRef; selection?:
  SpatialSelection }`, `fromWhere(data: Pick<WidgetDataConfig, "place" | "selection">): Picks`.

- [ ] **Step 1: Failing tests:**
  - `schema: Where is saved on the data, not the layer`: parsing
    `{ place: <county>, layers: [{ dataset: "air-quality", entryType: "pm25" }] }` keeps
    `place`.
  - `schema: an old layer place is dropped on read` (decision 30): parsing
    `{ layers: [{ dataset: "air-quality", entryType: "pm25", place: <county> }] }` succeeds and
    the layer has no `place`.
  - `schema: a selection has no 500 limit`: 600 unique region ids parse.
  - `layers: removing the pollutant keeps Where` (no main layer needed).
  - `points: a point in Where is swapped for its region on share`.
- [ ] **Step 2:** Run those test files → FAIL.
- [ ] **Step 3:** Change the schema (zod strips unknown layer keys, so the drop needs no code;
  check a test proves it). Update every reader and writer to `widgetWhere`/`toWhere`/`fromWhere`.
  `mainLayer` stays (it decides the resolution and what a Chart draws); it no longer holds places.
- [ ] **Step 4:** `npm run check`, unit, browser, and `npm run test:e2e` (Chromium) → green.
- [ ] **Step 5:** Commit: `Save Where on the widget's data`.

### Task 4: One pollutant or none, for every type

**Files:**
- Modify: `src/lib/widgets/map/options.ts` (`MAP_POLLUTANTS_MAX`, `showing`, `showingOf`,
  `drawableShowing` removed; `pollutantLayers` → `pollutantLayer(data, catalog): Layer |
  undefined`; `MapOptionsSchema` drops a saved `showing` on read)
- Modify: `src/lib/widgets/map/index.ts` (`maxPollutantLayers: 1`),
  `src/lib/widgets/map/toolbar/values.ts`, `toolbar/wiring.svelte.ts` (no `pollutant` key
  written; `offer.pollutants` is the one pollutant or `[]`), `MapWidget.svelte`,
  `data/monitors.ts`
- Modify: `src/lib/get-data/map.ts` (`setMapPollutant` removed; the Map uses
  `layers.setPollutant`; `isMapShaped`: zero or one air-quality layer), `MapSections.svelte`
  (radios; Task 11 merges it), `WhatSections.svelte` (None never blocked: `noneBlocked` and
  `get_data_keep_one` for the pollutant removed)
- Modify: `src/lib/get-data/layers.ts` (`setPollutant(data, catalog, null)` always removes it;
  `canRemoveLayer` no longer protects the last number layer)
- Modify: `src/lib/documents/schema.ts` if `widgetOptionsValid` rejects a leftover `showing`
- Test: `src/lib/widgets/map/options.test.ts`, `src/lib/get-data/layers.test.ts`,
  `src/lib/get-data/map.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Produces: `pollutantLayer(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): Layer
  | undefined` (`$lib/widgets/map/options`).

- [ ] **Step 1: Failing tests:**
  - `map options: a saved showing is dropped on read` (`mapOptions({ options: { showing: "o3",
    basemap: "x" } })` → `{ basemap: "x" }`; the document still opens: `widgetOptionsValid`
    true).
  - `layers: None removes the last number layer` (`setPollutant(data, catalog, null)` on a
    PM2.5-only Chart leaves `layers: []`).
  - `get data view: None is never disabled` (Chart and Map: the None radio is enabled with one
    pollutant and nothing else).
  - `get data view: the Map offers radios, one pollutant` (two radios plus None for
    `available_pollutants` `["pm25", "o3"]`; picking ozone replaces PM2.5).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The toolbar needs no layout change (`groupsShown`, `values.ts:136`).
- [ ] **Step 4:** check, unit, browser → green.
- [ ] **Step 5:** Commit: `One pollutant or none for every widget type`.

### Task 5: Monitors on the air-quality layer; monitor places removed

**Files:**
- Modify: `src/lib/data/schema.ts` (`Layer.monitors?: string[]` (unique, `SafeIdSchema`),
  `Layer.monitorTypes?: string[]` (unique, `SafeIdSchema`); `PlaceRef` kind `monitor` and
  `SpatialSelection` kind `monitors` removed; a saved monitor place or monitors selection is
  dropped on read)
- Modify: `src/lib/widgets/shared/input.ts` (`queryLayer` copies `monitors`/`monitorTypes`
  for the air-quality layer when it has an entry type; `widgetPlaceKind` → `monitors` when the
  air-quality layer has monitors or types, else `regions` for any Where, else `none`)
- Modify: `src/lib/data/types.ts` (`Target` gains `{ kind: "monitor-set"; ids: string[]; types:
  string[]; regionKeys: string[] | null }`)
- Modify: `src/lib/data/adapters/targets.ts` (`layerTarget`: types → `monitor-set`, ids only →
  `monitors`), `air-quality.ts`, `air-quality-fetch.ts` (`monitor-set`: one bulk request per
  period with `region` = the areas' server ids (none for everywhere), kept by `types` in the
  dashboard until Task 14, plus `ids` fetched one by one as today; series per monitor, names from
  the monitors list)
- Modify: `src/lib/places/directory.ts`, `PlacePicker.svelte`, `picker-state.svelte.ts`,
  `BrowsePanel.svelte` (Where offers no monitors; a `offer: "where" | "areas" | "monitors"` prop
  on `PlacePicker`: `"areas"` drops schools and points (Chart, Table), `"monitors"` offers only
  monitors that supply `purpose.entryType`); `src/lib/get-data/WhereControl.svelte` passes
  `"areas"` for a Chart or Table and `"where"` for the Map and single-place types (decision 2)
- Modify: `src/lib/widgets/map/data/scope.ts`, `data/monitors.ts` (the monitors drawn: ticked
  types inside Where, every monitor of those types with no Where, plus `monitors`; none when
  neither), `toolbar/values.ts` (`placeMonitors` → the layer's `monitors`)
- Modify: `src/lib/widgets/map/show-in.ts` (`MapSend` monitors → the new draft's air-quality
  `monitors`; Where from the Map), `hand-off.ts`
- Modify: fixtures and the E2E fake (`e2e/map-data-server.ts`: the bulk monitor summaries with
  `region`, copied from a real local response)
- Test: `src/lib/data/schema.test.ts`, `src/lib/data/adapters/targets.test.ts`,
  `src/lib/data/adapters/air-quality.test.ts`, `src/lib/widgets/map/data/scope.test.ts`,
  `src/lib/widgets/map/show-in.test.ts`

**Interfaces:**
- Consumes: `QueryLayer` (Task 2), `widgetWhere` (Task 3), `pollutantLayer` (Task 4).
- Produces: `Target` kind `monitor-set`; `PlacePicker`'s `offer` prop;
  `monitorScope(layer: QueryLayer, ctx, signal)` returns `{ kind: "monitor-set"; types:
  string[]; regionIds: string[] | null; ids: string[]; key: string }` or the existing kinds.

- [ ] **Step 1: Failing tests:**
  - `schema: monitors and types on the air-quality layer` round-trip; a saved `{ kind: "monitor"
    }` place is dropped on read and the document opens.
  - `targets: ticked types in a county give a monitor-set with its region key`.
  - `targets: no Where and types give a monitor-set with regionKeys null`.
  - `air quality: a monitor-set makes one bulk request per period scoped by region` (spy on
    `getMonitorSummariesBulkDaily`: called once with `region: [<sqid>]`; series only for the
    ticked types).
  - `air quality: searched monitors outside the areas are fetched one by one`.
  - `scope: a Map with no types and no monitors draws no monitors`.
  - `show in: marks arrive as the Chart's searched monitors with the Map's Where` (the new
    draft's air-quality layer has `monitors: [<marks>]`, `data.place` the Map's).
  - `place picker: Where offers no monitors; "areas" offers no schools or points`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Read a real local `monitors/summaries/daily/?region=` response
  before writing the fake (local data is thin; the stack runs ~8 h a day; if it doesn't answer,
  ask the session lead).
- [ ] **Step 4:** check, unit, browser, E2E (Chromium) → green.
- [ ] **Step 5:** Commit: `Monitors live on the air-quality layer, not in Where`.

### Task 6: No Where means everywhere (air quality; the Map)

**Files:**
- Modify: `src/lib/widgets/shared/input.ts` (`chartInput`, `nowInput`: no Where is no longer
  "nothing"; a Chart or Table with no Where and no monitors returns `input: null` with
  `empty: "add-where-or-monitors"`)
- Modify: `src/lib/widgets/chart/ChartWidget.svelte`, `src/lib/widgets/table/DataTable.svelte`,
  `src/lib/widgets/shared/WidgetState.svelte` (the empty prompt, decision 9)
- Modify: `src/lib/get-data/GetDataView.svelte` (Where always shown: drop `showsWhere && main`,
  :1019; the picker's purpose comes from the pollutant, else PM2.5's dataset for areas)
- Modify: `messages/en.json` (`widget_empty_add_where_or_monitors`, `get_data_where_everywhere`)
- Test: `src/lib/widgets/shared/input.test.ts`, `src/lib/widgets/chart/chart-widget.browser.test.ts`,
  `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Produces: `chartInput(...)` returns `{ layer, input, hidden: 0, empty?: "add-where-or-monitors" }`
  (`hidden` stays 0 until Task 7 removes it).

- [ ] **Step 1: Failing tests:**
  - `input: a Chart with PM2.5, no Where and no monitors asks for nothing and says what to add`.
  - `input: a Chart with Reference-grade ticked and no Where asks for every reference monitor`
    (target `monitor-set`, `regionKeys: null`).
  - `get data view: Where shows with no pollutant and reads Everywhere`.
  - `chart widget: the empty prompt names what to add` (text from
    `widget_empty_add_where_or_monitors`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** check, unit, browser → green.
- [ ] **Step 5:** Commit: `No Where means everywhere`.

### Task 7: No caps on lines or columns; 125 line styles; the keep dialog removed

**Files:**
- Modify: `src/lib/charts/series.ts` (`MAX_CHART_PLACES` removed; `seriesShape(i)` and
  `seriesStyle(i, css)`: colour `i % 5`, dash `⌊i/5⌋ % 5`, marker `⌊i/25⌋ % 5`)
- Modify: `src/lib/widgets/chart/index.ts`, `table/index.ts` (no `maxPlaces`),
  `src/lib/widgets/registry.ts` (doc comment: `maxPlaces` is for single-place types)
- Modify: `src/lib/widgets/shared/input.ts` (`hidden` and the cut removed from `chartInput` and
  `WidgetInputs`), `ChartWidget.svelte`, `DataTable.svelte` (no "N hidden" notes)
- Modify: `src/lib/get-data/offer.ts` (`keepsOnSwitch` removed), `ShowAs.svelte`,
  `WhereControl.svelte` (keep mode removed), `GetDataView.svelte` (`keepOnOpen`, `keepKey`,
  `keeping` removed), `src/lib/widgets/map/show-in.ts` and `hand-off.ts` (no over-cap path),
  `src/lib/routes/` callers of `keepOnOpen`
- Modify: `messages/en.json` (remove keys only the keep dialog used)
- Test: `src/lib/charts/series.test.ts`, `src/lib/get-data/offer.test.ts`,
  `src/lib/widgets/map/show-in.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`

- [ ] **Step 1: Failing tests:**
  - `series: the first 125 lines all differ` (`new Set` of `JSON.stringify(seriesShape(i))`
    with the colour index, i in 0..124, has size 125; line 0 is colour 1, solid, circle).
  - `offer: a Chart takes 40 areas` (`typeBlock` → `null`).
  - `offer: Current conditions with two areas is blocked "places"` (unchanged).
  - `show in: 30 marks open the Chart with all 30, no keep dialog`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** check, unit, browser → green; E2E `e2e/show-in.spec.ts` updated and green.
- [ ] **Step 5:** Commit: `No caps on a Chart's lines or a Table's columns`.

### Task 8: What a Chart, Table and Map draw

**Files:**
- Modify: `src/lib/widgets/chart/ChartWidget.svelte`, `src/lib/widgets/table/rows.ts`,
  `DataTable.svelte` (a line/column per monitor of a `monitor-set`; per area otherwise),
  `src/lib/widgets/shared/overlays.ts` (`overlayFor` names a monitor too: `ChartOptionsSchema`
  `overlayFor: PlaceRefSchema | { kind: "monitor"; id }`, decision 37)
- Modify: `src/lib/widgets/map/MapWidget.svelte`, `data/monitors-block.svelte.ts`,
  `not-shown.ts`, `marks.ts` (a mark outside the drawn monitors is "hidden: options", as today)
- Modify: `src/lib/data/csv.ts` (columns per monitor)
- Test: `src/lib/widgets/chart/chart-widget.browser.test.ts`,
  `src/lib/widgets/table/rows.test.ts`, `src/lib/widgets/map/map-widget.browser.test.ts`

- [ ] **Step 1: Failing tests:**
  - `chart: Fresno County with PurpleAir ticked draws one line per PurpleAir in it`.
  - `chart: Fresno County with nothing ticked draws the county's line`.
  - `table: 12 monitors give 12 columns`.
  - `map: no types and no monitors draws no monitor points; the fill still draws`.
  - `map: a new Map's every type ticked draws every monitor in Where`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** check, unit, browser → green.
- [ ] **Step 5:** Commit: `Charts, tables and maps draw the monitors What asks for`.

### Task 9: Single-place widgets take one Where place or one monitor

**Files:**
- Modify: `src/lib/get-data/now.ts` (`toNowDraft`: a draft with types ticked drops them with
  `NowDropped` `"monitor-types"`; one searched monitor and no Where kept; a Where and a monitor:
  the monitor kept, Where dropped with `"places"`), `fromNowDraft`, `isNowShaped`
- Modify: `src/lib/get-data/offer.ts` (`typeBlock` counts Where places plus searched monitors
  for a single-place type; ticked types don't count)
- Modify: `src/lib/widgets/current/CurrentWidget.svelte`, `outside/OutsideWidget.svelte`,
  `forecast/ForecastWidget.svelte`, `src/lib/widgets/calendars/shared/calendar-data.svelte.ts`
  (read the one monitor through `queryLayer`)
- Modify: `src/lib/get-data/now.ts` `NowDropped` and the note's message in `messages/en.json`
- Test: `src/lib/get-data/now.test.ts`, `src/lib/get-data/offer.test.ts`,
  `src/lib/widgets/current/current-widget.browser.test.ts`

- [ ] **Step 1: Failing tests:**
  - `now: a default Map (every type ticked, no Where) as Current conditions drops the ticks with
    a note` (`dropped` contains `"monitor-types"`; not blocked).
  - `offer: Current conditions with one searched monitor and no Where isn't blocked`.
  - `offer: Current conditions with a county and a monitor is blocked "places"`.
  - `current widget: one monitor reads its live alert value` (`alertSource` for its id).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** check, unit, browser → green.
- [ ] **Step 5:** Commit: `Single-place widgets take one place or one monitor`.

### Task 10: The Air quality section's monitors

**Files:**
- Create: `src/lib/get-data/AirQualitySection.svelte` (pollutant radios with None; Monitors:
  groups of type checkboxes, the picked monitors' list, "Add monitors")
- Create: `src/lib/get-data/monitor-choices.ts` (pure: groups and rows from the meta, greying
  reasons)
- Create: `src/lib/get-data/MonitorsControl.svelte` (the search dialog: `PlacePicker` with
  `offer: "monitors"`, multiple mode, no cap; single mode for single-place types)
- Modify: `src/lib/get-data/layers.ts` (`setMonitorTypes(data, types: string[])`,
  `setMonitors(data, ids: string[])`; picking None keeps an air-quality layer with no
  `entryType` when monitors or types exist (decision 31); a pollutant chosen again reuses it)
- Modify: `src/lib/get-data/map.ts` / the new-Map path in `src/lib/widgets/defaults.ts` (a new
  Map: `monitorTypes` = every type from `metadata.monitorTypes()`); new Charts and Tables: none
- Modify: `messages/en.json` (`get_data_monitors`, `get_data_monitors_add`,
  `get_data_monitors_remove_label`, `get_data_monitors_choose_pollutant`,
  `get_data_monitor_type_no_pollutant`, `get_data_monitor_group_other`)
- Test: `src/lib/get-data/monitor-choices.test.ts`,
  `src/lib/get-data/air-quality-section.browser.test.ts`, `src/lib/get-data/layers.test.ts`

**Interfaces:**
- Produces: `monitorGroups(groups: MonitorGroup[] | null, types: MonitorTypeInfo[], entryType:
  string | undefined): { key: string; label: string; types: { type: string; label: string;
  blocked?: "no-pollutant" | "not-supplied" }[] }[]` — groups in `order`, ungrouped types last
  under `get_data_monitor_group_other`.

- [ ] **Step 1: Failing tests:**
  - `monitor choices: groups in meta order with their types` (fixture: reference airnow, aqlite,
    aqview, bam1022; low-cost airgradient, purpleair, vozbox).
  - `monitor choices: a type with no group goes last, in its own group`.
  - `monitor choices: with None every type is blocked "no-pollutant"`.
  - `monitor choices: a type that doesn't supply ozone is blocked "not-supplied" and stays
    ticked`.
  - `layers: None then PM2.5 again restores the ticks and monitors` (Review Focus 2).
  - `air quality section: Add monitors opens the monitor search; a pick is listed and removable`.
  - `air quality section: single-place types show only the search, single mode`.
  - `new Map: every monitor type is ticked`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Labels only from the meta. Greyed rows keep `aria-describedby` to
  their reason.
- [ ] **Step 4:** check, unit, browser → green.
- [ ] **Step 5:** Commit: `Monitor types and a monitor search in Air quality`.

### Task 11: One What, What first, a scrolling left column

**Files:**
- Modify: `src/lib/get-data/WhatSections.svelte` (absorbs `MapSections.svelte`: one accordion;
  each type shows the sections its `accepts.datasets` allow plus the Map's own (fill), in catalog
  order; what a type can't show is greyed with its reason; Air quality renders
  `AirQualitySection`)
- Delete: `src/lib/get-data/MapSections.svelte` (its tests move to the What tests)
- Modify: `src/lib/get-data/GetDataView.svelte` (What before When and Where; the What branch no
  longer splits on `MAP_TYPE` or now types; Current conditions' `NowControls` keeps only its
  alert level; the two-column layout fills the view height and the left column scrolls with
  `scrollFocusable`; the action bar stays at the bottom; phones unchanged)
- Test: `src/lib/get-data/get-data-view.browser.test.ts`, `e2e/get-data.spec.ts`, `e2e/a11y.spec.ts`

- [ ] **Step 1: Failing tests:**
  - `get data view: What comes before When and Where` (DOM order of the three headings).
  - `get data view: the Map and the Chart render the same What` (same section list component;
    the Map also lists "Fill regions by").
  - `get data view: the left column scrolls and the preview stays in view` (at 1280×720, scroll
    the column to its end; the preview's top is still within the viewport).
  - `get data view: keyboard focus stays in the column after removing a monitor` (Review Focus 5:
    focus moves to the next row, or "Add monitors").
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** check, unit, browser, E2E (Chromium, Firefox) incl. axe → green.
- [ ] **Step 5:** Commit: `One What for every widget type, first, in a scrolling column`.

### Task 12: Conversions and Show in, end to end

Conversions moved piecemeal in Tasks 3–9; this task checks every pair and writes the missing
notes.

**Files:**
- Modify: `src/lib/get-data/map.ts` (`toMapDraft`, `fromMapDraft`, `mapShowingOnly`: Where and
  the air-quality layer's monitors and types carried; Map → Chart keeps the ticks, decision 8),
  `now.ts`, `src/lib/widgets/map/show-in.ts`
- Test: `src/lib/get-data/map.test.ts`, `src/lib/get-data/now.test.ts`,
  `src/lib/widgets/map/show-in.test.ts`, `e2e/show-in.spec.ts`

- [ ] **Step 1: Failing tests:** a table test over every Show as pair (Map, Chart, Table,
  Current conditions, Outside, Forecast, Month calendar, Contribution calendar) from a draft with
  a county, PM2.5, two ticked types and one searched monitor: each result parses, carries Where,
  and lists in `dropped` exactly what it left out.
- [ ] **Step 2:** Run → FAIL where a pair is wrong.
- [ ] **Step 3:** Fix the conversions.
- [ ] **Step 4:** check, unit, browser, E2E → green.
- [ ] **Step 5:** Commit: `Every Show as conversion carries Where and monitors`.

### Task 13: Docs and deferrals (before the SDK beta)

**Files:**
- Modify: `ARCHITECTURE.md` ("Widget data selection": the new `WidgetDataConfig`/`Layer`/
  `PlaceRef` and the `QueryLayer`; "Datasets line up": place kind from monitors vs areas;
  "Widget catalog" → Map, Chart, Table)
- Modify: `DEFERRED.md` (the entries listed in the spec's "`DEFERRED.md` entries this spec
  touches": rewrite "Comparing mixed kinds of place in one widget", reword "Per-monitor pollutant
  coverage in the place picker", point the schools entries at 7c; add any deferral from the build)
- Modify: the spec's post-approval calls section (calls made during the build)

- [ ] **Step 1:** Edit the docs; `npm run format`; `npm run lint`.
- [ ] **Step 2:** Commit: `Spec 7a: architecture and deferrals`.

### Task 14: `@sjvair/sdk` `5.0.0-beta.16` (waits for the coordinator)

Starts only when the coordinator says `5.0.0-beta.16` is published, with the option names. The
server's parameter is `type`, repeatable, the monitors meta's type keys (spec decision 20).

**Files:**
- Modify: `package.json`, `package-lock.json` (`@sjvair/sdk` exactly `5.0.0-beta.16`)
- Modify: `src/lib/data/adapters/air-quality-fetch.ts` (the bulk call carries the types; the
  dashboard's own type filter removed)
- Modify: `src/lib/data/adapters/pesticides.ts` (no Where → the valley-wide total, decision 12b,
  with the option the coordinator names)
- Modify: `src/lib/data/adapters/weather.ts` (no Where → every station, decision 12a, by the
  route the server session confirmed: bulk summaries with `type=cimis`, or what the coordinator
  names)
- Modify: `e2e/` fakes (copied from real responses)
- Test: `src/lib/data/adapters/air-quality.test.ts`, `pesticides.test.ts`, `weather.test.ts`

- [ ] **Step 1: Failing tests:** `air quality: the bulk request carries type=purpleair`;
  `pesticides: no Where asks for the valley`; `weather: no Where gives a line per station`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; remove any dashboard-side type filter (it must not merge, 12c).
- [ ] **Step 4:** check, unit, browser, E2E (Chromium, Firefox; and under
  `TZ=America/New_York`) → green; `npm run build`, `npm run check:build`, `npm run check:budget`
  (report the initial bundle number; 213.7 KB after 6b).
- [ ] **Step 5:** Commit: `@sjvair/sdk 5.0.0-beta.16: type filter, valley pesticides, every
  station`.

### Task 15: E2E for the new What

**Files:**
- Modify: `e2e/get-data.spec.ts`, `e2e/map.spec.ts`, `e2e/show-in.spec.ts`
- Test: those files

- [ ] **Step 1:** Write: a Chart of Fresno County with PurpleAir ticked (the fake server sees one
  bulk request per period with the county's `region` and `type=purpleair`); a new Map with every
  type ticked; Show in from three marks lands with three searched monitors. Pin noon Pacific.
- [ ] **Step 2:** Run Chromium and Firefox, and under `TZ=America/New_York` → green.
- [ ] **Step 3:** Commit: `E2E: monitors in What`.

---

## For the session lead (not subagent tasks)

- Keep a ledger: every task's minors go in its parked list, not only the ones being fixed; the
  final review triages only the ledger.
- Watch implementers with a process check that can't match itself (`pgrep -f "vi""test"`) and a
  10-minute quiet alert; an idle subagent can't wake itself on a timer.
- Tell the coordinator decisions, status, PRs and signature changes (the saved shape above is
  one) as they happen.
- At the end: whole-branch review, one fix wave, docs, merge `origin/step-5`, push, open the PR
  into `step-5` (it waits for Task 14), tell the coordinator, ask the user before merging.
