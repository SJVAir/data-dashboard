# Step 4 spec 4: the "now" widgets and thresholds — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three lazily loaded "now" widget types (Current conditions, Forecast strip, "Can we go
outside?"), client-side self-monitoring thresholds with an opt-in desktop notification, and Chart
threshold lines.

**Architecture:** Hourly values reuse the existing query client (a trailing-hours range pinned to
`hour`). Forecast days, today's heat and (after SDK beta.7) the server's alert value come from a
small **now client** that the existing poller drives. Threshold firing runs in one **dashboard-level
watcher** (minimized widgets aren't mounted), which writes per-widget marks that the tiles and the
taskbar read, and keeps "last told" per browser under a lock.

**Tech Stack:** Svelte 5 runes, TypeScript, zod, `@sjvair/sdk` (pinned exactly), Paraglide,
uPlot, Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-step-4-spec-4-now-widgets-design.md` (approved
2026-11-08). Read it with this plan; decisions are argued there, not here.

## Global Constraints

- Branch `step-4-spec-4` (from `origin/step-4`); one PR into `step-4`; merging needs the user's yes.
  **The PR waits for `@sjvair/sdk` `5.0.0-beta.7`** (Task 13 is last).
- SDK pinned exactly (`"npm:@jsr/sjvair__sdk@5.0.0-beta.6"` until Task 13); no SDK workarounds.
- Metadata is the source of truth: levels, colors, `guidance`, units, `display.precision`, the
  alert `window`, zones, school guidelines, heat scales, scale `source`s. Nothing hardcoded.
- Every string through Paraglide (`messages/en.json`), parameters not concatenation; key names
  match their text. Dates and times through `$lib/format`, Pacific time.
- No generated English saved in documents: only level keys, ids and places.
- Saved fields schema-validated and size-limited (`$lib/zod`, `LIMITS`).
- `Notification` and preferences only through the platform adapter (`src/lib/platform/`).
- Theme tokens only (`src/lib/theme/token-discipline.test.ts`). Never color alone: every level,
  heat score, burn status, threshold mark and Chart line carries its label. `readableColor` for
  text on level colors; swatches outlined.
- `prefers-reduced-motion`: the outline pulse and taskbar flash become a steady mark.
- Each widget type's code, the now client, the heat and forecast sources and the watcher are lazy.
  Initial bundle: 199.7 KB of a 200 KB soft budget. Run
  `npm run build && npm run check:budget` after Tasks 9, 10 and 11; if over, stop and tell the user.
- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- No Claude/AI attribution in commits or the PR.

## Review Focus

- **A place with no data at all for the pollutant** (a ZIP with no monitors, a new school): every
  now widget shows its "No data" state and the card keeps its heat line; nothing throws.
- **A saved threshold key that the scale no longer has** (pollutant switched PM2.5 → O3 with
  `moderate` saved; O3 has no `moderate`): falls back to the first tier-2 level, says so, and
  never fires on the missing key.
- **The same dashboard open in two tabs**: one toast and one notification per crossing.
- **Pacific midnight in a non-Pacific browser** (`TZ=America/New_York`): "Today"/"Tomorrow", heat
  "today" and "Issued …" follow Pacific dates.
- **A widget removed, or its threshold turned Off, between a fetch and its firing**: no toast for
  a widget that no longer watches; its told state is dropped.

---

### Task 1: Metadata for the now widgets

**Files:**

- Modify: `src/lib/data/metadata.ts`
- Test: `src/lib/data/metadata.test.ts`

**Interfaces:**

- Produces:
  - `Level` gains `guidance: string` (`""` when absent) and `description: string`.
  - `MetadataSource.schoolGuidelines(entryType: string, signal?) => Promise<SchoolGuidelines | null>`
    (the SDK's type, from `monitors/meta/` `entries[entryType].school_guidelines`).
  - `MetadataSource.scaleSource(dataset: string, entryType: string, signal?) => Promise<{ name: string; url: string } | null>`
    (the scale's `source`; `dataset` routes like `datasetLevels`).
  - `datasetLevels("calheatscore", "heat-score")` reads `getCalHeatScoreMeta().scales`.

- [ ] **Step 1: Write failing tests** in `metadata.test.ts` (mocking the SDK as the file does):
      `mapScaleLevels keeps guidance and description` (Good's `""`, Moderate's sentence);
      `schoolGuidelines returns pm25's set and null for o3`;
      `datasetLevels reads calheatscore scales` (5 levels, `low`…`severe`, tiers 0–4);
      `scaleSource returns the burn-status source`.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/data/metadata.test.ts` → FAIL.
- [ ] **Step 3:** Implement; memoize `getCalHeatScoreMeta` like `forecastsMeta`. Update the
      `MetadataSource` test doubles the type checker flags (`npm run check`).
- [ ] **Step 4:** Tests and `npm run check` pass.
- [ ] **Step 5:** Commit `feat: level guidance, school guidelines and heat scales in metadata`.

### Task 2: Thresholds: saved shape, level choice, firing rule

**Files:**

- Create: `src/lib/thresholds/schema.ts`, `src/lib/thresholds/levels.ts`, `src/lib/thresholds/firing.ts`
- Modify: `src/lib/documents/schema.ts` (`WidgetInstance.thresholds`), `package.json`
  (`test:unit:tz` also runs `src/lib/thresholds`)
- Test: `src/lib/thresholds/levels.test.ts`, `src/lib/thresholds/firing.test.ts`,
  `src/lib/documents/schema.test.ts`

**Interfaces:**

- Produces:
  - `ThresholdSchema = z.object({ level: CodeSchema })`; `type Threshold`.
    `WidgetInstance.thresholds: z.array(ThresholdSchema).max(1).optional()` (no entry = Off).
  - `defaultThresholdLevel(levels: Level[]): string | null` — the first level with `tier === 2`.
  - `resolveThreshold(saved: Threshold[] | undefined, levels: Level[]): { level: Level; fellBack: boolean } | null`
    — `null` when Off or the scale has no levels; a missing key falls back to the default with
    `fellBack: true`.
  - `type Told = { level: string | null; at: number }` (epoch ms).
  - `decide(told: Told | undefined, reading: { level: string; at: number }, threshold: Level, levels: Level[]): { fire: boolean; told: Told }`.
    `REARM_MS = 2 * 60 * 60 * 1000`.

- [ ] **Step 1: Write failing tests.** `levels.test.ts`: default is `unhealthy_sensitive` for the
      PM2.5 and O3 scales (from fixtures matching `monitors/meta/`), `null` for `[]`; a saved
      `moderate` on O3 falls back with `fellBack: true`; Off (`undefined`/`[]`) is `null`.
      `firing.test.ts` (levels ordered by `min`; "worse" = later in that order):
  - `first reading only sets the starting point`: `decide(undefined, {level:"unhealthy"}, usg)` →
    `fire: false`, `told.level: "unhealthy"`; below threshold → `told.level: null`.
  - `fires once on reaching the threshold`: told `{null}` + `unhealthy_sensitive` → fire; same
    level again → no fire.
  - `fires again only when worse`: told `unhealthy_sensitive` + `unhealthy` → fire.
  - `never on improvement`: told `unhealthy` + `unhealthy_sensitive` → no fire.
  - `re-arms on a below value at least 2 h after the last toast`: told at t, `moderate` at
    t + 2 h → `told.level: null`; at t + 1 h 59 m → told unchanged.
  - `a reopened tab already at the level shows no toast`: told `unhealthy_sensitive` yesterday,
    reading `unhealthy_sensitive` now → no fire.
        `schema.test.ts`: two thresholds, or a level key over `LIMITS.CODE_MAX`, fail validation.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/thresholds src/lib/documents` → FAIL.
- [ ] **Step 3:** Implement. `decide` keeps `told` unchanged when nothing applies.
- [ ] **Step 4:** Pass, also under `npm run test:unit:tz`.
- [ ] **Step 5:** Commit `feat: threshold shape, default level and firing rule`.

### Task 3: Platform `notifications` capability

**Files:**

- Create: `src/lib/platform/web/notifications.ts`
- Modify: `src/lib/platform/types.ts`, `src/lib/platform/memory.ts`,
  `src/lib/platform/web/storage.ts` (wire it), `src/lib/platform/capability-contract.ts`
- Test: `src/lib/platform/web/notifications.test.ts`, the capability contract

**Interfaces:**

- Produces:

```ts
export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";
export interface NotificationAccess {
	/** "unsupported" where pages can't show notifications (phones, tablets, no API). */
	permission(): NotifyPermission;
	/** Asks the browser; call only from a person's action. */
	request(): Promise<NotifyPermission>;
	/** No-op unless granted. Same `tag` replaces an earlier notification. */
	show(n: { title: string; body: string; tag: string }): void;
}
```

`Platform.notifications: NotificationAccess`. `MemoryNotifications` adds `script(p)` and `shown`.

- [ ] **Step 1: Failing tests:** contract: `show` before granting records nothing; after
      `request()` → granted, `show` records `{title, body, tag}`. Web (stubbed `window`):
      `unsupported` without `Notification`, and when `matchMedia("(hover: none) and (pointer: coarse)")`
      matches (the desktop-only rule; builder may refine the test of "phone or tablet" and must
      keep a unit test for it).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Pass, `npm run check` clean.
- [ ] **Step 5:** Commit `feat: notifications platform capability`.

### Task 4: The now client

**Files:**

- Create: `src/lib/data/now/client.ts`, `src/lib/data/now/now-query.svelte.ts`,
  `src/lib/data/now/index.ts`
- Modify: `src/lib/data/query/poller.ts` (accept any `Pollable`)
- Test: `src/lib/data/now/client.test.ts`, `src/lib/data/query/poller.test.ts` (still green)

**Interfaces:**

- Consumes: `startPoller`, `QueryEntryInfo`, `ActivitySource`.
- Produces:

```ts
// poller.ts
export type Pollable = Pick<QueryClient, "entries" | "refetch" | "onChange">;
export function startPoller(client: Pollable, activity: ActivitySource, opts?: PollerOptions);

// now/client.ts
export type NowSource<T> = {
	key: string; // cache key; equal keys share one fetch
	cadence: "raw" | "hour"; // poller cadence: every 3 min, or :55 past each Pacific hour
	fetch(signal: AbortSignal): Promise<T>;
};
export type NowState<T> =
	| { status: "idle" | "loading"; data?: T }
	| { status: "ready"; data: T; fetchedAt: number }
	| { status: "error"; error: unknown; data?: T };
export interface NowClient extends Pollable {
	subscribe<T>(source: NowSource<T>, listener: (s: NowState<T>) => void): NowSubscription;
}
export interface NowSubscription { setPolling(on: boolean): void; retry(): void; unsubscribe(): void }
export function createNowClient(opts: { activity?: ActivitySource; now?: () => Date }): NowClient;

// now/now-query.svelte.ts — like LiveQuery
export class NowQuery<T> { state: NowState<T>; set(source: NowSource<T> | null): void; setPolling(on: boolean): void; retry(): void; destroy(): void }

// now/index.ts — lazy-only, like $lib/data
export function getNowClient(): NowClient;
```

Entries report `includesNow: true` and `resolution` `"raw"` or `"hour"` to the poller. Idle
entries (no subscribers) are dropped after their last fetch is an hour old.

- [ ] **Step 1: Failing tests:** two subscribers to one key fetch once; `refetch` while in flight
      is ignored; an error keeps the last data; unsubscribe of the last subscriber stops polling;
      a poller over a now client refetches a `"raw"` entry after 3 minutes (fake timers).
- [ ] **Step 2–4:** FAIL → implement → pass (poller tests unchanged and green).
- [ ] **Step 5:** Commit `feat: now client for forecast days, heat and alert values`.

### Task 5: The current reading (hourly path)

**Files:**

- Create: `src/lib/data/now/current.ts`, `src/lib/widgets/shared/current.svelte.ts`
- Test: `src/lib/data/now/current.test.ts`

**Interfaces:**

- Consumes: `QueryClient`/`LiveQuery`, `QueryData`, `Level`, `levelFor`.
- Produces:

```ts
// data/now/current.ts
export const CURRENT_RANGE: DateRangeSpec = { kind: "trailing", amount: 6, unit: "hour" };
export const STALE_MS = 3 * 60 * 60 * 1000; // an hourly value older than this is "No recent data"
export function currentInput(layer: Layer): QueryInput; // pin "hour", CURRENT_RANGE
export type Trend = "rising" | "falling" | "steady";
export function trend(value: number, previous: number | null, precision: number | null): Trend | null;
export type CurrentReading =
	| {
			status: "ok";
			value: number;
			level: Level | undefined;
			/** Epoch ms: the reading's time (alert) or the hour's end (summary). */
			at: number;
			trend: Trend | null;
			source: "alert" | "alert-latest" | "hourly";
			/** The alert window in minutes, for the "60-minute average" label. */
			windowMinutes?: number;
			place: PlaceInfo;
	  }
	| { status: "pending" | "insufficient" | "no-recent" | "no-data"; place?: PlaceInfo };
export function hourlyReading(data: QueryData, levels: Level[], now: Date, precision: number | null): CurrentReading;

// widgets/shared/current.svelte.ts — used by the two tiles and by the watcher
export class CurrentConditions {
	constructor(widget: () => WidgetInstance, opts?: { polling?: () => boolean });
	readonly reading: CurrentReading | undefined; // undefined while loading
	readonly levels: Level[];
	readonly state: "loading" | "ready" | "error" | { unavailable: UnavailableReason };
	retry(): void;
}
```

`trend` is "steady" when the two values are equal at the entry type's `precision` (0 decimals when
`null`); this is the builder's "Steady" rule, kept in this one function. Task 13 adds the alert
path inside `CurrentConditions`; until then every place uses `hourlyReading`.

