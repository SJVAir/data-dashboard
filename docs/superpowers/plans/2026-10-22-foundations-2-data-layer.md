# Foundations spec 2: the data layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One data layer that turns a widget layer plus a date range into cached, shared,
live-refreshing, correctly resolved air-quality data, proven by unit tests and a hidden dev page.

**Architecture:** Pure modules (range resolution, resolution ladder, period planning, chunking,
aggregation, downsampling) under `src/lib/format/` and `src/lib/data/`, a framework-free query
engine (cache, dedup, polling, abort) with a thin runes wrapper, one dataset adapter (air quality)
behind an adapter registry, and a metadata source interface whose web implementation reads
`monitors/meta/` and reports the catalog as unavailable until the server serves it.

**Tech Stack:** Svelte 5 runes, TypeScript, zod 4, `@date-fns/tz`, `@sjvair/sdk` 4.7.0, `color2k`,
Vitest (node + browser mode), Vite inline workers, Paraglide.

**Spec:** `docs/superpowers/specs/2026-10-22-foundations-2-data-layer-design.md`

## Global Constraints

- Branch `foundations-2-data` from `foundations`; PR into `foundations`. Never touch `main`.
- Code style: tabs, double quotes, no trailing commas, 100-column lines; `npm run format` before
  each commit. Svelte 5 runes only.
- Commit messages carry **no** AI attribution or `Co-Authored-By` trailer (user rule).
- All dates and periods in **America/Los_Angeles** through the `format` module; weeks start
  **Sunday**. Never the browser's zone.
- No hardcoded labels, units, colors, breakpoints, resolutions, or pollutant lists in product
  code. Test fixtures and the dev page may supply a stand-in catalog.
- All product UI strings through Paraglide (`messages/en.json`, `m.*`). The dev page may use plain
  English (it never ships).
- Styling values only from theme tokens (CSS variables in `src/app.css`).
- No direct `document.visibilityState`/`visibilitychange` outside the platform adapter.
- The production build must not contain the dev page, the dev catalog, or the data layer in the
  initial chunk (nothing in product code imports `src/lib/data/` at startup except the document
  schemas).
- Every deferral goes into `DEFERRED.md` in the same commit, with why and a revisit trigger.
- Resolution ladder: span ≤ 2 days → `raw`; ≤ 60 days → `hour`; ≤ 730 days → `day`; longer →
  `month`. Priority: widget-type pin → layer override → ladder.
- Poll cadence: `raw` every 3 minutes; every other resolution at the next :55 past the hour
  (Pacific), after the server's :50 summary task. Backoff on error: 30 s doubling, capped at
  30 minutes; reset on success. Polls only for ranges that include now; paused while hidden.

## Review Focus

1. **A viewer whose device is not in Pacific time** (e.g. `America/New_York`, `Asia/Tokyo`)
   gets the same dates, periods, and raw-entry windows as a Pacific viewer. → Task 2 and Task 10
   tests run with `process.env.TZ` set to a non-Pacific zone.
2. **Quick successive changes** (a widget switches range three times before the first response)
   show only the last request's data, and the first two are aborted. → Task 8 test
   `superseded requests are aborted and never shown`.
3. **The tab sits hidden overnight, then becomes visible**: exactly one catch-up poll runs, not
   a burst of missed polls. → Task 9 test `one catch-up poll after a long hidden period`.
4. **The current month with no daily row yet for today** (just after midnight, or a local stack
   with no rollups) shows a partial month from what exists, never an error or a blank. → Task 7
   test `open month with missing today is still partial, not empty`.
5. **A place with no data** in a bulk response (the server omits it) shows as an empty series and
   isn't refetched on the next poll. → Task 10 test `omitted places become empty series`.

---

## File structure

```
src/lib/sdk-setup.ts                         SDK origin + request defaults (Task 1)
src/lib/format/index.ts                      strict date parsing, PT label message (Task 2)
src/lib/format/range.ts                      resolveRange, rangeSpan, freezeRange, periodStart (Task 3)
src/lib/data/schema.ts                       zod schemas: DateRangeSpec, PlaceRef, … (Task 4)
src/lib/documents/schema.ts                  WidgetInstance.data → WidgetDataConfig (Task 4)
src/lib/widgets/registry.ts                  real types for accepts/resolution/… (Task 4)
src/lib/data/types.ts                        Series, QueryData, QueryState, Target, … (Task 5)
src/lib/data/metadata.ts                     MetadataSource interface + web implementation (Task 5)
src/lib/data/testing/fixtures.ts             stand-in catalog + monitors meta for tests (Task 5)
src/lib/data/resolution.ts                   chooseResolution (Task 6)
src/lib/data/periods.ts                      planSegments (open-period stitching) (Task 7)
src/lib/data/aggregate.ts                    combine summaries into coarser points (Task 7)
src/lib/data/chunks.ts                       splitChunks + runLimited (Task 7)
src/lib/data/downsample.ts                   raw → buckets (pure) (Task 11)
src/lib/data/downsample.worker.ts            worker wrapper (Task 11)
src/lib/data/downsample-client.ts            lazy inline-worker client (Task 11)
src/lib/data/query/key.ts                    cache keys (Task 8)
src/lib/data/query/client.ts                 QueryClient: cache, dedup, abort, subscribers (Task 8)
src/lib/data/query/poller.ts                 cadence, backoff, visibility (Task 9)
src/lib/data/live-query.svelte.ts            runes wrapper (Task 9)
src/lib/data/adapters/registry.ts            adapter registry (Task 10)
src/lib/data/adapters/targets.ts             PlaceRef/selection → Target (Task 10)
src/lib/data/adapters/air-quality.ts         the air-quality adapter (Task 10)
src/lib/platform/types.ts, web/*, memory.ts  `activity` visibility capability (Task 9)
src/lib/color.ts                             readableColor (Task 12)
src/lib/components/data/LevelSwatch.svelte   outlined swatch + label (Task 12)
src/routes/dev/DevData.svelte (+ dev-catalog.ts)  hidden dev page (Task 13)
src/router.ts                                dev-only lazy route (Task 13)
```

