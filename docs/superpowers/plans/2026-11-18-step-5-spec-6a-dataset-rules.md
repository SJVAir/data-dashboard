# Step 5 spec 6a: dataset rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every widget's layers share one date range and one data resolution, Get data offers only
datasets and resolutions that line up, the Map steps by day, month or year with pesticide use on
the Map's range, and every pollutant shows the same figure in every widget.

**Architecture:** `WidgetDataConfig` holds one `resolution` (missing = Automatic). A new pure
module, `src/lib/data/dataset-rules.ts`, answers what each layer and the dataset offer, what
Automatic picks and why, and which layers don't fit. Get data, the query client, Chart, Table and
Map all call it. The query client fetches every layer at exactly that resolution (no coarser
fallback). The Map's day stops become period stops; 5b's `usePeriod` goes.

**Tech Stack:** Svelte 5 runes, TypeScript, zod (`$lib/zod`), Paraglide (`messages/en.json`),
Vitest (unit + browser mode), Playwright, `@sjvair/map-sdk` `0.1.0-beta.21`, `@sjvair/sdk`
`5.0.0-beta.14` (then `5.0.0-beta.15` for Tasks 11–13).

**Spec:** `docs/superpowers/specs/2026-11-18-step-5-spec-6a-dataset-rules-design.md`

## Global Constraints

- The rule's text, the Automatic note and every decision come from the spec; copy them exactly.
- Levels offered anywhere: `raw`, `hour`, `day`, `month`, `year` (labels "Every measurement",
  "Hourly", "Daily", "Monthly", "Yearly"). No `quarter`/`season` in any UI or Automatic choice.
  The Map offers `day`, `month`, `year` only.
- Automatic is never stored; `data.resolution` missing means Automatic.
- No compatibility code for earlier shapes (`Layer.resolution`, Map `usePeriod`, Map `day`).
  `MapOptionsSchema` stays a `z.strictObject`.
- Pins, both exact: `@sjvair/map-sdk` `0.1.0-beta.21`; `@sjvair/sdk` `5.0.0-beta.14` until Task 11
  moves it to `5.0.0-beta.15`. Nothing newer without the coordinator.
- **Tasks 11–13 are gated**: they start only when the coordinator sends the sjvair.com PR and the
  `5.0.0-beta.15` pin. Server names (settled): row fields `daily_statistic_mean`,
  `daily_statistic_days`, `daily_statistic_expected_days` (null on hourly/daily rows and types with
  no `daily_statistic`); scale keys `period_statistic`, `period_statistic_label`. Read a real local
  response before relying on them.
- Dates: Pacific (`$lib/format`), weeks start Sunday. All strings through Paraglide; no
  concatenation; never store generated English.
- Metadata is the source of truth (labels, scales, which figure, offered resolutions). Never map
  pollutants to figures in code.
- Styling from theme tokens; text on a level colour uses `readableColor`; WCAG 2.2 AA; greyed
  choices stay visible with their reason (`aria-describedby`), never hidden.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before each
  commit. Svelte 5 runes only.
- Commits GPG-signed, no AI attribution, one git command at a time. On "No passphrase given", stop
  and ask the user to unlock; never commit unsigned.
- Run vitest suites one after another, never in parallel. A browser test that fails under load:
  rerun it alone before calling it a bug.
- E2E: pin the clock at noon Pacific; also run under `TZ=America/New_York`.
- Never touch map-sdk, monitor-map, mobile, sdk-js or sjvair.com. Never print keys, passwords,
  phone numbers or coordinates. Keep heavy local work out of :40–:50 past the hour.

## Lessons from the Map sessions (apply where a task touches the Map)

- A `null` source scale draws no legend section, so `legendUnits` and `legendNote` vanish with it.
- map-sdk's hover tooltip is `role="tooltip"` with `pointer-events: none`: hover content is a
  static form; interactive only when pinned or focused (`focusedKey` / `pinned`).
- Cache card snippets per marker and form and keep cards mounted across refetches and focus moves,
  or keyboard focus drops to `<body>`.
- Test legend text through map-sdk's real Legend or an E2E, not FakeMap's snippet. Make FakeMap
  refuse what map-sdk refuses (e.g. `pin` outside a `zoomRange`).
- Scroll regions use `scrollFocusable` (`src/lib/components/shared/scroll-focusable.ts`).
- Peer messages can arrive out of order across pauses: check `git log` after a resume.