- [ ] **Step 1: Failing tests:** latest of three hourly points with `previous` = the hour before
      and a "rising" trend; one point → trend `null`; latest hour ended more than `STALE_MS` ago
      → `no-recent`; no points → `no-data`; a school's fallback keeps `via` in `place`; `trend`
      at precision 1: 28.44 vs 28.41 → steady, 28.4 vs 28.6 → rising.
- [ ] **Step 2–4:** FAIL → implement → pass (also `test:unit:tz`).
- [ ] **Step 5:** Commit `feat: current reading from the latest hourly average`.

### Task 6: Current conditions widget

**Files:**

- Create: `src/lib/widgets/current/index.ts`, `module.ts`, `CurrentWidget.svelte`,
  `src/lib/widgets/shared/LevelChip.svelte`, `src/lib/thresholds/marks.svelte.ts`
- Modify: `src/lib/store/app.svelte.ts` (register), `messages/en.json`
- Test: `src/lib/widgets/current/current-widget.browser.test.ts`, `src/lib/thresholds/marks.test.ts`

**Interfaces:**

- Consumes: `CurrentConditions` (Task 5), `WidgetState.svelte`, `Toggletip.svelte`,
  `readableColor`, `$lib/format`.
- Produces:
  - `CURRENT_TYPE = "current-conditions"`: `time: "now"`, `placePicker: true`,
    `thresholds: true`, `analyzable: true`, `downloadable: false`,
    `accepts: { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces: 1 }`,
    `minSize {w:3,h:3}`, `defaultSize {w:3,h:4}`.
  - `LevelChip.svelte` props `{ level: Level; size?: "sm" | "md" }` (color, label,
    `readableColor` text, outline). Reused by Tasks 7, 8, 12.
  - `marks.svelte.ts`: `thresholdMarks: Record<string, ThresholdMark>` (`$state`, keyed by widget
    id) with `type ThresholdMark = { level: Level; at: number; pulse: number }`;
    `setMark(id, mark | null)`. Kept tiny: the Taskbar imports it (initial chunk).
