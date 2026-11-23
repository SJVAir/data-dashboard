# Step 5 spec 7c: schools and child care on the Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map can draw schools and child care sites, chosen in two What sections ("Schools",
"Child care") whose types, labels and order come from the regions meta, filtered by Where; plus
the flaky arrange-submenu browser test fixed at its cause.

**Architecture:** One new Map layer (`dataset: "locations"`, `locationTypes`) edited by the Map's
What; a new Map data entry (`src/lib/widgets/map/data/locations.ts`) fetches
`getPesticideLocations` per area (or valley-wide with no Where) and hands map-sdk's
`schoolsPlugin` one source; MapWidget mounts one plugin per location group. Location groups and
sources are read from the regions meta through `MetadataSource`.

**Tech Stack:** Svelte 5 runes, zod, `@sjvair/sdk` (pinned exactly; the 5.0.0 beta with location
groups and valley-wide locations arrives late), `@sjvair/map-sdk` `0.1.0-beta.22` (`schoolsPlugin`),
Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-step-5-spec-7-data-portal-design.md` → "7c"
(decisions 24–29 and "Settled at the 7c brainstorm"). Read it with this plan.

## Global Constraints

- Branch `step-5-spec-7c` in worktree `.worktrees/step-5-spec-7`; push `-u origin step-5-spec-7c`, never to `step-5`.
- Pins exact: `@sjvair/sdk` `5.0.0-beta.16` until Task 8; `@sjvair/map-sdk` `0.1.0-beta.22` throughout. Nothing newer except through the coordinator.
- Metadata is the source of truth: no location type id, group id, or label in widget code (the section heading, checkbox labels and Layers rows all come from the regions meta). The dataset id `"locations"` is the dashboard's own layer id, like `PESTICIDE_NOTICES`.
- The default pollutant stays `DEFAULT_LAYER` (`entryType: "pm25"`): the user's call, 2026-11-22. Don't touch it.
- None is never blocked. No checkbox means "everything" when empty: no ticked type means no layer.
- Nothing is live: no compatibility code for old saved Maps. `schemaVersion`, `load.ts`, `migrate-changes.ts` stay as they are.
- All UI copy through Paraglide; no concatenated sentences.
- Cards: map-sdk's hover tooltip is non-interactive; anything interactive only when pinned or focused. Keep card snippets mounted across refetches.
- The test FakeMap refuses what map-sdk refuses; legend text is tested through the real Legend or E2E.
- E2E pins noon Pacific; also run under `TZ=America/New_York`. The E2E fake copies shapes from real local responses (`e2e/` is type-checked by `npm run check`).
- Run the vitest suites one after another, never in parallel; rerun a lone browser failure alone before calling it a bug.
- Subagents never use `git stash`; stage by path, never `-A`. Commits are GPG-signed; on "No passphrase given" stop and ask. **No `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines** in commits or the PR.
- Report the initial bundle (`npm run build && npm run check:budget`; 215.2 KB after 7b; soft budget 250 KB) at every task that adds an import to shared code. Check for a stray `vite preview` on port 4173 before an E2E run.
- Every deferral goes into `DEFERRED.md` in the same commit, with why and a revisit trigger.

## Review Focus

1. **A Where with several overlapping areas** (a county and a city in it): each site drawn once (dedupe by feature `id`), and one request per area, not per type. Test in Task 4.
2. **The locations request failing** (one area of three, or the valley call): the Map says the schools failed (its existing failed-layer note pattern), every other layer still draws, and a retry happens on the next refetch. Test in Task 4 (source) and Task 6 (widget).
3. **A saved type or group the meta no longer lists:** a greyed checkbox that can still be unticked, never drawn, never an error opening the document. Test in Task 5.
4. **A school in Where whose ZIP has no region on the server** (resolver `null`) or whose location is gone: no schools, and the layer says why, not an empty silent map. Test in Task 4.
5. **The focus school with its type unticked or the layer off:** the focus pin draws as today (one row); with it ticked, one badge with the ring and one row. Test in Task 6 (FakeMap) and the Task 7 visual check.

