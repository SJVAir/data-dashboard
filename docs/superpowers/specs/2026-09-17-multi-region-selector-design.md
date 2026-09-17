# Multi-Region Selector for the Monitors Tab

## Overview

Replace the Monitors tab's single-county dropdown with a region-type selector
(administrative / census / district) plus a multi-select checkbox list of
regions within that type, with a search filter for lists over 10 options.
Selections drive the county-fill-style colored polygons, per-region calendars,
and which monitor markers render — generalized from "county" to any of 7
supported region types.

This spans three repos: `sjvair.com` (two new/changed endpoints, one merged
branch), `sdk-js` (client wrappers for all three), and `data-dashboard` (the
actual UI and state). `monitor-map` needs no changes — the region-fill
polygons, calendar, and region-selection state have never lived there; they're
entirely `data-dashboard`-owned code that happens to render on top of the map
`monitor-map` provides.

## Scope

**In scope:** the 7 region types in the `administrative` (county, city,
zipcode), `census` (tract, cdp), and `district` (congressional_district,
state_assembly, state_senate, school_district) categories. All are small
enough (single digits to ~1,200 rows in dev; the user confirmed production has
data for all of these) to list and render directly.

**Explicitly out of scope (future work):**
- `land_use` (66,151 rows in dev) and `mtrs` (27,917 rows) — orders of
  magnitude larger, and not meaningfully browsable as a flat or even
  county-narrowed checkbox list. A future "progressive unlock" (browse
  land-use/MTRS parcels only after narrowing to a small enough parent area)
  is a plausible follow-up but needs its own design pass.
- `place`, `protected`, `custom` — currently 0 rows in dev; add when they have
  data, no code changes needed since they're just additional `Region.Type`
  values the meta endpoint already reports.
- Cross-type selection persistence in the URL (only the *active* type's
  selection round-trips through the URL; other types' in-memory selections
  are session-only). Revisit if users want to share/bookmark a multi-type
  view.
- A `within=`-driven "lightweight" (geometry-free) regions list endpoint.
  Current design accepts embedded boundary geometry in the checkbox-list
  fetch even though only toggled regions need it for map rendering — traded
  off against added endpoint surface for a payload size that's untested
  in practice. Revisit if this proves too slow for e.g. an unnarrowed
  1,200-row tract list.

## Data model & URL state (`data-dashboard`)

`MonitorsTabManager` replaces `selectedCountyId: string | null` and
`counties: Array<RegionData> | null` with:

- `regionTypes: RegionsMeta | null` — fetched once in `init()`, drives the
  type-selector dropdown (grouped by `category`, restricted to
  administrative/census/district).
- `selectedRegionType: RegionType` — defaults to `"county"`.
- `regionSelections: Map<RegionType, Set<string>>` — per-type selected-id
  sets. Only `selectedRegionType`'s set is "active" (drives fetches/map/
  calendar); the others persist in memory across type switches within the
  session.
- `narrowingEnabled: Map<RegionType, boolean>` — per-type "show all instead
  of narrowing" override; defaults to narrowed (`true`) whenever another
  type currently has a non-empty selection.
- `activeRegions: Array<RegionData> | null` — the fetched, possibly-narrowed
  region list for `selectedRegionType` (drives both the checkbox list and,
  for the selected subset, the map fill/border geometry).

URL encodes only the active type + its selection:
`?regionType=county&regions=id1,id2,id3`, reusing the existing
`encodeViews`/`decodeViews` comma-separated-set codec pattern from
`url-state.ts`. On load, `regionType` defaults to `"county"` and, if
`regions` is absent, defaults to *all* counties selected — matching today's
"All Counties" default exactly, so existing bookmarks/behavior don't change.
Every other type starts with an empty selection until the user opens it.

## Backend changes (`sjvair.com`)

### B1. Merge `regions/meta/` (already built)

Branch `feature/regions-meta-endpoint`, commit `8d4a76fc`. No new work —
land it as-is. `GET /api/2.0/regions/meta/` returns every `Region.Type` with
its label and `category`; this is what drives the type-selector UI. Verified
this is not redundant with B2/B3: it answers "what types exist," which
neither of those endpoints does.

### B2. `within=` narrowing filter on `GET /api/2.0/regions/`

