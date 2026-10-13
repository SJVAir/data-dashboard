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
  possible from a web page. (IDEA.md asked for "JupyterLabs for the desktop app". Bundling
  JupyterLab into Tauri was not chosen because it means shipping a full Python runtime and
  packages, which is large and hard to maintain; JupyterLite already works offline in
  Tauri, and researchers usually have their own Jupyter.) **Revisit when** the Tauri build starts.
- **Embeddable production build.** _Deferred 2026-09-14 (v1 spec)._ Needs a `sv-router`
  escape hatch (`routerEscapeHatch`/`basePath`) and a non-URL fallback for view state.
  **Revisit when** the dashboard's core views exist. Keep state managers from hardcoding
  ownership of the top-level route in the meantime. **Partly pulled forward 2026-09-24:** `basePath` support ships in
  Release 1 for serving under `sjvair.com/workspace/`. Still deferred: host-page
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
- **Server-side location/radius search.** _Deferred 2026-09-14 (v1 spec); narrowed
  2026-09-28; updated 2026-10-13._ Point → containing-region lookup is **scheduled**
  (Release 1 step 3, `regions/places/lookup/`; still name-only on the server today). The
  server now has radius and buffer queries for pesticides (`sections/` by
  `lat,lng,radius`; `locations/` by radius up to 10 mi; `notices/active/` by bbox or
  `region`+`buffer`, but not by radius) and `regions/<id>/?buffer=1|3|5`, which Release
  2's pesticide-notice rules can build on. Still deferred: general
  monitor search by location/radius. Needs sdk-js and server changes. Drawn-shape selection resolves on the client, so it doesn't depend
  on this. **Revisit when** client-side resolution gets too slow or needs data the client
  doesn't have.
- **Shared date-range helper home.** _Open since 2026-09-14; narrowed 2026-09-24._
  monitor-map's `data-chart/DateRange.ts` uses the browser's local time zone, so it
  conflicts with the Pacific-time rule and can't be reused as-is. This repo's
  `DateRangeSpec` resolution lives with the `format` module in Foundations. **Still open:**
  whether a Pacific-aware helper is later shared with monitor-map or sdk-js. **Decide
  in** the `map-sdk` spec (Release 1 step 5; also listed under "Open decisions").

- **Pinned dashboard versions and runtime config injection.** _Deferred 2026-09-24._
  sjvair.com builds dashboard `main` on each Heroku deploy, the same as monitor-map, and
  `VITE_*` keys come from Heroku config vars at build time. **Revisit when** dashboard and
  server deploys need to diverge (e.g. a server hotfix blocked by a dashboard build, or
  a need to hold the dashboard back), or when keys must rotate without a redeploy. The
  options then are a tag/version pin, a CI artifact, and config injected by the Django
  view.

- **Branch protection on `main`** (PRs only, required CI). _Deferred 2026-09-28._ The user
  sometimes pushes small fixes straight to `main`. **Revisit when** more contributors join,
  or at go-live, when `main` becomes the production deploy.
- **Uploading source maps to Sentry.** _Deferred 2026-10-13._ It needs a secret Sentry
  token in sjvair.com's Heroku build. Errors are reported without it, but with minified
  stack traces. The repo is public and MIT, so serving source maps publicly is a simpler
  alternative. **Revisit when** an unreadable stack trace first costs real debugging time.
- **Bulk migration of saved references on the server** (rewriting every saved widget or
  rule from a retired id to its replacement). _Deferred 2026-10-13._ The `replacedBy`
  pointer handles it one widget at a time, as an undoable edit. **Revisit when** a
  widely used id is retired and per-widget switching would affect many people.
