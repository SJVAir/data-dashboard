# Release 1, step 5, spec 1: the Map widget (core)

Status: brainstormed with the user 2026-11-11; checked by a fresh builder read (four
contradictions with the code fixed and five questions settled as my calls, below; one question
for the user, answered: exact points open on their region); not yet approved. Branch
`step-5-spec-1` from `step-5`; its PR goes into `step-5`.

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.

## Where this sits

Step 5 is the Map widget on `@sjvair/map-sdk` (part 1, map-sdk itself, is done through
`0.1.0-beta.6`). Step 4 is merged into `main` (#50). Step 5 works on a `step-5` branch (the user,
2026-11-11): each spec branches from `step-5` and opens a PR into it, and `step-5` merges into
`main` once, at the end, with the user's yes. Step 5 is five specs (the user, 2026-11-11):

1. **This spec: the Map widget core.** A live map of PM2.5 monitors around the widget's
   places, with the places outlined and framed. It's synced with the shared place picker, follows
   "Change place", follows the location-privacy rules, and is lazy-loaded and torn down when
   hidden.
2. **The options toolbar and the reading card's buttons**, on map-sdk's shared toolbar and
   card actions (see "map-sdk changes"). This spec covers pollutant, smoke and fire, schools and
   child care, the dimmed surround, **Select**/**Remove** on the card, and Shift-click.
3. **A date-range mode and region fills.** Monitors or regions are colored by the range's worst
   day or its average, using the calendars' daily-level rule (`scale.daily_statistic`), on the
   dashboard's own data layer and cache.
4. **Pesticide use by section and township, and spray notices** (from sjvair.com's pesticides
   explorer), with spec 3b's filters.
5. **"Show in a chart" / "Show in a table"** from a map's selection.

The Map widget joins the starter in step 6, as a full-width row under the "now" row. It isn't
added here, but this spec makes it work there (see "Sizes").

## Why

The dashboard shows air quality for a place as numbers, tiles and charts. None of them answer
the question a parent or teacher has on a smoky day: what's happening *around* us? Researchers
and agencies also want to see the spread of monitors, and later of a whole event, across the
Valley. A map that sits beside their own widgets and follows their dashboard's place gives them
that. It's also a natural way to pick places: pointing at a neighborhood instead of searching
for it.

## Who it's for

Parents, teachers and students, researchers, and agencies such as CARB (`project-dashboard-audience`).
Parents and teachers want "what's near us now" at a glance; researchers want to frame and pick
monitors or regions precisely.

## Goals

- A **Map** widget type on map-sdk's `MapView`, lazy-loaded, showing live PM2.5 monitors.
- The map's **places are its places layer, exactly as Chart's and Data table's are** (the user,
  2026-11-11, "keep it like the other widgets"): one place in `layer.place`, several in
  `layer.selection`, through `toLayerPlaces`/`fromLayer`.
- **One place** is framed: a region is outlined; a monitor is highlighted; a school or a point
  gets a pin. The map zooms to it. **Several places** are highlighted, and the map zooms to fit
  them all (the user: "highlight them and zoom to fit").
- **Synced both ways with the shared place picker.** "Change place" and the idle "Choose a
  place" open the picker; what the picker saves is what the map shows.
- **Follows "Change place"** when it shows one place, and stays put with several, through the
  existing `widgetPlace`/`replacePlace` rules (the user, 2026-11-11). No map-specific code is
  added to that mechanism.
- **A fresh map shows PM2.5 monitors around the dashboard's place** (the user).
- **Hover or tap shows a monitor's reading** with map-sdk's existing tooltip (the user: "show
  the reading first, with a button to select it"; the button is spec 2).
- Works **full-width** at the starter's row size, at small widget sizes, on phones, and in
  fullscreen.
- Follows every location-privacy rule, including for viewers of a shared link.
- Keeps map-sdk and MapLibre **out of the initial bundle**.

## Non-goals (this spec)

- The options toolbar, other pollutants on the map, smoke, fire, schools as a layer, the dimmed
  surround: spec 2.
- Selecting places by clicking the map: spec 2. map-sdk can't yet tell a plain click (which
  should show the reading) from Shift-click (which should select), so in this spec **map clicks
  never change the selection**; selecting is done in the place picker.
- Date ranges and region fills (spec 3), pesticides and notices (spec 4), "Show in a chart"
  (spec 5).
- Drawn-shape selection (method C): stays deferred (`DEFERRED.md` → "Map & selection").
- The Map widget in the starter: step 6.
- Saving the camera. Panning and zooming aren't saved (see "Camera").

## Anti-goals

- **A map-only special case in the place mechanisms.** The map must not need its own branch in
  `replacePlace`, the bar, sharing or the picker beyond the three standard place spots every
  type wires (spec 4's Forecast strip lost its place on share when one was missed).
- **A second place picker**, or map-local selection state that can drift from the document.
- **A map that shows an exact point to someone who shouldn't see it**, or puts coordinates in a
  URL, log or error report.
- **MapLibre in the initial bundle**, or a map that keeps a WebGL context while hidden.
- **Hardcoded labels, colors or scales**: everything from metadata or theme tokens (except
  map-sdk's fixed monitor defaults, which it owns).
- **Tracking**: MapTiler's telemetry and session id must be off (see "Privacy").

## Decisions

### The widget type

`src/lib/widgets/map/` with `index.ts` (descriptor, in the initial bundle, imports neither
map-sdk nor the data layer), `module.ts` (exports `component`) and the component. Registered in
`src/lib/store/app.svelte.ts` with the others.

- `type: "map"`, label "Map" (Paraglide), a map icon from `@lucide/svelte`.
- `time: "now"`. Spec 3 adds the date-range mode and decides then how `time` describes it
  (shapes are free before release, so it may redefine this). **(my call)**
- `accepts: { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces: 25, onlyPollutant:
  true }`. **(my call: 25)** is well above Chart's 5, because framing many monitors is
  what a map is for, but still keeps the picker's list readable. The schema's own cap is 500.
- `thresholds: false`, `analyzable: false`, `downloadable: false` (spec 1). **(my call)**
- `menu: () => []`. "Change place" comes from the generic `placeItems` (any type with
  `accepts.maxPlaces`), and "Edit data" from `accepts.datasets`.
- **It's a data type and also directly addable.** It's listed in Get data's "Show as", so a
  chart's data can become a map. **In Add widget it appears once**, as a direct add ("Map",
  PM2.5 at the dashboard's place, below), not through Get data. **(my call)** Add widget
  (`AddWidgetButton.svelte`) and its menu (`actions/dashboard.ts`, `add-widget-${type}` ids) join
  `dataTypes()` and `addableWidgetTypes()` today and assume they're disjoint (a type in both
  would be a duplicate key). So the rule becomes: a type with `addable` is added directly even
  if it's also a data type, and `dataTypes()` entries that are `addable` are left out of Add
  widget's Get data list. Update `registry.ts`'s comment ("Data types … go through Get data
  instead") to say this.
- **Entry types: the monitor map's pollutants, from metadata.** The map accepts the entry types
  in the monitors meta's `available_pollutants` (today `pm25` and `o3`), which is what map-sdk's
  monitors store can draw. Its `entryTypeFor()` silently swaps any other type for
  `default_pollutant`, which would put PM2.5 under an "O3" title. **(my call)** Both are
  whole-number scales, so map-sdk's whole-number readings (`DEFERRED.md` → "map-sdk milestone 2
  review leftovers") don't misread them. A ppm-scale type such as CO isn't in the list, and the
  rule stays right if the server adds one only after map-sdk change 8. Get data has no
  per-entry-type block today (`TypeBlock` in `get-data/offer.ts`), so it gains one ("The map
  shows {pollutants} only", Paraglide, the list from metadata), with the existing "left out"
  handling.

### What "the dashboard's place" is for a new map

`addable()` takes no arguments today, so a new type can't see the dashboard. It changes to
`addable(doc: Dashboard)` (and the Add widget action passes the open dashboard). The Map's
`addable(doc)` gives one PM2.5 layer (`DEFAULT_LAYER`'s dataset and entry type) whose place is:

1. the bar's place when the bar shows (`barVisible(doc)`);
2. else the dashboard's most common single place (`mainPlaces(doc)[0]`);
3. else `DEFAULT_LAYER`'s place (Fresno County).

Steps 1 and 2 are exactly `placesToReplace(doc)[0]` (`actions/dashboard.ts`), which
"Duplicate for another place" already uses, so a stale bar that no widget shows is ignored in
both places. **(my call)** The Notes type ignores the argument. Get data keeps its own starting draft;
changing that is out of scope.

### Where the map's places live (Option A, the user, 2026-11-11)

The map has **one layer**: `{ dataset: "air-quality", entryType, place | selection }`, read
through `placesLayer` like every other type. There's no separate "focus" field and no saved
camera. What the map frames is always what the picker saves:

| Layer holds | The map shows | "Change place" |
|---|---|---|
| `place` region | its outline (and monitors around it); zoomed to its bounds | follows |
| `place` monitor | that monitor highlighted; centered, zoomed in to at least 12 | follows |
| `place` location (school, child care) | a pin with the school's name, at its `point` from `getLocationsByCode`; zoom 13 | follows |
| `place` point | framed on **its region** (the one its data uses, `placeRegion`), outlined like a region, with a pin ("Your location" / "Shared location") inside (see "Privacy") | follows |
| `selection` monitors | those monitors highlighted; fit to them all | stays (`mixed`) |
| `selection` regions | those regions outlined and highlighted; fit to them all | stays (`mixed`) |
| `default-place` (starter, unresolved) | the idle state; the starter resolves it before render | stays |
| none | idle "Choose a place" (editable dashboards) | — |

All monitors for the pollutant are drawn in every case. The places only decide what's
highlighted and where the camera goes.

When the picker changes a single region to a monitor, the outline goes and the monitor is
highlighted. **Undo** brings the region back; that's how it works for every widget.

### Showing the places (spec 1 layers)

- **Monitors:** `monitorsPlugin` fed by map-sdk's `createMonitorsStore()` (live readings, polls
  every 2 minutes). There's **one store per entry type, shared by every Map widget on the page**,
  and it's disposed when no map uses it. It pauses while the page is hidden
  (`platform().activity`), as the query client does. **(my call)** Live readings come from
  map-sdk's store, because the dashboard's data layer has no "all monitors with positions"
  query, and Current conditions' latest-reading path is per place. Spec 3's date-range data goes
  on the dashboard's data layer, as the brief asks. `selectedStyle: "ring"` (map-sdk's default,
  with a check mark, so selection isn't shown by color alone). Selection mode `"none"`:
  map-sdk still draws a selection the host sets (`setSelection`), and clicks don't change it.
- **Region outlines:** one `shapesPlugin` in `"plain"` mode, `listed: false`, `selectable:
  false`, `hoverable: false`, added **below** the monitors so its fill never takes their clicks.
  Geometry comes from the SDK's `getRegionsGeoJSON({ type, external_id, simplify })`, through
  the dashboard's query client (cached; region ids are `type:code` with `code` the external id,
  matching map-sdk's `region:<type>:<external_id>` refs). A selection of regions groups its codes
  by type and makes one request per type. The highlight is map-sdk's selected outline (3 px
  `--highlight`). This is spec 1's stand-in for map-sdk's focus area. Spec 2 replaces it with
  the focus area (outline plus dimmed surround) once map-sdk has one.
- **Pins** for a school or point: a `pointsPlugin` with one `feature:` ref (not selectable),
  marked in theme tokens with an outlined marker and a text label, not color alone.
- A place that no longer resolves (a retired monitor, a region with no geometry) shows the
  widget's existing unavailable state for that reason (`monitor-unlisted` and the others), and
  the map still draws.

### Camera **(my call)**

- **Nothing about the camera is saved.** When the widget opens, and whenever its places
  change, it fits them (`fitBounds` with padding; `easeTo` with `minZoom` for one monitor or
  pin). Panning and zooming are for the moment only; reopening refits. So the document never
  holds coordinates the user didn't choose, and a shared map always opens on its places.
- The map starts at the Valley's view (`config.initialView`) and refits once `map.ready`. There's
  no flash of the wrong view: the skeleton covers the map until it's ready.
- Fitting uses no animation under `prefers-reduced-motion` (map-sdk does this).
- Mercator projection, no globe, no space backdrop **(my call)**: a widget is a small flat
  view, and this sidesteps the globe-zoom precision item in `DEFERRED.md` → "Map & selection".
  That entry gets a note that the Map widget uses Mercator.

### Clicks, hover and the keyboard (spec 1)

- **Hover** (mouse) and **tap** (touch) show map-sdk's monitor tooltip: reading, level label,
  time.
- **The feature list** (map-sdk's keyboard list, `featureList={{ reveal: "focus" }}`) reaches every
  monitor, and focusing a row pins its tooltip. This is the keyboard path.
- **Clicks don't select** (selection mode `"none"`). Spec 2 adds the card's **Select**/**Remove**
  and Shift-click.