## Review Focus

1. A rolling range at Monthly across a month boundary (e.g. "Last 12 months" opened on the 1st
   before 02:15 Pacific): the current month has no row yet and must draw as no data with the
   reason, not shift the range. Pinned in Task 4 and Task 12.
2. A share link or `/import#…` carrying a mixed dataset (pesticide use with smoke, or a stored
   `resolution` a layer doesn't offer): opens, draws the main layer's resolution, notes the
   left-out layers, never rewritten. Pinned in Task 3 and Task 10.
3. Removing the last dataset that forced Automatic up (pesticide use removed from a monthly
   Automatic chart): Automatic drops back to the range's level and the note disappears. Pinned in
   Task 2 and Task 5.
4. Changing the range so the explicit resolution's point budget is exceeded while a coarse-only
   dataset is in: the resolution stays, the budget reason shows, Save is blocked, nothing swaps
   silently. Pinned in Task 5.
5. Stepping a monthly Map with the keyboard to the current month while its row is not final:
   "so far" marking, polling until final, focus stays on the stepper. Pinned in Task 8.

---

### Task 1: map-sdk `0.1.0-beta.21`

**Files:**
- Modify: `package.json`, `package-lock.json`, `CLAUDE.md` (Key Libraries row), `DEFERRED.md`
  (remove the lens-flash item, ~line 2110)

- [ ] **Step 1:** `npm install --save-exact @sjvair/map-sdk@0.1.0-beta.21`. Also run `npm ci` so
  the installed `@sjvair/sdk` matches the `5.0.0-beta.14` pin (the main checkout had beta.13 on
  disk).
- [ ] **Step 2:** `npm run check`, `npm run test:unit`, then `npm run test:browser`. Expected: all
  pass (the beta adds `GlMapLike.isSourceLoaded`, unused, and no message keys; the messages-table
  test must still pass).
- [ ] **Step 3:** Hand-check the lens with the user's dev server (`npm run dev`, a Map with
  pesticide use, hover across sections): no flash. Tell the controller the result; if it flashes,
  stop and report to the coordinator.
- [ ] **Step 4:** Remove DEFERRED's lens-flash entry; update CLAUDE.md's map-sdk row to
  `0.1.0-beta.21`.
- [ ] **Step 5:** Commit `chore: @sjvair/map-sdk 0.1.0-beta.21 (lens flash fixed)`.

### Task 2: the rules module

**Files:**
- Create: `src/lib/data/dataset-rules.ts`, `src/lib/data/dataset-rules.test.ts`
- Modify: `src/lib/data/adapters/offered.ts` (add `hms-fire`, `pesticide-notices` → `["day"]`)

**Interfaces — Produces:**

```ts
export const LEVELS = ["raw", "hour", "day", "month", "year"] as const;
export type Level = (typeof LEVELS)[number];
export const MAP_LEVELS: readonly Level[] = ["day", "month", "year"];
/** Where a layer is fetched for: monitors, regions, or none (place-less). */
export type PlaceKind = "monitors" | "regions" | "none";
/** The levels one layer offers (catalog `resolutions` ∩ `offeredLevels`, narrowed by place:
 *  regions have no raw). An air-quality entry type listing only `raw` offers every level
 *  (downsampled). Unknown dataset or entry type: []. */
export function layerOffers(layer: Layer, catalog: CatalogEntry[], place: PlaceKind): Level[];
/** Levels every layer offers, finest first, limited to `within` (default LEVELS). */
export function datasetOffers(
	layers: readonly Layer[], catalog: CatalogEntry[], place: PlaceKind, within?: readonly Level[]
): Level[];
/** The range ladder (today's `resolution.ts` ladder): ≤3 days raw, ≤7 hour, ≤365 day, else month. */
export function rangeLevel(spanDays: number): Level;
export type Effective = {
	resolution: Level;
	automatic: boolean;
	/** Set when Automatic moved above the range's level: the layer whose offer moved it. */
	movedBy?: Layer;
	/** Layers that don't offer `resolution` (only possible from untrusted input). */
	misfits: Layer[];
};
/** The dataset's resolution. Pinned types (calendars `day`, Current `hour`) use the pin.
 *  Explicit (`data.resolution`): as stored. Automatic: the finest level ≥ max(rangeLevel, floor)
 *  every layer offers. When layers share no level, the main layer (`mainLayer`; a Map's first
 *  pollutant) decides and the others are misfits. */
export function effectiveResolution(args: {
	data: WidgetDataConfig; catalog: CatalogEntry[]; place: PlaceKind; spanDays: number;
	pin?: Level; within?: readonly Level[]; floor?: Level;
}): Effective;
/** Why `layer` can't join at `level`, for the greyed reason: its finest offered level, or null. */
export function offeredFrom(layer: Layer, catalog: CatalogEntry[], place: PlaceKind): Level | null;
```