---

### Task 1: The arrange-submenu flake, fixed at its cause

**Files:**
- Test: `src/lib/components/dashboard/arranging.browser.test.ts:1394-1450` (`focusItem`, "the submenu by keyboard: Enter repeats, focus leaves an item that turns disabled")
- Modify (only if the cause is in the app): the arrange submenu component found by the investigation
- Modify: `DEFERRED.md` → the "\"The submenu by keyboard…\" flaked in CI" entry (removed when fixed)

Independent of the other tasks; run it first so CI runs overlap with the rest. Use superpowers:systematic-debugging.

- [ ] **Step 1: Instrument.** On a throwaway commit pushed to `step-5-spec-7c`, log every bits-ui `onOpenChange` of the Move submenu and its parent menu with `new Error().stack` and `performance.now()`, plus each `press` in the test, to the browser console (vitest browser mode prints console output in CI logs).
- [ ] **Step 2: Reproduce in CI.** `gh workflow run ci.yml --ref step-5-spec-7c` five times (the failure rate on `step-5` was 1 in 4); read the failing runs' logs with `gh run view <id> --log-failed`. Expected: the stack that closes the submenu just after it opens.
- [ ] **Step 3: Write down the cause** in the ledger before changing anything. If it's the app (e.g. a re-render or focus move that closes the submenu), fix the app; if it's the test reading a transient state, make the test wait on the settled state: the submenu open, focus inside it, and still open after the next animation frame, rather than one poll.
- [ ] **Step 4: Drop the instrumentation;** keep the fix and any test change.
- [ ] **Step 5: Verify.** Locally: `npx vitest run --project browser src/lib/components/dashboard/arranging.browser.test.ts` passes. In CI: five more `gh workflow run ci.yml --ref step-5-spec-7c` runs, the browser job green in all five.
- [ ] **Step 6: Commit** the fix and the `DEFERRED.md` entry's removal (or its rewrite with what was found, if CI still fails).

### Task 2: Location groups and sources from the regions meta

**Files:**
- Modify: `src/lib/data/metadata.ts` (interface `MetadataSource`, `createWebMetadata`)
- Modify: `src/lib/data/testing/fixtures.ts` (the fake metadata)
- Modify: `src/lib/data/adapters/places.ts:13-26,108` (`LOCATION_SOURCES` → meta)
- Test: `src/lib/data/metadata.test.ts`, `src/lib/data/adapters/places.test.ts`
- Modify: `DEFERRED.md` → "The dashboard's school and child-care source table is hand-kept" (done; remove)

**Interfaces:**
- Produces, in `metadata.ts`:
  ```ts
  export type LocationTypeInfo = { type: string; label: string; source: string };
  export type LocationGroup = { key: string; label: string; order: number; types: LocationTypeInfo[] };
  // MetadataSource:
  /** The regions meta's location groups, by `order`, each with its types in meta order; a type
   *  with no (or an unknown) group is a group of its own (key = type, label = type label,
   *  ordered after the named groups). `[]` when the meta lists no location types. */
  locationGroups(signal?: AbortSignal): Promise<LocationGroup[]>;
  /** The location sources the regions meta lists (`location_types[t].source`), deduplicated. */
  locationSources(signal?: AbortSignal): Promise<string[]>;
  ```

- [ ] **Step 1: Failing tests** in `metadata.test.ts` with a stubbed regions meta in the suggested shape:
  `location_groups: { school: { key: "school", label: "Schools", order: 0 }, child_care: { key: "child_care", label: "Child care", order: 1 } }`, types `public_school`/`private_school` with `group: "school"`, `child_care` with `group: "child_care"`, plus an extra `"museum"` type with no group.
  - `locationGroups()` → `[{key:"school",…,types:[public, private]}, {key:"child_care",…}, {key:"museum", label:"Museum", order: 2, types:[museum]}]` (labels from the stub).
  - `locationSources()` → `["cde-public","cde-private","cdss-ccl", <museum's>]`.
  - In `places.test.ts`: a resolver asked for a source the meta lists makes one `getLocationsByCode` request; one it doesn't list resolves `null` with no request.
