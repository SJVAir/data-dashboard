# TODO / Current Status

Last updated: 2026-09-24

## Start here

**⏸ Resume here: final-review decisions in progress (paused 2026-09-24).** A three-way
final review found 12 gaps; #1–#3, #8, and #9 are decided (map-sdk split, dropdown
picker, dataset definition). Continue **one at a time** with these proposed defaults,
updating the docs after each:

- [x] **#4 Resolution for data without summaries**: catalog-driven; daily-native data
      as-is; weather/PM10 raw with a span cap, downsampled in a worker; server summaries
      for them deferred. See `ARCHITECTURE.md` → "Data resolution & live refresh".
- [ ] **#5 Document identity and share route.** Proposed:
  - the server keeps client-generated UUIDs
  - a new `/s/:shareToken` read-only route with "Make a copy"
  - `link` documents can be viewed without an account
  - `public` is reserved until templates ship
  - the server stores the body as opaque JSON with a size cap
- [ ] **#6 Sync scope and sign-out.** Proposed:
  - all documents sync once signed in
  - sign-out offers "keep on this device / remove"
  - preferences stay local in Release 1
  - "Clear my data" never deletes server copies
- [ ] **#7 Rolling ranges when staged or shared.** Proposed: dashboards keep ranges
      rolling; "Mark for analysis" freezes them to absolute Pacific dates, with a "keep
      rolling" toggle in the Collections drawer.
- [ ] **#10 CSRF.** The server's API views (resticus) are `csrf_exempt`, and Release 1
      adds the first cookie-authenticated writes. Proposed: new session-authenticated
      write endpoints require `X-CSRFToken`, and the SDK sends it from the `csrftoken`
      cookie when no `apiToken` is given.
- [ ] **#11 Email alerts.** `User.email` is optional and unverified, and
      `USERNAME_FIELD = phone`. Proposed: email alerts require a verified email (a new
      flow mirroring phone verification) plus one-click unsubscribe. Also confirm that a
      required phone number is acceptable for people who only want server-saved
      documents.
- [ ] **#12 Existing SMS subscriptions.** Proposed: migrate each `Subscription` into a
      monitor rule that reproduces today's behavior exactly, and keep the legacy
      endpoints as a compatibility facade so v3-mobile works unchanged.

After these, push `planning` (ask first).

**Planning is complete (2026-09-23 → 2026-09-24, branch `planning`).** All IDEA.md Open
Questions and the follow-up gaps are resolved and recorded in `ARCHITECTURE.md`;
sequencing is in `ROADMAP.md`; every deferral is in `DEFERRED.md`.
A full traceability review against IDEA.md (2026-09-24) fixed the remaining gaps
and decided nine follow-ups (more were settled later that day: the fresh start and the
v1-lessons step, the deploy model, the sign-in staging, `analyzable` and the 3-day window,
the private preview and go-live, and the full test gate on PRs into `main`): minimal Collections in Release 1, autosave with durability
safeguards, server documents in Release 1, dataset accordions as layers, Pacific time,
hosting under `sjvair.com/dashboard/`, an installable app shell, WCAG 2.2 AA, and the
testing strategy.

Next steps (each its own spec → plan → implementation, per the brainstorming process):

1. **PM2.5 breakpoint fix** in sjvair.com (urgent, independent — see below).
2. **Release 1, step 1: Foundations** spec (this repo).
3. In parallel once approved (sjvair.com/sdk-js plans): Release 1's **metadata
   enablers**, **hosting under `/dashboard/`**, and **server-backed documents** tracks,
   plus **server alerting** (Release 2).

## Planning session record: IDEA.md (2026-09-23 → 2026-09-24)

`IDEA.md` describes a larger direction (Dashboard / Widget Creation / Analysis views,
windowed widgets, alerts, Tauri). We worked through its **Open Questions** in order,
updating the docs after each one.

- [x] **Q1 Tauri now or later?** → Web-first, Tauri-ready. See `ARCHITECTURE.md`
      → "Platform strategy" and "Authentication".
