# Step 5 spec 2: the Map's data, marks and focus area — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map tile draws only the data its owner chose (pollutants at its places, smoke and
fire), loaded by the dashboard and handed to map-sdk; people mark monitors from the card or with
Shift-click, saved with undo; the focus area replaces spec 1's outline, pin and pin label.

**Architecture:** Map data sets are dashboard-side entries (`src/lib/widgets/map/data/`), each a
`NowSource` on the app's now client (`src/lib/data/now/`) plus a converter to map-sdk's
`DataSource` and the plugin that draws it. Marks and the pollutant showing live in the widget's
`options` (a validated `MapOptions`); places live on the first pollutant layer, as a Chart's do.
map-sdk fetches nothing: its metadata comes from an adapter over the dashboard's
`MetadataSource`.

**Tech Stack:** Svelte 5 runes, TypeScript, zod, Vitest (unit + browser mode), Playwright,
`@sjvair/map-sdk` `0.1.0-beta.11`, `@sjvair/sdk` `5.0.0-beta.9`, Paraglide.

**Spec:** `docs/superpowers/specs/2026-11-12-step-5-spec-2-map-data-design.md` (read it first;
this plan argues from it). Spec 1's spec and plan are background.

## Global Constraints

- Branch `step-5-spec-2-map-data`; the PR goes into `step-5`, never `main`. No merges, publishes
  or releases without the user's yes.
- Pins, exact: `@sjvair/map-sdk` `0.1.0-beta.11`, `@sjvair/sdk` `5.0.0-beta.9`. Drop the direct
  `@maptiler/sdk` dependency.
