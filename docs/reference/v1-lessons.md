# What the v1 code learned about server behavior

The v1 Monitors tab (Svelte 5, `sv-router`, the `@sjvair/monitor-map` embed) was removed in
Foundations spec 1. This note keeps what its code, comments, and 78 unit tests learned about
how the SJVAir server and map behave, written as behaviors rather than code. Nothing here is
a design decision; `ARCHITECTURE.md` makes those. Where a finding is already tracked, it is
cross-referenced to `DEFERRED.md`.

Sources: `src/lib/monitors/*`, `src/routes/monitors/*`, `src/routes/MonitorsTab.svelte`,
`src/lib/{calendar,preferences,url-state}.ts`, `src/lib/components/*`, and the v1
specs and plans in `docs/superpowers/{specs,plans}/2026-09-1*`.

## Server behavior

- **Monthly and longer rollups exist only after the period ends.** A scheduled task computes
  each level (hourly, daily, monthly, quarterly, seasonal, yearly) once, at the start of the
  next period. The in-progress month never has a monthly summary row, in production too.
  v1 defaulted to "current month, monthly resolution" and so opened empty. The new data layer
  answers this with incomplete-period stitching (`DEFERRED.md` → "Legacy Monitors-tab
  follow-ups").
- **A local dev server often has no rollups even for finished months.** The periodic tasks
  only fire if the worker happens to be running at that cron instant. Compare a summaries
  endpoint with the raw `current/` endpoint to tell "no rollups" from "no data". Backfilling
  with the server's `rebuild_summaries` command works, but always scope it by region or
  monitor and date range.
- **Raw entries default to the monitor type's default stage, not the published series.** With
  no `processor` or `stage`, `monitors/<id>/entries/<entry_type>` returns e.g. the `cleaned`
  stage for PurpleAir, while summaries and the map use the default calibration. Measured on the
  dev server (2026-10-22, one PurpleAir PM2.5 hour): cleaned mean 4.83 vs. the published hourly
  summary 0.0563 (`PM25_EPA_Oct2021`); raw fetched with `?processor=PM25_EPA_Oct2021` matched
  the summary exactly. Pass `processor` to get the published series. Send zone-aware bounds
  (e.g. UTC ISO): zone-less `timestamp__*` values are read as Pacific, and one inside the
  repeated fall-back hour is ambiguous, so the server silently drops that filter (no 400) and
  returns everything on the other side of the remaining bound. Also note the server's
  `pm10` entry type is PM1.0; PM10 is `pm100`.
- **Bulk summary endpoints omit a region or monitor that has zero matching rows**, rather than
  returning it with an empty list. Treat absence as "no data" and remember it, or the same
  data-less id is refetched on every refresh.
- **The bulk monitor summaries endpoint is not scoped by region.** v1 asked for every
  published monitor for a pollutant and date range, then filtered client-side. A region
  toggle therefore never needed a new fetch; only a pollutant or date change did.
- **Bulk region summaries take a repeatable `region` parameter, and require `start` and
  `end`.** A span that is too large is rejected with a 400. v1 used the daily resolution for
  the calendar (one row per day) and the monthly resolution, with `start` and `end` both set
  to the first of the month, for the map fill.
- **Summary rows carry a timestamp whose first 10 characters are the date** (`yyyy-MM-dd`).
  v1 compared on that prefix, and defensively filtered returned rows back to the requested
  range. Monthly rows were matched on the first 7 characters (`yyyy-MM`).
- **A month average for a monitor is the plain mean of its in-range rows.** A monitor with no
  in-range rows has no average and is left out, not shown as zero.
- **Region ids are unique across all region types** (one table, one id per row), so caches
  keyed by region id stay valid when the user switches the parent type.
- **Entry-type metadata supplies the level list** (name, label, color, range, guidance). A
  value is bucketed by finding the level whose inclusive range contains it. Ranges are
  inclusive on both ends, so a value in no range (in a gap between adjacent levels, such as
  between the test fixture's 9 and 9.1, or beyond the last) has no level and no color.
- **Monitor positions are GeoJSON points** (`longitude, latitude`), and may be null.
- **Sizes and timings measured on the dev server:**
  - A regions list that includes full boundary geometry is slow. Narrowing to a large
    `within=` selection took about 1.7 s with geometry; without it the list is fast.
  - A county's boundary can have around 9,600 vertices.
  - The `land_use` list never responded (hung past 60 s); `mtrs` responded after about 12 s.
  - Eight region-type list fetches in parallel can take several seconds in total.

## Regions

- **Boundaries are large, so list responses omit geometry and keep only `bbox`.** The bounding
  box is enough for pickers and for fitting the map. Full geometry (needed for the map fill
  and for point-in-region tests) is fetched per region, only once that region is selected,
  and kept for the rest of the session. Boundaries are static and a user selects a handful at
  a time, so eviction was not worth it.
- **Concurrent boundary fetches for the same region are deduped.** The first selection (all
  counties seeded at startup) raced the map refresh, which asks for the same boundaries a
  moment later. A map of in-flight requests keyed by region id lets every caller await the
  same fetch. Because the cache is only filled when a fetch completes, it cannot do this job
  alone. A failed fetch leaves the region selected with its bbox-only boundary (only the fill
  polygon and point-in-region filtering are affected) and clears the in-flight entry so a
  later call retries.
- **Anything that depends on full geometry must first ensure the geometry is loaded.** A
  region selected moments ago looks empty to the monitor filter until its boundary arrives.
  v1 computed "latest" for the map as empty in that window, and nothing re-triggered it. The
  fix was one central "ensure every selected region has its boundary" step before the monitor
  computation, rather than relying on each selection call site to remember.
- **Single-parent narrowing.** An earlier many-to-many model (any type could narrow, or be
  narrowed by, any other) lost selections when the user switched types and left the "show
  all" escape hatch unreliable. It was replaced by exactly one parent type (default `county`)
  that always narrows, and the other types are children. The parent's selection defaults to
  all counties on first load, and starts empty for any other parent type.
- **Child lists are fetched narrowed by the parent selection** (the `within` parameter,
  repeatable, taking the union of the selected parent ids; no selection means no narrowing)
  for every child type in parallel, re-fetched whenever the parent selection changes.
- **A child selection can only shrink when the parent selection changes.** After each
  re-fetch, each child type's selection is pruned to the ids still in its narrowed list.
  Pruning must finish before the map and calendar refresh if any child type has a selection
  (otherwise a now-out-of-scope region flashes), and may run concurrently when none does.
- **Child selections are independent of each other.** Checking a city never touches the zip
  code list or selection.
- **Switching the parent type clears all selections and the child lists**, then reseeds.
  A stale param for the current parent type can be left in the URL from when it was a child
  type, and must be deleted explicitly.
- **Child-type filtering by category.** The server's region meta reports all 15 region types,
  but v1 offered only three categories (`administrative`, `census`, `district`), which was 9
  types. The rest (`urban_area`, `land_use`, `protected`, `place`, `mtrs`, `custom`) were out
  of scope, and `land_use` and `mtrs` were unsafe: one slow type in the parallel child fetch
  stalls the whole refresh behind it. The child types are every in-scope type except the
  current parent (8 once the meta has loaded). `land_use` (about 66k rows) and `mtrs` (about
  28k rows) are too large to list or browse flat; browsing them needs a "progressive unlock"
  after narrowing to a small area (`DEFERRED.md` → "Map & selection"). The `place` type has
  since been removed from the server.
- **Selected regions with no average get a black border and no fill.** A selected region whose
  month average is missing or matches no level is drawn with a plain black outline and zero
  fill opacity, so it reads as "selected but no data" rather than invisible. Its hover
  tooltip shows the name and a "no data for this month" line, with no value box. Regions with
  a level get a 35% opaque fill and a full-opacity border of the same color.
- **Nothing selected means no fill and no fetch.** The fill state is cleared and the monthly
  fetch is skipped, even when the parent list is loaded. With no selection the map fits to
  the whole parent list.
- **Selection state must stay reactive in the browser.** Maps of selections that are updated
  with `.set()` on one long-lived instance need Svelte's reactive map; a plain `Map` inside
  `$state` is not tracked. Sets that are rebuilt and reassigned each time may stay plain.
- **Point-in-region tests are expensive.** Running them through Svelte's reactive proxy
  measured about 44 times slower (a stall near 10 s versus about 200 ms) than on a plain
  snapshot of the same data. Snapshot once per recompute.
- **Pruned/narrowed lists can be empty.** A narrowing that yields zero regions (for example a
  school district with no matching children) is a normal state, not an error.

## Map

- **Globe-projection zoom precision.** When fitting bounds on the globe projection, large
  counties are under-zoomed (the camera stops short of filling the view). This was left
  open in v1; it is tracked in `DEFERRED.md` → "Map & selection" and should be revisited
  when the map widget is built on `map-sdk`.
- **Bounds passed to the map must be plain arrays.** Reading a bounding box off reactive
  state hands back a proxy that MapLibre's bounds parsing mishandles; unwrap it first. The
  server's bbox type is also looser than the four numbers it always sends.
- **Fit to the union of the selected regions' bounds**, or to the whole parent list when
  nothing is selected. Re-run it when the selection changes and also when the map becomes
  ready, so it corrects itself if the selection was set first.
- **A host-driven layout change needs an explicit map resize.** The embedded map only resized
  for its own panel transitions, so when the surrounding layout grew or shrank, the canvas
  kept stale dimensions and drew against the wrong bounds. Observe the wrapper and call resize.
- **The embedded map library constructs a default integration on import**, and it collides on
  the same layer id with one the host creates. Settings (such as clustering and tooltips off)
  must be applied to both. This was a one-map-per-page singleton limitation and goes away with
  `map-sdk`.
- **Region polygons are drawn as a separate source and fill+line layers**, fed with the
  selected regions' full geometry plus a per-feature color and a "has a value" flag.

## Loading states

- **Year and month showed 0 or blank during initial load.** Startup awaited the child-type
  region fetches before the date range was set, adding one to two seconds in which the
  selects had no value. Startup must not wait on child-list fetches; set the date range and
  pollutant first, then fetch children alongside the map and calendar.
- **Map and calendar updates must not block on child-list refetches.** When the parent type or
  selection changes, the eight parallel child fetches can take several seconds, and nothing
  displayed depends on them unless a child selection might be pruned (see Regions). Run the
  child refetch concurrently with the map average, calendar, and fill refreshes.
- **Last request wins.** Every refresh (parent list, children, map averages, calendar, fill)
  took a monotonically increasing token and discarded its result if a newer call had started.
  Without that, rapid filter changes let the last response to finish win, not the last request
  made (`DEFERRED.md` → "No in-flight request coordination").
- **Memoize fetched summaries so toggling a region fetches only what is new.** Deselecting
  never needs the network. Keys combine pollutant, date range (or month), and region id; stale
  keys are simply never read again, so unbounded growth was not a concern in a session.
- **Failures are shown, not thrown.** A failed regions fetch clears the list and shows an
  error. A failed summary fetch clears that view and suggests a narrower range or fewer
  regions, since the likely cause is a request that is too large.
- **Fetching the whole year for a month view is wasteful.** The `month` parameter exists on
  the summary endpoints but v1 did not use it (`DEFERRED.md` → "Whole-year over-fetch").

## Edge cases the tests encode

All 78 tests, grouped by file. Each bullet is one distinct behavior.

### `src/lib/calendar.test.ts` (8)

- A level is found by the range that contains the value; a value in no range has no level.
- A calendar has one entry per day in the range, colored by level; a day without a value has
  a null value and no color.
- Without level metadata, days keep their values but get no color.
- A range of exactly 1,826 days (about five years) succeeds.
- A range one day over that limit throws, with the requested and maximum day counts in the
  message.
- A reversed range (start after end) is normalized to ascending order instead of misbehaving.
- Days are grouped by their `yyyy-MM` prefix, so a range crossing a month boundary gives one
  group per month with the right day counts.

### `src/lib/monitors/monitor-latest.test.ts` (2)

- A monitor with an average becomes a "latest" entry whose value is the number as a string,
  with the pollutant as its entry type.
- A monitor with no average is skipped, not zero-filled.

### `src/lib/monitors/region-bounds.test.ts` (4)

- An empty list of bounds gives no bounds.
- A single box returns unchanged.
- Several boxes union to the smallest enclosing box.
- Boxes that do not overlap still union correctly.

### `src/lib/monitors/region-fill.test.ts` (4)

- Each region's mean is bucketed to its level's color.
- A mean matching no level leaves the region out of the color map.
- With no level metadata the result is empty.
- Empty input gives an empty result.

### `src/lib/monitors/region-narrowing.test.ts` (5)

- Pruning keeps only the selected ids still available.
- Nothing available gives an empty selection.
- Everything available leaves the selection unchanged.
- An empty selection stays empty.
- The result is a new set, never the input object (so reassigning it triggers reactivity).

### `src/lib/monitors/region-scoping.test.ts` (5)

- A monitor inside a region's polygon is in scope.
- A monitor outside every region is not.
- A monitor with no position is not in scope.
- A region with no boundary geometry is skipped rather than throwing.
- A monitor inside any one of several regions is in scope.

### `src/routes/monitors/monitors-tab-region-fill.test.ts` (1)

- With regions loaded but none selected, the fill is cleared and the bulk monthly summaries
  fetch is not made.

### `src/routes/monitors/monitors-tab.svelte.test.ts` (5)

- The per-type child selection map is a reactive map, because plain-map mutation is not
  tracked in the browser.
- Toggling a child region adds it to that type's selection, and toggling again removes it.
- The selected regions are the parent selection plus every child type's selection, with no
  duplicates.
- A selected region lacking geometry gets its cached full boundary overlaid.
- Before the cache is populated, the list-provided (bbox-only) boundary is used.

The test comment also records a tooling constraint: Vitest's SSR transform compiles `$effect`
to a no-op, so effect-driven reactivity cannot be tested without a DOM environment. The new
test setup (browser-mode component tests) removes that limit.

### `src/lib/preferences.test.ts` (8)

Preferences were localStorage defaults that seed the URL. They are removed, not migrated; the
behaviors are kept for the platform adapter's storage wrapper.

- A tab with nothing stored gives an empty object.
- Stored preferences round-trip.
- Different tabs' preferences are independent.
- A partial update merges into, rather than replaces, the tab's preferences.
- Clearing removes everything.
- Corrupted JSON in storage is ignored instead of throwing.
- A stored value of the wrong shape (the tabs entry is not an object) is ignored.
- If localStorage does not exist, reads give empty, and writes and clears do not throw.
  Write failures such as quota exceeded or private-browsing restrictions are swallowed too.

### `src/lib/url-state.test.ts` (36)

These were URL codecs. The router coerces numeric-looking query values to numbers, which is
the root of several cases. Only the rules worth keeping are listed.

- Date range: encodes as `start..end`; round-trips. Null, undefined, an empty string, and a
  value with no separator all decode to "no range".
- Views: a comma-separated list of enabled views; round-trips. Null or undefined decode to
  "no param". An empty string means all views off, and no enabled views encodes as an empty
  string. Unknown keys are ignored.
- Pollutant: only `pm25` and `o3` decode; anything else, null, or undefined gives none.
- Year: a four-digit number or numeric string decodes; a non-numeric string, an empty string,
  a non-four-digit number, a boolean, null, and undefined all give none. A number and its
  string form decode the same (the router hands over numbers, so a string-only check
  silently rejected every real URL).
- Month: an integer 1 to 12 decodes, as a number or a string; out of range, non-numeric,
  boolean, null, and undefined give none.
- Region type: any non-empty string round-trips; null, undefined, and an empty string give
  none.
- Region selection: ids encode as a comma-separated list, from a set or an array, and round
  trip; null, undefined, and an empty string give an empty set; stray commas do not produce
  empty entries.
