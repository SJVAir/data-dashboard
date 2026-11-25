# Data Portal: type options in a dropdown, Map options, one Pesticides section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The type's own options open from a button beside "Show as" in a floating panel; the Map's
location groups and "Fill regions by" move out of What into "Map options"; Pesticide use and
Pesticide notices become one "Pesticides" section.

**Architecture:** A `TypeOptionsButton.svelte` (bits-ui Popover) replaces the always-open
`TypeOptions.svelte` section in `GetDataView.svelte`. The Map's location and fill controls move
from `WhatSections.svelte` snippets into a `MapOptions.svelte` component shown inside that
popover. `whatSections()` stops listing the location and fill sections and lists one `pesticides`
section in place of the two pesticide sections. No saved-document shape changes.

**Tech Stack:** Svelte 5 runes, bits-ui Popover (`$lib/components/ui/popover`), Paraglide,
Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-data-portal-options-design.md`

## Global Constraints

- All UI strings through Paraglide; no concatenated sentences (lists through `formatList`).
- Metadata is the source of truth: group labels, type labels and dataset labels come from the
  meta/catalog as today; only the headings "Map options", "Points of interest" and "Pesticides" are
  new messages.
- Theme tokens only; WCAG 2.2 AA (button names, `aria-expanded`, focus return, 24×24 targets).
- No stop-gap: each task leaves the Data Portal complete and the suites it touches green.
- Saved documents unchanged: the same layers, `options` and `thresholds` are written.
- Tabs, double quotes, no trailing commas, width 100. No AI attribution in commits.
- Per task: only the touched test files (narrowed with `-t`/`-g`, or `npx vitest related <files>
--run`), plus `npm run check` and `npm run lint`. Full suites once, at the end. Vitest runs one at
  a time. Subagents never use `git stash`.

## Review Focus

1. **No location groups (meta failed or still loading) and no fill types:** the Map shows no
   "Map options" button and nothing errors (Task 2 test).
2. **A saved location type the meta dropped** still shows ticked in "No longer offered" inside
   Map options and can be unticked (Task 2 test).
3. **Switching Show as while the panel is open** closes it; the new type's button (if any)
   appears closed; focus stays on the Show as switch (Task 1 test).
4. **Chart with a saved pesticide use layer:** Pesticides is enabled, its closed detail names the
   measure, Notices shows greyed "Only for Map" (Task 3 test).
5. **Phone width (390 px) with the panel open:** the panel fits the viewport and scrolls inside;
   axe passes (Task 4 E2E).

---

### Task 1: The type's options open from a button beside Show as

**Files:**

- Create: `src/lib/get-data/TypeOptionsButton.svelte`
- Delete: `src/lib/get-data/TypeOptions.svelte`
- Modify: `src/lib/get-data/GetDataView.svelte` (the preview column, ~lines 1271–1291)
- Test: `src/lib/get-data/get-data-view.browser.test.ts` (and any test that reads the options as an
  always-open section: `grep -rn "Chart options\|Alert levels\|Calendar options" src e2e`)

**Interfaces:**

- Produces: `TypeOptionsButton.svelte` props `{ label: string; children: Snippet }`; renders a
  `Button` (`variant="outline" size="sm"`, text `label`, lucide `ChevronDown` `aria-hidden`) as the
  Popover trigger (`aria-haspopup="dialog"`, `aria-expanded` from bits-ui) and a
  `Popover.Content` (`align="end"`, `aria-label={label}`, classes
  `w-80 max-w-[calc(100vw-2rem)] max-h-(--bits-popover-content-available-height) overflow-y-auto`)
  holding `children`. `open` is bindable.
- In `GetDataView`: Show as and the button sit in one `flex flex-wrap items-center gap-2` row; the
  button renders when today's `showTypeOptions && type?.optionsLabel`; `open` resets to `false`
  when `plain.type` changes.

- [ ] **Step 1: Failing browser tests** in `get-data-view.browser.test.ts`:
  - `a Chart's options open from the Chart options button beside Show as, over the preview` —
    button named "Chart options" with `aria-expanded="false"`; no level-line control in the page;
    click → `aria-expanded="true"`, the dialog named "Chart options" holds the level-line control;
    the preview's bounding box top is unchanged before vs. after opening; Escape closes it and focus
    is on the button.
  - `Current conditions' alert levels open from the Alert levels button` — the alert controls only
    after opening.
  - `switching Show as closes the options panel` (Review Focus 3).
  - Update the existing tests that read the level line / alert levels directly (the 2500–2660
    block, and any others the grep finds) to open the button first (add a test helper
    `openTypeOptions(name: string)` in `src/test/sections.ts`).
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run --project browser src/lib/get-data/get-data-view.browser.test.ts -t "options|Alert levels|closes the options"`.
- [ ] **Step 3: Implement** `TypeOptionsButton.svelte`, use it in `GetDataView`, delete
      `TypeOptions.svelte`.
- [ ] **Step 4: Run** the whole `get-data-view.browser.test.ts` and `src/routes/get-data.browser.test.ts`;
      E2E files that touch the options: `npx playwright test e2e/get-data.spec.ts e2e/current.spec.ts e2e/calendars.spec.ts --project=chromium -g "level|alert|line"` (update them to open the button
      first); `npm run check`, `npm run lint`. Expect PASS.
- [ ] **Step 5: Commit** `Data Portal: the type's options open from a button beside Show as`.