- No stop-gaps between specs (the user's rule): build toward step 5's end state. Keep the suite
  green, other widgets working, saved documents opening.
- map-sdk is a drawing library: never `createMonitorsStore`, HMS stores, or
  `createDefaultMetadata` in the widget; never hand map-sdk a request function.
- Metadata is the source of truth: pollutants from `metadata.mapPollutants()`; labels, units,
  scales from metadata. No lists of pollutants in code.
- All UI text through Paraglide (`messages/en.json`), no concatenated sentences; plurals use the
  `count`/`countValue` pattern (`get_data_places_count`). Numbers through `$lib/format`.
- Theme tokens only (`token-discipline.test.ts`); the focus area's fixed colors are map-sdk's, so
  the dashboard sets no focus CSS.
- Privacy: coordinates never in URLs, logs, error reports or saved data the user didn't choose.
  An exact point frames its region. Marks are monitor ids.
- WCAG 2.2 AA; Shift-click's keyboard path is Shift+Enter in the feature list.
- Map code stays lazy; report the initial bundle (`npm run build && npm run check:budget`) against
  the 250 KB soft budget (about 210.5 KB before).
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before commits.
- Commits carry no AI attribution.
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.
- Browser tests flake under machine load: rerun a timing failure alone before calling it a bug.

## Review Focus

1. **A Map tile saved by spec 1** (one layer, any `available_pollutants` pollutant, no options)
   opens, draws, and keeps its pollutant. Test in Task 2 and Task 7.
2. **The pollutant showing was unchecked in Get data** (`options.showing` names a pollutant the
   layers no longer hold): the map shows the first pollutant, never an empty or broken map.
   Test in Task 2 (`showingOf`).
3. **A tile whose places are all outside every monitor** (a region with no monitors, a retired
   monitor): the map draws with its focus area and a "no monitors here" note, not an error.
   Test in Task 7.
4. **Marks on a view-only or shared dashboard, and on the built-in starter**: no buttons and
   Shift-click inert when read-only; on the starter, a mark hands off to the copy like any edit
   (`session.apply`). Test in Task 8.
5. **The now client's cache key must not carry coordinates**: a point tile's monitors key is its
   region's, never the point. Test in Task 4.

---

## File Structure

- `src/lib/widgets/map/options.ts` (create): `MapOptionsSchema`, `mapOptions(widget)`,
  `showingOf(data, options, catalog)`. Imported by `documents/schema.ts` (light: zod only).
- `src/lib/widgets/map/data/types.ts` (create): `MapDataEntry` interface.
- `src/lib/widgets/map/data/monitors.ts` (create): the monitors entry (scope, source, converter).
- `src/lib/widgets/map/data/hms.ts` (create): the smoke and fire entry.
- `src/lib/widgets/map/data/scope.ts` (create): `monitorScope(layer, ctx)` — which monitors the
  places allow.
- `src/lib/widgets/map/host/metadata.ts` (create): `mapMetadata(source)` adapter.
- `src/lib/widgets/map/focus.ts` (create): `focusGeometry(frame, shapes)`.
- `src/lib/widgets/map/marks.ts` (create): `canMark`, `hiddenMarks`, `marksChange`.
- `src/lib/widgets/map/MapWidget.svelte` (modify): the wiring.
- `src/lib/widgets/map/index.ts` (modify): `accepts`.
- `src/lib/get-data/map.ts` (create): the Map's layer edits and conversions.
- `src/lib/get-data/MapSections.svelte` (create): the Map's "What" sections.
- `src/lib/get-data/GetDataView.svelte`, `now.ts` (modify): route the Map to them.
- `src/lib/data/metadata.ts` (modify): `serverScale`, `monitorTypeInterval`, `attribution`.
- Delete: `pin-label.svelte.ts`, `host/stores.ts` (and its test), the pin/shape parts of
  `sources.ts`.
- `e2e/map.spec.ts`, `e2e/maptiler.ts`, a new `e2e/map-data-server.ts` (stubs).
- Docs: `ARCHITECTURE.md`, `CLAUDE.md`, `DEFERRED.md`, `TODO.md`.

---

### Task 1: Move the pins

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/lib/widgets/map/host/messages.ts`
- Test: `src/lib/widgets/map/host/messages.test.ts` (existing)

**Interfaces:**
- Produces: map-sdk `0.1.0-beta.11` APIs for later tasks (`focusAreaPlugin`, `card: { actions }`,
  `CardContext`, `pickWith`, `canSelect`, `MapContext.notice`).

- [ ] **Step 1:** `npm view @sjvair/map-sdk dist-tags --prefer-online`; if anything newer than
  `0.1.0-beta.11` is on `next`, stop and tell the coordinator before going on.
- [ ] **Step 2:** `npm install --save-exact @sjvair/map-sdk@0.1.0-beta.11 @sjvair/sdk@5.0.0-beta.9`.
- [ ] **Step 3:** Run `npm run test:unit -- src/lib/widgets/map/host/messages.test.ts`. Expected:
  FAIL naming the new `mapsdk_*` keys (card actions, refusals, focus area).
- [ ] **Step 4:** Add each missing key to `host/messages.ts` as a Paraglide message (English text
  from map-sdk's `defaultMessages`), and the messages to `messages/en.json`.
- [ ] **Step 5:** Run `npm run check && npm run test`. Expected: PASS (spec 1 code still builds on
  `0.1.0-beta.11`; `card` as `true` is still accepted).
- [ ] **Step 6:** Commit `chore: pin @sjvair/map-sdk 0.1.0-beta.11 and @sjvair/sdk 5.0.0-beta.9`.

### Task 2: Map options and the pollutant showing

**Files:**
- Create: `src/lib/widgets/map/options.ts`
- Modify: `src/lib/documents/schema.ts` (the body's `superRefine`, next to the Note check)
- Test: `src/lib/widgets/map/options.test.ts`, `src/lib/documents/schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAP_MARKS_MAX = 25;
  export const MapOptionsSchema: z.ZodType<MapOptions>; // { showing?: SafeId; marks?: SafeId[] (unique, ≤ 25) }
  export type MapOptions = { showing?: string; marks?: string[] };
  export function mapOptions(widget: Pick<WidgetInstance, "options">): MapOptions; // invalid → {}
  /** The air-quality layers, in order (the first holds the places). */
  export function pollutantLayers(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): Layer[];
  /** The entry type drawn now: `options.showing` when a pollutant layer has it, else the first. */
  export function showingOf(data: WidgetDataConfig, options: MapOptions, catalog: CatalogEntry[] | undefined): string | undefined;
  ```
  `MAP_TYPE` moves here from `index.ts` (re-exported there) so `documents/schema.ts` imports
  nothing heavy.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("reads a spec 1 tile (no options) as nothing marked, showing its one pollutant", () => {
  	expect(mapOptions({})).toEqual({});
  	expect(showingOf({ layers: [{ dataset: "air-quality", entryType: "o3", place: FRESNO }] }, {}, CATALOG)).toBe("o3");
  });
  it("falls back to the first pollutant when the one showing was removed", () => {
  	expect(showingOf(twoLayers("pm25", "o3"), { showing: "pm10" }, CATALOG)).toBe("pm25");
  });
  it("rejects 26 marks, duplicate marks, and unsafe ids", () => {
  	expect(MapOptionsSchema.safeParse({ marks: ids(26) }).success).toBe(false);
  	expect(MapOptionsSchema.safeParse({ marks: ["a", "a"] }).success).toBe(false);
  	expect(MapOptionsSchema.safeParse({ marks: ["a b"] }).success).toBe(false);
  });
  // schema.test.ts
  it("refuses a dashboard whose Map has invalid options", () => { /* widget type "map", options { marks: "x" } → parse fails at widgets.0.options */ });
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/map/options.test.ts src/lib/documents/schema.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `options.ts` (reuse `SafeIdSchema` from `$lib/data/schema`), and add the
  Map branch to `DashboardBodySchema`'s `superRefine` (path `["widgets", i, "options"]`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): saved Map options (marks, the pollutant showing)`.

### Task 3: The Map's layers (pollutants, smoke and fire)

**Files:**
- Create: `src/lib/get-data/map.ts`
- Modify: `src/lib/widgets/map/index.ts` (`accepts`), `src/lib/widgets/map/start.ts` if needed
- Test: `src/lib/get-data/map.test.ts`, `src/lib/widgets/map/start.test.ts`

**Interfaces:**
- Consumes: `pollutantLayers` (Task 2), `keepingPlaces`-style moving of places from
  `get-data/layers.ts` (export a variant or reuse `removeLayer`/`addLayer` semantics).
- Produces:
  ```ts
  export const HMS_SMOKE = "hms-smoke"; export const HMS_FIRE = "hms-fire";
  export const MAP_POLLUTANTS_MAX = 6; // LAYERS_MAX (8) less smoke and fire
  /** Adds or removes an air-quality layer; the places stay on the first pollutant layer; the last one can't go. */
  export function setMapPollutant(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined, entryType: string, on: boolean): void;
  /** Adds or removes both place-less layers together. */
  export function setSmokeAndFire(data: WidgetDataConfig, on: boolean): void;
  export function hasSmokeAndFire(data: WidgetDataConfig): boolean;
  ```
  `mapType.accepts` becomes `{ datasets: ["air-quality", "hms-smoke", "hms-fire"], maxPollutantLayers: MAP_POLLUTANTS_MAX, maxPlaces: 25 }` (no `onlyPollutant`). Check `typeBlock` and `offeredDatasets` callers still behave for other types.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("adds ozone after PM2.5 without moving the places", () => {
  	const d = tile("pm25"); setMapPollutant(d, CATALOG, "o3", true);
  	expect(d.layers.map((l) => [l.entryType, !!l.place])).toEqual([["pm25", true], ["o3", false]]);
  });
  it("moves the places to the next pollutant when the first is removed", () => { /* remove pm25 → o3 has place */ });
  it("never removes the last pollutant", () => { /* setMapPollutant(d, CATALOG, "pm25", false) on a one-pollutant tile → unchanged */ });
  it("stops at 6 pollutants", () => { /* seventh add is a no-op */ });
  it("adds and removes smoke and fire together, with no place", () => {
  	const d = tile("pm25"); setSmokeAndFire(d, true);
  	expect(d.layers.slice(1)).toEqual([{ dataset: "hms-smoke" }, { dataset: "hms-fire" }]);
  	setSmokeAndFire(d, false); expect(d.layers).toHaveLength(1);
  });
  // start.test.ts: a new Map is PM2.5 only, no smoke and fire, no options.
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/get-data/map.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `map.ts`; update `accepts`. The HMS layers carry `entryType` only if the
  catalog's HMS entries need one for metadata lookups (check `catalog_snapshot.json` in
  `../sjvair.com/camp/api/v2/meta/tests/`); keep them place-less either way.
