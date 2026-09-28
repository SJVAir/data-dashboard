# TODO / Current Status

Last updated: 2026-09-28

## Start here

**Final-review decisions: complete (2026-09-24 → 2026-09-28).** A three-way final review
found 12 gaps; all are decided and recorded. #1–#3, #8 and #9 cover the map-sdk split, the
dropdown picker, and the dataset definition. The rest:

- [x] **#4 Resolution for data without summaries**: catalog-driven; daily-native data
      as-is; weather/PM10 raw with a span cap, downsampled in a worker; server summaries
      for them deferred. See `ARCHITECTURE.md` → "Data resolution & live refresh".
- [x] **#5 Document identity and sharing**: server keeps client UUIDs; `/explore/shared/:token`
      (revocable, anonymous read-only + copy); `public` reserved; body stored without
      interpretation; automatic replay of non-overlapping edits plus a 3-choice prompt;
      no CRDT. Also decided: readable routes and the `/explore/` base path.
- [x] **#6 Sync scope and sign-out**: every document syncs when signed in; sign-out
      offers keep/remove (remove by default); preferences stay local; "Clear my data" is
      browser-only.
- [x] **#7 Rolling ranges**: dashboards stay rolling; staging freezes to fixed Pacific
      dates, with a per-item "keep rolling" toggle; exports always record fixed dates.
- [x] **#10 CSRF**: fix in django-resticus (`~/workspace/django-resticus`): enforce the
      CSRF check for session-authenticated writes. The SDK sends `X-CSRFToken`, and
      sjvair.com pages that call the API with the cookie send it too. Not pinned (the user
      is talking with the developer), so those changes land before or with the resticus
      merge. See `ARCHITECTURE.md` → "CSRF protection".
- [x] **#11 Email alerts and accounts**: email alerts need a verified email plus
      one-click unsubscribe. **Email-only accounts in Release 1**: phone optional, a new
      email verification flow, login by either; phone flows keep working for v3-mobile.
- [x] **#12 Existing SMS subscriptions**: migrate to monitor rules that reproduce today's
      behavior exactly (caps and quiet hours off), with opt-in to new behavior. New rules'
      "back to normal" means below the user's threshold (today's all-clear rarely reaches
      anyone). Legacy endpoints stay as a logged compatibility layer; their removal and the
      v3-mobile update are deferred.

**Planning is complete (2026-09-23 → 2026-09-24, branch `planning`).** All IDEA.md Open
Questions and the follow-up gaps are resolved and recorded in `ARCHITECTURE.md`;
sequencing is in `ROADMAP.md`; every deferral is in `DEFERRED.md`.
A full traceability review against IDEA.md (2026-09-24) fixed the remaining gaps
and decided nine follow-ups (more were settled later that day: the fresh start and the
v1-lessons step, the deploy model, the sign-in staging, `analyzable` and the 3-day window,
the private preview and go-live, and the full test gate on PRs into `main`): minimal Collections in Release 1, autosave with durability
safeguards, server documents in Release 1, dataset accordions as layers, Pacific time,
hosting under `sjvair.com/explore/`, an installable app (revised 2026-09-28: manifest only, no service worker), WCAG 2.2 AA, and the
testing strategy.

Next steps (each its own spec → plan → implementation, per the brainstorming process):

1. **PM2.5 breakpoint fix** in sjvair.com (urgent, independent — see below).
2. **Release 1, step 1: Foundations** spec (this repo).
3. Before the step 3 metadata plan: **the user decides the action-tier assignments and
   heat guidance wording** (`DEFERRED.md` → "Open decisions").
4. In parallel once approved (sjvair.com / sdk-js / django-resticus plans): Release 1's
   **metadata enablers**, **hosting under `/explore/`**, **email-only accounts**, and
   **server-backed documents** (CSRF fix first) tracks, plus **server alerting**
   (Release 2).

## Planning session record: IDEA.md (2026-09-23 → 2026-09-24)

