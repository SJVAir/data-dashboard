# Release 1, step 4, spec 3: Get data (formerly the Data Explorer)

Status: approved by the user 2026-11-05 (brainstormed the same day). Branch `step-4-spec-3` from `step-4`; the
PR goes into `step-4` (the user's yes needed to merge).

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.

## Where this sits

Step 4 is six specs into `step-4`. Spec 1 built the widget groundwork, Chart, Data table, and
CSV export; spec 2 built the shared place picker and location privacy. This spec builds the view
where data widgets start and get edited. Specs 4 (the "now" widgets), 5 (calendars, heatmap)
and 6 (Notes, starter dashboard) plug their widget types into it through their registry
descriptors. No map code (step 5).

## Why

Today "Add widget" drops in a Chart or Data table showing Fresno County PM2.5 for the last 30
days, and the only thing you can change afterwards is the place. People need one place to say
_what_ data, _where_, and _when_, see it, and then either put it on a dashboard or download it.

## Who it's for (the user, 2026-11-05)

- **A teacher or parent** wants "how has the air been at my school this month" as a chart on
  their dashboard in under a minute. They should never meet the word "resolution".
- **A researcher** wants exact numbers ("hourly PM2.5 for these six monitors, January to
  June") and a CSV, without making a widget.

## The name (the user, 2026-11-05; replaces spec 1's "Data Explorer")

People already know roughly what they want; they aren't exploring the way sjvair.com's
Pesticide and Facility Emissions explorers let them (the server calls those "the explorers").
So:

- **Top nav: "Data".** **Page heading: "Get data"**, or **"Edit data"** when opened from a widget.
- In docs it's **"the Get data view"**. Older text saying "Widget Creation" or "Data Explorer"
  means this view.

## Goals

- One view that picks dataset layers, places, and a date range, shows a live preview as a Chart
  or a Table, and then **Add to dashboard** or **Download CSV**.
- **Edit data** on every data widget, opening the same view with **Save changes**.
- Multiple layers per widget: at most one pollutant layer, plus overlays.
- The advanced resolution override.
- Which datasets, date presets, and "Show as" choices appear comes from the catalog and the
  widget-type descriptors, so specs 4 and 5 add types without changing this view.

## Non-goals (this spec)

- Overlays whose server support isn't there yet: smoke per day, weather (nearest station,
  daily summaries, SDK entry types), monthly pesticide use. The **Get data layers** track
  (sjvair.com + sdk-js session, started 2026-11-05, in that order: monthly pesticides, nearest
  weather station, smoke per day, weather summaries) delivers them; each becomes a layer here
  in a later change (see "Deferrals").
- Fires by distance or per day, TEMPO, and emissions series (deferred; see "Deferrals").
- One chart row per place ("small multiples"; deferred).
- The "now" widgets, calendars, heatmap, Notes, the starter dashboard, and the Map.
- Time-offset or correlation analysis. The chart invites a closer look; lag and correlation
  belong to Release 3's Analysis.

## Anti-goals

- A form you must fill in before seeing anything. It opens with a working preview.
- A chart that implies one layer caused another (no "correlation" wording, no fitted lines).
- Showing a layer by color alone (day bands carry labels and a pattern; see "Accessibility").
- Growing the initial bundle (197.5 KB gzip today; soft budget 200).
- Hardcoding datasets, entry types, labels, units, level names or colors.

## Decisions

### It opens already filled in (the user)

The preview is never blank; you adjust a working picture, and every change updates it.

- **From the top nav or "Add widget":** your last Get data draft (or the last place and
  dataset you used), or for a first-timer **Fresno County · PM2.5 · last 30 days** (today's
  `addable()` default). **(my call)**
- **From a widget's "Edit data":** that widget's data. **(my call)**

### Layout: option A (the user, from `layout.html`)

- **Left column, top to bottom:**
  - **When**: the date control (below).
  - **Where**: the places, with "Change", which opens spec 2's `PlacePicker` (embedded,
    `multiple` mode with the chosen widget type's `maxPlaces`).
  - **What**: one collapsible section per dataset, generated from the catalog (see "Which
    datasets appear"). Air Quality starts open.
  - **More options**: the resolution override ("Detail").
- **Right:** a large live preview with a **Show as** switch (Chart | Table).
- **Bottom:** a bar that stays in view: **Cancel**, **Download CSV**, and **Add to
  dashboard** (or **Save changes** when editing).
- **Phones:** the same parts stacked (controls, then preview), with the bar pinned.

### The date control: option C (the user, from `date-control.html`; settles DEFERRED's open decision)

No method switch. One list of presets, grouped:

- **Last:** 24 hours, 7 days, 30 days, 90 days, 12 months (the descriptor-allowed subset of
  ARCHITECTURE's trailing presets; 3 days stays available where a type wants it **(my call)**).
- **To date:** This week, This month, This year.
- **A specific…:** Day…, Week…, Month…, Year… (each opens its own picker).
- **Custom range…** (start and end dates).

The saved shape is unchanged: the three methods (`set`, `to-date`/`trailing`, `custom`) in
`DateRangeSpec`. The resolved dates always show underneath ("Oct 7 – Nov 5, 2026"), with
"moves forward each day" for rolling ranges **(my call)**. Pacific time, weeks start Sunday.
A widget type's `dateMethods` and `span` hide what doesn't apply (a type that needs whole months
hides "Last 7 days"); a range outside `span` can't be chosen, with the reason shown.

### Which datasets appear (my call; revises ARCHITECTURE)

ARCHITECTURE says new datasets appear "without code changes". In practice a dataset needs a
data adapter in the query client and a widget type that accepts it. So the **What** sections
are the catalog's datasets that (1) the query client has an adapter for and (2) at least one
offered widget type's `accepts.datasets` includes. Labels, entry types, units and descriptions
come from the catalog. New entry types inside a listed dataset still appear without code
changes. In this spec that's **Air Quality** and **Air Quality Forecasts** (catalog id
`forecasts`).

- **`accepts.datasets` is explicit** **(my call, after the builder check)**: Chart and Data
  table declare `["air-quality", "forecasts"]`. A type with no list accepts no datasets (so a
  new type can't accidentally offer everything); Notes declares none.
- **The adapter decides fit**, not the catalog's `geographies`: an adapter says whether it can
  serve a layer for the main layer's places (the forecasts adapter takes monitors and regions
  and lets the server map them to a zone). Specs 4 and 5 add types by declaring `accepts`; a
  new dataset needs an adapter and a type that lists it.

Within a section, a dataset's entry types that no offered type can show are left out; a
`retired` or `available: false` entry type isn't offered for new picks (an existing widget
that uses one keeps showing it, with spec 1's retired states).

### Layers (the user)

- **At most one pollutant layer** per widget (by the catalog's `kind`), plus **overlays**.
- **The main layer** (the first, which sets the chart's value axis) is an Air Quality
  pollutant in this spec, as spec 1's Chart and Table show, and **it's required**: the Air
  Quality section is a single required choice, and overlays can't stand alone **(my call,
  after the builder check)**. A widget or CSV of only an overlay (say, no-burn days alone)
  is deferred (see "Deferrals"). Air monitors' temperature and humidity wait for the weather
  summaries (they're raw-only today).
- **The overlay this spec ships:** Air Quality Forecasts: **burn status** and **AQI forecast**,
  one value per Pacific day, from `forecasts/place/` (SDK `getForecastForPlace`), which already
  maps a region or monitor to its forecast zone. On the Chart both show as **labeled day
  bands** behind the line, with levels, labels and colors from `forecasts/meta/` scales
  **(my call)**. In the Table they're columns.
- **Up to two overlays** per widget **(my call; for readability)**.
- **The chart doesn't claim a link.** The legend names each layer ("No-burn days in Fresno
  County"); no correlation wording.

### Several places with overlays (the user)

- **Where** is shared: the main layer holds the places (spec 2's `place` or `selection`).
  **Overlay layers store no places of their own**; they always use the main layer's places
  **(my call, after the builder check)**. So "Change place" re-targets every layer at once.
- **The data covers every place.** An overlay is fetched for each of the main layer's places,
  with one request per distinct source (places in the same forecast zone share one). The
  **Table** shows a column per place per layer, and the **CSV** has every place's overlay rows,
  so the researcher has every number (the user: "a column per place per layer").
- **"Overlay for" is a Chart display choice only.** When all the places share the overlay's
  source (the same forecast zone today; later the same station or smoke area), the Chart
  shows it once and no choice appears. **When they don't**, an **"Overlay for: [place ▾]"**
  choice picks which place's overlay the Chart draws, and the legend names that place. It's
  saved as a Chart option on the widget (a place ref, validated like any other), not on the
  layer. When that place leaves the widget's places, the Chart falls back to the first place
  **(my call)**.
- One chart row per place is deferred (see "Deferrals").

### Show as (my call)

- **Chart** or **Table** today. Spec 5's calendars and heatmap appear here by registering
  descriptors with `accepts` (no change to this view).
- A type that can't show the current data (too many places, a dataset it doesn't accept, a
  span outside its `span`) is greyed out with a short reason, never hidden silently.
- Switching keeps the data; only the widget type changes.
- The `addable` hook on Chart and Data table goes away: they start here. Notes (and later
  the Map) stay direct adds in "Add widget".

### The preview (the user)

- It starts **large**, for reading. A **"Dashboard size"** switch shows it at the size it
  will land on the dashboard (the type's `defaultSize` in the current grid's column width).
- No drag-to-resize (the dashboard already resizes), so there's no drag needing a keyboard
  alternative.
- It's the real widget component in a view-only frame, so states (loading, "No data", errors,
  retired) look exactly as they will on the dashboard **(my call)**.

### Add to dashboard (the user)

- The button names its target: **"Add to _My dashboard_ ▾"**, defaulting to the dashboard
  you came from, else the last-opened one. The menu lists your other dashboards and **"New
  dashboard"**.
- The widget goes into **the first free spot** (step 2's layout engine), at the type's
  `defaultSize`.
- You're taken to that dashboard with the new widget **briefly highlighted** (respecting
  `prefers-reduced-motion`), and the add is undoable there (one `applyChange`).
- A read-only (shared) dashboard is never a target **(my call)**.
- **The starter and "no dashboards yet"** **(my calls, after the builder check)**:
  - "Add widget" on the starter opens `/dashboards/starter/widgets/new`. Adding is an edit, so
    it makes the personal copy exactly as any other first edit does
    (`src/lib/starter/starter.ts`), and you land on the copy's `/dashboards/:id`.
  - From `/data` with no saved dashboards, the target is the starter (named as it reads in
    the nav), which makes the copy the same way; the menu also offers "New dashboard".

### Edit data (my calls; the user agreed)

- Every data widget's ⋯ menu gains **"Edit data"**, opening the view with that widget's data
  and **Save changes**, which applies one `setWidgetData` change (one undo step), then
  returns to the dashboard.
- **"Choose another"** on a retired dataset or entry type opens Edit data (as spec 1 meant).
  **"Change place"** and **"Choose a place"** keep opening the place picker directly, since
  that's quicker.
- Leaving with unsaved changes (Cancel, Back, a nav link) asks **"Discard changes?"**. Cancel
  returns without saving.
- Editing can change the widget type (Show as) too; the widget keeps its id, position and
  title, and its size is clamped to the new type's `minSize` **(my call)**.

### Routes (my call; follows ARCHITECTURE's routing rules)

```
/data                                          Get data, from the top nav
/dashboards/:id/widgets/new                    Get data, adding to that dashboard (from Add widget)
/dashboards/:id/widgets/:widgetId/edit         Edit data
```

- ARCHITECTURE already reserved the last two; `/data` is the nav entry. **This replaces what
  the brainstorm's playback said** ("`/workspace/data` plus which widget you're editing"), to
  keep ARCHITECTURE's rule that ids only appear inside their own collection.
- The URL holds only where you are. **The draft (layers, places, dates) never goes in the
  URL**, so coordinates never do.
- `/dashboards/:id/widgets` (trimmed) goes to the dashboard. An unknown dashboard or widget id
  shows the not-found page.
- Back and forward move between places, never between edits.
- `routePattern` in `src/lib/errors/scrub.ts` gains the three routes, and a test compares it
  with the router's route keys (settles DEFERRED's "route list duplicates the router's").

### The draft (my call)

- The working draft is kept in memory while you're on the view, and saved through the
  platform adapter (a preference, like "last-opened dashboard") so a reload or a later visit
  starts from it. One draft for `/data` and `…/widgets/new`; Edit data starts from the widget
  each time.
- It's a `WidgetDataConfig` plus the chosen widget type, validated with the same schemas on
  read (drafts are untrusted input); an invalid draft is dropped for the default.
- A point place (your location) in a draft is kept only in this browser, never synced.

### The resolution override: "More options" → "Detail" (my call)

- **Automatic** (spec 1's rule, the default), or **Raw**, **Hourly**, **Daily**, **Monthly**,
  stored on the main layer as `resolution` (already in `LayerSchema`; "Automatic" stores
  nothing).
- Only levels the entry type offers (the catalog's `resolutions`) are listed. A level the
  point budget can't serve for the current range (e.g. raw over a year) is greyed with the
  reason. (Corrected in the final review: the server's 31-day cap is per request, and the
  adapters fetch a month at a time, so no level has a range cap of its own.) A widget type with
  a pinned `resolution` hides the control.
- Collapsed by default; the teacher never needs to open it.

### Download CSV (spec 1, extended)

- Uses spec 1's shared export (`src/lib/data/csv.ts`), generalized to take a
  `WidgetDataConfig` instead of a widget, so the draft downloads with no widget.
- Overlay rows are added in the same long format (their own `entry_type` rows); categorical
  values (burn status, AQI category) get a column for the level label and key **(my call;
  the builder settles the column names)**.
- The same place swap as spec 2 (points become their region for anything that leaves the
  browser as a share).

### Location privacy (spec 2, applied)

"Add to dashboard" and "Save changes" go through `DocumentSession` like every other edit, so
spec 2's `onEdit` guard covers them: on a live-shared dashboard an exact point is saved as its
region unless the owner chose "Share my exact location". The builder confirms this with a test.

### Region names

Place names go through spec 2's `placeLabel`, which switches to the SDK's
`regionDisplayName(region, meta)` ("ZIP 93702") with **`@sjvair/sdk` pinned exactly to
`npm:@jsr/sjvair__sdk@5.0.0-beta.4`** (published 2026-11-05). `regions/meta` fixtures (unit and
e2e) gain the required `name_template`. This is the plan's first task.

### Accessibility (WCAG 2.2 AA)

- **The date list:** a standard listbox/select pattern with grouped options; the "A
  specific…" and custom pickers use standard date inputs with keyboard entry.
- **Dataset sections:** the standard accordion pattern (bits-ui).
- **Show as** and **Dashboard size:** standard radio groups or toggle buttons.
- **The preview:** changes are announced politely ("Showing PM2.5 for Fresno County, last 30
  days"), never per keystroke. The Table is the accessible alternative to the Chart.
- **Day bands:** never color alone: each band has its level label available (legend with
  outlined swatches and a pattern, a band's label on hover and keyboard focus), and the
  Table shows the values.
- **Discard changes?** is a standard alert dialog. Focus goes to the heading on arrival and
  returns sensibly on close.
- Full keyboard use, the design pass's focus ring, 24 px targets.

### Loading

The Get data view is a lazily loaded route: none of its code, nor the picker's, reaches the
initial bundle. A new barrel-imported package used only by lazy code goes in `vite.config.ts`'s
`BARRELED` list. The forecasts adapter loads with the data layer, as the air-quality one does.

## Constraints (project rules that bite here)

- Metadata is the source of truth: datasets, entry types, labels, units, levels, colors, and
  region type names come from `…/meta/` endpoints.
- All UI text through Paraglide messages, no concatenated sentences; all formatting through
  `$lib/format` in Pacific time; never store generated English (titles stay derived).
- New saved fields (overlay layers' places, the draft) are schema-validated with size limits;
  `LAYERS_MAX` (8) already bounds layers.
- Theme tokens only (`token-discipline.test.ts`), shadcn-svelte primitives, Tailwind utilities.
- Browser storage only through the platform adapter.
- Don't work around the SDK: anything missing goes to the coordinator (`data-dashboard-b7`).

## Testing (what must be shown)

- Unit: date preset ↔ `DateRangeSpec` mapping (with `npm run test:unit:tz`), dataset/entry
  filtering by catalog + adapters + `accepts`, overlay place following and shared-source
  detection, override availability, draft validation, CSV with an overlay, `routePattern`
  against the router.
- Browser (Vitest): the view opens filled in; changing each control updates the preview;
  Show as greys with a reason; "Overlay for" appears only for differing zones; Discard
  dialog; axe on the view (desktop `page.viewport(1280, 800)` and a phone width); waits use
  `animationsSettled`.
- The forecasts adapter against fixtures (latest issue per date, zone mapping via the place).
- E2E (fixtures in `e2e/fixtures/api/`): Add to dashboard from `/data` lands highlighted and
  undoes; Edit data → Save changes is one undo step; Download CSV from the draft; a live-shared
  dashboard saves a point as its region.
- A stack check against local `develop`: Fresno County PM2.5 with burn status over a winter
  month (local data has gaps; see the local-data rule).

## Deferrals (added to `DEFERRED.md` in the same change)

- **Overlays waiting on the Get data layers track** (one entry each, naming the track so it
  isn't duplicated): monthly pesticide use (`pesticides/place/`, draft shape received
  2026-11-05), nearest weather station, smoke over a place per day, weather daily summaries
  and SDK weather entry types (which also bring air monitors' temperature and humidity).
  **Revisit when** each final shape and SDK beta lands.
- **Fires near a place / per day, TEMPO, emissions series.** No per-place time series today
  (TEMPO isn't in the SDK; emissions are yearly snapshots). **Revisit when** a widget needs
  them, or the Map widget (fires) is built.
- **An overlay on its own** (a widget or CSV of, say, only no-burn days). This spec needs a
  pollutant main layer. **Revisit when** someone asks for it, or when weather or smoke layers
  land (a temperature-only chart is the likely first case).
- **One chart row per place (small multiples)** for overlays with places in different zones.
  "Overlay for" covers it for now. **Revisit when** users ask to compare overlays across
  places, or with spec 5's chart work.
- Removed from the open decisions: "Date-range method toggle" (settled: one preset list).
- Settled: "The error reports' route list duplicates the router's" (a test now compares them).

## Docs changed with this spec

- `ARCHITECTURE.md` → "Data Explorer (formerly 'Widget Creation view')": rewritten as "Get
  data" for the data-first order, option A layout, the preset list, layers and "Overlay for",
  "Which datasets appear", routes. "Widget-type contract": `addable` removed for data types.
  "Routing, URL state & undo": the route table.
- `TODO.md`/`ROADMAP.md`: step 4's sections only (spec 3 status and the name).
- `DEFERRED.md` as above.

## Left to the builder

- Component structure, file names, and how the draft store is shaped.
- CSV column names for categorical overlay values.
- The exact preset subsets per widget type (within ARCHITECTURE's list and each `span`).
- How day bands draw in the Chart (uPlot hooks or a layer behind the canvas), within the
  accessibility rules above.
- Exact wording of messages (new English strings go to the user for approval with the PR, as
  in spec 2).
