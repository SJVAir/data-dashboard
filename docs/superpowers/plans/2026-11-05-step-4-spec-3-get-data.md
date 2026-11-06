# Step 4 spec 3: Get data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Get data view (top nav "Data"): pick layers, places and a date range, see a live
Chart or Table preview with a burn-status / AQI-forecast overlay, then Add to dashboard, Download
CSV, or (from a widget) Save changes.

**Architecture:** A lazily loaded route renders a draft `WidgetDataConfig` + widget type through
the real widget components in a view-only frame. Overlays are extra layers that borrow the main
layer's places; a new forecasts adapter feeds them through the existing query client. Adds and
edits go through `DocumentSession.apply` (one undo step, spec 2's privacy guard).

**Tech Stack:** Svelte 5 runes, TypeScript, sv-router, bits-ui/shadcn-svelte, Tailwind v4,
Paraglide, zod, uPlot (Chart), Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-step-4-spec-3-get-data-design.md` (approved
2026-11-05). Read it before any task; this plan argues from it.

## Global Constraints

- Branch `step-4-spec-3`; PR into `step-4`; never merge without the user's yes. No releases.
- No Claude/AI attribution in commits, PRs or docs.
- `@sjvair/sdk` pinned exactly: `"npm:@jsr/sjvair__sdk@5.0.0-beta.4"`.
- Metadata is the source of truth: dataset/entry labels, units, levels, colors, region type names
  from `…/meta/`; never hardcoded.
- All UI text via Paraglide (`src/lib/paraglide/messages`), no concatenated sentences; formatting
  via `$lib/format` in Pacific time; weeks start Sunday; never store generated English.
- New saved fields schema-validated with size limits; drafts are untrusted input.
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`); shadcn-svelte primitives.
- Browser storage only through the platform adapter.
- WCAG 2.2 AA, recognized patterns, full keyboard, changes announced, never color alone.
- Get data code never in the initial bundle (197.5 KB gzip today, soft budget 200; run
  `npm run build && npm run check:budget`). Barrel-imported lazy-only packages → `BARRELED` in
  `vite.config.ts`.
- Coordinates never in URLs, logs or error reports.
- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- Browser tests: `animationsSettled(el)` from `src/test/animations.ts`; `page.viewport(1280, 800)`
  for desktop. Time-sensitive code: also `npm run test:unit:tz`. CI isn't Pacific: match formatted
  times with an optional " PT".
- Don't work around the SDK or server: gaps go to the coordinator (`data-dashboard-b7`).

## Review Focus

1. **A saved widget from before this spec** (Chart/Table with one layer, no `accepts.datasets`
   match, no `options`) opens in Edit data unchanged and Save-without-changes is a no-op — Task 11.
2. **Overlay places disagree after "Change place"** (the widget's places move to another county,
   so the saved `options.overlayFor` is no longer among them): the Chart falls back to the first
   place and never throws — Task 6.
3. **The forecasts endpoint 404s for a place** ("No such region", or a monitor outside every
   zone): the overlay shows its own unavailable note while the main layer still renders — Task 5.
4. **A draft in storage from an older shape or tampered** (bad entry type, 50 layers, a point with
   lat 999): dropped for the default, no crash — Task 8.
5. **Leaving Edit data mid-change via a nav link or browser Back** (not just Cancel): the Discard
   dialog appears and "Keep editing" stays on the page — Task 11.

---

### Task 1: SDK beta.4 and region display names

**Files:**

- Modify: `package.json` (`@sjvair/sdk` → `npm:@jsr/sjvair__sdk@5.0.0-beta.4`), `package-lock.json`
- Modify: `src/lib/data/adapters/registry.ts` (`createWebRegionResolver`: `ResolvedRegion.name`)
- Modify: `src/lib/places/directory.ts` (search and browse row names)
- Modify: every `regions/meta` fixture: `grep -rln "regions/meta\|types\":" e2e/fixtures src --include='*.json' --include='*.ts'`
- Test: `src/lib/data/adapters/registry.test.ts`, `src/lib/places/directory.test.ts`

**Interfaces:**