- [x] **Q2 Map widget partial dataset selection** → Stage query descriptors, not data;
      one `SpatialSelection` model fed by feature picking (A), region picking (B), and
      later drawn shapes (C, opt-in monitor-map plugin). No map time scrubbing. See
      `ARCHITECTURE.md` → "Widget data selection".
- [x] **Q3 Map SDK modularity / plugin system** → `@sjvair/monitor-map` 4.0 clean
      break: per-map `MapContext` instead of singletons, factory plugins with data-source
      interfaces, `MapShell` + lightweight `MapView`, injected config; migrate
      sjvair.com and `v3-mobile` in the same effort. See `ARCHITECTURE.md` →
      "Map SDK".
- [x] **Q4 Dashboard layout mechanics** → Snapping grid (no overlap), pure layout
      engine + CSS Grid rendering, fullscreen within dashboard area, minimize-to-taskbar
      with compaction, vertical scrolling with cooperative map gestures, multiple
      dashboards for crowding. See `ARCHITECTURE.md` → "Dashboard layout mechanics".
- [x] **Q5 Dynamic context menu architecture** → Shared scoped action list (data, not
      Snippets); DOM-ancestry resolution with payload enrichment for canvas widgets;
      specific-first merge; bits-ui `ContextMenu`; same actions power widget "⋯" menus
      and a future command palette. See `ARCHITECTURE.md` → "Actions & context menu".
- [x] **Q6 Analysis view**
  - [x] Staged data → named **Collections** of query descriptors, independent of
        dashboards (provenance link only); active + per-dashboard default targets.
  - [x] Engine → generic date-aligned core; starters and user analyses share one
        `AnalysisSpec` format; pitfalls (resolution/geography/lag/spurious correlation)
        are built-in steps. See `ARCHITECTURE.md` → "Analysis: Collections & engine".
  - [x] Health data → **CalEnviroScreen only**; outside health data + ER-lag analysis
        deferred (see `DEFERRED.md`).
  - [x] Pre-defined analyses → **all 10** confirmed. See `ARCHITECTURE.md` →
        "Starter analyses".
  - [x] Save/share → one versioned `SavedDocument` format for dashboards/Collections/
        analyses; local + JSON file + URL-fragment sharing first (fork on open);
        server-backed live links later (since moved into Release 1). See `ARCHITECTURE.md` →
        "Saving & sharing documents".
  - [x] Notebooks → "Export to notebook" bundles (Python, R, Deno/TS; Parquet + CSV +
        `collection.json`) plus embedded **JupyterLite with Pyodide only**, bundled
        offline, as a separate static app. Licensing OK. See `ARCHITECTURE.md` →
        "Notebooks" and `docs/reference/jupyterlite-kernels.md`.
- [x] **Q7 Metadata gaps audit** → per-domain `…/meta/` + top-level `meta/datasets/`
      catalog; coverage as a separate endpoint; 7 prioritized gaps + hardcoded-value
      cleanup. See `ARCHITECTURE.md` → "Metadata as source of truth".
- [x] **Q8 More widget ideas** → first release adds Current conditions, "Can we go
      outside?", Forecast strip, Alerts feed, Data table, Notes, Hour × weekday heatmap
      to Map/Calendars/Chart (the Alerts feed ships in Release 2); the rest deferred. See `ARCHITECTURE.md` → "Widget catalog".

**Planning session gaps (all resolved 2026-09-24).** Found while working through IDEA.md;
each was interviewed and recorded:

- [x] **Alerting design** (see `ARCHITECTURE.md` → "Alerts").
  - [x] Split: client self-monitoring (anyone) vs server automated alerting (accounts).
  - [x] Watch-list: pollutants on monitor/region targets (gated by available-pollutants
        metadata), forecasts, nearby pesticide notices; others deferred.
  - [x] Thresholds: level categories only; server-defined averaging windows; notify on
        crossing/escalation/optional all-clear; daily caps + quiet hours.
  - [x] Channels: SMS (all alert types) + email + in-app inbox first; web push next;
        mobile push deferred.
- [x] **Spanish / i18n** → ship English-only, translation-ready: Paraglide JS (English
      messages only) + 8 day-one practices; translations deferred. See `ARCHITECTURE.md`
      → "Internationalization".
