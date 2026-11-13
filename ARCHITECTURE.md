# Architecture

This document describes the design of SJVAir's data dashboard. The current direction
comes from `IDEA.md` (planning brief) and the decisions made while working through its
Open Questions and follow-up reviews (2026-09-23 → 2026-10-13); each section below notes which question it resolves.
Deferred and ruled-out items live in `DEFERRED.md`; the server's actual data is
catalogued in `docs/reference/server-data-inventory.md`. The original v1 tab-based
design (`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`) is superseded,
and its code is removed in Release 1's Foundations step. See "Legacy: v1 tab model" at
the end.

**A fresh start, not a retrofit** (decided 2026-09-24). The new direction is built as
one cohesive design. The v1 layout and tab code are not kept or adapted. Existing code is
reused only when it is exactly what the new design needs (e.g. a well-tested pure
helper), never to save effort at the cost of fitting the new architecture. Before the v1
code is removed, its _lessons_ (server behaviors and edge cases, not code) are captured
in `docs/reference/v1-lessons.md`.

## Product direction

**A personal, interactive dashboard and data-analysis toolbox for all public SJVAir
data** (historical and live). Three uses:

- **Day-to-day monitoring** of conditions.
- **Exploring trends** local to a region.
- **Staying on top of live data for alerts** — both _self-monitoring_ (live data shown
  clearly enough to spot concerning values as they arrive) and _automated alerting_
  (the system notifies the user when values cross a threshold).

**Audiences:** everyday community members, schools, and research scholars. Intuitive
for basic users, feature-rich for power users.

### Views

- **Dashboard** (primary) — horizontal navigation bar on top (replacing the v1 vertical
  sidebar), dashboard area below. Holds widgets (see "Dashboard layout mechanics",
  "Widget catalog"). Multiple saved dashboards, selectable at minimum via a dropdown
  (decided 2026-09-24: a **dropdown in the top nav** for Release 1, with new / duplicate /
  rename / delete at its bottom; a visual thumbnail picker is deferred). "Add widget" picks a type
  from the predefined list, then opens Widget Creation to configure its data.
- **Widget Creation** — configures one widget's data (see below).
- **Analysis** (Release 3; the nav shows no Analysis entry before then) — Collections,
  starter and user-defined analyses, notebooks (see "Analysis: Collections & engine",
  "Notebooks").

These may change if a better structure emerges.

### Starter dashboard

Decided 2026-09-28. The dashboard a first-time visitor sees (not a blank page):

- A **built-in document** whose place defaults to **Fresno County**. Automatic location is
  ruled out (geolocation is opt-in only), and there is no Valley-wide region.
- A **"Showing Fresno County · Change place"** bar offers the shared place picker plus an
  opt-in "Use my location". It **changes the place for all of the starter's widgets at
  once**. This is a feature of the built-in starter only, not general widget linking
  (which stays deferred).
- **URL and copies** (decided 2026-09-28):
  - The starter lives at **`/workspace/`** for first-time visitors and anyone with no
    dashboards of their own. Once someone has dashboards, `/workspace/` opens their
    last-opened one, and the starter stays reachable from the picker ("New from starter").
  - **"Change place" does not create a copy.** The chosen place is saved as a
    **preference** (through the platform adapter).
  - **A real edit creates the visitor's own copy**: moving, resizing, adding, removing,
    or configuring a widget, or renaming. The copy gets a new id, the URL is replaced with
    `/workspace/dashboards/:id` (no new history entry), it carries over the chosen place,
    and a toast says "Saved as your own dashboard". The built-in template is never
    modified.
  - **Sharing the starter** first makes a copy, then shares that.
  - **As built (step 4 spec 6, 2026-11-10):**
    - The template's layers hold `{ kind: "default-place" }`. **The starter's session is the
      template resolved with the chosen place** when it is built, so every widget, the data
      layer, the picker and sharing see an ordinary place; the data layer never receives
      `default-place`. One resolve function runs at every exit (the first edit's copy, New from
      starter, duplicating, Export, sharing).
    - **The bar stays on copies made from the starter.** The copy saves the bar's place (a
      validated dashboard field); "Change place" there is an ordinary edit that switches the
      widgets showing the bar's place, in one undo step. Widgets pointed at another place are
      left alone, and the picker offers an unchecked **"Also change the N widgets showing other
      places"**; with the bar's own place picked, "Also change" brings the other widgets to it.
      A widget comparing several places, or holding a place-tied choice (a weather station),
      is never switched. The bar hides when no widget shows its place, and a live share link
      shows "Showing …" without "Change place".
    - **The bar's place travels with the dashboard** (links, Export, live shares, copies from
      shares) and is a place like a layer's, so the exact-point rules (point-to-region swap,
      live-link prompt, upload guard) cover it too.
    - **Sharing the starter copies it first** through `copyStarter`, the same hand-off as a
      first edit.
    - **"Duplicate for another place…"** (dashboard menu and list rows, any dashboard) asks for
      a place and copies with the dashboard's main place replaced (the bar's place when there is
      a visible bar; otherwise the place most switchable widgets show, asking on a tie). A copy
      of a starter copy keeps its bar; a copy of any other dashboard does not gain one. In the
      list it always shows, and toasts when there is nothing to replace.
    - `StarterHint` is gone: the bar and the welcome Note say what it said.
    - **The welcome Note shows only to the dashboard's owner** (decided 2026-11-10). Its text
      speaks to the owner ("Change place", "your first change saves…"), so a live share leaves
      every built-in message Note (`{ message }`) out of the view (the grid closes the gap), and
      a Note that can't be edited where it's shown renders a `{ message }` as nothing. A Note
      with its own text always shows; "Make a copy" keeps the welcome Note for its new owner.
    - **The starter's Current conditions and "Can we go outside?" tiles have no alert level**
      (decided 2026-11-10): a first-time visitor isn't signed up for threshold watching
      without asking, and the template is built without metadata. A copy's owner can add one.
- Titles are generated from metadata, and the welcome Note references a **message key**
  (nothing English is stored in the template). A personal copy stores the Note's rendered
  text only once the user edits it.
- **Contents** (decided 2026-09-28; layout settled in the step 4 spec): Current conditions
  (PM2.5), Forecast strip, "Can we go outside?", a PM2.5 chart (last 30 days), a
  day-colored calendar (this month), and a short welcome Note. (The hour × weekday heatmap was
  dropped on 2026-11-09, step 4 spec 5.) **Layout as built (spec 6, 12 columns):** the welcome
  Note full width on top; then Current conditions, "Can we go outside?" and the Forecast strip
  in a row; then the chart (8 wide) beside the month calendar (4 wide). The heatmap's old slot
  stays empty. The Map joins in step 6 as a full-width row under the "now" row. The welcome
  Note is a message reference (`{ message }`); a copy keeps it until the person edits the Note.

### Get data (formerly the Data Explorer and "Widget Creation view")

**Renamed 2026-11-05 (the user, step 4 spec 3, which built it; spec:
`docs/superpowers/specs/2026-11-05-step-4-spec-3-get-data-design.md`).** The top nav says
**"Data"**; the page heading is **"Get data"**, or **"Edit data"** when opened from a widget. In
docs it's "the Get data view". Older text saying "Widget Creation" or "Data Explorer" means this
view. People mostly know what they want, so it isn't an explorer (sjvair.com's Pesticide and
Facility Emissions explorers are "the explorers"). It doesn't overlap Release 3's Analysis view.

**Data first, and never blank.** Pick _what_ data, _where_ and _when_, watch the live preview,
choose how to show it, then **Add to dashboard** or **Download CSV** (no widget needed just to
download). It opens already filled in: from the nav or "Add widget", the last draft, or for a
first-timer **Fresno County · PM2.5 · last 30 days**; from a widget's **"Edit data"**, that
widget's data. Notes (and later the Map) are added directly from "Add widget", since they don't
start from data. Built fresh; the only carry-over from v1 is the idea of per-dataset options,
now inside the dataset sections.

**Layout (option A).**

- **Left column, top to bottom:** **When** (the date control), **Where** (the places, with
  "Change", which opens the shared place picker in `multiple` mode up to the widget type's
  `maxPlaces`), **What** (one collapsible section per dataset; Air Quality starts open), and
  **More options** → **Show values** (the resolution override, with a "?" toggletip).
- **Right:** a large live preview with a **Show as** switch (Chart | Data table today) and a
  **"Dashboard size"** switch that shows it at the size it will land (the type's `defaultSize`).
  It's the real widget component in a view-only frame, so its states (loading, "No data",
  errors, retired) look exactly as on the dashboard. No drag-to-resize. Changes are announced
  politely once the preview settles ("Showing PM2.5 · Fresno County · Last 30 days").
- **Bottom:** a bar that stays in view: **Cancel**, **Download CSV**, and **Add to _dashboard_
  ▾** (or **Save changes** when editing).
- **Phones:** the same parts stacked (controls, then preview), with the bar pinned.

**Dates: one preset list** (option C; replaces the earlier method toggle). One date range per
widget (dashboard display widgets only; time-offset/lag comparison belongs to Analysis). No
method switch; one grouped list:

- **Last:** 24 hours, 3 days, 7 days, 30 days, 90 days, 12 months (each type shows the subset
  its `span` allows).
- **To date:** This week, This month, This year.
- **A specific…:** Day…, Week…, Month…, Year… (each opens its own date input).
- **Custom range…** (start and end dates).

The resolved dates always show underneath ("Oct 7 – Nov 5, 2026"), with "moves forward each
day" for rolling ranges. A type's `dateMethods` and `span` hide what doesn't apply; a range
outside `span` can't be chosen, and the reason is shown. Underneath, the saved shape is still
the **three methods** of `DateRangeSpec`:

- **Set ranges** (`set`): a year, month, week, or day.
- **Rolling ranges**: _to date_ (`to-date`: year, month, week) and _last_ (`trailing`; added
  2026-10-13 because IDEA.md's three methods couldn't express "the last 30 days", which the
  starter chart, the "now" widgets' window, and Collections all use).
  - **Meaning (Pacific time):** "last 30 days" is today plus the 29 days before it, by Pacific
    calendar day, so today's partial data is included; "last 12 months" counts calendar days
    back one year. "Last 24 hours" is exact hours ending now.
  - **Stored as an amount and a unit** (`{ kind: "trailing", amount: 30, unit: "day" }`; units
    `hour` | `day` | `month`), so any length is representable although the list offers only
    the presets (an unlisted length shows as Custom range).
  - Rolling ranges move forward with time; "Mark for analysis" freezes them, and "keep
    rolling" applies.
- **Custom ranges** (`custom`): start and end dates.

Weeks start on Sunday.

**Which datasets appear** (revises the earlier "without code changes" promise). The **What**
sections are the `meta/datasets/` catalog's datasets that (1) the query client has a data
adapter for and (2) at least one offered widget type's `accepts.datasets` lists. Labels, entry
types, units, and descriptions come from the catalog, so a new entry type inside a listed
dataset still appears without code changes; a new dataset needs an adapter and a type that
lists it. In a section, entry types no offered type can show are left out, and a `retired` or
`available: false` entry type isn't offered for new picks (an existing widget that uses one
keeps showing it, with its retired state). **The adapter decides fit**, not the catalog's
`geographies`: it says whether it can serve a layer for the main layer's places (the forecasts
adapter takes monitors and regions and lets the server map them to a forecast zone). Spec 3
offers **Air Quality** and **Air Quality Forecasts** (`forecasts`); spec 3b (2026-11-07) adds
**Weather** (`weather`), **Wildfire Smoke** (`hms-smoke`) and **Pesticide Use** (`pesticide-use`).

**Layers.**

- A widget combines dataset **layers** sharing its one date range: **at most one pollutant
  layer** (by the catalog's `kind`; no mixing O3 and PM2.5), plus **up to two overlays**.
- **Two kinds of layer (spec 3b).** A **level layer** draws day bands: burn status, AQI
  forecast and smoke density. A **number layer** has a value with units: a pollutant, a weather
  reading or total, or a pesticide measure. Which kind a layer is comes from the dataset's
  adapter (`drawsAsBands`, in the dependency-free `src/lib/data/adapters/bands.ts`: `forecasts`
  and `hms-smoke` do), not from the catalog, which gives the AQI forecast units and
  `chart: "bar"`; a metadata test would misclassify it.
- **The main layer** is the pollutant if there is one, else the first **number layer**
  (`mainLayer`): a weather reading or total, or a pesticide measure. **A number layer can stand
  alone**: Air Quality has a "None" choice, and a widget needs at least one number layer. The
  last one can't be removed (the places move to the next number layer when the main one goes). A
  widget of only level layers can't be added or downloaded; the reason shows.
- **Number overlays draw in strips under the chart** (the user, option B, spec 3b), each with
  its own axis labeled with the entry type's label and units, sharing the chart's dates;
  nothing is drawn on a second axis inside the main plot. Bars or a line follow the catalog's
  `display.chart`, from `y_min`. Each strip takes a fixed share of the height and the main chart
  keeps at least half. The legend names each layer and its source ("Temperature · CIMIS #80 -
  Fresno State", "Pounds applied · Sulfur"), with no correlation wording. A strip can be
  coarser than the chart: pesticide use is monthly or yearly, so under a daily chart it is one
  bar per month spanning that month's days ("Monthly total"; a month only partly in the range
  shows its whole-month total, marked). An empty pesticide strip says "No pesticide use
  reported for these dates."
- **Overlays borrow the main layer's places.** Only the main layer stores places (the shared
  place picker's `place` or `selection`), so "Change" re-targets every layer at once. An overlay
  is fetched for each of the main layer's places; the **Data table** shows a column per place
  per layer, and the **CSV** has every place's overlay rows (categorical values get
  `level_key` and `level_label` columns). An overlay the Table can't show (it failed, or the
  periods are longer than a day) gets a note under the table, so the Table never silently
  disagrees with the Chart.
- **The adapter decides which entry types can be overlays** (`DatasetAdapter.overlays`): the
  forecasts adapter offers all of its own; air quality offers none (its temperature and
  humidity are raw-only). One already in a widget stays listed, checked, so it can be removed.
- **Spec 3's overlays:** Air Quality Forecasts' **burn status** and **AQI forecast**, one value
  per Pacific day (the latest issue) from `forecasts/place/`. On the Chart they're **labeled,
  patterned day bands** behind the line, with levels, labels, and colors from `forecasts/meta/`
  scales; in the Table they're columns. The legend names each layer ("Burn Status in Fresno
  County") and never claims a link (no correlation wording or fitted lines).
- **"Overlay for" is a Chart option.** When all the places share the overlay's source (the
  same forecast zone), the Chart draws it once and no choice appears. When they don't, an
  **"Overlay for: [place ▾]"** choice picks whose overlay the Chart draws; it's saved on the
  widget as a Chart option (`options.overlayFor`, a validated place ref), not on the layer, and
  falls back to the first place when that place leaves the widget.
- **Weather (spec 3b):** every catalog entry type with summary levels except `raw` (no "Every
  measurement": CIMIS readings are hourly, so Hourly shows the same values; entry types left
  with nothing, such as wind direction, aren't offered). The data is the place's nearest CIMIS
  station's monitor summaries, one station per request. **The station** defaults to the first
  one `getWeatherStationsForPlace` lists; with one place, "Station" in the Weather section lists
  them (inactive ones with "no recent data") and the choice is saved as `Layer.station` (a
  monitor id; the default stores nothing). One station serves every weather layer of the widget
  (saved on each, kept in step). With several places each uses its own default; changing the
  place drops the override; a saved station no longer listed falls back to the first. A row with
  `is_complete: false` is partial. Schools and "my location" use the region they fall back to,
  so no coordinates leave the browser.
- **Wildfire smoke (spec 3b):** a level layer, one band per Pacific day from `hms/smoke/place/`
  (levels, labels and colors from `hms/meta`), requests split to at most 366 days. Alone it
  can't make a widget.
- **Pesticide use (spec 3b):** pounds applied, acres treated and applications per region, from
  `months` (Monthly; a month the server omits is 0 inside the dataset's coverage, no point
  outside it) and `years` (Yearly, the server's year totals, which include undated records).
  **Filters belong to each layer** (`Layer.filters`: chemical, commodity and product ids,
  categories, cancer group, method, narrow-to): a "Filters" area under each layer, with a
  summary line, and "Add a/another pesticide layer", so one chart can hold all use and
  carcinogens only. Labels come from `pesticides/meta/` and `display_name`; the legend, Table
  header and CSV name the active filters. A saved id the server no longer has makes the layer
  unavailable ("filter-gone").
- **Table and CSV:** the CSV gains `source_id` and `source_name` (the weather station) and
  `filters` (the pesticide filters) after `level_label`, then `aggregate` (the catalog's `sum`,
  `mean`, or empty) last, so a total reads as one. The legend, strip tags, Table caption and
  cells say "Daily total" for a summed layer at every resolution, "Daily average" for a mean,
  and the entry type's label for a layer that never rolls up. Weather offers no "Every
  measurement" (see `DEFERRED.md`).
- A saved pesticide category, cancer group, method or narrowing that `pesticides/meta/` no
  longer lists is "filter-gone" too.
- One chart row per place is in `DEFERRED.md`.

**Show as.** The data types (those with `accepts.datasets`) are offered; one that can't show
the current data (too many places, a dataset it doesn't accept, a span outside its `span`) is
greyed out with a short reason, never hidden. Switching keeps the data. Spec 5's calendars
appear by registering descriptors (see "Widget-type contract"), with no change here.

**Add to dashboard.** The button names its target: the dashboard Get data was opened from, else
the last-opened one; the menu lists the others and **"New dashboard"**. A read-only (shared)
dashboard is never a target. The widget goes into the first free spot at the type's
`defaultSize`, and you land on that dashboard with the new widget focused and briefly
highlighted (respecting `prefers-reduced-motion`); the add is one `applyChange`, so one undo
step. "Add widget" on the starter opens `/dashboards/starter/widgets/new`, and from `/data`
with no saved dashboards the target is the starter (named as in the nav): adding is an edit,
so it makes the personal copy as any first edit does, with the same "Saved as your own
dashboard" toast.

**Edit data.** Every data widget's ⋯ menu has **"Edit data"**, opening the view with that
widget's data and **Save changes**, which applies one `setWidgetData` change (one undo step,
including a switched type and a size clamped to the new type's `minSize`; the widget keeps its
id, position, and title) and returns to the dashboard. "Choose another" on a retired dataset or
entry type opens Edit data; "Change place" and "Choose a place" still open the place picker
directly. Leaving with unsaved changes (Cancel, Back, a nav link) asks **"Discard changes?"**
(an alert dialog). Cancel goes Back only from an entry the app pushed; on a page opened from
its link it goes to the dashboard (or `/` from `/data`), never off the app.

**Show values ("More options"; was "Detail" until spec 3b).** **Automatic** (spec 1's
resolution rule, the default), or **Every measurement**, **Hourly**, **Daily**, **Monthly**,
**Yearly**, stored on the main layer as `resolution` (Automatic stores nothing). A "?"
toggletip beside it (a button on the bits-ui popover: opens on click, tap or Enter, also on
hover, closes on Escape or a click outside, announced) explains it. Only levels the entry type's catalog `resolutions` offer are listed; one the point
budget (places × periods) can't serve for the current range is greyed with the reason. No
level has a range cap of its own: the server's 31-day cap on raw and hourly is per request,
and the adapters ask a calendar month (or 31 raw days) at a time (and a stored one that becomes blocked goes back to Automatic). A type with a pinned
`resolution` hides it. Collapsed by default.

**Routes** (see "Routing, URL state & undo"): `/data` (from the top nav),
`/dashboards/:id/widgets/new` (from "Add widget"; `?type=` picks the starting Show as), and
`/dashboards/:id/widgets/:widgetId/edit` (Edit data). The URL holds only where you are: **the
draft never goes in the URL**, so coordinates never do. An unknown dashboard or widget id shows
the not-found page.

**The draft.** Kept in memory on the view and saved through the platform adapter as a
preference (device-local, never synced) so a reload or later visit starts from it: one draft
for `/data` and `…/widgets/new`; Edit data starts from the widget each time. It's a
`WidgetDataConfig` plus the chosen type (and Chart options), validated with the same schemas on
read (drafts are untrusted input); an invalid one is dropped for the default.

**Loading.** The view is a lazily loaded route: none of its code, nor the place picker's,
reaches the initial bundle.

### Shared widget behavior

- **Title bar** defaults to the dataset name(s) + date range; user-renamable.
- **From Release 3** (moved from Release 1 on 2026-10-25; see "Collections"), every widget with data (`analyzable`; see "Widget-type contract") contributes **"Mark for analysis"** (add its data — or current selection —
  to a Collection) and **"Analyze"** (add + navigate to Analysis) via the shared action
  list (see "Actions & context menu"). Widgets with a selection (map features/regions,
  calendar day ranges) add "Mark selected data for analysis" / "Analyze selected data"
  alongside the whole-dataset options.
- Minimize, fullscreen, drag, resize per "Dashboard layout mechanics".

### Theme & style

- **Theme tokens from Foundations; design pass before the widgets** (decided 2026-09-28).
  All colors, fonts, radii, spacing, and motion timings are CSS variables (`src/app.css`), and
  components never hardcode them. `src/lib/theme/token-discipline.test.ts` fails on raw palette
  classes and hex colors in components.
- **The look (design pass, part 1, built 2026-11-03).** Spec:
  `docs/superpowers/specs/2026-11-03-design-pass-design.md`. The user chose "A with C's cards":
  - **Colors.** Brand navy (`--primary`, from the logo) for primary buttons and page titles;
    sky blue (`--highlight`, from the logo) for highlights, selected states, and the focus ring
    only, never text and never a control's only boundary; link blue (`--link`, sjvair.com's) for
    underlined links. Blue-tinted grays replace shadcn's neutral grays. Destructive is a UI red,
    always with text or an icon. UI states never use the health-level hues (EPA, heat, smoke,
    fire, forecasts). Level colors still come from server metadata, not tokens.
  - **Shape.** Cards (widgets, menus, popovers, dialogs) are white with 12px corners
    (`--radius`), a 1px `--card-border`, and a soft blue-tinted `--shadow-card`. Buttons and
    inputs have 8px corners (`--radius-control`); text fields have a darker `--input` border
    (3:1, WCAG 1.4.11), while outline buttons keep `--border`. A picked-up widget shows the focus
    ring's look and `--shadow-lifted`. The top bar shows the SJVAir logo with
    "Dashboard"; the current page's link has navy text and an underline (navy in light, sky in
    dark, so it reaches 3:1).
  - **Density: "in between, closer to packed".** About 12px gaps and card padding (`--grid-gap`,
    `--card-padding`); widgets default to 3 of 12 columns, so a laptop shows about four across.
  - **Type.** Inter, on a scale around 13px: `text-xs` 12, `text-sm` 13 (body), `text-base` 15,
    `text-lg` 18 (page titles), `text-3xl` 32 (headline numbers). Form fields use 16px below the
    `md` breakpoint so iOS doesn't zoom on focus. Numbers that line up use tabular figures
    (`tabular-nums`); step 4 applies it to readings, tables, and axes.
  - **Focus.** One indicator: a 2px sky ring with a 1px `--ring-edge` (navy in light, the page
    color in dark). Where a card clips it (the widget title bar) and in menus, it's drawn inside
    the element: menu items move focus by script, so a keyboard-focused item gets the inset ring
    and the accent fill alone marks pointer hover. A focused invalid field shows this ring, not
    the destructive one.
  - **Motion: quick and subtle.** `--motion-duration-fast` (120ms), `--motion-duration-base`
    (200ms), and `--motion-ease-standard`, used through `duration-fast`, `duration-base`, and
    `ease-standard`. Colors fade for one base duration only while the theme changes. Reduced
    motion turns all of it off.
  - **Chart series.** `--chart-1` … `--chart-5`: navy, link blue, teal, slate, indigo. Never a
    level hue, at least 3:1 on cards in both modes, and never the only difference (step 4 adds a
    dash pattern or marker per series).
- **Dark mode with a switch.** The default follows the system (`prefers-color-scheme`, in CSS
  alone, so no flash). The Help menu's **Light / Dark / Match my device** radio group overrides
  it per device, not per account (Match my device stores nothing, and "Clear my data" goes back
  to it in every tab). An override sets `data-theme` on `<html>`; `bootstrap.ts`
  applies a saved one before the app mounts. Tailwind's `dark:` variant covers both cases. Dark
  is a deep navy-slate page with slightly lighter cards; navy lifts to a lighter blue. Toasts
  follow the same mode. The app sets a `theme-color` meta from the computed `--background`; the
  web manifest stays light. A saved override that differs from the system can flash the page
  background before `app.js` runs (see `DEFERRED.md`).
- **The family palette.** Token names stay shadcn's plus a few new ones (`--link`,
  `--highlight*`, `--card-border`, `--shadow-card`, `--shadow-lifted`, `--radius-control`,
  `--chart-1…5`, `--overlay`), so monitor-map, mobile, and `map-sdk` can adopt the palette by copying the token
  blocks. `map-sdk`'s legends and tooltips will use the same names and inherit the host's theme
  (the token list goes to the map-sdk session after the design pass's first PR). The
  restyle of the other apps waits for launch (see `DEFERRED.md`).
- **Tailwind CSS + shadcn-svelte** for components. **Never Bulma** (the server uses it;
  this project never will).
- Modern component/layout practice; **animations for transitions encouraged**. Tone:
  clean, not messy — but not plain, boring, or corporate. Use layout patterns users
  already know.
- **Responsive required** — phones aren't the primary target but must work. On phones the top
  bar uses the compact logo.

### Charting

**uPlot for all charts.** Nearly all data is time series, so chart configuration should
converge on a consistent, shared pattern.

**The Chart's look** (decided 2026-11-04, the user, step 4 spec 1, mockup option A): faint level
bands from the scale metadata behind a navy line with dots; each day's worst hour as a light
stick (single place only); band labels are the **full** level names, wrapped, never
abbreviations (the server has none; a band too thin for its label goes unlabeled); a level key
with outlined swatches and full names **always** shows under the chart; a hover/tap/arrow-key
readout gives date, value, level, and worst hour; several places (at most 5) differ by series
color plus dash or marker; gaps break the line. No zoom or pan in Release 1 (`DEFERRED.md`).
The Chart and the Data table open at **3×6** grid cells (3 of 12 columns, 6 rows) and shrink to
at least 3×4 (as built, step 4 spec 1).

### Alerts

The server already has an alert/notification system; **extend it** for dashboard
alerting rather than building a separate one. Current shape (see
`docs/reference/server-data-inventory.md`): `Subscription(user, monitor, level)`,
level-category thresholds, evaluated every 10 min for PM2.5 (most monitors) / O3
(AirNow, AQLite), **SMS only**; no push infrastructure exists on the server or in
`mobile`. **The server's alert system was redesigned on 2026-10-12** (sjvair.com PR #246);
see "Server baseline since the 2026-10-12 redesign" below. The decisions in this section that
were made against the older behavior were re-confirmed or replaced on 2026-10-13.

Decided 2026-09-24: **two separate mechanisms.**

**1. Self-monitoring — client-side, no account.** Widgets make threshold states obvious:
level-colored threshold lines on charts, current-conditions tiles that change color /
pulse on a level change, a toast when a newly arrived value crosses a threshold, and an
opt-in browser notification **while the dashboard is open** (through the platform
adapter). **Desktop browsers only in Release 1:** Android Chrome and iOS need a service
worker to show notifications, and that arrives with web push (see `DEFERRED.md`). Thresholds default to metadata levels and are overridable per widget. Needs
no server changes; ships with the widgets.

**Part 1 as built (step 4 spec 4, 2026-11-08).** Thresholds are per widget; Off is the default
until a person picks a level (Get data's "Alert me at" choice). They apply to the two live tiles
(Current conditions and "Can we go outside?", the two `thresholds: true` "now" types; the Forecast strip has none);
**Charts only display** a level-colored threshold line (keyed in the legend) and never toast or
notify.

- **Firing rule** (pure `decide`, `src/lib/thresholds/firing.ts`). The first value a browser
  sees sets the starting point and never fires. After that a toast fires only when the level is
  **worse than the last one told** (worse is later in the scale, by order, and at or above the
  chosen level). It re-arms when a value arrives **below the threshold at least 2 hours after
  the last toast**. There are **no improvement messages** and no all-clear; the tile and the
  taskbar mark show the current state. An unknown level key never fires.
- **Told state is per browser** (the last level told and when, kept through the platform
  adapter, pruned when a widget leaves the dashboard). **Once per browser**: a lock keeps two
  open tabs of the same dashboard from both toasting.
- **The mark.** A tile at or above its threshold shows a level mark (text as well as color), and
  its taskbar entry when minimized; it pulses only when a toast fires and respects
  `prefers-reduced-motion`. Marks clear on a reading with no current value and stay across a
  fetch error that still holds the last good reading.
- **Browser notifications** are a **per-browser, per-dashboard switch** in a "Notifications"
  dialog from the dashboard's ⋯ menu (also on read-only and shared views, since notifications
  belong to the viewer). A notification shows only when the switch is on **and** the browser
  permission is granted; the permission is asked for only when the switch is turned on. **Desktop
  only** (no service worker, as above); `permission()` reads `"unsupported"` elsewhere.
- **The watcher** is a dashboard-level component (lazy-loaded) that subscribes to every widget
  with a threshold, so a minimized or off-screen tile still fires; it shares each widget's query
  with the tile, so there is one fetch per place.

**2. Automated alerting — server-side, requires an account.** The dashboard only
_creates rules_; the server evaluates them on its periodic task and delivers through a
channel that reaches the user when the dashboard is closed. Extends `Subscription` into
a general alert rule (target monitor, region, _or location_ such as a school; entry type;
condition; channels).
Region targets fit naturally: `RegionSummary` is already computed hourly. Needs an
approved sjvair.com plan.

**What automated alerts watch (first server iteration, decided 2026-09-24):**

- **Pollutants** — on **monitor** targets (existing 10-min evaluation) and **region**
  targets (county, city, ZIP, **school district**, …; evaluated from hourly
  `RegionSummary`, so ~1 h latency). Limited to the **available pollutants** list
  (below) — PM2.5 and O3 today — though the rule model supports every summarized entry
  type (pm25, o3, no2, so2, co).
- **Forecasts** — tomorrow's AQI category, no-burn days, declared air alerts (per
  forecast zone): before-the-fact warnings, especially for schools.
- **Pesticide notices nearby** — a SprayDays application scheduled within N miles of a
  chosen place. The server already has `pesticides/notices/active/` (by bounding box or
  `region` + `buffer`) and radius queries on `sections/` and `locations/` to build on.

Smoke, heat (CalHeatScore), fire-proximity, and drawn-area targets are deferred — see
`DEFERRED.md`.

**Thresholds & notification behavior (decided 2026-09-24):**