- [ ] **Step 2: Run** `npx vitest run src/lib/data/metadata.test.ts src/lib/data/adapters/places.test.ts`. Expected: FAIL (methods missing).
- [ ] **Step 3: Implement.** Until Task 8's SDK beta, the pinned SDK's types don't have `group`/`location_groups`: read them through one local type `RegionsMetaGroups` in `metadata.ts` over `getRegionsMeta()`'s result (Task 8 deletes it). Check whether the pinned SDK strips unknown keys; if it does, the real server yields one group per type until Task 8, which is acceptable in between (say so in the ledger). `createWebLocationResolver` awaits `getMetadata().locationSources()` (memoized in the metadata) in place of `LOCATION_SOURCES`. Add both methods to the fake in `testing/fixtures.ts` (returning the stub groups above).
- [ ] **Step 4: Run** the same tests, then `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** (with the `DEFERRED.md` removal).

### Task 3: The locations layer in the saved shape and the Map's draft helpers

**Files:**
- Modify: `src/lib/widgets/map/options.ts` (constant; `hiddenLocationGroups` option; `MAP_TOOLBAR_KEYS`)
- Modify: `src/lib/data/schema.ts:158-176` (`LayerSchema.locationTypes`)
- Modify: `src/lib/get-data/map.ts` (helpers, layer order at :191–213, `toMapDraft` at ~:355, `mapShowingOnly` at :413)
- Modify: `src/lib/get-data/now.ts:43` (`NowDropped` gains `"locations"`) and the "left out" note copy (Paraglide)
- Test: `src/lib/get-data/map.test.ts`, `src/lib/widgets/map/options.test.ts`, `src/lib/data/schema.test.ts` (or the file that tests `LayerSchema`), `src/lib/get-data/show-as.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // map/options.ts
  /** The Map's schools and child care layer (the dashboard's own id; no catalog entry). */
  export const LOCATIONS = "locations";
  // MapOptionsSchema: hiddenLocationGroups: unique SafeId array, max 32, optional ("Location groups switched off")
  // schema.ts LayerSchema:
  /** The locations layer's ticked location types (the regions meta's type keys). */
  locationTypes: uniqueIds("Location types must be unique").optional()
  // get-data/map.ts
  export function locationsLayer(data: WidgetDataConfig): Layer | undefined;
  /** Sets the ticked types (meta order kept by the caller); `[]` removes the layer. */
  export function setLocationTypes(data: WidgetDataConfig, types: string[]): void;
  ```
- Layer order (the validity check at `map.ts:191–213`): smoke and fire 0, notices 1, **locations 2**, use 3.

- [ ] **Step 1: Failing tests.**
  - `setLocationTypes(data, ["public_school"])` adds `{ dataset: "locations", locationTypes: ["public_school"] }` after any notices layer and before the use layer; `setLocationTypes(data, [])` removes it.
  - The layer-order check accepts `[hms, notices, locations, use]` and rejects `[use, locations]`.
  - `LayerSchema` rejects `locationTypes: ["a","a"]`.
  - `MapOptionsSchema` accepts `hiddenLocationGroups: ["school"]`, rejects duplicates.
  - `toMapDraft` (Map → Map) keeps the locations layer; `mapShowingOnly` of a Map with a pollutant and a locations layer returns `dropped` containing `"locations"` (not only `"overlays"`), and the layer is gone.
  - Show as from that Map to a Chart shows the "left out" note for schools and child care (copy: `get_data_dropped_locations` = "Schools and child care were left out."; final wording is the builder's).
- [ ] **Step 2: Run** `npx vitest run src/lib/get-data/map.test.ts src/lib/widgets/map/options.test.ts src/lib/get-data/show-as.test.ts` and the schema test. Expected: FAIL.
- [ ] **Step 3: Implement** the constant, schema field, option, helpers, order slot, `"locations"` drop and its note. `mapShowingOnly` pushes `"locations"` for the locations layer and keeps `"overlays"` only for the other non-pollutant layers.
- [ ] **Step 4: Run** the tests again and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: The locations data entry (fetching by Where)

**Files:**
- Create: `src/lib/widgets/map/data/locations.ts`
- Modify: `src/lib/widgets/map/data/types.ts:12` (`id` union gains `"locations"`)
- Modify: `src/lib/widgets/map/data/loaded.svelte.ts` (load and expose it, as the notices are: `locations`, `locationsState`, `locationsFailed`, `locationsUnavailable`)
- Test: `src/lib/widgets/map/data/locations.test.ts`, `src/lib/widgets/map/data/loaded.svelte.browser.test.ts`

**Interfaces:**
- Consumes: `locationsLayer` (Task 3); `RegionResolver.resolve(type, code, signal)` → `ResolvedRegion | null | "unsupported"` (`data/adapters/registry.ts:17`); `LocationResolver.resolve(source, code, signal)` (its `keys`, ZIP first: `FALLBACK_TYPES`); `placeRegion(input, signal)` (`data/index.ts:76`) for a point, with the `DEFAULT_LAYER` lookup as `sharing/points.ts:86` does.
- Produces:
  ```ts
  export type LocationsData = { features: PesticideLocationFeature[] }; // the SDK's feature type
  export const locationsEntry: MapDataEntry<LocationsData>; // id "locations"
  /** The region sqids the layer loads for `data`'s Where; "everywhere" with no Where;
   *  { unavailable } when a pick has no region on the server. */
  export function locationAreas(data: WidgetDataConfig, signal?: AbortSignal):
    Promise<string[] | "everywhere" | { unavailable: UnavailableReason }>;
  ```
- Rules: no locations layer → `source` returns `null` (nothing loaded). Every type is fetched (no `type` param); ticking never refetches. Results from several areas are merged and deduplicated by feature `id`. Not tied to the day shown (`at` is ignored: sites have no time), and not polled.

- [ ] **Step 1: Failing tests** (`locations.test.ts`, SDK call mocked as other entries' tests do):
  - A county in Where → one call with `region: <its sqid>`; a selection of a county and a city → two calls, a site in both drawn once.
  - A school in Where → one call for its first fallback key's region (ZIP).
  - A point in Where → one call for the region `placeRegion` returns.
  - A region the resolver answers `null` for → `{ unavailable }` with the existing "place gone" reason, no call.
  - No Where → `"everywhere"`; `source` for it is **not** wired until Task 8 (the pinned SDK requires an area): it returns `{ unavailable }` with a reason only in between, and Task 8 replaces it. Say so in the ledger.
  - One of two area calls rejects → the source reports failure (the notices' failure shape), not a partial list.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/data/locations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `locations.ts` on the `noticesEntry` pattern (`data/notices.ts`), and wire it into `loaded.svelte.ts` beside the notices (refetch when Where or the layer's presence changes, not when `locationTypes` changes).
- [ ] **Step 4: Run** the unit test and `npx vitest run --project browser src/lib/widgets/map/data/loaded.svelte.browser.test.ts`. Expected: PASS.
- [ ] **Step 5: Bundle check** (`npm run build && npm run check:budget`); `locations.ts` must load with the Map module only. Report the number.
- [ ] **Step 6: Commit.**

### Task 5: The Map's What: a section per location group

**Files:**
- Modify: `src/lib/get-data/what-sections.ts` (`whatSections`, `sectionTypes`)
- Modify: `src/lib/get-data/WhatSections.svelte` (the section body: a checkbox per type)
- Modify: `src/lib/get-data/GetDataView.svelte` (load `locationGroups()` with the catalog; pass it down)
- Test: `src/lib/get-data/what-sections.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Consumes: `LocationGroup` (Task 2), `setLocationTypes`/`locationsLayer` (Task 3).
- Produces: `whatSections(catalog, offered, layers, groups: LocationGroup[])`; a group's section key is `` `locations:${group.key}` ``; `export function locationSectionKey(group: string): string`. `sectionTypes(key, types)` offers `locations:*` sections to the Map only (others show them greyed with the Map-only reason, as the Map's own sections are).
- Order: the location sections come after the pesticide sections and before "Fill regions by", in `order`.

