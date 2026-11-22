# Release 1, step 5, spec 7: the Data Portal's What, monitors in Air quality, schools and child care

_Brainstormed and decided with the user 2026-11-21 (session on branch `step-5-spec-7`, from
`origin/step-5` at `ec5e2da`). Split into three parts, each its own plan and PR into `step-5`:
**7a** (this document in full), **7b** and **7c** (their decisions recorded here so they aren't
lost; each gets its own plan, and its own brainstorm only for what is still open)._

## Intent

The Data Portal (code: the "Get data view", `src/lib/get-data/`) is one screen for every widget
type. The user's rule for it (2026-11-21):

> **What is the data. When and Where are filters for it.** With no Where, a widget shows
> everything its What asks for. This holds for every data set, not only air quality.

Today the code doesn't follow that rule:

- Monitors are _places_: Where's picker offers them beside areas (`places/directory.ts:111`),
  several picks must be all monitors or all areas (`places/selection.ts:30-31`), and they are
  saved as `PlaceRef` kind `monitor` / `SpatialSelection` kind `monitors`
  (`data/schema.ts:64`, :89).
- Where is shown only once there's a main layer (`GetDataView.svelte:1019`), and a Chart or
  Table with no place asks for nothing (`widgets/shared/input.ts:150`, :159).
- Places live on one layer and move between layers (`keepingPlaces`, `get-data/layers.ts:52`).
- What has two bodies: the Map's `MapSections.svelte` (up to four pollutants as checkboxes, the
  last one locked) and everyone else's `WhatSections.svelte` (radios, with None blocked when no
  other number layer is left, :83).

This spec makes What the data (monitors included), Where and When the filters, and one What for
every type.

**Audience:** parents, teachers and students, researchers, agencies such as CARB. Copy serves all
of them.

## Decisions (the user, 2026-11-21; not to be reopened)

### The model

1. **What is the data; When and Where filter it.** No Where means everywhere, for every data set.
2. **Where holds areas, schools, addresses and "my location"** (unchanged), never monitors. A
   school, address or point has no data of its own; it stands for the areas it sits in (ZIP code,
   then city, then county, the order used today: `FALLBACK_TYPES`, `data/adapters/places.ts:11`;
   `layerTarget`, `data/adapters/targets.ts:79-97`).
   - **A Chart or Table's Where offers areas only** (counties, school districts and so on): "no
     reason to have them [schools, addresses, my location] open in charts or tables" (the user).
   - The Map and the single-place widgets keep schools, addresses and "my location" in Where.
3. **Where and monitors are saved in new places** (the user chose approach A, see Approaches):
   - `WidgetDataConfig` gets `place` / `selection` (areas, schools, points; never monitors),
     beside `dateRange`. A layer no longer holds places.
   - The air-quality layer gets `monitors` (ids picked by search) and `monitorTypes` (ticked
     monitor types).
   - `PlaceRef` kind `monitor` and `SpatialSelection` kind `monitors` are removed. Nothing is
     live, so there is no migration (`CLAUDE.md`, "Shapes are free before release").

### The Air quality section

4. **One pollutant control for every type: radios with None** (`( ) None (•) PM2.5 ( ) Ozone`).
   **None is never blocked.** The list is the catalog's available air-quality pollutants (today
   PM2.5 and ozone locally: `meta/datasets/` lists CO, NO2, PM10, SO2 and others as
   `available: false`), and the Map's are its `available_pollutants`. It grows when the server
   turns more on. Exception: Current conditions (7b).
5. **The Map holds one pollutant or none.** `MAP_POLLUTANTS_MAX` and the several-pollutant
   handling go. The Map's `showing` option (`widgets/map/options.ts:32`) is removed. The
   toolbar needs no change: it shows its pollutant group only with two or more pollutants and
   its monitor-type group only with two or more types (`groupsShown`, `toolbar/values.ts:136-137`).
6. **A pollutant is optional.** It is required only once monitors are added (a type ticked or a
   monitor picked). A widget may hold only pesticide data, only a region fill, and so on.
