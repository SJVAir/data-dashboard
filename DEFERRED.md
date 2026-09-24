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
  sjvair.com plan. Includes **local → account migration** (first sign-in offers to upload
  local documents).
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
- **Entry types beyond PM2.5/O3.** _Deferred 2026-09-15; mechanism decided 2026-09-24._
  Pollutants offered in the frontend (widgets, analyses, alerts) will be gated by a
  server **available-pollutants** metadata list (PM2.5 + O3 today), replacing the
  hardcoded `"pm25" | "o3"` in `url-state.ts`, `monitor-latest.ts`, `MonitorsTab.svelte`.
  **Revisit when** SJVAir is confident in NO2/SO2/CO (or others) — enabling them is then a
  metadata change.

- **In-browser R and JavaScript kernels in JupyterLite.** _Deferred 2026-09-23
  (IDEA.md Q6)._ Embedded JupyterLite ships Python (Pyodide) only; R/JS/TS users use
  export bundles in their local tools. xeus-r lacks `openair`/`sf`/CRAN; the webR
  JupyterLite kernel is stale; xeus-javascript can't start offline and
  `jupyterlite/javascript-kernel` is alpha. Full findings in
  `docs/reference/jupyterlite-kernels.md`. **Revisit when** `openair`/`sf` reach
  emscripten-forge or webR's kernel is revived (R), `jupyterlite/javascript-kernel`
  ships a stable 0.4 (JS), or schools/community users ask for them.

## Map plugins

- **Map plugins for the remaining server datasets.** _Deferred 2026-09-24 (docs review)._
  First release covers monitors, region fill, HMS smoke/fire, collocation, EV, wind,
  weather. Deferred: pesticide use and SprayDays notices, CalEnviroScreen tracts,
  CalHeatScore ZIPs, forecast zones, CEIDARS facilities, TEMPO rasters. The 4.0 plugin
  interface must support points, polygons, choropleths, and rasters so these are
  additive. **Revisit when** a widget or analysis needs one on a map (pesticide notices
  likely first, alongside the alerts work).

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

- **Additional automated-alert sources and targets.** _Deferred 2026-09-24 (alerting
  design)._ First server iteration covers pollutants (monitor/region targets),
  forecasts, and nearby pesticide notices. Deferred: **HMS smoke** over an area
  (density ≥ X), **heat** (CalHeatScore ≥ level), **fire detections** within N miles,
  and **drawn-area / near-a-point targets** (resolved to monitor sets per Q2).
  **Revisit when** the first alert-rule iteration ships, or ahead of wildfire/heat
  season if demand appears.

- **Numeric alert thresholds** (e.g. "PM2.5 > 25 µg/m³"). _Deferred 2026-09-24 (alerting
  design)._ First iteration uses level categories only: simpler for community/schools
  and consistent with the level colors shown everywhere. **Revisit when** researchers or
  advocates ask for raw-value alerts; offer as an "advanced" option.

- **Web push for alerts.** _Sequenced as next iteration 2026-09-24._ Reaches desktop
  and Android with the dashboard closed, no per-message cost; iOS only for home-screen-
  installed sites. Needs a service worker (coordinate with the web offline stance — see "Open decisions"),
  VAPID keys, and a server push-subscription table. **Revisit when** the first alerting
  iteration (SMS + email + inbox) ships.
- **Mobile app push for alerts (`v3-mobile`).** _Deferred 2026-09-24._ No FCM/APNs setup
  exists in `v3-mobile` or the server. **Revisit when** `v3-mobile` plans push
  notifications; needs its own approved plan.

## Accounts

- **Shared-computer guest mode.** _Deferred 2026-09-24._ A mode (e.g. enabled by a
  teacher-distributed `?guest` link) where nothing persists after the tab closes.
  Current approach: browser profile as the boundary + "Clear my data" + session-only
  sign-in. **Revisit when** a school reports shared-device problems (i.e. students share
  one browser profile).
- **Teacher / class / organization accounts.** _Deferred 2026-09-24._ Rosters, class
  dashboards, shared org alerts. Teachers share via links for now. **Revisit when**
  schools ask for managed class use, likely after server-backed live share links exist.

## Internationalization

- **Translations and language switching.** _Deferred 2026-09-24._ No translations exist
  and there's no timeline; the app ships English-only but translation-ready (see
  `ARCHITECTURE.md` → "Internationalization"). Deferred together: Spanish, Filipino (tl),
  and Hmong (hmn) message files; a language picker (saving to `User.language` when
  signed in); server `.po` files for sjvair.com (metadata labels/guidance, alert text);
  per-language metadata caching; alerts sent in `User.language`; a formatting fallback
  for `hmn` (thin CLDR/`Intl` data); i18n in monitor-map and v3-mobile. Health guidance
  and alert text need human translation or review, not machine-only. **Revisit when**
  translators or funding for translation are available.