`IDEA.md` describes a larger direction (Dashboard / Widget Creation / Analysis views,
windowed widgets, alerts, Tauri). We worked through its **Open Questions** in order,
updating the docs after each one.

- [x] **Q1 Tauri now or later?** → Web-first, Tauri-ready. See `ARCHITECTURE.md`
      → "Platform strategy" and "Authentication".
- [x] **Q2 Map widget partial dataset selection** → Stage query descriptors, not data;
      one `SpatialSelection` model fed by feature picking (A), region picking (B), and
      later drawn shapes (C, opt-in map plugin; now `map-sdk`). No map time scrubbing. See
      `ARCHITECTURE.md` → "Widget data selection".
- [x] **Q3 Map SDK modularity / plugin system** → `@sjvair/monitor-map` 4.0 clean
      break: per-map `MapContext` instead of singletons, factory plugins with data-source
      interfaces, `MapShell` + lightweight `MapView`, injected config; migrate
      sjvair.com and `v3-mobile` in the same effort (restructured 2026-09-24 as
      `@sjvair/map-sdk` 1.0 plus monitor-map rebuilt on it; consumers migrate one at a
      time). See `ARCHITECTURE.md` → "Map SDK".
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
        crossing/escalation/optional all-clear (since refined: below the user's threshold, on by default); daily caps + quiet hours.
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
**Every consumer found so far** (docs review 2026-09-28):

- sjvair.com: `entries/levels.py`, the inline breakpoints in
  `entries/models/particulates.py`, `generate_group_map.py`, `entries/tests/test_levels.py`,
  and the guideline templates
- monitor-map: the `150.5` fallback in `monitors-cluster-renderer.ts` (cleanup folds into the
  map-sdk rebuild)
- **v3-mobile**: `src/components/PMGauge.svelte` hardcodes the full pre-2024 scale
  (12.1/35.5/55.5/150.5/250.5). Tracked in `DEFERRED.md`; it needs its own plan and an app
  release.

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
  opt-in geolocation,
  auth mode, and token storage. Preferences (last-opened dashboard, active Collection)
  go through it; the v1 `preferences.ts` is removed, not migrated.
- Data layer (in-memory cache shared across widgets; HTTP cache for reloads; documents in
  IndexedDB):
  - catalog-driven resolution for unsummarized data (worker downsampling, span caps)
  - automatic resolution selection
  - incomplete-period stitching
  - one poll per descriptor
  - pause when the tab is hidden
  - last-requested-wins
- Dataset adapter registry keyed by catalog id; hide catalog entries with no adapter
  (`ARCHITECTURE.md` → "Metadata as source of truth" → "What a dataset is").
- `QueryDescriptor` type: one definition, in `ARCHITECTURE.md` → "Widget data selection".
- Paraglide JS (English-only) and the shared `format` module, before any new UI. The
  `format` module owns the time-zone rules: Pacific everywhere via `@date-fns/tz`,
  Sunday week start, DST-safe (`ARCHITECTURE.md` → "Time zone & calendar conventions").
- `SavedDocument` types, a migration chain, `applyChange`, and undo/redo. The `Change`
  format is serializable JSON with explicit `target`s, plus a persisted queue of unsynced
  changes with their base version, and cross-tab sync via `BroadcastChannel`
  (`ARCHITECTURE.md` → "Routing, URL state & undo").
- Date-range resolution (`DateRangeSpec` → Pacific dates) lives with the `format` module;
  see `DEFERRED.md` → "Shared date-range helper home".
- Local save plus Export/Import `.json` and URL-fragment share, with the `/import` route.
- Minimal Collections: the store, the drawer, "Add to collection ▸", staging that freezes
  rolling ranges to fixed Pacific dates (with a per-item "keep rolling" toggle), and a
  placeholder
  Analysis view ("starter analyses coming soon").
- Action/menu registry: pure resolution and merge logic, tested, plus a bits-ui
  `ContextMenu` host. Install shadcn-svelte `context-menu`.
- App shell: top nav, dashboard picker (a dropdown), and the new route table (`ARCHITECTURE.md` →
  "Routing"), plus `basePath` support for `sjvair.com/explore/`.
- CI workflow: lint, type-check, tests, and build on every PR.
- Test infrastructure (`ARCHITECTURE.md` → "Testing strategy"): Vitest browser mode +
  `vitest-browser-svelte`, Playwright (Chromium/WebKit/Firefox) with fixture routing,
  `@axe-core/playwright`, and a dev-stack smoke suite. PRs into `main` run the full suite
  (three engines plus axe); feature-branch PRs run unit + component + Chromium E2E.
- Installable app: a web app manifest and icons (no service worker in Release 1), plus an
  offline banner from the online/offline events.
- "Clear my data".
- Vite dev proxy: `/api` and `/account/` to the local podman sjvair.com, plus a one-time `csrftoken`
  cookie bootstrap (Vite serves the app, so Django's `ensure_csrf_cookie` doesn't run in dev).
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
- In order: the `meta/datasets/` catalog (schema per `ARCHITECTURE.md` → "Metadata as source of truth" →
  "What a dataset is"), the coverage endpoint, per-domain scale metas
  (hms, calheatscore with per-score guidance, forecasts, AQI), plus a shared `tier` (0–4)
  on every level of every scale (the user supplies assignments and wording), region
  hierarchy, choice lists, and
  display hints.
- HTTP cache headers (Cache-Control/ETag) on the summary endpoints: **required**, since the
  browser's HTTP cache is the dashboard's persistent data cache (long on completed
  periods, short on the current one).
- Extend `regions/places/lookup/` to accept `?lat=&lon=` or `?monitor=` (plus `type=`),
  returning a list of containing regions (filtered by `type`) with the `within=` geometry
  rules; the name mode is unchanged; update
  `lookupRegionPlace` in sdk-js.
- sdk-js wrappers for `forecasts/`, `calheatscore/`, and `calenviroscreen/`. Fix sdk-js
  `api-urls.md`.
- Clean up hardcoded values in sjvair.com once the metadata exists. The map cleanup folds
  into `map-sdk` and the monitor-map rebuild; this repo's v1 values go away with the v1 code.

**Release 1, step 4: Widget Creation and non-map widgets**

- The **starter dashboard** (first-visit default): a built-in document defaulting to
  **Fresno County**, a "Showing … · Change place" bar (the shared picker plus opt-in
  location) that re-targets all its widgets, and a personal copy on first edit. It has non-map widgets, including
  calendars; the Map widget joins in step 6.
- The Widget Creation view (including the advanced resolution override): date methods above catalog-driven dataset accordions (the v1
  tabs become accordions), multiple layers per widget (≤ 1 pollutant), the shared place
  picker (plus a pollutant control) for "now" widgets, and a live preview.
- The "Duplicate widget" action (used to put several widgets on the same place).
- Point places: resolve air quality to the smallest containing region with data (ZIP →
  city → county) at render time, label the source, and freeze to that region on staging.
- The **shared place picker**: monitors, regions (any hierarchy type) or places; search,
  hierarchy browsing, single or multiple selection; built on step 3's region-hierarchy
  metadata and `v1-lessons.md`. It's reused by the Map widget and Release 2 alert rules.
- The `WidgetType` registry (including `analyzable` and an optional pinned `resolution`:
  calendars `day`, heatmap `hour`); layers and `QueryDescriptor` carry `resolution`
  (pin → override → ladder) and `WidgetDataConfig`; "now" widgets
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
  plugin interface, `MapView`, app-level data stores (`createMonitorsStore()`), and optional
  `metadata` / `messages` / `format` providers with built-in defaults.
- A monitor-map plan (parallel, not blocking; start alongside the Map widget to validate
  the `map-sdk` API): rebuild on `map-sdk` on a branch (MapShell, routes, panels, the
  standalone build). Merge to its `main` only after verification, with explicit approval.
- The v3-mobile migration is a separate later track (see `DEFERRED.md`).
- The Map widget: map feature clicking (method A), synced both ways with the step 4 shared
  place picker (method B). Drawn shapes (C, via a
  `terra-draw` plugin) come later.

**Release 1, parallel track: hosting on sjvair.com** (approved sjvair.com plan first)

- sjvair.com:
  - an import script that clones and builds this repo's `main` during the Heroku deploy
    (modeled on `scripts/import-monitor-map.sh`; no pinning)
  - a Django catch-all route for `/explore/*`, decorated with `ensure_csrf_cookie` and not
    forcing trailing slashes
  - confirm no existing CMS page uses `explore`
- Confirm `SJVAir/data-dashboard` is public (the user is switching it, 2026-09-28) so the
  anonymous import clone works.
- `VITE_*` keys as Heroku config vars.
- Restrict the MapTiler and NREL keys by domain in each provider's dashboard (sjvair.com,
  plus separate keys or allowed domains for localhost dev and a staging preview).
