# Deferred work

**The single register of everything deliberately deferred or ruled out.** Nothing leaves this
file except by being done (move it to `TODO.md` → Done) or explicitly dropped by the user
(move it to "Dropped" with the date and reason). Specs, plans, and other docs link here
instead of keeping their own deferred lists.

Each entry records **why** it was deferred and **what should trigger revisiting it**.

---

## Platform & infrastructure

- **Tauri desktop build.** _Deferred 2026-09-23 (IDEA.md Q1)._ The web build comes first
  and the app is kept Tauri-ready (see `ARCHITECTURE.md` → "Platform strategy").
  **Revisit when** there is a concrete desktop-only win, such as tray-based background
  alerting or large offline datasets for researchers. **Prerequisite:** a WebKitGTK spike
  with a map widget to confirm Linux desktop is viable. The spike must also confirm JupyterLite
  kernels can access files under Tauri-set COOP/COEP headers (service workers don't
  register on `tauri://` on macOS — see `docs/reference/jupyterlite-kernels.md`).
- **"Open locally" for notebooks (Tauri).** _Deferred 2026-09-23 (IDEA.md Q6)._ Write an
  export bundle to a folder and launch the user's `jupyter lab` if installed. Not
  possible from a web page. **Revisit when** the Tauri build starts.
- **Embeddable production build.** _Deferred 2026-09-14 (v1 spec)._ Needs a `sv-router`
  escape hatch (`routerEscapeHatch`/`basePath`) and a non-URL fallback for view state.
  **Revisit when** the dashboard's core views exist. Keep state managers from hardcoding
  ownership of the top-level route in the meantime.
- **Server-backed saved documents & live share links.** _Sequenced later 2026-09-23
  (IDEA.md Q6)._ `SavedDocument` model + endpoints on sjvair.com with
  private/link/public visibility, live read-only links with "Make a copy", curated public
  templates. Subsumes **server-synced preferences** (deferred 2026-09-14, v1 spec). Local
  storage with file/URL sharing ships first. **Revisit when** local documents exist and
  users need cross-device access or teacher → class sharing; needs an approved
  sjvair.com plan.
- **Heavier WASM analysis engine (e.g. DuckDB-WASM).** _Deferred 2026-09-23 (IDEA.md Q6)._
  Plain TypeScript over typed arrays in a worker is enough for now. **Revisit when**
  researcher-scale datasets make the TypeScript engine too slow or memory-bound.
- **Server-side location/radius search.** _Deferred 2026-09-14 (v1 spec)._ Needs sdk-js
  and server changes. Drawn-shape selection resolves on the client, so it doesn't depend
  on this. **Revisit when** client-side resolution gets too slow or needs data the client
  doesn't have.
- **Shared date-range helper home.** _Open since 2026-09-14._ The helper currently exists
  only in monitor-map's `data-chart/DateRange.ts`. It could move to `@sjvair/sdk`'s
  `datetime` module or become a monitor-map export. **Decide when** the Widget Creation
  date-range picker (set, rolling, and custom ranges) is built.

## Map & selection

- **Drawn-shape map selection (box/lasso/radius).** _Sequenced later 2026-09-23 (IDEA.md
  Q2)._ This comes after feature and region picking. It will be an opt-in `terra-draw`
  plugin in monitor-map. **Revisit when** feature and region selection have shipped.
- **Globe-projection zoom precision.** _Noted 2026-09-16._ Large counties are under-zoomed
  in the globe projection. **Revisit when** building the map widget on monitor-map 4.0.
- **`land_use` / `mtrs` region browsing ("progressive unlock").** _Deferred 2026-09-17
  (multi-region selector spec)._ These tables have roughly 66k and 28k rows. Browsing them
  only after narrowing to a small parent area needs its own design. **Revisit when**
  pesticide analyses need parcel-level (MTRS) selection.
- **`place` / `protected` / `custom` region types.** _Deferred 2026-09-17._ They have 0
  rows in dev today. No code changes are needed once they have data. **Revisit when** data
  appears. Forecast zones are stored as `custom`.
- **Cross-type region selection persistence in the URL.** _Deferred 2026-09-17._ Only the
  active region type's selection is stored in the URL. **Revisit when** users want to
  share or bookmark a view spanning several region types. This may be absorbed by saved
  dashboard configs.
- **Lightweight (geometry-free) regions list endpoint.** _Deferred 2026-09-17._
  **Revisit when** large unnarrowed lists (e.g. about 1,200 tracts) prove slow.
- **"All counties" aggregate view.** _Deferred 2026-09-15._ The server doesn't support it,
  and we chose not to approximate it on the client. **Revisit when** the server gains a
  valley-wide region, or a custom region is defined for it.

## Analysis & data

- **Outside health data (HCAI ED visits, CDC PLACES, etc.) and the "smoke → ER visits"
  lag analysis.** _Deferred 2026-09-23 (IDEA.md Q6)._ The server holds no ER,
  hospitalization, or incidence data, so health analysis is limited to CalEnviroScreen's
  tract indicators for now. Adding outside data needs new server importers plus a
  privacy and small-number-suppression policy. **Revisit when** the pre-built analyses
  have shipped and there's demand, or when a data partner is available.
