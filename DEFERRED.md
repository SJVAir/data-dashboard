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
  Release 1 for serving under `sjvair.com/workspace/`. Still deferred: embedding in a
  host app with its own router, and the in-memory router mode. (The Django-template
  embedding on sjvair.com is decided and not part of this.)
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

- **sjvair.com API v2 archive links point at v1.** _Noted 2026-10-19 (Alerts fix)._ The
  v2 monthly-archive list builds each file's `url` with `Archive.get_csv_url()`, which
  reverses the **v1** route (`/api/1.0/.../archive/<year>/<month>/`), and the v2 archive
  tests (`camp/api/v2/archive/tests.py`) also exercise the v1 routes, so the v2 endpoints
  are untested. No current client uses archives (the SDK wraps them). **Revisit when**
  anything starts using monthly archives (e.g. a dashboard download feature), or with the
  next sjvair.com API cleanup. Needs an approved sjvair.com plan.
- **sjvair.com test settings depend on the local env.** _Noted 2026-10-19._ Without
  `TWILIO_AUTH_TOKEN`, 23 Twilio signature tests fail; with `BAM_MIRROR_ENABLED=1` in the
  local `.env.test`, 2 BAM tests fail (they expect it off by default). `camp/settings/test.py`
  could pin a dummy token and `BAM_MIRROR_ENABLED = False` so the suite runs the same
  everywhere. **Revisit with** the next sjvair.com test or settings change. Needs an
  approved sjvair.com plan.
- **CI and dependency loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review)._ None
  affects what spec 1 ships: Playwright runs with no retries in CI; sharp's install script
  has no `allowScripts` decision yet; `@inlang/plugin-message-format` has an empty npm
  `license` field although its `LICENSE` file is MIT, so spec 5's license check must accept
  it; the `--duration-*` `@theme` aliases are probably inert. **Revisit when** CI first
  flakes (retries), with spec 5's license check (sharp and the inlang plugin), and in the
  design pass (the duration aliases).
- **`/workspace` without a trailing slash.** _Deferred 2026-10-20 (Foundations spec 1
  review)._ The home route shows as `/workspace` (sv-router drops the slash), while Vite's
  base is `/workspace/`. **Revisit in** the hosting track: sjvair.com must serve both forms.
- **sdk-js: no runtime validation of responses.** _Deferred 2026-10-19 (Alerts fix)._ SDK
  calls return API data without checking it against their Zod schemas, which is how the
  stale `airAlertSchema` went unnoticed when the server dropped `id`/`latest`. Adding
  validation would change behavior for every call. **Revisit when** the dashboard's data
  layer (Foundations) decides where responses are validated. Needs an sdk-js plan and a
  release (explicit approval).
- **sdk-js: subscription levels are incomplete.** _Noted 2026-10-19._
  `monitorSubscriptionSchema.level` only allows `unhealthy_sensitive` and above, but the
  server also accepts `good` and `moderate` (treated as Moderate). **Revisit with** the
  Release 2 alert-rule SDK work. Needs an sdk-js plan and a release.
- **sdk-js: CSRF header can follow a cross-origin redirect.** _Deferred 2026-10-21._ The
  SDK's origin check applies to the initial URL. If a same-origin write got a 307/308
  redirect to another origin, the request would carry `X-CSRFToken` along (browsers strip
  only `Authorization`). Contained today: the custom header forces a CORS preflight, so it
  only reaches a target that explicitly allows it, and the API's writes don't redirect.
  **Revisit when** the API starts redirecting writes or the dashboard is deployed
  cross-origin; the fix then is `redirect: "error"` on requests that carry the CSRF header.