- [ ] **Step 1: Failing tests.**
  - `whatSections` with the two stub groups lists `locations:school` then `locations:child_care`, before `fill`; with `groups: []` lists none.
  - Browser, Map draft: the "Schools" section shows "Public school" and "Private school" checkboxes (labels from the fake meta), "Child care" one; ticking "Public school" stores `locationTypes: ["public_school"]`; ticking "Child care" too gives `["public_school","child_care"]` in meta order whatever the tick order; unticking all removes the layer. None in Air quality stays enabled throughout.
  - Browser, Chart draft: the location sections are greyed with the Map-only reason.
  - Browser: a saved Map whose layer has `locationTypes: ["gone_type"]` opens without error; "gone_type" shows as a greyed, ticked checkbox labelled with its id and a "no longer offered" reason, and can be unticked.
- [ ] **Step 2: Run** `npx vitest run src/lib/get-data/what-sections.test.ts` and `npx vitest run --project browser src/lib/get-data/get-data-view.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The heading is the group's label; each checkbox's label is the type's label. Groups load with the catalog; while they load, no location sections show; if they fail, none show and the failure is reported (as R8 in 7b).
- [ ] **Step 4: Run** the tests again. Expected: PASS.
- [ ] **Step 5: Bundle check** (new import in `GetDataView`); report the number.
- [ ] **Step 6: Commit.**

### Task 6: Drawing on the Map: plugins per group, Layers rows, cards, the focus school

**Files:**
- Modify: `src/lib/widgets/map/MapWidget.svelte` (mount the plugins; failure/unavailable notes)
- Modify: `src/lib/widgets/map/toolbar/wiring.svelte.ts` (a Layers row per group; `hiddenLocationGroups`)
- Modify: `src/lib/widgets/map/test-harness/` FakeMap (accept `schoolsPlugin` the way map-sdk does)
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`, the toolbar wiring test

