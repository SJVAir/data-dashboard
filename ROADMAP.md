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
   - the action/context-menu registry
   - the top-nav app shell
2. **Dashboard layout engine and windowing**: snapping grid, drag/resize,
   minimize-to-taskbar, fullscreen, and responsive stacking. Proven with placeholder
   widgets.
3. **Metadata enablers** (sjvair.com + sdk-js; runs in parallel with 1–2)
   - the available-pollutants list
   - the `meta/datasets/` catalog
   - the coverage endpoint
   - scale metas
   - SDK wrappers for forecasts, CalHeatScore, and CalEnviroScreen
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
5. **monitor-map 4.0 and the Map widget**
   - instance-scoped core, plugins, `MapView`
   - migrating sjvair.com and v3-mobile
   - the Map widget with feature/region selection (methods A/B)
   - The Map widget **waits for 4.0**; there is no interim single-map build.
6. **Starter dashboard replaces the v1 tabs.** A default landing dashboard (map +
   calendar widgets covering today's Monitors tab) replaces the Monitors, HMS, and
   Collocation Sites tabs in one switch. **The v1 tabs stay live until this step**, which
   depends on 5.

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

1. **Collections and the analysis engine**: the Collections store and drawer,
   `AnalysisSpec`, and worker-side engine steps (resample, align, lag, aggregate,
   correlate).
2. **The ten starter analyses.** #7 needs the CalEnviroScreen wrapper and #8 needs the
   CalHeatScore wrapper, both from Release 1 step 3.
3. **Export-to-notebook bundles**: Python first, then R, then Deno/TypeScript.
4. **JupyterLite app**: Pyodide only, bundled for offline use, a separate static app.

## Later

Everything in `DEFERRED.md`, each entry with its own revisit trigger. The notable ones:

- web push
- server-backed saved documents and live share links
- drawn-shape map selection
- more alert sources
- translations
- the Tauri desktop build (after a WebKitGTK spike)
