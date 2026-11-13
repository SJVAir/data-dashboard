# Release 1, step 5, spec 3: the Map's options toolbar, Settings, and viewer changes

Status: brainstormed with the user 2026-11-13, on `step-5-spec-3` (from `step-5` at e6f20c1).
Checked by a fresh builder read: two questions for the user (read-only views that show no tiles;
Inactive and Inside defaults), the rest settled as my calls below, and four contradictions with
the code fixed. **Approved by the user 2026-11-13.**

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's
(from this brainstorm, or from the spec 2 brainstorm on 2026-11-12, recorded in
`ARCHITECTURE.md` → "The Map tile's toolbar").

## Where this sits

Step 5 is the Map widget, on the `step-5` branch; each spec branches from it and opens a PR into
it, and `step-5` merges into `main` once, at the end, with the user's yes. Specs 1 (the widget
core, #53) and 2 (the Map's data, marks and focus area, #56) are merged into `step-5`.

1. The widget core. Done.
2. The Map's data per tile, marks, focus area. Done.
3. **This spec:** the options toolbar built from the tile's data, plus Settings, on map-sdk's
   shared `OptionsToolbar`; viewer changes on read-only dashboards.
4. A date-range mode and region fills.
5. Pesticide use by section and township, and spray notices.
6. "Show in a chart/table" from a map's marks.

**Working rule (the user, 2026-11-12; `CLAUDE.md` → "Repo workflow"):** build straight toward
step 5's final design. No stop-gap UI between specs. Between specs: tests green, every other
widget working, saved documents opening without errors. The toolbar built here is the final one;
specs 4 and 5 add rows and groups to it, they don't replace it.

## Why

A Map tile is assembled from the data its owner picked (spec 2), not a copy of monitor-map. The
toolbar lets people switch between what the tile holds (its pollutants, its monitor types, smoke
and fire) and set up the map itself (clusters, basemap, theme), with each tile remembering its
own setup.

Shared dashboards are often made to be explored: someone puts a lot into a dashboard and expects
the people they share it with to toggle through it (the user, 2026-11-13). So a viewer who can't
edit can still use the toolbar; nothing they do is saved into the owner's dashboard.

## Goals

- **Before the toolbar** (the user, 2026-11-12): split `MapWidget.svelte`, and finish the
  hidden-marks note's reasons (a spec 2 miss).
- **Adopt `@sjvair/map-sdk` `0.1.0-beta.12` and `0.1.0-beta.13`, and `@sjvair/sdk`
  `5.0.0-beta.10`**, both pinned exactly.
- **The toolbar:** map-sdk's `OptionsToolbar` in `MapView`'s `toolbar` snippet, offering only
  what the tile's data allows, values saved in the tile's options with undo.
- **Viewer changes:** a general widget-core mechanism; on any read-only view, toolbar changes
  apply for the visit and are never saved. The Map is its first user.
- **A read-only dashboard whose backup couldn't be kept shows its tiles** (Part 5).

## Non-goals

- **Schools & child care** (`schoolsPlugin`, beta.12). Not in this spec (the user, 2026-11-13);
  goes to `DEFERRED.md` (below).
- **Collocation sites.** The dashboard loads none, so `monitorsOptions`' Collocation Sites row is
  left out (`collocation: false`) **(my call)**; `DEFERRED.md`.
