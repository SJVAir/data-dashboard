# Nav item and a closable "Change place" bar — design

Date: 2026-11-25. A small change from the user's requests on 2026-11-25. Branch `nav-and-place-bar`.

## Why

The top nav's "Dashboards" link repeats what the dashboard picker already offers ("All dashboards",
"Recently deleted"). The "Change place" bar takes space on every starter-made dashboard, even after
the person has set their place. The user wants to close the bar for good on a dashboard, with
"Change place…" still reachable from the dashboard's menus.

## Goals

1. Remove "Dashboards" from the top nav. "Data Portal" stays.
2. The place bar can be closed. Once closed on a dashboard, it doesn't come back on that dashboard.
3. "Change place…" is in the dashboard's ⋯ menu and its right-click menu.
4. Copies show the bar again: Duplicate, Duplicate for another place, New from starter, import, and
   copies saved from share links.
5. The starter's welcome Note says where "Change place" is when the bar is gone.

## Non-goals

- Moving the dashboard's ⋯ button (the user: keep it beside the dashboard's name, see how it feels).
- "Change place…" on dashboards without a bar (the user chose "only dashboards with a bar, for
  now"; see `DEFERRED.md`).
- Showing which widgets "Change place" moves (still deferred).
- A way to reopen a closed bar other than Undo (the menu item does the bar's job).

## Approaches (storing "closed")

- **A. In the dashboard document** (chosen by the user): a flag on `body.placeBar`. Closing is an
  undoable change, holds in every tab and device and for viewers; copies clear it.
- B. A per-device setting through the platform adapter, keyed by dashboard. No undo, doesn't follow
  the person to another device, nothing for copies to clear. Rejected: works against "for good" and
  gives no Undo for a mistaken close.

## Design

**Nav.** Remove the "Dashboards" link from `TopNav.svelte`. Keep the `nav_dashboards` message: the
Import page still uses it.

**Document.** `DashboardBodySchema.placeBar` becomes `{ place, closed?: true }` (the object isn't
strict, so old documents still open; leaving `closed` out means open). `barVisible(doc)` is false when
`closed`. The bar's place still moves with "Change place" while closed (it's what the menu item
works from).

**Closing.** An icon button (×) at the bar's end, accessible name "Hide place bar" (my call), at
least a 24×24 target, only where the bar offers "Change place" (`editable`: not for viewers or live
share links). Closing is one undoable change through `applyChange`; my call: a `replaceDocument`, as
the bar's own change already is, so the change schema doesn't grow. On the built-in starter it is a
first edit like any other: the hand-off saves the copy, with the bar closed. After closing, focus
moves to the dashboard's ⋯ button and the announcer says "Place bar hidden. Change place is in the
dashboard's menu." (my call). Undo brings the bar back.

**Menu item.** "Change place…" in `dashboardActions` (`src/lib/actions/dashboard.ts`), so the ⋯ and
right-click menus both get it. Shown only for the open dashboard (not on list rows) when it is
editable and has a `placeBar` (open or closed); it runs `openPlacePicker({ dashboardPlace: true })`
after the menu closes, as "Duplicate for another place" does, so focus returns to what opened the
menu. Its text is a new message ("Change place…").

**Viewers.** A viewer of a dashboard whose owner closed the bar doesn't see the bar (one document; my
call). Viewers already get no "Change place".

**Copies.** `freshCopy` (`src/lib/starter/starter.ts`) drops `closed`. Every clone goes through it:
Duplicate and Duplicate for another place (`dashboard-index` `duplicate`), New from starter
(`copyOfStarter`), import and share-link copies (`sharing/copy.ts` `saveCopy`). "Save mine as a copy"
after a sync conflict keeps the person's own version as it is, `closed` included (my call: it isn't a
clone, it's their edits). Restoring an earlier version restores that version's bar state.

**Welcome Note.** `starter_note_welcome` reads "Use **Change place** above, or in the dashboard's ⋯
menu, to pick your school, city or ZIP Code." (the rest unchanged). The Note stores its message key,
so the starter and every copy show the new text. The bold text still matches `place_bar_change`.

## Docs

- `DEFERRED.md` → "A "Change place" bar for dashboards not made from the starter.": add that the
  menu item now exists for dashboards with a bar, and that showing it on any dashboard with a main
  place (asking which on a tie) was considered and left out "for now" (the user, 2026-11-25); revisit
  unchanged.
- `ARCHITECTURE.md` / `TODO.md` / `ROADMAP.md`: update where they describe the nav or the bar.

## Tests

- Nav: `shell.browser.test.ts`, `get-data.browser.test.ts` and `e2e/sharing.spec.ts` stop using the
  "Dashboards" link (go through the picker's "All dashboards" or the URL).
- Unit: `barVisible` with `closed`; `freshCopy` clears `closed`; schema accepts old and new bars.
- Browser: closing hides the bar, focuses ⋯, announces; Undo brings it back; no close button for a
  viewer; menu item present with a bar (closed too), absent without one, absent on list rows and for
  viewers; it opens the picker and moves the bar's place.
- E2E: close the bar, change place from the ⋯ menu, duplicate and see the bar again; axe on the bar
  with its close button.

## Left to the builder

Icon choice from lucide (`x`), exact placement classes within the bar, test file layout.
