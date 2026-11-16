# Release 1, step 5, spec 4: the Map's days and region fills

Status: brainstormed with the user 2026-11-15, on `step-5-spec-4` (from `step-5` at 9d4b460).
Checked by a fresh builder read: two questions for the user (the Now fill's data; the no-figure
look and the legend), the rest settled as my calls below, and five contradictions with the code
fixed. **Approved by the user 2026-11-15.**

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's
(this brainstorm, or earlier ones recorded in `ARCHITECTURE.md` → "Map SDK").

## Where this sits

Step 5 is the Map widget, on the `step-5` branch; each spec branches from it and opens a PR into
it, and `step-5` merges into `main` once, at the end, with the user's yes. Specs 1 (#53), 2 (#56)
and 3 (#57) are merged into `step-5`.

1. The widget core. Done.
2. The Map's data per tile, marks, focus area. Done.
3. The options toolbar, Settings, viewer changes. Done.
4. **This spec:** a Map that steps through the days of a date range, and region fills.
5. Pesticide use by section and township, and spray notices.
6. "Show in a chart/table" from a map's marks.

**Working rule (`CLAUDE.md` → "Repo workflow"):** build straight toward step 5's final design. No
stop-gap UI between specs; tests green, every other widget working, saved documents opening
without errors. Specs 5 and 6 add to what this spec builds; they don't replace it.

## Why

The Map shows only "now". The people the dashboard serves (`project-dashboard-audience`: parents,
teachers and students, researchers, agencies) also ask **"what was it like that day?"**: the smoky
week in September, the day of a fire, the day a class was kept inside. They want the valley as it
looked on that day, and to step day by day to watch it change, with smoke and fire for the same
day. That is also the user's "shade the area by each day's values" idea (`DEFERRED.md` → "A heatmap
layer over the map, of daily values"), done with monitors and region shapes rather than a smooth
surface.

Region fills show the area's figure next to what was measured: each ZIP, county or tract shaded by
its level, with the monitors on top, so a fill is explained by the monitors in it.

## Goals

- A Map tile shows **"Now"** (as today) or a **date range** whose days it steps through, one day
  at a time, with each scale's daily figure.
- A range that includes today ends in a **"Now" stop** with the live readings.
- The day stepped to is saved with the tile; viewers step for themselves.
- **Region fills** of one region type per tile (tracts included), drawn under the monitors, on the
  day showing or now.
- Smoke and fire follow the day showing.
- A general **snapshot query** in the data layer (one figure per place, for one day or now) that
  later data sets reuse.

## Non-goals

- **One figure per place for the whole range** ("where was it worst over the period": a count of
  bad days, an average). Deferred (see "`DEFERRED.md` changes").
- A smooth interpolated heatmap between monitors. Stays deferred.
- Marking regions. Only monitors can be marked, as now.
- Hourly stepping within a day, or any resolution choice: a Map's days are daily figures.
- A Map in Analysis (`analyzable` stays false).
- Schools, pesticides, spray notices (spec 5) and "Show in a chart" from marks (spec 6).

## Anti-goals

- Loading a whole range at once (a year of daily ZIP figures is about 515 pages of rows).
- Implying a fill is live: on "Now" a fill shows **today's daily figure so far** (the server's open
  days, built from hourly region rows, which land about one to two hours behind live readings).
  It is always labelled "today so far".
- Hardcoded region types, labels, levels, colors or daily figures: all from the metadata.
- Conveying a level by color alone; a region with no figure looking broken rather than "no data".
- Batching region ids in the dashboard to dodge request limits (the server gains a whole-type
  scope instead; see Part 4).

## Constraints

- Pins: `@sjvair/sdk` moves from `5.0.0-beta.10` to the beta that adds the whole-type region
  scope (Part 4); `@sjvair/map-sdk` moves from `0.1.0-beta.13` to the beta with the no-figure
  regions and shared legend section (Part 4), which also brings `0.1.0-beta.14`'s `layoutRoot`
  (unused here). Each is an exact pin.