7. **Monitors, inside Air quality,** have two parts that work together:
   - **A checkbox per monitor type, in two groups,** "Reference-grade" and "Low-cost sensors", laid
     out the way monitor-map lays out its monitor options. Groups come from the monitors meta's
     `monitor_groups` sorted by `order`, and each type's group from its `group` key
     (`metadata.monitorGroups()` and `monitorTypes()`, `data/metadata.ts:190-195`, :494). Labels
     come from the meta, never hardcoded. A type with no group (`group: null`) still gets a
     checkbox, in a group of its own after the others (my call).
   - **A Monitors search**, the same search as Where's place picker but offering only monitors
     (of a type that supplies the chosen pollutant). The chosen monitors are listed the way Where
     lists its chosen places, each removable.
   - The type checkboxes are shortcuts ("all reference-grade monitors in my county", "just
     AirGradient") so people don't add monitors one by one.
   - **A ticked type counts only inside Where's areas**; with no Where, every monitor of that
     type. **Searched monitors count wherever they are**, inside the areas or not.
   - **An unticked type means "not shown"** (the user chose option 1): there is no "nothing ticked
     means everything" case on any widget type.
8. **New widgets' starting ticks:** a new Map starts with **every** monitor type ticked (so it
   looks the way a Map does today). A new Chart or Table starts with **none** ticked. Converting
   between types through Show as keeps the ticks the draft has.

### What a widget draws