- `cooperativeGestures: true`, so scrolling the page doesn't zoom maps (Ctrl/⌘-scroll or two
  fingers zoom). **(my call)** It stays on in fullscreen too: map-sdk sets it only when the map
  is created, and fullscreen reuses the same mounted widget, so turning it off there would mean
  rebuilding the map. A runtime switch is on the map-sdk list as a nice-to-have.
- **Tap on a phone:** phones send an emulated mouse move before a tap's click, and map-sdk's
  hover reads it, so a tap should show the tooltip. **The plan verifies this first** (an E2E
  with a touch context on Chromium and WebKit). If a tap doesn't show the reading, the map-sdk
  pinned card (change 4) moves into the "needed for spec 1" list instead of the dashboard
  working around it. **(my call)**

### Picker sync

Nothing new: the map's layer is the places layer, so `openPlacePicker({ widgetId })` reads and
writes it through `applyChange` (undoable). The widget's idle state passes
`onchoose={() => openPlacePicker({ widgetId: widget.id })}` like Chart. When the layer changes
(picker, undo, "Change place", another tab), the map re-reads it, calls `setSelection` and
refits.

### Title

A generated title like the others'. One place: "PM2.5 · {placeLabel}" (`m.label_join`,
`placeLabel` with the viewer, so "(your location)" and "(shared location)" read right).
Several: "PM2.5 · {n} places" (`widget_title_places`). The generated title is never saved.
**(my call: reuse the existing strings; the builder picks the closest helper.)**

