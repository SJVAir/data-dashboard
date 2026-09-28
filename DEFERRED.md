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
  ownership of the top-level route in the meantime. **Partly pulled forward 2026-09-24:** `basePath` support ships in
  Release 1 for serving under `sjvair.com/explore/`. Still deferred: host-page
  embedding and the in-memory router mode.
- **Tighten sjvair.com CORS.** _Noted 2026-09-24._ `CORS_ORIGIN_ALLOW_ALL` plus
  `CORS_ALLOW_CREDENTIALS` is normally risky; it's largely contained by Django's default
  `SameSite=Lax` session cookie. The dashboard doesn't need it, since it's served from the
  same origin. **Revisit when** server security settings are next touched, or when
  non-browser/standalone clients are reviewed. Needs an approved sjvair.com plan.
  **Related:** the CSRF fix for session-authenticated API writes is decided for
  Release 1 (in django-resticus; see `ARCHITECTURE.md` → "CSRF protection"). CORS
  tightening can ride along with it.
- **Pinning django-resticus in sjvair.com.** _Deferred 2026-09-28 by the user, who is
  discussing it with resticus's developer._ sjvair.com installs
  `git+https://github.com/dmpayton/django-resticus@develop` unpinned, so any commit to
  `develop` reaches production at the next deploy. That is why the CSRF fix's rollout
  order matters. **Revisit after** the user's conversation with the resticus developer.