- [ ] **Step 4:** Run `npm run test:unit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): a Map holds several pollutants and smoke and fire`.

### Task 4: Map data-set entries on the now client

**Files:**
- Create: `src/lib/widgets/map/data/types.ts`, `data/scope.ts`, `data/monitors.ts`, `data/hms.ts`
- Test: `data/scope.test.ts`, `data/monitors.test.ts`, `data/hms.test.ts`

**Interfaces:**
- Consumes: `NowSource`/`NowClient` (`src/lib/data/now/client.ts`), `getResolvers()` and
  `placeRegion()` (`src/lib/data/index.ts`), `RegionResolver.resolve(type, code)` → `{ id }`
  (server sqid).
- Produces:
  ```ts
  // types.ts
  export interface MapDataEntry<T, P extends MapFeatureProperties = MapFeatureProperties> {
  	id: "monitors" | "hms";
  	/** The now source for this tile's data, or null when it has none (idle, unresolved). */
  	source(input: MapDataInput, signal?: AbortSignal): Promise<NowSource<T> | null>;
  	/** The loaded value as map-sdk data. */
  	toDataSources(value: T, ctx: { messages: MessageProvider }): Record<string, DataSource<P>>;
  }
  export type MapDataInput = { data: WidgetDataConfig; entryType: string };
  // scope.ts
  /** Which monitors the places allow: server region ids, explicit monitor ids, or null (unavailable). */
  export type MonitorScope = { kind: "regions"; ids: string[]; key: string } | { kind: "monitors"; ids: string[]; key: string };
  export function monitorScope(layer: Layer, ctx: { regions: RegionResolver; placeRegion: typeof placeRegion }, signal?: AbortSignal): Promise<MonitorScope | { unavailable: UnavailableReason }>;
  // monitors.ts
  export const monitorsEntry: MapDataEntry<MonitorLatest[], MonitorFeatureProperties>; // toDataSources → { monitors }
  export function toMonitorFeatures(readings: MonitorLatest[]): FeatureCollection<Point, MonitorFeatureProperties>;
  // hms.ts
  export const hmsEntry: MapDataEntry<{ smoke: ...; fires: ... }>; // toDataSources → { smoke, fireGroups, fireHotspots }
  ```