- Strings (draft English; the user reviews): `widget_current_title` "Current conditions",
  `current_trend_rising` "Rising", `current_trend_falling` "Falling", `current_trend_steady`
  "Steady", `current_minute_average` "{minutes}-minute average", `current_latest_reading` "Latest
  reading", `current_hourly_average` "Hourly average", `current_source_updated` "{average} · updated {minutes} min ago" (one message, the average label passed in), `current_not_available_yet` "Not available yet", `current_no_recent_data` "No recent
  data", `current_not_enough_readings` "Not enough recent readings", `current_no_data` "No data
  for this place", `current_at_alert_level` "At your alert level", `current_averaging_help` (the
  toggletip: which average and how often it updates).

- [ ] **Step 1: Failing browser tests** (memory platform, fixture query client, as
      `chart-widget.browser.test.ts` does; first wait on the lazy chunk > 1 s): renders "28.4",
      "µg/m³" from metadata units, the Moderate chip text, "Rising", the Moderate guidance, "Hourly
      average · updated 6 min ago"; Good shows no guidance line; each state's text; a mark in
      `thresholdMarks` shows "At your alert level" and the outline; `monitor-unlisted` and a retired region show the shared "no longer available" card; under emulated reduced motion
      there's no pulse animation (`animationsSettled`); axe clean.
