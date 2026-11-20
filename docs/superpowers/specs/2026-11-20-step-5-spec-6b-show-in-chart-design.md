# Release 1, step 5, spec 6b: "Show in a chart" / "Show in a table" from a Map

_Decided with the user 2026-11-18 (the spec 6 brainstorm, before it split into 6a and 6b);
brainstormed and confirmed 2026-11-19–20 in the 6b session. Branch `step-5-spec-6b`, from
`origin/step-5`, PR into `step-5`._

## Intent

A Map shows where the air is bad on one day, month or year. Comparing places over time takes a
Chart or a Table. Today a person who has marked monitors on a Map has to rebuild that selection
by hand in the Data Portal. This spec gives them one step from the Map to a Chart or Table of the
marked monitors, over the Map's dates. A pinned section card does the same for one section's
pesticide use.

**Looking is the common case.** So these items open the Data Portal on the new Chart or Table
rather than adding a widget: leaving costs nothing, and the same items work on view-only
dashboards and share links. Adding the widget to a dashboard is the person's choice from there.

Audience: parents, teachers and students, researchers and agencies (copy serves all of them).

## Decisions (the user, 2026-11-18, confirmed 2026-11-19; not to be reopened)

1. **Sections: option B.** Only monitors are marks. A **pinned** section card (not the hover
   card, which can't take clicks) gets "Show in a chart" for that one section. No section marks,
   no section browsing in the place picker.
2. **The items open the Data Portal** as `/dashboards/:id/widgets/new` for the Map's dashboard,
   so "Add to" targets that dashboard, with the drawn marks as the places, starting on Chart (or
   Table).
3. **The saved draft is left alone.** Opened from a Map, the Data Portal starts from what the
   Map gives it, keeps edits for this visit only, and never writes the device's saved draft (the
   rule Edit data already follows). Leaving with changes still asks "Discard changes?".
4. **Only the drawn marks are sent** (the user, 2026-11-12). A note in the Data Portal counts
   the marks left out because they're hidden.
5. **Over the cap (5 for a Chart, 10 for a Table):** the Data Portal opens with the shared place
   picker set to that limit, every mark ticked, so the person chooses which to keep. The same
   "choose which places to keep" replaces today's greyed-out Show as buttons whenever any
   over-limit selection switches to Chart or Table (the user, 2026-11-11).
6. **It works for viewers.** The items show on view-only dashboards and share links too, since
   looking isn't an edit.
7. **What's charted** reuses the Data Portal's Map → Chart (and → Table) conversion, with only
   the places swapped for the marks. The Chart takes the Map's one range and resolution (6a).
8. **Inside the Data Portal nothing else changes.** Switching a Map to Chart there still keeps
   the Map's places and drops the marks with their note. The menu items are the only way to
   chart marks.
9. **Series data** comes through the normal chart and table loading, by monitor id, never from
   the Map's day snapshot (spec 4).

## Decided in the 6b brainstorm (2026-11-19–20)

10. **The section card's chart covers the Map's range at the Map's resolution** (the user chose
    A). This is what the marks' chart gets too, so the two always agree. Pesticide use draws
    only at Monthly and Yearly, so a section card always has a range and a Monthly or Yearly
    resolution.
11. **Where "Add to" points when the person can't edit the Map's dashboard** (the user accepted
    the proposal). On a share link (`/shared/:token`, no session, the dashboard not in the
    viewer's list) and on a read-only dashboard of their own (`session.readOnly` is `"newer"`,
    `"invalid"` or `"unkept"`), the items open `/data`, which is tied to no dashboard. "Add to"
    then works as it does there today: the button names the last-opened dashboard, else the
    starter; its menu lists the others and "New dashboard". A read-only dashboard is never the
    button's target (`addTargets` skips it; today it could pick it, and adding would throw). An
    editor on their own dashboard (or the starter) gets `/dashboards/:id/widgets/new` (the
    starter as `STARTER_ID`, as `startGetData` does).
12. **The button's wording doesn't change for viewers** (the user agreed): "Add to ‹name›"
    already names a dashboard of their own.
13. **The items are listed only while at least one mark would be sent (drawn, or hidden only for its stop; decision 18)** (the user: hiding them
    matches what they'd expect). The calendars' "Open these days in a chart" follows the same
    rule. A Map with no marks, or with every mark hidden, lists neither.
14. **A Map on Now** (no range) gives the Chart or Table its type's default range (the last 30
    days), as Show as does today for a Now Map.