- [ ] **Step 1: Failing tests** in `dataset-rules.test.ts` against
  `src/lib/data/testing/dataset-catalog.ts`:
  - `layerOffers` — pm25 at monitors: all five; pm25 at regions: no `raw`; `hms-smoke`: `["day"]`;
    `pesticide-use`: `["month","year"]`; humidity (raw-only): all five; weather temperature: no raw.
  - `datasetOffers([pm25, pesticide-use])` → `["month","year"]`; `[pm25, smoke]` → `["day"]`
    (catalog lists smoke at day only); `[smoke, pesticide-use]` → `[]`; with `within: MAP_LEVELS`
    pm25 alone → `["day","month","year"]`.
  - `effectiveResolution` — Automatic 30-day range, pm25 → `day`, no `movedBy`; add pesticide use →
    `month`, `movedBy` = the use layer; remove it → back to `day` (Review Focus 3); explicit
    `"hour"` with smoke → `hour`, misfits `[smoke]`; pin `"day"` ignores `data.resolution`;
    Automatic with `floor: "day"` and a 2-day range → `day`; layers sharing nothing → main decides,
    others misfits.
- [ ] **Step 2:** `npx vitest run src/lib/data/dataset-rules.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Reuse `offeredLevels` and `mainLayer`; no SDK imports.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat: dataset rules module (offers, Automatic, misfits)`.

### Task 3: one stored resolution, and the query client fetches exactly it

**Files:**
- Modify: `src/lib/data/schema.ts` (add `WidgetDataConfigSchema.resolution:
  ResolutionSchema.optional()`; remove `LayerSchema.resolution`), `src/lib/data/types.ts`
  (`QueryInput`: replace `pin?` with `resolution: Resolution`), `src/lib/data/resolution.ts`
  (replace `chooseResolution` with `fetchLevel`), `src/lib/data/query/client.ts` (`choose`/`plan`),
  `src/lib/data/query/key.ts`, `src/lib/widgets/shared/overlays.ts` (`overlayInput`),
  `src/lib/widgets/shared/data-widget.svelte.ts` (overlays no longer wait for the main),
  `src/lib/get-data/layers.ts` (`keepingPlaces` no longer carries resolution),
  every other reader of `layer.resolution` (grep), and the fixtures/tests that set it.

**Interfaces:**
- Consumes: `effectiveResolution` (Task 2).
- Produces:
  - `WidgetDataConfig.resolution?: Resolution`.
  - `QueryInput.resolution: Resolution` — every caller passes the dataset's effective resolution.
  - `fetchLevel(resolution: Resolution, offered: Resolution[]): { resolution: Resolution;
    downsampleFromRaw: boolean } | null` in `resolution.ts`: the level itself when offered;
    downsampled raw when only raw is offered; otherwise `null` → the client's existing
    `no-resolution` unavailable reason. No coarser fallback.
  - `widgetInputs(widget, catalog, place): { main: QueryInput | null; overlays: (QueryInput | null)[];
    effective: Effective }` in `src/lib/widgets/shared/input.ts`: misfit overlays are `null`.

- [ ] **Step 1: Failing tests:** `resolution.test.ts` — `fetchLevel("day", ["month","year"])` →
  `null`; `fetchLevel("month", ["raw"])` → downsampled; `client.test.ts` — an overlay of pesticide
  use at `"day"` is `no-resolution`, not month; `schema.test.ts` — a layer with `resolution` parses
  with the key dropped; `data.resolution: "month"` round-trips; `input.test.ts` — a shared-link
  shaped widget (30-day range) with pm25 + smoke + pesticide use and no resolution shares no
  level, so the main decides: resolution `day`, misfits `[pesticide use]`, its overlay input
  `null`, smoke's input at `day` (Review Focus 2).
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement. Calendars and Current keep their pins through `effectiveResolution`'s
  `pin`; the Map passes `within: MAP_LEVELS, floor: "day"`. Get data's `setDetail` writes
  `draft.data.resolution` (Automatic deletes it). Fix every compile error from the removed field.