- **Server-backed saved documents & live share links.** _Sequenced later 2026-09-23;
  **scheduled into Release 1 on 2026-09-24** as a parallel server track (see
  `ROADMAP.md`)._ This includes local → account migration. It stays listed here until it ships, then moves to TODO → Done.
  **Still deferred within it:**
  - SJVAir-curated public templates, which come after the basic model ships.
  - A public listing or search of documents. `public` visibility is reserved until
    templates ship. **Revisit with** templates.
  - Promoting fields inside `body` to real database columns (the server stores `body`
    without interpreting it, so it can't query inside documents). **Revisit when** a
    server-side feature needs to query documents (e.g. "dashboards using monitor X").
- **Server-synced preferences** (last-opened dashboard, active Collection, Widget
  Creation defaults). _Deferred 2026-09-14 (v1 spec); re-confirmed 2026-09-25._ Documents
  sync in Release 1; preferences stay local per device (they're conveniences, and devices
  can reasonably differ). **Revisit when** users ask for preferences to follow them
  across devices; this would add a `preferences` kind of `SavedDocument` or a user-settings
  endpoint.
- **Heavier WASM analysis engine (e.g. DuckDB-WASM).** _Deferred 2026-09-23 (IDEA.md Q6)._
  Plain TypeScript over typed arrays in a worker is enough for now. **Revisit when**
  researcher-scale datasets make the TypeScript engine too slow or memory-bound.
- **Server-side location/radius search.** _Deferred 2026-09-14 (v1 spec)._ Needs sdk-js
  and server changes. Drawn-shape selection resolves on the client, so it doesn't depend
  on this. **Revisit when** client-side resolution gets too slow or needs data the client
  doesn't have.
- **Shared date-range helper home.** _Open since 2026-09-14; narrowed 2026-09-24._
  monitor-map's `data-chart/DateRange.ts` uses the browser's local time zone, so it
  conflicts with the Pacific-time rule and can't be reused as-is. This repo's
  `DateRangeSpec` resolution lives with the `format` module in Foundations. **Still open:**
  whether a Pacific-aware helper is later shared with monitor-map or sdk-js. **Decide
  in** the `map-sdk` 1.0 spec (also listed under "Open decisions").

- **Pinned dashboard versions and runtime config injection.** _Deferred 2026-09-24._
  sjvair.com builds dashboard `main` on each Heroku deploy, the same as monitor-map, and
  `VITE_*` keys come from Heroku config vars at build time. **Revisit when** dashboard and
  server deploys need to diverge (e.g. a server hotfix blocked by a dashboard build, or
  a need to hold the dashboard back), or when keys must rotate without a redeploy. The
  options then are a tag/version pin, a CI artifact, and config injected by the Django
  view.

## Map & selection

- **Drawn-shape map selection (box/lasso/radius).** _Sequenced later 2026-09-23 (IDEA.md
  Q2)._ This comes after feature and region picking. It will be an opt-in `terra-draw`
  plugin in `map-sdk`. **Revisit when** feature and region selection have shipped.
- **Globe-projection zoom precision.** _Noted 2026-09-16._ Large counties are under-zoomed
  in the globe projection. **Revisit when** building the Map widget on `map-sdk`.
- **`land_use` / `mtrs` region browsing ("progressive unlock").** _Deferred 2026-09-17
  (multi-region selector spec)._ These tables have roughly 66k and 28k rows. Browsing them
  only after narrowing to a small parent area needs its own design. **Revisit when**
  pesticide analyses need parcel-level (MTRS) selection.
- **`place` / `protected` / `custom` region types.** _Deferred 2026-09-17._ They have 0
  rows in dev today. No code changes are needed once they have data. **Revisit when** data
  appears. Forecast zones are stored as `custom`.
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
  v1 hardcoded `"pm25" | "o3"` (which goes away with the v1 code).
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

- **CEIDARS facility emissions.** _Deferred 2026-09-24 (docs review)._ On the server
  (yearly facility emissions + health risk indices) but no widget, analysis, or SDK
  wrapper is planned. **Revisit when** an emissions/facility-proximity use case comes up.
- **Combined heat + air-quality tier bump** (raise the tier by one when both conditions
  are at tier ≥ 2, reflecting combined heat and ozone effects). _Deferred 2026-09-28._ It
  is a health claim needing expert backing. **Revisit when** the user or a health advisor
  confirms a rule.
- **Pesticide timing → health analysis** (from IDEA.md's prior brainstorm). _Deferred
  2026-09-24._ No health outcome data beyond CalEnviroScreen; closest planned work is
  starter #9 (use trends) and #7 (CES indicators). **Revisit with** the outside-health-data
  entry above.
- **Server summaries for CIMIS weather and PM10.** _Deferred 2026-09-25._ Only pm25, o3,
  no2, so2 and co are summarized. Until then the client fetches these raw (span-capped,
  chunked) and downsamples them in a worker. **Revisit when** raw fetches get slow or large
  (e.g. a multi-year weather chart takes more than a few seconds). Needs an approved
  sjvair.com plan (add them to the summary rollups).
- **Sub-yearly pesticide analysis.** _Deferred 2026-09-24._ Server region summaries are
  yearly only; finer analysis needs the nullable `application_date`. **Revisit when**
  users need seasonal pesticide timing; likely needs a server summary change.
- **CarbonMapper data source.** _Noted 2026-09-24._ `VITE_CARBONMAPPER_KEY` is reserved in
  `.env.example` (a `carbon-mapper-exploration` sibling repo exists) but nothing is
  designed. **Revisit when** CarbonMapper integration is scoped. Same for the unused
  `VITE_OPENWEATHERMAP_KEY` — remove it if no use appears.

## Map plugins

- **Map plugins for the remaining server datasets.** _Deferred 2026-09-24 (docs review)._
  First release covers monitors, region fill, HMS smoke/fire, collocation, EV, wind,
  weather. Deferred: pesticide use and SprayDays notices, CalEnviroScreen tracts,
  CalHeatScore ZIPs, forecast zones, CEIDARS facilities, TEMPO rasters. The `map-sdk` plugin
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

## Alerts

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
  installed sites. Brings in the dashboard's **first service worker** (none in Release 1;
  `ARCHITECTURE.md` → "Platform strategy"),
  VAPID keys, and a server push-subscription table. **Revisit when** the first alerting
  iteration (SMS + email + inbox) ships. That service worker also enables **in-browser
  self-monitoring notifications on Android/iOS** (desktop-only in Release 1). **Optional
  add-on:** app-shell caching, decided when the worker is built.
- **v3-mobile PM2.5 gauge on the old scale.** _Noted 2026-09-28 (docs review)._
  `v3-mobile/src/components/PMGauge.svelte` hardcodes the full pre-2024 PM2.5 scale. The
  sjvair.com breakpoint fix doesn't reach it. **Revisit with** the PM2.5 breakpoint fix
  (ideally the gauge reads metadata levels). Needs a v3-mobile plan and an app release
  (explicit approval).
- **v3-mobile on the new alert-rule endpoints.** _Deferred 2026-09-28._ Release 2 keeps
  v3-mobile working through the legacy subscription endpoints, but dashboard-only rules
  (regions, forecasts, pesticide notices) don't appear in the app. **Revisit when**
  Release 2 ships, or when v3-mobile users ask to see or manage those rules. Needs an
  approved v3-mobile plan.
- **Remove the legacy subscription endpoints.** _Deferred 2026-09-28._ They remain a
  compatibility layer over alert rules, with usage logged by app version. **Revisit when**
  v3-mobile **and** any sjvair.com pages use the new rule endpoints, **and** legacy usage
  has been near zero for a set period (e.g. 4–8 weeks), or a v3-mobile minimum-version
  prompt guarantees nobody needs them. Removing them doesn't affect anyone's alerts.
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

- **Multiple editors on a shared document** (group/co-owner permissions). _Deferred
  2026-09-25._ The most plausible real need is a community group maintaining one
  dashboard, taking turns. It works with the existing versioned sync plus automatic
  replay, and needs no CRDT. **Revisit when** community groups or schools ask for shared
  ownership.
- **Real-time co-editing (Automerge or similar CRDT).** _Deferred 2026-09-25._ Automerge's
  core library works over our existing Django HTTP API (it merges in the browser and
  Django stores bytes); its optional `automerge-repo` sync server isn't required. No
  demand is expected: research and school workflows are solo work with handoffs.
  **Revisit when** simultaneous editing is actually requested, or overlap prompts turn
  out to be common. **Note:** adopting it means a one-time conversion of all stored JSON
  documents to Automerge's format, plus reworking `schemaVersion` upgrades as CRDT
  changes.

## Internationalization

- **Translations and language switching.** _Deferred 2026-09-24._ No translations exist
  and there's no timeline; the app ships English-only but translation-ready (see
  `ARCHITECTURE.md` → "Internationalization"). Deferred together: Spanish, Filipino (tl),
  and Hmong (hmn) message files; a language picker (saving to `User.language` when
  signed in); server `.po` files for sjvair.com (metadata labels/guidance, alert text);
  per-language metadata caching; alerts sent in `User.language`; a formatting fallback
  for `hmn` (thin CLDR/`Intl` data); i18n in monitor-map and v3-mobile (`map-sdk` is translation-ready via its `messages`
  provider but ships English defaults). Health guidance
  and alert text need human translation or review, not machine-only. **Revisit when**
  translators or funding for translation are available.