**Interfaces:**
- Consumes: `locationsEntry`/the loaded `locations` (Task 4), `locationGroups()` (Task 2), `hiddenLocationGroups` (Task 3), map-sdk `schoolsPlugin({ id, source, layerLabel, types })`.
- Rules: one plugin per group that has a ticked type: `id: "locations-" + group.key`, `layerLabel: group.label`, `types` = that group's ticked types; a group switched off in the toolbar (`hiddenLocationGroups`) isn't mounted. Card content and hover come from the preset (it's `selectable: false`); check its hover tooltip is static and its pinned card reachable by keyboard, and record what you found in the ledger.
- The focus school: the frame's pin for a `location` place takes its coordinates from the location resolver (`framing.ts` `Need` kind `location`). Before relying on map-sdk's exact-match drop, compare a local school's `getLocationsByCode` `point` with its `pesticides/locations/` feature coordinates (read both from the local stack; never print the coordinates of a school found by a person's search, only "equal"/"differ"). If they differ, tell the controller: it's a server question for the coordinator, not a dashboard workaround.

- [ ] **Step 1: Failing tests** (browser, FakeMap):
  - A Map with `locationTypes: ["public_school","child_care"]` mounts two plugins, `locations-school` (types `["public_school"]`, label "Schools") and `locations-child_care`.
  - The toolbar shows a Layers row per mounted group; switching "Schools" off stores `hiddenLocationGroups: ["school"]` and unmounts that plugin only.
  - The locations failing → the Map's failed-layer note names schools and child care; the pollutant layer still draws.
  - A school in Where with its type ticked: the focus point's coordinates equal the site feature's (FakeMap records both); with the type unticked: the focus pin as today.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/widgets/map/map-widget.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests again and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: E2E and the visual check

**Files:**
- Modify: `e2e/fixtures/api/2.0/regions/meta.json` (groups in the suggested shape, copied from the real response once the server has it; until then the suggested shape, noted in the ledger)
- Modify: `e2e/map-data-server.ts` (a `pesticides/locations/` route; feature shape copied from a real local response: `id`, `source`, `external_id`, `name`, `type`, `type_label`, `address`, `city`, `school_district*`, `grade_span`, `enrollment`, `capacity`)
- Create or modify: `e2e/map.spec.ts` (a "schools and child care" describe)

