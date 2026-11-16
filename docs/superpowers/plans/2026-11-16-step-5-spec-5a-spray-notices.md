# Step 5 spec 5a: spray notices on the Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map tile can show SprayDays spray notices that follow its day stepper, with a notice
card and the explainer wording, on top of a `MapData` split into per-data-set blocks.

**Architecture:** One generic `DayLayer<T>` block (a main query plus fetch-ahead queries,
keyed by the day or by today's Pacific date) replaces the copy-pasted smoke-and-fire and fill
logic in `MapData`. The new notices entry is a third `DayLayer`. Notices are a place-less
`pesticide-notices` layer chosen in Get data, drawn with map-sdk's `pointsPlugin` (one feature
per section, with a count), with a Layers row, a legend row and note, and a card in the points
tooltip snippet.

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/map-sdk` (exact pin), `@sjvair/sdk` 5.0.0
beta (exact pin), Paraglide, Vitest (unit and browser), Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-11-16-step-5-spec-5-pesticides-and-notices-design.md`.
This plan covers Part 0, Part 1 and the notices half of Part 3. 5b (use, the lens, the use
cards) gets its own plan.

## Global Constraints

- **Branch:** `step-5-spec-5` from `step-5`. One PR into `step-5` for 5a. Before pushing, merge
  `origin/step-5`. Pushes need no yes; merges do.
- **Pins:** exact versions only (`@sjvair/map-sdk` `0.1.0-beta.16` today;
  `npm:@jsr/sjvair__sdk@5.0.0-beta.11`). Move only to the betas the coordinator names.
- Map code stays in the lazy map chunk. Report the initial bundle against the 250 KB soft budget
  (213.0 KB before this spec) with `npm run build && npm run check:budget`.
- Svelte 5 runes only. In a class, effects go in `$effect.root` with cleanup in `destroy()`. Key
  deriveds on primitives.
- Every UI string goes through Paraglide (`messages/en.json`), with no concatenated sentences.
  Dates go through `$lib/format` (Pacific, Sunday weeks).
- **Metadata is the source of truth:** labels come from the catalog (`pesticide-notices`,
  `spray-notice`); explainer text, method labels and the SprayDays link come from
  `pesticides/meta/`. Nothing is hardcoded.
