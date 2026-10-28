# Release 1, step 2: the layout engine and windowing

Date: 2026-10-28. Step branch: `layout` (from `main`). Two specs, each a PR into `layout`
(the second stacked on the first), then `layout` into `main` with the user's approval, the way
Foundations used the `foundations` branch.

Repo: **data-dashboard only.** No sjvair.com or sdk-js changes are expected; if one turns up, it
needs an approved plan in that repo first (sjvair.com branches from and PRs into `develop`).

Out of scope: real widgets (step 4), the map widget and WebGL context release (step 5, with
map-sdk), and server-backed documents (sync), which is its own track (see "Parallel work").

## Why

The dashboard is a page of windowed widgets, but today the widgets just sit where they were
placed. Step 2 makes arranging them real: drag and resize on a snapping grid, minimize to a
taskbar, fullscreen, and a phone layout, all usable by keyboard and screen reader (WCAG 2.2 AA).
It is proven with the placeholder widget, so step 4's widgets drop into finished chrome.

### Who it's for (from the user, 2026-10-28)

- **A researcher** comparing datasets: rearranges constantly, many widgets, puts charts side by
  side, fullscreens one to dig in, minimizes what they're done with. The heaviest user of
  drag, resize, and minimize.
- **A teacher on a school Chromebook** (slow CPU, often a touchpad, sometimes a touchscreen
  2-in-1) arranging a dashboard for class, then **projecting one widget fullscreen**. Confirmed
  as a real use.
- **A community member** watching live data near home, often on a phone. Mostly looks.
- **A school office worker** with a dashboard open all day, deciding things like canceling
  after-school sports. Needs a glance, not rearranging.

### What follows from that

- **The layout never moves unless someone moves it.** Live refresh, another tab's save, or a
  widget loading must not shift anything.
- **Dragging on a slow Chromebook with a touchpad is forgiving:** clear snapping, an obvious drop
  target, no lag. The keyboard path is also a fallback for a fiddly touchpad.
- **Fullscreen is a "show this one thing" mode** (the projector, the office worker's deciding
  reading).
- Anti-goals: a layout that jumps around on its own; a drag that stutters on a Chromebook; an
  arrangement feature with no keyboard path; a phone layout that silently diverges from desktop.

## Decisions made while designing (with the user, 2026-10-28)

1. **Fullscreen covers the dashboard area**, as `ARCHITECTURE.md` already says, not the whole
   screen. The browser's own full screen (F11, the Chromebook fullscreen key) gives an
   edge-to-edge projector view without us building it. A "present" mode using the browser
   Fullscreen API is deferred (see `DEFERRED.md`).
2. **Minimize is saved in the dashboard, and a minimized widget has no spot on the grid.**
   Minimizing is an ordinary edit: the widget leaves the grid (the rest close up) and goes to the
   taskbar. **Restoring places it like a newly added widget: at the bottom, at the size it had.**
   Undo right after minimizing puts it back exactly where it was. A shared copy shows the
   author's minimized widgets in the taskbar (it's the recipient's own copy; restoring is one
   click). Minimizing or restoring on the starter makes the user's copy, like any other edit.
   Spec 1's `minimized: { restoreRect }` becomes a plain flag (shapes are free before the first
   release). This replaces the architecture's "restore to the previous rect if free, else the
   nearest free slot" (with gravity, the old spot is almost never free). _History:_ a
   per-browser, view-only minimize was considered first and dropped the same day: it left
   hidden widgets holding grid spots that every rearrangement had to map, which the builder
   check showed was the hard part.
3. **Undo covers every change to the saved dashboard**: move, resize, minimize, restore, add,
   delete, rename, and so on. Things that change only your own view stay off it (fullscreen,
   scrolling, menus). One drag can move several widgets, and dragging back doesn't put them
   back, so undo is the only clean way back. **Fullscreen is never an edit**: it never makes a
   starter copy.
