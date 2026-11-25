# An empty Where means nothing, and six smaller changes — design

Date: 2026-11-25. From the user's requests on 2026-11-25. Branch `where-empty` (worktree
`.worktrees/where-empty`), one PR into `main`.

## Why

- **Empty Where (part 2).** Today a widget with no Where shows everything its What asks for
  (`ARCHITECTURE.md` → "No Where means everywhere", spec 7a): ticked monitor types draw every monitor
  of the type valley-wide, a Chart's weather draws every station, pesticide use draws the valley
  total, the Map's schools load valley-wide. The user's decision (2026-11-25): **no Where selected
  means nothing from Where.**
- **Raw reason (part 3).** The Data Portal said "Air Quality has no individual measurements" when
  the place, not the dataset, is why: an area's air quality and ticked monitor types come from the
  server's summaries. The user asked whether an area could offer every measurement; it can't (no
  bulk raw endpoint, raw is per monitor and 31 days per request, and Fresno County's 100+ PurpleAirs
  over 3 days would be about 216,000 points against the 50,000-point budget). So the reason should
  name the place and say what to do.
- **Forecast → calendars (part 4).** With Forecast chosen in Show as, the month and year calendars
  are greyed ("Can't show this data"). The user: they shouldn't be.
- **Nav (part 5).** "Dashboard" (the picker, a ghost button) and "Data Portal" (a plain text link)
  look different in the top nav. The user: make "Data Portal" match.
- **Legend (part 6).** The Map's legend starts open on a wide widget. The user: start it folded.
- **Fullscreen zoom (part 7).** A fullscreen Map still asks for Ctrl + scroll. The user: no Ctrl
  needed while fullscreen.
- **Starter layout (part 8).** The user supplied a new layout for the starter dashboard (an
  exported dashboard; "I only want the same layout").

## Goals

1. A widget with no Where shows nothing that comes from Where, and says what to add.
2. Monitors searched in What still show with no Where (they're What, not Where).
3. A Map with no Where still draws its layers that never used Where.
4. Every saved document still opens without errors; ones with no Where show the empty state.
5. Code that only served "everywhere" is removed.
6. The raw-resolution reason names the place (an area, ticked types) and the fix, in all three spots.
7. Forecast → a calendar is offered and converts like Forecast → Chart.
8. "Data Portal" in the top nav looks like the dashboard picker's button.
9. The Map's legend starts folded at every width.
10. A fullscreen Map zooms and pans without Ctrl; on the dashboard it keeps cooperative gestures.
11. The starter dashboard uses the user's layout.

## Non-goals

- A bulk "every measurement" for an area (ruled out above; no server work).
- A phone-only widget order (the user chose to accept the new reading order, part 8).
- Making the place bar fill widgets with no Where (the user: no Where is a deliberate choice).
- Changing the Map's place-less layers (smoke, fire, spray notices, pesticide use townships and
  sections, region fills).
- The unreproduced preview bug (part 1; see "Part 1" below).

## Anti-goals

- Valley-wide data quietly reappearing for a widget with no Where through some other path.
- An empty widget with no message saying what to add.
- Any saved document failing to open (a strict-schema parse failure fails the whole dashboard).

## Part 1: the preview bug (set aside)