---

### Task 1: Branch, SDK bump, SDK setup

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/main.ts`, `.env.example`
- Create: `src/lib/sdk-setup.ts`, `src/lib/sdk-setup.test.ts`

**Interfaces:**
- Produces: `configureSdk(env: { DEV: boolean; VITE_DEV_URL?: string; VITE_PROD_URL?: string }, pageOrigin: string): string` — returns the origin it set.

- [ ] **Step 1:** `git checkout foundations && git pull && git checkout -b foundations-2-data`.
- [ ] **Step 2:** `npm install @sjvair/sdk@npm:@jsr/sjvair__sdk@^4.7.0`. Confirm `node_modules/@sjvair/sdk` exports `setRequestDefaults` and `setOrigin`. Run `npm run check && npm test` → pass.
- [ ] **Step 3: Write the failing test** `src/lib/sdk-setup.test.ts` (mock `@sjvair/sdk` with `vi.mock`):
  - `dev with VITE_DEV_URL uses it`: `configureSdk({ DEV: true, VITE_DEV_URL: "http://localhost:8000" }, "http://localhost:5173")` → `setOrigin` called with `"http://localhost:8000"`.
  - `dev without VITE_DEV_URL falls back to the page origin`: → `"http://localhost:5173"`.
  - `production uses the page origin, ignoring VITE_DEV_URL`: `{ DEV: false, VITE_DEV_URL: "x" }`, `"https://www.sjvair.com"` → `"https://www.sjvair.com"`.
  - `VITE_PROD_URL overrides in production`: `{ DEV: false, VITE_PROD_URL: "https://staging.example" }` → that value.
  - `sets same-origin credentials with CSRF left on`: `setRequestDefaults` called once with exactly `{ credentials: "same-origin" }`.
- [ ] **Step 4:** Run `npx vitest run src/lib/sdk-setup.test.ts` → FAIL (module missing).
- [ ] **Step 5:** Implement `configureSdk` in `src/lib/sdk-setup.ts`. Call it in `src/main.ts` before `boot(...)` with `import.meta.env` and `location.origin`. In `.env.example`, change the `VITE_DEV_URL` comment to "SDK origin in dev (until spec 5's dev proxy); unset = page origin" and `VITE_PROD_URL` to "standalone/Tauri override; unset = page origin".

  Note: `VITE_PROD_URL` is set in `.env.example` today; production under `/workspace/` must use the page origin, so the hosting track sets no `VITE_PROD_URL`. Record that sentence in `ARCHITECTURE.md` → "Deployment" → env vars if not already said.
- [ ] **Step 6:** Run the test → PASS; `npm run check` → pass.
- [ ] **Step 7: Commit** `git commit -m "Set up the SDK origin and request defaults on 4.7.0"`.

---

### Task 2: `format` module gaps

**Files:**
- Modify: `src/lib/format/index.ts`, `src/lib/format/format.test.ts`, `messages/en.json`, `DEFERRED.md`

**Interfaces:**
- Produces: `parseDateKey(date: string): { y: number; m: number; d: number }` (throws `RangeError` on anything but a real `YYYY-MM-DD` date); `pacificDay(date: string, hour?: number): TZDate` and `toKey(d: Date): string` become exported (Task 3 uses them).

- [ ] **Step 1: Write failing tests** in `format.test.ts`:
  - `parseDateKey rejects malformed and impossible dates`: each of `"2026-1-05"`, `"2026-02-30"`, `"20261005"`, `"2026-10-05T00:00"`, `""` throws `RangeError`; `"2024-02-29"` returns `{ y: 2024, m: 2, d: 29 }`.
  - `DST spring-forward day has the right hour starts`: `pacificHoursOfDay("2026-03-08")` has 23 instants; the first three (`toISOString`) are `2026-03-08T08:00Z, 09:00Z, 10:00Z` (00:00 PST, 01:00 PST, then 03:00 PDT; 02:00 never happens).
  - `DST fall-back day repeats 1 AM`: `pacificHoursOfDay("2026-11-01")` has 25 entries; the first three are `07Z, 08Z, 09Z` (00:00 PDT, 01:00 PDT, 01:00 PST).
  - `formatDate shows the Pacific calendar date in any device zone`: `formatDate("2026-10-22")` → `"Oct 22, 2026"`; `formatDate(new Date("2026-10-22T05:00:00Z"))` → `"Oct 21, 2026"`.
  - `formatDateTime appends the PT label from messages`: with `deviceZone: "America/New_York"` the result ends with the rendered `m.time_zone_suffix()`; with `"America/Los_Angeles"` it doesn't.
- [ ] **Step 2:** Run `npm run test:unit -- src/lib/format` → FAIL.
- [ ] **Step 3:** Implement: `parseDateKey` (regex `^\d{4}-\d{2}-\d{2}$` plus a round-trip check); `pacificDay` uses it; add message `"time_zone_suffix": "{time} PT"` and use `m.time_zone_suffix({ time: text })` in `formatDateTime`; export `pacificDay`, `toKey`.
- [ ] **Step 4:** Run tests → PASS. Also run them once with `TZ=Asia/Tokyo npm run test:unit -- src/lib/format` → PASS.
- [ ] **Step 5:** Remove the "Format module gaps" entry from `DEFERRED.md` → "Internationalization" (done, not dropped).
- [ ] **Step 6: Commit** `"Close the format module gaps"`.

---

### Task 3: `DateRangeSpec` resolution

**Files:**
- Create: `src/lib/format/range.ts`, `src/lib/format/range.test.ts`

**Interfaces:**
- Consumes: `pacificDay`, `toKey`, `parseDateKey`, `todayPacific`, `WEEK_STARTS_ON` (Task 2). `DateRangeSpec` type from Task 4 — **define the TS type here** in `range.ts` (Task 4's zod schema must infer to the same shape; Task 4 re-exports the type from the schema and this file switches to importing it).
- Produces:
  ```ts
  type ResolvedRange = {
  	firstDate: string; // inclusive Pacific YYYY-MM-DD
  	lastDate: string; // inclusive
  	start: Date; // instant, inclusive
  	end: Date; // instant, exclusive (for "trailing hour": now)
  	rolling: boolean; // to-date or trailing
  	includesNow: boolean;
  };
  resolveRange(spec: DateRangeSpec, now: Date): ResolvedRange
  rangeSpanDays(r: ResolvedRange): number // (end - start) in ms / 86_400_000, not rounded
  freezeRange(spec: DateRangeSpec, now: Date): { kind: "custom"; start: string; end: string }
  type Period = "hour" | "day" | "month" | "quarter" | "season" | "year";
  periodStart(instant: Date, period: Period): Date // Pacific boundary at or before instant
  nextPeriodStart(start: Date, period: Period): Date
  ```
  Seasons: use the server's season boundaries. Read them from sjvair.com
  (`grep -rn "season" ../sjvair.com/camp/apps/summaries`) and copy the rule into a comment with
  the file path; if the server defines none, use meteorological seasons (Dec–Feb, Mar–May,
  Jun–Aug, Sep–Nov, a season starting in December belongs to the next year) and say so in the
  commit message.

- [ ] **Step 1: Write failing tests** (`now = new Date("2026-10-22T19:00:00Z")`, which is Thu Oct 22 12:00 PDT):
  - `set day/week/month/year`: `{set, day, "2026-03-08"}` → first=last=`2026-03-08`, `end - start` = 23 h; `{set, week, "2026-10-22"}` → `2026-10-18`..`2026-10-24`; `{set, month, "2024-02-10"}` → `2024-02-01`..`2024-02-29`; `{set, year, "2026-05-01"}` → `2026-01-01`..`2026-12-31`, `includesNow: true`, `rolling: false`.
  - `to-date`: week → `2026-10-18`..`2026-10-22`; month → `2026-10-01`..`2026-10-22`; year → `2026-01-01`..`2026-10-22`; all `rolling: true, includesNow: true`.
  - `trailing days include today`: `{trailing, 30, day}` → `2026-09-23`..`2026-10-22`.
  - `trailing months count calendar days back`: `{trailing, 12, month}` → `2025-10-23`..`2026-10-22`; `{trailing, 1, month}` with now `2026-03-31T19:00Z` → `2026-03-01`..`2026-03-31` (date-fns `subMonths` clamps Feb 31 → Feb 28, then +1 day).
  - `trailing hours are exact`: `{trailing, 24, hour}` → `start = 2026-10-21T19:00Z`, `end = now`, firstDate `2026-10-21`, lastDate `2026-10-22`.
  - `custom`: `{custom, "2025-12-30", "2026-01-02"}` → those dates, `includesNow: false`; a custom range ending today → `includesNow: true`.
  - `freezeRange`: `{trailing, 24, hour}` → `{custom, "2026-10-21", "2026-10-22"}`; `{to-date, month}` → `{custom, "2026-10-01", "2026-10-22"}`; a `set` spec freezes to its dates.
  - `periodStart across DST`: `periodStart(new Date("2026-11-01T09:30:00Z"), "hour")` → `09:00Z` (second 1 AM); `periodStart(…"2026-03-08T12:00Z", "day")` → `2026-03-08T08:00Z`; quarter of `2026-05-15` → `2026-04-01T07:00Z`.
  - Add the script `"test:unit:tz": "npm run paraglide && TZ=America/New_York vitest run --project unit src/lib/format src/lib/data"` to `package.json`, so the same tests also run in a non-Pacific device zone (used from here on).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `@date-fns/tz` (`TZDate`) and `date-fns` (`startOfWeek` with `WEEK_STARTS_ON`, `subMonths`, `addDays`). Invalid specs (bad dates) throw `RangeError` from `parseDateKey`.
- [ ] **Step 4:** Run `npm run test:unit -- src/lib/format` and `npm run test:unit:tz` → PASS.
- [ ] **Step 5: Commit** `"Resolve DateRangeSpec to Pacific dates"`.

---

### Task 4: Data config schemas in the document format

**Files:**
- Create: `src/lib/data/schema.ts`, `src/lib/data/schema.test.ts`
- Modify: `src/lib/documents/schema.ts`, `src/lib/documents/load.ts`, `src/lib/starter/starter.ts` (only if needed), `src/lib/widgets/registry.ts`, `src/lib/format/range.ts` (import the type)

**Interfaces:**
- Produces (zod schemas and inferred types, exact names): `ResolutionSchema` (`"raw" | "hour" | "day" | "month" | "quarter" | "season" | "year"`), `DateRangeSpecSchema`, `PlaceRefSchema`, `SpatialSelectionSchema`, `TimeSubRangeSchema`, `LayerSchema`, `WidgetDataConfigSchema`, plus `LIMITS = { ID_MAX: 64, CODE_MAX: 64, LABEL_MAX: 200, LAYERS_MAX: 8, SELECTION_MAX: 500 }`.
  - `LayerSchema`: `{ dataset: string(1..64); entryType?: string(1..64); place?: PlaceRef; selection?: SpatialSelection; resolution?: "auto" | Resolution }`, refined: not both `place` and `selection`.
  - `SpatialSelectionSchema`: `{ kind: "monitors" | "regions"; ids: string[] (1..SELECTION_MAX, unique); source?: GeoJSON geometry (validated as an object with a string `type`; size bounded by the document size limit in spec 3) }`; region ids match `^[a-z0-9_]+:[^:]+$`.
  - `PlaceRefSchema`: the five kinds from ARCHITECTURE.md; `point` has `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`, `label?` ≤ LABEL_MAX.
  - `TimeSubRangeSchema`: `{ start, end }`, both `YYYY-MM-DD` (valid via `parseDateKey`) or both ISO date-times with offset (`z.iso.datetime({ offset: true })`), with `start <= end`.
  - `DateRangeSpecSchema`: dates valid via `parseDateKey`; `trailing.amount` int 1..3650; custom `start <= end`.
  - `WidgetDataConfigSchema`: `{ dateRange?: DateRangeSpec; timeSubRange?: TimeSubRange; layers: Layer[] (≤ LAYERS_MAX) }`.
  - `DashboardSchema` rejects any `{ kind: "default-place" }` anywhere in widget layers; `StarterDashboardSchema` (exported) allows it. `loadDashboard` keeps using `DashboardSchema`; the starter is checked against `StarterDashboardSchema` in its test.
- Registry: `accepts?: { datasets?: string[]; maxPollutantLayers?: number }`, `placePicker?: boolean`, `resolution?: Resolution`, `dateMethods?: DateRangeSpec["kind"][]`, `span?: { minDays?: number; maxDays?: number }`.

  Note on `timeSubRange`: the ARCHITECTURE sketch puts it on `QueryDescriptor`; widgets keep it on the widget's data config, next to `dateRange`, since the range is per widget. Record this in `ARCHITECTURE.md` → "Widget data selection" in this task.

- [ ] **Step 1: Write failing tests** `schema.test.ts`: a valid map-like config (two layers, one with a regions selection `["county:06019"]`); a valid chart config with `{trailing, 30, day}` and a monitor place; rejections: place and selection both set; `trailing.amount: 0`; custom `start > end`; `"2026-02-30"`; selection with 501 ids; duplicate ids; a region id `"06019"` without type; a `timeSubRange` mixing a date and a date-time. Plus: `DashboardSchema` rejects a widget whose layer place is `default-place`; `StarterDashboardSchema` accepts it; existing placeholder dashboards (`data: { layers: [] }`) still parse.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; replace `data: z.object({ layers: z.array(z.unknown()) })` with `WidgetDataConfigSchema`; update registry types.
- [ ] **Step 4:** Run `npm test` (all) and `npm run check` → PASS (existing tests must still pass unchanged).
- [ ] **Step 5: Commit** `"Finalize the data config schemas"`.

---

### Task 5: Data types, metadata source, fixtures

**Files:**
- Create: `src/lib/data/types.ts`, `src/lib/data/metadata.ts`, `src/lib/data/metadata.test.ts`, `src/lib/data/testing/fixtures.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  type SeriesPoint = { t: number; mean: number; min: number; max: number; count: number; partial: boolean };
  type Series = { place: string; points: SeriesPoint[] }; // place: "monitor:<id>" | "region:<type>:<code>"
  type QueryData = { series: Series[]; resolution: Resolution; fromRaw: boolean; processor: string | null; fetchedAt: number };
  type UnavailableReason = "catalog-unavailable" | "unknown-dataset" | "unknown-entry-type" | "no-adapter" | "no-resolution" | "place-unsupported" | "region-unresolved" | "whole-layer-raw";
  type QueryState =
  	| { status: "loading"; data?: QueryData }
  	| { status: "ready"; data: QueryData }
  	| { status: "error"; error: unknown; data?: QueryData }
  	| { status: "unavailable"; reason: UnavailableReason };
  type Target = { kind: "monitors"; ids: string[] } | { kind: "regions"; keys: string[] } | { kind: "all" };
  type QueryInput = { layer: Layer; dateRange: DateRangeSpec; pin?: Resolution };
  ```
  `t` is the period start in epoch ms. A raw point has `mean = min = max = value`, `count = 1`.
- Produces in `metadata.ts`:
  ```ts
  type EntryTypeMeta = { id: string; label: string; units: string; kind: "pollutant" | "meteorological" | "other"; resolutions: Resolution[]; available?: boolean; retired?: { since: string; replacedBy?: string } };
  type CatalogEntry = { id: string; label: string; entryTypes: EntryTypeMeta[]; geographies: string[]; retired?: {...} }; // the ARCHITECTURE.md shape (other fields optional here)
  type Level = { name: string; label: string; color: string; range: [number, number] };
  interface MetadataSource {
  	catalog(signal?: AbortSignal): Promise<CatalogEntry[] | "unavailable">;
  	levels(entryType: string, signal?: AbortSignal): Promise<Level[]>; // ordered by range start; [] if none
  	defaultProcessor(monitorType: string, entryType: string, signal?: AbortSignal): Promise<string | null>; // `default_calibration`, "" → null
  	monitorType(monitorId: string, signal?: AbortSignal): Promise<string | null>;
  	monitors(signal?: AbortSignal): Promise<Array<{ id: string; name: string; type: string }>>;
  }
  createWebMetadata(): MetadataSource       // getMonitorsMeta + getMonitorsList, each fetched once and memoized; catalog() → "unavailable"
  withCatalog(base: MetadataSource, catalog: CatalogEntry[]): MetadataSource
  ```
- Produces in `testing/fixtures.ts`: `FIXTURE_CATALOG` (air-quality with `pm25` and `o3` resolutions `["raw","hour","day","month","quarter","season","year"]`, `pm10` `["raw"]`, all `kind: "pollutant"`, `available: true` except `pm10: false`), `fixtureMetadata(overrides?)` — an in-memory `MetadataSource` with two monitors (`"m-pa"` type `"purpleair"` → processor `"PM25_EPA_Calibration"`; `"m-bam"` type `"bam1022"` → `null`) and pm25 levels `good [0, 9]` `#00e400`, `moderate [9.1, 35.4]` `#ffff00`.

