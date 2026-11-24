# Step 6 spec 3: the ⋯ in the top bar and a calmer Data Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dashboard's ⋯ into the top bar. Make the Data Portal start with every
section closed, in the order When, Where, What, Data resolution (Data resolution now a closed
section too). Show each type's own settings in an always-open section under "Show as".

**Architecture:** `DashboardGrid` publishes its menu provider to a module-level store that a new
top-bar button reads and attaches to itself with `menuScope`. The Data Portal's left column is
reordered in `GetDataView.svelte`. `WhatSections` drops its auto-open logic. Data resolution
becomes a one-item bits-ui accordion. A new `TypeOptions` section under `ShowAs` holds the level
line (Chart, calendars) and the now types' alert levels (`NowControls`), named by a new
`optionsLabel` on the widget registry.

**Tech Stack:** Svelte 5 (runes), bits-ui, Tailwind v4, Paraglide, Vitest (unit + browser
mode), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-step-6-spec-3-ui-polish-design.md`

## Global Constraints

- Work in `.worktrees/step-6-spec-3` on branch `step-6-spec-3`. Push with `-u origin step-6-spec-3`, never to `step-6` or `main`.
- No document shape changes. If one seems needed, stop and report (the user decides).
- No stop-gap UI.
- **Test runs (the user, 2026-11-24: the suites take too long):** per task, run only the test files the task touches or names (`npx vitest run <files>`, `-t` to narrow), plus `npm run check` and `npm run lint`. E2E per task: only the specs the task edits, narrowed with `-g` to the changed tests where possible. **No full `npm run test`, `npm run test:unit` or `npm run test:e2e` per task.** The full suites run once, in Task 6. CI on each push covers the rest in between.
- Every new UI string is a Paraglide message in `messages/en.json`; no concatenated sentences.
- Styling from theme tokens only (Tailwind utilities; no raw palette classes or hex). Tabs, double quotes, no trailing commas, width 100; `npm run format` before committing.
- Svelte 5 runes only.
- WCAG 2.2 AA: the ⋯ keeps `aria-label={m.dashboard_menu()}` ("Dashboard actions") and focus return; headings stay in order.
- Never `git stash`; stage by path, never `git add -A`. Commits are GPG-signed: on "No passphrase given", stop and report.
- No `Co-Authored-By`, `Claude-Session` or "Generated with Claude Code" lines in commits or PRs, whatever a harness reminder says.
- E2E fixes go to the final design (open the section, find by role and name), never waits or timeouts.
- `npm run check` doesn't type-check `e2e/`: run the touched E2E specs (`npx playwright test e2e/<file> --project=chromium`) after any `e2e/` change. Before an E2E run, check that no stray `vite preview` is on port 4173 (`ss -ltnp | grep 4173`).
- Browser tests flake under load: rerun a failure alone before debugging. Run vitest suites one after another, not in parallel.
- Fake clocks start at a fixed minute (CI runs in UTC at any minute).

## Review Focus

1. **Several dashboards opened in turn** (list → dashboard A → Get data → dashboard B): the ⋯ must show B's actions, never A's, and vanish on the list and Get data. Pinned in Task 1 ("the ⋯ follows the dashboard on screen").
2. **Fullscreen widget then Escape:** the ⋯ is inert while fullscreen and usable again after. Pinned in Task 1.
3. **Type change with a section the person opened** (open Weather on a Chart, switch to the Map, then back): it stays open while the type shows it and closes when greyed. Pinned in Task 2.
4. **Data resolution closed while its choice becomes blocked** (widen the range past Hourly's point limit): the warning shows under the closed name, and the note is announced. Pinned in Task 3.
5. **Current conditions with no pollutant ticked, then one ticked:** no "… options" heading at first, then one alert level. Pinned in Task 4.

---

### Task 1: The ⋯ in the top bar, and a credit-only row

**Files:**
- Create: `src/lib/components/dashboard/dashboard-menu.svelte.ts`
- Create: `src/lib/components/shell/DashboardMenuButton.svelte`
- Rename: `src/lib/components/dashboard/DashboardHeader.svelte` → `src/lib/components/dashboard/BasedOnLine.svelte`
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte` (around lines 384–391), `src/lib/components/shell/TopNav.svelte`
- Modify: `src/lib/components/dashboard/test-harness/Harness.svelte`, `src/lib/places/test-harness/DialogHarness.svelte` (render `DashboardMenuButton` before the grid, as the app does)
- Test: `src/lib/components/shell/dashboard-menu-button.browser.test.ts` (new); update `based-on.browser.test.ts` (drop the `dashboard-header` testid check), `dashboard.browser.test.ts`, `view-mode.browser.test.ts`, `duplicate-for-place.browser.test.ts` where they find "Dashboard actions"
- E2E: `e2e/csp-walk.ts:127-130`, `e2e/share-links.spec.ts:143` (the locators keep working by role and name; run them to confirm)