- Map code stays in the lazy map chunk; report the initial bundle against the 250 KB soft budget
  (212.6 KB before this spec).
- Svelte 5 runes, Paraglide (no concatenated sentences; `sentence_join` for folding sentences),
  theme tokens only, Pacific time through `format` with Sunday weeks, WCAG 2.2 AA with standard
  patterns, location privacy (no coordinates in URLs, logs or reports).
- The three place-handling spots stay wired for the Map (`src/lib/sharing/points.ts`,
  `PlacePickerDialog`'s `regionOf`, Get data's `src/lib/get-data/now.ts`), with range-side
  equivalents where a ranged Map needs them.
- Nothing in map-sdk, monitor-map, mobile, sdk-js or sjvair.com changes from this repo. The server
  scope, the SDK beta and the map-sdk beta come through the coordinator, each specced in its own
  repo.

## Approaches

**How a day's data loads** (the user picked A, as a general data-layer piece):

- **A. A snapshot query: one figure per place for one day or now, cached through the now client.**
  Each day is an entry keyed by dataset, pollutant, region type (or monitors) and date. Fits how
  the Map already loads (`src/lib/data/now/client.ts`), each request is a page or a few, and it
  avoids the range client's whole-layer backfill gaps. The calendars' day rules move into the data
  layer and are shared, so nothing is re-implemented. Later snapshots reuse it: spec 5's pesticide
  figures per section and township, the deferred period summary, a heatmap.
- **B. The range client, asked for one day of every monitor.** Brings the final-day handling, but
  that client is built around a series per place: whole-layer queries hit `DEFERRED.md` →
  "Whole-layer backfill gaps", and one client would do two jobs. Spec 6's series for marked
  monitors stays with the range client, which does that well.
- **Ruled out:** loading the whole range up front (size, above).

**Census tracts** (the user picked A): **A.** the server gains a whole-type scope on bulk region
summaries, and tracts are in; **B.** leave tracts out; **C.** split ids into batches in the
dashboard (a workaround). Measured on the local stack (2026-11-15, PM2.5 daily): listing every
tract id exceeds Django's 1,000-field cap (and likely production's URL limit). On a day with data
about a third of tracts have a figure (330–362 of 978), about 60% of ZIPs and cities, all
counties; a region with no monitor inside never gets one (`camp/apps/summaries/tasks.py:134`).

**Fills and monitors** (the user picked A): **A.** fills under the monitors on one tile; **B.** a
tile shows monitors or regions, not both. A explains each fill by the monitors in it.

**Today** (the user picked the "Now" stop): a range that includes today ends in a "Now" stop with
live readings, rather than today's daily figure so far.

**A fill on Now** (the user picked C): **A.** a server hour filter on bulk hourly region
summaries, for the latest hour; **B.** today's hourly rows as they are (20 to 50 pages an hour,
since the bulk endpoints filter by date only); **C.** the server's open-day row, today's figure so
far, one row per region. C is the server's own rolling figure for regions and matches the
calendars' "today so far"; early in the day it covers few hours, so it is labelled.

**A region with no figure, and the legend** (the user picked B): **A.** map-sdk's look as it is
(a gray "No level" fill, two legend sections for one pollutant); **B.** a map-sdk change for
outline-only no-figure regions and one shared section. On a typical day about 40% of ZIPs have no
figure, so A's gray could read as smoke or a level.

**The day saved** (the user picked A): **A.** saved with the tile, viewers step for themselves;
**B.** not saved, like the camera. A lets an owner share "look at September 9".

## Part 0: first, spec 3's leftovers

Do the four items in `DEFERRED.md` → "Step 5 spec 3 review leftovers" → "Do at the start of spec
4", then remove them from that entry:

1. The hidden-marks note's `pollutant: entryLabel ?? ""` would read "doesn't report " with no
   name: fall back to the "aren't shown" line (`MapWidget.svelte:483`).