- **`@sjvair/sdk` is pinned to the 4.8.0-beta.0 pre-release.** _Deferred 2026-10-22
  (Foundations spec 2, PR #7 follow-up)._ The data layer needs `getDatasetCatalog`,
  `getRegionsByCode`, and `getMonitorEntries` with `processor` and `Date` bounds, which are
  only in that pre-release; it is pinned exactly because a caret range skips pre-releases.
  **Revisit when** sdk-js 4.8.0 is released (after sjvair.com #293 reaches production and
  the user approves the release): switch to `^4.8.0`.
- **sdk-js: no way to opt out of day-snapping short entry windows.** _Deferred 2026-10-22
  (Foundations spec 2, PR #7 follow-up)._ `getMonitorEntries` widens two bounds within five
  minutes of each other to whole Pacific days. The air-quality adapter's raw windows can be
  that short (the open hour a few minutes in, or a chunk's tail), so it pads such a window's
  upper bound to five minutes and a millisecond (later than now is allowed) and filters
  entries to the real window, rather than fetching a whole day. **Revisit if** sdk-js adds an
  option to send bounds exactly; then drop the padding. Needs an sdk-js plan and a release
  (explicit approval).
- **sjvair.com: `ensure_csrf_cookie` on the map page.** _Deferred 2026-10-21 (monitor-map
  SDK 4.7 design)._ The subscribe button's `X-CSRFToken` relies on the `csrftoken` cookie
  that Django sets at login (1-year cookie vs. a 2-week session), so the page doesn't set it
  itself. **Revisit if** the resticus rollout's end-to-end subscribe check finds the cookie
  missing, or sjvair.com changes its CSRF/session settings. Needs a sjvair.com plan.
  **Checked 2026-10-22:** the signed-in check on local sjvair.com found the cookie present,
  so it stays deferred.
- **resticus: credential lookups on safe methods.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF
  fix review)._ For a session-signed-in request that also sends an `Authorization` header,
  the fix tries the other authenticators before the CSRF check, even on GETs, where the
  check does nothing: an extra token query, or a password hash and `user_login_failed`
  signal for Basic. Rare from browsers. **Revisit if** the resticus developer asks, or such
  requests show up in practice; the fix is to skip the lookup for safe methods.
- **resticus: a non-UTF-8 token header gives 500.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF fix
  review)._ `TokenAuth.lookup_user` raises `UnicodeDecodeError` on a non-UTF-8 key. This was
  already true without a session; with a session it used to be ignored (200). Not a
  security issue (a cross-site page can't set the header). **Revisit with** the next
  resticus change; fix by raising `AuthenticationFailed` there.
- **resticus: CSRF skip trusts any non-session authenticator.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22
  (resticus CSRF fix review)._ A custom authenticator that reads a cookie (e.g. a JWT in a
  cookie) and doesn't subclass `SessionAuth` would let cookie-only requests skip the CSRF
  check. sjvair.com uses only `TokenAuth`. **Revisit if** the resticus developer wants it
  documented, or anyone adds a cookie-based authenticator; a docstring/README note is enough.
- **resticus: PATCH test goes around `ApiClient`.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF fix
  review)._ `ApiClient` has no `patch` wrapper, so `tests/test_csrf.py` calls Django's
  `Client.patch` directly. Cosmetic. **Revisit if** the resticus developer asks.

## Documents & saving

- **Name normalization edge cases.** _Deferred 2026-10-20 (Foundations spec 1 review)._
  `normalizeName` can split a surrogate pair (an emoji, say) at the 100-character cut, and
  trimming again after the cut is untested. Names that long are rare. **Revisit with** spec
  3 (the format freeze), or on the first report of a broken character at the end of a name.
- **Migration chain hardening.** _Deferred 2026-10-20 (Foundations spec 1 review)._ The
  chain's test hard-codes `to: 1`; that migrations must not mutate their input isn't
  documented on `Migration.migrate`; and a bare `catch` hides migration bugs as "invalid".
  There is only one schema version so far. **Revisit with** spec 3 (the format freeze) for
  the first two, and spec 5 (the error reporter) for the `catch`.
- **IndexedDB adapter robustness.** _Deferred 2026-10-20 (Foundations spec 1 review)._ A
  connection closed by `blocking` or `terminated` is never reopened, so the UI shows
  "Couldn't save" until a reload. The commit precondition (`doc.version` equals the last
  entry's, entries contiguous) isn't enforced, and the memory and IndexedDB adapters diverge
  on duplicate entry versions. Contract gaps: a commit on a missing id with a numeric base,
  and `readLog` for an unknown document. The app's callers don't hit these cases
  today. **Revisit before** any IndexedDB version bump (the reopen), or
  with spec 3's durability work (the rest).
- **DocumentSession durability gaps.** _Deferred 2026-10-20 (Foundations spec 1 review)._
  Edits queued during the starter hand-off are dropped if the hook returns `null` or
  rejects, and aren't journaled while it runs. A failed save is retried only on the next
  edit or `pagehide` (there's no retry timer). Errors on the commit chain aren't reported.
  Each needs a storage failure at an unlucky moment. **Revisit with** spec 3 (durability)
  for the first two, and spec 5 (Sentry) for reporting.
- **Cross-tab sync edge cases.** _Deferred 2026-10-20 (Foundations spec 1 review)._ A
  catch-up from a trimmed log during a conflict leaves stale conflict pairs. "Keep mine"
  after a journal-replay conflict can drop edits to widgets the other side deleted (it needs
  a `#conflictBase`). The "error" status during a conflict looks like "Couldn't save".
  Untested: save-as-copy with a replay, a catch-up during an in-flight commit, and
  `pageshow`. All need several tabs editing the same widgets at once. **Revisit with** spec
  3's durability work, or on the first report of lost edits after a conflict; the status
  wording in the design pass.
- **Journal limits and cleanup.** _Deferred 2026-10-20 (Foundations spec 1 review)._ Journal
  records have no explicit size limit; records for dashboards that are never reopened stay
  in `localStorage`; and the dashboards list shows a stale name when a rename exists only in
  a journal record (until the dashboard is opened). Records are small and rare (only edits
  pending at `pagehide`). **Revisit with** spec 3 (size limits), or if `localStorage` use
  ever grows noticeably.

## Map & selection

- **Saving land-use regions by code.** _Deferred 2026-10-22 (sjvair.com metadata plan,
  decided by the user)._ Land-use codes include the state dataset's `OBJECTID`, which a
  refresh can renumber, so they are excluded from code lookup and the permanence promise;
  the dashboard can't save a land-use region as a reference. **Revisit when** someone needs
  land-use areas in a saved widget or rule; the server first needs a stable code built from
  fields that survive a refresh.
- **Greying out places with no data in the place picker.** _Deferred 2026-10-22
  (sjvair.com metadata plan, coverage endpoint)._ Coverage has no bulk mode in Release 1
  (only per dataset and per single place), so the picker can't know which places lack
  data. A place without data shows a "no data for this range" state once chosen.
  **Revisit when** users struggle to find places with data; it would need a bulk coverage
  mode, probably backed by a precomputed table on the server.
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
  through the forecasts data or a metadata zone list, not `type=custom`. **Production checked
  2026-10-14** (public API): 201 school districts and the schools are loaded, but there
  are **0 `custom` regions**, so the 3 forecast zones are missing and production has no
  forecasts for them (tracked as a separate fix in `TODO.md`). Nothing planned uses
  `protected`. **Revisit when** the step 3 metadata plan and the Release 2 alerts plan
  start, to confirm the zones were imported.
- **"All counties" aggregate view.** _Deferred 2026-09-15._ The server doesn't support it,
  and we chose not to approximate it on the client. **Revisit when** the server gains a
  valley-wide region, or a custom region is defined for it.
- **monitor-map: chart stuck loading after a failed background refresh.** _Noted
  2026-10-21 (monitor-map 4.3.0 review)._ If a timed (silent) chart refresh supersedes a
  range change that is still loading and then fails, `DataChart` keeps showing the loading
  state. This is the same as in 4.2.0, not a regression. **Revisit with** the next DataChart
  change or the map-sdk rebuild (5.0). The fix is to have the silent refresh take over the
  `loading` flag. Needs a monitor-map plan.
- **monitor-map: subscription status load errors are unhandled.** _Noted 2026-10-21
  (monitor-map 4.3.0 review)._ A failed subscription-status load (not a cancel) still
  surfaces as an unhandled rejection, as in 4.2.0, with no error state on the button.
  **Revisit with** the next change to `MonitorSubscriptionManager` or the map-sdk rebuild.
  Needs a monitor-map plan.
- **monitor-map: cancelling one-off loads.** _Deferred 2026-10-21 (monitor-map SDK 4.7
  design)._ HMS smoke/fire and collocation sites accept a caller's signal but don't
  supersede themselves, since nothing re-requests them on user selection. **Revisit when**
  any of them becomes selection-driven (e.g. a date-picked HMS layer).

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
  or SDK wrapper is planned. sjvair.com PR #282
  (Facility Emissions Explorer, merged 2026-10-13) moved the API to
  `/api/2.0/emissions/…` and added CEPAM, dairies, wells, and toxics, so anything we build
  uses `emissions`. **Revisit when** an emissions or facility-proximity use case comes up.
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
- **CarbonMapper data source.** _Noted 2026-09-24; updated 2026-10-14._ The server now
  imports Carbon Mapper methane sources and plumes and serves them under
  `emissions/methane/` (merged with #282), so the dashboard would read them from the
  server and needs no `VITE_CARBONMAPPER_KEY` (remove it from `.env.example` when
  convenient). Carbon Mapper's terms are **non-commercial and share-alike**, which its
  catalog entry's `license` and any export must carry. Nothing is designed in the
  dashboard. **Revisit when** a methane layer or analysis is scoped. Same for the unused
  `VITE_OPENWEATHERMAP_KEY` — remove it if no use appears.
- **Calibration choice on layers.** _Deferred 2026-10-22 (Foundations spec 2)._ The data
  layer always uses each monitor type's published series (e.g. EPA-calibrated PM2.5 for
  PurpleAir) and reports which one it used; `QueryDescriptor` has no processor field. An
  optional field can be added later without a document migration. **Revisit when**
  researchers ask for uncalibrated or alternative-calibration data.
- **Refetch keeps the resolution chosen at creation.** _Deferred 2026-10-22 (Foundations spec
  2)._ A query entry picks its resolution from the range span once, when it is created; a
  to-date range (e.g. "this month") can grow across a ladder boundary over time without the
  entry switching. **Revisit when** widgets show to-date ranges (Release 1 step 4).
- **The query client has no `dispose()`, and its poller is never stopped.** _Deferred
  2026-10-22 (Foundations spec 2)._ `getQueryClient()` returns one app-wide client, so nothing
  needed teardown. **Revisit when** HMR or tests recreate clients, or anything creates more
  than one.
- **`LiveQuery` has no idle state for a null input.** _Deferred 2026-10-22 (Foundations spec
  2)._ A widget with nothing to show yet (no place picked) has to avoid constructing the query
  rather than pass `null`. **Revisit when** building widgets (Release 1 step 4).
- **`DocumentSession` reads page visibility directly.** _Noted 2026-10-22 (Foundations spec
  2)._ `src/lib/store/document-session.svelte.ts` (spec 1) still listens to
  `visibilitychange` and reads `visibilityState`, against the platform-adapter rule; spec 2
  added `platform.activity`. **Revisit when** `DocumentSession` is next changed, or in the
  spec 3/5 platform work: move it onto that capability.
- **`adapter.target` takes no `AbortSignal`.** _Deferred 2026-10-22 (Foundations spec 2 final
  review)._ Resolving a layer's target can't be cancelled when its subscriber moves on; today
  it makes no network calls (the web region resolver answers at once), so nothing is wasted.
  **Revisit when** step 3's region resolver makes network calls: pass the subscription's
  signal through.
- **Updating a subscription to an input with the same key detaches first.** _Deferred
  2026-10-22 (Foundations spec 2 final review)._ `Subscription.update()` with a different
  input that resolves to the same cache key (e.g. a selection's ids reordered) shows
  `loading` for a moment and, if it was the entry's only subscriber with a fetch in flight,
  aborts and restarts that fetch. **Revisit when** widgets edit selections in place (Release
  1 step 4) and the flash or the extra fetch shows.
- **A new subscriber refetches an errored entry at once.** _Deferred 2026-10-22 (Foundations
  spec 2 final review)._ Attaching to a cache entry whose last fetch failed refetches
  immediately, skipping the poller's backoff, so widgets opening one after another against a
  failing server each send a request. **Revisit if** that shows up as load during an outage;
  the fix is to respect the entry's backoff when attaching.
- **The idle cache cap counts entries, not bytes.** _Deferred 2026-10-22 (Foundations spec 2
  final review)._ Up to 200 idle entries stay cached whatever their size, so large raw
  selections could hold a lot of memory. **Revisit with** step 4's large selections: cap by
  approximate size (points held) instead.
- **Midnight race on rolling keys.** _Deferred 2026-10-22 (Foundations spec 2 final review)._
  A subscriber that attaches across midnight to a rolling entry ("last 7 days") whose fetch
  started before midnight gets the older dates until the next poll. **Revisit if** a widget
  shows yesterday's window after midnight for longer than a poll; the fix is to compare the
  in-flight request's dates when attaching.
- **A monitor missing from the monitors list gets the uncalibrated series silently.**
  _Deferred 2026-10-22 (Foundations spec 2 final review)._ Without its type the adapter
  can't name the published processor, so the request names none and the server returns the
  type's default stage. **Revisit when** step 3's metadata work lands: report the query as
  `unavailable`, or refresh the monitors list and try again.
- **The rollup-lag backfill is one level deep and fetched on every poll.** _Deferred
  2026-10-22 (Foundations spec 2 final review)._ The last completed period is backed up from
  the next finer level only, so a day backfilled from hourly summaries just after midnight
  lacks its final hour until that hour's rollup runs (about 00:45), yet reads as complete;
  and the backfill is fetched with every poll even once the coarse rollup exists. **Revisit
  when** widgets show daily data live (Release 1 step 4): backfill the backfill's own last
  period from the next level down, and skip the backfill once the coarse value has arrived.

## Map plugins

- **Map plugins for the remaining server datasets.** _Deferred 2026-09-24 (docs review)._
  First release covers monitors, region fill, HMS smoke/fire, collocation, EV, wind,
  weather. Deferred: pesticide use and SprayDays notices, CalEnviroScreen tracts,
  CalHeatScore ZIPs, forecast zones, CEIDARS facilities, TEMPO rasters. The `map-sdk` plugin
  interface must support points, polygons, choropleths, and rasters so these are
  additive. **Revisit when** a widget or analysis needs one on a map (pesticide notices
  likely first, alongside the alerts work).

## Widgets

- **Weak tests in the widget registry and `applyChange`.** _Deferred 2026-10-20 (Foundations
  spec 1 review)._ Widget-type registration and lookup are untested, and the tests for
  `applyChange`'s index clamping and for never mutating its input are weak. Both are
  exercised indirectly by other tests. **Revisit when** a second widget type registers
  (Release 1 step 4), or `applyChange` gains an operation.
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
- **Mobile: move `@sjvair/sdk` to `^4.7.0` when taking monitor-map 4.3.0.** _Noted
  2026-10-21 (monitor-map SDK 4.7 design)._ Mobile depends on the SDK directly (`^4.6.0`)
  and calls `setOrigin` on its copy. monitor-map 4.3.0 needs `^4.7.0`. Without the bump,
  npm can nest a second SDK under monitor-map whose requests ignore mobile's origin.
  **Revisit when** mobile next updates its monitor-map dependency. Needs a mobile plan and
  an app release (explicit approval).
- **Mobile app's hardcoded PM2.5 scale.** _Noted 2026-09-28; widened 2026-10-13._ Three
  files hardcode the pre-2024 scale: `src/components/PMGauge.svelte`
  (12.1/35.5/55.5/150.5/250.5), `src/lib/colors.ts` (`pmValueColors`,
  `ozoneValueColors`), and `src/components/AirQualityGuidelines.svelte`. Only its Alerts
  and Subscriptions screens read levels from metadata. The sjvair.com breakpoint fix
  doesn't reach these. **Revisit when** the server fix (sjvair.com #288, in `develop`
  since 2026-10-20) is on its way to production (ideally they read metadata levels), or
  with the mobile migration, whichever comes first. Needs a mobile plan and an app release
  (explicit approval).

- **Mobile dev proxy still points at API v1.** _Noted 2026-10-19 (Alerts fix)._
  `vite.config.ts` proxies only `/api/1.0` to `localhost:8000`, but the app calls
  `/api/2.0` through the SDK at the full origin from `VITE_DEV_URL`, so the proxy is never
  used. Harmless leftover. **Revisit with** the next mobile build-tooling change, or the
  mobile migration. Needs a mobile plan.
- **Monitors without a county show a bare "County".** _Noted 2026-10-20 (Alerts QA)._ The
  Alerts and Subscriptions screens render `{monitor.county} County`, so a monitor with no
  county reads "County". Pre-existing, not caused by the Alerts fix. **Revisit with** the
  next change to those screens. Needs a mobile plan and an app release.

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
- **Context menu loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review)._ The menu
  items, context, and dropdown state could be `$state.raw`; the module-singleton dropdown
  state needs a comment; submenus, disabled items, and separators have no tests; menus have
  no reduced-motion test; and whether the Windows Menu key opens the menu twice is
  unverified. Spec 1 menus are flat and short. **Revisit when** a menu first needs a
  submenu, or in the first Windows testing pass.
- **Shell keyboard handling.** _Deferred 2026-10-20 (Foundations spec 1 review)._ The
  text-entry check treats every `input` as text entry; IME composition (`isComposing`) isn't
  skipped; shortcut labels say Ctrl on macOS; `contenteditable` is untested; and the
  undo/redo buttons and shortcuts call `session.undo()` directly instead of the registered
  global actions (the spec has nav controls be views onto actions). **Revisit in** Release 1
  step 4 (its first checkbox or range input), with the command palette (the actions), and
  before translations ship (IME).
- **Startup failures all read as "storage unavailable".** _Deferred 2026-10-20 (Foundations
  spec 1 review)._ An init failure that isn't a storage failure shows the same message.
  **Revisit with** spec 5 (error reporting).
- **Save-status and undo-toast timing.** _Deferred 2026-10-20 (Foundations spec 1 review)._
  The saved indicator's `aria-live` region announces "Saving…"/"Saved" on every edit, which
  is noisy for screen readers. Undo toasts use sonner's 4-second default, after which a
  dashboard deleted from the picker can't be recovered until "Recently deleted" ships (WCAG
  2.2.1, Timing Adjustable). **Revisit in** the design pass (the announcements), and with
  spec 3's "Recently deleted" (or lengthen the toasts sooner).
- **Names of copies.** _Deferred 2026-10-20 (Foundations spec 1 review)._ "Save mine as a
  copy" keeps the same name with no rename prompt, and duplicating an unnamed "My dashboard"
  lists the copy as "Untitled dashboard". **Revisit in** the design pass, or when people
  report confusing copies.
- **Dashboard page and list loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review)._
  The delete action's `deletedAt` comes from `new Date()`, not an injected clock; the
  previous `document.title` lingers while a session loads; the conflict dialog watches only
  the current session; list-row sessions are never disposed. Untested: leaving when another
  tab deletes the dashboard, save-as-copy navigation, the `conflict_failed` toast, and
  row-duplicate navigation. **Revisit with** the next change to the dashboard page or list,
  or if many open list-row sessions start to cost memory.
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

