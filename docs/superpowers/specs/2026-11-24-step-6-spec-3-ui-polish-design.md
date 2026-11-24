# Release 1, step 6, spec 3: the ⋯ in the top bar, and a calmer Data Portal

Status: brainstormed with the user 2026-11-24; checked by a fresh builder read (two questions,
both settled as my calls: "When the options section shows" and "When the ⋯ appears"). Branch `step-6-spec-3` from `origin/step-6`
(470fdde); its PR goes into `step-6`.

Calls marked **(my call)** are the brainstorming session's own. Everything else is the user's
(2026-11-24), or was decided before this spec (noted where it matters).

## Why

The user asked for four interface changes on 2026-11-24:

- The dashboard's ⋯ button has a whole row to itself above the grid, which looks odd when that
  row holds nothing else, as on most dashboards.
- The Data Portal opens with sections already expanded, so the page is long before anyone has
  chosen anything. The order (What first) also puts the biggest choice ahead of the two
  everyone makes (when and where).
- The level line, the one setting a widget type has of its own, is hidden: inside the
  collapsed "More options" for a Chart, and standing alone for a calendar. The user wants a
  type's own settings clearly visible next to the type.

## Goals

1. The dashboard's ⋯ sits in the top bar, right after the dashboard picker.
2. Every collapsible Data Portal section starts closed and never opens by itself.
3. The order in the Data Portal's left column becomes When, Where, What, Data resolution.
4. Data resolution becomes a section that starts closed, showing the current choice under its
   name while closed.
5. A type's own settings sit in an always-open section under "Show as", named for the type.

## Non-goals

- **No new per-type settings.** The section only has to leave room for later ones.
- **No document shape changes.** Thresholds stay where they are in a saved widget. If the
  build finds that a shape must change, it stops and asks the user.
- **When and Where don't become collapsible.** They stay open, as today.
- **The shared page's own header** (name, Notifications, Make a copy) doesn't change.

## Anti-goals

- **No stop-gap UI.** The ⋯ gets a proper way to reach the dashboard's actions (below), not a
  copied list or a hidden duplicate button.
- **Nothing moves under the person's pointer.** A section never opens or closes because of
  something they didn't do to it, apart from a section closing because the new type greys it
  out (that part works this way today).
- **No meaning lost when a section is closed.** What's chosen stays readable under the name.

## Decisions

### The ⋯ in the top bar

- **Where:** in `TopNav.svelte`, directly after `DashboardPicker` ("My dashboard ▾ ⋯"), since
  it acts on the dashboard the picker names. It keeps its accessible name
  (`m.dashboard_menu()`, "Dashboard actions"), its icon and its `ghost` / `icon-sm` style.
- **When it shows:** only while an own dashboard is on screen. That means a mounted
  `DashboardGrid` that isn't a shared view (`view` unset), including read-only own dashboards,
  which have their menu today. It doesn't show on the dashboards list, Get data, a widget's
  edit page or a shared page.
- **When the ⋯ appears (my call):** the grid publishes its provider only once it has a session
  (it renders nothing before then), so the button doesn't flash while a dashboard loads.
  Read-only sessions ("newer", "invalid", "unkept") keep it, as they keep their menu today.
- **Inert while a widget is fullscreen,** as the header row is today (`inert={!!shownId}`).
- **How it reaches the actions (approach, the user's yes 2026-11-24, as the only sensible
  one):** while mounted (and not a view), `DashboardGrid` publishes its `actions` provider and
  its fullscreen state to a small module-level store (one dashboard on screen at a time, like
  `dropdown` in `menu-state.svelte.ts`), and clears them when it unmounts. The top bar's button
  renders only while a provider is published, attaches it to itself with
  `menuScope(provider)`, and opens with `openMenuFor(button)`. `resolveMenu` walks up from the
  target, so the button's own scope gives exactly the grid's items. Focus returns to the
  button. The grid's root keeps its own `menuScope(actions)` for right-clicks on the
  background. (The store's name and file are the builder's call.)