- Theme tokens only. WCAG 2.2 AA. Never colour alone.
- No coordinates in the dashboard's URLs, logs or error reports.
- Run `npm run lint`, `npm run check` and the relevant tests before every commit. Run git
  commands one at a time (the worktree's guard refuses compound ones). On a GPG "No passphrase
  given" error, stop and ask the user to unlock. Never commit unsigned.
- Commit messages and docs carry no AI attribution.
- Every review minor goes into `DEFERRED.md` before the PR opens.

## Dependencies (gate)

Tasks 1–4 need nothing new. **Tasks 5–8 start only when the coordinator (`data-dashboard-59`)
reports these, with their exact names and shapes:**

- sjvair.com: `date=` and the category and cancer-group filters on `notices/active/`; in
  `pesticides/meta/`, the explainer text (notice meaning, data lag) and the SprayDays link.
- sdk-js: the `@sjvair/sdk` `5.0.0` beta with a function for `notices/active/`, called
  `getActivePesticideNotices` in this plan. Use the name sdk-js picks.
- map-sdk: `@sjvair/map-sdk` `0.1.0-beta.17`, if it carries the legend note slot or a marker
  count label. If notices need nothing new from map-sdk, stay on `0.1.0-beta.16`.

If a piece is late, 5a waits for it. Never work around it with a raw `fetch`, hardcoded text or a
client-side substitute.

## Review Focus

1. **Filters changed while on a past day:** the notices are fetched again for the new filters,
   and the old filters' notices are never drawn under the new legend. The source key includes the
   filters (Task 5 test `notices key includes filters`).
2. **Pacific midnight on Now:** the notices refetch for the new date, with no stale "yesterday's
   active" set held (Task 1 test `remakes the now source when today turns over`).
3. **Several notices in one section, on different dates:** one marker with the count, and a list
   card sorted by scheduled date (Task 5 `groups by section` and Task 7 `list card order`).
4. **The server refuses the request** (a 400 over its 2,000-notice cap, or a network failure):
   a notices note with one Retry shows, and the rest of the map keeps working (Task 6
   `notices failure note`).
5. **A saved filter the server no longer has:** the notices layer reads "filter-gone" the way
   charts do, never a silent empty map (Task 5 `filter-gone`).

---

### Task 1: `DayLayer<T>`, the shared day-following block

**Files:**
- Create: `src/lib/widgets/map/data/switch.ts`
- Create: `src/lib/widgets/map/data/day-layer.svelte.ts`
- Test: `src/lib/widgets/map/data/day-layer.svelte.test.ts`

**Interfaces:**
- Produces:
  - `switchQueries<T>(now: NowClient, pairs: [NowQuery<T>, NowSource<T> | null][]): void`. This is
    `MapData.#switch` moved out unchanged (hold every wanted source while the queries swap).
  - `class DayLayer<T>`, constructed with `(now: NowClient, opts: DayLayerOptions<T>)` where:

    ```ts
    type DayLayerOptions<T> = {
    	/** The source for now or a day; null when nothing loads. May resolve async. */
    	sourceFor(at: SnapshotAt): NowSource<T> | null | Promise<NowSource<T> | null>;
    	/** Whether the shown query polls, given the day showing and its loaded value. */
    	polls(at: SnapshotAt, value: T | undefined): boolean;
    };
    ```

    Members: `state: NowState<T>` (derived from its main query), `failed: boolean`,
    `update(input: { on: boolean; at: SnapshotAt; ahead: readonly string[]; today: string }): void`
    (call from inside an owner's `$effect`), `setPolling(on: boolean): void`, `retry(): void`,
    `destroy(): void`. The ahead queries never poll. It keeps fetch-ahead at the same `AHEAD`
    (2) as today.

- [ ] **Step 1: Write the failing tests** with a real `createNowClient` and fake timers (the
  pattern in `src/lib/data/now/client.test.ts`). Each test builds a `DayLayer<number>` inside
  `$effect.root`:
  - `fetches the day and its neighbours ahead`: `update({ on: true, at: { day: "2026-11-10" },
    ahead: ["2026-11-09", "2026-11-11"], today: "2026-11-16" })` → `sourceFor` called with all
    three days, and three fetches.
  - `a step to a day fetched ahead draws at once, with no second fetch`: after the above, stepping
    to `2026-11-11` → `state.status === "ready"` with no new fetch for that key.
  - `retry fetches the failed day again`: the first fetch throws → `failed` true; `retry()` →
    fetch called again and `failed` false.
  - `polls only while polls() says so`: `polls` returns `at === "now"` → the main query polls
    on now (advance to the `"hour"` tick, a second fetch) and doesn't on a day.
  - `remakes the now source when today turns over`: `sourceFor("now")` keys by `today` → a new
    `today` gives a new fetch.
  - `off clears every query`: `update({ on: false, ... })` → `state.status === "idle"`, no
    fetches.
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/data/day-layer.svelte.test.ts`.
  Expected: FAIL (module missing).
- [ ] **Step 3: Implement `switchQueries` and `DayLayer<T>`.** Move the logic from
  `MapData.#switch`, `#resolveHms` and `#resolveFill`
  (`src/lib/widgets/map/data/loaded.svelte.ts:419-428`, `560-625`). An async `sourceFor` cancels
  on the next `update` (the `cancelled` flag `#resolveHms` uses).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `refactor(map): a shared day-following block for map data sets`.

### Task 2: Split `MapData` onto the blocks

**Files:**
- Create: `src/lib/widgets/map/data/monitors-block.svelte.ts`
- Modify: `src/lib/widgets/map/data/loaded.svelte.ts`
- Modify: `src/lib/widgets/map/data/hms.ts`, `src/lib/widgets/map/data/fill.ts` (add each one's
  `polls` rule beside its entry)
- Test: `src/lib/widgets/map/data/loaded.svelte.test.ts` (new), and the existing
  `src/lib/widgets/map/map-widget.browser.test.ts` unchanged

**Interfaces:**
- Consumes: `DayLayer<T>` and `switchQueries` (Task 1).
- Produces: `MapData`'s **public members unchanged** (the same names, types and behaviour), so
  `MapWidget.svelte` and its tests don't change. Internally:
  - `MonitorsBlock` holds the monitors list, the day's figures, scope resolving and their
    polling (today's `#resolveMonitors`, `#resolveDay`, and the first `#poll` effect's monitors
    half).
  - `hms` and `fill` are `DayLayer`s.
  - `MapData` keeps the input deriveds (`#day`, `#ahead`, `#today`, `#loads`) and one
    `$effect.root` that calls each block's `update`.
- Rules moved as they are:
  - HMS `polls`: `at === "now" || dayPolls`, where `dayPolls` is the monitors block's "the day's
    figures aren't all final" (spec 4's ruling).
  - Fill `polls`: `source.poll(value)`.

- [ ] **Step 1: Write failing tests** in `loaded.svelte.test.ts`, building a `MapData` with a
  real now client, fake timers and fake entries (`vi.mock` of `./hms` and `./fill` sources):
  - `smoke and fire on a day poll only while the day's figures aren't final`: the monitors'
    day snapshot `final: false` → the HMS main query polls; `final: true` → it stops.
  - `smoke and fire fetch the neighbouring days ahead`: on a day with `ahead` of two days →
    three HMS fetches.
  - `retryHms fetches smoke and fire again after a failure`.
- [ ] **Step 2: Run them.** Expected: FAIL (the tests reach into blocks not yet split, or the
  timing differs).
- [ ] **Step 3: Move the code** into `MonitorsBlock` and the two `DayLayer`s, keeping every public
  member of `MapData`. `loaded.svelte.ts` should end well under 300 lines.
- [ ] **Step 4: Run** `npx vitest run src/lib/widgets/map` and
  `npm run test:browser -- src/lib/widgets/map`. Expected: PASS, with the existing map tests
  untouched.
- [ ] **Step 5: Commit** `refactor(map): split MapData into per-data-set blocks`.

### Task 3: The notices option, the layer limit and the constants

**Files:**
- Modify: `src/lib/widgets/map/options.ts`
- Modify: `src/lib/widgets/map/toolbar/values.ts`
- Test: `src/lib/widgets/map/options.test.ts`, `src/lib/widgets/map/toolbar/values.test.ts`

**Interfaces:**
- Produces:
  - `export const PESTICIDE_NOTICES = "pesticide-notices"` in `options.ts`.
  - `MAP_POLLUTANTS_MAX = LIMITS.LAYERS_MAX - 4` (4: smoke, fire, notices and 5b's use take the
    rest).
  - `MapOptionsSchema` gains `noticesShown: z.literal(false).optional()`, and
    `MAP_TOOLBAR_KEYS` gains `"noticesShown"`.
  - The toolbar value key is `export const NOTICES_KEY = "notices"`, in `toolbar.svelte.ts`
    beside `FILL_KEY`. `toValues` sets `values.notices = options.noticesShown !== false`, and
    `toOptions` maps it back as `regions` is.
  - `MapOffer` gains `notices: boolean`, and `groupsShown(...).layers` becomes
    `offer.smokeAndFire || offer.fill || offer.notices`.

- [ ] **Step 1: Write failing tests:**
  - `noticesShown accepts only false`.
  - `MAP_POLLUTANTS_MAX is 4`.
  - `the notices row maps to noticesShown and back, and on is never written`: `toOptions` with
    `notices: true` removes `noticesShown`, and with `false` writes it.
  - `Layers shows for notices alone`.
  - `Reset removes noticesShown` (`withoutToolbar`).
- [ ] **Step 2: Run** `npx vitest run src/lib/widgets/map/options.test.ts
  src/lib/widgets/map/toolbar/values.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement as listed.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run `npx vitest run src/lib/get-data`,
  since `setMapPollutant` reads the cap.
- [ ] **Step 5: Commit** `feat(map): the spray notices option and a 4-pollutant cap`.

### Task 4: Get data — the Spray notices section and the shared filters

**Files:**
- Modify: `src/lib/get-data/map.ts`
- Modify: `src/lib/get-data/MapSections.svelte`, `src/lib/get-data/GetDataView.svelte` (wiring at
  `GetDataView.svelte:735`)
- Modify: `messages/en.json`
- Test: `src/lib/get-data/map.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`,
  `src/lib/sharing/points.test.ts`

**Interfaces:**
- Consumes: `PESTICIDE_NOTICES`, `MAP_POLLUTANTS_MAX` (Task 3); `PesticideFilters.svelte` (its
  props `filters`, `onchange`) and `PesticideFiltersSchema`.
- Produces, in `get-data/map.ts`:
  - `hasNotices(data: WidgetDataConfig): boolean`.
  - `setNotices(data: WidgetDataConfig, on: boolean): void` adds `{ dataset: PESTICIDE_NOTICES }`
    after smoke and fire, or removes it.
  - `mapPesticideFilters(data: WidgetDataConfig): PesticideFilters | undefined` returns the first
    pesticide layer's filters.
  - `setMapPesticideFilters(data: WidgetDataConfig, filters: PesticideFilters | undefined): void`
    writes the same filters to **every** pesticide layer (notices now; 5b's use joins). An empty
    object is removed.
  - `isMapShaped` accepts a trailing notices layer: place-less, no `entryType`, with optional
    `filters`.
  - `toMapDraft` carries a Map draft's notices layer and its filters.
  - Converting a Map with notices to any other type drops the layer with the existing
    `"overlays"` note.

- [ ] **Step 1: Write failing unit tests** in `map.test.ts`:
  - `setNotices adds one place-less notices layer after smoke and fire, and removes it`.
  - `setMapPesticideFilters keeps every pesticide layer in step`.
  - `isMapShaped accepts a notices layer`.
  - `toMapDraft keeps a Map's notices and filters`.
  - `a Map with notices shown as a chart drops them with the overlays note`.
- [ ] **Step 2: Write a failing browser test** in `get-data-view.browser.test.ts`:
  `the Spray notices section switches the layer on and shows its filters`. The section's title
  and description come from the catalog entry, and the filters appear only while notices are on.
- [ ] **Step 3: Write a failing test** in `points.test.ts`: `a place-less notices layer passes
  the point swap unchanged`.
- [ ] **Step 4: Run** `npx vitest run src/lib/get-data src/lib/sharing` and
  `npm run test:browser -- src/lib/get-data`. Expected: FAIL.
- [ ] **Step 5: Implement.** `MapSections` gains a `notices` accordion item after smoke and fire,
  holding a switch and, while on, `PesticideFilters` bound through `mapPesticideFilters` and
  `setMapPesticideFilters`, with new props `onnotices(on)` and `onfilters(filters)`. Add the
  message keys `getdata_map_notices_switch` and `getdata_map_notices_filters`.
- [ ] **Step 6: Run the tests.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(get-data): spray notices on a Map, with its pesticide filters`.

### Task 5: The notices entry (gated)

**Files:**
- Create: `src/lib/widgets/map/data/notices.ts`
- Modify: `src/lib/widgets/map/data/types.ts` (`id` union gains `"notices"`)
- Modify: `src/lib/widgets/map/data/loaded.svelte.ts` (a `notices` `DayLayer`)
- Modify: `src/lib/data/adapters/pesticides.ts` (export the filters-to-params mapping for notices)
- Test: `src/lib/widgets/map/data/notices.test.ts`, `loaded.svelte.test.ts`

**Interfaces:**
- Consumes: `getActivePesticideNotices` (the SDK; gate), `DayLayer` (Task 1),
  `PesticideFilters`, `pesticideMeta` and `FilterGone` (`$lib/data/pesticide-meta`).
- Produces:
  - `type NoticeItem = { id: string; scheduled: string; scheduledEnd: string; method: string;
    amount: number | null; units: string; county: string; section: string; products: { id:
    string; name: string }[]; chemicals: { id: string; name: string; ofConcern: boolean }[] }`.
    The fields come from the SDK type; the builder maps the names the SDK picks.
  - `type NoticeFeatureProperties = MapFeatureProperties & { count: number; notices:
    NoticeItem[] }`, one feature per section. Its `refKey` is
    `encodeRef({ kind: "feature", id: <section id> })`, and its `name` is
    `m.map_notices_name({ count, section })`. Notices are sorted by `scheduled`.
  - `noticesEntry: MapDataEntry<NoticeItem[], NoticeFeatureProperties>`:
    - `source({ data, at })` keys `map-notices:<Pacific date>|<stable filters key>`, with
      `cadence: "hour"`. The date is `at.day`, or `todayPacific()` on now. Pass `date` only on a
      day.
    - `toDataSources` returns `{ notices: DataSource }` with `scale: null`.
    - A saved filter id the server no longer has returns `{ unavailable: "filter-gone" }`, the
      way the chart adapter does.
  - `noticesPolls(at: SnapshotAt): boolean`, which is `at === "now"`. A past day never polls.
  - `MapData` gains `noticesSource`, `noticesState`, `noticesFailed`, `noticesUnavailable`,
    `retryNotices()`, and `notices` (whether the tile has the layer).

- [ ] **Step 1: Write failing tests** in `notices.test.ts`, with the SDK mocked:
  - `groups by section`: three notices in two sections → two features; the counts are 2 and 1;
    each feature's notices are sorted by date.
  - `notices key includes filters`: the same day with other filters → a different key.
  - `now asks without a date, a day asks with it`.
  - `filter-gone`: a chemical id the meta can't resolve → `{ unavailable: "filter-gone" }`.
  - `noticesPolls is true on now only`.
- [ ] **Step 2: Write a failing test** in `loaded.svelte.test.ts`: `notices follow the day and
  fetch the neighbours ahead`.
- [ ] **Step 3: Run** `npx vitest run src/lib/widgets/map/data`. Expected: FAIL.
- [ ] **Step 4: Implement.** Add the message keys `map_notices_name` (with plural forms for
  `count`) and `map_notices_failed`.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(map): load spray notices for the day showing`.

### Task 6: Draw notices — plugin, toolbar row, legend, note (gated)

**Files:**
- Modify: `src/lib/widgets/map/MapWidget.svelte`
- Modify: `src/lib/widgets/map/toolbar/toolbar.svelte.ts`, `src/lib/widgets/map/toolbar/wiring.svelte.ts`,
  `src/lib/widgets/map/toolbar/icons.svelte.ts`
- Modify: `src/app.css` (`--map-icon-notices`, `--map-notice-marker`: light and dark values)
- Modify: `src/lib/widgets/map/host/messages.ts` (any new `mapsdk_*` keys in the pinned beta)
- Modify: `messages/en.json`
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`,
  `src/lib/widgets/map/toolbar/toolbar.svelte.browser.test.ts`,
  `src/lib/theme/contrast.test.ts`

**Interfaces:**
- Consumes: `MapData.notices*` (Task 5), `NOTICES_KEY` and `MapOffer.notices` (Task 3).
- Produces:
  - A `pointsPlugin({ id: "notices", source: noticesSource, layerLabel, legendTitle, clustered:
    true, ... })`, added `{ before: "monitors" }` when the monitors are on the map. It sits above
    the fill (and 5b's use) and below the monitors and the focus area.
  - The layer label is the catalog's `pesticide-notices` label.
  - The toolbar row is a checkbox `NOTICES_KEY` in Layers, with the catalog label and the
    `notices` icon.
  - The `[data-map-notices-note]` banner reads `m.map_notices_failed()` with one Retry.
  - On a day stop that has loaded with zero notices, the legend note reads
    `m.map_notices_none_day()` plus the meta's explainer.

- [ ] **Step 1: Write failing browser tests** with the fake map harness:
  - `adds the notices plugin under the monitors when the tile has notices`.
  - `the Layers row hides notices without unloading them`: the plugin is removed and no new fetch
    happens.
  - `notices failure note`: a failing fetch shows the note, and Retry fetches again while the
    monitors stay drawn.
  - `a day with no notices says so, with the explainer`.
  - `the notices row appears only when the tile has notices`.
  - `the legend names the active filters`, through `filterSummary` (`$lib/data/pesticide-meta`),
    as charts' legends do.
- [ ] **Step 2: Add the new tokens** to `contrast.test.ts`, against `--background`, the menu
  surface and the hovered `--accent`, at 3:1 for icons and markers.
- [ ] **Step 3: Run** `npm run test:browser -- src/lib/widgets/map` and
  `npx vitest run src/lib/theme`. Expected: FAIL.
- [ ] **Step 4: Implement.** Use the legend note slot if `0.1.0-beta.17` adds one. Otherwise put
  the explainer in the widget's legend area beside map-sdk's Legend and record why in
  `DEFERRED.md`.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(map): draw spray notices with a Layers row and legend`.

### Task 7: The notice card (gated)

**Files:**
- Create: `src/lib/widgets/map/NoticeCard.svelte`
- Modify: `src/lib/widgets/map/MapWidget.svelte` (pass it to the notices plugin's feature tooltip
  snippet)
- Modify: `messages/en.json`
- Test: `src/lib/widgets/map/notice-card.browser.test.ts`

**Interfaces:**
- Consumes: `NoticeFeatureProperties` (Task 5); `pesticideMeta()` for the method labels, the
  explainer and the SprayDays link; `$lib/format` for dates and numbers.
- Produces `NoticeCard` with props `{ notices: NoticeItem[]; section: string; county: string }`:
  - **One notice:** the scheduled date and time; an "Active" tag when `scheduled <= now <=
    scheduledEnd`; "May begin through ‹scheduledEnd›"; "‹section› · ‹county› (the square mile,
    not the field)"; the treated amount and units with the method label; products, then
    chemicals, with "of concern" as text plus its marker; "None listed" for an empty list; the
    explainer; and "Sign up with SprayDays".
  - **Several notices:** a heading "‹count› notices of intent" and a list, one row per notice
    (date, amount, method), each a button that shows that notice's detail in the card.