- **Entry types beyond PM2.5/O3 in existing code.** _Deferred 2026-09-15._ The pollutants
  are hardcoded in `url-state.ts`, `monitor-latest.ts`, and `MonitorsTab.svelte`. The
  dashboard direction should drive them from `monitors/meta/` (see IDEA.md Q7).
  **Revisit when** the Widget Creation dataset picker is built.

- **In-browser R and JavaScript kernels in JupyterLite.** _Deferred 2026-09-23
  (IDEA.md Q6)._ Embedded JupyterLite ships Python (Pyodide) only; R/JS/TS users use
  export bundles in their local tools. xeus-r lacks `openair`/`sf`/CRAN; the webR
  JupyterLite kernel is stale; xeus-javascript can't start offline and
  `jupyterlite/javascript-kernel` is alpha. Full findings in
  `docs/reference/jupyterlite-kernels.md`. **Revisit when** `openair`/`sf` reach
  emscripten-forge or webR's kernel is revived (R), `jupyterlite/javascript-kernel`
  ships a stable 0.4 (JS), or schools/community users ask for them.

## Widgets

_Deferred 2026-09-23 (IDEA.md Q8)._ Brainstormed but not in the first-release widget set
(see `ARCHITECTURE.md` → "Widget catalog"). **Revisit when** the first-release widgets
ship, or a specific audience asks for one.

- **Rankings**: worst-N monitors/regions right now, with sparklines.
- **Days-per-level stacked bars**: by month (widget form of starter analysis #1).
- **Range bands chart**: mean + p25/p75/min/max bands from summaries.
- **Pollution rose**: pollutant by wind direction/speed from CIMIS stations.
- **Region comparison bars**: regions ranked by mean over the date range.
- **Smoke & fire map preset**: map widget + HMS plugins.
- **TEMPO satellite layer**: NO₂/O₃ raster overlays. Needs SDK wrapper + a raster map
  plugin.
- **Pesticide notices**: upcoming/recent SprayDays applications near a place (list or
  timeline).
- **Monitor health**: QA/QC scores and sensor agreement (research).

## UI & UX

- **Command palette (Ctrl+K) and keyboard shortcuts.** _Deferred 2026-09-23 (IDEA.md
  Q5)._ The shared action registry is designed to feed these. **Revisit when** the action
  registry and the widget "⋯" menus have shipped.
- **Icon-only collapsed sidebar.** _Deferred 2026-09-16._ This is a self-contained change:
  a collapsed `$state` toggle plus per-link icons. **Revisit when** the nav has enough
  entries that full-width labels cost too much space. The IDEA.md direction moves to a
  top nav bar, so this may become moot.
- **Visual and brand design system.** _Deferred 2026-09-14._ IDEA.md sets the direction
  (Tailwind + shadcn-svelte, never Bulma, clean but not corporate, with animations).
  Colors may come from the server's existing pages. **Revisit when** the dashboard shell
  is built, as a dedicated design pass.

## Legacy Monitors-tab follow-ups (may be superseded by the dashboard/widget direction)

These came from the Monitors-tab work. If that tab is replaced by widgets, re-check each
item against the widget design rather than dropping it silently.

- **Chart and spreadsheet views**: _deferred 2026-09-15_. Likely becomes chart and table
  widgets.
- **HMS Smoke/Fire and Collocation Sites tabs**: _v1 roadmap_. Likely becomes map and
  chart widgets or data sources.
- **Whether HMS gets a spreadsheet view of raw records**: _open since 2026-09-14_.
- **Whole-year over-fetch**: _deferred 2026-09-16_. The `month` param exists on the
  summary endpoints but isn't used.
- **No in-flight request coordination**: _deferred 2026-09-16_. Rapid filter changes race,
  so the last response to finish wins instead of the last request made. This applies to
  every widget data manager, so solve it once in the data layer or cache.
- **Preferences persist only the month**: _deferred 2026-09-16_. The URL is read once at
  mount and doesn't react to back/forward.
- **Migrating old `?range=` bookmark URLs**: _deferred 2026-09-16_.
- **"Default to current month" can't show monthly data until the month ends**: _noted
  2026-09-16_. Monthly rollups only compute after month-end.

## Decided against (kept for the record, not planned)

Recorded so nobody re-proposes these without the context. Reopen only with a new reason.

- **Desktop-first / "web as a side effect of Tauri"**: _2026-09-23, Q1_. See the
  Tauri-build entry above.
- **Time scrubbing or time selection inside map widgets**: _2026-09-23, Q2_. Time is fixed
  per widget, and calendar and chart widgets handle narrowing the time range.
- **A long-lived monitor-map 3.x compat shim**: _2026-09-23, Q3_. We chose a clean 4.0
  break with coordinated consumer migration.
- **Free-form, overlapping dashboard windows**: _2026-09-23, Q4_. We chose a snapping grid.
- **A horizontally scrolling dashboard canvas**: _2026-09-23, Q4_. It grows vertically,
  and multiple dashboards handle crowding.
- **Dashboard-owned Collections**: _2026-09-23, Q6_. Collections are independent and link
  back to their source dashboards only as provenance.

## Dropped

_(none yet)_
