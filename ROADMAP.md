# Roadmap

Sequencing for the dashboard direction. Decided 2026-09-24 at the end of the IDEA.md
planning session. Design lives in `ARCHITECTURE.md`, current status in `TODO.md`, and
everything deferred in `DEFERRED.md`.

**Every numbered item below is its own sub-project** with its own spec, then plan, then
implementation. Sub-projects in a sibling repo (sjvair.com, sdk-js, django-resticus, map-sdk, monitor-map,
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
   - data layer (in-memory cache plus HTTP caching; documents local-first): automatic
     resolution, incomplete-period
     stitching, shared polling, last-requested-wins, pause when the tab is hidden,
     catalog-driven handling of unsummarized data (worker downsampling, span caps), the
     dataset adapter registry, and `DateRangeSpec` → Pacific date resolution
   - Paraglide (English-only) and the `format` module
   - `SavedDocument`, `QueryDescriptor`/`DateRangeSpec`, `applyChange`, and undo/redo;
     changes as serializable JSON with explicit targets, a persisted unsynced-change queue
     with its base version, and cross-tab sync via `BroadcastChannel`
   - **minimal Collections** (decided 2026-09-24): the store, the Collections drawer,
     "Add to collection ▸", staging that freezes rolling ranges to fixed Pacific dates
     (with a per-item "keep rolling" toggle), and a placeholder Analysis view that lists a Collection's
     items with "starter analyses coming soon"
   - autosave (no explicit Save) with a "Saved" indicator; picker actions (new,
     duplicate, rename, delete with an undo toast)
   - local durability safeguards (`storage.persist()`, status note, backup nudge, quota
     errors) and "Clear my data"
   - version-skew handling (newer documents read-only, version-tagged change queue,
     `version.json` deploy detection with a reload prompt)
   - Export/Import `.json` and URL-fragment sharing (`/import`), with schema validation and size limits
     on every incoming document
   - **a fresh start** (decided 2026-09-24): the v1 app shell, sidebar, tab routes, and
     tab pages are removed; the new top-nav shell and route table replace them from this
     step on. The v1 app was never deployed, so there are no users or URLs to migrate.
     Existing code is reused only if it's exactly what the new design needs. **Before
     removing it**, write `docs/reference/v1-lessons.md` capturing the server behaviors
     and edge cases the v1 code and its tests learned (behaviors, not code).
   - the action/context-menu registry
   - the top-nav app shell, with `basePath` support in `src/router.ts` for serving under
     `sjvair.com/explore/`
   - MIT license, a CI license check (permissive only), third-party notices
   - scrubbed front-end error reporting to Sentry, an in-app privacy note, and a preview
     feedback link (no Google Analytics on `/explore/`)
   - CI: lint, type-check, tests, and build on every PR. PRs into `main` run the full
     suite (three engines plus axe); feature-branch PRs run the fast set
   - Vite dev proxy to the local sjvair.com stack (same-origin cookies in dev), plus a
     one-time `csrftoken` cookie bootstrap
   - test infrastructure: Vitest browser mode, Playwright (3 engines) with fixture
     routing, axe, and a dev-stack smoke suite
   - installable via a web app manifest (no service worker in Release 1), plus an
     offline banner
2. **Dashboard layout engine and windowing**: snapping grid, drag/resize,
   minimize-to-taskbar, fullscreen, and responsive stacking. Proven with placeholder
   widgets. Includes the **WCAG 2.2 AA** pieces: keyboard move/resize, live-region
   announcements, focus management, `prefers-reduced-motion`.
3. **Metadata enablers** (sjvair.com + sdk-js; runs in parallel with 1–2)
   - the available-pollutants list
   - the `meta/datasets/` catalog
   - the coverage endpoint
   - scale metas
   - a shared action `tier` on every scale level, using **CalHeatScore's 0–4 scale** (heat
     maps one to one, with its official guidance); **the user supplies the AQ-level
     mapping before this plan**
   - SDK wrappers for forecasts, CalHeatScore, and CalEnviroScreen
   - region hierarchy, choice lists, and display hints (metadata gaps 5–7)
   - verify production `school_district` and `custom` (forecast zone) region rows; import
     if missing
   - extend `regions/places/lookup/` with rounded coordinates (POST body; coordinates scrubbed
     from logs, Sentry, Scout) and `?monitor=` (containing
     regions), plus the SDK wrapper update
   - HTTP cache headers on the summary endpoints
   - hardcoded-value cleanup in sjvair.com, and fixing sdk-js `api-urls.md`
4. **Widget Creation and the non-map widgets**
   - Widget Creation view (catalog-driven dataset accordions, layers, advanced resolution
     override)
   - the **starter dashboard** (first-visit default; place defaults to Fresno County, with a
     "Change place" bar; the first edit makes a personal copy) with non-map widgets. Until it
     exists, `/` and "new from starter" open a blank dashboard
   - the `WidgetType` registry and `WidgetDataConfig`, including optional resolution pins
     (calendars `day`, heatmap `hour`; pin → override → ladder)
   - the "Duplicate widget" action
   - point places resolved to the smallest containing region with data (labeled; frozen
     on staging)
   - the **shared place picker** (monitors, regions, or points; "place" here means a
     `PlaceRef`), reused by the Map widget
     (step 5) and alert rules (Release 2)
   - Chart
   - Calendar (day-colored)
   - Calendar (contribution)
   - Current conditions
   - Data table
   - Notes (safe Markdown: raw HTML off, link allowlist)
   - Hour × weekday heatmap
   - Forecast strip
   - "Can we go outside?"
   - client-side self-monitoring thresholds (in-browser notifications are desktop-only in
     Release 1)
   - "Mark for analysis" / "Analyze" on every `analyzable` widget, plus the calendar's "selected
     data" variants, feeding Release 1's Collections