## Open decisions

Undecided items that don't block current work but must be answered before the listed
point.

- **Dataset license and attribution text.** _Decided 2026-10-22 to leave empty for now (user,
  sjvair.com metadata plan, #293)._ In `meta/datasets/`, every dataset has `license: ""`
  except NOAA HMS smoke/fire and NASA TEMPO ("Public domain"). The real license and
  attribution text for air-quality, weather, pesticide-use, pesticide-notices, forecasts,
  calheatscore, calenviroscreen, and emissions must come from the user and must not be
  guessed. Meanwhile the dashboard handles an empty `license` gracefully (shows the `source`
  alone, never a placeholder). **Decide before** dashboard go-live (and before exports or
  shared pages show attribution).
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
- **Does email get its own rollout switch for alerts?** (2026-10-14) Text alerts open to
  everyone before Release 2; email is a new channel. The per-account channel list carries
  either answer. **Decide in** the Release 2 server alerting plan.
- **Legal confirmation of the account and privacy approach.** **The user arranges this**
  with whoever advises SJVAir (operated by the Central California Asthma Collaborative),
  before the email-only accounts plan is finalized. The questions (listed 2026-10-14; not
  legal advice):
  1. **Does COPPA apply at all?** It targets commercial operators, and the FTC has said
     nonprofits outside its jurisdiction are generally not covered. If CCAC is a
     nonprofit, is it exempt? (The 13+ policy stays as a safeguard either way.)
  2. **If COPPA applies, is the approach enough?** Accounts for ages 13 and up with a
     neutral age question; under-13s use the dashboard without an account, with their
     work kept in their own browser; teachers share by link. Since schools are a named
     audience, confirm the site isn't treated as directed to children in a way that
     requires parental consent anyway.
  3. **California student privacy law (SOPIPA).** It covers services designed and
     marketed for K-12 school purposes. Does it apply, given we promote the dashboard to
     schools, and what does it require? The design already has no ad tracking, no selling
     of data, no profiling, and complete deletion.
  4. **What the privacy policy must say** (California requires one): what stays in the
     browser and what syncs, scrubbed error reports, the text and email providers, the
     30-day trash and snapshots, and how account deletion works.
  5. **Location and anonymous use.** "Use my location" sends a rounded position to the
     server to find the area, and anonymous error reports are sent. Confirm neither
     counts as collecting personal information from anonymous, possibly under-13, users.
  6. **Code ownership.** Confirm CCAC owns the code it licenses: automatic for employees'
     work, but contractors' and volunteers' contributions depend on their agreements.
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
- **monitor-map: `setRequestDefaults`.** _Ruled out 2026-10-21 (monitor-map SDK 4.7
  design)._ monitor-map passes request options per call and never sets the SDK's page-global
  defaults, because it runs inside host apps that own those settings. **Reopen if** a host
  needs monitor-map to set a header the host can't set itself.

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

Dropped 2026-10-20 by the user ("we won't deal with production"):

- **Run `import_forecast_zones` on production** (noted 2026-10-20). The three `custom`
  forecast zones were imported and verified locally (`TODO.md` → the forecast-zones
  warning); production work is out of scope.