### The three place-handling spots (project checklist)

- **`src/lib/sharing/points.ts` (`lookupInput`):** the map is `time: "now"`, so its single
  place goes through `nowInput(placesLayer(…))`, which is what the exact-point swap already
  does. A point is always alone, so a selection never holds one. Add a **test** that sharing a
  Map widget holding a point swaps it for the region the "now" lookup gives. Add a map branch
  only if that test shows one is needed.
- **`PlacePickerDialog`'s `regionOf`:** the same three-way switch, so the same test, through
  the picker's live-link path.
- **Get data (`src/lib/get-data/now.ts`):** `toNowDraft` keeps only the first place, and
  `isNowShaped` requires at most one. A "now" type with `maxPlaces: 25` would lose its
  selection on every type switch. So the map gets its own shape: switching **to** Map keeps all
  places (up to 25, with the existing "left out" note beyond). Switching **from** Map to a
  one-place "now" type keeps the first place with the existing `"places"` note. Switching from
  Map to Chart or Table keeps up to their cap with the same note. Add the map to the "left out"
  notes and to Show as.
- `src/lib/widgets/shared/input.ts`: the map reads its layer with `placesLayer`.
- `registry.test.ts`: the type is in the size check.

### Sizes

- `defaultSize: { w: 6, h: 6 }`, `minSize: { w: 3, h: 4 }` **(my call)**. The starter's
  future row is 12 columns wide. The widget must look right at 12×6 and 12×7, and in one
  column on a phone.
