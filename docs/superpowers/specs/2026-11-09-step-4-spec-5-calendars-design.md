# Release 1, step 4, spec 5: the calendars

Status: approved by the user 2026-11-09 (brainstormed the same day). Checked by a fresh
builder read; its questions are answered below (one by the user: today's cell).

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.
Mockups shown in the brainstorm (throwaway; this document is the record): the heatmap coloring
(kept, because the user asked to show it to others:
`docs/superpowers/mockups/2026-11-09-step-4-spec-5-heatmap-coloring.html`), the month calendar's
cell states (`calendar-states-v2.html`) and the contribution calendar's level marks
(`contribution-v4.html`). The last two used real Fresno – Garland data from a one-time,
read-only pull of public sjvair.com data that the user approved.

## Where this sits

Step 4 is seven specs into `step-4`. Specs 1, 2, 3, 3b and 4 are merged (#36, #38, #40, #43,
#45), and `origin/main` was merged into `step-4` for this spec (#46). This spec adds the two
calendar widget types from `ARCHITECTURE.md` → "Widget catalog". **The hour × weekday heatmap,
planned for this spec, was dropped by the user** ("drop it, just do the two calendars"; see
`DEFERRED.md` → "Dropped"). Spec 6 (Notes and the starter dashboard) puts a day-colored calendar
("this month") on the starter.

A parallel server + SDK session (sjvair.com, then sdk-js, through the coordinator) publishes what
the day coloring needs. It ends in `@sjvair/sdk` **5.0.0-beta.8**, which the coordinator pins
here. See "Dependency" below.

## Why

The Chart answers "how did it change?" hour by hour. A calendar answers the question people
actually ask about a stretch of time: "how many bad days did we have, and which ones?" A parent
looks back on a smoky week, a teacher checks this month, a researcher scans a year for the
smoke season. The month calendar is the familiar view; the contribution calendar is GitHub's
"a year at a glance".

## Who it's for

- **A parent or teacher:** "This month" at their school or ZIP; how many days were at or above
  the level they care about.
- **A community member:** the last 12 months at a monitor near them, to see when the bad season
  was.
- **A researcher:** a run of days selected, summarized, then opened in a Chart for the hourly
  detail.

## Goals

- Two new widget types, `time: "range"`, resolution pinned to `"day"`, lazily loaded, set up
  through Get data:
  - **Day-colored calendar:** month grids (weeks as rows, Sunday first); several months side
    by side, wrapping to the widget's width, for a longer range.
  - **Contribution calendar:** GitHub's layout (one column per week, Sunday at the top, month
    labels along the top).
- Each day colored by **the daily figure that matches its pollutant's scale**, the way EPA's
  daily AQI does it (the user: "the matching figure for each pollutant"). Colors and breakpoints
  from metadata.
- A display-only threshold: days at or above a chosen level marked and counted.
- Day-range selection with a summary of the selected days and "Open these days in a chart".
- Partial, unrateable, missing and future days each visibly different, never by color alone.

## Non-goals

- The hour × weekday heatmap (dropped) and a heatmap layer over the map (a Map / map-sdk idea,
  in `DEFERRED.md` → "Map plugins").
- **Data other than air quality** (weather, smoke, pesticides, forecasts) in a calendar. The user:
  "keep it to air quality and defer the rest". Build so adding one later is registration, not a
  rebuild (see "What a calendar shows").
- Several places or several pollutants in one calendar.
- Alerts, toasts or notifications from a calendar (display only, like the Chart's line).
- Linking a calendar to other widgets (cross-filtering stays deferred). "Open these days in a
  chart" creates a new, independent widget.
- Collections, "Mark selected data for analysis" and "Analyze selected data" (Release 3). The
  selection is stored where Release 3 will read it.
- A quick range switch on the widget itself (the user: "Get data only").

## Anti-goals

- **A day colored by the wrong figure.** A daily mean against a 1-hour scale (ozone, NO2, SO2) or
  an 8-hour one (CO) almost never leaves Good. The calendar never does that. When a matching
  figure isn't available, it says so instead of coloring.
- **A gap that reads as a good day.** Days without enough data, or with none, are never colored,
  and never counted as below the threshold.
- **Meaning by color alone.** See "Showing the level without color alone".
- **Hardcoded scales.** Which figure colors a day, the completeness rule, levels, colors, units
  and precision all come from the server.

## Dependency: the server's daily figure (settled with the server session, 2026-11-09)

The user's decision: each pollutant's day is colored by the daily figure matching its scale's
averaging period, **because this is how EPA does it** (the reason stays in docs; the UI doesn't
mention EPA). The 24-hour scales (PM2.5, PM10) use the daily mean. The 1-hour scales (O3, NO2,
SO2) use the day's highest hourly average, and CO's 8-hour scale uses its highest 8-hour
average. The server says which applies:

- **`monitors/meta/` `entries.<type>.scale`** gains `averaging_hours` (24, 1 or 8; null for the
  AQI forecast scale and category scales) and **`daily_statistic`**: the name of the daily
  summary field that colors a day (`mean_24h` for PM, `max_1h` for O3/NO2/SO2, `max_8h` for CO; null
  where `averaging_hours` is null). **The calendar reads the field `daily_statistic` names. It
  never maps pollutants itself.**
- **Daily summary rows** (monitor, region, bulk) gain `max_1h` and `max_8h`. Each is null when
  the type doesn't use it or the day fails EPA's completeness rule (75% of the day's hours, or of
  CO's 8-hour windows), unless the peak already reaches the standard.
- **The 18-hour rule for 24-hour scales** (the user: "yes, use the 18-hour rule"; the user chose
  the shape with the server session, 2026-11-09): daily rows (monitor, region, bulk) also gain
  **`mean_24h`**, the mean of the hourly means of the day's hours with data, null when fewer than
  ceil(0.75 × n) of the day's n hours have data (18 of 24 or 23, 19 of 25), with no exception.
  For PM2.5 and PM10, `daily_statistic` is `mean_24h` (not `mean`). So for every pollutant:
  **read the field `daily_statistic` names; null means "Not enough data".** `mean` and
  `is_complete` are unchanged. Hourly means at or below −900 (old AirNow −999 rows) count as no
  data in the daily figures.
- **Today's running figure** (the user, 2026-11-09: today is colored "so far", option A over
  an uncolored "In progress"): the completeness rule leaves today's figure null for most of the
  day (PM until about 6 pm), so the server also publishes a running figure for the day in
  progress, without the completeness rule, and marks it as not final. There was no daily row
  for the open day (daily rows are written once, after the day ends), so this is new server
  work. **The shape (the user with the server session, 2026-11-09):** when a daily request
  (monitor, region, bulk) covers the open Pacific day, the response includes a row for today,
  computed on request from today's complete hourly rows (60 s cache): `mean_24h` = the mean of
  the hourly means so far, `max_1h` = the highest so far, `max_8h` = the highest valid 8-hour
  window so far (≥ 6 of 8 hours), with no 75% rule. **Every daily row gains `is_final`** ("can't
  change anymore"); finished days stay strict. Settled 2026-11-09 (the user with the server
  session): open days come from separate endpoints next to each daily list (monitor, region,
  bulk), returning computed rows (`is_final: false`) for today and for any earlier day whose
  nightly row doesn't exist yet, until about 03:00 Pacific; stored rows are `is_final: false`
  until settled (yesterday until about 3 am, CO's yesterday until 28 h after the day ends). The
  SDK gets one helper that fetches a range plus its open days and merges them. **The calendar's
  rule:** `is_final: false` today = "so far"; `is_final: false` on an earlier day = "Not final
  yet"; a missing row = "No data". The dashboard never computes any of this from hourly rows. A finished day stays strict.
- **CO settles late:** CO's 8-hour windows start during the day, so a day's `max_8h` is final
  only about 28 hours after the day ends (the server re-rolls the previous day nightly).
- **Field names in the SDK** come with beta.8. No dashboard code reads them until the coordinator
  pins beta.8.

## Decisions

### What a calendar shows

- **One place, one air-quality pollutant** (`accepts: { datasets: ["air-quality"],
  maxPollutantLayers: 1, maxPlaces: 1 }`); any place kind a Chart takes (monitor, region,
  school or point).
- **Exactly one layer, and it must be a pollutant with a level scale (my call).** The
  `air-quality` dataset also has meteorological and other entry types (temperature, humidity,
  particulates), which `maxPollutantLayers` doesn't count. A calendar is greyed out in Show as,
  with a new reason, when the data has no pollutant layer, an extra layer of any kind, or a
  pollutant whose scale has no levels. (New `TypeBlock` reason and message; tests.)
- **Daily summaries only.** Each cell is one daily summary row from the query client, with the
  resolution pinned to `"day"`. The dashboard computes nothing for a cell. The calendar doesn't
  ask for the Chart's browser-computed `worstHour` (it uses the server's `max_1h`).
- **Built for more data later (my call):** the cell's figure, level and "rated" state come from
  one function of (dataset metadata, entry type, daily point). It reads `daily_statistic` and the
  scale and has no air-quality branch beyond what the metadata says, so a future dataset is added
  by listing it in `accepts.datasets` and answering its own questions (see `DEFERRED.md`).

### The day's figure and rating (before and after beta.8)

- **Rated day:** a daily row whose `daily_statistic` field is a number. Its level is the scale level containing that value (half-open ranges, as
  everywhere).
- **Not enough data to rate:** a row exists, but its `daily_statistic` field is null.
- **No data:** no row for the day.
- **Today:** the row with `is_final: false` for today's date, shown "so far", colored by its
  `daily_statistic` field (the running figure; see "Dependency"), never by `mean` or a browser
  computation. Its level is the level of that
  figure. If the server has no running figure yet (no hours today), today shows "No data so
  far".
- **Not final yet:** a CO day inside the server's settling margin (yesterday, until the row
  settles). **Also yesterday for every pollutant before it settles** (about 3 am): the server's
  open-day rows and `is_final` cover it, so the calendar reads one flag, never a time.
- **Still to come:** a date in the range after today.
- **Before beta.8 (my call, builder's order):** the grids, states, selection, summary, chart
  action and threshold marks are built and tested against fixtures. In the running app, a
  pollutant whose scale has levels but no `daily_statistic` (every pollutant until beta.8) shows
  its days as unrated, with one note on the widget that the server doesn't say which daily
  figure rates this pollutant. It never falls back to the mean.
- **The adapter splits "today" from "not enough data" (my call).** `toPoints` in
  `air-quality-fetch.ts` merges "period still open" and `is_complete === false` into `partial`.
  The calendar needs them apart: the point carries whether its period is still open, and
  rateability comes from whether the `daily_statistic` field is null, not from `is_complete`.
- **Tooltip and accessible name** name the figure ("Daily average", "Highest hourly average",
  "Highest 8-hour average"). **The name comes from server metadata** next to `daily_statistic`
  (the user, 2026-11-09, with the server session: `scale.daily_statistic_label`, translatable;
  "24-hour average", "Highest 1-hour average", "Highest 8-hour average"; null otherwise), not from dashboard messages. Only a missing label falls back to one
  dashboard message, "Daily value" (my call). No EPA mention.

### Day-colored calendar (the user approved the mockup)

- Month grids, weeks as rows, Sunday first (`$lib/format`'s week constant). A longer range shows
  several months side by side, wrapping to the widget's width; the widget scrolls vertically
  when they don't fit (my call).
- **Default range: "This month"** (to-date month). The whole month's grid is drawn, with days
  still to come left blank, so the calendar keeps its shape early in the month (my call).
- **Span (my call):** 1 day to 12 months (366 days); beyond that the type is greyed out in Show
  as with the span reason.
- **A rated cell:** the level color (with an outline, WCAG 1.4.11), the day number, the value
  (metadata precision, through `formatValue`), and the level label. Text uses `readableColor`.
  When the cell is too small for the label, it shows the tier number instead (`tier` from
  metadata) (my call). If even that doesn't fit, the widget's minimum size is too small: set the
  minimum so a tier always fits.
- **Other states:** not enough data = grey stripes, greyed value (if any), "Not enough data";
  no data = grey, "—", "No data"; today = a dashed outline and "so far" after the level;
  not final yet = dashed white, "…", "Not final yet"; still to come = a faint outline, day
  number only.

### Contribution calendar (the user approved the mockup, option C with a switch)

- One column per week (Sunday at the top), month labels along the top, weekday labels on the
  left (Sun, Tue, Thu, Sat, as GitHub does).
- **Default range: "Last 12 months"** (the user). **Span:** at least 1 week (7 days), at most
  about 2 years (731 days) (my call).
- **Cells are the level color only** (GitHub-like), with an outline. A **"Show patterns"**
  switch, **on by default**, adds a per-level pattern: Good plain, Moderate dots (the denser
  5 px grid the user preferred over 4 dots), Unhealthy for Sensitive Groups diagonal stripes,
  Unhealthy cross-hatch, tier 4 levels horizontal lines, drawn in the `readableColor` ink. The
  patterns follow the level's `tier` (Very Unhealthy and Hazardous share tier 4 and its
  pattern; the legend and tooltip still tell them apart) (my call).
- **The switch is a per-viewer preference** (platform preferences, per space), not saved in the
  document, and applies to every contribution calendar the viewer sees (my call). It sits in the
  widget's ⋯ menu as a checkbox item (my call; the builder may choose another visible place).
- **Other states** match the month calendar, drawn small: stripes, grey, dashed outline (today),
  dashed white (not final yet), faint outline (still to come).
- **Long ranges scroll sideways** inside the widget, starting scrolled to the latest week (my
  call). The month and weekday labels stay put.
- **Legend:** a swatch per level present in the scale up to one above the highest shown (my
  call), plus "Not enough data", "No data" and the threshold mark, under the grid. Swatches use
  `LevelChip` or the same outline and ink rules.

### Showing the level without color alone

`ARCHITECTURE.md` requires calendar cells to show the level's label, tier or an icon. The month
calendar does (label, or tier when small). The contribution calendar does when "Show patterns"
is on (the default). **With patterns off, it shows color only**: the user's informed choice for
that viewer, recorded here and in `ARCHITECTURE.md` → "Accessibility" as the one exception. In
every mode each cell's tooltip and accessible name give the date, figure, value, unit and level.

### Threshold (the user: "mark those days and show the count, display only")

- `thresholds: true` on both types: the widget stores `WidgetInstance.thresholds` (at most one
  `{level}`), set in Get data with the existing alert-level control (`ThresholdLineControl`),
  **off by default**, as on the Chart. The watcher ignores calendars (it watches only "now"
  types), so there are no toasts or notifications.
- **Mark:** a small ▲ in the corner of each rated day at or above the level (month calendar), a
  small corner triangle on the contribution calendar, in the readable ink. The legend explains
  it.
- **Count line** above the grid: "▲ 36 of 39 rated days at or above Moderate" (the user approved
  this wording). When the range spans more than one month and includes this month, a second
  count follows: "8 of 9 in November so far" (my call).
- Only rated days count, in both numbers. Today counts once its figure so far reaches the level
  (it's "so far") (my call).
- A stored level key the pollutant's scale doesn't have draws no marks, with a note, as the
  Chart does (spec 4's Ruling 1).
- Switching to or from a Chart carries the level both ways (both are display-only lines/marks);
  to or from a now tile follows spec 4's rules for a Chart (my call).

### Selecting days (the user: "the summary plus open in a chart")

- **Pointer:** click a rated or unrated past day to select it; drag, or Shift-click, to extend.
  Clicking the only selected day again, or pressing Escape, clears it. Future days can't be
  selected.
- **Keyboard (my call; the standard date-grid pattern):** the grid is one Tab stop (roving
  tabindex). Arrows move the focus day (on the contribution calendar Up/Down is the previous/next
  day and Left/Right ±7 days), Home/End the week's first/last day, Page Up/Page Down a month.
  Space or Enter selects the focus day, Shift+arrow extends the selection, Escape clears it.
- **Look:** a navy ring (theme token) around each selected day, so the level colors stay
  visible. Not by color alone: the summary line names the selected dates, and each cell's
  accessible name adds "selected".
- **Stored as `WidgetDataConfig.timeSubRange`** (`{start, end}`, Pacific dates), through
  `applyChange`, so it autosaves, syncs, survives a reload, shows in share links and undoes (one
  undo step per click, Shift-click or finished drag) (my call). Release 3's "Analyze selected
  data" reads it.
- **The calendar's own query ignores `timeSubRange`** (the selection highlights; it doesn't
  narrow the fetch). `chartInput` passes `timeSubRange` through, so the calendar builds its
  input without it.
- **Read-only and shared views (my call):** selecting works but stays in memory (not saved), so a
  viewer can explore without editing.
- **Range changes (my call):** when a new date range no longer contains the whole selection,
  the selection is cleared in the same change. A relative range that rolls forward on its own
  ("This month" on the 1st, "Last 12 months") isn't an edit: the stored selection is kept and
  only its part inside the current range is shown and summarized; none of it inside means no
  selection is shown.
- **Switching type (my call):** switching a calendar with a selection to a type that isn't a
  calendar (Chart, Data table, a now tile) clears `timeSubRange`, with a "left out" note naming
  the selected days, because a Chart narrows its x range to `timeSubRange` and Get data has no
  control to show or clear it. Calendar ↔ calendar keeps it.
- **Summary line** under the grid while a selection exists: dates (`formatDateRange`), number of
  days, the average of the rated days' figures, the worst day (weekday date, value, level chip),
  and, with a threshold, how many are at or above it. Unrated days in the selection are named
  ("2 days not rated") and left out of the average (my call). Days with a different figure
  (`max_1h`) are averaged as they are; the line names the figure with the server's label inside
  a message placeholder (no concatenation; the label is used as given, so the message is worded
  to work with a capitalized label, e.g. "Average · {figure}") (my call). "Esc clears" hint. A
  polite live region announces the summary after a selection settles.
- **"Open these days in a chart"** in the widget's ⋯ menu, shown only while a selection exists
  (also on the keyboard: the widget menu shortcut). It adds a Chart widget with the same layer,
  a `custom` date range of the selected dates, `resolution` automatic (so a few days show
  hourly), and the calendar's threshold as the Chart's line. It's placed like "Duplicate
  widget" (`copyPlacement`) and is one undo step. Not offered on read-only views.

### Get data

- Both types appear in **Show as** by registering descriptors (`dataTypes()`), with
  `resolution: "day"` (hiding "Show values"), `span`, and the default date ranges above.
- **Switching to a calendar** follows Get data's existing rule for range types: a type that
  can't show the current data (more than one place, a dataset it doesn't accept, a span outside
  its limits, more than one pollutant layer) is greyed out with its reason; switching keeps the
  data. (My call. In the brainstorm I said switching would keep only the pollutant with a "left
  out" note; this spec keeps the existing rule instead, so Chart ↔ calendar works like
  Chart ↔ Data table. The user can overrule.) The "left out" note only applies where a type
  converts, which stays the now types' path (`toNowDraft`/`fromNowDraft`); converting a now
  tile to a calendar keeps its place, pollutant and threshold and gets the calendar's default
  range.
- **A calendar's default date range** applies when switching to it from a now tile or when a
  new calendar is created. Switching from a Chart keeps the Chart's range if the span allows.

### The three place spots (`project-new-widget-type-checklist`)

Both types must be handled in all three places, using one shared calendar input (the calendar's
main layer, its date range, resolution `"day"`, no `timeSubRange`, no `worstHour`):

1. `src/lib/sharing/points.ts` `lookupInput`: the exact-point-to-region swap uses the calendar
   input, so the region is the one the calendar shows.
2. `PlacePickerDialog` `regionOf`: the same input for a calendar.
3. Get data's type switch (above), including now → calendar conversion.

### Sizes (my call)

- Day-colored: default about 4 × 6 cells (one month readable with labels), minimum where a tier
  number still fits.
- Contribution: default the full row (12 of 12 columns) × about 3 rows, so 53 week columns fit at
  about 12–16 px; minimum 3 wide (it scrolls).
- Phones (one column) work: the month calendar stacks months, the contribution calendar scrolls.

### Bundle

- Descriptors stay light: no data-layer imports, the component behind `load` and `loadLazy`. The
  icon is a small lucide icon like the other types'; if the budget grows, the builder may make
  the icons lazy for all types. Run `npm run check:budget` after each task that adds imports.
  The initial bundle is 202.1 KB against the 200 KB soft budget, accepted by the user for now;
  raise any growth past about 0.5 KB with the user rather than trimming silently.

## Accessibility (WCAG 2.2 AA)

- The grid is a `role="grid"` with a label (the widget title), rows and `gridcell`s; each cell's
  accessible name: weekday date, figure name, value and unit, level (or the state), "at or above
  {level}", "selected". The month calendar's visible label/tier and the contribution calendar's
  patterns cover WCAG 1.4.1 (except a viewer's own "patterns off", above).
- Keyboard selection as above (every drag has a keyboard alternative); a visible focus ring
  distinct from the selection ring.
- The selection summary and the threshold count are text; the summary is announced politely.
- Text on level colors uses `readableColor`; cells and swatches are outlined (3:1).
- Reduced motion: no animated selection or scroll.
- "Download data (CSV)" (`downloadable: true`) is the full-numbers alternative. **Its daily rows
  gain the figure that colors the day (my call):** a column named by the figure's server label ("Highest hourly
  average") and a "Rated" column (yes / not enough data), once beta.8 lands. The Data table's
  matching column is deferred (see Deferrals).
- Both light and dark modes checked (axe), including a yellow (Moderate) cell.

## Constraints (project rules that bite here)

- Metadata is the source of truth: `daily_statistic` and its label, levels, colors, tiers, units, precision,
  completeness. No pollutant names in calendar logic.
- Paraglide messages, no concatenation, keys matching their text; dates and numbers through
  `$lib/format` in Pacific time (add helpers there, e.g. a day-count or week-column helper,
  never in a component). Weeks start on Sunday from the format module's constant.
- Saved fields schema-validated: `timeSubRange` and `thresholds` already have schemas; check the
  calendar types against them. No generated English saved.
- Preferences ("Show patterns") through the platform adapter.
- Theme tokens only (the token-discipline test); level colors come from metadata, the selection
  ring and states from tokens.
- SDK pinned (`5.0.0-beta.7` until the coordinator pins beta.8). Anything missing goes to the
  coordinator, never worked around here.

## Testing (what must be shown)

- **Unit:** day state from a daily point (rated, not enough data, no data, today, not final,
  still to come), driven by a fixture scale with `daily_statistic` `mean_24h`, `max_1h` and
  `max_8h`, and by one without `daily_statistic` (unrated with the note); level lookup at a
  breakpoint; threshold counts (only rated days, today "so far", two-number form across
  months); the selection summary (unrated days excluded, worst day tie → earliest (my call));
  week columns and month labels across a year boundary and a daylight-saving change; Sunday-first
  month grids. Run under `npm run test:unit:tz` too.
- **Browser:** each calendar's cell states; label vs tier at small sizes; patterns on and off;
  the threshold mark and count; pointer and keyboard selection (click, drag, Shift-click,
  Shift+arrows, Escape, Page Up/Down), the summary and its announcement; read-only selection not
  saved; "Open these days in a chart" adds a Chart with the right range, layer and line, in one
  undo step; scroll to the latest week.
- **E2E:** Get data → Show as → each calendar → preview → Add; switching Chart ↔ calendar
  (greyed with reasons for several places and for weather layers); a share link with a point
  place swaps to its region for a calendar; axe on both calendars in light and dark.
- **Stack check** once beta.8 is pinned: an ozone monitor's month calendar colored by
  `max_1h`, a PM2.5 VOZBox's by `mean_24h`, a day under 18 hours as "Not enough data", and CO's late
  day if any local CO data exists. Local data is incomplete (the stack runs part of each day), so
  expect many unrated days; rule out downtime before calling one a bug.
- `npm run build && npm run check:build && npm run check:budget`; `gh pr checks` after pushing.
- **Copy review:** a fresh-eyes subagent checks each new string where it renders; the PR lists
  every new key and its English for the user's approval. Notes in the `get_data_*` voice: the
  reason, then the consequence, then what to do.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Other data in the calendars** (weather, smoke days, pesticide use, forecasts). The user: keep
  spec 5 to air quality. Each needs its own daily figure from metadata, and coloring for scales
  without levels; smoke days (HMS, one category per day with levels) are the likely first.
  **Revisit when** someone asks for a non-pollutant calendar.
- **The Chart's worst hour could use the server's `max_1h`.** The Chart computes each day's worst
  hourly average in the browser from hourly summaries (`worst-hour.ts`, up to 92 days, no
  completeness rule). Once `max_1h` exists for every pollutant with summaries the Chart could read
  it instead, saving the hourly fetch. **Revisit when** beta.8 is pinned and the Chart's daily
  view is next touched.
- **The Data table's column for the day's figure.** The calendar's CSV gets the figure that
  colors a day; the Data table still shows the daily mean, which for ozone, NO2, SO2 and CO isn't
  the colored number. **Revisit when** the Data table is next touched, or a screen-reader user
  needs the figure in the table.
- **Several places in one calendar** (one row of calendars per place). One place keeps cells
  readable. **Revisit if** people ask to compare places by day.
- Already recorded with this brainstorm: the heatmap widget (Dropped) and a heatmap layer over
  the map ("Map plugins").

## Docs changed with this spec

- `ARCHITECTURE.md`: "Widget catalog" (both calendars as designed, the day's figure and the EPA
  reason); "Widget-type contract" examples (spans, defaults); "Accessibility" (the "Show patterns"
  exception); "Metadata as source of truth" (`averaging_hours`, `daily_statistic`, `max_1h`,
  `max_8h`, once beta.8 lands); the heatmap drop is already recorded.
- `TODO.md`/`ROADMAP.md`: step 4's sections only.
- `DEFERRED.md` as above.

## Left to the builder

- **Code shape:** components, file names, how the day-state function and the calendar input are
  shared, how the selection drag is implemented, and how the beta.8 fields reach the adapter
  (keep the adapter's `SeriesPoint` lean: add the figure and a rated flag, not every field).
- **Small calls:** exact sizes, pattern geometry, label and tier breakpoints, where the "Show
  patterns" switch sits, the count line's layout on narrow widgets.
- **Wording:** every message. New English strings go to the user with the PR.