- [ ] **Step 2–4:** FAIL → implement (title generated: "{pollutant} · {place}", via
      `setGeneratedTitle`) → pass.
- [ ] **Step 5:** Commit `feat: Current conditions widget`.

### Task 7: Forecast strip

**Files:**

- Create: `src/lib/data/now/forecast-days.ts`, `src/lib/widgets/forecast/index.ts`, `module.ts`,
  `ForecastWidget.svelte`
- Modify: `src/lib/store/app.svelte.ts`, `messages/en.json`
- Test: `src/lib/data/now/forecast-days.test.ts`, `src/lib/widgets/forecast/forecast-widget.browser.test.ts`

**Interfaces:**

- Consumes: `layerTarget`, `placeCandidates`, `isNotFound`, `getForecastForPlace`,
  `datasetLevels("forecasts", …)`, `scaleSource`, `todayPacific`.
- Produces:

```ts
export type ForecastDay = {
	date: string; // YYYY-MM-DD, Pacific
	aqi: number;
	aqiLevel: Level | undefined;
	pollutant: string; // the feed's, e.g. "PM2.5"
	burn: { level: Level } | { text: string } | null; // unknown status → feed text
};
export type ForecastDays = {
	days: ForecastDay[]; // today and tomorrow that exist, in order
	airAlert: { start: string; end: string } | null;
	zone: { name: string; nearest: boolean } | null; // nearest: rule === "center"
	publishedAt: string | null;
	sources: { aqi: { name: string; url: string } | null; burn: { name: string; url: string } | null };
};
export function forecastDaysSource(layer: Layer, ctx: AdapterContext, now: () => Date): Promise<NowSource<ForecastDays> | { unavailable: UnavailableReason }>;
```

