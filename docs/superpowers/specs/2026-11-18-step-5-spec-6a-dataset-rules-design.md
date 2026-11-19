# Release 1, step 5, spec 6a: dataset rules

_Brainstormed with the user 2026-11-18 (session for spec 6, which the user split: dataset rules
first as 6a, then "Show in a chart" / "Show in a table" as 6b). Branch `step-5-spec-6a`, from
`origin/step-5`, PR into `step-5`._

## Intent

The dashboard is a data-analysis toolbox for parents, teachers and students, researchers and
agencies. Today a widget can mix data that doesn't line up: a Map shows 2026 monitors beside
2023 pesticide use (5b's separate `usePeriod`), and a Chart draws daily PM2.5 beside monthly
pesticide totals (the strip falls back to months). The user, 2026-11-18: "People should be
limited to only creating valid datasets which can be used for data analysis. You can't analyze
data that doesn't line up."

This spec defines a **dataset** and makes every widget follow it, so a mixed dataset can't be
built, saved or drawn.

## The rule (exact text for `ARCHITECTURE.md` and `CLAUDE.md`; for the user's approval)

> **Datasets line up (dashboard only).** A dataset is the set of layers in one widget. Every
> layer in it covers the same date or date range and uses the same data resolution. The
> dashboard never mixes times (for example 2026 monitors with 2023 pesticide use) or resolutions
> (for example daily PM2.5 with monthly pesticide totals) in one dataset. A dataset not offered at
> the chosen resolution can't be selected. Comparing two time windows is two datasets, each
> following this rule (a later feature).

The rule covers the dashboard only, not monitor-map or mobile (the user, 2026-11-18). The
`CLAUDE.md` line goes under "Platform & auth rules" and points to the `ARCHITECTURE.md` section.

## Goals

1. One stored data resolution per dataset, used for every layer.
2. Get data offers only what lines up: datasets not offered at the chosen resolution, and
   resolutions a chosen dataset doesn't offer, are greyed out with the reason.
3. **Automatic** adapts to the range and the datasets, and says when the datasets moved it.
4. At Monthly or coarser, ranges are whole periods.
5. The Map follows the same rule: one range, one resolution, stepping through each period.
   Pesticide use follows the Map's range (5b's separate `usePeriod` goes).
6. Monthly and coarser monitors and region fills on a Map use the **daily scale**, coloured by
   the server's new average of daily figures.
7. Charts and Tables draw every layer at the one resolution (no whole-month strip bars on a daily
   chart, no monthly value repeated down daily rows).
8. Coarse summaries come from the server's stored rows; the data layer stops filling ended and
   current coarse periods from finer levels.
9. No compatibility code for earlier shapes (the user, 2026-11-18: nothing has reached
   production, so only test documents exist). An earlier document still opens without errors,
   since the schemas drop unknown keys; it just loses the dropped settings.

## Non-goals

- "Show in a chart" / "Show in a table" from a Map's marks, choosing which places to keep, and
  the section card's chart: spec 6b.
- Comparing two datasets (two time windows side by side): deferred (see "Deferrals").
- A weekly resolution: deferred (the server has no weekly summaries).
- An hourly or finer Map: deferred.
- Schools and child care as a Map data set: its own spec after 6b.

## Anti-goals

