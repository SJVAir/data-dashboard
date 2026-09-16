# Monitors Tab — Month Picker & County Choropleth

## Purpose

Replace the Monitors tab's free-form date-range picker with a year/month
selector, and replace the selected-county border outline with a
semi-transparent county fill colored by that county's (or, when no county
is selected, every county's) monthly average level. Both changes exist to
solve the same underlying problem: the tab currently mixes summary
resolutions (daily map averages, always-daily calendar data, and an
occasional monthly map average for wide ranges) that don't represent the
same averaging window. Pinning the tab to exactly one calendar month lets
every number on screen — map icons, county fills, and the calendar's
day-level detail — come from data covering that same month.

This spec builds on `docs/superpowers/specs/2026-09-15-monitors-tab-design.md`
(the original Monitors tab spec) and the region `bbox` work in
`docs/superpowers/specs/2026-09-15-monitors-tab-design.md`'s follow-on PRs.
It does not revisit anything from those specs except where explicitly noted
below.

## Decisions from brainstorming

- **Calendar stays**, scoped to exactly the picked month, still always at
  daily resolution, still only for the selected county — no change to its
  own logic, only to what range it's ever called with.
- **Monitor markers stay** on the map, colored by their own monthly
  average, same as today (just always monthly now instead of
  daily-or-monthly).
- **Monitor filtering by county stays** exactly as today: selecting a
  county narrows the visible monitor markers to that county's roster.
- **County fill behavior differs by selection state**:
  - No county selected ("All counties"): **every** county gets a
    semi-transparent fill colored by its own monthly average level.
  - A county selected: **only that county** gets the fill; other counties
    show no fill. This also means county-summary fetches only ever cover
    either "all counties" or "the one selected county" — never a partial
    subset — so no new pagination/batching concerns beyond what
    `getRegionsList`/`getRegionSummariesMonthly` already handle per-region.
- **Picker UI**: two shadcn `Select`s — Year (current year + 4 prior, 5
  total) and Month (January–December) — replacing the two date
  `<input type="date">` elements.
- **Month persistence**: the last-selected year/month is remembered in
  `preferences.ts` (replacing today's `dateRange` preference), the same way
  today's date range is — a fresh visit with no URL params reopens on the
  last-selected month, not necessarily the current one.

## Data sources

Fetched once and cached, unchanged from the existing spec: monitor roster
(`getMonitorsList`), meta/levels (`getMonitorsMeta`), county list
(`getRegionsList({ type: "county" })`).

Fetched reactively, keyed on `(year, month, pollutant)` or
`(year, month, pollutant, countyId)`:

- **Map per-monitor averages**: for each visible monitor, exactly one
  `getMonitorSummariesMonthly({ monitorId, entryType, year })` call per
  monitor (already returns the whole year; filtered client-side to the
  selected month's row — the existing multi-year-loop fix from the prior
  pass collapses to at most one year now, since a single month can't span a
  year boundary). No daily fallback — the resolution threshold
  (`summary-resolution.ts`) is removed entirely.
- **County fill data** (new): `getRegionSummariesMonthly({ regionId,
  entryType, year })` — one call per county when "all counties" fill is
  active (up to 8 concurrent calls, same pattern as the existing
  per-monitor fan-out), or one call for just the selected county's region
  when a county is selected. Each county's fill color comes from bucketing
  its monthly mean through the same `getCurrentLevel`/`levels` used
  elsewhere (`src/lib/calendar.ts`'s existing `getCurrentLevel`), so a
  county's fill and a monitor's icon always agree on what "moderate" or
  "unhealthy" looks like for the same pollutant.
- **Calendar data**: unchanged — `getRegionSummariesDaily` for the selected
  county, now always called with a range equal to exactly the picked
  month's first/last day (previously could be any arbitrary range).

## Picker UI & state

Two new `Select`s in `MonitorsTab.svelte`, replacing the Start/End date
`<input>`s:

- **Year**: options are `[currentYear, currentYear-1, ..., currentYear-4]`
  (5 entries, descending).
- **Month**: options are the 12 calendar months (`January`–`December`),
  mapped to `1`–`12`.

Selecting either recomputes `{ start, end }` as the first and last day of
that year/month (`date-fns`'s `startOfMonth`/`endOfMonth` on a
constructed `Date`, formatted the same `yyyy-MM-dd` way the manager
already expects) and writes it into `manager.dateRange`, so the manager's
existing `refreshMapAverages()`/`refreshCalendar()` methods don't need to
know a month picker exists — they still just see a `{ start, end }` range,
now always exactly one month wide.

**URL state**: two new params, `year` (number) and `month` (1–12), with
codecs in `url-state.ts` following the existing `encode*/decode*` pattern.
The existing `range` param is removed (superseded by `year`/`month`); no
migration path for old bookmarked `range` URLs is provided (out of scope —
this is a pre-release tab with no external users yet).

**Preferences**: `TabPreferences.dateRange` is replaced with
`TabPreferences.month: { year: number; month: number }`. `onMount` seeds
from the URL if present, else from preferences, else from the current
real-world year/month (`new Date()`).

## Removed code

- `src/lib/monitors/summary-resolution.ts` and its test — the
  daily/monthly threshold has no case left to trigger (every range is
  exactly one month, so the map always requests monthly summaries).
- The date-range clamping/normalization logic in `handleDateRangeChange`
  (`MAX_CALENDAR_DAYS` span cap, reversed-range swap) — a year/month picker
  cannot produce an invalid or oversized range, so there is nothing left to
  clamp. `MAX_CALENDAR_DAYS` itself stays exported from `calendar.ts` only
  if `buildCalendarDays`'s own defensive cap (guarding against a
  maliciously/accidentally huge URL-supplied range reaching the calendar
  directly) is still considered worth keeping — it is, since the calendar
  component is meant to be reusable beyond this tab and shouldn't assume
  its caller always constrains the range the way this tab now does.
- The blue county-border source/layer (`selected-county-boundary`,
  `selected-county-boundary-line`) in `MonitorsTab.svelte`, replaced by the
  new fill layer(s) described above.

## County fill rendering

A new `fill` layer (`county-fill`) sourced from a `FeatureCollection` built
from each relevant county's `boundary.geometry`, with each `Feature`
carrying a `color` property set to that county's bucketed level color (or
omitted/transparent if the county's monthly summary has no data yet — same
"no data" handling as the calendar's gray cells). `fill-opacity` around
`0.35`–`0.4` (semi-transparent, so monitor markers and place labels
underneath/above remain legible) using a MapLibre `["get", "color"]`
data-driven paint expression, following the same `mapManager.map.addSource`
/ `addLayer` / `mapManager.setDataSource(...)` pattern already used for the
(now-removed) border layer.

## Out of scope for this pass

- Any change to which pollutants are selectable (still pm25/o3 only).
- Any change to `sdk-js`, `monitor-map`, or the `sjvair.com` backend.
- Migrating old `?range=...` bookmarked URLs to the new `year`/`month`
  params.
- The map-camera zoom-precision issue (globe projection under-zooming for
  large counties) — noted as still open, unaffected by this pass.