2. The fire tint is 2.9998:1 on a hovered row (the light `--accent`): darken `--map-icon-fire`'s
   light value one step in `src/app.css` (`:root` only; the dark blocks stay identical to each
   other), and add the hovered surface to `src/lib/theme/contrast.test.ts`.
3. The hidden-marks reasons read "isn't shown" briefly while the metadata loads: hold the note
   until the monitors lookup settles (still "aren't shown" if it fails).
4. `activeFilters`' optional `defaults` (`src/lib/widgets/map/toolbar/values.ts`) falls back
   silently when a caller forgets it: make it required.

## Part 1: the snapshot query (data layer)

- **What it is (my call on the shape):** in `src/lib/data/` (a new `snapshot/` folder), a query
  for one figure per place of a whole layer: input `{ dataset: "air-quality", entryType, places:
  "monitors" | { regionType }, scope?, at: "now" | { day: "YYYY-MM-DD" } }`, output a map from the
  place (monitor id, or region `type:code`) to `{ value, level, kind, final }`. `scope` narrows
  monitors to the tile's places (region ids for the server's `region` filter, or monitor ids
  filtered client-side), as `monitorScope` does today.
- **Days:** the bulk daily summaries (`getMonitorSummariesBulkDaily`,
  `getRegionSummariesBulkDaily`) for that one Pacific day, reading the field each scale's
  `daily_statistic` names. **The day rules move** from `src/lib/calendars/day-state.ts` into the
  data layer, and the calendars and the Map share them: rated, "Not enough data" (null), "Not
  final yet" (`is_final: false`), and "unrated" when the scale has no `daily_statistic` (said once,
  never a fallback to the mean). The calendars' behaviour doesn't change; the move touches about
  ten calendar files (`DayGrid`, `MonthGrid`, `WeekGrid`, `CalendarLegend`, `CalendarShell`,
  `calendar-data`, `day-label`, `summary` and their tests), whose tests stay green.
- **Now:** monitors keep their live readings (the existing monitors entry). Regions use **today's
  open-day row** (`/regions/<entry_type>/summaries/daily/open/`, the SDK's
  `getRegionSummariesBulkDailyOpen`, with the whole-type scope): today's daily figure so far,
  built by the server from the stored hourly rows, one row per region, no dates (the user,
  2026-11-15). The open endpoint can also return yesterday's row until the nightly rollup settles;
  the Now fill reads today's only.
- **Caching and polling** go through the now client's shared cache: a day is fetched once; **a day
  whose figures aren't all final polls hourly while shown** (this covers yesterday's late hours
  and today's partial day if ever shown), and a final day never polls (my call). Regions on "now"
  poll on the `"hour"` cadence; live monitors keep `"raw"` (3 minutes).
- **Whole types:** a region type is fetched with the server's new whole-type scope (Part 4), never
  an id list. Region geometry for a whole type uses `getRegionsGeoJSON` with `simplify` where the
  server offers it (county, ZIP, tract), cached page-wide with the existing outline cache in
  `src/lib/widgets/map/regions.ts` (my call: extend it to whole types rather than add a second
  cache).
- **Bundle:** the snapshot code is imported only by lazy chunks (map, calendars); it never joins
  the initial bundle.

## Part 2: the Map's time

### The contract (my call on the shape)

The widget contract's `time` is one of `"range" | "now" | "none"`; the Map needs both. The Map
becomes `time: "range"` with a new optional `now: true` on `WidgetType`: a type that offers "Now"
as a When choice, where a missing `dateRange` means Now. With it: `resolution: "day"` (no
resolution choice), `span: { minDays: 1, maxDays: 366 }` (as the Month calendar), every date
method, and no `defaultRange` (a new Map, and one added directly through `addable`, is Now).
`analyzable` stays false.

