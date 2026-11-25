# Nav item and a closable "Change place" bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the top nav's "Dashboards" link; let a dashboard's place bar be closed for good
(undoable, cleared on copies); add "Change place…" to the dashboard's ⋯ and right-click menus.

**Architecture:** "Closed" is a flag on the document (`body.placeBar.closed`), set through
`session.apply` as one `replaceDocument` change. `barVisible` reads it; `freshCopy` drops it. The
menu item lives in the shared `dashboardActions` list, so both menus get it.

**Tech Stack:** Svelte 5 runes, zod, Paraglide, bits-ui, Vitest (unit + browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-nav-and-place-bar-design.md`

## Global Constraints

- All UI strings through Paraglide (`messages/en.json`); no generated English stored in documents.
- Theme tokens only; WCAG 2.2 AA (close button target at least 24×24, accessible name).
- Old documents must still open: `placeBar` stays a non-strict `z.object`; `closed` is optional.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only.
- No Claude/AI attribution in commits (leave out `Co-Authored-By` / `Claude-Session` lines).
- Per task: run only the touched test files (narrowed with `-t`/`-g`, or `npx vitest related <files>
--run`), plus `npm run check` and `npm run lint`. Full suites once, at the end (Task 6). Vitest runs
  one at a time, never in parallel. Subagents never use `git stash`; stage by path.

## Review Focus

1. Closing the bar on the **built-in starter** (the first edit hands off to a copy): the copy must
   end up closed, not open (Task 3 test).
2. **Undo after close** brings the bar back, and **another tab** sees the close (Task 3 test,
   through a second `DocumentSession` on the same platform).
3. **Duplicate for another place on a closed dashboard**: the copy's bar shows, at the new place
   (Task 2 test, through `index.duplicate` with `replace`).
4. **Viewer / view mode** of a closed dashboard: no bar, no close button, no menu item (Task 3 and
   Task 4 tests).
5. **"Change place…" while closed** moves the bar's place and widgets, and the bar stays closed
   (Task 4 test).

---

### Task 1: Remove "Dashboards" from the top nav

**Files:**

- Modify: `src/lib/components/shell/TopNav.svelte` (delete the `/dashboards` `<a>`)
- Modify: `e2e/helpers.ts` (add `openAllDashboards`)
- Test: `src/lib/components/shell/shell.browser.test.ts`, `src/routes/get-data.browser.test.ts`,
  `e2e/sharing.spec.ts`

**Interfaces:**

- Produces: `openAllDashboards(page: Page, current: string): Promise<void>` in `e2e/helpers.ts`:
  `openPicker(page, current)` then clicks the menu's "All dashboards" link.

- [ ] **Step 1: Update tests to the new nav.** In `shell.browser.test.ts`: line ~43 becomes
      `expect(nav.getByRole("link", { name: "Dashboards" }).query()).toBeNull()` (rename the test
      to say the nav has Data Portal and no Dashboards link); the "current page's link is marked"
      test (~140) uses `/data` and the "Data Portal" link instead. In `get-data.browser.test.ts`
      (~445) leave through the picker's "All dashboards" link instead. In `e2e/sharing.spec.ts` replace
      the 5 nav-link clicks with `openAllDashboards(page, <current dashboard name>)`.
- [ ] **Step 2: Run them, expect the shell test to fail** (the link is still there):
      `npx vitest run --project browser src/lib/components/shell/shell.browser.test.ts`
- [ ] **Step 3: Delete the link** in `TopNav.svelte`. Keep `nav_dashboards` in `messages/en.json`
      (`src/routes/Import.svelte` uses it).
- [ ] **Step 4: Run** the two browser files above, then
      `npx playwright test e2e/sharing.spec.ts --project=chromium`; expect PASS. `npm run check`,
      `npm run lint`.
- [ ] **Step 5: Commit** `Nav: remove the Dashboards link (the picker has All dashboards)`.

### Task 2: The document's "closed" flag

**Files:**

- Modify: `src/lib/documents/schema.ts:51` — `placeBar: z.object({ place: ChosenPlaceSchema, closed: z.literal(true).optional() }).optional()`
- Modify: `src/lib/places/replace.ts` — `barVisible`, new `barClosedChange`
- Modify: `src/lib/starter/starter.ts:146` — `freshCopy` drops `closed`
- Test: `src/lib/places/replace.test.ts`, `src/lib/starter/starter.test.ts`,
  `src/lib/documents/schema.test.ts`, `src/lib/store/dashboard-index.svelte.test.ts` (or wherever
  `index.duplicate` is tested; find with `grep -rln "index.duplicate\|\.duplicate(" src`)

**Interfaces:**

- Produces: `barClosedChange(doc: Dashboard, closed: boolean): Change | null` in
  `src/lib/places/replace.ts`: one `replaceDocument` (`from: { name, body }`, `to: { name, body }`
  with `placeBar.closed` set to `true` or removed); `null` with no `placeBar` or no change.
- Produces: `barVisible(doc)` is `false` when `doc.body.placeBar?.closed`.

- [ ] **Step 1: Failing tests.**
  - `barVisible is false for a closed bar even with widgets at its place`.
  - `barClosedChange(doc, true)` → `op: "replaceDocument"`, `to.body.placeBar` equals
    `{ place, closed: true }`; `barClosedChange(closedDoc, false)` → `to.body.placeBar` has no
    `closed` key; `barClosedChange(noBarDoc, true)` and `barClosedChange(closedDoc, true)` → `null`.
  - `placesToReplace` on a closed dashboard returns `mainPlaces` (the bar isn't shown).
  - Schema: a body with `placeBar: { place }` (old) and with `closed: true` both parse;
    `closed: false` fails (only `true` or absent is stored).
  - `duplicateDashboard(closedDoc, now).body.placeBar` has no `closed`; `copyOfStarter` has none.
  - `index.duplicate(id, { from, to })` of a closed dashboard: the copy's bar is at `to` with no
    `closed` (Review Focus 3).
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run --project unit src/lib/places/replace.test.ts src/lib/starter/starter.test.ts src/lib/documents/schema.test.ts` (+ the index test file).
- [ ] **Step 3: Implement** the schema field, `barVisible`'s check, `barClosedChange`, and in
      `freshCopy` delete `copy.body.placeBar.closed` when present (it already `structuredClone`s).
      Update `placesToReplace`'s comment if needed (it already uses `barVisible`).
- [ ] **Step 4: Run, expect PASS;** `npm run check`, `npm run lint`.
- [ ] **Step 5: Commit** `Place bar: a closed flag on the document, cleared on copies`.

### Task 3: The bar's close button

**Files:**

- Modify: `src/lib/components/dashboard/PlaceBar.svelte`
- Modify: `src/lib/components/shell/DashboardMenuButton.svelte` (add `data-dashboard-menu-button`)
- Modify: `messages/en.json` — `"place_bar_hide": "Hide place bar"`,
  `"place_bar_hidden": "Place bar hidden. Change place is in the dashboard's menu."`
- Test: `src/lib/components/dashboard/PlaceBar.browser.test.ts`

**Interfaces:**

- Consumes: `barClosedChange` (Task 2).

- [ ] **Step 1: Failing browser tests** (each with a real `DocumentSession`, as the file's copy
      tests do):
  - `on a copy, Hide place bar closes it for good: one undo step, focus on the dashboard's menu,
announced` — click the button named "Hide place bar"; the region "This dashboard's place" is
    gone; `session.doc.body.placeBar.closed === true`; `document.activeElement` has
    `data-dashboard-menu-button`; the announcer received `"Place bar hidden. Change place is in
the dashboard's menu."`; `session.undo()` brings the region back.
  - `a second tab sees the bar closed` — a second `DocumentSession.open(platform, space, id, "t2")`
    after flush has `closed: true` and its `PlaceBar` renders nothing.
  - `closing on the starter closes it on the copy` — on the starter, click "Hide place bar"; after
    the hand-off the copy's `placeBar.closed` is `true` and no bar shows (Review Focus 1).
  - `a live-share viewer sees no Hide place bar` — alongside the existing viewer test; and a view of
    a closed document shows no bar.
  - The button's bounding box is at least 24×24.
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run --project browser src/lib/components/dashboard/PlaceBar.browser.test.ts -t "Hide place bar|closing|second tab"`.
- [ ] **Step 3: Implement.** Inside `{#if editable}`, at the bar's end (`ml-auto`), a `Button`
      `variant="ghost" size="icon-sm"` with lucide `X` (`aria-hidden`) and
      `aria-label={m.place_bar_hide()}`. On click: `const session = useApp().current.session`; skip if
      none or `readOnly`; `apply(barClosedChange(session.doc, true))` when non-null; then focus
      `document.querySelector("[data-dashboard-menu-button]")` and `announce(m.place_bar_hidden())`.
      Read `useApp()` at component init, not in the handler.
- [ ] **Step 4: Run, expect PASS;** also the rest of `PlaceBar.browser.test.ts` and
      `arranging.browser.test.ts`; `npm run check`, `npm run lint`.
- [ ] **Step 5: Commit** `Place bar: a Hide place bar button (undoable, focus to the dashboard's menu)`.

### Task 4: "Change place…" in the dashboard's menus

**Files:**

- Modify: `src/lib/actions/dashboard.ts` (`dashboardActions`)
- Modify: `messages/en.json` — `"dashboard_change_place": "Change place…"`
- Test: `src/lib/actions/dashboard.test.ts`, `src/lib/components/dashboard/PlaceBar.browser.test.ts`
  (or `duplicate-for-place.browser.test.ts`, whichever already opens the dashboard menu)

**Interfaces:**

- Item: `{ id: "change-place", label: m.dashboard_change_place(), icon: MapPin, group: "manage" }`,
  listed first in `manage`; present only when `id === undefined && session && !session.readOnly &&
session.doc.body.placeBar`; `run: (ctx) => afterMenuClose(() => { ctx.target.focus?.();
openPlacePicker({ dashboardPlace: true }); })` (as "Duplicate for another place" does).

- [ ] **Step 1: Failing tests.**
  - Unit (`dashboard.test.ts`, new `describe("Change place")`): present for an editable dashboard
    with a bar, open or closed; absent with no `placeBar`, on a read-only session, and in a row's
    list (`dashboardActions(app, "some-id")`).
  - Browser: on a closed copy, open the ⋯ menu → "Change place…" → pick another place → Done: the
    bar's place and its widgets move in one undo step and `placeBar.closed` stays `true` (Review
    Focus 5); focus returns to the ⋯ button when the picker closes.
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run --project unit src/lib/actions/dashboard.test.ts -t "Change place"`, then the browser test by name.
- [ ] **Step 3: Implement** the item. `PlacePickerDialog`'s `findDashboard` already reads
      `placeBar.place` whether closed or not; `replacePlace` keeps `closed` because it spreads the bar
      only when it moves: check that `{ place: to }` doesn't drop `closed` (it does today — make it
      `{ ...bar, place: to }`, with a unit test in `replace.test.ts`:
      `moving a closed bar keeps it closed`).
- [ ] **Step 4: Run, expect PASS;** `npm run check`, `npm run lint`.
- [ ] **Step 5: Commit** `Dashboard menu: Change place… on dashboards with a place bar`.

### Task 5: Welcome Note, E2E, docs

**Files:**

- Modify: `messages/en.json` `starter_note_welcome`: replace "Use **Change place** above to pick"
  with "Use **Change place** above, or in the dashboard's ⋯ menu, to pick" (rest unchanged).
- Modify: tests asserting the welcome text (`grep -rln "Change place\*\* above" src e2e`).
- Modify: `e2e/starter.spec.ts` — new test.
- Modify: `DEFERRED.md`, `ARCHITECTURE.md`, `TODO.md`, `ROADMAP.md`.

- [ ] **Step 1: E2E test** `close the place bar, change place from the dashboard menu, a duplicate
shows the bar again` (starter → make own copy → Hide place bar → bar gone → axe on the page →
      ⋯ → Change place… → pick → widgets move → ⋯ → Duplicate → copy shows the bar). Add an axe
      check of the bar with its close button before closing. Run
      `npx playwright test e2e/starter.spec.ts --project=chromium -g "close the place bar"`; FAIL on
      the Note text first if asserted, then PASS after Step 2.
- [ ] **Step 2: Update the Note's message** and the tests that assert it; run them.
- [ ] **Step 3: Docs.** `DEFERRED.md` → "A "Change place" bar for dashboards not made from the
      starter.": add a `_Changed 2026-11-25_` note: dashboards with a bar now have "Change place…" in
      their menus and the bar can be closed; offering it on any dashboard with a main place (asking
      which on a tie) was considered and left out "for now" (the user); revisit unchanged. Check the
      "welcome Note's bold Change place must match" entry still reads true. `ARCHITECTURE.md`: where
      the nav and the place bar are described (grep `nav_dashboards`, "Change place" bar, `placeBar`),
      add the closed flag, the menu item, copies clearing it, the nav without Dashboards. `TODO.md` /
      `ROADMAP.md`: this work's status line.
- [ ] **Step 4:** `npm run check`, `npm run lint`. Commit
      `Welcome Note points to the dashboard menu; docs for the closable place bar`.

### Task 6: Full verification and review

- [ ] Push; dispatch CI's `e2e-full` on this head early (`gh workflow run CI --ref nav-and-place-bar`).
- [ ] `npm run test:unit`, then `npm run test:browser`, then `npm run test:e2e` (one at a time; stop
      any stray `vite preview` on :4173 first). `npm run build && npm run check:budget`: report the
      number.
- [ ] Whole-branch review on the most capable model, report to a file; fix its findings (ask before
      parking any); full CI after the fix wave.
- [ ] Merge `origin/main` into the branch (resolve conflicts before formatting), open the PR into
      `main`, check `gh pr checks` against the PR's `headRefOid`. The merge waits for the user's yes.
