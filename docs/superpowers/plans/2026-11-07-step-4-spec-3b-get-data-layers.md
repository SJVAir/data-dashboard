# Step 4 spec 3b: Get data layers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weather (CIMIS station summaries), Wildfire Smoke (per day) and Pesticide Use (monthly,
with filters) become Get data layers. Number layers draw in strips under the chart and can stand
alone, and the resolution control becomes "Show values" with a "?" toggletip.

**Architecture:**

- **Adapters:** three new dataset adapters plug into spec 3's query client. A layer gains two
  optional saved fields: a weather `station` and pesticide `filters`. Overlays carry these to
  their fetch and their cache key.
- **The main chart:** the main layer is the pollutant, else the first number layer. Number
  overlays are fetched at the main layer's resolution (as a pin, so a coarser-only layer falls
  back to month).
- **The chart:** the Chart draws each number overlay as its own uPlot strip under the main plot,
  sharing the time axis.

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/sdk` 5.0.0-beta.6, uPlot, bits-ui
(Popover, Combobox), Paraglide, zod, Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-06-step-4-spec-3b-get-data-layers-design.md` (approved
2026-11-06, SDK section final 2026-11-07). Read it, and spec 3's spec, before any task. This plan
argues from them.

## Global Constraints

- Branch `step-4-spec-3b` from `origin/step-4` (after `git fetch`). The PR goes into `step-4`.
  Never merge without the user's yes. No releases or publishing.
- No Claude or AI attribution in commits, PRs or docs (the user's global rule overrides any
  harness default).
- `@sjvair/sdk` pinned exactly: `"npm:@jsr/sjvair__sdk@5.0.0-beta.6"`. **Task 1 can't start until
  beta.6 is published.** Ask the coordinator (`data-dashboard-23`) first.
- **Metadata is the source of truth:**
  - from the catalog: chart kind (`display.chart`), units, precision, `y_min`, resolutions;
  - from `hms/meta`: smoke levels;
  - from `getPesticidesMeta()`: filter labels;
  - from `display_name`: saved-filter names.
  - Never hardcode any of these.
- **Text and dates:** all UI text via Paraglide, no concatenated sentences. Formatting via
  `$lib/format` in Pacific time; weeks start Sunday. Never store generated English. New English
  strings go to the user with the PR.
- **No wording that blames a data publisher** (no "published late").
- **Saved fields:** new saved fields are schema-validated with size limits. Drafts and documents
  are untrusted input.
- **Styling and storage:** theme tokens only (`src/lib/theme/token-discipline.test.ts`),
  shadcn-svelte and bits-ui primitives. Browser storage only through the platform adapter.
- **Accessibility:** WCAG 2.2 AA, recognized patterns, full keyboard use, never color alone,
  24 px targets.
- **Initial bundle:** none of this code reaches it. It's 199.4 KB gzip of the 200 KB soft budget:
  run `npm run build && npm run check:budget`. Barrel-imported lazy-only packages go in
  `vite.config.ts`'s `BARRELED` list. Modules imported by the initial bundle (`src/lib/sharing/`,
  `src/lib/places/apply.ts`) must not import `@sjvair/sdk` or adapters.
- **Privacy:** coordinates never in URLs, logs or error reports. Points and schools reach the
  server only as their region keys.
- **Code style:** tabs, double quotes, no trailing commas, width 100. Run `npm run format` before
  each commit.
- **Tests:**
  - Browser tests: `animationsSettled(el)` from `src/test/animations.ts`, and
    `page.viewport(1280, 800)` for desktop. A test waiting on a lazy route preloads its module
    (see `widget-state.browser.test.ts`).
  - Date code: also `npm run test:unit:tz`.
  - CI isn't on Pacific time: match formatted times with an optional " PT". Check
    `gh pr checks` after pushing.
- **Other repos:** don't work around the SDK or server. Gaps go to the coordinator. Message it
  before restarting, rebuilding or backfilling the shared stack.

## Decisions this plan settles (within the spec's "left to the builder")

1. **Level versus number layers:** the dataset's adapter says it draws bands (`drawsAsBands`, in a
   dependency-free `src/lib/data/adapters/bands.ts`): `forecasts` and `hms-smoke` do, and the rest
   don't.
   - It isn't a metadata test, because the catalog gives the AQI forecast `chart: "bar"` and
     units, and weather temperature may have a monitor scale. A metadata test would misclassify
     both.
   - Its only inputs are code facts about what each adapter emits (points with `level`). It keeps
     the SDK out of the initial bundle, since `src/lib/sharing/points.ts` uses the main-layer rule.