Repeatable region-id query param. Declared as a documented no-op in
`RegionFilter` (for OpenAPI schema generation, matching the existing idiom
`BulkMonitorSummaryFilter.region` uses), applied imperatively in
`RegionList.get_queryset()`:

```python
def get_queryset(self):
    qs = super().get_queryset()
    within_ids = self.request.GET.getlist('within')
    if within_ids:
        geometry = Region.objects.filter(sqid__in=within_ids).combined_geometry()
        if geometry:
            qs = qs.intersects(geometry)
    return qs
```

Both `combined_geometry()` and `intersects()` already exist on
`RegionQuerySet` (`camp/apps/regions/querysets.py`) — no new spatial code.
Verified against existing single-region `region_id` → `intersects` filters
in `ces/filters.py`, `hms/filters.py`, `pesticides/filters.py`: those are
singular (one region, direct geometry lookup); `within=` generalizes the
idiom to union multiple parent regions' geometries first, which none of the
existing filters do.

### B3. New bulk region-summaries endpoint

```
GET /api/2.0/regions/<entry_type>/summaries/<resolution>/?start=&end=&region=id1&region=id2...
```

Mirrors `BulkMonitorSummaryList` exactly (verified via full read of
`camp/api/v2/summaries/endpoints.py`, `filters.py`, `forms.py`,
`serializers.py` — this capability does not exist anywhere today;
`RegionSummaryList` is hard-scoped to one region via a URL path kwarg, not a
query param, so it cannot serve multiple regions):

- New `camp/api/v2/summaries/region_bulk_urls.py`, mirroring `bulk_urls.py`
  (one `path()` per resolution: hourly/daily/monthly/quarterly/seasonal/
  yearly).
- Mounted in `regions/urls.py` as
  `path('<entry_type>/summaries/', include(...))`, placed **before**
  `path('<region_id>/', ...)` — same ordering `monitors/urls.py` already
  relies on, since `entry_type` values (`pm25`, `o3`, ...) never collide
  with region sqids.
- New `BulkRegionSummaryList(SummaryMixin, generics.ListEndpoint)` in
  `summaries/endpoints.py`. Requires `start`/`end`/at least one `region`.
  Simpler than the monitor version — no `scope_to`/bbox/processor concept,
  just `RegionSummary.objects.filter(region__in=Region.objects.filter(sqid__in=region_ids), ...)`.
  Paginates by summary row (`page_size = 168`, inherited from
  `SummaryMixin`), with the same cross-page merge contract documented on
  `BulkMonitorSummaryList` (same monitor/region id on the last row of one
  page and the first row of the next ⇒ concatenate their `summaries`).
- New `BulkRegionSummaryFilter` (`summaries/filters.py`, no-op declarations
  for OpenAPI, mirroring `BulkMonitorSummaryFilter`) and
  `BulkRegionSummaryGroupSerializer` (`summaries/serializers.py`, extends
  the existing `RegionSerializer` the same way `BulkMonitorSummaryGroupSerializer`
  extends `MonitorSerializer` — nests `summary_rows` under `summaries`).
- **Small shared-code refactor**: extract a `BulkSummaryDateRangeForm` base
  in `summaries/forms.py` holding the date-range validation/per-resolution
  span-capping logic currently duplicated-in-waiting between
  `BulkMonitorSummaryForm` (which also adds `bbox`) and the new
  `BulkRegionSummaryForm` (which adds nothing extra). Targeted refactor of
  code this work already touches, not speculative cleanup.

## SDK changes (`sdk-js`)

- **New `lib/regions/get_regions_meta.ts`**: mirrors `get_monitors_meta.ts`.
  A `RegionsMeta` class wrapping the raw `{type, label, category}` map,
  exposing `.asIter.types` (array) and `.type(regionType)` (single lookup).
  New `RegionCategory` zod enum in `lib/regions/schemas/`, mirroring the
  backend's `Region.Category`.
- **Extend `lib/regions/get_regions_list.ts`**: add
  `within?: string | Array<string>` to the filter config, serialized as
  repeatable `within` params (same array-handling the bulk monitor summaries
  config already does for `region`).