- **Full version history for documents** (previews, side-by-side comparison, named
  versions). _Deferred 2026-10-13._ Release 1 has a dated "Restore an earlier version"
  list for recovery only. **Revisit when** people use restore for everyday undo rather
  than recovery, or ask to compare versions.

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
- **`protected` / `custom` / `school_district` region data.** _Deferred 2026-09-17; re-checked
  2026-09-28 and 2026-10-13._ The `place` region type was **removed** from the server
  (migrations 0009/0010); name lookup now tries city, then CDP, then urban area. New types
  exist: `air_district` and `ab617`. `school_district` has an import command
  (`import_school_districts`), and there is a new **`Location`** model for schools and
  child care (`import_schools`). Plans rely on **`school_district`** (school region
  alerts, the picker) and on the **3 `custom` forecast zones** (Tulare, Kern, Sequoia);
  the other 6 forecast zones, including Fresno, are county regions, so a zone lookup goes
  through the forecasts data or a metadata zone list, not `type=custom`. **Verify
  production row counts before the step 3 metadata plan and the Release 2 alerts plan**
  (local dev had 0 rows of `school_district` and `custom` on 2026-09-28); import them if
  missing. Nothing planned uses `protected`. **Revisit when** those two plans start.
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

- **CEIDARS facility emissions.** _Deferred 2026-09-24 (docs review); updated 2026-10-13._ On
  the server (yearly facility emissions + health risk indices) but no widget, analysis,
  or SDK wrapper is planned. **Heads-up:** the open sjvair.com PR #282 (Facility Emissions
  Explorer) replaces the `ceidars` app with an `emissions` app, moves the API to
  `/api/2.0/emissions/…`, and adds CEPAM, dairies, wells, and toxics. The user confirmed
  (2026-10-13) that this lands **before the dashboard goes live**, so anything we build
  uses `emissions` from the start. **Revisit when** an emissions or facility-proximity
  use case comes up, and after #282 lands.
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
- **Sub-yearly pesticide analysis.** _Deferred 2026-09-24; updated 2026-10-13._ The server
  now has **monthly pesticide rollups** (`PesticideUseRollup`, with month 0 for undated
  records), exposed through the new `sections/` and `townships/` endpoints (`month=`) and
  section detail. The `region/<id>/summary/` endpoint is still chemical × commodity ×
  year. Starter analysis #9 stays yearly for now. **Revisit when** users need seasonal
  pesticide timing; it now needs sdk-js wrappers and a client adapter rather than new
  server summaries.
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

- **A free "last N days" entry for trailing ranges.** _Deferred 2026-10-13._ The Rolling
  method offers presets (24 hours to 12 months) and Custom covers anything else; the
  saved format already holds any amount and unit. **Revisit when** people ask for a
  length the presets lack.
- **Linking widgets**: _deferred 2026-09-28._ (The built-in starter's "Change place" bar
  is a narrow, starter-only exception; design the two together.) First step: a **dashboard-wide place and date
  range** that widgets can choose to follow ("change the county once, everything
  updates"). Later: full **cross-filtering** (e.g. clicking a map region filters a chart and
  calendar; a calendar selection narrows a chart). Both touch the document model, Widget
  Creation, and undo. **Revisit when** pilot or private-preview users ask for it.
- **Additional widget types.** _Deferred 2026-09-23 (IDEA.md Q8)._ Brainstormed but not in
  the first-release widget set (see `ARCHITECTURE.md` → "Widget catalog"). **Revisit
  when** the first-release widgets ship, or a specific audience asks for one. The list:
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

- **An opt-in "back to normal" message by email.** _Deferred 2026-10-13._ All channels follow
  the server's escalation-only rules, with no all-clear; the in-app inbox shows when an
  alert eased or ended. An email-only all-clear has no per-message cost and could be
  offered as an opt-in. **Revisit when** users ask to be told when conditions improve.
- **Opt-in quiet hours for alert texts** (e.g. none between 10 PM and 7 AM). _Deferred
  2026-10-13._ The server's escalation logic makes this safe: a held text leaves the user
  "not yet told", so the alert goes out at the next check after quiet hours. It could
  only be opt-in, since smoke often worsens overnight. **Revisit when** people complain
  about night texts, or when the rule UI gains a settings page.
- **Numeric alert thresholds** (e.g. "PM2.5 > 25 µg/m³"). _Deferred 2026-09-24 (alerting
  design)._ First iteration uses level categories only: simpler for community/schools
  and consistent with the level colors shown everywhere. **Revisit when** researchers or
  advocates ask for raw-value alerts; offer as an "advanced" option.

