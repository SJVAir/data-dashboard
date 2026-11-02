# Step 2, spec 2a: Arranging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widgets can be moved and resized on a snapping 12-column grid by mouse, touch, and
keyboard (with screen-reader announcements), on desktop and in the phone column, with one undoable
change per drop.

**Architecture:** A pure layout engine (`src/lib/layout/`, grid cells only, column count as an
input) decides every layout. One new change type, `setLayout`, records a drop (and, in spec 2b,
minimize/restore). A small reactive controller (`Arrangement`) holds the in-progress preview shared
by pointer, touch, and keyboard input; nothing is applied to the document until the drop. The grid
renders the **tidied** saved layout of the widgets that aren't minimized.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind v4, Vitest (unit + browser mode with
`vitest-browser-svelte`), Playwright (Chromium, Firefox, WebKit) with `@axe-core/playwright`, zod
via `$lib/zod`, Paraglide, bits-ui.

**Spec:** `docs/superpowers/specs/2026-10-28-layout-engine-windowing-design.md` (approved
2026-10-28), sections "The model" and "Spec 2a: Arranging". Read both before any task.

## Global Constraints

- **Branch:** `layout-2a-arranging`, created from `layout`; PR into `layout` (not `main`). Never
  merge to `main`, release, or publish without the user's explicit go-ahead.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only; UI text only
  through Paraglide (`messages/en.json`), no sentences built from fragments (use message variants
  for plurals); numbers through `formatNumber` from `$lib/format`; styling from theme tokens only;
  `z` from `$lib/zod`, never `zod`. Run `npm run format` before committing.