- Rules: region places (one or several) and a school/point (its `placeRegion` region) give
  `kind: "regions"` with server ids; monitor places give `kind: "monitors"`. `key` is
  `map-monitors:<entryType>:<sorted server region ids or monitor ids>` — never coordinates.
  The monitors fetch is `getMonitors(entryType, { timestamp: now, region: ids })` for regions,
  and `getMonitors(entryType)` filtered to `ids` for monitors (the builder may choose
  `getMonitorsList({ region })` + current if `at` proves wrong; record why). Cadence `"raw"`.
  The HMS key is `map-hms:<today, Pacific date key via $lib/format>`, cadence `"hour"`; fires go
  through map-sdk's `groupFires`/`cleanFires`; smoke values are density keys; scales are the
  ScaleRefs `{ dataset: "hms-smoke", entryType: "smoke-density" }` and the fire one map-sdk's
  `hmsFirePlugin` docs name. Feature names come from `mapsdk_hms_smoke_name` etc. via messages.

- [ ] **Step 1: Write the failing tests** (SDK mocked with `vi.mock("@sjvair/sdk")`)
  ```ts
  it("scopes a region to its server id", async () => { /* county:06019 → resolve → { id: "r6phe" } → { kind: "regions", ids: ["r6phe"] } */ });
  it("scopes a school or point to its region, and the key holds no coordinates", async () => {
  	const s = await monitorScope(pointLayer(36.7, -119.7), ctx);
  	expect(s).toMatchObject({ kind: "regions" });
  	expect(JSON.stringify(s)).not.toMatch(/36\.7|-119\.7/);
  });
  it("scopes monitors to exactly their ids", async () => { /* selection monitors [a,b] → { kind: "monitors", ids: ["a","b"] } */ });
  it("is unavailable when a region can't be resolved", async () => { /* resolve → null → { unavailable: "region-unresolved" } */ });
  it("builds monitor features in map-sdk's shape, skipping monitors with no position", () => {
  	expect(toMonitorFeatures([withPos, noPos]).features).toHaveLength(1);
  	expect(toMonitorFeatures([withPos]).features[0].properties).toEqual({ refKey: "monitor:a", name: "A", value: 12.5, type: "purpleair", isActive: true, isSjvair: true, location: "outside", timestamp: "2026-11-12T10:00:00-08:00" });
  });
  it("filters a monitors scope to its ids", async () => { /* fetch returns a,b,c; scope [a,c] → a,c */ });
  it("gives today's smoke and grouped fires", async () => { /* getHMSSmoke/getHMSFire mocked; toDataSources keys smoke, fireGroups, fireHotspots */ });
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/map/data`. Expected: FAIL.
- [ ] **Step 3:** Implement the four files.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): the dashboard loads the Map's monitors, smoke and fire`.

