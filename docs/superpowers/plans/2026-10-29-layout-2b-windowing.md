# Step 2, spec 2b: Windowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widgets can be minimized to a taskbar and restored (as undoable edits), and shown
fullscreen over the dashboard area (never an edit, deep-linkable, Back exits); the dashboard
gets a visible ⋯ button; home shows as `/workspace/`.

**Architecture:** Minimize and restore are `setLayout` changes built by pure functions in
`src/lib/layout/windowing.ts`. The taskbar is a toolbar component under the grid. Fullscreen is
**a `?widget=<id>` query parameter on the dashboard's own URL** (changed from the design's
`/dashboards/:id/widgets/:widgetId`, with the user, 2026-10-29): the route component doesn't
change, so the grid and the widget stay mounted, and the frame is lifted over the dashboard area
with CSS. Opening pushes a history entry, so Back exits. Focus moves after minimize, restore, and
fullscreen go through one small module-level focus request that survives a starter hand-off.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind v4, sv-router 0.19 (`navigate` with
`search`, `state`, `scrollToTop: false`; `route.search`, `route.state`), Vitest (unit + browser
mode), Playwright (Chromium, Firefox, WebKit) with `@axe-core/playwright`, Paraglide, bits-ui,
`@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-10-28-layout-engine-windowing-design.md` (approved
2026-10-28), sections "The model" (for `setLayout` and `minimized`) and "Spec 2b: Windowing",
**except the fullscreen URL**, which this plan changes to `?widget=` (Task 1 updates the design
doc and `ARCHITECTURE.md` to match). Read both before any task. Spec 2a's plan
(`docs/superpowers/plans/2026-10-28-layout-2a-arranging.md`) shows what already exists.

## Global Constraints

- **Branch:** `layout-2b-windowing`, created from `layout` (done); PR into `layout` (not
  `main`). Never merge to `main`, release, or publish without the user's explicit go-ahead.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only; UI text only
  through Paraglide (`messages/en.json`), no sentences built from fragments; numbers through
  `$lib/format`; styling from theme tokens only; `z` from `$lib/zod`. Run `npm run format` before
  committing.
- **Fullscreen URL:** `/workspace/dashboards/<id>?widget=<widgetId>`; on the starter,
  `/workspace/?widget=<widgetId>`. Fullscreen **never edits the document** and never makes a
  starter copy.
- **Minimize / restore are edits:** one `setLayout` each, on the undo list, synced to other
  tabs, through the starter hand-off on the starter, unavailable on a read-only page.
- **`minimized.order`:** one more than the highest `order` in the document (0 if none). Taskbar
  order: `order` ascending, ties by widget id.
- **Restore places the widget like a new one:** `placeNew` (x 0, below every grid widget) at its
  saved `w`/`h`.
- **Every animation is instant under `prefers-reduced-motion`** (use the motion tokens, which are
  0 ms there, as `src/lib/layout/flip.ts` does).
- **The layout never moves unless someone moves it:** nothing in this spec writes layout except
  minimize and restore.
- Touch targets for new buttons (title-bar Minimize / Fullscreen, Exit fullscreen, taskbar items,
  the dashboard ⋯) at least 24 × 24 px (WCAG 2.5.8); the existing `size="icon-sm"` buttons
  qualify.
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.

## Calls made in this plan (not discussed with the user; check these)

- **A minimize lists only the minimized widget, plus tidy fixes that were already due before it
  left** (differences between the saved rects and the tidied full grid). It doesn't save the
  close-up of the gap it leaves; the shown layout closes it by tidying, and the next layout edit
  saves it. Why: if minimize also saved the close-up, two tabs minimizing different widgets
  would nearly always list the same moved widgets with different `to`s, and conflict. Undo is
  exact either way. Restore likewise lists the restored widget plus tidy fixes due before it.
- **Taskbar items** are a restore button (type icon + title) and a ⋯ button; the roving tabindex
  moves across every button in the toolbar (the APG toolbar pattern).