- [ ] **Step 1: Write failing tests** `metadata.test.ts` with `vi.mock("@sjvair/sdk")`: catalog is `"unavailable"`; `getMonitorsMeta` is called once across three `levels()` calls; `levels("pm25")` returns levels ordered by range start; `defaultProcessor("purpleair", "pm25")` returns the meta's `default_calibration`, `""` maps to `null`; `monitorType` of an unknown id → `null`; `withCatalog` returns the given catalog and delegates the rest.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `"Add the data types and metadata source"`.

---

### Task 6: Resolution choice

**Files:** Create `src/lib/data/resolution.ts`, `resolution.test.ts`.

**Interfaces:**
- Produces: `chooseResolution(args: { spanDays: number; offered: Resolution[]; pin?: Resolution; override?: "auto" | Resolution }): { resolution: Resolution; downsampleFromRaw: boolean; reason: "pin" | "override" | "ladder" }`.

Rules, in order:
1. Ideal = pin, else the override if not `"auto"`, else the ladder from Global Constraints.
2. If the ideal is offered → `{ ideal, downsampleFromRaw: false }`.
3. Else the nearest offered level **coarser** than the ideal, in the order
   `raw, hour, day, month, quarter, year` (`season` is used only when it is the ideal).
4. Else, if `raw` is offered → `{ ideal, downsampleFromRaw: true }`.
5. Else throw `RangeError` (the query client reports `no-resolution`).