- **New `lib/regions/get_region_summaries_bulk.ts`**: mirrors
  `get_monitor_summaries_bulk.ts`. `RegionSummaryBulkRequestConfig
  {entryType, start, end, region: string | Array<string>}`, one exported
  function per resolution, new `RegionWithSummaries` type + schema.
- **Refactor**: extract the pagination-fetch-and-merge logic currently
  living in `get_monitor_summaries_bulk.ts` (`fetchAllBulkSummaryPages` +
  the same-id-split-across-pages merge) into a shared, grouping-key-
  parameterized helper (candidate location: `lib/http/`, alongside the
  `PaginatedResponse` type it already depends on) so
  `get_region_summaries_bulk.ts` doesn't duplicate it verbatim.
- **Wiring**: export both new modules from `lib/regions/mod.ts` (already
  re-exported at the top level via `mod.ts`), add `deno.json` export-map
  entries mirroring `"./monitors/get_monitor_summaries_bulk"`. Version bump
  (e.g. 4.4.0 → 4.5.0) as its own commit once merged, matching existing
  practice.

## Frontend changes (`data-dashboard`)

- **Region-type selector**: dropdown (extends the existing `Select.Root`
  pattern used for county today) populated from `getRegionsMeta()`, grouped
  by category, restricted to administrative/census/district.
- **New `RegionCheckboxList.svelte`**: no multi-select-with-search primitive
  exists in either `data-dashboard` or `monitor-map` today. Props:
  `regions: Array<RegionData>`, `selected: Set<string>`, `onToggle`. A
  plain-text filter input renders only when `regions.length > 10`
  (client-side name filter); checkboxes below, built on bits-ui primitives
  (already a dependency).
- **Narrowing UX**: when *any* other type currently holds a non-empty
  selection, the regions fetch passes `within=` with the union of ids from
  **every** other type's current selection (not just one designated
  "parent" type) — e.g. 2 selected counties + 1 selected city all
  contribute to the union. A line above the list ("Showing regions within:
  Fresno County, Kern County — show all") is the escape hatch, clearing
  narrowing for that type only.
- **Manager state** (`monitors-tab.svelte.ts`): per the data model above.
  `refreshCountyFill`/`refreshCalendar`/`refreshMapAverages` generalize
  from "county" to "active type's selected ids," and switch from N
  parallel per-region calls to the single bulk region-summaries call —
  the same shape of change already made for monitor summaries this
  session, applied to regions.
- **Map fill/border layers**: generalize from `manager.counties` +
  `countyFillColors` to `manager.activeRegions` (already carries boundary
  geometry from the list fetch) + the same color-map computation,
  regardless of active type.
- **Calendar**: the per-region grid built and reverted earlier this session
  comes back, now driven by `regionSelections.get(selectedRegionType)`
  instead of "all counties, always" — one calendar block per toggled
  region, sized to whatever's actually selected (typically small, since
  it's opt-in).
- **Monitor markers**: `visibleMonitors` switches from
  `countyMatches(monitor.county, region.name)` string-matching to
  `@turf/boolean-point-in-polygon` against each toggled region's
  `boundary.geometry`, using each monitor's `position`. New dependency:
  `@turf/boolean-point-in-polygon`, matching the turf sub-packages
  `monitor-map` already depends on (`@turf/area`, `@turf/clusters-dbscan`,
  `@turf/helpers`) — added to `data-dashboard` directly since this is a
  `data-dashboard`-owned concern, not something `monitor-map` needs.
- **URL state**: `regionType`/`regions` codecs added to `url-state.ts`,
  following the `encodeViews`/`decodeViews` pattern.

## `monitor-map`

No changes. Verified during research: the county-fill polygons, calendar,
and region-selection state have always lived directly in
`data-dashboard`'s `MonitorsTab.svelte`/`monitors-tab.svelte.ts`, not as a
`monitor-map` integration. The only `monitor-map`-owned piece this feature
touches is which monitors render as markers, and that's driven by
`data-dashboard`'s own `visibleMonitors` derived value feeding
`MonitorsMapIntegration`'s existing `dataSource` injection point — no change
to `monitor-map` itself is needed.

## Error handling & edge cases

- **Empty selection for the active type**: no fill polygons, no calendar
  blocks, no monitor markers — same as today's "no county selected" state,
  generalized.
- **`within=` narrowing yields zero regions** (e.g. a school district with
  no tracts intersecting it — unlikely but possible for oddly-shaped
  districts): show the "show all" escape hatch prominently rather than an
  empty list with no explanation.
- **Backend 400 from the bulk endpoints** (missing `start`/`end`, span too
  large, no `region` provided): surface as a non-fatal inline error near the
  map, not a full-page failure — consistent with how the rest of the tab
  already treats fetch failures (silently empty rather than crashing).
- **A toggled region's geometry is null** (rare, `Region.boundary` is
  nullable): skip it for map-fill/marker-matching purposes, same guard
  pattern already used in the existing county-fill code
  (`if (!county?.boundary?.geometry) return [];`).