- **"Based on …"** keeps a small row above the grid, shown only when there is a credit. A
  dashboard that isn't a copy has no row at all. `DashboardHeader.svelte` becomes the credit
  line only (renaming it is the builder's call). It keeps its `inert` while fullscreen.
- **Phones:** the top bar already wraps (`flex-wrap`). Check at 390 px that the picker and ⋯
  stay together on one line and that nothing overlaps. The ⋯ follows the picker in the DOM, so
  it wraps with it, not after the right-hand group. If they split apart, keep them in one
  non-wrapping group **(my call)**.
- **Earlier decision this changes:** the dashboard header row with its ⋯ (design pass, PR #33,
  and the sync spec 3 "Based on …" row) becomes a credit-only row. Record this in
  ARCHITECTURE.md's dashboard menu section with the date.

### The Data Portal's left column

Order, top to bottom:

1. **When** (only for types with a range, as today: not for now-only types, and not for the
   Map on Now). So for those types, Where comes first.
2. **Where**.
3. **What**, its accordion sections as today, minus the now types' alert levels (moved, below).
4. **Data resolution** (when there are choices, as today).

"More options" goes away (`MoreOptions.svelte` and the `get_data_more_options` message are
removed).

**Headings:** When, Where and What keep their `h2` headings and the What sections their `h3`.
Data resolution's trigger is an `h2` (it sits at the same level as What). The page's outline
stays in order **(my call)**.

### Sections start closed

- **On first load,** every What section and Data resolution are closed. `opened()` in
  `WhatSections.svelte` goes away.
- **On a type change,** sections the person opened stay open, and any the new type greys out
  close (as today). Nothing opens because of the change.
- **A section listed later** (location groups arrive after the catalog) arrives closed.
- **Nothing ever opens by itself (the user's yes, 2026-11-24).** A missing pick is already said
  in two places: under the closed section's name (its `detail`) and in the action bar's
  blocked reason (for example "Choose a pollutant").
- **Editing an existing widget** ("Edit data") follows the same rule: everything closed, picks
  shown under the names.
- **Earlier decisions this changes:** step 4 spec 3 ("Air Quality starts open") and step 5
  spec 7 (a type's main section opens, all sections for the Map). Record the change in
  ARCHITECTURE.md's Data Portal section with the date.

### Data resolution as a section

- `DataResolutionControl.svelte` becomes a one-item accordion with the same trigger look as the
  What sections (`SectionTrigger` or the same styles; the builder's call), closed by default.
- **Closed, it shows the current choice under its name** (its label: "Automatic",
  "Hourly", …, from the existing `get_data_resolution_*` messages).
- The "?" toggletip stays beside the heading, outside the trigger's name (as today: a button
  inside the trigger isn't allowed). The open content is the radio group as today.
- **The note (`resolution-note`, `role="status"`) stays outside the collapsible part**, so a
  note that appears while the section is closed is still seen and announced **(my call)**.
- **A blocked current choice** (its reason shown in red today) also shows under the closed
  name, so a closed section never hides why Add is blocked **(my call)**. The action bar
  already says it too.
- It holds only the resolution choice.

### A type's own options, under "Show as"

- **Where:** in the preview column, directly under `ShowAs` (and above "Overlay for"), a short
  section named for the type, always open (not collapsible), shown only when the type has a
  setting there.
- **Name:** one whole Paraglide message per type ("Chart options", "Calendar options",
  "Current conditions options", …), held on the type's registry entry (for example
  `optionsLabel: () => string`), never built from the type's label **(my call: whole messages,
  so each can read naturally; "Can we go outside?" doesn't take a suffix well, so its name is
  the builder's wording, reviewed in the spec's copy review)**. The heading is an `h2`.
- **What goes there today:**
  - **The level line** for every type with `thresholds` that isn't a now type: the Chart, the
    Month calendar and the Contribution calendar (the Data table has none). It's
    `ThresholdLineControl`, unchanged, with `marks` for calendars.
  - **The now types' alert levels (the user's yes, 2026-11-24):** `NowControls` moves out of
    What into this section for Current conditions and "Can we go outside?". It still lists one
    alert level per pollutant chosen in What's Air quality section.
- **When the options section shows (my call):** only when it has a control to show right now,
  matching today's rule for each control. The level line needs its pollutant's scale (none for
  a Chart of pesticide data, none while the scale loads), and the alert levels need a ticked
  pollutant with levels. A "levels unavailable" retry counts as something to show. So no type
  ever shows an empty "… options" heading, and no new "nothing to set" message is needed. The
  section may appear a moment after a type change, once the scale has loaded. That pushes the
  preview down once, from something the person just did, and it's the same as the level line
  appearing today.
- **Nothing else moves.** The Map's options (fill, location types, smoke and fire, …) are data
  choices and stay in What.

## DEFERRED.md entries this spec touches

- **"A pinned calendar's lone dataset isn't greyed in What."** Fix it here: when the type pins
  a resolution, `datasetReason` checks candidates against that resolution, so a dataset not
  offered daily is greyed in What with its reason (today `resolution` is passed as `undefined`
  for pinned types). Remove the entry once done. If the fix turns out to grey a dataset the
  person already has (so they couldn't remove it), stop and bring it to the user.
- **"A `?type=` override keeps Chart options on a Data table draft."** Its trigger ("a
  non-Chart type has options of its own") fires: calendars now have a "Calendar options"
  section. Check: thresholds kept across Chart ↔ calendar are the same level line, kept by
  design. The Data table still has no options, so a kept threshold there stays unused and
  harmless. Add a "Looked at in step 6 spec 3" note and keep the entry with its trigger
  reworded to "when the Data table gains options of its own".
- **"Get data's Detail limits are estimates."** Its text says "More options → Detail". Reword
  it to "Data resolution" (the limits don't change).
- **"Shared pages don't show their own 'Based on …'"** and **"'Based on …' looked up while
  offline stays hidden until the next page load."** The credit's row moves (it now exists only
  with a credit). Check that both still describe the behaviour, and add a "Looked at in step 6
  spec 3" note.
- **Grep on the day** for "Get data", "Data Portal", "More options", "Detail", "Show as",
  "TopNav", "top bar", "⋯ menu" and "Based on", and update any entry whose text this spec
  makes wrong.

## Testing

- **Unit and browser tests:**
  - The ⋯: present on an own dashboard (including read-only), absent on the list, Get data and
    a shared view; inert while fullscreen; opens the same items as a right-click on the grid;
    focus returns to it.
  - The credit row: absent with no credit, present with one.
  - Sections: all closed on load, for every type, including the Map and Edit data. Opened
    sections stay open across a type change, and greyed ones close.
  - Data resolution: closed by default, shows its choice when closed, the note announced while
    closed.
  - The options section: shown for the Chart, both calendars and both now types when they have
    levels to offer; absent for the Data table, Forecast and the Map, and with nothing to set
    (a Chart of pesticide data, no pollutant ticked); the level line and alert levels work from it.
  - The pinned calendar's lone dataset is greyed with its reason.
- **E2E:** fix every locator the move and the closed sections break (dashboard menu by role
  and name, Data Portal sections, `e2e/csp-walk.ts`) to the final design, not with waits.
  Opening a section is part of each flow now.
- **Accessibility:** `e2e/a11y.spec.ts` on the Data Portal and a dashboard, light and dark,
  with the new layout. Headings in order.
- **Phone:** the top bar at 390 px (an E2E check that the picker and ⋯ share a line and don't
  overlap).
- **Full browser and E2E suites** at tasks that change E2E paths and once at the end;
  `e2e-full` dispatched by hand on the final head.

## Left to the builder

- The store's name and file for the published dashboard menu, and whether `DashboardHeader`
  is renamed.
- Whether Data resolution reuses `SectionTrigger` directly.
- The options section's component name, and each type's option-section wording (reviewed with
  the copy review at the end).
- Which existing tests move and which are rewritten.

## Build calls

(Filled in during the build.)
