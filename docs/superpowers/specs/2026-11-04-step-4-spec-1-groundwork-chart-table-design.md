# Release 1, step 4, spec 1: widget groundwork, Chart, and Data table

Date: 2026-11-04. Branch: `step-4-spec-1`, a stacked PR into `step-4` (itself from `main`).
Merging `step-4` into `main` needs the user's explicit yes.

Repo: **data-dashboard only.** If something is needed from sjvair.com, sdk-js, or map-sdk, tell
the coordinator session (`data-dashboard-2c`) and don't edit those repos or work around the SDK.

Mockups from the brainstorm are kept (git-ignored) in `.superpowers/brainstorm/`: the chosen
chart look is `chart-look-v2.html`, option A.

## Step 4's split

Step 4 (`TODO.md` → "Release 1, step 4") is six specs, each its own spec → plan → stacked PR into
`step-4`, in this order (agreed with the user 2026-11-04):

1. **This spec:** widget groundwork, Chart, Data table.
2. The shared place picker (monitors, regions, schools, points; "Use my location"; point
   resolution; location privacy). Second, so sjvair.com's location name search is likely out.
3. The Data Explorer (formerly "Widget Creation"; see below).
4. The "now" widgets: Current conditions, Forecast strip, "Can we go outside?", with heat and
   forecast data and client-side self-monitoring thresholds.
5. Calendars (day-colored, contribution) and the hour × weekday heatmap.
6. Notes and the starter dashboard.

Monthly, seasonal, and yearly views and region-summary views aren't shipped as done until
sjvair.com's summary bugs are fixed (`DEFERRED.md` → the summary entries under "Analysis & data").

## Why

Every later widget needs the same frame: a registry entry, its code loaded only when used,
shared loading/empty/error/retired states, a data feed that uses the browser cache well, and the
⋯ menu actions. Building those with the Chart and the Data table first gives two real widgets to
prove them on. The Chart is the widget most people will see first (the starter's PM2.5 chart);
the Data table is the accessible alternative to it and the researcher's way to exact numbers.

## Who it's for

- **A parent or teacher glancing at a PM2.5 chart** should see in a few seconds how the air has
  been lately (the user): the daily averages, and the bad stretches.
- **Researchers** want the exact numbers, to download as CSV (the user). Downloading must never
  require adding a widget.

## Goals

- A Chart widget showing one pollutant for one or more places over the widget's date range, in
  the chosen look (below).
- A Data table widget showing the same data as exact numbers.
- "Download data (CSV)" on every data widget, through one shared CSV export.
- The widget groundwork every later step 4 spec builds on.
- The new automatic resolution rule, applied in the data layer.

## Non-goals (this spec)

- Choosing data in a UI. The Data Explorer is spec 3; until then "Add widget" adds a Chart or a
  Data table with a default configuration.
- Non-pollutant layers on a chart (smoke days, temperature). They come with the Data Explorer's
  multiple layers in spec 3.
- Zooming or panning a chart. Changing the date range is how you look closer (deferred; see
  "Deferrals").
- Any place picker. Spec 2.
- Map code of any kind (step 5).

## Anti-goals

- A chart that makes ordinary afternoons look alarming. That's why the default is daily averages
  with the worst hour, not hourly spikes.
- Level shown by color alone, or level names invented in the dashboard.
- Growing the initial bundle (already over its 200 KB soft budget at about 205.5 KB gzip).

## Decisions

### The automatic resolution rule (the user)

Replaces the ladder in `src/lib/data/resolution.ts` (and the table in `ARCHITECTURE.md` →
"Data resolution & live refresh") for every widget and export, not only charts:

| Range span       | Resolution       |
| ---------------- | ---------------- |
| ≤ 3 days         | Raw entries      |
| ≤ 7 days         | Hourly summaries |
| ≤ 1 year (365 d) | Daily summaries  |
| longer           | Monthly          |

The user first proposed daily up to 3 months; they took the recommendation of daily up to a
year, because 12 monthly points would average a week of wildfire smoke into one mildly elevated
month, and monthly data carries the server's known summary bugs. The existing fallback rules
(nearest coarser offered level, else downsampling raw) are unchanged. Regions have no raw
entries, so a region at ≤ 3 days falls back to hourly as today.

### The worst hour (the user)

In daily views of **up to 3 months (92 days)**, each day also shows its **worst hourly
average**: the highest of that day's hourly summaries, not the summary's `maximum`. (The
server's daily `maximum` is the single highest raw reading, about 2 minutes long, so one sensor
glitch or a nearby barbecue can make a "Good" day spike; checked in sjvair.com
`camp/apps/summaries/aggregators.py`.) It's computed in the browser from hourly summaries
fetched in whole-month requests, so past months stay cached. Daily views from 3 months to a year
show averages only (fetching up to 8,760 hourly points per place to compute it was judged too
much).

- **Builder's call (mine):** daily averages still come from the server's daily summaries, and
  the worst hour from a second, hourly fetch. Both are cacheable. This keeps the average the
  same as the CSV's and the server's. The worst hour also records which hour it was (shown in
  the readout and the CSV).
- The worst hour is a query option the Chart, Data table, and CSV ask for, not a new
  resolution. It's ignored outside daily views of ≤ 92 days.
- **Single place only, everywhere (my call, from the builder check):** the Chart, the Data
  table, and the CSV show the worst hour only when the widget has one place. With several
  places it isn't requested at all, so the hourly fetch never multiplies by the number of places,
  and the CSV's worst-hour columns are left empty.

### The Chart's look (the user: option A)

- **Faint level bands** behind the plot, one per level of the entry type's **scale** (from the
  server's scale metadata, `@sjvair/sdk` 4.8.0-beta.4+: each level's `key`, `label`, `color`,
  `opacity`, `min`, `max`). Drawn at a low opacity so the line stays the strongest thing.