- **Web push for alerts.** _Sequenced as next iteration 2026-09-24._ Reaches desktop
  and Android with the dashboard closed, no per-message cost; iOS only for home-screen-
  installed sites. Brings in the dashboard's **first service worker** (served by Django under `/workspace/`,
  since static files are on another origin; none in Release 1;
  `ARCHITECTURE.md` → "Platform strategy"),
  VAPID keys, and a server push-subscription table. **Revisit when** the first alerting
  iteration (SMS and email, plus the inbox) ships. **Constraint:** the bad-build block list
  relies on a reload always fetching the current build, so this worker must not serve a
  stale app shell. That service worker also enables **in-browser
  self-monitoring notifications on Android/iOS** (desktop-only in Release 1). **Optional
  add-on:** app-shell caching, decided when the worker is built.
- **Mobile app on the new alert-rule endpoints.** _Deferred 2026-09-28._ Release 2 keeps
  mobile working through the legacy subscription endpoints, but dashboard-only rules
  (regions, forecasts, pesticide notices) don't appear in the app. **Revisit when**
  Release 2 ships, or when mobile users ask to see or manage those rules. Needs an
  approved mobile plan.
- **Remove the legacy subscription endpoints.** _Deferred 2026-09-28._ They remain a
  compatibility layer over alert rules, with usage logged by app version. **Revisit when**
  mobile **and** any sjvair.com pages use the new rule endpoints, **and** legacy usage
  has been near zero for a set period (e.g. 4–8 weeks), or a mobile minimum-version
  prompt guarantees nobody needs them. Removing them doesn't affect anyone's alerts.
- **Mobile app push for alerts (`mobile`).** _Deferred 2026-09-24._ No FCM/APNs setup
  exists in `mobile` or the server. **Revisit when** `mobile` plans push
  notifications; needs its own approved plan.

## Mobile app (`../mobile`)

- **Mobile migration to `map-sdk` and the rebuilt monitor-map (5.0).** _Deferred
  2026-09-28; updated 2026-10-13._ It doesn't block Release 1 or go-live. The mobile app
  is on monitor-map `^4.2.0` and keeps working on 4.x. It depends on
  `@sjvair/monitor-map/core` (`monitorsManager` as an app-wide store,
  `provideMonitorMapRouter`) and `/routes` (`monitorMapRoutes`), which the rebuild must
  keep. **Revisit when** the mobile team wants the new stores or features. Bundle the
  other mobile follow-ups into the same effort where timing allows: the new alert-rule
  endpoints, and the hardcoded PM2.5 scale unless it has already shipped with the
  breakpoint fix. Needs a mobile plan and an app release (explicit approval; publishing
  a GitHub Release there ships to TestFlight and the Play beta track).
- **Mobile app's hardcoded PM2.5 scale.** _Noted 2026-09-28; widened 2026-10-13._ Three
  files hardcode the pre-2024 scale: `src/components/PMGauge.svelte`
  (12.1/35.5/55.5/150.5/250.5), `src/lib/colors.ts` (`pmValueColors`,
  `ozoneValueColors`), and `src/components/AirQualityGuidelines.svelte`. Only its Alerts
  and Subscriptions screens read levels from metadata. The sjvair.com breakpoint fix
  doesn't reach these. **Revisit with** the PM2.5 breakpoint fix (ideally they read
  metadata levels), or with the mobile migration, whichever comes first. Needs a mobile
  plan and an app release (explicit approval).

## Accounts

- **Shared-computer guest mode.** _Deferred 2026-09-24._ A mode (e.g. enabled by a
  teacher-distributed `?guest` link) where nothing persists after the tab closes.
  Current approach: per-account local spaces (sign-out removes them), the browser profile
  as the boundary for signed-out work, "Clear my data", and session-only sign-in. **Revisit when** a school reports shared-device problems (i.e. students share
  one browser profile).
- **Accounts for children under 13** (with verifiable parental or school consent).
  _Deferred 2026-10-13._ It needs consent workflows, record-keeping, and stricter data
  rules. Under-13s use the dashboard anonymously. **Revisit when** a school partner needs
  student accounts, together with class accounts below.
- **Teacher / class / organization accounts.** _Deferred 2026-09-24._ Rosters, class
  dashboards, shared org alerts. Teachers share via links for now. **Revisit when**
  schools ask for managed class use, likely after server-backed live share links exist.