- **Columns: 12. Phone cut-off: below Tailwind's `md` (48rem / 768 px)** one column, otherwise 12.
- **Row height and gap stay the theme tokens** `--grid-row-height` and `--grid-gap`.
- **Placeholder sizes:** `minSize { w: 3, h: 2 }`, `defaultSize { w: 6, h: 4 }`.
- **Long-press:** 500 ms, movement tolerance 8 px. **Mouse drag start threshold:** 4 px.
- **Touch targets** for resize handles and "Done": at least 44 × 44 px (well over WCAG 2.5.8's 24).
- **Every animation is instant under `prefers-reduced-motion`** (the motion tokens already go to
  0 ms there; use them).
- **The layout never moves unless someone moves it:** no code path writes layout except a drop,
  a keyboard drop, a touch "Done", and (2b) minimize/restore.
- Shapes are free before Release 1: change `minimized` in place, no schema-version bump.
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.

## Review Focus

1. **An imported or synced layout with overlaps, out-of-range sizes, or rects below a type's
   minimum** (hand-edited file, an older build). Expected: it shows tidied, nothing is written
   until a layout edit, and the first drop saves the tidy fixes in the same undo step. Pinned in
   Task 2 (`"tidy fixes an overlapping, undersized layout"`) and Task 6 (`"an overlapping
   document shows tidied and writes nothing"`).
2. **Another tab deletes or moves widgets while this tab is mid-drag.** Expected: the preview
   follows the new document; if the dragged widget is gone, the drag cancels with an
   announcement; the drop's `from` matches the document at drop time. Pinned in Task 5
   (`"a remote change mid-drag recomputes the preview"`, `"the dragged widget deleted elsewhere
   cancels"`).
3. **Undo after another tab deleted one of the moved widgets.** Expected: the rest move back; no
   error. Pinned in Task 4 (`"setLayout skips ids that are gone"`).
4. **Focus leaves a picked-up widget** (Tab, a click elsewhere, the window losing focus).
   Expected: the move is cancelled and the layout is back as it was, announced. Pinned in Task 8
   (`"moving focus away cancels"`).
5. **A drop on the starter dashboard.** Expected: the copy is made with the new layout, the URL
   moves to the copy, and focus is on the moved widget's title bar. Pinned in Task 8 (`"a
   keyboard drop on the starter keeps focus through the hand-off"`) and Task 11 (E2E).

---

## File map

- `src/lib/layout/config.ts` (new): `GRID_COLUMNS`, `PHONE_QUERY`.
- `src/lib/layout/engine.ts` (new, replaces `src/lib/widgets/placement.ts`): the pure engine.
- `src/lib/layout/geometry.ts` (new): pixels ↔ grid cells, pure.
- `src/lib/layout/arrangement.svelte.ts` (new): the in-progress preview controller.
- `src/lib/layout/items.ts` (new): document widgets → engine items; `layoutChange`.
- `src/lib/a11y/announcer.svelte.ts` + `src/lib/components/a11y/LiveRegion.svelte` (new).
- `src/lib/changes/{types,apply,overlap,rebase}.ts`: `setLayout`.
- `src/lib/documents/schema.ts`: `minimized: { order }`; `GRID_COLUMNS` from config.
- `src/lib/components/dashboard/{DashboardGrid,WidgetFrame}.svelte`, new
  `ResizeHandles.svelte`, `src/lib/components/menu/ContextMenuHost.svelte`,
  `src/lib/actions/widget.ts`, `src/lib/actions/dashboard.ts`, `src/lib/widgets/placeholder/index.ts`,
  `src/App.svelte`, `messages/en.json`.
- Tests next to each file, plus `e2e/arranging.spec.ts`, `e2e/drag-performance.spec.ts`.

---

### Task 1: Branch, layout config, and the engine's basics

**Files:**
- Create: `src/lib/layout/config.ts`, `src/lib/layout/engine.ts`, `src/lib/layout/engine.test.ts`
- Delete: `src/lib/widgets/placement.ts`, `src/lib/widgets/placement.test.ts`
- Modify: `src/lib/documents/schema.ts` (import `GRID_COLUMNS` from config, re-export it),
  every importer of `placement` (`DashboardGrid.svelte`, `actions/widget.ts`, `changes/rebase.ts`,
  `widgets/placeholder/index.ts`, `store/cross-tab.test.ts`, `dashboard.browser.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  // config.ts
  export const GRID_COLUMNS = 12;
  export const PHONE_QUERY = "(width < 48rem)";
  // engine.ts
  export type Size = { w: number; h: number };
  export type LayoutItem = { id: string; rect: Rect; minSize: Size };
  export type Layout = LayoutItem[]; // always returned in reading order
  export function rectsOverlap(a: Rect, b: Rect): boolean;
  export function readingOrder<T extends { id: string; rect: Rect }>(items: T[]): T[]; // y, x, then id
  export function placeNew(items: LayoutItem[], size: Size, columns: number): Rect; // x 0, below everything
  export function tidy(items: LayoutItem[], columns: number): Layout;
  export function diff(before: LayoutItem[], after: LayoutItem[]): Record<string, Rect>; // ids whose rect changed, with the after rect
  ```

- [ ] **Step 1:** `git checkout layout && git checkout -b layout-2a-arranging`.
- [ ] **Step 2: Write the failing tests** in `engine.test.ts` (helper `item(id, x, y, w, h, minW = 1, minH = 1)`):
  - `"readingOrder sorts by row, then column, then id"`.
  - `"placeNew goes below everything at x 0"`: items at `{0,0,6,4}` and `{6,0,6,2}` →
    `placeNew(items, {w:6,h:4}, 12)` equals `{ x: 0, y: 4, w: 6, h: 4 }`; empty → `{0,0,6,4}`.
  - `"tidy is a no-op on a tidy layout"`: `a{0,0,6,4}`, `b{6,0,6,4}`, `c{0,4,12,2}` unchanged.
  - `"tidy compacts upward"`: `a{0,3,6,2}` → `a{0,0,6,2}`; `a{0,0,6,2}`, `b{0,5,6,2}` → `b{0,2,6,2}`.
  - `"tidy fixes an overlapping, undersized layout"`: `a{0,0,6,4}`, `b{0,2,6,4}` → `b{0,4,6,4}`;
    `c{10,0,4,1}` with min `{3,2}` → `c` clamped to `x 8, w 4, h 2`; `d{0,0,20,2}` → `w 12, x 0`.
  - `"tidy works with another column count"`: with `columns = 6`, `a{0,0,6,2}`, `b{3,0,3,2}` →
    `b{3,2,3,2}`.
  - `"diff lists only changed rects"`.
- [ ] **Step 3:** Run `npx vitest run --project unit src/lib/layout` → FAIL (module missing).
- [ ] **Step 4: Implement** `config.ts` and the engine functions above. `tidy` = the spec's three
  passes (clamp to grid and `minSize`; resolve overlaps in reading order by moving down; compact
  upward in reading order). Move every `placement` import to `$lib/layout/engine` (`placeAtBottom`
  callers use `placeNew` with items built from the widgets; until Task 3 a widget's `minSize` can be
  `{ w: 1, h: 1 }` at call sites that don't need it).
- [ ] **Step 5:** Run `npm run test:unit` and `npm run check` → PASS.
- [ ] **Step 6: Commit** — `git commit -m "Add the layout engine's tidy, placement, and config"`.

### Task 2: The engine's moves: move, resize, stepDown, moveInOrder

**Files:** Modify `src/lib/layout/engine.ts`, `src/lib/layout/engine.test.ts`

**Interfaces:**
- Consumes: Task 1's types and `tidy`.
- Produces:
  ```ts
  export function move(items: LayoutItem[], id: string, to: { x: number; y: number }, columns: number): Layout;
  export function resize(items: LayoutItem[], id: string, rect: Rect, columns: number): Layout; // rect clamped to minSize and grid
  export function stepDown(items: LayoutItem[], id: string, columns: number): Layout | null; // null = already at the bottom
  export function moveInOrder(items: LayoutItem[], id: string, index: number, columns: number): Layout;
  ```
  All take an already tidy layout and return a tidy one.

- [ ] **Step 1: Write the failing tests:**
  - `"move pushes overlapped widgets down"`: `a{0,0,6,4}`, `b{6,0,6,4}`; `move(a → {6,0})` →
    `a{6,0,6,4}`, `b{6,4,6,4}`.
  - `"move into empty space below snaps back up"`: `a{0,0,6,4}`; `move(a → {0,5})` → `a{0,0,6,4}`.
  - `"moving up past a widget swaps them"`: `a{0,0,12,2}`, `b{0,2,12,3}`; `move(b → {0,1})` →
    `b{0,0}`, `a{0,3}`.
  - `"move clamps x so the widget stays on the grid"`: `move(a{w 6} → {9,0})` → `x 6`.
  - `"resize pushes and clamps"`: `a{0,0,6,4}`, `b{6,0,6,4}`; `resize(a → {0,0,8,4})` → `b{6,4,6,4}`;
    `resize(a → {0,0,1,1})` with min `{3,2}` → `a{0,0,3,2}`; `w 20` → `w 12`.
  - `"stepDown jumps past the next widget below in the same columns"`: `a{0,0,12,2}`, `b{0,2,12,3}`
    → `b{0,0}`, `a{0,3}`; on the bottom widget → `null`; `a{0,0,6,2}` with `b{6,0,6,4}` only
    (nothing below `a` in its columns) → `null`.
  - `"moveInOrder places the widget at the requested reading position"`: full-width `a,b,c`
    stacked; `moveInOrder(c, 0)` → reading order `c,a,b`; `moveInOrder(a, 2)` → `b,c,a`.
  - `"moveInOrder property: random layouts"`: a seeded generator (a small LCG in the test, no new
    dependency) builds 200 tidy layouts of 2–10 items (random widths 1–12, heights 1–6, columns 12);
    for a random `id` and `index`, the result is tidy (`tidy(result)` deep-equals `result`), has no
    overlaps, keeps every id and size, and `readingOrder(result).indexOf(id) === index`.
- [ ] **Step 2:** Run the engine tests → FAIL.
- [ ] **Step 3: Implement.** `move`: set the rect (x clamped), push every overlapping widget down
  below it (cascading, the moved widget wins), then `tidy`. `stepDown`: find the nearest widget
  below whose columns intersect; if none, `null`; else `move` to `y = that.y + 1` so the moved
  widget ends just below it after compaction (verify against the tests, adjust the target if
  needed). `moveInOrder`: take the position of the widget currently at `index` in reading order
  (moving down: the position just below it) and `move` there; if the property test finds cases where
  that lands off by one, settle by retrying adjacent targets until the reading index matches.
- [ ] **Step 4:** Run the engine tests → PASS.
- [ ] **Step 5: Commit** — `"Add move, resize, stepDown, and moveInOrder to the layout engine"`.

### Task 3: Engine items from documents; placeholder sizes

**Files:**
- Create: `src/lib/layout/items.ts`, `src/lib/layout/items.test.ts`
- Modify: `src/lib/widgets/placeholder/index.ts` (`minSize { w: 3, h: 2 }`), `src/lib/actions/widget.ts`
  (Duplicate), `src/lib/actions/dashboard.ts` / `newPlaceholder` (Add widget)

**Interfaces:**
- Consumes: Task 1, `getWidgetType` from `$lib/widgets/registry`.
- Produces:
  ```ts
  export const FALLBACK_MIN_SIZE: Size; // the placeholder type's minSize
  export function gridItems(widgets: WidgetInstance[]): LayoutItem[]; // not-minimized widgets only, minSize from the type (fallback for unknown types)
  export function shownLayout(widgets: WidgetInstance[], columns?: number): Layout; // tidy(gridItems(widgets), columns ?? GRID_COLUMNS)
  export function placeNewWidget(widgets: WidgetInstance[], size: Size): Rect; // placeNew over gridItems
  ```

- [ ] **Step 1: Write the failing tests:** `"unknown types use the fallback minimum"`,
  `"shownLayout tidies"`. (The minimized cases need Task 4's schema; they're in Task 4.)
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; switch Add widget and Duplicate to
  `placeNewWidget`. **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** — `"Build layout items from dashboard widgets"`.

### Task 4: The `setLayout` change and `minimized: { order }`

**Files:**
- Modify: `src/lib/documents/schema.ts`, `src/lib/changes/types.ts`, `apply.ts`, `overlap.ts`,
  `rebase.ts`, and their tests (`schema.test.ts`, `apply.test.ts`, `overlap.test.ts`,
  `rebase.test.ts`, `undo.test.ts`); `src/lib/layout/items.ts` (+ test)

**Interfaces:**
- Produces:
  ```ts
  // schema.ts
  minimized: z.object({ order: z.number().int().min(0) }).optional() // replaces { restoreRect }
  // types.ts
  export const PlacementSchema = z.object({ rect: RectSchema, minimized: z.object({ order: z.number().int().min(0) }).nullable() });
  export type Placement = z.infer<typeof PlacementSchema>;
  { op: "setLayout", target: { widgetIds: string[] /* min 1, unique */ }, from: Record<string, Placement>, to: Record<string, Placement> }
  // items.ts
  export function layoutChange(widgets: WidgetInstance[], after: Layout): Change | null;
  // a setLayout for every grid widget whose saved rect differs from `after` (tidy fixes included); null when nothing differs
  ```

- [ ] **Step 1: Write the failing tests:**
  - schema: `"minimized takes an order"`, `"the old restoreRect shape is rejected"`.
  - types: `"setLayout requires from and to keys to equal target.widgetIds"`, `"setLayout ids must be unique and non-empty"`.
  - apply: `"setLayout sets rects and minimized"`, `"its inverse restores the document"` (apply,
    then apply the inverse → deep-equal original), `"the inverse reads from the document, not the
    change"` (stale `from`), `"setLayout skips ids that are gone"` (one of two ids removed → the
    other applies; the inverse lists only it), `"setLayout with every id gone throws
    ChangeTargetMissing"`, `appliedChange` round-trip.
  - overlap: `"setLayouts sharing an id with different to overlap"`, `"same to doesn't"`, `"disjoint
    ids don't"`, `"setLayout overlaps removeWidget of a listed id"` (both orders).
  - rebase: `"applyForced drops gone ids from setLayout"`; `replaceIfOverlapping` uses
    `placeNewWidget` (an added widget overlapping a grid widget goes below the grid widgets only).
  - undo: `"undo of a setLayout after another tab deleted one widget moves the rest back"`.
  - items: `"gridItems skips minimized widgets"`, `"placeNewWidget ignores minimized widgets"`.
  - items: `"layoutChange includes tidy fixes"` (document with `b{0,5,6,2}` floating, `after` from a
    move of `a` → the change lists `b` too); `"layoutChange returns null when nothing moved"`.
- [ ] **Step 2:** Run `npm run test:unit` → FAIL.
- [ ] **Step 3: Implement.** In `applyChange`, `minimized: null` removes the field. Setting `to`
  applies only `rect` and `minimized` to each listed widget. Add the `setLayout` case to
  `appliedChange` (swap `from`/`to`). `upgradeChanges` needs no change (validation is by
  `ChangeSchema`).
- [ ] **Step 4:** `npm run test:unit && npm run check` → PASS.
- [ ] **Step 5: Commit** — `"Add the setLayout change and minimized order"`.

### Task 5: Geometry and the `Arrangement` controller

**Files:**
- Create: `src/lib/layout/geometry.ts` (+ `geometry.test.ts`), `src/lib/layout/arrangement.svelte.ts`
  (+ `arrangement.test.ts`)

**Interfaces:**
- Consumes: Tasks 1–4; `DocumentSession` (`doc`, `apply`, `editTarget`).
- Produces:
  ```ts
  // geometry.ts
  export type GridMetrics = { left: number; top: number; width: number; columns: number; rowHeight: number; gap: number };
  export function cellWidth(m: GridMetrics): number;
  export function cellAt(m: GridMetrics, point: { x: number; y: number }): { x: number; y: number }; // clamped ≥ 0, x < columns
  export function snapDelta(m: GridMetrics, dx: number, dy: number): { dx: number; dy: number }; // pixel delta → whole cells (rounded)
  export function rectToPixels(m: GridMetrics, r: Rect): { left: number; top: number; width: number; height: number };
  // arrangement.svelte.ts
  export type ArrangeMode = "move" | "resize";
  export type ArrangeInput = "pointer" | "keyboard" | "touch";
  export class Arrangement {
  	constructor(session: () => DocumentSession | null, columns: () => number, opts?: { onGone?: (id: string) => void });
  	readonly active: { id: string; mode: ArrangeMode; input: ArrangeInput } | null; // $state
  	readonly preview: Layout | null; // $state; null when idle
  	readonly pushedCount: number; // widgets other than the active one whose preview rect differs from the start
  	pickUp(id: string, mode: ArrangeMode, input: ArrangeInput): void;
  	moveTo(to: { x: number; y: number }): void;   // engine.move on the start layout (12 columns)
  	resizeTo(rect: Rect): void;                    // engine.resize
  	step(dir: "up" | "down" | "left" | "right"): "moved" | "at-bottom" | "blocked"; // keyboard; down = stepDown; on 1 column: up/down = moveInOrder ±1
  	grow(dir: "up" | "down" | "left" | "right"): void; // Shift+arrows: right/left = w ±1, down/up = h ±1 (h only on 1 column)
  	drop(): Change | null;   // applies layoutChange(session.doc.body.widgets, preview) to session; clears state; returns it
  	cancel(): void;          // clears state; nothing applied
  	pendingFocus: string | null; // $state: the widget whose title bar should take focus once mounted (starter hand-off)
  }
  ```
  `preview` is always computed from the **current** `session.doc` plus the active widget's target,
  so a remote change recomputes it (spec, "Another tab's change mid-drag").

- [ ] **Step 1: Write the failing tests:**
  - geometry: `cellAt` and `snapDelta` with `width 1200, columns 12, gap 12, rowHeight 64` (cell
    width `(1200 - 11·12)/12 = 89`): point `x = 101+left` → column 1; negatives clamp to 0; the
    last column clamps to 11.
  - arrangement (Node, with `createMemoryPlatform` + `DocumentSession` as in `document-session.test.ts`):
    `"pickUp, moveTo, drop applies one setLayout"` (session undo stack grows by exactly 1; undo
    restores every rect); `"cancel applies nothing"`; `"step down at the bottom reports
    at-bottom"`; `"grow is clamped to the minimum"`; `"on one column, step up/down reorders"`;
    `"a remote change mid-drag recomputes the preview"` (apply another widget's move to the session
    while picked up → `preview` reflects it and the drop's `from` equals the document at drop time);
    `"the dragged widget deleted elsewhere cancels"` (`active` becomes null and `onGone` is called
    with its id; the grid announces `layout_gone` from it); `"drop with no change returns null and applies nothing"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Recompute `preview` with `$derived` from
  `session().doc` and the target; detect "gone" when the active id leaves the grid widgets.
  **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `"Add grid geometry and the arrangement controller"`.

### Task 6: Announcer, live region, and the grid rendering the shown layout

**Files:**
- Create: `src/lib/a11y/announcer.svelte.ts`, `src/lib/components/a11y/LiveRegion.svelte`
- Modify: `src/App.svelte` (mount `<LiveRegion />` once), `src/lib/components/dashboard/test-harness/Harness.svelte`
  (mount it too), `DashboardGrid.svelte`, `WidgetFrame.svelte`, `dashboard.browser.test.ts`,
  `messages/en.json`

**Interfaces:**
- Produces:
  ```ts
  export function announce(message: string): void; // polite; the same text twice in a row is still read (clear, then set on the next frame)
  ```
  `DashboardGrid` creates one `Arrangement` per grid and passes it through Svelte context
  (`ARRANGEMENT_KEY`, `useArrangement()` exported from `arrangement.svelte.ts`). `WidgetFrame`
  takes `rect: Rect` (the shown or previewed rect) as a prop instead of reading `widget.rect`.

- [ ] **Step 1: Write the failing browser tests** in `dashboard.browser.test.ts`:
  `"an overlapping document shows tidied and writes nothing"` (seed `a{0,0,6,4}`, `b{0,2,6,4}` via
  `replaceDocument` or a fresh doc → frame `b` has `gridRowStart` `"5"`, and `session` has no pending
  changes / version unchanged); `"minimized widgets aren't on the grid"`; `"the live region is
  polite and announces"` (`announce("x")` → `role="status"` region with `aria-live="polite"` has
  text `x`).
- [ ] **Step 2:** Run `npm run test:browser` → FAIL. **Step 3:** Implement: the grid renders
  `arrangement.preview ?? shownLayout(widgets)` in reading order; the columns value comes from
  `new MediaQuery(PHONE_QUERY)` (`svelte/reactivity`) → 1 or 12. Pushed widgets animate with a
  FLIP transform (measure before/after on preview change; duration `--motion-duration-base`,
  so instant under reduced motion). The drop target is an outlined box (not a tint) at the active
  widget's preview rect; the active widget itself follows the pointer via `transform` while
  `input === "pointer" | "touch"`. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `"Render the tidied layout and add the live region"`.

### Task 7: Messages

**Files:** Modify `messages/en.json` (run `npm run paraglide`)

Add (use Paraglide variants for plurals; numbers are passed preformatted with `formatNumber`):

| Key | English |
| --- | --- |
| `widget_move` | `Move…` |
| `widget_resize` | `Resize…` |
| `layout_picked_up` | `Picked up {title}. Column {column}, row {row}. Arrow keys move, Shift and arrow keys resize, Enter drops, Escape cancels.` |
| `layout_picked_up_resize` | `Resizing {title}: {width} columns wide, {height} rows tall. Shift and arrow keys resize, Enter drops, Escape cancels.` (plural variants for width/height) |
| `layout_picked_up_phone` | `Picked up {title}. Position {position} of {total}. Up and down arrows move, Shift and up and down arrows resize, Enter drops, Escape cancels.` |
| `layout_position` | `Column {column}, row {row}.` |
| `layout_size` | `{width} columns wide, {height} rows tall.` (variants) |
| `layout_phone_position` | `Position {position} of {total}.` |
| `layout_dropped` | `Dropped {title} at column {column}, row {row}.` / `… {count} other widget moved.` / `… {count} other widgets moved.` (variants on count: 0, one, other) |
| `layout_dropped_phone` | `Dropped {title} at position {position} of {total}.` |
| `layout_cancelled` | `Cancelled. {title} is back where it was.` |
| `layout_gone` | `{title} was removed in another tab. Move cancelled.` |
| `layout_at_bottom` | `{title} is already at the bottom.` |
| `layout_done` | `Done` |
| `layout_title_bar_hint` | `Press Enter to move` (the title bar's `aria-description`) |

- [ ] **Step 1:** Add them; `npm run check` → PASS. **Step 2: Commit** — `"Add arranging messages"`.
  (Small enough to fold into Task 8's commit if preferred.)

### Task 8: Keyboard move and resize, Move… / Resize…, the starter hand-off

**Files:** Modify `WidgetFrame.svelte`, `src/lib/actions/widget.ts`, `DashboardGrid.svelte`;
test in `dashboard.browser.test.ts` (or a new `arranging.browser.test.ts` beside it)

**Interfaces:**
- Consumes: `Arrangement` (Task 5), `announce` (Task 6), messages (Task 7).
- Produces: `widgetActions(app, widgetId, arrangement?)` adds `move-widget` and `resize-widget`
  items (group `"layout"`, disabled when locked; hidden on a minimized widget).

- [ ] **Step 1: Write the failing browser tests:**
  - `"Enter picks up, arrows move, Enter drops"`: two half-width widgets; focus `a`'s title bar,
    Enter, ArrowRight ×6, Enter → `a` at `x 6`, `b` pushed; announcements in order (picked up …,
    `Column 7, row 1.`, dropped … `1 other widget moved.`); one undo entry; Ctrl+Z restores.
  - `"Shift+arrows resize"` (w grows, clamps at the minimum on Shift+ArrowLeft).
  - `"Escape cancels"` (layout back, `layout_cancelled` announced, nothing applied).
  - `"moving focus away cancels"` (Tab while picked up).
  - `"Down at the bottom announces it"`.
  - `"phone column: arrows reorder"` (viewport 400 × 800; ArrowUp on the 3rd → it's 2nd in reading
    order and on desktop takes the 2nd's spot; `layout_phone_position` announced).
  - `"Move… from the menu picks up with focus on the title bar"`; `"Resize… announces the resize
    instructions"`.
  - `"a keyboard drop on the starter keeps focus through the hand-off"` (render the starter
    through the app harness the existing starter tests use; after the drop the session is the copy
    and `document.activeElement` is the moved widget's title bar).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Title bar `keydown` (Enter/Space pick up; while active: arrows → `step`
  / `grow`, Enter/Space → `drop`, Escape → `cancel` with `stopPropagation`); `focusout` from the
  title bar cancels. Announce after each step using the preview rect (1-based). The menu items call
  `arrangement.pickUp` and then focus the title bar **after** the dropdown's own close-focus
  (`onCloseAutoFocus` focuses the ⋯ anchor), e.g. in a `requestAnimationFrame`; the pick-up must
  not be cancelled by that focus move. Before `drop` on the starter, set `pendingFocus`; the
  `WidgetFrame` whose id matches focuses its title bar on mount and clears it.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** — `"Move and resize widgets by keyboard"`.

### Task 9: Mouse drag, resize handles, autoscroll

**Files:** Create `src/lib/components/dashboard/ResizeHandles.svelte`; modify `WidgetFrame.svelte`,
`DashboardGrid.svelte`; tests in the browser test file.

- [ ] **Step 1: Write the failing browser tests** (use `userEvent` pointer actions or dispatched
  `PointerEvent`s with `pointerType: "mouse"`):
  - `"dragging a title bar moves the widget on drop"` (drag `a`'s title bar right by 6 cell widths →
    `a.x 6`; one undo entry; `layout_dropped` announced).
  - `"a click on the title bar without moving doesn't start a drag"` (< 4 px → no preview).
  - `"the ⋯ button isn't a drag handle"`.
  - `"Escape during a drag cancels"`.
  - `"dragging the right edge resizes; the left edge moves x and w"`; `"handles are hidden from
    assistive tech"` (`aria-hidden="true"`, not focusable).
  - `"dragging near the bottom of the viewport scrolls the page"` (tall dashboard; pointer held
    within 40 px of the bottom → `scrollY` increases).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Pointer capture on the title bar; read `GridMetrics` from the grid
  element (`getBoundingClientRect` and computed `gap`/`grid-auto-rows`) at pick-up; call `moveTo`
  only when the target cell changes. Handles: left, right, bottom, bottom-left, bottom-right, shown
  on hover/focus-within of the frame on `(pointer: fine)`, resize cursors. Autoscroll with a
  `requestAnimationFrame` loop while the pointer is within 40 px of the viewport's top or bottom.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** — `"Drag and resize widgets with the mouse"`.

### Task 10: Touch: long-press, the selected state, no long-press menu

**Files:** Modify `WidgetFrame.svelte`, `ResizeHandles.svelte`,
`src/lib/components/menu/ContextMenuHost.svelte`, `src/lib/components/menu/context-menu.browser.test.ts`;
tests in the dashboard browser test file.

- [ ] **Step 1: Write the failing browser tests** (dispatched `PointerEvent`s with
  `pointerType: "touch"`):
  - `"a long-press on the title bar lifts the widget; sliding moves it"`.
  - `"a swipe that starts before the long-press doesn't pick up"` (move > 8 px within 500 ms → no
    `active`).
  - `"lifting without moving selects with touch handles and Done"` (handles and "Done" button ≥ 44 px;
    tapping Done applies one change and announces `layout_dropped`; tapping outside also finishes).
  - `"on a phone only the bottom handle shows"`.
  - In `context-menu.browser.test.ts`: `"a touch long-press doesn't open the context menu"`; the
    existing right-click and Shift+F10 tests still pass.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Title bar `touch-action: pan-y` (page swipes still scroll); on touch
  `pointerdown` start a 500 ms timer, cancelled by > 8 px movement or `pointercancel`; when it fires,
  `pickUp(id, "move", "touch")` and add a non-passive `touchmove` listener that calls
  `preventDefault()` until the drag ends, so the page doesn't scroll during the drag. Release
  without movement → selected state. In `ContextMenuHost`, stop resolving on non-mouse
  `pointerdown` and keep bits-ui's trigger from opening on touch long-press (e.g. `disabled` on the
  trigger while the last pointer was touch, or cancelling the `contextmenu` event when
  `pointerType` was touch). **Note:** until spec 2b adds the dashboard ⋯ button, touch users reach
  dashboard actions only through existing buttons; that's acceptable on the `layout` branch, which
  doesn't reach `main` before 2b.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Hand check on real devices** (Chrome on Android and Safari on iOS/iPadOS, through
  `npm run dev -- --host` on the LAN): page scrolls when swiping over title bars; long-press lifts;
  drag doesn't scroll the page; resize handles work. Record the result in the PR body. If no device
  is available, say so in the PR and add it to `DEFERRED.md` with the trigger "before `layout`
  merges into `main`".
- [ ] **Step 6: Commit** — `"Arrange widgets by touch"`.

### Task 11: E2E, axe, and the drag performance check

**Files:** Create `e2e/arranging.spec.ts`, `e2e/drag-performance.spec.ts`; add helpers to
`e2e/helpers.ts` (`titleBar(page, title, index?)`, `dragTitleBar(page, title, dx, dy)`).

- [ ] **Step 1: Write the E2E tests** (`test.use({ reducedMotion: "reduce" })` except where noted):
  - `"mouse drag moves a widget and survives a reload"` (`page.mouse` down/move in steps/up; reload →
    same order; `expectSaved`).
  - `"resizing by the right edge"`.
  - `"keyboard move and resize, then undo"`.
  - `"a drop on the starter makes the copy"` (URL becomes the copy's; the moved widget is where it
    was dropped; focus on its title bar after a keyboard drop).
  - `"phone width: keyboard reorder"` (viewport 400 × 800).
  - `"touch long-press drag"` (dispatched pointer events via `page.evaluate`, all engines).
  - `"axe: picked-up state"` (the project's existing axe helper, as in `e2e/a11y.spec.ts`).
  - In `drag-performance.spec.ts` (Chromium only, `test.skip` elsewhere): 30 placeholders (import a
    document with `sharedDoc`-style helper), CDP `Emulation.setCPUThrottlingRate { rate: 4 }`, a
    scripted mouse drag across the grid in 60 steps; record `requestAnimationFrame` deltas in the page;
    assert the 95th-percentile frame time is under a threshold set from a measured baseline (record the
    baseline and the chosen threshold in a comment; start the threshold at 2× the baseline's p95).
- [ ] **Step 2:** Run `npm run test:e2e` → PASS on Chromium; then `npm run test:e2e:podman` (all three
  engines) → PASS.
- [ ] **Step 3: Commit** — `"Add arranging E2E and the drag performance check"`.

### Task 12: Docs, deferrals, full verification, PR

**Files:** `TODO.md` ("Start here"), `DEFERRED.md` (anything deferred while building; the touch
real-device check if not done), the design doc only if something changed while building.

- [ ] **Step 1:** Update `TODO.md` "Start here": 2a done (what it built, how it was verified),
  next is 2b.
- [ ] **Step 2:** Run `npm run lint && npm run check && npm run test && npm run build &&
  npm run check:build && npm run check:budget` → all PASS (budget: initial JS under the limit).
- [ ] **Step 3: Commit** — `"Record spec 2a in TODO"`; push `layout-2a-arranging` (first push of
  `layout` too: `git push -u origin layout` before it) and open a PR into `layout` with `gh pr
  create --base layout`. The body summarizes the spec, lists the hand checks (Task 10 Step 5), and
  carries no AI attribution. Do not merge it without the user's go-ahead.
