# Release 1, step 5, spec 2: the Map's data, its marks, and the focus area

Status: brainstormed with the user 2026-11-11 and 2026-11-12, on `step-5-spec-2-map-data`
(from `step-5`, with `origin/main` merged in for #55, the user's yes). Checked by a fresh
builder read: one question for the user (marks outside the tile's data are kept hidden, the
user's choice of my recommendation), the rest settled as my calls below, and five contradictions
with the code fixed. **Approved by the user 2026-11-12.**

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.

## Where this sits

Step 5 is the Map widget. It works on the `step-5` branch; each spec branches from it and opens a
PR into it, and `step-5` merges into `main` once, at the end, with the user's yes. Spec 1 (the
widget core, PR #53) is merged into `step-5`.

Step 5 is six specs (the user, 2026-11-12; this replaces the five-spec list in spec 1):

1. The widget core. Done.
2. **This spec:** what a Map tile holds and draws (several data sets, monitors limited to the
   tile's places, chosen in Get data, loaded by the dashboard), the saved marks, the card's
   **Select**/**Remove** and Shift-click, and the focus area.
3. The options toolbar built from the tile's data, plus Settings, once map-sdk part 5 ships.
4. A date-range mode and region fills.
5. Pesticide use by section and township, and spray notices.
6. "Show in a chart/table" from a map's marks (including "choose which places to keep").

**Working rule for every step of Release 1 (the user, 2026-11-12):** build toward the step's
final design, with no stop-gap UI or interim behaviour to make the Map usable between specs.
Nobody uses the Map until `step-5` merges. Between specs: the test suite stays green, every other
widget keeps working, and saved documents still open without errors.

## Why

Spec 1 built a small monitor-map: every monitor for the pollutant, with the tile's places
outlined and framed. That's not what the user wants. A Map tile is **chosen per tile, like a
chart's lines**: a teacher in Delano wants Delano's monitors, their school, and maybe smoke, not
every monitor in the Valley. The map is assembled from map-sdk's drawing pieces with the data the
owner picked, not a copy of monitor-map.

Teachers' moments that drive the card (the user picked these two):

- **"Is it just us?"** The school's monitor reads high before recess; the teacher glances at the
  nearby monitors' cards to see if they agree.
- **Planning a field trip or an away game.** They look at the air near the destination and mark
  a monitor there.

## Goals

- A Map tile holds: one set of **places**, one or more **pollutants**, and **smoke and fire** on
  or off. It draws only that.
- The dashboard loads every map data set through its own data layer and hands map-sdk plain
  `DataSource`s. map-sdk only draws.
- One dashboard-side **entry per map data set** says how it loads, when it refreshes, how it
  becomes a `DataSource`, and which plugin draws it with what settings.
- **Marks:** monitors a person marks on the map (card **Select**/**Remove**, Shift-click), saved
  with the tile, with undo.
- The **focus area** from `@sjvair/map-sdk` `0.1.0-beta.11` replaces spec 1's outline stand-in,
  the pin layer and the pin-label stop-gap.
- In Get data, the Map uses the Chart's "What" sections (no dates until spec 4).

## Non-goals (this spec)

- The options toolbar and Settings (basemap, variant, marker clusters, Reset): spec 3. Until then
  the tile shows its first pollutant. Per the working rule, no interim switcher.
- Date ranges: spec 4. The tile shows latest readings only.
- Schools and child care as a data set: waits on map-sdk part 4 and a later spec.
- Pesticides: spec 5. Charting marks: spec 6.
- Marking regions, smoke or fire. Only monitors can be marked.

## Anti-goals

- Drawing monitors the owner didn't choose (spec 1's "all monitors" rule is gone).
- map-sdk fetching anything for the dashboard, or being handed request functions.
- A toolbar or pollutant switch that loses saved work (switching pollutants never drops marks).
- Coordinates in URLs, logs, error reports, or anything saved that the user didn't choose.

## Decisions

### What a Map tile holds (the user)

| Part | What it is |
|---|---|
| Places | One set, chosen in the place picker as today: one region, several regions, one monitor, up to 25 hand-picked monitors, a school, or an exact point. "Change place" moves it. |
| Pollutants | One or more, from the monitors meta's `available_pollutants` (`mapPollutants()`), never a list in code. All share the tile's places. |
| Smoke and fire | On or off. |
| The pollutant showing | One at a time. Spec 3's Pollutant button switches it; until then it's the first pollutant. Saved with the tile. |
| Marks | Monitors marked on the map. Saved with the tile, with undo. |

**How it's saved (my call; the builder may refine names):**

- `data.layers`: one `air-quality` layer per pollutant. The tile's places (`place` or
  `selection`) live on the **first** pollutant layer only, the main layer, as a Chart's do
  (`mainLayer`/`placesLayer`, `keepingPlaces` in `get-data/layers.ts`); the other pollutant
  layers use them (planning check: this replaces "each layer carries the same places", so every
  place-handling path already sees one place). Smoke and fire are two place-less layers, `hms-smoke` and
  `hms-fire` (both are in the server's dataset catalog); one Get data checkbox adds or removes
  both together.
- `options`: a validated Map options object, like Notes' `NoteOptionsSchema`, holding
  `showing` (the entry type drawn now) and `marks` (monitor ids, at most 25, unique). Spec 3 adds
  its toolbar values here.
- Shapes are still free before Release 1 ships: existing saved Map tiles are converted in place
  (a spec 1 tile keeps its one pollutant layer, whichever pollutant it was, with no smoke and
  fire and no marks), with no version bump. Saved documents must still open without errors.
- `LAYERS_MAX` is 8, so a tile holds at most 6 pollutants alongside smoke and fire. The local
  stack's `available_pollutants` is `["o3","pm25"]`, so this doesn't bite today **(my call:
  leave the cap; Get data stops offering more pollutants at the cap)**.

### What the tile draws (the user)

- **Monitors** for the pollutant showing, limited by the places:

  | Places | Monitors drawn |
  |---|---|
  | A region, or several | the monitors in any of them |
  | One monitor, or hand-picked monitors | exactly those |
  | A school or an exact point | the monitors in its region, the same region the map frames it on (`placeRegion`) |

  Monitors that don't report the pollutant showing aren't drawn.
- **A school's or point's region is one region for the whole tile (my call):** the region
  `placeRegion` gives for the tile's places layer (`placesLayer`, the first pollutant layer),
  whichever pollutant is showing. It's what the frame, sharing's point swap and the picker's
  `regionOf` already use, so a switch never moves the camera or changes which monitors are in
  scope. Sharing does one swap, on the layer that holds the places.
- **Smoke plumes and fire detections**, drawn everywhere when on, never clipped to the places.
- **The focus area** (`focusAreaPlugin`, `@sjvair/map-sdk` `0.1.0-beta.11`): the places'
  outline with the surround dimmed, or the pin for a school or point. Always on, not an option.
  **Monitor places get no focus area (my call):** only those monitors are drawn, the camera fits
  them, and spec 1's selection-ring highlight for monitor places goes, since the ring now means a
  mark.
  Colors are map-sdk's fixed ones (the user, in map-sdk part 3); the dashboard sets no theme CSS
  for it.
- The camera rules are unchanged from spec 1 (fit the places, nothing saved, a point frames its
  region).

### Loading (the user: the dashboard loads, map-sdk draws)

- The widget drops `createMonitorsStore` and `host/stores.ts`'s `acquireMonitors`. Loading goes
  through the dashboard's data layer: its **now client** (`src/lib/data/now/`, `NowSource`), which
  already serves non-series "now" data (forecasts, alerts) with a shared cache, polling paused
  while the page is hidden, retries and error states (planning check: the query client is
  series-only, so the now client is the fit).
- **One entry per map data set** (monitors; smoke and fire), in `src/lib/widgets/map/`. Each
  entry holds:
  - **load:** the SDK calls, through the data layer. For monitors, the SDK already scopes by
    region: `getMonitorsList({ region })` and `getMonitors(entryType, { timestamp, region })`
    take the server's region ids. `getMonitors(entryType)` with no options is the "current"
    list for the whole Valley. The builder picks the calls; the dashboard's region keys are
    `type:code`, so they go through the region resolver to get server ids. For smoke and fire:
    `getHMSSmoke` / `getHMSFire` for today.
  - **refresh:** live readings on the now client's `"raw"` cadence (every 3 minutes, the
    dashboard's standard for live readings), paused while the page is hidden. Smoke and fire on
    its `"hour"` cadence.
  - **to a `DataSource`:** map-sdk exports no monitor-to-feature converter, so the dashboard
    writes its own into map-sdk's `MonitorFeatureProperties` shape (and the HMS shapes). If a
    shared converter would help, list it for the coordinator; don't change map-sdk.
  - **plugin:** which map-sdk preset draws it (`monitorsPlugin`, `hmsSmokePlugin`,
    `hmsFirePlugin`) and its settings.
- Adding schools or pesticides later means adding an entry. Spec 3's toolbar reads each entry's
  options from the same place.
- **Spec 4 rule (the user; recorded in `DEFERRED.md`):** the Map refreshes only when its date
  range includes today. A past-only range loads once and never polls.

### Marks, the card, and Shift-click (the user)

- **A tap or click** on a monitor opens its reading card (map-sdk's pinned card), as in spec 1.
  Nothing is marked by a plain click.
- **On the card, Select** marks the monitor and **Remove** unmarks it. **Shift-click** does the
  same without opening the card. Shift+Enter in the feature list does it from the keyboard
  (map-sdk). map-sdk wiring: `selectionMode: "multiple"`, `pickWith: "modifier"`, `card: {
  actions }` with Select/Remove shown only when `ctx.selectable`, `canSelect`, and
  `onselectionchange` writing through `applyChange` (undoable); `setSelection` when the document
  changes (undo, redo, another tab), which fires nothing.
- **Only monitors can be marked.** Smoke, fire, the focus area and its pin show no buttons.
- **At most 25 marks** (counting every mark, drawn or not). A 26th is refused with a short
  "limit reached" message (map-sdk's `notice`, 4 s, `role="status"`).
- **Marks survive a pollutant switch.** A marked monitor that doesn't report the pollutant
  showing isn't drawn, keeps its mark, and comes back when switched back. A short note under the
  map says how many marks are hidden ("2 marked monitors don't report ozone"), and the feature
  list says the same for screen readers.
- **Marks are kept when a monitor leaves the tile's data** (the user, 2026-11-12, my
  recommendation). A place change, or a pollutant unchecked in Get data, never edits the marks.
  A marked monitor that isn't drawn (outside the places, or not reporting the pollutant showing)
  keeps its mark, hidden, and comes back when it's drawn again (undo, or picking the old place
  again). Nothing waits on the server, and nothing quietly loses saved work. The hidden-marks
  note counts every hidden mark, whatever the reason (the builder words the reasons; Paraglide,
  plural-aware). The 25 cap still counts every mark. **Spec 6 charts only the marks that are
  drawn** (recorded for spec 6).
- **View-only dashboards** (and shared ones opened without a copy) hide Select/Remove, and
  Shift-click does nothing. Cards and saved marks still show.
- Marks are monitor ids, not coordinates, so the live-link point rule doesn't apply to them.

### Get data (the user: the Chart's sections)

- The Map moves onto the Chart's "What" sections, without dates: an **Air quality** section
  and a **Smoke and fire** section. The Map no longer uses the "now" form's single pollutant
  radio.
- **New UI for the Map (code check):** today's Air quality section is radios plus "None"
  (`WhatSections.svelte:167-190`), since a Chart holds one pollutant. For the Map it shows a
  **checkbox per offered pollutant** (only `available_pollutants`). The Chart keeps its radios.
  At least one pollutant stays checked.
- **Smoke and fire (code check):** the Chart's section is `hms-smoke` at a place, and `hms-fire`
  has no dataset adapter, so `offeredDatasets` skips it (`offer.ts:40-41`). **(my call)** The
  Map's Smoke and fire section is offered from the Map's own data-set entries, not the chart
  adapters: one checkbox (with the smoke help toggletip) that adds or removes the place-less
  `hms-smoke` and `hms-fire` layers together. The `hms-fire` loading goes into the dashboard's
  data layer with the Map's entry.
- Places work as today. The several-place handling spec 1 added to `now.ts` (keep up to 25 on a
  switch to Map; first place on a switch to a one-place "now" type; Chart/Table greyed out while
  over their cap) carries over to wherever the Map's draft conversion now lives.
- The Map keeps `time: "now"` until spec 4 adds dates **(my call)**; Get data shows it the
  sections without the date controls.
- **Conversions (my calls; spec 1's rules assumed one layer):**
  - Map to Chart, Table or another type that holds one pollutant: the **pollutant showing**
    survives, at the tile's places (cap and greying as in spec 1). Smoke and fire are dropped with
    the existing "left out" note, never carried over as place-less layers.
  - Map to Current conditions, the Forecast strip or "Can we go outside?": as above, then each
    type's own rules (first place, its own pollutant rule).
  - To the Map: the source's pollutant becomes the one pollutant, and the places carry over as in
    spec 1. A Chart's smoke overlay turns Smoke and fire on.
  - Marks are dropped when converting away from the Map, with a note.

### A new Map tile (my call)

`addable(doc)` gives PM2.5 only, at the dashboard's place as in spec 1, with smoke and fire off
and no marks.

### The three place-handling spots

The Map stays wired into `src/lib/sharing/points.ts`, `PlacePickerDialog`'s `regionOf`, and Get
data. The places live on the first pollutant layer only, so each place-handling path sees one
place; the tests from spec 1 extend to a multi-pollutant tile to prove it.

### Dropped from spec 1

- `pin-label.svelte.ts`, `pinIcon`, `pinFeatures`/`pinSource` and the "pin" `pointsPlugin`;
  the places `shapesPlugin` outline. `focusAreaPlugin.set({ geometry, label })` replaces them
  (a point is `{ type: "Point", coordinates }` with the pin's label; regions are their
  `Polygon`/`MultiPolygon`). It's added first (or `before` the first data plugin) so it draws
  under them; the monitors plugin no longer needs `before: "pin"`.
- The direct `@maptiler/sdk` dependency (it was only for the pin label). Remove it from
  `package.json`, the CLAUDE.md library table, and the license list as needed.
- `createMonitorsStore` and `host/stores.ts`'s monitors part.
- **`sharedMetadata()`'s `createDefaultMetadata()` (my call):** it has map-sdk fetch the monitors
  meta, the dataset catalog and the HMS meta itself. It's replaced by a `MetadataProvider`
  adapter over the dashboard's own metadata module, so map-sdk fetches nothing and the metadata is
  loaded once, through the same cache as every other widget. The adapter grows with each new
  map-sdk `MetadataProvider` hook. The first is map-sdk part 4's schools' location type labels
  (from `getRegionsMeta` → `location_types`), arriving with `@sjvair/map-sdk` `0.1.0-beta.12`;
  its shape is agreed with `map-sdk-c0`, and the adapter implements it when the dashboard moves
  to that beta.
- `DEFERRED.md` → "The map pin's label is the dashboard's own stop-gap" is done.

### Packages

Pin exactly, in the plan's first commit: `@sjvair/map-sdk` `0.1.0-beta.11` (focus area; it
includes `0.1.0-beta.10`'s card actions, `pickWith`, `canSelect`) and `@sjvair/sdk`
`5.0.0-beta.9`. `host/messages.ts`'s key table gets every new `mapsdk_*` key (its test fails on
a missing one). Check `npm view @sjvair/map-sdk dist-tags --prefer-online` first for anything
newer.

## Accessibility (WCAG 2.2 AA)

- Shift-click's keyboard path is Shift+Enter in the feature list, and the card's buttons are
  ordinary buttons.
- Refusals and the hidden-marks note are announced (`role="status"`).
- Marks use map-sdk's ring with a check mark, not color alone.
- Get data's sections are the Chart's; the Map's new pollutant checkboxes are a plain
  `fieldset` of checkboxes with a `legend`, and the at-least-one rule says why the last one
  can't be unchecked (the existing "keep one" pattern).

## Bundle

Map code stays lazy. Report the initial bundle against the 250 KB soft budget (about 210.5 KB
before this spec).

## Testing (what must be shown)

- Each kind of place draws exactly its monitors (region, several regions, monitors, school,
  point), and none outside them.
- Smoke and fire draw everywhere when on and are absent when off.
- Select, Remove, Shift-click and Shift+Enter mark and unmark, through undo and redo; the 26th is
  refused with the message; view-only hides the buttons and ignores Shift-click.
- A pollutant switch, a place change and an unchecked pollutant all keep marks; the
  hidden-marks note counts every hidden mark; undo of a place change shows them again.
- Get data: the sections for the Map; at least one pollutant stays checked; smoke and fire add
  and remove both layers; conversions to and from the Map keep the spec 1 behaviour.
- A spec 1 saved Map tile opens and converts.
- The focus area replaces the pin and outline (E2E with the MapTiler stub; WebGL may be skipped
  only in Firefox).
- Polling: monitors refresh on the now client's `"raw"` cadence and pause while the page is
  hidden.
- The three place-handling spots with a multi-pollutant tile.

## Deferrals (added to `DEFERRED.md` in the same change)

- **The Map refreshes only when its range includes today** (the user): for spec 4. Trigger:
  spec 4's date-range mode.
- **The focus school drawn twice** (the user's lean: keep it in the schools data, with the focus
  ring around the badge and one feature-list row; `map-sdk-c0` says both details fit). Trigger:
  the dashboard's schools spec.
- **Schools and child care as a Map data set.** Trigger: map-sdk part 4 (`0.1.0-beta.12`).
- **Spec 6 charts only the drawn marks** (the user, 2026-11-12): hidden marks aren't sent to a
  chart or table. Trigger: spec 6.
- **More than 6 pollutants on one Map** (`LAYERS_MAX` 8 less smoke and fire). Trigger: the
  server's `available_pollutants` growing past 6.
- Any `DEFERRED.md` entry that names old spec numbers is already renumbered (coordinator,
  5f863b8).

## Docs changed with this spec

- `ARCHITECTURE.md` → "Map SDK" and the Map widget's section: the tile's data model, the
  dashboard-loads rule, marks, the focus area; spec 1's "all monitors drawn" line goes.
- `CLAUDE.md`'s library table: drop `@maptiler/sdk`; `@sjvair/map-sdk` at `0.1.0-beta.11`.
- `TODO.md` status, `DEFERRED.md` as above.

## Left to the builder

- The exact names in the Map options schema and the data-set entry interface.
- Which SDK calls load monitors (region-scoped list plus current readings, or the `at` endpoint
  with a timestamp) and how the region keys map to server ids.
- How the Get data sections are reused for the Map (shared component, flags).
- Smoke and fire's refresh cadence.
- The hidden-marks note's wording (through Paraglide, no concatenation, plural-aware).