- **Switching region type mid-fetch**: in-flight requests for the
  previously-active type should be superseded, not raced against the new
  type's fetch — follow whatever pattern (if any) the existing
  `refreshCountyFill`/`refreshCalendar` `Promise.all` calls use today; if
  none exists, this is a real gap to close as part of implementation, not
  defer.

## Testing

- **`sjvair.com`**: unit tests for `RegionList`'s `within=` filter (single
  parent, multiple parents unioned, unknown id, no geometry), and for
  `BulkRegionSummaryList` (multi-region fetch, pagination/merge boundary
  behavior, missing required params, span-too-large), following the
  existing test patterns in `camp/api/v2/regions/tests.py` and
  `camp/api/v2/summaries/tests.py`.
- **`sdk-js`**: unit tests for `getRegionsMeta`, `getRegionsList`'s `within`
  param serialization, and `getRegionSummariesBulk*` (including the
  cross-page merge), mirroring `lib/regions/mod_test.ts` and the bulk
  monitor summaries tests.
- **`data-dashboard`**: the pure logic (checkbox-list filtering, narrowing
  escape-hatch state, URL codec round-tripping, point-in-polygon monitor
  scoping) is unit-testable the same way `county-fill.ts`/`county-match.ts`
  are today. The manager class itself (`monitors-tab.svelte.ts`) has no
  existing test coverage precedent in this repo — verify manually in the
  browser, consistent with how `refreshCountyFill`/`refreshMapAverages`
  are handled today.

## Implementation sequencing / parallelization

The three repos form a dependency chain (`sjvair.com` → `sdk-js` →
`data-dashboard`) for *runtime* correctness, but the **API shapes are fully
specified above** — every endpoint's URL, params, and response shape is
pinned in this document. That means, once this spec is approved, work can
start in parallel across all three repos immediately, treating this
document as the interface contract instead of waiting for each layer to be
literally merged before the next starts:

- **Backend track** (`sjvair.com`): B1 (merge existing branch), B2
  (`within=` filter), B3 (bulk region-summaries endpoint + the forms
  refactor) are independent of each other and can be split further or done
  by one person sequentially — none blocks the others.
- **SDK track** (`sdk-js`): can be built and unit-tested against the
  *documented* response shapes from this spec without waiting for the
  backend branches to merge — the schemas are pinned above. Needs a final
  pass against the real merged backend before publishing, but the bulk of
  the work (schema types, the shared pagination-merge refactor, the meta
  wrapper class) doesn't depend on backend code existing yet.
- **Frontend track** (`data-dashboard`): the new `RegionCheckboxList.svelte`
  component, the narrowing-escape-hatch UI, the URL codecs, and the
  turf.js point-in-polygon logic are all independent of the SDK functions
  existing yet — they can be built and unit-tested standalone. The
  `monitors-tab.svelte.ts` manager rewrite (wiring everything to real SDK
  calls) is the one piece that genuinely needs the SDK track's output, and
  should be sequenced last within the frontend track, or built against a
  hand-written stub matching this spec's shapes and swapped once `sdk-js`
  publishes.

Suggested split for a implementation plan: **Backend** (B1+B2+B3 as one or
more work items), **SDK** (meta + within param + bulk regions + shared
refactor, as one or more work items, developed against this spec's pinned
shapes), **Frontend UI atoms** (checkbox list, narrowing UI, URL codecs,
point-in-polygon helper — no manager dependency), **Frontend integration**
(the manager rewrite + wiring, depends on SDK track landing). The
writing-plans skill should turn this into explicit tasks along those four
tracks.