- **Pollutants: level categories only** (e.g. "Unhealthy for Sensitive Groups or
  worse"), picked from metadata levels — so thresholds track breakpoint changes
  automatically. Numeric thresholds are deferred (see `DEFERRED.md`).
- **Averaging windows are server-defined, not user-set.** Monitors use whatever the
  server's evaluator uses (since 2026-10-12: one trailing 60-minute average with at least
  50% coverage; the earlier 30-minute open window is gone); regions use hourly summaries.
  Published via alert metadata (Metadata gap #4) so the UI can explain "based on a
  60-minute average".
- **Notify on: the server's escalation-only rules, for every pollutant rule and every
  channel**
  (decided 2026-10-13; this replaces the 2026-09-28 "any level change plus a back-to-normal
  message" design). A notification goes out only when conditions get **worse than what
  the user was last told**, with the server's throttles (one per 2 hours, three per Pacific
  day, bypassed by a jump of two or more levels; re-armed after 2 hours below the
  threshold) and its daily 10 AM "still bad" reminder. **Nothing is sent on improvement,
  and there is no all-clear notification.** Reasons: the server's approved throttling
  design (2026-10-06) found the earlier behavior sent 8–27 texts a day per monitor, and it
  matches how the Valley Air District alerts. One behavior for old and new rules means
  nothing to migrate or explain twice.
- **"Is it over yet?" is answered in the app, not by a message.** The server records every
  level change and the alert's end as **rule events** (see "Channels on the server"), so
  the **in-app alert inbox shows the full timeline** (rose, eased, ended), and widgets show current conditions live.
- **Server baseline since the 2026-10-12 redesign** (PR #246; verified in
  `alerts/models.py`, `evaluator.py`, `notifications.py`, `tasks.py` on 2026-10-13). This
  replaces the behavior verified on 2026-09-28:
  - **Models:** `Subscription` gains `last_notified_level`, `last_notified_at`,
    `below_threshold_since`. `Alert`/`AlertUpdate` use integer keys plus a `sqid` (old
    alert rows were dropped). A new **`Notification`** model is the delivery audit trail
    (kind `alert` | `reminder`, level, status, message, provider id). It has **no `channel`
    field**; the redesign's spec lists a channel abstraction as a non-goal.
  - **Evaluation:** one trailing 60-minute average (≥ 50% coverage) to create, escalate,
    and de-escalate; feeds of 1 h or longer use the latest reading. An alert opens at
    Moderate or above and closes at Good after at least 60 minutes.
  - **Who gets texted:** only on **escalation** (the level is at or above the
    subscriber's threshold _and_ above the last level they were texted). **Nothing is
    sent when air improves: there is no all-clear at all.** Throttles: at most one text
    per 2 hours and three per Pacific day per subscription (a jump of two or more levels
    bypasses them), re-arming after 2 hours below the threshold. A daily **10 AM
    "still bad" reminder** is new. The worst pollutant drives the text.
  - **Gating and opt-out:** SMS goes only to users with the **`sms_alerts` waffle flag**
    (so most subscribers may currently get no texts), and only when `SEND_SMS_ALERTS` is
    on. STOP/START keywords are handled (`User.sms_blocked`). Texts use the user's
    language setting.
  - **API shape change:** `account/alerts/` now returns `sqid` and **no longer returns
    `id` or `latest`**. `@sjvair/sdk` 4.5.0's `airAlertSchema` still requires both, and the
    mobile app's Alerts screen reads `alert.latest`. Traced on 2026-10-14: `latest` was
    only ever an `AlertUpdate` id, so that screen had never shown a correct level and then
    showed no alerts. **Fixed 2026-10-22**, independently of this project: sjvair.com #287
    adds `level` (in production via release #291), @sjvair/sdk 4.6.0 adds `sqid` and `level`
    and deprecates `id` and `latest`, and mobile #112 shipped in 4.0.6 (see `TODO.md`).
  - **Decisions re-confirmed against this baseline on 2026-10-13:** (a) **decided 2026-10-13**: follow the server's escalation-only design
    (see "Notify on" above); (b) **decided 2026-10-13**: no guard rails beyond the server's throttles (quiet hours deferred); (c) **decided 2026-10-13**: see "Channels on the server" below.
- **Existing SMS subscriptions** (decided 2026-09-28):
  - Every `Subscription` is **migrated to a monitor rule that reproduces the server's
    current behavior exactly**. Since the 2026-10-12 redesign that means SMS, the same
    level, escalation-only texts, the existing throttles and daily reminder, and no
    all-clear. Since new rules use the same behavior, migration changes nothing a
    subscriber can notice. Genuinely new features (e.g. email as a second channel)
    default **off** for migrated rules.
  - **The legacy endpoints** (`monitors/<id>/alerts/subscribe|unsubscribe`,
    `alerts/subscriptions`) stay as a **compatibility layer** over the new rules, showing
    and editing only rules a `Subscription` can express (single monitor, SMS, level). They
    **log usage with the app version**. The mobile app works unchanged; dashboard-only rules
    don't appear in it until it is updated.
  - One source of truth: old and new endpoints read and write the same rules.
  - Removing the legacy endpoints later is deferred (see `DEFERRED.md`). Removing them
    never affects anyone's alerts, only the old management API.
- **Guard rails** (decided 2026-10-13): the server's existing **per-subscription
  throttles** (one per 2 hours, three per Pacific day) are the only guard rail in Release 2. **Opt-in quiet hours are deferred**, and a per-person cap across rules is decided
  against, following the server's throttling spec (see `DEFERRED.md`).
- **Forecasts:** tomorrow's category ≥ a level, and/or no-burn day, and/or declared air
  alert; checked once daily after forecasts publish.
- **Pesticide notices:** place + radius (e.g. 1/2/5 mi), optional filters for
  application method (aerial/ground) and chemical category (e.g. fumigants); notify when
  the notice is published, optional reminder the day before application.

**Channel availability per account** (decided 2026-10-13). The server sends alert texts
only to accounts with its `sms_alerts` rollout flag, so a rule with SMS selected could
otherwise save and never deliver. **The user confirmed (2026-10-14) that text alerts open
to everyone before Release 2**, so at launch this mainly covers accounts that opted out
by STOP or have no verified phone, and any future rollout of a channel.

- **The server reports which channels this account can use**, as a per-account list in the
  alert metadata (e.g. SMS available or not yet). The flag stays the server's business;
  the dashboard never checks it directly.
- **The rule UI offers only what will work.** An unavailable channel is shown disabled
  with a plain explanation; the others remain. No rule can be created that silently does
  nothing.
- **Existing rules show their real state:** if a rule has SMS selected and the account
  lacks it, the rule list says texts are paused and why.
- Whether email gets its own rollout switch is for the Release 2 server plan (see
  `DEFERRED.md` → "Open decisions"); the same list would carry it. The in-app inbox is never gated.

**Email alerts** (decided 2026-09-28): require a **verified email** (the verification flow in "Accounts & anonymous use") and
include **one-click unsubscribe** (the `List-Unsubscribe` header plus a link), which major
providers expect from automated senders. A rule can't use a channel until it is verified,
and the rule UI prompts for verification when needed.

**Channels on the server (decided 2026-10-13):**

- **`Notification` gains a `channel` field** (`sms` | `email`), one row per delivery
  attempt per channel; existing rows default to `sms`. The audit trail, delivery statuses,
  and daily reminder work the same for email. This **overrides the redesign spec's (2026-07-09)
  "no channel abstraction" non-goal**, which predates this dashboard, so it goes through
  the sjvair.com Release 2 plan for approval there.
- **The in-app alert inbox is not a channel.** It is a read view over **rule events**
  (below) for the user's rules, plus a "last seen" marker for unread counts. It needs no
  `Notification` rows and works for rules with no SMS or email.
- **Rule events are the common record for every kind of rule.** The server's `Alert`
  requires a monitor and `Notification` requires an `AlertUpdate`, so region, location,
  forecast, and pesticide-notice rules would otherwise have no inbox source, no delivery
  log, and nowhere to record "rule paused". The rules plan adds one small record: each
  time a rule fires, changes level, ends, or is paused, the server writes a row (rule,
  subject, kind of event, level if any, time). The inbox reads these and `Notification`
  points at them. Monitor alerts keep their existing, tested logic and write rule events
  as well. Stretching `Alert` to cover non-monitor targets was decided against (see
  `DEFERRED.md`).
- **What "fires" means per kind of rule:**
  - _Pollutant rules (monitor, region, location):_ escalation-only with the server's
    throttles and daily reminder. Region and location rules read the hourly region
    summaries, so they are evaluated hourly.
  - _Forecast rules:_ at most one notification per day, after forecasts publish, when
    tomorrow meets the rule.
  - _Pesticide-notice rules:_ one notification per notice when it is published, plus the
    optional day-before reminder. No throttle (each notice is a distinct event), but a
    notice never notifies twice for the same rule.
- **Throttling stays per rule, not per channel.** The "last told" state lives on the
  rule, so a rule with SMS and email sends both at the same moment under the same
  throttle.

**Delivery channels (decided 2026-09-24):** channels are chosen **per rule**. First
iteration: **SMS** (available for **every** alert type — the server's per-subscription throttles
are the cost control) and **email** (new; natural default for schools and slow alerts).
Every fired alert also appears in the **in-app alert inbox**, which is history, not a
channel (see "Channels on the server").
**Web push** is the next iteration; **mobile app push** is a separate `mobile`
project. Both are tracked in `DEFERRED.md`.

Channel reference:

| Channel                  | Reaches user with dashboard closed? | Notes                                                                                                                                     |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SMS                      | Yes                                 | Exists; per-message cost; verified phone                                                                                                  |
| Email                    | Yes                                 | Cheap to add via Django; verified email; one-click unsubscribe (`List-Unsubscribe`)                                                       |
| Web push                 | Mostly                              | Desktop needs the browser running; Android works; iOS only for home-screen-installed sites. Needs a service worker + VAPID + server table |
| Mobile app push          | Yes                                 | Would require FCM/APNs in `mobile` — separate project                                                                                     |
| In-dashboard alert inbox | No                                  | Not delivery — history of what fired, shown on next open                                                                                  |

### Sibling projects

Built with and against `sjvair.com` (server), `sdk-js` (`@sjvair/sdk`), and
`monitor-map` (map experience, also used by sjvair.com and `mobile`), and the planned
`map-sdk` (map library split out of monitor-map), and `django-resticus` (the API framework,
`~/workspace/django-resticus`). They may need changes,
but **must not break their existing use cases**, and **each change needs an approved
plan first**.

## Platform strategy: web-first, Tauri-ready

Decided 2026-09-23 (IDEA.md Open Question #1). **The web build is the primary product;
a Tauri desktop build is a later, additive target** — not the other way around.

Why web-first:

- **Audience reach.** Schools largely run managed Chromebooks / locked-down machines
  where installs are blocked (ChromeOS can't run Tauri at all); community members
  arrive via links from sjvair.com. Only research users are likely to install an app.
- **Embedding** in sjvair.com (see below) is a web-only goal.
- **Tauri is not one engine.** It uses the OS webview — WebView2 (Chromium) on
  Windows, WKWebView (Safari) on macOS, WebKitGTK on Linux. WebKitGTK has known
  WebGL performance/driver problems (relevant to map widgets). A desktop-first build
  would still need cross-engine testing, with worse tooling.
- Tauri's distinctive features (tray, native notifications, local SQLite, background
  polling for alerts, large offline datasets) are **additive capabilities**, not
  foundations — as long as the core never assumes they're absent.

Tauri-ready seams required **from day one**:

- **Platform adapter layer.** A small set of interfaces for storage, notifications,
  file save/export, background tasks, online/offline status, opt-in geolocation, and error
  reporting. The web
  implementation uses IndexedDB (for documents and preferences) and browser APIs; a Tauri implementation later
  swaps in SQLite, native notifications, tray, and filesystem access. **Components and
  managers never call `localStorage`, `Notification`, `showSaveFilePicker`, etc.
  directly** — only through the adapter. Preferences (e.g. last-opened dashboard,
  active Collection, the starter's chosen place) are stored through it. The v1 `src/lib/preferences.ts` is removed
  with the rest of the v1 code, not migrated.
- **`activity` capability** (built 2026-10-22, Foundations spec 2). `platform.activity` reports
  whether the app is in front of the person (`visible()` and `onChange(cb)`). On the web it is
  page visibility; a Tauri build can report visible while the window is in the background so
  polling continues. The data layer's poller uses it; nothing outside the adapter reads
  `visibilitychange` for new code.
- **`errors` capability** (built 2026-10-26, Foundations spec 5a). `platform.errors` is the
  one way to report a failure: `report(error, context)`. On the web it lazy-loads the Sentry
  browser SDK only when a DSN is set (`VITE_SENTRY_DSN`) and the first error happens, scrubs
  every event (no document ids or bodies, no page URLs, names, emails, or coordinates; free
  text pattern-scrubbed, so messages must not carry names or titles), and reports each
  failure streak once. Lightweight `error` / `unhandledrejection` listeners and a CSP
  `securitypolicyviolation` listener forward to it. Without a DSN it is a no-op.
- **`identity` capability** (built 2026-10-27, Foundations spec 5b). `platform.identity`
  (the `IdentitySource`) is the one place that knows who is signed in: `current()`,
  `onChange(cb)`, `recheck()`, `signInUrl(returnPath)`, `signOut()`, and `authMode`
  (`"cookie"` on the web; nothing else is built). The state is `unknown` (dev or standalone,
  before the first answer), `signed-out`, or `signed-in` with the validated account. On the web
  it reads the `sjvair-identity` block on load, or calls `account/` once when there is no
  block. `currentSpace()` still returns `"anonymous"` for everyone; the place where identity
  would map to an account space is the seam the server-backed documents track switches on. A
  Tauri build swaps in its own sign-in dialog and token storage. The API token never reaches
  the dashboard, and identity data never goes into error reports.
- **`display` capability** (built 2026-11-03, design pass). `platform.display` holds the
  per-device theme choice (`"light"`, `"dark"`, or `"system"`): `theme()`, `setTheme(choice)`,
  and `onThemeChange(cb)`. Unlike the async, per-space `PreferenceStorage`, it is synchronous,
  because the choice must be read before the first render. On the web it is one
  `localStorage` key (`sjvair-workspace:theme`); other tabs hear changes through the `storage`
  event. Blocked or full storage reads as `"system"` and makes saving a no-op, so the switch
  still works for the page. A memory version backs the tests; a Tauri build can keep the choice
  in its own settings.
- **`notifications` capability** (built 2026-11-08, step 4 spec 4). `platform.notifications`
  has `permission()` (`"granted"`, `"denied"`, `"default"`, or `"unsupported"` where pages
  cannot show notifications, such as phones), `request()` (asks the browser; only from a
  person's action), and `show({ title, body, tag })` (a no-op unless granted; the same `tag`
  replaces an earlier notification). Components never call `Notification` directly. A memory
  version with scripted permission backs the tests; a Tauri build can supply native
  notifications.
- **`online` capability** (built 2026-10-26, spec 5a). `platform.online` has `online()` and
  `onChange(cb)`; on the web it follows `navigator.onLine` and the `online`/`offline` events,
  and drives the offline banner. A Tauri build can report real connectivity.
- **`geolocation` capability** (built 2026-11-04, step 4 spec 2). `platform.geolocation.locate(signal?)`
  asks once, only when "Use my location" is pressed, and resolves `{ ok: true, lat, lon }` or
  `{ ok: false, reason: "denied" | "unavailable" | "timeout" | "unsupported" }` (it rejects
  only on abort). On the web it is one `getCurrentPosition` call (low accuracy, 15 s timeout,
  a position up to 5 minutes old is fine); the memory version takes a scripted position for
  tests; a Tauri build can supply its own. Coordinates are never logged or reported. The place
  picker's **recent places** use the existing per-space `preferences` (`places.recent`).
- **Documents are local-first; fetched data is not** (revised 2026-09-28). Saved documents
  live locally (IndexedDB), which is required for anonymous users and autosave. Fetched
  air-quality data uses an **in-memory cache** shared across widgets, plus the
  **browser's HTTP cache** for persistence across reloads (long `Cache-Control` on
  completed periods, short on the current one). There is no custom persistent data
  store. A larger on-disk data store is a Tauri-era concern.
- **No server runtime, no origin assumptions** (already true — plain Vite SPA). See
  "Authentication" below for the one origin-sensitive piece.
- **Cross-origin isolation is page-scoped, not global.** Some candidate analysis
  tooling (e.g. JupyterLite's SharedArrayBuffer file access) benefits from COOP/COEP headers,
  which break cross-origin resources (map tiles, API) that don't opt in. Never enable
  isolation app-wide; if needed, confine it to a dedicated page/window (Tauri can set
  headers per window). See Open Question #6 in `IDEA.md`.

**Web offline stance (decided 2026-09-24; revised 2026-09-28): not offline-first.**
Air-quality data is inherently live; schools have connectivity; researchers who need data
offline export a notebook bundle. What Release 1 keeps:

- **Local documents** (above) and **versioned sync**, which are needed regardless:
  anonymous storage, autosave, and conflicts from two tabs or devices even when online.
- **Installable via a web app manifest only** ("Add to Home Screen" / Install). An
  installed site is exempt from Safari's 7-day storage eviction, which protects anonymous
  users' dashboards _created in the installed app_. On iOS the home-screen app likely has
  storage separate from Safari (unverified; **verify during the private preview**), so dashboards made in Safari first are moved
  with Export/Import. Modern browsers need only the manifest (and icons), not an offline
  service worker. The manifest is served by Django under `/workspace/` (same origin), not
  from S3.
- **An offline banner** ("You're offline, data may be out of date") from the browser's
  online/offline events, through the platform adapter.

Removed from Release 1: the **app-shell service worker** (the app opening offline, the
update prompt, cache versioning) and the **persistent data cache**. A service worker
arrives with **web push**, which needs one anyway (including on iOS), scoped to
`/workspace/` (JupyterLite's worker stays on `/notebooks/`). Whether it also caches the app
shell then is an optional add-on tracked with web push in `DEFERRED.md`. True offline-first remains a Tauri concern (see `DEFERRED.md`).

When to actually add Tauri: once there's a concrete desktop-only win (most likely
background alerting from the tray, or large offline datasets for researchers). Before
committing, run a short WebKitGTK spike with the map widget to confirm Linux desktop is
viable. See `ROADMAP.md`.

## Authentication

`@sjvair/sdk` supports two auth modes, and which one applies depends on **where this
app is running**, not on a user choice:

| Deployment context                                                                    | Auth mode                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------- |
| Served from sjvair.com's origin (Release 1: `/workspace/`; host-page embedding later) | Django **session cookie** (same-origin)       |
| Standalone on a different origin, or Tauri desktop                                    | **`Authorization: Token <api_token>`** header |
| (Reference: `../mobile`, the mobile app)                                              | Token header                                  |

Release 1 is served from sjvair.com's origin and uses cookie auth (see "Deployment").

How the SDK does it: `account/login` returns `UserDetails` including `api_token`. Some
authenticated calls (e.g. `getSubscriptions`) take an **optional** `apiToken`: when it
is passed a `Token` header is sent, and when it is omitted the request relies on the
browser's same-origin session cookie. Until 4.7.0 others **required** a token:
`getUserDetails`, `updateUser`, `getAirAlerts`, `subscribe`/`unsubscribe`, `deleteUser`,
the phone functions, and change-password (`sdk-js/lib/account/*`). The server (resticus)
accepts an existing session for them, so that was an SDK signature limitation. **The sdk-js
change making `apiToken` optional on those calls shipped in @sjvair/sdk 4.7.0** (commit
a211be6), found already done while designing spec 5b (2026-10-27).

**Session responses carry no `api_token`** (decided 2026-10-27, spec 5b). `GET`, `PATCH`, and
`DELETE account/` and `PUT account/password/` leave `api_token` out when the request was
authenticated by session cookie, and so does `GET account/login/`, which answers a GET with
the signed-in user (found in the 5b final review: it had returned the token to any
session-cookie request). Token requests (the mobile app) get it as before, and so do a
credential `POST account/login/` and registration, which exist to hand it out. A signed-out
request to `account/` or a GET of `account/login/` is a `401`, not the `500` it was. The SDK rejects a non-2xx JSON call with the
response status at `error.cause.result.status`; the dashboard reads the status there. The
dashboard validates the account response with its own schema, so it needs no new SDK release.
The type side (a `SessionUserDetails` type and overloads on `getUserDetails`, `updateUser`,
and `changePassword`) was merged into sdk-js
`release/4.8.0` (#33, 2026-10-27); no beta or release was cut for it. Consequences:

- Cookies **only work same-origin**. A standalone deployment (e.g. a separate
  subdomain) or a Tauri window (`tauri://`/`http://tauri.localhost` origin) must use
  tokens.
- Auth mode is a **platform-adapter concern**: the adapter exposes "how to
  authenticate" (cookie vs. token + where the token is stored), and data managers pass
  `apiToken` (or not) accordingly. No component decides this itself.
- Token storage must go through the adapter too (browser storage on web, OS keychain /
  secure store under Tauri).

## Accounts & anonymous use

Decided 2026-09-24. Uses the existing **sjvair.com accounts** (register, login,
password reset, phone verification — all wrapped by `@sjvair/sdk` `account/*`); no new
auth system. See "Authentication" for cookie vs token.

**Email-only accounts (decided 2026-09-28, Release 1).** Today every account **requires a
phone number**: `phone` is unique and required, it is `USERNAME_FIELD`, and registration
immediately texts a verification code. Email is optional and never verified. That would
force teachers, researchers, and anyone without a mobile phone to give and verify a
phone number just to sync dashboards. So in Release 1 (sjvair.com accounts work plus sdk-js
changes, approved plans first):

- **`phone` becomes optional.** An account needs **either a verified phone or a verified
  email**.
- **A new email verification flow**, mirroring phone verification (an emailed link).
- **Login by email or phone** (the existing `identifier` field), and registration by
  either.
- **SMS alerts require a verified phone; email alerts require a verified email.** Users
  can add the other later.
- **Must not break existing consumers:** phone-based registration and login keep working
  for mobile and existing users. The username-field change needs care (phone-less
  users), which the plan must address.

**Age policy (decided 2026-10-13).** Email-only accounts remove the phone barrier that
kept most young students from registering, and COPPA restricts collecting personal
information from children under 13 without verifiable parental consent.

- **Accounts are for ages 13 and up.** Registration includes a **neutral age
  confirmation** (e.g. a birth year, with no hint at the "right" answer).
- **Students under 13 use the dashboard without an account.** Everything except alerts
  and cross-device sync already works anonymously, and teachers share by link. Accounts
  are not marketed to students.
- **Collect less:** `full_name` becomes optional for email-only accounts (the public
  display name is already optional).
- **sjvair.com gets a privacy policy page**, which the in-app privacy note links to.
- **The legal position must be confirmed** by whoever advises SJVAir before the
  email-only accounts plan is finalized (see `DEFERRED.md` → "Open decisions").
  Under-13 accounts with parental or school consent are deferred.

**Everything works anonymously except what needs the server to act or persist for
you:**

| Anonymous (local via platform adapter)                 | Requires an account                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Dashboards, widgets, Widget Creation                   | Automated alerts (SMS/email) + alert inbox                                            |
| Collections, analyses, notebook export, JupyterLite    | Creating server-backed documents & live share links (opening a link needs no account) |
| Self-monitoring (client-side thresholds/notifications) | Cross-device sync                                                                     |
| File / URL sharing (fork on open)                      |                                                                                       |

- **Sign-in is lazy/contextual** — prompted only when needed (e.g. inside the "Create
  alert" flow), never as a gate on first load.
- **Local storage is split into spaces** (decided 2026-10-13): one anonymous space plus
  one per account. Spec 5b (2026-10-27) built none of the account-space behavior below and
  marked it _held for sync_ (without server saves each part promised something false or could
  lose work). **Sync spec 2 (2026-11-02) built all of it**: signed-in work lives in
  `account:<user id>` and syncs, and the app remounts when the space changes. Every
  local document, queued change, and place preference belongs to exactly one space, and the
  app only ever shows the current one. Purely cosmetic device settings (e.g. theme) stay
  with the browser.
  - **Signing in asks once about anonymous work** ("Add the 3 dashboards
    made on this browser to your account?"). Yes moves them into the account with the same
    IDs and out of the anonymous space; No leaves them for signed-out use.
  - **Signing out removes that account's local copies** from the browser (they are on the
    server). If changes haven't synced, the app says so and offers to finish first. **"Sign
    out anyway" hides the space** (kept 30 days) instead of removing it, so nothing is lost,
    and signing back in as the same person resumes it.
  - **An expired or browser-session-ended sign-in is not a sign-out**: the
    space is hidden but kept, so unsynced work survives, and signing back in as the same
    person resumes it. A hidden space nobody returns to is removed after 30 days.
  - **ID collisions become copies.** The server accepts a save to an existing ID only
    from its owner. If an upload hits an ID owned by someone else, the client assigns a
    new ID and uploads a copy with `copied_from` set. Nothing is overwritten.
  - **Sign-in and sign-out apply to every open tab at once**, through the cross-tab
    channel (built in 5b: the tab channel carries an identity message).
  - **Saves are bound to an account** (decided 2026-10-13; built in sync spec 2). In
    Release 1, sign-in and sign-out happen on sjvair.com's pages, so the cookie can change
    (another person signs in, or a session expires) while a tab still holds one person's
    queued changes.
    - Each account space records its **account id** (the server's stable user id).
    - **Every save names the account it is for, and the server refuses a mismatch**: no
      write happens, and the response says who is signed in. This is the real guard, since
      a client-only check can be raced.
    - **The app re-checks who is signed in** when a tab regains focus and before each
      sync. If the account changed, it switches spaces (hiding and keeping the previous
      one, as for an expired session) and says so.
  - **A session-identity response without the API token** (decided 2026-10-13; revised
    2026-10-27, spec 5b). The account response includes the permanent `api_token`, which
    the mobile app needs but a cookie-authenticated dashboard never does; receiving it would
    let an injection bug steal a credential that outlives the session. There is **no
    separate session-identity endpoint**: `GET /api/2.0/account/` serves all three callers.
    Token requests are unchanged (mobile keeps `api_token`); session-cookie requests get the
    same fields **without `api_token`**; signed out is `401`. Dropping the token for session
    requests is the protection itself, since a separate endpoint would leave it reachable
    through `account/`. **The response keeps `phone`** (the shapes stay the same apart from the
    token). The dashboard gets it **on first load from the Django template** (a non-executing
    JSON data block, see "Deployment" → "Template embedding"), and for re-checks from
    `account/` with no token. A re-check answers `200` (signed in), `401` or `403` (signed
    out), and anything else (network error, timeout, `5xx`, a response that fails validation)
    changes nothing, so being offline never looks like a sign-out. Re-checks run when the app
    becomes visible (at most every 30 seconds), when the connection returns, and when the
    account menu opens. Identities are compared by `id`.
- **Account deletion is immediate and complete** (decided 2026-10-13). The server already
  deletes an account at once after a password check (the mobile app relies on it), and
  subscriptions and the delivery log go with it. It now also covers everything the
  dashboard adds:
  - **Server-saved documents** are deleted for real, including ones in the 30-day trash
    and all recovery snapshots. **Live share links stop at once** and show the "no longer
    available" page.
  - **Copies other people made stay theirs.** They keep only the original's id
    (`copied_from`), which no longer resolves and holds no personal data.
  - **Alert rules, the delivery log, the inbox marker, and the public display name** are
    deleted. Staff takedown records are kept but unlinked from the person. Error reports
    hold no names, emails, or account ids, so there is nothing to delete there.
  - **Local copies** are removed from this browser immediately: after a deletion, sjvair.com's
    first `/workspace/` page carries the old account id once as `deletedAccount` in the
    identity block, and the dashboard removes that space when it next opens there, once no open
    tab holds it (tabs still showing it switch away first). Other devices hide a
    deleted account's space at once, when they learn the account is gone, and remove it
    within 30 days (spec 2). The server keeps no record of deleted accounts.
  - **A backup is offered first.** The confirmation states what will be deleted (counts
    of documents, share links, and rules) and offers "Download my documents" as one file,
    importable later with or without an account.
  - **One place to do it:** sjvair.com's account page, where the password check lives.
    The dashboard's account menu links there; the mobile app's flow is unchanged.
  - A 30-day grace period is decided against (see `DEFERRED.md`).
- **No teacher/class/org accounts**; teachers share via links.
- **Shared computers:** per-account spaces (above) keep one person's signed-in documents
  away from the next person. For signed-out work the **browser profile is the boundary**
  (as for any website; managed Chromebooks usually give each student their own profile).
  Provide a visible
  **"Clear my data"** action. Signing in **without "remember me"** gives a session that
  ends when the browser closes: under cookie auth that's a browser-session cookie (a
  small server change, see "Sign-in flow"), and for token builds a session-only token
  via the platform adapter. A dedicated guest mode is deferred.

### Security baseline for untrusted content

Decided 2026-09-28. The dashboard runs on **sjvair.com's own origin**, with the session
cookie and a JS-readable CSRF cookie, so an XSS bug in `/workspace/` could act as the
signed-in user (change password, delete account, SMS sign-ups). Untrusted content enters
through **Notes Markdown** (shown to anyone opening a share link) and through **`/import#…`**,
files, and server documents.

1. **Validate every incoming document**, from a file, URL fragment, or the server, against
   a schema (zod, as in the SDK) and a size limit **before** migration or use. Invalid
   documents are rejected with a clear message and never partly loaded.
   - **Layout rects are capped** (step 2, spec 2a final review): a widget starts at row
     `MAX_ROW` (100,000) at most and is `MAX_HEIGHT` (100) rows tall at most, in the schema
     and when arranging (a drop past the caps applies nothing). The layout engine's work
     grows with rows, so an uncapped `y` or `h` in a shared document could hang the tab.
2. **Safe Markdown:** Notes render with **raw HTML off** and a link allowlist (`http`,
   `https`, `mailto`). **As built (step 4 spec 6, 2026-11-10):** the viewer runs `marked`'s
   lexer only and draws its tokens as a **closed model of blocks** (paragraphs, the one heading
   level, bulleted and numbered lists, bold, italic, links) with Svelte components; **no HTML
   string is ever built or injected**. Raw HTML tokens, images, tables, code, quotes and other
   headings show as plain text, and nested lists flatten to text (`DEFERRED.md`). Links are
   checked at render time (`http:`, `https:`, `mailto:` only; they open in a new tab with
   `rel="ugc nofollow noopener"`), whatever the saved text says. The editor (Lexical) is
   limited to the same set, and pasted content is reduced to it. The Note's saved options are
   validated with the document (`src/lib/notes/options.ts`): `{ text }` of at most 5,000
   characters, or `{ message }` (a key-shaped reference, allowlisted at render). Lexical and
   `marked` load only when a Note is shown or edited.
3. **A content security policy on `/workspace/*`**, sent by the Django view: the
   browser-enforced backstop if a bug slips past 1–2.
   - `script-src 'self'` plus **the dashboard's own folder** on the static host (production
     serves built files from S3; see "Deployment" → "Template embedding"), and `'wasm-unsafe-eval'` only where
     WebAssembly needs it: no inline scripts or handlers, and no third-party scripts.
   - `worker-src 'self' blob:` (workers are built inline; see "Template embedding").
   - Explicit `connect-src`/`img-src` hosts (the sjvair.com API, MapTiler, NREL, …), so
     injected code can't send data elsewhere.
   - `style-src` may need `'unsafe-inline'` (Svelte and map libraries set inline styles).
   - **Rollout:** deploy in **report-only** mode first, then enforce once clean. It
     applies only to `/workspace/*`.
   - **Ownership** (decided 2026-10-13, revised the same day once embedding was
     settled): the page is a Django template, so **sjvair.com's view holds the host list
     and sends the header**. This repo keeps a checked-in list of the hosts its code needs
     as the reference, with a test that fails when code references an unlisted host; a
     new host therefore needs a matching sjvair.com change, and the report-only phase and
     the app's own violation reports (below) catch any drift.
   - **The app also reports violations itself:** it listens for the browser's
     policy-violation event and sends it through the scrubbed error reporting.
   - **No `'unsafe-eval'`, and the E2E suite runs under the contract CSP** (spec 5a final
     review). Zod's compiled parser probes `new Function`, so every module imports `z` from
     `$lib/zod`, which sets `jitless` first (ESLint forbids importing `zod` directly). The
     preview server sends the CSP from `csp-hosts.json`, and an E2E fixture fails any test
     whose page reports a violation.
4. **Unguessable share tokens:** at least 128 bits (`secrets.token_urlsafe(16)` or
   more), revocable.
5. **Abuse limits** in the server-documents plan: per-user caps on document count and save
   rate, alongside the body size limit.
6. **User-made pages are labeled and removable** (decided 2026-10-13). A live share link
   sits on sjvair.com but its title, Notes, and links are the author's, so:
   - **A "made by a user" bar on every shared page** (built in sync spec 3), always visible and
     not removable by the author: who shared it (the optional display name, else a generic label) and that
     it is not an official SJVAir page. The data in the widgets is still SJVAir's.
   - **Links in user text are marked as user content:** they open in a new tab with
     `rel="ugc nofollow noopener"`. Shared pages are served `noindex`.
   - **A "Report this page" link** (built in sync spec 3) in that bar, going to sjvair.com's
     existing contact form with the share link filled in. No separate moderation system.
   - **Staff takedown** in the Django admin: disable a share link (it then shows a "no
     longer available" page) and, if needed, block an account from creating shares. The
     author's own document is untouched. Each takedown records who and when.
   - Automatic text filtering and pre-publication review are decided against, and a
     public gallery stays deferred (see `DEFERRED.md`).

### CSRF protection for cookie-authenticated API writes

Decided 2026-09-28. Verified in code:

- **Website pages and forms are protected.** Django's CSRF middleware is on (it sets the
  `csrftoken` cookie).
- **Session-cookie API requests are not.** sjvair.com's API uses `django-resticus`
  (installed from its unpinned `develop` branch; configured with `TokenAuth` only).
  `Endpoint.dispatch` is `csrf_exempt`, and `Endpoint.authenticate` returns an
  already-logged-in session user early, so resticus's own `SessionAuth.enforce_csrf`
  never runs.
- It is mitigated today by token auth for most API writes (mobile) and by
  `SameSite=Lax`. **Release 1's cookie-based document saves would be the first
  significant writes on this path**, so the fix must land first.

**The fix goes in resticus** (local repo `~/workspace/django-resticus`, remote
`dmpayton/django-resticus`; the user has access and coordinates with its developer). When a
request is authenticated by the **session** (not a token) and **changes data**
(POST/PUT/PATCH/DELETE), run Django's CSRF check. Keep the existing early return (add the
check there) so nothing else changes for existing resticus users. Tests cover:

- session with no CSRF token → rejected
- session with a CSRF token → accepted
- token-only → accepted
- GET → unaffected

**Supporting changes:**

- **The SDK sends `X-CSRFToken` automatically** on same-origin writes in a browser (from the
  `csrftoken` cookie; see "SDK request options"). Token clients are unaffected.
- **The only cookie-based API write on sjvair.com today is monitor-map's subscribe
  button** (`window.USER` on sjvair.com has no `api_token`, so it passes an empty token and relies on
  the session cookie). It is fixed by upgrading monitor-map to
  sdk-js 4.7.0, so it needs no separate page change.
- **The resticus fix skips the CSRF check when the request also carries a valid token**,
  so a client that sends both a session cookie and a token is not rejected. As built
  (2026-10-22), this is generic: the check is skipped when any configured authenticator
  other than `SessionAuth` (token, basic) accepts the request's own credentials; invalid
  or malformed credentials count as none. The session user is still the one returned.
- **A second cookie-based write was found (2026-10-21): the admin Data Export form**, which
  posts straight to the `entries/export/` API endpoint. sjvair.com's `fix/csrf-ready` adds
  `{% csrf_token %}` to it, and makes 43 `RequestFactory` API tests opt out of CSRF the way
  Django's test client does (`camp.utils.test.CsrfExemptRequestFactory`).
- **Built 2026-10-22:** resticus `fix/session-csrf` (also fixes multipart parsing the CSRF
  check exposed: malformed bodies give 400, not 500, and bodies aren't parsed twice or
  dropped) and sjvair.com `fix/csrf-ready`. PRs: resticus
  [#25](https://github.com/dmpayton/django-resticus/pull/25), sjvair.com [#292](https://github.com/SJVAir/sjvair.com/pull/292).
  Verified on local sjvair.com: signed-in subscribe and unsubscribe pass, a write without
  `X-CSRFToken` gets 403, and token-only writes and admin export work.
- **Follow-ups (2026-10-22), resticus [#26](https://github.com/dmpayton/django-resticus/pull/26)**,
  stacked on #25: the credential lookup is skipped for safe methods, a token header that
  isn't UTF-8 is an invalid token (401), and the rule for custom authenticators is
  documented: only accept credentials a browser doesn't send on its own; a cookie-reading
  authenticator subclasses `SessionAuth` and calls `enforce_csrf`.

**Ordering, since resticus is not pinned** (decided 2026-09-28; the user is discussing
pinning with its developer): sjvair.com installs resticus `develop`, so merging the fix
there reaches production at the next server deploy. The sjvair.com pages that use the
cookie and the SDK header must therefore be ready **before or together with** that merge,
and all of it must land before the dashboard's cookie-based saves ship. **Rollout order:**
sdk-js 4.7.0 released, then monitor-map's upgrade on its `main` (done 2026-10-21: monitor-map 4.3.0, PR #124), then the resticus merge.
Needs approved plans in resticus, sjvair.com, and sdk-js. **Before the user tells the
resticus developer to merge**, sjvair.com's production must already have monitor-map 4.3.0
(built from monitor-map `main` at deploy) and the `fix/csrf-ready` changes (sjvair.com
`develop` → `main` → deploy); otherwise subscribe or admin export breaks until they land. **Merging to resticus `develop` needs explicit
approval** (it's effectively a production deploy while unpinned), as does any resticus release.

### Sign-in flow

Decided 2026-09-24. The API's `account/login` is **token-only**
(`TokenAuthEndpoint`: it returns `api_token` and never calls Django's `login()`). Only the
website form at `/account/login/` (Django `LoginView`) creates a session cookie. The
approach is staged:

- **Release 1: redirect.** "Sign in" / "Create account" go to sjvair.com's own pages
  (`/account/login/?next=/workspace/…`, registration likewise) and return to the same
  dashboard route. This reuses the mature Django flows (password reset, phone
  verification, plus the new email verification from "Accounts & anonymous use") and
  adds no new auth endpoint. Known cost: in-progress dialog state
  isn't preserved across the redirect (autosave keeps documents safe). **"Remember me"**
  needs a small sjvair.com change (a checkbox; when unchecked, the session expires at
  browser close) in the **email-only accounts plan** (both change the login page).
- **By Release 2: in-app session login.** A small `POST account/session/` endpoint
  (`{identifier, password, remember}` → Django `login()` plus session expiry, with a
  matching logout) behind an in-app sign-in dialog. That keeps mid-flow sign-in (e.g.
  inside "Create alert") in context and matches the app's design. It needs rate
  limiting and non-enumerating error messages. The same dialog later serves Tauri and
  standalone builds using tokens. The rest of the app only asks "am I signed in?", so
  the switch is contained.
- **SDK:** `apiToken` is optional on the account calls (`getUserDetails`, `updateUser`,
  `getAirAlerts`, `subscribe`/`unsubscribe`, `deleteUser`, the phone functions,
  change-password), so a session works everywhere. Shipped in @sjvair/sdk 4.7.0.
- **Built in 5b (2026-10-27):** a "Sign in" button and an account menu in the top bar.
  - **Sign in** links to `/account/login/?next=<pathname + search>` (never the hash). The
    login page used to drop `next` (its form had no hidden `next` field, so everyone landed
    on `/`); it now keeps it, for the whole site. `LoginView` still checks it is a same-site
    URL.
  - **Sign out is a `POST` to `/account/logout/`**, sent by the platform adapter with
    `fetch` (same origin, `X-CSRFToken` from the `csrftoken` cookie, the redirect treated as
    success). Django 5.2's `LogoutView` signs out only on POST, so sjvair.com's own Logout
    link, which was a GET and returned `405`, became a small POST form. The CSP's
    `form-action 'none'` rules out a form on the dashboard side. It is not an SDK call; the
    Release 2 `account/session/` logout will be. On success the identity becomes signed out
    here and in every open tab, with a "Signed out" toast. On failure the person stays signed
    in, sees an error toast, and the app re-checks in case it went through.
  - **A change this tab didn't cause** (expired, signed out elsewhere, another account) shows
    a toast ("You've been signed out.", "Signed in as …", "Now signed in as …").
  - **Returning after sign-up is not built.** A new account still goes sign-up → the "enter
    your code" page → the profile page. Passing `next` to sign-up would skip phone
    verification (`SignupView` sends the person to `next` instead of the code page). It is
    designed once, with the email-only accounts track (`DEFERRED.md` → "Accounts").
- **Development:** the Vite dev server proxies `/api/` and `/account/` to the local
  podman sjvair.com (target: `SJVAIR_DEV_SERVER`, not `VITE_`-prefixed, default
  `http://localhost:8000`), so dev is same-origin and cookies behave as in production.
  Because Vite serves the app itself in dev, Django's `ensure_csrf_cookie` never runs
  there, so dev bootstraps the `csrftoken` cookie once through the proxy with a GET of
  `/account/login/` (built 2026-10-26, spec 5a). `npm run test:dev-stack` smoke-tests this
  against the running stack. In production, cookie-based saves depend
  on the hosting track's `ensure_csrf_cookie`.

## SDK request options

Decided 2026-09-28; built and released 2026-10-21 as @sjvair/sdk 4.7.0 (PR
https://github.com/SJVAir/sdk-js/pull/30).
`@sjvair/sdk`'s data wrappers used to pass no `init`, so there was no `AbortSignal` (needed
for last-requested-wins), no single place to set headers (`X-CSRFToken`, a future
`Accept-Language`), and no global `credentials`. One **additive** change fixes this:

- **Every fetching function takes a final `options?: RequestOptions`** (`{ signal, init }`),
  passed through to `fetch` (`getMonitors` names it `requestOptions`). An aborted call
  rejects with the signal's reason, unchanged (`abort()` gives an `AbortError`).
- **A global `setRequestDefaults({ headers, credentials, csrf })`** that the dashboard
  sets once. Headers merge in this order, lowest to highest: the built-in CSRF header,
  the global defaults, the function's own headers, then the caller's `init.headers`.
- **CSRF is automatic.** On POST/PUT/PATCH/DELETE in a browser, and only to the page's own
  origin, the SDK copies the `csrftoken` cookie into an `X-CSRFToken` header. It reads the
  cookie fresh on every request. The cookie and header names are configurable, and
  `csrf: false` turns it off.
- **Account calls take an optional `apiToken`.** The SDK sends `Authorization` only for a
  non-empty token.
- **Error causes are scrubbed.** The `Authorization` header, the CSRF header, and the
  request body (passwords, say) are redacted so they cannot reach error reports.
- **Nothing breaks:** every addition is optional (monitor-map, mobile, and existing code
  are unaffected).

## The dashboard's own API code

Decided 2026-11-11 (the user). **`src/lib/api/` holds calls to sjvair.com endpoints that only
the dashboard uses**, one folder per server area; the first is `src/lib/api/documents/` (saved
documents, change logs, share links, snapshots, the display name). It's built on
`@sjvair/sdk/http`, so the origin and request defaults that `configureSdk`
(`src/lib/sdk-setup.ts`) sets, and the http module's built-in CSRF header, apply to it as to the
rest of the SDK.

- **Public data stays in `@sjvair/sdk`** (monitors, HMS, regions and the rest), as do site-wide
  account features (sign-in, profile, subscriptions, alerts). `src/lib/api/` never duplicates
  something the SDK has; when the dashboard needs public data the SDK lacks, the SDK gets it.
- **An endpoint moves into the SDK once a second app needs it.**
- This is the dashboard's side of sdk-js's matching rule in its `CLAUDE.md` (the user,
  2026-11-11): the public SDK covers public data plus site-wide account features, and an endpoint
  backing only one app's own feature lives in that app, built on `@sjvair/sdk/http`.
- ESLint rejects imports of `@sjvair/sdk/documents` (the module left the public SDK).

## Data resolution & live refresh

Decided 2026-09-24. Implemented once in the data layer (in-memory cache plus HTTP
caching), not per widget.

**Automatic resolution by range span** (bounds fetch size):

| Range span       | Resolution        |
| ---------------- | ----------------- |
| ≤ 3 days         | Raw entries       |
| ≤ 7 days         | Hourly summaries  |
| ≤ 1 year (365 d) | Daily summaries   |
| longer           | Monthly summaries |

Revised 2026-11-04 (step 4 spec 1, the user; was raw ≤ 2 days, hourly ≤ ~60 days, daily ≤ ~2
years): a month of hourly points reads as alarming spikes to a parent, and monthly points hide
a week of wildfire smoke. Daily views of up to 92 days also carry each day's **worst hourly
average** (computed in the browser from hourly summaries, single place only), not the daily
summary's `maximum`, which is one raw reading. Spec:
`docs/superpowers/specs/2026-11-04-step-4-spec-1-groundwork-chart-table-design.md`. **As
built:** the span is counted in Pacific calendar days, first date to last inclusive ("last 30
days" is 30), except a trailing-hours range, which is its elapsed hours / 24.

- **Datasets without summaries** (decided 2026-09-25). Only pm25, o3, no2, so2 and co have
  server summaries, so the ladder only uses levels the catalog lists in each entry type's `resolutions`:
  - **Naturally daily data** (HMS smoke/fire, forecasts, CalHeatScore) is fetched as-is
    and aggregated for display (e.g. smoke days per month).
  - **Unsummarized time series** (CIMIS weather, PM10) are fetched raw with a span cap
    (about 1 year per request, split into chunks) and **downsampled in a Web Worker** (built inline, since static files are cross-origin) to
    the resolution the ladder would pick. The table and exports say "computed from raw
    data".
  - **Pesticide use** is monthly and yearly (the server's `months` and `years`; spec 3b).
  - Weather now has server summaries (CIMIS stations, sjvair.com #313, used by spec 3b); PM10's are deferred (see `DEFERRED.md`).
- **Number overlays and coarser strips (spec 3b).** A number overlay's strip is pinned to the
  main data's resolution (`pin`): `chooseResolution` falls back to the nearest coarser level the
  overlay's entry type offers (a daily chart gets monthly pesticide bars). An overlay's own saved
  `resolution` is ignored. Level overlays keep spec 3's behavior (no pin).
- **Totals follow the catalog's `aggregate` (the user, 2026-11-07, `@sjvair/sdk` 5.0.0-beta.6;
  decision 2 of spec 3b's plan).** Each catalog entry type has a top-level `aggregate`: `"sum"`
  (weather precipitation, ETo, ETr; pounds applied, acres treated, applications) reads the
  summary's `sum`, and rolling values into an open period sums them; `"mean"` (pollutants, the
  other weather entries) reads `mean` and an open period averages; `null` (wind direction,
  forecasts, smoke density, and others) never rolls up. `display.chart` picks bars or a line
  and nothing else. Pesticide Yearly still reads the server's `years[]`, since summing months can
  fall short of a year; summing is only for an open month.
- **Incomplete periods are stitched from finer data** — e.g. the current month (no
  monthly rollup until it ends) is computed from daily summaries so far, today from
  hourly. Fixes the "current month shows nothing" problem for every widget.
- **The last completed period is backfilled too** (2026-10-22, Foundations spec 2). Server
  rollups lag the period's end: hour H is summarized at about H+1:45 for monitors and H+1:50
  for regions, daily rollups run at about 01:10 Pacific, monthly ones on the 1st at about
  01:25, and yearly ones at about 02:05 (all on Pacific time since 2026-11-04). So the query
  also fetches the last completed period from the next finer offered level and uses it only
  where the coarse response lacks that period (computed client-side, and complete, so not
  partial); once the server's rollup exists, the coarse value wins. Where no finer level is
  offered (regions at hour, which have no raw entries) there is no backfill, and that period
  stays empty until the server task runs. Since step 4 spec 1 the backfill's own last
  sub-period is filled one level finer again, and the backfill is skipped for places whose
  coarse value has arrived.
- Advanced **resolution override** in Widget Creation (Release 1 step 4); data table and
  exports show the resolution used.
- **Where resolution lives** (decided 2026-09-28): each layer (and so each
  `QueryDescriptor`) carries `resolution` (`"auto"` by default), so Collections and exports
  keep it. A `WidgetType` may **pin** a resolution: calendars `"day"` (the hour × weekday
  heatmap's `"hour"` pin went with the widget, dropped 2026-11-09). **Priority:
  widget-type pin → user override → automatic ladder.** Pinned widgets don't show the
  override.
- Long raw exports (notebook bundles, CSV) use the monthly **CSV archive** endpoint.

**Live refresh:**

- Only widgets whose date range **includes now** refresh.
- Cadence follows data cadence: raw/current-conditions every 2–5 min; hourly summaries
  hourly, scheduled a few minutes after the server's :50 region-summary task; daily
  after midnight plus hourly for today's partial value.
- **One poll per descriptor**, shared across widgets via the cache; **pause while the
  browser tab is hidden**; back off on errors.
- **Cadence as built** (2026-10-22, Foundations spec 2): raw entries poll every 3 minutes;
  every other resolution polls at the next :55 past the hour in Pacific time, after the
  server's :50 summary task. Errors back off from 30 seconds, doubling up to 30 minutes, and
  reset on success. Polling runs only for ranges that include now and pauses while the page is
  hidden; on becoming visible, each overdue key gets one catch-up poll. A key that becomes
  pollable again (resubscribed from the cache, or a widget un-minimized) is scheduled from its
  last fetch, so data that is already overdue is refetched at once. Raw entries are
  requested with the monitor type's published processor and zone-aware UTC bounds, so they
  are on the same (calibrated) series the summaries use.
- **Minimized widgets refresh only if they have thresholds configured** — so their
  taskbar entry can flash when a threshold is crossed (self-monitoring). Minimized
  widgets without thresholds don't poll.
  **As built (step 4 spec 4, 2026-11-08):** the dashboard-level threshold watcher is what keeps
  a minimized widget with an alert level refreshing (it holds the same shared query as the tile).
- **The "now" client** (step 4 spec 4, 2026-11-08; `src/lib/data/now/`). The live tiles read
  through one shared client that plugs into the same poller: the **alert value polls every 3
  minutes** (`raw` cadence), and **forecast days and today's heat poll hourly** (at :55 Pacific,
  like summaries). Sources are keyed without coordinates; a key idle for an hour is dropped.
- **Caching:** an in-memory cache keyed by descriptor, shared across widgets. Across
  reloads, the **browser's HTTP cache** does the work: completed periods are immutable, so
  the server sends a long `Cache-Control`; open periods get a short one. The server's
  summary cache headers are therefore a **Release 1 requirement** (metadata enablers,
  step 3), not an optional follow-up.
  - **The cache rule** (built in spec 2, sjvair.com #301): a period that has **settled**
    answers `Cache-Control: private, max-age=86400`; anything that includes now, or whose
    rollup is still due, answers `private, max-age=60`. Every 200 carries an `ETag` and
    answers `If-None-Match` with a 304; errors are `no-cache`. A period settles at its end
    plus a margin that covers its rollup time (hour 2 h, day 3 h, month, quarter and season
    4 h, year 5 h), computed in Pacific time; the table is `camp/apps/summaries/schedule.py`
    in sjvair.com. Rollups land at about 01:00-02:05 Pacific after the period ends.
  - **Stable URLs:** the browser reuses its cache only for the same URL, so the data layer
    requests settled periods with stable URLs (fixed start and end) separately from the live
    tail. One request spanning "up to now" changes URL every time and never hits the cache.
    **Request units as built** (step 4 spec 1): requests cover whole Pacific calendar units, a
    **month** for hourly and daily summaries (and the worst hour's hourly fetch) and a **year**
    for monthly, quarterly, and seasonal ones (yearly is one call); each past unit is its own
    request and only the unit containing now is live, so "last 30 days" is last month (long
    cache) plus this month so far (60 s). Rows outside the range are dropped in the browser.
- In-flight requests are superseded by newer ones for the same widget
  (last-requested wins, not last-to-finish).

## Routing, URL state & undo

Decided 2026-09-24. Supersedes the v1 "URL is the source of truth" rule (see "Legacy:
v1 tab model") for the dashboard direction.

**The URL identifies _where you are_; the saved document holds _what's there_.** A
dashboard's layout and widget configs are far too large for a URL and are now saved
documents (see "Saving & sharing documents").

**Routes use readable words, never single-letter segments** (decided 2026-09-25). IDs
stay opaque (no readable slugs). **IDs only appear inside their own plural collection**
(`/dashboards/:id`, `/analysis/collections/:id`), never at the same level as fixed words, so no
reserved-word list is needed. All routes sit under the `/workspace/` base path (see
"Deployment"), e.g. `sjvair.com/workspace/dashboards/:id`. Where a trimmed URL has a
page, it's the obvious one (e.g. `…/dashboards/:id` → `…/dashboards`, the list). Other
trimmed paths (e.g. `…/analysis/collections`, `…/shared`) redirect to their section's
home (`/shared` redirects to `/`; `/shared/:token` is built, sync spec 3).

```
/                                                last-opened dashboard (preference) or the starter
/dashboards                                      all dashboards (list)
/dashboards/:id                                  a dashboard
/dashboards/:id/widgets/new?type=chart           Get data, adding to that dashboard (from Add widget)
/dashboards/:id?widget=:widgetId                 that widget fullscreen (deep-linkable)
/dashboards/:id/widgets/:widgetId/edit           Get data editing a widget's data ("Edit data")
/data                                            Get data, from the top nav ("Data")
/analysis                                        Analysis home (your Collections)
/analysis/collections/:id                        a Collection
/analysis/collections/:id/analyses/:analysisId   an analysis run on it
/shared/:token                                   a server-shared document (read-only + "Make a copy")
/import#<lz-compressed document>                 URL-fragment share → opens a copy (fork on open)
```

The `/analysis` routes arrive with Collections in Release 3 (see "Collections"). The three
Get data routes were built in step 4 spec 3; `/dashboards/:id/widgets` (trimmed) goes to the
dashboard, and the Get data draft never goes in the URL (see "Get data").

- **Back/forward navigates between places** (dashboards, fullscreen, Get data, Analysis) —
  never between edits.
- **Ephemeral UI state stays out of the URL** (open accordions, in-progress map
  selection, calendar drag range).
- **Opening a document from another device:** for signed-in users, synced documents
  open on any device (the server keeps the client UUID). The "This dashboard is saved on
  another device" message, with a pointer to **Share**, appears only for anonymous users
  or documents that were never synced.
- **Embedding:** same routes, held in memory when the host owns the URL (see
  "Embedding").
- The v1 per-tab URL seeding is gone. Preferences hold the "last-opened dashboard" and the
  Get data draft (through the platform adapter).

**Undo/redo (first release).** A **document-level undo/redo stack** (Ctrl+Z /
Ctrl+Shift+Z, plus menu actions via the shared action list), separate from browser
history. All edits to dashboards, Collections, and analyses go through a single
**`applyChange(doc, change)`** function producing a new document version plus an
inverse change — so undo is free by construction and edits are testable. Covers every
change to a saved document: move, resize, add/delete/configure widget, rename, and
Collection edits, plus minimize/restore. Fullscreen and other view-only state aren't on it
and never count as an edit (decided 2026-10-28, step 2).
The stack is per document and per session (not persisted).

**Changes, unsynced edits, and tabs** (decided 2026-09-28):

- **A change is serializable JSON naming exactly what it touches**, e.g.
  `{ op: "moveWidget", target: { widgetId }, from, to }` or
  `{ op: "setField", target: { widgetId, path: "layers.0.entryType" }, value }`. Undo
  stores each change's inverse. Overlap detection for conflict handling compares
  `target`s.
- **Unsynced changes are persisted** in IndexedDB with the document: a queue plus the
  base version they build on. They survive reloads and crashes, and sync resumes on
  reopen.
- **Tabs in the same browser stay in step via `BroadcastChannel`.** A change in one tab is
  broadcast and applied in the others. Local saves are versioned too, and genuine
  same-target edits across tabs go through the **same replay-and-prompt logic** as server
  sync. Undo history stays per tab.
- **Layout moves never prompt** (decided with the user, 2026-10-28; built in sync spec 2,
  2026-11-02). Two `setLayout` changes never overlap, between devices or between tabs: mine is
  replayed over theirs (the last save wins) and step 2's engine tidies any overlap. Because a
  `setLayout` records every widget its move pushed, the later device's arrangement replaces the
  earlier one's, including the earlier device's own moves (seen in the spec 3 hand check; see
  `DEFERRED.md` → "Merging colliding layout moves more cleverly"). `setLayout` against `removeWidget` doesn't prompt either (the delete wins and the move is
  dropped). This replaces step 2's rule that two `setLayout`s overlap if they share a widget id
  with a different `to`. Two deletes also agree: two `setField deletedAt` changes that both set
  a time don't overlap.

## Widget data selection (partial datasets)

Decided 2026-09-23 (IDEA.md Open Question #2).

**What gets staged is a query descriptor, not copied data.** This is the **single
definition** used by Collections, saved documents, and export manifests. A widget's
config is **one shared date range plus a list of layers** (see "Get data"),
and each layer resolves to one descriptor:

```ts
type QueryDescriptor = {
	dataset: string; // from the meta/datasets/ catalog
	entryType?: string; // pollutant/entry type where applicable
	dateRange: DateRangeSpec; // set / rolling (to-date or trailing) / custom (see "Get data")
	timeSubRange?: { start: string; end: string }; // e.g. calendar day-range selection
	place?: PlaceRef; // one place (any kind), the common case; or…
	selection?: SpatialSelection; // …several monitors or regions. Never both; neither = whole layer
	resolution?: "auto" | Resolution; // default "auto"
};

type Resolution = "raw" | "hour" | "day" | "month" | "quarter" | "season" | "year";

type WidgetDataConfig = {
	dateRange?: DateRangeSpec; // absent for time: "now" | "none" widget types
	timeSubRange?: { start: string; end: string }; // per widget, not per layer
	layers: Array<Omit<QueryDescriptor, "dateRange" | "timeSubRange">>; // ≤ 1 pollutant layer
};

type PlaceRef =
	| { kind: "monitor"; id: string }
	| { kind: "region"; type: string; code: string } // e.g. county + "06019" (see below)
	| { kind: "location"; source: string; code: string } // a school or child-care site
	| { kind: "point"; lat: number; lon: number; label?: string }
	| { kind: "default-place" }; // the starter's chosen place, read from a preference

type DateRangeSpec =
	| { kind: "set"; unit: "year" | "month" | "week" | "day"; start: string }
	| { kind: "to-date"; unit: "year" | "month" | "week" }
	| { kind: "trailing"; amount: number; unit: "hour" | "day" | "month" }
	| { kind: "custom"; start: string; end: string };
```

- **Region places resolve through a `RegionResolver`** (built 2026-10-22, Foundations spec 2):
  the air-quality adapter turns a region's type and official code into the server's id before
  fetching. The web resolver looks codes up with `@sjvair/sdk`'s `getRegionsByCode`
  (2026-10-22, sdk-js 4.8.0-beta.0), batched per type and cached per resolver: a retired
  region still resolves, a code the server doesn't know leaves the layer "unavailable"
  (`region-unresolved`), and land-use regions, which have no codes, are unsupported. The
  web metadata source reads the dataset catalog with `getDatasetCatalog`; a server without
  `meta/datasets/`, or any failed fetch, gives `catalog-unavailable` (retried on the next
  query). Production stays unavailable until sjvair.com #293 (which adds the catalog and the
  code filter on `regions/`) is live there.
- **`timeSubRange` lives on `WidgetDataConfig`** (decided 2026-10-22), next to `dateRange`,
  not on each layer's descriptor: the range is per widget. A layer resolves to a
  `QueryDescriptor` by taking the widget's `dateRange` and `timeSubRange`.
- **Dates are Pacific calendar dates** (`YYYY-MM-DD`). `"to-date"` and `"trailing"` are the
  two groups of the Rolling method (see "Get data").
- **A layer holds one place or a multi-selection** (decided 2026-10-13): `place` takes any
  `PlaceRef`, including a point or a school, which is how a chart keeps "my location";
  `selection` is for several monitors or regions (maps, comparisons).
- **`default-place`** (decided 2026-10-13) is how the built-in starter says "the chosen
  place" while "Change place" stays a preference. It resolves at display time. When an
  edit turns the starter into a personal copy, every `default-place` is replaced by the
  actual place at that moment, so the copy is self-contained; user documents never keep
  it.
- **`default-place` never leaves the starter** (decided 2026-10-14). One resolve step
  replaces it at every exit: the edit that creates a personal copy, "Mark for analysis"
  and "Add to collection", "New from starter", Export, and sharing. Schema validation
  rejects `default-place` in every document and Collection except the built-in starter, so
  a missed path fails loudly instead of saving a placeholder nothing can resolve.

**Places** (decided 2026-09-28). The shared place picker produces the four user-pickable `PlaceRef`
kinds (not `default-place`, which only the built-in starter uses). Server support:

- **Existing** (already wrapped by the SDK): `regions/places/search/?q=&type=`
  (`searchRegionPlaces`) for name search in the picker; `regions/places/lookup/?q=&type=`
  (`lookupRegionPlace`) to resolve a name to the best region (without `type` it tries
  city, then CDP, then urban area; the `place` region type no longer exists);
  `regions/?within=` (repeatable) for a parent region's children. Since October 2026 the
  region **list returns only `bbox`, not boundary geometry**; geometry comes from
  `regions/geojson/?type=` or region detail, and `regions/<id>/?buffer=1|3|5` returns a
  buffered boundary (the allowed distances are listed in `regions/meta/` `buffers`). Both are wrapped: `getRegionsGeoJSON` (4.8.0-beta.4; it batches code lists over the server's 100-code cap since 5.0.0-beta.1) and `getRegionDetails(id, { buffer })` (5.0.0-beta.1).
- **Schools and child care are places** (decided 2026-10-13). The server's `Location`
  model (public school, private school, child care; added by sjvair.com PR #275) holds a
  name, address, point, and **direct links to its county, city, ZIP, and school
  district**; today it is served by `pesticides/locations/` (bounding box, region +
  buffer, or radius).
  - **"Pick my school"** in the shared place picker and the starter's "Change place" bar:
    search by name alongside monitors and regions.
  - **It resolves like a point, but with no coordinate lookup:** air quality uses the
    smallest of its linked regions with data, heat uses its ZIP, forecasts use its
    county's zone.
  - **No location-privacy handling:** a school's address is public, so it is stored and
    shared as-is (unlike a personal point).
  - **Alert rules can target a location** (Release 2), e.g. pesticide applications within
    1 mile of a school, using the server's existing radius queries.
  - **Server and SDK work (step 3):** a name search for locations, ideally an endpoint
    outside the `pesticides/` namespace since schools are used for air quality too; SDK
    wrappers; and a check that production has the school data loaded (`import_schools`).
    **Built in spec 3** (sjvair.com #302, sdk-js #39; merged 2026-11-04, in @sjvair/sdk 4.8.0-beta.6):
    - `GET regions/locations/search/?q=&type=&region_type=&region=` →
      `{ data: [location rows], more }`. Each row is the `regions/locations/` row (code pair,
      name, type, address, `city_name`, ZIP, point, linked regions as
      `{ type, external_id, name }`), so a picked row and a reopened one look the same.
    - **Matching:** part of a name, small typos (`linclon`), and a town typed with the name
      (`lincoln visalia`, `visalia lincoln`). A town matches either the mailing city or the
      linked city/CDP.
    - **Order:** exact name, then name starts with the text, then a word starts with it,
      then name + town, then substring or typo only; ties by mailing city, then name.
    - **Size:** 10 rows, stretched to 15 while the following rows repeat the 10th's name
      (all 13 "Lincoln Elementary" rows show). `more` is set when anything is left out, for
      "keep typing to narrow it down".
    - **Filters:** `type` is a comma list; `region_type` + `region` take a code for
      county, city, cdp, zipcode or school_district.
    - **Rows:** current sites only; a child-care center's several licenses are one row.
      Names are shown as the state publishes them (child-care names are often all caps).
    - **Labels** come from `regions/meta/` → `location_types` (`{ type, label, source }`).
    - **Requests:** `q` under 2 characters is empty, with no request from the SDK. 200s are
      cached by the browser for an hour.
    - **SDK:** `searchLocations({ q, type?, region?, ...requestOptions })` →
      `{ results, more }`. `getPesticideLocations` wraps `pesticides/locations/` (its point
      form puts coordinates in the URL, so it is only for public points like a school).
    - **Resolving a saved location:** stays on `regions/locations/?source=&external_id=` /
      `getLocationsByCode`, retired ones included.
- **Missing: lookup by coordinates or monitor.** Needed for "Use my location" and for
  mapping a monitor to its ZIP (CalHeatScore) or forecast zone. **Extend
  `regions/places/lookup/`** (no new endpoint) to accept rounded coordinates (`lat`/`lon` in a **POST body**; see "Location
  privacy") or `?monitor=`,
  plus `type=`. **Response shape:** in coordinate or monitor mode it always returns a
  **list** of containing regions (only the given `type` when `type=` is set). The existing
  name mode keeps its current single-region response. It uses the same geometry rules as `within=`, and builds on the
  existing `Monitor.regions()` query. The SDK wrapper gains the parameters. **Built in
  spec 2 (sjvair.com #301, sdk-js #38; open for review):** `POST {lat, lon, type?}` or
  `GET ?monitor=&type=`; `type` is a comma list or an array; with no `type` every type but
  `land_use` and `mtrs` is returned (asking for `land_use` is a 400, `mtrs` is allowed); the
  server rounds coordinates to 3 decimals itself; coordinates in a query string are refused
  (400); a hidden or unknown monitor is a 404, while CIMIS stations resolve. Answers are
  cached 24 hours. `lookupRegionPlace` takes `{ lat, lon, type? }` or `{ monitor, type? }`.
  - **Weather stations** are listed through the catalog's Weather `places_url`
    (`getMonitorsList({ dataset: "weather" })`, i.e. `monitors/?dataset=weather`); CIMIS
    stays out of the default monitor list. Nearest-station matching is computed in the
    browser from that list.
- **What a point shows for air quality** (decided 2026-09-28): the **smallest containing
  region with summaries for the pollutant**, tried in the order ZIP → city → county via the
  coordinate lookup. Region averages use the server's monitor weighting, so they're
  steadier than a single nearest sensor. The widget labels the source (e.g. "PM2.5 for ZIP
  93721 (your location)"). The point itself is kept for display and for the other lookups
  (ZIP for heat, forecast zone for the Forecast strip). The region is resolved when the
  widget renders. **"Mark for analysis" freezes it** to the region actually used, staged as
  a normal region item ("ZIP 93721 (from your location)").
  - **Built in step 4 spec 2 (2026-11-04).** A point gets its candidate regions from the
    coordinate lookup (`lookupRegionPlace({ lat, lon, type: ["zipcode", "city", "county"] })`,
    cached in memory per rounded point); a school uses its own linked regions
    (`getLocationsByCode`, batched per source, no coordinate lookup). `layerTarget` returns a
    `fallback` target with those candidates, and the adapter fetches them in order through
    the region path, **stopping at the first that has any point in the widget's date range**
    ("has data"; a ZIP with gaps stays the ZIP), else the last candidate's empty data.
    `QueryData.places` names the region used with `via` (the point, or the school's name), and
    `placeLabel` renders it: "93721 (your location)", "93702 (Roosevelt High)", and
    "(shared location)" in a live link's read-only view; the table header and the CSV place
    column read the same, and the CSV never carries coordinates. A point the lookup puts in no
    ZIP, city or county is "Your location is outside the area SJVAir covers." A school that no
    longer resolves gets the "no longer available" card; a retired one keeps its data with
    "<name> is no longer listed (since <date>)" and, when replaced, "Switch to the replacement".
    `placeRegion(input)` gives the region a point or school widget uses now, through the same
    query and cache (the share swap and the live-link save use it).
- **Location privacy** (decided 2026-09-28). Exact coordinates are often a home or school,
  and the audience includes students.
  - **The owner's own document keeps the exact point**, private to their browser or
    account.
  - **Server lookups always send a rounded point** (3 decimals, about 100 m; enough for
    ZIP, zone, and region), in a **POST body** rather than URL parameters, so router logs
    never see coordinates. The SDK rounds, and the server rounds again; the server refuses
    coordinates in a query string (a 400, though the router log still sees that request). **The server scrubs `lat`/`lon`** from Sentry, Scout, and
    application logs.
  - **Sharing, copies made from a share, and exporting default to the resolved region**
    (the owner's own copies, e.g. the starter copy or "Save as copy", keep the exact point) (e.g. "ZIP 93721"),
    with a notice: "Your location is shared as ZIP 93721, not your exact position." The
    notice offers an explicit **"Share my exact location instead"** option, off by
    default and chosen per share, with a warning that anyone with the link will see it.
    The region is the one the point's widget shows now (`placeRegion`); a point with no region
    is left out of the shared content (its widget shows the idle state). The exact option
    lives only in the Share dialog: the ⋯ menu's **Export** always exports the regions, with
    the same notice. If a region can't be looked up, nothing is offered until Retry succeeds
    (never a silent fallback to the point). Copies made from a share, including imported
    files, always swap points for their regions (no option). **The full backup keeps exact
    points**: it is the owner's own restore file, not a share (Step 4 spec 2).
  - **Live share links** can't swap in transit (viewers read the owner's synced document), so
    before turning one on the Share dialog asks: "Use ZIP 93721 instead" (one undoable edit:
    `setWidgetData` when one widget has points, else one `replaceDocument`) or "Share my
    exact location" (with the warning). Viewers' labels read "(shared location)".
    **The live link is guarded three ways** (step 4 spec 2):
    - _When the link goes on:_ the share uploads first, then checks, under the document lock,
      that the stored version has no point (unless the owner chose "Share my exact location");
      a failed check, or edits still waiting to upload, refuses the share. An already-on link
      whose dashboard holds a point shows the same prompt.
    - _Every edit while it's on_ (the user, 2026-11-05): any of this tab's edits, Undo and Redo
      included, that leaves a point on a live-shared dashboard saves its region instead, with
      the "saved as" notice (a toast, announced). `DocumentSession`'s `onEdit` hook hands the
      session to the app, which loads `src/lib/sharing/live-points.ts` only for a dashboard
      with a point (and a live link, once the worker's states know); it looks the regions up (`placeRegion`, 20 s), and applies the swap with
      `amend`: stored like any edit but not an undo step of its own, so Undo goes past it
      (the stacks' changes set values, and an inverse is taken from what was there, so it
      ends; a redo that would land on the swapped point lands on the region). The app also
      runs it when a live-shared dashboard opens holding a point, uploaded or not (another
      tab's journal replayed here, a lookup that failed before a reload, a point shared before
      this rule), and when the sync worker reports one (`onPointsHeld`): a held upload, or a
      link that starts guarding points in its states (turned on here or elsewhere, learned by
      a poll or pull, or first known at start). So a device that uploaded a point before it
      knew of the link swaps it as soon as it learns. The swap checks the stored dashboard
      (`worker.pointsShown`), whatever is unsynced. One run per dashboard per tab; a Web Lock and a stored-version check
      keep two tabs from both swapping. A failed lookup shows "Can't look up your area right
      now." with Retry (and tries again when the connection returns).
    - _Every upload:_ `pointsHeld` (`src/lib/sync/points.ts`) is the check every save of a
      stored document makes first (`uploadDocument`'s loop, after each merge too, and
      settling a conflict, which refuses with `PointsHeld`): with the link on and not exact, a
      document holding a point isn't sent (`points`), whichever path asks (autosave, a replayed
      journal, the sweep, another tab). It goes once the swap is stored. A batch whose changes
      mention a point (the pick and its undo) is sent as one `replaceDocument` from the
      server's copy instead, so not even the change log gets it. Server snapshots kept before
      a restore or a "use theirs" are the owner's only, never shown on the link, and aren't
      held (`DEFERRED.md`).
    - **"Share my exact location" is remembered per link**: `shareExact` in the sync record,
      next to `shareToken`, set by the Share dialog's choice (on a new link with the share; on
      an on link first, so its held points go up), and kept by every record write for the
      same token (`withShareToken`). Turning the link off, or a different token arriving,
      clears it; "Use … instead" sets it back to false. It's this device's record: another
      device swaps the points on its next edit (`DEFERRED.md`).
  - **"Use my location" on a dashboard with a live link** (the picker reads the sync record's
    `shareToken` and `shareExact` at Done; with exact chosen it keeps the point) saves the region the widget would use (ZIP, else city, else county)
    instead of the point, and says so: "This dashboard is shared by link, so your location is
    saved as 93721." Turning the link off later doesn't restore the point. A pick identical to
    the current place makes no edit (and no notice).
- **Geolocation** is a platform-adapter capability: an opt-in "Use my location" button,
  never automatic, with the browser's usual permission prompt. Tauri can supply its own.
- **The shared place picker** (built in step 4 spec 2, 2026-11-04; spec
  `docs/superpowers/specs/2026-11-04-step-4-spec-2-place-picker-design.md`). A lazily loaded
  component (`src/lib/places/`) that a dialog hosts today (full screen on a phone) and spec 3's
  Get data view and spec 6's starter bar can place inline. Its code never reaches the initial
  bundle; the menu item and idle button reach it through `lazy.svelte.ts`.
  - **Getting there:** "Change place" in a Chart's or Data table's ⋯ menu (and its taskbar
    menu when minimized), only on an editable dashboard; "Choose a place" on the idle state;
    "Choose another" on the "no longer available" card. A saved place that no longer resolves
    isn't offered back as a pick (so "Choose another" replaces it); one whose lookup failed
    stays, unnamed. Every change is one `setWidgetData` edit (Undo restores the old place);
    Cancel, Escape, or closing makes none, and neither does a pick identical to the current
    place.
  - **What it's for:** the host passes the dataset and entry type (the widget's pollutant
    layer), the mode, and the cap. **Single** mode closes on the first pick; **multiple** mode
    (`accepts.maxPlaces`: Chart 5, Data table 10) keeps picks as removable chips until
    **Done**, which needs at least one pick (an empty Done would idle the widget; Remove widget
    exists for that), and **Cancel** discards them.
  - **One kind at a time:** several places are one `SpatialSelection` (all monitors or all
    regions, region ids `"type:code"`), the shape the Map widget syncs with. The first pick
    sets the kind; rows of the other kind stay visible but are `aria-disabled` with a reason
    ("This widget compares regions. Remove the regions to compare monitors."). The reasons say
    "This widget …", since the picker serves every widget type. **Schools and "your location"
    are single-place only:** either can be the only pick. With exactly one place picked (of any
    kind, a school or your location too), choosing one replaces it (the user's decision,
    2026-11-05); with two or more picked they are greyed out with a reason. With a school or
    your location picked, regions and monitors are greyed out; another school or your location
    replaces it. At the cap, the rest read "This widget shows up to 5 places." One pick is
    stored as the layer's `place`, two or more as its `selection`; removing back to one stores
    a `place` again.
  - **Pollutant fit:** monitors whose type can't supply the entry type (`monitors/meta/`
    `monitors[<type>].entries`) are hidden, not greyed out. Regions, schools, and points aren't
    filtered (no bulk coverage; see `DEFERRED.md`); a place with no data shows "No data".
  - **Monitors** come from the memoized `monitors/` list (every public monitor, active or not;
    the health filter applies only to current readings), active first, then by name; stopped
    ones are tagged "Not reporting" in text. An `activeOnly` option (for spec 4's "now"
    widgets) leaves them out. **A saved monitor missing from a list that loaded** gets the "no
    longer available" card (`monitor-unlisted`), not an uncalibrated series; when the list
    can't load, the error with Retry stays.
  - **Search:** one box, from 2 characters, debounced 250 ms, each query aborting the last.
    Three searches run at once and load and fail on their own ("Couldn't search places.
    Retry"): schools and child care (`searchLocations`), places (`searchRegionPlaces`, reading
    only id, name, type, code and retirement, never `boundary.geometry`), and monitors (in the
    browser: name starts, then word starts, then substrings; active first). Groups show in that
    order, up to 10 rows each, with "More matches. Keep typing to narrow them down." when the
    server says `more` (or more than 10 monitors match). A row whose type has no label in
    `regions/meta/` is dropped, never shown with a raw key. Retired regions aren't offered.
  - **Browse:** the `regions/meta/` types with `browsable: true` and `count > 0`, in the
    server's order with their counts, plus Monitors. A type whose `parents` includes `county` gets an "In:" control
    (`regions/?within=`), and so does Monitors (`monitors/?region=`); every list has a filter
    box; a county row's **"Inside ›"** lists the child types and Monitors, and opens one already
    narrowed to it. Headings use `label_plural` from the metadata.
  - **Recent places:** up to 8, newest first, per space through `preferences` (this browser
    only, never in documents); every monitor, region, or school pick is added, "your location"
    never is. Read back through a schema (a malformed list is dropped) and shown with current
    names; a place that no longer resolves is left out.
  - **Accessibility:** the search box and results follow the W3C ARIA combobox pattern
    (editable combobox with a listbox popup; labeled groups; arrow keys across groups, Enter
    picks, Escape clears, then closes); the result count and a failed group are announced in a
    polite live region. **Browse lists are a W3C APG grid**, not a listbox (changed during the
    build, because rows carry a separate "Inside ›" button): `role="grid"`
    (`aria-multiselectable` in multiple mode), each row a `row` with `aria-selected` /
    `aria-disabled`, a name cell and an Inside cell; ↑/↓ move between rows, ←/→ to and from
    Inside, Space/Enter picks. Greyed-out rows stay focusable with their reason as the
    description; chips have a labeled remove button.

"Mark for analysis" on a multi-layer widget adds **one Collection item per layer**, each
with the widget's date range and any current time sub-range or selection.

"Whole widget" is simply the no-selection case,
so partial and all-or-nothing selection are the same mechanism. Descriptors are cheap
to stage, shareable, and reproducible. (These are the items held in analysis
Collections — see "Analysis: Collections & engine".)

**Map widgets select spatially only.** Time is fixed per widget by its single date
range. Narrowing _when_ is done with a calendar or chart widget's **own** time selection
(for staging its data), not a map time scrubber and not by filtering other widgets.

One selection model, three ways to produce it:

```ts
type SpatialSelection = {
	kind: "monitors" | "regions";
	ids: string[]; // monitors: server ids; regions: "type:code" keys (see "Stable ids")
	source?: GeoJSON.Geometry; // present when produced by a drawn shape
};
```

- **A. Feature picking** — click a monitor/region to select, shift-click to add;
  selection shows as removable chips in the widget title bar; right-click a feature
  for feature-scoped context-menu entries (from Release 3, "Analyze this monitor").
- **B. Region picking**: uses the **shared place picker** (decided 2026-09-28), a non-map
  component built in **Release 1 step 4** that picks monitors, regions (any type in the
  hierarchy), schools and child-care sites, or points (`PlaceRef`), with search, hierarchy browsing, and single or multiple
  selection, built on the region-hierarchy metadata. It's reused by Widget Creation's
  accordions, the "now" widgets, Collections item editing, the Map widget (the same
  picker, with the selection also shown on the map; selections sync both ways), and
  Release 2's alert-rule targets. Step 5 adds only map-specific method A (clicking
  features). The v1 multi-region selector's narrowing rules and
  boundary-loading behavior are captured in `docs/reference/v1-lessons.md`, not reused
  as code. Preferred basis for analysis: regions are stable, meaningful
  units the server already aggregates (`RegionSummary`) and are the natural
  crosswalk to other geographies (health, pesticide data).
- **C. Drawn shapes** — box, lasso, radius-from-point, via `terra-draw` (MIT). The
  shape is **resolved to IDs at selection time**: monitors inside the shape are
  included; regions are included only if their centroid falls inside. The raw
  geometry is kept in `source` so it can be redisplayed and re-resolved later (e.g.
  when new monitors come online). Users can prune the resulting chips.

Build order: A and B first (both share one selection state); C
later. Drawing tools belong in `@sjvair/map-sdk` as an **opt-in plugin, off by
default**, so sjvair.com's map and the mobile app are unaffected (see Open Question #3).

**A map's places are its places layer (step 5 spec 1, built 2026-11-11; Option A, the user,
2026-11-11).** The Map widget has one layer, `{ dataset: "air-quality", entryType, place |
selection }`, read through `placesLayer` like every other type. There's no separate focus field
and no saved camera: what the map frames is always what the picker saved. Every monitor for the
pollutant is drawn; the places only decide what's highlighted and where the camera goes.

- A **region** is outlined and highlighted, and the map fits its bounds. A **monitor** is
  highlighted and centered (zoom 12 at least). A **school or child-care site** gets a labeled
  pin (zoom 13). Several monitors or regions are all highlighted and fitted.
- An **exact point** frames **its region** (the one its data uses), outlined, with a pin inside
  reading "Your location" for the owner or "Shared location" for a viewer. The tiles asked for
  are the region's, so MapTiler never learns the point unless the person zooms in on it. When
  the region can't be found, the map opens on the Valley's view, not the point.
- The picker reads and writes the layer through `applyChange` (undoable). A picker change, undo,
  "Change place" or another tab re-targets the map. "Change place" moves a one-place map and
  leaves a several-place map alone, as for every widget.
- **Clicks don't select in spec 1.** Hover shows map-sdk's tooltip, and the feature list reaches
  every monitor by keyboard. A tap on a phone shows no reading yet: that waits on map-sdk's
  pinned card for a click or tap, its own map-sdk release, which spec 1 needs before it merges.
  Feature picking (method A: the card's Select/Remove and Shift-click) comes in spec 2.

## Map SDK: `@sjvair/map-sdk` + monitor-map rebuilt on it

Decided 2026-09-23 (IDEA.md Open Question #3), **restructured 2026-09-24**. IDEA.md calls
it the "map sdk (formerly 'monitor-map')". The map toolkit is **split into two
packages** instead of rewriting monitor-map in place.

**Status check 2026-10-13:** monitor-map has since shipped **4.0–4.2** (October 2026),
but those are a UI and packaging major, **not this split**: a new options toolbar and
unified legend (4.0), `./core` and `./routes` entry points (4.1), and a self-fetching
detail panel with basemap-failure handling (4.2). It is still one map per page, with the
same singletons, no `createMap`, no `MapView`, and config read from `import.meta.env`.
Its own `CLAUDE.md` says "mount at most one `MapShell` per app instance". 4.3.0
(2026-10-21) only moved it to @sjvair/sdk 4.7.0 and added request cancelling. So the plan
below stands, with the baseline now 4.3.0 and the rebuild becoming monitor-map **5.0**:

| Package                                                   | Contains                                                                                                                                                                                                                                                   | Used by                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **`@sjvair/map-sdk`** (new repo; pre-1.0 until validated) | Per-map core (`createMap`/`MapContext`), the plugin interface and every data-type plugin, `MapView`, **app-level data stores** (e.g. `createMonitorsStore()`), the `terra-draw` drawing plugin (later), injected config. No routing, no page layouts       | This dashboard; `monitor-map`; mobile (directly for stores, and through monitor-map) |
| **`@sjvair/monitor-map`** (existing repo)                 | The SJVAir monitor-map _experience_: `MapShell`/`MonitorMapLayout`, routes and detail panels, legends, load screen, and the standalone build sjvair.com imports. **Rebuilt on `map-sdk`** (as its **5.0**), keeping the `/core` and `/routes` entry points | sjvair.com (standalone build); mobile (as a library)                                 |

Why: the dashboard depends only on the library (no layouts or routing it has to work
around); monitor-map becomes a real consumer of the plugin API, which keeps it honest;
clear ownership (general map capabilities → `map-sdk`, monitor-map product decisions →
`monitor-map`). Cost: changes that span both need a `map-sdk` release, then a bump in
monitor-map (local linking for development; each publish needs explicit approval).
The dashboard's Map widget depends on the published `@sjvair/map-sdk` from npm, not a
local link (decided 2026-11-08); a map-sdk change it needs ships as a new beta first.

**The core problem being solved is still "one map per page"**, not a lack of
configurability. As of monitor-map 4.3.0 (unchanged from 3.6.x): `mapManager` (one `map`),
`integrationsManager`, and `clickManager` are module-level singletons; integrations are exported singleton
instances (`export const monitorsMapIntegration = new MonitorsMapIntegration()`) that
talk to `mapManager.map`; `MaptilerConfig.apiKey` is set from `import.meta.env` at
import time. The mobile app (`../mobile`, on `^4.2.0`) also uses `monitorsManager` as an
**app-wide data store outside any map**, imported from `@sjvair/monitor-map/core`
(`monitors-list.ts` with `init(undefined, { autoUpdate: false })`, its Subscriptions and
Alerts screens, `MonitorSubscription`), plus `provideMonitorMapRouter` from `/core` and
`monitorMapRoutes` from `/routes`. **Those entry points, the `monitor/:id?pollutant=`
route, and the `dist/lib` path are compatibility surface the 5.0 rebuild must keep.**
New 4.x "experience" code to carry over into the rebuild: the options toolbar and panel,
the unified legend (its gradient already comes from metadata levels), `mapStyleState`,
`MonitorDetailsState`, lazy routes, and the re-entrant `init` rules.

`map-sdk` design:

- **Per-map instance.** `createMap(options)` returns a `MapContext` (own map, plugin
  registry, click manager, tooltips), provided to descendants via Svelte context.
  Nothing module-global.
- **Plugins are factories.** e.g. `monitorsPlugin({ dataSource, entryType })`,
  evolving the existing `MapLayerIntegration`/`MapGeoJSONIntegration`/
  `MapIconLayerIntegration` classes:

  ```ts
  interface MapPlugin {
  	id: string;
  	setup(ctx: MapContext): () => void; // add sources/layers; returns teardown
  	legend?: Snippet;
  	displayOptions?: Snippet; // UI slots the host shell renders
  	contextMenu?(target: unknown): MenuItem[]; // hooks into context-menu registry (Q5)
  	toSelection?(features: MapGeoJSONFeature[]): SpatialSelection; // Q2 selection model
  }
  ```

- **What belongs in map-sdk** (the user, 2026-11-04, map-sdk milestone 2 spec): layers built on
  SJVAir server data, through `@sjvair/sdk`. Layers on outside services stay in monitor-map:
  wind (`@maptiler/weather`, proprietary) and EV chargers (NREL). "Weather" in monitor-map is
  only its detail panel's temperature lookup. map-sdk gives host plugins what they need
  (custom layers in their draw-order slot, the GL map for popups and markers).
- **One plugin per data type, each taking a data-source interface** (generalizing
  what `MonitorsDataSource` already does): monitors, region fill/choropleth, HMS
  smoke, HMS fire, collocation, and **later** the `terra-draw`
  drawing plugin (Q2, opt-in; see `DEFERRED.md`). Plugins for the remaining server datasets — pesticide
  use/notices, CalEnviroScreen tracts, CalHeatScore ZIPs, forecast zones, CEIDARS
  facilities, TEMPO rasters — are deferred (see `DEFERRED.md` → "Map plugins"), but
  the plugin interface must accommodate points, polygons, choropleths, and rasters so
  they're additive. The same renderer serves live data
  (sjvair.com, mobile) and historical/date-ranged data (this dashboard). New data
  types become new plugins, not edits to a monolith.
- **Data is separate from maps.** App-level stores (e.g. `createMonitorsStore()`) are
  created explicitly by the host, passed to plugins as data sources, and shareable across
  the host's screens. This replaces the `monitorsManager` singleton for mobile.
- **`MapView`** (no routing, no load screen) is the embeddable map, and what dashboard
  widgets use. **`MapShell`** (full-page layout, routed detail panel, router escape
  hatch) moves to monitor-map, built on `MapView`.
- **Config is injected**, not read from `import.meta.env` at import (MapTiler key etc.).
- **Host-provided metadata, messages, and formatting** (decided 2026-09-28). `createMap`
  accepts three **optional providers**:

  ```ts
  createMap({
  	config: { maptilerKey },
  	metadata?: MetadataProvider, // levels, colors, units, labels from the host's cache
  	messages?: MessageProvider, // UI strings for legends/tooltips (key → text)
  	format?: FormatProvider // numbers, dates, times (Pacific)
  });
  ```

  - **The dashboard passes all three** (its metadata cache, its Paraglide messages, and its
    `format` module), so maps follow the metadata, i18n, and Pacific-time rules with a
    single metadata cache.
  - **monitor-map and mobile pass nothing.** The defaults: `map-sdk` fetches metadata
    itself, uses built-in English strings, and formats in Pacific time. Behavior is
    unchanged.
  - `map-sdk`'s strings are defined as **message keys with English defaults**, so it's
    translation-ready.

- **WebGL context budget.** Browsers cap live WebGL contexts per page (~8–16); each
  map is one. Minimized/off-screen map widgets must tear down their map and rebuild on
  restore (affects dashboard layout, Q4).

**Rollout (resolves the risk of an unfinished major landing on an unpinned `main`):** `map-sdk` starts as a
new package, so nothing picks it up by accident. monitor-map migrates onto it **on a
branch**; its `main`, which sjvair.com's import script builds unpinned, changes only once
the standalone app is migrated and verified, and that merge needs explicit approval.
The mobile app (on `^4.2`) keeps working unchanged on monitor-map 4.x until it migrates. Each step
needs an approved plan in its repo:

1. `map-sdk` (new repo; pre-1.0, then 1.0 once steps 2 and 3 validate it)
2. monitor-map rebuilt on `map-sdk` (as monitor-map 5.0)
3. this dashboard's Map widget on `map-sdk`
4. mobile migrated (stores from `map-sdk`, layout from the new monitor-map)

**Dependencies** (decided 2026-09-28): the dashboard's critical path is only 1 → 3.
monitor-map's rebuild (2) runs **in parallel, started alongside 3**. Both build against
pre-1.0 `map-sdk`, and **1.0 is cut once both have validated the API**. **Changed 2026-11-04 (the
user):** mobile (4) is no longer a separate later track. map-sdk on the latest sdk-js, monitor-map
5.0 and mobile on it must all be done before sjvair.com `develop` is released, and the mobile
release ships the same day (see `DEFERRED.md` → the deploy entry).

**Milestone 1 spec (approved by the user 2026-11-03)** is in the map-sdk repo,
`docs/superpowers/specs/2026-11-03-map-sdk-design.md`; milestone 1 is built and merged
(map-sdk #1, 2026-11-04). It refines the design above:

- **Two milestones.** Milestone 1 is what the dashboard needs. monitor-map parity (collocation
  sites, EV stations, wind, live stores beyond monitors) is milestone 2, a later map-sdk spec
  started with the monitor-map 5.0 rebuild. Until then the live map and mobile keep shipping
  from monitor-map 4.x (the user: the dashboard is the priority).
- **General plugins by shape kind, plus thin dataset presets.** `pointsPlugin` and
  `shapesPlugin` (plain or value-filled) give every dataset tooltips, selection, the feature
  list, and legend data; a raster plugin is allowed for but not built. Milestone 1 presets:
  **monitors, region fill, HMS smoke, HMS fire, CalHeatScore ZIPs, and forecast zones** (the
  user added the last two, moving them out of the deferred plugins). Data sources can be plain
  GeoJSON with a host-supplied scale, so a user GeoJSON or CSV importer can come later with no
  plugin changes.
- **Scales use `@sjvair/sdk`'s shared `Scale`/`Level` types** from step 3 batch 2 (keyed by
  catalog entry-type id, half-open ranges, optional `opacity` for smoke). Presets never fall
  back to hardcoded values; they show `unavailable` on a server without the meta.
- **Plugins never fetch.** The dashboard feeds its own data layer's results in as data
  sources. map-sdk's stores (`createMonitorsStore()`, in a `/stores` entry that can't reach the
  map engine) are for live data in monitor-map and mobile. The dashboard's Map widget doesn't
  use them: it loads all of its data, live data too, through the dashboard's data layer and
  passes it in as plain data sources (the user, 2026-11-12, step 5 spec 2).
- **`MapContext` outlives the GL map.** `MapView`'s `active={false}` (or unmounting) releases
  the WebGL context; showing it again rebuilds with the same camera, basemap, plugins, and
  selections. The core re-runs plugin setup after basemap changes, so plugins never check a
  style-loading flag.
- **Selection is per plugin and host-owned,** in the `SpatialSelection` shape (regions as
  `"type:code"`), with modes none, single, or multiple. Click selects, shift-click (or
  ⌘/Ctrl-click) adds; on touch a tap toggles in multiple mode. Selected features get a
  `--highlight` ring plus a check mark.
- **`MapPlugin.contextMenu` is dropped.** For the context menu's map scope, map-sdk offers
  synchronous `featuresAt(point)` and `featureForElement(element)` lookups (the latter for
  feature-list rows, so the Menu key works), and the host builds the items.
- **Finished on-screen pieces ship with map-sdk,** each over a plain data function: legends,
  tooltips, a keyboard and screen-reader **feature list** (one tab stop, only features in
  view, sortable, virtualized; Enter selects, Space toggles; also behind a "List" button), a
  selection bar, a view summary, and zoom and attribution controls. They use only theme tokens
  (standard shadcn names plus the design pass's family tokens, each falling back to a standard
  one) and follow the host's dark mode.
- **Today's live-map look is kept** (the user), so visitors see no change after the 5.0
  rebuild.
- **Published to npm** (not JSR: JSR's npm layer isn't built for `.svelte` files) as `0.x`;
  `@sjvair/sdk` is a peer dependency so hosts have one copy.
- **`@maptiler/weather` is proprietary**, so map-sdk can't depend on it; wind is decided in
  milestone 2 (see `DEFERRED.md`).

**Milestone 2 (monitor-map parity)** is built and merged (map-sdk #4, 2026-11-04; spec
`docs/superpowers/specs/2026-11-04-map-sdk-milestone-2-design.md`). Every addition is a general
option the Map widget can use too:

- **Host access without host layers.** `MapContext` gains camera moves (`easeTo`, `flyTo`,
  `fitBounds`), a reactive `ready` and `gl`, and `maptilerMap()` for markers and popups only.
  Plugins can add MapLibre custom layers (`addCustomLayer`), which is how monitor-map keeps its
  wind layer outside map-sdk, and can win the hover tooltip (`hoverPriority`).
- **`MapView` pieces are choosable:** `controls` (map-sdk's, the engine's, or none),
  `selectionBar`, and `tooltip` (pinned, or following the pointer). Credits are the engine's
  attribution control on every map, with data credits in it.
- **Live stores for everything the live map shows,** in `./stores` with no map engine:
  monitors (now with a public `meta`), HMS smoke, HMS fire, and collocation sites (joined to the
  monitors store's readings). Each loads once like today, except monitors, which poll.
- **Today's look, decided by the user from a side-by-side check:** inactive monitors `#969696`
  and a black inside outline, the collocation crosshair `#4A5FC6` (fixed colors, exceptions to
  the theme-token rule), today's monitor and cluster tooltip layout, whole-number readings cut
  off as today, blocks legends as one labeled bar, the monitors legend titled by pollutant, and
  fire switching from groups to hotspots at zoom 10. These apply on every map, the dashboard's
  included.
- **Parity defaults from monitor-map 5.0's review** (map-sdk #15, on npm as `0.1.0-beta.4`,
  2026-11-08; spec `docs/superpowers/specs/2026-11-07-parity-defaults-design.md`), on every map,
  the dashboard's included: tooltip times in sjvair.com's format, in Pacific ("4:00 pm Friday
  Nov 06, 2026", " PT" on other zones); the cluster tooltip's "N monitors within a X mi² area"
  from the monitors' convex hull (reversing the 2026-11-04 "no area line"); fire tooltips as the
  monitors' reading box, with fire values cut off rather than rounded in the box, list and
  accessible names (`truncateValues`); and smoke with no hover tooltip and no hover-stealing
  (`hoverable: false`; list focus still pins it), reversing part of milestone 2's accessibility
  additions.
- **Shapes that cover the view, and category readings** (map-sdk #18 and #19, on npm as
  `0.1.0-beta.5` and `0.1.0-beta.6`, 2026-11-08), on every map, the dashboard's included: a shape
  counts as in view when its geometry overlaps the view, not only its label point; focusing one
  whose label point is off-screen keeps the camera, and its tooltips and list-pick
  `featureclick` use a point in view (the antimeridian isn't handled; see `DEFERRED.md`). A value
  that is its category level's code (smoke density, burn status, the heat score's 0–4) shows only
  the level label, in rows, tooltips and accessible names (the user chose label only).

**Shared options toolbar (decided by the user 2026-11-11, in the Map widget brainstorm).** map-sdk
gets a shared, host-controlled options toolbar: plugins declare a group (Pollutant, Monitors,
Layers, Overlays, Settings) and their options, the host owns the values, and the toolbar sizes
itself by the map's box. The dashboard's Map widget uses it (step 5 spec 3), and **monitor-map 5.0
moves onto it** in place of its own options toolbar. That also changes mobile's map: mobile
renders monitor-map through `monitorMapRoutes` (`@sjvair/monitor-map/routes`), whose
`MonitorMapLayout` includes the options toolbar, so mobile re-pins and is re-tested after the move.
map-sdk also adds an actions slot on the pinned card (the widget's Select/Remove). The Map widget's
spec lists the exact map-sdk changes. **Built for monitor-map (5.0.0-beta.2, 2026-11-13):**
`MonitorMapLayout` renders map-sdk's `OptionsToolbar` from map-sdk's presets (monitors, HMS,
settings), plus its own EV charger and Wind groups, with the host's values in one flat record.

**The Map tile's toolbar (decided by the user 2026-11-12, in the step 5 spec 2 brainstorm; built
in spec 3, 2026-11-13).** A Map tile is not a copy of monitor-map: its toolbar offers options only
for the data that tile holds.

- **A group appears only when it has a choice.** Pollutant, Monitors and Layers each show only
  when the tile's data gives that group a choice (Pollutant and Monitors: two or more options;
  Layers: the tile has smoke and fire, and its one row counts as a choice). There is no Overlays
  group: wind belongs to monitor-map, outside map-sdk, and the tile has no overlay data. Settings
  always shows, because its options set up the map itself.
- **Layers holds only Fire & Smoke** (the user, 2026-11-13): a show/hide switch for both layers.
  It doesn't add or remove the data, which stays a Get data choice (the layers' data stays loaded
  while hidden, so showing again is instant). The places' outline (focus area) is always drawn,
  with no row.
- **Monitors' "Inactive" and "Inside" options** show only when the loaded monitors include
  inactive or indoor ones, and both are **off by default** (the user, 2026-11-13: a Map no longer
  draws inactive or indoor monitors until someone turns them on). A monitor type with no monitor
  among the loaded ones for the pollutant showing isn't offered.
- **Left out on purpose:** a search slot (the place picker does that job), a "None" pollutant (a
  Map tile always draws one), and Collocation Sites (the dashboard loads none).
- **Settings** keeps monitor-map's set: marker clusters, basemap, basemap theme (the variant), and
  Reset to defaults.
- **Values are saved with the tile**, in its options.
- **The theme can differ from the dashboard's.** It opens on the basemap style's own default
  variant, as monitor-map does today. There is no "Follow the dashboard" option: the list offers
  only the variants MapTiler defines.
- **The basemap is one saved value**, the variant id, which map-sdk stores. An unknown id falls
  back to a default and never throws. Every MapTiler basemap is offered at its newest version; it
  opens on Streets v4 without POI layers.
- **The saved shape** (`MapOptionsSchema`, `src/lib/widgets/map/options.ts`), next to `showing` and
  `marks`: `basemap`, `clustered`, `fireAndSmoke`, `inactive`, `inside`, and `hiddenTypes` (the
  monitor types switched off, unique and bounded). Types are saved as the ones switched **off**, so
  a type the server adds later shows as on with nothing to fix in old dashboards.
- **Missing means default, and a default is never written.** A missing option is drawn as its
  default; a choice equal to its default is stored as missing (a type switched back on leaves
  `hiddenTypes`, an empty list is removed). So **Reset Map Options** needs no special handling:
  putting each key back to its default removes it. `showing` resets to the first pollutant; marks
  and places stay.
- **A saved value applies only while its row is offered.** A type switched off, or Inactive or
  Inside off, filters the monitors only when the Monitors group shows that row. If the tile's data
  later leaves the row out, nothing filters by it, so a tile can never hide monitors with no
  visible way back. The value stays saved and applies again when the row returns.
- **The toolbar's filters never hide the monitors that are the tile's own places** (a ruling
  made while building, 2026-11-13). A monitor place, or a hand-picked monitors selection, is
  always drawn, even when inactive, indoors or of a type switched off: the Inactive and Inside
  defaults and the type switches hide incidental monitors around a place, never one the owner
  chose. So such a monitor is never "hidden by the map's options" in the hidden-marks note.
- **No per-field fallback for invalid options** (changed while planning, 2026-11-13): the document
  schema already rejects any invalid Map options (`DashboardBodySchema`'s refine), so such a
  dashboard opens read-only and a per-field fallback could never run. A missing or invalid
  options value read at a tile reads as none.
- **One `applyChange` per toolbar action** (one undo step); a select-all heading and Reset are one
  step each, matching map-sdk's one `onchange` per action. Converting away from the Map drops
  these options, as it drops `marks`.
- **Icons** are Lucide icons tinted with theme tokens, `--map-icon-monitors`, `-layers`,
  `-basemap`, `-theme`, `-settings`, `-clusters` and `-fire` in `src/app.css`, each with a
  dark-mode value, picked for at least 3:1 against the toolbar's background in both schemes.
  The light values are monitor-map's hex colors, except clusters: `#1c86ee` (dodgerblue2), one
  step darker than monitor-map's `#1e90ff`, to meet 3:1.
- **The hidden-marks note gives its reasons.** A hidden mark's monitor type is looked up once
  (page-wide cache), so the note names each reason that applies, one line each: the type doesn't
  report the pollutant showing; the mark is hidden by the map's options (its type switched off, or
  inactive or indoor and those hidden); it is outside the map's places; or its reason can't be told
  ("aren't shown"). The same lines are the map's accessible name and map-sdk's feature-list note.

**The dashboard's Map widget (step 5 spec 1, built 2026-11-11).** How the dashboard hosts map-sdk
(code in `src/lib/widgets/map/`, the host pieces in `host/`):

- **Pinned exactly:** `@sjvair/map-sdk` `0.1.0-beta.13` (never a range or a dist-tag; moved from
  `0.1.0-beta.11` in step 5 spec 3, 2026-11-13) and `@sjvair/sdk` `5.0.0-beta.10`
  (`npm:@jsr/sjvair__sdk@5.0.0-beta.10`). The dashboard no longer depends on `@maptiler/sdk`
  directly: the pin's label comes from map-sdk's focus area.
- **Config, shared by every map** (`host/config.ts`): the MapTiler key, Mercator projection
  (no globe), `cooperativeGestures: true` (Ctrl/⌘-scroll or two fingers zoom, so scrolling the
  page never zooms a map; also in fullscreen) and `telemetry: false`. MapTiler's usage report is
  off, because the dashboard allows no analytics; its session id and tile cache stay on (the
  user, 2026-11-11). With no `VITE_MAPTILER_KEY` the widget shows "Map unavailable". The key is
  never logged.
- **The dashboard loads, map-sdk draws** (step 5 spec 2, built 2026-11-12). The widget uses no
  map-sdk store. Each map data set is one **entry** in `src/lib/widgets/map/data/` (monitors in
  `monitors.ts`, smoke and fire in `hms.ts`) that says how it loads, how it becomes a plain
  `DataSource`, and what it needs; `types.ts` has the interface. Loading goes through the data
  layer's **now client** (`src/lib/data/now/`): a shared cache, polling paused while the page is
  hidden (through the platform's `activity`, which the map takes from `useApp()`), retries and
  error states. Live monitors refresh on the `"raw"` cadence (3 minutes), smoke and fire on
  `"hour"`. Adding a data set later (schools, pesticides) means adding an entry. The Map
  refreshes only when its date range includes today (a rule for spec 4; see `DEFERRED.md`).
- **What a Map tile holds.** One set of places (on the first pollutant layer only, so every
  place-handling path sees one place), one or more pollutants (one `air-quality` layer each, from
  the monitors meta's `available_pollutants`; at most 6, since `LAYERS_MAX` is 8 less smoke and
  fire), and smoke and fire on or off (two place-less layers, `hms-smoke` and `hms-fire`, added
  and removed together). Saved options (`options.ts`, `MapOptionsSchema`): `showing` (the entry
  type drawn now; the first pollutant until the toolbar switches it, which spec 3 added) and
  `marks` (monitor ids, at most 25, unique). Invalid or missing options read as none.
- **A tile draws only its own data.** Monitors are the ones in the places (a region or several:
  those regions' monitors; monitor places: exactly those; a school or exact point: the monitors
  in its `placeRegion` region, the one the frame uses), and only those reporting the pollutant
  showing. Smoke and fire are drawn everywhere, never clipped to the places. A tile never draws
  another pollutant's or an earlier place's readings while a load is pending. A load error shows
  one Retry.
- **Marks.** A tap or click opens map-sdk's pinned card; its **Select** and **Remove** buttons,
  Shift-click, and Shift+Enter in the feature list mark and unmark a monitor (`selectionMode:
"multiple"`, `pickWith: "modifier"`, `card.actions`, `canSelect`). Marks are saved in
  `options.marks` through `applyChange`, so they undo, and `setSelection` follows the document
  (undo, redo, other tabs). At most 25, counting every mark: a 26th gets map-sdk's notice. Only
  monitors can be marked, and view-only dashboards hide the buttons. Marks are kept when a
  monitor leaves the tile's data (a place change, another pollutant showing, a pollutant
  unchecked): the mark stays, hidden, and a note under the map counts the hidden marks. Marks
  are dropped, with a note, when converting away from the Map.
- **The toolbar's wiring** (step 5 spec 3, `src/lib/widgets/map/toolbar/`). The Map's options
  toolbar is map-sdk's `OptionsToolbar` in `MapView`'s `toolbar` snippet. `values.ts` turns saved
  options into the toolbar's full effective record and back (saved values over defaults; a choice
  equal to its default is stored as missing); `toolbar.svelte.ts` builds map-sdk's groups from the
  tile's data (one `monitorsOptions` per map, its groups made inside a `$derived`); `wiring.svelte.ts`
  connects them to the widget and to `changeTileOptions`. How each key drives the map: `pollutant`
  is the saved `showing`; `type:*`, `inactive` and `inside` are **filters the dashboard applies to
  the monitors' features inside `MapData`** (map-sdk never filters a host's data), and
  `monitorsDrawn`, which the hidden-marks note reads, stays unfiltered; `clustered` is the
  monitors plugin's clustering; `basemap` is `map.basemap.select`; `fireAndSmoke` adds or removes
  the smoke and fire plugins. The pollutant shown is the one **drawn**, including
  `drawableShowing`'s fallback, which is drawn and never saved. The dashboard doesn't subscribe to
  `map.basemap.onFallback`: fallbacks are drawn, not saved. The toolbar and the List button show
  above the loading skeleton, and so do the map's notes (under the toolbar, using
  `--mapsdk-toolbar-height`, which ends the banner crowding the zoom buttons).
  Get data's "Show as" converts by the pollutant drawn, not the saved `showing`.
- **Providers:** `messages` maps every `mapsdk_*` key to a Paraglide message through an explicit
  table (a test fails when map-sdk adds a key the table lacks); `format` wraps the dashboard's
  `format` module (Pacific, " PT" off-Pacific), except relative time, which stays map-sdk's
  (see `DEFERRED.md`); `metadata` is the dashboard's own adapter over its metadata cache (`host/metadata.ts`), so map
  levels, colors, units and labels come from the same source as every other widget. Since step 5
  spec 3 it also implements `monitorGroups`, `monitorTypeGroup`, `monitorTypeReports` (each entry's
  `published`), `entryTypeHelp` (the entry's `description`) and `locationTypeLabel` (`"unavailable"`
  on failure), so the toolbar's rows, groups, help and colors all come from the metadata, never
  hardcoded. In the data layer's `MetadataSource`: `monitorGroups` (null when the server sends
  none), `entryTypeHelp` and `locationTypeLabel` are new, `MonitorSummary` gains `inside`, and
  `MonitorTypeInfo` gains `group`, `published` and `unflagged` (entries the meta lists without a
  `published` flag: unknown, not false). `getMonitorsMeta()` needs `monitor_groups`; the fixtures
  carry it.
- **map-sdk's `theme.css` isn't imported.** It's Tailwind source, which only `app.css` compiles,
  and `app.css` already defines every token it adds. `app.css` has map-sdk's `@source`.
- **On screen only.** `MapView active` is true only while the widget is on screen (an
  IntersectionObserver with a 200 px margin) and the page is visible. Off screen or hidden for
  about 5 seconds, the map detaches and frees its WebGL context; coming back rebuilds it and
  refits. Unmounting destroys it. A map that fails to start shows the widget's error state with
  "Try again".
- **The camera is never saved.** The map fits its places when it opens, when they change, and
  on entering or leaving fullscreen, after the frame's animations settle. A pan or zoom lasts
  only for the moment (it survives a theme switch's style reload). A map holding an exact point
  frames the point's region, never the point (see "Widget data selection").
- **Layers:** the monitors, smoke and fire as the tile's entries give them (`selectedStyle:
"ring"` marks the marked monitors), and map-sdk's **focus area** (`focusAreaPlugin`, `focus.ts`):
  the places' outline with the surround dimmed, or a labelled pin for a school or exact point. It
  replaces spec 1's outline layer, pin layer and the dashboard's own pin label. Monitor places get
  no focus area (only those monitors are drawn and the camera fits them). Region geometry comes
  from `getRegionsGeoJSON`, kept in a page-wide in-memory cache in `src/lib/widgets/map/regions.ts`
  (each region fetched once, one request per region type). `featureList={{ reveal: "focus" }}` is
  the keyboard path, and the legend sits in the widget's card (a button on narrow maps).
- **CSP:** `connect-src` and `img-src` both include `https://api.maptiler.com` (styles, tiles,
  glyphs, sprites, and the logo; the user, 2026-11-11). sjvair.com holds the real list, so it
  gets the same host (sjvair.com #330, on `develop`). `cdn.maptiler.com`, MapTiler's default
  right-to-left text plugin, is blocked on purpose (see `DEFERRED.md` → "Right-to-left map
  labels"); `check:build` allowlists it as a library default.
- **"Clear my data" also deletes MapTiler's tile cache** (Cache Storage `maptiler_sdk`), in the
  web platform adapter's reset (the user, 2026-11-11).

## Dashboard layout mechanics

Decided 2026-09-23 (IDEA.md Open Question #4).

- **Snapping grid, no overlap.** Widgets snap to grid cells when dragged/resized; other
  widgets move out of the way (collision + upward compaction/"gravity"). No free-form
  overlapping windows. The desktop-windowing feel comes from the chrome — title bar,
  minimize, fullscreen, taskbar — not from overlap.
- **Pure layout engine, CSS Grid rendering.** Collision/compaction/placement are pure
  TypeScript functions, unit-tested like `url-state.ts`. Widgets render via CSS Grid
  `grid-column`/`grid-row`; drag by the title bar, **resize via edge/corner hover
  handles** (resize cursors), all via pointer events. Chosen over `gridstack.js`,
  which owns DOM positioning and fights Svelte's rendering; the core algorithm is
  small enough to own.
- **Fullscreen** overlays the dashboard area (not the browser window), animated from
  the widget's grid rect (FLIP-style); the underlying grid layout is untouched.
- **Minimize** moves the widget to the bottom taskbar (horizontally scrolling when
  overloaded) and the grid compacts. Minimize is saved in the dashboard and is on the undo
  list; a minimized widget has no spot on the grid. **Restore places it like a newly added
  widget, at the bottom at its old size** (decided 2026-10-28, step 2; undo right after
  minimizing puts it back exactly). Minimized/off-screen map widgets release their WebGL
  context (see "Map SDK").
- **Vertical growth/scrolling.** The dashboard grows downward as widgets are added —
  not horizontally. Reasons: mouse wheels scroll vertically (shift+wheel is obscure,
  school machines mostly use mice); the taskbar is already a horizontal scroller;
  phones stack vertically; every familiar dashboard product scrolls down. To avoid
  wheel conflicts, map widgets use MapLibre's `cooperativeGestures` (ctrl/⌘+scroll
  zooms the map; plain scroll scrolls the page). "Too crowded" is answered by
  **multiple saved dashboards**, not a bigger canvas.
- **Responsive: two layouts** (decided 2026-10-28, step 2; this replaces "fewer columns on
  tablet"). The 12-column grid on anything roughly 768 px wide or wider, and on phones a
  single-column stack derived from the desktop layout's reading order. Only the desktop
  layout is persisted in a saved dashboard config. Rearranging works on phones and changes the
  desktop layout (a widget moved above another takes its spot); on a phone only height can be
  resized. A separate tablet layout is deferred (see `DEFERRED.md`). On the phone stack a Note
  grows to fit its text, up to 12 rows (decided 2026-11-10, for WCAG reflow); this is display
  only, the stored height never changes, and a longer Note scrolls inside as before.
- **Touch** (decided 2026-10-28, step 2): a long-press on the title bar picks a widget up to
  drag it; lifting without moving leaves it selected with touch-sized resize handles and a
  "Done" button. The design is in
  `docs/superpowers/specs/2026-10-28-layout-engine-windowing-design.md`.

## Widget catalog

Decided 2026-09-23 (IDEA.md Open Question #8). All charts use uPlot. "SDK+" = needs a new
`@sjvair/sdk` wrapper for an existing server endpoint.

**First widget set** (Release 1, except the Alerts feed, which ships with Release 2):

| Widget                    | What it shows                                                                                          | Notes                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Map                       | `map-sdk` `MapView` + plugins; spatial selection (feature/region, later drawn)                         | See "Map SDK"                |
| Calendar — day-colored    | Each day colored by its average; day-range selection                                                   | Replaces the v1 calendar     |
| Calendar — contribution   | GitHub-style grid with adjustable range (≥ 1 week); day-range selection                                |                              |
| Chart                     | uPlot time series: at most one pollutant plus any non-pollutant layers, over the widget's date range   |                              |
| Current conditions tile   | Big current value, level color, trend arrow, "updated N min ago", level guidance from `monitors/meta/` | Any `PlaceRef`               |
| "Can we go outside?" card | Plain-language outdoor-activity recommendation from current level + guidance + today's CalHeatScore    | Schools; SDK+ (CalHeatScore) |
| Forecast strip            | Today and tomorrow's AQI category + burn-day status, plus any active Air Alert                         | SDK+ (forecasts)             |
| Alerts feed               | Recently fired alerts from the user's alert inbox (pollutant, forecast, pesticide-notice rules)        | Requires login               |
| Data table                | Exact numbers for researchers; sortable, CSV export; the accessibility fallback for maps/charts        |                              |
| Notes                     | Markdown text for annotating shared dashboards (built in step 4 spec 6)                                | No data source; see below    |

**Notes as built (step 4 spec 6, 2026-11-10).** Spec:
`docs/superpowers/specs/2026-11-10-step-4-spec-6-notes-and-starter-design.md`. A Note is a
`time: "none"` widget with no layers (`data` is `{ layers: [] }`), 3 × 2 at minimum and 4 × 3 by
default, not analyzable or downloadable, with generated title "Note". Its text lives in the
widget's **`options`** as `{ text }` (Markdown, at most 5,000 characters) or `{ message }` (a
message-key reference, used by the starter's welcome Note so no English is stored); the document
schema validates `options` for `note` widgets. People write in a dialog ("Edit note" in the
widget menu, double-click on an empty Note, or at once after "Add widget" → Notes): Lexical,
formatted as you type, a toolbar of Bold, Italic, Heading (one level), bulleted and numbered
lists and Link. Saving stores the normalized Markdown as one undo step. Read-only views offer no
editing. Viewing is described in "Security baseline for untrusted content".

**The hour × weekday heatmap widget was dropped** (the user, 2026-11-09, step 4 spec 5: "just do
the two calendars"; an average of every Tuesday at 3 pm didn't seem useful). Starter analysis #2
(Release 3) is a separate item and is unchanged. A heatmap _layer over the map_, of daily values,
is a map idea instead (see `DEFERRED.md` → "Map plugins").

**The three "now" widgets as built (step 4 spec 4, 2026-11-08).**

- **Forecast strip:** today and tomorrow, each with its AQI category and burn status (the
  feed's text; "No Burning For All" has no level of its own yet), and an **Air Alert banner**
  when a declared alert's dates overlap today or tomorrow (Pacific).
- **"Can we go outside?":** always reads PM2.5 and the school activity guidelines from
  `monitors/meta/`, and adds today's CalHeatScore. **The heat needs no SDK work**:
  `getHeatForPlace` already exists. A heat failure only blanks the heat line, never the card.
- **Current conditions' number:** for monitor types and pollutants the server evaluates alerts
  for, the number is the **server's alert value** (the same trailing 60-minute figure the server
  alerts on, from `getMonitorAlertCurrent` in `@sjvair/sdk` 5.0.0-beta.7; the meta `alerts` block
  says which pairs are evaluated); otherwise it is the **latest complete
  hourly average**. The tile says which it is ("updated N min ago", an averaging note), and a
  reading older than 3 hours is marked stale. Regions always use hourly averages.

**The two calendars as built (step 4 spec 5, 2026-11-09).** Both are `time: "range"` types with
the resolution pinned to `"day"`, lazily loaded, set up in Get data, and limited to **one place
and one air-quality pollutant** (`accepts.onlyPollutant`; other data layers are in `DEFERRED.md`).
Show as greys them out with the reason for two places, a weather or other non-pollutant layer, or
a date range outside their span.

- **Day-colored calendar:** month grids (weeks as rows, Sunday first), several side by side for a
  longer range. Default range "This month"; the whole month is drawn with days still to come left
  blank. Span 1 day to 12 months. A rated cell shows the level color, the day number, the value
  and the level label. When the label doesn't fit, the cell shows the level's position in the scale
  instead (1 for the first level, so every level has its own number; not `tier`, which levels can
  share), and the legend's chips then carry the same numbers ("3 · Unhealthy for Sensitive
  Groups"); the user, 2026-11-09.
- **Contribution calendar** (type `calendar-contribution`; its user-facing label is **"Year calendar"**, the user, 2026-11-09): GitHub's layout (a column per week, Sunday at the top, month labels
  above). Default range "Last 12 months"; span 1 week to about 2 years; long ranges scroll
  sideways from the latest week. A **Show patterns** switch (on by default) adds a per-tier
  pattern over each color; see "Accessibility".
- **A day's figure comes from server metadata, never from the dashboard.** Each day is colored by
  the daily figure matching its pollutant's scale, **because that is how EPA computes the daily
  AQI**: the 24-hour scales (PM2.5, PM10) use the 24-hour average, the 1-hour scales (O3, NO2, SO2)
  the day's highest hourly average, and CO's 8-hour scale its highest 8-hour average. A daily mean
  against a 1-hour scale would almost never leave Good. `monitors/meta/` `scale.daily_statistic`
  names the daily summary field to read (`mean_24h`, `max_1h`, `max_8h`) and
  `scale.daily_statistic_label` its name; the calendar never maps pollutants itself. A null value
  is "Not enough data" (EPA's completeness rule, applied by the server). Until the metadata
  carries `daily_statistic`, every past day is unrated and the widget says so once. It never falls
  back to the mean. Today is colored "so far" from the server's running figure, and a day whose
  rollup hasn't finished shows "Not final yet" (`is_final`).
- **Selecting days uses a two-click range for every pointer:** click a day, then click another to
  extend the range; a third click starts anew; clicking the only selected day clears it. Mouse
  drag and Shift-click also work, and the keyboard follows the date-grid pattern (one Tab stop,
  arrows, Home/End, Page Up/Down, Space or Enter, Shift+arrows, Esc). The selection is stored as
  `timeSubRange` and summarised under the grid; **Open these days in a chart** (a widget menu item
  while days are selected) adds a separate Chart over them.
- **The tooltip and each cell's accessible name** give the date, the figure's name, the value,
  unit and level, and whether the day is selected, at or above the threshold, partial or not final.
- **The display-only threshold** (`thresholds: true`, off by default) marks and counts rated days
  at or above a level; no alerts or notifications.

**The Map as built (step 5 spec 1, 2026-11-11).** Spec:
`docs/superpowers/specs/2026-11-11-step-5-spec-1-map-widget-design.md`. Code:
`src/lib/widgets/map/`. The descriptor (`index.ts`) is in the initial bundle and imports only an
icon and messages; map-sdk, MapLibre and the rest load with `module.ts`.

- **The descriptor:** `type: "map"`, label "Map", `time: "now"` (spec 3 adds a date range and
  may redefine this), `accepts: { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces:
25, onlyPollutant: true }`, `thresholds`, `analyzable` and `downloadable` all `false`,
  `menu: () => []`. "Change place" and "Edit data" come from the generic items. Sizes: 6 × 6 by
  default, 3 × 4 at minimum.
- **The pollutants come from metadata:** the map accepts only the monitors meta's
  `available_pollutants` (today PM2.5 and ozone), because that's what map-sdk's monitors store
  draws. Get data greys out the rest with a reason. A draft on another pollutant that becomes a
  Map switches to the first allowed one, with a note.
- **25 places at most.** A chart's data can become a map in Get data's Show as, keeping all its
  places (up to 25, with the "left out" note beyond). Leaving a Map for a one-place "now" type
  keeps the first place, with the same note. While a selection is over Chart's or Table's cap,
  Show as greys them out, as before (choosing which places to keep comes in step 5 spec 6).
- **`addable(doc)`.** `addable` now gets the dashboard it's added to. The Map's gives one PM2.5
  layer whose place is the bar's place when the bar shows, else the dashboard's most common
  single place, else Fresno County (`placesToReplace(doc)[0]`, then `DEFAULT_LAYER`). Notes
  ignores the argument.
- **Add widget lists each type once.** A type with `addable` is added directly even if it is
  also a data type, so the Map appears once, as a direct add, and isn't in Add widget's Get
  data list (`addWidgetEntries()` in `registry.ts`).
- **Title:** generated, never saved. One place reads "PM2.5 · {place}" (`label_join`, with the
  viewer, so "(your location)" and "(shared location)" read right); several read "PM2.5 · {n}
  places" (`label_join` and `get_data_places_count`).

How the widget hosts map-sdk is in "Map SDK" → "The dashboard's Map widget"; what its places are
is in "Widget data selection".

The remaining brainstormed widgets are tracked in `DEFERRED.md` → "Widgets".

**Widgets are independent in Release 1** (decided 2026-09-28). Each widget has its own data,
date range, and selection; one widget doesn't drive another (no cross-filtering). Putting
several widgets on the same place is done with the shared place picker and "Duplicate
widget". Linking is deferred (see `DEFERRED.md`).

### Widget-type contract

Each widget type declares what Get data shows and how the dashboard treats it:

```ts
type WidgetType = {
	type: string;
	label: MessageKey; // i18n: message key, never literal English
	minSize: { w: number; h: number }; // grid cells
	time: "range" | "now" | "none"; // the date section is shown only for "range"
	accepts?: {
		datasets?: string[];
		maxPollutantLayers?: number;
		maxPlaces?: number;
		onlyPollutant?: boolean; // only a pollutant (a layer with a daily scale) can be added
	}; // explicit
	addable?: (doc: Dashboard) => { data: WidgetDataConfig; options?: Record<string, unknown> }; // a direct add from "Add widget"
	placePicker?: boolean; // "now" widgets: one layer whose place is picked directly (no accordions)
	thresholds: boolean; // supports self-monitoring thresholds
	analyzable: boolean; // offers Mark for analysis / Analyze
	resolution?: Resolution; // pinned resolution (e.g. calendars "day"); hides the override
	dateMethods?: DateRangeSpec["kind"][]; // allowed date methods (default: all); only for time: "range"
	span?: { min?: Duration; max?: Duration }; // e.g. contribution calendar: min 1 week
	defaultRange?: DateRangeSpec; // the range a new widget (and one with none of its own) shows
	defaultTitle(config: WidgetDataConfig, meta: Metadata): string; // generated, not stored
	menu: (ctx: MenuContext, env: WidgetMenuEnv) => MenuItem[]; // widget-scoped actions (see
	// "Actions & context menu"); `env` reads the live widget, so a menu can depend on its data
	component: Component;
};
```

Examples: **Notes** is `time: "none"` with no layers; it uses `addable`,
and keeps its content in the widget's free-form **`options`** (`{ text }` or `{ message }`),
which the document schema checks for `note` widgets (it is not left free-form). **Current conditions**, **Forecast
strip**, and **"Can we go outside?"** are `time: "now"` with `placePicker: true`; for those,
Get data hides the date section and shows **the shared place picker** instead of
the dataset accordions, plus a **separate pollutant control** for Current conditions and
"Can we go outside?" (gated by available pollutants); in `WidgetDataConfig` that's a
**single layer whose `place` holds the picked place** (decided 2026-10-14: the separate
`target` field was removed so every widget type stores places the same way). Current
conditions and "Can we go outside?" have one pollutant layer (heat for "Can we go
outside?" follows from the same place); the Forecast strip has one forecasts layer. **Chart** is `time: "range"` and accepts multiple layers. **Map** is `time: "now"` in step 5
spec 1, with one pollutant layer holding up to 25 places (spec 3 adds a date range).

**`accepts.datasets` is explicit** (decided 2026-11-05, step 4 spec 3). It lists the catalog
dataset ids a type can show; a type with no list accepts no datasets, so a new type can't
accidentally offer everything. Chart and Data table declare
`["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"]` (spec 3b);
Notes declares none. The types with a list are the **data types**: "Add widget" opens Get data
for them, and Get data's **What** sections and **Show as** choices come from their lists (see
"Get data"). **`addable`** is a direct add: "Add widget" adds the type with the data it returns,
given the open dashboard (`addable(doc)`, step 5 spec 1). Notes has it, and so does the Map,
which is also a data type: a type with `addable` is added directly and listed once, not also
through Get data. Chart and Data table dropped it in spec 3.

**Analysis actions on widgets without a date range** (decided 2026-09-24). IDEA.md asks
for "Mark for analysis" / "Analyze" on all widgets, but a Collection item needs a date
range:

- **Notes:** `analyzable: false`. It has no data, so the menu doesn't offer these actions.
- **Current conditions, "Can we go outside?":** stage their place and pollutant with a
  **default trailing window of the last 3 days (Pacific time)**, the "what led up to now"
  question. It is an ordinary "last 3 days" trailing range, not a special case. The Collection item shows that range, and the user can adjust it in the
  Collections drawer.
- **Forecast strip:** stages the forecast zone over the same 3-day trailing window. Past
  forecasts are kept per `issued_date` (verified 2026-09-29; only same-day reissues are
  replaced), so it is `analyzable`.
- **Alerts feed** (Release 2): `analyzable: false`. It lists fired alerts; the data behind
  an alert is reachable from its monitor or region.

## Actions & context menu

Decided 2026-09-23 (IDEA.md Open Question #5). **The right-click menu is one view onto
a shared, scoped action list.** The same actions also populate each widget's title-bar
"⋯" menu, and later a Ctrl+K command palette and keyboard shortcuts — so every action
is reachable without right-clicking (discoverability, keyboard users, accessibility).

```ts
type MenuItem = {
	id: string;
	label: string;
	icon?: Component;
	shortcut?: string;
	group: string; // rendered as separated sections
	disabled?: boolean;
	bubbles?: boolean; // also shown in nested scopes' menus; off by default
	children?: MenuItem[]; // nesting / submenus
	run(ctx: MenuContext): void;
};
type MenuContext = { event?: Event; target: Element; payload: Record<string, unknown> };
type MenuProvider = (ctx: MenuContext) => MenuItem[];
```

- **Scopes register providers** via a `menuScope(provider)` Svelte attachment, stored
  in a `WeakMap<Element, MenuProvider>` and removed on teardown (no leaks).
- **Resolution walks DOM ancestry** from the event target (`parentElement` chain,
  O(depth)), calling each scope's provider.
- **Scopes enrich the payload before resolution.** Canvas-based widgets can't be
  resolved by DOM ancestry alone: a map widget resolves the feature under the cursor
  (`queryRenderedFeatures`) and adds `{ feature }`; the calendar adds
  `{ selectedRange }`; a uPlot chart adds `{ point }`. That's how "Analyze this monitor"
  or "Analyze selected days" appear only when meaningful. Map plugins contribute
  feature-scoped items through `MapPlugin.contextMenu` (see "Map SDK").
- **Merge order: most specific first** — feature → widget → dashboard → global,
  grouped with separators. An inner item with the same `id` overrides the outer one.
- **Only the innermost scope shows all its items** (decided 2026-10-20). Outer scopes
  add only items marked `bubbles`, so a widget's menu doesn't list dashboard actions
  like Add widget or Rename dashboard. Undo / Redo belong to the dashboard's own menu
  (they act on the whole dashboard's history), not to widget menus.
- **Rendered with bits-ui's `ContextMenu`** (shadcn-svelte `context-menu`): one
  trigger around the dashboard, items computed on open. Provides submenus, keyboard
  navigation, ARIA roles, and viewport collision handling. Opens via right-click and
  Shift+F10 / Menu key (focused element). **On touchscreens it opens from the ⋯ buttons, not
  long-press** (decided 2026-10-28, step 2: long-press picks up widgets and is the browser's
  own gesture); the dashboard has its own visible ⋯ button for that reason.
- **Baseline actions** (Release 1; IDEA.md's examples plus decided features):
  - _Global:_ Undo / Redo (in the dashboard's menu, not widgets'), "Clear my data",
    Sign in / out.
  - _Dashboard (blank space):_ **Add widget**, **Save as copy…**, **Export…**, Share…,
    New / Duplicate / Rename / Delete dashboard, **Restore an earlier version…**.
  - _Widget:_ **Refresh** (a manual refetch, alongside automatic live refresh), **Download
    data (CSV)** on every data widget (decided 2026-11-04, step 4 spec 1), Edit
    (opens Widget Creation), Rename, **Duplicate**, Minimize, Fullscreen, Move ▸ / Size ▸
    (single-click alternatives to dragging), Delete. From Release 3: **Mark for analysis**,
    **Analyze**, Add to collection ▸.
  - _Selection (map features/regions, calendar range), from Release 3:_ Mark selected data
    for analysis, Analyze selected data.
  - _Map feature:_ e.g. "Analyze this monitor", contributed by map plugins.
- **Reuse:** the widget "⋯" menu calls the same resolution with that widget as target;
  the future command palette queries global + focused-scope actions.

Prior art reviewed: `monitor-inventory-tracker`'s `ContextMenu.svelte`. Kept its core
idea (attachment-registered, ancestry-scoped contributions); dropped Snippet-based
items (not mergeable/testable/reusable), missing cleanup, module-global state,
hand-rolled positioning, and the debounce workaround.

## Analysis: Collections & engine

Decided 2026-09-23 (IDEA.md Open Question #6, staging + engine parts). Data available
to analyze is catalogued in `docs/reference/server-data-inventory.md`.

### Terminology

- **Collection** — a named set of staged **data inputs** (query descriptors). "Mark for
  analysis" adds to a Collection. Collections hold data references, never analyses.
  (Earlier drafts called this the "pool"; use _Collection_ in UI and code.)
- **Analysis** — a saved **recipe** (`AnalysisSpec`) that runs over items from a
  Collection. One Collection can feed many analyses; one analysis can run against
  different Collections.

### Collections

```ts
type CollectionItem = {
	id: string;
	descriptor: QueryDescriptor; // dataset, entry_type, date range, SpatialSelection, optional time sub-range
	label: string;
	origin?: { dashboardId: string; widgetId: string }; // provenance only
	addedAt: string;
};
type Collection = { id: string; name: string; items: CollectionItem[] };
```

- **Multiple named Collections, independent of dashboards.** Analysis routinely spans
  dashboards, and because items are descriptors (not live widget references), a
  Collection survives its source widget/dashboard being edited or deleted.
- **Provenance, not ownership:** `origin` lets the Collection drawer show "from
  _Dashboard → Widget_" and offer "jump back" while that widget exists; if it's gone,
  the item still works.
- **Targeting:** one Collection is **active** (shown in the nav badge, e.g.
  "Analysis · Smoke study · 3"). Each dashboard may set a **default target
  Collection**. "Mark for analysis" adds to the dashboard's default, else the active
  one; the **Add to collection ▸** submenu (existing Collections + "New collection…")
  targets explicitly; "Analyze" adds and navigates to the Analysis view.
- **Rolling ranges** (decided 2026-09-25):
  - **Dashboards keep rolling ranges rolling** (month-to-date moves forward daily; shared
    dashboards stay live).
  - **"Mark for analysis" freezes the range** into fixed Pacific dates when staged, shown
    on the item (e.g. "Sep 1 – Sep 25, 2026 (was: month-to-date)"), so analyses stay
    reproducible. The same applies to the "now" widgets' 3-day window.
  - A **"keep rolling" toggle per Collection item** allows deliberately rolling inputs
    (e.g. a weekly rerun on "the last 30 days"). Analyses and exports show the resolved
    dates they used.
  - **Notebook exports always record fixed dates** in `collection.json`.
- **Lazy data:** staging stores only the descriptor. Data is fetched when an analysis
  runs, through the data layer's cache keyed by descriptor (reusing what widgets
  already fetched).
- Persisted via the platform adapter (IndexedDB on web).
- **Ships in Release 3, with the analysis engine** (decided 2026-10-25, replacing the
  2026-09-24 decision to ship a minimal version in Release 1): the store, the drawer, and
  "Mark for analysis" / "Analyze" / "Add to collection ▸" on every `analyzable` widget.
  In Release 1 a Collection could be gathered but not used (no analyses and no download),
  and Release 3 still has to settle the Analysis view's layout and how items bind to an
  analysis. Release 1 widgets keep `analyzable` in their type so the actions can be added
  without touching them, and `DashboardBody.defaultCollectionId` stays optional, so adding
  Collections needs no format upgrade. See `DEFERRED.md`.

### Engine: generic core, curated starters as specs

A generic date-aligned comparison engine, seeded with curated starter analyses —
where **a starter is just a saved `AnalysisSpec`**, identical in format to a
user-defined one:

```ts
type AnalysisSpec = {
	inputs: Record<string, { role: string; accepts: DescriptorFilter }>; // bound to Collection items
	steps: Step[]; // resample → align → lag → aggregate → correlate …
	views: ViewSpec[]; // uPlot charts, tables, stat tiles
	notes?: string; // caveats shown with results
};
```

- **User-defined analyses** = editing a starter or composing from scratch. Applying a
  spec to a Collection prompts the user to bind items to its input roles.
- **Save/share** uses the same JSON-document mechanism as dashboards and Collections.
- **Known cross-dataset pitfalls are first-class steps**, not per-analysis hacks:
  resolution mismatch → explicit resample step with a stated aggregation; geography
  mismatch → region crosswalk (regions from "Widget data selection"); lag effects →
  lag step with a slider; spurious correlation → confidence intervals and a
  "correlation ≠ causation" note shown by default.
- **Compute:** plain TypeScript over typed arrays (uPlot's native format) in a Web
  Worker. Heavier WASM engines (e.g. DuckDB-WASM) deferred until researcher-scale
  datasets demand them; Tauri's native storage is the other lever there.

### Health data scope

Decided 2026-09-23: **CalEnviroScreen only** (static tract-level indicators, e.g. asthma
/ CVD / low-birth-weight percentiles, SB535 DAC). The server holds no ER, hospitalization,
or incidence data; importing outside health data (HCAI ED visits, CDC PLACES) and the
"smoke → ER visits" lag analysis are deferred — see `DEFERRED.md`.

### Starter analyses

Confirmed 2026-09-23: **all 10 ship as starters.** #7 and #8 depend on new `@sjvair/sdk`
wrappers (CalEnviroScreen, CalHeatScore) — a sdk-js change needing its own approved plan.

"SDK+" = the server serves the data but `@sjvair/sdk` must wrap the endpoint first.

| #   | Analysis                                                                       | Data                         | Audience            | Status                        |
| --- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------- | ----------------------------- |
| 1   | Bad-air days: days per AQ level by region, month/season/year, year-over-year   | Region summaries             | Everyone            | Ready                         |
| 2   | When is air cleanest: hour-of-day × weekday heatmap                            | Hourly summaries             | Schools, community  | Ready                         |
| 3   | Smoke days vs PM2.5: share of PM2.5 excess on HMS smoke days, by density       | HMS smoke + region summaries | Everyone            | Ready                         |
| 4   | Fire → air-quality lag: daily FRP near region vs PM2.5, 0–7 day lag slider     | HMS fire + summaries         | Research            | Ready                         |
| 5   | Weather drivers: PM2.5/O₃ vs CIMIS temperature, wind, humidity                 | Entries + CIMIS              | Research, science   | Ready (nearest-station match) |
| 6   | Long-term trend: monthly/yearly means, Theil–Sen slope + Mann–Kendall          | Summaries                    | Research, community | Ready                         |
| 7   | Environmental-justice lens: tract PM2.5 vs CalEnviroScreen indicators          | Tract region summaries + CES | Research, advocates | SDK+ (CES); monitored tracts  |
| 8   | Heat + AQ compound days: CalHeatScore and PM2.5/O₃ both elevated               | CalHeatScore + summaries     | Schools             | SDK+                          |
| 9   | Pesticide use trends: lbs by chemical/commodity/region, category filters       | PUR region summaries         | Community, research | Ready (yearly only)           |
| 10  | Low-cost sensor vs reference: scatter, bias, R² over time for collocated pairs | Collocation + entries        | Research / QA       | Ready                         |

## Notebooks

Decided 2026-09-23 (IDEA.md Open Question #6, Jupyter part). Research:
`docs/reference/jupyterlite-kernels.md`. Licensing is not a blocker (JupyterLite/
JupyterLab BSD-3, Pyodide MPL-2.0 used unmodified — ship license notices).

Notebooks are a **separate power-user path that shares the data layer, not the engine**:
Collections/descriptors are shared; the TypeScript engine and uPlot views are not.

### Export to notebook (all languages)

An "Export to notebook" action on a Collection or analysis downloads a `.zip` bundle:

- `analysis.ipynb` (Python), `analysis-r.ipynb` (R), `analysis-ts.ipynb` (Deno /
  TypeScript) — data-loading cell + the analysis steps written out where practical.
  Generation priority: Python → R → Deno/TS.
- Data as **Parquet + CSV**, and a `collection.json` manifest (descriptors, units, AQ
  levels) so any kernel can load it and live data can be re-fetched.
- A short README: open in JupyterLab, RStudio, Deno's Jupyter kernel, or Google Colab.

This is **language-neutral**: loading needs no SJVAir-specific helper (a helper
package is an optional convenience). Deno's built-in Jupyter kernel gives JS/TS users
real TypeScript and can import `@sjvair/sdk` straight from JSR.

A web page cannot launch a local JupyterLab; that true "Open locally" (write bundle to
a folder, launch `jupyter lab` if installed) is a **Tauri** capability — see `DEFERRED.md`.

### Embedded JupyterLite (Python only)

So schools and community users can write code with **no install** (incl. Chromebooks):

- **Kernel: Pyodide** (`jupyterlite-pyodide-kernel`) — real CPython 3.14 with pandas,
  numpy, scipy, statsmodels, scikit-learn, matplotlib, pyarrow; seaborn/plotly bundled as
  wheels. **Python only**; in-browser R and JavaScript are deferred (see `DEFERRED.md`).
- **Fully bundled for offline**: self-hosted Pyodide, custom `pyodide-lock`, piplite
  wheels, `disablePyPIFallback: true`. Kernel and Pyodide versions upgraded in lockstep.
- **A separate static app** at its own path (`/notebooks/`, see "Deployment"), not inside dashboard pages
  (tens of MB). It is the **only** place cross-origin isolation (COOP/COEP) may be
  enabled, per "Platform strategy"; it also works without isolation (service-worker
  file access).
- **Opens the same export bundle** — "Open in browser notebook" loads the bundle's
  notebook + data into JupyterLite, so there is one bundle format for both paths.
- Known limits to document for users: no threads/multiprocessing, ~2–4 GB memory,
  no installing unbundled packages offline, slower pure-Python code.
- **Timing:** after Collections and the starter analyses exist.

## Saving & sharing documents

Decided 2026-09-23 (IDEA.md Open Question #6, save/share part).

**Dashboards, Collections, and analyses are all "documents"** sharing one mechanism:

```ts
type SavedDocument<K extends "dashboard" | "collection" | "analysis"> = {
	kind: K;
	schemaVersion: number;
	id: string;
	name: string | null; // null = generated from a message key (decided 2026-10-20)
	copiedFrom?: string; // source document id when this is a copy
	deletedAt?: string; // local soft delete ("Recently deleted"; purged after ~30 days)
	body: DocumentBody<K>;
};

// Version 1 dashboard body (decided 2026-10-13; the Foundations spec finalizes field detail)
type DashboardBody = {
	widgets: WidgetInstance[];
	defaultCollectionId?: string; // "Mark for analysis" target (see "Collections")
};

type WidgetInstance = {
	id: string;
	type: string; // a WidgetType id
	title: string | null; // null = generated by the type's defaultTitle
	rect: { x: number; y: number; w: number; h: number }; // desktop grid cells
	minimized?: { order: number }; // position among minimized widgets (its rect is kept)
	data: WidgetDataConfig;
	options?: Record<string, unknown>; // per-type display options, validated by that type's schema
	thresholds?: SelfMonitorThreshold[]; // only where the type has thresholds: true
};
```

**`thresholds` as built (step 4 spec 4, 2026-11-08).** The saved shape is an array of **at most
one `{ level }` entry** (a level key from the pollutant's scale); **no entry means Off**.
Live tiles use it as their alert level; Charts use it for the threshold line (a Chart whose
pollutant's scale lacks the key draws no line and says so). Switching a widget's type carries
the level where the new type can hold it and says what was dropped. The `SelfMonitorThreshold`
name above is `Threshold` in the code.

Widget Creation offers only the date methods and spans a type declares (`dateMethods`,
`span` in the widget-type contract), so a saved widget can't hold a range its type can't
show. **A `span` is checked against a range's full unit** (decided 2026-10-14): week-to-date
counts as a week even on a Sunday, and the widget shows the rest of the period as empty.

- **Versioned from day one.** Every document carries `schemaVersion`; a pure, tested
  migration chain upgrades old documents on load. Shared links live for years.
- **Version skew between app and documents** (decided 2026-09-28):
  1. **Newer documents open read-only in older apps.** If `schemaVersion` is higher than
     the app knows, the document opens **read-only** with "This dashboard was saved by a
     newer version. Reload to edit." It is never overwritten.
  2. **Queued changes record the `schemaVersion` they were written against.** They are
     synced or replayed **before** a document is migrated, and never applied blindly
     across a format change.
     **Amendment for the server (built in sync spec 2, 2026-11-02):** the local amendment
     below covers the server too. Pending changes are upgraded with `migrateChange` when the
     document opens, and the server's changes are upgraded the same way before they are
     compared with mine (a change that can't be carried over counts as an overlap, so it
     prompts). An upgraded document is not pushed until its first real edit, so opening a
     dashboard on a new build doesn't turn other devices on the old build read-only.
     **Local amendment (built in Foundations spec 3, decided 2026-10-25):** locally, pending
     changes (change-log entries and journal records) are upgraded alongside the document
     instead. Each `Migration` has a required `migrateChange(change)` returning the change
     rewritten for the next format, or `null` when it can't be carried over; those are not
     applied, and the person is told some unsaved edits couldn't be applied (the kept original
     still holds the pre-upgrade document). To keep old tabs from writing old-format data,
     **every `schemaVersion` bump also bumps the IndexedDB version**
     (`DB_VERSION = DB_LAYOUT_VERSION + CURRENT_SCHEMA_VERSION - 1`), so the `versionchange`
     handling stops an old tab saving and shows the reload bar; a tab that reads a newer
     `schemaVersion` than it knows does the same. So `migrateChange` only runs on records older
     than the current format, at open. Server-side, rule 2 stands as written.
  3. **The server refuses downgrades:** a save whose `schemaVersion` is lower than the
     stored one is rejected.
  4. **New deploys are detected.** The build emits `version.json`. The app checks it on tab
     focus and hourly, and shows "A new version is available. Reload" when it changes.
     Code-file (chunk) load failures show the same prompt instead of an error.
- **Recovery from a bad upgrade or sync bug** (decided 2026-10-13). Upgrade on load, then
  autosave, then sync, with the server refusing downgrades, has no way back by itself, so:
  1. **Validate before saving.** An upgraded document is checked against the new schema.
     If it fails, nothing is saved: the original stays untouched, the document opens
     read-only with a plain message, and an error report is sent. One bad document never
     blocks the others.
  2. **Keep the original locally.** Before upgrading a document, the browser stores the
     untouched original beside it (one per document, for 30 days). This protects people
     without accounts.
  3. **Keep earlier versions on the server.** For each document: the last version before
     each `schemaVersion` change, plus one snapshot per day it changed, for 30 days. The
     limits are **50 dashboards** and **25 MB** per account, not counting snapshots (they
     have their own cap of 25 MB, oldest trimmed first, and never cause a save to be
     refused), alongside a save-rate limit.
  4. **"Restore an earlier version"** in the document menu: a dated list of the local and
     server snapshots, newest first, each labelled with its source and its date and time, with
     no merging (the local original and the server's `schema` snapshot can both show). A
     restore first keeps the replaced version on the server as a snapshot, so it can be undone
     after a reload; if that keep fails, nothing is restored.
  5. **Bad builds can be blocked.** The app sends its build id (the git commit) with
     every save. Staff can add a build to a server block list; saves from it are refused
     with a "please reload" response, and documents stay in the browser until the fixed
     build loads. On the web there is no service worker, so a reload always gets the
     current build (any later service worker must keep that true); a blocked Tauri or
     standalone build shows "update required" instead.
  6. **Fixtures for every past `schemaVersion` are kept permanently**, and CI runs the
     whole migration chain against all of them.

  **Read-only states** (`DocumentSession.readOnly`):
  - `"unkept"` is a **valid** document that is read-only only because the untouched original
    couldn't be stored first. It shows its message bar and its tiles below it, read-only, the way
    the shared view renders them: no editing, moving, resizing, adding or marks; fullscreen
    and viewer changes work as on a shared view (step 5 spec 3, 2026-11-13), and minimize isn't
    offered because it writes the document. Nothing is
    written: autosave and the journal stay off.
  - `"newer"` (saved by a newer version) and `"invalid"` (couldn't be read) show only their
    message, no tiles: an older app can't draw a newer format faithfully, and an invalid document
    is never drawn (the security baseline), so recovery is their path.

- **References, not data.** Documents store query descriptors, never fetched data, so
  they stay small and a recipient sees the same _query_ run against current data.

**Storage (decided 2026-09-24: both layers ship in Release 1):**

1. **Local + files.** Documents persist through the platform adapter
   (IndexedDB on web, filesystem/SQLite under Tauri). Share by **Export/Import `.json`**,
   or for small documents a **link with the document lz-string-compressed into the URL
   fragment** (fragment → never sent to a server). If the encoded link exceeds a safe
   length, the UI falls back to file export.
2. **Server-backed, for signed-in users** (a parallel sjvair.com track in Release 1;
   needs an approved plan). A `SavedDocument` model (`id` (the client UUID), `owner,
kind, name, body, version, visibility: private | link | public, schemaVersion,
share_token` (revocable), `copied_from` (source document id, if a copy), `deleted_at`
   (soft delete)) plus endpoints. Gives
   short links, live share links, cross-device access to documents, protection from
   browser storage eviction, and later
   SJVAir-curated public templates (see `DEFERRED.md`).
   - **Local-first sync, kept simple** (refined 2026-09-25): documents always save
     locally first. For signed-in users the server copy is authoritative. Each save says
     "based on version N"; the server accepts it only if it's still at N, otherwise it
     reports a conflict (the same document edited on two devices, in two tabs, or
     offline).
   - **Automatic replay:** on a conflict the client replays its own `applyChange`
     operations on top of the newer server version, so edits that touch different
     widgets or fields merge silently.
   - **Prompt only on true overlaps** (both sides changed the same widget or field):
     "Keep mine / Use the other version / Save mine as a copy".
   - No real-time co-editing and no CRDT (e.g. Automerge). Research and school
     workflows are solo work with handoffs, and sharing goes through read-only links,
     copies, and notebook export. Multiple editors and real-time co-editing are
     deferred (see `DEFERRED.md`).
   - **Document identity and sharing** (decided 2026-09-25):
     - The client generates a UUID, and the server **keeps the same id** on upload, so
       `/workspace/dashboards/:id` works on any signed-in device.
     - Share links use a **separate, revocable token** (`/workspace/shared/:token`), not
       the document id. They open a read-only view with "Make a copy".
     - **`link` documents can be opened by anyone with the link, no account needed**
       (teacher → class). A copy saves locally for anonymous users, or to their account
       if signed in.
     - **`public`** is reserved (it behaves like `link`) until curated templates ship.
       There is no public listing or search in Release 1.
     - **The server stores `body` without interpreting it** (JSON, size-limited, e.g.
       1 MB). The server's database table is a normal Django model and migration in
       sjvair.com. The document format inside `body` is defined in this repo's
       TypeScript and upgraded by client-side `schemaVersion` functions on load. The
       trade-off: the server can't query inside documents; specific fields can be
       promoted to real columns later if needed.
   - **Local → account migration:** signing in asks once whether to move the browser's
     anonymous documents into the account (see "Accounts & anonymous use" → local
     spaces).
   - **Deletion** (decided 2026-09-28):
     - **Delete is synced and recoverable:** a local deleted marker plus a server soft
       delete (`deleted_at`), **purged after about 30 days**. The undo toast restores
       immediately, and a **"Recently deleted"** list in the picker restores within 30
       days. Anonymous users get the same local "Recently deleted" behavior.
     - **Edits to a deleted document** prompt: "This dashboard was deleted on another
       device. Restore it, or discard your changes?"
     - **Share links to deleted documents** show "This shared dashboard is no longer
       available". Restoring brings the link back.
     - **"Remove from this device"** stays a separate, local-only action (like "Clear my
       data").
   - **Ownership and provenance** (decided 2026-09-28):
     - **A single `owner`** per document. **Only the owner can delete.** Future editors
       (deferred) would live in a **separate access table** (document, user, role), so
       adding them is additive; an editor's "delete" would only remove their own access.
     - **`copied_from`** records the source document when a copy is made (from a share
       link, the starter, or another dashboard). It stores only the id; the source's name
       and author are shown ("Based on …") only if that document still exists and is
       visible.
     - **Shared pages show no personal information by default.** An owner may set an
       optional public **display name** (e.g. "Ms. Lopez's class") shown on their shared
       documents and in "Based on …" credits.
   - **Sync scope and sign-out** (decided 2026-09-25):
     - **Every document syncs once signed in**; there's no per-document sync toggle.
     - **Sign-out removes the account's local copies** (decided 2026-10-13, replacing the
       2026-09-25 keep-or-remove prompt; see "Accounts & anonymous use" → local spaces).
       Server copies remain, and unsynced changes are flagged first.
     - **Preferences** (last-opened dashboard, active Collection) **stay local per device**
       in Release 1. Server-synced preferences are deferred.
     - **"Clear my data" only clears this browser**, never server copies. Deleting server
       documents is a separate, explicit action (delete a document, or delete the
       account).

**How the dashboard syncs (built in sync spec 2, 2026-11-02).** The design is in
`docs/superpowers/specs/2026-10-28-server-backed-documents-design.md`; these are the calls
made while building it. Items 2, 5, 8, and 10 were decided with the user on 2026-11-02; the
rest are the builder's calls, and the user kept them.

1. **Server changes enter local storage as `SYNC_TAB` log entries** (or as one
   `replaceDocument` when the local log doesn't reach back far enough). **Unsynced** means the
   local log entries after `syncedThrough` that aren't `SYNC_TAB` entries. Open tabs use their
   existing catch-up code unchanged.
2. **One poll per browser lists changes since a cursor** (`listDocuments({ since })`), every 60
   seconds from a visible tab, then fetches `changes` only for documents that moved. It covers
   open dashboards and the dashboards list with one small request a minute. Hidden tabs don't
   poll; a tab that becomes visible or comes back online polls at once.
3. **The poller is the one visible tab holding a Web Lock**, which it gives up when hidden.
   Uploads run in any tab under a per-document lock.
4. **A device conflict is a hold in the sync record**, so it survives reloads and every tab
   sees it. It is shown with the existing three-choice `ConflictDialog`.
5. **"Use the other version" keeps the local version as a separate snapshot request:**
   `POST documents/<id>/snapshots/` (sjvair.com #298), through `createSnapshot` in
   `@sjvair/sdk` 4.8.0-beta.6. "Use the other version" and "Discard" after a delete elsewhere
   keep the local version this way, with no save. (The plan first called for an extra
   snapshot field on a save.)
6. **A lost save answer is recognized.** The record notes the batch in flight; if the server's
   next version is exactly that batch, it counts as saved (no prompt, no duplicate).
7. **An oversized queue sends one `replaceDocument`** (from the server's content to the local
   one) instead of uploading in batches. A save's changes are capped at 1.5 M characters on the
   client; the server refuses bodies over 1 MB and changes over 2 MB.
8. **Switching spaces remounts the app:** flush every session, stop the worker, unmount,
   `initApp` for the new space, mount, go to `/`.
9. **Account spaces don't purge Recently deleted locally.** The server purges and reports the
   ids in `purged`. "Delete now" in an account space uploads first, then asks the server to
   purge the dashboard (see "Recovery", below).
10. **Refused saves with no fix in this spec** (`too_large`, `limit_documents`,
    `limit_storage`, `invalid`) hold that document as "Only on this device", retried on the
    next local commit in the space. The Saved popover says why, and a notice bar that can't be
    dismissed stays at the top of the page while any dashboard in the account is held this way
    (the notice bar was the user's addition).
11. **A blocked build** shows an update notice with the reason `"build-blocked"` and stops all
    uploads until reload.
12. **"Deleted elsewhere" asks only when the server's document is deleted and this device has
    a change other than a delete.** Two deletes agree.
13. **Space locks:** each open app holds a shared Web Lock `sjvair-space:<space>`, and waits
    for it before storing anything. Tidying removes a hidden space only under that lock taken
    with `ifAvailable`, so it skips held spaces, and a tab opening the space meanwhile waits
    for the removal. The orphan rule (a non-current account space with no hidden marker) runs
    only when the identity is known and is the opened space's.
14. **Permanently deleted elsewhere:** a document the server reports as purged is removed
    quietly when this device has no unsynced changes. With unsynced changes it asks "This
    dashboard was permanently deleted from your account. Keep your version as a new
    dashboard, or discard it?" Keep uploads a copy with a new id.
15. **The SDK pin** is `npm:@jsr/sjvair__sdk@5.0.0-beta.8` (exact). The documents client lives
    in this repo, in `src/lib/api/documents/` (copied 2026-11-11 from sdk-js 819d152, the code in
    `@sjvair/sdk` 5.0.0-beta.8, when it left the public SDK; see "The dashboard's own API code").

**Live share links (built in sync spec 3, 2026-11-02).** The builder's calls, in the plan
`docs/superpowers/plans/2026-11-02-sync-3-share-links.md`:

1. **The share token lives in the sync record** (`shareToken`), not in the document: sharing
   isn't an edit (no undo, no change log, no version bump). Every tab sees it through the
   existing `sync` message.
2. **The shared page polls `sharedChanges`**: one tiny `{ version }` answer when nothing
   changed, every 60 seconds while visible, at once on becoming visible or coming back online.
3. **Each open shared page polls on its own**, with no cross-tab leader (viewers are mostly
   signed out, one tab each).
4. **"You already have a copy" matches by source id** (`copiedFrom === shared.id`), not the
   content fingerprint the fragment import uses; the existing `ExistingCopyDialog` asks.
5. **Stop sharing asks first** (`confirmAction`): it breaks a link others use and can't be
   undone (the next link gets a new token).
6. **"Report this page" sends the path, not the full URL** (`page=/workspace/shared/<token>`)
   to sjvair.com's contact page (`src/lib/links.ts`), in a new tab.
7. **"Based on …" for a duplicate of a dashboard stored here** uses the local name and makes no
   request; otherwise it asks the server's `credit` once per page load per id, and shows nothing
   when offline or refused. The starter's id is never looked up.
8. **The display name has no client-side length limit**; the server's limit (60) is the source
   of truth, and a refused name shows "That name can't be used".
9. **A dashboard with unsynced changes still shares** (its last synced version) after one
   upload attempt; the dialog says so. One that has never reached the server can't share yet,
   and the dialog says why.
10. **A dashboard with an exact location asks before its link goes on** (step 4 spec 2): "Use
    93721 instead" or "Share my exact location". Unless the owner chose exact, the share runs
    with a check (`onlyIf`, after the upload and under the document lock) that the stored
    version has no point; a failed check or edits still waiting to upload refuse it
    (`check-failed`). While the link is on, every edit and every upload is guarded too, and
    the exact choice is remembered (`shareExact`) until the link is off. See "Widget data
    selection" → "Location privacy".

**Recovery (built in sync spec 4, 2026-11-03).** The builder's calls, in the plan
`docs/superpowers/plans/2026-11-02-sync-4-recovery.md`:

1. **Restoring keeps the replaced version on the server first.** In an account space, the
   current local content is kept with `keepSnapshot` (a `conflict` snapshot at the record's
   `serverVersion`) before the restore applies, so a restore can be undone after a reload. If
   the keep fails (offline, refused), nothing is restored and the dialog says why. A
   dashboard never uploaded skips the keep; its local log still holds the replaced version.
2. **The list shows every earlier version, with no merging.** Each is labelled with its source,
   newest first, with date and time.
3. **Offline, the dialog still lists the local original** and says the account's versions
   can't be loaded right now. The menu item shows for a stored, editable dashboard that is on
   the server or has a kept original.
4. **"Delete now" in an account space needs the server.** It isn't queued offline: it says it
   couldn't reach the account and leaves the dashboard in Recently deleted. A dashboard never
   uploaded is removed locally with no request. The button keeps its label; the confirmation
   says it is removed from every device.
5. **"Delete now" uploads first, like Share:** it uploads anything pending, then reads the
   dashboard again. If it's no longer deleted, another device restored it and it stops and
   says so. If it's held, it stops (not saved). Otherwise it sends `DELETE`; a `not_deleted`
   answer means a restore landed in between.
6. **Account gone, in the browser where it was deleted:** the `deletedAccount` signal marks that
   space hidden with the reason `"deleted"`, which `tidySpaces` removes with no 30-day wait
   (when the dashboard next opens in that browser and no open tab holds the space; tabs still
   showing it switch away first), unsynced changes included (decided with the user,
   2026-11-02). Other devices keep spec 2's behaviour.
7. **`markDeleted` overrides an earlier reason**, unlike `hideSpace`; another tab may already
   have hidden the space as `"expired"`.
8. **A server snapshot is upgraded with the same loader the local kept original uses**
   (`loadDashboard` with the migration chain), not the sync merge code, so the restore dialog
   adds no sync code to the initial bundle.
9. **On a `not_deleted` answer to "Delete now", the dashboard is pulled in at once**, so it
   leaves Recently deleted right away; if that pull fails, the next poll brings it back.
10. **The fake documents server models daily snapshots and their 30-day expiry** (still not the
    snapshot storage cap).

**Staff never see private dashboard contents in the admin** (no page shows a private
dashboard's body, snapshots, or change log). To review a reported shared page, staff open its
share link like anyone else.

**Saving model (decided 2026-09-24): autosave.** Every `applyChange` persists immediately
(debounced about 500 ms), with a small "Saved" indicator; undo covers mistakes. There is
no explicit Save. IDEA.md's example "Save Dashboard" menu action becomes **"Save as
copy…"** and **"Export…"**. The dashboard picker offers new (blank or from the starter
dashboard), duplicate, rename, and delete (with an undo toast).

**Local durability safeguards** (these matter most for anonymous users, whose documents
stay local; built in Foundations spec 3):

- **Persistent storage.** Where the browser decides silently (Chrome, Edge, Safari),
  `navigator.storage.persist()` is requested automatically on the first document create or
  edit. Where requesting shows a browser prompt (**Firefox**), the app never requests on its
  own: the storage status note and the backup reminder offer **"Protect my dashboards"**, which
  requests (and so shows the prompt) only when clicked, after the person has read why. Until
  granted, storage counts as unprotected. Refusing the prompt keeps the button in the status
  note but removes it from the reminder bar. The two cases are told apart by a **user-agent
  check** (Firefox) in the platform adapter: no feature check distinguishes them (the
  Permissions API reports "prompt" in Chrome too).
- **Storage status note.** A popover from the "Saved" indicator, and on the dashboards list:
  "Dashboards are stored in this browser." When unprotected, a second line says the browser
  may clear them (Safari does after 7 days without a visit), with "Download a backup" (and
  "Protect my dashboards" where it prompts). It never interrupts.
- **Backup reminder.** A slim bar above the dashboard, never a dialog or toast. Shown only
  when storage is unprotected, never on the first Pacific day of the space's first dashboard,
  only when a dashboard changed after the last backup download, and at most once every 14
  days. Actions: "Download a backup", "Not now" (this page load only), and "Don't remind me
  again" (off for good, per space). State is kept per space in preferences. The "sign in to
  keep this safe everywhere" line waits for accounts (`DEFERRED.md`).
- **Quota and write errors** keep the in-memory document, say plainly that the save failed,
  and offer "Download a backup"; failed saves retry on a backoff timer.
- **Recently deleted** (30 days, then purged on app open), **Clear my data** (every space,
  with other open tabs reset at the same moment and unable to write the old data back), and
  **kept originals** with "Restore an earlier version" (see "Recovery from a bad upgrade").

**Sharing without a server** (built in Foundations spec 3, decided 2026-10-25):

- **Copy versus restore.** A link or an Export file (one dashboard) is a **copy**: a new id,
  `copiedFrom` = the source id, then the app opens it (replacing the `/import#…` history
  entry) with the toast "Saved a copy to your dashboards". A backup file is a **restore**: a
  dashboard whose id isn't in this browser comes back with the same id; one already here is
  left alone (a backup never overwrites anything); one in Recently deleted is undeleted
  keeping the browser's version. A summary reports restored, already-here, and unreadable
  counts. A restored dashboard has its `deletedAt` removed (a backup is a snapshot of live
  dashboards, so a restore never lands one in Recently deleted). Only ids made of letters,
  digits, `-`, and `_` (up to 64) are restored, and never the starter's; others count as
  skipped. Restoring any dashboard counts as a backup for the reminder. Read-only (newer or
  invalid) dashboards in a backup are restored as stored, still read-only. Links and Export
  files refuse newer or invalid documents; a read-only dashboard's Export file is its stored
  value as it is (unknown top-level fields kept), less the local-only fields.
- **Exact locations (step 4 spec 2):** a link or Export file carries each point as the region
  its widget shows ("Your location is shared as 93721, not your exact position."); only the
  Share dialog's "Share my exact location instead" keeps it, per share. A copy made from a link
  or file always swaps any point for its region. A backup keeps exact points (a restore, not a
  share). Details: "Widget data selection" → "Location privacy".
- **"You already have a copy."** If a non-deleted local copy was made from the same
  contents, the app asks first: "Open my copy" or "Make a new copy" (equal prominence). "Same
  contents" is a **local content fingerprint** (a hash of the document's canonical JSON,
  kept per space in preferences, never in shares or exports; it travels only as backup-only
  metadata). A changed dashboard has a new fingerprint, so a fresh link gets a fresh copy
  with no prompt. A deleted copy doesn't count.
- **The envelope.** Links, Export files, and backups share one wrapper,
  `{ format: "sjvair-workspace", type: "document" | "backup", formatVersion, exportedAt,
documents }`, with its own version separate from `schemaVersion`. A shared document carries
  only `kind`, `schemaVersion`, `id`, `name`, and `body`; local-only fields are left out. A
  backup carries each dashboard exactly as stored (plus its fingerprint), or, for an open
  dashboard whose latest edits couldn't be saved, as it is in the tab. Collections and
  analyses can join without a new format (`DEFERRED.md`).
- **Links** are `<origin>/workspace/import#1.<lz-string URL-safe payload>` (the fragment is
  never sent to a server). Limits: a link is capped at **8,000 characters** (over it, the
  Share dialog offers the file instead); an incoming fragment at 64,000 characters before
  decompressing; one document at 1,000,000 characters of JSON (checked again after
  decompressing); a backup file at 50,000,000 bytes. Everything incoming passes the envelope
  schema, the size limits, and the full load pipeline before anything is saved.
  `lz-string` and the share/import code are lazy-loaded, never in the entry chunk.

**Share semantics:**

- **File / URL share → copy (fork on open).** Opening creates the recipient's own
  independent document.
- **Server share → live link.** Recipients see the owner's current version read-only,
  with **"Make a copy"** to edit their own. Fits teacher → class and SJVAir → public.
- **Viewer changes: a viewer can change what a tile shows, never what it holds** (the user,
  2026-11-13; step 5 spec 3). On a read-only view that shows tiles, a widget's in-tile switches
  (the Map's toolbar is the first user) work for the visit and are never saved, stored, sent or
  logged. The module is `src/lib/widgets/shared/tile-options.svelte.ts`:
  - `ViewerChanges` holds, in memory and per widget id, only the keys the viewer changed. A held
    key set to `undefined` means "missing" (the drawn default). `SharedPage` owns one per share
    token, so fullscreen and remounts keep the changes and leaving the page or opening another
    dashboard drops them. An unkept dashboard (below) gets one per session.
  - `tileOptions` reads a widget's options (saved, with the viewer's held keys on top);
    `changeTileOptions` writes them: on an editable dashboard one undoable `applyChange` (a
    starter's edit goes to its copy), on a read-only view held in memory; `viewerReset` drops held
    keys. There is no undo for viewer changes.
  - **Reset Map Options, for a viewer,** goes back to the owner's view, not the bare defaults: the
    toolbar's defaults are the owner's effective values, so Reset reports only the keys where the
    viewer differs, and those held keys are dropped.
  - **A live update keeps only changed keys:** a value the viewer changed keeps the viewer's
    choice, and everything else follows the owner. Held changes for a widget the owner removed are
    dropped, and **a held value that fails validation is left out key by key** (a pollutant the
    owner took out, say), so the drawn fallback applies.
  - **"Make a copy" keeps the viewer's changes:** `makeCopy` saves `ViewerChanges.applyTo` of the
    shared document it copies today (`view.doc`), with the held changes applied to the widgets'
    options and validated like any document. Matching an existing copy stays by source id.
  - **Marks stay owner-only:** Select and Remove stay hidden for viewers.
  - **It is not "Show patterns".** The contribution calendar's "Show patterns" switch is a
    personal display preference (device-wide, never in a document); viewer changes are per tile,
    per visit, about the tile's own data, and can become part of a copy.
  - Other widgets adopting it: see `DEFERRED.md`.

## Internationalization: English-only, translation-ready

Decided 2026-09-24. **Ship in English only**; no translations exist and there is no
timeline for them. But build so adding a language is _adding message files_, not a
retrofit. Context: sjvair.com declares `LANGUAGES` = en, es, tl (Filipino), hmn (Hmong)
and stores `User.language`, and server metadata strings are gettext-marked. As of
2026-10-13 the server has locale catalogs for es, tl, and hmn (`camp/locale/*/django.po`,
395 entries each), but **every entry is still untranslated**, and SMS alerts are now sent
in the user's language setting (which falls back to English for the same reason).
monitor-map and the mobile app have no i18n (the mobile app's language picker is
commented out).

**Day-one practices (cheap now, expensive to retrofit):**

1. **All UI strings via Paraglide JS** (inlang; compiled message functions, works with
   plain Vite, type-checked, tree-shaken) with an **English-only** message file. No inline
   UI strings in components.
2. **No string-concatenated sentences.** One message with parameters (and plural
   variants) per sentence.
3. **One `format` module** for numbers, dates, durations, and units via `Intl`/`date-fns`
   with a locale parameter (always `en-US` for now). No ad-hoc formatting.
4. **Saved documents store meaning, not English.** Default widget titles are stored as
   auto (`title: null`) and generated at render from metadata; only user renames are
   stored as text.
5. **Built-in content uses message keys** — starter-analysis notes/caveats, widget-type
   names, action/menu labels. User-authored text (Notes widget, custom names) is stored
   verbatim.
6. **Alert text is rendered at send time** from the rule's data, never stored at rule
   creation — so `User.language` can apply later without a data migration.
7. **Server-sourced text stays server-sourced** (metadata rule), and the data layer has a
   single place that sends a language (`Accept-Language`), currently always `en`.
8. **Layouts tolerate longer text** (Spanish ≈ 20–30% longer): no fixed-width text
   containers sized for English.

Deferred until translations exist (see `DEFERRED.md`): language picker, translation
files, translated content for the server's (currently empty) catalogs, per-language
metadata caching, translated alert text,
Hmong formatting fallback, monitor-map / mobile i18n. RTL support is not needed for
the declared languages.

## Time zone & calendar conventions

Decided 2026-09-24. The server stores timestamps in UTC, but **all summary rollups are cut
at America/Los_Angeles boundaries** (`settings.DEFAULT_TIMEZONE`, used in
`summaries/tasks.py`). The dashboard matches that.

- **Pacific time (America/Los_Angeles) everywhere, whatever the viewer's zone.** This
  covers "today", calendar day cells, set ranges (day/week/month/year), and rolling
  ranges. It keeps day boundaries identical to the server's daily
  and monthly summaries.
- **Timestamps display in Pacific time.** A "PT" label appears only when the viewer's
  device is in a different zone.
- **All date calculations go through the `format` module** with a time-zone-aware helper
  (`@date-fns/tz`), never the browser's local zone. Daylight-saving days are handled
  correctly: 23- and 25-hour days, and a repeated or missing hour in hourly data.
- **Weeks start on Sunday** (US convention). This applies to set weeks, week-to-date, and
  the contribution calendar. It is a single constant in the `format` module, so a future
  locale can change it.

## Metadata as source of truth

Decided 2026-09-23 (IDEA.md Open Question #7). Audit basis:
`docs/reference/server-data-inventory.md`.

**Rule:** anything describing data — labels, units, level breakpoints, colors, scales,
resolutions, coverage, attribution — comes from server metadata endpoints. Never
hardcode it in this app, `map-sdk`, `monitor-map`, or `sdk-js`. When a value is missing, add it to
server metadata rather than hardcoding "for now".

**What a dataset is (decided 2026-09-24).** A catalog entry is a **broad data domain**, and
each one is one Widget Creation accordion:

```ts
type DatasetCatalogEntry = {
	id: string; // e.g. "air-quality", "weather", "hms-smoke", "hms-fire", "pesticide-use",
	//          "pesticide-notices", "forecasts", "calheatscore", "calenviroscreen",
	//          "emissions", "tempo"
	label: string;
	description: string;
	source: string;
	license: string; // attribution
	entryTypes: {
		id: string;
		label: string;
		kind: "pollutant" | "meteorological" | "other";
		units: string;
		// Per entry type, not per dataset (e.g. pm25: raw…year; pm100 (PM10): raw only).
		resolutions: ("raw" | "hour" | "day" | "month" | "quarter" | "season" | "year")[];
		available?: boolean; // air-quality entry types: the available-pollutants switch
		retired?: { since: string; replacedBy?: string };
	}[];
	geographies: ("monitor" | "region" | "polygon" | "point" | "tract" | "zip" | "zone")[];
	metaUrl: string; // the domain's own …/meta/ endpoint; "" until that domain has one
	retired?: { since: string; replacedBy?: string }; // see "Stable ids and retirement"
};
```

**Catalog format changes (2026-10-22, from the sjvair.com metadata plan, approved by the
user there):** `resolutions` moved from the dataset onto each entry type, with no
dataset-level field (so clients need no inheritance rule); air-quality entry types carry
`available`; the catalog lists every server domain, including `emissions` and `tempo` (the
dashboard hides those without an adapter); and `metaUrl` is empty for domains with no meta
endpoint yet (since 2026-11-03 only `calenviroscreen`, `emissions`, `tempo`, and the pesticide domains lack one).

- **Air quality is one dataset.** Its entry types are PM2.5, O3, … (`kind: "pollutant"`).
  Monitor vs. region is a **geography choice inside a layer**, not a separate dataset.
  "At most one pollutant per widget" means at most one layer whose entry type has
  `kind: "pollutant"`, and the available-pollutants list filters which pollutants
  appear.
- **Weather (CIMIS) is its own dataset**, even though the server stores it as monitor
  entries: to users it's a different thing, and it isn't a pollutant. Its stations are
  listed via the catalog's `places_url` (`getMonitorsList({ dataset: "weather" })`).
- **Where "no code changes" ends:** new entry types, levels, labels, or colors inside a
  known dataset need **metadata only** (e.g. enabling NO2). A **new domain** (e.g. TEMPO)
  needs a client **dataset adapter** (fetch and shape), plus a map plugin if it's shown on
  maps. The client keeps an adapter registry keyed by dataset id, and **catalog entries
  without an adapter are hidden**, so the server can list datasets before the dashboard
  supports them.
- **A layer with no selection** means "all features" on a map. Charts and calendars
  **require** a place or selection (a monitor, region, or location). A **point** given to a range
  widget (e.g. from the starter's "Change place" bar) is **kept as the point** (in the layer's `place`) and resolved
  at render to its smallest containing region with data, labeled "(your location)", the
  same rule as "now" widgets. Staging freezes it to that region.

**Stable ids and retirement** (decided 2026-10-13). Saved documents and alert rules hold
references (monitor, region, location, dataset, and entry-type ids) for years, and the
things they point to change (the server removed the `place` region type in October 2026).

- **Ids are permanent and never reused.** Dataset ids, entry-type keys, monitor ids, and
  region and location codes (below) are a public contract. A rename changes the label, never the
  id. The server-side metadata plan states this as a rule.
- **Regions and locations are referenced by official code, not the server's id** (decided
  2026-10-13). The server's public region and location id is a `sqid` derived from the
  database row number, so it differs between local dev, a preview, and production, and
  changes if rows are deleted and re-imported. Saved documents, alert rules, the built-in
  starter, and test fixtures instead store:
  - a region as its **`type` plus `external_id`** (county FIPS, ZIP code, tract number,
    district code, …), which the server already treats as unique;
  - a location as its **`source` plus `external_id`** (e.g. the state CDS code), likewise
    unique on the server.
  - Monitors keep their existing server id (a UUID).
  - **Server work (step 3):** region and location detail and lookup endpoints accept the
    code pair and include it in responses; every referenceable region has a non-empty
    `external_id` (the **3 `custom` forecast zones** already have codes in
    `import_forecast_zones`, e.g. `sjvapcd-kern-airbasin`, but are **missing on
    production**; see `TODO.md`); and the import commands never change an existing code.
    Two known exceptions the plan must handle: **child-care sites** are keyed by the
    lowest facility license number at a merged site, which changes when that license
    closes (needs a stable site key, or old keys kept as aliases). Since 2026-10-15 the
    server also groups nearby same-name rows into one place at read time
    (`one_per_place`), choosing the representative by lowest database id, which differs
    between environments, so a reference must pick a group's code by a stable rule; and a **CDP that
    incorporates** becomes a `city`, changing its type and code pair (retire the old pair
    with `replacedBy`).
  - **As planned in the sjvair.com metadata plan (2026-10-22, approved by the user
    there):** regions and locations gain `retired` (`{ since, replaced_by: { type,
external_id } }`). Lookups by code: `regions/?type=&external_id=a,b` (returns sqids; a
    retired region comes back flagged; an unknown code is simply absent) and a new
    `regions/locations/?source=&external_id=`. Retired rows are hidden from listings and
    search but still resolve by code or sqid. Child-care sites keep their existing code,
    and any license number at the site finds it. A CDP that becomes a city is retired with
    `replaced_by` pointing to the city. The retired-vs-never-existed lookup for
    **monitors** is not in this round.
  - **Land-use regions are excluded** from code lookup and the permanence promise for now
    (decided by the user 2026-10-22, sjvair.com metadata plan). The server builds their
    codes as `{County}-{jurisdiction}-{OBJECTID}`, and a refresh of the state dataset can
    renumber `OBJECTID`s, so a saved code could point at a different area.
    `regions/?type=land_use&external_id=…` returns 400; land-use regions still show
    `external_id`, documented as not permanent. Every other region type and every location
    source is covered; 2010-only census tracts stay valid references (see `DEFERRED.md`).
  - Using the server's ids for user documents and codes only for built-in ones was
    decided against (see `DEFERRED.md`).
- **Retire, don't delete.** Catalog entries and entry types carry `retired` (a date and an
  optional `replacedBy`) instead of disappearing. Old data stays readable. Retired
  entries are hidden from pickers for new widgets but still resolve for existing ones.
- **A widget with a retired or missing reference shows a clear state**, never a blank or
  an error:
  - _Retired, with data:_ it keeps working over the dates that exist, with a short note
    (e.g. "This monitor stopped reporting on March 3").
  - _Replaced:_ the note offers "Switch to the replacement", a normal undoable edit.
  - _Gone entirely:_ a "no longer available" card in the widget's place, with "Choose
    another" and "Remove".
  - **The app never rewrites a saved document silently.**
- **Alert rules pause and tell the owner.** A rule whose target is retired stops
  evaluating, shows as paused in the rule list, and puts one notice in the alert inbox.
- **Shared pages behave the same way** for viewers, without the edit actions.
- **Server work (step 3):** retirement fields in the catalog and domain metadata, the
  never-reuse rule, and lookups that answer "retired" as distinct from "never existed"
  (for monitors, regions, and locations).
- **Naming to build against:** sjvair.com PR #282 (merged 2026-10-13) replaced the
  `ceidars` API with `emissions` (`/api/2.0/emissions/…`), so the dashboard uses
  `emissions` from the start and no saved document ever holds a `ceidars` id.

**Structure: per-domain meta + a catalog index.**

- Each domain owns a `…/meta/` endpoint (existing: `monitors/meta/`, `regions/meta/`;
  new: `hms/meta/`, `pesticides/meta/`, `calheatscore/meta/`, `forecasts/meta/`,
  `calenviroscreen/meta/`, `emissions/meta/` (the API moved from `ceidars/` in sjvair.com
  PR #282), `tempo/meta/` as needed).
- A top-level **`meta/datasets/`** catalog lists every dataset and links to its domain
  meta.
- **Coverage is separate** (it changes with the data); everything else is effectively
  static and long-cacheable.

**Gaps, in priority order:**

1. **Dataset catalog**: label, description, geography type, available resolutions,
   units, and source attribution/license. Needed by the Widget Creation picker,
   `AnalysisSpec` input filters, and export manifests. See "What a dataset is" above.
2. **Coverage/availability** — first/last data date per dataset and per
   monitor/region × entry type; which summary resolutions are complete (monthly+
   rollups exist only after the period ends).
   **Decided 2026-10-22 (sjvair.com metadata plan, approved by the user there):**
   coverage is computed on request and HTTP-cached (no precomputed table or background
   task). Two modes only: per dataset (first and last date for each catalog dataset), and
   one place (a monitor or region plus an entry type → first and last date). **No bulk
   mode**, so the place picker doesn't grey out places without data in Release 1 (see
   `DEFERRED.md`). "Which summary resolutions are complete" is a fixed rule, not per-place
   data (monthly and longer summaries exist only after the period ends), stated as static
   metadata in the catalog; the data layer's incomplete-period filling handles it.
3. **Non-pollutant scales**: smoke density, fire FRP tiers, CalHeatScore, AQI 0–500,
   temperature thresholds, forecast categories/burn status (labels + colors). Currently
   hardcoded in `monitor-map` and server Sass. **CalHeatScore meta also carries per-score
   `guidance`**, since the server stores only 0–4 labels today. AQI 0–500 is used only by
   the Valley Air District forecasts (monitors report concentrations, not AQI), so the AQI
   scale lives in `forecasts/meta/`. **Built (2026-11-03, step 3 spec 1; PRs open):**
   `calheatscore/meta/`, `hms/meta/` (smoke density with `opacity`, fire FRP), and
   `forecasts/meta/` (AQI, the `burn-status` entry type, and the zones with their regions)
   return scales keyed by catalog entry-type id; `monitors/meta/` adds a `scale` per entry
   type. Its old `levels` dict is removed by sjvair.com spec 5
   ([#306](https://github.com/SJVAir/sjvair.com/pull/306)); `scale` is the only level format.

   **School guidelines** (spec 5): each `monitors/meta/` entry type has `school_guidelines`,
   `null` except `pm25`. SJVAir's outdoor activity guidelines for schools, verbatim from the
   `/guidelines/schools/` page, which renders from the same source:

   ```ts
   type SchoolGuidelines = {
   	label: string; // "Outdoor Activity Guidelines for Schools"
   	resolution: "hour"; // compared with hourly PM2.5
   	source: { name: string; url: string }; // SJVAir, the schools page
   	activities: {
   		key: "recess" | "pe" | "athletics" | "events"; // permanent
   		label: string;
   		duration: string | null; // e.g. "15 minutes"; null for sporting events
   		levels: Record<string, string[]>; // PM2.5 level key → sentences, in order
   	}[];
   } | null;
   ```

   **Scale shape:** `{id, label, units, kind: "range" | "category", source, levels[]}`; a level
   is `{key, label, color, opacity, tier, description, guidance, min, max, value}`. Ranges are
   half-open (`min <= value < max`) with a `null` top `max`; categories use `value`. `tier` is
   0–4 or `null` (no severity). `description` is the official wording (credited by `source`),
   `guidance` is SJVAir's own. Level `key`s are permanent.

   **Daily figure** (SDK 5.0.0-beta.8, used by the calendars): a `monitors/meta/` scale also
   carries `averaging_hours` (`24 | 1 | 8 | null`, the averaging period its breakpoints assume),
   `daily_statistic` (`"mean_24h" | "max_1h" | "max_8h" | null`: the summary field a whole day
   is rated by) and `daily_statistic_label` (its words, e.g. "24-hour average"; `null` falls back
   to the dashboard's "Daily value"). Summary rows (every resolution) carry `mean_24h`, `max_1h`
   and `max_8h` (`number | null`; on a daily row, only the field its scale's `daily_statistic`
   names is filled, and `null` means too few hours to rate) and `is_final` (`false` while the
   day can still change). **Open-day rows** (`…/summaries/daily/open/`, single monitor, bulk
   monitors and bulk regions) are today so far, plus yesterday until its nightly row exists
   (about 03:00 Pacific); `mergeOpenDays` / `mergeBulkOpenDays` add them to the stored rows
   (the stored row wins on a shared day). The dashboard asks for them only for calendar
   requests whose range reaches yesterday or today, never reads their `expected_count` or
   `is_complete`, and never computes a daily figure itself. A scale with levels but no
   `daily_statistic` leaves every day unrated, with one note.

4. **Alert metadata** — alertable entry types per monitor type, alert levels,
   evaluation windows (today only in server `ENTRY_CONFIG`).
5. **Region hierarchy** — nesting between region types, counts, which regions have
   summaries. **Built (2026-11-03):** `regions/meta/` types carry `count`, `parents`,
   `referenceable` (false for land use), and `browsable` (false for MTRS and land use). **Regions that cross county lines** (locally 39 of 237 ZIPs and 27 of 200
   school districts; no cities or CDPs) are listed under **every county they meaningfully
   overlap** when browsing, each naming the other counties it's in (user, 2026-11-03).
   Today's `within=` (99% containment) would show them under no county. Built as
   `regions/?within=…&within_mode=overlaps` (also the geojson variant): it keeps regions with
   at least 1% of their own area inside the parents and adds `also_in`; the default
   `contained` mode is unchanged. Details in sjvair.com's step 3 spec 1.
6. **Choice lists** — stage/processor labels + descriptions, pesticide categories/IARC.
   **Built:** `monitors/meta/` carries `stages` and `processors` labels (pesticide lists stay
   with the pesticide spec).
7. **Display hints** — decimal precision, preferred chart type/scale per entry type.
   **Built:** each catalog entry type has `display: {precision, chart, y_min}`.

**Shared action tiers** (decided 2026-09-28). Scales with different step counts and names
(6 AQ levels, 5 heat scores, …) are compared by a **`tier` (0–4) in metadata** for every
level of every scale.

- **The tier scale is CalHeatScore's own 0–4 scale.** Heat maps one to one (Low 0, Mild 1,
  Moderate 2, High 3, Severe 4), and each tier's meaning comes from CalHeatScore's
  **official per-score descriptions** (its interpretation table's "Meaning" column).
  **Corrected 2026-11-03:** CalHeatScore publishes no per-score recommended actions (only
  those descriptions, a general stay-cool list, and organization-level steps in its User
  Guide). So each scale level carries the official text as `description` (credited) and a
  short SJVAir-written `guidance` line; the heat guidance was drafted from CalHeatScore's
  stay-cool advice and approved by the user. Guidance is empty for AQ "Good" and heat
  "Low" (user, 2026-11-03). The shape and texts are in sjvair.com's step 3 spec 1
  (`docs/superpowers/specs/2026-11-03-metadata-scales-design.md`).
- **The air-quality mapping** (decided by the user 2026-10-14). Very Unhealthy and
  Hazardous share tier 4; the other levels take one tier each, in order. The mapping is
  kept in server metadata.

  | Air-quality level              | Tier | CalHeatScore name |
  | ------------------------------ | ---- | ----------------- |
  | Good                           | 0    | Low               |
  | Moderate                       | 1    | Mild              |
  | Unhealthy for Sensitive Groups | 2    | Moderate          |
  | Unhealthy                      | 3    | High              |
  | Very Unhealthy                 | 4    | Severe            |
  | Hazardous                      | 4    | Severe            |

- Every other scale in the metadata (including smoke density in Release 1) is mapped onto
  the same tiers. **Smoke density:** Light 1, Medium 2, Heavy 3 (user, 2026-11-03; satellite
  density isn't a ground-level measure, so none reaches tier 4). Trade-off: tier meanings are anchored to CalHeatScore's definitions, and
  a change there would mean revisiting the mapping (easy, since it's metadata).

- **Heat for areas larger than a ZIP** (decided 2026-09-28): CalHeatScore is per ZIP, so a
  county, city, or similar target uses the **highest heat score among its ZIPs**, labeled
  (e.g. "Heat: High (highest in Fresno County today)"). That's the safe choice for activity
  advice. A point or ZIP target uses that exact ZIP. **Built as `calheatscore/place/`
  (2026-11-03):** takes `?region_type=&region=` (code) or `?monitor=` and returns the highest
  score per date among the ZIPs with at least 1% of their own area inside the region (a
  monitor uses the ZIP it touches); ties go to the lowest ZIP code.
- **Forecasts for areas that aren't a forecast zone:** use the containing zone, found
  through the forecasts app's zone list (exposed in forecasts metadata), not a region
  type. Note that forecast zones are **county regions for 6 of 9 zones** (incl. Fresno) and `custom` regions (missing on production as of 2026-10-14) for Tulare (Valley portion), Kern (SJV Air Basin portion), and Sequoia National Park and Forest (`forecasts/tasks.py` `ZONE_TO_REGION`). An area spanning zones uses the zone containing its
  center, labeled. **Built as `forecasts/place/` (2026-11-03):** same parameters; the rule
  order is county, zone, center (point-on-surface or monitor), then largest overlap (the zone
  needs at least 1% of the place's area). The response names the `rule` and returns one
  latest-issued forecast per date. Both place endpoints cache answers 24 hours.
- **"Can we go outside?"** leads with the **higher-tier condition's guidance** and lists
  both conditions beneath it; ties show both guidance texts. Only tier numbers are
  compared, and all wording is server metadata. With no heat data (uncovered ZIP, or not
  yet published today), it falls back to air quality alone and says so.
- Raising the tier when heat and poor air quality combine is deferred (see
  `DEFERRED.md`).

**Available pollutants (decided 2026-09-24).** The code supports every entry type, but
SJVAir is only confident in some readings (PM2.5 and O3 today). A server-controlled
**available-pollutants list in metadata** (e.g. an `available_pollutants` list or
per-entry-type `available` flag on `monitors/meta/` — ideally admin-editable so changing
it needs no deploy) gates which pollutants the frontend offers in **widgets, analyses,
and alert rules**. Enabling NO2/SO2/CO later is a metadata change, not a code change. The
new code never hardcodes pollutants (the v1 `"pm25" | "o3"` goes away with the v1 code).
**Shape (2026-10-22, sjvair.com metadata plan):** each air-quality entry type in the
catalog carries `available: boolean`, and `monitors/meta/` gains an `available_pollutants`
list. The server derives both from its existing `DefaultCalibration` rows (the map's
"published" switch), so one admin switch turns a pollutant on for the map, widgets,
analyses, and alerts together.
Priority: alongside gap #1.

**Cleanup to do alongside** (removing hardcoded duplicates once metadata covers them):
server breakpoints defined twice (`levels.py` + entry classes), legacy
`Subscription.LEVELS`, Sass AQ colors, `generate_group_map.py`; `monitor-map`'s
`colors.ts`, legend gradient, `150.5` fallback, hardcoded "µg/m³", smoke/fire colors;
stale `sdk-js` `api-urls.md`; mobile's `PMGauge.svelte` (old PM2.5 scale, see
`DEFERRED.md`). (This repo's v1 hardcoded values disappear with the v1
code; the new code never hardcodes them.)

## Tech stack

The existing stack stays (IDEA.md: "nothing is being ripped out"); tools are added as
needed. Plain Vite SPA — no SvelteKit, no server runtime — keeping embedding and a Tauri
wrap simple.

- **Current** (after Foundations spec 1): Svelte 5 + TypeScript + Vite, `sv-router`,
  Tailwind CSS v4, shadcn-svelte (bits-ui), `@lucide/svelte`, `svelte-sonner` (toasts),
  `date-fns`, `@date-fns/tz` (Pacific-time math), Paraglide JS (i18n-ready messages),
  `zod` (document validation), `idb` (IndexedDB, inside the platform adapter),
  `@sveltejs/enhanced-img`, `color2k` (`readableColor`), `@sjvair/sdk`, **Lexical** (`lexical`
  and the `@lexical/*` packages it needs; the Notes editor) and **`marked`** (the Notes Markdown
  lexer), both added in step 4 spec 6 (2026-11-10), pinned exactly (Lexical 0.53.0, `marked`
  18.2.0) and loaded lazily, and for testing
  Vitest (unit and browser mode with `vitest-browser-svelte`), Playwright, and
  `@axe-core/playwright`.
- **Planned additions (decided):** `uplot` (a direct dependency, for all charts),
  `lz-string` (URL-fragment sharing), `@sjvair/map-sdk` (the map library), `terra-draw`
  (drawn-shape selection, via a map-sdk plugin), the Sentry browser SDK (via the platform
  adapter), and JupyterLite + Pyodide
  (separate notebook app).

## Browser support & performance budget

Decided 2026-09-28.

- **Supported browsers = Tailwind v4's minimums: Chrome/Edge 111+, Safari 16.4+, Firefox
  128+.** Older browsers see a friendly "Your browser is too old for this app" notice
  that points to sjvair.com's main map. Some school Chromebooks past their update end
  date may fall below this; check with partner schools during the private preview.
  **The notice is shown by the bootstrap** (`app.js`, plain syntax), which feature-tests the
  floor (`CSS.registerProperty` for `@property`, and `CSS.supports` for `color-mix()`) before
  loading the app, so older browsers never parse the app bundle.
  Dropping to Tailwind v3 was decided against (see `DEFERRED.md`).
- **Performance budget, checked in CI as a soft limit:** about **250 KB compressed** of
  initial JS for the app shell (200 KB until 2026-11-10, when the user raised it: "It's a soft
  limit for now anyways. Do the work, and if the bundle is too big, we will address that later"). Going over prints a warning (a GitHub Actions annotation in CI)
  and does not fail the build (decided with the user, 2026-11-02: "I'd like it to load quick,
  but it won't be the end of the world if it's a bit over"). **Each widget type loads its
  own code only when used** (the map library only with a Map widget, uPlot only with charts,
  and so on). The budget assumes compressed
  delivery, which S3 only gives if files are uploaded pre-compressed (see "Template
  embedding").
- **A low-end device check before go-live:** Lighthouse with throttled CPU and network,
  plus a real older Chromebook from the private-preview school if possible.

## Telemetry, analytics & privacy

Decided 2026-09-28. The audience includes K-12 students; sjvair.com's `base.html` loads
Google Tag Manager/Analytics; and the dashboard's riskiest logic (sync, migrations,
IndexedDB, conflict replay) runs only in the browser, where no SJVAir front end reports
errors today.

1. **No Google Analytics or Tag Manager on `/workspace/`.** The dashboard is embedded in a
   **dedicated Django template that does not extend sjvair.com's base template** (see
   "Deployment" → "Template embedding"), so none of the site's tags load. Aggregate usage counts
   are deferred (see `DEFERRED.md`).
2. **Front-end errors go to the existing Sentry org**, through the platform adapter, with
   strict scrubbing: never document bodies, Notes text, names, emails, or coordinates;
   only the error, the app version, and anonymous technical context. Sentry's host is
   added to the CSP's allowed hosts. Setup (decided 2026-10-13):
   - **A separate Sentry project** for the dashboard in the existing org, so browser
     errors stay out of the Django project's issues. sjvair.com's `SENTRY_DSN` and
     `SENTRY_DSN_CLIENT` are left alone.
   - **The DSN is a Heroku config var injected at build time** (`VITE_SENTRY_DSN`; a DSN
     is public by design). Without it (local dev, forks), error reporting is off.
   - **The release name is this repo's git commit**, stamped at build time, since
     sjvair.com builds `main` unpinned.
   - **Source-map upload is deferred** (see `DEFERRED.md`).
3. **An in-app privacy note** (linked from the footer or account menu) explaining what's
   stored locally, what syncs, and what error data is sent.
4. **A feedback link** (an email address or form) for the private preview.

## Licensing

Decided 2026-09-28.

- **MIT** for `data-dashboard`, `map-sdk`, and `monitor-map`, matching `sdk-js` (and
  `django-resticus`). **Copyright holder** (decided 2026-10-14): the
  legal entity that operates SJVAir (whether it owns contractors' and volunteers'
  contributions is on the legal checklist in `DEFERRED.md`), with the brand after it. Every SJVAir repo uses the
  same line: `Copyright (c) 2026 Central California Asthma Collaborative (SJVAir)`. The
  CCAC website's footer says "All Rights Reserved", which must **not** be copied into the
  license, since the MIT terms grant those rights. `data-dashboard` has its `LICENSE` file
  (spec 5a, below). Still pending: `monitor-map` (on npm) has no license, which means "all
  rights reserved".
- **Built 2026-10-26 (Foundations spec 5a):** the `LICENSE` file and `"license": "MIT"` are
  in this repo; the check is a Vite plugin (`vite-plugins/licenses.ts`) that runs inside
  `npm run build`. It walks the modules actually bundled (JS, and packages imported from CSS),
  reads each package's `license` and `LICENSE` text, fails the build on anything off the list,
  and writes `THIRD-PARTY-NOTICES.txt` from the same data. Dev-only tools are not checked.
  **Named exceptions** (commented in the plugin): `@inlang/plugin-message-format` (empty npm
  `license` field, MIT `LICENSE` file) and `@jsr/sjvair__sdk` (first-party, MIT per sdk-js's
  `deno.json`, but the JSR build has no license field). The real fix for the second is a
  `LICENSE` file in sdk-js (planned below); remove the exception once it ships.
- **Dependency policy:** bundled dependencies must be permissively licensed: MIT, BSD,
  Apache-2.0, ISC, or MPL-2.0 when used unmodified (e.g. Pyodide), and **OFL-1.1 for fonts
  only** (decided 2026-10-26; the bundled Inter font is OFL-1.1). A **CI license check**
  flags anything else, and the build generates a **third-party notices** file (which
  also covers the JupyterLite/Pyodide notices).
- Adding the license to `monitor-map` is a sibling-repo change: it goes in its next plan,
  or as a tiny standalone change with the user's approval. `map-sdk` is created with MIT.
  `sdk-js` declares MIT in `deno.json` but has no `LICENSE` file either; it gets the same
  file the same way.

## Accessibility

**Target: WCAG 2.2 Level AA from Release 1** (decided 2026-09-24). Applies to all widgets
and views.

- **Keyboard move and resize** (WCAG 2.1.1, Keyboard). Focus a widget's title bar and press
  Enter to pick it up; arrow keys move it one grid cell, Shift+arrows resize, Enter drops,
  Esc cancels.
- **Move ▸ and Size ▸ submenus** (WCAG 2.5.7, Dragging Movements) in the widget ⋯ menu,
  through the shared action list: Up, Down, Left, Right, To top, To bottom; Wider, Narrower,
  Taller, Shorter. One click is one step (one undo step), and the submenu stays open for the
  next. Keyboard support alone doesn't meet 2.5.7 (W3C technique G219).
- **Live-region announcements** for layout changes, e.g. "Moved to column 3, row 2" or
  "Widget minimized to taskbar". `announce()` and toasts go to one live region on the page; while a
  modal dialog is open they go to that dialog's own region instead (bits-ui hides everything
  outside a modal from assistive technology). A dialog stops taking messages as soon as it starts
  closing; a message for the page waits until the closing dialog is gone. A toast (`onlyInDialog`)
  is read from our regions only when a dialog was on screen as it appeared or opens just after;
  otherwise the toaster's own region reads it. The saved indicator announces only changes that matter (a failure, a
  conflict, recovery), not every "Saving…" and "Saved".
- **Focus management:**
  - Fullscreen traps focus; Esc exits and restores focus.
  - Minimize moves focus to the widget's taskbar item; restore returns it to the widget.
  - The taskbar is a keyboard-navigable toolbar (roving tabindex).
- **Animations respect `prefers-reduced-motion`.**
- **Official level colors, used accessibly** (decided 2026-09-28). Server metadata keeps the
  official EPA AQI colors, some of which fail contrast on white (yellow `#ffff00` is about
  1.07:1). So:
  - **Color never carries meaning alone** (WCAG 1.4.1): tiles, chart threshold lines,
    calendar cells, and legends always show the level's label, tier, or an icon.
  - **Swatches and colored areas get a contrasting outline** (WCAG 1.4.11, 3:1).
  - **Text on a level color uses color2k's `readableColor`** (black or white, whichever
    contrasts more, per the WCAG luminance formula), shared through one helper in the
    `format`/theme module (mobile already uses it). No `text_color` metadata field.
  - axe checks and manual passes cover these states (e.g. a yellow-level tile, the
    calendar).
  - **The one exception: the contribution calendar's "Show patterns" switch** (step 4 spec 5).
    With it on (the default), each cell also carries a per-tier pattern, so the level does not
    rest on color. A viewer may switch it off for themselves (a per-viewer preference, not saved in
    the document) and then sees color only; the tooltip and each cell's accessible name still give
    the level. This is the user's informed choice, recorded here as the only place color alone is
    allowed.
- **The year calendar's day cells are smaller than 24 px** (WCAG 2.2 2.5.8, Target Size
  (Minimum), step 4 spec 5). Its cells are about 12–16 px, so a whole year fits across a
  dashboard-wide widget, as GitHub's contribution graph does. A year at a glance is essential to
  that view (2.5.8's "essential" exception), and larger cells would mean scrolling sideways
  through the year. Other routes to the same days: the keyboard (arrows, Page Up/Down, Shift+arrows),
  the month calendar (cells at least 3rem tall), and the CSV. A deliberate exception: the user's
  decision (the user, 2026-11-09).
- **Range selection without dragging** (WCAG 2.5.7). On the calendars, the two-click range
  (click a day, click another) is the single-pointer alternative to dragging across days; the
  keyboard has its own (Shift+arrows).

- **Both modes are checked** (design pass, 2026-11-03). The axe checks (`e2e/a11y.spec.ts` and
  the per-feature ones) run in light and dark. `src/lib/theme/contrast.test.ts` checks the token
  pairs that matter in both modes: text and muted text on the page and cards, links, primary
  button text, the focus ring, chart series on cards, and destructive text (also on its own
  tint). A level swatch on a dark card keeps its outline and label (a component test).

- Every data widget has a non-visual fallback: the **Data table** widget serves chart/map
  data; maps and charts expose their data as summary text or link to a table view.
- Keyboard navigation and ARIA via shadcn-svelte / bits-ui primitives, not hand-rolled
  interactive elements (includes the context menu — Shift+F10 / Menu key).
- Standard loading/error states per widget (skeleton or spinner; inline error with retry).

## Testing strategy

Decided 2026-09-24.

| Layer         | Tool                                                                | Covers                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit          | Vitest (existing)                                                   | Pure logic: layout engine, `applyChange`/undo, menu resolution and merge, `format` and Pacific time/DST, resolution selection and stitching, descriptor codecs, document migrations, analysis steps    |
| Component     | Vitest browser mode (Playwright provider) + `vitest-browser-svelte` | Svelte components in a real browser: widgets, Widget Creation accordions, pickers                                                                                                                      |
| End-to-end    | Playwright on Chromium, WebKit, Firefox                             | Drag/resize and keyboard move/resize, context menus, autosave → reload, undo, the offline banner, fullscreen/taskbar focus, a Map widget WebGL smoke test. WebKit stands in for Safari and Tauri/macOS |
| Accessibility | `@axe-core/playwright` inside E2E                                   | Automated WCAG 2.2 AA checks on key screens. Manual keyboard and screen-reader passes are still required before releases                                                                               |

- **API data:** E2E uses recorded fixtures via Playwright request routing, so runs are
  deterministic. A small **smoke suite against the local sjvair.com dev stack** (podman)
  catches contract drift.
- **CI** (decided 2026-09-24): **PRs into `main` run the full suite**: unit, component,
  and three-engine E2E (Chromium, WebKit, Firefox) plus axe. Merging to `main` is
  effectively a deploy, so this is the pre-production gate. PRs into the `foundations`
  integration branch also run the full suite (decided 2026-10-20: GitHub can only start a
  workflow by hand once it is on `main`), and so do PRs into step 2's `layout` branch (added
  2026-10-29). A PR runs either the full suite or the Chromium-only E2E job, never both. Other PRs between feature branches run the fast
  set (unit, component, Chromium E2E).

## Deployment

Decided 2026-09-24. **Release 1 is served from sjvair.com under a path**, not from a
separate origin. **The base path is `/workspace/`** (decided 2026-10-13, replacing the
2026-09-25 choice of `/explore/`).

- **Why `/workspace/`:** the base path names the _app_, not one of its resources. The app
  holds Dashboards _and_ Analysis, so `/dashboard/` would either repeat itself
  (`/dashboard/dashboards/:id`) or put Analysis under "dashboard". The product
  is called **"SJVAir Dashboard"** in the UI (decided 2026-10-26: the app name, page titles,
  manifest, and messages); only the URL uses `workspace`.
- **Why not `/explore/` any more:** sjvair.com now has the "Pesticide Data Explorer" at
  `/tools/pesticides/`, with a "Facility Emissions Explorer" to follow, and the server
  calls them "the explorers". An `/explore/` path for a different product would confuse
  people.
- **Top-level, not under `/tools/`:** the dashboard is a person's home base that can link
  out to the explorers, not one tool among them. The `beta_tools` gate can still cover it
  with a small middleware change.
- **Before hosting:** confirm no existing sjvair.com CMS page uses `workspace` (Django's
  final catch-all serves prose pages).
- **CSRF cookie and trailing slashes** (docs review 2026-09-28): nothing in sjvair.com
  calls `ensure_csrf_cookie`, so a user landing directly on `/workspace/` may have no
  `csrftoken` cookie, and every cookie-based save would fail after the resticus CSRF fix.
  The `/workspace/*` view must be decorated with **`ensure_csrf_cookie`**, and must **not
  force trailing-slash redirects** (the catch-all `PageTemplate` does; the route table has
  no trailing slashes). This is the hosting track's responsibility.

- **Same origin, so cookie auth.** Users signed in to sjvair.com are signed in to the
  dashboard. There is no token handling, no token in browser storage, and no dependence
  on CORS. This matters because Release 1 includes sign-in and server-backed documents.
  Token auth stays supported for Tauri and any future standalone build (see
  "Authentication").
- **The monitor-map import pattern, as-is** (decided 2026-09-24). During each Heroku
  deploy, a sjvair.com build step clones this repo's **`main`**, builds it, and copies it
  into `dist/` (like `scripts/import-monitor-map.sh`). A Django catch-all route renders the
  dashboard's template for `/workspace/*` (see "Template embedding" below). **No version pinning:** `main` is always
  production-ready and ships with every server deploy. Needs an approved sjvair.com
  plan.
  - **Consequence: merging to dashboard `main` is the deploy approval point**, since any
    server deploy (even an unrelated backend fix) ships it. CI on PRs is the gate.
  - **Before go-live**, the import and route may be merged into sjvair.com but the
    `/workspace/*` route stays **disabled or hidden** (except for the private preview),
    so in-progress work on `main` isn't public. Merges still need explicit approval.
  - **After go-live**, unfinished features stay on branches or behind a flag.
  - A broken dashboard build would fail the server deploy. This is the same risk
    monitor-map already carries, accepted for now.
- **Repo visibility** (decided 2026-09-28; done): `SJVAir/data-dashboard` is
  **public** (it was private, which would break the anonymous `git clone` in the
  monitor-map-style import). A history scan found no committed secrets (only
  `.env.example` with public URLs). This matches monitor-map and sdk-js, which are public.
- **Build configuration:** `VITE_*` keys (MapTiler, NREL, …) come from **Heroku config
  vars** at build time, as for monitor-map. These keys end up in the built JavaScript like any
  in-browser map key, so **each must be restricted by domain** in its provider's
  dashboard (MapTiler, NREL). Use separate keys, or extra allowed domains, for localhost
  dev and a staging preview app. The router's `basePath` is `/workspace/`; built files are
  served from Django's static path (see "Template embedding" below).
- **Template embedding on sjvair.com** (decided 2026-10-13; the user corrected an earlier assumption that the
  view would serve the dashboard's own `index.html`). **The dashboard is built at deploy
  and embedded in a Django template view, the way the monitor map is**
  (`pages/index.html`: `{% static %}` tags for a fixed-name script and stylesheet, a
  helper for locating other build files, and the signed-in user passed in from the
  template). One difference:
  - **A dedicated template that does not extend `base.html` / `page.html`.** The site
    shell would bring Google Tag Manager and Analytics, Bulma's global styles, the old
    Raven script and inline scripts, and the site header, footer, and Translate widget,
    which conflict with the no-analytics rule, Tailwind, the CSP, and the full-height
    windowed layout. The template is a bare shell holding only the dashboard, whose own
    nav links back to sjvair.com.
  - **Build output:** fixed-name entry files (one script, one stylesheet) plus
    content-hashed lazy chunks, and `version.json` (at the top level next to `app.js`, built in
    Foundations spec 5a). **Files find each other by relative
    reference** (decided 2026-10-14): the build resolves every chunk and asset relative to
    the module that loads it (`import.meta.url`), so one build works in local
    development, the preview, and on S3. This replaces
    monitor-map's approach (a `window.__cdnUrl` helper set by an inline script, which the
    no-inline-script rule forbids and which module import order would make fragile).
    Lazily loaded assets keep content-hashed names (only the entry script and stylesheet
    have fixed names), since they are uploaded as immutable.
  - **Static files are served from S3, a different origin** (decided 2026-10-13: the
    same pipeline as the map; serving the dashboard's files from sjvair.com through
    WhiteNoise was the alternative). Verified on production that day: sjvair.com's
    static files are synced to S3 in the release phase (`sync_staticfiles_s3`) and served
    from `sjvair-production.s3.amazonaws.com`, with **no compression, no `Cache-Control`**,
    and cross-origin `GET` allowed only for `https://www.sjvair.com`. The dashboard
    therefore needs these accommodations:
    1. **Compression and cache headers are set at upload.** _Deferred 2026-10-26 by the
       user: the dashboard is uploaded exactly as monitor-map is for now; see `DEFERRED.md`
       and spec 5a's reload refresh. The plan below is kept for when it's revisited._ The dashboard's files go to
       S3 pre-compressed with `Content-Encoding`, hashed chunks as long-lived and
       immutable, and the fixed-name entry files and `version.json` as `no-cache`
       (revalidated on each load). Without this the ~200 KB compressed budget means
       nothing on the wire. A post-deploy check confirms the headers. Today's
       `sync_staticfiles_s3` (one `aws s3 sync`, the same headers for every file) can't do
       this, so the hosting plan specifies the upload:
       - the general sync **excludes the dashboard's directory**, so compressed files are
         never uploaded without their `Content-Encoding`;
       - the dashboard uploads in **separate passes, in order**: hashed chunks first, then
         uncompressed assets (fonts, images), then the entry files and `version.json`
         last, so a page never references a chunk that isn't there yet (old dynos keep
         serving during the release phase);
       - file names keep their extensions so content types are right;
       - **the command fails the release on any upload error** (today it prints the
         return code and exits successfully).
    2. **The CSP allows only the dashboard's folder on the static host** (decided
       2026-10-14), e.g. `https://<bucket>/static/workspace/`, for scripts, styles,
       fonts, images, and `connect-src`; the view builds it from `STATIC_URL`. Allowing the
       whole host would also permit the site's other scripts there (htmx, admin jQuery,
       monitor-map), which an injection bug could misuse.
    3. **Workers are built inline** (as blob workers), since a worker script cannot be
       loaded from another origin. `worker-src blob:` already allows this, and the
       dashboard's CSP must keep it: the downsampling worker
       (`src/lib/data/downsample.worker.ts`, imported with `?worker&inline`) is created from
       a `blob:` URL, so dropping `blob:` from `worker-src` breaks PM10 and other raw-data
       charts. The build emits no separate worker file.
    4. **The web app manifest, and the later service worker, are served by Django under
       `/workspace/`**, because they must be same-origin. Icons can stay on S3.
    5. **`version.json` is fetched from the static origin** (located relative to the entry
       module) with `cache: "no-store"`
       (allowed by the bucket's cross-origin rule).
    6. **Cross-origin problems only show in production**, because local development serves
       static files from the same origin. **Revised 2026-10-26 (the user):** local setup
       matches monitor-map's (same origin, nothing standing in for S3), and the preview is on
       production behind `beta_tools`, so it uses the real S3 serving and the existing
       cross-origin rule for `www.sjvair.com`. Cross-origin behavior is first exercised
       there, with the CSP report-only and errors in Sentry (see `DEFERRED.md`).
  - **The bootstrap entry and `startApp(staticBase)`** (built 2026-10-26, spec 5a). `app.js`
    is `src/bootstrap.ts`, deliberately plain syntax: it finds `#SJVAirDataDashboard`, tests
    the browser floor (see "Browser support & performance budget"), and only then
    dynamically imports `src/main.ts` and calls `startApp({ target, staticBase })`.
    `staticBase` is the entry module's own folder (`new URL(".", import.meta.url)`), so the
    page passes no path. A browser below the floor gets the "too old" notice instead of a
    parse error.
  - **The reload refresh.** When the app finds that `version.json` (fetched from
    `staticBase`, `cache: "no-store"`) differs from its own build id, the notice's reload
    button first re-fetches the fixed-name `app.js` and `app.css` with `cache: "reload"`, so
    the browser's HTTP cache can't hand back the stale entry files, and then reloads. It
    never rejects; if the refresh fails the page reloads anyway. A dev build skips the check.
  - **No `VITE_*` names or values reach the bundle** (spec 5a).
    `configureSdk({ dev, prodUrl }, pageOrigin)` takes only those two fields, under names
    without the `VITE_` prefix, and the build stops inlining `import.meta.env` objects;
    `npm run check:build` fails on any `VITE_` string in `dist/workspace/` (and checks the rest
    of the hosting contract). `npm run check:budget` checks the initial bundle budget and
    warns when it is over.
  - **The live host is `www.sjvair.com`** (the bare domain redirects to it). Docs write
    `sjvair.com/workspace/` for short; share links and the same-origin API use
    `location.origin`.
  - **The template passes data, not script:** the signed-in user (id, display name, email,
    verification status; never the API token) goes in a
    `json_script` data block (the app finds its files by relative reference, so no
    static path is passed), which the CSP does not treat as executable. No inline
    JavaScript.
  - **The view owns the response:** the CSP header, `X-Robots-Tag: noindex` on
    `/workspace/shared/*`, `ensure_csrf_cookie`, no forced trailing slash, framing
    protection, the manifest, and no caching of the page itself (static-file headers are set
    at upload, above).
  - **A takedown or deleted share is answered by the API:** the view always serves the
    app, which shows "no longer available" from the API's response.
  - **This repo keeps an `index.html` for local development and standalone or Tauri
    builds only.**
  - **The hosting contract** (settled 2026-10-26 with the sjvair.com hosting session) is
    recorded in `docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` →
    "Hosting contract", the single source both repos follow; changes go through this repo.
    In short: `npm ci && npm run build` (Node `>=26 <27`) writes `dist/workspace/` with
    fixed-name `app.js`, `app.css`, `version.json`, `manifest.webmanifest`, and
    `THIRD-PARTY-NOTICES.txt` at the top level and hashed files under `assets/`; the template
    mounts the app in `<div id="SJVAirDataDashboard">` and passes identity in a `json_script`
    block `sjvair-identity`
    (`{"v": 1, "user": null | <the session account/ response>}`, never the token; revised
    2026-10-27 by spec 5b, which also dropped the "never the phone number" rule and kept
    `v: 1`, since nothing read the block and nothing was released). An unknown `v`, an
    unreadable block, or a `user` that fails validation reads as signed out (the unreadable
    case is reported, scrubbed). The dashboard's `index.html` no longer carries a stand-in
    block, so dev, E2E, and the standalone build ask `account/` once instead; the template
    references `app.js` by its exact static URL (no query string, no renamed copy), because hashed chunks import it back as `../app.js` and
    any other URL runs the bootstrap twice; the CSP comes from this repo's
    `csp-hosts.json`, report-only for the preview and enforced by a server setting
    (`WORKSPACE_CSP_ENFORCE`) before go-live; the manifest is served by Django at
    `/workspace/manifest.webmanifest`, outside the `beta_tools` gate (browsers fetch it without
    cookies; it holds nothing private) and `noindex`.
  - Extending the site's base template, serving the dashboard's own `index.html`, and a
    build-manifest file read by the server were considered and decided against (see
    `DEFERRED.md`).
- **Same-origin API in production:** when served under `/workspace/`, the SDK origin is
  the page's own origin (`setOrigin(location.origin)`), not an env value. This prevents
  `www.sjvair.com` vs `sjvair.com` mismatches from turning API calls cross-origin and
  silently breaking cookie sign-in. `VITE_PROD_URL` is read only for production
  standalone or Tauri builds, where it is passed to `configureSdk` as `prodUrl`; it is ignored
  in dev and never set for the sjvair.com build (production under `/workspace/` uses the page
  origin).
- **`basePath` support in `src/router.ts` is pulled into Release 1**: the one piece of the
  deferred embedding work that serving under a path needs. Embedding in a host app with its
  own router stays deferred.
- **Private preview before go-live** (decided 2026-09-24). `sjvair.com/workspace/` goes
  public only when Release 1 is complete, but from about Release 1 step 4 an **unlisted
  preview** (a staging Heroku app, a hidden route, or the server's `beta_tools` flag;
  chosen in the hosting-track plan)
  lets a pilot teacher and a researcher try it and give feedback early. **Decided
  2026-10-26: the `beta_tools` flag on production**, with a "My Dashboard" link under the
  beta-only "Data Tools" menu (no staging app, so no extra S3 cross-origin origin).
- **JupyterLite (Release 3)** lives at its own path (e.g. `/notebooks/`), and COOP/COEP
  headers are set only for that path.
- **CI in this repo** runs lint, type-check, tests, and build on every PR. **Merging to
  `main` needs the user's explicit go-ahead**, because it is effectively a production
  deploy. The same goes for triggering server deploys.
- Server context: `CORS_ORIGIN_ALLOW_ALL = True` with `CORS_ALLOW_CREDENTIALS = True`. This is
  largely contained by Django's default `SameSite=Lax` session cookie. Tightening it is
  tracked in `DEFERRED.md`.

## Embedding (production build)

Like `monitor-map`'s `MapShell`, this app's production build is intended to be
embeddable inside another host app/site, not only run standalone. This shapes several
decisions made along the way:

- **No SvelteKit, plain Vite SPA** — a pure static client with no server runtime to
  strip out, so the same build works standalone, embedded in a host page, and
  eventually wrapped by Tauri.
- **`sv-router` needs a host-safe escape hatch** — same problem `monitor-map` solved
  for `MapShell` with `routerEscapeHatch`/`basePath` (see its `CLAUDE.md`): a host
  page that already has its own router must be able to either mount this app under a
  sub-path (`basePath`) or disable this app's own history/URL manipulation entirely
  when the host is driving navigation. **`basePath` is built** (Foundations spec 1) for
  serving under `/workspace/` (see "Deployment"); otherwise `src/router.ts` still assumes it
  owns top-level routing, and the escape-hatch/in-memory mode for
  embedding in a host app with its own router stays deferred (see `DEFERRED.md` → "Embeddable production
  build").
- **URL state vs. embedding** — decided in "Routing, URL state & undo": when the host
  owns the URL, the same routes are held in memory.

## Legacy: v1 tab model

The sections below describe the original tab-per-data-domain design that the current code
implements. **That code is removed in Release 1's Foundations step** (a fresh start; it
was never deployed). Parts are reused only if they're exactly what the new design needs.
These sections stay only as a record until then. Tech stack and accessibility rules live
in current sections above.

### Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

### Tab structure

One top-level tab per SDK data domain, routed via `sv-router`:

- **Monitors** (`/`) — entry_type filter (pm25/pm10/o3/etc., not a sub-tab), date
  range, client-side county filter (using the `county` field already present on
  `MonitorData` — no SDK changes needed). Map, chart, and spreadsheet views, all
  independently toggleable.
- **HMS Smoke/Fire** (`/hms`) — date range filter. Primarily map-centric (GeoJSON
  polygons); chart/spreadsheet toggles may be hidden or disabled for this tab.
- **Collocation Sites** (`/collocation-sites`) — not a date-range + multi-view tab
  like the others. A collocation "site" pairs a reference monitor with a collocated
  monitor, with no time-series data of its own. The flow is: list/map of pairs →
  select a pair → drill into a comparison view of both monitors' entries over a date
  range (reusing the Monitors tab's chart/spreadsheet views against two monitor IDs).

### State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1; server sync of
  preferences is deferred, see `DEFERRED.md` → "Server-synced preferences") holds only _defaults_: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no params present
  — not on every navigation. Once URL params exist, they win.
- **`src/lib/url-state.ts`** provides the pure, unit-tested serialization codecs
  (`encodeDateRange`/`decodeDateRange`, `encodeViews`/`decodeViews`) a tab uses to
  read/write its URL search params via `sv-router`'s `route.search`/`searchParams`.
- Each tab owns its own lightweight `*.svelte.ts` manager (mirroring `monitor-map`'s
  `monitorsManager` pattern): fetches from `@sjvair/sdk`, holds `$state`, derives
  view-ready data. These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s own managers, which are scoped to "all currently active
  monitors," not arbitrary historical date ranges.

### Views (v1 tabs)

Rendered as simultaneous split panes when more than one is toggled on (side-by-side
on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `@sjvair/monitor-map`'s `MapShell` plus the relevant integration(s) for
  that tab (e.g. the Monitors tab passes `[monitorsMapIntegration]`). `MapShell` must
  be used with `routerEscapeHatch={false}` since this app has its own `sv-router`
  navigation — see `monitor-map`'s `CLAUDE.md`.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart` module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export, preferring
  the SDK's existing CSV entries endpoint over re-serializing fetched JSON client-side
  where the endpoint's shape matches what's displayed.

### Out of scope

See `DEFERRED.md`.
