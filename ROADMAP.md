# Roadmap

Sequencing for the dashboard direction. Decided 2026-09-24 at the end of the IDEA.md
planning session. Design lives in `ARCHITECTURE.md`, current status in `TODO.md`, and
everything deferred in `DEFERRED.md`.

**Every numbered item below is its own sub-project** with its own spec, then plan, then
implementation. Sub-projects in a sibling repo (sjvair.com, sdk-js, monitor-map,
v3-mobile) need an approved plan in that repo before any change. Publishing any package
needs explicit per-release approval.

## Done (v1 tab era)

- ~~monitor-map modularization~~: `MapShell`, released in `@sjvair/monitor-map` 3.3.0.
- ~~Data dashboard scaffold~~: merged as SJVAir/data-dashboard#1.
- ~~Monitors tab (map + calendar)~~: #2. Then the multi-region selector and
  single-parent narrowing (#3, #4).

## Now: independent of everything

- **PM2.5 breakpoint fix (sjvair.com).** `levels.py` is only half-updated to EPA's 2024
  AQI revision. It is urgent and separate from this project; see `TODO.md`.

## Release 1: Dashboard

1. **Foundations** (this repo)
   - platform adapter
   - local-first cache and data layer: automatic resolution, incomplete-period
     stitching, shared polling, last-requested-wins
   - Paraglide (English-only) and the `format` module
   - `SavedDocument`, `applyChange`, and undo/redo
   - **minimal Collections** (decided 2026-09-24): the store, the Collections drawer,
     "Add to collection ▸", and a placeholder Analysis view that lists a Collection's
     items with "starter analyses coming soon"
   - local save, Export/Import `.json`, and URL-fragment sharing (`/import`)
   - the action/context-menu registry
   - the top-nav app shell, with `basePath` support in `src/router.ts` for serving under
     `sjvair.com/dashboard/`
   - CI: lint, type-check, tests, and build on every PR
   - test infrastructure: Vitest browser mode, Playwright (3 engines), axe
   - installable app: an app-shell service worker via `vite-plugin-pwa`, scoped to
     `/dashboard/`, with an offline notice and an update prompt
2. **Dashboard layout engine and windowing**: snapping grid, drag/resize,
   minimize-to-taskbar, fullscreen, and responsive stacking. Proven with placeholder
   widgets.
3. **Metadata enablers** (sjvair.com + sdk-js; runs in parallel with 1–2)
   - the available-pollutants list
   - the `meta/datasets/` catalog
   - the coverage endpoint
   - scale metas
   - SDK wrappers for forecasts, CalHeatScore, and CalEnviroScreen
   - region hierarchy, choice lists, and display hints (metadata gaps 5–7)
   - HTTP cache headers on the summary endpoints
   - hardcoded-value cleanup in sjvair.com and this repo, and fixing sdk-js `api-urls.md`
   - alert metadata is part of Release 2
4. **Widget Creation and the non-map widgets**
   - Widget Creation view
   - Chart
   - Calendar (day-colored)
   - Calendar (contribution)
   - Current conditions
   - Data table
   - Notes
   - Hour × weekday heatmap
   - Forecast strip
   - "Can we go outside?"
   - client-side self-monitoring thresholds
   - "Mark for analysis" / "Analyze" on every widget, plus the calendar's "selected
     data" variants, feeding Release 1's Collections
5. **monitor-map 4.0 and the Map widget**
   - instance-scoped core, plugins, `MapView`
   - migrating sjvair.com and v3-mobile
   - the Map widget with feature/region selection (methods A/B)
   - The Map widget **waits for 4.0**; there is no interim single-map build.

- **Parallel track: hosting on sjvair.com** (approved sjvair.com plan first). An import
  of a pinned, versioned dashboard build into `dist/`, plus a Django catch-all route for
  `/dashboard/*`. Production deploys only with explicit approval.
- **Parallel track: server-backed documents** (sjvair.com + sdk-js, decided
  2026-09-24). The `SavedDocument` model and endpoints, live share links (read-only
  plus "Make a copy"), versioned local-first sync with conflict prompts, local →
  account migration, and the sign-in flow (which Release 2 reuses). Anonymous users
  stay local, with durability safeguards.

6. **Starter dashboard replaces the v1 tabs.** A default landing dashboard (map +
   calendar widgets covering today's Monitors tab) replaces the Monitors, HMS, and
   Collocation Sites tabs in one switch. **The v1 tabs stay live until this step**, which
   depends on 5. The HMS and Collocation tabs are still placeholders, so nothing is lost.
   Their replacements come later: the smoke & fire map preset (deferred) and starter
   analysis #10 (Release 3). Old v1 URLs (`/hms`, `/collocation-sites`, `?range=`)
   redirect.

## Release 2: Alerts

- **Server work starts in parallel with Release 1**, once an sjvair.com plan is
  approved:
  - generalize `Subscription` into alert rules for monitor/region pollutants (gated by
    available pollutants), forecasts, and nearby pesticide notices
  - level-category thresholds, caps, and quiet hours
  - SMS for every alert type, a new email channel, and the alert inbox API
  - alert metadata
- sdk-js wrappers for the new alert endpoints.
- Dashboard: an alert-rule UI (lazy sign-in), the alert inbox, and the Alerts feed
  widget.

## Release 3: Analysis

1. **Analysis engine**: `AnalysisSpec`, the full Analysis view (built on Release 1's
   Collections), and worker-side engine steps (resample, align, lag, aggregate,
   correlate).
2. **The ten starter analyses.** #7 needs the CalEnviroScreen wrapper and #8 needs the
   CalHeatScore wrapper, both from Release 1 step 3.
3. **Export-to-notebook bundles**: Python first, then R, then Deno/TypeScript.
4. **JupyterLite app**: Pyodide only, bundled for offline use, a separate static app.

The Release 3 spec must also decide what IDEA.md and the planning session left open:

- the Analysis view's layout (Collections drawer, list of analyses, results)
- the user-defined analysis editor UI
- the geographic crosswalk method: monitor→region, tract (CES), ZIP (CalHeatScore),
  county/MTRS (PUR), and area weighting

## Later

Everything in `DEFERRED.md`, each entry with its own revisit trigger. The notable ones:

- web push
- server-backed saved documents and live share links
- drawn-shape map selection
- more alert sources
- translations
- the Tauri desktop build (after a WebKitGTK spike)