Every place that branches on `time === "now"` decides whether it means "a now type" or "showing
now" and reads the `now` flag and the missing `dateRange` accordingly; the builder check found
`src/lib/sharing/points.ts:87`, `src/lib/places/PlacePickerDialog.svelte:296`,
`src/lib/get-data/map.ts:176`, `src/lib/get-data/now.ts:157,210`,
`src/lib/get-data/GetDataView.svelte:154,179,435,479,485,521` and
`src/lib/thresholds/watched.ts:10` (re-check with a search when planning).

### Get data

- **When** for a Map offers **Now** plus the usual date methods (set, to-date, trailing, custom).
  Now is the default.
- **What** gains **"Fill regions by"**: None (the default) or one of the region types the server's
  regions meta offers. No meta field lists "types with summaries" (the server summarizes any
  region with a monitor inside), so **(my call)** the rule is the place directory's:
  `browsable && count > 0` (`src/lib/places/directory.ts:122`), which leaves out `mtrs` (not
  browsable). Types without `simplify` (city, school district and the rest) load unsimplified;
  measured locally, the largest is school districts at 0.79 MB gzip, fetched once per page.
- **Show as** from a Map carries its pollutant, places and range to a range type; a Map on Now
  converts as today (the target's default range). The fill and the stepped day drop; the fill
  gets a note, as marks do. Into a Map, a range type's range is kept (within the Map's 366-day
  span; a longer one is cut to its last 366 days, with a note) and its `timeSubRange` dropped (my
  call). `isMapShaped` stops treating a date range as non-Map.
- `fromMapDraft` / `mapShowingOnly` / `toMapDraft` and the place-handling spots keep working for a
  ranged Map: the places and their privacy rules don't change with the range.

### The day stepper

- **A strip under the map, inside the tile** (never over the map or the toolbar), shown only for a
  range:

  ```
  ┌───────────────────────────────────┐
  │ [toolbar]                         │
  │              map                  │
  ├───────────────────────────────────┤
  │ ◀  Tue, Sep 9, 2026  ━━━●━━━━━  ▶ │
  └───────────────────────────────────┘
  ```

- **Stops:** each day of the range up to today. Days after today aren't stops. A range that
  includes today ends in a **"Now"** stop. The strip names the day (through `format`), and shows
  "Not final yet" beside it when the day's figures aren't final (my call: once for the day, not
  per monitor).
