# Release 1, step 5, spec 5: pesticide use and spray notices on the Map

_Brainstormed with the user 2026-11-16 (session `data-dashboard-30`). Built as two PRs into
`step-5`: **5a, spray notices** (with the shared groundwork), then **5b, pesticide use**._

## Where this sits

Step 5 is the Map widget, on the `step-5` branch. Each spec branches from it and opens a PR into
it. `step-5` merges into `main` once, at the end, with the user's yes. Specs 1 (#53), 2 (#56), 3
(#57) and 4 (#58) are merged into `step-5`.

1. The widget core. Done.
2. The Map's data per tile, marks, focus area. Done.
3. The options toolbar, Settings, viewer changes. Done.
4. Days (the stepper, with Now) and region fills. Done.
5. **This spec:** pesticide use by section and township, and spray notices.
6. "Show in a chart/table" from a map's marks.

**Working rule (`CLAUDE.md` → "Repo workflow"):** build straight toward step 5's final design.
There is no stop-gap UI between 5a and 5b: between them the test suite is green, every other
widget works, and saved documents open without errors. 5a doesn't build half of use.

## Why

Two audiences ask two different questions (the user, 2026-11-16):

- **Parents** ask "is anything being sprayed near my child's school, this week or on the day they
  got sick?" That is **spray notices**: SprayDays notices of intent, filed before a grower applies
  a California-restricted material. They are recent, near a place, and follow the day.
- **Researchers and agencies** ask "how much was used here, when in the year, and how does it
  compare with the rest of the valley?" That is **pesticide use** (CDPR Pesticide Use Reporting),
  per square-mile section and per 6 × 6 mile township. Its finest period is a month, and it
  arrives about a year late. In the user's words, since this data is always old it will be of more
  use to researchers than parents.

sjvair.com's Pesticides Data Explorer (`/tools/pesticides/map/`) already maps both, and the user
likes how its layers work. This spec brings its best parts to a dashboard tile: the township and
section switch, the hover lens, the section card, the notice card and the explainer wording. It
does that within the dashboard's rules: metadata is the source of truth, nothing is conveyed by
colour alone, the keyboard and touch work, and the scale is stable.

## Goals

- **Spray notices** on a Map, following the day stepper: on Now the notices active now, and on a
  past day the notices active that day. One marker per section, with a count, clustered when
  zoomed far out. A notice card explains what a notice is and isn't.
- **Pesticide use** on a Map, with **its own fixed period** (a year, or a month of a year), apart
  from the stepper. Townships are shaded when zoomed out, and square-mile sections from about zoom
  11, loaded as the view moves.
- **One valley-wide scale.** The server ranks every section (or township) in the valley into
  quantile classes for the period, figure and filters, so a colour means the same amount
  everywhere on the map and doesn't move while panning.
- The figure is one of pounds applied, acres treated or applications, chosen in the toolbar.
- **The same filters as charts' pesticide layers**, applied to use and notices together.
- **The lens.** Hovering a township shows its 3 × 3 neighbourhood as sections. The township
  card's "Show square miles" button does the same for keyboard and touch users.
- **Cards.**
  - Section card: figures, top chemicals with badges, the year's 12 months as bars, "peaks in
    ‹month›", and an "Open in Pesticides Explorer" link.
  - Township card: figures, section count, "Show square miles" and "Zoom in".
  - Notice card: dates, method, amount, products, chemicals, and a SprayDays sign-up link.
- **Explainer text from the server** wherever the explorer explains its data: notices are a plan
  and cover restricted materials only, use runs about a year behind, and what the shades mean.

## Non-goals

- **Comparing years** (the explorer's red-to-blue change map). It stays deferred (see
  "`DEFERRED.md` changes"). This spec leaves room for it: use's period setting can later gain a
  "compared with" choice.
- **Marking sections, townships or notices.** Only monitors are markable, as now. MTRS selection
  stays deferred, with spec 6 as a new trigger.
- **Schools and child care as a Map data set.** They stay deferred (the user, 2026-11-16, trigger
  "after spec 5"). So do schools' "use within about a mile" totals.
- **A township detail endpoint** (top chemicals per township). Deferred.
- **The explorer's Tweaks** (ramp, number of bins, basemap): ruled out. The metadata decides
  ramps and bins, and the Map's Settings already holds the basemap.
- More than one use layer per Map. Two shadings can't share the same squares.
- Use following the stepper. Its finest period is a month and it runs about a year behind, so
  stepping by day would show the wrong period or nothing (the user chose its own period, 2026-11-16).

## Anti-goals

- **Colours that shift as you pan**, or a colour that means a different amount in different parts
  of the same map. That is the explorer's on-screen ranking, which the user ruled out.
- **A notices layer that reads as "all spraying".** Notices cover California-restricted materials
  only and are a plan, not proof. With no notices, the map must not suggest nothing was sprayed.
- **Use that looks current.** The legend and card always name the period ("Pounds applied,
  2023").
- **Hardcoded** years, ramps, bins, labels, units, badge names, method names, categories or
  help text. All of it comes from `pesticides/meta/`, the dataset catalog or the responses.
- Conveying a class or a badge by colour alone.
- **Working around a missing server, SDK or map-sdk piece in the dashboard**, such as client-side
  bins or a hand-rolled fetch for an endpoint the SDK lacks. Each gap is fixed in its own repo
  (see "Dependencies").

## Constraints

- **Pins:** `@sjvair/map-sdk` `0.1.0-beta.16` and `@sjvair/sdk` `5.0.0-beta.11` today, each pinned
  exactly. This spec moves to the map-sdk beta and the `@sjvair/sdk` `5.0.0` beta that carry the
  pieces in "Dependencies", adopted only through the coordinator.
- Map code stays in the lazy map chunk. Report the initial bundle against the 250 KB soft budget
  (213.0 KB before this spec).
- Svelte 5 runes, Paraglide (no concatenated sentences), theme tokens only, Pacific time through
  `format` with Sunday weeks, WCAG 2.2 AA with standard patterns.
- **Location privacy:** coordinates never go in the dashboard's URLs, logs or error reports, and
  shares swap points for regions. This spec saves no coordinates. **Sections load by the map's
  view box** (`bbox` on `sections/`, for the padded view and the lens), the user's choice on
  2026-11-16: it is the map's view, not a person's location (an exact point's Map frames its
  region), the tiles already tell MapTiler the same view, and error reports drop query strings
  (`src/lib/platform/web/errors.ts`). Loading by township id was the alternative.
- The three place-handling spots stay wired for the Map (`src/lib/sharing/points.ts`,
  `PlacePickerDialog`'s `regionOf`, Get data's `src/lib/get-data/now.ts`). The pesticide layers
  are place-less, like smoke and fire, so they add no place to handle.
- Nothing in map-sdk, monitor-map, mobile, sdk-js or sjvair.com changes from this repo.

## Approaches

**Use and the day stepper** (the user picked B):

- **A.** Use follows the stepper, so each day shows its month. One control, but about 30 steps
  per month, and most recent days have no data yet.
- **B.** Use has its own period (a year, or a month of a year), and only notices and monitors
  follow the stepper. "July 2023" is one choice, and the legend names the period.
- **C.** Use follows the stepper's month, falling back to the latest month with data. It never
  looks empty, but it quietly shows a different period from the one on screen.

**Use's period** (the user picked B, a fixed period):

- **A.** "Latest year" as a rolling default, so a saved Map moves to new data by itself.
- **B.** Always a fixed year or month, opening on the latest year with data. A saved Map never
  changes under its owner, which suits researchers.

**Notices on a past day** (the user picked B):

- **A.** Notices on Now only.
- **B.** Notices follow the stepper, like smoke and fire, which needs a server `date=` filter.

**Where the colour bins come from** (the user picked B, after looking at how the explorer does it):

- **A.** Fixed bins in `pesticides/meta/`. They're stable, but most of a filtered layer would
  fall in the bottom bin.
- **B.** The server ranks the whole valley for the query (`camp/apps/pesticides/maps.py`'s
  `quantile_classes`, the explorer's own algorithm), cached apart from the `bbox`. Measured on the
  local stack: whole-valley township totals take 0.1–0.4 s cold for every filter tried, and about
  0.02 s warm.
- **C.** Ranking what's on screen, as the explorer does
  (`assets/js/pesticides/section-map.js:2033`). Colours shift with the view, and it breaks
  "scales come from the server".
- **D.** Ranking within the tile's places. That keeps local contrast, but two Maps wouldn't share
  colours.

**Sections or townships** (the user picked A):

- **A.** Switch by zoom: townships across the valley, and sections from about zoom 11, loaded
  for the view.
- **B.** A toolbar choice, with sections only inside the tile's places. A county is more than the
  server's 2,500-section cap.
- **C.** Townships only.

**Filters** (the user picked A): **A.** the same as charts' pesticide layers, with the server
adding category and cancer group to the map endpoints; **B.** only what the map endpoints take
today.

**Clicking a section** (the user picked A plus the link): **A.** not markable, a read-only card;
**B.** markable, which makes sections dashboard places (the deferred MTRS selection); **C.** a
link to the explorer. The card has A's content and C's link.

**The lens** (the user, 2026-11-16): in, on condition that the keyboard and touch get the same
function through the township card's "Show square miles", and that it uses the valley-wide
section bins.

**How it's built** (the user picked B, the fastest to finish):

- **A.** One PR, after every other repo lands.
- **B.** One design, two PRs: 5a notices first, then 5b use. All the asks go out at once, and 5a
  builds while the server's bins and map-sdk's lens and card work are under way.
- **C.** Two separate specs. More process for no gain.

## Dependencies on other repos

The coordinator (`data-dashboard-59`) carries these to each repo's own session, and each session
specs its own change. The shapes below are what the dashboard needs, not what those repos must
build. Each repo's choice is recorded here when it reports back.

**sjvair.com** (`develop`):

1. **Valley-wide classes** on `sections/` and `townships/` responses. For each of the three
   figures, the break values from `quantile_classes` over every section (or township) in the
   valley, for the same year, month and filters. Zero counts as no data. They are cached apart
   from `bbox` and `region`, for a long time (a day, or until the next import).
2. **In `pesticides/meta/`:** the sequential colour ramp, and the list of years with data, newest
   first.
3. **In `pesticides/meta/`:** the explainer text (what a notice means, the data's lag, what the
   shades mean), worded for the server bins.
4. **`category` and the cancer-group filter** on `sections/`, `townships/` and `notices/active/`,
   and in the classes' cache key, with the names and values `pesticides/place/` takes.
5. **`date=` on `notices/active/`:** the notices active on that Pacific day, under the same 4-day
   rule.
6. **Badges** on `sections/<id>/` `top_chemicals` (Prop 65, CARB TAC, IARC group, restricted), as
   keys into meta lists.

**sdk-js** (`release/5.0.0`): functions and schemas for `sections/`, `sections/<id>/`,
`townships/` and `notices/active/`, with the new fields. Riding along: a looser
`locationSourceSchema`, so a new Location source or type doesn't fail `regions/locations/` and
`pesticides/locations/`.

**map-sdk:**

1. A `zoomRange` on `shapesPlugin`, with no gap at the handover.
2. For the lens: hover enter and leave on shapes, a sections layer drawn over part of the township
   layer with those townships' own fill hidden, and a pinned mode that Esc clears.
3. Card content for shapes and points: a small 12-month bar chart, a badge list, an external
   link, and host actions.
4. Notice markers: a count per marker, and clustering when zoomed far out.
5. Legend: a unit line per level ("lbs per township"), the no-data row, and a slot for a note.

**What map-sdk has today** (the coordinator checked map-sdk `main` f08f673, 2026-11-16):
`pointsPlugin` already has `zoomRange`, clusters with aggregate cluster properties, and feature
and cluster tooltip snippets, so notice counts may need nothing new. `shapesPlugin` has no
`zoomRange`, no tooltip or detail snippet, and no hover events. `map.bounds` is reactive (updated
on moveend), so loading by view is the host's own `DataSource` driven by it, which is the intended
pattern. Cards are `MapTooltip` plus `card.actions`, so "Show square miles" and "Zoom in" fit as
actions; a rich body for shapes is the gap. `LegendSection` has units and `noFigure`, but no
note slot. The township id must be stable (`townships/`), passed on to the server.

**Order:** 5a needs sjvair.com 4 (for notices) and 5, the explainer text from 3, and the SDK's
notices function. It also needs map-sdk 3 and 4 for notices, unless map-sdk can already draw them.
5b needs the rest. If a 5a piece lags, 5a waits for it rather than working around it.

## Part 0: groundwork (in 5a)

The deferrals this spec makes due (`DEFERRED.md` → "Step 5 spec 4 review leftovers"):

1. **Split `MapData`** (`src/lib/widgets/map/data/loaded.svelte.ts`, about 620 lines): move each
   data set's block (monitors, smoke and fire, the fill) into its own file beside its entry, so
   notices and use join as two more without growing one file. `MapData` keeps the shared
   orchestration: the input, polling, the day's fetch-ahead and destroy.
2. **Browser tests for day-following layers:** prefetch, retry and refresh on a day stop, for
   smoke and fire, and for notices as they join.
3. **`figureOfRow`:** extract the per-row figure logic shared by `snapshot/regions.ts` and
   `snapshot/monitors.ts` into `rows.ts`, if pesticide use's rows share it. If they don't, record
   why in the entry and leave it.

## Part 1: spray notices (5a)

- **Data set:** the catalog's `pesticide-notices` (entry type `spray-notice`). It is a
  **place-less layer** like smoke and fire (`{ dataset: "pesticide-notices" }`), added and
  removed in Get data's Map section with a "Spray notices" switch. Its label and description come
  from the catalog.
- **What a day shows.** On Now, the notices active now. On a past day stop, the notices active on
  that Pacific day (`date=`). Everything follows spec 4's day rules: fetch the neighbouring stops
  ahead; Now polls on the `"hour"` cadence (the user, 2026-11-16: the server imports notices
  once a day, at 14:00 UTC, and hourly polling picks that import up within an hour without the
  dashboard hardcoding the server's schedule; requests are small and served from the server's
  5-minute cache); a past day polls hourly until Pacific 00:00 of D+5, and a settled day never
  polls (the user, 2026-11-16: the server's daily 14:00 UTC import rewrites notices up to 4 days
  back; see "Calls made after the builder check"); after midnight, Now's notices are keyed by the
  Pacific date, apart from a day stop's.
- **Where they're drawn:** across the whole valley, not clipped to the tile's places (my call,
  like smoke and fire), loaded in one valley-wide request. Each notice is drawn at its section's
  centre: SprayDays gives the square mile, not the field, and the card says so. Several notices in
  one section are **one marker with a count**, and markers cluster when zoomed far out (while the
  toolbar's Clusters setting is on). Notices draw above the fill, the use layer and the focus area, and below the monitors (my
  call: monitors stay on top, as in spec 4).
- **Filters:** the Map's pesticide filters (Part 3) apply to notices too, as far as the server
  takes them: the request sends only the meta's `notice_filters`, and a saved filter it doesn't
  list (the crop) is named "doesn't apply to spray notices" (see "Calls made after the builder
  check").
- **The notice card:**
  - The scheduled date and time, with an "Active" tag when it applies (on Now only), and "may
    begin through ‹date›".
  - The section and county.
  - The treated amount and units, and the method (the meta's label for the notice's
    `aerial_ground`).
  - Products, then chemicals, with the "of concern" marker.
  - A "Sign up with SprayDays" link.
  - The explainer note: a plan, not proof; restricted materials only.

  Several notices in one section get a list card ("3 notices of intent"), each row with its date,
  amount and method, opening that notice. The wording and labels come from the meta and the
  catalog, and dates go through `format`. On hover the card is a static summary; pinned or
  focused it is interactive.
- **Toolbar:** the Layers group gains a "Spray notices" show/hide row (like Fire & Smoke). It
  hides without unloading, saved as `noticesShown` (only `false` is stored; a toolbar key Reset
  clears).
- **Legend:** a notices row (marker, label, "numbered: how many") and the explainer note. The
  marker's colour and the row come from the server's one-level `spray-notice` scale. With no
  notices for the day it reads "No spray notices for this day" (my call), or on Now "No spray
  notices right now" (the user, 2026-11-16), and the note still reminds that this doesn't mean no
  spraying.
- **Accessibility:** markers are in map-sdk's feature list, one row per section ("2 spray notices,
  ‹section›, ‹county›"), so a keyboard user reaches every notice. The count is in the accessible
  name, not only on the marker.

## Part 2: pesticide use (5b)

- **Data set:** the catalog's `pesticide-use`. It is **one place-less layer per Map**
  (`{ dataset: "pesticide-use", filters? }`), added in Get data's Map section with a "Pesticide
  use" switch, its period and its filters.
- **The figure** is a Map option, `useFigure`: one of the catalog's `pesticide-use` entry types
  (`pounds-applied`, `acres-treated`, `applications`), offered in the toolbar. Missing means the
  catalog's first, and a default is never written (spec 3's rule). The labels and units come from
  the catalog.
- **The period** is a Map option, `usePeriod`: `"YYYY"` or `"YYYY-MM"`. It is written when use is
  added, as the latest year in the meta's years list, and it is **always present while use is
  on** (the user chose a fixed period). It is offered in Get data and in the toolbar (a year
  select, then "Whole year" or a month). A saved year the meta no longer lists draws nothing, and
  the layer reads "No data for ‹period›" (my call: it doesn't fall back to another period).
  Converting away from the Map drops it, as it drops `marks`. It isn't a Reset key, since Reset
  never changes the data.
- **Sections and townships by zoom.**
  - Below about zoom 11, the valley's townships come in one request (`townships/` with
    `geometry` once, then values only).
  - From about zoom 11, the sections in view (padded by half a view, as the explorer does) come
    in further requests, refetched only when the view leaves what's loaded.
  - The exact switch follows the explorer's `sectionZoom()`: raise the threshold until the view is
    under the server's 2,500-section cap. A 400 falls back to townships.
  - The handover uses map-sdk's shapes `zoomRange`.
  - The in-flight request is cached as spec 4's `regionTypeShapes` does: shared between callers,
    dropped on failure, never cancelled by one caller's abort.
- **The scale.** The server's classes for the figure and level make a scale with a **stable
  identity** per (figure, level, period, filters), since map-sdk matches a resolved scale by
  identity (spec 4's lesson). The colours come from the meta's ramp, sampled to the class count
  as the server's `sample_ramp` does (my call: the client samples only the server's own ramp, and
  invents no colour). _Changed while planning 5b: the colours are the server's own
  `classes.<figure>.colors`, one per break; see "Calls made after the builder check"._ Zero use
  is drawn **outlined with no fill** and reads "No data" (`noFigure: "outline"`). The legend
  names the figure, the period and the level ("Pounds applied, 2023, lbs per township"), and
  shows the shades note. The class ranges come from the breaks, formatted through `format` with
  the catalog's precision.
- **Draw order:** a tile with a fill and use shows both. Use goes under the fill (my call: the
  fill is the air-quality context and stays readable on top at its lower opacity). The builder
  checks this on screen and may swap them, recording why. Monitors, notices and the focus area
  are always on top. _Swapped in 5b: use draws above the fill; see "Calls made after the builder
  check"._
- **Toolbar:** a "Pesticide use" group with the figure (a select of three) and the period, plus a
  Layers row "Pesticide use" (show/hide, saved as `useShown`; only `false` is stored).
- **The lens.**
  - At township zoom, hovering a township (after a short rest, about 50 ms) draws the sections of
    its 3 × 3 neighbourhood over it, with those townships' own fill hidden. They are shaded with
    the **valley-wide section classes**, not re-ranked.
  - Leaving clears it after a short grace (about 120 ms). Escape clears it.
  - The township card's **"Show square miles"** opens the same lens, pinned until Escape, closing
    the card, or another township. This is the keyboard and touch path. On touch, a tap opens the
    card and never the lens directly.
  - Sections in the lens are in the feature list while it shows, and their cards work as at
    section zoom.
- **The section card.**
  - The section code and county.
  - The period's three figures, with the shown figure's class in words.
  - The top chemicals (up to 3 by the shown figure, as the explorer does), each with its badges
    in text, never colour alone. _As built: ranked by pounds, since `sections/<id>/` gives
    pounds only (see `DEFERRED.md`)._
  - The year's 12 months as small bars, with a text alternative listing each month.
  - "Peaks in ‹month›". The month is the largest of the year's months, named through `format`; it
    is left out when every month is zero.
  - **"Open in Pesticides Explorer"**, linking to sjvair.com's `/tools/pesticides/sections/<id>/`
    with the year. _Replaced in 5b: the explorer popup's links, from the meta; see "Calls made
    after the builder check"._

  The data comes from `sections/<id>/`, fetched when the card opens and cached per section and
  period.
- **The township card:** the township name, the period's three figures with the class in words,
  the number of sections, "Show square miles" and "Zoom in". There is no explorer link, since
  townships have no page there.
- **"Show as" and conversions:** a chart's pesticide layer converts to a Map's use (its filters
  kept). The Map takes the period from the chart's range: its last full year with data, else the
  latest year (my call). A Map's use converts to a chart's pesticide layer at the Map's places.
  The conversion notes say what was dropped. See "Calls made after the builder check" for which
  dates a converted chart gets and which layer a multi-layer chart gives the Map.

## Part 3: filters (shared by 5a and 5b)

- **The same filters as charts' pesticide layers** (`PesticideFiltersSchema`): chemical,
  commodity, product, categories, cancer group, method, narrow-to. Get data's Map section reuses
  `PesticideFilters.svelte`. "Filter-gone" works as on charts.
- **One filter set per Map.** It is saved on each pesticide layer and kept in step, as one weather
  station is kept in step across weather layers (my call: it keeps the layer the unit that
  carries filters, as on charts). It applies to use, its classes and notices.
- The legend and both cards name the active filters, as charts' legends do.
- Filters are owner choices in Get data, not toolbar rows (my call: the toolbar holds view
  choices; filters change the data).

## Testing

- **Unit:**
  - The new options (`useFigure`, `usePeriod`, `useShown`, `noticesShown`): missing means
    default, a default is never written, an unknown period.
  - Get data's Map section with the two switches.
  - The conversions to and from charts.
  - Grouping notices by section.
  - The scale built from the server's classes: stable identity, ramp sampling, no data.
  - The zoom switch and padded-bounds reuse.
  - The "peaks in" month.
- **Browser:**
  - Day-following prefetch, retry and refresh for smoke and fire and for notices (Part 0).
  - The toolbar rows and the figure and period choices.
  - The notice card and its list form.
  - The section and township cards, with "Show square miles" pinning the lens and Escape
    clearing it.
  - Viewer changes on a read-only dashboard (no writes).
- **E2E, against map-sdk's real Legend, with axe in light and dark, for each new layer as it
  lands** (spec 4's lesson). The fixtures' scale and entry labels differ, so the title assertions
  can fail.
  - 5a: notices on Now and on a past day, with the legend's notes.
  - 5b: townships, sections after zooming in, the lens by mouse and by the card button, the legend
    naming the period, and the bins unchanged after a pan.
- **Accessibility:** contrast for any new token (the notice marker, the lens outline) on
  `--background`, the menu surface and the hovered `--accent`. Escape and hover behaviour
  (WCAG 1.4.13). The feature list reaches notices, townships and sections.

## `ARCHITECTURE.md` changes in this spec

- "The dashboard's Map widget": the two new entries (notices and use), the split `MapData`, what
  a tile holds, and draw order.
- "The Map tile's toolbar": the Pesticide use group, the Layers rows for notices and use, and the
  new keys.
- "The Map's days and region fills": notices follow the day; use has its own period.
- "Widget data selection (partial datasets)": the Map's pesticide layers and their shared
  filters.
- "Metadata as source of truth": the pesticide meta's ramp, years, explainer text and badges.

## `DEFERRED.md` changes in this spec

- **Add:**
  - Comparing years on the Map (the explorer's change map). Revisit after spec 6, or when an
    agency or researcher asks. This updates the existing "Year-over-year change on the map" entry
    rather than adding a second one.
  - A township detail endpoint (top chemicals per township). Revisit when someone asks.
  - The explorer's Tweaks, ruled out (the metadata decides ramps and bins; the basemap is in
    Settings). Recorded under "Dropped" as the user's decision.
  - Anything the dependencies leave out, each with its trigger.
- **Update:**
  - "Schools and child care as a Map data set": trigger "after spec 5" (the user, 2026-11-16).
  - "`land_use` / `mtrs` region browsing": add spec 6 as a trigger.
  - "Map plugins for the remaining server datasets": pesticide use and SprayDays notices are
    done.
- **Resolve:**
  - The spec 4 leftovers done in Part 0: the `loaded.svelte.ts` split, the day prefetch tests, and
    `figureOfRow` (or why not).
  - "The SDK's school and child-care source list is strict", once the SDK change lands.
- **Every review minor reaches this file before each PR**, as a "Step 5 spec 5 review leftovers"
  entry.

## Left to the builder

- File layout and type names for the two entries and the split `MapData`.
- The exact zoom threshold, padding and debounce, if the explorer's values don't fit a tile.
- The lens's timings (about 50 ms rest and 120 ms grace) if testing shows others work better.
- How the Pesticide use group lays out the period choice on a narrow toolbar.
- Draw order between use and the fill (see Part 2), recorded with why.

## Calls made after the builder check

The first four calls are mine, made at the builder check. The rest were made while building 5a
and 5b, each marked as mine, the user's or the builder's.

- **The layer limit.** A Map's layers stay within `LIMITS.LAYERS_MAX` (8): smoke, fire, notices
  and use take 4, so `MAP_POLLUTANTS_MAX` becomes `LAYERS_MAX - 4` (4). The server offers 2
  pollutants today (`available_pollutants`: ozone and PM2.5), so no saved Map holds more than 4,
  and the document schema's own limit doesn't change. `DEFERRED.md` → "More than 6 pollutants on
  one Map" becomes "more than 4".
- **A Map with use, converted to a chart.** The chart keeps the Map's date range (as today). The
  use layer comes along only if its period **overlaps** that range (the builder, 2026-11-17,
  replacing "falls inside": a chart range is at most 366 days, so a whole year would almost never
  fit, and the note's own wording is only true under overlap). Otherwise it is dropped, with a
  conversion note naming the period ("Pesticide use for 2023 isn't in these dates"). The range
  doesn't follow `usePeriod`, since that would also move the air-quality layers.
- **A chart with several pesticide layers, converted to a Map.** The Map takes the **first**
  pesticide-use layer: its filters become the Map's filter set, and its entry type becomes
  `useFigure`. The others are dropped with a note. The places stay on the pollutant layer, as
  `toMapDraft` does today. A chart with no pollutant layer (pesticides only) gets the first
  offered pollutant, holding the chart's places, as for any other source.
- **Error reports never carry request URLs' query strings.** The web platform's reporter
  (`src/lib/platform/web/errors.ts`) already drops breadcrumbs and query strings and keeps only the
  route pattern, so no new scrubbing is needed for this spec's requests.
- **Notices poll on past days too** (the user, 2026-11-16). A past day's notices poll hourly
  until Pacific 00:00 of D+5, and a settled day never polls. This replaces "a past day never
  polls" (my call, made before the server said past days change): the server's daily 14:00 UTC
  SprayDays import rewrites notices up to 4 days back. The cost is a few hourly requests for
  recent days.
- **The notice colour and legend come from the server** (the user, 2026-11-16).
  `pesticides/meta/` gives a one-level `scales["spray-notice"]` (pink `#e64980`, the user's pick),
  and the dashboard passes it as the notices' scale. This replaces the plan's
  `--map-notice-marker` token, and was chosen over a map-sdk change for unscaled layers.
- **The count number is readable on the colour** (the user, 2026-11-16). `@sjvair/map-sdk`
  `0.1.0-beta.19` draws it black or white by contrast with the level colour (WCAG 1.4.3): a
  number in `--background` on the pink was 3.43:1 in light mode.
- **The method label** (the user, 2026-11-16). The card shows the meta's `methods` label by the
  notice's `aerial_ground` key (sjvair.com #338), not SprayDays' own wording.
- **Filters the notices don't take** (mine). The notices request sends only the meta's
  `notice_filters`. A saved filter that doesn't apply (the crop) is named "doesn't apply to spray
  notices" in Get data and in the legend, and is left out of "Filtered by". Only applicable
  filters can make the layer filter-gone.
- **Now with no notices** reads "No spray notices right now" (the user, 2026-11-16).
- **The notice card's two forms, and the Active tag** (mine). On hover the card is a static
  summary (nothing focusable inside map-sdk's tooltip); pinned or keyboard-focused it is
  interactive (WCAG 2.4.3, 4.1.2). The "Active" tag shows on Now only: on a past day every notice
  returned was active that day.
- **The lens** (the user, 2026-11-16). A notice's card holds the hover lens, as a section's card
  does. Shipped in `@sjvair/map-sdk` `0.1.0-beta.18`; it applies in 5b.
- **Notices load valley-wide** (mine). The server caps a request at 2,000 matches; production's
  busiest 5-day window since 2026-05-30 is 224, so a valley-wide request fits with room. Early
  spring isn't measured yet (`DEFERRED.md`).
- **Notices draw above the focus area** (mine), under the monitors, and **cluster only while the
  toolbar's Clusters setting is on** (mine): the setting applies to every clustered layer.

Made while planning and building 5b (2026-11-17):

- **Decisions made while planning** (the user, 2026-11-17):
  - **The section card's links match the explorer popup's:** Section details, Records here,
    Notices here, and a link on each top chemical's name. Each opens in a new tab with
    `ExternalLinkCue` and `rel="noopener noreferrer"`. The card has no "Zoom in" (the township
    card keeps its own).
  - **The section card's months and top chemicals follow the Map's filters.** `sections/<id>/`
    takes the value filters and the month (sjvair.com, typed in `@sjvair/sdk` `5.0.0-beta.14`).
    The card's own figures come from the filtered map feature.
  - **Zero use is an outline with no fill**, and the legend reads "No data". `meta.ramp.no_data`
    isn't used. The server rewords `notes.shades_valley` (it said "Gray means…"); it now ends "An
    outline with no shading means nothing was reported."
  - **"Located in".** The section card has a line "In township ‹id› · ‹figure›" that swaps the
    card for the township's, in place: the mouse path to the township card, which the hover lens
    otherwise covers. It uses map-sdk's public `map.pin` (`@sjvair/map-sdk` `0.1.0-beta.20`).
  - **Which cards name the filters:** the section card, the township card and the use legend.
  - **"Notices here" stays a link.** The section card doesn't list the section's notices, unlike
    the explorer's popup.
  - **5a leftovers fixed here:** the `MapWidget` split with one note banner, filters kept across
    off and on, the filter-change refetch test, and the notice card's flicker and focus items.
- **The class colours are the server's** (made while planning, 2026-11-17). Each class colour is
  `classes.<figure>.colors[i]`, one per break and in break order (`@sjvair/sdk` `5.0.0-beta.13`).
  The client never samples `meta.ramp.colors`, replacing Part 2's sampling call.
- **The section card's links come from the meta** (the user, 2026-11-17), replacing the
  hardcoded `/tools/pesticides/sections/<id>/`. `pesticides/meta/` gives `links` (URL templates
  for `section_page`, `section_records`, `section_notices`, `section_notices_past` and
  `chemical_page`) and `link_params` (the query parameters each takes), and `@sjvair/sdk`
  `5.0.0-beta.14`'s `pesticideLinkUrl` fills them by the server's rule. A link the meta lacks is
  left out. The section links carry the period and the Map's filters; the notices link is
  `section_notices_past`, with the day's year and month, while the notices layer is on and
  showing a past day, else `section_notices`. **The chemical link carries the Map's filters
  except `chemical_id`** (the link names its own chemical), `narrow` included. The links show on
  the interactive card only, while the detail loads and when it fails too. The dev server proxies
  `/tools/` and `/static/` to the local stack, since the server builds the links from the
  request's host.
- **The section detail follows the Map** (the builder, 2026-11-17). `sections/<id>/` is asked with
  the Map's filters, `narrow` and, for a month period, the month, only for the interactive card
  (never on hover). Its cache is keyed by section, year, month and filters, shares a request
  while in flight, and keeps the 50 most recently used answers (an LRU).
- **Use draws above the fill** (the builder, checked on screen 2026-11-17; the coordinator
  agreed), swapping Part 2's provisional order. Under the fill, use's classes can't be matched to
  the legend, and the fill takes the pointer, so the lens never opens and the township card is
  out of reach while a fill is on. Bottom to top: the fill, the townships, the lens, the
  sections, the focus area, smoke and fire and the notices, then the monitors
  (`layers/order.ts`).
- **The section zoom** (the builder, 2026-11-17). It is the explorer's `sectionZoom()` with the
  explorer's values: from zoom 11, the first whole zoom whose view at the tile's size holds at
  most 2,000 square miles, capped at 18. It reads a fixed latitude (the places' frame, else the
  valley's townships), so panning never changes it, and the plugins are made once the tile has a
  size. A padded `sections/` request the server refuses (400) is retried unpadded; a second
  refusal raises the section zoom one step for the session (`refusedZoom`), and the townships
  stay drawn meanwhile, so the map is never blank.
- **Feature refKeys are prefixed** (the builder, 2026-11-17), so plugins never collide:
  `township:<PLSS id>` and `section:<section id>` (through `encodeRef`), beside the notices'
  `feature:<section id>`.
- **A missing `usePeriod` draws the latest listed year** (the builder, 2026-11-17), the year the
  toolbar shows, and is never written ("fallbacks are drawn, not saved"). A saved period the meta
  no longer lists still reads "No data for ‹period›" and asks for nothing.
- **`MapWidget.svelte` at about 806 lines is fine** (the user, 2026-11-17), against the plan's
  "under 700" aim after the split. The next moves (map creation, the marks sync) depend on plugin
  order.
- **The 5a banners stay, and the legend also says why** (the builder, 2026-11-17). On
  `@sjvair/map-sdk` `0.1.0-beta.20` an unavailable source passes a translated `message`, so the
  legend's status row names the reason for notices and use (filter-gone). The banners stay: they
  carry the Edit data action for an editor, and show while the legend is folded on a narrow tile.
- **The "In township" line** (the builder, 2026-11-17, from the plan's approved wording "whose
  township name is a button"). It sits in the card body on both forms. On the interactive card
  only the township id is a button (accessible name "Open township ‹id›"), and only while the
  townships plugin lists it; from the section zoom on, the id is plain text. A township's own
  card has no line.
- **`legendDisplay: "blocks"` on all three use plugins** (the builder, 2026-11-17): townships,
  lens and sections (plugins sharing a `ScaleRef` take the first one's display). A gradient's
  tick labels ran together with 8 classes.
- **The legend's scroll wrapper isn't a second "Legend" region** (the builder, 2026-11-17). It
  keeps `tabindex="0"` but drops `role="region"` and its label: nested landmarks with the same
  name are an accessibility bug. _Replaced in the final review; see "The legend's scroll wrapper
  is a named group" below._
- **A minors sweep before the docs** (the user, 2026-11-17). The task reviews' minors were fixed
  in one pass after Task 11; what it left is in `DEFERRED.md` → "Step 5 spec 5b review
  leftovers".
- **Use numbers on the cards** (the final review, 2026-11-17). A use figure above zero never
  reads "0": values are written at the catalog's precision, and a non-zero value that would round
  to zero gets more digits until it doesn't. The shown figure also gets more digits while its
  rounded value falls outside its own class. One helper, `formatUseValue` (`data/use-scale.ts`),
  serves all three card figures and the "In township" line.
- **"No data for ‹period›" and filter-gone in the legend** (the final review, 2026-11-17). When a
  saved period isn't listed or a filter is gone, the townships and sections sources each report
  `unavailable` with the message as a translated `message`. map-sdk draws one status row with the
  note under it, at every zoom (the zoom ranges don't overlap, and the lens adds no row). A key
  that fails to load exposes its empty scale, never the previous key's classes, and the failure
  banner says why. The earlier "the layer reads No data for ‹period›" call now works this way.
- **The legend's scroll wrapper is a named group** (the final review, 2026-11-17). It is
  `role="group"`, named "Legend, scrollable", and a Tab stop only while it overflows, through the
  shared `scrollFocusable` attachment (`src/lib/components/shared/scroll-focusable.ts`). map-sdk's
  legend inside it stays the only "Legend" region. This replaces the "wrapper isn't a second
  Legend region" call above.

## Open with the server

_(Filled when sjvair.com, sdk-js and map-sdk report back.)_

For 5a, all answered:

- **Filters on notices:** the map endpoints take `pesticides/place/`'s sqids for chemical and
  product, and `aerial_ground` codes for the method; notices record no crop (`commodity_id` is a
  400), and the meta lists the filters they take in `notice_filters`.
- **`date=` on `notices/active/`:** a notice is active on D when scheduled from Pacific 00:00 of
  D-4 to before Pacific 00:00 of D+1; with `date=` each feature has `past`. A day is settled from
  Pacific 00:00 of D+5.
- **The spray-notice scale and `aerial_ground`:** sjvair.com #338, in `@sjvair/sdk`
  `5.0.0-beta.13`.
- **The 2,000-match cap:** fits a valley-wide request (see above).