### Task 5: map-sdk metadata from the dashboard

**Files:**
- Modify: `src/lib/data/metadata.ts` (+ its test)
- Create: `src/lib/widgets/map/host/metadata.ts` (+ `.test.ts`)
- Delete: `src/lib/widgets/map/host/stores.ts`, `stores.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // MetadataSource additions
  /** The server's raw scale for a dataset's entry type (routes like `datasetLevels`, plus "hms-fire"); null when none. */
  serverScale(dataset: string, entryType: string, signal?: AbortSignal): Promise<unknown | null>;
  monitorTypeInterval(type: string, signal?: AbortSignal): Promise<string | null>;
  // host/metadata.ts
  export function mapMetadata(source: MetadataSource): MetadataProvider; // map-sdk's interface
  ```
  `mapMetadata` implements `scale`, `entryType` (label, units, precision from `catalog()`),
  `monitorTypeLabel` (from `monitorTypes()`), `monitorTypeInterval`, `attribution` (the catalog
  entry's `source`), each resolving `"unavailable"` on a miss or failure and rejecting only on
  the caller's abort — map-sdk's contract. It doesn't implement `locationTypeLabel` yet (that's
  `@sjvair/map-sdk` `0.1.0-beta.12`; noted in the spec).

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("gives map-sdk the server's PM2.5 scale and its label and units", async () => { /* stub MetadataSource; scale({dataset:"air-quality",entryType:"pm25"}) equals the stub's raw scale */ });
  it("gives the HMS smoke and fire scales", async () => { /* hms-smoke and hms-fire refs */ });
  it("resolves unavailable for an unknown type or a failed fetch, and rejects on abort", async () => {});
  it("never fetches through map-sdk", () => { /* vi.mock("@sjvair/sdk") asserts getMonitorsMeta/getDatasetCatalog/getHMSMeta not called by mapMetadata */ });
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/map/host src/lib/data/metadata.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; `MapWidget` passes `mapMetadata(getMetadata())` to `createMap` (one
  provider per page: memoize in `host/metadata.ts`). Remove `stores.ts`.
- [ ] **Step 4:** Run `npm run check && npm run test:unit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): map-sdk reads the dashboard's metadata`.

### Task 6: The focus area

**Files:**
- Create: `src/lib/widgets/map/focus.ts` (+ `focus.test.ts`)
- Modify: `MapWidget.svelte`, `sources.ts` (+ test), `framing.ts` if `Frame` needs a field
- Delete: `pin-label.svelte.ts`; `@maptiler/sdk` from `package.json`; its row in `CLAUDE.md`
- Test: `map-widget.browser.test.ts`

**Interfaces:**
- Consumes: `Frame`, `frame.shapes` (`frame.svelte.ts`), `focusAreaPlugin` (map-sdk).
- Produces:
  ```ts
  /** The focus geometry: the regions' shapes as one Polygon/MultiPolygon, the pin as a Point, or null (monitor places, nothing known). */
  export function focusGeometry(frame: Frame, shapes: Map<string, Feature>): Polygon | MultiPolygon | Point | null;
  ```
  The widget adds `focusAreaPlugin({ id: "focus", layerLabel: m.map_layer_places() })` first and
  calls `set({ geometry: focusGeometry(...), label: pinLabel })` when the frame changes. A point
  pin's label is "Your location"/"Shared location" (viewer), a school's its name. The monitors
  plugin loses `before: "pin"`. Spec 1's selection highlight of monitor places is removed
  (`monitorSelection`/`regionSelection` go; marks use the selection in Task 8).

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("joins several regions into one MultiPolygon", () => { /* two Polygon shapes → MultiPolygon with 2 polygons */ });
  it("gives the pin for a school or point, and null for monitor places", () => {});
  // browser: renders a region tile → map has plugin "focus" with a Polygon focus; no "pin" or "places" plugin; no DOM pin label
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/map/focus.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; delete the pin code and `@maptiler/sdk`; `npm run check:build`
  (license list) and `npm run build` still pass.
