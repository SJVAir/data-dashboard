# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SJVAir's data dashboard — a Vite + Svelte 5 SPA: a personal, interactive dashboard and
data-analysis toolbox over all public SJVAir data, for community members, schools, and
researchers. Three views: **Dashboard** (windowed widgets), **Widget Creation**, and
**Analysis** (Collections, starter analyses, notebooks).

Where to look:

- `IDEA.md` — the planning brief this direction comes from.
- `ARCHITECTURE.md` — all design decisions (each notes which IDEA.md question it resolves).
- `TODO.md` — current status and "start here".
- `ROADMAP.md` — sequencing of sub-projects.
- `DEFERRED.md` — **every** deferred or ruled-out item (see the standing rule below).
- `docs/reference/` — server data inventory, notebook-kernel evaluation.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # Type-check Svelte components
npm run check:watch  # Type-check in watch mode
npm run test         # Run the Vitest suite once (unit + browser-mode component tests)
npm run test:unit    # Vitest unit tests only (Node)
npm run test:browser # Vitest browser-mode component tests only
npm run test:watch   # Run Vitest in watch mode
npm run test:e2e     # Playwright E2E on Chromium (builds and serves /workspace/)
npm run test:e2e:all # Playwright E2E on Chromium, Firefox, and WebKit
npm run test:e2e:podman # All three engines in the official Playwright image (podman)
npm run test:dev-stack # Local-only: dev server + sjvair.com podman stack smoke (run `npm run dev` first)
npm run test:embedding # Local-only embedding suite against the stack (needs WORKSPACE_E2E_IDENTIFIER and
                        # WORKSPACE_E2E_PASSWORD; optional WORKSPACE_E2E_STATIC = the static folder to expect)
