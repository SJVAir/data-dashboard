# Release 1, step 4, spec 3b: Get data layers (weather, smoke, pesticide use)

Status: approved by the user 2026-11-06 (brainstormed the same day). Branch `step-4-spec-3b` from
`origin/step-4`; the PR goes into `step-4` (the user's yes needed to merge).

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.

## Where this sits

Step 4 is seven specs into `step-4`. Specs 1, 2 and 3 are merged into `step-4` (#36, #38, #40).
The user added spec 3b on 2026-11-05, between spec 3 (Get data) and spec 4 (the "now" widgets).
It adds the layers that the **Get data layers** track (sjvair.com #310–#313, sdk-js #51–#54) built
on the server and in the SDK. It extends spec 3's rules ("Layers", "Several places with overlays",
"Which datasets appear", "Accessibility") and doesn't replace them. Its starting brief is
`DEFERRED.md` → "Get data overlays waiting on the 'Get data layers' track".

## Why

Spec 3 can show one pollutant with burn status or the AQI forecast behind it. People asking "why
was the air bad last week?" also want the weather, the smoke, and what was sprayed nearby. Some
want those on their own: a school garden's rainfall, or monthly pesticide use in a county.

## Who it's for (scenarios from the brainstorm; the user: "These all seem very plausible")

- **A teacher after a bad-air week in winter:** PM2.5 at the school's ZIP, with wind speed from
  the nearest station and burn status, to see calm days line up with the spikes.
- **A parent in August:** PM2.5 with smoke density bands ("was that haze smoke?").
- **A summer ozone check:** ozone with the daily high temperature.
- **A researcher in a farm community:** monthly PM2.5 for a county over a few years, with
  pesticide pounds per month, narrowed to one chemical, crop or method.
- **After a storm:** PM2.5 with daily rain totals.
- **On its own:** a garden club's rain and ETo for a season; monthly pesticide pounds for three
  counties over five years, as a chart or a CSV.

## Goals

- Three new datasets in Get data, each with an adapter:
  - **Weather**: CIMIS station summaries.
  - **Wildfire Smoke**: smoke density per day over a place.
  - **Pesticide Use**: monthly and yearly totals per place, with filters.
- **Number overlays** draw in their own strip under the main chart.
- **Number layers can stand alone**, with no pollutant.
- A **weather station choice**.
- **Pesticide filters** at least as many as the Pesticides Explorer's (see "Pesticide use").
- The resolution control is renamed **"Show values"** and gets a "?" help.
- Pin `@sjvair/sdk` to **5.0.0-beta.6** (see "SDK").

## Non-goals

- **Air monitors' temperature and humidity:** they're raw-only on the server. Still deferred.
- **Fires near a place, TEMPO, emissions series.** Still deferred.
- **One chart row per place** (small multiples). Still deferred.
- **A level layer on its own** (smoke days alone, no-burn days alone). It belongs to spec 5's
  day-colored calendar. Deferred.
- **Pesticide breakdowns** ("top chemicals, products or crops here", by method, biggest movers
  between years). These are ranked lists, not time series, so they need a new widget type and a
  server endpoint. Deferred.
- **A school's "within about a mile" pesticide block, and a buffer or radius around a place.**
  The server deferred these (the user, 2026-11-06).
- **Wind direction** (my call; see "Weather").
- The "now" widgets, calendars, the heatmap, Notes, the starter dashboard, and any map code.

## Anti-goals

- **A chart that implies one layer caused another.** No second axis in the same plot, no
  correlation wording, no fitted lines.
- **Wording that blames a data publisher** for delays (the user: no "published months late").
- **Showing a layer by color alone.**
- **Hardcoding** chart kinds, units, precision, labels, filter values, levels or colors. All
  of them come from metadata.
- **Growing the initial bundle** (199.4 KB gzip of the 200 KB soft budget).
- **Breaking sjvair.com's Pesticides Explorer or Facility Emissions Explorer** through server
  changes made for this spec (the user). The server session confirmed the changes stay out of
  the explorers' code paths.

## Decisions

### The new datasets and what they offer

The catalog (`meta/datasets/`) already lists `weather`, `hms-smoke` and `pesticide-use`. Chart
and Data table extend `accepts.datasets` to
`["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"]`. Spec 3's rule stands:
a dataset shows in **What** only if it has an adapter and a widget type accepts it.

- **Weather:** every entry type that has summary levels: temperature, humidity, dew point, wind
  speed, precipitation, ETo, ETr, solar radiation, net radiation, vapor pressure, and soil
  temperature.
- **Wildfire Smoke:** smoke density. It's a level layer (day bands), with levels, labels and
  colors from `hms/meta`.
- **Pesticide Use:** pounds applied, acres treated, and applications. Applications is a new
  catalog entry type from the server.

Labels, units, `display.chart` (bar or line), `display.y_min`, `display.precision` and
`resolutions` all come from the catalog. The server already changed precipitation, ETo and ETr
to `bar`, `y_min: 0`, precision 2 (sjvair.com #314, the user's yes, 2026-11-06).

### Two kinds of layer: level layers and number layers

- **A level layer** has a scale with levels: burn status, AQI forecast, smoke density. It draws
  as spec 3's labeled, patterned day bands behind the main chart, one lane each (spec 3's
  `drawDayBands` already stacks lanes).
- **A number layer** has a value with units: a pollutant, a weather reading or total, or a
  pesticide measure.

Which kind a layer is comes from metadata **(my call, after the builder check)**:

- **Level layers** are non-pollutant entry types whose dataset meta gives them a level scale
  (`MetadataSource.datasetLevels`): burn status, AQI forecast, smoke density.
- **Number layers** are everything else.

**The AQI forecast stays a band**, as spec 3 draws it, although the catalog gives it units and
`display.chart: "bar"`. So spec 3's widgets don't change, and it can't stand alone. The builder
picks the exact metadata test within this rule.

### Number overlays draw in a strip under the chart (option B, the user, from `numeric-overlays.html`)

- **Each number overlay gets its own strip** under the main chart.
  - The strip shares the chart's dates and has its own axis, labeled with the entry type's label
    and units.
  - Nothing is drawn on a second axis inside the main plot. The user: "stacking a line on bars
    just seems a bit confusing".
- **Bars or a line** follows the catalog's `display.chart`. Bars start at `y_min`.
- **Heights (my call):** each strip gets a fixed share of the widget's height, and the main chart
  always keeps at least half. With spec 3's limit of two overlays, that's at most two strips.
- **The legend names every layer and its source:** "Daily rain · CIMIS #80 Fresno State
  (4.2 mi away)", "Pounds applied · Chlorpyrifos · Grapes · ZIP 93702". There's no
  correlation wording.

### A strip can be coarser than the chart (idea 3, the user)

- Pesticide use exists only per month and per year. Under a daily or hourly chart, its strip
  draws **one bar per month spanning that month's days**, labeled "Monthly total".
- **A month only partly in the range** still shows its whole-month total, and is marked as a
  whole-month total. **(my call on the marking; the builder picks how)**
- Smoke stays daily on any chart, hourly included.
- **Strips follow "Show values"** **(my call, after the builder check)**:
  - A number overlay uses the main layer's level when its entry type offers that level.
    Otherwise it uses the nearest coarser level it offers.
  - So the strip, the readout, the Table and the CSV line up with the chart.
  - An overlay's own saved `resolution` is ignored and not written for new layers.
- **An empty pesticide strip** says **"No pesticide use reported for these dates."** with
  nothing more. The user: don't say "published months late".

### A number layer can stand alone (the user)

This settles DEFERRED's "An overlay on its own" for number layers.

- **The main layer** is the widget's pollutant layer if it has one. Otherwise it's the first
  number layer in layer order: a weather reading or total, or a pesticide measure.
  `pollutantLayer` (`src/lib/widgets/shared/input.ts`) already falls back to the first layer.
  The rule just becomes "the first number layer".
- **Air Quality stops being required.** A widget needs at least one number layer. A widget with
  only level layers can't be added or downloaded; the reason shows and points to the calendars
  later. **(my call on the wording; the strings go to the user with the PR)**
- **The other limits stay as spec 3 set them:** at most one pollutant layer, at most two
  overlays. The places live on the main layer, and overlays borrow them.
- **Two number layers and no pollutant** (temperature and rain): the first one picked is the
  main chart, and the second is a strip. **(my call)**

### "Show values" replaces "Detail" (the user)

- **"More options" → "Show values"**, with the options Automatic · Every measurement · Hourly ·
  Daily · Monthly · Yearly.
  - Only the levels the main layer's entry type offers are listed, so pesticides offer only
    Monthly and Yearly.
  - Spec 3's greying for too much data still applies.
- **A "?" toggletip next to it**, the recognized accessible pattern:
  - a real button with a 24 px target and an accessible name ("About Show values");
  - it opens on click, tap or Enter, also shows on hover, closes on Escape or a click outside,
    and its text is announced;
  - built on the existing bits-ui popover. **(my call on the pattern; hover-only tooltips fail
    WCAG 2.2's 1.4.13 and keyboard and touch use)**
- **Draft help text** (final wording to the user with the PR): "Each point on the chart is one
  value. Automatic picks hourly, daily or monthly values to suit the dates you chose. Choose
  another to see every measurement or a smoother picture. Also called data resolution."
- **The same "?" pattern serves the layers' notes** below (smoke, pesticide yearly totals).

### Weather

- **The station (option 2, the user):**
  - **The default is the first station** `getWeatherStationsForPlace` lists. The server lists
    stations inside the place first, nearest the region's point-on-surface first, then up to
    five within 25 miles of its edge, nearest first. For Fresno County that's #80 Fresno State,
    and for ZIP 93702 it's Fresno State, 4.2 mi away.
  - **"Station: [name ▾]"** in the Weather section lists the server's stations: inside ones
    first, then nearby ones with their miles. Picking one saves it on the layer as an optional
    override (a monitor id).
  - **Inactive stations stay listed.** A station whose `is_active` is false is shown with a quiet
    "may be behind" note. **(my call)**
  - **One station for the whole Weather section (the user, 2026-11-06):** every weather layer in
    the widget (temperature and rain, say) uses the same station. It's saved the same way on each
    weather layer, so the layers stay self-contained, and the builder keeps them in step.
  - **Several places (my call):** each place uses its own default station, and the station
    choice shows only when the widget has one place. "Overlay for" still picks which place's
    strip the Chart draws. Spec 3's `sharedSource` already hides "Overlay for" when every place
    gets the same station's data.
  - **Changing the place drops the override (my call):** it was chosen for the old place.
  - **Schools and "my location"** use the stations of the region they fall back to (ZIP, then
    city, then county; spec 2's `placeRegion`), so no coordinates leave the browser.
- **The data:** monitor summaries for the station, one station per request (bulk summaries are
  air-quality only).
  - **Totals:** precipitation, ETo and ETr use the summary's `sum`; the other types use `mean`.
    Which field to read comes from the summary, not a hardcoded list: a row with `sum` is a total.
    **(my call; the builder confirms against beta.6's schema)**
  - **Open periods:** server summaries cover only finished periods, so the open month or year is
    built from finer rows (spec 1's `planSegments`), `sum` totals included.
  - **Partial periods:** a period is partial when `count` is short of the hours in it, and marked
    as spec 1 marks partial points. **(my call)**
  - **Late settling:** summaries settle late (CIMIS revises yesterday each morning). Spec 1's
    live-refresh rules already refetch recent periods.
  - **Timestamps:** raw CIMIS readings are stamped at the start of their hour in fixed PST, and
    the dashboard formats everything in Pacific time through `$lib/format`.
  - **Dew point and soil temperature** raw rows carry `*_f`/`*_c` fields, not `value`, so read
    the °F field when "Every measurement" is chosen. The catalog's unit is °F.
- **Wind direction is left out (my call):** it's raw-only, and a compass bearing drawn as a line
  jumps between 359° and 0°. Weather entry types with no summary levels aren't offered. That's a
  rule from the catalog, not a hardcoded id. Deferred.

### Wildfire Smoke

- **The data:** `getSmokeForPlace(place, {gte, lte})`, one row per day with no gaps, at most 366
  days per request, so longer ranges go out in chunks. Density keys match `hms/meta`'s
  smoke-density scale. A `null` density means no band.
- **Several places:** one request per place. `sharedSource` hides "Overlay for" when the days
  match.
- **The caveat, in the layer's "?" (the user):** "Days without a band had no smoke detected. A
  missed satellite pass looks the same." Locally, false clear days are expected (the local data
  rule).
- **Smoke works only as an overlay** in this spec (level layer).

### Pesticide use

- **The data:** `getPesticidesForPlace(place, filters)`.
  - **Two levels:** `months` (only months with use) at Monthly, `years` at Yearly. A month
    missing from `months` is zero inside the dataset's coverage
    (`meta/coverage/?dataset=pesticide-use`, locally 2018-01-01 to 2023-12-31), and has no data
    outside it. Both show "No pesticide use reported for these dates." when the whole range is
    empty. **(my call)**
  - **Undated records:** a year's totals include records with no month, so a yearly total can
    exceed the sum of its months. The Yearly view and the CSV use the server's year totals, and
    the layer's "?" says so. **(my call)**
  - **Places:** pesticide use is per region. A monitor counts through its ZIP (server side). A
    school or "my location" uses its ZIP, then city, then county (spec 2's `placeRegion`; the
    user, 2026-11-06), and the legend names that area so it never reads as "at the school".
- **Filters belong to each layer (the user, 2026-11-06, after the builder check).**
  - Each pesticide layer has its own "Narrow down", and the section has an **"Add another
    pesticide layer"** button. So one chart and one CSV can hold "all pesticides" and
    "carcinogens only" side by side.
  - Each layer shows a short summary line of its filters ("Carcinogens · Grapes"), so it's always
    clear which layer a "Narrow down" area edits.
  - This changes spec 3's What sections, where an entry type is a single checkbox: a pesticide
    entry type can appear in more than one layer, each with different filters.
  - The two-overlay limit still applies. A chart can be "all pesticides" as the main bars plus
    "carcinogens" as a strip, or PM2.5 with two different pesticide strips.
- **Filters (the user: researchers need them; at least the explorer's ways to filter).** They
  are saved on the layer and combine:
  - **Chemical, Crop (commodity) and Product:** searchable pickers over the server's lists, by
    our own ids. Placeholder chemicals ("unknown", "confidential") are left out of the chemical
    picker; their pounds stay in totals (server decision, the user, 2026-11-06).
  - **Category:** several at once (any of them).
  - **Cancer group (IARC):** one.
  - **Method:** Ground / Air / Field fumigation / Other / Not reported (the explorer's wording, in
    `pesticides/meta/`).
  - **Narrow to:** chemicals of concern / restricted / fumigant / aerial, one at a time.
  - **Years:** none of its own. The widget's date range sets `year__gte`/`year__lte`.
  - **All labels and descriptions** come from `pesticides/meta/`. Category values with
    `in_use: false` aren't offered.
  - The legend and the Data table header name the active filters. **(my call)**
  - **Two pesticide layers with different filters** (all use and carcinogens) count as two
    layers under spec 3's limits.
- **A saved filter id that no longer exists** (a chemical merged or removed) shows spec 1's
  retired state for that layer: "no longer available", with "Choose another" opening Edit data.
  It depends on the server telling a missing id from a bad request (asked for; see "SDK").
- **No "published late" wording anywhere** (the user).

### Overlays carry their own settings

Spec 3's `overlayInput` copies only `dataset`, `entryType` and `resolution` from an overlay. A
weather overlay's station and a pesticide overlay's filters must reach its fetch too, and its
cache key. They still never carry places: places stay on the main layer.

### Saved shape (my call; the builder settles the exact fields)

- **`LayerSchema` gains optional, schema-validated, size-limited fields:**
  - a weather station override: a monitor id, `SafeIdSchema`;
  - pesticide filters: chemical, commodity and product ids, categories (at most about ten),
    IARC group, method, and narrow. Each is a bounded string checked against `pesticides/meta/`
    keys where they're enumerable.
- **Unknown keys are dropped** on read, like the rest of the document.
- **The Map widget session and the coordinator are told the final shape** once the plan fixes
  it.

### Several places

Spec 3's rules apply unchanged. Each place gets its own weather station, smoke series and
pesticide totals. The Table has a column per place per layer, the CSV has every place's rows, and
the Chart's "Overlay for" picks which place's strips and bands it draws.

### Table and CSV

- **Data table:** a column per place per layer, as in spec 3. Totals and readings show with the
  catalog's precision and units.
- **CSV (spec 1's long format, extended):**
  - each new layer's rows, with its `entry_type`;
  - weather rows: the station's id and name;
  - pesticide rows: the active filters;
  - a whole-month total under a daily view, marked as such.
  - The column names are the builder's call, as in spec 3.

### SDK (changes the brief: beta.6, not beta.5)

- The brief said to pin beta.5. The pesticide filter work the user approved on 2026-11-06 ships
  in **`@sjvair/sdk` 5.0.0-beta.6**, so the spec branch's first code commit pins exactly
  `"npm:@jsr/sjvair__sdk@5.0.0-beta.6"`. Publishing it needs the user's yes, in the SDK session.
- **Final signatures** (the user approved the SDK spec 2026-11-07: sdk-js
  `docs/superpowers/specs/2026-11-07-pesticide-place-filters-design.md`; server: sjvair.com #316,
  merged into `develop` and live on the local stack):
  - `getPesticidesForPlace(place, filters, options)` with `PesticidesForPlaceFilters`:
    - `chemical`, `commodity`, `product`: strings, our ids (CDPR codes are refused);
    - `category: string | string[]` (any of them);
    - `narrow: PesticideNarrow` (`"concern" | "restricted" | "fumigant" | "aerial"`, one);
    - `iarc_group: IARCGroup`;
    - `aerial_ground: AerialGroundFilter` (`"A" | "F" | "G" | "O" | "none"`);
    - `year__gte`, `year__lte`: numbers.
  - **`pesticidePlaceFilterErrors(error)`** gives the first error code per field, or `undefined`
    for anything else. **`not_found` on `chemical`, `commodity` or `product`** is what triggers
    the layer's "no longer available" state.
  - **`getPesticidesMeta()`** returns:
    - categories `{key, label, description, in_use}`: offer only `in_use`;
    - iarc_groups, methods (`AerialGroundFilter` keys: Ground / Air / Field fumigation / Other /
      Not reported) and narrows, each with labels, and descriptions where given;
    - placeholder_chemicals.
  - **`searchPesticides({type, q, limit?, year?, county?, narrow?, signal?})`** returns
    `{results, more}` for the pickers:
    - `type` is `"chemical" | "product" | "commodity"`;
    - each hit is `{id, name, detail}`, plus `placeholder` on chemical hits (left out of the
      picker);
    - a `q` under 2 characters gives an empty result with no request;
    - one page only, at most 25 results.
  - **`display_name` labels** saved filters (the legend and the Data table header) for all three
    kinds. It's on chemical rows already, and on commodity and product rows through a sjvair.com
    PR still open on 2026-11-07.
  - **The catalog** has `applications` (units "applications", `display` bar, `y_min` 0,
    precision 0), and both pesticide datasets' `meta_url` points to `pesticides/meta/`.
- **Pin:** exactly `"npm:@jsr/sjvair__sdk@5.0.0-beta.6"` once it's published. Fixtures (unit and
  e2e) gain the new shapes. Check beta.5 and beta.6's schemas for fixture changes elsewhere too.
- Nothing works around the SDK. Anything missing goes to the coordinator.

### Loading

- **The new adapters load with the data layer**, which is already lazy (`getQueryClient`).
- **The pickers, the toggletip and the strip drawing** load with the Get data route or the Chart
  module.
- **Nothing new reaches the initial bundle.** A new barrel-imported package used only by lazy code
  goes in `vite.config.ts`'s `BARRELED` list, which is fragile (see DEFERRED).

## Accessibility (WCAG 2.2 AA)

- **Strips:**
  - each has its own visible axis label with units, and a legend entry with an outlined swatch
    and the mark's shape (bar or line);
  - the chart's existing keyboard and hover readout includes every strip's value at that time;
  - the Data table stays the accessible alternative.
- **Smoke bands:** spec 3's rules (label, pattern, readout).
- **Toggletips:** see "Show values".
- **Pickers:**
  - the chemical, crop and product search is a standard combobox (the place picker's pattern);
  - Category is a checkbox group;
  - the other filters are standard selects.
- **Never color alone:** a strip's marks keep the theme's series styling plus the legend shape,
  and level bands keep their labels and patterns.

## Constraints (project rules that bite here)

- **Metadata is the source of truth:** chart kind, units, precision, `y_min`, levels, colors,
  filter labels, and which entry types have summaries.
- **Text and dates:** all UI text through Paraglide messages, no concatenated sentences. All
  formatting through `$lib/format`, in Pacific time.
- **Saved fields:** new saved fields are schema-validated with size limits.
- **Styling:** theme tokens only (`token-discipline.test.ts`), shadcn-svelte and bits-ui
  primitives, Tailwind utilities.
- **Shared local stack:** message the coordinator before any restart, rebuild or backfill.

## Testing (what must be shown)

- **Unit:**
  - level versus number layer from metadata;
  - the main-layer rule (pollutant, else the first number layer; level-only refused);
  - `overlayInput` carrying the station and filters;
  - the weather adapter: station default and override, `sum` versus `mean`, partial from
    `count`, the open month built from finer rows, and summary-less types left out;
  - the smoke adapter: 366-day chunks, `null` density;
  - the pesticide adapter: months, years with undated records, filters on the wire, whole-month
    bars under a daily range, and a gone id giving the retired state;
  - the CSV with each new layer;
  - the layer schema's limits;
  - all with `npm run test:unit:tz` where dates matter.
- **Browser (Vitest):**
  - a strip under the chart with its axis label;
  - bars versus a line from `display.chart`;
  - the main chart keeps at least half the height;
  - the station choice shows only for one place;
  - the "?" toggletip opens by keyboard and closes on Escape;
  - a temperature-only chart;
  - axe on the view at `page.viewport(1280, 800)` and a phone width;
  - waits use `animationsSettled`, and lazy routes preload their module.
- **E2E (fixtures):** add a weather overlay and a pesticide overlay with a filter, a weather-only
  widget, and a CSV download with the new rows.
- **Stack check against local `develop`:**
  - Fresno County PM2.5 with Fresno State temperature and smoke over a recent month;
  - Fresno County pesticide pounds narrowed to one chemical over 2022–2023;
  - expect local gaps (the local data rule).

## Deferrals (added to `DEFERRED.md` in the same change)

- **Move out of "Get data overlays waiting…":** the four layers, when they ship.
- **Update "An overlay on its own":**
  - number layers are done;
  - level layers alone (smoke days, no-burn days) wait for spec 5's day-colored calendar;
  - **revisit with** spec 5.
- **Wind direction in Get data:** raw-only, and circular. **Revisit if** the server summarizes it
  (a prevailing direction), or someone asks for a wind rose.
- **Pesticide breakdowns** ("top chemicals, products or crops here", by method, biggest movers):
  a ranked-list widget plus a server breakdown endpoint. **Revisit when** a later step adds
  ranked-list widgets, or users ask.
- **The school "within about a mile" pesticide block, and buffer or radius:** server-side
  deferrals. The coordinator records them. The dashboard side (a school uses its ZIP, then city,
  then county) **revisits when** the server adds a location place.
- **A neutral note on when pesticide data is released,** in the dataset's catalog description
  (server text), offered and not taken. **Revisit if** people ask why recent months are empty.
- **Choosing a weather station per place** (with several places) **or per layer** (rain from two
  stations): one station per Weather section, and the choice shows only for one place. **Revisit
  if** researchers ask to compare stations.

## Docs changed with this spec

- `ARCHITECTURE.md`:
  - "Get data": number layers stand alone, strips, "Show values", the station choice, and the
    pesticide filters;
  - "Widget catalog" → "Widget-type contract": `accepts.datasets`;
  - "Data resolution & live refresh": coarser strips, weather totals.
- `TODO.md`/`ROADMAP.md`: step 4's sections only (spec 3b's status, beta.6).
- `DEFERRED.md` as above.

## Left to the builder

- **Code shape:** component structure, file names, the strip drawing (uPlot series on extra
  scales in stacked panes, or separate synced plots), and the exact layer fields.
- **Small calls:** the exact test for level versus number layers (from metadata), the CSV column
  names, how a whole-month bar is marked, and the toggletip's component.
- **Wording:** every message. New English strings go to the user with the PR.