- At small sizes, the legend sits in the widget's own card (`Legend framed={false}`), in the
  `overlays` snippet, and collapses to a button below about 360 px wide. **(my call)**
  `selectionBar={false}`: the title and the picker show the places.
- The map's container needs a real height: it fills the widget body.
- Resizing: MapLibre tracks its container. During the frame's FLIP or fullscreen animation, the
  map waits for `ancestorAnimationsSettled` before refitting, as `TimeChart` does.

### Lifecycle and WebGL

- `MapView active` is true only while the widget is **on screen** (an IntersectionObserver
  on the widget body, with a margin), the page is visible, and the widget isn't minimized.
  Minimized widgets are already unmounted. Off-screen or hidden, the map detaches and frees its
  WebGL context. Coming back rebuilds it with the same plugins and selection, and refits.
  **(my call)** A short delay before detaching (about 5 s) avoids churn while scrolling.
- `map.destroy()` on unmount. A map that fails to create (no WebGL, a lost context) shows the
  widget's error state with "Try again".
- Theme: the dashboard sets `data-theme` on `<html>`, which is where map-sdk looks, so a theme
  switch restyles the map. map-sdk `0.1.0-beta.7` (a separate map-sdk session, not yet
  published) fixes its slow restyle (4–10 s).

### map-sdk setup in the dashboard