## UI & UX

- **Command palette (Ctrl+K) and per-action keyboard shortcuts** (beyond undo/redo and
  menu-opening keys, which ship in Release 1). _Deferred 2026-09-23 (IDEA.md
  Q5)._ The shared action registry is designed to feed these. **Revisit when** the action
  registry and the widget "⋯" menus have shipped.
- **Visual and brand design system.** _Deferred 2026-09-14._ IDEA.md sets the direction
  (Tailwind + shadcn-svelte, never Bulma, clean but not corporate, with animations).
  Colors may come from the server's existing pages. **Revisit when** the dashboard shell
  is built, as a dedicated design pass.

- **Visual dashboard picker** (thumbnail grid instead of the dropdown). _Deferred
  2026-09-24._ IDEA.md: "at minimum via dropdown; ideally via a nicer visual picker".
  Release 1 uses a top-nav dropdown. **Revisit when** people routinely keep more than
  about 5–7 dashboards, or public templates ship and need browsing.

## Legacy Monitors-tab follow-ups

These came from the Monitors-tab work. That code is removed in Release 1's Foundations
step (a fresh start), so each item stays here only until the new design delivers what
it describes.

- **Chart and spreadsheet views**: _deferred 2026-09-15; superseded 2026-09-24_: now the
  Chart and Data table widgets (ROADMAP Release 1 step 4). Close when they ship.