5. **`map-sdk` and the Map widget** (decided 2026-09-24: split out of monitor-map)
   - `@sjvair/map-sdk` (new repo): instance-scoped core, plugins, `MapView`, optional
     metadata/messages/format providers with defaults,
     app-level data stores
   - the dashboard's Map widget on `map-sdk`: map feature clicking (method A), synced both
     ways with step 4's shared place picker (method B)
   - **Critical path (decided 2026-09-28): only `map-sdk` → the dashboard's Map widget.**
     There is no interim single-map build on monitor-map 3.x.
   - **Parallel, not blocking:** monitor-map rebuilt on `map-sdk` on a branch. **The Map
     widget and the monitor-map rebuild both build against pre-1.0 `map-sdk`, and 1.0 is
     cut once both have validated the API.** Its `main` (which sjvair.com builds) changes only once verified,
     with approval.
   - **Separate later track, not blocking Release 1 or go-live:** the v3-mobile migration
     (see `DEFERRED.md`).

- **Parallel track: hosting on sjvair.com** (approved sjvair.com plan first). An import
  of this repo's `main` into `dist/` during each Heroku deploy (the monitor-map pattern, no
  pinning), a Django catch-all route for `/explore/*`, and Heroku config vars for
  `VITE_*` keys. Merging to dashboard `main` is the deploy approval point. A CSP on `/explore/*` (report-only
  first, then enforced). Also:
  `ensure_csrf_cookie` and no forced trailing slashes on `/explore/*`, and a check that no
  CMS page uses `explore`. This repo: Vite `base: "/explore/"` and
  `setOrigin(location.origin)`. Also: confirm the repo is public (done 2026-09-28) and
  restrict the MapTiler and NREL keys by domain (with separate keys or allowed domains for
  localhost dev and a staging preview).
- **Parallel track: email-only accounts** (sjvair.com + sdk-js, decided 2026-09-28).
  Phone becomes optional; an account needs a verified phone or email; a new email
  verification flow; login and registration by either; the server "remember me"
  checkbox. Phone flows keep working for
  v3-mobile. It lands before sign-in-dependent features ship.
- **Parallel track: server-backed documents** (sjvair.com + sdk-js + django-resticus,
  decided 2026-09-24). **First, the CSRF fix** in django-resticus (with the SDK header and
  sjvair.com page updates), before any cookie-based saves. Merging to resticus `develop`
  needs explicit approval (it's effectively a production deploy while unpinned). The
  `SavedDocument` model and endpoints, live share links (read-only
  plus "Make a copy"), versioned local-first sync (automatic replay of non-overlapping
  edits; a prompt only on true overlaps), local →
  account migration, the sign-in flow (Release 2 replaces the redirect with an in-app
  dialog), sync scope and sign-out keep/remove, and the model details (server keeps the
  client UUID, revocable `share_token`, body size limit, `copied_from`, soft delete with a
  30-day restore, owner-only delete, and an optional public display name). Anonymous users
  stay local, with durability safeguards. Sign-in in Release 1 **redirects** to
  sjvair.com's login/registration pages (the server "remember me" change is owned by the
  email-only accounts track); sdk-js
  makes `apiToken` optional on account calls.

- **Private preview from about step 4** (decided 2026-09-24). An unlisted preview (e.g.
  a staging Heroku app or a hidden route) for a pilot teacher and a researcher, so the
  windowed-dashboard experience gets real feedback well before go-live. The mechanism is
  decided in the hosting-track plan.

6. **Map widget in the starter, and go-live.** The default dashboard a first-time visitor sees
   (not a blank page) uses non-map widgets, including calendars, from step 4. The Map
   widget joins once step 5 lands. **The `sjvair.com/explore/` route goes live when Release 1 is
   complete.** Until then the route stays disabled or hidden (except for the private
   preview), so work in progress on `main` isn't public. Merges still need explicit
   approval.

## Release 2: Alerts

- **Server work starts in parallel with Release 1**, once an sjvair.com plan is
  approved:
  - generalize `Subscription` into alert rules for monitor/region pollutants (gated by
    available pollutants), forecasts, and nearby pesticide notices
  - level-category thresholds, caps, and quiet hours
  - migrate existing SMS subscriptions to rules with today's behavior exactly (new
    features default off); keep the legacy endpoints as a logged compatibility layer so
    v3-mobile works unchanged
  - SMS for every alert type, a new email channel (verified email, one-click
    unsubscribe; **depends on the email-only accounts track's verification flow**; SMS,
    inbox and rules can ship first), and the alert inbox API
  - alert metadata
- sdk-js wrappers for the new alert endpoints.
- **In-app session sign-in**: a `POST account/session/` endpoint plus an in-app sign-in
  dialog, replacing Release 1's redirect so mid-flow sign-in keeps context.
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

The Release 3 step 1 spec (Analysis engine) must also decide what IDEA.md and the planning session left open:

- the Analysis view's layout (Collections drawer, list of analyses, results)
- the user-defined analysis editor UI
- the geographic crosswalk method: monitor→region, tract (CES), ZIP (CalHeatScore),
  county/MTRS (PUR), and area weighting

## Later

Everything in `DEFERRED.md`, each entry with its own revisit trigger. The notable ones:

- web push
- SJVAir-curated public templates (on top of Release 1's server-backed documents)
- drawn-shape map selection
- more alert sources
- translations
- the Tauri desktop build (after a WebKitGTK spike)