The user: "when I clear "Where", and then select "Fresno County", the preview doesn't update." It
couldn't be reproduced: dev server and the local stack (signed in), the default Chart, Clear, then
Fresno County by search and by Browse → Counties, in all eight Show as types, and with every request
slowed by 3 s (Clear while loading). The preview updated every time. The user set it aside, since part 2
changes what an empty Where means. It goes into `DEFERRED.md` (not reproduced; revisit after part 2
ships or if it's seen again). One related defect was found: after Clear, the preview's title kept
"Fresno County", because `DataWidget` sets its generated title only from ready data. Part 2's empty
state must give the title the empty widget's own value (see "Titles" below).

## Approaches (part 2)

- **A. Cut "everywhere" at its source (chosen).** A widget with no Where asks the data layer for
  nothing; each widget shows its empty state; the code that only served "the whole layer" is
  removed. One rule, one seam, no dead paths.
- B. Keep the data layer able to fetch everything, and only stop widgets asking. Rejected: it leaves
  valley-wide fetching code and tests for behaviour nothing can reach, and the prompt asks to
  remove what's dead.

Parts 3–8 each have one sensible way (below).

## Part 2: an empty Where means nothing

### The rule

- **Where** (`place` / `selection`) filters everything that has a place. With neither, nothing with
  a place is shown.
- **Searched monitors** (the air-quality layer's `monitors`, and a Forecast strip's one monitor) are
  What: they show wherever they are, with or without a Where. Unchanged.
- **Ticked monitor types** (`monitorTypes`) are counted only inside Where's areas. With no Where they
  draw nothing. A layer with ticked types and searched monitors and no Where shows the searched
  monitors only.
- **Place-less Map layers** (smoke, fire, spray notices, pesticide use townships and sections,
  region fills) never used Where and keep drawing with or without one.
- `default-place` (the starter's unresolved place) stays as it is: idle until resolved.
- **Ticked types with no Where don't count for the dataset rules** (my call; they draw nothing):
  `widgetPlaceKind` returns `"monitors"` for ticked types plus searched monitors with no Where, and
  `"none"` for ticked types alone with no Where. So raw is offered with searched monitors, and part
  3's "ticked monitor types" wording only appears when there is a Where.
- **Ticks that do nothing are always explained** (the user, 2026-11-25: "say it everywhere"). One
  shared rule (ticked types, no Where) drives: a note on the Chart, Table and Map, e.g. "Add a place
  to show ticked monitor types." (the Chart's and Table's misfit notes, in their editor and viewer
  forms; the Map's `MapNotes`), and a hint under the ticks in the Data Portal's What while Where is
  empty. With no searched monitors either, the widget's empty message already says what to add, so
  the note isn't repeated there.

### What each widget does with no Where

| Widget | Today with no Where | After |
|---|---|---|
| Chart / Table, air quality, no monitors | "Add a place, or choose which monitors to show." | Unchanged |
| Chart / Table, ticked types, no searched monitors | Every monitor of the types, valley-wide | The same empty message as above |
| Chart / Table, searched monitors | The monitors | Unchanged (with ticked types too: the searched ones only) |
| Chart / Table, weather or pesticide use main | Every station / "Whole valley" total | The same empty message as above (the existing "add-where-or-monitors" empty state) |
| Current conditions, Forecast strip, Outside, calendars | Ask for a place or a monitor | Unchanged |
| Map, ticked types | Every monitor of the types | No monitor marks; a Map note says to add a place (below) |
| Map, searched monitors | The monitors | Unchanged |
| Map, schools / child care (location groups) | Every site, one valley-wide request | None; covered by the same Map note |
| Map, place-less layers | Drawn | Drawn (unchanged) |

### The Map with no Where

- The Map is made and draws whatever is left to draw (place-less layers, searched monitors).
- When a layer that needs a place has nothing because there's no Where (ticked monitor types,
  schools / child care), a Map note (the existing `MapNotes` list under the toolbar) says so: the
  shared ticked-types note above, and a like note for schools / child care (the builder words it
  through Paraglide, with no concatenated sentences).
- When nothing at all is left to draw, the Map's existing idle message applies, reworded so it asks
  for a place when a place would make something draw (`map_empty_add_layers` today says "Choose
  what this map shows in Edit data.").
- The camera with no Where: unchanged (searched monitors framed, else the map-sdk default view).
- The Map's title with no Where: unchanged (pollutant alone, or the searched monitors counted or
  named).

### The Data Portal's Where

- Empty Where reads **"None"** instead of "Everywhere".
- With searched monitors and no Where: **"None: showing the monitors chosen in What"** (the
  single-place types' existing "None: this shows one monitor" and "asks for a place or a monitor"
  stay).
- **Clear stays** (a person may want only their searched monitors). Its announcement changes from
  "back to everywhere" wording to the new meaning.
- The preview shows the empty widget's message, as on the dashboard.

### Titles

A widget whose input is empty because it has no Where must not keep a stale generated title (the
preview kept "Fresno County" after Clear). The builder makes the empty state set the title from what
the widget now is (e.g. the entry label alone, as the Map's title does with no Where), for the Chart
and Table (`DataWidget`) and any other type that sets its title only from ready data.

### What goes away

Per the inventory (file:line references as of `bf60f91`); the builder confirms each is dead before
removing it:

- `layerTarget`'s `{kind: "all"}` result for a widget with no Where (`adapters/targets.ts`), and
  `whereRegionKeys` returning `null` (a monitor-set with no Where becomes searched monitors only, or
  no target). The `monitor-set` `regionKeys: null` member, if nothing else uses it.
- Air quality's internal bulk request (`bulkReq` in `air-quality.ts`) reuses `{kind: "all"}`: keep
  what the bulk fetch by region still needs; it is not Where-related.
- `drawnWithNoWhere` (`adapters/offered.ts`) and its use in `chartInput` (`shared/input.ts`).
- Weather's every-station path: `fetchEveryStation`, `stationTypes`, the `"all"` branches in
  `adapters/weather.ts`.
- Pesticide use's valley total: `VALLEY_PLACE`, `useOf(null)`, the `"all"` branch and
  `data_place_valley` ("Whole valley") in `adapters/pesticides.ts` (this also removes the CSV
  `placeParts` mis-split of `"valley"`).
- `whole-layer-raw` (`query/client.ts`, `data/messages.ts`, `WidgetState.svelte`, the two message
  keys) if `"all"` can no longer reach it.
- Overlays: `everywhereMain`, the everywhere branch of `overlayInputsFor` (`shared/overlays.ts`),
  `noWhereNotes` and `widget_overlay_needs_place` (`shared/misfit-notes.ts`, Chart and Table).
- The Map: `whereRegionIds` returning `null` and the `"*"` scope (`map/data/scope.ts`), the null
  branch of `scopeReadings` (`map/data/monitors.ts`), `"everywhere"`, `VALLEY` and the valley
  cache entry in `map/data/locations.ts`.
- Snapshots: `{kind: "all"}` and `regionIds: null` in `data/snapshot/types.ts` and
  `snapshot/monitors.ts` `scopeRequests` (already unused in production, per the inventory).
- `get_data_where_everywhere`, and comments describing "everywhere" (`data/types.ts`,
  `data/schema.ts`, `WhereControl.svelte`, `shared/input.ts`).
- Tests asserting the everywhere behaviour change to assert the new rule (unit, browser and E2E,
  including `e2e/get-data.spec.ts`'s three "with no Where" tests and `e2e/map.spec.ts`'s valley-wide
  child care test; the E2E fake servers' valley-wide fixtures go if unused).

### Saved documents

Shapes are free before release; no compatibility code. A document with no Where parses as before
and shows the empty state. Document versioning is unchanged.

## Part 3: the raw-resolution reason

`layerOffers` (`data/dataset-rules.ts`) keeps dropping `raw` for air quality when the place kind is
`regions` or `monitor-types` (`noRaw`). The wording, approved by the user:

| Spot | Area (`regions`) | Ticked types (`monitor-types`) |
|---|---|---|
| Data resolution, a greyed level (`DataResolutionControl.svelte`) | "Air quality for an area is summarized by the hour. Search for monitors in What to see every measurement." | "Ticked monitor types are summarized by the hour. Search for monitors in What to see every measurement." |
| Adding a dataset at "every measurement" (`dataset-offer.ts`) | "Air quality for an area is summarized. Set the data resolution to {level} to add it." | "Ticked monitor types are summarized. Set the data resolution to {level} to add it." |
| A dashboard widget's misfit note (`misfit-notes.ts`, editor and viewer forms) | "{dataset} isn't shown: air quality for an area is summarized, with no individual measurements. Change the data resolution in the Data Portal." | the same with "ticked monitor types" |

- "by the hour" is the finest level offered there, from the catalog and dataset rules (not
  hardcoded); the builder phrases it through the existing level phrases, with whole-sentence
  messages per level if a translated sentence needs it.
- The viewer form of the misfit note drops the "Change … in the Data Portal" sentence, as today.
- Weather and any dataset that truly has no raw keep today's wording.
- The place-caused reason needs the place kind where each message is chosen (pass it in, or return
  the cause from the rules).

## Part 4: Forecast → the calendars

- Show as checks a range type against what switching would produce: for a draft from a now type
  (not the Map), against `fromNowDraft(draft, type)`'s data, not the unconverted forecasts layer.
  The month and year calendars are then offered.
- Switching is unchanged: `fromNowDraft` turns the Forecast strip's forecasts layer into PM2.5
  (a new widget's layer), keeping its place or its one monitor.
- **A note** (the user's choice A): the conversion adds a "what changed" note (the Data Portal's
  existing conversion notes), e.g. "The forecast is an overall AQI, so this shows PM2.5. Change the
  pollutant in What." It applies to every range type the Forecast strip converts to (Chart and Table
  too), since they convert the same way. The builder names the forecast's entry type from the
  catalog's label, not hardcoded.
- Calendar → Forecast is unchanged (never greyed; keeps the place).

## Part 5: "Data Portal" in the top nav

- `TopNav.svelte`: the "Data Portal" `<a>` takes `buttonVariants({ variant: "ghost" })` (the
  dashboard picker's trigger), so height, padding, weight and hover match.
- The current page keeps the 2 px inset underline (a shape, not colour alone) and `aria-current`.
- Check the phone top bar (the picker's `min-w-40` wrapping from #74), dark mode, and the WCAG 2.2
  target size.

## Part 6: the Map's legend starts folded

- `MapLegendOverlay.svelte`: `shown = open ?? !narrow` becomes folded unless the person opened it
  (`open ?? false`). The "Legend" button and the remembered choice are unchanged. The `narrow`
  prop goes if nothing else uses it.

## Part 7: no Ctrl while the Map is fullscreen

- Needs `@sjvair/map-sdk` `0.1.0-beta.26` (another session builds it): `MapContext.setCooperativeGestures(on)`
  and the readonly reactive `MapContext.cooperativeGestures`. Called before the map exists it's
  remembered and re-applied when `MapView` recreates its map; after `destroy()` it does nothing;
  calling it in an `$effect` doesn't make the effect depend on the setting; turning it off within
  0.1 s of a blocked gesture takes effect after that 0.1 s.
- Re-pin `@sjvair/map-sdk` from `0.1.0-beta.23` to `0.1.0-beta.26` (exact). That also brings
  `0.1.0-beta.24` and `0.1.0-beta.25`: featureclick `touch`, `tooltipOnTouch`, tapped list rows
  adding in multiple mode, the toolbar stopping at the measured controls, and 4 px narrower
  triggers. Check the Map widget's toolbar and its `Record<MessageKey>` table.
- Wiring: an `$effect` on the Map widget's `fullscreen` calls `map.setCooperativeGestures(!fullscreen)`.
  `host/config.ts` keeps `cooperativeGestures: true` at creation. The test harness's fake map
  (`map/test-harness/fake-map.svelte.ts`) gains both members.
- Built last: it waits for the publish. If `0.1.0-beta.26` isn't published by the time the rest is
  done, the user decides whether the PR waits or part 7 moves to `DEFERRED.md`.

## Part 8: the starter layout

Same seven widgets with the same data and options; only the rects change (16 rows instead of 22):

| Widget | Rect |
|---|---|
| Note | x 0, y 0, w 12, h 2 (unchanged) |
| Map | x 0, y 2, w 6, h 7 |
| Current conditions | x 6, y 2, w 3, h 3 |
| Forecast strip | x 6, y 5, w 3, h 4 |
| Outside | x 9, y 2, w 3, h 7 |
| Chart | x 0, y 9, w 6, h 7 |
| Month calendar | x 6, y 9, w 6, h 7 |

- Phones stack in reading order: Note, Map, Current conditions, Forecast strip, Outside, Chart,
  Month calendar (the user accepted this; no phone-only order).
- Check that Current conditions at 3×3 and the Forecast strip at 3×4 (their minimum sizes) read
  well; the starter's tests and any E2E relying on the starter's order or sizes; the Lighthouse/LCP
  notes from step 6 spec 1 (the Map's code now loads above the fold on wide screens).

## Constraints

- Build straight toward this design (no stop-gap UI); keep the suite green, every widget working,
  saved documents opening.
- Metadata is the source of truth (labels, levels, entry types from the catalog); all UI strings
  through Paraglide, whole sentences; theme tokens only; WCAG 2.2 AA; Pacific time via `format`.
- The initial bundle stays under the 250 KB soft budget (217.1 KB on `main`).
- No changes to sdk-js, map-sdk, monitor-map, mobile or sjvair.com from this branch.

## Docs

- `ARCHITECTURE.md`: "No Where means everywhere" and the What/Where section ("What is the data;
  When and Where are filters for it") change to the new rule; the other mentions the inventory
  lists (Data Portal "Everywhere", valley-wide requests, locations valley-wide).
- `DEFERRED.md`: add the unreproduced preview bug; close or update "Overlays with no Where" (no
  everywhere main remains); update "The Map's schools and child care sites are kept for the
  session" (no valley-wide list); update the spec 7a leftovers that mention valley-wide requests or
  "a widget with no Where"; any new deferral from this work.
- `TODO.md` / `ROADMAP.md`: this work's status.

## Left to the builder

- Exact wording of the Map note(s), the reworded Map idle message, the Clear announcement, and the
  Forecast conversion note (in the spirit above; shown to the user in the PR).
- Where the place-caused raw reason is decided (rules returning a cause, or the caller passing the
  place kind).
- Removal order and test rewrites.