- [x] **Accounts & anonymous use** → existing sjvair.com accounts; everything anonymous
      except alerts / server docs / sync; lazy sign-in; browser profile as the boundary
      with "Clear my data" + session-only sign-in. See `ARCHITECTURE.md` → "Accounts".
- [x] **Live refresh & data volume** → automatic resolution by span with incomplete-period
      stitching; data-cadence-aware refresh, shared polls, pause when hidden; minimized
      widgets refresh only with thresholds. See `ARCHITECTURE.md` → "Data resolution &
      live refresh".
- [x] **URL state with dashboards** → URL = location, document = content (routes for
      dashboards, fullscreen widgets, Widget Creation, Analysis, `/import#…`); document-
      level undo/redo via `applyChange` in the first release. See `ARCHITECTURE.md` →
      "Routing, URL state & undo".
- [x] **Sequencing** → `ROADMAP.md` rewritten: PM2.5 fix now; Release 1 Dashboard
      (foundations → layout → metadata enablers ∥ → widgets → monitor-map 4.0 (now `map-sdk`) + Map
      widget on map-sdk → starter dashboard + go-live); Release 2 Alerts (server work starts
      alongside Release 1); Release 3 Analysis. Map widget waits for 4.0 (since restructured as `map-sdk`).

**⚠️ Urgent, separate from this project: PM2.5 breakpoints in sjvair.com are
half-updated to EPA's 2024 AQI revision.** `camp/apps/entries/levels.py` `PM25` uses the
new Moderate boundary (9.1) but the old upper boundaries — `VERY_UNHEALTHY(150.5)` and
`HAZARDOUS(250.5)` should be `125.5` and `225.5` (verify against the EPA rule). Served via
`monitors/meta/`, so maps, legends, and alerts above "Unhealthy" misclassify in every
consumer. Also check the inline breakpoints in the PM2.5 entry class. Needs its own
approved sjvair.com plan; decided 2026-09-23 to fix independently of the dashboard.

## Work breakdown by ROADMAP step

Every item below comes from a recorded decision (see `ARCHITECTURE.md`). Standing rule: record
every deferral in `DEFERRED.md`. Sibling-repo items each need an approved plan first, and a
package release needs explicit per-release approval.

**Now (independent)**

- sjvair.com PM2.5 breakpoint fix (see the warning above).

**Release 1, step 1: Foundations** (this repo)

- **First, write `docs/reference/v1-lessons.md`**: what the v1 code and its 78 tests
  learned about server behavior, as behaviors rather than code. Examples:
  - monthly+ rollups exist only after the period ends
  - region boundaries are large, so they're fetched lazily for selected regions only, with
    concurrent fetches deduped
  - single-parent region-narrowing rules and child-type filtering
  - selected regions with no average get a black border
  - `land_use` and `mtrs` are too large to list
  - globe-projection zoom precision for large counties
  - year/month showing 0 or blank during initial load
  - map/calendar updates must not block on child-list refetches

  Harvest the edge cases the tests encode as well.

- Then the fresh start: remove the v1 app shell, sidebar, tab routes, and tab pages.
  Reuse existing code only if it's exactly what the new design needs.

- Platform adapter: storage, notifications, file export, background tasks, online status,
  auth mode, and token storage. Preferences (last-opened dashboard, active Collection)
  go through it; the v1 `preferences.ts` is removed, not migrated.
- Local-first cache and data layer (IndexedDB/OPFS):
  - catalog-driven resolution for unsummarized data (worker downsampling, span caps)
  - automatic resolution selection
  - incomplete-period stitching
  - one poll per descriptor
  - pause when the tab is hidden
  - last-requested-wins
- Dataset adapter registry keyed by catalog id; hide catalog entries with no adapter
  (`ARCHITECTURE.md` → "What a dataset is").
- `QueryDescriptor` type: one definition, in `ARCHITECTURE.md` → "Widget data selection".
- Paraglide JS (English-only) and the shared `format` module, before any new UI. The
  `format` module owns the time-zone rules: Pacific everywhere via `@date-fns/tz`,
  Sunday week start, DST-safe (`ARCHITECTURE.md` → "Time zone & calendar conventions").
