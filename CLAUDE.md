# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SJVAir's data exploration dashboard — a Vite + Svelte 5 SPA for browsing and comparing
the SJVAir ecosystem's data sets (air monitors, HMS smoke/fire, collocation sites).
See `ARCHITECTURE.md` for the full design and `ROADMAP.md` for what's deliberately
deferred past v1.

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
- `@sjvair/sdk` (sibling repo `../sdk-js`) — the SJVAir API client. Currently covers
  the `monitors` (with `entry_type`s like pm25/pm10/o3/etc.), `hms` (smoke/fire), and
  `collocation_sites` domains.

## Key Libraries

| Library                 | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `sv-router`             | Client-side routing                         |
| `@sjvair/sdk`           | Air quality data API                        |
| `@sjvair/monitor-map`   | Embeddable map component (future tab plans) |
| `date-fns`              | Date handling                               |
| `uplot`                 | Charts (future tab plans)                   |
| shadcn-svelte / bits-ui | Accessible UI primitives                    |
| `@lucide/svelte`        | Icons                                       |
| Vitest                  | Unit tests for framework-agnostic logic     |

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

## Code Style

- **Tabs** for indentation (not spaces)
- **Double quotes** for strings
- No trailing commas
- Print width: 100 characters
- Prettier + ESLint (flat config); run `npm run format` before committing
- Tailwind CSS v4 for styling; prefer utility classes over custom `<style>` blocks
- Svelte 5 runes only (`$state`, `$derived`, `$effect`) — no legacy `$:` reactive statements