`FORECAST_TYPE = "forecast-strip"`: `time: "now"`, `placePicker: true`, `thresholds: false`,
`analyzable: true`, `accepts: { datasets: ["forecasts"], maxPlaces: 1 }`, `minSize {3,3}`,
`defaultSize {3,4}`, cadence `"hour"`.

- Strings: `widget_forecast_title` "Forecast", `forecast_today` "Today", `forecast_tomorrow`
  "Tomorrow", `forecast_aqi` "AQI {value} · {pollutant}", `forecast_air_alert` "Air Alert declared
  {start} – {end}", `forecast_issued` "Issued {time}", `forecast_zone` "Forecast for {zone}",
  `forecast_zone_nearest` "Forecast for {zone} (nearest zone)", `forecast_none_yet` "Today's
  forecast isn't out yet", `forecast_none_here` "No forecast for this place", `source_link`
  reuse if one exists.

- [ ] **Step 1: Failing tests** (unit): latest issue per date wins; days outside today/tomorrow
      (Pacific) dropped, also with `TZ=America/New_York` at 21:30 Pacific; an Air Alert that ended yesterday → `airAlert: null`; `Registered` → its
      level; `"Prohibited"` → `{ text: burn_status_text }`; `air_alert` true with dates →
      `airAlert`; `rule: "center"` → `nearest: true`; a 404 → tries the next fallback key.
      Browser: two rows with chips and labels, the banner, "Issued Sat 1:42 PM", states, axe.
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** Commit `feat: Forecast strip widget`.

### Task 8: Heat source and "Can we go outside?"

**Files:**

- Create: `src/lib/data/now/heat.ts`, `src/lib/widgets/outside/index.ts`, `module.ts`,
  `OutsideWidget.svelte`, `ActivityRow.svelte`
- Modify: `src/lib/store/app.svelte.ts`, `messages/en.json`
- Test: `src/lib/data/now/heat.test.ts`, `src/lib/widgets/outside/outside-widget.browser.test.ts`

**Interfaces:**

- Consumes: `CurrentConditions` (with the layer's entry type forced to `pm25`), `schoolGuidelines`,
  `getHeatForPlace`, `datasetLevels("calheatscore", "heat-score")`, `LevelChip`, `thresholdMarks`.
- Produces:

```ts
export type HeatToday = {
	level: Level | undefined;
	/** Set when the place covers more than one ZIP: the ZIP that set the highest score. */
	highest?: { zip: string; placeName: string };
} | null; // no score today
export function heatSource(layer: Layer, ctx: AdapterContext, now: () => Date): Promise<NowSource<HeatToday> | { unavailable: UnavailableReason }>;
```

Place → heat request: monitor → `{ monitor }`; region → its region ref; school or point → its
`zipcode:` key from `layerTarget`'s fallback keys (none → `null`, the line says heat isn't
available). `zip_count > 1` → `highest`. Cadence `"hour"`.

`OUTSIDE_TYPE = "outside"`: `time: "now"`, `placePicker: true`, `thresholds: true`,
`analyzable: true`, `accepts: { datasets: ["air-quality"], maxPlaces: 1 }`, `minSize {3,5}`,
`defaultSize {3,7}`. Its layer always has `entryType: "pm25"` (Get data sets it, Task 11).

Layout (approved mockup `outside-card-v2.html`): PM2.5 `LevelChip` + source line; one
`ActivityRow` per activity in metadata order (a disclosure button with `aria-expanded`: label,
`duration` if not null, first sentence truncated with CSS; open shows every sentence of that
level); the heat section in a non-shrinking footer, never truncated; the guidelines' `source` link.

- Strings: `widget_outside_title` "Can we go outside?", `outside_heat_today` "Heat today",
  `outside_heat_highest` "Highest in {place} (ZIP {zip})", `outside_heat_unavailable` "No heat
  score today", `outside_no_guidance` "No guidance for this level", `outside_no_pm25` "No PM2.5
  data for this place", `outside_source` "Source: {name}".