2. **Totals read `sum`, from the catalog's `aggregate` (the user, 2026-11-07; changed from
   inferring totals from `display.chart`):** each catalog entry type has a required top-level
   `aggregate: "sum" | "mean" | null` (sjvair.com #318, `@sjvair/sdk` 5.0.0-beta.6), next to
   `resolutions`, not inside `display`.
   - `"sum"` (weather precipitation/ETo/ETr, pounds applied, acres treated, applications, spray
     notices): read the summary's `sum`, and rolling values into an open period sums them.
   - `"mean"` (pollutants, the other weather entries, TEMPO): read `mean`, and an open period
     averages.
   - `null` (wind direction, heat score, AQI forecast, CES score, smoke density, burn status, fire
     FRP, facility entries, methane emission rate): values never roll up over time.
   - `display.chart` still picks bars or a line, and nothing else.
   - Pesticide Yearly still reads the server's `years[]`, because summing months can fall short of
     a year (undated records sit only in the year rows). Summing is only for an open month.
3. **Weather offers no "Every measurement":** the adapter offers the catalog's levels minus
   `raw`.
   - CIMIS readings are hourly, so Hourly shows the same values. This also avoids the raw
     `*_f`/`*_c` dew point and soil temperature fields.
   - Entry types left with nothing (wind direction, raw-only) aren't offered. This is a small
     narrowing of the spec ("read the °F field when Every measurement is chosen"); the PR says so.
4. **Weather partial:** a summary row with `is_complete: false` is `partial` (the server's own
   count against expected hours), as well as an open period.
5. **Number overlays get `pin` = the main data's resolution.** `chooseResolution` already falls
   back to the nearest coarser offered level: daily main → monthly pesticide bars. Level overlays
   keep spec 3's behavior (no pin).
6. **A gone filter id is caught in `target()`:** the pesticide adapter looks up each saved
   chemical, commodity or product by id (memoized), which also gives `display_name` for the legend.
   - A 404 → `{ unavailable: "filter-gone" }`.
   - A `not_found` from `pesticidePlaceFilterErrors` during fetch (a race) is thrown as an error.
7. **Saved field names:** `Layer.station` and `Layer.filters` (see Task 2). The coordinator gets
   these for the Map widget prompt in Task 2's last step.

## Review Focus

1. **A widget saved before this spec** (PM2.5 + burn status, no `station`/`filters`) renders
   exactly as before: the same cache key, the AQI forecast still a band, and its overlay not
   pinned. → Task 2 test `old layers keep their keys and kinds`.
2. **Removing the pollutant from a widget with a weather layer:** the places move to the weather
   layer (now main), and the widget never ends with no places. Removing the only number layer is
   refused. → Task 9 tests `removing the pollutant moves places to the next number layer` and
   `the last number layer can't be removed`.
3. **A place where the weather station list is empty, or the saved station isn't in the list
   any more** (a monitor outside every 25-mile radius, or a station hidden since): the layer falls
   back to the first listed station, or shows "No data" for that place, and never throws. → Task 4
   tests.
4. **A pesticide range entirely outside the dataset's coverage** (last 30 days):
   - the strip shows "No pesticide use reported for these dates.";
   - the main chart is unaffected;
   - a pesticide-only widget shows the same text, not an error.
   → Task 6 and Task 7 tests.
5. **A smoke range over 366 days** (last 12 months plus "This year" in a leap year, or a custom
   two-year range): split into ≤ 366-day requests with no day lost or duplicated at the joins. →
   Task 5 test `two-year range splits without gaps`.

---

### Task 1: Pin SDK beta.6, and metadata for chart kind and smoke levels

**Blocked until `@sjvair/sdk` 5.0.0-beta.6 is published** (ask the coordinator).

**Files:**

- Modify: `package.json`, `package-lock.json`
- Modify: `src/lib/data/metadata.ts` (`EntryTypeMeta`, `mapDatasetCatalog`, `datasetLevels`)
- Modify: `src/lib/data/metadata.test.ts`
- Modify: unit fixtures under `src/lib/data/testing/` and e2e fixtures under `e2e/fixtures/api/`
  (catalog: the new `applications` entry type, the weather `display` changes from #314, and
  `meta_url`s)

**Interfaces:**

- Produces:
  - `EntryTypeMeta.chart: "line" | "bar" | null`, from the catalog's `display.chart`; unknown
    values → `null`.
  - `EntryTypeMeta.aggregate: "sum" | "mean" | null`, from the catalog's top-level `aggregate`
    (decision 2).
  - `MetadataSource.datasetLevels("hms-smoke", "smoke-density")` → levels from
    `getHMSMeta()`'s smoke-density scale, mapped with the existing `mapScaleLevels`.
- [ ] **Step 1:** `git fetch`, branch `step-4-spec-3b` from `origin/step-4`. Set
      `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.6"` and run `npm install`. Run
      `npm run check` and `npm run test`, and fix any fixture or schema breaks from beta.5/beta.6
      before going on (look at the SDK CHANGELOG for both).
- [ ] **Step 2: Write failing tests** in `metadata.test.ts`:
  - `maps display.chart onto entry types`: precipitation → `"bar"`, temperature → `"line"`, a
    missing `display` → `null`.
  - `maps aggregate onto entry types`: precipitation → `"sum"`, temperature → `"mean"`, wind
    direction → `null`.
  - `hms-smoke levels come from hms meta`: a stubbed `getHMSMeta` with light/medium/heavy → three
    levels in min order, keys `light`/`medium`/`heavy`.
- [ ] **Step 3:** Implement both.
  - `getHMSMeta` is memoized like `forecastsMeta`.
  - Update the `datasetLevels` comment: each dataset with scales names its endpoint here.
- [ ] **Step 4:** Run `npx vitest run src/lib/data/metadata.test.ts`. Expected: PASS. Then run
      `npm run test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: pin @sjvair/sdk 5.0.0-beta.6; catalog chart kind and smoke
      levels`. Tell the coordinator the pin landed.

### Task 2: Layer fields, layer kinds, the main-layer rule, and overlays that carry their settings

**Files:**

- Modify: `src/lib/data/schema.ts`, `src/lib/data/schema.test.ts`
- Create: `src/lib/data/adapters/bands.ts`
- Create: `src/lib/data/layer-kind.ts`, `src/lib/data/layer-kind.test.ts`
- Modify: `src/lib/data/types.ts` (`UNAVAILABLE_REASONS` + `"filter-gone"`)
- Modify: `src/lib/data/adapters/registry.ts` (`AdapterRequest`)
- Modify: `src/lib/data/query/client.ts`, `src/lib/data/query/key.ts`,
  `src/lib/data/query/key.test.ts`, `client.test.ts`
- Modify: `src/lib/widgets/shared/input.ts` (`pollutantLayer` → `mainLayer`) and every caller
  (`csv.ts`, `data-widget.svelte.ts`, `places/apply.ts`, `PlacePickerDialog.svelte`,
  `GetDataView.svelte`, `sharing/points.ts`, `overlays.ts`)
- Modify: `src/lib/widgets/shared/overlays.ts`, `overlays.test.ts`
- Modify: `src/lib/widgets/shared/WidgetState.svelte` (the `filter-gone` message, shown like
  `GONE` reasons with "Choose another" → Edit data)

**Interfaces:**

- Produces:
  - `LIMITS.CATEGORIES_MAX = 10`.
  - `PesticideFiltersSchema`, with every field optional, an object, and unknown keys stripped:
    - `{ chemical: IdSchema, commodity: IdSchema, product: IdSchema }`;
    - `category: z.array(CodeSchema).min(1).max(CATEGORIES_MAX)`;
    - `iarcGroup: CodeSchema`, `method: CodeSchema`, `narrow: CodeSchema`.
    - Type: `PesticideFilters`.
  - `LayerSchema` gains `station: SafeIdSchema.optional()` and
    `filters: PesticideFiltersSchema.optional()`.
  - `drawsAsBands(dataset: string): boolean` (`bands.ts`; true for `"forecasts"` and
    `"hms-smoke"`; no imports).
  - `layerKind(layer: Layer, catalog: CatalogEntry[] | undefined)`, in `layer-kind.ts`:
    - returns `"pollutant" | "number" | "level" | undefined` (`undefined`: unknown entry type);
    - pollutant by the catalog's `kind`, level by `drawsAsBands`, else number.
  - `mainLayer(data: WidgetDataConfig, catalog): Layer | undefined`:
    - the first pollutant layer, else the first number layer;
    - else the first layer with an entry type, so an unknown one still says so, as today;
    - it replaces `pollutantLayer` (same file, all callers renamed).
  - `AdapterRequest` gains `station?: string` and `filters?: PesticideFilters`, copied from the
    layer.
  - `queryKey` parts gain optional `station` and `filters`, left out of the key when absent, so
    existing keys are unchanged.
  - `overlayInput(main: QueryInput, overlay: Layer, mainResolution: Resolution | undefined,
    catalog)`:
    - copies `station` and `filters` from the overlay;
    - sets `pin: mainResolution` when the overlay is a number layer;
    - drops the overlay's own `resolution` (decision 5 and the spec).
  - `UnavailableReason` adds `"filter-gone"`.
- [ ] **Step 1: Write failing tests.**
  - `schema.test.ts`:
    - `a layer keeps station and filters`;
    - `filters reject 11 categories`;
    - `unknown filter keys are dropped`;
    - `a 65-char chemical id is rejected`.
  - `layer-kind.test.ts` (fixture catalog):
    - PM2.5 → pollutant, burn-status and aqi-forecast → level, smoke-density → level,
      temperature (weather) → number, pounds-applied → number, unknown → `undefined`.
  - `input.test.ts`:
    - `main is the pollutant even when listed second`;
    - `with no pollutant, main is the first number layer`;
    - `a level layer is never main while a number layer exists`.
  - `key.test.ts`:
    - `old layers keep their keys and kinds`: the exact key string for a layer with no
      station/filters equals the pre-change string (snapshot the current output before changing
      code);
    - `station and filters change the key`.
  - `overlays.test.ts`:
    - `a number overlay is pinned to the main resolution`;
    - `a level overlay is not pinned`;
    - `an overlay carries its station and filters, never places of its own`.
- [ ] **Step 2:** Run them. Expected: FAIL (missing exports and fields).
- [ ] **Step 3:** Implement.
  - `DataWidget` (`data-widget.svelte.ts`) passes the main query's `data.resolution` as
    `mainResolution`. While the main is loading, overlays wait: `null` input → idle.
  - Add the `filter-gone` message `widget_state_unavailable_filter_gone` ("A filter this widget
    uses is no longer available.").
- [ ] **Step 4:** Run `npm run test:unit` and `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: layer station and filters, layer kinds, and the main-layer rule`.
      Send the coordinator the final `Layer.station` / `Layer.filters` shape for the Map widget
      prompt.

### Task 3: Summary series for totals

**Files:**

- Modify: `src/lib/data/aggregate.ts`, `aggregate.test.ts`
- Modify: `src/lib/data/adapters/air-quality-fetch.ts` (`SummaryRow`, `toPoints`,
  `monitorSummaryTasks`)
- Modify: `src/lib/data/adapters/air-quality.ts` (export `summarySeries`; thread options)
- Test: `src/lib/data/adapters/air-quality.test.ts`

**Interfaces:**

- Produces:
  - `type SummaryOptions = { total?: boolean; completeness?: boolean }`, exported from
    `air-quality-fetch.ts`.
    - `total`: points take `row.sum` as `mean`/`min`/`max`.
    - `completeness`: `row.is_complete === false` → `partial`.
  - `monitorSummaryTasks(..., signal, opts?: SummaryOptions)`.
  - `aggregate(points, to, now, how: "mean" | "sum" = "mean")`: `"sum"` adds means, and min/max
    become the sum.
  - `export async function summarySeries(req, places: { place: string; id: string }[],
    processors: (string | null)[], signal, opts?: SummaryOptions): Promise<Series[]>` from
    `air-quality.ts`. Monitors only when `opts` is given; air quality calls it unchanged.
- [ ] **Step 1: Write failing tests:**
  - `aggregate sums totals into an open month`: three daily 0.1/0.2/0.3 in → one month point,
    `mean` 0.6.
  - `a total row reads sum`: a monitor summary fixture with `sum: 1.25`, `mean: 0.05` → point
    `mean` 1.25.
  - `an incomplete row is partial with completeness`.
  - `air quality points are unchanged`: the existing fixtures with no `opts` give the same
    points.
- [ ] **Step 2:** Run `npx vitest run src/lib/data/aggregate.test.ts
      src/lib/data/adapters/air-quality.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `summarySeries` passes `opts.total ? "sum" : "mean"` to every
      `aggregate` call (fill and backfill).
- [ ] **Step 4:** Run the same files, then `npm run test:unit:tz`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: summary series can read totals and completeness`.

### Task 4: The weather adapter and station list

**Files:**

- Create: `src/lib/data/adapters/weather.ts`, `weather.test.ts`
- Modify: `src/lib/data/index.ts` (`ADAPTERS`), `src/lib/data/adapters/registry.test.ts` if it
  lists ids
- Modify: `src/lib/widgets/chart/index.ts`, `src/lib/widgets/table/index.ts` (`accepts.datasets`
  →
  `["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"]`; the other two datasets'
  adapters land in Tasks 5–6, and `offeredDatasets` already skips a dataset without one)

**Interfaces:**

- Consumes: Task 2's `AdapterRequest.station`; Task 3's `summarySeries` with
  `{ total, completeness: true }`.
- Produces:
  - `weatherAdapter: DatasetAdapter`:
    - id `"weather"`;
    - `target`: `layerTarget`, with `"all"` → `place-unsupported`;
    - `offered: (base) => base.filter((r) => r !== "raw")`;
    - `overlays: () => true`;
    - no `bands`.
  - `stationsFor(ref: PlaceRef, signal): Promise<WeatherStation[]>`, memoized per place key:
    `getWeatherStationsForPlace(...).stations`, in server order.
  - `stationChoice(stations: WeatherStation[], saved: string | undefined)`:
    - returns `WeatherStation | undefined`;
    - the saved station if listed, else the first.
  - `export type WeatherStation = { id: string; name: string; distance: number; inside: boolean;
    active: boolean }`.
  - `PlaceInfo` for weather series:
    - the **main place's** key (`region:…` / `monitor:…`), so series match the main layer's
      places;
    - a new optional `source?: { id: string; name: string; distance: number; inside: boolean }`
      field on `PlaceInfo` (`src/lib/data/types.ts`), for the legend and CSV.
- [ ] **Step 1: Write failing tests** (SDK calls stubbed with fixture JSON):
  - `the first station is the default`: Fresno County fixture → #80 Fresno State.
  - `a saved station in the list wins; one not listed falls back to the first`.
  - `the override is ignored with several places`: two places, `station` set → each uses its own
    first station.
  - `an empty station list gives an empty series, not an error`.
  - `precipitation reads sum, temperature reads mean`: catalog `aggregate` sum/mean.
  - `wind direction is not offered`: `offered(["raw"])` → `[]`, so `offeredDatasets` leaves it
    out (assert through `offeredDatasets` with the fixture catalog).
  - `a school uses its ZIP's stations`: a fallback target asks with its first key.
  - `the open month is built from daily rows and summed for totals` (Task 3 path, through the
    adapter).
- [ ] **Step 2:** Run `npx vitest run src/lib/data/adapters/weather.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Places come from `candidates` as in `forecasts.ts`. Factor that function into `targets.ts` as
    `placeCandidates(target, ctx, signal)` if it's needed unchanged; otherwise keep a local copy.
  - Each place gets its station, then `summarySeries` with places `[{ place: mainKey, id:
    station.id }]` and processors `[null]`.
- [ ] **Step 4:** Run the test file, `npm run test:unit`, and `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: weather adapter with the nearest station`.

### Task 5: The smoke adapter

**Files:**

- Create: `src/lib/data/adapters/smoke.ts`, `smoke.test.ts`
- Modify: `src/lib/data/index.ts`

**Interfaces:**

- Produces: `smokeAdapter: DatasetAdapter`:
  - id `"hms-smoke"`;
  - `offered: () => ["day"]`, `overlays: () => true`;
  - day points with `level` = the density key and `mean` = NaN, as `forecasts.ts` does for
    burn status;
  - `null` density → no point;
  - 404 → an empty series.
- [ ] **Step 1: Write failing tests:**
  - `densities become day levels`;
  - `null density makes no point`;
  - `two-year range splits without gaps`: 2024-01-01 – 2025-12-31 → requests each ≤ 366 days,
    contiguous `gte`/`lte` in Pacific dates, 731 days in total, no duplicates;
  - `several places, one request each`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Split with `splitChunks(seg, 366)` from `chunks.ts` (or whole
      calendar years, if that caches better; either passes the test).
- [ ] **Step 4:** Run `npx vitest run src/lib/data/adapters/smoke.test.ts` and
      `npm run test:unit:tz`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: smoke adapter (density per day)`.

### Task 6: The pesticide adapter, meta and filter labels

**Files:**

- Create: `src/lib/data/adapters/pesticides.ts`, `pesticides.test.ts`
- Create: `src/lib/data/pesticide-meta.ts` (memoized `getPesticidesMeta`, plus label lookups)
- Modify: `src/lib/data/index.ts`

**Interfaces:**

- Consumes: Task 2's `AdapterRequest.filters` and `"filter-gone"`.
- Produces:
  - `pesticidesAdapter: DatasetAdapter`:
    - id `"pesticide-use"`;
    - `offered: (base) => base.filter((r) => r === "month" || r === "year")`;
    - `overlays: () => true`;
    - entry types read `pounds` / `acres` / `applications` from each row.
    - **One field map is allowed:** the catalog's entry type id → its response field
      (`pounds-applied` → `pounds`, `acres-treated` → `acres`, `applications` → `applications`),
      the same way `forecasts.ts` reads its fields.
  - `toWire(filters: PesticideFilters, range)`:
    - returns `PesticidesForPlaceFilters`;
    - `iarcGroup` → `iarc_group`, `method` → `aerial_ground`, `category` array as is;
    - `year__gte`/`year__lte` from the range's Pacific years.
  - Points:
    - Monthly gives one point per month in range. A month missing from `months` is 0 inside
      coverage (`meta/coverage/?dataset=pesticide-use` through the SDK's coverage getter) and no
      point outside it.
    - Yearly gives `years[]` totals, undated included.
    - `partial: false`.
  - `pesticideMeta(signal): Promise<PesticidesMeta>` (memoized).
  - `filterLabels(filters, signal): Promise<{ chemical?: string; commodity?: string; product?:
    string }>`:
    - `display_name` from the detail getters, memoized per id;
    - it rejects with a `FilterGone` error on a 404.
  - `PlaceInfo.filters?: string[]`: the human labels of the active filters (category labels,
    method label, narrow label, names), for the legend, table header and CSV.
- [ ] **Step 1: Write failing tests** (fixture JSON for `place/`, `meta/`, detail getters,
      coverage):
  - `months fill zeros inside coverage only`: a range 2023-11 – 2024-02 with coverage ending
    2023-12-31 → points for 2023-11 and 2023-12 (one 0), none for 2024.
  - `yearly totals include undated use`.
  - `filters go out on the wire`: `{ chemical: "hp8nm", category: ["carcinogen",
    "toxic_air_contaminant"], method: "none", narrow: "concern" }` → the SDK called with
    `chemical: "hp8nm"`, `category: [...]`, `aerial_ground: "none"`, `narrow: "concern"`.
  - `a removed chemical makes the layer filter-gone`: the detail getter 404 → `target` returns
    `{ unavailable: "filter-gone" }`.
  - `a daily request is served monthly`: through the query client with `pin: "day"` →
    `resolution: "month"`.
  - `a range outside coverage gives an empty series, not an error`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. A fallback target uses its first key (ZIP, then city, then county
      per spec 2); a monitor goes as `{ monitor }`.
- [ ] **Step 4:** Run `npx vitest run src/lib/data/adapters/pesticides.test.ts`, then
      `npm run test:unit`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: pesticide use adapter with filters`.

### Task 7: Chart strips, bars and the main chart as bars

**Files:**

- Create: `src/lib/charts/strips.ts`, `strips.test.ts` (layout math and point shaping, pure)
- Modify: `src/lib/charts/time-chart.ts`, `TimeChart.svelte`, `Readout.svelte`,
  `SeriesKey.svelte`, `time-chart.browser.test.ts`
- Modify: `src/lib/widgets/chart/ChartWidget.svelte`, `chart-widget.browser.test.ts`,
  `chart-size.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**

- Consumes: `EntryTypeMeta.chart`, `layerKind`, `PlaceInfo.source` and `PlaceInfo.filters`.
- Produces:
  - `type ChartStrip = { name: string; label: string; unit: string; chart: "line" | "bar";
    precision: number | null; yMin: number | null; points: SeriesPoint[]; resolution:
    Resolution; wholePeriod: boolean }`.
    - `wholePeriod` is set when the strip is coarser than the main chart.
  - `stripLayout(height: number, strips: number): { main: number; strip: number; gap: number }`.
    - The main chart keeps ≥ 50% of `height`; each strip gets an equal share of the rest.
    - Below a minimum strip height (pick 48 px), strips still draw and the main keeps 50%.
  - `createTimeChart` input gains `strips?: ChartStrip[]` and `mainChart?: "line" | "bar"`.
    - Each strip is its own uPlot below the main, with the same x scale, synced cursor (uPlot
      `cursor.sync`), and an axis labeled with `label` and `unit`.
    - Bars use `uPlot.paths.bars` from `yMin`.
    - A coarser strip draws each point as one bar from period start to next period start.
- **Strings:**
  - `chart_strip_monthly_total` ("Monthly total");
  - `chart_strip_whole_month` (the readout's whole-month marker);
  - `chart_strip_none_pesticides` ("No pesticide use reported for these dates.");
  - `chart_strip_key` (`{layer} · {source}`, with the source being the station name with miles,
    or the filters; final wording to the user).
- [ ] **Step 1: Write failing tests.**
  - `strips.test.ts`:
    - `the main chart keeps half with two strips`: `stripLayout(400, 2).main >= 200`;
    - `strips share the rest equally`;
    - `a month bar spans its month`: points at month starts → bar spans
      `[start, nextMonthStart)` in Pacific time (`npm run test:unit:tz`).
  - `time-chart.browser.test.ts`:
    - `a strip draws under the main plot with its axis label`: the label text and unit are
      visible;
    - `bar strips for bar entry types, a line for line ones`;
    - `the readout shows each strip's value at the cursor` (keyboard: move the cursor with arrow
      keys as the existing readout test does);
    - `a pesticide-only chart draws bars as the main chart`.
  - `chart-widget.browser.test.ts`:
    - `an empty pesticide strip says no use reported` (text, and no error state);
    - `the legend names the station and its distance`;
    - `the legend names the active filters`;
    - `a pre-spec widget renders as before`: PM2.5 + burn status with no strips, the same band
      count.
- [ ] **Step 2:** Run `npx vitest run --project browser src/lib/charts
      src/lib/widgets/chart` and `npx vitest run src/lib/charts/strips.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `ChartWidget.drawn()` splits overlays by `layerKind`: level → `bands` (as today), number →
    `strips`.
  - "Overlay for" picks the place for both.
  - Reduced motion is respected as today (no new animation).
- [ ] **Step 4:** Run the same commands. Expected: PASS. Run `npm run check`.
- [ ] **Step 5:** Commit `feat: number overlays draw in strips under the chart`.

### Task 8: Data table and CSV for the new layers

**Files:**

- Modify: `src/lib/widgets/table/rows.ts`, `rows.test.ts`, `DataTable.svelte`,
  `data-table.browser.test.ts`
- Modify: `src/lib/data/csv.ts`, `csv.test.ts`

**Interfaces:**

- Produces:
  - `TableRow.overlays: Array<Level | SeriesPoint | null>`: a number overlay cell is its point,
    formatted with the entry type's precision and units.
  - `OverlayRows` gains `kind: "level" | "number"`.
  - CSV columns gain `source_id`, `source_name` (the weather station) and `filters` (the active
    filter labels joined with "; "; empty otherwise), appended after the existing columns, so
    existing column positions don't move.
  - A coarser overlay's rows under a finer main keep their own `period_start`/`period_end`.
- [ ] **Step 1: Write failing tests:**
  - `rows.test.ts`:
    - `a weather overlay column holds numbers`;
    - `a monthly pesticide overlay fills the days of its month` (marked whole-month).
  - `csv.test.ts`:
    - `weather rows carry the station`;
    - `pesticide rows carry their filters`;
    - `the existing columns keep their order` (header string up to `level_label` unchanged);
    - `a pesticide-only CSV has no pollutant rows`.
  - `data-table.browser.test.ts`: `the header names the station and filters`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/lib/data/csv.test.ts src/lib/widgets/table` and the
      browser project for the table. Expected: PASS.
- [ ] **Step 5:** Commit `feat: table and CSV for weather, smoke and pesticide layers`.

### Task 9: Get data's What sections: optional pollutant, standalone number layers, per-layer pesticide filters, the station choice

**Files:**

- Create: `src/lib/get-data/layers.ts`, `layers.test.ts` (pure draft-layer operations)
- Create: `src/lib/get-data/PesticideFilters.svelte` (one layer's "Narrow down")
- Create: `src/lib/get-data/SearchPicker.svelte` (combobox over `searchPesticides`)
- Create: `src/lib/get-data/StationChoice.svelte`
- Modify: `src/lib/get-data/WhatSections.svelte`, `GetDataView.svelte`, `offer.ts`,
  `offer.test.ts`, `get-data-view.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**

- Consumes:
  - `mainLayer` and `layerKind` (Task 2);
  - `stationsFor`, `stationChoice` (Task 4);
  - `pesticideMeta`, `filterLabels` (Task 6);
  - SDK `searchPesticides`.
- Produces (`layers.ts`, each `(data: WidgetDataConfig, catalog, …) => void`, mutating the draft
  in place like today's handlers):
  - `setPollutant(data, catalog, pick: EntryPick | null)`: `null` removes the pollutant. Places
    move to the new main; refused (no change) if it would leave no number layer.
  - `toggleLayer(data, catalog, pick: EntryPick, on: boolean)`: for weather, smoke and forecasts.
    - Adding a number layer when there's no main makes it the main, with places moved from the
      old main.
    - Respects `MAX_OVERLAYS`.
  - `addPesticideLayer(data, catalog, entryType: string)`.
  - `removeLayer(data, catalog, index: number)`: same place-moving rule; refuses the last
    number layer.
  - `setFilters(data, index: number, filters: PesticideFilters | undefined)`.
  - `setStation(data, station: string | undefined)`: sets it on every weather layer.
  - `dropStationOnPlaceChange(data)`: called from `setPlaces`.
  - `levelOnly(data, catalog): boolean`. When true, Add, Save and Download are disabled with
    `get_data_level_only` ("Add a pollutant, weather or pesticide layer to chart this.").
- `offeredDatasets`: a dataset with no pollutant entry types offers its number entry types as
  layers that can stand alone (`OfferedDataset.layerTypes`), and level ones as overlays.
- **The UI:**
  - Air Quality's radio group gains **"None"** (first, so the choice stays a radio group, the
    standard pattern).
  - Weather is checkboxes plus `StationChoice`, shown only with exactly one place.
  - Smoke and Forecasts are checkboxes.
  - Pesticide Use lists its layers, each with a summary line ("Carcinogens · Grapes", or "All
    pesticides") and an expandable "Narrow down" (`PesticideFilters`). The section ends with
    "Add another pesticide layer" (disabled with the limit reason at `MAX_OVERLAYS`).
  - **`PesticideFilters` controls:**
    - Chemical, Crop and Product: `SearchPicker`, the bits-ui Combobox, `searchPesticides` with
      `limit` 25. Starts after 2 characters; "More results: keep typing" when `more`; placeholder
      chemicals filtered out.
    - Category: a checkbox group of `in_use` categories.
    - Cancer group, Method and Narrow to: selects with "Any" first.
    - Labels and descriptions come from `pesticideMeta`.
  - **`StationChoice`** is a select:
    - inside stations first, then nearby ones as "{name} ({miles} mi)";
    - inactive ones with "may be behind";
    - default = the first station; choosing the first stores nothing.
- [ ] **Step 1: Write failing tests:**
  - `layers.test.ts`:
    - `removing the pollutant moves places to the next number layer`;
    - `the last number layer can't be removed`;
    - `a pesticide layer can be added twice with different filters`;
    - `setStation sets every weather layer`;
    - `changing places drops the station`;
    - `levelOnly is true for smoke alone`;
    - `MAX_OVERLAYS counts pesticide layers`.
  - `offer.test.ts`:
    - `weather offers its summary types only`;
    - `pesticide use offers three layer types`;
    - `smoke is an overlay only`.
  - `get-data-view.browser.test.ts`:
    - `a temperature-only chart can be added`;
    - `choosing None for Air Quality keeps the places`;
    - `the station choice shows only with one place`;
    - `a filter search lists results after two letters and picks one` (stubbed
      `searchPesticides`);
    - `smoke alone disables Add with the reason`;
    - axe at `page.viewport(1280, 800)` and at 390 × 844 with a pesticide layer's "Narrow down"
      open.
- [ ] **Step 2:** Run `npx vitest run src/lib/get-data/layers.test.ts
      src/lib/get-data/offer.test.ts` and the browser file. Expected: FAIL.
- [ ] **Step 3:** Implement. `GetDataView`'s `setMain`, `toggleOverlay` and `setPlaces` delegate
      to `layers.ts`. The draft schema is unchanged (Layer carries the new fields).
- [ ] **Step 4:** Run the same, then `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: Get data layers: optional pollutant, pesticide filters, station
      choice`.

### Task 10: "Show values" and the toggletip

**Files:**

- Create: `src/lib/components/Toggletip.svelte`, `toggletip.browser.test.ts`
- Modify: `src/lib/get-data/DetailControl.svelte` (keep the file name; its legend and options
  change), `resolution-offer.ts`, `resolution-offer.test.ts`
- Modify: `src/lib/get-data/WhatSections.svelte` (a toggletip on Smoke and on Pesticide Use)
- Modify: `messages/en.json`

**Interfaces:**

- Produces:
  - `<Toggletip label={string} text={string} />`, on bits-ui Popover:
    - a 24 px "?" button whose accessible name is `label`;
    - opens on click, tap or Enter/Space, and also on pointer hover;
    - closes on Escape, an outside click, or pointer leave (when opened by hover);
    - its text is in a `role="status"` live region, so it's announced;
    - focus stays on the button.
  - `resolution-offer.ts` `LEVELS` gains `"year"` (`PER_DAY.year = 1/365`).
- **Strings:**
  - `get_data_detail` → "Show values";
  - the options "Automatic", "Every measurement", "Hourly", "Daily", "Monthly", "Yearly"
    (`get_data_detail_year`);
  - `get_data_show_values_help` (the spec's draft text);
  - `get_data_smoke_help` ("Days without a band had no smoke detected. A missed satellite pass
    looks the same.");
  - `get_data_pesticide_help` (yearly totals include reports with no month, so a year can exceed
    its months).
  - Final wording goes to the user with the PR.
- [ ] **Step 1: Write failing tests:**
  - `toggletip.browser.test.ts`:
    - `opens with Enter and closes with Escape, focus stays on the button`;
    - `opens on click and closes on outside click`;
    - `its text is announced` (a live region with the text after opening);
    - `the button is at least 24 px`.
  - `resolution-offer.test.ts`:
    - `pesticides offer Monthly and Yearly only`;
    - `Yearly is offered when the entry type has it`.
  - `get-data-view.browser.test.ts`: `More options shows "Show values" with a help button`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same, then `npm run check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: "Show values" with a toggletip`.

### Task 11: End to end, stack check, bundle, docs

**Files:**

- Modify: `e2e/get-data.spec.ts`, plus fixtures in `e2e/fixtures/api/`:
  - `monitors/weather/place`, monitor summaries for a CIMIS station;
  - `hms/smoke/place`, `hms/meta`;
  - `pesticides/place`, `pesticides/meta`, `pesticides/search`, and the detail getters;
  - `meta/coverage`.
- Modify: `ARCHITECTURE.md`:
  - "Get data": number layers on their own, strips, "Show values", the station choice, per-layer
    pesticide filters, `Layer.station`/`Layer.filters`;
  - "Widget catalog" → "Widget-type contract": `accepts.datasets`;
  - "Data resolution & live refresh": number overlays pinned to the main level, coarser strips,
    weather totals.
- Modify: `DEFERRED.md`:
  - remove the four layers from "Get data overlays waiting…";
  - update "An overlay on its own";
  - add the spec's deferrals: wind direction, pesticide breakdowns, the school block / buffer
    dashboard side, the release-timing note, and the station per place or per layer.
- Modify: `TODO.md` and `ROADMAP.md`: step 4's sections only (spec 3b built, its PR pending).
- [ ] **Step 1: Write the e2e tests:**
  - `adds PM2.5 with a weather strip and a filtered pesticide strip`;
  - `adds a temperature-only chart`;
  - `downloads a CSV with station and filter columns`;
  - `an old PM2.5 + burn status widget still shows its bands`.
- [ ] **Step 2:** Run `npm run test:e2e`, then `npm run test:e2e:podman`. Expected: PASS on all
      three engines.
- [ ] **Step 3:** Run `npm run build && npm run check:build && npm run check:budget`. Expected:
      the initial bundle is ≤ 200 KB gzip, unchanged from 199.4 KB apart from noise. If it grew,
      find the import with the budget report and make it lazy.
- [ ] **Step 4:** Stack check against local `develop` (`npm run dev`; Playwright, not the shared
      Chrome):
  - Fresno County PM2.5 with Fresno State temperature and smoke over October 2026. Local gaps
    are expected, including 2026-11-06 15:44–17:49 PT.
  - Fresno County pounds applied narrowed to one chemical over 2022–2023.
  - A CSV with both.
  - Record what was seen in the PR.
- [ ] **Step 5:** Update the docs above (re-read each file right before editing), then run
      `npm run lint` and `npm run test`. Commit `docs: spec 3b in ARCHITECTURE, DEFERRED, TODO
      and ROADMAP`.
- [ ] **Step 6:** Push, open the PR into `step-4` listing:
  - the new English strings for the user's approval;
  - decision 3 (no "Every measurement" for weather) as a narrowing of the spec;
  - the stack check results.
  - No AI attribution in the body.
  - Run `gh pr checks`.
  - Tell the coordinator the PR number. Don't merge without the user's yes.