- **A navy daily-average line** (`--chart-1`) with small dots at each point.
- **Each day's worst hour as a light stick** (whisker) from the dot up to the worst hourly
  value, only when the chart shows a single place.
- **Band labels: the full level names, never abbreviations** (the user). The server has no short
  names, and "USG" is jargon to a parent. A label is drawn inside its band at the right edge,
  wrapped onto two lines when needed; a band too thin to hold it is left unlabeled.
- **A level key always shows under the chart** (the user): outlined swatches with the full level
  names, in the design pass's swatch-plus-label pattern, plus the series key (daily average,
  worst hour, and one entry per place when there are several).
- **The readout.** Hovering or tapping a point shows: the date (or date-time), the value with its
  unit, the level name with an outlined swatch, and, for daily single-place views, "Worst hour
  N, 3–4 PM". Arrow keys step through points when the chart has focus; Home/End jump to the ends.
  Formatting goes through `$lib/format` and Paraglide messages.
- **Several places:** each gets its own series color (`--chart-1…5`, in order) and its own dash
  pattern or marker, so color is never the only difference. The bands stay; the worst-hour
  sticks don't show.
- **How several places are stored, and the cap (my calls, from the builder check):** several
  places are **one pollutant layer with a `selection`** (`ARCHITECTURE.md`: `selection` is for
  several monitors or regions); a chart's other layers are reserved for non-pollutant data in
  spec 3. **A Chart holds at most 5 places** (one per series color), declared by the widget type
  (`accepts` gains a `maxPlaces`), which the picker (spec 2) and the Data Explorer (spec 3)
  enforce. A document that arrives with more (it's untrusted) shows the first 5 and a note that
  the rest aren't drawn; the Data table and CSV still include them all. **The Data table holds
  at most 10 places** as columns, the same way. The schema's `SELECTION_MAX` (500) stays for
  maps.
- **Gaps:** a missing period breaks the line; it's never drawn across.
- **Partial periods** (today so far) are drawn distinguishably (builder's call: a hollow last
  dot), and the readout says so.
- **Axes:** tabular figures on both; the unit from metadata on the value axis; Pacific dates,
  weeks start Sunday.
- **Redraws:** throttled to the end of a resize animation (closes `DEFERRED.md` → "Chart and map
  widgets redraw every frame of a resize animation").
- uPlot (MIT) draws it, added as a direct dependency. The bands, labels, and sticks are uPlot
  hooks or plugins; the key and readout are Svelte markup, so they're real text.
- One shared chart module (series styles, band drawing, readout, keyboard stepping) that later
  chart-like widgets reuse ("converge on a consistent, shared pattern", `ARCHITECTURE.md` →
  "Charting").

### The Data table (the user's purpose; the layout is my call, agreed by the user)

- **Wide on screen:** one row per period, one column per place. Each value shows its level name
  beside it; numbers use tabular figures; every column sorts (by keyboard too, with
  `aria-sort`).
- At the default 3-column size: date, value, level. Wider, it adds worst hour (single place,
  where computed) and min/max.
- Long tables scroll inside the widget with the header row kept in view.
- It shows the resolution used and "computed from raw data" where that applies
  (`ARCHITECTURE.md` already requires this).
- Its own "Download CSV" button produces the same file as the menu action.

### "Download data (CSV)" on every data widget (the user)

Resolves the open item in `DEFERRED.md` ("Download data (CSV) on every data widget"; remove it
from there). One shared CSV export on the data layer; every widget type with data gets the ⋯ menu
action (`analyzable` types, or a new `downloadable` flag; builder's call). Spec 3 adds a
"Download CSV" button to the Data Explorer, reusing it.

The file (my call, agreed by the user):

- **Long format:** one row per place per period.
- **Columns:** period start and end in Pacific time with the offset written out
  (`2026-10-25T00:00:00-07:00`); place kind, id or code, and name; pollutant (entry type id and
  label); unit; mean, min, max; worst hourly average and its hour, where computed; number of
  readings; resolution; `partial` (yes/no); `computed_from_raw` (yes/no). Column names are
  stable identifiers, not translated text; cell labels (place and pollutant names) come from
  metadata.
- No comment lines at the top. The file name says what's in it (dataset, place, dates), built
  like `src/lib/sharing/file-names.ts`.
- Saved through the platform adapter's `save(name, contents, type)`.
- The data is exactly what the widget shows (same range, resolution, and places), including a
  time sub-range if one is set.
- Attribution: the catalog's `source` and `license` are empty for most datasets for now
  (`DEFERRED.md` → "Open decisions" → "Dataset license and attribution text"); the CSV carries
  no attribution until that's decided, and that open item gains "CSV downloads" to its list.

### "Data Explorer" replaces "Widget Creation" (the user; built in spec 3)

Recorded now because it changes the docs and spec 3's starting point:

- The view is called the **Data Explorer**, so people know it's where to find data. It gets its
  own top-nav entry.
- **Data first:** pick the dataset, places, and dates, see the live preview, then choose how to
  show it (chart, table, calendar, heatmap), then **Add to dashboard** or **Download CSV**.
- Editing a widget opens the same view, with **Save changes** instead of Add to dashboard.
- Notes (and later the Map) are added directly from the dashboard's "Add widget", since they
  don't start from data.
- It doesn't overlap Release 3's Analysis view (Collections and computed analyses).

### Groundwork (my calls, agreed by the user)

- **SDK bump first:** `@sjvair/sdk` from `npm:@jsr/sjvair__sdk@4.8.0-beta.3` to `4.8.0-beta.5`,
  as the first commit, with whatever type fixes it needs (`MonitorData.grade` is now
  `string | null`; monitor types include `"cimis"`).
- **Levels from the scale.** `MetadataSource.levels()` reads the entry type's new `scale`
  (`getMonitorsMeta()` → entry `.scale`) instead of the old `levels` (which stays on the server
  for mobile). `Level` gains what the chart needs (`key`, `opacity`, `tier`, `min`/`max` with an
  open top level).
- **The widget-type registry** (`src/lib/widgets/registry.ts`) gets what this spec uses, in line
  with `ARCHITECTURE.md` → "Widget-type contract": the type's code is **loaded lazily** (a
  dynamic `import()` per type, with a small always-loaded descriptor: type id, label, sizes,
  icon, flags), default sizes of about 3 of 12 columns wide, `time`, `analyzable`,
  `resolution` pin, `dateMethods`, `span`. Registration and lookup get real tests (closes
  `DEFERRED.md` → "Weak tests in the widget registry and `applyChange`" for the registry half).
- **Shared widget states**, one component every widget type uses:
  - loading: a quiet placeholder in the widget's shape (no spinner flash for fast loads);
  - "No data for this range" when the server returns nothing;
  - error: a short message and a Retry button (`LiveQuery.retry()`);
  - unavailable: the reason in plain words (one message per `UnavailableReason`);
  - **retired or missing references** (`ARCHITECTURE.md` → "Stable ids and retirement"): the
    "stopped reporting" note, "Switch to the replacement", and the "no longer available" card
    with "Choose another" / "Remove". "Choose another" opens the Data Explorer once it exists;
    until spec 3 it's hidden.
    **What drives them (my call, from the builder check):** build the states the data can tell
    apart today. A retired dataset or entry type (catalog `retired`). A retired region: the web
    region resolver (`createWebRegionResolver`, `src/lib/data/adapters/registry.ts`) is extended
    to pass on the region's `retired: { since, replaced_by }` from `getRegionsByCode` instead of
    dropping it, so the widget can show "stopped reporting" with "Switch to the replacement"
    (when `replaced_by` is set), and `QueryState` carries it alongside the data. An unknown code
    is "no longer available". **Monitors' "stopped reporting" is deferred** (the server's
    retired-versus-never-existed lookup for monitors isn't built; `ARCHITECTURE.md` → "Stable
    ids and retirement"); an unknown monitor shows the error (with Retry) or "No data" state until
    step 4 spec 2 (`DEFERRED.md` → "An unknown monitor shows the error (with Retry) or 'No data'").
  - nothing to show yet (no place): fixes `DEFERRED.md` → "`LiveQuery` has no idle state for a
    null input" by giving `LiveQuery` an idle state.
- **Default title:** generated, "PM2.5 · Fresno County · Last 30 days" (pollutant label, place
  name, date range), from metadata and Paraglide messages, never stored; the user can rename.
- **Duplicate widget** in the ⋯ menu: the copy goes next to the original (same size), as one undo
  step.
- **"Add widget" until spec 3** offers Chart and Data table, each starting as Fresno County
  (`region`, `county`, `06019`) PM2.5, last 30 days. The placeholder type stops being offered
  (builder's call whether it stays registered for tests).
- **Cache-friendly requests.** The browser reuses its HTTP cache only for an identical URL
  (sjvair.com #301: settled periods `max-age=86400`, live ones 60 s, both with ETags). So:
  - **The rule (my call, from the builder check):** requests cover whole calendar units, and
    only the unit containing now is live. The server decides the cache from the request's end
    (`is_settled(resolution, timestamp__lt)` in sjvair.com
    `camp/api/v2/summaries/endpoints.py`), so a request that reaches now is short-cached as a
    whole; past units must be their own requests.
  - **The unit:** a **month** for hourly and daily summaries (and for the worst hour's hourly
    fetch), a **year** for monthly and coarser. Daily changes from today's year-sized
    single-monitor paths and 366-day bulk chunks to months: a 365-day daily view is about 13
    requests per monitor (or 13 bulk requests for regions), each of which, once past, is the
    same URL every day. The bulk path's `splitChunks` from the range start changes to these
    calendar-aligned units.
  - A "last 30 days" view is therefore the previous month (stable URL, long cache) plus the
    current month so far (short cache), and the rows outside the range are dropped in the
    browser.
  - The same shapes serve the Map widget later (step 5, through a map-sdk `DataSource`; see
    `../map-sdk/demo/date-range-source.svelte.ts`); no map code here.
- **Data-layer items due in step 4** (from `DEFERRED.md` → "Analysis & data"), fixed here:
  - "Refetch keeps the resolution chosen at creation": the query re-picks its resolution when a
    to-date range crosses a rule boundary.
  - "The rollup-lag backfill is one level deep and fetched on every poll": backfill the
    backfill's own last period from the next level down, and skip the backfill once the coarse
    value has arrived.
  - "Updating a subscription to an input with the same key detaches first": fix if the flash
    shows when duplicating or editing widgets; otherwise leave it deferred.
  - "The idle cache cap counts entries, not bytes": cap by approximate points held.
- **Bundle (the user, 2026-11-04):** uPlot and each widget type's component load only when a
  widget of that type is shown. **This spec also trims the initial bundle back under the 200 KB
  soft budget**, this once, by loading rarely used dialogs only when opened (restore an earlier
  version, share, conflict, move to account, and similar; builder picks which, by measured
  size). That covers the SDK bump and the always-loaded groundwork, with room left. Record
  `npm run check:budget` before and after in the PR. Closes item (4) of `DEFERRED.md` → "Code
  tidy-ups from sync spec 4"; a new entry says to revisit when the initial bundle goes over
  200 KB again (the user: revisit then, rather than trimming every time).

## Constraints (project rules that bite here)

- Metadata is the source of truth: labels, units, level colors and ranges, and resolutions come
  from the server's `…/meta/` endpoints and the dataset catalog.
- All UI text through Paraglide messages, no concatenated sentences, formatting through
  `$lib/format`; nothing English stored in documents.
- Pacific time, weeks start Sunday. CI isn't on Pacific time: match formatted times with an
  optional " PT", and test time-sensitive code with `TZ=America/New_York`.
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`). Level colors come from metadata,
  not tokens; text on a level color uses `readableColor`; swatches are outlined.
- WCAG 2.2 AA: keyboard stepping through chart points, sortable table headers by keyboard,
  reduced motion respected.
- Browser storage and file saving through the platform adapter only.
- Documents are untrusted: any new widget fields are schema-validated with size limits.
- Tests: browser tests wait with `animationsSettled(el)` (`src/test/animations.ts`) and use
  `page.viewport(1280, 800)` for desktop sizes.

## Testing (what must be shown)

- Unit: the new resolution rule at each boundary; the worst-hour computation (including DST
  days with 23 and 25 hours, and missing hours); calendar-aligned request splitting and the
  settled/live split (the same URL for a past month across days); CSV rows and file names.
- Browser: Chart renders bands, labels, key, sticks, gaps; readout by pointer and keyboard;
  multi-place series differ by more than color; Data table sorting by keyboard; each shared
  widget state; Duplicate; "Download data (CSV)" saves through the adapter.
- E2E: add a Chart and a Data table on the local stack (Fresno County PM2.5), see data, download
  a CSV. Locally summaries have gaps; rebuild a **scoped** range to test with
  (`rebuild_summaries <start> <end> --region <id> --regions-only`), never an unscoped one.
- Accessibility: axe on a dashboard with both widgets, light and dark.
- `npm run check:budget` before and after.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Zoom and pan on charts.** Why: changing the date range covers looking closer, and zoom
  needs its own keyboard design. Revisit when people ask to zoom, or with the Analysis view.
- **The worst hour beyond 3 months.** Why: up to 8,760 hourly points per place per view.
  Revisit if people ask for it on longer daily views, or if the server adds a daily
  worst-hourly-average to its summaries (the better fix; it would also cover regions cheaply).
- **Worst hour with several places** (chart, table, and CSV). Why: overlapping sticks are
  unreadable, and the hourly fetch would multiply by the number of places. Revisit with a
  different mark if people ask, or if the server adds a daily worst-hourly-average.
- **"Stopped reporting" for monitors.** Why: there's no server lookup telling a retired monitor
  from one that never existed. Revisit when sjvair.com adds it (tell the coordinator).

## Docs changed with this spec

- `ARCHITECTURE.md`: the resolution table; "Widget Creation view" renamed "Data Explorer" with
  the data-first flow; the Charting section (option A, worst hour, labels, key); the Data
  table's role; "Download data (CSV)" on every data widget.
- `DEFERRED.md`: the deferrals above; remove the CSV open item and the bundle item (4); add
  the "over 200 KB again" entry; add "CSV downloads" to the
  attribution open decision.
- `TODO.md` / `ROADMAP.md` step 4 sections: the six-spec split and the rename.

## Left to the builder

- uPlot plugin structure, the exact band opacity (as long as text and the line keep contrast in
  both modes), stick and dot sizes, and the dash patterns per series.
- How the lazy registry is shaped (descriptor plus loader), as long as the initial bundle
  doesn't grow.
- Whether the worst hour lives on `SeriesPoint` or alongside it.
- Message wording for the states, within the design pass's tone ("this browser", plain words).
