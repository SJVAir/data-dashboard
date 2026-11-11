# Step 4, spec 2: the shared place picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One lazily loaded place picker (search, browse, recent, "Use my location"; single or
several places) wired into the Chart and Data table, with point and school places showing data
through the ZIP → city → county fallback, and exact locations protected when sharing.

**Architecture:** A new `src/lib/places/` module holds the picker's data (directory of region
types, location types, monitors; search; selection rules; recent places) and its components; it
is only reached through a lazily loaded dialog. The data layer (`src/lib/data/`) gains location
and point targets with a fallback over candidate regions, used both for rendering and for the
privacy swap. Geolocation is a new platform capability. Sharing (`src/lib/sharing/`) swaps
points for regions on the way out.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, `@sjvair/sdk` `5.0.0-beta.2` (exact pin),
bits-ui / shadcn-svelte (Dialog), Paraglide, Tailwind v4 tokens, zod, Vitest (unit + browser),
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-step-4-spec-2-place-picker-design.md` (read it
first; this plan argues from it). Mockups: `.superpowers/brainstorm/*/content/picker-*.html`.

**Branch:** `step-4-spec-2` (exists, with the spec commits; from `origin/step-4`), PR into
`step-4`.

## Global Constraints

- SDK pinned exactly: `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.2"` (no caret; lockfile
  root entry matches). Don't pin beta.3 until the user says it's out.
- Never read `boundary.geometry` from `searchRegionPlaces` rows (beta.2 still types it).
- Search from 2 characters (trimmed), debounced ~250 ms, each query aborts the previous one.
- Caps: Chart `maxPlaces: 5`, Data table `maxPlaces: 10`; recent places at most **8**.
- Several places are one `SpatialSelection` (`kind: "monitors" | "regions"`, region ids
  `"type:code"`); one place is a `PlaceRef`. Schools and points are single-place only.
- Fallback order for points and schools: `zipcode` → `city` → `county`; "has data" = any point in
  the widget's date range.
- Coordinates only ever leave the browser through `lookupRegionPlace({ lat, lon, type })` (POST
  body); never in a URL, a log, an error report, or the recent list.
- Labels, plurals, types, counts, parents, location types, monitor networks and their entry
  types come from metadata (`regions/meta/`, `monitors/meta/`); never hardcoded. Browse headings
  use the singular `label` until beta.3 (`label_plural`).
- All text through Paraglide (`messages/en.json`), no concatenated sentences; `$lib/format`;
  never store generated English (`PlaceRef.point.label` is never set by the app).
- Geolocation and recent places only through the platform adapter.
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`); WCAG 2.2 AA; W3C combobox
  pattern; disabled rows `aria-disabled` with a reason, never color alone.
- `src/lib/places/` and `src/lib/data/` are imported only from lazily loaded code. Initial-chunk
  code (menu items, idle button) reaches them with dynamic `import()` or through `lazy.svelte.ts`.
- Browser tests: `animationsSettled(el)`, `page.viewport(1280, 800)` for desktop, axe as in
  `LevelSwatch.browser.test.ts`; formatted times match an optional `" PT"`.
- No AI attribution in commits or PRs. `npm run format` before each commit. Every deferral into
  `DEFERRED.md` in the same change.

## Review Focus

1. **A point outside every county, or a lookup that fails mid-share.** The widget shows "Your
   location is outside the area SJVAir covers" (never a crash), and sharing never falls back to
   the exact point: a point with no containing region is cleared from the shared copy (the
   recipient sees the idle state), a failed lookup makes the share wait with Retry. (Task 9,
   Task 13.)
2. **A shared or imported document with junk places.** A `location` with an unknown source, a
   monitor id not in the list, a selection mixing a school into `regions` ids, more places than
   `maxPlaces`: the right state, never a crash; the picker opened on it shows what it can and
   lets the person fix it. (Task 6, Task 9.)
3. **Typing fast, then closing.** Stale responses never overwrite newer ones; closing the
   dialog aborts in-flight searches and geolocation; no toast or announcement after close.
   (Task 5, Task 10.)
4. **A monitors-list failure.** Search still shows regions and schools with "Couldn't search
   monitors. Retry"; saved monitors keep the error/Retry state instead of "no longer
   available". (Task 5, Task 9.)
5. **Live link turned on in another tab while the picker is open.** "Use my location" checks the
   live-link state when the pick is applied, not when the dialog opened. (Task 12.)

---

### Task 1: Pin `@sjvair/sdk` 5.0.0-beta.2 and drop `exact`

**Files:**

- Modify: `package.json`, `package-lock.json`
- Modify: `src/lib/data/adapters/air-quality-fetch.ts` (`rawTasks` and its doc comment)
- Modify: `src/lib/data/adapters/air-quality.test.ts` (`{ exact }` options)

- [ ] **Step 1:** Set `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.2"` and run `npm install`.
      Check `package-lock.json`'s root `packages[""].dependencies["@sjvair/sdk"]` is the same
      exact string and `node_modules/@sjvair/sdk/deno.json` says `5.0.0-beta.2`.
- [ ] **Step 2:** Remove `exact: true` from the `getValidDateRange` call in `rawTasks` and the
      sentence about it in the doc comment (beta.2 is exact by default; `wholeDays: true` would
      round out). Remove `{ exact }` from the test's calls/expectations.
- [ ] **Step 3:** Run `npm run check && npm run test:unit`. Expected: PASS. If a type error
      surfaces elsewhere from the 5.0 rename (e.g. `getHMSSmoke` signatures), fix it at the call
      site without changing behavior.
- [ ] **Step 4:** Commit `chore(deps): pin @sjvair/sdk 5.0.0-beta.2; drop exact (now the default)`.
      Message the coordinator (`data-dashboard-2c`) that the pin landed on `step-4-spec-2`.

### Task 2: Merge `origin/main` into `step-4` (small PR), then into this branch

**Files:** whatever conflicts (`DEFERRED.md`, `TODO.md`, `ROADMAP.md`, `ARCHITECTURE.md` likely).

- [ ] **Step 1:** `git fetch`; check `main` matches `origin/main`. From `origin/step-4`, create
      `step-4-sync-main`, `git merge origin/main`. Resolve conflicts by keeping both sides'
      entries; if one is unclear, ask the coordinator before choosing.
- [ ] **Step 2:** `npm ci && npm run check && npm run test`. Expected: PASS.
- [ ] **Step 3:** Push and open a PR into `step-4` titled "Merge main into step-4 (before spec
      2)". Tell the user and the coordinator; **wait for the user's yes to merge it.**
- [ ] **Step 4:** After it merges, `git merge origin/step-4` into `step-4-spec-2` (Task 1's commit
      stays on top). Run `npm run check && npm run test:unit`. Expected: PASS.

### Task 3: Geolocation capability and recent places

**Files:**

- Modify: `src/lib/platform/types.ts` (new `GeolocationAccess`; `Platform.geolocation`)
- Create: `src/lib/platform/web/geolocation.ts`
- Modify: `src/lib/platform/memory.ts`, `src/lib/platform/index.ts`, the web platform factory
- Create: `src/lib/places/recent.ts`, `src/lib/places/recent.test.ts`
- Test: `src/lib/platform/memory.test.ts` (geolocation part)

**Interfaces:**

- Produces:

```ts
// platform/types.ts
export type GeoResult =
	| { ok: true; lat: number; lon: number }
	| { ok: false; reason: "denied" | "unavailable" | "timeout" | "unsupported" };
export interface GeolocationAccess {
	/** Asks once (the browser may prompt). Rejects only with the signal's reason when aborted. */
	locate(signal?: AbortSignal): Promise<GeoResult>;
}
// memory platform: geolocation.script(result: GeoResult) sets the next answer (default unsupported)