- **A search slot.** None: the place picker ("Change place") does that job **(my call)**.
- **An Overlays group.** Wind is monitor-map's, outside map-sdk; the tile has no overlay data.
- **A "None" pollutant choice** (`none`) **(my call)**: a Map tile always draws a pollutant.
- **Renaming `bam1022` to "SJVAir"** stays held (`DEFERRED.md`).
- **Other widgets adopting viewer changes.** None has an in-tile data switch today (the calendars'
  day selection and the Map's marks are the only in-tile edits). `DEFERRED.md` (below).

## Anti-goals

- A viewer's change ever reaching the owner's document, the server, a log, or an error report.
- Saving a fallback or a default the person didn't choose (a missing value is drawn as its
  default and never written; only a person's change writes, the same rule as `drawableShowing`).
- Hardcoded labels, help text, groups, colors or scales; hex colors in components.
- A toolbar that offers a choice the tile's data doesn't have.

## Constraints

Metadata is the source of truth; all text through Paraglide, no concatenated sentences; theme
tokens only (`token-discipline.test.ts`); WCAG 2.2 AA with standard patterns; Pacific time via
`format`; map code stays out of the initial bundle (report the number against the 250 KB soft
budget); location privacy (coordinates never in URLs, logs or reports); the Map stays wired into
the three place-handling spots (`src/lib/sharing/points.ts`, `PlacePickerDialog`'s `regionOf`,
`src/lib/get-data/now.ts`). Don't modify map-sdk, monitor-map, mobile, sdk-js or sjvair.com: a
missing piece goes to the coordinator.

## Approaches (for viewer changes)

1. **A shared tile-options layer next to the document (chosen by the user, 2026-11-13).** A small
   widget-core module holds viewer changes per view and tile, in memory. Widgets read options
   through one helper (saved values with viewer changes on top) and write through one function
   (`applyChange` with undo when editable; in memory when read-only). "Make a copy" applies the
   held changes. `DocumentSession` is untouched (it's already ~940 lines, flagged in
   `DEFERRED.md`).
2. **Inside `DocumentSession`.** The session holds a viewer layer when read-only. Fits "the
   session owns the document", but grows an already-large class and ties a display concern to
   saving and undo.
3. **Map-only local state.** Fewest lines, but against the user's "make it general", and "Make a
   copy" would reach into one widget.

## Part 1: first, before the toolbar

### 1a. Split `MapWidget.svelte`

Move the data blocks (the monitors query and its scope resolution, `monitorsSource`, the HMS
query and its three sources, the status helpers) into `src/lib/widgets/map/data/loaded.svelte.ts`
(`DEFERRED.md` → spec 2 leftovers). The toolbar's wiring goes in its own module (below), so the
component stays the view. No behaviour change; the existing browser and E2E tests pass unchanged.

### 1b. The hidden-marks note gives its reasons

Today a hidden mark is only "not in the drawn features". The loaded list is the monitors **in the
places that report the pollutant showing**, so the widget can tell the reasons apart by knowing
each hidden mark's monitor type **(my call, checked in the code)**:

- **Its type doesn't report the pollutant showing** (the metadata's per-entry `published`, the
  same check as `monitorTypeReports`): "2 marked monitors don't report ozone".
