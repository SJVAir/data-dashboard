# Step 5 spec 5b: pesticide use on the Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map tile can shade pesticide use (CDPR PUR) by township when zoomed out and by
square-mile section when zoomed in. It has its own fixed period, the server's valley-wide classes,
the hover lens with its "Show square miles" path, and section and township cards. The filters are
shared with spray notices.

**Architecture:**
- **One place-less layer.** `{ dataset: "pesticide-use", filters? }`, with three Map options:
  `useFigure`, `usePeriod` and `useShown`.
- **A `UseBlock` beside `MapData`'s other blocks.** It loads the valley's townships once per
  period and filters (outlines once, then values only), and the sections for the padded view and
  for the lens's block.
- **Scales.** Each response's `classes.<figure>` becomes a map-sdk `Scale`, served through the
  host metadata provider under a stable `ScaleRef` per (figure, level, period, filters), so the
  sections and the lens share one legend section.
- **Plugins.** Three map-sdk plugins draw it, `[townships, lens, sections]`, below the fill, with
  `zoomRange`s meeting at a section zoom computed from the tile's size.
- **First, a refactor.** `MapWidget.svelte` is split into per-layer components and one shared note
  banner, so use doesn't grow a 1,040-line file.

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/map-sdk` (exact pin), `@sjvair/sdk` 5.0.0
beta (exact pin), Paraglide, Vitest (unit and browser), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-11-16-step-5-spec-5-pesticides-and-notices-design.md`,
Part 2 (pesticide use) and Part 3 (filters) as use needs them. Read "Calls made after the builder
check" too. Part 0 and Part 1 are done (5a, #59). The decisions below, made while planning, go
into the spec's post-approval calls in Task 12.

## Decisions made while planning (the user, 2026-11-17)

- **The section card's links match the explorer popup's.** They are Section details, Records
  here, Notices here, and a link on each top chemical's name. Every one opens in a new tab with
  `ExternalLinkCue` and `rel="noopener noreferrer"`. The card has no "Zoom in" (the township card
  keeps its own). **The URLs come from `pesticides/meta/` `links`** (`@sjvair/sdk`
  `5.0.0-beta.14`) and are never hardcoded. A missing link is left out.
- **The section card's months and top chemicals follow the Map's filters.** This needs
  `sections/<id>/` to take the value filters and the month (sjvair.com, typed in
  `@sjvair/sdk` `5.0.0-beta.14`). The card's own figures come from the filtered map feature.
- **Zero use is an outline with no fill**, and the legend reads "No data". `meta.ramp.no_data`
  isn't used. The server rewords `notes.shades_valley`, which says "Gray means…" today.
- **"Located in".** The section card has a line "In township ‹id› · ‹figure›" whose township name
  is a button that swaps the card for the township's, in place. This is the mouse path to the
  township card, which the hover lens otherwise covers. It needs map-sdk's public pin
  (`@sjvair/map-sdk` `0.1.0-beta.20`).
- **Which cards name the filters:** the section card, the township card and the use legend.
- **"Notices here" stays a link.** The section card doesn't list the section's notices, unlike
  the explorer's popup.
- **5a leftovers fixed here:** the `MapWidget` split with one note banner, filters kept across
  off and on, the filter-change refetch test, and the notice card's flicker and focus items.

## Global Constraints

- **Branch and PR.** Work on `step-5-spec-5b` (worktree `.worktrees/step-5-spec-5b`), from
  `origin/step-5`, and open one PR into `step-5`. Merge `origin/step-5` before pushing. Pushes
  need no yes; merges do. The main checkout stays on `step-5`.
- **Pins are exact:** `@sjvair/map-sdk` `0.1.0-beta.19` and
  `npm:@jsr/sjvair__sdk@5.0.0-beta.13`. Move to `@sjvair/sdk` `5.0.0-beta.14` and
  `@sjvair/map-sdk` `0.1.0-beta.20` only when the coordinator (`data-dashboard-50`) says they are
  out (the gated tasks).
- **Bundle.** Map code stays in the lazy map chunk. Report the initial bundle against the 250 KB
  soft budget (213.1 KB before this spec) with `npm run build && npm run check:budget`.
- **Runes.** Svelte 5 runes only. In a class, effects go in `$effect.root`, cleaned up in
  `destroy()`. Key deriveds on primitives.
- **Text and dates.** Every UI string goes through Paraglide (`messages/en.json`), with no
  concatenated sentences. Dates, months and numbers go through `$lib/format` (Pacific).
- **Metadata is the source of truth:**
  - Figure labels, units and precision come from the catalog's `pesticide-use` entry types.
  - Years, badges, the explainer notes (`pur_lag`, `shades_valley`) and the links come from
    `pesticides/meta/`.
  - Class colours come from `classes.<figure>.colors`, one per break and in break order. Never
    sample `meta.ramp.colors`.
  - The one hand-written table is the wire-field map from entry type to the response's property
    (`USE_FIELDS`, below), as the adapter's `FIELDS` already is.
- **The server's classes:**
  - `breaks[i]` is class i's **inclusive** upper bound. There are at most 8, possibly fewer.
  - An empty result is `{ breaks: [], min: null, colors: [] }`.
  - **Zero is no data.**
- **Never send `county=`** on `sections/` or `townships/`, nor `lat`/`lng`/`radius`/`region`:
  only `bbox` (the view, or the lens block) or nothing. Coordinates never go in URLs the dashboard
  owns, logs or error reports.
- **A year the server doesn't list falls back silently to its latest** (checked locally:
  `year=1999` answers `year: 2023`). So the dashboard checks `usePeriod` against meta `years`
  before asking, and never asks for an unlisted year.