- [ ] **Step 1: Failing tests** (unit): school → ZIP request; Fresno County with `zip_count` 58 →
      `highest` with "93210"; no days → `null`; today's date is Pacific under
      `TZ=America/New_York`. Browser: USG rows show the first sentences; opening Athletics shows
      both sentences and `aria-expanded="true"`; Severe heat's full guidance is visible at
      default size (not clipped: its box's `scrollHeight <= clientHeight`); Low shows just "Heat
      today" and "Low"; a level with no sentences shows "No guidance for this level"; no PM2.5 →
      `outside_no_pm25` with heat still shown; axe clean.
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** Commit `feat: "Can we go outside?" widget and today's heat`.

### Task 9: The threshold watcher

**Files:**

- Create: `src/lib/thresholds/watcher.svelte.ts`, `src/lib/thresholds/ThresholdWatcher.svelte`,
  `src/lib/thresholds/told.ts`
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte` (mount the watcher lazily when any
  widget has `thresholds`), `src/lib/components/dashboard/Taskbar.svelte` (mark), `messages/en.json`
- Test: `src/lib/thresholds/watcher.browser.test.ts`, `src/lib/thresholds/told.test.ts`,
  `e2e/thresholds.spec.ts`

**Interfaces:**

- Consumes: `decide`, `resolveThreshold` (Task 2), `CurrentConditions` (Task 5) with
  `polling: () => true` (so minimized widgets keep refreshing), `thresholdMarks`/`setMark`
  (Task 6), `platform().locks`, `platform().preferences`, `platform().notifications`,
  `notifyEnabled` (Task 10 adds the switch; until then read as off).
- Produces:
  - `told.ts`: `TOLD_KEY = "thresholdTold"`; `readTold(p, space, docId): Promise<Record<string, Told>>`,
    `writeTold(p, space, docId, map)`; the map is schema-validated on read (bad → `{}`) and
    pruned to the document's widget ids on write.
  - `ThresholdWatcher.svelte` props `{ docId: string; widgets: WidgetInstance[]; space: SpaceId }`,
    rendering one persistent `role="status"` `aria-live="polite"` sr-only region.
  - On each new reading (`at` greater than the last seen for that widget): under
    `platform().locks.run("thresholds:" + docId, …)` re-read told, `decide`, write told; if
    `fire`: `toast(m.threshold_reached(...))`, set the live region text, `setMark` with a new
    `pulse`, and `notifications.show({ title, body, tag: docId + ":" + widgetId })` when the
    dashboard's switch is on. `setMark(id, null)` when the level drops below or the threshold is
    Off or the widget is gone.
- Strings: `threshold_reached` "{pollutant} at {place} is now {level}".

- [ ] **Step 1: Failing tests.** `told.test.ts`: round trip; invalid stored value → `{}`; prune
      drops removed widget ids. Browser (memory platform, fixture readings, fake clock):
  - `the first reading at the level shows the mark but no toast`.
  - `a crossing toasts once and announces politely` (live region text equals the toast).
  - `a minimized widget keeps watching and its taskbar entry shows the mark`.
  - `two watchers for one dashboard (two tabs) fire once` (shared memory platform and locks).
  - `turning the threshold Off clears the mark and never fires`.
  - `a notification is shown only when the switch is on and permission granted`.
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** `e2e/thresholds.spec.ts`: a dashboard fixture with a Current conditions widget
      whose stubbed hourly response goes Moderate → USG between polls (`page.clock`): one toast
      with the text, then minimize and the taskbar mark; axe on the marked tile.
- [ ] **Step 6:** `npm run build && npm run check:budget` (the watcher must be its own chunk).
- [ ] **Step 7:** Commit `feat: threshold watcher, toasts, announcements and taskbar marks`.

### Task 10: The notifications switch

**Files:**

- Create: `src/lib/components/dialogs/NotificationsDialog.svelte`, `src/lib/thresholds/notify-pref.ts`
- Modify: `src/lib/actions/dashboard.ts` (a "Notifications…" item), `src/lib/components/dialogs/lazy.svelte.ts`
  and `LazyDialogs.svelte` (lazy dialog), `messages/en.json`
- Test: `src/lib/components/dialogs/notifications-dialog.browser.test.ts`, `src/lib/thresholds/notify-pref.test.ts`

**Interfaces:**

- Produces: `NOTIFY_KEY = "notifyWhileOpen"`; `notifyEnabled(p, space, docId): Promise<boolean>`,
  `setNotifyEnabled(p, space, docId, on)`; a preference keyed per dashboard, never in the
  document. The watcher (Task 9) reads it on each fire.
- Dialog: a labelled switch "Notify me while this dashboard is open"; turning it on calls
  `notifications.request()` then; `denied` leaves it off with the help text; `unsupported` shows
  it disabled with the reason as visible text.
- Strings: `dashboard_notifications_menu` "Notifications…", `notifications_title`
  "Notifications", `notifications_switch` "Notify me while this dashboard is open",
  `notifications_this_computer` "On this computer only. Only widgets with an alert level notify.",
  `notifications_denied` "Your browser is blocking notifications for this site. Allow them in the
  browser's site settings, then try again.", `notifications_unsupported` "Notifications work in
  desktop browsers only."

- [ ] **Step 1: Failing tests:** off by default; on → `request()` called once, granted → stored
      true; denied → stays off with `notifications_denied`; unsupported → disabled switch with the
      visible reason; per-dashboard: another doc id reads false.
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** `npm run build && npm run check:budget`.
- [ ] **Step 6:** Commit `feat: per-dashboard notifications switch`.

### Task 11: Get data for now widgets

**Files:**

- Create: `src/lib/get-data/NowControls.svelte` (pollutant control and alert level),
  `src/lib/get-data/now.ts`
- Modify: `GetDataView.svelte`, `draft.svelte.ts` (`thresholds` in `DraftSchema`), `add.ts`,
  `edit.ts` (carry and compare `thresholds`), `ShowAs.svelte` (if needed), `messages/en.json`
- Test: `src/lib/get-data/now.test.ts`, `get-data-view.browser.test.ts`, `edit.test.ts`,
  `add.test.ts`, `e2e/get-data.spec.ts`

**Interfaces:**

- Consumes: `dataTypes()`, `mainLayer`, `fromLayer`, `defaultThresholdLevel`.
- Produces:
  - `toNowDraft(draft: Draft, type: WidgetType, catalog): { draft: Draft; dropped: ("dates" | "overlays" | "places")[] }`
    — keeps the main layer's first place and pollutant (`pm25` for `OUTSIDE_TYPE`; the
    `forecasts` dataset with no entry type for `FORECAST_TYPE`), removes `dateRange`/`timeSubRange`,
    sets the default threshold for threshold types if none.
  - `fromNowDraft(draft, type)` — back to a range type: `DEFAULT_RANGE`, nothing dropped.
- View, for `type.time === "now"`: no When section; Where in single mode; `NowControls` (pollutant
  radio group from catalog pollutants with `available`, Current conditions only; "Tell me at
  [level] or worse" select with Off, threshold types only); the note listing `dropped`
  (`get_data_now_dropped`) until the next edit.
- Strings: `get_data_alert_level` "Tell me at {level} or worse" (the select's visible label as
  separate text where needed: `get_data_alert_level_label` "Alert level"), `get_data_alert_off`
  "Off", `get_data_alert_fell_back` "The saved alert level isn't on this pollutant's scale, so {level} is used instead." (also shown in the tile's settings; wording to the copy review), `get_data_now_dropped`
  "Dates and extra places don't apply to this widget, so they were left out.",
  `get_data_pollutant` "Pollutant".

- [ ] **Step 1: Failing tests** (unit `now.test.ts`): Chart with 3 places + burn overlay + last 30
      days → Current conditions keeps place 1 and PM2.5, `dropped: ["dates","overlays","places"]`,
      `thresholds: [{ level: "unhealthy_sensitive" }]`; → Outside forces `pm25`; → Forecast strip
      keeps the place, layer `{ dataset: "forecasts", place }`; back to Chart gets
      `DEFAULT_RANGE`. Browser: now type hides When, shows single picker, pollutant control only
      for Current conditions, Off/levels in the select, the preview renders the now widget.
      `edit.test.ts`: changing only the alert level is one undo step (`saveEdit` true).
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** e2e in `get-data.spec.ts`: Add widget → Show as Current conditions → pick
      "Fresno County" → alert level stays USG → Add to dashboard → the tile shows; Edit data
      reopens with the same alert level.
- [ ] **Step 6:** `npm run build && npm run check:budget`.
- [ ] **Step 7:** Commit `feat: Get data sets up the now widgets`.

### Task 12: Chart threshold lines

**Files:**

- Modify: `src/lib/widgets/chart/ChartWidget.svelte`, `src/lib/charts/time-chart.ts` (a horizontal
  level line), `src/lib/get-data/ShowValuesControl.svelte` (or the More options block: a
  "Threshold line" select), `src/lib/widgets/chart/index.ts` (`thresholds: true`),
  `messages/en.json`
- Test: `src/lib/charts/time-chart.browser.test.ts` or a new `threshold-line.test.ts`,
  `chart-widget.browser.test.ts`

**Interfaces:**

- Consumes: `resolveThreshold` (with no default: Off unless saved), `LevelChip` styling tokens.
- Produces: `thresholdLine(level: Level): { value: number; color: string | null; label: string }`
  (value = `level.min`); the time chart draws it across the plot and includes it in the value
  axis range. The watcher (Task 9) ignores Chart widgets (`time !== "now"`).
- Strings: `get_data_threshold_line` "Threshold line", `chart_threshold_line_label` "{level}",
  `chart_threshold_missing` "This chart's threshold level isn't on the pollutant's scale."

- [ ] **Step 1: Failing tests:** a Chart with `thresholds: [{level:"unhealthy_sensitive"}]` draws
      a line at 35.5 with the label "Unhealthy for Sensitive Groups" and the axis reaches 35.5
      when data peaks at 6; Off draws none; a missing key draws none and shows the note; a
      minimized Chart is not watched (no mark).
- [ ] **Step 2–4:** FAIL → implement → pass.
- [ ] **Step 5:** Commit `feat: Chart threshold lines`.

### Task 13: SDK 5.0.0-beta.7 and the alert value (last; waits on the SDK)

Start only when the coordinator says beta.7 is published. Show the user the pin change.

**Files:**

- Modify: `package.json`/lockfile (`"npm:@jsr/sjvair__sdk@5.0.0-beta.7"`),
  `src/lib/data/metadata.ts` (`alertConfig`), `src/lib/data/now/current.ts` (alert path),
  `src/lib/widgets/shared/current.svelte.ts`
- Create: `src/lib/data/now/alert.ts`
- Test: `src/lib/data/now/alert.test.ts`, `current.test.ts`, the Current conditions browser test

**Interfaces:**

- Consumes: `getMonitorAlertCurrent(monitorId)` and the meta `alerts` block, as published in
  beta.7 (field names follow the SDK, not this plan, if they differ).
- Produces:
  - `MetadataSource.alertConfig(monitorType: string, entryType: string, signal?) => Promise<{ windowMinutes: number; expectedIntervalMinutes: number | null } | null>`
    (`null` = not evaluated).
  - `alertSource(monitorId: string): NowSource<AlertCurrent>` (cadence `"raw"`, key
    `"alert:" + monitorId`).
  - `alertReading(entry, levels, config, place): CurrentReading` — `ok` → `source: "alert"`
    (or `"alert-latest"` when the expected interval ≥ the window), `at = latest_timestamp`,
    trend from `previous.value` when `previous.status === "ok"`, and no trend when
    `previous.latest_timestamp === latest_timestamp` (the same reading); `pending` → `pending`;
    `insufficient` → `insufficient`; `no_data` → `no-recent`; a missing key → the hourly path.
  - `CurrentConditions` picks: monitor + `alertConfig` not null → alert source; else hourly.

- [ ] **Step 1: Bump the pin**, `npm install`, `npm run check` (fix type changes only).
- [ ] **Step 2: Failing tests** with fixtures in the published shape: each status; hourly feed →
      "Latest reading"; a PurpleAir monitor with a config uses the alert value; a VOZBox monitor
      (`alerts: null`) uses the hourly average labeled "Hourly average"; a region never calls
      `getMonitorAlertCurrent`; polling every 3 minutes.
- [ ] **Step 3–4:** FAIL → implement → pass.
- [ ] **Step 5: Stack check** (message the coordinator before any container change): with
      `npm run dev` against `develop`, a script in the scratchpad compares a PurpleAir tile with
      `GET /api/2.0/monitors/<id>/alerts/current/`; a VOZBox tile reads "Hourly average";
      Roosevelt High's card; Fresno County's strip. Rule out local data gaps before calling
      anything a bug.
- [ ] **Step 6:** Commit `feat: Current conditions uses the server's alert value (SDK 5.0.0-beta.7)`.

### Task 14: Docs, copy review and the PR

**Files:**

- Modify: `ARCHITECTURE.md` (the sections listed in the spec's "Docs changed"), `DEFERRED.md`
  (the spec's six deferral bullets: five new entries and the pointer for "No Burning For All"),
  `TODO.md`/`ROADMAP.md` (step 4 sections only); re-read each file right before
  editing.

- [ ] **Step 1:** Docs edits; `npx prettier --check` on them.
- [ ] **Step 2: Full verification:** `npm run lint`, `npm run check`, `npm run test`,
      `npm run test:unit:tz`, `npm run test:e2e`, `npm run test:e2e:podman`,
      `npm run build && npm run check:build && npm run check:budget`. Rule out the known flakes
      in `DEFERRED.md` before chasing a failure.
- [ ] **Step 3: Copy review:** a fresh-eyes subagent checks every new string where it renders
      (accessible names, near-duplicates, promises the UI doesn't keep); fix; then the list of
      keys and English goes to the user in the PR, with unsure wording flagged.
- [ ] **Step 4:** Commit docs; push; open the PR into `step-4` (no attribution); `gh pr checks`.
      Tell the coordinator the PR number and the final saved shape (`thresholds`, now-widget
      layers) for the Map widget session.
