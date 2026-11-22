# Spec 7b: Current conditions as an overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Current conditions holds one or more pollutants, each with its own reading and alert
level; "Can we go outside?" offers the pollutants that have school guidelines, not PM2.5 by name.

**Architecture:** A Current conditions widget keeps one air-quality layer per pollutant (its Where
and searched monitor stay as 7a left them, the monitor on `layers[0]`). Everything that reads one
pollutant today (the card's `CurrentConditions`, the threshold watcher) runs once per pollutant
over a one-pollutant view of the widget (`onePollutant`). Thresholds gain an optional
`entryType`, set only on Current conditions, so each pollutant has its own alert level. Marks and
"last told" are kept per widget and pollutant.

**Tech Stack:** Svelte 5 runes, zod, Paraglide, Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-step-5-spec-7-data-portal-design.md`, decisions
21–23 (the "7b" section). The rest of the spec is 7a's and binds only where 7b touches it.

**Branch:** `step-5-spec-7b` from `origin/step-5` at `07da12e`, in this worktree
(`.worktrees/step-5-spec-7`); PR into `step-5`.

## Global Constraints

- Nothing is live: no compatibility code for older saved documents (no drop-on-read, no
  migration). Fixtures, the starter and the E2E fake use the new shape. The document versioning
  code (`schemaVersion`, `load.ts`, `migrate-changes.ts`) stays as it is (the user, 2026-11-22).
- Metadata is the source of truth: pollutant labels, levels and which pollutants have school
  guidelines come from the catalog and the monitors meta. No pollutant id appears in widget code
  (the `"pm25"` in `OutsideWidget.svelte:47` and `outside/pm25.ts` goes).
- All copy through Paraglide; lists of names through the `format` module (no concatenated
  sentences). Never convey a level by colour alone (the `LevelChip` carries the label).
- Current conditions offers the catalog's available air-quality pollutants (`nowPollutants`), as
  checkboxes in catalog order; layers are stored in that order.
- "Can we go outside?" offers one pollutant, from the pollutants whose monitors meta entry has
  `school_guidelines`; with one offered (PM2.5 today), no choice is shown.
- Show as from Current conditions to any other type keeps the first pollutant and notes the others
  were left out (decision 23).
- Pins unchanged: `@sjvair/sdk` `5.0.0-beta.16`, `@sjvair/map-sdk` `0.1.0-beta.22`.
- Bundle: report the initial bundle (214.5 KB after 7a; soft budget 250 KB).
- Commits GPG-signed, no AI attribution lines. Subagents never run `git stash`.

## Decided (proposed as my calls; the user chose each, 2026-11-22; not to be reopened)

- **C1. "Can we go outside?" stays one pollutant** (a radio when more than one has guidelines).
  One answer from two pollutants' guidelines needs a rule for combining them, which nobody has
  decided, so building it now would be guesswork. The choice still appears with no code change
  when the server adds guidelines (decision 22). Combining them is in `DEFERRED.md` (added with this plan).
- **C2. Unticking the last pollutant is allowed.** The preview then says "Choose a pollutant", and
  Save is blocked with that reason. Nothing greys out the checkbox (the user: None is never
  blocked).
- **C3. A newly ticked pollutant gets its scale's default alert level,** as a new Current
  conditions widget does today. Unticking a pollutant drops its alert level.
- **C4. The card shows one row per pollutant.** Each row has its value, units, level, trend and
  guidance, and its own mark (outline and "Alert level reached"). The taskbar shows the widget as
  marked when any pollutant is, in the first marked pollutant's level colour, in layer order.
- **C5. The generated title with several pollutants** is the pollutant names as a list, then the
  place ("PM2.5 and Ozone · Fresno"), through `label_join` and the `format` module's list.

## Review Focus

1. **A searched monitor and several pollutants:** the monitor is on `layers[0]`. Unticking the
   first pollutant must move the monitor to the new first layer, not lose it. Pinned in Task 2
   (`setCurrentPollutants`) and Task 4.
2. **Show as from a two-pollutant Current conditions:** Chart, Table, Map and the calendars must
   not be greyed out with "pollutants". They convert, keeping the first pollutant, with a note.
   Pinned in Task 2 (`show-as.test.ts`).
3. **One pollutant's scale fails to load** while another's loads. Only that pollutant's alert
   control shows "couldn't load, retry". Its saved alert level is kept, and the other pollutant
   still works. Pinned in Task 4.
4. **One pollutant has no data at the place** (a monitor that doesn't measure ozone). That row
   says so, and the other rows still show. Pinned in Task 5.
5. **The same widget crosses on two pollutants.** It fires two toasts (one per pollutant), each
   with its own "last told". Changing one pollutant's alert level must not reset the other's
   "last told". Pinned in Task 6.

---

### Task 1: Alert levels per pollutant

**Files:**
- Modify: `src/lib/thresholds/schema.ts`, `src/lib/thresholds/levels.ts`,
  `src/lib/get-data/now.ts` (`keptThreshold`)
- Test: `src/lib/thresholds/levels.test.ts`, `src/lib/get-data/now.test.ts`

**Interfaces:**
- Produces:
  - `ThresholdSchema = z.object({ level: CodeSchema, entryType: CodeSchema.optional() })`.
    `entryType` is set on Current conditions' thresholds only, and there is at most one threshold
    per `entryType`. Add a `.refine` on the widget's `thresholds` array, wherever
    `WidgetInstanceSchema` defines it, that rejects duplicate `entryType`s.
  - `thresholdFor(saved: Threshold[] | undefined, entryType?: string): Threshold | undefined`: with
    `entryType`, the entry with that `entryType`; without one, `saved?.[0]`.
  - `resolveThreshold(saved, levels, entryType?: string)`: as today, but it reads
    `thresholdFor(saved, entryType)`.
  - `keptThreshold(saved, levels, defaultWhenOff, entryType?: string): Threshold[] | undefined`:
    as today, for one pollutant. With `entryType`, it reads that pollutant's entry and the result
    carries `entryType`.
  - `withThreshold(saved: Threshold[] | undefined, entryType: string, next: Threshold | undefined): Threshold[] | undefined`:
    replaces or removes one pollutant's entry and keeps the others. Returns `undefined` when
    nothing is left.

- [ ] **Step 1: Failing tests.**
  - `levels.test.ts`:
    - `thresholdFor([{level:"usg",entryType:"pm25"},{level:"unhealthy",entryType:"o3"}], "o3")` →
      `{level:"unhealthy",entryType:"o3"}`.
    - Without `entryType` → the first entry.
    - An `entryType` that isn't there → `undefined`.
    - `resolveThreshold(saved, levels, "o3")` resolves the ozone entry.
  - `now.test.ts`:
    - `keptThreshold([{level:"usg",entryType:"pm25"}], levels, false, "pm25")` →
      `[{level:"usg",entryType:"pm25"}]`.
    - `withThreshold` replaces, adds and removes one entry, keeps the others in order, and gives
      `undefined` when the last entry goes.
    - The schema rejects two entries with the same `entryType`.
- [ ] **Step 2:** Run `npx vitest run --project unit src/lib/thresholds src/lib/get-data/now.test.ts`.
  Expect FAIL.
- [ ] **Step 3:** Implement the code. Every existing caller keeps calling without `entryType`, so
  it behaves as before.
- [ ] **Step 4:** Run the same command. Expect PASS. Then run `npm run check` (0 errors).
- [ ] **Step 5:** Commit: "Alert levels per pollutant: an optional entryType on thresholds".

### Task 2: Current conditions holds several pollutants (shape and conversions)

**Files:**
- Modify: `src/lib/widgets/current/index.ts` (drop `maxPollutantLayers: 1`; the description
  changes to "Current values of one or more pollutants at one place…"),
  `src/lib/get-data/now.ts`, `src/lib/get-data/show-as.ts`, `src/lib/get-data/GetDataView.svelte`
  (`blockData` only), the messages for the new note
- Create: `src/lib/widgets/current/pollutants.ts`
- Test: `src/lib/widgets/current/pollutants.test.ts`, `src/lib/get-data/now.test.ts`,
  `src/lib/get-data/show-as.test.ts`

**Interfaces:**
- Consumes: Task 1's `thresholdFor`, `keptThreshold(…, entryType)`, `withThreshold`.
- Produces, in `widgets/current/pollutants.ts` (no SDK imports):
  - `currentPollutants(data: WidgetDataConfig): string[]`: the `entryType`s of the air-quality
    layers, in layer order.
  - `onePollutant(widget: WidgetInstance, entryType: string): WidgetInstance`: the widget with
    one layer, `layers[0]` (it keeps the monitor) with `entryType` swapped in, and only that
    pollutant's threshold, with `entryType` removed. It is what the card and the watcher read per
    pollutant.
  - `setCurrentPollutants(data: WidgetDataConfig, entryTypes: string[]): WidgetDataConfig`: one
    air-quality layer per `entryType`, in the order given. `layers[0]`'s `monitors` move to the
    new `layers[0]`. With `[]`, it keeps a single air-quality layer with no `entryType` that
    still holds the monitor (7a's decision 31 shape), so a monitor isn't lost while nothing is
    ticked.
  - `firstPollutantOnly(draft: Draft): Draft`: a Current conditions draft cut to its first
    pollutant (its threshold with `entryType` removed). It is what Show as checks and converts
    from.
- Produces, in `now.ts`:
  - A new `NowDropped` value, `"pollutants"`. `NowConversion` gets
    `leftOut?: { dataset: string; entryType: string }[]`, the pollutants that were left out.
  - `isNowShaped` for Current conditions: one or more layers, all air quality, each with a
    distinct `entryType`, and monitors only on `layers[0]`.
  - `toNowDraft` into Current conditions: a one-pollutant source gives one layer, and its
    threshold gets that pollutant's `entryType`.
  - From Current conditions (`toNowDraft` to another now type, `fromNowDraft`): convert
    `firstPollutantOnly(draft)`. Add `"pollutants"` with `leftOut` when there were more. The
    other pollutant layers are never counted as `"overlays"`.
- `GetDataView`'s `blockData`: a Current conditions draft is checked as `firstPollutantOnly`, so
  `typeBlock` never answers `"pollutants"` for it.

- [ ] **Step 1: Failing tests.**
  - `pollutants.test.ts`:
    - `setCurrentPollutants` with a monitor on `layers[0]` and `["o3"]` → one `o3` layer that
      holds the monitor.
    - With `["pm25","o3"]` → two layers, the monitor on the first only.
    - With `[]` → one air-quality layer with no `entryType` that still holds the monitor.
    - `onePollutant(w, "o3")` keeps the Where and the monitor, and has only the ozone threshold,
      with no `entryType`.
  - `now.test.ts`:
    - `isNowShaped` holds for a two-pollutant Current conditions draft.
    - It fails for a draft with the same pollutant twice, or a monitor on `layers[1]`.
    - `toNowDraft` from a Chart's PM2.5 with threshold `[{level:"usg"}]` into Current conditions
      → thresholds `[{level:"usg",entryType:"pm25"}]`.
  - `show-as.test.ts` (Review Focus 2): a Current conditions draft of `pm25`+`o3`, with a county
    and both alert levels set, shown as each of Chart, Table, Map, Month calendar and "Can we go
    outside?" →
    - one PM2.5 layer;
    - `dropped` contains `"pollutants"` and not `"overlays"`;
    - `leftOut` is `[{dataset:"air-quality",entryType:"o3"}]`;
    - a type with thresholds keeps the PM2.5 alert level, without `entryType`.
    - And `typeBlock` with `firstPollutantOnly(draft)` is `null` for Chart.
- [ ] **Step 2:** Run `npx vitest run --project unit src/lib/widgets/current src/lib/get-data`.
  Expect FAIL.
- [ ] **Step 3:** Implement the code.
  - The note's copy names the dropped pollutants through the `format` module's list ("Ozone was
    left out: this type shows one pollutant"). Find where the other `NowDropped` notes are
    rendered (the conversion notes beside Show as) and add `"pollutants"` there.
  - Then grep for `layers[0]` and `CURRENT_TYPE` in `src/lib/get-data/` and `src/lib/starter/`.
    Make each reader that means "Current conditions' pollutant" correct for several (for
    example `nowEntryType` in `GetDataView.svelte:833`, which Task 4 replaces).
- [ ] **Step 4:** Run the same command. Expect PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: "Current conditions holds several pollutants: shape and Show as".

### Task 3: "Can we go outside?" offers the pollutants with school guidelines

**Files:**
- Modify: `src/lib/data/metadata.ts` (the interface and its implementation),
  `src/lib/data/testing/fixtures.ts`, `src/lib/get-data/now.ts` (`nowPollutant`),
  `src/lib/get-data/GetDataView.svelte` and `WhatSections.svelte` (the Outside offer),
  `src/lib/widgets/outside/OutsideWidget.svelte`, `src/lib/widgets/outside/index.ts` (drop
  "Always PM2.5." from the doc comment), `src/lib/thresholds/WatchedWidget.svelte`
- Delete: `src/lib/widgets/outside/pm25.ts` and its tests, if any
- Test: `src/lib/data/metadata.test.ts`, `src/lib/get-data/now.test.ts`,
  `src/lib/widgets/outside/outside-widget.browser.test.ts`

**Interfaces:**
- Produces:
  - `Metadata.guidelinePollutants(signal?: AbortSignal): Promise<string[]>`: the monitors meta's
    entry ids whose `school_guidelines` is not null, in the meta's order. The fixture returns
    `[]` unless a test sets it.
  - `nowPollutant(draft, type, catalog, allowed)` for Outside: the same rule as for the other now
    types, with `allowed` = `guidelinePollutants()`. That is the main layer's pollutant when it's
    offered, else the first offered one. The `OUTSIDE_POLLUTANT` constant goes.
    - With no guideline pollutants at all, the result is `undefined`, and the Data Portal shows
      "No pollutant has school activity guidelines yet". Show as can't be blocked by this,
      because now types are never blocked; the widget then shows that state.
- The Data Portal's Air quality section for Outside:
  - radios over the guideline pollutants when there are two or more;
  - nothing shown when there is one (`pollutants={null}`, as today).
- `OutsideWidget` loads `schoolGuidelines(<its layer's entryType>)`. It reads the widget as saved,
  with no `asPm25`. `WatchedWidget` likewise reads the widget as saved (Task 6 rewrites it).

- [ ] **Step 1: Failing tests.**
  - `metadata.test.ts`: a meta with `school_guidelines` on `pm25` only →
    `guidelinePollutants()` is `["pm25"]`.
  - `now.test.ts`:
    - `nowPollutant` for Outside from an ozone Chart, with `allowed=["pm25"]` → `"pm25"`.
    - With `allowed=["pm25","o3"]` → `"o3"`.
    - With `allowed=[]` → `undefined`.
  - Browser test: an Outside widget saved with ozone, and a fixture whose guidelines exist for
    `o3`, asks `schoolGuidelines` for `"o3"` (a spy on the fixture).
- [ ] **Step 2:** Run the unit tests and
  `npx vitest run --project browser src/lib/widgets/outside`. Expect FAIL.
- [ ] **Step 3:** Implement the code. Grep for `asPm25` and `"pm25"` under `src/lib/` (outside
  tests and fixtures) and remove each pollutant-by-name use.
- [ ] **Step 4:** Run the same tests. Expect PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: "Can we go outside? offers the pollutants with school guidelines".

### Task 4: The Data Portal: pollutant checkboxes and an alert level for each pollutant

**Files:**
- Modify: `src/lib/get-data/AirQualitySection.svelte`, `src/lib/get-data/WhatSections.svelte`,
  `src/lib/get-data/NowControls.svelte`, `src/lib/get-data/GetDataView.svelte` (the alert-level
  block at :832–916, the Save block reasons), the messages
- Test: `src/lib/get-data/get-data-view.browser.test.ts` (or the browser test file that covers
  the Air quality section today; find it by grepping for `AirQualitySection`)

**Interfaces:**
- Consumes: Task 1 (`withThreshold`, `keptThreshold(…, entryType)`, `resolveThreshold(…, entryType)`)
  and Task 2 (`currentPollutants`, `setCurrentPollutants`).
- `AirQualitySection` gets a `multiple: boolean` prop. When it's true:
  - the pollutants render as checkboxes (`type="checkbox"`) in the given order, with no None;
  - `onpollutants(entryTypes: string[])` replaces `onpollutant`.
  - With `multiple` false it behaves as today. Current conditions passes `multiple`; every other
    type passes false.
- `GetDataView`:
  - `alertLevels` becomes a map keyed by `entryType`, each entry `Level[] | "unavailable"`.
  - Each pollutant's scale loads once, retries on its own, and is shared by the Chart's line path.
  - `setNowPollutants(entryTypes)`:
    - writes the layers through `setCurrentPollutants`;
    - gives each newly ticked pollutant the default level from `keptThreshold(undefined, levels, true, entryType)` (C3);
    - drops the thresholds of unticked pollutants through `withThreshold`.
  - `setThreshold(entryType, level)` goes through `withThreshold`.
  - With no pollutant ticked, Save is blocked with "Choose a pollutant", and the preview shows the
    same (C2).
- `NowControls` takes a list of `{ entryType, label, levels, threshold }`. It renders one
  alert-level select per pollutant, labelled "Alert level for {pollutant}", each with its own
  "Couldn't load, retry" and its own "replaced" note. With one pollutant it reads as today.
  "Can we go outside?" passes its one pollutant.

- [ ] **Step 1: Failing browser tests.**
  - Current conditions shows checkboxes and no None.
  - Ticking Ozone beside PM2.5 adds an ozone layer and an ozone alert level at its scale's tier-2
    default, and shows two alert selects named "Alert level for PM2.5" and "Alert level for
    Ozone".
  - Unticking PM2.5 drops its alert level and keeps the searched monitor (Review Focus 1).
  - Unticking every pollutant leaves the checkboxes enabled and blocks Save with "Choose a
    pollutant".
  - With ozone's levels failing to load, only the ozone select is replaced by "Couldn't load"
    and retry, and the PM2.5 select still works (Review Focus 3).
  - A Chart's What still shows radios with None.
- [ ] **Step 2:** Run `npx vitest run --project browser src/lib/get-data`. Expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run the same command. Expect PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: "Data Portal: pollutant checkboxes and an alert level per pollutant".

### Task 5: The card, one row per pollutant

**Files:**
- Create: `src/lib/widgets/current/CurrentRow.svelte`
- Modify: `src/lib/widgets/current/CurrentWidget.svelte`,
  `src/lib/widgets/shared/MarkFrame.svelte` (it takes the mark key; see Task 6's interface), the
  messages
- Test: `src/lib/widgets/current/current-widget.browser.test.ts`

**Interfaces:**
- Consumes: Task 2's `onePollutant` and `currentPollutants`.
- `CurrentRow` (props: `widget: WidgetInstance` already cut by `onePollutant`, and `markKey: string`):
  - owns one `CurrentConditions`;
  - renders today's body (value, units, `LevelChip`, trend, guidance, "updated", toggletip)
    inside its own `MarkFrame`;
  - shows its own empty, stale, retired, error and retry states.
- `CurrentWidget` renders one `CurrentRow` per `currentPollutants(widget.data)`, keyed by
  `entryType`, in a scrolling column when they don't fit. With no place it keeps today's idle
  state (one "Choose a place or monitor", not one per row).
- The generated title (C5): one pollutant gives today's "PM2.5 · Fresno"; several give the names
  as a list, then the place. It is set once every row's meta is known.

- [ ] **Step 1: Failing browser tests.**
  - A two-pollutant widget shows two rows, each with its value and level label.
  - When the place has no ozone data, the ozone row says "No data", and the PM2.5 row still shows
    its value (Review Focus 4).
  - A one-pollutant widget looks as it does today (keep the existing tests passing unchanged).
  - With no place there is a single idle message.
  - The title is "PM2.5 and Ozone · {place}".
- [ ] **Step 2:** Run `npx vitest run --project browser src/lib/widgets/current`. Expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run the same command. Expect PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: "Current conditions: one row per pollutant".

### Task 6: The threshold watcher per pollutant

**Files:**
- Modify: `src/lib/thresholds/ThresholdWatcher.svelte`, `WatchedWidget.svelte`, `marks.svelte.ts`,
  `watcher.svelte.ts` (the `watching` ids), `watched.ts`, `told.ts` (key bounds), and
  `src/lib/components/dashboard/Taskbar.svelte`
- Test: `src/lib/thresholds/watcher.browser.test.ts`, `src/lib/thresholds/marks.test.ts`,
  `src/lib/thresholds/told.test.ts`

**Interfaces:**
- Produces, in `marks.svelte.ts`:
  - `markKey(widgetId: string, entryType?: string): string`, which is `${widgetId}:${entryType}`
    with `entryType` and `widgetId` without one. "Last told", marks and the notification tag all
    use it.
  - `widgetMark(widgetId: string, keys: string[]): ThresholdMark | undefined`, the first marked
    key in order (C4). The taskbar uses it.
- `ThresholdWatcher` renders one `WatchedWidget` per watched widget and pollutant. For Current
  conditions that is `onePollutant(widget, e)` for each `e` with a threshold. Every other type
  keeps one, keyed by the widget id. `watching()` returns those keys.
- `watchesThresholds` is unchanged: a widget with any threshold is watched.
- `told.ts`: `TOLD_MAX` stays 500. Key length: bound the record key at
  `LIMITS.ID_MAX + 1 + LIMITS.CODE_MAX`.
- `WatchedWidget` reads the widget it's given, with no `asPm25` (Task 3). Its "what the reading
  is of" key, `watchedKey`, covers its own pollutant only, so changing ozone leaves PM2.5's "last
  told" alone.

- [ ] **Step 1: Failing tests.**
  - `marks.test.ts`: `markKey("w1","o3")` is `"w1:o3"`, and `widgetMark` returns the first marked
    key in order.
  - `watcher.browser.test.ts` (Review Focus 5):
    - A two-pollutant widget crossing on both fires two toasts, each naming its pollutant, and
      stores two told entries.
    - Changing the ozone alert level then forgets only `w1:o3`.
    - Removing the widget prunes both.
    - The taskbar item is marked when either pollutant is.
- [ ] **Step 2:** Run `npx vitest run --project browser src/lib/thresholds` and
  `npx vitest run --project unit src/lib/thresholds`. Expect FAIL.
- [ ] **Step 3:** Implement the code.
- [ ] **Step 4:** Run the same commands. Expect PASS. Run `npm run check`.
- [ ] **Step 5:** Commit: "Threshold watcher: one watch per pollutant".

### Task 7: E2E, docs and the final checks

**Files:**
- Modify: `e2e/current.spec.ts`, `e2e/thresholds.spec.ts`, and the E2E fake if ozone's levels or
  readings are missing (copy shapes from a real local response, as 7a did), `ARCHITECTURE.md`
  (the now widgets and thresholds parts), `DEFERRED.md`, the spec's "Calls made during the build"
  (a 7b list)
- Test: the E2E specs above

- [ ] **Step 1:** E2E tests.
  - Build a Current conditions widget with PM2.5 and Ozone at a county: the card shows two rows,
    and the alert levels save per pollutant (reload keeps them).
  - Show it as a Chart: one PM2.5 line and the "Ozone was left out" note.
  - Pin noon Pacific, and also run under `TZ=America/New_York`.
- [ ] **Step 2:** `DEFERRED.md`:
  - C1's entry ("'Can we go outside?' with several pollutants: combining their guidelines") is
    already there (added with this plan); check it still matches what was built;
  - add anything else this build defers.
- [ ] **Step 3:** `ARCHITECTURE.md`: per-pollutant thresholds (`entryType`), marks and told keyed
  by `markKey`, the card's rows, Outside reading `guidelinePollutants`.
- [ ] **Step 4:** Run everything, one after another:
  - `npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:browser`,
    `npm run test:e2e`;
  - the two E2E specs on Firefox;
  - `npm run build && npm run check:budget`, and report the number.
- [ ] **Step 5:** Commit: "Spec 7b: E2E and docs".
