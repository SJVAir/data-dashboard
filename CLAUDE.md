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
renders the nav and `<Router />`). Each top-level tab is a route under `src/routes/`.

### State architecture

- **URL is the source of truth** for the current view (active tab, filters, date
  range, which views are toggled on) — see `ARCHITECTURE.md` for the full rationale.
- **`src/lib/preferences.ts`** is a localStorage-backed store of _defaults_ only
  (`getTabPreferences`/`setTabPreferences`/`clearAllPreferences`), used to seed the URL
  when a tab is opened with no params present — never to override an existing URL.
- **`src/lib/url-state.ts`** provides pure encode/decode codecs (`encodeDateRange`/
  `decodeDateRange`, `encodeViews`/`decodeViews`) for serializing state into URL search
  params. These are framework-agnostic and unit-tested independently of `sv-router`;
  a tab wires them to `sv-router`'s reactive `route.search`/`searchParams`.

### Related SJVAir projects

- `@sjvair/monitor-map` (sibling repo `../monitor-map`) — SJVAir's interactive map,
  packaged as an embeddable Svelte library. Its `MapShell` component (added in v3.3.0)
  is a reusable, configurable map-layout primitive intended for exactly this kind of
  embedding — see its `CLAUDE.md` for the `routerEscapeHatch`/`basePath` props needed
  when embedding it inside an app with its own routing (like this one).
  A 4.0 clean break (per-map instances + plugin system, needed for multiple map
  widgets) is planned — see `ARCHITECTURE.md` → "Map SDK".
- `@sjvair/sdk` (sibling repo `../sdk-js`) — the SJVAir API client. Covers `monitors`
  (with `entry_type`s like pm25/pm10/o3/etc.), `hms` (smoke/fire), `collocation_sites`,
  `pesticides`, `regions`, and `account` (login, subscriptions, air alerts).
- `../sjvair.com` — the Django server (data, user accounts, alert/notification system).
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
- **Auth mode depends on deployment context** (see `ARCHITECTURE.md` →
  "Authentication"): session cookie when embedded on sjvair.com's origin; `Token`
  header when standalone on another origin or under Tauri.

## Deferred work — standing rule

**`DEFERRED.md` is the single register of everything deferred or ruled out.** Whenever
anything is deferred — in a brainstorm, spec, plan, code review, or implementation — add
it to `DEFERRED.md` in the same change, with why and what triggers revisiting it. Never
leave a deferral only in a spec/plan/TODO/commit message. Items leave `DEFERRED.md` only
by being done or explicitly dropped by the user (recorded under "Dropped").

## Key Libraries

| Library                 | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `sv-router`             | Client-side routing                     |
| `@sjvair/sdk`           | Air quality data API                    |
| `@sjvair/monitor-map`   | Map widget (4.0 plugin API planned)     |
| `date-fns`              | Date handling                           |
| Paraglide JS (inlang)   | UI message catalog (English-only today) |
| `uplot`                 | **All** charts (time-series-first)      |
| shadcn-svelte / bits-ui | Accessible UI primitives                |
| `@lucide/svelte`        | Icons                                   |
| Vitest                  | Unit tests for framework-agnostic logic |

## Environment Variables

Copy `.env.example` to `.env` and fill in real values (never commit `.env` itself):

```
VITE_DEV_URL=              # @sjvair/sdk origin used in dev (setOrigin)
VITE_PROD_URL=              # @sjvair/sdk origin used in production builds
VITE_MAPTILER_KEY=          # used by @sjvair/monitor-map's MapShell (future tab plans)
VITE_NREL_KEY=               # used by @sjvair/monitor-map (future tab plans)
VITE_OPENWEATHERMAP_KEY=    # used by @sjvair/monitor-map (future tab plans)
VITE_CARBONMAPPER_KEY=      # reserved for a future data source integration
```

## Releases and publishing — standing restriction

NEVER create a GitHub release, run `npm publish`, trigger a CI release/publish
workflow, or otherwise cause a package to be published, in this or any related
SJVAir project, without the user's explicit permission for that specific
release — every single time. Approval for one release does not carry forward
to the next, even later in the same session or as the natural next step of a
task already in progress. Always stop and ask first.

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Tailwind CSS v4 for styling; prefer utility classes over custom `<style>` blocks
- UI components from shadcn-svelte (bits-ui). **Never use Bulma** (the server's CSS
  framework) in this project.
- Animations for transitions are encouraged; responsive layouts are required (phones
  must work, though they aren't the primary target)
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive statements
