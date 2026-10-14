# TODO / Current Status

Last updated: 2026-10-13

## Start here

**All 10 decisions from the 2026-09-29 review are recorded (2026-10-13)**, plus the
base-path change to `/workspace/`. Nothing from that review is pending.

**Broad review pass (2026-10-13, after those decisions).** IDEA.md traceability came back
clean; about 40 stale or missing passages were fixed; and six gaps were decided:

1. Regions and locations are referenced by type and official code, not the server's
   per-database id.
2. The version 1 document body is specified (`DashboardBody`, `WidgetInstance`,
   `DateRangeSpec`; one place or a multi-selection per layer; a `default-place` reference;
   per-type date constraints).
3. A per-rule event record on the server feeds the inbox and delivery log for every kind
   of rule, and "fires" is defined per kind.
4. Each local space and every save is bound to an account id, enforced by the server; the
   dashboard gets identity without the API token.
5. **The dashboard is embedded in a dedicated Django template** (the monitor-map pattern,
   not extending the site's base template); the view holds the CSP host list. This
   replaced an earlier assumption that the view serves the dashboard's own `index.html`.
6. The server reports which alert channels an account can use (covers the `sms_alerts`
   rollout flag).

**Hosting pass (2026-10-13).** A narrower check of the hosting, build, and sign-in sections
against the template-embedding model found that production static files are served from
S3 (another origin), uncompressed and without cache headers. Decided: the dashboard uses
that same pipeline, with the accommodations in `ARCHITECTURE.md` → "Template embedding"
(headers set at upload, the static origin in the CSP, inline workers, the manifest and
later service worker served by Django). The rest of those sections was consistent.

**Next:** the user's call: another pass, or merge `planning` into `main` (with approval) and
start the first specs.

**Sibling-repo review (2026-10-13).** A lot changed in the other repos; the docs were updated
to match (see "What changed in the sibling repos" below). The 10 decisions, as recorded
(two were reshaped by those changes):

1. ✅ **Alerts on the redesigned server** (sjvair.com PR #246, **merged 2026-10-12**). The
   redesign is now the baseline: escalation-only texts, built-in throttles, a daily
   reminder, no all-clear, and a `Notification` audit model with no `channel`.
   **(a) Decided 2026-10-13:** every rule and channel follows the server's escalation-only
   rules; no all-clear notification; the in-app inbox shows the timeline. **(b) Decided 2026-10-13:** the server's per-subscription throttles are the only guard
   rail; quiet hours deferred; no per-person cap. **(c) Decided 2026-10-13:** `Notification`
   gains `channel` (sms | email); the in-app inbox is a view over `Alert`/`AlertUpdate`
   with a last-seen marker; throttling stays per rule. This overrides the redesign's "no
   channel" non-goal, so it needs approval in the sjvair.com Release 2 plan.
2. ✅ **Schools as places** (decided 2026-10-13). `PlaceRef` gains
   `{ kind: "location"; id }` for the server's `Location` rows (schools, child care): "pick
   my school" in the place picker, no coordinate lookup or privacy handling needed, and
   alert rules can target a school. Step 3 adds location name search, SDK wrappers, and a
   production data check.
3. ✅ **Age policy** (decided 2026-10-13): accounts are 13+, with a neutral age confirmation;
   under-13s use the dashboard anonymously; `full_name` optional; a site privacy policy;
   legal confirmation needed before the accounts plan is final.
4. ✅ **CSP and Sentry ownership** (decided 2026-10-13): the dashboard keeps the CSP host
   list in a checked-in file that sjvair.com's view reads to build the header; a separate
   Sentry project, DSN from a build-time config var, release = git commit; source-map
   upload deferred. Also decided: **the base path is `/workspace/`, not `/explore/`** (the
   server's "data explorers" made `/explore/` confusing).
5. ✅ **Local document ownership** (decided 2026-10-13): local storage is split into an
   anonymous space and one per account; sign-in asks once about anonymous work; sign-out
   removes the account's local copies; an expired session hides and keeps them (30 days);
   an ID owned by someone else uploads as a copy.
6. ✅ **User content under sjvair.com's name** (decided 2026-10-13): a fixed "made by a
   user, not an official SJVAir page" bar on shared pages, `ugc nofollow` links, `noindex`,
   a report link to the contact form, and staff takedown in the Django admin.
7. ✅ **Stable ids and retirement** (decided 2026-10-13): ids are permanent and never reused;
   entries are retired (with an optional replacement), not deleted; widgets show a clear
   state and offer a switch; rules pause and notify; no silent rewrites. `ceidars` becomes
   `emissions` before go-live, so we build against `emissions`.
8. ✅ **Recovery after a bad upgrade or sync bug** (decided 2026-10-13): validate after
   upgrading, keep the original locally (30 days), keep server snapshots (pre-upgrade plus
   daily, 30 days), a "Restore an earlier version" list, a server block list for bad
   builds, and permanent fixtures for every past format version.
9. ✅ **Account deletion** (decided 2026-10-13): immediate and complete, as today, extended to
   documents, snapshots, share links, rules, and the display name; others' copies stay; a
   backup download is offered first; done from sjvair.com's account page.
10. ✅ **Trailing date ranges** (decided 2026-10-13): the Rolling method gains a "Last" group
    (24 hours, 3/7/30/90 days, 12 months), stored as an amount and unit, in Pacific calendar
    days including today. Still three methods.

**What changed in the sibling repos (reviewed 2026-10-13):**

- **Mobile app:** `../mobile` (`SJVAir/sjvair-mobile`, v4.0.5) is now the current app; the
  old `v3-mobile` working copy is gone. All docs now say `mobile`.
- **monitor-map 4.0–4.2** shipped (options toolbar, unified legend, `/core` and `/routes`
  entry points). It is **still one map per page**, so the `map-sdk` split still stands;
  the rebuild becomes monitor-map 5.0 and must keep `/core` and `/routes` for the mobile
  app.
- **sjvair.com `main`** gained the notifications redesign (#246) and the Pesticides Data
  Explorer (#275), and on 2026-10-13 the Facility Emissions Explorer (#282, which moved the
  API from `ceidars/` to `emissions/`). **Still open:** legacy-entries backfill (#261). New on `main`:
  `Location` (schools, child care), region types `air_district` and `ab617` (`place`
  removed), `regions/geojson/` and `?buffer=`, the region list without boundary geometry,
  21 pesticide routes with monthly rollups, and a waffle `beta_tools` gate for `/tools/`.
  **Unchanged:** PM2.5 breakpoints (still not fixed), metadata endpoints, accounts (phone
  still required), resticus unpinned, no CSRF/CSP, no cache headers, the monitor-map
  import script.
- **`@sjvair/sdk`** is unchanged (4.5.0, no open work). Everything planned for it is still
  to do, and it now also lacks wrappers for the new pesticide and region endpoints.
- **sjvair.com `next`:** no longer the working base. `origin/next` is stale (475 behind
  `main`); the old local integration branch is `my-next`, with `rebuild-next.sh` only in
  its worktree. Three of its four branches are merged; #261 remains an open PR against `main`. New sjvair.com work branches from `main` again unless the user says otherwise.

**Final-review decisions: complete (2026-09-24 → 2026-09-28).** A three-way final review
found 12 gaps; all are decided and recorded. #1–#3, #8 and #9 cover the map-sdk split, the
dropdown picker, and the dataset definition. The rest:

- [x] **#4 Resolution for data without summaries**: catalog-driven; daily-native data
      as-is; weather/PM10 raw with a span cap, downsampled in a worker; server summaries
      for them deferred. See `ARCHITECTURE.md` → "Data resolution & live refresh".
- [x] **#5 Document identity and sharing**: server keeps client UUIDs; `/workspace/shared/:token`
      (revocable, anonymous read-only + copy); `public` reserved; body stored without
      interpretation; automatic replay of non-overlapping edits plus a 3-choice prompt;
      no CRDT. Also decided: readable routes and the `/workspace/` base path.
- [x] **#6 Sync scope and sign-out**: every document syncs when signed in; sign-out
      offers keep/remove (**superseded 2026-10-13:** sign-out removes the account's local
      space); preferences stay local; "Clear my data" is
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
      email verification flow, login by either; phone flows keep working for mobile.
- [x] **#12 Existing SMS subscriptions**: migrate to monitor rules that reproduce today's
      behavior exactly. (**Superseded 2026-10-13:** the original plan had new rules send a
      "back to normal" message with caps and quiet hours; every rule now follows the
      server's escalation-only design, with no all-clear and only its existing throttles.) Legacy endpoints stay as a logged compatibility layer; their removal and the
      mobile update are deferred.

**IDEA.md Open Questions resolved (2026-09-23 → 2026-09-24, branch `planning`).** They and
the follow-up gaps are resolved and recorded in `ARCHITECTURE.md`;
sequencing is in `ROADMAP.md`; every deferral is in `DEFERRED.md`.
A full traceability review against IDEA.md (2026-09-24) fixed the remaining gaps
and decided nine follow-ups (more were settled later that day: the fresh start and the
v1-lessons step, the deploy model, the sign-in staging, `analyzable` and the 3-day window,
the private preview and go-live, and the full test gate on PRs into `main`): minimal Collections in Release 1, autosave with durability
safeguards, server documents in Release 1, dataset accordions as layers, Pacific time,
hosting under `sjvair.com/workspace/`, an installable app (revised 2026-09-28: manifest only, no service worker), WCAG 2.2 AA, and the
testing strategy.

Next steps (each its own spec → plan → implementation, per the brainstorming process):

0. When planning is finished: merge `planning` into `main` (**needs the user's approval**).

1. **PM2.5 breakpoint fix**, the **mobile Alerts screen fix** (sjvair.com, the SDK, and the
   mobile app), and the **missing forecast zones** on sjvair.com (all urgent and independent
   — see below; planned for a new session once the `planning` branch is done).
2. **Release 1, step 1: Foundations** spec (this repo). Its data layer depends on the
   **sdk-js request-options change** (first item of the step 3 metadata track), so plan
   that first.
3. ✅ **AQ levels mapped onto CalHeatScore's 0–4 tiers** (2026-10-14): Good 0, Moderate 1,
   Unhealthy for Sensitive Groups 2, Unhealthy 3, Very Unhealthy and Hazardous 4
   (`ARCHITECTURE.md` → "Shared action tiers"). Heat maps one to one and uses
   CalHeatScore's official guidance.
4. Before the step 3 metadata plan and the Release 2 alerts plan: **verify production row
   counts for `school_district` regions and the 3 `custom` forecast-zone regions**
   (Tulare, Kern, Sequoia; the other 6 zones are counties), and import them if
   missing (`DEFERRED.md`).
5. In parallel once approved (sjvair.com / sdk-js / django-resticus plans): Release 1's
   **metadata enablers**, **hosting under `/workspace/`**, **email-only accounts**, and
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
- [x] **Q3 Map SDK modularity / plugin system** → `@sjvair/monitor-map` 4.0 (a version number since used by an unrelated release; the
      rebuild is now 5.0) clean
      break: per-map `MapContext` instead of singletons, factory plugins with data-source
      interfaces, `MapShell` + lightweight `MapView`, injected config; migrate
      sjvair.com and `mobile` in the same effort (restructured 2026-09-24 as
      `@sjvair/map-sdk` (pre-1.0, then 1.0 once validated) plus monitor-map rebuilt on it; consumers migrate one at a
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
        crossing/escalation/optional all-clear; daily caps + quiet hours. (**Superseded
        2026-10-13:** escalation-only, no all-clear, the server's throttles only.)
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
      widget on map-sdk → starter dashboard + go-live, since revised: the starter is built in step 4 and step 6
      adds the Map widget); Release 2 Alerts (server work starts
      alongside Release 1); Release 3 Analysis. Map widget waits for 4.0 (since restructured as `map-sdk`; the monitor-map rebuild is now 5.0).

**⚠️ Urgent, separate from this project: the mobile app's Alerts screen has never shown a
correct level.** Traced 2026-10-14 through sjvair.com, `@sjvair/sdk`, and the mobile app:

- The screen (`mobile/src/features/account/Alerts.svelte`) treats `alert.latest` as a PM2.5
  reading and compares it with the PM2.5 level ranges to choose the label and color.
- **`latest` was never a reading.** The server serialized the `Alert.latest` foreign key,
  i.e. the id of the latest `AlertUpdate`: a text UUID before the sqids migration (so the
  comparison always failed and every alert was dropped), briefly an integer during PR #246
  (a meaningless level), and since 2026-10-01 (`4c098322`) **not returned at all**, along
  with `id`. Every alert is dropped again and the screen says "There are no active air
  quality alerts" even during an alert.
- No error appears: `getAirAlerts` doesn't validate the response, so the SDK's
  `airAlertSchema` (`id: z.string()`, `latest: z.number()`) is never applied.
- It looks up PM2.5 levels only, so ozone alerts could never display correctly.
- Texts are unaffected; this is only the in-app list.

**Planned fix (to handle in a new session after the `planning` branch is done), each step
with an approved plan in its repo and explicit approval for any release:**

1. **sjvair.com (additive):** `account/alerts/` gains `level` (the current level key from the
   latest `AlertUpdate`). Nothing existing changes, so it can ship on its own first.
2. **sdk-js (minor release):** the alert type gains `sqid` and `level`; `id` and `latest`
   become optional and deprecated.
3. **Mobile (app release):** look up the level by key in the alert's own entry type's
   metadata (fixing ozone too) and stop using `latest`.

**⚠️ Separate from this project: three forecast zones are missing on production.** Checked
2026-10-14 through the public API: production has **0 `custom` regions**, and the live
`forecasts/` feed has only the 6 county zones (Fresno, Kings, Madera, Merced, San Joaquin,
Stanislaus). **Tulare (SJV Valley portion), Kern (SJV Air Basin portion), and Sequoia
National Park and Forest have no forecasts on sjvair.com**, because the forecast import
(`ZONE_TO_REGION` in `forecasts/tasks.py`) can't match them to a region. Fix: import the
three `custom` regions (and give them stable codes, per "Stable ids and retirement"), then
re-run the forecast import. To handle in a new session alongside the alerts fix.

**Worth doing, separate from this project: sjvair.com's static files are served
uncompressed.** Checked on production 2026-10-13: the map's script
(`static/monitor-map/sjvairMonitorMap.js` on S3) is sent as 2.18 MB with no
`Content-Encoding` and no `Cache-Control`. Uploading it compressed would cut the download
by roughly 70%. The dashboard's hosting plan sets these headers for its own files; the
same change would help the existing site.

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
- **mobile**: three files hardcode the pre-2024 scale: `src/components/PMGauge.svelte`
  (12.1/35.5/55.5/150.5/250.5), `src/lib/colors.ts`, and
  `src/components/AirQualityGuidelines.svelte`. (Re-checked 2026-10-13: the server
  breakpoints are still not fixed.) Tracked in `DEFERRED.md`; it needs its own plan and an app
  release.

## Work breakdown by ROADMAP step

Every item below comes from a recorded decision (see `ARCHITECTURE.md`). Standing rule: record
every deferral in `DEFERRED.md`. Sibling-repo items each need an approved plan first, and a
package release needs explicit per-release approval.

**Now (independent)**

- sjvair.com PM2.5 breakpoint fix (see the warning above).
- The mobile Alerts screen fix (server `level` field, SDK minor release, app release; see
  the warning above).
- Import the 3 missing `custom` forecast zones on production (see the warning above).

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
  opt-in geolocation, error reporting,
  auth mode, and token storage. Preferences (last-opened dashboard, active Collection, the
  starter's chosen place)
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
- A theme-token layer: all colors, fonts, radii, spacing, and motion as CSS variables; no
  hardcoded styling values in components.
- Paraglide JS (English-only) and the shared `format` module, before any new UI. The
  `format` module owns the time-zone rules: Pacific everywhere via `@date-fns/tz`,
  Sunday week start, DST-safe (`ARCHITECTURE.md` → "Time zone & calendar conventions").
- The version 1 document body as sketched in `ARCHITECTURE.md` (`DashboardBody`,
  `WidgetInstance`, `DateRangeSpec`, a layer's `place` or `selection`, `default-place`),
  with zod schemas; the spec finalizes field detail.
- `SavedDocument` types, a migration chain (validated after each upgrade, with the original
  kept locally for 30 days and permanent fixtures for every past `schemaVersion` run in
  CI), `applyChange`, and undo/redo. The `Change`
  format is serializable JSON with explicit `target`s, plus a persisted queue of unsynced
  changes with their base version, and cross-tab sync via `BroadcastChannel`
  (`ARCHITECTURE.md` → "Routing, URL state & undo").
- **Local storage spaces** from the first IndexedDB schema: an anonymous space plus one per
  account, keying every document, queued change, and place preference; the one-time
  "add anonymous work to your account" prompt; sign-out removing the account's space;
  an expired session hiding it for 30 days; each space bound to an account id, re-checked
  on tab focus and before each sync; sign-in and sign-out applied across tabs
  (`ARCHITECTURE.md` → "Accounts & anonymous use").
- The **CSP host reference list**: one checked-in file of the hosts each directive needs,
  with a test that fails when code references an unlisted host (sjvair.com's view holds
  the deployed copy), and a listener that reports policy violations.
- Build output for embedding: fixed-name entry script and stylesheet, hashed lazy chunks
  located under the static path, `version.json`; identity and static path read from the
  template's JSON data block. `index.html` is for local dev and standalone builds only.
  Workers are built inline (static files are cross-origin in production), and an E2E
  smoke run serves static files from a second origin. Sentry
  through the platform adapter: `VITE_SENTRY_DSN` (off when unset) and the git commit as
  the release and build id.
- Date-range resolution (`DateRangeSpec` → Pacific dates) lives with the `format` module;
  see `DEFERRED.md` → "Shared date-range helper home".
- Local save plus Export/Import `.json` and URL-fragment share, with the `/import` route.
- Version skew: open newer-`schemaVersion` documents read-only; tag queued changes with
  their `schemaVersion` and replay before migrating; a `version.json` check on focus and
  hourly, plus a chunk-load-failure reload prompt.
- Schema validation (zod) plus size limits for every incoming document (file, fragment,
  server) before migration; reject invalid documents cleanly.
- Minimal Collections: the store, the drawer, "Add to collection ▸", staging that freezes
  rolling ranges to fixed Pacific dates (with a per-item "keep rolling" toggle), and a
  placeholder
  Analysis view ("starter analyses coming soon").
- Action/menu registry: pure resolution and merge logic, tested, plus a bits-ui
  `ContextMenu` host. Install shadcn-svelte `context-menu`.
- App shell: top nav, dashboard picker (a dropdown), and the new route table (`ARCHITECTURE.md` →
  "Routing"), plus `basePath` support for `sjvair.com/workspace/`.
- CI workflow: lint, type-check, tests, and build on every PR.
- A CI bundle budget (about 200 KB compressed of initial JS), per-widget-type code
  splitting, and an unsupported-browser notice (Chrome/Edge 111+, Safari 16.4+, Firefox 128+).
- A shared `readableColor` helper (color2k) for text on level colors; outlined swatches;
  labels always shown alongside level colors.
- Error reporting through the platform adapter to Sentry (strict PII scrubbing), an in-app
  privacy note, and a preview feedback link.
- Add an MIT `LICENSE` file (`Copyright (c) 2026 Central California Asthma Collaborative
(SJVAir)`) (and `"license": "MIT"` in `package.json`), a CI license check
  (permissive only), and generated third-party notices.
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
  actions: new, duplicate, rename, delete with an undo toast. Local soft delete with a
  "Recently deleted" list (about 30 days), and `copiedFrom` on local copies (starter, Save as
  copy).
- Local durability: a `navigator.storage.persist()` request, a storage status note, a
  backup nudge, and clear quota and write errors.

**Release 1: design pass** (its own small sub-project, before step 4 and the private preview)

- Palette (from sjvair.com's pages, around the fixed EPA level colors), typography,
  spacing, motion, and component styling, applied as theme-token values.

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
- Regions and locations by official code: detail and lookup endpoints accept `type` +
  `external_id` (regions) and `source` + `external_id` (locations) and return them;
  assign codes to the 3 `custom` forecast zones; sdk-js wrappers accept the pair. (Checked
  2026-10-14: the region API returns `id` (sqid), name, slug, type, and boundary, but not
  `external_id`.)
- Stable ids and retirement: a never-reuse rule for ids, `retired` (date, optional
  replacement) on catalog entries and entry types, and lookups that distinguish "retired"
  from "never existed" (`ARCHITECTURE.md` → "Stable ids and retirement").
- In order: the `meta/datasets/` catalog (schema per `ARCHITECTURE.md` → "Metadata as source of truth" →
  "What a dataset is"), the coverage endpoint, per-domain scale metas
  (hms, calheatscore with per-score guidance, forecasts, AQI), plus a shared `tier` (0–4;
  CalHeatScore's scale, heat mapped one to one) on every level of every scale (AQ levels: Good 0 … Unhealthy 3,
  Very Unhealthy and Hazardous 4), region
  hierarchy, choice lists, and
  display hints.
- HTTP cache headers (Cache-Control/ETag) on the summary endpoints: **required**, since the
  browser's HTTP cache is the dashboard's persistent data cache (long on completed
  periods, short on the current one).
- Location (schools, child care) support: a name search endpoint (ideally outside
  `pesticides/`), sdk-js wrappers for it and `pesticides/locations/`, and a check that
  production has `import_schools` data.
- Extend `regions/places/lookup/` to accept coordinates (rounded, **in a POST body**; scrub
  `lat`/`lon` from Sentry, Scout, and logs) or `?monitor=` (plus `type=`),
  returning a list of containing regions (filtered by `type`) with the `within=` geometry
  rules; the name mode is unchanged; update
  `lookupRegionPlace` in sdk-js.
- **First sdk-js change:** optional `signal`/`init` on every data function plus a global
  `setRequestDefaults({ headers, credentials })` (additive; `ARCHITECTURE.md` → "SDK request
  options").
- sdk-js wrappers for `forecasts/`, `calheatscore/`, and `calenviroscreen/`, plus
  `regions/geojson/` and the `buffer` parameter (the region list no longer returns
  geometry). Fix sdk-js
  `api-urls.md`.
- Clean up hardcoded values in sjvair.com once the metadata exists. The map cleanup folds
  into `map-sdk` and the monitor-map rebuild; this repo's v1 values go away with the v1 code.

**Release 1, step 3 (addition):** verify production `school_district` rows and the 3
`custom` forecast-zone regions; import if missing.

**Release 1, step 4: Widget Creation and non-map widgets**

- Each widget type declares its allowed date methods and span (`dateMethods`, `span`);
  Widget Creation hides what doesn't apply.
- **Retired or missing references** in every widget type: the "stopped reporting" note,
  "Switch to the replacement", and the "no longer available" card with "Choose another" /
  "Remove" (`ARCHITECTURE.md` → "Stable ids and retirement").
- Heat for areas larger than a ZIP = the highest ZIP score, labeled; forecasts for
  non-zone areas = the containing zone (or the center's zone, labeled).
- The **starter dashboard** (first-visit default): a built-in document defaulting to
  **Fresno County**, a "Showing … · Change place" bar (the shared picker plus opt-in
  location) that re-targets all its widgets, and a personal copy on first edit. It lives at `/workspace/`; "Change place" is a preference (no
  copy); a real edit makes a copy and replaces the URL with `/workspace/dashboards/:id`; sharing
  copies first. It has non-map widgets, including a
  calendar; the Map widget joins in step 6.
- The Widget Creation view (including the advanced resolution override): date methods above catalog-driven dataset accordions (the v1
  tabs become accordions), multiple layers per widget (≤ 1 pollutant), the shared place
  picker (plus a pollutant control) for "now" widgets, and a live preview.
- The "Duplicate widget" action (used to put several widgets on the same place).
- Location privacy: send rounded points to lookups; shares, copies, and exports default to
  the region, with a per-share "Share my exact location instead" option and warning.
- Point places: resolve air quality to the smallest containing region with data (ZIP →
  city → county) at render time, label the source, and freeze to that region on staging.
- The **shared place picker**: monitors, regions (any hierarchy type), schools and
  child-care sites (`location`), or points
  (`PlaceRef`); search,
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
  - Notes (safe Markdown: raw HTML off, link allowlist, links open in a new tab with
    `rel="ugc nofollow noopener"`)
  - Hour × weekday heatmap
  - Forecast strip
  - "Can we go outside?"
- "Mark for analysis" / "Analyze" actions on every `analyzable` widget, including the calendar's
  selected-range variants.
- Client-side self-monitoring thresholds. These need no server work and ship with the
  widgets.

**Release 1, step 5: `map-sdk` and the Map widget**

- Create the `@sjvair/map-sdk` repo (MIT license from the start). Its spec and plan (pre-1.0; 1.0 is cut once the Map
  widget and the monitor-map rebuild validate it) cover the instance-scoped core,
  plugin interface, `MapView`, app-level data stores (`createMonitorsStore()`), and optional
  `metadata` / `messages` / `format` providers with built-in defaults.
- A monitor-map plan (parallel, not blocking; adds the MIT license; start alongside the Map widget to validate
  the `map-sdk` API): rebuild on `map-sdk` on a branch (MapShell, routes, panels, the
  standalone build). Merge to its `main` only after verification, with explicit approval.
- The mobile migration is a separate later track (see `DEFERRED.md`).
- The Map widget: map feature clicking (method A), synced both ways with the step 4 shared
  place picker (method B). Drawn shapes (C, via a
  `terra-draw` plugin) come later.

**Release 1, parallel track: hosting on sjvair.com** (approved sjvair.com plan first)

- sjvair.com:
  - an import script that clones and builds this repo's `main` during the Heroku deploy
    (modeled on `scripts/import-monitor-map.sh`; no pinning)
  - a **dedicated Django template** for `/workspace/*` that embeds the built dashboard the
    way `pages/index.html` embeds the map (`{% static %}` tags, the user and static path
    in a `json_script` block) but does **not** extend `base.html`/`page.html` (so no
    Google Tag Manager/Analytics, Bulma, or site chrome)
  - `X-Robots-Tag: noindex` on `/workspace/shared/*`, framing protection, and the page
    itself uncached
  - **static files on S3** (the map's pipeline): upload the dashboard's files
    pre-compressed with `Content-Encoding`, hashed chunks long-lived and immutable, entry
    files and `version.json` as `no-cache`; a post-deploy header check; add the static
    origin to the CSP; add the preview's origin to the bucket's cross-origin rule
  - serve the web app manifest from Django under `/workspace/`
  - a Django catch-all route for `/workspace/*`, decorated with `ensure_csrf_cookie` and not
    forcing trailing slashes
  - confirm no existing CMS page uses `workspace`
- `VITE_*` keys as Heroku config vars.
- A CSP on `/workspace/*` from the Django view: report-only first, then enforced, with the
  host list **kept in sjvair.com beside the view** (matching this repo's reference list)
  (`ARCHITECTURE.md` → "Security baseline").
- Create the dashboard's own Sentry project in the existing org and set `VITE_SENTRY_DSN`
  as a Heroku config var.
- Restrict the MapTiler and NREL keys by domain in each provider's dashboard (sjvair.com,
  plus separate keys or allowed domains for localhost dev and a staging preview).
- This repo: router `basePath` `/workspace/`, built files under the static path, and
  `setOrigin(location.origin)` when served
  under `/workspace/` (`VITE_PROD_URL` only for Tauri/standalone builds).
- Merging to dashboard `main` needs the user's explicit go-ahead (it ships with the next
  server deploy).

**Release 1, parallel track: email-only accounts** (approved sjvair.com and sdk-js plans
first)

- sjvair.com:
  - make `phone` optional (an account needs a verified phone or email; handle
    `USERNAME_FIELD`)
  - an email verification flow
  - login and registration by email or phone
  - keep the phone flows working for mobile
  - a neutral age confirmation at registration (13+), `full_name` optional for email-only
    accounts, and a privacy policy page on sjvair.com
  - legal confirmation of the age policy before the plan is final
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

- Reject saves whose `schemaVersion` is lower than the stored document's.
- Deletion: synced soft delete (`deleted_at`, purged after about 30 days), a "Recently
  deleted" list, a restore-or-discard prompt, and "no longer available" share pages.
  Owner-only delete; `copied_from`; an optional public display name (no personal info on
  shared pages by default).
- Share tokens ≥ 128 bits (`secrets.token_urlsafe(16)`+); per-user document-count and
  save-rate limits.
- sjvair.com: the `SavedDocument` model and endpoints (`id` = client UUID, visibility,
  `version`, revocable `share_token`, body size limit). Shared pages are served `noindex`;
  staff can disable a share link or block an account from sharing in the Django admin
  (recorded), and the shared page's report link uses the existing contact form. Document
  snapshots (pre-upgrade plus daily, 30 days) with a list-and-restore endpoint, and a
  build block list checked on save (the client sends its build id). Account deletion
  removes documents, trash, snapshots, and share links; the account page's confirmation
  lists what goes and offers a download of all documents; clients learn "account gone"
  and clear that account's local space.
- sjvair.com: every document save carries the account id and is refused on a mismatch with
  the session's account; a session-identity response without `api_token` (the existing
  account response is unchanged for the mobile app).
- sdk-js wrappers; make `apiToken` optional on account calls that require it today.
- Dashboard:
  - the sign-in flow: redirect to sjvair.com login/registration with `?next=` (the server
    "remember me" change is owned by the email-only accounts plan)
  - versioned local-first sync: automatic replay of non-overlapping edits, and a prompt
    (keep mine / use the other / save mine as a copy) on true overlaps
  - live share links (read-only plus "Make a copy")
  - local → account migration (the one-time prompt on sign-in) and sign-out removing the
    account's local space
  - the "made by a user" bar on shared pages (display name, "not an official SJVAir
    page", the report link)
  - "Restore an earlier version" (a dated list of local and server snapshots)

**Release 1, step 6: Map widget in the starter, and go-live**

- The default first-visit dashboard gains the Map widget (it has non-map widgets,
  including a calendar, from step 4).
- Before go-live: a low-end device performance check (Lighthouse with throttling, plus a
  real older Chromebook from the preview school if possible).
- Go-live: enable the `sjvair.com/workspace/` route once Release 1 is complete.

**Release 1: private preview (from about step 4)**

- An unlisted preview (staging Heroku app, hidden route, or the server's `beta_tools`
  flag; decide in the hosting-track plan) for a pilot teacher and a researcher. During it, **verify whether an iOS
  home-screen install has storage separate from Safari** (`ARCHITECTURE.md` → "Platform
  strategy"). Collect feedback on the windowed dashboard
  before go-live.

**Release 2: Alerts** (the server work can start alongside Release 1)

- sjvair.com:
  - alert rules (monitor/region/location pollutant, forecast, pesticide-notice)
  - level-category thresholds, on the server's escalation-only rules and existing throttles
  - SMS for every alert type, plus email (verified email; one-click unsubscribe). Email
    depends on the email-only accounts track's verification flow; SMS, inbox and rules can
    go first.
  - migrate existing SMS subscriptions to rules that reproduce today's behavior exactly
    (no visible change, since new rules behave the same way)
  - keep the legacy subscription endpoints as a compatibility layer, logging usage with
    the app version, so mobile works unchanged
  - a `channel` field on `Notification` (sms | email); a per-rule **event record** written by
    every kind of rule (monitor alerts write to it too), which `Notification` points at;
    the inbox API as a read view over rule events with a last-seen marker; throttling per
    pollutant rule, once daily for forecast rules, once per notice for pesticide rules
  - alert metadata reports which channels the account can use (covers the `sms_alerts`
    rollout flag); the rule UI disables the rest and shows paused texts on existing rules
  - rules whose target is retired pause and put one notice in the inbox
  - account deletion also removes rules, the delivery log, and the inbox marker
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

- [x] **Geometry-free regions list** (was deferred 2026-09-17). Delivered server-side in
      sjvair.com #280: `regions/` no longer returns `boundary.geometry` (only `bbox`), and
      geometry comes from the new `regions/geojson/?type=` endpoint. Removed from
      `DEFERRED.md` on 2026-10-13.

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