- **Fullscreen frame:** `position: fixed` from the top of `<main>` to the bottom of the viewport,
  above the grid and taskbar, below dialogs, menus, and toasts. The rest of the dashboard
  (other frames, the taskbar, the dashboard header, Add widget) is `inert`; the top nav isn't,
  so a mouse can still reach it, but Tab is trapped in the widget.
- **Inside fullscreen** the title bar shows Exit fullscreen instead of Minimize and Fullscreen,
  dragging and keyboard pick-up are off, and Move… / Resize… / Minimize leave its menu.
- **A deep link to a widget that isn't there** drops `?widget` (replace) and shows a toast; a link
  on a read-only dashboard drops it silently (widgets aren't rendered there).
- **Home's redirect to the last-opened dashboard drops `?widget`** (that id belongs to the
  starter).
- **The widget type gets an `icon`** (a Lucide component) for its taskbar item; the placeholder
  uses `square-dashed`, an unknown type `circle-help`.

## Review Focus

1. **Editing the starter while one of its widgets is fullscreen** (rename from the ⋯ menu inside
   fullscreen). Expected: the copy is made, the URL becomes the copy's with `?widget=` kept,
   fullscreen stays open with the same mounted widget, and exiting lands on the copy's
   dashboard. Pinned in Task 6 (`"an edit in starter fullscreen keeps fullscreen on the copy"`).
2. **Another tab deletes or minimizes the widget that's fullscreen here.** Expected: minimized
   elsewhere → stays fullscreen (exiting goes to the taskbar item); deleted elsewhere →
   fullscreen closes (replace, no history entry left behind) with the missing-widget toast.
   Pinned in Task 6 (`"a fullscreen widget deleted in another tab exits"`, `"minimized in
   another tab stays fullscreen"`).
3. **A deep link opened while the dashboard is still loading.** Expected: no "missing widget"
   decision until the session has loaded; then the widget opens fullscreen. Pinned in Task 6
   (`"a deep link waits for the dashboard to load"`).
4. **Escape inside fullscreen while a menu or dialog is open.** Expected: Escape closes only the
   menu or dialog; a second Escape exits fullscreen. Pinned in Task 6 (`"Escape in an open menu
   closes only the menu"`).
5. **Two tabs minimizing different widgets at once.** Expected: no conflict dialog; both end up in
   the taskbar, ordered by `order` then id, in both tabs. Pinned in Task 2 (`"minimizes of
   different widgets in a tidy layout don't overlap"`, `"equal orders sort by id"`) and Task 9
   (E2E, cross-tab).

---

## File map

- `src/lib/layout/windowing.ts` (new): `nextMinimizedOrder`, `taskbarWidgets`, `minimizeChange`,
  `restoreChange`.
- `src/lib/layout/fullscreen.ts` (new): the `?widget` URL rules and the exit decision, pure.
- `src/lib/layout/focus-request.svelte.ts` (new): the focus request after minimize, restore, and
  fullscreen exit.
- `src/lib/components/dashboard/Taskbar.svelte`, `DashboardHeader.svelte` (new);
  `DashboardGrid.svelte`, `WidgetFrame.svelte` (modified).
- `src/lib/actions/widget.ts` (minimize, restore, fullscreen items; the taskbar provider).
- `src/lib/widgets/registry.ts`, `src/lib/widgets/placeholder/{index.ts,Placeholder.svelte}`
  (`icon`, `fullscreen` prop).