- **Controls (standard slider pattern):** Previous and Next buttons; a slider (bits-ui's, through
  shadcn-svelte) with Left/Right and Up/Down one day, Page Up/Down one week, Home/End the first
  and last stop, and `aria-valuetext` the day's name ("Now" for the Now stop). The buttons are the
  drag's keyboard and pointer alternative. On a narrow tile the slider drops out, leaving the
  buttons and the date (my call on the width: match the toolbar's narrow breakpoint, 48rem).
- **Opens on:** the saved day; with none, the last stop (Now for a range that includes today).
- **Fetching ahead:** the neighbouring days are fetched ahead so stepping is instant (my call:
  one day each side).
- **Motion:** changing day doesn't animate the camera; any transition respects
  `prefers-reduced-motion`.

### The saved day

- **An option, `day`** (a Pacific date key) in `MapOptionsSchema`. **Missing means the last
  stop**, and stepping to the last stop stores it as missing (the spec 3 rule: a default is never
  written). So a rolling "last 7 days" range keeps opening on its newest day.
- **A saved day outside the range** (a rolling range moved on, or the range edited) opens on the
  last stop and is left as saved until the next step (my call: never written on open).
- **Viewers step for themselves** through the tile-options layer
  (`src/lib/widgets/shared/tile-options.svelte.ts`): on a read-only view a step changes only that
  viewer's in-memory `ViewerChanges`, never the document; stepping to the last stop is held as
  missing (`set(id, { day: undefined })`). "Make a copy" keeps the viewer's changes, as with the
  toolbar's options.
- **One undo step per run of steps (my call on the mechanism):** the first step of a run is an
  ordinary change; later steps within about a second of the last, or during one slider drag,
  `amend` it (the document session's existing "saved, not its own undo step"). The builder checks
  that Undo restores the day from before the run and Redo the run's last day; if `amend` can't
  give that, say so before building another way.
- **Not a toolbar key:** Reset Map Options doesn't clear the day (my call).

### Refresh

- A past-only range loads its days as they are shown and polls only days that aren't final yet
  (Part 1). It resolves `DEFERRED.md` → "The Map refreshes only when its date range includes
  today".
- The Now stop (and a Map on Now) refreshes as today: live monitors every 3 minutes, smoke and fire
  hourly, a fill hourly.
- The data layer's pause while the page is hidden, and the map's on-screen rule, apply as now.

## Part 3: what a day shows

- **Monitors:** each monitor's daily figure for the day, from the monitors in the places as today
  (`scope.ts`). The monitor's name, position, type and location come from the monitors list, as
  now. **(my call, following the shared day rules)**:
  - A monitor with **no row** for the day (`none`) isn't drawn; a hidden mark gets the reason
    below.
  - A monitor with a row but **no figure** (`thin`, "Not enough data") is drawn with no level and
    reads "Not enough data": it was reporting, just not enough to rate.
  - A pollutant whose scale has **no `daily_statistic`** (`unrated`) draws its monitors with no
    level on day stops and says once, in the map's notes, that its days can't be rated (the
    calendars' rule; never a fallback to the mean). Every pollutant the Map draws today has one.
- **Toolbar on a day (my call):** the Inactive row isn't offered on a day stop (a monitor with a
  figure that day was reporting), so by the spec 3 rule ("a saved value applies only while its row
  is offered") the Inactive choice doesn't filter there. Inside and the type rows apply as on Now.
  The Monitors group's "appears only with a choice" rule reads the day's monitors.
- **Smoke and fire** show the day's (`getHMSSmoke` / `getHMSFire` with `{ date }`), with the
  existing Fire & Smoke row.
- **Marks:** a hidden mark gains a reason line, "has no figure for this day" (one Paraglide message,
  folded with the others through `sentence_join`). The note's other reasons are unchanged.
- **The tooltip, list row and accessible name** of a monitor on a day give the day's figure name
  (`daily_statistic_label`), value, unit and level, and "Not final yet" when it applies (my call:
  through map-sdk's existing item text; if it has no slot for the figure name, tell the coordinator
  rather than work around it).

## Part 4: region fills

- **Held (my call on the shape):** the region type is a Map option, `fill` (a region type id),
  written by Get data's "Fill regions by", not a layer: a fill has no pollutant of its own (it
  follows `showing`), and a layer would cut the Map's pollutant cap from 6 to 5. It is not a
  viewer change (it is what the tile holds). `fill` is validated against the metadata's region
  types when drawn: an unknown type draws no fill and the toolbar offers no fill row, and nothing
  is written (fallbacks are drawn, not saved; the value applies again if the type returns).
- **Shown:** a Layers row (the dashboard's own, shaped like `hmsOptions(map).row`) shows or hides
  the fill without unloading it, saved as `fillShown` (missing: shown; shown is never written, so
  only `false` is stored), a toolbar key cleared by Reset. **Layers appears** when the tile has a fill or smoke and fire.
- **Drawn:** map-sdk's `regionsPlugin` over the whole valley, under the monitors and the focus area
  (`addPlugin(…, { before })`), with `selectable: false` (regions can't be marked). Its source's
  features have `refKey` `region:<type>:<external_id>` and the scale `{ dataset: "air-quality",
  entryType: <showing> }`. The fill goes under the focus area, so outside the places the focus
  area's wash dims it (the monitors and smoke and fire draw over the focus area and aren't dimmed,
  as today).
- **The day's figure,** or on Now today's figure so far. **Its time is labelled:** on Now the
  fill's layer label says so ("ZIP codes, today so far", one Paraglide message with the region
  type's label; my call); on a day it is the day's figure like the monitors.
- **A region with no figure** is drawn **outlined with no fill** and reads "No data" (the user
  picked this over map-sdk's current gray "No level" fill, 2026-11-15).
- **Legend:** **one section** for the pollutant showing serves both monitors and fill, plus a
  no-figure entry; levels always with their names, swatches outlined.
- **Both need map-sdk** (the user, 2026-11-15): today `shapesPlugin` fills a null value with the
  neutral color (`shapes.svelte.ts`, `style.ts`), `regionsPlugin` passes no `fillOpacity` or
  `outline` through, and `Legend` draws one section per plugin with a scale, so monitors plus a
  fill give two sections for one pollutant, with no no-figure entry. The coordinator arranges a
  map-sdk change (its spec in map-sdk) and a `@sjvair/map-sdk` beta; this spec moves the pin.
  The fill waits on that beta as well as on the SDK's.
- **Card:** clicking a region shows map-sdk's card or tooltip (name, figure, level); no Select
  button.
- **The server scope:** sjvair.com gains a whole-type scope on the bulk region summaries, daily
  (for days) and daily open (for Now), current-vintage regions only, so tracts match the
  GeoJSON's 978 and not the list's 1,161; arranged by the coordinator; the SDK beta that exposes it is a pin move here. **The
  parameter names are filled in here when the server spec is approved.** Until the SDK beta is
  out, the fill's loading can't land; everything else in this spec doesn't wait on it.

## Testing

- Unit: the snapshot query (days, now, polling only non-final days, scope), the shared day rules
  (the calendars' existing tests keep passing unchanged), the `day`/`fill`/`fillShown` options
  (missing means default, a default is never written, a day outside the range), Get data's
  conversions with a range, the stepper's stops (ranges with and without today, future days cut).
- Browser: the stepper's keys and buttons, the narrow layout, `aria-valuetext`, the run-of-steps
  undo, viewer stepping on a read-only view (no writes), the fill's row and legend, the hidden
  mark's new reason.
- E2E: step through a past range with fixtures (monitors, a fill, smoke for the day); a shared live
  link where a viewer steps without writing; a range with today opening on Now. Reuse
  `routeMapReadings`, `liveLinkTo`, the method-based "no writes" check.
- Accessibility: axe on the stepper and the fill legend; contrast for any new token on
  `--background`, the menu surface and the hovered `--accent`.

## `ARCHITECTURE.md` changes in this spec

- "Widget-type contract": the `now` flag; the Map as `time: "range"` with Now.
- "The dashboard's Map widget": days, the stepper, the saved day, refresh, fills, the snapshot
  query; "The Map tile's toolbar": the Layers fill row, Inactive on day stops, `day` not a toolbar
  key.
- "Widget data selection" or the data layer section: the snapshot query, and the day rules shared
  with the calendars.

## `DEFERRED.md` changes in this spec

- **Add:** one figure per place for a whole range ("where was it worst over the period"); why: a
  year of daily rows for a whole region type is too much to load, and the right shape is a
  server-side figure per region per range. Revisit when someone asks for it, or the server offers
  that figure.
- **Update:** "A heatmap layer over the map, of daily values": day-by-day fills and monitors are
  built; a smooth interpolated surface stays deferred (it shows values where nothing was
  measured). Revisit if someone asks for it.
- **Resolve:** "The Map refreshes only when its date range includes today".
- **Update:** "Whole-layer backfill gaps": the Map's ranged data uses the snapshot query, not
  whole-layer range queries, so it still doesn't bite; revisit when a whole-layer series is needed.
- **Remove:** spec 3's four "Do at the start of spec 4" leftovers once done.

## Left to the builder

- The snapshot module's exact file layout and type names.
- How the stepper's strip shares space with the legend button on narrow tiles.
- The exact "run of steps" pause (about a second) if testing shows another works better.
- Which neighbouring days to fetch ahead, if one each side proves too much or too little.