- **CEIDARS facility emissions.** _Deferred 2026-09-24 (docs review)._ On the server
  (yearly facility emissions + health risk indices) but no widget, analysis, or SDK
  wrapper is planned. **Revisit when** an emissions/facility-proximity use case comes up.
- **Pesticide timing → health analysis** (from IDEA.md's prior brainstorm). _Deferred
  2026-09-24._ No health outcome data beyond CalEnviroScreen; closest planned work is
  starter #9 (use trends) and #7 (CES indicators). **Revisit with** the outside-health-data
  entry above.
- **Sub-yearly pesticide analysis.** _Deferred 2026-09-24._ Server region summaries are
  yearly only; finer analysis needs the nullable `application_date`. **Revisit when**
  users need seasonal pesticide timing; likely needs a server summary change.
- **CarbonMapper data source.** _Noted 2026-09-24._ `VITE_CARBONMAPPER_KEY` is reserved in
  `.env.example` (a `carbon-mapper-exploration` sibling repo exists) but nothing is
  designed. **Revisit when** CarbonMapper integration is scoped. Same for the unused
  `VITE_OPENWEATHERMAP_KEY` — remove it if no use appears.

## UI & UX

- **Command palette (Ctrl+K) and per-action keyboard shortcuts** (beyond undo/redo and
  menu-opening keys, which ship in Release 1). _Deferred 2026-09-23 (IDEA.md
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
- **HMS Smoke/Fire and Collocation Sites tabs**: _v1 roadmap; superseded 2026-09-24_ —
  the v1 tabs are replaced by the starter dashboard (ROADMAP Release 1 step 6). HMS
  becomes the smoke & fire map preset (see "Widgets"); collocation becomes the
  low-cost-vs-reference starter analysis (#10). Close when those ship.
- **Whether HMS gets a spreadsheet view of raw records**: _open since 2026-09-14_.
- **Whole-year over-fetch**: _deferred 2026-09-16; addressed by design 2026-09-24_ (automatic
  resolution + narrow fetches in the data layer — see `ARCHITECTURE.md` → "Data resolution &
  live refresh"). Close once implemented. The `month` param exists on the
  summary endpoints but isn't used.
- **No in-flight request coordination**: _deferred 2026-09-16; addressed by design 2026-09-24_
  (last-requested wins in the data layer). Close once implemented. Rapid filter changes race,
  so the last response to finish wins instead of the last request made. This applies to
  every widget data manager, so solve it once in the data layer or cache.
- **Preferences persist only the month**: _deferred 2026-09-16_. The URL is read once at
  mount and doesn't react to back/forward.
- **Migrating old `?range=` bookmark URLs**: _deferred 2026-09-16_.
- **"Default to current month" can't show monthly data until the month ends**: _noted
  2026-09-16; addressed by design 2026-09-24_ (incomplete-period stitching). Close once
  implemented. Monthly rollups only compute after month-end.

## Open decisions

Undecided items that don't block current work but must be answered before the listed
point.

- **Optional `sjvair` Python helper package** — own published package (PyPI) or a small
  file embedded in notebook bundles? Notebook bundles work without it. **Decide in** the
  Release 3 export-bundle spec.

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
- **`gridstack.js` for the layout engine**: _2026-09-23, Q4_. It owns DOM positioning and
  fights Svelte; we own a small pure layout engine instead.
- **Snippet-based context-menu items** (the monitor-inventory-tracker approach):
  _2026-09-23, Q5_. Items are data so they can be merged, tested, and reused.
- **Staging copied data instead of query descriptors**: _2026-09-23, Q2_.
- **Persisting tablet/phone layouts separately**: _2026-09-23, Q4_. Only the desktop
  layout is saved; smaller layouts are derived.
- **URL as source of truth for dashboards**: _2026-09-24_. The URL holds location; the
  document holds content.
- **JupyterLite inside dashboard pages / app-wide cross-origin isolation**: _2026-09-23,
  Q1/Q6_. JupyterLite is a separate static app.
- **User-set alert averaging windows** and **repeat notifications while a level holds**:
  _2026-09-24, alerting_.
- **An interim single-map-widget build on monitor-map 3.x**: _2026-09-24, sequencing_. The
  Map widget waits for 4.0.
- **RTL layout support**: _2026-09-24, i18n_. None of the declared languages need it.
- **Dashboard-owned Collections**: _2026-09-23, Q6_. Collections are independent and link
  back to their source dashboards only as provenance.

## Dropped

_(none yet)_