- This repo: Vite `base: "/explore/"`, and `setOrigin(location.origin)` when served
  under `/explore/` (`VITE_PROD_URL` only for Tauri/standalone builds).
- Merging to dashboard `main` needs the user's explicit go-ahead (it ships with the next
  server deploy).

**Release 1, parallel track: email-only accounts** (approved sjvair.com and sdk-js plans
first)

- sjvair.com:
  - make `phone` optional (an account needs a verified phone or email; handle
    `USERNAME_FIELD`)
  - an email verification flow
  - login and registration by email or phone
  - keep the phone flows working for v3-mobile
- sdk-js: account-call updates for email verification and email registration.
- Lands before sign-in-dependent features ship. Fold the server "remember me" change into
  this plan, since both change the login page.

**Release 1, parallel track: server-backed documents** (approved sjvair.com, sdk-js, and
django-resticus plans first)

- **First: the CSRF fix** (`ARCHITECTURE.md` → "CSRF protection"). This covers a
  django-resticus change enforcing CSRF for session-authenticated writes, the sdk-js
  `X-CSRFToken` header, and updates to sjvair.com pages that call the API with the
  cookie. Order: the pages and SDK are ready before or with the resticus merge, and all
  of it lands before cookie-based saves ship. Merging to resticus `develop` needs the
  user's explicit approval.