- **Hover content isn't interactive.** A card shown on hover is a static form with nothing
  focusable. It is interactive only when pinned or focused
  (`current.focusedKey === refKey || current.pinned?.hit.refKey === refKey`), as `notice-tooltip.ts`
  does.
- **Card snippets stay put.** Cache one snippet per feature and form while it is mounted, and read
  the latest props by refKey, as `noticeTooltips` does. A refetch never remounts a card.
- **A legend needs a scale.** A `null` scale draws neutral and no legend section, so
  `legendUnits` and `legendNote` vanish with it. Use always passes a `ScaleRef`.
- **Fallbacks are drawn, not saved.** An unknown `useFigure` draws the catalog's first figure, and
  an unlisted `usePeriod` draws "No data for ‹period›". Neither writes to the document.
- **Feature refKeys are prefixed so plugins never collide** (notices already use
  `feature:<section id>`):
  - townships: `encodeRef({ kind: "feature", id: "township:<PLSS id>" })`
  - sections: `encodeRef({ kind: "feature", id: "section:<section id>" })`
- **Checks and git.**
  - Run `npm run lint`, `npm run check` and the relevant tests before every commit.
  - Run git commands one at a time.
  - On GPG "No passphrase given", stop and ask the user to unlock. Never commit unsigned.
  - No AI attribution in commits, PRs or docs.
  - Every review minor goes into `DEFERRED.md` before the PR opens.
- **Local stack:**
  - Never start, restart or rebuild shared containers.
  - Keep heavy work out of :40–:50.
  - `&_cc=1` refreshes one cached `sections/` or `townships/` response; tell the coordinator when
    you use it.
  - Local use data runs to 2023.
- **Tests:** E2E pins noon Pacific. Run E2E under `TZ=America/New_York` too. Browser tests flake
  under load (arranging, chart-size, PlaceBar, a monitors refresh test): rerun one alone before
  calling it a bug.

## Dependencies (gates)

Tasks 1–9 need nothing new. These wait for the coordinator:

- **Gate A**, `@sjvair/sdk` `5.0.0-beta.14`: `pesticides/meta/` `links` templates for the section
  page, its records and notices, and a chemical's page, plus `sections/<id>/` taking the value
  filters and the month. Gate A covers Task 10. (The user, 2026-11-17: the card keeps its
  "Notices here" link and doesn't list notices, unlike the explorer's popup.)
- **Gate B**, `@sjvair/map-sdk` `0.1.0-beta.20`: a public pin of another plugin's feature, with no
  pan and the lens kept held. Gate B covers Task 11.

Never work around a gate: no raw `fetch`, no hardcoded URL and no client-side substitute.

## Review Focus

1. **The period or filters change while the lens is pinned.** The townships' new key loads with
   `features: null`, so map-sdk releases the pin; that's accepted. The old classes are never drawn
   under the new legend: the scale ref changes with the key (Task 5, `a new period gives a new
   scale ref and drops the old features`).
2. **Panning at section zoom keeps every colour.** Two bbox responses with equal classes give the
   same `ScaleRef` object and the same `Scale` (Task 4, `equal classes keep one ref`), and E2E
   checks the legend's classes after a pan (Task 9).
3. **A saved period the meta no longer lists:**
   - no request is made;
   - the layer reads "No data for 2017";
   - nothing is written (Task 5, `an unlisted period asks for nothing`).
4. **A tile so large that the view at zoom 11 tops the cap.** The section zoom rises with the tile
   (Task 3, `sectionZoom`). A padded 400 retries unpadded, then raises the zoom one step; the map is
   never blank (Task 5, `a refused bbox falls back to townships`).
5. **A read-only viewer changes the figure or period.** The change is held for the viewer and never
   written (Task 7, `viewer changes to the use rows are held`).

---

### Task 1: Split `MapWidget.svelte` and share the note banner (refactor)

**Files:**
- Create: `src/lib/widgets/map/MapNote.svelte`, the one banner: message, optional Retry or action
  button, a `data-*` hook.
- Create: `src/lib/widgets/map/layers/NoticesLayer.svelte`, `layers/HmsLayers.svelte` and
  `layers/FillLayer.svelte`. Each takes `map: MapContext` and its inputs as props, renders
  nothing, and adds and removes its plugins in `$effect`s, moved unchanged from `MapWidget.svelte`.
- Modify: `src/lib/widgets/map/MapWidget.svelte` (target under 700 lines).
- Test: `src/lib/widgets/map/map-widget.browser.test.ts` stays unchanged and green.

**Interfaces:**
- Produces:
  - `MapNote` props: `{ message: string; hook: string; action?: { label: string; onclick: () =>
    void } }`. It renders the existing markup, with `role="status"` and `data-{hook}` on its root.
  - Each layer component's props are exactly the values its moved effect reads today. For example,
    `NoticesLayer` takes `{ map, source, label, drawn, loads, clustered, onNow, byRef, note }`.
  - Plugin order and `before` rules are unchanged. `underMonitors` moves to `layers/order.ts`.

- [ ] **Step 1: Run** `npm run test:browser -- src/lib/widgets/map` and record that it's green.
- [ ] **Step 2: Move the code.** The five banners (refresh, HMS, fill, notices failed, notices gone)
  become `MapNote`s. Keep every `data-map-*` hook name, which the tests use.
- [ ] **Step 3: Run the same tests, and E2E** `npm run test:e2e -- e2e/map.spec.ts`. Expected:
  PASS with no test edits.
- [ ] **Step 4: Commit** `refactor(map): one note banner, and a component per map layer`.

### Task 2: The use options, the constants and the period