- [ ] **Step 1: Failing tests:** spans `2` → raw, `2.01` → hour, `60` → hour, `61` → day, `730` → day, `731` → month (pm25 offered all); pm10 (`["raw"]`) at 30 days → `{ hour, downsampleFromRaw: true }`; pin `"day"` beats override `"hour"` (`reason: "pin"`); override `"month"` at 3 days → month; offered `["raw","day"]` at 30 days → `day` (nearest coarser).
- [ ] **Steps 2–4:** run → FAIL, implement, run → PASS. **Step 5: Commit** `"Choose a resolution from the span and offered levels"`.

---

### Task 7: Period planning, aggregation, chunking

**Files:** Create `src/lib/data/periods.ts`, `aggregate.ts`, `chunks.ts`, and a test file for each.

**Interfaces:**
- Produces:
  ```ts
  type Segment = { resolution: Resolution; start: Date; end: Date; aggregateTo?: Resolution };
  planSegments(args: { resolution: Resolution; range: ResolvedRange; now: Date; offered: Resolution[] }): Segment[]
  aggregate(points: SeriesPoint[], to: Period): SeriesPoint[] // groups by periodStart(t, to); partial = true for an open period or any partial input
  splitChunks(seg: Segment, maxDays: number): Segment[]
  runLimited<T>(tasks: Array<() => Promise<T>>, limit: number, signal?: AbortSignal): Promise<T[]> // preserves order; stops starting tasks once aborted
  CHUNK_DAYS: Record<Resolution, number> = { raw: 31, hour: 31, day: 366, month: 1830, quarter: 1830, season: 1830, year: 3660 }
  ```
  `planSegments`: completed periods of `resolution` come from one segment of that resolution;
  the **open** period at the end (the one containing `now`, clipped to `range.end`) is filled from
  the next finer offered level, recursively: `year/quarter/season ← month ← day ← hour ← raw`.
  Each fill segment has `aggregateTo` set to the coarse resolution. For `raw` there's nothing to
  plan. Before using `CHUNK_DAYS` for bulk endpoints, check the server's maximum spans in
  `../sjvair.com/camp/api/v2/summaries/endpoints.py` and lower any value that exceeds them (note
  the source in a comment).

  `aggregate`: `mean` is the count-weighted mean, `min`/`max` over parts, `count` summed.
  Points with `count = 0` are skipped.