- sjvair.com: the `SavedDocument` model and endpoints (`id` = client UUID, visibility,
  `version`, revocable `share_token`, body size limit).
- sdk-js wrappers; make `apiToken` optional on account calls that require it today.
- Dashboard:
  - the sign-in flow: redirect to sjvair.com login/registration with `?next=` (the server
    "remember me" change is owned by the email-only accounts plan)
  - versioned local-first sync: automatic replay of non-overlapping edits, and a prompt
    (keep mine / use the other / save mine as a copy) on true overlaps
  - live share links (read-only plus "Make a copy")
  - local → account migration
  - sign-out "keep on this device / remove" (remove by default)

**Release 1, step 6: Starter dashboard and go-live**

- The default first-visit dashboard gains the Map widget (it has non-map widgets,
  including calendars, from step 4).
- Go-live: enable the `sjvair.com/explore/` route once Release 1 is complete.

**Release 1: private preview (from about step 4)**

- An unlisted preview (staging Heroku app or hidden route; decide in the hosting-track
  plan) for a pilot teacher and a researcher. Collect feedback on the windowed dashboard
  before go-live.

**Release 2: Alerts** (the server work can start alongside Release 1)

- sjvair.com:
  - alert rules (monitor/region pollutant, forecast, pesticide-notice)
  - level-category thresholds, caps, and quiet hours
  - SMS for every alert type, plus email (verified email; one-click unsubscribe). Email
    depends on the email-only accounts track's verification flow; SMS, inbox and rules can
    go first.
  - migrate existing SMS subscriptions to rules that reproduce today's behavior exactly
    (caps and quiet hours off, opt-in to new behavior)
  - keep the legacy subscription endpoints as a compatibility layer, logging usage with
    the app version, so v3-mobile works unchanged
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
