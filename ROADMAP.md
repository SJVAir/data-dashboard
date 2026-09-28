# Roadmap

Sequencing for the dashboard direction. Decided 2026-09-24 at the end of the IDEA.md
planning session. Design lives in `ARCHITECTURE.md`, current status in `TODO.md`, and
everything deferred in `DEFERRED.md`.

**Every numbered item below is its own sub-project** with its own spec, then plan, then
implementation. Sub-projects in a sibling repo (sjvair.com, sdk-js, map-sdk, monitor-map,
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
     stitching, shared polling, last-requested-wins
   - Paraglide (English-only) and the `format` module
   - `SavedDocument`, `QueryDescriptor`/`DateRangeSpec`, `applyChange`, and undo/redo
   - **minimal Collections** (decided 2026-09-24): the store, the Collections drawer,
     "Add to collection ▸", and a placeholder Analysis view that lists a Collection's
     items with "starter analyses coming soon"
   - autosave (no explicit Save) with a "Saved" indicator; picker actions (new,
     duplicate, rename, delete with an undo toast)
   - local durability safeguards (`storage.persist()`, status note, backup nudge, quota
     errors) and "Clear my data"
   - Export/Import `.json` and URL-fragment sharing (`/import`)
   - **a fresh start** (decided 2026-09-24): the v1 app shell, sidebar, tab routes, and
     tab pages are removed; the new top-nav shell and route table replace them from this
     step on. The v1 app was never deployed, so there are no users or URLs to migrate.
     Existing code is reused only if it's exactly what the new design needs. **Before
     removing it**, write `docs/reference/v1-lessons.md` capturing the server behaviors
     and edge cases the v1 code and its tests learned (behaviors, not code).
   - the action/context-menu registry
   - the top-nav app shell, with `basePath` support in `src/router.ts` for serving under
     `sjvair.com/explore/`
   - CI: lint, type-check, tests, and build on every PR. PRs into `main` run the full
     suite (three engines plus axe); feature-branch PRs run the fast set
   - Vite dev proxy to the local sjvair.com stack (same-origin cookies in dev)
   - test infrastructure: Vitest browser mode, Playwright (3 engines), axe
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
   - SDK wrappers for forecasts, CalHeatScore, and CalEnviroScreen
   - region hierarchy, choice lists, and display hints (metadata gaps 5–7)
   - HTTP cache headers on the summary endpoints
   - hardcoded-value cleanup in sjvair.com and this repo, and fixing sdk-js `api-urls.md`
4. **Widget Creation and the non-map widgets**
   - Widget Creation view (catalog-driven dataset accordions, layers, advanced resolution
     override)
   - the **starter dashboard** (first-visit default) with non-map widgets. Until it
     exists, `/` and "new from starter" open a blank dashboard
   - the `WidgetType` registry and `WidgetDataConfig`
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
   - "Mark for analysis" / "Analyze" on every `analyzable` widget, plus the calendar's "selected
     data" variants, feeding Release 1's Collections
5. **`map-sdk` and the Map widget** (decided 2026-09-24: split out of monitor-map)
   - `@sjvair/map-sdk` 1.0 (new repo): instance-scoped core, plugins, `MapView`,
     app-level data stores
   - monitor-map rebuilt on `map-sdk` on a branch; its `main` (which sjvair.com builds)
     changes only once the migration is verified
   - v3-mobile migrated
   - the dashboard's Map widget on `map-sdk`, with feature/region selection (methods A/B)
   - The Map widget **waits for `map-sdk`**; there is no interim single-map build.

- **Parallel track: hosting on sjvair.com** (approved sjvair.com plan first). An import
  of this repo's `main` into `dist/` during each Heroku deploy (the monitor-map pattern, no
  pinning), a Django catch-all route for `/explore/*`, and Heroku config vars for
  `VITE_*` keys. Merging to dashboard `main` is the deploy approval point.
- **Parallel track: email-only accounts** (sjvair.com + sdk-js, decided 2026-09-28).
  Phone becomes optional; an account needs a verified phone or email; a new email
  verification flow; login and registration by either. Phone flows keep working for
  v3-mobile. It lands before sign-in-dependent features ship.
- **Parallel track: server-backed documents** (sjvair.com + sdk-js + django-resticus,
  decided 2026-09-24). **First, the CSRF fix** in django-resticus (with the SDK header and
  sjvair.com page updates), before any cookie-based saves. The `SavedDocument` model and endpoints, live share links (read-only
  plus "Make a copy"), versioned local-first sync (automatic replay of non-overlapping
  edits; a prompt only on true overlaps), local →
  account migration, and the sign-in flow (which Release 2 reuses). Anonymous users
  stay local, with durability safeguards. Sign-in in Release 1 **redirects** to
  sjvair.com's login/registration pages (plus a server "remember me" change); sdk-js
  makes `apiToken` optional on account calls.

- **Private preview from about step 4** (decided 2026-09-24). An unlisted preview (e.g.
  a staging Heroku app or a hidden route) for a pilot teacher and a researcher, so the
  windowed-dashboard experience gets real feedback well before go-live. The mechanism is
  decided in the hosting-track plan.

6. **Starter dashboard and go-live.** The default dashboard a first-time visitor sees
   (not a blank page) gains its map + calendar widgets once step 5 lands. Before that it
   uses non-map widgets. **The `sjvair.com/explore/` route goes live when Release 1 is
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
    unsubscribe), and the alert inbox API
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

The Release 3 spec must also decide what IDEA.md and the planning session left open:

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