- [ ] **Step 4:** Run `npm run test -- src/lib/widgets/map`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): the focus area replaces the outline, pin and pin label`.

### Task 7: The widget draws the tile's data

**Files:**
- Modify: `MapWidget.svelte`, `map-widget.browser.test.ts`
- Messages: `map_no_monitors_here`, `map_layer_smoke`, `map_layer_fire` (or reuse catalog labels
  via metadata; prefer metadata)

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6; `NowQuery` (`src/lib/data/now/now-query.svelte.ts`),
  `getNowClient()`.
- Behavior:
  - The showing pollutant is `showingOf(widget.data, mapOptions(widget), catalog)`; the support
    check uses it against `mapPollutants()` as spec 1 did.
  - One `NowQuery` for monitors (source from `monitorsEntry.source`, re-resolved when the places
    or the pollutant showing change), one for HMS when `hasSmokeAndFire`. Polling follows
    `onScreen.active` (`setPolling`).
  - Plugins: `focus` (Task 6), `monitorsPlugin({ source, layerLabel, selectedStyle: "ring" })`,
    and when on `hmsSmokePlugin`/`hmsFirePlugin({ source, hotspots, layerLabel })`, added and
    removed as the layers change. `DataSource`s are stable objects whose getters read the
    current `NowQuery` state (as `featureSource` does), so map-sdk sees updates.
  - States: loading → skeleton; monitors error → widget error with Retry (`NowQuery.retry`);
    HMS error → a note over the map, monitors still drawn; scope `unavailable` → the existing
    note banner with its reason; a scope with zero monitors → note `map_no_monitors_here`.
  - The camera: `positions` for monitor places come from the loaded features
    (`monitorPositions`).
  - The title: unchanged rules, using the showing pollutant's label.

- [ ] **Step 1: Write the failing browser tests** (SDK mocked as in spec 1's tests)
  ```ts
  it("draws only the region's monitors", async () => { /* getMonitors mocked: called with region ["r6phe"]; source features = the region's */ });
  it("draws exactly the hand-picked monitors", async () => {});
  it("draws a spec 1 ozone tile as ozone", async () => {});
  it("draws smoke and fire when on, and none when off", async () => {});
  it("shows a note, not an error, when the places hold no monitors", async () => {});
  it("keeps the monitors when smoke and fire fail, with a note", async () => {});
  it("stops polling while off screen", async () => { /* now client entries(): polling false after detach */ });
  ```
- [ ] **Step 2:** Run `npm run test:browser -- src/lib/widgets/map/map-widget.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rewire `MapWidget.svelte` (drop the store effects).
- [ ] **Step 4:** Run the file's tests, then `npm run test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): a tile draws only its own data`.

### Task 8: Marks, the card buttons and Shift-click

