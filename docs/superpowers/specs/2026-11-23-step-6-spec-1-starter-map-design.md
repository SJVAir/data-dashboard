# Release 1, step 6, spec 1: the Map in the starter, and the low-end device check

Status: brainstormed with the user 2026-11-23; checked by a fresh builder read (two questions:
one answered by the user, the rest as my calls, decisions 19–21). Branch `step-6-spec-1` from `step-6` (7951f5b);
its PR goes into `step-6`.

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's,
or was decided before this spec (noted where it matters).

## Where this sits

Step 5 (the Map widget) is in `main` (#68, 325e44e). Step 6 is "the Map in the starter, and
go-live" (`ROADMAP.md` item 6, `TODO.md` → "Release 1, step 6"). This is its first spec. It
does the two things step 6 has before go-live: the starter gains its Map (DEFERRED "The Map
joins the starter in step 6."), and the low-end device check (`ARCHITECTURE.md` → "A low-end
device check before go-live") runs against the starter with its Map.

## Why

The starter is what a first-time visitor (a parent, a teacher, a student, a researcher, an
agency) sees at `/workspace/`. The Map is the view of the Valley people already know from
sjvair.com, and the step 4 layout kept a row for it. The device check is the last look at
speed before go-live: a school Chromebook on a slow connection has to get a usable starter.

## Goals

1. **The starter's Map:** a full-width row under the "now" row, showing PM2.5 now at the
   starter's chosen place, every monitor type ticked, with smoke and fire.
2. **The starter's monitor types come from metadata** (no type ids in the template), and every
   way out of the starter stores them.
3. **A rerunnable Lighthouse check** of a production build on a throttled mobile profile: a
   first visit (the starter with its Map) and a visit with a saved dashboard, each with
   compressed and uncompressed delivery; plus one read-only run against the local stack.
4. **The numbers reported to the user**, with every finding either fixed in this spec or
   brought to the user. Nothing gets parked by severity without asking.

## Non-goals

- **Showing which widgets "Change place" moved.** It stays deferred (the user, 2026-11-23). Its
  trigger drops "the step 6 starter review" and keeps "the first usability testing". In the
  starter every widget with a place follows the bar, the Map included, so the starter can't
  show the gap.
- **Changing how widget code loads** (for example, waiting until the Map nears the screen)
  ahead of the numbers. See "First-visit cost" and decision 20.
- Spray notices, pesticide use, a region fill or alert levels on the starter's Map (smoke and
  fire only; the starter's tiles have no alert levels, decided 2026-11-10).
- A new widget's pollutant from the monitors meta's `default_pollutant` (DEFERRED; it stays
  PM2.5, the user's call of 2026-11-22).
- The real older Chromebook: that stays a hand check for the user. Nothing in this spec claims it
  was done.
- Go-live itself (enabling the route), and anything in production.

## Anti-goals

- Monitor type ids, pollutant ids, labels or colours in starter code. The template stays
  synchronous and metadata-free.
- A starter that blocks its first paint on the catalog.
- A copy of the starter (first edit, share, New from starter, Duplicate, Export) that stores a
  Map with no types just because the catalog arrived late.
- Compatibility code for older saved dashboards (nothing is live). The document versioning
  code (`schemaVersion`, `load.ts`, `migrate-changes.ts`) stays as it is.

## Decisions

### The Map's place in the starter

1. **Layout** (decided 2026-11-10, DEFERRED): a full-width row under the "now" row. Rows of
   the 12-column grid become: the welcome Note `{0,0,12,2}`; the "now" row at y 2, h 7
   (unchanged); **the Map `{x 0, y 9, w 12, h 7}`**; the Chart `{0,16,8,6}` and the month
   calendar `{8,16,4,6}`.
2. **Height: 7 rows** (my call), the same as the "now" row: about 520 px (rows are 4rem plus a
   0.75rem gap). At about 1280 px wide the Map is about 2.4 times as wide as it is tall. The
   Map's own default of 6 rows makes a thin strip at full width, and 8 rows pushes the Chart
   well down.
3. **Phones and narrow widths:** nothing new. Below `48rem` the grid is one column and each
   widget keeps its own height, so the Map is full width and 7 rows tall. Its legend folds
   into a "Legend" button below 360 px of widget width (existing behaviour).
4. **Its place is the template's `default-place`**, so `resolveDefaultPlace` gives it the
   chosen place. "Change place" and "Duplicate for another place" move it like the other
   one-place widgets (`replacePlace` swaps only the place and keeps the layer's ticks). It is
   not areas-only, so a school or point stays a school or point on the Map (unlike the Chart).

### The Map's data and options

5. **Layers:** PM2.5 (`DEFAULT_LAYER`'s dataset and entry type, as `mapStartData` builds it)
   plus smoke and fire (the user, 2026-11-23): the template holds them exactly as Get data
   stores them (`setSmokeAndFire`: `{ dataset: HMS_SMOKE }`, `{ dataset: HMS_FIRE }` after the
   pollutant). Smoke and fire draw nothing when there is none, and the toolbar gets its smoke
   and fire switch.
6. **Now** (no `dateRange`), and **no options stored** (my call): the default basemap, clusters
   as map-sdk's preset sets them, no fill, inactive and indoor monitors hidden, no marks.
   That's what a new Map looks like.
7. `starter.test.ts`'s check, "each widget's data is what Get data stores for its type", covers
   the Map too: the template's Map data, resolved and given types, equals `mapStartData` with
   those types plus `setSmokeAndFire(on)`.

### Monitor types (approach A, the user, 2026-11-23)

8. **The app holds the catalog's monitor types, the way it holds the starter's area.** The app
   context gets the starter's types: unknown until loaded, then a list (`everyMonitorType` of
   the catalog; possibly empty). The load is lazy (dynamic import of `$lib/data`, so the
   initial bundle doesn't grow) and uses the same rule as a new Map: wait up to
   `CATALOG_WAIT_MS`, and a catalog that fails or is late gives an empty list, which is
   reported (`report`) on failure. **(my call)** Share one helper between
   `mapStartDataWithTypes` and the app rather than two copies of that rule.
9. **Building the starter takes the types:** `starterDashboard(place, area, types)` and
   `copyOfStarter(now, place, area, types)` put `monitorTypes` on the Map's air-quality layer
   when `types` is non-empty. The template (`starterTemplate()`) stays synchronous and has none.
   This is a signature change the coordinator has been told about.
10. **The starter shows at once.** While the types are unknown, the starter session is built
    without them. When they arrive, and the starter hasn't been edited (no hand-off started),
    the app swaps in a fresh starter session that has them, the way `changeStarterPlace`
    already does. In practice the types arrive before the Map's code has loaded (see "First-visit
    cost"), so nobody sees the "no monitors chosen" note in between. **(my call)** The swap
    must not cost the person anything: no focus jump and no lost fullscreen. If the builder
    finds it does, that's a miss to fix, not a new question.
11. **Every exit waits for the types before it stores anything:** the first edit's hand-off
    (`onBeforeFirstEdit` is already asynchronous), sharing (`copyStarter`), New from starter,
    Duplicate and "Duplicate for another place" from the starter, and Export of the starter.
    Each stores the explicit list, the same as a new Map. With an empty list (no catalog), the
    copy has no types and its Map shows the existing "no monitors chosen" note with its "Edit
    data" action.
    (Amended by step 6 spec 2, decision 12: edits made during the wait show at once; storing
    still waits.)
12. **"Clear my data" and a new chosen place keep the rule:** the types aren't per place, so a
    place change rebuilds the starter with the types already held. The types are not a stored
    preference (**my call**): they're re-read from the catalog each visit, since metadata is
    the source of truth.

### First-visit cost

13. **Measured during the brainstorm** (production build of 7951f5b): the initial bundle is
    215.3 KB of the 250 KB budget, and the starter doesn't change that (`starter.ts` must not
    import `$lib/data` or the Map's module statically; check `npm run check:budget` after
    every change to it). But the Map's lazy chunk (map-sdk with MapLibre) is **428 KB
    compressed (1.58 MB uncompressed)**, and a widget's code loads as soon as the widget
    mounts, even off screen (`OnScreen` only governs the live map). So a first visit's
    JavaScript goes from about 215 KB to about 640 KB compressed, or about 2.2 MB as S3 serves
    the files today.
14. **No loading change ahead of the numbers** (my call, told to the user). The Lighthouse
    check measures it. If it shows slow loads, the fix (most likely: load a widget's code only
    when it nears the screen) is brought to the user with the numbers.

### The low-end device check (approach B, the user, 2026-11-23)

15. **Lighthouse, scripted and rerunnable**, as the spec's last task. The mobile preset's
    throttling (4× CPU, slow 4G), three runs per case, median reported. Lighthouse is
    Apache-2.0. If it becomes a dev dependency it goes through the licence check
    (`vite-plugins/licenses.ts`, if that covers dev dependencies; the builder checks).
16. **Run 1, the fakes:** the production build served the way the E2E suite serves it, with
    the server's responses from the E2E fakes and fixtures (metadata, data, documents, stubbed
    MapTiler tiles with the dummy key). Four cases:
    - a first visit (a fresh profile, so `/workspace/` shows the starter with its Map);
    - a visit with a saved dashboard (the same profile after the starter was copied);
    - each with the files served **compressed** and **uncompressed** (the way S3 serves them
      today, DEFERRED "Upload compression, cache headers…").
    How the fakes reach a Lighthouse-driven browser (Playwright routes over CDP, or a small
    fixture server behind the preview's proxy) is the builder's choice; find out on the day
    what works.
17. **Run 2, the local stack, read-only:** one run against the stack's `/workspace/` (the real
    template embedding, real data, real MapTiler tiles with the key from `.env`), signed in as
    the E2E test user (`WORKSPACE_E2E_*`) to pass the beta-tools gate. Rules: message the
    coordinator before touching the stack; only during the user's working hours and outside
    :40–:50; only page loads and a login, **nothing that writes**, so no saved-dashboard case
    here. It measures whatever that account opens to (the starter only if it has no
    dashboards; report which). It also measures whatever dashboard build the stack serves:
    record its version (`version.json`) and ask the coordinator if a current one is needed.
    If the gate or the stack makes the run impossible, say so and keep run 1's numbers. Never
    print the MapTiler key or the password.
18. **What's reported, per case:** the performance score, FCP, LCP, TBT, Speed Index, total
    bytes and script bytes, with the Map chunk's share. Results saved as files, not committed
    if they hold anything private (**my call**: commit the script and a summary only).
19. **What counts as a finding** (my call, from the builder check): a miss on Google's "good"
    Core Web Vitals thresholds, measured on the throttled mobile profile: LCP over 2.5 s, TBT
    over 200 ms (the lab stand-in for INP), CLS over 0.1. Audits that fail only because of the
    setup (`vite preview`'s cache headers, MapTiler tiles stubbed in the fakes) are reported,
    with that said, but aren't findings. Each finding is fixed in this spec or brought to the
    user, never parked by severity without asking.
20. **A fix the user approves lands in this spec** (the user, 2026-11-23). The plan ends with a
    conditional task: if the numbers show slow loads and the user approves the fix (most likely
    loading a widget's code only when it nears the screen, decision 14), build it with its tests
    and rerun the Lighthouse cases. Without a finding, or without the user's yes, the task
    doesn't run.
21. **The drag and resize items** (my call, from the builder check): Lighthouse measures page
    loads, not dragging or a resize animation. Their "Looked at in step 6 spec 1" notes say so,
    give the starter's TBT, and keep the items open for the real Chromebook. No new drag or
    resize measurement is built.

## DEFERRED.md entries this spec touches

- **Done:** "The Map joins the starter in step 6." (removed, with ARCHITECTURE's starter
  section updated: the layout as built, the Map's data, and where the types come from).
- **Fired by the starter holding a Map:** "Step 5 spec 2 review leftovers" → "Test gaps kept":
  replace the hand-built session in the starter hand-off test with the real starter, and remove
  the item.
- **Fired by the Lighthouse check:** add a "Looked at in step 6 spec 1" note, with the numbers,
  to "Drag performance threshold is loose, and its calibration is approximate." and "Map
  widgets redraw every frame of a resize animation."; and to "Upload compression, cache
  headers…" (whose trigger is slow loads), with the compressed vs. uncompressed numbers and
  whatever the user decides.
- **Kept open:** `TODO.md`'s and `ARCHITECTURE.md`'s low-end check stay open for the real
  Chromebook.
- **Changed trigger:** "Which widgets \"Change place\" moves isn't shown anywhere." drops "the
  step 6 starter review" (the user, 2026-11-23).
- **Check, and note "Looked at in step 6 spec 1" if unchanged:** "The starter hand-off can set
  the current dashboard after the person has left for a shared page.", "A starter journal
  record can outlive its copy.", "A starter replay can take a live tab's journal record.",
  "Another tab's starter shows a new chosen place only after reload.", "Widget state across the
  starter's first edit in fullscreen." (the types swap in decision 10 is new starter
  rebuilding: check it against this one), and "Step 4 spec 6 review leftovers" (its starter
  items).
- Grep on the day for "starter", "step 6", "Change place" and "first visit"; any new deferral
  goes in with why and a revisit trigger.

## Testing

- Unit: the template's layout and the Map's data (decision 7); `starterDashboard` and
  `copyOfStarter` with and without types; the types loader (catalog, late catalog, failure).
- App: the starter swaps in types when they arrive; an edit before they arrive waits and the
  copy stores them; a place change keeps them; "Clear my data" mid-load; every exit in
  decision 11 stores the list.
- The real starter hand-off test (the DEFERRED test gap).
- E2E (`e2e/starter.spec.ts`, using the existing map fakes): the starter shows the Map in its
  row with smoke and fire, "Change place" moves it, a first edit's copy keeps its types; the
  a11y check covers the starter with the Map. Run under `TZ=America/New_York` too.
- Controller-side Playwright screenshots of the starter: desktop and a phone width, light and
  dark.
- `npm run check:budget` after each change near `starter.ts`; report the number.

## Left to the builder

- The exact shape of the types state and helper, and how the swap in decision 10 reuses
  `changeStarterPlace`'s path.
- How Lighthouse is driven and how the fakes reach it (decision 16), the script's location and
  npm script name, and the results' format.
- Message keys for anything new (none expected).

## Build calls

Decided while building (2026-11-23). Calls by the build's controller, then the user's.

- **The controller's rulings:**
  - `DashboardList` passes the starter's area early. The plan's Task 3 lists it, and it costs
    nothing if wrong.
  - A starter that isn't the current one is replaced in the app's cache, not discarded, so holders
    like Add or Share stay usable. Home reads again after setting the current dashboard and swaps
    or discards the old one. Why: decision 10 (no Map shown without its types). If wrong, a left
    over session keeps its listeners until its hand-off or the page closes (a deferred leftover).
  - The types wait never rejects: a failed catalog gives an empty list, so the starter can still
    be edited.
  - A Map's title reads "Map" until its code loads (Task 6). The title is worked out in the Map's
    lazy module, and moving it is a refactor beyond the approved fix. Deferred in `DEFERRED.md`.
  - A Map frame's "already loaded" state is not reactive. A waiting off-screen Map loads once it
    nears the screen (the code is cached by then, so it is instant).
- **The user's five decisions after the first Lighthouse numbers:**
  1. The speed fix, loading a widget's code when its frame nears the screen, is built in this
     spec (decision 20; Task 6).
  2. Compressed uploads before go-live: on hold. "Upload compression, cache headers…" in
     `DEFERRED.md` keeps its go-live trigger, with the numbers.
  3. The startup chain's LCP (5.3 s with gzip even without the Map) is recorded in `DEFERRED.md`,
     to revisit at go-live.
  4. Lighthouse runs through a pinned `npx lighthouse@13.6.0`, not a dev dependency: its
     transitive dependencies carry FSL-1.1 and BlueOak-1.0.0 licences that aren't on the allow-list.
  5. A generated Map title names the map ("PM2.5 map · Fresno County"), so the starter's Map and
     "Current" no longer share a title (Task 6b).
- **Tasks added after the plan, with the user's approval:** Task 6 (the speed fix) and Task 6b
  (the Map's generated title).
- **Results:** `docs/reference/lighthouse-2026-11-23.md`. After the fix, TBT passes in all four
  cases (115–152 ms); LCP still misses, as the welcome Note's text waits for the app chunk.