- **Pin** the published `@sjvair/map-sdk` exactly, never a range or a dist-tag (npm's `latest`
  is held at beta.1). Building starts on `0.1.0-beta.6`, the newest today. The pin moves up to
  the beta carrying map-sdk change 1 (telemetry off) before the PR merges, and that beta is
  expected to also carry the restyle fix (beta.7 or later). Check `npm view @sjvair/map-sdk
  dist-tags` at each step. **(my call)** Its peer `@sjvair/sdk ^5.0.0-beta.2` accepts the
  dashboard's exact `5.0.0-beta.8`. Its license is MIT; `@maptiler/sdk` and `maplibre-gl` are
  BSD-3-Clause; the build's license check must pass.
- **Tailwind:** add map-sdk's `@source` for its dist (`README` → "Install"), and import
  `@sjvair/map-sdk/theme.css` **in the map module**, so its CSS lands in the lazy chunk where
  possible. Measure what `@source` adds to the initial CSS and report it.
- **Messages:** map-sdk's `messages` provider maps every `mapsdk_*` key to a Paraglide message.
  The keys are copied into `messages/en.json` with map-sdk's English text. There's an explicit
  key table (like `notes/messages.ts`), not `import * as m`, so only the map chunk pulls them in.
  Plural keys `_one`/`_other` are picked by `count`. A test checks that the table covers every key in
  `@sjvair/map-sdk/messages/en.json`, so a new map-sdk key fails the build until it's added.
- **Format:** map-sdk's `format` provider wraps the dashboard's `format` module (Pacific time,
  " PT" off-Pacific), so the map's dates read like the rest of the dashboard.
- **Metadata:** one shared metadata provider for every map (map-sdk's `createDefaultMetadata`,
  created once in the map module), so two maps don't fetch metadata twice. **(my call)** A
  provider built on the dashboard's own `getMetadata()` would avoid even that one extra fetch;
  the builder may do that if the shapes line up.