**Files:**
- Create: `src/lib/widgets/map/marks.ts` (+ `marks.test.ts`)
- Modify: `MapWidget.svelte`, `map-widget.browser.test.ts`
- Messages: `map_mark_select` ("Select"), `map_mark_remove` ("Remove"),
  `map_marks_limit` ("Limit reached: up to {count} marked monitors", count/countValue),
  `map_marks_hidden` (plural: "{count} marked monitor isn't shown" / "{count} marked monitors
  aren't shown"; the builder may refine wording, no concatenation)

**Interfaces:**
- Consumes: `MapOptions`, `MAP_MARKS_MAX` (Task 2); the session (`useApp().current.session`,
  `readOnly`, `apply`).
- Produces:
  ```ts
  /** map-sdk's canSelect: true, or the limit message when `next` holds more than 25. */
  export function canMark(next: SpatialSelection | null, limitMessage: string): true | string;
  /** Marks not drawn now (outside the places or not reporting the pollutant showing). */
  export function hiddenMarks(marks: readonly string[], drawn: ReadonlySet<string>): string[];
  /** The setWidgetData change that saves `marks`, or null when unchanged. */
  export function marksChange(widget: WidgetInstance, marks: string[]): Change | null;
  ```
- Wiring: monitors plugin added with `{ selectionMode: readOnly ? "none" : "multiple", pickWith: "modifier", canSelect, selection: marksSelection, onselectionchange }`; `onselectionchange` →
  `session.apply(marksChange(...))` (data unchanged, `options: { from, to }`), so it's one undo
  step and hands off on the starter. The document's marks → `map.setSelection("monitors", …)`
  (fires nothing). `MapView card={{ actions }}`: the snippet shows Select or Remove (by
  `ctx.selected`) only when `ctx.selectable`, calling `ctx.toggle()`. Read-only: no buttons
  (mode `"none"` makes `selectable` false). The hidden-marks note (`role="status"`) shows under
  the map when `hiddenMarks(...)` is non-empty, and is also said in `MapView`'s `label`
  (the map's accessible name) so the feature list's readers hear it.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("refuses a 26th mark with the limit message", () => { expect(canMark({ kind: "monitors", ids: ids(26) }, "L")).toBe("L"); });
  it("lists marks that aren't drawn", () => { expect(hiddenMarks(["a","b","c"], new Set(["b"]))).toEqual(["a","c"]); });
  it("saves marks as one setWidgetData change, and null when unchanged", () => {});
  // browser
  it("marks from the card's Select and unmarks with Remove, undoable", async () => {});
  it("marks with Shift-click and with Shift+Enter in the feature list", async () => {});
  it("keeps marks when the pollutant showing changes, and counts the hidden ones", async () => {});
  it("keeps marks when the places change, and undo shows them again", async () => {});
  it("hides Select/Remove and ignores Shift-click on a view-only dashboard", async () => {});
  it("hands a mark on the starter off to its copy", async () => {});
  it("shows no buttons on smoke, fire or the focus pin", async () => {});
  ```
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/widgets/map/marks.test.ts` and the browser file. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, then `npm run test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(map): mark monitors from the card or with Shift-click`.

### Task 9: Get data for the Map

**Files:**
- Create: `src/lib/get-data/MapSections.svelte`
- Modify: `src/lib/get-data/GetDataView.svelte`, `now.ts` (conversions), `map.ts` (Task 3)
- Test: `src/lib/get-data/map.test.ts`, `now.test.ts`, `get-data-view.browser.test.ts`
- Messages: `get_data_smoke_and_fire` ("Smoke and fire"), `get_data_marks_left_out`
  ("Marked monitors are left out" or similar), reuse `get_data_keep_one`, the smoke help
  toggletip and `get_data_overlays_left_out`.

**Interfaces:**
- Consumes: `setMapPollutant`, `setSmokeAndFire`, `hasSmokeAndFire`, `MAP_POLLUTANTS_MAX`
  (Task 3); `offeredPollutants(catalog, allowed)` (`now.ts`) with `allowed` = `mapPollutants()`.
- Produces (in `map.ts`):
  ```ts
  /** `draft` (any type) as a Map: the source's pollutant (or the first offered), its places (≤ 25), smoke and fire on when the source had a smoke layer. */
  export function toMapDraft(draft: Draft, catalog: CatalogEntry[], allowed: string[]): NowConversion;
  /** A Map draft as `type`: the pollutant showing at the places; smoke, fire and marks dropped with notes. */
  export function fromMapDraft(draft: Draft, type: WidgetType, catalog: CatalogEntry[]): NowConversion;
  ```
  `NowDropped` gains `"marks"`. `GetDataView` uses these when converting to or from the Map
  (instead of `toNowDraft`/`fromNowDraft`'s single-layer path), shows `MapSections` for the Map
  instead of `NowControls`, and no date controls (the Map keeps `time: "now"`).
- `MapSections`: an Accordion section "Air quality" (a `fieldset` + `legend`, one checkbox per
  offered pollutant in `allowed` order; the last checked one is disabled with the "keep one"
  reason; checkboxes past `MAP_POLLUTANTS_MAX` disabled) and a section "Smoke and fire" (one
  checkbox, the smoke help toggletip). Same section look as `WhatSections`.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("converts a Chart with PM2.5 and smoke to a Map with PM2.5 and smoke and fire", () => {});
  it("converts a Map with PM2.5, ozone (showing) and smoke and fire to a Chart with ozone only, noting what's left out", () => {
  	const c = fromMapDraft(mapDraft(["pm25","o3"], { showing: "o3", marks: ["a"] }, true), CHART, CATALOG);
  	expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "o3", place: FRESNO }]);
  	expect(c.dropped).toEqual(expect.arrayContaining(["overlays", "marks"]));
  	expect(c.draft.options?.marks).toBeUndefined();
  });
  it("converts a Map to Current conditions with the pollutant showing and the first place", () => {});
  it("keeps up to 25 places converting to a Map", () => {});
  // browser
  it("shows the Map pollutant checkboxes, and the last one can't be unchecked", async () => {});
  it("turns smoke and fire on and off together", async () => {});
  it("saves a Map edit as one undo step", async () => {});
  ```
- [ ] **Step 2:** Run the unit and browser files. Expected: FAIL.
- [ ] **Step 3:** Implement; leave the other "now" types on `NowControls` untouched.
- [ ] **Step 4:** Run `npm run test`. Expected: PASS (all Get data tests, not only the Map's).
- [ ] **Step 5:** Commit `feat(get-data): the Map's pollutants and smoke and fire`.