- [ ] **Step 4:** `npm run check`, `npm run test:unit`, `npm run test:browser` → PASS.
- [ ] **Step 5:** Commit `feat: one data resolution per dataset, fetched exactly`.

### Task 4: whole-period ranges

**Files:**
- Modify: `src/lib/format/range.ts` (`resolveRange`), its tests, `src/lib/format/range.test.ts`

**Interfaces — Produces:** `resolveRange(spec: DateRangeSpec, now: Date, resolution?: Resolution):
ResolvedRange` — at `month`/`year` the result is widened to whole periods (first day of the start's
period to the last day of the end's period, Pacific); a `trailing` range in months or years is the
last N calendar periods including the current one. Also `rangeWidened(spec, now, resolution):
boolean` (the resolved dates differ from the unwidened ones). Callers that pass no resolution are
unchanged.

- [ ] **Step 1: Failing tests:** custom 2026-03-15..2026-06-10 at `month` → 03-01..06-30, widened;
  `trailing 12 month` at `month` on 2026-11-18 → 2025-12-01..2026-11-30 (current month included),
  not widened; `trailing 30 day` at `month` → whole months covering it, widened; at `year`,
  2025-06-01..2026-02-01 → 2025-01-01..2026-12-31; at `day` unchanged; DST and New Year boundaries
  under `TZ=America/New_York` too. Review Focus 1: on 2026-12-01 at 01:00 Pacific, `trailing 12
  month` includes December 2026 (its row comes the next night).
- [ ] **Step 2:** `npx vitest run src/lib/format/range.test.ts` → FAIL.
- [ ] **Step 3:** Implement with the existing `periodStart` / `nextPeriodStart`. Pass the effective
  resolution at every resolve that feeds a fetch or a stop list (query client `plan`, Map stops,
  Get data's When summary).
- [ ] **Step 4:** Same, then `TZ=America/New_York npx vitest run src/lib/format/range.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: whole-period ranges at Monthly and Yearly`.

### Task 5: Get data — Data resolution and Automatic

**Files:**
- Modify: `src/lib/get-data/ShowValuesControl.svelte` → rename to `DataResolutionControl.svelte`,
  `src/lib/get-data/resolution-offer.ts` (`detailChoices`), `src/lib/get-data/GetDataView.svelte`
  (section order and notes), `messages/en.json`, the view's browser test.

**Interfaces:**
- Consumes: `effectiveResolution`, `datasetOffers`, `LEVELS` (Task 2); `rangeWidened` (Task 4).
- Produces: `resolutionChoices(args: { data, catalog, place, range, places, pin, now, within? }):
  ResolutionChoice[] | null` with `ResolutionChoice = { level: "auto" | Level; blocked:
  "too-many-points" | { notOffered: Layer } | null }` (replaces `detailChoices`/`DetailChoice`).

**Messages** (rename `get_data_show_values*` → `get_data_resolution*`, same level labels):
- `get_data_resolution`: "Data resolution"
- `get_data_resolution_help_label`: "About data resolution"
- `get_data_resolution_help`: "Each point is one value. Every layer uses the same data
  resolution, so the data lines up. Automatic picks one that suits your dates and every dataset
  you chose."
- `get_data_resolution_not_offered`: "{dataset} isn't reported {level}" (level as the lowercase
  label message, e.g. `get_data_resolution_level_hour`: "hourly" — separate keys, not a lowercased
  string)
- `get_data_resolution_auto_moved`: "Automatic data resolution is now {level}: {dataset} is
  reported {by}." — the user's wording; `{level}` the capitalised label ("Monthly"), `{by}` a per-
  level key (`get_data_resolution_by_month`: "by month", `_by_day`: "by day", `_by_year`: "by
  year").
- `get_data_range_widened`: "Monthly data covers whole months: showing {start} to {end}." and
  `get_data_range_widened_year`: "Yearly data covers whole years: showing {start} to {end}."
  (dates via `format`).

- [ ] **Step 1: Failing tests** (`resolution-offer.test.ts`, `get-data-view.browser.test.ts`):
  - choices for pm25 + pesticide use: `raw`/`hour`/`day` blocked `{ notOffered: use layer }`,
    `month`/`year` open; the point budget still blocks (Review Focus 4: explicit `hour`, range grown
    past the budget → stays `hour`, blocked too-many-points, Save blocked).
  - the view: heading "Data resolution" is its own section after What (not inside "More options");
    the threshold line control is under "More options"; adding pesticide use on Automatic shows
    "Automatic data resolution is now Monthly: Pesticide use is reported by month."; removing it
    clears the note (Review Focus 3); a widened custom range shows the widened note with dates.
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3:** Implement; dataset names come from the catalog labels.
- [ ] **Step 4:** Run both → PASS; `npm run check`.
- [ ] **Step 5:** Commit `feat: Get data's Data resolution, Automatic notes and reasons`.

### Task 6: Get data — datasets and visualizations that don't line up

**Files:**
- Modify: `src/lib/get-data/WhatSections.svelte`, `src/lib/get-data/MapSections.svelte`,
  `src/lib/get-data/offer.ts` (`TypeBlock` gains `"resolution"`), `src/lib/get-data/ShowAs.svelte`,
  `src/lib/get-data/ActionBar.svelte` + `GetDataView.svelte` (blocked while `misfits.length > 0`),
  `src/lib/get-data/WhenControl.svelte` (whole-period pickers), messages, tests.

**Interfaces:** Consumes `layerOffers`, `offeredFrom`, `effectiveResolution` (Task 2),
`resolveRange(…, resolution)` (Task 4).

**Messages:** `get_data_dataset_not_offered`: "Reported {by}. Set the data resolution to {level}
to add it." (with an Automatic variant needing no note: on Automatic a dataset is greyed only when
it shares no level: `get_data_dataset_no_common`: "Can't line up with the datasets you chose: it's
reported {by}."); `get_data_type_resolution`: "{type} can't show {level} data."; Map:
`get_data_map_resolution`: "Maps show daily, monthly or yearly data."

- [ ] **Step 1: Failing tests:** explicit Daily greys "Pesticide use" with "Reported by month. Set
  the data resolution to Monthly to add it."; explicit Hourly greys smoke ("Reported by day…");
  Automatic greys nothing that shares a level; Show as greys the Map at Hourly; a draft carrying a
  misfit (untrusted) blocks Add with the reason; at Monthly the custom range picker picks months
  and stores first/last days.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Reasons via `aria-describedby`, items never hidden.
- [ ] **Step 4:** Run → PASS; `npm run check`.
- [ ] **Step 5:** Commit `feat: Get data greys out datasets and types that don't line up`.

### Task 7: Chart and Table draw one resolution

**Files:**
- Modify: `src/lib/widgets/chart/ChartWidget.svelte` (drop `wholePeriod`), `src/lib/charts/strips.ts`,
  `src/lib/charts/time-chart.ts`, `src/lib/charts/TimeChart.svelte` (remove the whole-period bar
  path), `src/lib/widgets/table/rows.ts` (drop `whole`, `pointAt` repeat, `byDay` gate),
  `src/lib/widgets/table/DataTable.svelte`, the misfit note in both widgets, messages, tests.

**Messages:** `widget_layer_not_lined_up`: "{dataset} isn't shown: it isn't reported {level}.
Change the data resolution in Edit data."

- [ ] **Step 1: Failing tests:** monthly chart with pm25 + use draws plain monthly bars (no strip
  span logic); a daily chart from an untrusted doc with use draws without it and shows the note;
  smoke day bands only at Daily; table rows: one per period, no repeated monthly value.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; delete code paths that only served mismatched resolutions.
- [ ] **Step 4:** Run → PASS; CSV test still passes.
- [ ] **Step 5:** Commit `feat: Chart and Table draw every layer at the dataset's resolution`.

### Task 8: the Map steps by period

**Files:**
- Modify: `src/lib/widgets/map/options.ts` (`day` → `at`, same date-key regex; remove `usePeriod`;
  `MAP_MAX_DAYS` → `MAP_MAX_STOPS = 366`), `src/lib/widgets/map/index.ts` (drop `resolution: "day"`;
  span check counts stops), `src/lib/widgets/map/days.ts` (`dayStops` → `periodStops`),
  `day-mode.svelte.ts`, `DayStepper.svelte`, `marks.ts` (`HiddenReason` `"day"` → `"period"`),
  `get-data/map.ts` (`mapRange` cuts by stops), `get-data/date-presets.ts` (`blockedBySpan` gets the
  resolution), messages, tests, `e2e/map.spec.ts`.

**Interfaces — Produces:** `type Stop = { at: string } | "now"`; `periodStops(range: DateRangeSpec,
resolution: Level, today: string): Stop[]` (each period's Pacific start key, then `"now"` only at
`day` when the range includes today; at `month`/`year` the current period is the last stop, marked
"so far"); `stopLabel(stop, resolution): string` via `format`.

- [ ] **Step 1: Failing tests:** `periodStops` for Mar–Jun 2026 monthly → four stops `2026-03-01…`;
  yearly 2024–2026 → three; daily unchanged; a monthly Map spanning 30 months is allowed (stops,
  not days); a stepper browser test stepping by month with the keyboard keeps focus on the stepper
  and labels the current month "so far" (Review Focus 5); hidden-marks "no figure for this
  period".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Fixtures and E2E that set `day` or `usePeriod` are updated to `at` or
  dropped (grep `src`, `e2e`, starter and sample documents, stack-suite seeds).
- [ ] **Step 4:** Run → PASS; `npm run check`; `npm run test:e2e -- e2e/map.spec.ts`.
- [ ] **Step 5:** Commit `feat: the Map steps by day, month or year`.

### Task 9: the Map's layers follow its resolution

**Files:**
- Modify: `src/lib/widgets/map/MapWidget.svelte` (use query from the stop),
  `src/lib/widgets/map/data/use-block.svelte.ts`, `src/lib/widgets/map/data/use.ts` (period from the
  stop's start key and resolution), `src/lib/widgets/map/use-period.ts` (keep only what the stop
  needs, or delete), `src/lib/widgets/map/toolbar/{values,toolbar.svelte,wiring.svelte}.ts`
  (remove the period selects; hide rows for layers the resolution doesn't offer), `get-data/map.ts`
  (remove `periodFromRange`, `periodOverlaps`, the `"use-period"` note, `setUse`'s period),
  delete `get-data/UsePeriodPicker.svelte`, `get-data/MapSections.svelte`, `GetDataView.svelte`
  (`setMapUsePeriod`), `layers/HmsLayers.svelte`, `layers/NoticesLayer.svelte`, `MapNotes.svelte`,
  messages, tests.

**Interfaces:** Consumes `effectiveResolution(…, within: MAP_LEVELS, floor: "day")` (Task 2),
`periodStops` (Task 8). On Now, pesticide use is a misfit.

**Messages:** `map_layer_not_lined_up`: "{dataset} isn't shown at this data resolution. Change it
in Edit data."; `map_use_none_yet`: "No pesticide use reported for {period} yet."

- [ ] **Step 1: Failing tests:** a monthly Map with use asks `use.ts` for the stop's month; stepping
  changes it; yearly asks the year; a daily Map from an untrusted doc with use draws no use and
  shows the note; on Now the same; smoke, fire and notices draw only at Daily, and their toolbar
  rows are hidden otherwise; no `usePeriod` anywhere (`grep -rn usePeriod src` empty).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Township/section cards, lens and filters unchanged.
- [ ] **Step 4:** Run unit, then browser suites → PASS; `npm run check`.
- [ ] **Step 5:** Commit `feat: the Map's layers follow its range and resolution`.

### Task 10: untrusted mixed datasets and fixtures sweep

**Files:** tests only, plus any fixture still carrying old keys.

- [ ] **Step 1:** Add `src/lib/documents/mixed-dataset.browser.test.ts`: a document (as a share link
  would carry) with a Chart of pm25 + smoke + pesticide use and `resolution: "hour"`, and a Map with
  use on at Daily, opens without errors, draws the main layer, shows both notes, and its stored
  document is byte-identical after opening (Review Focus 2).
- [ ] **Step 2:** `grep -rn "usePeriod\|\"day\":\|resolution:" e2e src/lib/**/testing src/lib/starter
  src/lib/**/fixtures*` and fix each hit that the new schemas refuse or ignore.
- [ ] **Step 3:** Full `npm run test:unit`, `npm run test:browser`, `npm run test:e2e` → PASS.
- [ ] **Step 4:** Commit `test: mixed datasets from untrusted input; fixtures on the new shapes`.

### Task 11 (gated on `@sjvair/sdk` `5.0.0-beta.15`): one figure per pollutant everywhere

**Files:**
- Modify: `package.json` (pin `5.0.0-beta.15`), `src/lib/data/metadata.ts` (`dailyFigure` →
  `figure(entryType, resolution, signal)`), `src/lib/data/types.ts` (`QueryInput.dailyFigure` →
  `figure?: string`, honored at `day`, `month`, `year`), `src/lib/data/adapters/air-quality.ts`,
  `src/lib/data/query/key.ts`, `src/lib/widgets/shared/input.ts` (always pass the figure),
  `src/lib/widgets/calendars/shared/calendar-data.svelte.ts`, `src/lib/data/csv.ts`, the Chart's
  series names and the Table's header, tests and fixtures (add the new fields).

**Interfaces — Produces:** `MetadataSource.figure(entryType: string, resolution: Level, signal?):
Promise<{ field: string; label: string | null } | null>` — `day`: `scale.daily_statistic` /
`daily_statistic_label`; `month`/`year`: `scale.period_statistic` / `period_statistic_label`;
`raw`/`hour`, or no scale field: `null` (the plain mean). Points' value is the figure's field when
set; null is "Not enough data".

- [ ] **Step 1:** Read a real local `monitors/meta/` and a monthly summary response; record the
  exact field shapes in the test fixtures.
- [ ] **Step 2: Failing tests:** daily ozone chart values come from `max_1h`, labelled with
  `daily_statistic_label`; monthly pm25 from `daily_statistic_mean`, labelled with
  `period_statistic_label`; weather plain mean at every level; CSV column carries the label; a null
  monthly figure is "Not enough data".
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run unit then browser → PASS.
- [ ] **Step 6:** Commit `feat: one figure per pollutant in every widget (sdk 5.0.0-beta.15)`.

### Task 12 (gated): monthly and yearly monitors and fills on the Map

**Files:** `src/lib/data/snapshot/monitors.ts`, `src/lib/data/snapshot/regions.ts`,
`src/lib/widgets/map/data/monitors.ts`, `data/fill.ts`, `daily-figure.svelte.ts` (→ the period's
figure via `metadata.figure`), the legend's figure name, tests.

- [ ] **Step 1: Failing tests:** a monthly stop reads `getMonitorSummariesBulkMonthly` (and the
  regions bulk monthly) for that month, colours by `daily_statistic_mean` on the daily scale, the
  legend names `period_statistic_label`; a null figure draws as no data with "fewer than 75% of
  days had a figure"; the current month polls while `is_final` is false; a month with no row yet
  (on the 1st before 02:15 Pacific) is no data with the usual reason (Review Focus 1).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: monthly and yearly air quality on the Map`.

### Task 13 (gated): coarse rows from the server only

**Files:** `src/lib/data/periods.ts` (`planSegments`), `src/lib/data/adapters/air-quality.ts`
(`summarySeries`), tests.

- [ ] **Step 1: Failing tests:** a monthly series over a range including the current month makes
  only monthly requests (no daily/hourly fill), and includes the nightly not-final row; daily and
  finer still fill today from `daily/open/` (unchanged).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Remove the coarse open/just-ended fill only.
  **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: coarse summaries from the server's stored rows`.

### Task 14: docs

**Files:** `ARCHITECTURE.md` (new section "Datasets line up (dashboard only)" with the spec's exact
rule text, plus updates to "Widget data selection", "Map SDK" → the Map's days and pesticide use,
the calendars' figure), `CLAUDE.md` (one line under "Platform & auth rules" pointing to it),
`DEFERRED.md` (the spec's Deferrals list: weekly; Quarterly/Seasonal; comparing two datasets,
replacing "Year-over-year change on the map"; an hourly Map; smoke/fire/notices by month; the plain
average option — each with why and revisit trigger; remove entries settled here), `TODO.md` ("Start
here" step 5 list: 6a dataset rules, 6b Show in a chart/table, then schools), `ROADMAP.md` (step 5
list). The spec's post-approval calls section.

- [ ] **Step 1:** Write them. **Step 2:** `npm run lint`. **Step 3:** Commit `docs: spec 6a`.

## After the tasks

Final whole-branch review and its one fix wave; `npm run build`, `npm run check:build`,
`npm run check:budget` (report the number; budget 250 KB, soft); merge `origin/step-5`; push; open
the PR into `step-5`; tell the coordinator so it holds TODO pushes; ask the user before merging.
