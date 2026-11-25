# Step 6 spec 1: the Map in the starter, and the low-end device check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The starter gains a full-width Map (PM2.5 now, every monitor type from the catalog,
smoke and fire), every exit from the starter stores those types, and a rerunnable Lighthouse
check measures the starter on a throttled mobile profile.

**Architecture:** The template stays synchronous and metadata-free. The app holds the
catalog's monitor types (like the starter's area), passes them into `starterDashboard` and
`copyOfStarter`, swaps in a starter that has them when they arrive, and makes every exit wait
for them. Lighthouse runs from a script against the production build with the E2E fakes, plus
one read-only run against the local stack.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest (unit + browser mode), Playwright,
Lighthouse (Apache-2.0).

**Spec:** `docs/superpowers/specs/2026-11-23-step-6-spec-1-starter-map-design.md` (decision
numbers below are the spec's). Executors read both.

## Global Constraints

- Metadata is the source of truth: no monitor type id, pollutant id, label or colour in starter
  or widget code. `DEFAULT_LAYER`, `HMS_SMOKE`, `HMS_FIRE` are the only ids the template uses.
- `starter.ts` is in the initial bundle: no static import of `$lib/data` or the Map's module.
  Run `npm run check:budget` after any change to it and report the number (215.3 KB of 250 KB
  before this spec).
- Nothing is live: no compatibility code for older saved dashboards. `schemaVersion`,
  `load.ts`, `migrate-changes.ts` stay as they are.
- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- Every UI string through Paraglide (none new expected).
- Commits are GPG-signed, with no Claude/AI attribution and no `Co-Authored-By` or
  `Claude-Session` lines. Stage by path, never `-A`. Never `git stash`. Run git commands one at a
  time.
- Run the Vitest suites one after another, never in parallel; rerun a browser test alone
  before calling a failure a bug.
- Before an E2E run, check nothing stray is on port 4173 (`ss -ltnp | grep 4173`).
- E2E also under `TZ=America/New_York`.
- Don't touch the shared stack except as Task 5 says; never print the MapTiler key, a password,
  phone numbers or a person's coordinates.
- Every deferral goes in `DEFERRED.md` with why and a revisit trigger, in the same commit.

## Review Focus

1. **An edit before the types arrive:** the person drags a widget while the catalog is still
   loading; the copy must store the full type list once it arrives, not an empty one (Task 3,
   "first edit before the types arrive").
2. **The catalog can't be read:** the starter still renders. The Map shows the existing "no
   monitors chosen" note, and copies store no types instead of hanging (Task 3, "catalog
   unavailable").
3. **Change place while the types load:** exactly one fresh starter, at the new place, ends up
   with the types. A late answer never brings back the old place (Task 3, "place change during
   the load").
4. **The swap under a fullscreen widget or an open dialog:** widget ids (`starter-1` …
   `starter-7`) and `app.current.isStarter` stay the same across the swap, so a fullscreen URL
   and the Change place dialog survive it (Task 3, "swap keeps widget ids").
5. **Phone width:** one column, the Map full width and 7 rows tall, its legend folded only below
   360 px of widget width (Task 4, the screenshots plus the E2E phone check).

---

### Task 1: One loader for the catalog's monitor types

**Files:**
- Modify: `src/lib/widgets/map/start.ts`
- Test: `src/lib/widgets/map/start.test.ts`

**Interfaces:**
- Produces: `loadMonitorTypes(): Promise<string[]>` in `start.ts`: `everyMonitorType` of the
  catalog, `[]` when the catalog is `"unavailable"`, late past `CATALOG_WAIT_MS`, or throws
  (a throw is `report`ed). It keeps `$lib/data` behind a dynamic import, as today.
  `mapStartDataWithTypes(doc)` becomes `mapStartData(doc, await loadMonitorTypes())`.

- [ ] **Step 1: Failing tests** in `start.test.ts` under `describe("loadMonitorTypes")`:
  "every air-quality monitor type from the catalog" → `["airnow", "purpleair"]` with the
  file's mocked catalog; "an unavailable catalog gives none" → `[]`; "a late catalog gives
  none after CATALOG_WAIT_MS" (fake timers) → `[]`; "a failing catalog gives none and is
  reported" → `[]` and `report` called once.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/widgets/map/start.test.ts`. Expected: FAIL
  (`loadMonitorTypes` not exported).
- [ ] **Step 3:** Move the body of `mapStartDataWithTypes` into `loadMonitorTypes`; make
  `mapStartDataWithTypes` call it.
- [ ] **Step 4:** Same command. Expected: PASS, the existing `mapStartDataWithTypes` tests too.
- [ ] **Step 5:** Commit: `Map: one loader for the catalog's monitor types`.

### Task 2: The template's Map row, and building the starter with types

**Files:**
- Modify: `src/lib/starter/starter.ts`
- Modify (callers, minimal; Task 3 wires the real types): `src/lib/store/dashboard-index.svelte.ts`,
  `src/lib/sharing/actions.ts`, `src/lib/actions/dashboard.ts`, `src/routes/DashboardList.svelte`,
  `src/lib/store/app.svelte.ts`
- Test: `src/lib/starter/starter.test.ts`, `src/lib/starter/resolve.test.ts` if it counts widgets

**Interfaces:**
- Produces:
  - Template widgets (reading order): Note `{0,0,12,2}`, Current `{0,2,3,7}`, Outside
    `{3,2,3,7}`, Forecast `{6,2,6,7}`, **Map `{0,9,12,7}`**, Chart `{0,16,8,6}`, month calendar
    `{8,16,4,6}`. Ids `starter-1` … `starter-7` in that order. Map data:
    `{ place: default-place, layers: [{ dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType }, { dataset: HMS_SMOKE }, { dataset: HMS_FIRE }] }`, no `options`, no `dateRange`.
  - `starterDashboard(place: ChosenPlace, area: ChosenPlace | null | undefined, types: readonly string[]): Dashboard`
    — as today, plus `monitorTypes: [...types]` on the Map's air-quality layer when
    `types.length > 0`.
  - `copyOfStarter(now: Date, place: ChosenPlace, area: ChosenPlace | null | undefined, types: readonly string[]): Dashboard`.
  - `StarterSessionOptions` gains `types: readonly string[]` (what the shown starter holds) and
    `typesReady: () => Promise<readonly string[]>` (awaited in `onBeforeFirstEdit` before
    `copyOfStarter`).
  - `DashboardIndex.createFromStarter(place, area, types)` and `duplicate(id, { from, to, area?, types? })`
    (`types` used only for `STARTER_ID`).
  - In this task every caller passes `[]` / `async () => []`; Task 3 replaces them.

- [ ] **Step 1: Update and add tests in `starter.test.ts`:**
  - "holds the seven widgets in reading order, each at default-place" (types: note, current,
    outside, forecast, map, chart, month calendar).
  - The layout test keeps its "rows, min sizes, no overlaps" assertions and pins the Map at
    `{x:0,y:9,w:12,h:7}` and the Chart/calendar at y 16.
  - "each widget's data is what Get data stores for its type": add
    `expect(map.data).toEqual(withSmoke(mapStartData(resolvedDoc, [])))` where `withSmoke`
    applies `setSmokeAndFire(data, true)` to a clone, and the same with types `["a","b"]`
    through `starterDashboard(FRESNO, null, ["a","b"])`.
  - "starterDashboard ticks the given types on the Map only": the Map's air-quality layer has
    `monitorTypes: ["a","b"]`, no other widget gains `monitorTypes`; with `[]` the key is absent.
  - "the template holds no monitor types": `JSON.stringify(starterTemplate())` has no
    `monitorTypes`.
  - starterSession: "the first edit's copy waits for typesReady and stores its types"
    (`typesReady` resolves `["a"]` after the edit; the stored copy's Map has `["a"]`).
- [ ] **Step 2:** `npx vitest run --project unit src/lib/starter/`. Expected: FAIL.
- [ ] **Step 3:** Implement the template row and the signatures above; update callers to pass
  `[]` so `npm run check` passes.
- [ ] **Step 4:** `npx vitest run --project unit src/lib/starter/` then `npm run check`. Expected:
  PASS, 0 errors. Then `npm run build && npm run check:budget`; report the number.
- [ ] **Step 5:** Commit: `Starter: the Map row, built with the catalog's monitor types`.

### Task 3: The app holds the types; the starter swaps them in; every exit waits

**Files:**
- Modify: `src/lib/store/app.svelte.ts`, `src/lib/sharing/actions.ts`,
  `src/lib/actions/dashboard.ts`, `src/routes/DashboardList.svelte`,
  `src/lib/store/dashboard-index.svelte.ts` (only if Task 2 left a gap)
- Test: `src/lib/starter/exits.test.ts` (add a `describe("the starter's monitor types")`)

**Interfaces:**
- Consumes: `loadMonitorTypes()` (Task 1); the Task 2 signatures.
- Produces on `AppContext`:
  - `starterTypes: readonly string[] | null` — `null` until loaded (raw state).
  - `starterTypesReady(): Promise<readonly string[]>` — starts the load once per app (memoized;
    not a stored preference, decision 12) and resolves to the list.
- Behaviour:
  - `#starter()` builds with `this.starterTypes ?? []` and `typesReady: () => this.starterTypesReady()`,
    and starts the load if `starterTypes` is `null`.
  - When the load resolves: set `starterTypes`. If the starter is live, not edited (no hand-off
    started) and was built without types, replace it with a fresh `#starter()` exactly as
    `changeStarterPlace` does (same `#open`/`#live`/`current` handling). Widget ids are
    unchanged, so fullscreen and open dialogs keep their target.
  - Exits await `app.starterTypesReady()` before building: Export (`targetOf` in
    `sharing/actions.ts`), Duplicate and "Duplicate for another place" of the starter
    (`actions/dashboard.ts`), New from starter (`actions/dashboard.ts` and
    `DashboardList.svelte`, which also passes `app.starterArea` now; today it passes none),
    sharing (through the hand-off's `typesReady`).
  - `resetAfterClear` keeps `starterTypes` (metadata, not the person's data).

- [ ] **Step 1: Failing tests** in `exits.test.ts`, mocking `loadMonitorTypes` (via
  `vi.mock("$lib/widgets/map/start", …)` keeping the rest of the module) with a controllable
  promise:
  - "the starter shows at once without types, then with them" — `sessions.get(STARTER_ID)`
    resolves before the types; after they resolve, `app.current.session.doc`'s Map has them.
  - "swap keeps widget ids" — the ids before and after are `starter-1` … `starter-7`, and
    `app.current.isStarter` stays `true`.
  - "first edit before the types arrive" — apply a move, then resolve the types; the stored
    copy's Map has the full list.
  - "an edited starter isn't swapped" — after the hand-off started, resolving the types leaves
    `app.current.session` as the copy.
  - "place change during the load" — `changeStarterPlace(TULARE)` before the types resolve; one
    starter afterwards, at Tulare, with the types.
  - "catalog unavailable" — `loadMonitorTypes` resolves `[]`; the starter renders and New from
    starter stores a Map with no `monitorTypes`.
  - Each exit stores the list: New from starter, Duplicate, Duplicate for another place, Export,
    sharing (`copyStarter`), the first edit — extend the existing `expectFromStarter` with the
    Map's `monitorTypes`.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/starter/exits.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as in Interfaces.
- [ ] **Step 4:** `npx vitest run --project unit` then `npx vitest run --project browser` (one
  after the other), `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 5:** Commit: `Starter: the app holds the monitor types; exits wait for them`.

### Task 4: The real starter in tests, E2E, and a look at it

**Files:**
- Modify: `src/lib/widgets/map/map-widget.browser.test.ts` ("hands a mark on the starter off
  to its copy")
- Modify: `e2e/helpers.ts` (`STARTER_TITLES`: the Map's title after "Forecast · Fresno County",
  read from the running app, not invented), `e2e/starter.spec.ts`, `e2e/a11y.spec.ts` if it
  lists the starter's reading order
- Modify: `DEFERRED.md` ("Step 5 spec 2 review leftovers" → remove "Test gaps kept")

**Interfaces:**
- Consumes: Tasks 2–3.

- [ ] **Step 1:** Rewrite "hands a mark on the starter off to its copy" to use the real starter
  (`app().sessions.get(STARTER_ID)` or `starterSession` with the real template) instead of the
  hand-built session; it renders the starter's Map widget and checks the mark lands on the
  stored copy and not on the starter.
- [ ] **Step 2:** Run it alone: `npx vitest run --project browser src/lib/widgets/map/map-widget.browser.test.ts -t "starter"`.
  Expected: PASS.
- [ ] **Step 3:** E2E in `starter.spec.ts`: "the starter shows the Map full width under the now
  row, with smoke and fire" (its frame spans the grid's width; its toolbar has the smoke and fire
  switch on); "Change place moves the Map" (its title names Tulare County); "the first edit's
  copy keeps the Map's monitor types" (read the stored copy as the existing test does, Map layer
  `monitorTypes` equals the fixture catalog's air-quality `monitor_types`); "on a phone the Map
  is full width" (390 px viewport). Update the reading-order a11y test to include the Map.
- [ ] **Step 4:** `npm run test:e2e`, then `TZ=America/New_York npm run test:e2e`. Expected:
  PASS.
- [ ] **Step 5:** Controller: Playwright screenshots of the starter at 1280×800 and 390×844,
  light and dark, saved to the scratchpad; look at them for gaps or overlap.
- [ ] **Step 6:** Commit: `Starter: the real starter in the Map hand-off test, and E2E for its Map`.

### Task 5: Lighthouse, scripted, and the report

**Files:**
- Create: the Lighthouse script (location and runner are the builder's choice; a Playwright
  project outside `test:e2e` that reuses `e2e/fixtures.ts`'s fakes is one option) and an npm
  script `perf:lighthouse`
- Create: `docs/reference/lighthouse-2026-11-23.md` (summary only)
- Modify: `package.json` (dev dependency, if any), licence check if it covers dev dependencies

**Interfaces:**
- Consumes: the production build (`npm run build`).

- [ ] **Step 1:** Find out what works on the day: Lighthouse against a production build with
  the fakes reaching it (Playwright routes over CDP, or a small fixture server behind a
  proxy). Serve the files with compression explicitly on and off (don't rely on `vite
  preview`'s defaults). If Lighthouse becomes a dev dependency, confirm its licence (Apache-2.0)
  passes the project's rules.
- [ ] **Step 2:** The script runs four cases, three runs each, median: first visit (fresh
  profile, the starter) and saved dashboard (same profile after a copy exists), each compressed
  and uncompressed. Lighthouse's mobile preset (4× CPU, slow 4G). Per case: score, FCP, LCP,
  TBT, CLS, Speed Index, total bytes, script bytes, the Map chunk's bytes. Raw results go to an
  ignored folder; nothing private is committed.
- [ ] **Step 3:** Run it: `npm run build && npm run perf:lighthouse`. Expected: a table for the
  four cases.
- [ ] **Step 4:** The stack run (decision 17): message the coordinator first; only during the
  user's working hours, outside :40–:50; sign in as the E2E test user (env vars right before the
  command, never stored); page loads only, nothing that writes; record the stack's
  `version.json` and what the account opened to. If impossible, say why.
- [ ] **Step 5:** Write the summary doc. Findings are misses on LCP > 2.5 s, TBT > 200 ms or
  CLS > 0.1 (decision 19); setup-only audits are listed as such.
- [ ] **Step 6:** Commit: `Lighthouse: a rerunnable low-end check of the starter`.
- [ ] **Step 7: STOP.** The controller reports the numbers and every finding to the user, with
  a recommendation for each, and waits.

### Task 6 (conditional): the approved speed fix

Runs only if Task 5 found slow loads **and** the user said yes to a fix (decision 20). The
user's approved fix defines its interfaces. The expected one is loading a widget's code only
when its frame nears the screen (the same `rootMargin` idea as `OnScreen`), with a placeholder
of the frame's size until then.

- [ ] **Step 1:** Write the fix's tests first (a widget off screen loads no code; scrolling it
  near loads it; keyboard focus into it loads it; fullscreen loads it at once).
- [ ] **Step 2:** Implement, run unit, browser and E2E suites, `check:budget`.
- [ ] **Step 3:** Rerun `npm run perf:lighthouse`; add the after numbers to the summary.
- [ ] **Step 4:** Commit.

### Task 7: Docs

**Files:** `ARCHITECTURE.md` (Starter dashboard: layout as built, the Map's data, where the
types come from, the exits waiting; the low-end check stays open for the Chromebook),
`DEFERRED.md`, `TODO.md`, the spec (a "Build calls" section).

- [ ] **Step 1: DEFERRED:**
  - Remove "The Map joins the starter in step 6."
  - "Which widgets \"Change place\" moves isn't shown anywhere.": drop "the step 6 starter
    review" from its trigger.
  - "Looked at in step 6 spec 1" notes, with numbers: "Drag performance threshold is loose…"
    and "Map widgets redraw every frame of a resize animation." (Lighthouse doesn't measure
    them; the starter's TBT; still open for the Chromebook, decision 21); "Upload compression,
    cache headers…" (compressed vs. uncompressed numbers and the user's decision).
  - Check each and add "Looked at in step 6 spec 1" if unchanged: "The starter hand-off can set
    the current dashboard after the person has left for a shared page.", "A starter journal
    record can outlive its copy.", "A starter replay can take a live tab's journal record.",
    "Another tab's starter shows a new chosen place only after reload.", "Widget state across
    the starter's first edit in fullscreen.", "Step 4 spec 6 review leftovers" (starter items).
  - Every parked minor from the ledger, with why and a trigger.
- [ ] **Step 2:** `npm run lint`. Expected: clean.
- [ ] **Step 3:** Commit: `Docs: the Map in the starter, and the low-end check's numbers`.

### Finish (controller)

- [ ] Final whole-branch review and its single fix wave.
- [ ] Merge `origin/step-6`, push `-u origin step-6-spec-1`, open the PR into `step-6`, and tell
  the coordinator.
- [ ] `gh workflow run ci.yml --ref step-6-spec-1` for `e2e-full`; watch the final head's runs
  with `gh run watch <id>`.
- [ ] Ask the user before merging.