- `SavedDocument` types, a migration chain, `applyChange`, and undo/redo.
- Date-range resolution (`DateRangeSpec` → Pacific dates) lives with the `format` module;
  see `DEFERRED.md` → "Shared date-range helper home".
- Local save plus Export/Import `.json` and URL-fragment share, with the `/import` route.
- Minimal Collections: the store, the drawer, "Add to collection ▸", and a placeholder
  Analysis view ("starter analyses coming soon").
- Action/menu registry: pure resolution and merge logic, tested, plus a bits-ui
  `ContextMenu` host. Install shadcn-svelte `context-menu`.
- App shell: top nav, dashboard picker (a dropdown), and the new route table (`ARCHITECTURE.md` →
  "Routing"), plus `basePath` support for `sjvair.com/dashboard/`.
- CI workflow: lint, type-check, tests, and build on every PR.
- Test infrastructure (`ARCHITECTURE.md` → "Testing strategy"): Vitest browser mode +
  `vitest-browser-svelte`, Playwright (Chromium/WebKit/Firefox) with fixture routing,
  `@axe-core/playwright`, and a dev-stack smoke suite. PRs into `main` run the full suite
  (three engines plus axe); feature-branch PRs run unit + component + Chromium E2E.
- Installable app: `vite-plugin-pwa` app-shell service worker (scope `/dashboard/`), an
  offline notice, a "new version, reload" prompt, and a manifest and icons. API data
  stays in the data cache, not the service worker.
- "Clear my data".
- Vite dev proxy: `/api` and `/account/` to the local podman sjvair.com.
- Autosave (debounced `applyChange` persistence), the "Saved" indicator, and picker
  actions: new, duplicate, rename, delete with an undo toast.
- Local durability: a `navigator.storage.persist()` request, a storage status note, a
  backup nudge, and clear quota and write errors.

**Release 1, step 2: Layout engine and windowing**

- Pure layout functions, tested: placement, collision, compaction, minimize/restore, and
  deriving the responsive stack.
- Drag and resize with edge/corner handles, a taskbar, and fullscreen.
- WCAG 2.2 AA pieces: keyboard move and resize (plus ⋯ menu actions), live-region
  announcements, focus management for fullscreen and the taskbar, and
  `prefers-reduced-motion`.

**Release 1, step 3: Metadata enablers** (sjvair.com + sdk-js, in parallel with steps 1–2)

- Available-pollutants list (PM2.5 + O3 initially), which the new code reads instead of
  hardcoding pollutants.