- [ ] **Step 1: Write failing browser tests:**
  - `one notice shows its dates, amount, method, products and chemicals`. The method label comes
    from the faked meta, not the code.
  - `of concern is said in text, not colour alone`.
  - `an empty chemical list reads None listed`.
  - `list card order`: three notices, newest last, by `scheduled`.
  - `a list row opens that notice`.
  - `the SprayDays link comes from the meta and opens in a new tab with rel noopener`.
- [ ] **Step 2: Run** `npm run test:browser -- src/lib/widgets/map/notice-card`. Expected: FAIL.
- [ ] **Step 3: Implement**, with message keys `map_notice_active`, `map_notice_through`,
  `map_notice_where`, `map_notice_amount`, `map_notice_products`, `map_notice_chemicals`,
  `map_notice_of_concern`, `map_notice_none_listed`, `map_notice_list_heading`,
  `map_notice_spraydays`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(map): the spray notice card`.

### Task 8: E2E against the real Legend (gated)

**Files:**
- Modify: `e2e/map-data-server.ts` (add `routeMapNotices(context, byDate: Record<string,
  NoticeFixture[]>)`, where the `"now"` key is the undated request)
- Modify: `e2e/map.spec.ts`
- Create: `e2e/fixtures/notices-*.json` (if fixtures live in files there)

- [ ] **Step 1: Write the tests.** In the fixtures, the catalog's `pesticide-notices` label
  differs from the legend title, so a title assertion can fail.
  - `notices on Now: the marker count, the legend row and the explainer`, with axe in light and
    dark.
  - `notices follow a step to a past day`: the second day's fixture shows, and the request
    carries `date=`.
  - `the notice card opens from the feature list by keyboard`: Tab to the list, Enter on the
    section's row, the card's heading shows, and Escape closes it.
  - `the Layers row hides notices`.
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/map.spec.ts`. Expected: PASS. Rerun a
  timing-sensitive failure alone before calling it a bug.