// places/recent.ts
export const RECENT_KEY = "places.recent";
export const RECENT_MAX = 8;
export type RecentRef = Exclude<PlaceRef, { kind: "point" } | { kind: "default-place" }>;
export function readRecent(platform: Platform, space: SpaceId): Promise<RecentRef[]>;
export function addRecent(platform: Platform, space: SpaceId, ref: PlaceRef): Promise<void>;
```

- [ ] **Step 1: Write failing tests** in `recent.test.ts` (memory platform):
      `addRecent` puts the newest first; a re-pick moves it to the top without duplicating
      (equality by kind + identity fields); the list never exceeds 8; a `point` or
      `default-place` is ignored; a stored value that fails the schema (`z.array(...).max(8)`
      over the non-point `PlaceRefSchema` kinds) reads back as `[]`. In `memory.test.ts`:
      `locate()` returns the scripted result; an aborted signal rejects with its reason.
- [ ] **Step 2:** Run `npx vitest run src/lib/places/recent.test.ts src/lib/platform/memory.test.ts`.
      Expected: FAIL (missing modules).
- [ ] **Step 3: Implement.** Web `locate` wraps `navigator.geolocation.getCurrentPosition`
      (`enableHighAccuracy: false`, `timeout: 15000`, `maximumAge: 300000`); error codes map
      1 → denied, 2 → unavailable, 3 → timeout; no `navigator.geolocation` → unsupported. It
      never logs or reports the coordinates. Recent places use `platform.preferences`.
- [ ] **Step 4:** Run the tests again. Expected: PASS. `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(platform): geolocation capability; recent places`.

### Task 4: The place directory (metadata for the picker)

**Files:**

- Modify: `src/lib/data/metadata.ts` (`MetadataSource.monitors` rows gain `county`, `active`;
  new `monitorTypes`; shared memo of `getMonitorsList`/`getMonitorsMeta`)
- Create: `src/lib/places/directory.ts`, `src/lib/places/directory.test.ts`
- Create: `src/lib/places/types.ts`

**Interfaces:**

- Produces:

```ts
// data/metadata.ts (MetadataSource additions)
monitors(signal?): Promise<Array<{ id: string; name: string; type: string; county: string; active: boolean }>>;
monitorTypes(signal?): Promise<Array<{ type: string; label: string; entryTypes: string[] }>>;