15. **Where the items live:** the Map's ⋯ menu (and its taskbar menu when minimized), as "Show in
    a chart" and "Show in a table". The section card's "Show in a chart" is a button in the
    pinned card's actions, beside Select / Remove (for viewers it's there alone).
16. **The starting draft travels in the history entry** (the user chose A). `navigate(path,
    { state })` (sv-router keeps it as `_userState`, read back as `route.state`). A reload, or
    Back / Forward to that entry, starts from the Map's draft again. The Data Portal validates it
    with `DraftSchema` like any input; an invalid one is ignored (the normal saved draft is
    used, as a plain visit does). The URL is unchanged, so nothing about the Map leaks into it.
17. **Choosing which places to keep uses the place picker dialog** (the user chose A). The Where
    control's dialog (`WhereControl.svelte` hosting `PlacePicker`) opens in multiple mode at the
    new type's cap with every place ticked, and a line above the chips: "Choose up to 5 places to
    keep." (the count from the cap). **Done is disabled while more than the cap are ticked.**
    - From **Show as** (any over-cap selection, a Map's 25 places say): clicking Chart or Table
      opens the dialog; Done converts with the chosen places; Cancel leaves the type and draft as
      they were. The "places" `TypeBlock` stops greying those buttons out.
    - From **the Map's items**: the Data Portal opens on the Chart or Table with the dialog
      already open over the marks. **Cancel there goes back** to where the person came from
      (`cancelPlan`: Back when the app pushed the entry, else the Map's dashboard, else home for
      a share link opened in a new tab). Every draft therefore stays within its type's limits; the
      saved draft can never hold an over-cap Chart.
18. **A mark with no figure for the stop shown is still sent** (the user, 2026-11-20). Spec 4's
    `"period"` hidden reason came after decision 4: a chart covers the whole range, so one empty
    stop says little about the rest. Marks hidden for the other reasons (`"pollutant"`,
    `"options"`, `"places"`, `"unknown"` in `marks.ts`) are left out and counted in the note.
19. **The Chart's resolution follows Show as exactly**: the Map's saved resolution is kept, so a
    Monthly Map gives a Monthly Chart and an Automatic Map an Automatic Chart. The same Map never
    gives two different Charts by the two routes (decisions 7 and 8). The hand-off doesn't
    store an effective resolution. _Build call (2026-11-20, Task 2):_ Show as turned out to drop
    the Map's resolution (`fromMapDraft` built the Chart's data from the range and layers only),
    against this decision's example and 6a's "never silently reset". `fromMapDraft` now keeps a
    ranged Map's saved resolution for range types that don't pin one (Chart, Table), so both
    routes give a Monthly Chart for a Monthly Map; a Map on Now gives none.

### Settled after the builder check (my calls, 2026-11-20)

20. **Viewers see the Map's items through an opt-in.** Today `WidgetFrame`'s read-only branch
    never calls `type.menu` (viewers get Download and Fullscreen only), on share links and on
    read-only dashboards of their own. A type's menu items gain an opt-in for read-only frames
    (a flag on the item, or a separate view menu on the type; the builder's). Only the Map's two
    items opt in. The calendars' "Open these days in a chart" adds a widget, so it stays hidden
    for viewers.
21. **The registry holds what the click needs**: per widget id, the drawn-and-sent marks, the
    hidden count, and a getter for the Map's dataset as this person sees it (data plus
    `tileOptions`, the viewer's held changes included). The menu item's `env` has only the saved
    widget, so it reads these from the registry.
22. **`addTargets` skips dashboards known to be read-only**, in the button and in the "others"
    menu: any already-open session with `readOnly` set (the Map's own dashboard is open, so it's
    known) and index items the index marks as newer. A dashboard whose read-only state only
    shows when it opens (`"unkept"`) is caught by `addFromDraft`'s existing throw, which shows
    "Couldn't add the widget" (rare; not worked around).
23. **Not in the Data Portal's previews**: the section card's button and the Map's items don't
    show in the Data Portal's Map preview (new widget or Edit data), since nothing else changes
    there (decision 8).
24. **After the opening keep dialog's Done, the kept draft is the baseline** for "Discard
    changes?", so passing the dialog alone doesn't count as a change.

## Goals

1. "Show in a chart" and "Show in a table" in the Map's menu, for owners and viewers, listed
   only while a mark would be sent.
2. "Show in a chart" on a pinned section card.
3. The Data Portal opened from a Map: on Chart or Table, the sent marks as places, the Map's
   range and resolution, a note counting hidden marks left out, the saved draft untouched.
4. Choosing which places to keep, from the Map and from Show as, in the place picker.
5. "Add to" that never targets a dashboard the person can't edit.
6. A hand-off shaped per Map layer (monitors and sections now), so spec 7's schools add a third
   kind without changing the path.

## Non-goals

- Section marks, section browsing in the place picker, a Chart of several sections.
- A township card's chart (townships aren't a chartable region type; deferred below).
- Changing what Show as does with a Map's marks inside the Data Portal (decision 8).
- Reading series from the Map's day snapshot (decision 9).
- Comparing two datasets (raised with the user at the end of 6b, not built in it).