- Consumes: `regionDisplayName(region: { type; name }, meta: Pick<RegionsMetaData, "types">): string`
  from `@sjvair/sdk/regions` (fills `name_template`, else returns `name`).
- Produces: region names everywhere already display-ready ("ZIP 93702"); `placeLabel`
  (`src/lib/widgets/title.ts`) is unchanged and keeps working from `PlaceInfo.name`.

- [ ] **Step 1:** `npm install "@sjvair/sdk@npm:@jsr/sjvair__sdk@5.0.0-beta.4" --save-exact`; confirm
      `package.json` reads exactly `"npm:@jsr/sjvair__sdk@5.0.0-beta.4"`. Run `npm run check`; fix
      fixtures that now fail the SDK schema by adding `name_template` per type (zipcode
      `"ZIP {name}"`, tract `"Census Tract {name}"`, urban_area `"{name} Urban Area"`, ab617
      `"{name} AB 617 Community"`, all others `null`).
- [ ] **Step 2: Failing tests.** In `registry.test.ts`: `"a ZIP resolves with its display name"` —
      resolver for `zipcode:93702` returns `name === "ZIP 93702"`; `"a county keeps its plain name"`
      → `"Fresno County"`. In `directory.test.ts`: a ZIP search row's label is `"ZIP 93702"`.
- [ ] **Step 3:** Run `npx vitest run --project unit src/lib/data/adapters/registry.test.ts src/lib/places/directory.test.ts` → FAIL.
- [ ] **Step 4:** Apply `regionDisplayName(row, regionsMeta)` where the resolver and directory map
      server rows to names (regions meta is already loaded there for `label_plural`; reuse that load).
- [ ] **Step 5:** Run `npm run test` and `npm run test:e2e` → PASS (update expected names in existing
      tests from `"93702"` to `"ZIP 93702"` where they assert a ZIP name).
- [ ] **Step 6:** Commit `feat: pin SDK 5.0.0-beta.4 and show region display names`. Tell the
      coordinator beta.4 is pinned.

### Task 2: Routes, nav entry, and the error-report route list

**Files:**

- Modify: `src/router.ts`, `src/lib/errors/scrub.ts` (`routePattern`), `src/lib/components/shell/TopNav.svelte`
- Create: `src/routes/GetData.svelte` (shell: heading only for now), `src/routes/get-data.browser.test.ts`
- Test: `src/lib/errors/scrub.test.ts`
- Modify: `messages/en.json` (`nav_data`: "Data", `get_data_heading`: "Get data", `edit_data_heading`: "Edit data")

**Interfaces:**

- Produces: routes `"/data"`, `"/dashboards/:id/widgets/new"`, `"/dashboards/:id/widgets/:widgetId/edit"`,
  each `() => import("./routes/GetData.svelte")`; `"/dashboards/:id/widgets"` →
  redirects to `/dashboards/:id`. `GetData.svelte` reads `route.params` and decides its mode:
  `{ kind: "new"; dashboardId?: string } | { kind: "edit"; dashboardId: string; widgetId: string }`
  (export the type as `GetDataMode` from `src/lib/get-data/mode.ts`).
- Produces: `ROUTE_KEYS: string[]` exported from `src/router.ts` (the route table's keys, minus
  hooks and `"*"`), used by the scrub test.

- [ ] **Step 1: Failing tests.** `scrub.test.ts`: `"routePattern covers every router route"` — for
      each key in `ROUTE_KEYS`, substituting `:param` with `abc`, `routePattern(BASE + path)` equals
      the key (dev-only `/dev/data` excluded). Plus `routePattern("/workspace/dashboards/x/widgets/y/edit") === "/dashboards/:id/widgets/:widgetId/edit"`.
      `get-data.browser.test.ts`: at `/workspace/data` the heading "Get data" is focused-on-arrival
      target and the nav link "Data" has `aria-current="page"`.
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3:** Implement routes, `ROUTE_KEYS`, `routePattern` cases, nav link (same classes as
      "Dashboards").
- [ ] **Step 4:** Run tests; `npm run build && npm run check:budget` → `GetData` is its own chunk,
      initial bundle not grown by more than the nav link's strings.
