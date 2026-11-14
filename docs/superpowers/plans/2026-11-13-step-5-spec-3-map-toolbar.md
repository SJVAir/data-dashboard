# Step 5 spec 3: the Map's options toolbar, Settings, and viewer changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Map tile gets map-sdk's shared options toolbar (only the choices its data allows,
plus Settings), saved per tile with undo; viewers on read-only views that show tiles can use it
without saving; and a read-only "unkept" dashboard shows its tiles.

**Architecture:** Pure option logic (schema, values ↔ options, which groups show, which filters
apply) lives in `src/lib/widgets/map/toolbar/`; the toolbar's map-sdk wiring is one Svelte module
the widget calls. Writes go through a new widget-core module, `src/lib/widgets/shared/tile-options.svelte.ts`:
`applyChange` on an editable dashboard, an in-memory `ViewerChanges` store on a read-only view
(provided by `DashboardGrid` through context; `SharedPage` owns one so "Make a copy" can apply it).
`DocumentSession` is untouched.

**Tech Stack:** Svelte 5 runes, TypeScript, zod, Paraglide, Vitest (unit + browser), Playwright,
`@sjvair/map-sdk` `0.1.0-beta.13`, `@sjvair/sdk` `5.0.0-beta.10`, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-11-13-step-5-spec-3-map-toolbar-design.md` (approved
2026-11-13). Read it first; this plan argues from it.

## Global Constraints

- Branch `step-5-spec-3` (from `step-5`); the PR goes into `step-5`. Never merge without the user's yes.
- Pins exact: `"@sjvair/map-sdk": "0.1.0-beta.13"`, `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.10"`.
- Metadata is the source of truth: no hardcoded labels, help, groups, colors or scales.
- All UI text through Paraglide (`messages/en.json`), no concatenated sentences; edit spec 2's
  `map_marks_hidden` / `map_label_marks_hidden` rather than adding parallel keys.
- Theme tokens only; no hex in components (`src/lib/theme/token-discipline.test.ts`); new tokens in
  `src/app.css` with a value in **both** identical dark blocks (a test checks they match).
- WCAG 2.2 AA; axe in light and dark in E2E.
- Map code stays in the lazy map chunk; report `check:budget`'s number against 250 KB.
- Coordinates never in URLs, logs or error reports; viewer changes never leave memory.
- A missing option is drawn as its default and never written; a choice equal to its default is
  stored as missing.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- Commits carry no AI attribution lines. Docs commits go on this branch.
- Timing-sensitive test failures under load: rerun alone before calling them bugs.

## Review Focus

1. **A shared link the owner edits while a viewer has changes** — the viewer keeps only what they
   changed, a removed widget's changes go, and an unfit value falls back (Task 5 tests this).
2. **A tile whose data shrinks below a group's threshold with a saved switch-off** (one monitor
   type left, it's in `hiddenTypes`) — the monitors still draw (Task 4 `activeFilters` test).
3. **Undo/redo and another tab changing options while a dropdown is open** — `values` follow,
   no `onchange` fires, nothing is re-saved (Task 8 browser test).
4. **A narrow tile (< 48rem) in fullscreen and back** — viewer changes and saved values survive
   the remount; the options button is found after its frame (Task 8 browser test, Task 11 E2E).
5. **A server whose meta lacks a monitor type's group or an entry's description** — the toolbar
   shows a flat list without help, no throw (Task 2 provider tests with `null` group/description).

---

### Task 1: Move the pins and fix what breaks

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `e2e/fixtures/api/2.0/monitors/meta.json`, `e2e/fixtures/map-meta.json`, unit meta
  fixtures in `src/lib/data/metadata.test.ts`, `src/lib/widgets/map/host/metadata.test.ts` (and
  any other fixture `npm run test` shows failing on `monitor_groups`)
- Modify: whatever `npm run check` flags (`ThemeColors` gains `schoolMarker`, `childCareMarker`;
  `defaultBasemaps()` takes options; SDK `Scale` gains `averaging_hours`, `daily_statistic`,
  `daily_statistic_label`)

- [ ] **Step 1:** `npm view @sjvair/map-sdk dist-tags --prefer-online`; if `next` is newer than
  `0.1.0-beta.13`, stop and tell the coordinator before going on.