- [ ] **Step 1: Failing tests** (`now = 2026-10-22T19:00Z`):
  - `month range this year: completed months plus a daily fill of October` → segments `[month Jan..Oct 1, day Oct 1..Oct 22 19:00Z aggregateTo month]`, and the day segment itself has an hourly fill for today: `[hour Oct 22 07:00Z..now aggregateTo day]` — assert the exact three segments, in order.
  - `range that ended in the past has a single segment`.
  - `open month with missing today is still partial, not empty`: aggregate of daily points for Oct 1..21 (no Oct 22) into month gives one point with `partial: true` and the weighted mean.
  - `aggregate weights by count`: `[{mean 10, count 1}, {mean 20, count 3}]` → mean `17.5`, count 4.
  - `aggregate across DST`: hourly points on 2026-11-01 (25 of them) into day → one point with count = sum.
  - `splitChunks` covers the segment exactly with no gaps or overlaps (Oct 1 2024 → Oct 22 2026, day, 366 → 3 chunks).
  - `runLimited` never runs more than `limit` at once, keeps order, and rejects with the abort reason after `abort()`.
- [ ] **Steps 2–4:** FAIL, implement, PASS (also `npm run test:unit:tz`). **Step 5: Commit** `"Plan open-period fills, aggregate, and chunk requests"`.

---

### Task 8: Query client: keys, cache, dedup, abort

**Files:** Create `src/lib/data/query/key.ts`, `client.ts`, `client.test.ts`, `key.test.ts`.