### Task 10: The three place-handling spots with a multi-pollutant tile

**Files:**
- Test: `src/lib/sharing/points.test.ts`, `src/lib/places/place-picker-dialog.browser.test.ts`,
  `src/lib/get-data/map.test.ts`
- Modify: only what the tests show is needed.

- [ ] **Step 1: Write the failing tests**
  ```ts
  it("shares a Map holding a point with PM2.5 and ozone as one region swap on the places layer", async () => {});
  it("saves a point picked for a multi-pollutant Map on a live link as its region", async () => {});
  it("keeps the places on the first pollutant layer through a Get data round trip", () => {});
  ```
- [ ] **Step 2:** Run them. Expected: they pass if the main-layer convention already holds; fix
  any that fail.
- [ ] **Step 3:** Commit `test(map): place handling with several pollutants`.

### Task 11: End to end

**Files:**
- Modify: `e2e/map.spec.ts`, `e2e/maptiler.ts` if needed
- Create: `e2e/map-data-server.ts` (route stubs for `monitors/<type>/current` and `/at`,
  `hms/smoke`, `hms/fire`, regions, metadata), following `e2e/places-server.ts`

- [ ] **Step 1: Write the specs** (Chromium, WebKit; Firefox may skip WebGL only)
  - A region tile shows the focus area and only the stubbed region's monitors (count the feature
    list rows).
  - Shift-click a monitor marks it (ring), the card's Remove unmarks it, Ctrl/⌘+Z brings it back.
  - A shared view-only dashboard shows the card with no Select/Remove.
  - Get data: add ozone and smoke and fire to a Map, save, reopen: both stay.
  - No request leaves for `api.maptiler.com/metrics` (spec 1's check) and no request URL holds a
    point's coordinates (`privacy.spec.ts` pattern) for a point tile.
- [ ] **Step 2:** Run `npm run test:e2e -- e2e/map.spec.ts`. Expected: PASS after fixes.
- [ ] **Step 3:** Commit `test(e2e): the Map's data, marks and focus area`.

### Task 12: Docs, budget and the finish

**Files:**
- Modify: `ARCHITECTURE.md` (Map SDK and the Map widget: the tile's data model, the
  dashboard-loads rule, the now client entries, marks, the focus area; remove "all monitors are
  drawn"), `CLAUDE.md` (library table: `@sjvair/map-sdk` `0.1.0-beta.11`, drop `@maptiler/sdk`),
  `DEFERRED.md`, `TODO.md`.
- `DEFERRED.md` adds (each with why and trigger, per the spec's "Deferrals"): the Map refreshes
  only when its range includes today (spec 4); the focus school drawn twice (schools spec);
  schools and child care as a Map data set (map-sdk part 4, `0.1.0-beta.12`, and its
  `locationTypeLabel` hook in `mapMetadata`); spec 6 charts only drawn marks; more than 6
  pollutants on one Map. Removes: "The map pin's label is the dashboard's own stop-gap" (done →
  `TODO.md` Done list).

- [ ] **Step 1:** Edit the docs; `npx prettier --write` them.
- [ ] **Step 2:** Run `npm run lint && npm run check && npm run test && npm run build && npm run check:build && npm run check:budget`. Expected: all pass; note the budget number.
- [ ] **Step 3:** Run `npm run test:e2e`. Expected: PASS (rerun a timing failure alone).
- [ ] **Step 4:** Commit `docs: step 5 spec 2 built`.
- [ ] **Step 5:** Tell the coordinator the branch is ready; push and open the PR into `step-5`
  only after telling them (they hold `TODO.md` pushes while it's open).