## Anti-goals

- Adding a widget straight away, or writing anything to a dashboard or the saved draft, from
  the Map's items.
- Sending hidden marks, or silently dropping marks over the cap (the person chooses).
- A resolution the person chose being reset without a word (6a); the Chart shows the Map's.
- Telling a viewer to change something they can't (messages state the problem; only editors get
  the "Change it in the Data Portal" part).
- A chart whose figures disagree with the Map's for the same place and period (6a's one figure
  per pollutant).

## Constraints

- Pins stay at `@sjvair/map-sdk` `0.1.0-beta.21` and `@sjvair/sdk` `5.0.0-beta.15` unless the
  coordinator moves them (the `0.1.0-beta.22` pin, when told, removes DEFERRED "map-sdk: list
  the two new `Scale` keys in `NO_SCALE`" and "The Map's legend doesn't name the month or year
  figure" in the same change).
- No server, SDK or map-sdk work. Checked 2026-11-20: the local server's
  `pesticides/place/?region_type=mtrs&region=<code>` answers with the section's months and
  years, so a section is a chart place as it is (`getPesticidesForPlace` with
  `{ region: { type: "mtrs", external_id } }`; `mtrs` is already a coded region type).
- Build straight toward the step's final design: no stop-gaps; tests green, other widgets
  working, saved documents opening (nothing here changes a document schema).
- All strings through Paraglide; names of places in the app capitalized ("Data Portal"), the
  rest sentence case. Metadata is the source of truth for names and figures.
- The Map's lazy chunk and the Data Portal's chunk carry the new code; the initial bundle
  stays around 250 KB (213.2 KB after 6a; report the number).

## The design

### What the Map knows and exposes

- **Sent marks per widget.** `MapWidget` already knows the marks and why each hidden one is
  hidden (`hiddenReasons` through `MapNoteLines`). It publishes, per widget id, the marks to
  send (drawn, plus those hidden only for `"period"`; decision 18), the count left out, and a
  getter for its dataset (decision 21), in a small registry like the calendars'
  `shown-registry` (`showsSelection`). The registry sits in the initial bundle (as the
  calendars' does); the Map's chunk writes it and clears it on unmount.
- **"Drawn" follows what this person sees**: the viewer's held toolbar changes (pollutant
  showing, stop) count, through `tileOptions`. The Map's own drawn fallbacks (a saved stop that
  isn't the range's, say) count as drawn, never saved.
- **The Map's dataset as this person sees it**: the widget's data plus the effective options
  (`tileOptions`), which the hand-off converts. A viewer's held changes are used and never
  written.

### The hand-off (`src/lib/widgets/map/show-in.ts`, lazy, in the Map's chunk; name is the builder's)

One function builds the Data Portal's starting draft and where to open it:

```ts
type MapSend =
	| { kind: "monitors"; ids: string[]; hidden: number } // the sent marks (decision 18)
	| { kind: "section"; code: string }; // one pinned section card
// later (spec 7): | { kind: "locations"; ... }
```

- **Where another layer plugs in (spec 7):** a new Map layer adds one `MapSend` kind and one
  case in the function that turns a `MapSend` into the main layer's places (monitors → monitor
  refs, a section → one `mtrs` region; schools would give location refs). The registry,
  the history-state payload (`{ draft, from }`, where `from` carries only counts), the Data
  Portal's reading of it, the hidden-count note and the keep dialog don't change: they take a
  draft and counts, never a layer kind. A layer kind the menu offers is listed by the registry
  entry it writes, so a schools layer adds its own entry and items.
- **Monitors → Chart or Table**: the Map's draft (data + effective options) through the existing
  `fromMapDraft(draft, type, catalog, levels, drawable, now)` (the same call Show as makes, with
  the memoized map pollutants as `drawable`), then the converted main layer's places replaced by
  the sent marks (`toLayerPlaces` of monitor refs, in mark order). Over the cap the places are
  all the sent marks, and the Data Portal opens the picker (below) instead of cutting them.
