# Architecture

This document describes the design of the SJVAir data-exploration dashboard. It
reflects the decisions recorded in
`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`; consult that spec
for the full rationale behind each decision.

## Scope (v1)

Data exploration only: browse each data domain, filter by date range (and, where
applicable, county), and view the result as a map, chart, and/or spreadsheet.
Cross-dataset analysis, server-side location search, server-synced preferences, and
a Tauri desktop build are deliberately out of scope for v1 — see `ROADMAP.md`.

## Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

## Tech stack

Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4, shadcn-svelte (bits-ui),
`@lucide/svelte`, `date-fns`, `uplot`, `@sveltejs/enhanced-img`, `@sjvair/sdk`.

No SvelteKit — a plain Vite SPA, matching `monitor-map` and `v3-mobile`, and keeping
a future Tauri wrap simple (pure static client, no server runtime to strip out).

## Tab structure

One top-level tab per SDK data domain, routed via `sv-router`:

- **Monitors** (`/`) — entry_type filter (pm25/pm10/o3/etc., not a sub-tab), date
  range, client-side county filter (using the `county` field already present on
  `MonitorData` — no SDK changes needed). Map, chart, and spreadsheet views, all
  independently toggleable.
- **HMS Smoke/Fire** (`/hms`) — date range filter. Primarily map-centric (GeoJSON
  polygons); chart/spreadsheet toggles may be hidden or disabled for this tab.
- **Collocation Sites** (`/collocation-sites`) — not a date-range + multi-view tab
  like the others. A collocation "site" pairs a reference monitor with a collocated
  monitor, with no time-series data of its own. The flow is: list/map of pairs →
  select a pair → drill into a comparison view of both monitors' entries over a date
  range (reusing the Monitors tab's chart/spreadsheet views against two monitor IDs).

## State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1, server-backed
  sync is a roadmap item) holds only _defaults_: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no params present
  — not on every navigation. Once URL params exist, they win.
- **`src/lib/url-state.ts`** provides the pure, unit-tested serialization codecs
  (`encodeDateRange`/`decodeDateRange`, `encodeViews`/`decodeViews`) a tab uses to
  read/write its URL search params via `sv-router`'s `route.search`/`searchParams`.
- Each tab owns its own lightweight `*.svelte.ts` manager (mirroring `monitor-map`'s
  `monitorsManager` pattern): fetches from `@sjvair/sdk`, holds `$state`, derives
  view-ready data. These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s own managers, which are scoped to "all currently active
  monitors," not arbitrary historical date ranges.

## Views

Rendered as simultaneous split panes when more than one is toggled on (side-by-side
on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `@sjvair/monitor-map`'s `MapShell` plus the relevant integration(s) for
  that tab (e.g. the Monitors tab passes `[monitorsMapIntegration]`). `MapShell` must
  be used with `routerEscapeHatch={false}` since this app has its own `sv-router`
  navigation — see `monitor-map`'s `CLAUDE.md`.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart` module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export, preferring
  the SDK's existing CSV entries endpoint over re-serializing fetched JSON client-side
  where the endpoint's shape matches what's displayed.

## Accessibility

- Every view has a non-visual fallback: the spreadsheet view already serves as one
  for chart/map data; map and chart views should expose their underlying data as
  visible summary text or link to the spreadsheet view.
- Keyboard navigation and ARIA labeling via shadcn-svelte's primitives (bits-ui), not
  hand-rolled interactive elements.
- Standard per-view loading/error states (skeleton or spinner while fetching; inline
  error message with retry).

## Out of scope for v1

See `ROADMAP.md`.