- `src/routes/Home.svelte`, `src/routes/DashboardPage.svelte` (keep `?widget` through the
  starter hand-off; drop it on Home's redirect).
- `src/router.ts`, `src/lib/routing.ts`, `vite.config.ts` (the `/workspace/` home).
- `messages/en.json`; tests next to each file; `e2e/windowing.spec.ts`; `e2e/helpers.ts`.
- Docs: the design doc, `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`.

---

### Task 1: Record the `?widget` decision in the docs

**Files:** `docs/superpowers/specs/2026-10-28-layout-engine-windowing-design.md`,
`ARCHITECTURE.md` (routing table near line 933, and "Dashboard layout mechanics" if it names the
path), this plan.

- [ ] **Step 1:** In the design's "Fullscreen" section, replace the route with
  `/dashboards/:id?widget=:widgetId` (the starter: `/?widget=:widgetId`) and add one line:
  _Changed 2026-10-29 with the user: a query parameter, so the route component doesn't change and
  the widget stays mounted with no router restructuring; Back and deep links work the same._
  Remove the "must not redirect the starter" bullet (the starter stays at `/`) and replace it
  with: an edit in starter fullscreen hands off to the copy with `?widget` kept.
- [ ] **Step 2:** In `ARCHITECTURE.md`'s routing table, change the fullscreen row to
  `/dashboards/:id?widget=:widgetId   that widget fullscreen (deep-linkable)`. Leave
  `/dashboards/:id/widgets/:widgetId/edit` (Widget Creation) as it is.
- [ ] **Step 3: Commit** — `"Make fullscreen a ?widget query parameter"` (includes this plan).

### Task 2: Minimize and restore changes (pure)

**Files:** Create `src/lib/layout/windowing.ts`, `src/lib/layout/windowing.test.ts`.

**Interfaces:**
- Consumes: `gridItems`, `layoutChange` from `$lib/layout/items`; `tidy`, `placeNew`,
  `readingOrder` from `$lib/layout/engine`; `GRID_COLUMNS`.
- Produces:
  ```ts
  export function nextMinimizedOrder(widgets: WidgetInstance[]): number; // max order + 1, else 0
  export function taskbarWidgets(widgets: WidgetInstance[]): WidgetInstance[]; // minimized, by order then id
  export function minimizeChange(widgets: WidgetInstance[], id: string): Change | null;
  // null if `id` is missing or already minimized
  export function restoreChange(widgets: WidgetInstance[], id: string): Change | null;
  // null if `id` is missing or not minimized
  ```
  Both changes are `setLayout`s: the target widget's `from` is its saved placement, plus every
  grid widget whose saved rect differs from `tidy(gridItems(widgets))` (fixes due before the
  change). Minimize's `to` for the target: `{ rect: saved rect, minimized: { order:
  nextMinimizedOrder } }`. Restore's: `{ rect: placeNew(tidied grid, { w, h } clamped to the
  type's minimum and the grid), minimized: null }`.

- [ ] **Step 1: Write the failing tests** (helper `widget(id, x, y, w, h, order?)`):
  - `"nextMinimizedOrder is one more than the highest"`: none → 0; orders 0 and 4 → 5.
  - `"equal orders sort by id"`: `b{order 1}`, `a{order 1}`, `c{order 0}` → `c, a, b`.
  - `"minimize lists only the widget on a tidy layout"`: `a{0,0,6,4}`, `b{6,0,6,4}`,
    `c{0,4,12,2}`; minimize `a` → `widgetIds` `["a"]`, `to.a.minimized.order` 0, rect unchanged.
  - `"minimize includes tidy fixes already due"`: `a{0,0,6,4}`, floating `b{0,9,6,2}`;
    minimize `a` → lists `a` and `b` (`b.to.rect.y` 4).
  - `"minimizes of different widgets in a tidy layout don't overlap"`: two changes from the same
    tidy document minimizing `a` and `b` → `changesOverlap(x, y)` is false (import from
    `$lib/changes/overlap`).
  - `"restore places at the bottom at its saved size"`: grid `b{0,0,12,3}`, minimized
    `a{rect 6,0,6,4, order 0}` → `to.a` = `{ rect: {0,3,6,4}, minimized: null }`.
  - `"restore clamps to the type's minimum"` (saved `w 1, h 1` placeholder → `w 3, h 2`).
  - `"undo of a minimize puts the widget back exactly"`: with `createMemoryPlatform` and a
    `DocumentSession` (as in `document-session.test.ts`), apply the minimize, then `undo()` →
    `doc.body.widgets` deep-equals the original.
  - `"minimizing a missing or minimized widget returns null"`; the same for restore.
- [ ] **Step 2:** Run `npx vitest run --project unit src/lib/layout/windowing` → FAIL (module
  missing).
- [ ] **Step 3: Implement** the four functions in `windowing.ts`. Build the "fixes due" part with
  `layoutChange(widgets, tidy(gridItems(widgets), GRID_COLUMNS))` and merge the target's entry
  into its `target`/`from`/`to`.
- [ ] **Step 4:** Run the same command → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** — `"Add minimize and restore changes"`.

### Task 3: Messages, the type icon, and the focus request

**Files:** Modify `messages/en.json` (then `npm run paraglide`), `src/lib/widgets/registry.ts`,
`src/lib/widgets/placeholder/index.ts`, `Placeholder.svelte`; create
`src/lib/layout/focus-request.svelte.ts` (+ `focus-request.test.ts`).

**Interfaces:**
- Produces:
  ```ts
  // registry.ts: WidgetType gains
  icon: Component; // shown on its taskbar item
  component: Component<{ widget: WidgetInstance; fullscreen?: boolean }>;
  // focus-request.svelte.ts (module-level state, so a remounted page still sees it)
  export type FocusTarget = { kind: "title" | "taskbar"; id: string };
  export function requestFocus(target: FocusTarget): void;
  export function takeFocus(target: FocusTarget): boolean; // true (and clears it) if it matches
  export function pendingFocusTarget(): FocusTarget | null; // reactive read, for effects
  ```
- Messages (keys and English):

  | Key | English |
  | --- | --- |
  | `widget_minimize` | `Minimize` |
  | `widget_minimize_named` | `Minimize {title}` (the title-bar button's label) |
  | `widget_fullscreen` | `Fullscreen` |
  | `widget_fullscreen_named` | `Show {title} fullscreen` |
  | `widget_exit_fullscreen` | `Exit fullscreen` |
  | `widget_restore` | `Restore` |
  | `taskbar_label` | `Minimized widgets` |
  | `taskbar_restore_named` | `Restore {title}` |
  | `widget_minimized` | `{title} minimized to taskbar.` |
  | `widget_restored` | `{title} restored.` |
  | `fullscreen_widget_missing` | `That widget isn't on this dashboard anymore.` |
  | `dashboard_menu` | `Dashboard actions` |

- [ ] **Step 1: Write the failing tests:** `"takeFocus matches kind and id, then clears"`,
  `"a non-matching takeFocus leaves the request"`.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement**; add `icon` to the placeholder
  (`@lucide/svelte/icons/square-dashed`) and accept `fullscreen` in `Placeholder.svelte`
  (expose it as `data-fullscreen` on its root, for tests). Add the messages.
- [ ] **Step 4:** `npm run test:unit && npm run check` → PASS.
- [ ] **Step 5: Commit** — `"Add windowing messages, widget icons, and focus requests"`.

### Task 4: The taskbar

**Files:** Create `src/lib/components/dashboard/Taskbar.svelte`,
`src/lib/components/dashboard/taskbar.browser.test.ts`; modify `src/lib/actions/widget.ts`.

**Interfaces:**
- Consumes: `taskbarWidgets` (Task 2); `widgetTitle`, `widgetActions`; `menuScope`,
  `openMenuFor`; `takeFocus` / `pendingFocusTarget` (Task 3).
- Produces:
  ```ts
  // widget.ts
  export function minimizeWidget(app: AppContext, widgetId: string): void; // applies minimizeChange, announces, requests taskbar focus
  export function restoreWidget(app: AppContext, widgetId: string): void;  // applies restoreChange, announces, requests title focus
  export function taskbarActions(app: AppContext, widgetId: string, fullscreen: (id: string) => void): MenuProvider;
  // Restore, Fullscreen, then widgetActions(app, widgetId) minus Move…, Resize…, Minimize
  ```
  `Taskbar.svelte` props: `{ widgets: WidgetInstance[]; onfullscreen: (id: string) => void }`
  (the minimized widgets, already ordered). It renders nothing when `widgets` is empty.
  Both actions read the session when they run and apply to `session.editTarget` semantics the way
  `rename` does (the starter hands off).

- [ ] **Step 1: Write the failing browser tests** (render through the dashboard test harness
  with a document holding minimized widgets):
  - `"the taskbar is a toolbar with one tab stop"`: `role="toolbar"`, name `Minimized widgets`;
    only one button has `tabindex="0"`.
  - `"arrows, Home, and End move between buttons"` (ArrowRight / ArrowLeft wrap; Home first,
    End last).
  - `"items follow minimized order"` (orders 2, 0, 1 → titles in 0, 1, 2 order).
  - `"activating an item restores it, focuses its title bar, and announces"` (one undo entry;
    live region `… restored.`; `document.activeElement` is the widget's title bar; the widget is
    at the bottom of the grid).
  - `"its menu has Restore and Fullscreen but not Minimize, Move…, or Resize…"` (open by its ⋯
    and by Shift+F10 on the item).
  - `"no taskbar when nothing is minimized"`.
  - `"on a phone the taskbar is a scrolling strip and minimized widgets leave the column"`
    (viewport 400 × 800; the toolbar scrolls sideways, `scrollWidth > clientWidth` with 8 items).
- [ ] **Step 2:** Run `npm run test:browser -- taskbar` → FAIL.
- [ ] **Step 3: Implement.** Sticky to the bottom of the dashboard area (`sticky bottom-0`),
  horizontal scroll when full (`overflow-x-auto`), background and border from tokens. Each item
  is wrapped in a `menuScope(taskbarActions(...))` element so right-click and Shift+F10 resolve
  its menu. After restore, scroll the restored frame into view (`scrollIntoView({ block:
  "nearest" })`, `behavior` instant under reduced motion).
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** — `"Add the taskbar"`.

### Task 5: Minimize from the widget; the grid shows the taskbar

**Files:** Modify `WidgetFrame.svelte`, `DashboardGrid.svelte`, `src/lib/actions/widget.ts`;
tests in `src/lib/components/dashboard/windowing.browser.test.ts` (new).

**Interfaces:**
- Consumes: Task 4's `minimizeWidget`, `Taskbar`; Task 3's focus request.
- Produces: `widgetActions`' signature becomes
  `widgetActions(app, widgetId, arrangement?, window?: { fullscreen?: (id: string) => void; inFullscreen?: boolean })`
  and it gains `minimize-widget` (group `"window"`, hidden while minimized or `inFullscreen`,
  disabled when locked). Title bar gains a Minimize button (`aria-label`
  `widget_minimize_named`), between the title and ⋯; like ⋯, it isn't a drag handle (the
  existing `closest("button")` check covers it).

- [ ] **Step 1: Write the failing browser tests:**
  - `"Minimize moves the widget to the taskbar, focuses its item, and announces"` (the rest of
    the grid closes up on screen; `… minimized to taskbar.` announced; one undo entry; Ctrl+Z
    puts it back at its exact rect and focus isn't lost).
  - `"Minimize from the ⋯ menu does the same"`.
  - `"a widget picked up by keyboard is cancelled by minimizing it"` (arrangement inactive, no
    stray layout change).
  - `"minimize on the starter makes the copy and focuses the taskbar item"` (the starter harness
    the 2a starter tests use; after the hand-off the session is the copy, the item has focus).
  - `"no Minimize on a read-only dashboard"` (the button and item are absent or disabled).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `DashboardGrid` renders `<Taskbar>` from `taskbarWidgets` after the
  grid (also when every widget is minimized: the empty state shows above it). Focus targets
  consume the request in an `$effect` on mount and on change (`takeFocus({ kind, id })`), so the
  copy's page after a starter hand-off still focuses.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** — `"Minimize widgets to the taskbar"`.

### Task 6: Fullscreen

**Files:** Create `src/lib/layout/fullscreen.ts` (+ `fullscreen.test.ts`); modify
`DashboardGrid.svelte`, `WidgetFrame.svelte`, `src/lib/layout/flip.ts`, `src/lib/actions/widget.ts`,
`src/routes/Home.svelte`, `src/routes/DashboardPage.svelte`; tests in
`windowing.browser.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // fullscreen.ts
  export const FULLSCREEN_PARAM = "widget";
  export const FULLSCREEN_STATE = { fullscreen: true } as const; // history state of an entry we pushed
  export function fullscreenId(search: Record<string, string | number | boolean>): string | null;
  export type ExitPlan = { kind: "back" } | { kind: "replace" }; // replace = same path, no `widget`
  export function exitPlan(state: unknown): ExitPlan; // "back" iff state is FULLSCREEN_STATE
  export type DeepLinkCheck = "wait" | "show" | "missing" | "read-only";
  export function checkDeepLink(session: DocumentSession | null, loaded: boolean, id: string): DeepLinkCheck;
  // DashboardGrid
  function openFullscreen(id: string): void; // navigate(current path, { search: { widget: id }, state: FULLSCREEN_STATE, scrollToTop: false })
  function exitFullscreen(): void;           // per exitPlan(route.state): history.back(), or navigate(path, { replace: true, scrollToTop: false }) without `widget`
  ```
  `WidgetFrame` gains `fullscreen: boolean`, `onfullscreen(): void`, `onexit(): void` props and
  passes `fullscreen` to the type's component. `widgetActions` gains `fullscreen-widget` (group
  `"window"`, shown when `window.fullscreen` is given and not `inFullscreen`); with
  `inFullscreen` it also hides Move… and Resize…. `taskbarActions` already has Fullscreen.

- [ ] **Step 1: Write the failing unit tests** in `fullscreen.test.ts`:
  `"fullscreenId reads widget"` (`{ widget: "a" }` → `"a"`; `{}` → null; `""` → null);
  `"exitPlan goes back only from an entry we pushed"` (`FULLSCREEN_STATE` → back; `null`,
  `undefined`, `{ other: 1 }` → replace); `"checkDeepLink"` (not loaded → wait; read-only →
  read-only; id absent → missing; present or minimized → show).
- [ ] **Step 2: Write the failing browser tests:**
  - `"the page doesn't remount when only the query changes"` (do this one first: render the app
    with the router at `/dashboards/<id>`, mark the placeholder's root element, navigate with
    `search: { widget }`, and assert it's the same element). **If this fails, stop and report to
    the user before going on**: the `?widget` decision depends on it.
  - `"Fullscreen covers the dashboard area and keeps the widget mounted"` (the same element
    before and after; the frame's box spans `<main>`'s top to the viewport bottom; the placeholder
    has `data-fullscreen="true"`; the rest of the dashboard is `inert`).
  - `"Tab is trapped in the fullscreen widget"` (Tab and Shift+Tab from the last/first focusable
    wrap).
  - `"Escape exits, focus returns to the title bar"`; `"the close button exits"`; `"Back exits"`
    (`history.back()` → no `widget` in the URL, focus on the title bar).
  - `"exit replaces when the page was opened on the link"` (start at `?widget=` with no pushed
    state → Escape → URL without `widget`, `history.length` unchanged).
  - `"Escape in an open menu closes only the menu"`.
  - `"a minimized widget opens fullscreen and stays minimized"` (from the taskbar menu; exit
    focuses its taskbar item; the document is unchanged).
  - `"a deep link waits for the dashboard to load"` (delay `app.sessions.get`; no toast and no
    URL change until it resolves; then fullscreen).
  - `"a deep link to a missing widget drops the parameter with a notice"` (replace; toast
    `fullscreen_widget_missing`).
  - `"a fullscreen widget deleted in another tab exits"`; `"minimized in another tab stays
    fullscreen"` (apply the change to the session as a remote one, as `cross-tab.test.ts` does).
  - `"an edit in starter fullscreen keeps fullscreen on the copy"` (at `/?widget=<id>` on the
    starter, rename the widget from its ⋯ → URL is `/dashboards/<copy>?widget=<id>`, the
    fullscreen frame is the same element, exit lands on `/dashboards/<copy>`).
  - `"opening fullscreen never makes a starter copy"`.
  - `"on a phone fullscreen covers the area below the top bar"` (viewport 400 × 800).
  - `"reduced motion: no animation"` (with `prefers-reduced-motion: reduce` emulated,
    `el.getAnimations()` is empty right after opening).
- [ ] **Step 3:** Run `npm run test:unit -- fullscreen && npm run test:browser -- windowing` →
  FAIL.
- [ ] **Step 4: Implement.**
  - `DashboardGrid` reads `fullscreenId(route.search)` and the session; it runs `checkDeepLink`
    in an effect: `missing` → `navigate(path, { replace: true, scrollToTop: false })` without
    `widget` plus the toast; `read-only` → the same without the toast.
  - The fullscreen frame keeps its place in the `{#each}` (so it isn't remounted) and gets
    `fixed` positioning from `<main>`'s top (measured into a CSS variable with a
    `ResizeObserver`, as notice bars can change it) to `bottom: 0`, full width, a z-index token
    above the grid and below overlays. A minimized widget shown fullscreen renders its frame
    outside the grid (it had no frame to keep).
  - `inert` on the dashboard header, the other frames, the taskbar, and Add widget. Tab trap:
    a `keydown` handler on the frame that wraps Tab and Shift+Tab across its focusables. Escape:
    a `keydown` on the frame that exits unless `event.defaultPrevented` (menus and dialogs
    handle Escape first).
  - Animation: add `flipRect(el: HTMLElement, from: DOMRect): void` to `flip.ts` (translate and
    scale from `from` to the element's current box, with the motion tokens; nothing under
    reduced motion). Measure before the class change, play after, both ways.
  - On exit, `requestFocus({ kind: "title" | "taskbar", id })` by whether the widget is
    minimized.
  - Inside fullscreen: no pick-up (keyboard, pointer, or touch), and the title bar shows only
    the title, ⋯, and Exit fullscreen (`widget_exit_fullscreen`). Move…, Resize…, and Minimize
    leave its menu.
  - The starter: `Home.svelte`'s hand-off `navigate` to the copy passes `search: { widget }` when
    `route.search.widget` is set, and `scrollToTop: false`. Home's redirect to a last-opened
    dashboard drops it. `DashboardPage` needs no change beyond keeping the session when it's
    already current (it does today).
  - The title bar's Fullscreen button (`widget_fullscreen_named`, Lucide `maximize-2`) and the
    menu item call `openFullscreen`; a keyboard arrangement in progress is cancelled first.
- [ ] **Step 5:** Run the tests → PASS; `npm run check` → PASS.
- [ ] **Step 6: Commit** — `"Show a widget fullscreen with ?widget"`.

### Task 7: The dashboard's ⋯ button

**Files:** Create `src/lib/components/dashboard/DashboardHeader.svelte`; modify
`DashboardGrid.svelte`; tests in `dashboard.browser.test.ts`.

**Interfaces:** `DashboardHeader` renders, inside the dashboard's `menuScope`, a right-aligned
ghost `size="icon-sm"` ⋯ button (`aria-label` `dashboard_menu`) that calls
`openMenuFor(button)`; the menu resolves the same provider as a blank-space right-click.

- [ ] **Step 1: Write the failing tests:** `"the dashboard ⋯ opens the dashboard's actions"`
  (Add widget, Undo, Redo, Rename, Duplicate, Share, Delete present; the same ids as a blank-space
  context menu); `"it's shown on the starter and on an empty dashboard"`; `"focus returns to it
  when the menu closes"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (above the starter hint and the grid).
  **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `"Add the dashboard's ⋯ button"`.

### Task 8: Home as `/workspace/`

**Files:** Modify `src/lib/routing.ts` (+ `routing.test.ts`), `src/router.ts`, `vite.config.ts`,
`src/lib/components/shell/TopNav.svelte` and the other `p("/")` users (8 non-test uses of
`p("/")` / `navigate("/")` today; check each), affected E2E assertions.

**Interfaces:**
- Produces:
  ```ts
  // routing.ts
  export const BASE = "/workspace";
  export const HOME_HREF = "/workspace/";
  /** The canonical form of a bare base path, else null: "/workspace" → "/workspace/". */
  export function canonicalHome(pathname: string): string | null;
  ```

- [ ] **Step 1: Write the failing tests:** `"canonicalHome adds the slash to the bare base
  only"` (`/workspace` → `/workspace/`; `/workspace/`, `/workspace/dashboards`, `/other` →
  null).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - `router.ts`: a root `hooks.afterLoad` that, when `canonicalHome(location.pathname)` isn't
    null, `history.replaceState(history.state, "", canonical + location.search + location.hash)`
    (keeping sv-router's state object as is, so its history index survives).
  - Links to home use `HOME_HREF` instead of `p("/")`; `navigate("/")` calls stay (the hook
    fixes the address).
  - `vite.config.ts`: a dev-only plugin whose `configureServer` middleware, registered before
    Vite's base check, rewrites a request for exactly `/workspace` (with any query) to
    `/workspace/`, so the app loads instead of the base-URL hint page. It uses `canonicalHome`.
  - Update E2E assertions that expect the bare `/workspace` home URL.
- [ ] **Step 4:** Run `npm run test:unit -- routing`, `npm run test:browser`, and by hand
  `npm run dev`, then open `http://localhost:5173/workspace` → the app, address
  `/workspace/` → PASS.
- [ ] **Step 5:** Remove the "`/workspace` without a trailing slash" entry from `DEFERRED.md` (done,
  not dropped).
- [ ] **Step 6: Commit** — `"Show home as /workspace/"`.

### Task 9: E2E and axe

**Files:** Create `e2e/windowing.spec.ts`; add helpers to `e2e/helpers.ts`
(`taskbar(page)`, `taskbarItem(page, title)`, `fullscreenFrame(page)`).

- [ ] **Step 1: Write the E2E tests** (`test.use({ reducedMotion: "reduce" })` except the last):
  - `"minimize and restore, with focus and announcements"`.
  - `"undo of a minimize"`; `"a minimize survives a reload"` (`expectSaved`, reload, the taskbar
    item is still there).
  - `"minimize on the starter makes the copy"` (URL matches `DASHBOARD_URL`, item focused).
  - `"two tabs minimizing different widgets"` (two pages in one context; both minimize at once;
    no conflict dialog; both taskbars show both items in the same order).
  - `"fullscreen open and exit by Escape, the close button, and Back"` (Back leaves the
    dashboard's URL with no `widget` and a working page).
  - `"a deep link to a fullscreen widget"`, `"to a minimized one"`, `"to a missing one"`.
  - `"axe: taskbar"`, `"axe: fullscreen"` (`expectNoViolations`).
  - `"fullscreen animates without reduced motion"` (Chromium only; the frame has a running
    animation right after opening).
- [ ] **Step 2:** Run `npm run test:e2e` → PASS on Chromium; then `npm run test:e2e:podman` (all
  three engines) → PASS.
- [ ] **Step 3: Commit** — `"Add windowing E2E"`.

### Task 10: Docs, deferrals, full verification, PR

**Files:** `TODO.md` ("Start here" and "Step 2"), `DEFERRED.md`, `ARCHITECTURE.md` (only if the
build changed a decision).

- [ ] **Step 1:** Update `TODO.md`: 2b done (what it built, how it was verified); next is
  `layout` → `main` after the user's two hand checks and explicit yes; then sync spec 2, which
  needs an sdk-js prerelease **with the documents module** (`4.8.0-beta.1`, which the dashboard
  pins, predates it), cut only with the user's yes.
- [ ] **Step 2:** Add anything deferred while building to `DEFERRED.md` (why + revisit trigger).
- [ ] **Step 3:** Run `npm run lint && npm run check && npm run test && npm run build &&
  npm run check:build && npm run check:budget` → all PASS (initial JS under the budget).
- [ ] **Step 4: Commit** — `"Record spec 2b in TODO"`; push `layout-2b-windowing` and open a PR
  into `layout` with `gh pr create --base layout`. The body summarizes the spec, notes the
  `?widget` change, lists the two hand checks still due before `layout` → `main`, and carries no
  AI attribution. Do not merge it without the user's go-ahead.