- **The range and resolution**: exactly what `fromMapDraft` gives (decision 19): the Map's
  range (Chart and Table have no span limit, so it always carries over) and its saved
  resolution. A Map on Now gets the type's default range (decision 14).
- **Section → Chart**: a Chart with one pesticide use layer: `entryType` the figure the Map
  draws (`useFigureOf`), the Map's use filters, `place: { kind: "region", type: "mtrs", code }`,
  the Map's range, and the Map's saved resolution (Automatic stays Automatic; a Chart of
  pesticide use alone resolves to Monthly, as the Map does). The Chart's title stays
  generated (`title: null`), so its place name is the section's PLSS code (DEFERRED "Readable
  names for MTRS sections").
- **Where it opens** (decision 11): `/dashboards/:id/widgets/new` when the Map's dashboard is the
  current, editable one (the starter as `STARTER_ID`); else `/data`. Both carry
  `{ state: { getData: { draft, from: { hidden, overCap } } } }` (shape the builder's).
- **The menu items** (`menu` in `src/lib/widgets/map/index.ts`, which returns `[]` today) read
  the registry, show only while it holds a mark to send, and load the hand-off with `loadLazy`, as
  `openInChartItems` does. A gone chunk offers a reload; failures are reported. Not an edit, so
  never disabled for a locked or read-only dashboard.
- **The section card's button** is in the `cardActions` snippet, shown only on the pinned
  section card (a section feature, `interactive`), never on the hover form.

### The Data Portal opened from a Map

- `GetData.svelte` reads `route.state` on a `new` visit. With a valid hand-off draft it starts
  from it instead of `loadDraft`, and **never calls `saveDraft`/`flushDraft`** for this visit
  (a flag on the view, set from the route: "this visit's draft isn't saved"). `/data` and
  `.../widgets/new` without the state behave as today.
- **"Discard changes?"** asks when leaving with changes from the hand-off draft, as Edit data
  does (`draftChanged(initial, current)`); Add and Cancel-to-back don't ask.
- **The note**: with hidden marks left out, the view's notes add one line:
  "‹N› marked monitors aren't shown on the map, so they were left out." (plural forms through
  Paraglide; no instruction to change anything, since a viewer can't). The conversion's own
  notes (overlays, fill, smoke and fire left out) show as Show as shows them, except the
  "marks left out" note, which doesn't apply here (the marks are the places).
- **Over the cap**: the view opens the Where dialog in keep mode at once (decision 17).

### Choosing which places to keep (`WhereControl`, `PlacePicker`, `ShowAs`, `offer.ts`)

- `PlacePicker` takes initial picks above `max` in a **keep** state: rows aren't added while over
  (the `at-cap` reason), chips are removable, the line "Choose up to ‹N› places to keep." shows,
  and Done is disabled (with that line as its description) until the picks are ≤ `max`.
- `offer.ts` stops returning `"places"` for an over-cap switch to Chart or Table; `ShowAs` then
  calls the view's switch, which opens the dialog in keep mode at the new type's cap before
  converting. Done converts with the kept places (the conversion's `"places"` cut note doesn't
  show, since nothing was cut). Cancel changes nothing.
- A switch **to the Map** never goes over its cap of 25 (Chart and Table hold 5 and 10). A
  **now** type over its cap keeps today's behaviour (out of scope; decision 5 names Chart and
  Table).

### The new widget type checklist (from step 5; all three in the plan and its tests)

- `src/lib/sharing/points.ts` (the point-to-region swap on share): the hand-off sends monitors
  and `mtrs` regions only, never points, so no swap applies. A test pins that a Map's hand-off
  from a shared view never carries a point, and that a Chart added from it shares without a swap
  prompt.
- `PlacePickerDialog` `regionOf`: not reached (the picker here is the Where dialog, and marks are
  monitors); a test pins that "Change place" on a Chart added from marks opens with the monitors.
- The Data Portal's type switch (`now.ts`, `map.ts`) and the "left out" notes: the hand-off goes
  through `fromMapDraft`; tests pin the notes for a Map with pollutants, smoke and fire, notices,
  use and a fill, at Daily, Monthly and Yearly, and on Now.

## Deferrals (each into `DEFERRED.md` in the same change)

- **Remove** "Spec 6b charts only the drawn marks" once built.
- **Keep** "On a past day, a monitor that has left the current monitors list isn't drawn …"
  (spec 4 leftovers): 6b doesn't change it (an undrawn mark isn't sent). New trigger: "when
  someone reports it, or when the Map reads a past day's monitors from that day's own list".