### Task 2: Map options (Points of interest, Fill regions by)

**Files:**

- Create: `src/lib/get-data/MapOptions.svelte`
- Modify: `src/lib/get-data/what-sections.ts` (drop location and fill sections),
  `src/lib/get-data/WhatSections.svelte` (drop `locationsSection`, `fillSection`, their `chosen`
  and `labelOf` cases and the `map.fill*`/`map.location*` props), `src/lib/get-data/GetDataView.svelte`,
  `src/lib/widgets/map/index.ts` (`optionsLabel`), `messages/en.json`
- Test: `src/lib/get-data/what-sections.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`,
  `e2e/map.spec.ts` (~2216), `e2e/get-data.spec.ts` (~511), `e2e/a11y.spec.ts` (~62)

**Interfaces:**

- Messages: `"get_data_options_map": "Map options"`, `"getdata_map_points_of_interest": "Points of interest"`.
- `mapType.optionsLabel = () => m.get_data_options_map()`.
- `whatSections(catalog, offered, layers)` — the `groups` parameter is removed; `FILL`,
  `LOCATIONS_GONE`, `locationSectionKey` and the location branch of `sectionTypes` go. Keep
  `toggledLocationTypes` and `goneTypes` (export `goneTypes`; `MapOptions` uses both).
- `MapOptions.svelte` props: `{ groups: LocationGroup[] | undefined; ticked: string[];
onlocations: (types: string[]) => void; fill: string | undefined; fillTypes: RegionTypeInfo[];
onfill: (type: string | undefined) => void }`. Renders, with `h3` headings and no accordions:
  "Points of interest" (one `fieldset` per group, legend = the group's meta label, a checkbox per
  type in the meta's order; then a "No longer offered" fieldset (`getdata_map_locations_gone`) for
  `goneTypes(groups, ticked)`, ticked, untickable) — shown when `groups` has a group or a gone type;
  "Fill regions by" (today's radios: None + `fillTypes`) — shown when `fillTypes.length > 0`.
- `GetDataView`: for the Map, the options button shows when `MapOptions` has anything to show
  (`(locationGroups?.length ?? 0) > 0 || gone types || fillTypes.length > 0`), and its children are
  `<MapOptions … />` with the props today passed in `map={{ … }}`.

- [ ] **Step 1: Failing tests.**
  - Unit (`what-sections.test.ts`): rewrite the "location groups" and fill expectations:
    `whatSections` never lists `locations:*`, `locations-gone` or `fill`; delete tests of removed
    exports; keep `toggledLocationTypes` tests.
  - Browser: `the Map's Points of interest and Fill regions by are in Map options, not What` — What
    has no "Schools", "Child care" or "Fill regions by" section; open "Map options" → checkboxes
    under "Schools" tick the locations layer (`locationTypes` saved as today); "Fill regions by"
    radios set `options.fill`.
  - Browser: `a Chart's What lists no Map settings, greyed or not` — no "Schools", "Fill regions by"
    buttons at all.
  - Browser: `with no groups and no fill types the Map has no options button` (Review Focus 1).
  - Browser: `a saved type the meta dropped shows ticked under No longer offered and can be unticked` (Review Focus 2).
  - Move the existing Data Portal location/fill browser tests to open Map options instead of a
    section (`grep -n "Schools\|Child care\|Fill regions\|locations-gone" src/lib/get-data/*.browser.test.ts`).
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run --project unit src/lib/get-data/what-sections.test.ts`, then the browser file with `-t "Map options|Map settings|No longer offered|no options button"`.
- [ ] **Step 3: Implement** `MapOptions.svelte`, the `whatSections`/`sectionTypes` changes, the
      `WhatSections` removals, the Map's `optionsLabel` and the `GetDataView` wiring.
- [ ] **Step 4: Run** the touched unit and browser files, then
      `npx playwright test e2e/map.spec.ts e2e/get-data.spec.ts e2e/a11y.spec.ts --project=chromium -g "Schools|Child care|Fill"` after updating them (open "Map options" instead of a section;
      a11y's "Fill regions by" disabled/enabled check becomes: absent on a Chart, inside Map options
      on a Map). `npm run check`, `npm run lint`.
- [ ] **Step 5: Commit** `Data Portal: Map options hold Points of interest and Fill regions by`.

### Task 3: One Pesticides section

**Files:**

- Modify: `src/lib/get-data/what-sections.ts`, `src/lib/get-data/WhatSections.svelte`,
  `messages/en.json`
- Test: `src/lib/get-data/what-sections.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`
  (the 1844–2030 Map pesticide block, 719, 1290), `e2e/get-data.spec.ts` (~158, ~350)

**Interfaces:**

- `export const PESTICIDES = "pesticides"` in `what-sections.ts`. `whatSections` lists one
  `{ key: PESTICIDES, use?: WhatSection, notices?: WhatSection }` (each part carrying today's
  `entry`/`offered`) where the first of the two pesticide sections is today, when either would
  be listed. `sectionTypes(PESTICIDES)` = the types that accept `pesticide-use`, plus the Map.
- Message: `"get_data_pesticides": "Pesticides"`.
- `WhatSections`: the `pesticides` section renders, under `h4` part headings (the parts'
  `labelOf`, i.e. the catalog labels), the Use part (Map: today's `useSection` switch, period,
  retry; others: `PesticideLayers`) then the Notices part (Map: today's switch; other types that
  show the section: the switch disabled with `get_data_section_only_for({ types: "Map" label })`
  as its reason, through the existing `reason` snippet), then — Map only — the one `filterSet()`
  when `use || notices`. `chosen()` for it: `formatList([...use labels, ...(notices ? [notices
part label] : [])])`.

- [ ] **Step 1: Failing tests.**
  - Unit: `lists one Pesticides section where pesticide use is, with use and notices as parts`;
    `sectionTypes(PESTICIDES)` is Chart, Data table and Map.
  - Browser: `the Map's Pesticides section switches use and notices, with one filter set below both`.
  - Browser: `a Chart's Pesticides section adds use measures; Notices is greyed, Only for Map`
    (Review Focus 4: with a saved use layer, the closed section's detail names the measure).
  - Browser: `a calendar greys the whole Pesticides section with its reason`.
  - Update the Map pesticide tests (1844–2030) and 719/1290 to open "Pesticides".
- [ ] **Step 2: Run, expect FAIL** (the unit file; the browser file with `-t "Pesticides"`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the touched files; update and run
      `npx playwright test e2e/get-data.spec.ts e2e/map.spec.ts --project=chromium -g "esticide|notice"`
      (`openSection(page, /^Pesticides/)`); `npm run check`, `npm run lint`.
- [ ] **Step 5: Commit** `Data Portal: one Pesticides section with Use and Notices`.

### Task 4: Phone check, docs

**Files:** `e2e/get-data.spec.ts` (new test), `ARCHITECTURE.md`, `TODO.md`.

- [ ] **Step 1: E2E** `on a phone the Map options panel fits the screen and passes axe` (390×844,
      Map type, open "Map options": the panel's box is inside the viewport, it scrolls when taller,
      `expectNoViolations(page)` with it open; light and dark). Run it; FAIL only if layout is wrong;
      fix the panel classes if so.
- [ ] **Step 2: Docs.** `ARCHITECTURE.md`: "Layout (option A)" (What lists data only; the type's
      options open from a button beside Show as; the Map's options), "More options is gone" bullet
      (now a button and panel, not an always-open section), "Schools and child care are What on the
      Map" (now in Map options; the rest unchanged), and the Map's pesticide sections (one
      Pesticides section with Use and Notices). `TODO.md`: this track's row. `DEFERRED.md`: anything
      deferred during the build, if any.
- [ ] **Step 3:** `npm run check`, `npm run lint`; commit
      `Data Portal options: phone check and docs`.

### Task 5: Full verification and review

- [ ] Push; dispatch CI's `e2e-full` early (`gh workflow run CI --ref data-portal-options`).
- [ ] `npm run test:unit`, then `npm run test:browser`, then `npm run test:e2e` (no stray
      `vite preview` on :4173). `npm run build && npm run check:budget`: report the number.
- [ ] Whole-branch review on the most capable model, report to a file; fix its findings (ask the
      user before parking any); full CI after the fix pass.
- [ ] Merge `origin/main`, open the PR into `main`, check `gh pr checks` on the PR's `headRefOid`.
      The merge waits for the user's yes.