- Never quietly change a resolution the person chose. Only Automatic moves, and it says why.
- Never draw a figure stretched past the range (a whole month's total for a 7-day range).
- Never compute in the dashboard what the server should give (the average of daily figures, the
  current period's row).
- Never hardcode which daily figure a pollutant uses: the metadata names it.

## Constraints

- **Server and SDK first** (the user, 2026-11-18). sjvair.com adds the average of daily figures
  and nightly rows for the current period (spec `e35c65fd` in sjvair.com, under the user's review),
  and `@sjvair/sdk` `5.0.0-beta.15` follows. Tasks that read the new fields wait for the server
  PR and the beta.15 pin; there is no interim "greyed out" phase. Names, settled with the user:
  - Row fields on monitor and region summaries coarser than a day (null on hourly and daily rows
    and on types without a `daily_statistic`): `daily_statistic_mean` (null when fewer than 75%,
    rounded up, of the expected days have a figure), `daily_statistic_days`,
    `daily_statistic_expected_days`.
  - Scale keys in `monitors/meta/`: `period_statistic` (`"daily_statistic_mean"` when
    `daily_statistic` is set) and `period_statistic_label`.
  - Every past period has a stored coarse row, final or not. Each night (monitors 02:15,
    regions 02:20 Pacific) the server writes, for each coarse resolution, the period holding
    yesterday, through yesterday, with `is_final: false`; on the 1st that is the just-ended
    month in full. No row exists for a period that starts today (until the next night) or for a
    night the task doesn't run: those draw as no data, with the usual reason. Today stays on
    `daily/open/`.
  - CO's coarse rows may stay not final for up to 28 hours after the period ends (open with the
    user; nothing in the dashboard depends on it).
- **map-sdk `0.1.0-beta.21` first** (from spec 6's brief, now this spec's first task): it fixes
  the lens flash; it adds `GlMapLike.isSourceLoaded`, unused here, and no message keys. Check the
  lens by hand, then remove DEFERRED's lens-flash entry. Nothing newer without the coordinator.
- Shapes are free before Release 1 ships: redefine stored shapes in place, no version bump, and
  no reading of the old shapes (the user, 2026-11-18).
- The Map's fallbacks are drawn, not saved.
- Metadata is the source of truth for labels, units, scales, which daily figure, and which
  resolutions a dataset offers (the dataset catalog's `resolutions`, with the adapters'
  `offered`).
- No server, SDK or map-sdk changes from this repo; gaps go to the coordinator.

## Approaches (how the rule is enforced)

- **A. One stored resolution per dataset and a shared rules module (the user picked A).** The
  widget's data holds one `resolution`; a shared module answers every question the rule raises
  (what's offered, what Automatic picks and why, the whole-period range); Get data, the query
  client, Chart, Table and Map all use it. Older documents are read into the new shape.
- **B. Keep the per-layer field and enforce only in Get data.** Smaller, but a share link, an
  import or an older document can still carry a mixed dataset, and each widget needs its own
  checks.
- **C. A on screen, with the data layer refusing mismatches** instead of the shape preventing
  them. Problems show late, as an error on the widget.

A is the only one where every dataset everywhere follows the rule.

## Decisions (the user's, 2026-11-18, unless marked _my call_)

### The stored shape

- `WidgetDataConfig` gains `resolution?: Resolution` (the existing levels: raw, hour, day,
  month, quarter, season, year). Missing means **Automatic**; Automatic is never stored.
- `Layer.resolution` goes, with no reading of the old field: an earlier document's per-layer
  resolution is dropped by the schema (it opens as Automatic).
- Widget types that pin a resolution today keep pinning it (calendars `day`; Current `hour`),
  through the same rules module (a pin is a resolution the person can't change).

### What a dataset offers

- A layer **offers** a resolution when its catalog entry lists it and its adapter can fetch it
  for the widget's places (`offered.ts`; for example region air quality has no raw). _My call:_
  air-quality entry types that list only raw (humidity, particulates, PM10 raw) keep today's
  downsampling of raw readings into coarser levels and count as offering those levels, since
  the result is a true average at that level.
- The **dataset offers** the resolutions every one of its layers offers.
- Smoke (`hms-smoke`, `hms-fire`) and spray notices offer **day** only; pesticide use **month**
  and **year**; forecasts **day**. A level layer like smoke follows the rule strictly: smoke is
  offered at daily or coarser only where its catalog lists it, so not on an hourly chart (the
  user picked strict, 2026-11-18). _My call:_ the catalog lists `hms-smoke` at `day` only, so a
  monthly chart doesn't offer smoke either.

### Get data

- **Order of the controls** (the user's workflow): 1. date or range, 2a. place (optional for
  place-less datasets), 2b. datasets, 3. **Data resolution**, 4. the visualization (Show as,
  beside the preview). Today's order is already When, Where, What, then "Show values" inside
  "More options"; the change is that Data resolution becomes its own visible section after What,
  not folded into "More options". The threshold line control stays under "More options".
- **"Show values" is renamed "Data resolution"** (heading, control, toggletip, its messages).
  The levels and their labels are today's: Automatic, Every measurement, Hourly, Daily, Monthly,
  Yearly (`LEVELS` in `resolution-offer.ts`). Quarterly and Seasonal stay out (the user,
  2026-11-18; see "Deferrals"), though the server has them.
- **A specific resolution** never changes by itself. Datasets that don't offer it are greyed
  out with the reason (for example "Pesticide use is reported by month."), never hidden.
- **Resolutions** a chosen dataset doesn't offer are greyed out with the reason naming the
  dataset. The existing point-budget reason ("too many points") stays.
- **Automatic** starts from the range (today's ladder in `resolution.ts`: up to 3 days every
  measurement, up to 7 hourly, up to 365 daily, else monthly) and takes the finest level at or
  above that which every chosen dataset offers. When the datasets moved it above the range's
  level, a note says so, naming the level and the dataset:
  "Automatic data resolution is now Monthly: pesticide use is reported by month." (the user's
  wording). A dataset with no resolution in common with the others is greyed out with the reason.
- **Whole periods.** At Monthly or coarser, the range is made of whole periods of that
  resolution. _My call:_ the stored range keeps its kind; `resolveRange` widens it to whole
  periods when given a coarse resolution (so a trailing range keeps rolling: "last 12 months" at
  Monthly is the last 12 calendar months including the current month so far). When the chosen
  range resolves wider than the person picked, a note says so, giving the resolved dates. A
  custom range edited at a coarse resolution is picked in whole periods (month pickers at
  Monthly, Quarterly and Seasonal snapping to the period's start and end; year pickers at
  Yearly); the exact picker is left to the builder within that rule.
- **The current period** is drawn "so far" and marked not final, from the server's nightly row
  (`is_final: false`), the way the calendars mark today.
- **Visualization types** that can't show the dataset at its resolution are greyed out with the
  reason (the existing Show as mechanism, `offer.ts` `typeBlock`, gains a resolution reason).
- Saving or adding a dataset that doesn't line up can't happen: the controls never build one, and
  the action bar stays blocked if one arrives (an old draft, say) until it's fixed.

### The Map

- **One range, one resolution.** The Map's offered resolutions are Daily, Monthly and Yearly
  (_my call_: no finer, see "Deferrals"). **Now** (no range) is the live Map as today; it has no
  resolution, and pesticide use isn't offered on Now (_my call_).
- **The Map has Automatic too** (_my call_, from the builder check): the finest level at or
  above Daily that every layer offers (the range ladder is clamped to Daily, since the Map
  offers nothing finer). The type's `resolution: "day"` pin goes.
- **The Map's span counts stops, not days** (_my call_, from the builder check): today's 366-day
  cap (`MAP_MAX_DAYS`) becomes at most 366 stops at the resolution (366 days at Daily, 366 months
  at Monthly, and so on). Whole-period widening never trips it: the cap is checked on the
  widened range's stops. Each stop is still fetched only when shown, as today's day snapshot.
- **The stepper steps through each period of the range** at the resolution: days at Daily, months
  at Monthly, and so on, the current period last as "so far". _My call:_ the Map option `day`
  becomes `at`: the Pacific date key of the shown period's start (a day, a month's first day,
  etc.). An earlier `day` is dropped (the Map opens on its default stop).
- **What each layer offers on a Map:**
  - Monitors and region fills: Daily (each day's figure, `scale.daily_statistic`, as today);
    Monthly and coarser (the period's `daily_statistic_mean`, named by `scale.period_statistic`),
    coloured with **the same daily scale** (the user: a monthly figure "provides a general idea
    of what people were exposed to each day in the month. The daily scale still fits."). The
    legend names the figure from `period_statistic_label` (_changed after approval:_ the
    tooltips and the feature list name it instead; see "Calls made after approval"). A row whose
    figure is null draws as no data with a reason, the same as a missing day (_changed after
    approval:_ "Only {days} of {expected} days had a figure", from the row's day counts, else
    "Too few days had a figure"; was "fewer than 75% of the days had a figure").
  - Smoke and fire, spray notices: Daily only.
  - Pesticide use: Monthly and Yearly. It follows the Map's range and the stepper's period; it
    shows only for whole periods (always true at those resolutions), and a period the server
    has no use for says so ("No pesticide use reported for ‹period› yet").
- **5b's separate use period goes:** the `usePeriod` option, `UsePeriodPicker`, the toolbar's
  period selects, `periodFromRange` / `periodOverlaps` in `get-data/map.ts`, and the
  `"use-period"` note. The use layer reads the period from the Map's stepper. The township and
  section cards, the lens and the filters are unchanged.
- **The Map's resolution is chosen in Get data (Edit data)**, not on the Map's toolbar (_my
  call_). The toolbar's layer rows follow the same offers: a row for a layer the resolution
  doesn't offer isn't shown.
- **The hidden-marks note's `"day"` reason** reads as "no figure for this period".

### One figure per pollutant, everywhere (the user, 2026-11-18)

"Monthly" means one value per calendar month (Pacific) in every widget, and each pollutant's
value is the same figure in every widget: the one its scale is built on, named by the metadata.

- **Hourly and finer:** the period's average, as today.
- **Daily:** the scale's daily figure (`scale.daily_statistic`: for example PM2.5's 24-hour
  average, ozone's highest 1-hour average), the figure the calendars already show; null is "Not
  enough data" (the server's completeness rule).
- **Monthly and Yearly:** the average of those daily figures (`scale.period_statistic`, the
  row's `daily_statistic_mean`); null when fewer than 75% of the expected days had a figure.
- **Entry types with no `daily_statistic`** (weather, for example): the plain average at every
  level.

This applies to the Map, Charts, Tables and calendars alike, so one place and period never shows
two numbers. It changes daily Charts and Tables of pollutants whose daily figure isn't a mean (O3,
NO2, SO2, CO): they show the day's peak figure instead of the day's plain average. A chart's level
line and colours are then compared against the figure the scale is defined for. The series name,
the table header, the legend and the CSV column carry the figure's name
(`daily_statistic_label` or `period_statistic_label`). The plain-average option is deferred.

### Charts and Tables

- Every layer is fetched at the dataset's resolution (the query client reads it from the rules
  module; no per-layer pin and coarser fallback). A layer that can't serve it isn't fetched.
- The Chart's pesticide layer at Monthly is plain monthly bars; the `wholePeriod` strip path for
  a coarser overlay goes. Smoke's day bands appear only on daily charts.
- The Table has one row per period for every layer; the `whole` overlay repeat and the
  level-overlay `byDay` gate go.

### The data layer

- **Coarse rows from the server only** (after the server ships): monthly, quarterly, seasonal and
  yearly series read the stored rows, including the current period's nightly row; the
  `planSegments` fill of the open and just-ended coarse periods from finer levels retires. Daily
  and finer are unchanged (today from `daily/open/`).
- A Map's monthly and coarser monitor and region snapshots read `period_statistic`'s field from
  the bulk summaries at that resolution, with `is_final` polling as the daily snapshot does.

### Documents that don't line up (untrusted input)

Get data never builds a mixed dataset, but a share link or `/import#…` is untrusted and could
carry one. Such a document opens without errors and is drawn, never rewritten: _my call_ the
main layer (a Map's first pollutant) decides the resolution, layers that don't offer it aren't
drawn, and a note says why and to change it in Edit data. On a Map on Now, pesticide use isn't
drawn, with the same note. Earlier shapes (`Layer.resolution`, the Map's `usePeriod` and `day`)
get no compatibility code (the user, 2026-11-18). Layer and data keys are dropped by the
schemas, but `MapOptionsSchema` is strict and fails the whole dashboard. No cleanup is needed:
a read-only scan of the local server (2026-11-18) found no saved dashboard with a Map, and the
user confirmed the browser has none.

## Messages

All strings through Paraglide; no concatenated sentences. New or renamed: the "Data resolution"
heading and control, the toggletip, the dataset-not-offered reason (with the dataset's label
from the catalog and the level), the resolution-not-offered reason, the Automatic note, the
range-widened note (with the resolved dates via `format`), the Map's per-layer "not shown at
this resolution" note, the pesticide "no use reported for ‹period›" text (via `format` for the
period), and the null-figure reason. Old `show_values` keys go.

## Deferrals (to `DEFERRED.md` in this spec's change)

- **A weekly resolution.** The server has no weekly summaries; it would need server work, with
  weeks starting Sunday in Pacific time. Revisit when someone asks for weekly figures.
- **Comparing two datasets** (two time windows, each lined up). Replaces "Year-over-year change
  on the map" in substance; reworded around the user's two-dataset idea. Revisit after spec 6b,
  or when an agency or researcher asks for trends.
- **An hourly or finer Map.** Revisit when someone asks to step a map by hour.
- **Quarterly and Seasonal resolutions.** The server and SDK have them, but the dashboard never
  offered them; seasons cross the year boundary (December to February) and need their own
  whole-period rules and pickers. Revisit when someone asks for seasonal or quarterly figures.
- **Choosing the plain average instead of the scale's figure** (for example a researcher's
  "monthly mean ozone" of all hours). Every widget shows the scale's figure (see "One figure per
  pollutant"). Revisit when a researcher or agency asks for the plain average.
- **Smoke, fire and spray notices at Monthly or coarser** (for example days with smoke per
  month): no monthly form on the server. Revisit when someone asks for them in monthly data.
- The DEFERRED entries this spec settles (the lens flash with beta.21; any entry about the
  pesticide strip's whole-month bars or the Map's use period) are updated or removed.

## Left to the builder

- The rules module's file name and API, and how it caches per draft.
- The whole-period pickers' exact UI, within "whole periods of the resolution".
- Which existing tests move to the rules module and which are rewritten.
- The order of tasks, keeping every task that reads `daily_statistic_mean` or
  `period_statistic`, and the coarse-row retirement, after the beta.15 pin.

## Testing

- Unit tests for the rules module: offers, Automatic and its note, whole-period resolution,
  old-shape parsing.
- A test that a document with layers that don't line up (as a share link could carry) opens
  without errors, draws the main layer's resolution with the note, and isn't rewritten.
- Browser tests for Get data's greyed-out choices and notes, and the Map stepping by month.
- E2E: pin noon Pacific and also run under `TZ=America/New_York`.
- Read a real local response for the new fields before relying on them.
- Every document the app or the tests open (the starter, sample documents, E2E and browser-test
  fixtures, the stack suites' seeds) must parse under the new strict `MapOptionsSchema`: grep
  them for `usePeriod`, `day`, `resolution` on layers, and quarter or season levels, and update
  them (today's hits include `e2e/map.spec.ts` and the Map's browser tests).
- The new widget type checklist doesn't fire (no new place kind), but the share swap,
  `PlacePickerDialog` `regionOf` and Get data's type switch keep passing with `data.resolution`.

## Calls made after approval

Made during the build (2026-11-18 and 2026-11-19), each told to the user where it changes what
people see.

- **2026-11-18, the widened note and the When summary never show a future end.** When the range
  holds the current period, they end at today with "(so far)". Why: the spec's "current period
  so far".
- **2026-11-18, raw has its own not-offered copy:** "{dataset} has no individual measurements".
  Why: "isn't reported every measurement" reads wrong.
- **2026-11-18, the Map's stop is `SnapshotAt`:** `"now"`, `{ day }`, or
  `{ start, resolution: "month" | "year" }`. Why: one stop shape for the monitors, the fill and
  pesticide use.
- **2026-11-18, a trailing range cut at Yearly becomes a fixed custom range** (the last 366
  years), so it stops rolling. Why: trailing ranges have no `year` unit. In `DEFERRED.md`.
- **2026-11-18, a Map on Now with pesticide use, converted to a Chart, keeps the use.** The
  Chart's Automatic then counts it (Monthly). Why: no silent drop; the conversion keeps what the
  person chose.
- **2026-11-18, a Chart with pesticide use, converted to a Map, keeps its range** (not Now, which
  would block the use).
- **2026-11-19, every widget's CSV (the calendars too) ends with `figure`, `figure_label` and
  `rated`** on every row. `mean` stays the plain mean, and a null figure is blank. `rated` keeps
  the calendar's values ("Yes", "Not enough data", "Not final yet"). Why: each row names its own
  figure, so an overlay's figure is never blanked under another label.
- **2026-11-19, a month or year with no figure says how many days had one:** "Only {days} of
  {expected} days had a figure", from the row's `daily_statistic_days` and
  `daily_statistic_expected_days`, else "Too few days had a figure". This replaces "fewer than
  75% of the days had a figure" (the Map section above). Why: the data is the source of truth,
  so the copy can't go stale if the server's rule changes.
- **2026-11-19, the Map names the month or year figure in the tooltips (`figureLabel`) and the
  feature list's note, not in the legend.** Why: map-sdk's `monitorsPlugin` has no legend slot
  for it (the same as at Daily). In `DEFERRED.md`. Region fills with no figure read "No data"
  with no reason, since the regions plugin has no detail slot either.
- **2026-11-19, coarse series come only from the server's stored rows**, the current period's
  nightly row (`is_final: false`) included. Daily and finer still fill today from `daily/open/`,
  and the last completed hour or day is still backfilled from a finer level until its rollup
  runs.
- **2026-11-19, Current pins Hourly as a now type** (`currentInput`). It holds one air-quality
  pollutant, which always offers Hourly, so it doesn't go through the rules module.
- **2026-11-19, a stored level that can't be drawn has one state** (final review): "This data
  isn't available at the chosen data resolution. Change it in Edit data." It shows when the main
  layer doesn't offer the stored level, and also for a stored level outside `LEVELS` (a quarter
  or season from untrusted input; never a silent Automatic) and for hour or raw on a Map. Get
  data blocks Save for the latter with its own reason: "Choose another data resolution: the
  saved one isn't offered here." The schema isn't narrowed, so such a document still opens.
