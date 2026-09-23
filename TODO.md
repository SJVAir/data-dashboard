# TODO / Current Status

Last updated: 2026-09-16

## Planning session in progress: IDEA.md (started 2026-09-23)

`IDEA.md` describes a larger direction (Dashboard / Widget Creation / Analysis views,
windowed widgets, alerts, Tauri). We're working through its **Open Questions** in order,
updating the docs after each one. No code yet.

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
        server-backed live links later. See `ARCHITECTURE.md` → "Saving & sharing".
  - [x] Notebooks → "Export to notebook" bundles (Python, R, Deno/TS; Parquet + CSV +
        `collection.json`) plus embedded **JupyterLite with Pyodide only**, bundled
        offline, as a separate static app. Licensing OK. See `ARCHITECTURE.md` →
        "Notebooks" and `docs/reference/jupyterlite-kernels.md`.
- [x] **Q7 Metadata gaps audit** → per-domain `…/meta/` + top-level `meta/datasets/`
      catalog; coverage as a separate endpoint; 7 prioritized gaps + hardcoded-value
      cleanup. See `ARCHITECTURE.md` → "Metadata as source of truth".
- [ ] Q8 More widget ideas

**⚠️ Urgent, separate from this project: PM2.5 breakpoints in sjvair.com are
half-updated to EPA's 2024 AQI revision.** `camp/apps/entries/levels.py` `PM25` uses the
new Moderate boundary (9.1) but the old upper boundaries — `VERY_UNHEALTHY(150.5)` and
`HAZARDOUS(250.5)` should be `125.5` and `225.5` (verify against the EPA rule). Served via
`monitors/meta/`, so maps, legends, and alerts above "Unhealthy" misclassify in every
consumer. Also check the inline breakpoints in the PM2.5 entry class. Needs its own
approved sjvair.com plan; decided 2026-09-23 to fix independently of the dashboard.

Follow-ups created by decisions so far:

- Record every deferral in `DEFERRED.md` (standing rule — see `CLAUDE.md`).
- Build the platform adapter layer (storage, notifications, file export, background
  tasks, online status, auth mode/token storage); move `src/lib/preferences.ts` behind it.
- Design the local-first data cache (IndexedDB/OPFS on web).
- WebKitGTK + map widget spike before committing to a Tauri build.
- Define the query-descriptor type (dataset, entry_type, date range, `SpatialSelection`)
  — shared by widget config, staging, and saved dashboards.
- Map feature/region selection (A, B), then a `terra-draw` drawing plugin in
  monitor-map (C) — needs an approved monitor-map plan first.
- monitor-map 4.0 spec + plan (instance-scoped core, plugin interface, `MapView`),
  then per-consumer migration plans for sjvair.com and `v3-mobile`. Releasing
  4.0 requires explicit per-release approval.
- Dashboard layout engine (pure functions + tests): placement, collision, compaction,
  minimize/restore, responsive stack derivation.
- Action/menu registry (pure resolution + merge logic, tested) and bits-ui
  `ContextMenu` host; install shadcn-svelte `context-menu`.
- Collections store + drawer UI; `QueryDescriptor`/`AnalysisSpec` types; analysis
  engine steps (resample, align, lag, aggregate, correlate) as pure worker-side
  functions with tests.
- sdk-js: wrap `calenviroscreen/` and `calheatscore/` endpoints (needed by starter
  analyses #7 and #8) — needs an approved sdk-js plan.
- `SavedDocument` types + migration chain; export/import and URL-fragment share.
- Export-to-notebook bundle generator (Python first, then R, then Deno/TS).
- JupyterLite (Pyodide-only) static app: offline build config, bundle loading. After
  Collections + starter analyses.
- Open: should an optional `sjvair` Python helper be its own published package?
- Server metadata work (each needs an approved sjvair.com plan, then sdk-js wrappers):
  `meta/datasets/` catalog → coverage endpoint → per-domain scale metas (hms, calheatscore,
  forecasts, AQI) → alert meta → region hierarchy → choice lists → display hints.
- Hardcoded-value cleanup in sjvair.com, monitor-map (fold into the 4.0 plugin work), and
  this repo once the metadata exists. Fix sdk-js `api-urls.md`.

## Start here (previous work — superseded by the planning session above)

**Monitors tab (map + calendar views) is implemented and in review.**
Implementation is on branch `worktree-monitors-tab`, open as
[SJVAir/data-dashboard#2](https://github.com/SJVAir/data-dashboard/pull/2). The latest
iteration replaced the date-range picker with a Year/Month picker and upgraded the map's
county visualization from a blue border outline to a semi-transparent county-fill
choropleth, per `docs/superpowers/plans/2026-09-16-monitors-tab-month-picker.md`
and the design spec (`docs/superpowers/specs/2026-09-16-monitors-tab-month-picker-design.md`).
See those for the full scope and decisions.

Shipped in this cycle:

- Month picker: dropdown selector spanning current year and 4 prior years, all 12 months,
  defaulting to the current month. Last-selected month is remembered in localStorage
  preferences via `setTabPreferences`/`getTabPreferences`.
- County selector: shadcn-svelte `Select` filtering which monitors show on map and
  which county's data populates the calendar (calendar doesn't render until a county
  is selected).
- Map view: shows monitor locations, colors by PM2.5/O3 monthly average. Counties are
  filled with a semi-transparent color matching their monthly average level — all
  counties when none is selected, only the selected county otherwise. This replaces the
  previous blue border outline. Clustering/click-drill-down behavior is inherited from
  `monitor-map` and was not independently verified in this pass.
- Calendar view: color-coded day grid showing the selected county's daily `RegionSummary`
  averages, scoped to exactly the selected month. Lays out vertically, sizing to its
  content instead of stretching full-width. Always fetches at daily resolution for the
  month in view.
- State management: `MonitorsTabManager` fetches the monitor roster/meta/county list once
  and caches them in `init()`; per-monitor and per-region summaries are refetched from
  scratch on every filter change (month, pollutant, or county) — no summary caching. The
  map's per-monitor averaging now always uses monthly summaries (previously had a
  45-day threshold switching between daily and monthly; the threshold logic has been removed).

Deferred follow-ups from this work now live in `DEFERRED.md` → "Legacy Monitors-tab
follow-ups".

Verification status at the time:

- Type-check, build, and automated tests all pass (59 tests). Interactive visual browser
  verification was performed during implementation and again during manual testing after
  merge review.

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
      update** — see "Start here" above for the `MonitorsDataSource` details. Merged via
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

## Next up

- [ ] **HMS Smoke/Fire tab**
- [ ] **Collocation Sites tab**

## Open questions / decisions to revisit

Everything deferred (sidebar collapse, embedding escape hatch, HMS spreadsheet view,
date-range helper home, visual/brand design, …) is tracked in **`DEFERRED.md`**. Open
questions from the current planning session are listed at the top of this file.