- [ ] **Step 1: Failing E2E.**
  - A Map in Fresno County, tick "Public school" in the Data Portal, Save: one `pesticides/locations/` request with `region=<Fresno's sqid>` and no `type`; the legend shows "Schools" with "Public school".
  - Ticking "Child care" too makes no new request.
  - A Map with a school in Where and its type ticked: the feature list shows that school once.
  - Show as Chart from that Map shows the schools "left out" note.
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/map.spec.ts`. Expected: FAIL, then implement fixture/route gaps until PASS.
- [ ] **Step 3: Full E2E** `npm run test:e2e`, then `TZ=America/New_York npm run test:e2e`. Expected: all pass.
- [ ] **Step 4: Visual check (controller).** Playwright screenshots of: the two What sections; a Map with both groups (badges, count bubbles, legend); a pinned school card; the focus school with its ring. Look at them; anything off is a fix or a parked minor. Not committed.
- [ ] **Step 5: Commit.**

### Task 8: The SDK beta: real group fields and the valley-wide call

**Blocked on** the sjvair.com change and the `@sjvair/sdk` 5.0.0 beta the coordinator reports (location groups and no-area locations). The PR waits for it.

**Files:**
- Modify: `package.json`, `package-lock.json` (exact pin to the beta the coordinator names)
- Modify: `src/lib/data/metadata.ts` (delete `RegionsMetaGroups`; read the SDK's fields)
- Modify: `src/lib/widgets/map/data/locations.ts` (no Where → the SDK's valley-wide form)
- Modify: `e2e/fixtures/api/2.0/regions/meta.json`, `e2e/map-data-server.ts` (copy the real shapes)
- Test: `locations.test.ts`, `metadata.test.ts`, `e2e/map.spec.ts`

- [ ] **Step 1: Failing tests:** no Where → one valley-wide call (no area param, as the SDK defines it); a Map with no Where and "Child care" ticked draws every site (E2E).
- [ ] **Step 2: Pin, adapt, run** `npm run check`, the unit and browser suites, and the full E2E (both time zones). Expected: all pass. Also read the real local `regions/meta/` and `pesticides/locations/` (no area) responses and match the fixtures to them; report the valley call's size.
- [ ] **Step 3: Bundle check;** report the number.
- [ ] **Step 4: Commit.**

### Task 9: Docs, final review, PR

- [ ] **Step 1: Final whole-branch review** (one reviewer over `origin/step-5...HEAD`, the ledger's parked minors included) and its single fix wave.
- [ ] **Step 2: Docs.** `ARCHITECTURE.md` → "Map SDK" and "Widget data selection" (the locations layer, groups from the regions meta); `DEFERRED.md`: remove "Schools and child care as a Map data set", "The focus school drawn twice" (unless the visual check showed it twice), the source-table entry (Task 2), the submenu flake (Task 1); update "map-sdk: a focus point under a school, edge cases", "map-sdk: schools' count bubbles, small gaps" (still true: say checked against `0.1.0-beta.22`), "map-sdk: no schools store" (unchanged: other hosts), "Comparing mixed kinds of place in one widget" and "A point's or school's fallback isn't shared…" (unchanged by 7c: say so only if wording needs it); "A new widget's pollutant from the monitors meta's `default_pollutant`" is already in (added with this plan); "Schools' 3×3 section block" and "within about a mile" unchanged (not fired). `TODO.md` status. The spec's "Calls made during the build" gets 7c's rulings.
- [ ] **Step 3:** `git fetch`, merge `origin/step-5`, run the suites, push, open the PR into `step-5` (no AI attribution lines). Tell the coordinator the PR number.
- [ ] **Step 4:** Wait for green CI on the final head; then ask the user before merging. Raise "Comparing two datasets" (`DEFERRED.md`): schedule it or keep it deferred.
