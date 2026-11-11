# Step 5 spec 1: the Map widget (core): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lazily loaded **Map** widget on `@sjvair/map-sdk` that shows live monitors for its
pollutant and frames the widget's places. One region is outlined; one monitor is highlighted; a
school gets a pin; a point is framed on its region with a pin; several places are highlighted and
fitted. Its places are its places layer, edited through the shared place picker, followed by
"Change place", and held to the location-privacy rules.

**Architecture:** The descriptor (initial bundle) is a data type that's also directly addable
(`addable(doc)` gives PM2.5 at the dashboard's place). Everything map-related loads with
`load: () => import("./module")`:

- **A host module** sets map-sdk up once per page: Paraglide message table, `format` provider,
  shared metadata provider, one shared monitors store per entry type, and the key.
- **A pure "framing" module** turns the layer into what to highlight, outline, pin and fit. It
  includes a small region-geometry cache and the point → region lookup.
- **The component** wires `MapView` and the plugins, the idle and unavailable states, the title,
  and the on-screen/visible lifecycle.

Get data learns that a "now" type may hold several places (`accepts.maxPlaces`), and that the
map's pollutants are the monitors meta's `available_pollutants`.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind v4 theme tokens, Paraglide,
`@sjvair/map-sdk` (new, MIT; brings `@maptiler/sdk`/`maplibre-gl`, BSD-3-Clause),
`@sjvair/sdk` 5.0.0-beta.8, Vitest (unit + browser), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-11-step-5-spec-1-map-widget-design.md` (approved
2026-11-11). Read it first; this plan argues from it.

## Global Constraints

- Branch `step-5-spec-1` from `step-5` (fetch first; `step-5` must match `origin/step-5`); the PR
  goes into `step-5`. Never merge without the user's own yes. No Claude or AI attribution in
  commits, PRs or docs.
- `@sjvair/sdk` pin unchanged: `npm:@jsr/sjvair__sdk@5.0.0-beta.8`. Anything missing goes to the
  coordinator (`data-dashboard-8a`, find it with ListAgents), never worked around.
- `@sjvair/map-sdk` pinned **exactly** (no `^`, never a dist-tag). Start on `0.1.0-beta.6`. Before
  the PR is marked ready, move to the beta carrying map-sdk changes 1 (telemetry/session off) and
  2 (panels sized by the map), expected `0.1.0-beta.7`, and turn telemetry off with it (Task 6).
  **The PR must not merge without that.** Don't modify map-sdk; ask the coordinator.
- **Nothing map-related in the initial bundle** beyond the descriptor (an icon and messages). Run
  `npm run build && npm run check:budget` after Tasks 1, 4 and 8, and report the number (209.7 KB
  after spec 6; soft budget 250 KB; don't stop to ask under it).
- Strings through Paraglide (`messages/en.json`), with no concatenated sentences. Theme tokens
  only (`token-discipline.test.ts`); map-sdk's fixed monitor colors stay map-sdk's.
- Dates through `$lib/format` (Pacific). No `localStorage`/`navigator.*` outside
  `src/lib/platform/`.
- **Coordinates never go in URLs, logs, errors or test snapshots' names.** `VITE_MAPTILER_KEY` is
  never printed.
- Metadata is the source of truth: the pollutants a map accepts come from the monitors meta's
  `available_pollutants`, never a list in code.
- Tests never reach MapTiler: E2E stubs `api.maptiler.com`. Unit and browser tests mock
  `@sjvair/map-sdk`.
- Every deferral goes into `DEFERRED.md` in the same change (Task 11 lists them).
- Docs-only commits go on the working branch (`step-5-spec-1`, or `step-5` for spec-level docs);
  nothing goes straight to `main`.
- Tabs, double quotes, no trailing commas, width 100. `npm run format && npm run lint && npm run
  check` before each commit.

## Review Focus

1. **The layer changes while the map is detached** (off-screen, or the page hidden), through
   undo, another tab or "Change place". On re-attach, the map shows the new places and refits,
   not the old ones (Task 8 test `refits to the current layer after re-attach`).
2. **A selection whose monitors aren't in the store** (inactive, unlisted, or not loaded yet).
   It fits the ones found. With none found, it stays on the Valley view without throwing. When
   the store loads later, it fits then (Task 7 test `fitTarget with no known monitors is null`;
   Task 8 test `fits once the store has the monitors`).
3. **Fast place changes** (undo spam, the picker saving twice). Stale geometry or region lookups
   are aborted, and the last layer wins (Task 7 test `a newer frame aborts the older lookup`).
4. **Two Map widgets on one page**, same or different pollutants. Each gets its own plugins on
   one shared store per entry type. Removing one doesn't stop the other's polling, and the store
   is disposed after the last one goes (Task 6 test `store is shared and disposed after the last
   release`).
5. **No WebGL, a lost context, no key, or a failed store.** Each shows a widget state ("Map
   unavailable" with no key; the error state with "Try again" otherwise), never a blank or a
   throw (Task 8 tests `shows unavailable with no key` and `shows the error state when the map
   fails to create`).

---

### Task 1: Install map-sdk, CSS, key, CSP

**Files:**
- Modify: `package.json`, `package-lock.json` (add `"@sjvair/map-sdk": "0.1.0-beta.6"` exactly)
- Modify: `src/app.css` (map-sdk's `@source` line per its README "Install")
- Modify: `src/vite-env.d.ts` (`readonly VITE_MAPTILER_KEY?: string`)
- Modify: `csp-hosts.json` (`connect-src` gains `"https://api.maptiler.com"`)
- Modify: `src/csp-hosts.test.ts` (its `CONTRACT`)
- Modify: `scripts/check-build-output.mjs` allowlist (only the hosts the built map chunk really contains)
- Modify: `.env.example` (no change if `VITE_MAPTILER_KEY` is already listed; check)

- [ ] **Step 1:** `git fetch && git switch step-5 && git pull --ff-only && git switch -c step-5-spec-1`.
- [ ] **Step 2:** `npm view @sjvair/map-sdk dist-tags`. Use the newest `next` beta at or above
  `0.1.0-beta.6`. `npm install --save-exact @sjvair/map-sdk@<that>`. Confirm `npm ls @sjvair/sdk`
  shows one copy (`5.0.0-beta.8`) satisfying map-sdk's peer.
- [ ] **Step 3:** Update the CSP contract test first: `CONTRACT["connect-src"]` equals
  `["'self'", "{static}", "https://o270131.ingest.us.sentry.io", "https://api.maptiler.com"]`.
  Run `npx vitest run src/csp-hosts.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Add the host to `csp-hosts.json`. Re-run. Expected: PASS.
- [ ] **Step 5:** `npm run build && npm run check:build`. If it fails on hosts in the bundled
  MapLibre/MapTiler code, allowlist each one by name (with a comment saying it's library code, not
  a request the app makes) and don't widen the CSP. `npm run check:budget`: the number must be
  unchanged except for map-sdk's CSS from `@source`. Report the delta.
- [ ] **Step 6:** Commit `build: add @sjvair/map-sdk, MapTiler in connect-src`.

### Task 2: Add widget lists a type once; `addable(doc)`

**Files:**
- Modify: `src/lib/widgets/registry.ts`
- Modify: `src/lib/actions/dashboard.ts` (`addWidget`, the Add widget menu entries)
- Modify: `src/lib/components/dashboard/AddWidgetButton.svelte`
- Modify: `src/lib/widgets/notes/index.ts` (signature only)
- Test: `src/lib/widgets/registry.test.ts`

**Interfaces:**
- Produces: `WidgetType.addable?: (doc: Dashboard) => { data: WidgetDataConfig; options?: Record<string, unknown> }`.
- Produces: `addWidgetEntries(): { type: WidgetType; direct: boolean }[]` in `registry.ts`, in
  registration order. Data types without `addable` get `direct: false` (they open Get data); any
  type with `addable` gets `direct: true`, once.

- [ ] **Step 1: Failing tests** in `registry.test.ts`:
  - `addWidgetEntries lists a data type that is also addable once, as direct`: register a type
    with `accepts.datasets` and `addable`; expect exactly one entry with `direct: true`.
  - `addWidgetEntries keeps data types without addable as Get data`: `direct: false`.
- [ ] **Step 2:** Run `npx vitest run src/lib/widgets/registry.test.ts`. Expected: FAIL (not defined).
- [ ] **Step 3:** Implement `addWidgetEntries`. Update the descriptor comment: "Data types go
  through Get data unless they're also `addable`, which adds them directly." Change `addable` to
  take `doc`. `addWidget` passes `session.doc`. Both Add widget call sites build their list from
  `addWidgetEntries()` (`direct ? addWidget : startGetData`). Notes' `addable: () => …` stays
  valid (it ignores the argument).
- [ ] **Step 4:** Run the registry tests and `npx vitest run src/lib/actions`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(widgets): Add widget lists each type once; addable gets the dashboard`.

### Task 3: Metadata: the map's pollutants; school coordinates

**Files:**
- Modify: `src/lib/data/metadata.ts` (`MetadataSource`, `createWebMetadata`, fixtures)
- Modify: `src/lib/data/adapters/registry.ts` (`LocationResolver` details)
- Modify: `src/lib/data/adapters/places.ts` (`resolvedLocation`)
- Modify: `src/lib/data/testing/fixtures.ts` (`fixtureMetadata`)
- Test: `src/lib/data/metadata.test.ts`, `src/lib/data/adapters/places.test.ts`

**Interfaces:**
- Produces: `MetadataSource.mapPollutants(signal?: AbortSignal): Promise<string[]>`, which is the
  monitors meta's `available_pollutants` in server order, and `[]` when the meta can't be loaded
  (never rejects except on abort).
- Produces: `LocationResolver` details gain `point: { lat: number; lon: number }` (from the
  SDK `Location.point`, `lng` → `lon`).

- [ ] **Step 1: Failing tests:** `mapPollutants returns available_pollutants` (meta stub
  `["o3","pm25"]` → `["o3","pm25"]`); `mapPollutants is [] when the meta fails`;
  `resolvedLocation carries the point` (`{lat: 36.7, lon: -119.8}` from `point: {lat: 36.7, lng: -119.8}`).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement on the memoized `getMonitorsMeta()` already in `metadata.ts`. Add
  `mapPollutants` to `fixtureMetadata` (default `["o3", "pm25"]`).
- [ ] **Step 4:** Run `npx vitest run src/lib/data`. Expected: PASS. `npm run check` passes
  (every `MetadataSource` implementer updated).
- [ ] **Step 5:** Commit `feat(data): the monitor map's pollutants; school coordinates`.

### Task 4: The Map descriptor and its starting place

**Files:**
- Create: `src/lib/widgets/map/index.ts` (descriptor, `MAP_TYPE = "map"`)
- Create: `src/lib/widgets/map/start.ts` (`mapStartData`)
- Create: `src/lib/widgets/map/module.ts` (exports `component`; a placeholder component until Task 8)
- Modify: `src/lib/store/app.svelte.ts` (register after the other data types)
- Modify: `messages/en.json` (`widget_map_title`: "Map")
- Test: `src/lib/widgets/map/start.test.ts`, `src/lib/widgets/registry.test.ts` (size list)

**Interfaces:**
- Consumes: `placesToReplace(doc)` (`$lib/actions/dashboard`; if importing it there pulls more
  into the initial bundle, move it with `barVisible`/`mainPlaces` into `$lib/places/replace.ts`,
  which already holds those), `DEFAULT_LAYER`.
- Produces: `mapStartData(doc: Dashboard): WidgetDataConfig`. This is one layer
  `{ dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType, place }`, where `place`
  is `placesToReplace(doc)[0] ?? DEFAULT_LAYER.place`.
- Produces: `mapType: WidgetType` with `type: "map"`, `icon` `@lucide/svelte/icons/map`,
  `minSize {w:3,h:4}`, `defaultSize {w:6,h:6}`, `time: "now"`, `thresholds: false`,
  `analyzable: false`, `downloadable: false`,
  `accepts { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces: 25, onlyPollutant: true }`,
  `menu: () => []`, `addable: (doc) => ({ data: mapStartData(doc) })`, `load`.

- [ ] **Step 1: Failing tests** in `start.test.ts`:
  - `starts at the bar's place when the bar shows` (doc with bar Tulare County and a widget at it → place Tulare County).
  - `ignores a bar no widget shows` (bar Tulare, the only widget at Kern → Kern).
  - `falls back to the most common place, then Fresno County` (empty doc → `DEFAULT_LAYER.place`).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `start.ts`, the descriptor, the placeholder module, and the
  registration. Add `"map"` to `registry.test.ts`'s size check.
- [ ] **Step 4:** Run `npx vitest run src/lib/widgets`. Expected: PASS. Then
  `npm run build && npm run check:budget`: the initial bundle grows by the descriptor only (a
  few hundred bytes). Report it.
- [ ] **Step 5:** Commit `feat(map): the Map widget type and its starting place`.

### Task 5: Get data: several places and the map's pollutants on a "now" type

**Files:**
- Modify: `src/lib/get-data/now.ts` (`nowPollutant`, `toNowDraft`, `isNowShaped`)
- Modify: `src/lib/get-data/GetDataView.svelte` (pass the map's pollutants; the pollutant choices for a Map draft)
- Modify: `messages/en.json` (a note when a Map draft's pollutant was changed, if the existing `"pollutant"` note's wording doesn't fit; reuse it if it does)
- Test: `src/lib/get-data/now.test.ts`

**Interfaces:**
- Consumes: `MetadataSource.mapPollutants` (Task 3), `MAP_TYPE` (Task 4).
- Produces: `nowPollutant(draft, type, catalog, allowed?: string[])`. When `allowed` is given,
  the offered pollutants are `nowPollutants(catalog)` filtered to `allowed`. `toNowDraft(draft,
  type, catalog, levels, fromType?, allowed?: string[])` passes it on. The view passes
  `allowed` only for `MAP_TYPE`, from `getMetadata().mapPollutants()`.
- Behavior: `toNowDraft` keeps up to `type.accepts?.maxPlaces ?? 1` picks (via `toLayerPlaces`),
  and pushes `"places"` only when picks exceed it. `isNowShaped` allows up to the same count.
  Existing one-place types are unchanged.

> Spec adjustment: "now" types are never blocked in "Show as" (they convert), so instead of a
> new `TypeBlock`, a Map draft whose pollutant isn't in `available_pollutants` converts to the
> first allowed one with the existing `"pollutant"` note. Same outcome, existing pattern.

- [ ] **Step 1: Failing tests** in `now.test.ts`:
  - `toNowDraft to Map keeps three monitors as a selection` (Chart draft with 3 monitors → layer `selection.ids` length 3, `dropped` has no `"places"`).
  - `toNowDraft to Map cuts at 25 with a places note` (30 monitors → 25, `"places"` in dropped).
  - `toNowDraft to Current conditions still keeps one` (unchanged behavior).
  - `nowPollutant for Map with allowed ["o3","pm25"] turns co into the first allowed` (draft on `co` → `"o3"`; `dropped` has `"pollutant"`).
  - `isNowShaped accepts a Map selection of 3`.
- [ ] **Step 2:** Run `npx vitest run src/lib/get-data/now.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `GetDataView.svelte`, load `mapPollutants()` once (it's already
  memoized), pass it to `convertToNow` for `MAP_TYPE`, and filter the pollutant choices shown for a
  Map draft the same way.
- [ ] **Step 4:** Run `npx vitest run src/lib/get-data`. Expected: PASS. Add a browser test case
  in the existing Get data browser test, `Show as Map keeps the chart's places`, if that file has a
  Show-as case to copy; otherwise the unit tests suffice.
- [ ] **Step 5:** Commit `feat(get-data): a now type may hold several places; Map's pollutants from metadata`.

### Task 6: The map-sdk host (lazy)

**Files:**
- Create: `src/lib/widgets/map/host/messages.ts` (key table + provider)
- Create: `src/lib/widgets/map/host/format.ts` (format provider)
- Create: `src/lib/widgets/map/host/stores.ts` (shared monitors stores)
- Create: `src/lib/widgets/map/host/config.ts` (map config: key, basemap, telemetry off)
- Modify: `messages/en.json` (every `mapsdk_*` key with map-sdk's English text, verbatim from `@sjvair/map-sdk/messages/en.json`)
- Test: `src/lib/widgets/map/host/messages.test.ts`, `stores.test.ts`, `config.test.ts`

**Interfaces:**
- Produces: `mapMessages: MessageProvider`. An explicit `Record<MessageKey, (params) => string>`
  of Paraglide functions (the `notes/messages.ts` pattern, not `import * as m`). Plural keys take
  the base key plus `params.count` and pick `_one`/`_other` with `Intl.PluralRules("en")`.
- Produces: `mapFormat: FormatProvider` wrapping `$lib/format` (`number` → `formatValue`,
  `dateTime`, `zoneLabel` → " PT" off-Pacific as the dashboard does, `relativeTime`).
- Produces: `sharedMetadata(): MetadataProvider`, one `createDefaultMetadata()` per page,
  memoized.
- Produces: `acquireMonitors(entryType: string): { store: MonitorsStore; release(): void }`.
  This is one `createMonitorsStore()` per entry type, `init(entryType)` on first acquire, paused
  while `platform().activity.visible()` is false, and `dispose()` after the last `release()`.
- Produces: `mapConfig(): MapConfig | null`. `null` when `import.meta.env.VITE_MAPTILER_KEY` is
  empty. Otherwise `{ maptilerKey, projection: "mercator", cooperativeGestures: true }`, plus the
  telemetry/session-off option once the pinned map-sdk has it (change 1). Until then, leave a
  `// TODO(map-sdk change 1)` comment and an `it.todo("turns MapTiler telemetry and session off")`
  in `config.test.ts`. The PR checklist (Task 11) blocks on it.

- [ ] **Step 1: Failing tests:**
  - `messages.test.ts`: `covers every map-sdk key` (every key of `@sjvair/map-sdk/messages/en.json` resolves, after folding `_one`/`_other` into their base; a stray key in the table fails too); `picks the plural form by count` (`mapsdk_hms_fire_detections` with `count: 1` vs `3`); `fills params` (`mapsdk_list_row_level` with `{name, level}`).
  - `stores.test.ts` (mock `@sjvair/map-sdk/stores`): `store is shared and disposed after the last release`; `two entry types get two stores`; `pauses while the page is hidden and resumes` (memory platform activity).
  - `config.test.ts`: `null without a key`; `mercator and cooperative gestures with a key`.
- [ ] **Step 2:** Run `npx vitest run src/lib/widgets/map/host`. Expected: FAIL.
- [ ] **Step 3:** Implement. Copy the `mapsdk_*` strings into `messages/en.json` exactly. Plural
  pairs stay two Paraglide messages (`…_one`, `…_other`).
- [ ] **Step 4:** Run. Expected: PASS (one `todo`). `npm run check` passes.
- [ ] **Step 5:** Commit `feat(map): map-sdk host: messages, format, metadata, shared stores, config`.

### Task 7: Framing: what the map highlights, outlines, pins and fits

**Files:**
- Create: `src/lib/widgets/map/framing.ts` (pure)
- Create: `src/lib/widgets/map/regions.ts` (geometry cache)
- Create: `src/lib/widgets/map/frame.svelte.ts` (reactive: layer → resolved frame, with aborts)
- Test: `src/lib/widgets/map/framing.test.ts`, `regions.test.ts`, `frame.test.ts`

**Interfaces:**
- Consumes: `fromLayer` (`$lib/places/selection`), `nowInput` (`../shared/input`),
  `placeRegion`, `getResolvers` (`$lib/data`), `getRegionsGeoJSON` (`@sjvair/sdk`), `Bbox` and
  `geometryBbox` (`@sjvair/map-sdk`).
- Produces (`framing.ts`):
  ```ts
  type Frame = {
    monitors: string[];                       // monitor ids to highlight (setSelection)
    regions: { type: string; code: string }[]; // regions to outline and highlight
    pin: { kind: "location"; name: string; lat: number; lon: number }
       | { kind: "point"; lat: number; lon: number } | null;
    focus: "monitor" | "regions" | "pin" | "none"; // what the camera fits
  };
  function frameOf(layer: Layer | undefined): Omit<Frame, "pin" | "regions"> & { needs: Need[] };
  type Need = { kind: "regions"; refs: { type: string; code: string }[] }
            | { kind: "location"; source: string; code: string }
            | { kind: "point-region"; layer: Layer };
  function fitTarget(frame: Frame, shapes: Map<string, Bbox>, monitorPositions: Map<string, [number, number]>):
    { bbox: Bbox } | { center: [number, number]; minZoom: number } | null;
  ```
  Rules (the spec's table):
  - **One monitor:** `monitors: [id]`, `focus: "monitor"`, `{center, minZoom: 12}`.
  - **One region:** `regions: [ref]`, `focus: "regions"`, its bbox.
  - **One location:** a pin at the school's point, `focus: "pin"`, `{center, minZoom: 13}`.
  - **One point:** `regions: [its region]`, a pin at the point, `focus: "regions"`. **The
    camera fits the region's bbox, never the point.** A region that can't be found means
    `fitTarget` returns `null`.
  - **Monitor selection:** the bbox of the known positions; `null` when none are known.
  - **Region selection:** the union bbox.
  - **`default-place` or nothing:** `focus: "none"`.
- Produces (`regions.ts`): `regionShapes(refs, signal): Promise<Map<"type:code", Feature>>`.
  One `getRegionsGeoJSON({ type, external_id: codes, simplify: true })` per type, results cached
  in memory by `type:code` for the page, and a missing region absent from the map.
- Produces (`frame.svelte.ts`): `class MapFrame { constructor(layer: () => Layer | undefined);
  frame: Frame | null; shapes: Map<string, Feature>; state: "idle" | "loading" | "ready" |
  { unavailable: UnavailableReason }; destroy(): void }`. Each layer change aborts the previous
  lookups. A point uses `placeRegion(nowInput(layer)!)`. A location uses
  `getResolvers().locations.resolve` (`location-unresolved` when null).

> Spec adjustment: the spec says region geometry goes "through the dashboard's query client".
> That client only serves adapter time series (`subscribe(QueryInput)`), so geometry gets its own
> small page-wide cache here instead. It has the same effect: fetched once, shared by every map.

- [ ] **Step 1: Failing tests:**
  - `framing.test.ts`: one test per table row above (`one monitor`, `one region`, `one location`, `one point frames its region not the point`, `monitor selection`, `region selection`, `default-place is none`); `fitTarget with no known monitors is null`; `fitTarget for a point with no region is null`.
  - `regions.test.ts` (mock the SDK): `groups codes by type, one request each`; `caches by type:code`; `leaves out a region the server doesn't return`.
  - `frame.test.ts`: `a newer frame aborts the older lookup` (two quick layer changes; the first lookup's signal is aborted; `frame` is the second's); `an unknown school is location-unresolved`; `a point outside every region is point-outside` (from `placeRegion` → `null`).
- [ ] **Step 2:** Run `npx vitest run src/lib/widgets/map`. Expected: FAIL.
- [ ] **Step 3:** Implement. No coordinates in thrown errors or logs.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): framing a map's places`.

### Task 8: The Map widget component

**Files:**
- Create: `src/lib/widgets/map/MapWidget.svelte`
- Create: `src/lib/widgets/map/on-screen.svelte.ts` (IntersectionObserver + activity + delay)
- Modify: `src/lib/widgets/map/module.ts` (export `MapWidget`, import `@sjvair/map-sdk/theme.css` here)
- Modify: `messages/en.json` (`map_unavailable_no_key` "Map unavailable", `map_pin_your_location` "Your location", `map_pin_shared_location` "Shared location", `map_legend_toggle` "Legend", `map_label` "{title} map")
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`, `on-screen.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 7, `WidgetState`, `openPlacePicker`, `placeLabel`/`setGeneratedTitle`,
  `PLACE_VIEWER_KEY`, `ancestorAnimationsSettled` (`$lib/charts/time-chart`), `MONITOR_*`
  exports only through map-sdk's own presets.
- Produces: `class OnScreen { constructor(el: () => Element | undefined, opts?: { detachDelayMs?: number /* 5000 */; rootMargin?: string /* "200px" */ }); active: boolean; destroy(): void }`.
  `active` is visible ∧ intersecting, turns true immediately, and turns false after the delay.
- Behavior:
  - **Map setup:** `createMap({ config, metadata: sharedMetadata(), messages: mapMessages,
    format: mapFormat })` once per mount, and `map.destroy()` on unmount.
  - **Plugins, in order:**
    1. Outline `shapesPlugin({ id: "places", mode: "plain", listed: false, selectable: false,
       hoverable: false })` from `MapFrame.shapes`.
    2. `monitorsPlugin({ source: store.dataSource, layerLabel: entry label, selectedStyle:
       "ring" })` with selection mode `"none"`.
    3. A pin `pointsPlugin` (one `feature:pin` ref, not selectable, text label "Your location" /
       "Shared location" by viewer, or the school's name).
  - **Selection display:** `map.setSelection("monitors", …)` and `map.setSelection("places", …)`
    from the frame, whenever it changes.
  - **Fitting:** when `map.ready`, after `ancestorAnimationsSettled(el)`, whenever the frame
    changes or the map re-attaches: `fitBounds(bbox, { padding: 32 })` or `easeTo`, using
    `fitTarget`. A `null` target leaves the Valley view.
  - **`MapView` props:** `active={onScreen.active}`, `label`, `featureList={{ reveal: "focus" }}`,
    `selectionBar={false}`, `tooltip="pointer"`. `overlays` holds `<Legend framed={false}>` in a
    token-styled card that collapses to a "Legend" toggle below 360 px widget width.
  - **States, through `WidgetState`:** idle with `onchoose` → "Choose a place" (no place or
    `default-place`). `MapFrame` unavailable reasons map to the existing unavailable card. No key
    shows "Map unavailable". A failed `createMap` or a WebGL error is an error with "Try again"
    (recreate).
  - **Title:** one place gives `m.label_join({ first: entryLabel, second: placeLabel(place,
    viewer) })`; several give the existing `widget_title_places` helper used by `dataTitle`.

- [ ] **Step 1: Failing tests:**
  - `on-screen.test.ts` (fake timers, stub IntersectionObserver): `active when visible and on screen`; `stays active for the delay after leaving`; `inactive while the page is hidden`.
  - `map-widget.browser.test.ts`, with `@sjvair/map-sdk` mocked by a fake `createMap` that records `addPlugin`, `setSelection`, `fitBounds`/`easeTo`, plus a `ready` flag and a `MapView` stub. Cases:
    - `idle shows Choose a place and opens the picker`;
    - `one region outlines and fits it`;
    - `a point fits its region and pins the point, labeled for owner and shared viewer`;
    - `a monitor selection highlights them with the ring style`;
    - `fits once the store has the monitors`;
    - `refits to the current layer after re-attach`;
    - `title for one place and several`;
    - `shows unavailable with no key`;
    - `shows the error state when the map fails to create`;
    - `passes axe in light and dark`.
- [ ] **Step 2:** Run `npm run test:browser -- src/lib/widgets/map` and the unit file. Expected: FAIL.
- [ ] **Step 3:** Implement. If the browser runner turns out to support WebGL, add one unmocked
  smoke case (`renders a real map with a stub style`). Skip it if not, and don't fight CI.
- [ ] **Step 4:** Run both. Expected: PASS. `npm run build && npm run check:budget`: map-sdk and
  MapLibre are in a lazy chunk only. Check with `npx vite-bundle-visualizer` or the build's chunk
  list that the entry doesn't import `maplibre-gl`. Report the initial bundle and the map chunk sizes.
- [ ] **Step 5:** Commit `feat(map): the Map widget`.

### Task 9: Place spots, sharing and "Change place"

**Files:**
- Test: `src/lib/sharing/points.test.ts`, the `PlacePickerDialog` regionOf test (find the existing one), `src/lib/places/replace.test.ts`
- Modify (only if a test shows it's needed): `src/lib/sharing/points.ts`, `PlacePickerDialog.svelte`

- [ ] **Step 1: Failing or confirming tests:**
  - `points.test.ts`: `a Map holding a point shares as the region the now lookup gives`; `a Map selection is left alone`.
  - picker: `a Map's point on a live link saves its region` (through `regionOf`).
  - `replace.test.ts`: `a one-place Map moves with the bar`; `a several-place Map stays`.
- [ ] **Step 2:** Run them. If the point tests pass with no code change (the map is `time: "now"`,
  so `lookupInput` uses `nowInput`), keep them as regression tests and make no change. If they
  fail, add the map branch to `lookupInput` and `regionOf`, and nowhere else.
- [ ] **Step 3:** Run `npx vitest run src/lib/sharing src/lib/places`. Expected: PASS.
- [ ] **Step 4:** Commit `test(map): sharing, picker and Change place cover the Map`.

### Task 10: E2E

**Files:**
- Create: `e2e/map.spec.ts`
- Create: `e2e/fixtures/maptiler-style.json` (a blank style: background layer only, no sources)
- Modify: the E2E API fixtures (`places-server.ts` or the shared route helpers) for `monitors/meta`, latest readings and `regions/geojson`

- [ ] **Step 1:** Route `https://api.maptiler.com/**`: style requests get the blank style, and
  everything else 404s. Assert in an `afterEach` that no request reached MapTiler unstubbed.
- [ ] **Step 2: Tests:**
  - `adds a Map from Add widget at the dashboard's place` (one "Map" entry in Add widget; the title names the place);
  - `the picker frames three monitors, and undo brings the region back`;
  - `fullscreen keeps the map and refits`;
  - `a tap on a monitor shows its reading` (touch context, `hasTouch: true`; Chromium and WebKit). **If this fails** because the tap doesn't set map-sdk's hover, mark it `test.fixme`, record it in the PR, and tell the coordinator that map-sdk change 4 (the pinned card) is needed for spec 1. Don't work around it in the dashboard.
  - `no CSP violations` (reuse `csp.spec.ts`'s listener);
  - axe on the dashboard with a Map, light and dark.
- [ ] **Step 3:** `npm run test:e2e -- e2e/map.spec.ts`, then `npm run test:e2e:all -- e2e/map.spec.ts`. Expected: PASS (or the documented `fixme`).
- [ ] **Step 4:** Commit `test(e2e): the Map widget`.

### Task 11: Docs, deferrals and the merge gate

**Files:**
- Modify: `ARCHITECTURE.md`:
  - "Widget catalog": the Map descriptor; `addable(doc)`; the once-in-Add-widget rule.
  - "Map SDK": how the dashboard hosts map-sdk (shared store per entry type, providers,
    on-screen lifecycle, Mercator, cooperative gestures, CSP, telemetry off).
  - "Widget data selection": a map's places are its places layer; clicks select from spec 2.
- Modify: `DEFERRED.md`, the spec's six deferrals, each with why and its revisit trigger:
  - "Which widgets Change place moves" → a new entry under the dashboard-wide section;
  - saving the camera;
  - pollutants beyond `available_pollutants`;
  - year-over-year on the map;
  - emissions map ideas → appended to "CEIDARS facility emissions";
  - Mercator note → appended to the globe-zoom entry.
- Modify: `TODO.md` (this track's row and the step 5 section: spec 1 status, the PR number),
  `ROADMAP.md` item 5 (the five specs).
- Modify: `CLAUDE.md` Key Libraries: move `@sjvair/map-sdk` to Installed, with its exact pin.

- [ ] **Step 1:** Write the docs. Re-read each file right before editing it (another session may
  have changed it).
- [ ] **Step 2:** Full check: `npm run format && npm run lint && npm run check && npm run test &&
  npm run build && npm run check:build && npm run check:budget && npm run test:e2e`. All pass.
  Also run with `TZ=America/New_York npm run test:unit` (CI isn't on Pacific).
- [ ] **Step 3:** Commit `docs: the Map widget (step 5 spec 1)`. Push. Open a **draft** PR into
  `step-5`. The body lists the bundle numbers and these blockers as unchecked items:
  - map-sdk beta with changes 1 and 2, pinned, with telemetry and session off (`config.test.ts`'s `todo` done);
  - sjvair.com CSP PR on `develop` (`camp/apps/workspace/csp-hosts.json`), so the map works on the local stack's `/workspace/`;
  - the tap result from Task 10.

  Check `gh pr checks` after pushing.
- [ ] **Step 4:** Tell the coordinator: the PR number, the bundle numbers, the tap result, and
  any map-sdk need found. Ask the user for the yes before marking it ready or merging.