- **Multiple editors on a shared document** (group/co-owner permissions). _Deferred
  2026-09-25; model prepared 2026-09-28: editors would be a separate access table (document,
  user, role); only the owner deletes._ The most plausible real need is a community group maintaining one
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

- **Translations and language switching.** _Deferred 2026-09-24; re-checked 2026-10-13._ The
  server now has empty locale catalogs (es, tl, hmn; 395 untranslated entries each) and
  sends SMS in the user's language, but no actual translations exist and there's no
  timeline; the app ships English-only but translation-ready (see
  `ARCHITECTURE.md` → "Internationalization"). Deferred together: Spanish, Filipino (tl),
  and Hmong (hmn) message files; a language picker (saving to `User.language` when
  signed in); translated content for sjvair.com's catalogs (metadata labels/guidance, alert
  text; the mechanism already sends SMS in `User.language`); per-language metadata
  caching; a formatting fallback
  for `hmn` (thin CLDR/`Intl` data); i18n in monitor-map and mobile (`map-sdk` is translation-ready via its `messages`
  provider but ships English defaults). Health guidance
  and alert text need human translation or review, not machine-only. **Revisit when**
  translators or funding for translation are available.

## UI & UX

- **Command palette (Ctrl+K) and per-action keyboard shortcuts** (beyond undo/redo and
  menu-opening keys, which ship in Release 1). _Deferred 2026-09-23 (IDEA.md
  Q5)._ The shared action registry is designed to feed these. **Revisit when** the action
  registry and the widget "⋯" menus have shipped.
- **Visual and brand design system.** _Deferred 2026-09-14; **scheduled 2026-09-28** as its
  own sub-project before Release 1 step 4 (Foundations builds the theme-token layer it
  plugs into)._ It stays listed here until it ships.

- **Aggregate usage counts** (e.g. which widgets get used; cookieless, never per-person).
  _Deferred 2026-09-28._ Release 1 sends no analytics, only scrubbed error reports.
  **Revisit when** someone needs usage numbers (e.g. for funding reports or prioritizing
  widgets).
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
- **Private-preview mechanism**: a staging Heroku app, an unlisted route on sjvair.com, or
  (new option, 2026-10-13) the server's **waffle `beta_tools` flag**, which already gates
  `/tools/pesticides/` to flagged "Beta testers" through `BetaToolsMiddleware`. Gating
  `/workspace/` the same way would give a preview on production with no separate
  deployment. **Decide in** the Release 1 hosting-track plan (the preview starts around
  Release 1 step 4).
