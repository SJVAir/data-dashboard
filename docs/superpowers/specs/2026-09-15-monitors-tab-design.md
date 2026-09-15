# Monitors Tab — Design

## Purpose

Implement the first real tab of the data dashboard (the Monitors tab), per
the V1 design's `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`
"Next up" item. All cross-repo prerequisite work (SDK upgrade, `monitor-map`
`MonitorsDataSource` decoupling, regions support) is done — this spec covers
the tab's own data flow, state manager, and a new reusable calendar
component.

Scope for this pass: **map + calendar views only.** Chart and spreadsheet
views (mentioned as toggleable in the V1 design) are explicitly deferred
until it's clearer what they should show relative to the map's per-monitor
averages — building them now, before that's decided, risks throwaway work.

## Repos touched

- **`data-dashboard`** (this repo) — all new work described here.
- **`sdk-js`** / **`monitor-map`** — no further changes required. Both
  already ship what this spec needs (`@sjvair/sdk@^4.1.0`'s `regions` module,
  `monitor-map@^3.5.0`'s `MonitorsDataSource`-accepting
  `MonitorsMapIntegration`).

## Data sources

Fetched once and cached for the lifetime of the tab (roster/meta rarely
change):

- **`getMonitorsList()`** — the monitor roster: `id`, `position`, `type`,
  `county` (a bare county name string, e.g. `"Fresno"` — see "County
  matching" below).
- **`getMonitorsMeta()`** — per-`entry_type` `levels` (the AQI-style category
  thresholds: `{ name, label, color, range, guidance }[]`), reused for both
  the map's icon coloring and the calendar's day coloring so the two stay
  visually consistent.
- **`getRegionsList({ type: "county" })`** — the county list backing the
  county `Select`: `{ id, name, slug, type, boundary }[]`.

Fetched reactively, keyed on `(dateRange, entryType)` or
`(dateRange, entryType, countyId)`:

- **Map data**: for each monitor currently on the roster, fetch its own
  summary series over the selected date range (resolution chosen by range
  length — see "Map resolution policy") and average `.mean` across the
  returned rows. This is unchanged from the prior plan; it is not affected
  by the regions work, since it answers a different question (one value per
  *monitor*, not per *county*).
- **Calendar data**: only fetched once a county is selected. Calls
  `getRegionSummariesDaily({ regionId, entryType, year, month? })` — always
  at daily resolution, regardless of the selected range's length, spanning
  as many year/month calls as the range requires and filtering the combined
  rows down to it. A calendar is inherently day-granular, so there is no
  resolution policy to choose here (contrast with the map, which only ever
  shows one color per monitor and can therefore average coarser summaries
  for wide ranges).

No "all counties" aggregate exists server-side (confirmed against the
`sjvair.com` backend and its OpenAPI spec — no umbrella region type, no
bulk/multi-region summary endpoint), and computing one client-side would
mean averaging per-county aggregates with no true per-monitor weighting
available (the server's precise `RegionSummary.weight` field isn't exposed
in the API, only `station_count` is). Rather than build an approximate
average, **the calendar simply doesn't render until a county is selected.**

## County selection

A shadcn-svelte `Select` (needs installing — not yet present in this repo),
populated from `getRegionsList({ type: "county" })`. Selecting a county:

1. Drives the calendar fetch (`regionId` from the selected `RegionData`).
2. Filters which monitors are shown on the map, via county-name matching
   against the roster's `county` field.

### County matching

`Monitor.county` (bare name, e.g. `"Fresno"`) does not exactly match
`RegionData.name` for counties (e.g. `"Fresno County"`) — confirmed against
the `sjvair.com` models and region fixtures. No shared ID exists between the
two. Rather than change server data, add a small pure, unit-tested helper
(alongside the existing `url-state.ts`/`preferences.ts` pure-logic files):

```ts
// e.g. src/lib/county-match.ts
function normalizeCountyName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+county$/, "");
}

function countyMatches(monitorCounty: string, regionName: string): boolean {
	return normalizeCountyName(monitorCounty) === normalizeCountyName(regionName);
}
```

## Calendar component (reusable)

A new, tab-agnostic component so it can be reused wherever a day-level,
category-colored calendar view is useful later (the design explicitly
avoids coupling it to the Monitors tab):

- **`src/lib/components/Calendar.svelte`** — rendering only: month grid(s)
  covering the requested range, each day cell colored via the shared
  bucketing logic, muted/gray for days with no data, keyboard-navigable via
  bits-ui primitives where applicable.
- **`src/lib/calendar.ts`** — pure logic, unit-tested like `url-state.ts`:
  which days fall in a given range, grouping days into month grids, and
  bucketing a value into its `levels` category
  (`getCurrentLevel`-equivalent — reuse `monitor-map`'s exported helper if
  it's public; otherwise a small local reimplementation, since it's a
  short, pure range-lookup function and worth keeping in sync rather than
  taking on a coupling for something this small).

Props (exact shape decided at implementation time, but conceptually):
`days: { date: Date; value: number | null }[]`, `levels: SJVAirEntryLevel[] | null`.

## Map resolution policy

Unchanged concern from the prior plan, still needs a concrete threshold at
implementation time. Proposed default (confirm or adjust during
implementation): daily summaries for ranges up to ~45 days, monthly beyond
that, since a single map icon color doesn't benefit from finer-than-monthly
granularity over long ranges the way the calendar's daily cells do.

## State & URL wiring

- A `MonitorsTab.svelte.ts` manager (mirroring the pattern described in the
  V1 design) holds `$state` for: `entryType`, date range, selected county
  (nullable). All three are URL-backed via `sv-router`'s `route.search`.
  - Date range already has a codec (`encodeDateRange`/`decodeDateRange` in
    `url-state.ts`).
  - `entryType` and selected county need small new string codecs added to
    `url-state.ts` following the same pattern (plain search-param
    round-trip, unit-tested).
- **`preferences.ts`** seeds defaults (a default date range, default
  `entryType`, no county selected) only when the tab is opened with no URL
  params present — never overriding params that already exist, per the V1
  design's existing rule.
- Roster and meta/levels fetch once; map averages and calendar data refetch
  reactively as their respective dependencies change.

## Map integration

The tab implements its own `MonitorsDataSource` (`{ meta, pollutant, latest,
levels }`) from the per-monitor averaged data described above, and
constructs `new MonitorsMapIntegration(thisSource)` to pass into
`monitor-map`'s `MapShell` (`routerEscapeHatch={false}`, since this app owns
its own `sv-router`) — this part of the design was already settled before
this spec (see TODO.md's prior "Start here" notes) and is restated here for
completeness.

## Out of scope for this pass

- Chart and spreadsheet views for the Monitors tab (deferred — see
  "Purpose").
- HMS Smoke/Fire and Collocation Sites tabs (separate specs later).
- Any change to `sdk-js`, `monitor-map`, or the `sjvair.com` backend beyond
  what's already merged/released as of this spec.
- An "all counties" aggregate view (no server support; not building a
  client-side approximation — see "Data sources").