**Files:**
- Modify: `src/lib/widgets/map/options.ts` and `src/lib/widgets/map/toolbar/values.ts`
- Create: `src/lib/widgets/map/use-period.ts`
- Test: `options.test.ts`, `toolbar/values.test.ts`, `use-period.test.ts`

**Interfaces:**
- Produces, in `options.ts`:
  - `export const PESTICIDE_USE = "pesticide-use"`.
  - `MapOptionsSchema` gains three options:
    - `useFigure: SafeIdSchema.optional()`;
    - `usePeriod: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/).optional()`;
    - `useShown: z.literal(false).optional()`.
  - `MAP_TOOLBAR_KEYS` gains `"useFigure"` and `"useShown"`, but **not** `"usePeriod"`: Reset
    never changes the data.
  - `useFigureOf(options: MapOptions, catalog: CatalogEntry[] | undefined): string | undefined`
    returns the saved figure when the catalog's `pesticide-use` lists it and `USE_FIELDS` maps it,
    else the catalog's first mapped one. It never writes.
- Produces, in `use-period.ts`:
  - `type UsePeriod = { year: number; month: number | null }`.
  - `parsePeriod(value: string | undefined): UsePeriod | null`.
  - `periodKey(p: UsePeriod): string`, which is `"2023"` or `"2023-07"`.
  - `periodListed(p: UsePeriod, years: readonly number[]): boolean`.
  - `periodLabel(p: UsePeriod): string` through `$lib/format`'s `formatYear` and `formatMonth`
    ("2023", "July 2023"). Not `formatPeriod`, which `$lib/format` already exports.
- Produces, in `values.ts`:
  - `USE_KEY = "use"` (the Layers row), `USE_FIGURE_KEY = "useFigure"`, `USE_YEAR_KEY = "useYear"`
    and `USE_MONTH_KEY = "useMonth"`. The month's value is `"all"` or `"1"`–`"12"`.
  - `MapOffer` gains `use: { figures: string[]; years: number[] } | null`.
  - `toValues` fills the four keys from the options: the drawn figure, the year and month from
    `usePeriod`, and `useShown !== false`.
  - `toOptions` maps the keys back. The figure is removed when it equals the first. `useYear` and
    `useMonth` write `usePeriod`: choosing a year keeps the month, and `"all"` drops it.
  - `groupsShown(...)` gains `use: offer.use !== null`, and `layers` also counts `offer.use`.

- [ ] **Step 1: Write the failing tests:**
  - `usePeriod accepts YYYY and YYYY-MM only` (rejects `"2023-13"` and `"23"`).
  - `useShown accepts only false`.
  - `useFigureOf falls back to the catalog's first and never writes` (an unknown saved figure gives
    `"pounds-applied"`, and the options object is unchanged).
  - `parsePeriod and periodKey round-trip`, and `periodListed` is false for a year not in `years`.
  - `the use rows map to usePeriod and back`: year 2022 with month `"7"` gives `"2022-07"`; then
    month `"all"` gives `"2022"`.
  - `Reset removes useFigure and useShown but keeps usePeriod` (`withoutToolbar`).
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/options.test.ts
  src/lib/widgets/map/toolbar/values.test.ts src/lib/widgets/map/use-period.test.ts`. Expected:
  FAIL.
- [ ] **Step 3: Implement as listed.** `USE_FIELDS` goes in `src/lib/widgets/map/data/use-fields.ts`
  and is imported by `useFigureOf`:

  ```ts
  /** The catalog's pesticide-use entry types to the map responses' properties (and classes). */
  export const USE_FIELDS = {
  	"pounds-applied": "lbs_chemical",
  	"acres-treated": "acres_treated",
  	applications: "applications"
  } as const;
  ```
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the pesticide use options and period`.

### Task 3: Townships, blocks and the section zoom (pure functions)

**Files:**
- Create: `src/lib/widgets/map/data/use-geometry.ts`
- Test: `src/lib/widgets/map/data/use-geometry.test.ts`

**Interfaces:**
- Produces:
  - `SECTION_ZOOM = 11`, `MAX_VIEW_SECTIONS = 2000` and `BBOX_PAD = 0.5` (the explorer's values,
    `assets/js/pesticides/section-map.js:39-41,88`).
  - `sectionZoom(widthPx: number, heightPx: number, latDeg: number): number` is the explorer's
    `sectionZoom()`: the first integer zoom from `SECTION_ZOOM` to 18 whose view is at most
    `MAX_VIEW_SECTIONS` square miles.
  - `townshipOfSection(mtrs: string): string`, which drops the last `-NN` (`MDM-T12S-R19E-35` gives
    `MDM-T12S-R19E`).
  - `townshipBlock(id: string, townships: ReadonlyMap<string, [number, number, number, number]>):
    string[]` takes each township's bounds and returns the 3 × 3 neighbourhood, measured from the
    centres as the explorer's `neighborhoodOf(id, 1.5)` does
    (`assets/js/pesticides/section-map.js:3106`). The reach is floored at a full township
    (`{ lat: 0.087, lng: 0.108 }` degrees). It includes `id`, and returns `[]` for an unknown id.
  - `padBounds(b: Bounds, ratio: number): Bounds`, `contains(outer: Bounds, inner: Bounds):
    boolean` and `unionBounds(list: Bounds[]): Bounds`.
- [ ] **Step 1: Write the failing tests:**
  - `sectionZoom is 11 for a small tile and rises for a big one`: 400×300 px at 36.7° gives 11, and
    2560×1440 gives 12 or more.
  - `townshipOfSection strips the section number`.
  - `townshipBlock gives the 3 × 3 block, fewer at an edge, and survives a survey offset`: 9
    synthetic townships on a grid, one shifted 0.01° on each axis, give 9; a corner gives 4.
  - `padBounds by half a view, and contains`.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/data/use-geometry.test.ts`. Expected:
  FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the township block and the section zoom`.