**Interfaces:**
- Consumes: `resolveRange` (Task 3), `chooseResolution` (Task 6), `MetadataSource` (Task 5), `QueryInput`/`QueryState`/`QueryData` (Task 5). Adapters via:
  ```ts
  interface DatasetAdapter {
  	id: string;
  	target(layer: Layer, ctx: AdapterContext): Promise<Target | { unavailable: UnavailableReason }>;
  	fetch(req: AdapterRequest, ctx: AdapterContext, signal: AbortSignal): Promise<QueryData>;
  }
  type AdapterRequest = { entryType: string; target: Target; resolution: Resolution; downsampleFromRaw: boolean; range: ResolvedRange; offered: Resolution[]; now: Date };
  type AdapterContext = { metadata: MetadataSource; regions: RegionResolver };
  interface RegionResolver { resolve(type: string, code: string, signal?: AbortSignal): Promise<string | "unsupported" | null> }
  ```
  (Define these in `src/lib/data/adapters/registry.ts` in this task; Task 10 implements one.)
- Produces:
  ```ts
  createQueryClient(opts: { adapters: DatasetAdapter[]; metadata: MetadataSource; regions: RegionResolver; now?: () => Date; maxIdleEntries?: number /* 200 */ }): QueryClient
  interface QueryClient {
  	subscribe(input: QueryInput, listener: (s: QueryState) => void): Subscription;
  	refetch(key: string): void; // used by the poller
  	entries(): Array<{ key: string; subscribers: number; inFlight: boolean; fetchedAt?: number; includesNow: boolean; resolution: Resolution }>; // for the dev page and poller
  }
  interface Subscription { update(input: QueryInput): void; setPolling(on: boolean): void; unsubscribe(): void; readonly key: string | null }
  queryKey(parts: { dataset; entryType; target: Target; resolution; downsampleFromRaw; range: DateRangeSpec | { firstDate; lastDate } }): string
  ```
  The key uses the **spec** for rolling ranges and the resolved dates for fixed ones (so two
  widgets on "last 7 days" share an entry as time moves); target ids sorted; stable JSON
  (sorted object keys).

  Flow of `subscribe`/`update`: read the catalog (→ `catalog-unavailable` if unavailable);
  find the dataset and entry type (`unknown-dataset` / `unknown-entry-type`; **retired entries
  still work**, per "Stable ids and retirement", so retirement is never an unavailable reason);
  the adapter (`no-adapter`); `adapter.target`; `resolveRange`; `chooseResolution` (a throw →
  `no-resolution`); `whole-layer-raw` when the target is `all` and the result is raw or
  downsampled from raw; then the key; attach to the entry, fetching if absent or stale. Errors keep the previous `data`. When a subscription moves to a new key, the old entry
  loses a subscriber; if it then has none and is in flight, its `AbortController` aborts.
  Idle entries (no subscribers) are evicted least-recently-used beyond `maxIdleEntries`.

- [ ] **Step 1: Failing tests** with a fake adapter whose `fetch` returns deferred promises:
  - `two subscribers to the same input share one fetch`.
  - `superseded requests are aborted and never shown`: one subscription updated three times quickly; the first two fetch signals are aborted; the listener never sees data from them, even if the fake resolves them late.
  - `abort spares a request another subscriber still needs`.
  - `an error keeps the last good data`: ready → refetch fails → state `{ status: "error", data: <previous> }`.
  - `catalog unavailable gives catalog-unavailable`; `unknown entry type`; `dataset without adapter gives no-adapter`; `whole layer at raw gives whole-layer-raw`.
  - `rolling inputs share a key as time moves; fixed inputs key by dates` (in `key.test.ts`).
  - `idle entries beyond the cap are evicted least recently used`.
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5: Commit** `"Add the query client with shared, cancellable requests"`.

---

### Task 9: Polling, visibility capability, runes wrapper

**Files:**
- Create: `src/lib/data/query/poller.ts`, `poller.test.ts`, `src/lib/data/live-query.svelte.ts`, `live-query.svelte.test.ts`
- Modify: `src/lib/platform/types.ts`, `src/lib/platform/web/storage.ts` (or a new `web/activity.ts` wired in `createWebPlatform`), `src/lib/platform/memory.ts`

**Interfaces:**
- Platform: `interface ActivitySource { visible(): boolean; onChange(cb: (visible: boolean) => void): () => void }`; `Platform.activity: ActivitySource`. Web uses `document.visibilityState`; memory exposes `setVisible(v: boolean)` for tests.
- Produces:
  ```ts
  nextPollDelay(resolution: Resolution, now: Date): number // raw: 180_000; others: ms until the next hh:55:00 Pacific (if now is exactly hh:55:00, one hour)
  backoffDelay(failures: number): number // min(30_000 * 2 ** (failures - 1), 1_800_000)
  startPoller(client: QueryClient, activity: ActivitySource, opts?: { now?: () => Date; setTimeout?; clearTimeout? }): { stop(): void }
  class LiveQuery { state: QueryState /* $state */; constructor(client: QueryClient, input: QueryInput | null); set(input: QueryInput | null): void; setPolling(on: boolean): void; destroy(): void }
  ```
  `createQueryClient` gains an option `activity?: ActivitySource` and starts the poller itself when
  given one. Only entries with subscribers that have polling on and `includesNow` are polled.
  While hidden, no timers run; on becoming visible, every entry whose due time has passed is
  refetched **once**, then scheduling resumes.

- [ ] **Step 1: Failing tests** (fake timers, memory activity):
  - `nextPollDelay`: raw → 180 000; hour at `2026-10-22T19:10:00Z` (12:10 PDT) → 45 min; at 12:55:00 → 60 min.
  - `backoffDelay`: 1 → 30 s, 2 → 60 s, 8 → 1 800 000 (capped).
  - `polls only ranges that include now`; `stops when the last subscriber leaves`; `setPolling(false) pauses one subscription's entry only when no other subscriber polls it`.
  - `paused while hidden`; `one catch-up poll after a long hidden period` (hidden for 10 h → exactly one refetch on visible).
  - `backs off after failures and resets on success`.
  - `LiveQuery` reflects loading → ready, and `destroy()` unsubscribes.
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5: Commit** `"Poll shared queries, paused while hidden"`.