- **Re-trigger** "`land_use` / `mtrs` region browsing": option B drops 6b as its trigger. New
  trigger: "when pesticide analyses need parcel-level selection in the place picker (for example,
  a Chart of several sections)".
- **Update** "Readable names for MTRS sections": the codes now also show on a section's Chart;
  the trigger stands.
- **New**: "Show a township in a chart": the township card gets no button, since townships
  aren't a chartable region type. Revisit when someone asks to chart a township's use.
- "Comparing two datasets": raised with the user at the end of 6b.
- The lens-flash entry stays until the user's hand check of `@sjvair/map-sdk` `0.1.0-beta.21`.

## Testing

- Unit: the hand-off's draft for monitors (Chart, Table; under and over the cap; hidden counts;
  a viewer's held pollutant and stop; Now; Daily, Monthly, Yearly with Automatic and a chosen
  resolution) and for a section; where it opens (editor, starter, read-only, share link);
  `addTargets` skipping read-only dashboards; `offer.ts` without the `"places"` block.
- Browser: the Map's menu listing the items only with a mark to send (one hidden only for its stop counts) (and for a viewer); the
  pinned section card's button (absent on the hover form); `PlacePicker`'s keep state (Done
  disabled, its description, chips); Show as opening the dialog and Cancel changing nothing; the
  Data Portal not writing the saved draft from a hand-off. A test that checks editor wording
  needs a real `DocumentSession` (none renders as a viewer).
- E2E (fixtures; noon Pacific clock; also under `TZ=America/New_York`): mark monitors on a Map,
  Show in a chart, see the Chart of the sent marks, Add to the dashboard; over the cap, keep 5;
  from a share link, Add to the viewer's own dashboard; a section card's chart.
- Lessons from the Map sessions apply (legends need a scale; hover content isn't interactive;
  cards stay mounted, so the new button mustn't remount the card; `readableColor` on level
  colours; flaky browser tests rerun alone; suites run one after another).

## Left to the builder

File and function names, the registry's shape, the history-state shape, message keys and exact
wording other than the lines quoted above, and how the view's "unsaved visit" flag is threaded.

## For the user to check while reading (my calls)

- Decisions 20–24 (from the builder check).
- On a share link opened in a new tab, Cancel from the keep dialog goes home (there's no app
  entry to go back to, and the share link isn't a dashboard of theirs). _Builder: check
  `cancelPlan` gives `/shared/:token` back if a better target exists._
- The hidden-marks note doesn't break the count down by reason (the Map's own note already does).

## Calls made during the build (2026-11-20)

- **Decision 19** (the Map's saved resolution kept by `fromMapDraft`) is recorded under the
  decision. `ARCHITECTURE.md` states it in the Data Portal text.
- **A minimized Map offers no items.** It isn't mounted, so nothing is drawn and no marks are
  known (decision 13); decision 15's taskbar menu for a minimized Map doesn't hold. In
  `DEFERRED.md` as "Show in a chart from a minimized Map".
- **The conversion's notes travel in `HandOff.notes`** (dropped items minus marks and places,
  plus the pollutant, the cut and the selection) and show on the hand-off visit. They stay after
  the opening keep's Done and clear on the next edit.
- **Focus:** after a keep started from Show as, focus returns to the pressed Show as toggle;
  after the opening keep, to Change places.
- **The hidden-marks note stays** until the person changes places through Change places.
- **Cancel on a hand-off visit:** the action bar's Cancel asks "Discard changes?" when there
  are edits (decision 3); the opening keep dialog's Cancel never asks.
- **`HandOffSchema` lives in `src/lib/widgets/map/hand-off.ts`**, so the Data Portal's chunk
  doesn't load the conversion.
- **The registry entry:** the Map writes it whenever it isn't a preview, with marks possibly
  empty, so the section button works on a Map with no marks.
- **Viewer menus:** `MenuItem.forViewers` and `viewerTypeItems(app, widget, ctx)` in
  `src/lib/actions/widget.ts`, used by `WidgetFrame` and the taskbar; only the Map's two items
  opt in.
- **A thin Daily region reads "No data"** with no reason (with the `0.1.0-beta.22` pin, "No data,
  Not enough data" repeated itself). The user was told; a one-line change in `FillLayer` if
  wanted.
- **A section always gives a Chart** (no Table), whatever the type argument.
- **"Add to":** `addTargets(app, routeId, lastOpened, skip)`; `DashboardSummary.readOnly` marks
  "newer" documents; a skipped starter falls to the first listed dashboard, else New dashboard.