// places/types.ts
export type RegionTypeInfo = { type: string; label: string; plural: string; count: number; parents: string[] };
export type LocationTypeInfo = { type: string; label: string; source: string };
export type MonitorOption = { kind: "monitor"; id: string; name: string; network: string; county: string; active: boolean };
export type RegionOption = { kind: "region"; type: string; code: string; name: string; typeLabel: string; county: string | null };
export type LocationOption = { kind: "location"; source: string; code: string; name: string; typeLabel: string; city: string; zip: string; address: string };
export type PlaceOption = MonitorOption | RegionOption | LocationOption;
export type PointPlace = Extract<PlaceRef, { kind: "point" }>;
export function refOf(option: PlaceOption): PlaceRef;
export function sameRef(a: PlaceRef, b: PlaceRef): boolean;

// places/directory.ts
export interface PlaceDirectory {
	/** Browsable types with count > 0, server order. `plural` = `label` until beta.3. */
	regionTypes(signal?: AbortSignal): Promise<RegionTypeInfo[]>;
	locationTypes(signal?: AbortSignal): Promise<LocationTypeInfo[]>;
	/** Monitors that can supply `entryType` (by type), active first then by name; `activeOnly` drops the rest. */
	monitors(entryType: string, opts: { activeOnly: boolean }, signal?: AbortSignal): Promise<MonitorOption[]>;
	/** A type's current (non-retired) regions, optionally within one parent region. */
	regionsIn(type: string, parent: { type: string; code: string } | null, signal?: AbortSignal): Promise<RegionOption[]>;
}
export function createPlaceDirectory(ctx: { metadata: MetadataSource; regions: RegionResolver }): PlaceDirectory;
```

- [ ] **Step 1: Write failing tests** with a fake `MetadataSource` and SDK mocks
      (`vi.mock("@sjvair/sdk")`): `regionTypes` drops `browsable: false` and `count: 0` types and
      keeps order, `plural === label`; `monitors("o3", …)` hides a PurpleAir whose type entries
      lack `o3`, keeps an AirNow, sorts active before inactive then by name, and drops inactive
      with `activeOnly`; `network` is the monitor type's `label`; `regionsIn("zipcode", { type:
      "county", code: "06107" })` resolves the county through `RegionResolver` and calls
      `getRegionsList({ type: "zipcode", within: <sqid> })`; retired rows are left out;
      `refOf`/`sameRef` round-trip each kind.
- [ ] **Step 2:** Run `npx vitest run src/lib/places/directory.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Memoize per directory (one fetch of `getRegionsMeta` and of each
      `regionsIn` key). `regionsIn` with `county` filled only when rows carry it (beta.3); until
      then `null`. A `TODO(beta.3)` comment names `label_plural`, the `county` field, and
      `getMonitorsList`'s region option.
- [ ] **Step 4:** Run tests, `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(places): place directory from region and monitor metadata`.

### Task 5: Combined search

**Files:**

- Create: `src/lib/places/search.ts`, `src/lib/places/search.test.ts`

**Interfaces:**

- Consumes: `PlaceDirectory`, `PlaceOption` (Task 4).
- Produces:

```ts
export type SearchGroup<T extends PlaceOption> =
	| { status: "ready"; options: T[]; more: boolean }
	| { status: "error"; error: unknown };
export type SearchResult = {
	query: string;
	locations: SearchGroup<LocationOption>;
	regions: SearchGroup<RegionOption>;
	monitors: SearchGroup<MonitorOption>;
};
export const MIN_QUERY = 2;
export const MONITOR_RESULTS = 10;
export function searchPlaces(
	query: string,
	ctx: { directory: PlaceDirectory; entryType: string; activeOnly: boolean },
	signal: AbortSignal
): Promise<SearchResult>;
/** Monitors matching `q`: word-start matches first, then substring; active before not reporting; then name. */
export function matchMonitors(monitors: MonitorOption[], q: string): { options: MonitorOption[]; more: boolean };
```

