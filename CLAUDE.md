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
npm run test         # Run the Vitest suite once
npm run test:watch   # Run Vitest in watch mode
npm run lint         # Prettier check + ESLint
npm run format       # Auto-format with Prettier
```

## Architecture Overview

Plain Vite SPA — no SvelteKit, no server-side rendering. Routing is handled by
`sv-router` (`src/router.ts` exports `{ route, navigate, p, isActive }`; `src/App.svelte`
renders the nav and `<Router />`). Today each v1 tab is a route under `src/routes/`. **This
v1 code is removed in Release 1's Foundations step (a fresh start)**, and the route table
in `ARCHITECTURE.md` → "Routing, URL state & undo" replaces it. When building new code,
reuse existing code only if it's exactly what the new design needs. Don't adapt or bolt
onto v1 code.

### State architecture

- **Dashboard direction (new code):** the URL identifies _where you are_ (dashboard,
  fullscreen widget, Widget Creation, Analysis); saved documents hold _what's there_.
  All document edits go through `applyChange` (gives undo/redo), and every change
  autosaves (there is no explicit Save). See `ARCHITECTURE.md` →
  "Routing, URL state & undo" and "Saving & sharing documents".
- **Legacy v1 tab code (current Monitors tab, removed in Foundations):** the URL is the source of truth for the
  tab's view (filters, date range, toggles). `src/lib/preferences.ts` (localStorage
  defaults that seed the URL when no params exist) and `src/lib/url-state.ts` (pure,
  unit-tested codecs such as `encodeDateRange`/`decodeDateRange`) support this. None of
  it carries forward.

### Related SJVAir projects

- `@sjvair/monitor-map` (sibling repo `../monitor-map`) — SJVAir's interactive map,
  packaged as an embeddable Svelte library. Its `MapShell` (v3.3.0) is what the **v1**
  Monitors tab embeds (see its `CLAUDE.md` for `routerEscapeHatch`/`basePath`). The new
  dashboard does not use it; see below.
  **Planned split (decided 2026-09-24):** a new `@sjvair/map-sdk` (sibling repo
  `../map-sdk`, not yet created) holds the per-map core, plugins, `MapView`, and data
  stores, while monitor-map is rebuilt on it as the monitor-map _experience_ (MapShell,
  routes, panels, the standalone build sjvair.com imports). **Dashboard map widgets use
  `map-sdk`'s `MapView`, not monitor-map.** See `ARCHITECTURE.md` → "Map SDK".
- `@sjvair/sdk` (sibling repo `../sdk-js`) — the SJVAir API client. Covers `monitors`
  (with `entry_type`s like pm25/pm10/o3/etc.), `hms` (smoke/fire), `collocation_sites`,
  `pesticides`, `regions`, and `account` (login, subscriptions, air alerts).
- `../sjvair.com` — the Django server (data, user accounts, alert/notification system).
- `~/workspace/django-resticus` — the REST framework sjvair.com's API is built on
  (remote `dmpayton/django-resticus`; sjvair.com installs its `develop` branch unpinned).
  The user has access. It gets the CSRF fix; see `ARCHITECTURE.md` → "CSRF protection".
- `../v3-mobile` — the current SJVAir mobile app (Capacitor); consumes `@sjvair/monitor-map`
  and authenticates with `Token` headers. (`../mobile` is an unrelated project — exclude
  it from all work.)

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
  HTML off, and never inject HTML or use inline scripts (a CSP on `/explore/` enforces this).
- **Auth mode depends on deployment context** (see `ARCHITECTURE.md` →
  "Authentication"): session cookie when served from sjvair.com's origin (Release 1:
  `/explore/`); `Token`
  header when standalone on another origin or under Tauri.

## Licensing

This repo is **MIT** (as are `map-sdk`, `monitor-map`, and `sdk-js`). Only add dependencies
with permissive licenses (MIT, BSD, Apache-2.0, ISC; MPL-2.0 only if unmodified). CI checks
licenses and the build generates third-party notices. See `ARCHITECTURE.md` → "Licensing".

## Deferred work — standing rule

**`DEFERRED.md` is the single register of everything deferred or ruled out.** Whenever
anything is deferred — in a brainstorm, spec, plan, code review, or implementation — add
it to `DEFERRED.md` in the same change, with why and what triggers revisiting it. Never
leave a deferral only in a spec/plan/TODO/commit message. Items leave `DEFERRED.md` only
by being done or explicitly dropped by the user (recorded under "Dropped").

## Key Libraries

Installed:

| Library                                       | Purpose                                        |
| --------------------------------------------- | ---------------------------------------------- |
| `sv-router`                                   | Client-side routing                            |
| `@sjvair/sdk`                                 | Air quality data API                           |
| `@sjvair/monitor-map`                         | v1 map (replaced by `@sjvair/map-sdk`)         |
| `date-fns`                                    | Date handling                                  |
| `uplot` (via monitor-map; direct dep planned) | **All** charts (time-series-first)             |
| shadcn-svelte / bits-ui                       | Accessible UI primitives                       |
| `@lucide/svelte`                              | Icons                                          |
| `@sveltejs/enhanced-img`                      | Optimized images                               |
| Vitest                                        | Unit tests (browser-mode component tests next) |

Planned (decided, not yet installed — see `ARCHITECTURE.md` → "Tech stack"):

| Library                                         | Purpose                                               |
| ----------------------------------------------- | ----------------------------------------------------- |
| `@date-fns/tz`                                  | Pacific-time date math (via the `format` module)      |
| Paraglide JS (inlang)                           | UI message catalog (English-only today)               |
| `lz-string`                                     | URL-fragment document sharing                         |
| `@sjvair/map-sdk`                               | Map widget: core, plugins, `MapView`, data stores     |
| `terra-draw`                                    | Drawn-shape map selection (via a map-sdk plugin)      |
| Playwright                                      | E2E on Chromium/WebKit/Firefox                        |
| `vitest-browser-svelte`, `@axe-core/playwright` | Component tests in a real browser; WCAG 2.2 AA checks |
| JupyterLite + Pyodide                           | Separate `/notebooks/` app (Release 3)                |

## Environment Variables

Copy `.env.example` to `.env` and fill in real values (never commit `.env` itself):

```
VITE_DEV_URL=              # @sjvair/sdk origin in dev (current code; planned: Vite proxy → same-origin)
VITE_PROD_URL=              # current code; planned: only for Tauri/standalone (under /explore/ → location.origin)
VITE_MAPTILER_KEY=          # MapTiler basemap key (injected into map-sdk; public in the build, so domain-restrict it)
VITE_NREL_KEY=               # NREL alt-fuel API, EV-stations plugin (public in the build; domain-restrict it)
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
deploys.** sjvair.com's Heroku deploy builds this repo's `main`, so **merging to `main`
is effectively a production deploy**: never merge to `main` without explicit approval.
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
- **The `planning` branch merges into `main` when planning is finished**, with the user's
  approval at that point. It isn't merged yet because planning is still in progress.

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Tailwind CSS v4 for styling; prefer utility classes over custom `<style>` blocks
- UI components from shadcn-svelte (bits-ui). **Never use Bulma** (the server's CSS
  framework) in this project.
- **Accessibility target: WCAG 2.2 AA** (see `ARCHITECTURE.md` → "Accessibility"). Every
  drag interaction needs a keyboard alternative; animations respect
  `prefers-reduced-motion`.
- Animations for transitions are encouraged; responsive layouts are required (phones
  must work, though they aren't the primary target)
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive statements