### Task 4: The use scale and its stable refs

**Files:**
- Create: `src/lib/widgets/map/data/use-scale.ts`
- Modify: `src/lib/widgets/map/host/metadata.ts`, so `scale` and `entryType` resolve use refs
- Test: `src/lib/widgets/map/data/use-scale.test.ts` and `host/metadata.test.ts`

**Interfaces:**
- Produces:
  - `type UseLevel = "township" | "section"`.
  - `useScaleRef(figure: string, level: UseLevel, queryKey: string): ScaleRef` returns the same
    object for the same arguments, from a module-level `Map`. Its `dataset` is `PESTICIDE_USE`, and
    its `entryType` is `` `${figure}|${level}|${queryKey}` ``. The sections and the lens share one
    ref, so they share one legend section. Townships get another.
  - `registerUseScale(ref: ScaleRef, classes: PesticideUseClass, info: { label: string; units:
    string; precision: number }): void` builds and stores the `Scale`. When the classes equal the
    stored ones, it keeps the stored object.
  - `useScaleFor(ref: ScaleRef): Scale | undefined`.
  - `buildUseScale(classes, info): Scale` makes a `kind: "range"` scale with one level per break:
    - `key` is `` `c${i + 1}` ``, `color` is `classes.colors[i]` and `tier` is `i + 1`;
    - `min` is `i === 0 ? Number.MIN_VALUE : nextUp(breaks[i - 1])`, so 0 is no level and draws as
      the outline;
    - `max` is `nextUp(breaks[i])` (the inclusive bound, as map-sdk's `[min, max)`), and the last
      level's `max` is `null`;
    - `label` is `m.map_use_class_range({ low, high })`, with both ends through `formatValue` at
      the catalog's precision; the first reads `m.map_use_class_upto({ high })`.

    `nextUp(x)` is the next float64 above `x`:

    ```ts
    function nextUp(x: number): number {
    	if (x === 0) return Number.MIN_VALUE;
    	const f = new Float64Array([x]);
    	const i = new BigInt64Array(f.buffer);
    	i[0] += x > 0 ? 1n : -1n;
    	return f[0];
    }
    ```
  - In `host/metadata.ts`:
    - `scale(ref)` returns `useScaleFor(ref)` for a `PESTICIDE_USE` ref before asking the server;
    - `entryType(ref)` looks the catalog up by the part of `ref.entryType` before the first `|`.
- [ ] **Step 1: Write the failing tests:**
  - `one level per break, colours in order, zero is no level` (`levelFor(scale, 0)` is `NO_LEVEL`).
  - `a value equal to a break is in that break's class` (an inclusive bound).
  - `fewer than 8 breaks give fewer levels`, and `empty classes give no levels`.
  - `equal classes keep one ref and one scale` (same objects), while `other classes make a new
    scale`.
  - `the host provider resolves a use ref, and its entry type by the figure`.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/data/use-scale.test.ts
  src/lib/widgets/map/host`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the message keys `map_use_class_range` and `map_use_class_upto`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): pesticide use scales from the server's classes`.

### Task 5: `UseBlock`, loading townships, sections and the lens block

**Files:**
- Create: `src/lib/widgets/map/data/use.ts` (the requests and the features) and
  `src/lib/widgets/map/data/use-block.svelte.ts` (the block)
- Modify: `src/lib/data/adapters/pesticides.ts`, exporting
  `toUseParams(filters: PesticideFilters): PesticideUseFilters` (every filter maps; never `county`)
- Modify: `src/lib/widgets/map/data/loaded.svelte.ts`, which gains the use members
- Test: `src/lib/widgets/map/data/use.test.ts`, `use-block.svelte.browser.test.ts` and
  `loaded.svelte.browser.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `getPesticideTownships` and `getPesticideSections` (`@sjvair/sdk`);
  `pesticideMeta`, `filterLabels`, `codesKnown` and `FilterGone`.
- Produces, in `use.ts`:
  - `type UseQuery = { figure: string; period: UsePeriod; filters: PesticideFilters }` and
    `useQueryKey(q): string`. The key is the period plus the order-independent filters key (move
    `filtersKey` from `notices.ts` to `src/lib/widgets/map/data/filters-key.ts` and share it). The
    figure isn't in the key: one response carries all three figures.
  - `townshipsFor(q, signal): Promise<UseLoaded>`:
    - one in-flight request per key, shared between callers, dropped on failure, and never
      aborted by one caller's abort (the `regionTypeShapes` pattern, `regions.ts:98`);
    - the first request ever asks with geometry, and later ones send `geometry: false`, joined to
      the remembered outlines by id;
    - `classes: true`.
  - `sectionsFor(q, bbox, signal): Promise<UseLoaded>` is the same, with `bbox` and `classes:
    true`. A 400 rejects with `TooLarge`.
  - `type UseLoaded = { classes: PesticideUseClasses; features: Feature<Geometry, UseProps>[] }`,
    where `UseProps = MapFeatureProperties & { level: UseLevel; id: string; county: string |
    null; township: string; sections?: number; lbs_chemical: number; acres_treated: number;
    applications: number }`. Feature `value` is the shown figure's property, and `name` is the
    MTRS code or township id.
  - `useFiltersGone(filters): Promise<boolean>`, as notices' `filtersGone` without the notice
    skip (every filter applies to use).
- Produces, `class UseBlock`, built with `(getInput: () => UseBlockInput)`, where
  `UseBlockInput = { on: boolean; query: UseQuery | null; bounds: Bounds | null; zoom: number;
  sectionZoom: number; lensCenter: string | null }`:
  - `townships: DataSource<UseProps>`, with `scale` set to `useScaleRef(figure, "township", key)`.
  - `sections: DataSource<UseProps>`, which loads only while `zoom >= sectionZoom` (debounced
    300 ms on `bounds`), padded by `BBOX_PAD`, and refetches only when the view leaves the loaded
    bounds. A padded `TooLarge` retries unpadded. A second `TooLarge` sets `refusedZoom` (+1), and
    the widget adds it to `sectionZoom`.
  - `lens: DataSource<UseProps>`. When `lensCenter` is set, it waits 50 ms, then loads the
    sections in the union of `townshipBlock(center)`'s bounds, cached per block and key. It keeps
    earlier blocks' features in the source, which map-sdk allows. Its scale is the sections' ref.
  - Also: `blockOf(refKey): string[]` and `parentOf(props): string | null`, both refKeys;
    `townshipsState: "loading" | "ready" | "error" | "no-data" | "filter-gone"`;
    `sectionsFailed: boolean`; `refusedZoom: number`; `retry(): void`; and `destroy(): void`.
  - A query whose period isn't in meta `years` asks for nothing and reads `"no-data"`.
  - Use never polls: the data changes at most once a year.
- `MapData` gains `use: boolean` (the tile has the layer), `useBlock: UseBlock`, `retryUse()` and
  `useUnavailable`. Its input gains `useQuery`, `bounds`, `zoom`, `sectionZoom` and `lensCenter`.

- [ ] **Step 1: Write the failing unit tests** in `use.test.ts`, with the SDK mocked:
  - `townships ask with geometry once, then values only, joined by id`.
  - `no request ever carries county, lat, lng, radius or region` (every mocked call's params,
    across townships, sections and the lens).
  - `the filters become the map params` (chemical to `chemical_id`, commodity to `commodity_id`,
    method to `aerial_ground`, categories to a repeated `category`).
  - `one request in flight per key, shared, and dropped on failure`.
  - `filter-gone` for a chemical the meta can't resolve.
- [ ] **Step 2: Write the failing browser tests** in `use-block.svelte.browser.test.ts`:
  - `an unlisted period asks for nothing` (meta years `[2023]`, period `"2017"`): no SDK call, the
    state is `"no-data"`, and the input options are unchanged.
  - `sections load only at section zoom, padded, and not again inside the loaded bounds`.
  - `a refused bbox falls back to townships`: 400 then 400 gives `refusedZoom === 1` with the
    townships still drawn.
  - `the lens loads its block after 50 ms, once per block`.
  - `a new period gives a new scale ref and drops the old features` (Review Focus 1).
- [ ] **Step 3: Write the failing integration test** in `loaded.svelte.browser.test.ts`,
  `changing the Map's filters refetches notices and use` (the 5a leftover).
- [ ] **Step 4: Run** `npx vitest run src/lib/widgets/map/data` and
  `npm run test:browser -- src/lib/widgets/map/data`. Expected: FAIL.
- [ ] **Step 5: Implement.** While building, check one real local `townships/` and `sections/`
  response against `UseProps`.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(map): load pesticide use by township, section and lens block`.

### Task 6: Get data — the Pesticide use section, conversions and kept filters

**Files:**
- Modify: `src/lib/get-data/map.ts`, `src/lib/get-data/MapSections.svelte` and
  `src/lib/get-data/GetDataView.svelte` (wiring at about line 737)
- Create: `src/lib/get-data/UsePeriodPicker.svelte` (a year select from meta `years`, then "Whole
  year" or a month)
- Modify: `messages/en.json`
- Test: `src/lib/get-data/map.test.ts`, `get-data-view.browser.test.ts` and
  `src/lib/sharing/points.test.ts`

**Interfaces:**
- Produces, in `get-data/map.ts`:
  - `hasUse(data)`, and `setUse(draft: Draft, on: boolean, years: readonly number[]): void`:
    - **On:** adds `{ dataset: PESTICIDE_USE }` after the notices (or after smoke and fire), with
      `mapPesticideFilters(data)` copied on, and writes `draft.options.usePeriod =
      String(years[0])` unless a listed one is there.
    - **Off:** removes the layer and `usePeriod`, `useFigure` and `useShown`.
  - `setNotices` copies `mapPesticideFilters` onto the new layer too (the 5a leftover, kept
    across off and on while the other pesticide layer exists).
  - `pesticideLayers` (already in the file) now matches only **place-less** `pesticide-use`
    layers, so a chart's place-bound layer never counts as the Map's.
  - `isMapShaped` takes, after the pollutants, place-less smoke and fire, then at most one notices
    layer and at most one place-less use layer, in that order (no entry type; optional filters).
  - `toMapDraft`, as in the spec's "Calls made after the builder check":
    - from a chart, the **first** `pesticide-use` layer becomes the Map's use: its filters become
      the Map's filter set, its entry type becomes `useFigure`, and `usePeriod` is the range's last
      full year in meta `years`, else the latest. The others are dropped with the `"overlays"`
      note;
    - a pesticides-only chart gets the first offered pollutant holding the chart's places;
    - a Map keeps its use, its filters and its three options.
  - `fromMapDraft`: when converting to a chart, the use becomes a chart pesticide layer at the
    Map's places, with `entryType` from `useFigureOf` and its filters, if `usePeriod` falls inside
    the chart's range. Otherwise it's dropped with a new `"use-period"` note naming the period. Any
    other type drops it with `"overlays"`.
  - The meta years reach these functions as a parameter (`years: readonly number[]`), loaded by
    `GetDataView` through `pesticideMeta()`.
- `MapSections` gains a `use` accordion item after the notices. It holds the switch (disabled, with
  `getdata_map_use_no_years`, when meta `years` is empty), `UsePeriodPicker`, and the shared
  `PesticideFilters` (one set for both layers). New props: `onuse(on)` and `onperiod(value:
  string)`. The section heading falls back to a Paraglide string when the catalog lacks the entry
  (the 5a leftover, for both sections).

- [ ] **Step 1: Write the failing unit tests** in `map.test.ts`:
  - `setUse adds one place-less use layer with the Map's filters and the latest year, and removes
    it with its options`.
  - `filters survive turning notices off and on while use is on`.
  - `isMapShaped accepts notices then use, and refuses a place-bound use layer`.
  - `a chart's first pesticide layer becomes the Map's use, the others dropped with a note`.
  - `a chart over 2021–2022 gives usePeriod 2022; one over the current year gives the latest listed
    year`.
  - `a Map's use shown as a chart becomes a pesticide layer at the Map's places when its period is
    in range, else drops with the use-period note`.
- [ ] **Step 2: Write the failing browser tests** in `get-data-view.browser.test.ts`:
  - `the Pesticide use section switches the layer on with the latest year, and the period picker
    writes usePeriod`.
  - `one filter set shows once for both pesticide layers`.
  - `the sections show a fallback heading without a catalog entry`.
- [ ] **Step 3: Write a failing test** in `points.test.ts`: `a place-less use layer passes the
  point swap unchanged`.
- [ ] **Step 4: Run** `npx vitest run src/lib/get-data src/lib/sharing` and
  `npm run test:browser -- src/lib/get-data`. Expected: FAIL.
- [ ] **Step 5: Implement**, with the message keys `getdata_map_use_switch`,
  `getdata_map_use_period`, `getdata_map_use_whole_year`, `getdata_map_use_no_years`,
  `getdata_map_section_fallback` and the conversion note `convert_dropped_use_period`.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(get-data): pesticide use on a Map, with its period and shared
  filters`.

### Task 7: Draw use — plugins, toolbar group, legend and notes

**Files:**
- Create: `src/lib/widgets/map/layers/UseLayers.svelte` (the three plugins) and
  `src/lib/widgets/map/UseLegendNote.svelte`
- Modify: `MapWidget.svelte`, `toolbar/toolbar.svelte.ts`, `toolbar/wiring.svelte.ts` and
  `toolbar/icons.svelte`
- Modify: `src/app.css` (`--map-icon-use`, light and dark) and `messages/en.json`
- Test: `map-widget.browser.test.ts`, `toolbar/toolbar.svelte.browser.test.ts` and
  `src/lib/theme/contrast.test.ts`

**Interfaces:**
- Consumes: `UseBlock` (Task 5), the keys and `MapOffer.use` (Task 2), and `useScaleRef` (Task 4).
- Produces:
  - **The plugins**, `UseLayers` in this order, all added `{ before: "fill" }` when a fill is on,
    else `{ before: "focus" }`:
    - `shapesPlugin({ id: "townships", mode: "choropleth", noFigure: "outline", zoomRange: { max:
      z }, legendUnits: m.map_use_units_township({ units }), legendNote })`;
    - `shapesLens({ id: "lens", parents: townships, source: lens, block, parentOf, layerLabel,
      noFigure: "outline", legendUnits: m.map_use_units_section({ units }) })`;
    - `shapesPlugin({ id: "sections", mode: "choropleth", noFigure: "outline", zoomRange: { min:
      z }, selectable: false, legendUnits: m.map_use_units_section({ units }) })`.

    Here `z = sectionZoom(width, height, lat) + refusedZoom`, rounded, and the plugins are made
    again only when `z`, the figure or the key changes. The layer label is
    `m.map_use_layer({ figure, period })` ("Pounds Applied, 2023").
  - **The lens center:** `UseLayers` passes `lens.center` back to `MapData`'s input. Its `pin`
    and `release` are used by the township card (Task 8).
  - **The legend note**, `UseLegendNote`, shows, in order:
    - "No data for ‹period›" for an unlisted period;
    - "Filtered by …" (`filterSummary`);
    - `notes.shades_valley` and `notes.pur_lag` (title and summary; the title links to `source_url`
      through `webHref`, with `ExternalLinkCue`).

    It keeps its last ready lines across a reload (no flicker).
  - **The toolbar:** a "Pesticide use" group with the `USE_FIGURE_KEY` select (choices from the
    catalog's labels and units) and the `USE_YEAR_KEY` and `USE_MONTH_KEY` selects. The Layers
    group gains a `USE_KEY` checkbox with the `use` icon. For a viewer, the wiring holds
    `usePeriod` like a toolbar key but leaves it out of Reset.
  - **Notes, as `MapNote`s:**
    - `use-failed` (`m.map_use_failed()`, with Retry calling `data.retryUse()`);
    - `use-gone` (`m.map_use_filter_gone()`, with Edit data for an editor);
    - `use-sections-failed` (sections or lens failed; Retry).
  - **Draw order:** use goes under the fill (the spec's call). Check it on screen with a fill and
    use together. If the fill makes use unreadable, swap the order and record why (Task 12).

- [ ] **Step 1: Write the failing browser tests** with the fake map harness:
  - `adds townships, lens and sections, in that order, under the fill`.
  - `the zoom ranges meet at the section zoom`: townships `max` equals sections `min`.
  - `the Layers row hides use without unloading it`: the plugins are removed and no new request is
    made.
  - `the figure select redraws with another scale and writes useFigure, but never the default`.
  - `the period selects write usePeriod`.
  - `viewer changes to the use rows are held` (read-only dashboard: no `apply`).
  - `an unlisted period says No data for 2017 in the legend`.
  - `the legend names the period, the units, the filters, and the server's two notes`.
  - `use failure note with one Retry`, with the monitors still drawn.
- [ ] **Step 2: Add `--map-icon-use`** to `contrast.test.ts` (3:1 against `--background`, the menu
  surface and the hovered `--accent`).
- [ ] **Step 3: Run** `npm run test:browser -- src/lib/widgets/map` and
  `npx vitest run src/lib/theme`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run the tests.** Expected: PASS. Then check by hand on `npm run dev` against the
  local stack:
  - zoom across the section zoom and look for a gap;
  - look at the lens flash on recentre (DEFERRED; note whether it shows);
  - look at the draw order with a fill.
- [ ] **Step 6: Commit** `feat(map): draw pesticide use with its toolbar group and legend`.

### Task 8: The township and section cards (without the gated parts)

**Files:**
- Create: `src/lib/widgets/map/TownshipCard.svelte`, `SectionCard.svelte`,
  `use-tooltip.ts` (snippets per refKey and form, as `notice-tooltip.ts`) and
  `data/section-detail.ts`
- Create: `src/lib/widgets/map/use-card.ts` (pure helpers)
- Modify: `layers/UseLayers.svelte` (the `tooltip` and `tooltipShowsName: true` for all three
  plugins) and `messages/en.json`
- Test: `use-card.test.ts`, `township-card.browser.test.ts` and `section-card.browser.test.ts`

**Interfaces:**
- Produces, in `use-card.ts`:
  - `peakMonth(months: { month: number; value: number }[]): number | null` returns the largest
    month, the first on a tie, and null when all are zero.
  - `classInWords(scale: Scale, value: number): { tier: number; count: number; label: string } |
    null` is null for zero.
- Produces, in `data/section-detail.ts`: `sectionDetail(id: string, year: number, signal):
  Promise<PesticideSectionDetail>`, cached per section and year, with one request in flight and
  dropped on failure. Task 10 adds the filters and month to its key.
- **The township card** (`{ props: UseProps; figure: string; period: UsePeriod; scale: Scale |
  null; filtersLine: string | null; interactive: boolean; onshow: () => void; onzoom: () => void }`)
  shows:
  - the township id as its heading;
  - "Filtered by …" when set;
  - the three figures, each with catalog label, units and precision, the shown one first with its
    class in words ("shade 3 of 8, 4,079–6,714 lbs");
  - the section count;
  - "Show square miles" (`lens.pin(refKey)`) and "Zoom in" (`easeTo` the township's centre at
    `minZoom: z`).

  The buttons render only when `interactive`.
- **The section card** (`{ props; figure; period; scale; filtersLine; interactive }`) shows:
  - the MTRS code and county;
  - "Filtered by …";
  - the three figures with the class in words;
  - from `sectionDetail` (interactive only, since the hover form fetches nothing):
    - the year's 12 months as small bars (CSS heights from `--map-use-bar`), with a visually
      hidden list of each month and its value as the text alternative;
    - "Peaks in ‹month›" (`formatMonthName`), left out when every month is zero;
    - up to 3 top chemicals by the shown figure, each with its badges in meta `badges` order, as
      text labels in outlined chips (never colour alone).
  - While the detail loads, a skeleton. On failure, a line with Retry.
- **Esc and the lens:** map-sdk owns them; the card adds no handlers.

- [ ] **Step 1: Write the failing unit tests:**
  - `peakMonth picks the largest, the first on a tie, null when all zero`.
  - `classInWords names the tier and range, null for zero`.
- [ ] **Step 2: Write the failing browser tests:**
  - `the township card shows its figures, class in words and section count`.
  - `Show square miles pins the lens on that township` (the lens's `pin` spy is called with its
    refKey).
  - `the hover form has nothing focusable` (both cards).
  - `the section card shows 12 bars with a text list, the peak month, and badges as text`.
  - `peaks in is left out when every month is zero`.
  - `a refetch keeps the open card mounted and focus inside it` (the snippet cache).
  - `the section detail is fetched once per section and year`.
- [ ] **Step 3: Run** `npx vitest run src/lib/widgets/map/use-card.test.ts` and
  `npm run test:browser -- src/lib/widgets/map/township-card src/lib/widgets/map/section-card`.
  Expected: FAIL.
- [ ] **Step 4: Implement.** Add the `--map-use-bar` token to `app.css` and to
  `contrast.test.ts` (3:1 on the card surface). Message keys: `map_use_card_figures`,
  `map_use_card_class`, `map_use_card_sections`, `map_use_card_show_sections`,
  `map_use_card_zoom_in`, `map_use_card_months`, `map_use_card_month_row`, `map_use_card_peak`,
  `map_use_card_top_chemicals`, `map_use_card_detail_failed`.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(map): the township and section cards`.

### Task 9: The notice card leftovers, and E2E for use

**Files:**
- Modify: `src/lib/widgets/map/NoticeCard.svelte` and `NoticesLegendNote.svelte`
- Modify: `e2e/map-data-server.ts` (add `routeMapUse(context, { townships, sections, details,
  meta })`), `e2e/map.spec.ts` and the `e2e/fixtures/` use fixtures (clearly fake geometry)
- Test: `notice-card.browser.test.ts` and `e2e/map.spec.ts`

- [ ] **Step 1: Write the failing browser tests:**
  - `a refetch that removes the focused list row moves focus to the card, not body`.
  - `the No spray notices line doesn't flicker across a poll`: the line stays through the
    `loading` state of a refetch.
- [ ] **Step 2: Implement:**
  - the notes keep their last ready value;
  - on a refetch, the card's `$effect.pre` handles a removed or collapsed list row as it handles
    an open detail;
  - `NoticeCard` uses `$state.raw` for the meta, and `amount()` moves to `{@const}` (both minors).
- [ ] **Step 3: Write the E2E tests.** In the fixtures, the catalog label differs from the legend
  title, so a title assertion can fail. With axe in light and dark:
  - `townships shade by the server's classes, and the legend names the period and units`.
  - `zooming in loads sections for the view, and the bins don't change after a pan`: the legend's
    class labels are equal before and after, and the second request's bbox differs.
  - `the lens opens on hover and its section's card opens on click`.
  - `the township card's Show square miles pins the lens from the keyboard, and Escape clears it`.
  - `sections and townships requests never carry county`.
- [ ] **Step 4: Run** `npm run test:browser -- src/lib/widgets/map/notice-card`,
  `npm run test:e2e -- e2e/map.spec.ts`, and the same under `TZ=America/New_York`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(map): notice card focus and flicker; test(e2e): pesticide use`.

### Task 10 (Gate A): The section card's filtered detail, links and notices

**Files:** `package.json` (re-pin `@sjvair/sdk` to `5.0.0-beta.14`), `data/section-detail.ts`,
`SectionCard.svelte`, `messages/en.json`, `DEFERRED.md`, and the tests from Task 8.

**Interfaces:** from the coordinator: the meta `links` keys and their fill rule, and the filter
params on `getPesticideSectionDetails`. Use the names beta.14 ships.

- [ ] **Step 1: Re-pin**, run `npm install`, and run `npm run check`. Fix any type changes beta.14
  brings.
- [ ] **Step 2: Write the failing tests:**
  - `the section detail is asked with the Map's filters and month, and keyed by them`.
  - `the card's links come from the meta templates, open in a new tab with the cue and rel`
    (extend `src/lib/a11y/new-tab-cue.test.ts` to the new card).
  - `a missing meta link is left out`.
  - `each top chemical's name links to its chemical page`.
  - `Notices here links to the explorer's notices for the section` (no notices list in the card).
- [ ] **Step 3: Implement.** Guard `meta.links` (the 5a leftover "unguarded `meta.links`") for both
  cards.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the section card's filtered detail and explorer links`.

### Task 11 (Gate B): "Located in" on the section card

**Files:** `package.json` (re-pin `@sjvair/map-sdk` to `0.1.0-beta.20`), `SectionCard.svelte`,
`layers/UseLayers.svelte`, `src/lib/widgets/map/host/messages.ts` (any new `mapsdk_*` keys) and
`messages/en.json`.

**Interfaces:** map-sdk's public pin, in the shape beta.20 ships (from the coordinator).

- [ ] **Step 1: Re-pin**, run `npm install` and `npm run check`, and read the new types in
  `node_modules/@sjvair/map-sdk/dist`.
- [ ] **Step 2: Write the failing browser tests:**
  - `the section card names its township and figure` ("In township ‹id› · ‹figure›").
  - `the township button opens the township card in place, the lens still held, the camera
    unmoved`.
  - `on hover the line is text, not a button`.
- [ ] **Step 3: Implement.** Pin `township:<id>` on the `townships` plugin. The township's figure
  comes from the loaded townships, by `parentOf`.
- [ ] **Step 4: Run the tests and E2E** (add `the section card's township link opens the township
  card` to `map.spec.ts`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the section card's located-in link`.

### Task 12: Docs, deferrals and the PR

**Files:** `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, and the spec's "Calls made after the
builder check".

- [ ] **Step 1: Update the spec's calls:**
  - every decision listed in "Decisions made while planning";
  - the section card's links, from meta (the user, 2026-11-17), replacing the hardcoded
    `/tools/pesticides/sections/<id>/`;
  - the draw order as checked on screen;
  - the section zoom with its refused-zoom fallback;
  - the refKey prefixes.
- [ ] **Step 2: Update `ARCHITECTURE.md`**, in the sections the spec's "`ARCHITECTURE.md` changes"
  names:
  - the Map widget: the use entry, the layer components, and draw order;
  - the toolbar: the Pesticide use group and its keys, with `usePeriod` not a Reset key;
  - days and fills: use has its own period;
  - widget data selection: one filter set across both pesticide layers;
  - metadata: years, classes, notes, badges and links.
- [ ] **Step 3: Update `DEFERRED.md`:**
  - **Resolve** the 5a leftovers done here: the split, the banner, the filters off and on, the
    refetch test, the flicker, the focus to body, the `$state.raw`, `{@const}`, the Get data
    fallback heading, the `filtersKey` share and the unguarded `meta.links`.
  - **Remove** "A note on when pesticide data is released", now shown as `pur_lag`.
  - **"map-sdk: the lens flashes…":** keep it, noting whether it showed in Task 7's check.
  - **Check that the triggers still read right** for "Year-over-year change on the map" and "A
    township detail endpoint".
  - **"Map plugins for the remaining server datasets":** pesticide use is done.
  - **Add** every review minor as "Step 5 spec 5b review leftovers".
  - Run `npx prettier --write ARCHITECTURE.md DEFERRED.md TODO.md` and the spec file.
- [ ] **Step 4: Update `TODO.md`'s step 5 row** for 5b.
- [ ] **Step 5: Run the full checks:** `npm run lint`, `npm run check`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm run check:build` and `npm run check:budget`. Record the
  bundle number.
- [ ] **Step 6: Commit** `docs: step 5 spec 5b (pesticide use)`.
- [ ] **Step 7: Run the final whole-branch review** and its single fix wave. Merge `origin/step-5`,
  push, open the PR into `step-5`, and run `gh pr checks`. Tell the coordinator the PR is open, so
  it holds its TODO pushes. Ask the user before merging.
- [ ] **Step 8: Raise the schools data set** ("Revisit after spec 5") with the user.