- **HMS Smoke/Fire and Collocation Sites tabs**: _v1 roadmap; superseded 2026-09-24_ —
  the v1 tabs are removed in Release 1's Foundations step (a fresh start). HMS
  becomes the smoke & fire map preset (see "Widgets"); collocation becomes the
  low-cost-vs-reference starter analysis (#10). Close when those ship.
- **Whole-year over-fetch**: _deferred 2026-09-16; addressed by design 2026-09-24_ (automatic
  resolution + narrow fetches in the data layer — see `ARCHITECTURE.md` → "Data resolution &
  live refresh"). Close once implemented. The `month` param exists on the
  summary endpoints but isn't used.
- **No in-flight request coordination**: _deferred 2026-09-16; addressed by design 2026-09-24_
  (last-requested wins in the data layer). Close once implemented. Rapid filter changes race,
  so the last response to finish wins instead of the last request made. This applies to
  every widget data manager, so solve it once in the data layer or cache.
- **"Default to current month" can't show monthly data until the month ends**: _noted
  2026-09-16; addressed by design 2026-09-24_ (incomplete-period stitching). Close once
  implemented. Monthly rollups only compute after month-end.

## Open decisions

Undecided items that don't block current work but must be answered before the listed
point.

- **Optional `sjvair` Python helper package** — own published package (PyPI) or a small
  file embedded in notebook bundles? Notebook bundles work without it. **Decide in** the
  Release 3 export-bundle spec.
- **Private-preview mechanism**: a staging Heroku app or an unlisted route on
  sjvair.com. **Decide in** the Release 1 hosting-track plan (the preview starts around
  Release 1 step 4).
- **Date-range method toggle in Widget Creation**: a dropdown (IDEA.md's default) or
  something more elegant (e.g. a segmented control) for set / rolling / custom.
  **Decide in** the Widget Creation spec (Release 1 step 4), with a mockup.
- **Analysis view layout** (Collections drawer, list of analyses, results area). **Decide
  in** the Release 3 step 1 spec (Analysis engine).
- **User-defined analysis editor UI** (IDEA.md Q6: "What should user-defined analysis
  creation look like"). The data model (`AnalysisSpec`) is decided; the editor UX isn't.
  **Decide in** the Release 3 step 1 spec (Analysis engine).
- **Geographic crosswalk method**: monitor→region, tract (CES), ZIP (CalHeatScore),
  county/MTRS (PUR), and area weighting. **Decide in** the Release 3 step 1 spec (Analysis
  engine).
- **Shared date-range helper home** (see "Platform & infrastructure"). **Decide in** the
  `map-sdk` 1.0 spec.
- **JupyterLite app: owner repo and deploy path** (docs review 2026-09-28). Options: a
  separate build in this repo, or a new repo, imported by sjvair.com like the dashboard,
  with a Django view setting COOP/COEP only on `/notebooks/`. **Decide in** the Release 3
  step 4 spec (JupyterLite app).

- **Action-tier assignments and heat guidance wording** (for the shared `tier` scale and
  `calheatscore/meta/` guidance). **The user decides these personally.** They're needed
  before the Release 1 step 3 metadata plan finalizes scale metas, and before step 4's "Can
  we go outside?" card. Open question within it: CalHeatScore's official recommended
  actions, or SJVAir's own wording.

## Decided against (kept for the record, not planned)

Recorded so nobody re-proposes these without the context. Reopen only with a new reason.

- **Desktop-first / "web as a side effect of Tauri"**: _2026-09-23, Q1_. See the
  Tauri-build entry above.
- **Time scrubbing or time selection inside map widgets**: _2026-09-23, Q2_. Time is fixed
  per widget, and calendar and chart widgets handle narrowing the time range.
- **A long-lived monitor-map 3.x compat shim**: _2026-09-23, Q3_. No compat shim; with the
  `map-sdk` split (2026-09-24), consumers migrate one at a time (v3-mobile stays on `^3.x`
  until its own migration).
- **An in-place monitor-map 4.0 rewrite**: _2026-09-24_. Replaced by splitting out
  `@sjvair/map-sdk` (library) with monitor-map rebuilt on it (experience), which also
  removes the risk of shipping an unfinished 4.0 through sjvair.com's unpinned import.
- **Keeping the name "monitor-map" for the map library**: _2026-09-24_. The library is
  `map-sdk`; the monitor-map name stays with the monitor-map experience.
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
  Map widget waits for `map-sdk`.
- **Explicit Save as the primary save model**: _2026-09-24_. Autosave plus undo instead;
  "Save as copy…" and "Export…" remain.
- **Token auth for the Release 1 web build**: _2026-09-24_. It would put tokens in browser
  storage and force a second sign-in for people already signed in to sjvair.com. Cookie
  sessions instead; tokens remain for Tauri and standalone builds.
- **Hosting Release 1 on a separate origin** (e.g. `dashboard.sjvair.com`): _2026-09-24_.
  Chose same-origin hosting under a path for cookie auth; token auth stays supported for
  Tauri and future standalone builds.
- **Keeping or adapting the v1 app while building the new one**: _2026-09-24_. It was
  never deployed. Foundations removes it, and a fresh, cohesive codebase is built
  instead of retrofitting.
- **Single-letter route segments** (e.g. `/d/:id`) and **readable slugs in URLs**:
  _2026-09-25_. Routes use readable words; IDs stay opaque.
- **`/dashboard/` as the base path, and dashboard IDs directly under the base**
  (`/dashboard/:id`): _2026-09-25_. Chose `/explore/` plus plural collections
  (`/explore/dashboards/:id`) so IDs never share a level with fixed words like
  `analysis` and `shared`, and the base names the whole app.
- **Offline-first for the web build** (a Release 1 app-shell service worker that opens the
  app offline, and a persistent IndexedDB/OPFS data cache): _2026-09-28_. Air-quality data is
  live, schools are online, and researchers export notebooks. Release 1 keeps local
  documents, sync, manifest-based installability, and an offline banner. A service worker
  comes with web push; true offline-first stays a Tauri concern.
- **Keeping the dashboard repo private** (a read-only deploy token for the import, or a
  CI-built artifact): _2026-09-28_. There was no reason to keep it private, so it's being
  made public, matching monitor-map and sdk-js.
- **RTL layout support**: _2026-09-24, i18n_. None of the declared languages need it.
- **Dashboard-owned Collections**: _2026-09-23, Q6_. Collections are independent and link
  back to their source dashboards only as provenance.

## Dropped

Dropped 2026-09-24 with the user's approval (docs review), each overtaken by later decisions:

- **Icon-only collapsed sidebar** (deferred 2026-09-16). The top nav bar replaces the
  sidebar.
- **Cross-type region selection persistence in the URL** (deferred 2026-09-17).
  Selections live in saved widget configs; the URL holds only location.
- **Whether HMS gets a spreadsheet view of raw records** (open since 2026-09-14). The Data
  table widget covers any dataset layer.
- **Preferences persist only the month; URL read once at mount** (deferred 2026-09-16).
  Replaced by autosaved documents and the new routing.
- **Migrating old `?range=` bookmark URLs** (deferred 2026-09-16). Not needed: the v1 app
  was never deployed, so there are no public v1 URLs (a redirect step was briefly planned
  and removed on 2026-09-24).