- **Date-range method toggle in Widget Creation**: a dropdown (IDEA.md's default) or
  something more elegant (e.g. a segmented control) for set / rolling / custom.
  **Decide in** the Widget Creation spec (Release 1 step 4), with a mockup.
- **Will the server's `sms_alerts` flag be on for everyone before Release 2?** (2026-10-13)
  Today only flagged accounts receive alert texts. The rule UI handles either answer (it
  offers only the channels the server reports as available), but the answer decides
  whether most users see SMS as an option at launch. **The user asks the server team;
  decide in** the Release 2 alerts plan.
- **Legal confirmation of the account age policy** (13+, neutral age confirmation, no
  under-13 accounts; COPPA). **The user arranges this** with whoever advises SJVAir, before
  the email-only accounts plan is finalized.
- **Copyright holder name for the MIT `LICENSE` files** (e.g. "SJVAir" or the organization's
  legal name). **The user decides**, before the Foundations license task.
- **Analysis view layout** (Collections drawer, list of analyses, results area). **Decide
  in** the Release 3 step 1 spec (Analysis engine).
- **User-defined analysis editor UI** (IDEA.md Q6: "What should user-defined analysis
  creation look like"). The data model (`AnalysisSpec`) is decided; the editor UX isn't.
  **Decide in** the Release 3 step 1 spec (Analysis engine).
- **Geographic crosswalk method**: monitor→region, tract (CES), ZIP (CalHeatScore),
  county/MTRS (PUR), and area weighting. **Decide in** the Release 3 step 1 spec (Analysis
  engine).
- **Shared date-range helper home** (see "Platform & infrastructure"). **Decide in** the
  `map-sdk` spec (Release 1 step 5).
- **JupyterLite app: owner repo and deploy path** (docs review 2026-09-28). Options: a
  separate build in this repo, or a new repo, imported by sjvair.com like the dashboard,
  with a Django view setting COOP/COEP only on `/notebooks/`. **Constraint found
  2026-10-13:** production static files are on S3 (another origin), but JupyterLite is a
  whole static site with its own service worker and needs cross-origin isolation, so it
  must be served from sjvair.com's own origin. **Decide in** the Release 3 step 4 spec
  (JupyterLite app).

- **Air-quality tier assignments**: which CalHeatScore tier (0–4) each of the 6 AQ levels
  maps to. **The user decides these personally**, before the Release 1 step 3 metadata plan
  finalizes scale metas and before step 4's "Can we go outside?" card. (Decided: the tier
  scale is CalHeatScore's own, heat maps one to one, and heat guidance uses CalHeatScore's
  official recommended actions, confirmed 2026-09-28.)

## Decided against (kept for the record, not planned)

Recorded so nobody re-proposes these without the context. Reopen only with a new reason.

- **Desktop-first / "web as a side effect of Tauri"**: _2026-09-23, Q1_. See the
  Tauri-build entry above.
- **Time scrubbing or time selection inside map widgets**: _2026-09-23, Q2_. Time is fixed
  per widget, and calendar and chart widgets handle narrowing the time range.
- **A long-lived monitor-map 3.x compat shim**: _2026-09-23, Q3_. No compat shim; with the
  `map-sdk` split (2026-09-24), consumers migrate one at a time (the mobile app stays on monitor-map 4.x
  until its own migration).
- **Rewriting monitor-map in place as the multi-map library**: _2026-09-24_. Replaced by
  splitting out `@sjvair/map-sdk` (library) with monitor-map rebuilt on it (experience).
  (monitor-map 4.0–4.2 did ship in October 2026, but as a UI and packaging major on the
  same one-map-per-page architecture; the rebuild on `map-sdk` will be monitor-map 5.0.)
- **Keeping the name "monitor-map" for the map library**: _2026-09-24_. The library is
  `map-sdk`; the monitor-map name stays with the monitor-map experience.
- **Free-form, overlapping dashboard windows**: _2026-09-23, Q4_. We chose a snapping grid.
- **A horizontally scrolling dashboard canvas**: _2026-09-23, Q4_. It grows vertically,
  and multiple dashboards handle crowding.
- **`gridstack.js` for the layout engine**: _2026-09-23, Q4_. It owns DOM positioning and
  fights Svelte; we own a small pure layout engine instead.
- **Snippet-based context-menu items** (the monitor-inventory-tracker approach):
  _2026-09-23, Q5_. Items are data so they can be merged, tested, and reused.
- **Staging copied data instead of query descriptors**: _2026-09-23, Q2_. Descriptors stay
  small, stay current, and keep fetched data out of saved documents.
- **Persisting tablet/phone layouts separately**: _2026-09-23, Q4_. Only the desktop
  layout is saved; smaller layouts are derived.
- **URL as source of truth for dashboards**: _2026-09-24_. The URL holds location; the
  document holds content.
- **JupyterLite inside dashboard pages / app-wide cross-origin isolation**: _2026-09-23,
  Q1/Q6_. JupyterLite is a separate static app.
- **User-set alert averaging windows**: _2026-09-24, alerting_. The server defines one
  window so every subscriber and the UI's explanation agree.
- **Repeat notifications while a level holds**, beyond the server's single daily 10 AM
  "still bad" reminder: _2026-09-24; amended 2026-10-13_ when the redesigned server's
  reminder was adopted. More frequent repeats would undo its throttling.
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
- **`/explore/` as the base path**: _2026-10-13_. Chosen 2026-09-25, then replaced by
  `/workspace/` because sjvair.com's `/tools/` section now holds "data explorers"
  (pesticides, then emissions). `/tools/dashboard/` and `/data/` were also considered and
  rejected (a repeated word and longer share links; the same confusion).
- **`/dashboard/` as the base path, and dashboard IDs directly under the base**
  (`/dashboard/:id`): _2026-09-25_. Chose a neutral app-level base (now `/workspace/`) plus plural collections
  (`/workspace/dashboards/:id`) so IDs never share a level with fixed words like
  `analysis` and `shared`, and the base names the whole app.
- **Offline-first for the web build** (a Release 1 app-shell service worker that opens the
  app offline, and a persistent IndexedDB/OPFS data cache): _2026-09-28_. Air-quality data is
  live, schools are online, and researchers export notebooks. Release 1 keeps local
  documents, sync, manifest-based installability, and an offline banner. A service worker
  comes with web push; true offline-first stays a Tauri concern.
- **Keeping the dashboard repo private** (a read-only deploy token for the import, or a
  CI-built artifact): _2026-09-28_. There was no reason to keep it private, so it was made
  public (done 2026-09-28), matching monitor-map and sdk-js.
- **Merging `planning` into `main` before planning is finished**: _2026-09-28_. It merges
  once planning completes, with approval.
- **Dropping to Tailwind v3 for older browsers**: _2026-09-28_. It would go against
  "nothing ripped out" at high cost for a shrinking set of devices. Revisit only if the
  preview shows many partner-school devices below the v4 floor.
- **A server-side `text_color` per level**: _2026-09-28_. It's computed with color2k's
  `readableColor` instead. Add an optional field only if a designer needs a non-black/white
  override.
- **Notifying on every level change, with a default "back to normal" message** (the
  2026-09-28 alert design): _2026-10-13_. Replaced by the server's escalation-only rules
  after its throttling audit (8–27 texts a day per monitor under the earlier behavior).
- **A per-person daily cap across all alert rules**: _2026-10-13_. The server's throttling
  spec (2026-10-06) considered a cross-monitor cap and chose per-subscription limits
  instead; we follow that.
- **Automatic text filtering or pre-publication review of shared pages**: _2026-10-13_.
  Too heavy for the expected volume, and it would delay teachers. Shared pages are
  labeled as user-made, reportable, and removable by staff instead.
- **A grace period for account deletion** (deactivate for 30 days, then delete):
  _2026-10-13_. It would change behavior the mobile app already has and keep personal data
  longer than asked; the backup download covers a change of mind for documents.
- **"Mark for analysis" on every widget** (IDEA.md's wording): _2026-09-28_. Notes and the
  Alerts feed hold no query, so they are `analyzable: false` and don't offer it.
- **Building Widget Creation "based on what we currently have"** (IDEA.md's wording):
  _2026-09-28_. It is built fresh; the v1 tabs' options reappear as accordions, but no
  v1 code is carried over unless it is exactly what the new design needs.
- **Server `sqid`s as the saved reference for regions and locations** (with official codes
  only for built-in documents and fixtures): _2026-10-13_. Two reference styles in one
  format, and a production re-import would still break everyone's saved dashboards.
- **Stretching the server's `Alert` model to non-monitor targets** (an optional monitor plus
  region, zone, and notice targets): _2026-10-13_. It would change a model that was just
  redesigned and approved, and a pesticide notice is not an alert that opens and closes.
  A separate rule-event record covers every kind of rule instead.
- **A client-only identity check before syncing** (no server enforcement): _2026-10-13_. It
  leaves a window where the cookie changes between the check and the save; the server
  refuses mismatched saves instead.
- **Serving the dashboard's own `index.html` from the `/workspace/*` view**: _2026-10-13_. An
  assumption recorded on 2026-09-28; the user corrected it. The dashboard is embedded in
  a Django template view, as the monitor map is.
- **Extending sjvair.com's base template for the dashboard page**: _2026-10-13_. It would
  load Google Tag Manager and Analytics, Bulma's global styles, and inline scripts, and
  wrap the dashboard in the site header and footer. A dedicated bare template is used.
- **A build-manifest file read by the server, or the CSP in a `<meta>` tag**: _2026-10-13_.
  Unnecessary once the page is a Django template: the view holds the host list and sends
  the header, and the build id is stamped into the app's code.
- **Serving the dashboard's built files from sjvair.com's own origin through WhiteNoise**:
  _2026-10-13_. The user chose the map's existing S3 pipeline, with the cross-origin
  accommodations listed in `ARCHITECTURE.md` → "Template embedding". Worth reconsidering
  if those accommodations prove costly (workers, the service worker, or compression).
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