- [ ] **Step 3: Commit** `test(e2e): spray notices on the Map`.

### Task 9: Docs, deferrals and the PR

**Files:**
- Modify: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`

- [ ] **Step 1: Update `ARCHITECTURE.md`:**
  - "The dashboard's Map widget": the `DayLayer` blocks, the notices entry, what a tile holds
    (up to 4 pollutants), and draw order.
  - "The Map tile's toolbar": the Spray notices row and `noticesShown`.
  - "The Map's days and region fills": notices follow the day; Now polls hourly (the server
    imports once a day at 14:00 UTC).
  - "Widget data selection": the Map's pesticide filters, shared across its pesticide layers.
- [ ] **Step 2: Update `DEFERRED.md`.** Resolve these from "Step 5 spec 4 review leftovers":
  - The `loaded.svelte.ts` split.
  - The HMS day prefetch, retry and refresh tests.
  - `figureOfRow`: not extracted. Pesticide use is read from `sections/` and `townships/`
    responses, not from summary rows, so no third copy exists. Revisit when a third
    summary-row snapshot appears.

  Then the spec's other changes:
  - "Schools and child care as a Map data set": the trigger becomes "after spec 5".
  - "`land_use` / `mtrs` region browsing": add spec 6 as a trigger.
  - "More than 6 pollutants on one Map" becomes "more than 4".
  - "Year-over-year change on the map": the explorer's compare, with the trigger "after spec 6,
    or when an agency or researcher asks".
  - Add the township detail endpoint.
  - Add the explorer's Tweaks under "Dropped", as the user's decision.
  - "Map plugins for the remaining server datasets": SprayDays notices are done.
  - Add every review minor as "Step 5 spec 5a review leftovers".
- [ ] **Step 3: Update `TODO.md`'s step 5 row** for 5a. Run `npx prettier --write TODO.md
  DEFERRED.md ARCHITECTURE.md`.
- [ ] **Step 4: Run the full checks:** `npm run lint`, `npm run check`, `npm run test`,
  `npm run test:e2e`, `npm run build`, `npm run check:build` and `npm run check:budget`. Record the
  bundle number.
- [ ] **Step 5: Commit** `docs: step 5 spec 5a (spray notices)`.
- [ ] **Step 6: Merge `origin/step-5` into the branch, push, open the PR into `step-5`**, then
  run `gh pr checks`. Tell the coordinator the PR is open (other sessions hold their `TODO.md`
  pushes while it's open). Ask the user before merging.