4. **Phones show the same layout as desktop**: a single column in the desktop layout's reading
   order. No separate phone order is saved (the user considered one and decided against it;
   `DEFERRED.md`'s "Persisting tablet/phone layouts separately" stands).
5. **Rearranging works on phones**, and it changes the desktop layout (the user is fine with
   that). Moving widget A above widget B in the phone column puts A in B's spot on the desktop
   grid and the rest shuffle. On a phone only a widget's height can be resized, and that height
   is the same on desktop.
6. **On touchscreens, a long-press on the title bar picks a widget up.** Slide to move it.
   Lifting without moving leaves it **selected, with touch-sized resize handles** (the phone
   home-screen pattern); tap outside it or a "Done" button to finish. Long-press on the widget
   body is left to the widget (map pan, calendar range, chart scrub).
7. **On touchscreens the context menu comes from the ⋯ buttons, not long-press.** Long-press
   already means the browser's own selection and link previews, and now picking up a widget. A
   mouse keeps right-click everywhere, and Shift+F10 / the Menu key still work. Spot-specific
   touch menus (e.g. "Analyze this monitor" on a map point) are deferred to the map widget.
8. **Two layouts, not three:** the 12-column grid on anything tablet-sized or wider (roughly
   768 px and up), the single column below that. No separate in-between tablet layout; what you
   arrange on a tablet is exactly what's saved. The layout engine takes the column count as an
   input, so a tablet layout can be added later as a pure display change. Deferred with a
   trigger (see `DEFERRED.md`).
9. **Two specs** (below), with accessibility built into each rather than a trailing pass.

## Calls made by Claude (not discussed with the user; check these)

- One step-level design document for both specs; each spec gets its own plan.
- Grid numbers: row height and gap stay theme tokens (`--grid-row-height`, `--grid-gap`); the
  column count (12) and the phone cut-off (Tailwind's `md`, 768 px) live in one layout config
  module. Widget min/default sizes stay on each widget type. The placeholder's minimum width
  goes from 2 to 3 columns so it stays usable at tablet width (12 columns at 768 px is ~55 px
  each).
- The screen always shows the **tidied** saved layout (below). A broken, shared, or imported
  layout is fixed on screen without saving. Tidy fixes are saved only by layout edits (a drop,
  a minimize, a restore), bundled into that edit's one change and its one undo step; a rename
  or an added widget doesn't write them.
- Move, resize, minimize, and restore are **one change each**, listing every widget whose saved
  layout changed.
- **Gravity and moving down** (builder check): with upward compaction, moving a widget down one
  cell into empty space would snap straight back. So moving down means moving past the next
  widget below it in the same columns (it takes that widget's place and that widget moves up);
  at the bottom, Down announces that it's already at the bottom and does nothing. Up, Left, and
  Right move one cell. A pointer drag below the last widget snaps to the lowest spot gravity
  allows.
- **Another tab's change mid-drag** (builder check): the drag continues; the preview is
  recomputed against the new document, and the drop's `from` is read from the document at drop
  time. If the dragged widget is deleted or minimized elsewhere, the drag cancels with an
  announcement.
- The keyboard model, announcements, taskbar, fullscreen exit behavior, deep-link handling,
  and the performance target in the sections below.
- The dashboard gets a visible ⋯ button for its own actions (touchscreens lose the long-press
  menu).
- The `/workspace` trailing-slash entry in `DEFERRED.md` is settled in spec 2b (home renders as
  `/workspace/`).

## The model

### What's saved and what's shown

- **Saved:** each widget's desktop `rect` (`x`, `y`, `w`, `h` in grid cells), as today, and
  `minimized: true` on minimized widgets (replacing `{ restoreRect }`). A minimized widget's
  `rect` keeps only its size meaningfully; its position is ignored and it takes no part in the
  grid.
- **Shown:** `tidy(saved rects of the widgets that aren't minimized, columns)`. "Tidy" is the
  layout engine's normalizing pass:
  1. Clamp each rect to the grid (x + w ≤ columns) and up to its type's minimum size (an unknown
     type uses the placeholder's).
  2. Resolve overlaps: take widgets in reading order (y, then x, then a stable tiebreak by id);
     a widget that overlaps one already placed moves down until it doesn't.
  3. Compact upward ("gravity"): each widget, in reading order, moves up as far as it can.
  A saved layout the dashboard itself produced is already tidy, so tidy is a no-op on it.
- **Phone:** the shown layout's reading order, one column, each widget `h` rows tall.

Minimizing a widget, opening a shared copy, or opening an imported dashboard with overlaps all
go through this one path. Nothing is written until the user makes a layout edit. The engine
only ever sees the widgets on the grid; minimized widgets are outside it.

### The layout engine

Pure TypeScript in `src/lib/layout/` (replacing `src/lib/widgets/placement.ts`; its
`rectsOverlap`, `placeAtBottom`, and `readingOrder` move in or are rewritten), unit-tested like
`url-state.ts`. Works in grid cells only; pixels stay in the UI layer. Every function takes the
column count. At least:

- `tidy(items, columns)`: above.
- `move(items, id, to, columns)`: the moved widget takes the target cell; widgets it overlaps are
  pushed down (cascading); then everything compacts upward. Returns the new layout.
- `resize(items, id, size, columns)`: the same, for a new size clamped to the type's minimum and
  the grid.
- `moveInOrder(items, id, index, columns)`: the phone move. Puts the widget at a desktop position
  so that, after tidying, it sits at `index` in reading order (in practice: it takes the
  position of the widget currently at `index` and the rest shuffle). A property test asserts the
  resulting reading order for random layouts.
- `placeNew(items, size, columns)`: where an added, duplicated, or restored widget goes (today's
  "at the bottom", kept).
- `diff(before, after)`: the rects that changed, for building one change.

Items carry `{ id, rect, minSize }`; only widgets on the grid are items.

### The change

A new change type in `src/lib/changes/types.ts`:

```ts
type Placement = { rect: Rect; minimized: boolean };
{ op: "setLayout", target: { widgetIds: string[] }, from: Record<id, Placement>, to: Record<id, Placement> }
```

- **Move / resize:** one per drop, keyboard drop, or touch "Done", covering the moved widget and
  every widget whose saved rect changed (pushed widgets and tidy fixes).
- **Minimize:** the widget's `minimized` goes to true (its rect unchanged), plus any tidy fixes
  for the rest of the grid.
- **Restore:** `minimized` goes to false and its rect becomes `placeNew` at its saved size.
- `applyChange` gives the inverse (swap, with `from` read from the document as it really is,
  like `setField`). One undo puts everything back, including a minimized widget's exact spot.
- During a drag nothing is applied; the preview is component state. Autosave sees one edit.
- **Cross-tab overlap:** two `setLayout`s overlap if they share a widget id with different `to`;
  a `setLayout` overlaps a `removeWidget` of any id it lists. Two tabs moving different widgets
  don't conflict; if the combined result overlaps, tidy fixes it on screen.
- `applyForced` ("Keep mine") drops ids that are gone and applies the rest.
- The schema check stays (non-negative ints, `x + w ≤ 12`, `w`, `h` ≥ 1). Change validation
  requires `from` and `to` to have the same keys as `target.widgetIds`.
- Existing users of `placeAtBottom` (Add widget, Duplicate, `replaceIfOverlapping` in rebase)
  move to the engine's `placeNew`. A widget added while others are minimized is placed among
  the grid widgets only.

## Spec 2a: Arranging

### Grid

- `DashboardGrid` renders the shown layout with CSS Grid (`grid-column` / `grid-row`), 12
  columns from `md` up, one column below. Tab order follows reading order (as today).
- The grid grows downward; no horizontal scrolling.

### Mouse and touchpad

- **Drag by the title bar** (pointer events, pointer capture). The ⋯ button isn't a drag
  handle. A few pixels of movement start the drag, so a click on the title bar still focuses it.
- **Resize by hover handles** on the edges and corners (resize cursors). Keyboard resize changes
  the right and bottom edges; the pointer handles may also offer left/top-left and the
  remaining corners (builder's call).
- **While dragging:** the widget follows the pointer with a CSS transform; an outline shows the
  snap target; the other widgets slide to their previewed spots (FLIP; instant under
  `prefers-reduced-motion`). The preview is recomputed only when the target cell changes, not
  on every pointer move. Near the top or bottom of the viewport the page auto-scrolls.
- **Drop** applies one `setLayout`. Esc during a drag cancels it.
- Undo / Redo already exist (Ctrl+Z / Ctrl+Shift+Z and the dashboard menu).

### Touch

- **Long-press on the title bar** (about 500 ms, small movement tolerance) lifts the widget;
  sliding moves it like a mouse drag. A swipe that starts on a title bar without the long-press
  must still scroll the page. Proving that on a real touch device (Chrome on Android, Safari on
  iOS/iPadOS) is part of the spec; the engine choice of `touch-action` and press detection is
  the builder's.
- **Lifting without moving** leaves the widget selected: touch-sized resize handles (well over
  WCAG 2.5.8's 24 px), a "Done" button, and tapping outside finishes. One `setLayout` per
  finished selection.
- **On a phone:** moving reorders the column with `moveInOrder`; only the bottom-edge handle
  shows (height only).
- **No long-press context menu on touch** (decision 7): the context-menu host ignores
  touch-initiated long-presses; the ⋯ buttons open the same menus.

### Keyboard

- **Focus a title bar and press Enter (or Space) to pick the widget up.** Arrows move it one
  cell, Shift+arrows resize from the right/bottom edge, Enter or Space drops (one `setLayout`),
  Esc cancels and puts everything back, and moving focus away cancels. On a phone, Up/Down move
  one position in the column and Shift+Up/Down change the height.
- **"Move…" and "Resize…"** in the widget's ⋯ menu start the same mode on that widget (they
  differ only in the first announcement). They are hidden while the widget is minimized.
- The preview, pushed widgets, and animations are the same as for a pointer drag.

### Announcements

- One polite live region for the dashboard page, messages through Paraglide, numbers through
  the `format` module, positions 1-based.
- On pickup: the widget's title, its position, and the keys ("Picked up Chart. Column 3, row 2.
  Arrows move, Shift+arrows resize, Enter drops, Escape cancels."). On each step: the new
  position or size. On drop: the result and how many other widgets moved. On cancel: that it
  went back. On a phone: "Position 3 of 8."
- Pointer and touch drops announce the result too.

### The starter dashboard

The starter lives at `/` and is copied on its first edit (spec 1's hand-off). A drop on the
starter is an edit: it goes through the existing hand-off, and the arrangement must survive it
(the copy gets the new layout, and focus stays on the moved widget).

### Performance

- During a drag, per frame, only the dragged widget's transform changes; no document or
  reactive-store updates per pointer move. Pushed widgets animate with transforms.
- **Target:** smooth dragging with 30 placeholder widgets at 4× CPU slowdown in Chromium. A
  scripted check (Playwright with CPU throttling, measuring frame times during a scripted drag)
  is part of the spec; the exact threshold is the builder's to set from a baseline, and the
  low-end Chromebook check before go-live (`ARCHITECTURE.md`) still applies.
- The layout code is in the initial bundle (it's the app shell); keep it small and inside the
  200 KB budget.

### Tests (2a)

- Unit: the engine (tidy, move, resize, moveInOrder with a property test, placeNew, diff), the
  new change (apply, inverse, overlap, rebase, validation).
- Component (browser mode): pickup/move/drop/cancel by keyboard; announcements; Move… /
  Resize… menu items.
- E2E on all three engines: mouse drag and resize, keyboard move and resize, undo after a drop,
  reload keeps the layout, phone-width reorder, a touch long-press drag (Playwright touch
  emulation; the real-device check above is by hand), axe on the arranging state.

## Spec 2b: Windowing

### Minimize and the taskbar

- **Minimize** (widget ⋯ menu, and a title-bar button) is a `setLayout` edit (decision 2): on
  the undo list, synced to other tabs like any edit, and on the starter it makes the user's copy
  through the existing hand-off (focus moves to the taskbar item after the hand-off).
- **Taskbar order** is the widgets' order in the document (my call; no separate ordering is
  stored).
- **The taskbar** appears only when something is minimized, sticks to the bottom of the
  dashboard area, and scrolls sideways when full. It's a toolbar with a roving tabindex (one
  Tab stop; arrows move between items; Home/End).
- **A taskbar item** shows the widget's title and type icon. Activating it restores the widget.
  Its menu (⋯ / right-click / Shift+F10) has Restore, Fullscreen, and the widget's other actions
  minus Minimize, Move…, Resize….
- **Focus:** minimizing moves focus to the widget's taskbar item; restoring moves it to the
  widget's title bar. Both are announced ("Chart minimized to taskbar." / "Chart restored.").
- **Restore** (activating the taskbar item, or its menu) is a `setLayout` edit placing the
  widget at the bottom at its saved size (decision 2). The page scrolls it into view.
- On a read-only page (today: a document opened read-only; later, sync's `/shared/…`), Minimize
  and Restore are unavailable like other edits.
- **On a phone:** the same taskbar as a scrolling strip at the bottom; minimized widgets leave
  the column.

### Fullscreen

- **Route:** `/dashboards/:id/widgets/:widgetId`, deep-linkable; back/forward move between it
  and the dashboard. Opening it from the dashboard pushes a history entry.
- **Opening it:** widget ⋯ menu "Fullscreen", a title-bar button, and the taskbar item's menu.
- **Exiting:** Esc, a close button, or Back. If this session pushed the entry, exiting goes back
  in history (no piling-up entries); if the page was opened on the link directly, exiting
  replaces it with `/dashboards/:id`.
- **The widget stays mounted.** Its frame is lifted to cover the dashboard area (not
  re-rendered elsewhere), so a widget's own state survives entering and leaving. The grid
  layout underneath is unchanged, and the rest of the dashboard is `inert` while fullscreen.
- **Animation:** FLIP from the widget's grid rect to the dashboard area and back; instant under
  `prefers-reduced-motion`.
- **Focus:** trapped inside the fullscreen widget; on exit it returns to the widget's title bar
  (or its taskbar item if it's minimized).
- **The widget is told it's fullscreen** (a prop or context on the widget component) and gets
  the space, so step 4's widgets can scale up their content for a projector.
- **Deep links:**
  - A minimized widget opens fullscreen; exiting returns it to the taskbar (fullscreen never
    edits the document, so it stays minimized).
  - A widget not in the dashboard: go to `/dashboards/:id` (replace) with a short notice.
  - A dashboard that doesn't exist: the existing missing-dashboard handling.
  - The starter: its fullscreen route is `/dashboards/<starter id>/widgets/:widgetId`, and
    exiting goes to `/`. The widget route must not redirect the starter to `/` the way
    `/dashboards/:id` does.
- **Same on phones** (fullscreen covers the dashboard area below the top bar).

### The dashboard's ⋯ button

A visible ⋯ button for the dashboard's own actions (Add widget, Undo/Redo, Rename, Duplicate,
Share, Delete, …: the same provider the blank-space context menu uses), placed in the dashboard
header. Needed because touchscreens lose the long-press menu.

### `/workspace/` home

Settle `DEFERRED.md`'s "`/workspace` without a trailing slash": the router shows home as
`/workspace/`, and in dev a bare `/workspace` reaches the app rather than Vite's base-URL hint
page. Remove the entry when done (it's done, not dropped).

### Tests (2b)

- Unit: minimize/restore changes (apply, inverse restoring the exact spot, restore placement),
  the fullscreen route's exit decision.
- Component: taskbar roving tabindex, focus after minimize/restore, the fullscreen focus trap
  and Esc.
- E2E on all three engines: minimize and restore (focus and announcement), undo of a minimize,
  minimize surviving a reload, minimize on the starter making a copy, fullscreen open/exit by Esc/close/Back, a deep link
  to a fullscreen widget, a minimized widget, and a missing one, reduced motion, axe on the
  taskbar and fullscreen states.

## Accessibility summary (both specs)

Keyboard move and resize (WCAG 2.5.7) and Move… / Resize…; touch targets over 24 px (2.5.8);
live-region announcements for every layout change; focus management for minimize, restore,
and fullscreen (trap, Esc, restore); the taskbar toolbar; `prefers-reduced-motion` on every
animation; never color alone for the drop target (an outline, not a tint).

## Changes to the planning docs (same commit as this design)

- `ARCHITECTURE.md` → "Dashboard layout mechanics": restore places the widget at the bottom
  at its old size; two layouts (12 columns from tablet width up, one column below); touch
  long-press drag; phone rearranging changes the desktop layout.
- `ARCHITECTURE.md` → "Routing, URL state & undo": undo covers changes to the saved dashboard,
  including minimize/restore; fullscreen is never an edit.
- `ARCHITECTURE.md` → "Actions & context menu": on touchscreens the menu opens from ⋯ buttons,
  not long-press; the dashboard has a visible ⋯.
- `DEFERRED.md`: the browser-fullscreen "present" mode; a separate tablet layout; spot-specific
  touch context menus; the "Persisting tablet/phone layouts separately" entry gains a note that
  it was reconsidered on 2026-10-28 and kept.

## Left to the builder

The tidy and push-down algorithm details beyond the rules above; FLIP and animation
implementation; long-press detection and `touch-action` handling (with the real-device proof);
whether resize handles include the left/top edges; the frame-time threshold; module and
component boundaries; how the widget learns it's fullscreen; message wording (through
Paraglide).

## Parallel work

The server-backed documents (sync) track can run in a parallel session now. Its only overlap
with step 2 is the change list (`src/lib/changes/`): 2a adds `setLayout`. Sync should treat
changes generically; if it starts before 2a merges into `layout`, expect a small rebase there.