- **The key:** `VITE_MAPTILER_KEY`, read as `import.meta.env.VITE_MAPTILER_KEY` (inlined; never
  the whole env), declared in `src/vite-env.d.ts`. With no key, the map shows a short "Map
  unavailable" state. It's never printed or logged.
- **CSP:** add `https://api.maptiler.com` to `connect-src` in `csp-hosts.json` (styles, tiles,
  glyphs and sprites are fetched). `worker-src blob:` and `img-src data: blob:` are already
  there. Update `src/csp-hosts.test.ts`'s contract, and let `scripts/check-build-output.mjs`
  find the hosts MapLibre and MapTiler bring and allowlist only what's needed. **sjvair.com holds
  the real CSP list** (`ARCHITECTURE.md` → "Deployment"), so the same host needs a server change
  on `develop`. That's a small sjvair.com change, raised with the coordinator, with its own
  spec in sjvair.com if it needs one.

### Privacy

- **Exact points:** a map draws exactly what its document holds. Shares, copy links and exports
  already swap a point for its region (`points.ts`), and live links swap each edit unless the
  owner chose "Share my exact location". So a shared viewer sees an exact pin only when the
  owner chose that. The pin reads "Shared location" for viewers and "Your location" for the
  owner (`PLACE_VIEWER_KEY`).
- **Coordinates never go in URLs, logs or error reports.** The map adds nothing to the route.
  Error reports from the map module pass through the existing scrubber, and the map's errors
  carry no camera or lngLat.
- **Map tiles reveal the viewed area to MapTiler.** Any web map does this: tile addresses name
  the area on screen. So **a map holding an exact point always opens framed on that point's
  region** (the user, 2026-11-11): the ZIP, city or county its data uses (`placeRegion`), never
  closer. The tiles it asks for are the region's. If the region can't be looked up
  (`location-unresolved`, `point-outside`), the map opens on the Valley's view, not the point.
  The person may zoom in by hand; that's their choice.
- **The pin is still drawn** inside the region's outline **(my call, at the user's "what do
  you think?")**. It's drawn locally and adds no requests. The owner sees "Your location". A viewer
  sees "Shared location" only when the owner chose "Share my exact location" for a live link.
  Every other share has already swapped the point for its region, so there's no pin.
- **MapTiler telemetry and session ids off.** `@maptiler/sdk` sends usage telemetry to MapTiler
  and adds a session id (`mtsid`) to requests by default. The dashboard allows no analytics or
  tracking, so both must be off. map-sdk doesn't expose these today (see "map-sdk changes").
  **This blocks merging spec 1.**
- **Geolocation** isn't used by the map in spec 1. A point reaches the map only through the
  picker, which already goes through the platform adapter.

## map-sdk changes (for the map-sdk session; the coordinator passes this on)

These are requirements, not a design. map-sdk's own spec, in the map-sdk repo, decides how. The
items are ordered by when the dashboard needs them. Consumers: the dashboard's Map widget,
monitor-map 5.0 (which moves onto the shared toolbar, the user, 2026-11-11), and through
monitor-map's `/routes` the mobile app.

**Needed for spec 1 (small; ideally in the same beta as the restyle fix or the next one):**

1. **Turn off MapTiler telemetry and the session id.** A `MapConfig` option (for example
   `telemetry: false`) that sets `@maptiler/sdk`'s `config.telemetry` and `config.session` off
   for that host. monitor-map's behavior is unchanged unless it opts in. Hosts can't do this
   themselves without depending on `@maptiler/sdk` directly.
2. **Panels sized by the map, not the window.** The feature-list panel's
   `max-width: calc(100vw - 2rem)` and the framed legend's fixed 21rem should size against the
   map's container, so a 300 px map widget on a wide screen doesn't overflow.

**Needed for spec 2:**

