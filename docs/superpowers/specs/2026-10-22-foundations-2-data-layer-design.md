# Foundations, spec 2: the data layer

Date: 2026-10-22. Branch: `foundations`. Release 1, step 1 (Foundations), second of five specs.

## Why

Spec 1 built the working core with no data. Spec 2 builds the layer every data widget in step
4 stands on, once, so no widget fetches, caches, polls, or picks a resolution on its own. The
problems it fixes are the ones v1 hit: whole-year over-fetching, races where the slowest
response wins, and the current month showing nothing because monthly rollups only exist after
the month ends (`docs/reference/v1-lessons.md`, `DEFERRED.md` → "Legacy Monitors-tab
follow-ups").

**Order (agreed 2026-10-22).** The server's dataset catalog, coverage endpoint, and
available-pollutants list (Release 1 step 3, "Metadata enablers") don't exist yet. Spec 2 goes
ahead anyway, written so it reads the catalog only through an interface. Nothing in the running
app needs the catalog until step 4's Widget Creation, and building spec 2 first tests the
catalog's planned format before the server commits to it. The step 3 metadata track starts now
in a **separate session in the sjvair.com repo**, in parallel. That session doesn't edit this
repo; it messages this session with anything to record here, and this session tells it about
any catalog-format change spec 2 finds (recorded in `ARCHITECTURE.md`).

**Proof without widgets.** Spec 2 adds no product UI. It is proven by unit tests and by a
**hidden dev data page** (agreed 2026-10-22) that shows live data going through the new layer
against the local sjvair.com stack.

## Goals

- The SDK is set up once at startup, on @sjvair/sdk 4.7.0.
- Any `DateRangeSpec` turns into exact Pacific dates and instants, DST-correct.
- `WidgetDataConfig`, `QueryDescriptor`, `PlaceRef`, and `SpatialSelection` have their final
  version 1 schemas in the document format.
- A query layer: give it a descriptor, get reactive data back. It caches, shares one poll per
  descriptor, pauses while the tab is hidden, backs off on errors, and lets the latest request
  win.
- Resolution is picked automatically from the range span and the resolutions a dataset offers,
  with the pin → override → ladder priority.
- Incomplete periods are filled in from finer data (the current month from daily, today from
  hourly).
- Unsummarized data is fetched raw in chunks and downsampled in a Web Worker.
- A dataset adapter registry, with **one adapter: air quality** (agreed 2026-10-22).
- A metadata source interface: real `monitors/meta/` today; the catalog behind the same
  interface, filled by fixtures until the server has it.
- The shared `readableColor` helper and an outlined level swatch.

## Non-goals

- Widgets, Widget Creation, the place picker, the "Change place" bar (step 4).
- Any server or SDK change. The catalog, coverage, available pollutants, region codes in the
  API, the point/monitor → region lookup, and summary cache headers are step 3 server work.
- Datasets other than air quality (each arrives with its widgets in step 4).
- Resolving a point, a school/child-care location, or `default-place` to a region (needs the
  step 3 lookup and the step 4 picker; see "Places" below).
- Persistent data caching (the HTTP cache does that; see "Platform strategy").
- The dev proxy and same-origin cookies in dev (spec 5). Spec 2 reads only public data.
- The dev-stack smoke suite (stays with spec 5, which brings the dev proxy).

## Anti-goals

- **No hardcoded data descriptions.** Labels, units, level colors and breakpoints, the
  resolutions a dataset offers, and the pollutant list come from metadata. A test fixture or
  the dev page may supply a stand-in catalog; product code never does. If the app needs a value
  the server doesn't provide yet, it doesn't show the feature rather than inventing the value.
- **No per-widget data plumbing.** Caching, polling, cancelling, and resolution choice live
  only in the data layer.
- **No browser-zone dates.** Every date calculation goes through the `format` module.
- **No direct browser APIs** for things the platform adapter owns (see "Visibility" below).
- **No dev code in production builds.** The dev page and its stand-in catalog are tree-shaken
  out of `npm run build`.

## Constraints

Everything in spec 1's constraints, plus these decided sections of `ARCHITECTURE.md`: "SDK
request options", "Data resolution & live refresh", "Widget data selection (partial
datasets)", "Metadata as source of truth" (including "Stable ids and retirement"), "Time zone &
calendar conventions", "Platform strategy", and "Browser support & performance budget" (about
200 KB compressed initial JS; each widget type's code loads only when used).

## What gets built

### 1. SDK setup

- Bump `@sjvair/sdk` to `^4.7.0` (it is installed through the JSR npm alias,
  `npm:@jsr/sjvair__sdk`).
- `main.ts` (or a module it calls before mounting) sets the SDK origin and request defaults
  once:
  - **Origin:** in dev, `VITE_DEV_URL` (the local sjvair.com stack, cross-origin reads, as v1
    did); in production builds, `location.origin` (the app is served from sjvair.com under
    `/workspace/`, per the hosting track). `VITE_PROD_URL` stays the standalone/Tauri override.
    Spec 5's dev proxy later changes dev to `location.origin`. _Builder's call:_ where this
    lives, and whether a missing `VITE_DEV_URL` in dev falls back to `location.origin` or fails
    with a clear message.
  - **Request defaults:** `setRequestDefaults({ credentials: "same-origin" })`, leaving the
    SDK's automatic CSRF on. No `Accept-Language` yet (English only).
- Error reporting of SDK failures waits for Sentry (spec 5); spec 2 only surfaces errors in
  query state.

### 2. `DateRangeSpec` resolution (in the `format` module)

Per "Widget Creation view" → date-range methods and "Time zone & calendar conventions".

- `resolveRange(spec, now) → ResolvedRange` with at least: the first and last Pacific
  calendar dates (`YYYY-MM-DD`, inclusive), the start and end instants (end exclusive),
  whether the range is rolling, and whether it **includes now** (which drives live refresh).
- Meanings:
  - `set`: the whole Pacific year/month/week (Sunday start)/day containing `start`.
  - `to-date`: the start of the current Pacific year/month/week through today.
  - `trailing`, unit `day`: today plus the `amount − 1` Pacific days before it. Unit `month`:
    calendar days back `amount` months (so "last 12 months" is one year of Pacific days,
    including today). Unit `hour`: exact hours ending now.
  - `custom`: `start` to `end` inclusive.
- `span(resolved)`: the length the resolution ladder and widget `span` limits use.
- `freezeRange(spec, now) → { kind: "custom", … }`: turns a rolling range into fixed dates,
  for spec 4's staging and for exports. A `trailing` hour range freezes to the Pacific dates
  it covers (so "last 24 hours" becomes two calendar days); _my call_, since `custom` holds
  only dates.
- Fixes the `format` module gaps in `DEFERRED.md` → "Internationalization" → "Format module
  gaps": strict `YYYY-MM-DD` parsing (reject anything else), DST tests that check actual hour
  starts (not just counts), tests for `formatDate`, and the " PT" suffix moved to a Paraglide
  message. That `DEFERRED.md` entry is closed in the same change.

### 3. The data config schemas

Final version 1 schemas (zod) for the types sketched in "Widget data selection":
`QueryDescriptor`, `Resolution`, `WidgetDataConfig`, `PlaceRef`, `SpatialSelection`, and
`DateRangeSpec`. `WidgetInstance.data` becomes `WidgetDataConfig` (replacing spec 1's
`{ layers: unknown[] }`). `schemaVersion` 1 is not frozen until the private preview, so this
needs no migration.

- **Region references** are `{ kind: "region"; type; code }` in a place, and `"type:code"`
  strings in a `SpatialSelection`. Monitors use the server id.
- **`default-place`** is a valid `PlaceRef` only in the built-in starter; validation of every
  other document rejects it (per "Widget data selection" → `default-place`). _Builder's call:_
  how the starter is validated with the looser rule (a flag, or a separate schema).
- **Size limits** on strings and arrays (ids, codes, layer count, selection size, labels), in
  line with "Security baseline" (incoming documents are untrusted). Exact numbers are the
  builder's call; make them generous.
- **Not in the schema:** "at most one pollutant layer" and "dataset and entry type exist".
  Both need metadata, so they are checked when a widget is configured (step 4) and when a
  query runs (a missing or retired reference becomes a query state, never a failed load). This
  keeps documents loadable when metadata changes.
- `WidgetType`'s placeholder fields from spec 1 get real types: `accepts`, `placePicker`,
  `resolution` (a pin), `dateMethods`, `span`. Placeholders keep `time: "none"` and no layers.

### 4. Metadata source

An interface the data layer reads, with:

- **Entry types and levels from `monitors/meta/`** (real today): labels, units, level names,
  colors, and breakpoints for each entry type. Fetched once per session through the query layer
  and cached.
- **The dataset catalog** (`DatasetCatalogEntry[]` as sketched in "Metadata as source of
  truth"): behind the same interface. Until the server serves `meta/datasets/`, the web
  implementation reports it as **unavailable**. Tests and the dev page inject a stand-in
  catalog. When the server endpoint lands (step 3), the web implementation reads it, with no
  change to callers.
- **Available pollutants and coverage:** also part of the interface, also unavailable until
  step 3. Spec 2's data layer doesn't need either to fetch; they gate Widget Creation (step 4).
- **Adapters without a catalog entry, and catalog entries without an adapter, are hidden**
  ("Metadata as source of truth" → "Where 'no code changes' ends").

_Builder's call:_ whether the metadata source lives on the platform adapter or beside it (it's
a network call, not a platform capability, so beside it is likely).

### 5. The query layer

The single entry point widgets will use. Per "Data resolution & live refresh".

- **Input:** a layer (`QueryDescriptor` without a date range), plus the widget's date range,
  an optional time sub-range, and the widget type's resolution pin. **Output:** a reactive
  query state: `loading`, `ready` (data plus the resolution actually used, whether it was
  computed from raw data, and when it was fetched), `error` (keeping the last good data if any,
  so a failed refresh doesn't blank a widget), and **`unavailable`** with a reason (unknown or
  retired dataset/entry type, no adapter, a place kind that can't be resolved yet, a region
  whose code can't be looked up yet). Each reason has a message key so step 4's widgets can show
  the clear states "Stable ids and retirement" requires.
- **Cache:** in memory, keyed by the normalized, fully resolved request (dataset, entry type,
  place or selection, resolution, and concrete dates), shared by every widget. Completed
  periods stay cached for the session; open periods (anything including now) are refreshed by
  polling. _Builder's call:_ eviction (an entry count or byte cap; least recently used).
- **Shared polling:** one poll per cache key, however many widgets show it. Subscribers are
  counted; the poll stops when the last unsubscribes. Only ranges that include now poll.
  Cadence follows the data:
  - raw / current: every 2–5 minutes (_builder's call_ within that);
  - hourly: hourly, a few minutes after the server's :50 region-summary task;
  - daily: after Pacific midnight, plus hourly for today's partial value.
- **Pause while hidden:** polls pause when the page is hidden and catch up once on return
  if a poll was missed.
- **Backoff:** failed polls retry with exponential backoff and a cap; a success resets it.
- **Last requested wins:** each subscriber (a widget) has one current request. Changing its
  descriptor or range aborts its previous request through the SDK's `signal` unless another
  subscriber still needs it. A response for a superseded request is never shown.
- **Dedup:** concurrent requests for the same cache key share one fetch.
- **Minimized widgets:** the layer exposes a way for a subscriber to stop polling without
  unsubscribing (step 2's minimize uses it; a minimized widget with thresholds keeps polling).
  Spec 2 builds the switch; step 2 and step 4 decide when to flip it.
- **Visibility** comes from a small platform-adapter capability (page visible/hidden events),
  not `document.visibilityState` directly, since a Tauri build may keep polling in the
  background (_my call_, following "Platform strategy").

### 6. Resolution

- **The ladder** (by the resolved range's span): ≤ 2 days raw, ≤ about 60 days hour, ≤ about 2
  years day, longer month. It only picks levels the dataset offers; if the ideal level isn't
  offered, it takes the nearest coarser one, or raw with downsampling (below).
- **Priority:** widget-type pin → the layer's `resolution` override → `"auto"` (the ladder).
- **Which levels a dataset offers** comes from the catalog's `resolutions`. For air quality the
  levels also depend on the entry type (PM2.5, O3, NO2, SO2, CO have summaries; PM10 doesn't).
  Spec 2 needs this per entry type; the planned catalog lists resolutions per dataset only.
  **This is a catalog-format change** to raise with the metadata session: `resolutions` per
  entry type (or a per-entry-type override). _My call_ that spec 2 builds against
  per-entry-type resolutions, and records the change in `ARCHITECTURE.md`.
- **Span caps and chunking:** long requests are split into chunks the server accepts (summary
  endpoints by year or month; raw entries by about a year, with smaller chunks if the server
  rejects or a chunk is slow). Chunks fetch with limited concurrency and merge in order.
  _Builder's call:_ chunk sizes and concurrency, based on what the endpoints accept.

### 7. Incomplete periods

Monthly and longer rollups exist only after the period ends, and today's daily row may be
missing (`v1-lessons.md`). For a range that includes an open period, the layer fills it from
finer data: the current month from daily summaries so far, today from hourly, and the current
hour (at hour resolution) from raw where needed. Filled values are marked as partial in the
result. The aggregation rule for combining summaries (count-weighted mean; min/max over
parts; which other statistics are kept) is the builder's call, documented in code and tests,
matching how the server rolls up where that's known.

Bulk endpoints that omit a place with no rows (`v1-lessons.md`) are treated as "no data" and
remembered, so the same place isn't refetched every poll.

### 8. Raw data and worker downsampling

For entry types without summaries (PM10 in spec 2), the layer fetches raw entries (chunked)
and downsamples them in a **Web Worker** to the resolution the ladder picked. The result says
it was computed from raw data (the table and exports show this in step 4).

- The worker is **built inline** (static files are cross-origin on S3; see "Template
  embedding"), e.g. Vite's inline worker import. It loads only when raw downsampling is needed,
  not in the initial bundle.
- Downsampling uses Pacific period boundaries from the `format` module (DST-correct days and
  hours).
- CSP: an inline worker needs `worker-src blob:`. Spec 5 owns the CSP host list; spec 2 adds
  this requirement to `ARCHITECTURE.md` → "Template embedding" so spec 5 picks it up.

### 9. The air-quality adapter and places

The one adapter in spec 2. It turns a resolved request into SDK calls and shapes the result
into the layer's common time-series form (_builder's call:_ the form; typed arrays are fine).

- **Monitors:** fully supported (by server id): raw entries and every summary level the
  server has.
- **Regions:** documents hold a region as type plus official code, but the server's region
  API doesn't yet expose or accept codes (it uses a per-database id, the `sqid`). The adapter
  gets region ids through a **region resolver interface** (type + code → server id). Until
  step 3 adds codes to the region API, the web resolver reports regions as unresolvable, so
  region queries return `unavailable` with that reason. Tests use a stand-in resolver. There
  is no interim way to look a region up by code (no API response carries `external_id`
  today), so **the dev page and the manual check cover monitors only**; region queries are
  proven by unit tests until the server adds codes. The metadata session has region codes as
  its second item (after the catalog and available pollutants).
- **Points, locations (schools/child care), and `default-place`:** `unavailable` in spec 2,
  with a reason. Points and locations need the step 3 lookup; `default-place` needs step 4's
  "Change place" preference. Their resolution steps plug into the same resolver interface.
- **Selections** (several monitors or regions) are fetched with the bulk endpoints where they
  exist, and per place otherwise.

### 10. Colors: `readableColor` and the outlined swatch

- `readableColor(levelColor)`: black or white text on a level color, wrapping `color2k`
  (already installed), so every level-colored surface uses one helper.
- A small `LevelSwatch` component: a color chip with an outline (visible on any background,
  including white and yellow levels) and **always paired with the level label**, never color
  alone. Colors and labels come from metadata. Outline width and color come from theme tokens.

### 11. The hidden dev data page

A dev-only route (for example `/workspace/dev/data`), registered only when
`import.meta.env.DEV`, so production builds don't include it. Not linked from the nav.

- Pick a monitor (from the monitors list), an entry type, a date range (any `DateRangeSpec`),
  and an optional resolution override.
- Show: the resolved Pacific dates, the resolution chosen and why (pin, override, or ladder),
  the cache key, the query state, the data (a plain table; no charts yet), whether it came
  from raw or was filled from finer data, poll timing (last fetch, next poll, paused while
  hidden), and a log of requests including aborted ones.
- A second panel subscribed to the same query proves sharing (one request, two views).
- It uses a dev-only stand-in catalog for air quality, since the server has none yet.
- English text on this page may skip Paraglide (it never ships); _my call_.

## Testing

- **Unit (Vitest):** range resolution and freezing (every kind and unit, around DST changes,
  year and month ends, leap days, Sunday week start); the ladder and priority; chunking;
  incomplete-period filling and aggregation; downsampling (run directly, not in a worker);
  cache keys; shared polling, pause/resume, backoff, abort, and dedup with fake timers and a
  stubbed fetch; the schemas (valid documents, size limits, `default-place` only in the
  starter); `readableColor`.
- **Component (browser mode):** `LevelSwatch` (label always shown, outline present); the
  worker actually loading and answering in a real browser.
- **E2E:** none new for product screens (spec 2 adds none). The existing suite keeps passing.
  Axe runs on the swatch through the component test.
- **Manual check against the local stack:** the dev page shows live PM2.5 and PM10 for a
  monitor at several ranges (last 24 hours, last 30 days, this year, a custom multi-year
  range), the current month filled in, sharing, aborts on quick changes, and polling pausing
  in a hidden tab. Local dev often lacks rollups (`v1-lessons.md`); scoped `rebuild_summaries`
  runs fix that (always with `--monitor` and date scoping).

## `DEFERRED.md` and docs updates in the same change

- Close when implemented: "Whole-year over-fetch", "No in-flight request coordination",
  "'Default to current month' can't show monthly data until the month ends", and "Format
  module gaps".
- Record in `ARCHITECTURE.md`: per-entry-type resolutions in the catalog, the region resolver
  and its dependence on step 3 region codes, the inline worker's `worker-src blob:` need, and
  the visibility capability on the platform adapter.
- Add to `DEFERRED.md`: an optional calibration/processor field on layers (revisit when
  researchers ask for uncalibrated data), and the SDK's zone-less raw-entry bounds (fix in
  sdk-js with the step 3 work; affects monitor-map and mobile too).
- Anything else deferred while building goes into `DEFERRED.md` with why and a revisit
  trigger.

## Done when

- `npm run lint`, `check`, `test`, and `build` pass; CI is green on the stacked PR, including
  the existing three-engine E2E.
- The dev page shows live monitor data through the new layer against the local stack, as in
  the manual check above.
- The production build contains no dev page, no stand-in catalog, and stays within the
  initial bundle budget (the worker and adapter code load lazily).
- No hardcoded data descriptions, browser-zone dates, or direct browser calls the platform
  adapter owns.

## Settled after the builder check

All _my calls_ unless noted.

- **Which data series: always the published series.** The server's endpoints default to
  different series: one monitor's summaries return the uncalibrated series unless a
  `processor` is named; bulk summaries return each monitor type's published series (e.g.
  EPA-calibrated PM2.5 for PurpleAir); raw entries return each monitor's default stage. The
  adapter always asks for the **published series**, the same one sjvair.com's map shows: for a
  single monitor it passes the processor named by its type's `default_calibration` in
  `monitors/meta/` (the monitor's type comes from the cached monitors list, so this adds no
  per-query request). Raw, summaries, and filled-in periods therefore never mix series. The
  result reports the series used. **No calibration field in `QueryDescriptor`**; an optional
  one can be added later without a migration if researchers ask for uncalibrated data
  (recorded in `DEFERRED.md`).
- **Selections return one series per place**, never a combined series (region averages are
  the server's job, through region summaries). **"Whole layer" (no place, no selection)** is
  supported only at summary resolutions, through the bulk monitor endpoint, which isn't
  scoped by region. At raw resolution there's no bulk endpoint, so a whole-layer raw query is
  `unavailable` (maps show current conditions through a "now" path in step 5, not raw
  history). Selections have a size cap (_builder's call_, generous), enforced by the schema.
- **Raw-entry time windows: worked around in the adapter, not fixed in the SDK now.**
  `getMonitorEntries` formats its bounds as date-times without a zone in the **browser's**
  local time, and the server reads zone-less times as Pacific, so the window is off by hours
  for viewers outside Pacific time. The SDK also throws when a bound is later than now. The
  adapter therefore pads the requested window by a day on each side, clamps the end to now,
  and keeps only entries whose own timestamps (which carry offsets) fall inside the Pacific
  window. The proper SDK fix (send zone-aware bounds) is recorded in `DEFERRED.md`, to ride
  along with the step 3 sdk-js work and its release (which needs the user's approval like
  any release). This bug also affects monitor-map's and mobile's raw-entry calls for viewers
  outside Pacific time; the `DEFERRED.md` entry says so.
- **`timeSubRange` is both dates or both instants:** `{ start, end }` as two Pacific
  `YYYY-MM-DD` dates (a calendar's day range) or two ISO date-times with offsets (a chart
  selection). In spec 2 it only filters fetched data; it doesn't change the resolution or the
  cache key. Spec 4 (staging) may refine this before `schemaVersion` 1 is frozen.
- **In production, every query reports `unavailable` until the server catalog exists.** With
  no catalog, no dataset is offered and no resolutions are known. That's intended: spec 2
  ships no product UI, and step 4 (the first real data on screen) waits for the step 3
  catalog. **Consequence:** if the metadata track slips, step 4 waits on it; no hardcoded
  fallback is added.

## Left to the builder

Anything marked _builder's call_ above, plus: module layout under `src/lib/` (e.g.
`src/lib/data/`); the query layer's API shape (a runes class, a function returning a reactive
object, or a Svelte attachment); the time-series data shape; cache eviction; chunk sizes and
concurrency; exact poll timings within the stated cadences; message wording; test
organization.

## Branching

This spec is committed on `foundations`. Implementation goes on a branch stacked on it (e.g.
`foundations-2-data`), with a PR into `foundations`. `foundations` merges into `main` only with
the user's explicit approval.
