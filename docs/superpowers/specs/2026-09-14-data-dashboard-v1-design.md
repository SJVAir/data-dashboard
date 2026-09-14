# SJVAir Data Dashboard — V1 Design

## Purpose

A new dashboard for exploring and comparing the different data sets in the
SJVAir ecosystem. V1 scope is **data exploration only**: browse each data
domain, filter by date range (and, where applicable, county), and view the
result as a map, chart, and/or spreadsheet. Accessibility for the "everyday
person" is a first-class, ongoing goal, not a post-hoc pass.

Deferred to `ROADMAP.md` (not part of this spec): a unified "Data Analysis"
tab for cross-dataset comparison/statistics, server-side location/radius
search, server-synced preferences, and a Tauri desktop build.

## Repos touched

- **`data-dashboard`** (this repo) — new app, all work described here.
- **`monitor-map`** — refactor required so its map can be embedded with a
  reduced feature set (see "monitor-map modularization" below).
- **`sdk-js`** (`@sjvair/sdk`) — no changes required for V1. County filtering
  uses the `county` field already present on `MonitorData`; server-side
  location search stays on the roadmap.

## Tech stack

Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4, shadcn-svelte
(bits-ui), `@lucide/svelte`, `date-fns`, `uplot`, `@maptiler/sdk` (via
`@sjvair/monitor-map`), `@sveltejs/enhanced-img`, `@sjvair/sdk`.

No SvelteKit — a plain Vite SPA, matching `monitor-map` and `v3-mobile`, and
keeping a future Tauri wrap simple (pure static client, no server runtime to
strip out).

## monitor-map modularization

**Problem:** `MonitorMapLayout.svelte` (the component behind the
library's documented `monitorMapRoutes` integration path) hardcodes the full
integration list (monitors, collocation sites, wind, HMS smoke/fire, EV
stations), unconditionally calls `.init()` on every manager, and hardcodes
the full `Menu` contents. The lower-level pieces (`Map.svelte`, individual
integrations, individual `*DisplayOptions.svelte`, managers, and the
`MapIntegration`/`MapLayerIntegration` base classes) are already exported
individually and composable — the shell around them is what isn't.

**Fix:** Split `MonitorMapLayout.svelte` into:

1. A generic shell component (name TBD at implementation time, e.g.
   `MapShell.svelte`) that owns only shell concerns with no knowledge of
   *which* integrations exist:
   - `LoadScreen` show/hide
   - panel-open resize/transition handling
   - the sv-router escape-hatch click handler
   - takes `integrations: SomeMapIntegration[]`, a `menu` snippet, and a
     `children` snippet (for the routed detail panel) as props
2. A thin `MonitorMapLayout.svelte` wrapper that calls the shell with
   today's full integration list, full manager `.init()` calls, and full
   menu — preserving current behavior for the existing widget build and
   `v3-mobile` with **no changes required in either consumer**.

`data-dashboard` composes the shell directly with only the
integrations/managers/menu items each tab needs (e.g. Monitors tab passes
`[monitorsMapIntegration]` and initializes only `monitorsManager`).

## Tab structure (V1)

One top-level tab per SDK data domain, using `sv-router`:

### Monitors

- Filter: `entry_type` (pm25, pm10, pm100, humidity, o3, no2, pressure,
  temperature, particulates) — a selector, not a sub-tab.
- Filter: date range (reusing/extracting the date-range logic from
  `monitor-map`'s `data-chart/DateRange.ts` — see "Shared date-range logic"
  below).
- Filter: county — client-side filter over the already-fetched monitor list,
  using the `county` field on `MonitorData`. No SDK/API changes.
- Views: map, chart, spreadsheet — all independently toggleable.

### HMS Smoke/Fire

- Filter: date range (HMS smoke/fire records carry `start`/`end`/`date`
  fields server-side already).
- Primarily map-centric (GeoJSON polygons/points). Chart/spreadsheet toggles
  may be hidden or disabled for this tab in V1 — decide at implementation
  time whether a spreadsheet view of raw smoke/fire records is worth
  building now or is better deferred.

### Collocation Sites

- Not a date-range + multi-view tab like the other two. A collocation
  "site" (`CollocationData`) just pairs a reference monitor with a
  collocated monitor — no time-series data of its own.
- V1 flow: list/map of collocation pairs → selecting a pair drills into a
  comparison view of the two monitors' entries over a date range (reusing
  the Monitors tab's chart/spreadsheet views against two monitor IDs at
  once). This is the one place V1 inherently compares two datasets,
  foreshadowing the roadmap "Data Analysis" tab.

## State & URL architecture

- **The URL is the source of truth for current view state.** Active tab,
  entry_type/filters, date range, county filter, and which views
  (map/chart/spreadsheet) are toggled on are all URL search params, per
  tab, via `sv-router`. Sharing a URL reproduces the exact same screen for
  the recipient, view toggles included.
- **A preferences store** (localStorage in V1; server-backed sync is a
  roadmap item) holds only *defaults*: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no
  params present (e.g. a bare URL typed in, or first visit) — not on every
  navigation. Once URL params exist, they win over stored preferences.
- Each tab owns a lightweight `*.svelte.ts` manager (mirroring
  `monitor-map`'s `monitorsManager` pattern): fetches from `@sjvair/sdk`,
  holds `$state`, derives view-ready data (table rows, chart series, map
  GeoJSON). These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s managers, which are scoped to "all currently active
  monitors" and not designed for arbitrary historical date ranges.

## Views

Rendered as simultaneous split panes when more than one is toggled on
(side-by-side on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `monitor-map`'s `<Map>` component plus the relevant
  integration(s) for that tab, composed through the new configurable shell.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart`
  module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export.
  Prefer the SDK's existing CSV entries endpoint over re-serializing fetched
  JSON client-side, where the endpoint's shape matches what's displayed.

### Shared date-range logic

`monitor-map`'s `data-chart/DateRange.ts` already implements the
start/end-of-day date-range logic this project needs in multiple tabs.
Rather than duplicating it, extract it to a shared location at
implementation time — either `@sjvair/sdk`'s `datetime` module (if it fits
the SDK's scope) or a `monitor-map` export both projects consume. Decide the
exact home when implementing the first tab that needs it.

## Accessibility & error handling

- Every view has a non-visual fallback: the spreadsheet view already serves
  as one for chart/map data; map and chart views should expose their
  underlying data as visible summary text or link to the spreadsheet view,
  not be chart/map-only.
- Keyboard navigation and ARIA labeling via shadcn-svelte's primitives
  (bits-ui), not hand-rolled interactive elements.
- Standard per-view loading/error states (skeleton or spinner while
  fetching; inline error message with retry). No global error boundary
  beyond this for V1.

## Out of scope for V1 (see ROADMAP.md)

- Unified "Data Analysis" tab (multi-dataset selection, statistical
  tooling, WASM-backed computation).
- Server-side location/radius search (requires `sdk-js` changes).
- Server-synced preferences (V1 is localStorage-only).
- Tauri desktop build.