3. **A shared, controlled options toolbar** (the user, 2026-11-11):
   - Plugins (and the host) declare which **group** each option belongs to (Pollutant,
     Monitors, Layers, Overlays, Settings, as in monitor-map 5.0's toolbar) and what each
     option is (a radio, a checkbox, a submenu, a select). map-sdk builds the menus from those
     declarations, so they update and sort themselves.
   - **The host owns the values.** The toolbar shows them and reports changes. The dashboard
     saves them per widget, with undo; monitor-map keeps its own copy.
   - **Sized by the map's box**, not the window (compact panel on a small map widget on a wide
     screen).
   - **Phones and touch** (mobile renders it through monitor-map), keyboard, and WCAG 2.2 AA,
     using a standard menu pattern.
   - Message keys with English defaults, like the rest of map-sdk.
4. **A pinned reading card with host actions.** A click or tap on a feature pins its tooltip
   card. The card takes pointer events, closes with Esc, a close button, or a click elsewhere,
   and takes a host **actions** slot (the dashboard puts **Select** / **Remove** there). Keyboard
   focus from the feature list gets the same card with the same actions. Use an accessible
   non-modal pattern: focus moves into the card only when the user asks, and returns when it
   closes.
5. **A selection mode where a plain click only pins the card**, and Shift/Cmd/Ctrl-click (and the
   list's additive key) toggles selection. Plus a **way for the host to refuse a pick** (one
   kind per selection, a cap) before it shows. Reverting in `onselectionchange` works but
   flashes.
6. **A focus area:** for a given geometry, a two-tone outline (a line over a lighter casing, so it
   reads on any basemap and over fills) and a dimmed surround outside it (an inverse mask), as on
   sjvair.com's pesticides and emissions explorers. It's not clickable and not listed, and it
   draws under interactive layers. For a point or school, an outlined pin with a label.
7. **A schools and child-care preset** on `pointsPlugin` (types and labels from metadata), fed
   by the SDK's locations (`pesticides/locations/` has bbox queries; the dashboard picks the
   call).

**Needed for spec 2 or 3 (precision):**

8. **Monitor readings at the metadata's display precision** (the "readings are cut to whole
   numbers" leftover), so ppm-scale pollutants such as CO can go on the map. The dashboard
   lifts its precision-0 limit then.

**Needed for spec 4 (listed now so map-sdk can plan):**