npm run check:build  # Check dist/workspace/ against the hosting contract (after a build)
npm run check:budget # Check the initial bundle budget (after a build)
npm run lint         # Prettier check + ESLint
npm run format       # Auto-format with Prettier
```

## Architecture Overview

Plain Vite SPA — no SvelteKit, no server-side rendering. Routing is handled by
`sv-router` (`src/router.ts` exports `{ route, navigate, p, isActive }`; `src/App.svelte`
renders the top nav and `<Router />`). The base path is `/workspace`. Routes live under
`src/routes/`: `/` (last-opened dashboard or the starter), `/dashboards` (the list), and
`/dashboards/:id`; the full table is in `ARCHITECTURE.md` → "Routing, URL state & undo".
The v1 tab code was removed in Foundations spec 1 (a fresh start). When building new code,
reuse existing code only if it's exactly what the new design needs.

### State architecture

- **Dashboard direction (new code):** the URL identifies _where you are_ (dashboard,
  fullscreen widget, Widget Creation, Analysis); saved documents hold _what's there_.
  All document edits go through `applyChange` (gives undo/redo), and every change
  autosaves (there is no explicit Save). See `ARCHITECTURE.md` →
  "Routing, URL state & undo" and "Saving & sharing documents".
- **Where it lives (Foundations spec 1):** documents and their change log in IndexedDB
  through the platform adapter (`src/lib/platform/`); `DocumentSession`
  (`src/lib/store/document-session.svelte.ts`) applies changes, keeps undo/redo, autosaves
  after 500 ms, and syncs other tabs over `BroadcastChannel` (`src/lib/store/tab-channel.ts`).
  On `pagehide` and when the page is hidden it also writes pending changes to a synchronous
  journal (`platform.journal`, `localStorage` on the web), replayed when the dashboard next
  opens.

### Related SJVAir projects

- `@sjvair/monitor-map` (sibling repo `../monitor-map`) — SJVAir's interactive map,
  packaged as an embeddable Svelte library, **now at v4.3.0** (4.0–4.2, October 2026: a new
  options toolbar and unified legend, `./core` and `./routes` entry points, a self-fetching
  detail panel; 4.3.0, 2026-10-21: `@sjvair/sdk` 4.7.0 and request cancelling). It is **still one map per page** (singleton `mapManager` and
  integrations). This repo no longer depends on it (the v1 Monitors tab that embedded its
  `MapShell` was removed in Foundations spec 1). The new dashboard does not use it; see below.
  **Planned split (decided 2026-09-24):** a new `@sjvair/map-sdk` (sibling repo
  `../map-sdk`, not yet created) holds the per-map core, plugins, `MapView`, and data
  stores, while monitor-map is rebuilt on it (as its **5.0**) as the monitor-map
  _experience_ (MapShell, routes, panels, options toolbar, legend, the standalone build
  sjvair.com imports), keeping the `/core` and `/routes` entry points the mobile app uses. **Dashboard map widgets use
  `map-sdk`'s `MapView`, not monitor-map.** See `ARCHITECTURE.md` → "Map SDK".
- `@sjvair/sdk` (sibling repo `../sdk-js`) — the SJVAir API client. Covers `monitors`
  (with `entry_type`s like pm25/pm10/o3/etc.), `hms` (smoke/fire), `collocation_sites`,
  `pesticides`, `regions`, and `account` (login, subscriptions, air alerts).
- `../sjvair.com` — the Django server (data, user accounts, alert/notification system).
  **During Foundations, sjvair.com work branches from and PRs into its `develop` branch**
  (decided 2026-10-19), not `main`.
- `~/workspace/django-resticus` — the REST framework sjvair.com's API is built on
  (remote `dmpayton/django-resticus`; sjvair.com installs its `develop` branch unpinned).
  The user has access. It gets the CSRF fix; see `ARCHITECTURE.md` → "CSRF protection".
- `../mobile` — the current SJVAir mobile app (`SJVAir/sjvair-mobile`, Svelte 5 +
  Capacitor; the Svelte rebuild shipped as 3.0.0 on 2026-09-29, now at 4.0.5, and it replaced the old
  `v3-mobile` working copy). It consumes `@sjvair/monitor-map` `^4.2` through its `/core`
  and `/routes` entry points (using `monitorsManager` as an app-wide data store) and
  authenticates with `Token` headers only. Its `CLAUDE.md` lists off-limits areas (`ios/`,
  `android/`, CI, env config, Capacitor plugin calls). Publishing a GitHub Release there
  ships to TestFlight and the Play beta track, so it needs explicit approval.

**Get an approved plan before modifying any sibling project**, and never break its
existing consumers (monitor-map is also used by sjvair.com and the mobile app).

### Platform & auth rules

- **Web-first, Tauri-ready** (see `ARCHITECTURE.md` → "Platform strategy"). Never call
  `localStorage`, `Notification`, file-save APIs, etc. directly from components or
  managers — go through the platform adapter layer so a Tauri build can swap them.
- Never enable cross-origin isolation (COOP/COEP) app-wide.
- **Metadata is the source of truth** (see `ARCHITECTURE.md` → "Metadata as source of
  truth"). Never hardcode labels, units, breakpoints, colors, scales, or coverage — read
  them from server `…/meta/` endpoints; if missing, add them server-side.
- **English-only but translation-ready** (see `ARCHITECTURE.md` →
  "Internationalization"): all UI strings through Paraglide messages, no concatenated
  sentences, all formatting through the shared `format` module, never store generated
  English in saved documents.
- **Dates use Pacific time (America/Los_Angeles), never the browser's zone**, via the
  `format` module; weeks start on Sunday. See `ARCHITECTURE.md` → "Time zone & calendar
  conventions".
- **No analytics or tracking in the dashboard** (no Google Analytics/Tag Manager). Error
  reports go through the platform adapter with strict PII scrubbing. See `ARCHITECTURE.md` →
  "Telemetry, analytics & privacy".
- **Treat document content as untrusted** (see `ARCHITECTURE.md` → "Security baseline"):
  validate every incoming document with a schema and size limit, render Markdown with raw
  HTML off, and never inject HTML or use inline scripts (a CSP on `/workspace/*`, report-only then enforced, backs this up).
- **The dashboard is embedded in a dedicated Django template on sjvair.com** (the
  monitor-map pattern, but not extending the site's base template). The build emits
  fixed-name entry files; `index.html` is for local dev and standalone builds only. See
  `ARCHITECTURE.md` → "Deployment" → "Template embedding".
- **Auth mode depends on deployment context** (see `ARCHITECTURE.md` →
  "Authentication"): session cookie when served from sjvair.com's origin (Release 1:
  `/workspace/`); `Token`
  header when standalone on another origin or under Tauri.

## Licensing

This repo is **MIT** (decided 2026-09-28; copyright holder: "Central California Asthma
Collaborative (SJVAir)", decided 2026-10-14; the `LICENSE` file is added in Foundations), as are `map-sdk` and `monitor-map` once added, matching `sdk-js`. Only add
dependencies with permissive licenses (MIT, BSD, Apache-2.0, ISC; MPL-2.0 only if
unmodified; OFL-1.1 for fonts only, decided 2026-10-26). CI will check licenses and the build will generate third-party notices. See `ARCHITECTURE.md` → "Licensing".

## Deferred work — standing rule

**`DEFERRED.md` is the single register of everything deferred or ruled out.** Whenever
anything is deferred — in a brainstorm, spec, plan, code review, or implementation — add
it to `DEFERRED.md` in the same change, with why and what triggers revisiting it. Never
leave a deferral only in a spec/plan/TODO/commit message. Items leave `DEFERRED.md` only
by being done or explicitly dropped by the user (recorded under "Dropped").

## Key Libraries

Installed:

| Library                            | Purpose                                            |
| ---------------------------------- | -------------------------------------------------- |
| `sv-router`                        | Client-side routing                                |
| `@sjvair/sdk`                      | Air quality data API                               |
| `date-fns`                         | Date handling                                      |
| `@date-fns/tz`                     | Pacific-time date math (via the `format` module)   |
| Paraglide JS (inlang)              | UI message catalog (English-only today)            |
| `zod`                              | Validating every incoming document                 |
| `idb`                              | IndexedDB (inside the platform adapter only)       |
| `lz-string`                        | URL-fragment document sharing                      |
| shadcn-svelte / bits-ui            | Accessible UI primitives                           |
| `svelte-sonner`                    | Toasts (via shadcn-svelte's `sonner`)              |
| `@lucide/svelte`                   | Icons                                              |
| `@sveltejs/enhanced-img`           | Optimized images                                   |
| `color2k`                          | `readableColor` for text on level colors           |
| Vitest                             | Unit tests and browser-mode component tests        |
| `vitest-browser-svelte`            | Rendering components in Vitest browser mode        |
| Playwright, `@axe-core/playwright` | E2E on Chromium/WebKit/Firefox; WCAG 2.2 AA checks |

Planned (decided, not yet installed — see `ARCHITECTURE.md` → "Tech stack"):

| Library                            | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `uplot` (direct dependency)        | **All** charts (time-series-first)                |
| `@sjvair/map-sdk`                  | Map widget: core, plugins, `MapView`, data stores |
| `terra-draw`                       | Drawn-shape map selection (via a map-sdk plugin)  |
| A Markdown renderer (raw HTML off) | Safe Notes rendering                              |
| Sentry browser SDK                 | Scrubbed error reports (via the platform adapter) |
| JupyterLite + Pyodide              | Separate `/notebooks/` app (Release 3)            |

## Environment Variables

Copy `.env.example` to `.env` and fill in real values (never commit `.env` itself):

```
SJVAIR_DEV_SERVER=          # optional, not VITE_-prefixed: dev proxy target for /api/ and /account/ (default http://localhost:8000)
VITE_PROD_URL=              # current code; planned: only for Tauri/standalone (under /workspace/ → location.origin)
VITE_MAPTILER_KEY=          # MapTiler basemap key (injected into map-sdk; public in the build, so domain-restrict it)
VITE_NREL_KEY=               # NREL alt-fuel API, EV-stations plugin (public in the build; domain-restrict it)
VITE_SENTRY_DSN=            # the dashboard's Sentry project DSN (public by design); unset = error reporting off
VITE_OPENWEATHERMAP_KEY=    # currently unused anywhere (see DEFERRED.md)
VITE_CARBONMAPPER_KEY=      # reserved; unused (see DEFERRED.md)
```

## Releases and publishing — standing restriction

NEVER create a GitHub release, run `npm publish`, trigger a CI release/publish
workflow, or otherwise cause a package to be published, in this or any related
SJVAir project, without the user's explicit permission for that specific
release — every single time. Approval for one release does not carry forward
to the next, even later in the same session or as the natural next step of a
task already in progress. Always stop and ask first. **The same applies to production
deploys.** Once the hosting track is live, sjvair.com's Heroku deploy builds this repo's
`main`, so **merging to `main` is effectively a production deploy**: never merge to `main` without explicit approval.
The same goes for **monitor-map `main`** (sjvair.com builds it unpinned) and
**django-resticus `develop`** (sjvair.com installs it unpinned).

## Repo workflow

Decided 2026-09-28.

- **Feature work happens on a branch per sub-project**, created from `main`. Stacked PRs are
  fine for large steps. Never do feature or implementation work directly on `main`.
- **Small housekeeping fixes may go directly to `main`** (e.g. a forgotten version bump in
  `package.json`), but only when the user asks. Once sjvair.com builds this repo's `main`
  (after the hosting track goes live), even these are production deploys and need
  explicit approval.
- **`main` is not branch-protected** for now (see `DEFERRED.md`).
- **The `planning` branch was merged into `main` on 2026-10-19** (PR #5), with the user's
  approval, once planning was finished.

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Tailwind CSS v4 for styling; prefer utility classes over custom `<style>` blocks
- **Styling values come from theme tokens** (CSS variables for colors, fonts, radii,
  spacing, motion); never hardcode them in components, so the design pass is a token swap
- UI components from shadcn-svelte (bits-ui). **Never use Bulma** (the server's CSS
  framework) in this project.
- **Accessibility target: WCAG 2.2 AA** (see `ARCHITECTURE.md` → "Accessibility"). Every
  drag interaction needs a keyboard alternative; animations respect
  `prefers-reduced-motion`.
- **Supported browsers:** Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (Tailwind v4). Keep the
  initial bundle around 200 KB compressed and lazy-load each widget type's code (CI enforces
  this).
- **Never convey meaning by color alone**: always show the level label or tier. Use the
  shared `readableColor` helper for text on level colors, and outline colored swatches.
- Animations for transitions are encouraged; responsive layouts are required (phones
  must work, though they aren't the primary target)
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive statements