- [ ] **Step 2:** Set both pins exactly; `npm install`.
- [ ] **Step 3:** Add to every monitors-meta fixture: `monitor_groups` (two groups, keys
  `reference` and `lowcost`, with `label` and `order` — copy their real shape from the local
  stack's `/api/2.0/monitors/meta/` or the SDK's `MonitorGroup` type), a `group` on each monitor
  type (`bam1022`, `airnow`, `aqview` reference; `purpleair`, `airgradient` low-cost; set one type
  to `null` in the unit fixture), `published` on each type's entries, and `description` on each
  entry type (one `null`).
- [ ] **Step 4:** `npm run check` → 0 errors; `npm run test` → all pass. If `app.css` lacks
  `--school-marker` / `--child-care-marker` and map-sdk's theme reads them, add them (map-sdk's
  README → "Theme tokens" gives the values; they're fixed colors like the focus area's).
- [ ] **Step 5:** Commit `chore: @sjvair/map-sdk 0.1.0-beta.13 and @sjvair/sdk 5.0.0-beta.10`.

### Task 2: Metadata for the toolbar

**Files:**
- Modify: `src/lib/data/metadata.ts` (types, `MetadataSource`, `createWebMetadata`)
- Modify: `src/lib/widgets/map/host/metadata.ts`
- Test: `src/lib/data/metadata.test.ts`, `src/lib/widgets/map/host/metadata.test.ts`