9. **Shading classes computed from the data** (quantile classes over the values in view, with
   the legend showing each class's real range) for measures with no fixed levels, such as
   pesticide pounds. The classing method and class count come from the host or metadata.
10. **Count labels on points** (spray notices grouped per section, with clusters summing a
    count).
11. **A distance ring** (1, 3 or 5 miles) around a point or school.

**Nice to have:** an `initialView` given as a bounding box, so a map can open already framed
instead of refitting after `ready`. A runtime setter for `cooperativeGestures`, so a widget can
turn it off in fullscreen without rebuilding its map.

## Accessibility (WCAG 2.2 AA)

- The map has an accessible label (`MapView label`): the widget's title.
- Every monitor is reachable by keyboard through map-sdk's feature list. Selection isn't shown
  by color alone (ring and check mark). Pins have text labels.
- `cooperativeGestures` on the grid means the map never traps scroll. Keyboard users can tab
  past the map.
- Fitting respects `prefers-reduced-motion`.
- axe checks on the widget (browser test) and in E2E, in light and dark.

## Bundle

- Everything map-related loads through the type's `load: () => import("./module")`. The
  descriptor imports only an icon and messages.
- Run `npm run check:budget` and report the initial bundle (209.7 KB after spec 6; soft budget
  250 KB). The map's chunk size is reported in the PR. It isn't budgeted, but it must not be in
  the initial bundle.

## Constraints (project rules that bite here)

- Metadata is the source of truth (entry-type labels, scales, precision, location types).
- All strings through Paraglide, with no concatenated sentences. Theme tokens only;
  `token-discipline.test.ts` passes. map-sdk's fixed monitor colors come from its own exports.
- Pacific time through `format`.
- No `localStorage`, `navigator.geolocation` or the like outside the platform adapter.
- Every deferral goes into `DEFERRED.md` in the same change.
- No production touches. The sjvair.com CSP change goes on `develop`.

## Testing (what must be shown)

- **Unit:** `addable(doc)` picks the bar's place (only when it shows), then the most common
  place, then Fresno County. Add widget lists Map once. Get data blocks a pollutant outside
  `available_pollutants` for Map. The map's Get data conversions (to and from Map, with the "left out" notes). The
  message table covers every map-sdk key. The region-geometry request groups codes by type.
- **Browser (Vitest):** the widget renders with a mocked map-sdk (no WebGL in CI is assumed
  unless a spike shows the browser runner has it). It reads its layer, shows the idle "Choose a
  place" state with no place, opens the picker, re-targets on an undoable layer change, shows
  the right title for owner and shared viewer, detaches when off-screen, and passes axe.
- **Exact points:** a map holding a point frames its region, not the point (no fit or ease to
  the point's coordinates), and opens on the Valley's view when the region can't be found.
- **Sharing:** a Map widget holding a point is shared as its region (copy link, export, live
  link without "Share my exact location"); with it, the viewer sees the pin labeled "Shared
  location".
- **"Change place":** a one-place map moves with the bar; a several-place map doesn't (through
  `replacePlace`, with no map-specific code).
- **E2E (Playwright):** add a Map from Add widget, pick places in the picker, see the map frame
  them, undo, and fullscreen. MapTiler requests are **stubbed** with a local blank style
  (no real tiles in tests). It runs under the CSP (`csp.spec.ts`).
- `npm run check:build` passes with the new hosts allowlisted.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Which widgets "Change place" moves isn't shown anywhere** (the user, 2026-11-11, raised as
  a dashboard-wide issue). It applies to every widget. Ideas: a toast after the change ("Moved 5
  widgets to Tulare County. 1 kept its own places." with Undo), or a "Dashboard place" tag on
  widgets that follow the bar. **Revisit:** the first usability testing, or the step 6 starter
  review, whichever comes first.
- **Saving the map's camera:** not saved, by design (see "Camera"). **Revisit** if people ask to
  keep a hand-framed view.
- **Pollutants beyond the monitor map's `available_pollutants`** (CO and other ppm scales) on
  the map: until map-sdk change 8 and the server listing them. **Revisit** when either lands.
- **Year-over-year change on the map** (diverging scale): after spec 4. **Revisit** when a
  researcher or agency asks for trends on the map.
- **Emissions on the map** (facilities sized by emissions, wells, dairies, methane plumes, from
  sjvair.com's emissions explorer): add to the existing "CEIDARS facility emissions" entry
  as map ideas. Same trigger.
- **Globe projection for the Map widget:** it uses Mercator. Note this on the existing
  globe-zoom entry.

## Docs changed with this spec

- `ARCHITECTURE.md` → "Widget catalog" (the Map type's descriptor), "Map SDK" (how the
  dashboard hosts map-sdk: shared store, providers, lifecycle, CSP), and "Widget data
  selection" (a map's places are its places layer; clicks select from spec 2).
- `TODO.md` step 5 status, `ROADMAP.md` item 5 (the five specs), `DEFERRED.md` (above).
- `CLAUDE.md` Key Libraries: `@sjvair/map-sdk` moves from Planned to Installed.

## Left to the builder

- File layout inside `src/lib/widgets/map/`, the shared-store module, and how the
  IntersectionObserver is wired.
- Whether the metadata provider wraps the dashboard's `getMetadata()` or map-sdk's default.
- Exact padding, zoom levels within the ranges above, the delay before detaching, and the
  legend's collapse width.
- Which title helper to reuse.