- In order: the `meta/datasets/` catalog (schema per `ARCHITECTURE.md` → "What a dataset
  is"), the coverage endpoint, per-domain scale metas
  (hms, calheatscore, forecasts, AQI), region hierarchy, choice lists, and
  display hints.
- HTTP cache headers (Cache-Control/ETag) on the summary endpoints.
- sdk-js wrappers for `forecasts/`, `calheatscore/`, and `calenviroscreen/`. Fix sdk-js
  `api-urls.md`.
- Clean up hardcoded values in sjvair.com once the metadata exists. The map cleanup folds
  into `map-sdk` and the monitor-map rebuild; this repo's v1 values go away with the v1 code.

**Release 1, step 4: Widget Creation and non-map widgets**

- The **starter dashboard** (first-visit default) with non-map widgets; map and calendar
  widgets join in step 6.
- The Widget Creation view (including the advanced resolution override): date methods above catalog-driven dataset accordions (the v1
  tabs become accordions), multiple layers per widget (≤ 1 pollutant), a place picker for
  "now" widgets, and a live preview.
- The `WidgetType` registry (including `analyzable`) and `WidgetDataConfig`; "now" widgets
  stage a 3-day trailing window for analysis (Forecast strip only where past forecasts
  exist), and Notes offers no analysis actions (`ARCHITECTURE.md` → "Widget-type
  contract").
- Widgets:
  - Chart
  - Calendar (day-colored)
  - Calendar (contribution)
  - Current conditions
  - Data table
  - Notes
  - Hour × weekday heatmap
  - Forecast strip
  - "Can we go outside?"
- "Mark for analysis" / "Analyze" actions on every `analyzable` widget, including the calendar's
  selected-range variants.
- Client-side self-monitoring thresholds. These need no server work and ship with the
  widgets.

**Release 1, step 5: `map-sdk` and the Map widget**

- Create the `@sjvair/map-sdk` repo. Its 1.0 spec and plan cover the instance-scoped core,
  plugin interface, `MapView`, and app-level data stores (`createMonitorsStore()`).
- A monitor-map plan: rebuild on `map-sdk` on a branch (MapShell, routes, panels, the
  standalone build). Merge to its `main` only after verification, with explicit approval.
- A v3-mobile migration plan (stores from `map-sdk`, layout from the new monitor-map).
- The Map widget, with feature/region selection (methods A and B). Drawn shapes (C, via a
  `terra-draw` plugin) come later.

**Release 1, parallel track: hosting on sjvair.com** (approved sjvair.com plan first)

- sjvair.com:
  - an import script that clones and builds this repo's `main` during the Heroku deploy
    (modeled on `scripts/import-monitor-map.sh`; no pinning)
  - a Django catch-all route for `/dashboard/*`
  - `VITE_*` keys as Heroku config vars
- This repo: Vite `base: "/dashboard/"`, and `setOrigin(location.origin)` when served
  under `/dashboard/` (`VITE_PROD_URL` only for Tauri/standalone builds).
- Merging to dashboard `main` needs the user's explicit go-ahead (it ships with the next
  server deploy).

**Release 1, parallel track: server-backed documents** (approved sjvair.com plan first)

- sjvair.com: the `SavedDocument` model and endpoints (visibility, `version`).
- sdk-js wrappers.
- Dashboard:
  - the sign-in flow: redirect to sjvair.com login/registration with `?next=`; a
    server "remember me" change (session expires at browser close when unchecked)
  - sdk-js: make `apiToken` optional on account calls that require it today
  - versioned local-first sync with conflict prompts
  - live share links (read-only plus "Make a copy")
  - local → account migration

**Release 1, step 6: Starter dashboard and go-live**

- The default first-visit dashboard gains its map and calendar widgets (non-map widgets
  until step 5).
- Go-live: enable the `sjvair.com/dashboard/` route once Release 1 is complete.

**Release 1: private preview (from about step 4)**

- An unlisted preview (staging Heroku app or hidden route; decide in the hosting-track
  plan) for a pilot teacher and a researcher. Collect feedback on the windowed dashboard
  before go-live.

**Release 2: Alerts** (the server work can start alongside Release 1)

- sjvair.com:
  - alert rules (monitor/region pollutant, forecast, pesticide-notice)
  - level-category thresholds, caps, and quiet hours
  - SMS for every alert type, plus email
  - the inbox API
  - alert metadata
- sdk-js wrappers.
- In-app session sign-in: sjvair.com `POST account/session/` (rate-limited,
  non-enumerating errors) plus an in-app dialog replacing the Release 1 redirect.
- Dashboard: the rule UI with lazy sign-in, the inbox, and the Alerts feed widget.

**Release 3: Analysis**

- The full Analysis view on top of Release 1's Collections, `AnalysisSpec`, and the
  engine steps (resample, align,
  lag, aggregate, correlate) as pure worker-side functions.
- The ten starter analyses.
- The Export-to-notebook bundle generator (Python, then R, then Deno/TS).
- The JupyterLite (Pyodide-only) static app.

**Tauri (later)**

- A WebKitGTK + map widget spike before committing (see `DEFERRED.md`).

## Previous work (v1 tab era)

The Monitors tab (map + calendar, month picker, county choropleth) merged as
SJVAir/data-dashboard#2, followed by the multi-region selector and single-parent
narrowing (#3, #4). Specs and plans are in `docs/superpowers/`. This code is removed in
Release 1's Foundations step (a fresh start). Its deferred follow-ups are in `DEFERRED.md`
→ "Legacy Monitors-tab follow-ups".

## Done

- [x] **`@sjvair/monitor-map` added as a dependency** (`^3.5.0`). Its `@tstk/*` jsr
      dependencies (`@tstk/builtin-extensions`, `@tstk/utils` — real runtime deps of
      `monitorsManager`/map-integration plumbing, not just types) are non-root/transitive
      from this repo's perspective, which this repo's `.npmrc` (`allow-remote=root`)
      blocks by design. Resolved by declaring both directly as root dependencies here
      too (pinned to the same ranges `monitor-map` uses) rather than loosening the
      policy to `allow-remote=all` project-wide.
- [x] **`@sjvair/sdk` upgraded to v4.0.0** in this repo's `package.json` (jsr-backed
      npm alias). No call sites in this repo used the renamed/removed functions yet,
      so this was a version-bump-only change.
- [x] **`monitor-map`: `MonitorsDataSource` decoupling + sdk v4 upgrade + full dependency
      update**: lets a host app reuse monitor-map's monitor rendering against non-live data
      (e.g. date-range averages). Merged via
      SJVAir/monitor-map#102 and #103 (stacked), plus a follow-up dependency sweep
      (every dep except TypeScript, notably `sv-router` peer range widened to `^0.19.0`
      and `@maptiler/weather` bumped to 4.0.1). Released as `@sjvair/monitor-map@3.4.0`
      then `3.5.0`.
- [x] **Vertical nav sidebar** — replaced the horizontal top-bar nav (`App.svelte`) with
      a vertical sidebar on desktop (`sm:` and up) and an off-canvas overlay drawer on
      mobile (shadcn-svelte `Sheet`, triggered by a hamburger button in a slim mobile
      top bar). Nav links extracted to `src/lib/components/AppNav.svelte`, shared by
      both. Also installed shadcn-svelte's `sheet`/`button` components for the first
      time, which required adding the standard `WithElementRef`/`WithoutChildrenOrChild`
      helper types to `src/lib/utils.ts` (missing since the scaffold predated any
      component install).
- [x] Brainstormed and wrote the v1 design spec:
      `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`
- [x] **monitor-map modularization** — `MapShell` extracted as a configurable map-layout
      primitive; `MonitorMapLayout` is now a thin wrapper preserving existing behavior.
      Merged as SJVAir/monitor-map#101, released as `@sjvair/monitor-map@3.3.0`.
- [x] **Data dashboard scaffold** — Vite/Svelte app, tab-routing skeleton (Monitors/HMS/
      Collocation Sites, all placeholders), preferences store + URL-state codec
      utilities (unit-tested), and this set of project docs. Merged as
      SJVAir/data-dashboard#1 into `main`.
      Plan: `docs/superpowers/plans/2026-09-14-data-dashboard-scaffold.md`
- [x] **Monitors tab (map + calendar)** — map view showing monitor locations colored by
      PM2.5/O3 monthly average; counties filled with semi-transparent color matching their
      monthly average level, replacing the previous blue border outline (all counties when
      none selected, only the selected county otherwise). Calendar view is a color-coded
      day grid of the selected county's daily `RegionSummary` averages, scoped to exactly
      the selected month. State management via `MonitorsTabManager`: the monitor roster,
      meta, and county list are fetched once and cached in `init()`; per-monitor and
      per-region summaries are refetched from scratch on every filter change (month,
      pollutant, or county). Month picker allows selection from current year plus 4 prior
      years (all 12 months), defaulting to the current month and remembering last-selected
      month in preferences. Map's per-monitor averaging now always uses monthly summaries
      (the previous 45-day threshold logic has been removed). Wired to `@sjvair/sdk` and
      `@sjvair/monitor-map`'s `MapShell` with county filter and pollutant toggle;
      clustering/click-drill-down behavior is inherited from `monitor-map` and was not
      independently verified in this pass. Chart/spreadsheet views and HMS/Collocation
      tabs still deferred.
      Plan: `docs/superpowers/plans/2026-09-16-monitors-tab-month-picker.md`
      Spec: `docs/superpowers/specs/2026-09-16-monitors-tab-month-picker-design.md`

## Open questions / decisions to revisit

Everything deferred is tracked in **`DEFERRED.md`**. Anything still undecided is listed there
under "Open decisions".