9. **Chart and Table:**
   - With monitors (ticked types or searched): one line (Table: one column) per monitor. Where's
     areas only narrow which monitors.
   - With areas and no monitors: one line per area (the area's figure, as today).
   - With no Where and no monitors: nothing to draw yet; the preview says what to add ("Add an
     area, or tick monitor types": final copy is the builder's, through Paraglide).
   - **No cap on lines or columns** (the user: "It's not our job to make sure a user's chart isn't
     cluttered"; a Table is "just a CSV and users can scroll"). `maxPlaces` (5 and 10) goes for
     both, for areas too.
   - **Line styles go further:** each line gets its own combination of colour, dash and marker
     (5 colours × 5 dashes × 5 markers = 125 before any repeat), replacing `i % 5`
     (`charts/series.ts:6-26`). Colour is never the only cue. The key and the hover readout name
     every line.
10. **The Map:** draws the monitors its Air quality section asks for: the ticked types inside
    Where (every monitor of those types with no Where) plus the searched monitors. With no
    monitors it draws none; an area's colour comes from "Fill regions by" if chosen. The
    toolbar's own monitor-type switches stay as a view filter over what the Data Portal asked for.
11. **Single-place widgets** (Current conditions, "Can we go outside?", the Forecast strip, the
    calendars) take **either** one place in Where (an area, school, address or "my location")
    **or** one monitor from the Air quality search, not both. "Keep it" (the user): a nearby
    sensor is often what people trust. Show as still greys them out, with its reason, when the
    draft has more than one place or monitor (`offer.ts:103-106`).
12. **The selection limit goes.** `LIMITS.SELECTION_MAX` (500, `data/schema.ts:9`) is removed. Any
    incoming document is already capped at 1,000,000 characters (`MAX_DOCUMENT_CHARS`,
    `sharing/envelope.ts:7`), which is the size check the security baseline needs.

### No Where for the other data sets (the user, 2026-11-21)

12a. **Weather with no Where draws every station**, one line each (a station is a sensor at a
    point, like a monitor). With an area it is the area's line from its station, as today
    (`stationChoice`, `data/adapters/weather.ts:121-124`). Today the dashboard refuses weather with
    no place (`weather.ts:166-169`). Listing every station and fetching their figures in bulk was
    sent to the server session as a check (the dashboard has only `getWeatherStationsForPlace`,
    `weather.ts:38-42`); if it doesn't exist, it is a server and SDK ask.
12b. **Pesticide use with no Where draws the valley-wide total.** Today both the dashboard
    (`data/adapters/pesticides.ts:304`) and the server refuse it (`pesticides/place/`'s shared
    `resolve_place`, 400 "Give a region (region_type and region) or a monitor.",
    `camp/apps/regions/resolve.py:54-55`, added 2026-11-03 in `ddeb67a9` for this project's own
    work). Sent to the coordinator as a server change (2026-11-21).
12c. **7a's PR waits for `@sjvair/sdk` `5.0.0-beta.16`** (the user accepted the coordinator's
    recommendation): it carries the bulk type filter (decision 20) and, ideally, the valley-wide
    pesticide total and whatever weather needs. 7a builds toward the real parameters. A filter
    done in the dashboard may be used while developing, but never merges.

### "Show in a chart / table" (6b) once monitors aren't places

13. **The Map's marked monitors arrive as the Chart's or Table's searched monitors,** with the
    Map's pollutant, its Where, and its range and resolution (6b's decision 19 stays). With no
    cap, 6b's "choose which to keep" dialog has nothing to do: it is removed from the hand-off and
    from Show as (`keepsOnSwitch`, `offer.ts:87`; `WhereControl`'s keep mode).
14. The pinned section card's "Show in a chart" (6b decision 1) is unchanged: its township is a
    Where area (`sendPlaces`, `widgets/map/show-in.ts:34-35`).

### Layout

15. **What comes first** in the left column, then When, then Where, then Data resolution and More
    options. Show as and the preview stay on the right.

    ```
    ┌ left column (scrolls) ───────────────┐ ┌ right (stays) ────────┐
    │ What                                  │ │ Show as [Map|Chart…]  │
    │  ▸ Air quality      PM2.5 · 2 types   │ │                       │
    │     ( ) None (•) PM2.5 ( ) Ozone      │ │   preview             │
    │     Monitors                          │ │                       │
    │      Reference-grade [ ]AirNow …      │ │                       │
    │      Low-cost        [x]PurpleAir …   │ │                       │
    │      Hwy 41 (AirNow)  ×               │ │                       │
    │      [Add monitors]                   │ │                       │
    │  ▸ Smoke and fire                     │ │                       │
    │  ▸ Spray notices                      │ │                       │
    │  ▸ Pesticide use                      │ │                       │
    │  ▸ Weather                            │ │                       │
    │  ▸ Fill regions by                    │ │                       │
    │  ▸ Schools and child care   (7c)      │ │                       │
    │ When   Last 30 days        [Change]   │ │                       │
    │ Where  Everywhere          [Change]   │ │                       │
    │ Data resolution · More options        │ │                       │
    └───────────────────────────────────────┘ └───────────────────────┘
    ```

16. **One What for every type.** `MapSections.svelte` and `WhatSections.svelte` become one list of
    sections. Each type shows the sections its `accepts.datasets` (and the Map's own sections)
    allow, in catalog order. What a type can't show is greyed out with its reason, never hidden.
17. **Where is always shown**; empty reads as "Everywhere" (copy is the builder's).
18. **The left column scrolls on its own and the preview stays in view** on the two-column layout
    (`md:` and up; the grid at `GetDataView.svelte:982`). The view fills the screen height, the
    action bar stays at the bottom, and the scroll region uses `scrollFocusable`
    (`components/shared/scroll-focusable.ts`). On a phone the columns stack and the page scrolls as
    now.

### Fetching

19. **Monitors of a type inside areas are fetched in bulk:** one bulk monitor-summaries request
    per period scoped by `region` (`@sjvair/sdk` `5.0.0-beta.15`'s
    `MonitorSummaryBulkRequestConfig.region`, `lib/monitors/get_monitor_summaries_bulk.ts:70`),
    then kept by type. No Where: one valley-wide bulk request. Searched monitors outside the areas
    are still fetched one by one (today's path, `data/adapters/air-quality.ts:210-222`).
20. **A monitor-type filter on the bulk endpoints** is asked of the server and SDK (the user;
    sent to the coordinator 2026-11-21; the coordinator passed it to the server session, every
    resolution plus open days, several types per request). The request carries the types. Decided
    server-side with the user: `type`, repeatable, the monitors meta's `monitors[*]` keys
    (`?type=purpleair&type=airnow`); an unknown type is a 400; it combines with `region`, `bbox`
    and `processor`. The SDK option comes in `@sjvair/sdk` `5.0.0-beta.16` (see 12c). CIMIS
    stations are monitors on the server, so bulk summaries with `type=cimis` may answer "every
    station" (12a); the server session is checking.

## 7b: Current conditions as an overview (decided; its own plan)

21. **Current conditions takes one or more pollutants:** its Air quality section shows
    checkboxes, not radios. The card shows each pollutant's level. The alert level is set per
    pollutant (each pollutant's scale has its own levels: `keptThreshold`, `get-data/now.ts:98`).
22. **"Can we go outside?" offers the pollutants whose monitors meta has `school_guidelines`**:
    PM2.5 alone today (checked locally: `pm25` set, `o3` and every other entry empty), so no
    choice is shown yet. Its code no longer forces PM2.5 by name (`asPm25`, `outside/pm25.ts:7`);
    the choice appears without code changes when the server adds guidelines.
23. **Show as from Current conditions to a one-pollutant type** keeps the first pollutant and notes
    the others were left out (the conversions' `dropped` notes).

## 7c: schools and child care on the Map (decided; its own plan)

24. **A "Schools and child care" section in What**, offered only for the Map (they're points with
    no readings). Kept in What, not under Where (the user, 2026-11-21): it follows the rule (What is
    shown; Where narrows it), it's offered only where it draws, and Where already picks a school
    as a place.
25. **A checkbox per location type** from the regions meta's `location_types` (locally: Public
    school, Private school, Child care), labels from the meta. map-sdk's `schoolsPlugin` takes a
    `types` allow-list (checked in `../map-sdk`'s working copy; confirm against the pinned
    `@sjvair/map-sdk` `0.1.0-beta.22`).
26. **Where filters them:** one `getPesticideLocations({ region })` per area (`buffer` not used).
    No Where: the whole valley in one call (the earlier check: 2,747 sites, about 191 KB
    uncompressed). A school, address or point in Where loads the area its data uses (ZIP code
    first).
27. **Not markable, no "Show in a chart / table", each gets its card.** The schools preset is
    already `selectable: false`. Hover cards are static; interactive only pinned or focused.
28. **The focus school:** one badge with the focus ring around it and one list row (the lean
    recorded in `DEFERRED.md` → "The focus school drawn twice").
29. **Show as from a Map with schools** drops them with a note, the way a region fill is dropped
    (`mapShowingOnly`, `get-data/map.ts:427`).

## Approaches (the data shape; the user chose A)

- **A. Where on the widget's data, monitors on the air-quality layer (chosen).** Matches the rule
  exactly: When and Where are widget-wide filters; monitors belong to Air quality, which needs its
  pollutant. A pesticide-only or notices-only widget has a Where with no trick. `keepingPlaces`,
  `placesLayer` and the "who holds the places" logic go. Most change up front, but nothing is live.
- **B. Places stay on the main layer; monitors added to it.** Less code changed, but a widget with
  no pollutant still needs a layer to hold its Where, and the juggling between layers stays (the
  root of "Where only shows with a main layer").
- **C. Monitors as their own layer.** Makes "a pollutant is required once monitors are added" a
  rule between two layers, and uses one of the eight layer slots.

## Goals (7a)

- One What for every widget type, What first, with the Air quality section as decided.
- Monitors only in Air quality; Where only areas, schools, addresses and points (areas only for a
  Chart or Table); no Where means everywhere.
- Every widget type working on the new shape: Chart, Table, Map, Current conditions, "Can we go
  outside?", the Forecast strip, the calendars, Notes untouched.
- Show in (6b) sending monitors; no caps; the keep dialog gone; line styles that go to 125.
- Bulk fetching by area for ticked types.

## Non-goals

- Schools and child care as a data set (7c). Several pollutants on Current conditions (7b).
- Comparing two datasets (`DEFERRED.md`; raised with the user at the end of spec 7).
- Any change to map-sdk, monitor-map, mobile, sdk-js or sjvair.com from this repo. The bulk
  type filter goes through the coordinator.
- The Map's toolbar (no change needed, decision 5).

## Anti-goals

- A checkbox that means "everything" when empty, on any type.
- A cap or a "choose which to keep" step on a Chart's lines or a Table's columns.
- Monitors offered in Where, or schools and points offered in a Chart's or Table's Where.
- Hardcoded group, type, pollutant or location-type labels.
- A stop-gap What between 7a, 7b and 7c: 7a builds the final What; 7b and 7c add to it.

## Constraints

- **Build straight to the final design; keep tests green, every widget working, saved documents
  opening without errors between specs** (`CLAUDE.md`, "Repo workflow"). The schema change lands
  with every consumer in 7a.
- **Strict option schemas:** `MapOptionsSchema` is a `z.strictObject` (`map/options.ts:30`);
  removing `showing` must not make documents fail. Check `widgetOptionsValid`
  (`documents/schema.ts:39`) and fixtures.
- **The Map's fallbacks are drawn, not saved**; never reset a person's choice silently.
- **Metadata is the source of truth** for groups, types, labels, pollutants.
- **The new widget type checklist** applies to the place change: `sharing/points.ts` (a point in
  Where is swapped for its region on share, now on `WidgetDataConfig`), `PlacePickerDialog`'s
  `regionOf` (:279, :355), and the Data Portal's type switches (`now.ts`, `map.ts`, the "left out"
  notes).
- **Pins:** `@sjvair/sdk` `5.0.0-beta.15`, `@sjvair/map-sdk` `0.1.0-beta.22`, both exact. Newer
  only through the coordinator.
- **Bundle:** report the initial bundle (213.7 KB after 6b; soft budget 250 KB).

## Early tasks (7a plan, first)

- **Type-check `e2e/` in `npm run check`** and fix its errors (`e2e/map.spec.ts` had 22 on
  2026-11-20). `DEFERRED.md` → "`npm run check` doesn't type-check `e2e/`" (the user's call: early
  in spec 7). The E2E fake server copies server shapes, so it must be checked before the shapes
  change.
- **Three timing-based browser tests that flake in CI** (arranging keyboard resize, time-chart
  resize redraw, time-chart keyboard stepping): make them wait for the animation or state.
  `DEFERRED.md` → "CI and dependency loose ends".

## `DEFERRED.md` entries this spec touches

- **"Comparing mixed kinds of place in one widget"**: rewritten. Monitors and areas now combine
  (areas filter, monitors listed); schools and points stay single and Map/single-place only.
  What's left is a school or point beside other places.
- **"Per-monitor pollutant coverage in the place picker"**: now about the Monitors search (offered
  by type, so a monitor that doesn't measure the pollutant can still be picked). Kept, reworded.
- **"Schools and child care as a Map data set"**, "The focus school drawn twice", "map-sdk: a focus
  point under a school, edge cases", "map-sdk: schools' count bubbles, small gaps", "map-sdk: no
  schools store (`createSchoolsStore`)", "The dashboard's school and child-care source table is
  hand-kept": **7c**. Each is updated in 7a to point at 7c.
- **"Schools' 3×3 section block for pesticide totals"** and **"The school "within about a mile"
  pesticide block, and buffer or radius"**: not fired (schools have no Show in). Unchanged.
- **"map-sdk: arriving townships go clear…"** and **"…a township the lens leaves goes clear for 1
  frame"**: folded into any new map-sdk beta this work needs. 7a needs none that I know of.
- **"The Monthly and Yearly legend line takes its units from the catalog"** and **"Show in a chart
  from a minimized Map"**: not fired.
- New in 7a: the bulk type filter until it lands (decision 20), and anything the build defers.

## Testing

- Unit: the new schema (areas on the data, monitors on the layer, no monitor places; old shapes
  rejected), conversions (`now.ts`, `map.ts`, `show-in.ts`), what a widget asks for (`input.ts`:
  monitors, areas, neither), the dataset rules' place kind (monitors present → monitors; areas only
  → regions), line styles (125 distinct).
- Browser: the Air quality section (radios, None always enabled, type groups from meta, search,
  list), Where always shown and "Everywhere", What first, the left column scrolling with the
  preview in view (keyboard too), single-place widgets with one monitor.
- E2E: a Chart of ticked types in a county (bulk request scoped by region), a Map of one pollutant
  with every type ticked by default, Show in from a Map's marks. Pin noon Pacific; run under
  `TZ=America/New_York` too. Chromium and Firefox locally (WebKit can't start here).
- The E2E fake copies the server's bulk response shape from a real local response.

## Settled after the builder check (my calls, 2026-11-21)

30. **Shapes from before this spec: no compatibility code** (the user, 2026-11-22: nothing is live).
    Fixtures, the starter and the E2E fake use the new shape; there is no drop-on-read or migration
    for older documents (an old local test dashboard may fail to open; clear the site's data).
31. **None with monitors still chosen:** the ticks and searched monitors stay, greyed out with
    "Choose a pollutant to show monitors"; nothing is drawn for them; nothing is cleared.
32. **A type or monitor that doesn't supply the chosen pollutant** is greyed out with its reason
    and kept, not dropped (in the Data Portal, Show as and Show in).
33. **Single-place widgets show only the Monitors search** (one monitor), no type checkboxes. Show
    as from a Map with types ticked to a single-place type drops the ticks with a note, so it isn't
    blocked; only searched monitors and Where places count toward the one place.
34. **A Map whose Where is a school, address or point** filters monitors by the area its frame
    uses today (`placeRegion`, `widgets/map/data/scope.ts:42-46`); 7c loads schools for the same.
35. **The Map on Now** filters by type in the dashboard (its list is already fetched by area,
    `map/data/monitors.ts:190-195`). The toolbar's Inactive and Indoor options stay as they are.
36. **Monitor groups:** any number, entirely from `monitor_groups`.
37. **Overlays on a Chart with several lines** keep today's "Overlay for" choice (one line's place
    or monitor; `overlayFor`, `GetDataView.svelte:1157`).

## Left to the builder

- Field names (`monitors`, `monitorTypes`, the data's `place` / `selection`), as long as the
  meaning holds.
- How the Monitors search reuses the place picker (a monitors-only mode of `PlacePicker` and
  `PlaceDirectory`, or a thin wrapper).
- Copy, through Paraglide, plain enough for every audience.
- How the 125 styles are ordered (colour first, then dash, then marker).

## For the user to check while reading (my calls)

- A monitor type with no group gets a checkbox in a group of its own after the others (decision 7).
- Show as keeps the draft's ticks when converting (decision 8), so a Map converted to a Chart keeps
  every type ticked.
- "Where: Everywhere" as the empty Where's wording (decision 17; final copy in the build).
- The Map's toolbar monitor-type switches stay as a view filter over what the Data Portal asked for
  (decision 10).