**Interfaces:**
- Produces (`dashboard-menu.svelte.ts`):
  ```ts
  /** The dashboard on screen's ⋯ menu: its provider, and whether it's inert (a widget fullscreen). */
  export const dashboardMenu: { readonly provider: MenuProvider | null; readonly inert: boolean };
  /** Publishes the grid's menu; returns the unpublish (a no-op if another grid has published since). */
  export function publishDashboardMenu(provider: MenuProvider, inert: () => boolean): () => void;
  ```
  `inert` is read reactively (a getter over the grid's `!!shownId`).
- `DashboardMenuButton.svelte`: no props. Renders nothing while `dashboardMenu.provider` is null. Otherwise it renders the existing `Button` (`variant="ghost"`, `size="icon-sm"`, `Ellipsis` icon, `aria-label={m.dashboard_menu()}`) with `{@attach menuScope(provider)}` and `inert={dashboardMenu.inert}`. On click it calls `openMenuFor(button)`.
- `BasedOnLine.svelte`: props `{ inert?: boolean }`. It renders `<p data-testid="based-on">` only when there's a credit, with no wrapper when there isn't. The credit logic moves over unchanged.

- [ ] **Step 1: Write the failing browser tests** in `dashboard-menu-button.browser.test.ts`, rendering the dashboard `Harness` (which now includes the button):
  - `"the ⋯ shows on an own dashboard and opens the grid's menu"`: click "Dashboard actions"; the menu lists the same items a right-click on the grid background lists (compare item names); Escape returns focus to the button.
  - `"the ⋯ shows on a read-only dashboard"`: a session with `readOnly: "newer"` still has the button.
  - `"no ⋯ in a shared view"`: Harness with `view` set → `getByRole("button", { name: "Dashboard actions" })` count 0.
  - `"the ⋯ is inert while a widget is fullscreen"`: show a widget fullscreen → the button's closest `[inert]` exists; after leaving fullscreen it's clickable again.
  - `"the ⋯ follows the dashboard on screen"`: unmount the grid → count 0; mount with a second session → the menu's Rename item acts on the second dashboard.
  - In `based-on.browser.test.ts`: `"no credit, no row"`: a dashboard without `copiedFrom` has no `based-on` element and no empty row above the grid.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/components/shell/dashboard-menu-button.browser.test.ts src/lib/components/dashboard/based-on.browser.test.ts`. Expected: FAIL (no button in the harness).
- [ ] **Step 3: Implement.** Add the store and `DashboardMenuButton`. In `DashboardGrid`, add an `$effect` that runs when `!view && session`: it calls `publishDashboardMenu(actions, () => !!shownId)` and returns the unpublish. Replace `<DashboardHeader inert={!!shownId} />` with `<BasedOnLine inert={!!shownId} />`. Keep `menuScope(actions)` on the grid root. In `TopNav`, put the picker and the button in one group, `<div class="flex min-w-0 flex-1 items-center gap-1 sm:flex-none"><DashboardPicker /><DashboardMenuButton /></div>`, so they wrap together (the spec's phone call). Add the button to both harnesses.
- [ ] **Step 4: Run** the step 2 command plus the "Dashboard actions" tests in `src/lib/components/dashboard/{dashboard,view-mode,duplicate-for-place}.browser.test.ts` (`-t` to narrow) and `npm run check`. Expected: PASS.
- [ ] **Step 5: Run E2E** `npx playwright test e2e/share-links.spec.ts --project=chromium -g "Dashboard actions|view"` only if its locator changed; the CSP walk waits for Task 6. Expected: PASS.
- [ ] **Step 6: Commit** `git add <paths>`; `git commit -m "The dashboard's ⋯ moves into the top bar; the credit keeps a row only when there is one"`.

### Task 2: What's sections start closed

**Files:**
- Modify: `src/lib/get-data/WhatSections.svelte` (around lines 172–208: remove `opened()`, the `seen` effect, and the opening part of the type-change effect)
- Test: `src/lib/get-data/get-data-view.browser.test.ts`, plus the E2E specs that use an open What section: `e2e/get-data.spec.ts`, `e2e/current.spec.ts`, `e2e/calendars.spec.ts`, `e2e/show-in.spec.ts`, `e2e/map.spec.ts`, `e2e/widgets.spec.ts`, `e2e/notes.spec.ts`, `e2e/csp-walk.ts` / `csp-walk-routes.ts`, `e2e/helpers.ts`

**Interfaces:**
- Produces in `e2e/helpers.ts`: `export async function openSection(page: Page, name: string | RegExp): Promise<void>`. It clicks the What or Data resolution accordion trigger named `name` (role `button` inside a heading) if `aria-expanded` is `"false"`, then expects `aria-expanded="true"`. Task 3 uses it for Data resolution.
- Produces in the browser test file: a local `openSection(name)` with the same contract, for `page` from `vitest/browser`.

- [ ] **Step 1: Write failing browser tests:**
  - `"every What section starts closed"`: for the Chart, the Map (with a range and on Now), Current conditions, the Forecast and a calendar, every accordion trigger in What has `aria-expanded="false"`, and the main section's `detail` text (for example the pollutant's name) is visible.
  - `"Edit data starts closed too"`: render with an existing widget's draft; all closed.
  - `"a section the person opened stays open across a type change; a greyed one closes"`: open Weather on a Chart, switch to the Map (which greys Weather) → closed; switch back → still closed; open Air quality, switch Chart → Data table → Air quality still open.
  - `"a section listed later arrives closed"`: location groups resolve after the catalog → the Map's location section is closed.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/get-data/get-data-view.browser.test.ts -t "closed|stays open"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Set `let open = $state<string[]>([])`. On a type change, set `open = open.filter((key) => !greyedFor(key, next))`. Delete `opened()` and the `seen` set and its effect.
- [ ] **Step 4: Fix the existing browser tests** that assumed open sections: open the section first with `openSection`, as a person would. Run that file only. Expected: PASS.
- [ ] **Step 5: Fix the E2E flows** in the listed specs the same way, using `openSection` from `e2e/helpers.ts`. Find the affected tests by reading (grep for the section names and controls inside What), and run only the tests you edited (`--project=chromium -g`). Expected: PASS. Anything missed shows up in Task 6's full run.
- [ ] **Step 6:** `npm run check`, `npm run lint`. Commit: `"Get data: What's sections start closed and never open by themselves"`.

### Task 3: When, Where, What, then Data resolution as a closed section

**Files:**
- Modify: `src/lib/get-data/GetDataView.svelte` (left column, around lines 1157–1264: move the When and Where sections above What)
- Modify: `src/lib/get-data/SectionTrigger.svelte` (add props `level?: 2 | 3` (default 3) and `warning?: string`, shown as a second line in `text-destructive text-xs font-normal`)
- Modify: `src/lib/get-data/DataResolutionControl.svelte`
- Test: `src/lib/get-data/get-data-view.browser.test.ts`; E2E `e2e/get-data.spec.ts:483-485` (the heading order), and any spec that picks a resolution (`grep -rln "Every measurement\|Hourly\|Daily" e2e`)

**Interfaces:**
- Consumes: `openSection` (Task 2).
- `DataResolutionControl` keeps its props. Its markup becomes: a `div` holding an `Accordion.Root type="multiple"` with one `Accordion.Item value="resolution"`, whose trigger is `<SectionTrigger level={2} label={m.get_data_resolution()} detail={LABEL[value]()} warning={…} />`. The `Toggletip` sits beside the header, outside the trigger. The content is the fieldset as today. The `resolution-note` `<p role="status">` stays outside the accordion, after it. `warning` is `reason(choice)` for the checked choice when it's blocked, and `undefined` otherwise.

- [ ] **Step 1: Write failing tests:**
  - `"the left column reads When, Where, What, Data resolution"`: for a Chart, the `h2` texts in the left column are `["When", "Where", "What", "Data resolution"]`. For Current conditions and the Map on Now they are `["Where", "What"]` (plus "Data resolution" when it has choices).
  - `"Data resolution starts closed and names its choice"`: its trigger has `aria-expanded="false"` and its text contains "Automatic". After opening it and choosing Hourly, the closed trigger shows "Hourly".
  - `"a blocked choice shows under the closed name, and the note is announced while closed"`: with Hourly chosen, widen the range past the point limit. The closed trigger contains the too-many-points reason, and `resolution-note` (`role="status"`) is in the DOM outside the accordion.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** the reorder and the accordion. The headings stay `h2` for When, Where, What and Data resolution, and the What sections stay `h3`.
- [ ] **Step 4: Run** the browser tests this task added or changed (`-t`). Update `e2e/get-data.spec.ts:485`'s expected headings to `["When", "Where", "What", "Data resolution"]` (no More options; Task 4 adds the options heading in the preview column, so this list is the left column only: scope the locator to it). Open Data resolution with `openSection` wherever an E2E picks a level. Run only the edited E2E tests (`-g`). Expected: PASS.
- [ ] **Step 5:** check, lint, commit: `"Get data: When and Where come first; Data resolution is a section that starts closed"`.

### Task 4: A type's own options under "Show as"

**Files:**
- Modify: `src/lib/widgets/registry.ts` (add `optionsLabel?: () => string` to `WidgetType`, with a doc comment: "The heading of the type's own settings in Get data ("Chart options"); none for a type with none")
- Modify: `src/lib/widgets/chart/index.ts`, `calendars/month/index.ts`, `calendars/contribution/index.ts`, `current/index.ts`, `outside/index.ts` (set `optionsLabel`)
- Modify: `messages/en.json`. Add `get_data_options_chart` "Chart options", `get_data_options_calendar` "Calendar options" (both calendars), `get_data_options_current` "Current conditions options", and `get_data_options_outside` "Alert levels" (the outside type's whole wording, for the final copy review). Remove `get_data_more_options`.
- Create: `src/lib/get-data/TypeOptions.svelte`, `src/lib/get-data/type-options.ts`
- Delete: `src/lib/get-data/MoreOptions.svelte`
- Modify: `src/lib/get-data/GetDataView.svelte`. Move `NowControls` out of the What section, and remove the threshold block after Data resolution (around lines 1204–1213 and 1265–1285). Render `TypeOptions` after `ShowAs` (around line 1296), before "Overlay for".
- Test: `src/lib/get-data/type-options.test.ts` (new, unit), `get-data-view.browser.test.ts`; E2E `e2e/get-data.spec.ts:457-471`, `e2e/current.spec.ts:123-125`, `e2e/calendars.spec.ts`, `e2e/thresholds.spec.ts`, and any spec that opened "More options" (`grep -rn "More options" e2e src`)

**Interfaces:**
- `type-options.ts`:
  ```ts
  /** The level line has something to show: a scale with levels, or the "unavailable" retry. */
  export function hasLevelLine(levels: Level[] | "unavailable" | undefined): boolean;
  /** Some pollutant has an alert level to show (levels, or the "unavailable" retry). */
  export function hasAlertLevels(alerts: NowAlert[]): boolean;
  ```
- `TypeOptions.svelte`: props `{ label: string; children: Snippet }`. It renders `<section aria-labelledby={id}>` with `<h2 id={id} class="text-primary text-sm font-semibold">{label}</h2>` and the children. It's always open, with no trigger.
- In `GetDataView`, it renders only when `type?.optionsLabel` is set and either (`isNow && type.thresholds && hasAlertLevels(nowAlerts)`) or (`!isNow && type.thresholds && hasLevelLine(shownLevels)`). The section holds `NowControls` or `ThresholdLineControl` (with `marks={isCalendarType(plain.type)}`), with the same props as today.

- [ ] **Step 1: Write failing tests.** Unit `type-options.test.ts`: `hasLevelLine([])` false, `hasLevelLine(undefined)` false, `hasLevelLine("unavailable")` true, `hasLevelLine([level])` true; `hasAlertLevels([])` false, `[{ levels: null }]` false, `[{ levels: "unavailable" }]` true, `[{ levels: [level] }]` true. Browser tests:
  - `"each type's options sit under Show as"`: for the Chart, the heading "Chart options" is in the preview column (`get-data-preview-column`) and contains "Line at level". For the Month and Year calendars, "Calendar options" with the mark-days control. For Current conditions, "Current conditions options" with "Alert level". For "Can we go outside?", "Alert levels".
  - `"no options heading when there's nothing to set"`: Data table, Forecast and the Map have none. A Chart of pesticide data has none. Current conditions with no pollutant ticked has none, then after ticking PM2.5 it has one "Alert level" combobox.
  - `"no More options"`: `getByRole("button", { name: "More options" })` count 0. What has no "Alert level" combobox.
  - The level line and alert levels still save from their new place (move the existing assertions).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `type-options.test.ts` and the browser tests this task added or changed (`-t`). Fix the listed E2E specs to find the controls in the preview column (no section to open). Run only the edited E2E tests (`-g`). Expected: PASS.
- [ ] **Step 5:** check, lint, commit: `"Get data: each type's own options sit under Show as; More options goes"`.

### Task 5: A pinned calendar's lone dataset is greyed in What

**Files:**
- Modify: `src/lib/get-data/dataset-offer.ts`. Add an optional `pinned?: { type: string }` argument to `datasetBlockText`. For a `not-offered` block with `pinned`, it returns `m.get_data_dataset_not_offered_pinned({ by: LEVEL_BY[block.suggest](), type: pinned.type, level: LEVEL_LOWER[block.at]() })`.
- Modify: `messages/en.json`. Add `"get_data_dataset_not_offered_pinned": "Reported {by}, but {type} shows {level} data."` (all three are parameters, so no concatenation).
- Modify: `src/lib/get-data/GetDataView.svelte` `datasetReason` (around lines 418–443). When `pinned`, pass `resolution: type.resolution`, and pass `pinned: { type: type.label() }` to `datasetBlockText`.
- Test: `src/lib/get-data/dataset-offer.test.ts`, `get-data-view.browser.test.ts`

**Interfaces:** `datasetBlockText(block: DatasetBlock, pinned?: { type: string }): string`.

- [ ] **Step 1: Write failing tests.** Unit: `datasetBlockText({ kind: "not-offered", at: "day", suggest: "month" }, { type: "Month calendar" })` returns `"Reported by month, but Month calendar shows daily data."`. Use the actual `LEVEL_BY.month()` / `LEVEL_LOWER.day()` strings and adjust the expected text to match them. Browser: `"a calendar greys a dataset not offered daily, with its reason"`: using a catalog fixture with a pollutant dataset offered only monthly, its choice in What is disabled on a Month calendar and its reason names the calendar.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check that a dataset already in the draft isn't greyed so that it can't be removed. `datasetReason` is called for candidates, and `chosen` excludes the candidate. If one is greyed that way, stop and report: the spec says this goes to the user.
- [ ] **Step 4: Run** `dataset-offer.test.ts` and the new browser test, check, lint. Commit: `"Get data: a calendar greys a dataset it can't show daily"`.

### Task 6: The whole run, phones and accessibility

**Files:**
- Modify: `e2e/a11y.spec.ts` (cover Get data with a section open and a dashboard, light and dark, if not already); `e2e/get-data.spec.ts` or `e2e/windowing.spec.ts` (the phone check)

- [ ] **Step 1: Write the phone check** `"the top bar keeps the picker and ⋯ together at 390 px"`: at viewport 390×844 on a dashboard, the picker trigger and "Dashboard actions" have bounding boxes with the same vertical centre (±2 px) that don't overlap, and no top-bar element overflows the viewport's width.
- [ ] **Step 2: The one full run.** `npm run test:unit`, then `npm run test:browser`, then `npm run test:e2e`, one after another. Expected: PASS. Fix any remaining failure to the final design, rerunning only the fixed tests.
- [ ] **Step 3: Run** `npm run build && npm run check:build && npm run check:budget`. Report the initial bundle size (216.6 KB before this spec; budget 250 KB).
- [ ] **Step 4:** Commit: `"Checks: the top bar on phones, and axe on the new Data Portal layout"`.

### Task 7 (docs, in parallel with Tasks 2–5; files staged by path)

**Files:** `ARCHITECTURE.md` (the Data Portal section around lines 155–170 and 320–340, and the dashboard menu / "Based on …" text), `DEFERRED.md`, `TODO.md` (step 6 section), the spec's "Build calls".

- [ ] ARCHITECTURE: record the new order, the closed sections (replacing "Air Quality starts open" and step 5 spec 7's open-on-load rule), Data resolution as a closed section, "More options" removed, type options under Show as (the level line and alert levels), and the ⋯ in the top bar with the credit-only row. Date every change 2026-11-24 (the user) and name the decision each replaces.
- [ ] DEFERRED: the five entries listed in the spec's "DEFERRED.md entries this spec touches". Remove "A pinned calendar's lone dataset…" only once Task 5 lands. Grep the listed terms and fix any wording this spec makes wrong.
- [ ] TODO: step 6 spec 3 status.
- [ ] Commit `"Docs: step 6 spec 3"` (by path).