- [ ] **Step 1: Write failing tests:** under 2 trimmed characters no SDK call is made and every
      group is `ready` and empty; the three searches start together (`searchLocations({ q,
      signal })`, `searchRegionPlaces(q, undefined, { signal })`, the directory's monitors);
      one rejected group is `error` while the others are `ready`; region rows that are retired
      are dropped and `typeLabel` comes from `regionTypes()`; location `typeLabel` from
      `locationTypes()`; `more` passes through from `searchLocations`; `matchMonitors` returns at
      most 10 with `more: true` beyond; "fre" ranks "Fresno - Garland" before "Clovis Freeway";
      an aborted signal rejects and no group resolves after it.
- [ ] **Step 2:** Run `npx vitest run src/lib/places/search.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Groups use `Promise.allSettled`; region rows read only `id`, `name`,
      `type`, `external_id`, `retired` (and `county` once typed). Debouncing lives in the
      component (Task 10), not here.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(places): combined place search`.

### Task 6: Selection rules

**Files:**

- Create: `src/lib/places/selection.ts`, `src/lib/places/selection.test.ts`

**Interfaces:**

- Produces:

```ts
export type PickerMode = { kind: "single" } | { kind: "multiple"; max: number };
export type Picks = PlaceRef[]; // ordered; points/locations only ever alone
export type BlockReason =
	| "other-kind-regions" // "This widget compares regions. Remove the regions to compare monitors."
	| "other-kind-monitors"
	| "single-only" // a school or location can't be added to other places
	| "alone-picked" // a school or location is picked; remove it first
	| "at-cap"; // "This widget shows up to {max} places."
export function blockReason(picks: Picks, candidate: PlaceRef, mode: PickerMode): BlockReason | null;
export function toggle(picks: Picks, candidate: PlaceRef, mode: PickerMode): Picks;
/** The layer fields for the picks: one → `place`, several → `selection`, none → neither. */
export function toLayerPlaces(picks: Picks): { place?: PlaceRef; selection?: SpatialSelection };
/** The picks a layer holds (a selection's region ids split back into refs; invalid ids dropped). */
export function fromLayer(layer: Pick<Layer, "place" | "selection">): Picks;
```

- [ ] **Step 1: Write failing tests:** in single mode nothing is ever blocked and `toggle`
      replaces; in multiple mode with nothing picked nothing is blocked; after a region, a
      monitor gets `other-kind-regions` and vice versa; after anything, a location or point gets
      `single-only`; after a location, everything gets `alone-picked`; at `max` a new candidate
      gets `at-cap` but a picked one can still be toggled off; `toLayerPlaces` of 1 region is
      `{ place }`, of 2 regions `{ selection: { kind: "regions", ids: ["county:06019",
      "county:06107"] } }`, of 2 monitors `kind: "monitors"`; `fromLayer` round-trips; a
      selection with more than `max` ids loads them all (the picker shows them; the cap blocks
      adding only).
- [ ] **Step 2:** Run `npx vitest run src/lib/places/selection.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Region ids split with `splitRegionKey`
      (`src/lib/data/adapters/targets.ts`).
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(places): selection rules for one or several places`.

### Task 7: Point and school places in the data layer

**Files:**

- Modify: `src/lib/data/types.ts` (`Target`, `PlaceInfo`, `UNAVAILABLE_REASONS`)
- Modify: `src/lib/data/adapters/registry.ts` (`AdapterContext` gains `locations`, `points`)
- Modify: `src/lib/data/adapters/targets.ts` (`layerTarget` for `location` and `point`)
- Modify: `src/lib/data/adapters/air-quality.ts` (fallback fetch)
- Create: `src/lib/data/adapters/places.ts` (web resolvers), `src/lib/data/adapters/places.test.ts`
- Modify: `src/lib/data/index.ts` (wire resolvers; export `placeRegion`)
- Test: `src/lib/data/adapters/targets.test.ts`, `src/lib/data/adapters/air-quality.test.ts`

**Interfaces:**

- Produces:

```ts
// data/types.ts
export type Via = { kind: "point" } | { kind: "location"; name: string; retired?: { since: string; replacedBy: { source: string; code: string } | null } };
export type Target =
	| { kind: "monitors"; ids: string[] }
	| { kind: "regions"; keys: string[] }
	| { kind: "fallback"; via: Via; keys: string[] } // region keys tried in order
	| { kind: "all" };
// PlaceInfo gains: via?: Via   (name stays the region's display name)
// UNAVAILABLE_REASONS gains: "location-unresolved", "point-outside", "monitor-unlisted" (Task 9 uses the last)

// adapters/registry.ts
export interface LocationResolver { resolve(source: string, code: string, signal?: AbortSignal): Promise<{ name: string; keys: string[]; retired?: { since: string; replacedBy: { source: string; code: string } | null } } | null>; }
export interface PointResolver { keys(lat: number, lon: number, signal?: AbortSignal): Promise<string[]>; }
export type AdapterContext = { metadata: MetadataSource; regions: RegionResolver; locations: LocationResolver; points: PointResolver };

// data/index.ts
/** The region a point or location layer uses now (the same rule as rendering); the last candidate when none has data; null when it has none. */
export function placeRegion(input: QueryInput, signal?: AbortSignal): Promise<{ type: string; code: string } | null>;
```

`keys` are `"zipcode:…"`, `"city:…"`, `"county:…"` in that order, only those present.

- [ ] **Step 1: Write failing tests.** `places.test.ts`: the web `LocationResolver` batches
      `getLocationsByCode(source, codes)` per source (≤ 100), maps `regions.zipcode/city/county`
      to ordered keys, keeps `retired`, returns `null` for an absent code and an unknown source;
      the web `PointResolver` calls `lookupRegionPlace({ lat, lon, type: ["zipcode", "city",
      "county"] })` once per rounded point (3 decimals) and orders the keys. `targets.test.ts`:
      a location → `{ kind: "fallback", via: { kind: "location", name }, keys }`; unknown →
      `{ unavailable: "location-unresolved" }`; a point with no keys → `{ unavailable:
      "point-outside" }`. `air-quality.test.ts`: a fallback target whose ZIP has points in the
      range returns the ZIP's series with `PlaceInfo.via` set; an empty ZIP falls to the city;
      all empty returns the county's (empty) series; one series per query, never several.
      `placeRegion` returns the key used, or the last key when none has data.
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** The adapter fetches candidates in order through its existing region
      path (same request units and cache), stopping at the first with any point in the range.
      `placeRegion` runs `layerTarget` and the same fallback (export the fallback helper from
      `air-quality.ts` so rendering and sharing share it). Error reports never include `lat`/`lon`.
- [ ] **Step 4:** Run tests, `npm run check`, `npm run test:unit:tz`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(data): school and point places through the ZIP, city, county fallback`.

### Task 8: Place labels in titles, tables, and CSV

**Files:**

- Modify: `src/lib/widgets/title.ts` (+ `title.test.ts`), `src/lib/widgets/table/rows.ts`,
  `src/lib/data/csv.ts`, `src/lib/widgets/shared/data-widget.svelte.ts`
- Create: `src/lib/widgets/shared/viewer.ts` (context key)
- Modify: `messages/en.json`

**Interfaces:**

- Consumes: `PlaceInfo.via` (Task 7).
- Produces:

```ts
// widgets/shared/viewer.ts
export const PLACE_VIEWER_KEY: unique symbol;
export type PlaceViewer = "owner" | "shared"; // default "owner"
// widgets/title.ts
export function placeLabel(info: PlaceInfo, viewer: PlaceViewer): string;
```

Messages (exact English): `place_via_point_mine` "{region} (your location)",
`place_via_point_shared` "{region} (shared location)", `place_via_location` "{region}
({location})". `dataTitle` uses `placeLabel` for each place.

- [ ] **Step 1: Write failing tests** in `title.test.ts`: a point place reads "ZIP 93721 (your
      location)" for the owner and "ZIP 93721 (shared location)" for `"shared"`; a location reads
      "ZIP 93702 (Roosevelt High School)"; a plain region is unchanged; `rows.ts` header and the
      CSV place column use the same label; the CSV never contains the point's coordinates.
- [ ] **Step 2:** Run `npx vitest run src/lib/widgets/title.test.ts src/lib/widgets/table src/lib/data/csv.test.ts`.
      Expected: FAIL.
- [ ] **Step 3:** Implement. `DataWidget` reads `getContext(PLACE_VIEWER_KEY) ?? "owner"`; the CSV
      (no Svelte context) takes the viewer as a parameter from its caller.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(widgets): label school and location places by source`.

### Task 9: Unlisted monitors and retired schools

**Files:**

- Modify: `src/lib/data/adapters/air-quality.ts` (`target`), `src/lib/data/adapters/targets.ts`
- Modify: `src/lib/widgets/shared/WidgetState.svelte`, `src/lib/widgets/shared/retired.ts`
  (+ tests), `messages/en.json`
- Test: `src/lib/widgets/shared/widget-state.browser.test.ts`, `air-quality.test.ts`

**Interfaces:**

- Consumes: `metadata.monitors` (Task 4), `Via.retired` (Task 7).
- Produces: `withReplacements` also swaps a retired location (`via.retired.replacedBy`) for
  `{ kind: "location", source, code }`.

- [ ] **Step 1: Write failing tests:** with the monitors list loaded and the id absent, `target`
      returns `{ unavailable: "monitor-unlisted" }` (a selection with any absent id too); with
      the list failing, the query runs as before (error/Retry path); WidgetState shows the "no
      longer available" card for `region-unresolved`, `location-unresolved`, and
      `monitor-unlisted`, with **Choose another** and **Remove** when editable (Choose another
      calls a new `onchoose` prop; hidden when the prop is absent); "point-outside" shows "Your
      location is outside the area SJVAir covers." with Choose another; a retired location shows
      the note "{name} is no longer listed (since {date})" and Switch when it has a
      replacement; axe clean.
- [ ] **Step 2:** Run the two test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Move `DEFERRED.md`'s "An unknown monitor shows the error…" and "A
      monitor missing from the monitors list gets the uncalibrated series silently" to Done with
      today's date and this spec.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(widgets): no longer available for unlisted monitors; retired schools`.

### Task 10: The picker component: search, results, chips, my location

**Files:**

- Create: `src/lib/places/PlacePicker.svelte`, `src/lib/places/ResultList.svelte`,
  `src/lib/places/picker-state.svelte.ts`, `src/lib/places/place-picker.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**

- Consumes: Tasks 3–6.
- Produces:

```ts
// PlacePicker.svelte props
{
	directory: PlaceDirectory;
	purpose: { dataset: string; entryType: string };
	mode: PickerMode;
	activeOnly?: boolean;          // default false
	initial: Picks;
	recent: PlaceOption[]; // resolved by the dialog (Task 12)
	locate: (signal: AbortSignal) => Promise<GeoResult>;
	pointKeys: (lat: number, lon: number, signal: AbortSignal) => Promise<string[]>; // outside check
	ondone: (picks: Picks) => void; // single mode: on the first pick
	oncancel: () => void;
}
```

- [ ] **Step 1: Write failing browser tests** (desktop and 390 px wide): the input is focused with
      the placeholder "Search for a city, ZIP, school, or monitor"; before typing, Recent rows
      and "Use my location" and Browse show; typing "fr" (after the debounce) shows three labeled
      groups; ArrowDown/ArrowUp move `aria-activedescendant` across groups, Enter picks, Escape
      clears then calls `oncancel`; the live region says "12 results" / "No matches" once
      settled; a stale response (resolved after a newer query) is ignored; a failed group shows
      "Couldn't search monitors." with Retry while others show; "More matches. Keep typing to
      narrow them down." when `more`; a blocked row is `aria-disabled`, focusable, and its
      reason is its `aria-describedby` text; multiple mode shows chips with labeled remove
      buttons, Done and Cancel; "Use my location" with `{ ok: true }` and keys calls `ondone([{
      kind: "point", lat, lon }])` at once; with `denied` shows "Location access is off. Search
      for a place instead."; with no keys shows "Your location is outside the area SJVAir
      covers." and picks nothing; unmounting aborts searches and `locate`; axe clean.
- [ ] **Step 2:** Run `npx vitest run src/lib/places/place-picker.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the W3C editable-combobox-with-listbox pattern (input
      `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; `listbox`
      with `role="group"` sections labeled by their headings). Debounce 250 ms; one
      `AbortController` per query. Row content per the spec ("Result rows"); "Not reporting" as
      text. Tokens only.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(places): place picker with combined search`.

### Task 11: Browse

**Files:**

- Create: `src/lib/places/BrowsePanel.svelte`, `src/lib/places/browse.browser.test.ts`
- Modify: `src/lib/places/PlacePicker.svelte`, `messages/en.json`

**Interfaces:**

- Consumes: `PlaceDirectory.regionTypes`, `regionsIn`, `monitors` (Task 4); `blockReason`,
  `toggle` (Task 6).

- [ ] **Step 1: Write failing browser tests:** Browse lists each `regionTypes()` entry with its
      count (formatted through `$lib/format`) plus "Monitors"; opening "ZIP Code" (singular until
      beta.3) shows an "In:" control defaulting to all counties and a filter box; choosing Tulare
      County calls `regionsIn("zipcode", { type: "county", code: "06107" })`; the filter box
      narrows by name; an empty narrowing shows "Nothing here" (not an error); a county row's
      "Inside ›" button (labeled "Inside Tulare County") lists child types (those whose `parents`
      include `county`) and opens one already narrowed; Back returns and restores focus; in
      multiple mode rows are checkboxes in an `aria-multiselectable` listbox and blocked rows
      carry their reason; Monitors is a flat filterable list; axe clean.
- [ ] **Step 2:** Run `npx vitest run src/lib/places/browse.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Long lists render incrementally (the builder's choice of windowing or
      "Show more"), never all ~1,160 tracts' DOM at once.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(places): browse regions by type, narrowed by county`.

### Task 12: The picker dialog and its entry points

**Files:**

- Create: `src/lib/places/PlacePickerDialog.svelte`, `src/lib/places/apply.ts` (+ `apply.test.ts`)
- Modify: `src/lib/components/dialogs/lazy.svelte.ts` (`placePicker` entry, `openPlacePicker`),
  `src/lib/components/dialogs/LazyDialogs.svelte`
- Modify: `src/lib/actions/widget.ts` (`placeItems`), `src/lib/components/dashboard/WidgetFrame.svelte`
- Modify: `src/lib/widgets/shared/WidgetState.svelte` (idle "Choose a place"; `onchoose`)
- Modify: `messages/en.json`
- Test: `src/lib/places/place-picker-dialog.browser.test.ts`, `src/lib/actions/widget.test.ts`

**Interfaces:**

- Consumes: everything above; `setWidgetData` change.
- Produces:

```ts
// lazy.svelte.ts
export function openPlacePicker(opts: { widgetId: string }): void;
// actions/widget.ts
/** "Change place" for an editable widget whose type has `accepts.maxPlaces`; none otherwise. */
export function placeItems(app: AppContext, widget: () => WidgetInstance | null): MenuItem[];
// places/apply.ts
/** The widget's new data for `picks`, or null when unchanged. Points become their region when the dashboard has a live link. */
export function pickedData(
	data: WidgetDataConfig,
	picks: Picks,
	opts: { liveLink: boolean; regionOf: (point: PointPlace) => Promise<{ type: string; code: string } | null> }
): Promise<{ data: WidgetDataConfig; savedAsRegion: { type: string; code: string } | null } | null>;
```

- [ ] **Step 1: Write failing tests.** `apply.test.ts`: picks equal to the layer's current
      places → `null`; one region → `place`; three monitors → `selection`; a point with
      `liveLink: false` stays a point; with `liveLink: true` becomes `{ kind: "region", type:
      "zipcode", code: "93721" }` and `savedAsRegion` is set; `regionOf` returning `null` keeps
      nothing (the call rejects with a typed error the dialog shows). `widget.test.ts`:
      `placeItems` offers "Change place" for Chart and Data table on an editable dashboard,
      nothing on read-only or for Placeholder. Dialog browser test: opening from the menu loads
      the dialog lazily, Done applies one `setWidgetData` (Undo restores), Cancel/Escape applies
      nothing and returns focus to the menu's trigger; the idle state's "Choose a place" and the
      gone card's "Choose another" open it; on a live-shared dashboard "Use my location" stores
      the region and announces "This dashboard is shared by link, so your location is saved as
      ZIP 93721."; closing the dialog while a search or lookup is in flight leaves no toast or
      announcement afterward; Recent shows current names (a renamed region shows its new name)
      and leaves out a recent place that no longer resolves; the live-link check reads `app.sync?.states[docId]?.shareToken` when Done
      runs; the pick is added to Recent (not a point); the dialog fills the screen at 390 px.
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** The dialog builds the directory and resolvers from the data layer
      (dynamic import), passes the widget's pollutant layer as `purpose`, `mode` from
      `accepts.maxPlaces` (`> 1` → multiple), and `fromLayer(layer)` as `initial`. `regionOf`
      is `placeRegion` for the widget's layer with the point. Before showing the picker it
      resolves `readRecent` refs to `PlaceOption`s (regions through `RegionResolver`, monitors
      through the directory, locations through `LocationResolver`), dropping any that don't
      resolve; so `PlacePicker`'s `recent` prop is `PlaceOption[]`, not `RecentRef[]`. "Choose
      a place" on idle shows only when editable.
- [ ] **Step 4:** Run tests, then `npm run build && npm run check:budget`. Expected: PASS; the
      initial bundle grows by no more than ~1 KB gzip (menu item, idle button, lazy entry).
- [ ] **Step 5:** Commit `feat(widgets): Change place, Choose a place, and Choose another open the picker`.

### Task 13: Location privacy when sharing

**Files:**

- Create: `src/lib/sharing/points.ts`, `src/lib/sharing/points.test.ts`
- Modify: `src/lib/sharing/actions.ts` (`shareDashboard`, `exportDashboard`),
  `src/lib/sharing/copy.ts` (`saveCopy`), `src/lib/components/dialogs/ShareDialog.svelte`,
  `src/lib/components/dialogs/lazy.svelte.ts` (`ShareOptions`), `src/routes/SharedPage.svelte`
  (sets `PLACE_VIEWER_KEY` to `"shared"`), `messages/en.json`
- Test: `src/lib/components/dialogs/share-dialog.browser.test.ts`, `src/lib/sharing/copy.test.ts`

**Interfaces:**

- Consumes: `placeRegion` (Task 7), `PLACE_VIEWER_KEY` (Task 8).
- Produces:

```ts
export type PointSwap = { widgetId: string; layerIndex: number; region: { type: string; code: string } | null };
export function hasPoints(doc: Dashboard): boolean;
/** Each point layer's region (via `placeRegion`); rejects when a lookup fails. */
export function pointSwaps(doc: Dashboard, signal?: AbortSignal): Promise<PointSwap[]>;
/** A copy of `doc` with each point replaced by its region, or the place cleared when `region` is null. */
export function withSwaps(doc: Dashboard, swaps: PointSwap[]): Dashboard;
// ShareOptions gains:
points: null | { region: string /* display name, e.g. "ZIP 93721" */; exactUrl: string | null; onDownloadExact(): void; useRegion(): void /* live: one undoable edit */ };
```

- [ ] **Step 1: Write failing tests.** `points.test.ts`: a doc without points → `hasPoints`
      false and no lookups; a point layer → swapped to its region; a point with no region →
      `place` removed; schools untouched; a failed lookup rejects. `copy.test.ts`: `saveCopy`
      of an incoming doc with a point stores the region (always; no option). Share dialog
      browser test: with points, the copy link and file are the swapped versions and the notice
      reads "Your location is shared as ZIP 93721, not your exact position."; checking "Share my
      exact location instead" shows the warning "Anyone with the link or file will see your
      exact location." and switches link and file to the exact ones (per opening; unchecked
      next time); before "Create link" (live), with points, the dialog asks with "Use ZIP 93721
      instead" (applies one `replaceDocument` change; Undo restores the points) and "Share my
      exact location" (warning, then creates the link); a failed lookup shows "Can't look up
      your area right now." with Retry and offers no link or file until it succeeds. Shared page:
      a point widget's title reads "(shared location)".
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** `shareDashboard` computes swaps once and builds both URLs/files.
      The menu's Export (`exportDashboard`) always exports the swapped document and toasts the
      same notice (the exact option lives in the Share dialog, my call). The full backup
      (`backupJson`) keeps exact points: it's the owner's own restore file (my call; recorded in
      `ARCHITECTURE.md`).
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sharing): share and export exact locations as their region by default`.

### Task 14: End to end, stack check, docs

**Files:**

- Create: `e2e/place-picker.spec.ts`; fixtures under `e2e/fixtures/api/2.0/regions/…`
  (`meta.json`, `places/search` for "fre"/"roo", `locations/search`, `regions/?within=`,
  `places/lookup` POST, `locations/?source=&external_id=`)
- Modify: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md` (step 4 only), `ROADMAP.md` (step 4 only)