- [ ] **Step 5:** Remove the DEFERRED entry "The error reports' route list duplicates the router's"
      (record under the spec's "Settled"). Commit `feat: Get data routes and nav entry`.

### Task 3: Date presets

**Files:**

- Create: `src/lib/get-data/date-presets.ts`, `src/lib/get-data/date-presets.test.ts`
- Modify: `messages/en.json`

**Interfaces:**

- Consumes: `DateRangeSpec` (`src/lib/data/schema.ts`), `WidgetType.dateMethods`/`span`, `$lib/format`.
- Produces:
  ```ts
  type PresetGroup = "last" | "to-date" | "specific" | "custom";
  type Preset = { id: string; group: PresetGroup; label: () => string; spec?: DateRangeSpec;
                  needs?: "day" | "week" | "month" | "year" | "range" };
  function presetsFor(type: Pick<WidgetType, "dateMethods" | "span">, now: Date): Preset[];
  function presetIdFor(spec: DateRangeSpec): string;   // "last-30-day", "to-date-month", "set-month", "custom"
  function blockedBySpan(spec: DateRangeSpec, span: WidgetType["span"], now: Date): "too-short" | "too-long" | null;
  ```
  Ids: `last-24-hour`, `last-3-day`, `last-7-day`, `last-30-day`, `last-90-day`, `last-12-month`,
  `to-date-week|month|year`, `set-day|week|month|year`, `custom`. `last-3-day` is listed only if
  the type's `span.maxDays` ≤ 7 (my call in the spec: "where a type wants it").

- [ ] **Step 1: Failing tests:** `"Last 30 days maps to trailing 30 day"`;
      `"presetIdFor round-trips every preset spec"`; `"a type without 'trailing' hides the Last group"`;
      `"span maxDays 31 blocks last-90-day as too-long"`; `"set-week starts on Sunday in Pacific time"`
      (2026-11-05 → week start `2026-11-01`).
- [ ] **Step 2:** Run `npx vitest run --project unit src/lib/get-data` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `npm run test:unit:tz` (add `src/lib/get-data` to that script's paths) → PASS.
- [ ] **Step 5:** Commit `feat: Get data date presets`.

### Task 4: Which datasets and types are offered; explicit `accepts.datasets`

**Files:**

- Modify: `src/lib/widgets/registry.ts` (drop `addable`; add `dataTypes(): WidgetType[]` — types
  with any `accepts.datasets`), `src/lib/widgets/chart/index.ts`, `src/lib/widgets/table/index.ts`
  (`accepts.datasets: ["air-quality", "forecasts"]`, remove `addable`)
- Modify: `src/lib/data/index.ts` (export `adapterIds(): string[]`)
- Create: `src/lib/get-data/offer.ts`, `src/lib/get-data/offer.test.ts`
- Modify: `src/lib/actions/dashboard.ts`, `src/lib/components/dashboard/AddWidgetButton.svelte`
  (data types navigate to `/dashboards/:id/widgets/new?type=<type>`; non-data types still
  `addWidget`), `src/lib/widgets/registry.test.ts`

**Interfaces:**

- Produces:
  ```ts
  type OfferedDataset = { dataset: CatalogEntry; entryTypes: EntryTypeMeta[] };
  function offeredDatasets(catalog: CatalogEntry[], adapters: string[], types: WidgetType[]): OfferedDataset[];
  type TypeBlock = "dataset" | "places" | "span" | "pollutants";
  function typeBlock(type: WidgetType, data: WidgetDataConfig, catalog: CatalogEntry[], now: Date): TypeBlock | null;
  ```
  `offeredDatasets` keeps catalog order; drops datasets with no adapter or no accepting type;
  drops entry types with `retired` or `available === false` (spec: not offered for new picks).
  A type with no `accepts.datasets` accepts nothing.
- Produces: `addWidget(app, type)` unchanged for non-data types; `startGetData(app, type)` in
  `src/lib/actions/dashboard.ts` navigates to the new-widget route (starter: `id = "starter"`).

- [ ] **Step 1: Failing tests:** `"forecasts appears only once an adapter exists"`;
      `"hms-smoke is not offered"`; `"an unavailable entry type is left out"`;
      `"typeBlock: 7 places blocks Chart (places), not Data table"`;
      `"Add widget's Chart item opens Get data for this dashboard"` (registry/actions test asserting
      the navigate call).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run `npm run test` → PASS.
- [ ] **Step 5:** Commit `feat: catalog-driven dataset offer and Add widget opens Get data`.

### Task 5: Forecasts adapter, category points, and dataset levels

**Files:**

- Create: `src/lib/data/adapters/forecasts.ts`, `src/lib/data/adapters/forecasts.test.ts`
- Modify: `src/lib/data/types.ts` (`SeriesPoint.level?: string`), `src/lib/data/metadata.ts`
  (`Level.value?: string`; `MetadataSource.datasetLevels(dataset: string, entryType: string, signal?): Promise<Level[]>`,
  reading `forecasts/meta/` scales via the SDK's `getForecastsMeta` when `dataset === "forecasts"`,
  delegating to `levels()` otherwise), `src/lib/data/index.ts` (register `forecastsAdapter`)
- Create: `src/lib/data/testing/forecasts-fixtures.ts` (from the local `forecasts/place/` response shape)

**Interfaces:**

- Consumes: SDK `getForecastForPlace(place, { gte, lte })`; `DatasetAdapter` (`registry.ts:72`).
- Produces: `forecastsAdapter: DatasetAdapter` (`id: "forecasts"`). `target()` accepts monitors and
  regions (fallback targets: the resolved region key); one series per place. `offered()` returns
  `["day"]`. `fetch()` returns `QueryData` whose points are one per Pacific `forecast_date`, latest
  issue, with: `aqi-forecast` → `mean = min = max = aqi_value`, `level` = the matching scale level's
  key; `burn-status` → `mean = min = max = NaN`, `level` = the level whose `value` equals
  `burn_status` (no match → point omitted). `count = 1`, `partial = false`.
- Server 404 ("No such region") → `{ unavailable: "not-found" }` (reuse an existing
  `UnavailableReason`; add one only if none fits).

- [ ] **Step 1: Failing tests:** `"burn status maps to the scale level by value"`;
      `"the latest issue per date wins"`; `"a ZIP target asks for that region"`;
      `"404 is unavailable, not an error"`; `"datasetLevels reads forecasts scales"` (labels
      "Burning Discouraged", "No Burning Unless Registered" come from the fixture, not code).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm run test:unit && npm run test:unit:tz` → PASS.
- [ ] **Step 5:** Commit `feat: forecasts adapter for burn status and AQI forecast overlays`.

### Task 6: Overlays in the data widgets (Chart day bands, Table columns)

**Files:**

- Modify: `src/lib/widgets/shared/input.ts`, `src/lib/widgets/shared/data-widget.svelte.ts`,
  `src/lib/widgets/chart/ChartWidget.svelte` (+ its band drawing), `src/lib/widgets/table/rows.ts`,
  `src/lib/widgets/table/DataTable.svelte`
- Create: `src/lib/widgets/shared/overlays.ts`, `src/lib/widgets/shared/overlays.test.ts`
- Test: `src/lib/widgets/chart/chart-widget.browser.test.ts`, `src/lib/widgets/table/rows.test.ts`,
  `src/lib/widgets/table/data-table.browser.test.ts`

**Interfaces:**

- Produces (in `overlays.ts`):
  ```ts
  const MAX_OVERLAYS = 2;
  function overlayLayers(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): Layer[]; // non-main layers, ≤ MAX_OVERLAYS
  function overlayInput(main: QueryInput, overlay: Layer): QueryInput; // overlay with main's place/selection, same range
  const ChartOptionsSchema = z.object({ overlayFor: PlaceRefSchema.optional() });
  function overlayPlaceFor(options: unknown, places: PlaceInfo[], picks: Picks): string; // a PlaceInfo.place key
  function sharedSource(series: Series[]): boolean; // all places' overlay series identical day by day
  ```
  Overlay layers store no `place`/`selection`; `overlayInput` copies the main's. `overlayPlaceFor`
  parses `widget.options` with `ChartOptionsSchema` (invalid → ignored) and falls back to the first
  place when the saved one isn't among the widget's places.
- `DataWidget` gains `overlays: { layer: Layer; meta; levels: Level[]; state: QueryState }[]`
  (one `LiveQuery` each; an overlay's error/unavailable never changes `shown`).
- Chart: labeled day bands behind the line for the chosen place's overlay, a legend row naming it
  ("No-burn days in Fresno County" — message with `{place}`), swatches outlined, a pattern per
  level, band label on hover and on keyboard focus of the legend item. With places that differ
  (`!sharedSource`), the legend names the followed place.
- Table: one column per place per overlay layer, cell text = the level's label (never color alone).

- [ ] **Step 1: Failing tests:** `overlays.test.ts`: `"overlay borrows the main layer's selection"`;
      `"a third overlay is ignored"`; `"overlayFor not among places falls back to the first"`;
      `"invalid options are ignored"`; `"sharedSource true for identical zone series"`.
      `rows.test.ts`: `"overlay adds a labeled column per place"`. Chart browser test:
      `"burn-status bands render with a legend naming the place"`, `"an overlay 404 shows its note and the line still draws"`, axe passes.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm run test` → PASS.
- [ ] **Step 5:** Commit `feat: overlay layers on Chart and Data table`.

### Task 7: CSV from a data config, with overlay rows

**Files:**

- Modify: `src/lib/data/csv.ts`, `src/lib/data/csv.test.ts`, `src/lib/actions/widget.ts` (callers)

**Interfaces:**

- Produces: `downloadDataCsv(data: WidgetDataConfig, save: FileAccess["save"], viewer?: PlaceViewer): Promise<void>`
  (the old `downloadWidgetCsv(widget, …)` becomes a thin call to it);
  `saveDataCsv(key: string, data, save, viewer?)` with the same pending/toast behavior keyed by
  `key` (widget id, or `"get-data"` for the draft). `CSV_COLUMNS` gains `"level_key"`, `"level_label"`
  (empty for numeric rows). Overlay rows: same long format, their own `entry_type`, every place.

- [ ] **Step 1: Failing tests:** `"overlay rows carry level_key and level_label"`;
      `"every place's overlay rows are exported"`; `"a point place exports as its region for shares"`
      (spec 2's swap still applies); existing tests updated for the two new columns.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: CSV from any data config, with overlay rows`.

### Task 8: The draft

**Files:**

- Create: `src/lib/get-data/draft.svelte.ts`, `src/lib/get-data/draft.test.ts`

**Interfaces:**

- Consumes: `platform.preferences` (`get/set(space, key, value)`), `WidgetDataConfigSchema`,
  `DEFAULT_LAYER`, `DEFAULT_RANGE`.
- Produces:
  ```ts
  const DRAFT_KEY = "getDataDraft";
  const DraftSchema = z.object({ type: z.string().max(64), data: WidgetDataConfigSchema, options: ChartOptionsSchema.optional() });
  type Draft = z.infer<typeof DraftSchema>;
  function defaultDraft(type?: string): Draft;           // chart, Fresno County PM2.5, last 30 days
  async function loadDraft(platform, space, type?: string): Promise<Draft>;  // invalid/unknown type → default
  function saveDraft(platform, space, draft: Draft): void;                    // debounced 500 ms
  ```
  A `point` place is saved locally like any field (preferences never sync); nothing new syncs.

- [ ] **Step 1: Failing tests:** `"no stored draft → Fresno County PM2.5 last 30 days"`;
      `"a tampered draft (50 layers / lat 999 / unknown type) → default"`;
      `"?type=data-table overrides the stored type"`; `"save then load round-trips"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: Get data draft kept in this browser`.

### Task 9: The Get data view

**Files:**

- Create under `src/lib/get-data/`: `GetDataView.svelte` (layout A), `WhenControl.svelte`,
  `WhereControl.svelte` (embeds spec 2's `PlacePicker` in a dialog/panel), `WhatSections.svelte`
  (accordion), `DetailControl.svelte`, `ShowAs.svelte`, `Preview.svelte`, `ActionBar.svelte`,
  `resolution-offer.ts` (+ `.test.ts`), `get-data-view.browser.test.ts`
- Modify: `src/routes/GetData.svelte` (mounts `GetDataView` with the mode), `messages/en.json`

**Interfaces:**

- Consumes: Tasks 3, 4, 6, 7, 8; `PlacePicker` props (spec 2); `loadWidget(type)`; `chooseResolution`.
- Produces:
  ```ts
  // resolution-offer.ts
  type DetailChoice = { level: "auto" | Resolution; blocked: "server-limit" | "too-many-points" | null };
  function detailChoices(entry: EntryTypeMeta, range: DateRangeSpec, places: number, pin: Resolution | undefined, now: Date): DetailChoice[] | null; // null → hide (pinned)
  ```
  Limits: raw ≤ 31 days; hourly region summaries ≤ 31 days; daily ≤ 366 days per request is
  already chunked by month, so daily/monthly are never blocked by the server limit. "Too many
  points" = places × periods > 50 000 (my call; tune in review).
- `GetDataView` props: `{ mode: GetDataMode; initial: Draft; onAdd(target, draft); onSave(draft); onCancel(); }`
  (Tasks 10–11 supply the handlers). The preview mounts the type's real component with a
  view-only `WidgetInstance` (`id: "get-data-preview"`, rect from size mode) and the `"owner"` viewer.
- Announcements: one polite live region, text `m.get_data_preview_showing({ title })` after the
  preview's data settles; never per keystroke.
- "Dashboard size": a toggle button group (Large | Dashboard size); dashboard size =
  `defaultSize.w` columns of the dashboard grid width at the current viewport.

- [ ] **Step 1: Failing tests** (`get-data-view.browser.test.ts`, desktop and 390 px):
      `"opens filled in: Fresno County, PM2.5, Last 30 days, chart drawn"`;
      `"choosing Last 7 days updates the resolved dates and the preview"`;
      `"adding Burn status adds an overlay; a third overlay option is disabled with a reason"`;
      `"Overlay for appears only when places are in different zones"`;
      `"Show as Chart is disabled with a reason at 7 places"`;
      `"Detail hides for a pinned type; Raw is disabled over 90 days with a reason"`;
      `"keyboard: the date list, accordion and Show as work without a mouse"`;
      `"the pollutant can't be cleared; overlays can't stand alone"`;
      `"choosing Hourly stores resolution: 'hour' on the main layer; Automatic stores none"`;
      axe passes on both widths.
      `resolution-offer.test.ts`: the limits above.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm run test` → PASS;
      `npm run build && npm run check:budget` → initial bundle unchanged.
- [ ] **Step 5:** Commit `feat: the Get data view`.

### Task 10: Add to dashboard

**Files:**

- Create: `src/lib/get-data/add.ts`, `src/lib/get-data/add.test.ts`, `src/lib/get-data/TargetMenu.svelte`
- Modify: `src/routes/GetData.svelte`, `src/lib/layout/focus-request.svelte.ts` (add `kind: "added"` that
  focuses the widget title and sets a 2 s highlight attribute; reduced motion → no animation)

**Interfaces:**

- Consumes: `app.sessions.get(id)` (`"starter"` gives the starter; its first edit makes the copy
  and sets `app.current` to it), `placeNewWidget`, `session.apply({ op: "addWidget", … })`.
- Produces: `addFromDraft(app: AppContext, targetId: string | "new", draft: Draft): Promise<{ dashboardId: string; widgetId: string }>`
  — `"new"` creates a blank dashboard via `app.index.createBlank()`; a read-only session throws
  (never offered). Then `navigate("/dashboards/:id")` and `requestFocus({ kind: "added", id: widgetId })`.
- Placement: `placeNewWidget` (column 0, below everything), which is what "the first free spot"
  means for Add widget in this codebase today; no new placement rule.
- Default target: the route's `:id`, else `LAST_OPENED_KEY`, else the starter. The menu lists
  non-read-only dashboards by display name plus "New dashboard".

- [ ] **Step 1: Failing tests:** `"adds at placeNewWidget's rect, one undo removes it"`;
      `"adding to the starter makes the copy and returns its id"`;
      `"a live-shared dashboard saves a point place as its region"` (spec 2's `onEdit` guard);
      `"New dashboard creates one and adds there"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: Add to dashboard from Get data`.

### Task 11: Edit data and Save changes

**Files:**

- Modify: `src/lib/changes/types.ts`, `src/lib/changes/apply.ts`, `src/lib/changes/rebase.ts`
  (`setWidgetData` gains optional `type: { from: string; to: string }` and
  `options: { from?: Record<string, unknown>; to?: Record<string, unknown> }`; its inverse swaps
  them), `src/lib/actions/widget.ts` (⋯ "Edit data" in group `"data"`, for editable widgets whose
  type has `accepts.datasets`), `src/lib/widgets/shared/WidgetState.svelte` (retired dataset/entry
  type "Choose another" → Edit data route; place cases keep the picker), `src/routes/GetData.svelte`
- Create: `src/lib/get-data/DiscardDialog.svelte`, `src/lib/get-data/edit.ts`, `src/lib/get-data/edit.test.ts`

**Interfaces:**

- Produces: `saveEdit(session: DocumentSession, widgetId: string, draft: Draft): boolean` — returns
  false (no change applied) when type, data and options are all unchanged; otherwise one
  `setWidgetData`; rect clamped to the new type's `minSize` via a `setLayout` only if needed (same
  undo step is not required for the clamp — my call, keep it one step if `applyChange` batching exists).
- Unsaved-changes guard: Cancel, Back, and nav links while dirty open `DiscardDialog`
  (bits-ui AlertDialog: "Discard changes?" / "Discard" / "Keep editing"); sv-router's
  before-navigate hook (or a `beforeNavigate` wrapper in `GetData.svelte`) blocks navigation.

- [ ] **Step 1: Failing tests:** `edit.test.ts`: `"unchanged save applies nothing"`;
      `"changing the date range is one undo step"`; `"switching Chart → Data table keeps id, rect, title"`;
      `"a pre-spec widget (one layer, no options) round-trips"`. `apply.test.ts`/`rebase.test.ts`:
      `setWidgetData` with `type` inverts and rebases. Browser: `"Back while dirty asks to discard; Keep editing stays"`;
      `"⋯ Edit data opens the widget's data"`; `"Choose another on a retired entry type opens Edit data"`;
      `"an unknown dashboard or widget id shows the not-found page"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm run test` → PASS.
- [ ] **Step 5:** Commit `feat: Edit data with Save changes`.

### Task 12: E2E, stack check, and docs

**Files:**

- Create: `e2e/get-data.spec.ts`, fixtures in `e2e/fixtures/api/2.0/forecasts/` (place + meta)
- Modify: `ARCHITECTURE.md` ("Data Explorer" section → "Get data" per the spec's "Docs changed";
  "Widget-type contract" without `addable` for data types, with explicit `accepts.datasets`;
  "Routing" table), `DEFERRED.md` (the spec's "Deferrals" list, each with why + revisit; the weather
  entry also notes "which station when several are inside the place" from the draft
  `monitors/weather/place/` shape; remove "Date-range method toggle"; rename "Data Explorer"
  mentions on step 4 entries), `TODO.md`/`ROADMAP.md` step 4 sections only (re-read first)

- [ ] **Step 1:** E2E: `"Data nav → Add to dashboard lands highlighted, Undo removes it"`;
      `"Edit data → Save changes, Undo restores"`; `"Download CSV from the draft has overlay rows"`;
      `"Add widget → Chart on the starter makes a copy"`. Run `npm run test:e2e` → PASS, then
      `npm run test:e2e:podman` (all engines) → PASS.
- [ ] **Step 2:** Stack check against local `develop` (`npm run dev`, Playwright script, own
      tab): Fresno County PM2.5 + burn status over 2026-01; ZIP 93702 shows "ZIP 93702"; remember
      local data gaps are expected.
- [ ] **Step 3:** Docs as listed; `npm run lint`.
- [ ] **Step 4:** Commit `docs: Get data in ARCHITECTURE, DEFERRED, TODO`; push; open the PR into
      `step-4` listing new English strings for the user's approval; tell the coordinator.