- **Its type is switched off in the toolbar, or it's inactive or inside and those are hidden**
  (new with this spec's Monitors rows): "1 marked monitor is hidden by the map's options".
- **Its type reports the pollutant and nothing hides it:** it must be outside the places:
  "1 marked monitor is outside this map's places".
- **Its type can't be found** (the lookup failed or the monitor is gone): "aren't shown".

The types come from one page-wide, cached lookup of the marked monitors (the SDK's monitors list
or details, through the data layer; at most 25 ids) **(my call; the builder picks the cheapest SDK
call that gives each id's type and `is_active`/`location`)**. One line per reason that applies,
in the order above. Edit spec 2's keys (`map_marks_hidden`, `map_label_marks_hidden`) to take a
reason (Paraglide selectors, with plural counts); add no parallel keys. The same lines are the
map's accessible name (after its title) and map-sdk's feature-list note
(`featureList={{ note }}`). The pollutant name comes from the catalog's entry-type label.

## Part 2: adopting the new packages

Move both pins, exactly: `@sjvair/map-sdk` `0.1.0-beta.13` and `@sjvair/sdk` `5.0.0-beta.10`
(`npm:@jsr/sjvair__sdk@5.0.0-beta.10`; JSR's `latest` tag doesn't move for betas). Check
`npm view @sjvair/map-sdk dist-tags --prefer-online` first; adopt nothing newer without saying so.

- **Shift-click doesn't open the card:** assert the card stays closed in `e2e/map.spec.ts`'s
  Shift-click test.
- **The spoken view summary follows the data:** a test that it updates after a refresh and after
  a place change at a still view.
- **The feature-list note:** Part 1b.
- **`MetadataProvider`** (`host/metadata.ts`) gains, from the dashboard's metadata layer, with the
  exact contracts in map-sdk's README → "Providers": `monitorGroups`, `monitorTypeGroup`,
  `monitorTypeReports` (reading each entry's `published`), `entryTypeHelp` (the entry's
  `description`), and `locationTypeLabel` (returns `"unavailable"` on failure; agreed with map-sdk
  2026-11-12). Labels, groups, help and colors all come from here, never hardcoded.
- **Fixtures:** `getMonitorsMeta()` throws without `monitor_groups`. Add `monitor_groups`, each
  type's `group` and each entry's `description` to `e2e/fixtures/api/2.0/monitors/meta.json`,
  `e2e/fixtures/map-meta.json`, and every unit-test meta fixture (`src/lib/data/metadata.test.ts`,
  `host/metadata.test.ts`, and any others `npm run test` finds).
- **Type changes:** `ThemeColors` gains `schoolMarker` and `childCareMarker`; `defaultBasemaps()`
  takes options. Let `npm run check` find what breaks. `app.css` defines `--school-marker` and
  `--child-care-marker` if map-sdk's theme needs them defined.

## Part 3: the toolbar

### What it offers

A group appears only when the tile's data gives it a choice; Settings always shows
(ARCHITECTURE → "The Map tile's toolbar").

| Group         | Shows when                                                    | Rows                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pollutant** | the tile holds 2+ pollutants the server's map draws           | one radio per drawable pollutant layer (`monitorsOptions` leaves it out with fewer than 2). The chosen one is the pollutant **drawn**, including `drawableShowing`'s fallback; picking one saves `showing`.                                                                                                                                      |
| **Monitors**  | the loaded monitors give 2+ options (types, Inactive, Inside) | from `monitorsOptions(map).groups(...)`: type rows from the metadata; group headings (Reference-grade, Low-cost sensors, by `order`, select-all) only when the types span both groups, else a flat list with each type's group marker; a null-group type last with no heading; types not reporting the pollutant left out; Inactive and Inside only when the loaded monitors include such monitors (`is_active` false; `location` inside). |
| **Layers**    | the tile has smoke and fire (the user, 2026-11-13)            | one row, Fire & Smoke (`hmsOptions(map).row`): shows or hides both. It doesn't add or remove the data: that stays in Get data. A single on/off row counts as a choice here.                                                                                                                                                                       |
| **Settings**  | always                                                        | `settingsGroup(map)`: Marker Clusters, Basemap (every MapTiler basemap at its newest version, opening on Streets v4 without POI layers; switching goes to the new basemap's default variant), Theme (the current basemap's variants; opens on the style's own default; no "Follow the dashboard"), Reset Map Options.                                |

"The tile's types" are the monitor types among the loaded monitors for the pollutant showing
**(my call)**: a type with no monitor in the places isn't offered. Marker icons take the
pollutant's lowest level color from its scale (map-sdk does this). The Monitors group counts as a
choice only with 2+ rows, the dashboard's check (map-sdk always returns the group).

**The places' outline (focus area) is always drawn**, with no row **(my call)**. While a new
place resolves, the old outline is cleared (closes `DEFERRED.md` → "The previous focus area stays
drawn") **(my call)**.

### Placement and look

- Top-left, like monitor-map, with the focus-revealed List button below it (map-sdk places both).
- The note banner (`data-map-note`) sits below the toolbar using `--mapsdk-toolbar-height`, which
  also ends the banner crowding the zoom buttons (closes that spec 1 leftover) **(my call)**.
- The legend stays in the bottom-left card (a button on narrow maps).
- **Icons** (the user, 2026-11-13): Lucide icons with monitor-map's tints, as new theme tokens in
  `app.css`, each with a dark-mode value; components use the tokens only. Monitors `RadioTower`
  (steel blue), Layers `Layers` (slate grey), Settings `Settings` (dim grey, icon-only), Marker
  Clusters `Network` (dodger blue), Basemap `Map` and Theme `Contrast` (slate grey), Fire & Smoke
  `Flame` (orange-red). Token names (e.g. `--map-icon-monitors`) and the dark-mode values are the
  builder's, picked for at least 3:1 against the toolbar's background in both schemes **(my
  call)**. The light values are monitor-map's hex colors.
- The toolbar itself follows the dashboard's dark mode (map-sdk uses only theme tokens, except the
  fixed Inactive and Inside swatches, as on every map).
- Wide (≥ 48rem map width) joined dropdowns, narrow one options button and a panel: map-sdk's.
  E2E on a narrow tile waits for the options button (the layout settles one frame after mount).

### Wiring (from map-sdk's notes; easy to get wrong)

- `monitorsOptions(map)` is made **once per map** and `.groups(input)` is called inside a
  `$derived` (calling the factory inside a `$derived` re-fetches forever).
- `settingsGroup(map)` / `basemapOptions(map)` are built inside a `$derived` (the Theme radios read
  `map.basemap.current`), and `basemapKey` is passed so Basemap and Theme show what the map draws.
- `values` given to `OptionsToolbar` is the full effective record: saved values over defaults, so
  a type key missing from the saved options shows as on (`type:<type>: true` filled for types that
  arrive after the defaults were made).
- Group and row ids are single tokens.
- The dashboard doesn't subscribe to `map.basemap.onFallback`: fallbacks are drawn, not saved, and
  change events come only from people's actions.
- How each key drives the map: `pollutant` → the saved `showing`; `type:*`, `inactive`, `inside` →
  the dashboard filters the monitors `DataSource`'s features (map-sdk never filters a host's
  data) **(my call)**; `clustered` → the monitors plugin's clustering; `basemap` →
  `map.basemap.select`; `fireAndSmoke` → the smoke and fire plugins added or removed (their data
  stays loaded while hidden, so showing again is instant) **(my call)**.

### The saved shape

The tile's options (`MapOptionsSchema`, `options.ts`) gain, next to `showing` and `marks`
**(my call on the field names and shapes)**:

```ts
{
	showing?: string;          // unchanged
	marks?: string[];          // unchanged
	basemap?: string;          // the variant id; an unknown id resolves in map-sdk, never throws
	clustered?: boolean;
	fireAndSmoke?: boolean;    // shown
	inactive?: boolean;
	inside?: boolean;
	hiddenTypes?: string[];    // monitor types switched off (unique, SafeId, bounded)
}
```

- **Types are saved as the ones switched off**, so a type the server adds later shows as on with
  nothing to fix in old dashboards.
- **Missing means default**, drawn and never written: Streets v4 (map-sdk's `defaultId`), the
  presets' defaults for clusters, Inactive and Inside **off** (monitor-map's defaults; the user,
  2026-11-13: a Map no longer draws inactive or indoor monitors until someone turns them on), smoke
  and fire shown.
- **Invalid or missing options read as none** (as today, per field where possible: one bad field
  doesn't drop the marks) **(my call)**.
- **Undo:** each toolbar action is one `applyChange` (one undo step); a select-all heading and
  Reset are one step each, matching map-sdk's one `onchange` per action.
- **A choice equal to its default is stored as missing** **(my call, from the builder check)**:
  when a change's new value equals its default, the key is removed instead of written (a type
  switched back on leaves `hiddenTypes`; an empty list is removed). So a deliberate "Streets v4"
  follows a future default change, which is acceptable.
- **Reset Map Options** therefore needs no special handling: map-sdk's Reset reports the keys
  that differ from `defaults` (and nothing when none do), and putting each back to its default
  removes it. The tile draws its defaults again: Streets v4, clusters, smoke and fire shown, every
  type on, Inactive and Inside at their defaults, and `showing` the first pollutant. Marks and
  places stay **(my call: `showing` resets like the others)**.
- **A saved value applies only while its row is offered** **(my call, from the builder check)**:
  a type switched off, or Inactive/Inside off, filters the monitors only when the Monitors group
  shows that row. If the tile's data later leaves that row out (the group has fewer than two
  options), nothing filters by it, so a tile can never hide monitors with no visible way back. The
  value stays saved and applies again when the row returns.
- Other tabs and undo/redo set `values` (no `onchange`), as marks already follow the document.
- Converting away from the Map drops these options, as it already drops `marks`.

### Get data's "Show as"

`mapShowingOnly` (`src/lib/get-data/map.ts`) converts by the pollutant actually drawn
(`drawableShowing`), not the saved `showing`, so a chart or table never shows a pollutant the tile
isn't drawing (closes that spec 2 leftover) **(my call)**.

## Part 4: viewer changes (widget core)

### The rule

**A viewer can change what a tile shows, never what it holds** (the user, 2026-11-13). On a
dashboard the person can't edit, a widget's in-tile switches work for the visit and are never
saved. The Map's toolbar is the first user.

### Where it applies (the user, 2026-11-13)

Every read-only view **that shows tiles**. Today that is the **live shared link**
(`/shared/:token`, `SharedPage.svelte`) and, with Part 5, a local dashboard open read-only
because its backup couldn't be kept (`readOnly: "unkept"`). Static (URL-fragment) links never
open read-only: they become a copy on open (`Import.svelte`). Dashboards saved by a newer version
(`"newer"`) and ones that couldn't be read (`"invalid"`) keep showing only their message, no
tiles (`DashboardGrid.svelte`): an older app can't draw a newer format faithfully, and an invalid
document is never drawn (the security baseline), so recovery, not drawing, is their path (the
user chose this over drawing them, 2026-11-13). The mechanism is general, so any read-only view
that shows tiles gets viewer changes. "Make a copy" and whatever else each view offers stay as
they are.

### Behaviour

- **Per tile, in memory, for the visit.** Changes are held per view (the shared link, or the
  local dashboard) and widget id, so fullscreen and remounts keep them; leaving the page or
  opening another dashboard drops them. Nothing goes to storage, the server, logs or error
  reports.
- **Only changed values are held.** A live link's update from the owner changes everything the
  viewer didn't touch; a value the viewer changed keeps the viewer's choice.
- **No undo** for viewer changes (read-only views have no undo list) **(my call)**.
- **Reset Map Options, for a viewer,** drops their changes, going back to the owner's view, not
  the bare defaults **(my call)**. For a viewer, the toolbar's `defaults` are the owner's
  effective values (saved values over the defaults), so map-sdk's Reset reports exactly the keys
  where the viewer's values differ from the owner's, and the dashboard drops those held keys. When
  the viewer changed nothing, nothing differs and Reset does nothing (map-sdk calls no `onchange`);
  it stays enabled, as it is for an owner whose values are all defaults.
- **A live-link update removes what no longer fits** **(my call, from the coordinator's review)**:
  held changes for a widget the owner removed are dropped; a held value that no longer validates
  against the widget's options (a pollutant the owner took out, say) is left out of the effective
  options, so the drawn fallback applies, and left out of `withViewerChanges` too.
- **"Make a copy" keeps the viewer's changes** (the user, 2026-11-13): `makeCopy` copies the
  shared document it copies today (`view.doc`, the full document, welcome Note included) with the
  held changes applied to its widgets' options, validated like any document. Matching an existing
  copy stays by source id, as today.
- **Marks stay owner-only:** Select and Remove stay hidden for viewers (spec 2).

### Shape (my call)

A module in the widget core (e.g. `src/lib/widgets/shared/tile-options.svelte.ts`):

- `tileOptions(widget)`: the widget's saved options with any viewer changes on top (reactive).
- `changeTileOptions(widget, next, changedKeys)`: on an editable dashboard, one `applyChange`
  replacing the widget's options (undoable; a starter's edit goes to its copy, as marks do); on a
  read-only view, held in memory.
- `withViewerChanges(doc)`: the document with the held changes applied, for "Make a copy"
  (`SharedPage.svelte`'s `makeCopy` → `saveCopy`).

Each widget still validates its own options (`MapOptionsSchema`), so a viewer change is checked
like a saved one.

### How it differs from "Show patterns"

The contribution calendar's "Show patterns" switch (`calendars/shared/patterns-pref.svelte.ts`) is
a **personal display preference**: stored on the device (`platform.preferences`, per space), for
every calendar at once, and never part of any document. Viewer changes are **per tile, per visit,
and about the tile's own data**; they can become part of a copy. The two stay separate, and "Show
patterns" isn't a future adopter unless the user says so.

## Part 5: a read-only dashboard whose backup couldn't be kept shows its tiles

Added to this spec by the user, 2026-11-13. `readOnly: "unkept"` is a **valid** document: it was
upgraded and passed validation, and it's read-only only because the untouched original couldn't
be stored first. Its message says "it's open read-only", but `DashboardGrid.svelte` renders no
widgets for any read-only session. Fix: for `"unkept"`, keep the message bar and render the tiles
below it, read-only, the way the shared view renders them (no editing, moving, resizing, adding
or marks; minimize, fullscreen and viewer changes work as on a shared view) **(my call on which
view affordances carry over)**. Whatever the bar offers today (downloading a backup, the reload)
stays. `"newer"` and `"invalid"` are unchanged. Nothing is written: autosave and the journal stay
off for a read-only session, as today. Tests: a browser test that an unkept session renders its
tiles with no edit affordances, and that newer and invalid still render none.

## Testing

- Unit: the options schema (new fields, per-field fallback, `hiddenTypes` bounds); building the
  groups (each "appears only when" rule; Layers with smoke and fire; Pollutant from the drawn
  pollutant); values ↔ options (missing = default, types switched off); the hidden-marks reasons;
  the tile-options module (editable path one change, read-only path in memory, live update keeps
  only changed keys, `withViewerChanges`); the metadata provider's new methods against fixtures.
- Browser: the toolbar's groups for a few tiles; a change saves and undoes; Reset; a read-only
  session's change isn't saved; the note under the toolbar.
- E2E: change pollutant, a type, Fire & Smoke and basemap, then reload (saved) and undo; a shared
  link's toolbar changes, not saved, then "Make a copy" keeps them; a narrow tile (waiting for the
  options button); Shift-click leaves the card closed; axe in light and dark.
- `npm run check`, `npm run lint`, `npm run build`, `check:build`, `check:budget` (report the
  number).

## `ARCHITECTURE.md` changes in this spec

- **Map SDK → "The Map tile's toolbar":** Layers holds only Fire & Smoke (a show/hide switch; the
  data stays a Get data choice); the saved shape; missing means default and a default-equal choice
  is stored as missing; a saved value applies only while its row is offered; Inactive and Inside
  off by default; the icon tint tokens; no search, no None, no Collocation Sites; the hidden-marks
  reasons.
- **Map SDK → "The dashboard's Map widget":** the new pins, the `MetadataProvider` methods, and
  the toolbar wiring (one `monitorsOptions` per map; the dashboard filters the monitors' features).
- **The viewer-changes rule** ("a viewer can change what a tile shows, never what it holds"), with
  the tile-options module, next to "Server share → live link" (the live link's "read-only + Make
  a copy"), including that "Make a copy" keeps the viewer's changes, how a live update treats
  them, and how it differs from "Show patterns".
- **The `"unkept"` read-only state**, next to "Recovery from a bad upgrade": valid but read-only
  because the original couldn't be kept; it shows its tiles under its message (Part 5). `"newer"`
  and `"invalid"` show only their message.

## `DEFERRED.md` changes in this spec

Remove when done: "Shift-click on the Map also opens the reading card", "map-sdk's spoken view
summary goes stale", "The hidden-marks note isn't in map-sdk's feature list", and from spec 2's
leftovers the split, the hidden-marks reason, the previous focus area, and "Show as converts by
the saved `showing`"; from spec 1's leftovers, the note banner under the zoom buttons. Update "A
Map draws no smoke or fire… without catalog labels": the toolbar's row uses map-sdk's own message,
so only the layer labels need the catalog (keep the "revisit if the catalog drops either").

Add:

- **Schools & child care on the Map.** Deferred 2026-11-13 (the user). map-sdk has
  `schoolsPlugin` (beta.12); it would be a new data set in Get data and a second Layers row.
  **Revisit when** spec 5's design starts.
- **Collocation sites on the Map.** Deferred 2026-11-13 (my call). The dashboard loads none.
  **Revisit if** someone asks for them, or with a later Map data-set spec.
- **Other widgets adopting viewer changes.** Deferred 2026-11-13. **Revisit with** the next widget
  that gets an in-tile switch (e.g. a chart's series toggle).

## Left to the builder

Module names and splits; the token names and dark-mode values (within the 3:1 rule); the SDK call
for marked monitors' types; the exact Paraglide shape of the reason keys; how `tileOptions` finds
the current view (the session or the shared page); test file placement.