- [ ] **Step 1: Write the E2E tests** (Chromium): Change place on a Chart to two counties, Undo;
      Data table "Choose a place" from idle → a school → title "PM2.5 for ZIP 93702 (Roosevelt
      High School)"; "Choose another" from a gone monitor; Use my location granted
      (`context.grantPermissions(["geolocation"])`, `setGeolocation`) and denied; Share dialog
      swap and live-link prompt; a copy from a share link has the region; axe on the open
      picker. Run `npm run test:e2e`. Expected: PASS. Then `npm run test:e2e:podman` (all
      engines). Expected: PASS.
- [ ] **Step 2: Stack check** against the local `develop` stack (`npm run dev`): search "fre",
      "roo"; browse ZIP Codes in Tulare County; a school's chart; my location with a scripted
      position (Playwright context as a device). Note local data gaps before calling anything a
      bug. No writes to the stack.
- [ ] **Step 3: Docs.** `ARCHITECTURE.md` per the spec's "Docs changed with this spec" (plus
      the Export-always-swaps and backup-keeps-exact calls); `DEFERRED.md`: the spec's six
      deferrals, the beta.3 follow-ups (plural headings, `county` second line,
      `getMonitorsList` region option, the monitors/meta fixture), and Done entries from Task 9;
      `TODO.md`/`ROADMAP.md`: spec 2 built.
- [ ] **Step 4:** `npm run lint && npm run check && npm run test && npm run build &&
      npm run check:build && npm run check:budget`. Expected: PASS (budget within noise of
      195.9 KB).
- [ ] **Step 5:** Commit, push, open the PR into `step-4`; tell the coordinator; check
      `gh pr checks`. **Merge only with the user's yes.** After the merge, rewrite
      `prompt-map-widget.txt` (spec "After the merge") and tell the coordinator.