**Interfaces:**
- Produces (`$lib/data/metadata`):
  - `MonitorSummary` gains `inside: boolean` (from the list's `location === "inside"`).
  - `MonitorTypeInfo` gains `group: string | null` and `published: string[]` (entry types whose
    `published` is true).
  - `MetadataSource.monitorGroups(signal?): Promise<MonitorGroup[]>` (sorted by `order`; `[]`
    when none), `entryTypeHelp(entryType, signal?): Promise<string | null>` (the monitors meta's
    `entries[entryType].description`), `locationTypeLabel(type, signal?): Promise<string | null>`
    (the regions meta's `location_types[type].label`).
- Produces (`mapMetadata`): the five optional `MetadataProvider` methods, with map-sdk's exact
  semantics (copy them from map-sdk `origin/main:src/lib/data/metadata.ts` lines ~200–237):
  `monitorGroups`, `monitorTypeGroup` ("unavailable" for null or unknown key), `monitorTypeReports`
  (true/false from `published`; no entry → false), `entryTypeHelp` (air-quality only),
  `locationTypeLabel` ("unavailable" on failure). Remove the "Not implemented yet" doc note.

- [ ] **Step 1: Write failing tests** in `host/metadata.test.ts`:
  `monitorGroups` returns the fixture's groups in `order`; `monitorTypeGroup("purpleair")` is
  `"lowcost"`, the null-group type is `"unavailable"`; `monitorTypeReports("purpleair","pm25")`
  true, a type without an `o3` entry → false; `entryTypeHelp({dataset:"air-quality",entryType:"pm25"})`
  is the fixture's description, the null one → `"unavailable"`, `{dataset:"hms-smoke",…}` →
  `"unavailable"`; `locationTypeLabel("child_care")` → its label, a failing source → `"unavailable"`.
  And in `metadata.test.ts`: `monitors()` sets `inside`; `monitorTypes()` sets `group`, `published`.
- [ ] **Step 2:** `npm run test:unit -- src/lib/data/metadata.test.ts src/lib/widgets/map/host/metadata.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Read the regions meta through the existing regions metadata path the
  file already uses (or add one memoized `getRegionsMeta` read like `meta(signal)`).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(map): metadata for the toolbar's groups, help and location types`.

### Task 3: Split `MapWidget.svelte`

**Files:**
- Create: `src/lib/widgets/map/data/loaded.svelte.ts`
- Modify: `src/lib/widgets/map/MapWidget.svelte`

**Interfaces:**
- Produces: `class MapData` constructed with
  `(getInput: () => { widget: WidgetInstance; layer: Layer | undefined; entryType: string | undefined; loads: boolean }, deps: { now: NowClient })`,
  exposing (reactive getters) `monitorsQuery`, `monitorsSource: DataSource<MonitorFeatureProperties>`,
  `monitorsCurrent`, `monitorsDrawn`, `monitorsLoading`, `monitorsRefreshFailed`,
  `monitorsUnavailable`, `unlisted`, `hmsQuery`, `smokeSource`, `fireSource`, `hotspotsSource`,
  `hmsFailed`, `setPolling(on: boolean)`, `retryMonitors()`, `retryHms()`, `destroy()`.
  Names may be adjusted, but Tasks 8 and 9 use this object for everything the data blocks did.

- [ ] **Step 1:** Move the blocks from "The monitors" through `hmsFailed` (and `dataStatus`)
  into `MapData`; the effects run inside it via `$effect.root` (cleaned up in `destroy`).
- [ ] **Step 2:** `npm run check`; `npm run test:browser -- src/lib/widgets/map` → PASS unchanged;
  `npm run test:e2e -- e2e/map.spec.ts` → PASS.
- [ ] **Step 3:** Commit `refactor(map): the widget's data blocks move to data/loaded.svelte.ts`.

### Task 4: Options, values, and which groups show (pure)

**Files:**
- Modify: `src/lib/widgets/map/options.ts`
- Create: `src/lib/widgets/map/toolbar/values.ts`
- Test: `src/lib/widgets/map/options.test.ts`, `src/lib/widgets/map/toolbar/values.test.ts`

**Interfaces:**
- Produces (`options.ts`): `MapOptionsSchema` (still `z.strictObject`; the document schema checks
  it, `src/lib/documents/schema.ts:53`) gains `basemap: SafeIdSchema.optional()`,
  `clustered: z.boolean().optional()`, `fireAndSmoke: z.boolean().optional()`,
  `inactive: z.boolean().optional()`, `inside: z.boolean().optional()`,
  `hiddenTypes: z.array(SafeIdSchema).max(32).refine(unique).optional()`.
  `MAP_TOOLBAR_KEYS = ["showing","basemap","clustered","fireAndSmoke","inactive","inside","hiddenTypes"] as const`.
  (Plan's call: the spec's "per-field fallback" is dropped — the strict document schema already
  rejects invalid map options, so there's nothing per-field to fall back from.)
- Produces (`toolbar/values.ts`):
  - `type MapOffer = { pollutants: string[]; types: string[]; hasInactive: boolean; hasInside: boolean; smokeAndFire: boolean }`
    — what the tile's data offers (pollutants = drawable pollutant layers in order; types = the
    loaded monitors' types).
  - `toValues(options: MapOptions, offer: MapOffer, defaults: OptionValues, drawn: string | undefined): OptionValues`
    — `pollutant` = `drawn`; `type:<t>` = not in `hiddenTypes`; others from options else `defaults`.
  - `toOptions(current: MapOptions, next: OptionValues, changed: string[], defaults: OptionValues, firstPollutant: string | undefined): MapOptions`
    — writes only `changed` keys; a value equal to its default (for `pollutant`: equal to
    `firstPollutant`) removes the key; `type:*` changes edit `hiddenTypes` (empty → removed);
    keeps `marks` and unknown-to-toolbar keys untouched.
  - `withoutToolbar(options: MapOptions): MapOptions` — drops `MAP_TOOLBAR_KEYS` (owner Reset).
  - `activeFilters(options: MapOptions, offer: MapOffer, rows: { types: boolean; inactive: boolean; inside: boolean }): { hiddenTypes: Set<string>; hideInactive: boolean; hideInside: boolean }`
    — a saved value filters only when its row is offered (`rows`), per the spec.
  - `groupsShown(offer: MapOffer, monitorRowCount: number): { pollutant: boolean; monitors: boolean; layers: boolean }`
    — pollutant ≥ 2; monitors when `monitorRowCount >= 2`; layers when `smokeAndFire`.
  - `filterMonitors(features: FeatureCollection<Point, MonitorFeatureProperties> | null, filters): same`
    — drops features by `type`, `isActive === false`, `location === "inside"`.

- [ ] **Step 1: Write failing tests** (`values.test.ts`), with these cases:
  - `toOptions` with `changed: ["basemap"]`, `next.basemap === defaults.basemap` → no `basemap` key.
  - `toOptions` switching `type:purpleair` off → `hiddenTypes: ["purpleair"]`; back on → key removed.
  - `toOptions` with `pollutant` equal to `firstPollutant` → no `showing`; another → `showing` set.
  - `toOptions` keeps `marks: ["a"]` through any change.
  - `toValues` with `drawn = "o3"` and `options.showing = "no2"` (fallback) → `pollutant: "o3"`.
  - `toValues` with a type absent from `hiddenTypes` and absent from `defaults` → `type:<t>: true`.
  - `activeFilters` with `hiddenTypes: ["purpleair"]` and `rows.types === false` → empty set.
  - `activeFilters` default (no keys) with `rows.inactive` → `hideInactive: true` (default off = hidden).
  - `groupsShown` with one pollutant → `pollutant: false`; `smokeAndFire` → `layers: true`;
    `monitorRowCount: 1` → `monitors: false`.
  - `withoutToolbar` keeps `marks`, drops every toolbar key.
  - `options.test.ts`: the schema accepts each new field, rejects `hiddenTypes` with duplicates or
    33 items, rejects an unknown key.
- [ ] **Step 2:** `npm run test:unit -- src/lib/widgets/map` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5:** Commit `feat(map): toolbar values, saved options and filters`.

### Task 5: Viewer changes (widget core) and "Make a copy"

**Files:**
- Create: `src/lib/widgets/shared/tile-options.svelte.ts`
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte` (provide the context; accept a
  `viewerChanges?: ViewerChanges` prop for view mode)
- Modify: `src/routes/SharedPage.svelte` (own a `ViewerChanges` per token; pass it; `makeCopy`
  copies `viewerChanges.applyTo(view.doc)`, fingerprint unchanged from today: computed from what
  it saves)
- Modify: `src/lib/documents/schema.ts` (export the per-type options check the body refine uses)
- Test: `src/lib/widgets/shared/tile-options.test.ts`, `src/routes/shared-page.browser.test.ts`

**Interfaces:**
- Produces (`$lib/documents/schema`): `widgetOptionsValid(type: string, options: unknown): boolean`
  (the same Note/Map checks `DashboardBodySchema` runs; the refine calls it).
- Produces (`tile-options.svelte.ts`):
  - `class ViewerChanges` — `get(widgetId): Record<string, unknown> | undefined`;
    `set(widgetId, values: Record<string, unknown>)` (merges keys; a key set to `undefined` is
    removed); `drop(widgetId, keys: string[])`; `applyTo(doc: Dashboard): Dashboard` (each widget's
    options with held keys over; a widget whose merged options fail `widgetOptionsValid` keeps its
    own; held changes for widgets not in `doc` are ignored); `prune(doc: Dashboard)` (forget
    widgets no longer in `doc`).
  - `TILE_OPTIONS_KEY` and `type TileOptionsContext = { mode: "edit"; session: DocumentSession } | { mode: "view"; changes: ViewerChanges }`.
  - `useTileOptions(): TileOptionsContext | undefined` (from context).
  - `tileOptions(ctx, widget: WidgetInstance): Record<string, unknown> | undefined` — edit: the
    widget's options; view: options with held keys over, falling back to the saved options when
    the merge fails `widgetOptionsValid`.
  - `changeTileOptions(ctx, widget: WidgetInstance, next: Record<string, unknown> | undefined, changedKeys: string[]): void`
    — edit: one `setWidgetData` change via `session.apply` (data unchanged, `options.from` the
    current options; null when equal; the starter hand-off as `saveMarks` does); view: `set` the
    changed keys' values from `next` (absent → `undefined`).
  - `viewerReset(ctx, widget, keys: string[])` — view only: `drop`.
- DashboardGrid: edit context when `editable`; view context with the given `viewerChanges`, or one
  it makes per session id for `readOnly === "unkept"` (Task 6). `$effect`: `changes.prune(doc)` on
  each document change (live updates).

- [ ] **Step 1: Write failing tests** (`tile-options.test.ts`):
  - edit mode: `changeTileOptions` applies exactly one change; `session.undo()` restores options.
  - view mode: after `changeTileOptions(..., {basemap:"x"}, ["basemap"])`, `tileOptions` has
    `basemap: "x"` and the session/doc is unchanged.
  - live update: held `{basemap:"x"}`; owner's new doc changes `clustered` → effective has owner's
    `clustered` and viewer's `basemap`.
  - `prune` after the owner removes the widget → `get(id)` undefined.
  - a held value that fails `widgetOptionsValid` (e.g. `hiddenTypes` duplicated) → `tileOptions`
    returns the saved options, and `applyTo` leaves that widget's options as saved.
  - `applyTo` on a doc with a Note keeps the Note (it's `view.doc`, not `forViewers`).
- [ ] **Step 2:** In `shared-page.browser.test.ts`: a viewer change, then "Make a copy" → the saved
  copy's Map widget has the changed option; the owner's remote doc is unchanged.
- [ ] **Step 3:** Run both → FAIL. Implement. Run → PASS.
- [ ] **Step 4:** Commit `feat: viewer changes for read-only views, kept by Make a copy`.

### Task 6: An "unkept" read-only dashboard shows its tiles

**Files:**
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte:344-352` and the view-mode branches
- Test: `src/lib/components/dashboard/` grid browser test (the existing one for read-only, or a new
  `dashboard-grid-readonly.browser.test.ts`)

**Interfaces:** Consumes Task 5's view context.

- [ ] **Step 1: Write failing tests:** a session with `readOnly: "unkept"` renders the
  `doc_readonly_unkept` message **and** its widgets, with no drag/resize handles, no "Add widget",
  and widget menus offering only what view mode offers (Fullscreen, Minimize); `"newer"` and
  `"invalid"` still render the message and no widgets.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: treat `"unkept"` like view mode for rendering (`shown = view ?? (session?.readOnly === "unkept" ? session.doc : undefined)`), keep the message bar above, autosave stays off (session is read-only already).
- [ ] **Step 4:** Run → PASS. Commit `feat: a read-only dashboard whose backup couldn't be kept shows its tiles`.

### Task 7: The toolbar's groups and icons

**Files:**
- Create: `src/lib/widgets/map/toolbar/toolbar.svelte.ts`, `src/lib/widgets/map/toolbar/icons.svelte` (icon snippets)
- Modify: `src/app.css` (tokens)
- Test: `src/lib/widgets/map/toolbar/toolbar.svelte.browser.test.ts`

**Interfaces:**
- Consumes: Task 4's `MapOffer`, `toValues`, `groupsShown`.
- Produces: `class MapToolbar` constructed **once per map** with `(map: MapContext)` — it calls
  `monitorsOptions(map)` once in the constructor. Method/getters used in `$derived` by the widget:
  `build(input: { offer: MapOffer; drawn: string | undefined; options: MapOptions; ownerValues?: OptionValues }): { groups: OptionGroup[]; defaults: OptionValues; values: OptionValues; rows: { types: boolean; inactive: boolean; inside: boolean } }`.
  - Pollutant + Monitors from `monitors.groups({ types, pollutants, pollutant: drawn, hasInactive, hasInside, collocation: false, icons })`; drop the Monitors group when `groupsShown(...).monitors` is false.
  - Layers: a group `{ id: "layers", label: m.…mapsdk_options_layers via messages, icon, rows: [hmsOptions(map).row] }` only when `offer.smokeAndFire`.
  - Settings: `settingsGroup(map, { icon })` built inside the call (reads `map.basemap.current`).
  - `defaults` = presets' defaults merged; for a viewer (`ownerValues` given) `defaults = ownerValues`.
  - `rows` reports which filter rows are offered (feeds `activeFilters`).
- Tokens (in `:root` and both dark blocks): `--map-icon-monitors` (light `#4682b4`),
  `--map-icon-layers`, `--map-icon-basemap`, `--map-icon-theme` (light `#708090`),
  `--map-icon-settings` (light `#696969`), `--map-icon-clusters` (light `#1e90ff`),
  `--map-icon-fire` (light `#ff4500`); dark values the implementer picks at ≥ 3:1 against the dark
  `--background`. Icons: Lucide `RadioTower`, `Layers`, `Settings`, `Network`, `Map`, `Contrast`,
  `Flame`, colored with `text-(--map-icon-…)`. Ids single tokens.

- [ ] **Step 1: Write failing tests** (browser, a real `createMap` without a key is fine if
  `npm run test:browser` already does this for the widget; otherwise a stub `MapContext` with
  `basemap`):
  - offer with 1 pollutant, 1 type, no smoke → groups are only `settings`.
  - 2 pollutants → a pollutant group whose chosen value is `drawn` (the fallback).
  - types spanning both groups → headings (rows of kind `group`); one group → flat.
  - `smokeAndFire` → a `layers` group with one `fireAndSmoke` checkbox.
  - `ownerValues` given → `defaults` equals it.
  - a contrast test: each `--map-icon-*` resolves, in light and dark, to ≥ 3:1 against `--background`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** `npm run test:unit -- src/lib/theme` → token-discipline and dark-block parity PASS.
- [ ] **Step 4:** Commit `feat(map): the toolbar's groups, presets and icon tokens`.

### Task 8: The toolbar on the Map tile

**Files:**
- Modify: `src/lib/widgets/map/MapWidget.svelte`
- Modify: `src/lib/widgets/map/frame.svelte.ts` (clear the old focus while a new place resolves)
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`

**Interfaces:** Consumes Tasks 3, 4, 5, 7.

Behaviour to wire:
- Options read through `tileOptions(useTileOptions(), widget)` and parsed with `mapOptions`; this
  replaces direct `mapOptions(widget)` reads (marks still save through `saveMarks`, owner-only).
- `MapView`'s `toolbar` snippet renders `OptionsToolbar {groups} {values} {defaults} basemapKey="basemap" onchange`.
  No `readonly` prop (viewers can use it). `onchange(next, changed)`: owner →
  `changeTileOptions(ctx, widget, toOptions(...), changed)`; a Reset (all `changed` keys back to
  `defaults`) is the same path — `toOptions` removes default-equal keys. Viewer →
  `changeTileOptions` with the changed keys; when every changed key now equals `ownerValues`,
  `viewerReset(ctx, widget, changed)` instead.
- `basemap` → `map.basemap.select(value ?? map.basemap.defaultId)` in an effect on the effective
  option (not in `onchange`, so undo/other tabs follow). No `onFallback` subscription.
- `clustered` → the monitors plugin's `clustered` option; the plugin effect re-adds on change.
- `fireAndSmoke === false` → the smoke and fire plugin effects don't add (queries keep loading).
- The monitors source's features pass through `filterMonitors(features, activeFilters(...))`.
- `entryType` uses the effective `showing`.
- The note banner (`data-map-note`) uses `top: var(--mapsdk-toolbar-height, 0px)`.
- `frame.svelte.ts`: while a new place is resolving, `frame.frame` is null for the focus area (the
  camera keeps its view); the focus area effect calls `plugin.set({ geometry: null })`.

- [ ] **Step 1: Write failing browser tests:**
  - a tile with two pollutants: picking the second saves `showing`; `session.undo()` reverts and
    the radio follows with no extra change applied.
  - Fire & Smoke off removes the smoke/fire plugins; on re-adds them; saved as `fireAndSmoke: false`, then key removed.
  - switching a type off hides its monitors; with only that type left (group hidden), they draw.
  - Reset removes every toolbar key, keeps `marks`.
  - view mode (a `ViewerChanges` context): a change doesn't touch the doc; Reset drops it.
  - fullscreen and back keeps the viewer change.
  - the note banner's computed `top` equals the toolbar's height variable.
  - a place change clears the focus area until the new frame arrives.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS (rerun alone if timing-flaky under load).
- [ ] **Step 3:** Commit `feat(map): the options toolbar on the Map tile`.

### Task 9: The hidden-marks reasons

**Files:**
- Modify: `src/lib/widgets/map/marks.ts`, `MapWidget.svelte`, `messages/en.json`
- Test: `src/lib/widgets/map/marks.test.ts`, `map-widget.browser.test.ts`

**Interfaces:**
- Produces: `type HiddenReason = "pollutant" | "options" | "places" | "unknown"`;
  `hiddenReasons(hidden: string[], monitors: Map<string, { type: string; active: boolean; inside: boolean }>, reports: (type: string) => boolean | undefined, filters: ReturnType<typeof activeFilters>): Map<HiddenReason, number>`
  — in the spec's order: type doesn't report → `pollutant`; filtered (type hidden, inactive or
  inside hidden) → `options`; otherwise found → `places`; not found → `unknown`.
- The widget gets `monitors` from `metadata.monitors()` (page-wide, already memoized), and
  `reports` from `metadata.monitorTypes()`'s `published`.
- Messages: `map_marks_hidden` takes `reason` (`pollutant` | `options` | `places` | `unknown`),
  `count`, `countValue`, `pollutant`; plural selectors per reason:
  - pollutant: "{count} marked monitor doesn't report {pollutant}" / "{count} marked monitors don't report {pollutant}"
  - options: "{count} marked monitor is hidden by the map's options" / "… are hidden by the map's options"
  - places: "{count} marked monitor is outside this map's places" / "… are outside this map's places"
  - unknown: "{count} marked monitor isn't shown" / "{count} marked monitors aren't shown"
  `map_label_marks_hidden` becomes `"{title} map. {notes}"` with `notes` the reason sentences
  joined with ". " — use the existing sentence/list join in the `format` module if there is one,
  else add `format.sentences(list)` (no hand-concatenated words; each part is a full sentence).
- The same lines go in `MapView`'s `featureList={{ reveal: "focus", note }}` and under the map.

- [ ] **Step 1: Write failing tests:** `hiddenReasons` cases for each reason and a mix (2 pollutant
  + 1 places → two entries); the browser test shows two lines for a mix and the map's
  `aria-label` contains both sentences.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Commit `feat(map): the hidden-marks note gives its reasons`.

### Task 10: Get data's "Show as" follows the drawn pollutant

**Files:**
- Modify: `src/lib/get-data/map.ts:138` (`mapShowingOnly`), `src/lib/get-data/GetDataView.svelte`
- Test: `src/lib/get-data/map.test.ts`

**Interfaces:** `mapShowingOnly(draft, catalog, drawable: readonly string[] | undefined)` uses
`drawableShowing` instead of `showingOf`. The caller passes `metadata.mapPollutants()` (array, or
`undefined` when `"unavailable"`).

- [ ] **Step 1:** Failing test: a draft with `showing: "no2"`, drawable `["pm25","o3"]`, layers
  pm25 and no2 → the converted draft's layer is `pm25`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `fix(get-data): Show as converts by the pollutant the Map draws`.

### Task 11: End-to-end

**Files:**
- Modify: `e2e/map.spec.ts`, the shared-page E2E spec (find it with `grep -l shared e2e/*.spec.ts`)

- [ ] **Step 1:** Add / extend:
  - Shift-click marks and the card stays closed (`expect(card).toBeHidden()`).
  - The spoken view summary updates after a refresh at a still view (route the monitors fixture
    to a second response with a different count) and after a place change that doesn't move the camera.
  - Toolbar: change pollutant, a type, Fire & Smoke and basemap; reload → kept; undo → reverted.
  - Shared live link: change the basemap and a type, confirm nothing reaches the server (no PUT/
    POST to the documents API), "Make a copy" → the copy has them.
  - Narrow tile: wait for the options button (`await expect(button).toBeVisible()`), open the panel,
    Esc closes and returns focus.
  - axe (WCAG 2.2 AA) with the toolbar open, light and dark.
- [ ] **Step 2:** `npm run test:e2e -- e2e/map.spec.ts` and the shared spec → PASS.
- [ ] **Step 3:** Commit `test(e2e): the Map toolbar, viewer changes, Shift-click and the view summary`.

### Task 12: Docs, budget and the PR

**Files:** `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, `ROADMAP.md`

- [ ] **Step 1:** ARCHITECTURE: every item in the spec's "`ARCHITECTURE.md` changes" list, and the
  pins in "The dashboard's Map widget" (`0.1.0-beta.13`, SDK `5.0.0-beta.10`). Note the dropped
  per-field fallback (Task 4).
- [ ] **Step 2:** DEFERRED: every removal, update and addition in the spec's "`DEFERRED.md` changes".
- [ ] **Step 3:** TODO/ROADMAP: spec 3 built, PR open.
- [ ] **Step 4:** `npm run lint`, `npm run check`, `npm run test`, `npm run build`,
  `npm run check:build`, `npm run check:budget` (note the KB number) → all pass.
- [ ] **Step 5:** Commit docs; push the branch; open the PR into `step-5` (body: summary, the
  budget number, test results; no AI attribution); `gh pr checks` until green; tell the coordinator
  the PR is open (they hold `TODO.md` table pushes until it merges). Don't merge.