---

### Task 10: The air-quality adapter

**Files:**
- Create: `src/lib/data/adapters/targets.ts`, `targets.test.ts`, `air-quality.ts`, `air-quality.test.ts`
- Modify: `src/lib/data/adapters/registry.ts` (export `createWebRegionResolver(): RegionResolver` → always `"unsupported"`), `src/lib/data/index.ts` (create) exporting `getQueryClient()`: a lazily created singleton with `[airQualityAdapter]`, `createWebMetadata()`, the web region resolver, and `platform().activity`.

**Interfaces:**
- Consumes: Tasks 5–9.
- Produces: `airQualityAdapter: DatasetAdapter` with `id: "air-quality"`; `layerTarget(layer: Layer, regions: RegionResolver, signal?): Promise<Target | { unavailable: UnavailableReason }>` in `targets.ts`.

Behavior (from the spec's "Settled after the builder check"):
- **Targets:** place `monitor` → `{monitors, [id]}`; place `region` → resolver; `"unsupported"` or `null` → `region-unresolved`; place `point`/`location`/`default-place` → `place-unsupported`; selection monitors → monitors; selection regions → each key via the resolver (any unresolved → `region-unresolved`); neither → `{ kind: "all" }`. Series `place` keys use the document reference (`monitor:<id>`, `region:<type>:<code>`), never the server sqid.
- **Published series:** single-monitor summary calls pass `processor` = `metadata.defaultProcessor(monitorType, entryType)` (omit when `null`). Bulk calls pass no `processor` (the server's default is the published series). Report `processor` in `QueryData` (single monitor) or `null` (bulk). **Verify against the local stack** (Step 5) that a PurpleAir monitor's raw entries and its published summaries are the same series; if raw entries need a stage or processor filter to match, add it and note the finding in `docs/reference/v1-lessons.md` → "Server behavior".
- **Summaries:** one monitor → `getMonitorSummaries{Hourly,Daily,Monthly,…}` chunked by the path segments the SDK takes (hourly per month, daily per year, monthly+ per year); several monitors → `getMonitorSummariesBulk*` with `start`/`end` dates; regions → `getRegionSummariesBulk*`; `all` → `getMonitorSummariesBulk*` with no `region`. Keep only rows inside the range (compare on Pacific period start). A place missing from a bulk response becomes an empty series (and the entry is still `ready`, so the next poll refetches only on schedule).
- **Raw entries (window workaround):** call `getMonitorEntries` with `timestampGte` = range start − 1 day and `timestampLte` = min(range end + 1 day, now), pass `signal`, then keep entries whose own timestamp (it carries an offset) is in `[start, end)`. Values are strings → `Number(...)`, drop `NaN`. If `downsampleFromRaw`, hand the points to the downsampling client (Task 11) — until Task 11 lands, call `downsample()` directly.
- **Open periods:** use `planSegments`, fetch each segment (chunked via `splitChunks` + `runLimited(…, 3, signal)`), `aggregate` the fill segments, and concatenate in time order.

- [ ] **Step 1: Failing tests** (`vi.mock("@sjvair/sdk")`, `fixtureMetadata()`, a stand-in resolver mapping `county:06019` → `"sq1"`):
  - `layerTarget` cases above, including `region-unresolved` with the web resolver.
  - `a PurpleAir monitor's daily summaries ask for the published processor` (`processor: "PM25_EPA_Calibration"`); a BAM monitor's call has no `processor`.
  - `raw window is padded, clamped to now, and filtered by entry timestamps`: with `now = 2026-10-22T19:00Z` and range "last 24 hours", the SDK is called with `timestampGte = 2026-10-20T19:00Z`, `timestampLte = now`, and an entry at `2026-10-21T18:59:59Z` is dropped while `2026-10-21T19:00:00Z` is kept. Run under `npm run test:unit:tz` too.
  - `omitted places become empty series` for a bulk region call with two regions where the server returns one.
  - `this year's monthly data fills October from daily and today from hourly` (asserts the SDK calls and that the last point is `partial`).
  - `region series are keyed by type and code, not sqid`.
- [ ] **Steps 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `"Add the air-quality adapter"`. (The local-stack series check runs in Task 13, Step 5.)

---

### Task 11: Worker downsampling

**Files:** Create `src/lib/data/downsample.ts`, `downsample.test.ts`, `downsample.worker.ts`, `downsample-client.ts`, `downsample.browser.test.ts`. Modify `air-quality.ts` to use the client.

**Interfaces:**
- Produces: `downsample(points: Array<{ t: number; value: number }>, to: Period, openFrom?: number): SeriesPoint[]` (buckets by `periodStart`; `partial` for buckets at or after `openFrom`); `downsampleInWorker(points, to, openFrom?, signal?): Promise<SeriesPoint[]>` — on first use, `await import("./downsample.worker.ts?worker&inline")` (Vite's inline worker, a `blob:` URL, since static files are cross-origin in production) and keeps one worker for the session; falls back to calling `downsample` on the main thread when `Worker` is undefined (node tests). One request id per call; an abort rejects that call with the signal's reason and ignores its late reply.

- [ ] **Step 1: Failing tests:** `downsample` hourly buckets across the fall-back day (25 buckets); mean/min/max/count; empty input → `[]`. Browser test: `downsampleInWorker` returns the same result as `downsample` for 10 000 points, and an aborted signal rejects.
- [ ] **Steps 2–4:** FAIL, implement, PASS (`npm run test:unit` and `npm run test:browser`).
- [ ] **Step 5:** `npm run build`; confirm the worker is inlined (no separate `.worker` file under `dist/`, a `blob:` creation in a lazy chunk) and the initial entry chunk doesn't contain `downsample` (grep). Add to `ARCHITECTURE.md` → "Template embedding": the dashboard's CSP needs `worker-src blob:` for the inline worker.
- [ ] **Step 6: Commit** `"Downsample raw data in an inline worker"`.

---

### Task 12: `readableColor` and `LevelSwatch`

**Files:** Create `src/lib/color.ts`, `color.test.ts`, `src/lib/components/data/LevelSwatch.svelte`, `LevelSwatch.browser.test.ts`. Modify `src/app.css` (tokens `--swatch-outline-width`, `--swatch-outline-color` mapped to existing tokens).

**Interfaces:**
- Produces: `readableColor(background: string): "#000000" | "#ffffff"` (wraps `color2k`'s `readableColor`); `<LevelSwatch color={string} label={string} />` — an outlined chip followed by the visible label text; the chip is `aria-hidden`.

- [ ] **Step 1: Failing tests:** `readableColor("#ffff00")` → `"#000000"`; `"#7e0023"` → `"#ffffff"`. Browser: the label text is visible; the chip has a non-zero outline width; the chip is `aria-hidden="true"`; axe (`@axe-core` via `vitest-browser` or `axe-core` directly) reports no violations for a swatch on a white background.
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5: Commit** `"Add readableColor and the outlined level swatch"`.

---

### Task 13: The hidden dev data page

**Files:** Create `src/routes/dev/DevData.svelte`, `src/routes/dev/dev-catalog.ts`. Modify `src/router.ts`.

**Interfaces:**
- Consumes: `createQueryClient`, `LiveQuery`, `airQualityAdapter`, `createWebMetadata`, `withCatalog`, `createWebRegionResolver`, `platform().activity`, `LevelSwatch`, `formatDateTime`, `resolveRange`, `chooseResolution`.

- [ ] **Step 1:** In `router.ts` add `...(import.meta.env.DEV ? { "/dev/data": () => import("./routes/dev/DevData.svelte") } : {})` (sv-router lazy route).
- [ ] **Step 2:** `dev-catalog.ts`: a `CatalogEntry` for air-quality with `pm25`, `o3` (all resolutions) and `pm10` (`["raw"]`), labels from `monitors/meta/` where possible. Header comment: dev-only stand-in until the server's `meta/datasets/` lands.
- [ ] **Step 3:** `DevData.svelte` (plain English allowed; layout with existing shadcn primitives and tokens): monitor picker (from `metadata.monitors()`), entry type, a range control covering every `DateRangeSpec` kind, a resolution override; panels showing resolved dates, chosen resolution and reason, the cache key, query status, `processor`, `fromRaw`, a data table (time in Pacific via `formatDateTime`, mean/min/max/count, partial flag, a `LevelSwatch` for the mean's level), poll info (last fetch, next poll, paused), a request log (started/finished/aborted), and a second panel bound to the same input showing that only one request ran.
- [ ] **Step 4:** `npm run build` then `grep -r "dev/data\|dev-catalog\|DevData" dist/` → no matches.
- [ ] **Step 5: Manual check against the local stack** (`podman` stack running, `VITE_DEV_URL=http://localhost:8000`, `npm run dev`, open `/workspace/dev/data`). If rollups are missing, run a **scoped** rebuild (always `--monitor <id>` and a date range). Check and note results in the PR:
  - PM2.5 for a PurpleAir monitor at last 24 hours (raw), last 30 days (hour), this year (day; October partial), a custom 3-year range (month; this month partial).
  - The PurpleAir raw and summary values are the same series (see Task 10).
  - PM10 last 30 days → hour, `fromRaw: true`.
  - Quick range changes: earlier requests show as aborted.
  - Both panels: one request.
  - Hide the tab for > 3 minutes on a raw range: no polls while hidden, one on return.
  - Set the device zone to `America/New_York` (`TZ=America/New_York` for the browser, or devtools sensors) and confirm the same dates and values.
- [ ] **Step 6: Commit** `"Add the hidden dev data page"`.

---

### Task 14: Docs, deferrals, and the PR

**Files:** Modify `DEFERRED.md`, `ARCHITECTURE.md`, `TODO.md`, `CLAUDE.md` (Key Libraries only if a dependency changed).

- [ ] **Step 1: `DEFERRED.md`:** close "Whole-year over-fetch", "No in-flight request coordination", "'Default to current month' can't show monthly data until the month ends" (move to done per the file's convention). Add: "Calibration choice on layers" (an optional processor field; revisit when researchers ask for uncalibrated data) and "sdk-js raw-entry bounds use the browser's zone" (fix in sdk-js with the step 3 work; affects monitor-map and mobile; the dashboard pads and filters meanwhile). Add anything else deferred during Tasks 1–13.
- [ ] **Step 2: `ARCHITECTURE.md`:** the region resolver and its dependence on step 3 region codes ("Widget data selection"); the `activity` capability ("Platform strategy"); `worker-src blob:` (if not done in Task 11); `timeSubRange` on `WidgetDataConfig` (if not done in Task 4); the "Data resolution & live refresh" cadence values as built.
- [ ] **Step 3: `TODO.md` → "Start here":** spec 2 built; PR link; next: spec 3.
- [ ] **Step 4: Verify:** `npm run lint && npm run check && npm test && npm run test:unit:tz && npm run build && npm run test:e2e` → all pass.
- [ ] **Step 5: Commit** `"Record spec 2 outcomes"`, push `foundations-2-data`, open a PR into `foundations` with the manual-check results from Task 13. (A PR into `foundations` is not a release or a `main` merge; merging it still waits for the user.)
