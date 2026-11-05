# Release 1, step 4, spec 2: the shared place picker

Date: 2026-11-04. Branch: `step-4-spec-2` (from `origin/step-4`), a stacked PR into `step-4`.
Merging `step-4` into `main` needs the user's explicit yes.

Repo: **data-dashboard only.** If something is needed from sjvair.com, sdk-js, or map-sdk, tell
the coordinator session (`data-dashboard-2c`), or message the server session and copy the
coordinator. Don't edit those repos, and don't work around the SDK in the dashboard.

Mockups from the brainstorm are kept (git-ignored) in `.superpowers/brainstorm/`:
`picker-first-look.html` (before typing, typed results, several places) and
`picker-browse.html` (browse by type, narrowed to a county, the "Inside ›" shortcut). Both were
agreed by the user as the starting point; they're wireframes, not the app's look.

## Where this sits

Step 4 is six specs (`TODO.md` → "Release 1, step 4"). Spec 1 (widget groundwork, Chart, Data
table) is merged into `step-4` (#36). This is spec 2. Spec 3 (the Data Explorer) and spec 4
(the "now" widgets) are the picker's main users; spec 6 (the starter's "Change place" bar) uses
it too; step 5's Map widget syncs with it; Release 2's alert rules reuse it.

## Why

Widgets can't change their place today. Spec 1's Chart and Data table have an idle state
("Choose a place to show data.") with no button, and a "no longer available" card whose "Choose
another" is hidden, because nothing picks places yet. Every later spec in step 4 needs one
picker that finds any place a person cares about: a school, their home, a city, a county, a
monitor. Points and schools also need their air quality resolved, and exact locations need
protecting when a dashboard is shared.

## Who it's for

Anyone: a parent or teacher looking for a school, a community member looking for their city,
ZIP, or "where I am", a researcher picking monitors or comparing counties (the user: "almost
anyone"). The design serves the most common case first ("the place I care about", one search
box) and keeps the researcher's tools (browse, several places) one step away.

## Goals

- One shared, lazily loaded place picker that picks monitors, regions (any browsable type),
  schools and child-care sites, or the person's location, singly or several at once.
- Search by name across all kinds at once, results grouped by kind; browse regions by type with
  county narrowing; recent places; "Use my location".
- Chart and Data table widgets can change their place: "Change place" in the ⋯ menu, "Choose a
  place" on the idle state, "Choose another" on the "no longer available" card.
- Point and school places show data: air quality from the smallest containing region with data
  (ZIP → city → county), labeled with where it came from.
- A saved monitor missing from the monitors list gets the "no longer available" card (settles
  the spec 1 deferral).
- Location privacy when sharing: copy links, exports, copies made from shares, and live links
  never carry an exact location unless the owner explicitly chooses to.

## Non-goals (this spec)

- The Data Explorer (spec 3), the "now" widgets (spec 4), the starter's "Change place" bar
  (spec 6). The picker supports what they need (single-place mode, the active-monitors-only
  option); they wire it in.
- Map code of any kind (step 5). The selection shape is the one the Map widget will share.
- Drawn-shape selection (`DEFERRED.md`), land-use/MTRS browsing (`DEFERRED.md`).
- "Mark for analysis" freezing a point to its region (Release 3).
- Heat by ZIP and forecast zones for points and schools (spec 4, with those widgets).

## Anti-goals

- **An exact location leaking by default** through any share, copy, export, or live link.
- **Invented metadata:** type labels, plurals, which types are browsable, which types sit inside
  a county, location type labels, monitor network labels must come from the server.
- **A picker that hides why something can't be picked.** Rows that can't be added stay visible,
  greyed out, with a reason (except monitors that can never supply the pollutant; see below).
- **Picker code in the initial bundle.**

## Decisions

### What the person sees (the user: agreed from the first-look mockup)

**Before typing:**

- **One search box, focused:** "Search for a city, ZIP, school, or monitor".
- **"Use my location"** under it.
- **Recent:** places this person picked before, in this browser.
- **Browse:** region types (below), plus Monitors.

**Once they type (2 characters or more):** the recent and browse lists give way to results,
grouped by kind: schools and child care, places (regions), monitors. Up to 10 results per group
from the server (its cap; 15 on a name tie), and a "More matches. Keep typing to narrow them
down." hint when the server says `more` (or, for monitors, when more than 10 match).

**Result rows:**

- **School / child care:** name as the state publishes it (ALL CAPS child-care names are left
  alone, the user's earlier choice), type label from `regions/meta/` `location_types`, city and
  ZIP; the street address as a second line.
- **Region:** name and type label (`regions/meta/` `types.<type>.label`).
- **Monitor:** name, network label (from `monitors/meta/`), county, and a **"Not reporting"**
  tag in text when it isn't active (below).

### Several places (the user)

- **Picker modes:** single (closes on the first pick) and multiple (picks become removable
  chips above the box; the picker stays open until **Done**; **Cancel** discards). The host
  says which, and the cap (`accepts.maxPlaces`: Chart 5, Data table 10).
- **All monitors or all regions.** Several places are one `SpatialSelection`
  (`{ kind: "monitors" | "regions", ids }`, region ids `"type:code"`), unchanged, so the Map
  widget syncs with it both ways in step 5. Before the first pick everything is offered; the
  first pick sets the kind. After that, rows of the other kind stay in results and browse lists
  but are **greyed out with a reason** (e.g. "This chart compares regions. Remove the regions to
  compare monitors.").
- **Schools and "my location" are single-place only.** On a multi-place widget they can be the
  only pick (my reading of the user's "single-place only": a Chart can still show a school
  alone). Once a school or location is picked, everything else is greyed out with a reason, and
  while anything else is picked, schools and "Use my location" are.
- **At the cap,** further rows are greyed out with a reason ("This chart shows up to 5
  places.").
- **Comparing mixed kinds in one widget is deferred** (`DEFERRED.md`).
- **How picks are stored (my call):** one pick → the layer's `place`; two or more → its
  `selection`. Removing back down to one stores a `place` again.

### Pollutant fit (the user)

- **The picker is always told what it's picking for:** the dataset and entry type (on "Change
  place", the widget's own pollutant layer).
- **Monitors whose type doesn't take that entry type are hidden**, not greyed out, from search
  and browse. The rule is `monitors/meta/` `monitors[<type>].entries` (per monitor type).
- **Regions, schools, and points aren't filtered:** no bulk coverage lookup exists
  (`DEFERRED.md` → "Greying out places with no data"); a place without data shows "No data"
  once chosen. Schools and points fall back ZIP → city → county, so they nearly always find
  data.
- **Per-monitor gaps are deferred:** the rule is per type, so e.g. an AirNow site without ozone
  can still be offered for an ozone chart and then show "No data" (`DEFERRED.md`).

### Monitors (the user)

- **The monitors list is safe to use:** `monitors/` (`MonitorList.get_queryset` →
  `get_public()`) returns every public monitor, active or not, healthy or not; only
  admin-hidden monitors and disabled types are left out. The health filter applies only to the
  current-readings endpoints. (So the local stack's relaxed health settings don't change the
  list.)
- **Stopped monitors are included,** after the active ones, tagged "Not reporting" (text, not
  color alone). They still have past data.
- **A `activeOnly` picker option leaves them out,** for spec 4's "now" widgets (Current
  conditions, "Can we go outside?"). Chart and Data table don't set it.
- **Monitor search is in the browser,** over the memoized monitors list (already fetched for
  names and processors): case-insensitive match on the name, word-start matches first, active
  before not reporting, then by name (ranking details are the builder's).
- **"No longer available" for monitors:** when the monitors list **loaded successfully** and a
  widget's saved monitor isn't in it, the widget shows the "no longer available" card (as for an
  unresolvable region), with "Choose another" and "Remove". When the list can't load, the
  widget keeps today's behavior (error with Retry). This settles `DEFERRED.md` → "An unknown
  monitor shows the error (with Retry) or 'No data'…" and, through the same check, "A monitor
  missing from the monitors list gets the uncalibrated series silently" (the query becomes
  unavailable instead of asking for an uncalibrated series). Telling a retired monitor from one
  that never existed stays deferred ("Stopped reporting" for monitors).

### Browse (the user: agreed from `picker-browse.html`)

- **The type list:** region types from `regions/meta/` with `browsable: true` and `count > 0`,
  in the server's order, each with its count, plus **Monitors** (a fixed UI string). Selecting
  one opens its list.
- **Headings are the plural label,** `types.<type>.label_plural` (Title Case, e.g. "Counties",
  "ZIP Codes"; sjvair.com PR #307, SDK 5.0.0-beta.3, not out yet). **Until the pinned SDK has
  it, show the singular `label`** ("County"); never invent plurals (my call, agreed with the
  coordinator; `DEFERRED.md` until the pin moves).
- **Narrowing by parent:** a type whose `parents` includes a type (today only `county`) gets an
  "In: <parent> ▾" control (default: all), and its list is fetched with `regions/?within=`. One
  parent type narrows; the others are children (`docs/reference/v1-lessons.md`). A narrowing
  that yields nothing is a normal empty state, not an error.
- **Every list has a filter box** (some are long: ~1,160 census tracts), filtering in the browser.
- **"Inside ›" on a parent's rows** (county rows) lists the child types inside it and opens a
  child list already narrowed to it.
- **Picking a row picks the place** (or ticks it, in multiple mode; rows have checkboxes there).
- **Monitors browse:** a flat list with the filter box, grouped or labeled by network, until the
  server can filter the monitors list by region (approved by the user 2026-11-04:
  `monitors/?region=<sqid>`, repeatable, union; sjvair-com-c9 builds it after #307, with a
  `getMonitorsList` region option aiming for SDK beta.3); then it narrows by county like the
  region types (`DEFERRED.md` until the pin has it).
- **Retired regions** aren't offered in browse lists or search (my call; they still resolve for
  saved widgets).

### Recent places (my call; the user didn't object)

- Up to **8** recent places, newest first, saved per space through the platform adapter's
  `preferences` (this browser only; never sent to the server, never in documents).
- Every pick of a monitor, region, or school is added (a re-pick moves it to the top); **"your
  location" is never added** (the button is always there, and an old position goes stale).
- Read back through a schema (untrusted storage): a malformed list is dropped silently.
- Rows show the place's current name (resolved, so a renamed or retired place shows correctly);
  a recent place that no longer resolves is left out.

### Getting to the picker (the user)

- **"Change place"** in the ⋯ menu of a Chart or Data table (widget types with a pollutant layer
  and `accepts.maxPlaces`), only when the dashboard is editable.
- **"Choose a place"** button on the idle state ("Choose a place to show data.").
- **"Choose another"** on the "no longer available" card (shown now, hidden in spec 1).
- **It opens in a dialog** over the dashboard; on a phone the dialog fills the screen.
- **The picker is a component the dialog hosts,** so spec 3 can place it inline in the Data
  Explorer's dataset sections, and spec 6 in the starter's bar.
- **Every change is one `setWidgetData` edit,** so Undo restores the old place. Cancel, Escape,
  or closing makes no change. A pick identical to the current place makes no edit.

### "Use my location" (the user: picks right away)

1. Pressed (never automatic), it asks the platform adapter for the position; the browser shows
   its usual permission prompt. Geolocation is a new platform capability (web: the Geolocation
   API; the memory platform: a scripted position for tests; Tauri later).
2. The dashboard looks up the containing regions with `lookupRegionPlace({ lat, lon, type })`
   (POST body; the SDK and server round to 3 decimals; never coordinates in a URL).
3. **It picks a `point` place right away**, no confirmation. The widget's title says where the
   data comes from ("PM2.5 for ZIP 93721 (your location)").
4. **Denied or unavailable:** "Location access is off. Search for a place instead." (and a
   timeout / no-fix message along the same lines; wording is the builder's, through Paraglide).
   **Outside SJVAir's area** (the lookup finds no ZIP, city, or county): "Your location is
   outside the area SJVAir covers." Nothing is picked in either case.
5. The point stored is exact (the owner's own document keeps it; `ARCHITECTURE.md` → "Location
   privacy"). `PlaceRef.point.label` is never set with generated English.

### What a point or a school shows (decided 2026-09-28; details are my calls)

- **Air quality comes from the smallest containing region with data for the pollutant,** tried
  ZIP → city → county:
  - **A point** gets its regions from the coordinate lookup (cached per rounded point).
  - **A school** uses its own linked regions (`getLocationsByCode`, batched; a location's
    identity is its `source` + code), with no coordinate lookup.
- **"Has data" (my call):** the region has any data in the widget's date range. A ZIP with gaps
  stays the ZIP rather than jumping to the county; the fallback is per query, at render time.
- **Labeled:** "PM2.5 for ZIP 93702 (Roosevelt High School)", "PM2.5 for ZIP 93721 (your
  location)": one Paraglide message with placeholders, no concatenation. The table header and
  CSV place column name the same way (the CSV never carries coordinates).
- **A school that no longer resolves** (a code that never existed) gets the "no longer
  available" card. **A retired school** (still resolves, `retired: { since, replaced_by }`)
  keeps showing data through its regions, with a note "<name> is no longer listed (since
  <date>)" and, when there's a replacement, "Switch to the replacement" (my call; mirrors
  retired regions).
- **The data layer:** `layerTarget` supports `location` and `point` (they return
  `place-unsupported` today); `QueryData.places` names the place with its source and the region
  used. How the fallback fits the adapter and cache is the builder's.

### Location privacy when sharing (decided 2026-09-28; live links: the user, option A)

"Exact location" means a `point` place anywhere in the dashboard. Schools need none of this.

- **Copy link and exported file:** the shared content has each point swapped for the region its
  widget actually uses (e.g. ZIP 93721), and the dialog says so: "Your location is shared as
  ZIP 93721, not your exact position." It offers **"Share my exact location instead"** (off by
  default, chosen per share) with a warning that anyone with the link or file sees it.
- **Copies made from a share** always swap points for their region (see below). The owner's own
  copies (the starter copy, "Save as copy", Duplicate) keep the exact point.
- **Live share link:** viewers read the owner's synced document, so nothing can be swapped in
  transit. When the dashboard holds an exact location, the Share dialog says so **before**
  turning the link on and offers **"Use ZIP 93721 instead"** (one undoable edit of the owner's
  widgets, swapping each point for its region) or **"Share my exact location"** (with the
  warning). No server change.
- **If the region can't be looked up** (offline, server error), the share waits with a message
  and Retry; it never falls back to the exact point silently (my call).
- **Which region:** the one the widget shows now (the same resolution as rendering). A point
  whose widget has no data anywhere uses its county (my call).
- **"Use my location" on a dashboard with a live link (the user, from the builder check):** it
  saves the region the widget would use (ZIP, else city, else county) instead of the exact
  point, and says so: "This dashboard is shared by link, so your location is saved as ZIP
  93721." So nothing exact reaches viewers through autosave without a choice. The check is at
  pick time (the picker knows whether the open dashboard has a live link from its sync record's
  `shareToken`); turning a link off doesn't restore the point.
- **What other people see for a point (the user, from the builder check):** copies made from a
  share, including imported files, **always** swap points for their region; there's no "keep
  exact" option on the receiving side. So the only people who see someone else's point are
  viewers of a live link whose owner chose "Share my exact location"; in that read-only shared
  view the label says "(shared location)" instead of "(your location)". No schema change.

### Accessibility (WCAG 2.2 AA)

- **The search box and results follow the W3C ARIA combobox pattern** (editable combobox with a
  listbox popup): arrow keys move through results across groups, Enter picks, Escape clears,
  then closes; groups are labeled (`role="group"` with a label); the result count is announced
  in a polite live region after each search settles ("12 results", "No matches").
- **Browse lists** are a W3C APG grid (`role="grid"`, multi-select ones `aria-multiselectable`,
  checkboxes shown; each row a `row` with `aria-selected`/`aria-disabled`, a name cell and an
  Inside cell; ↑/↓ rows, ←/→ to Inside, Space/Enter picks). _Changed during the build
  (2026-11-04, Task 11 review):_ this said listboxes, but a listbox can't hold the row's
  separate "Inside ›" button, and the grid is the standard pattern for rows with their own
  controls. Breadcrumbs/back buttons are real buttons; "Inside ›" is a separate, labeled
  button on the row.
- **Greyed-out rows** are `aria-disabled` (still focusable and announced) with their reason as
  the row's description, never color alone.
- **Chips** have a labeled remove button; removing returns focus sensibly.
- **The dialog** traps focus, returns it to the opener on close, and is fully usable by keyboard;
  the design pass's focus ring and density apply. Motion respects `prefers-reduced-motion`.

### Search mechanics (from the provisional answers given to the server; confirmed)

- **One box runs three searches in parallel:** monitors (in the browser), regions
  (`searchRegionPlaces`), locations (`searchLocations({ q, signal })`, which skips the request
  under 2 characters). Debounced (about 250 ms; the builder's), from 2 characters, and each new
  query aborts the last through the SDK's `AbortSignal`.
- **Groups load and fail independently:** a failed group shows "Couldn't search <kind>. Retry"
  inline, and the others still show.
- **No type or region filter controls in spec 2** (my call): the SDK's `type` / `region` options
  on `searchLocations` stay unused until someone needs them (`DEFERRED.md`). The coordinator was
  told these were optional; this narrows it.
- **Region search response weight:** `regions/places/search/` currently returns full boundary
  geometry (883 KB for "fre" locally). Approved by the user 2026-11-04: sjvair-com-c9 drops
  geometry from those rows (keeping `bbox`) and adds each row's containing county if cheap, with
  the SDK's new `searchRegionPlaces` return type aiming for beta.3. The picker works either way;
  it reads id, name, type, code, and retirement, and shows the county as a second line once
  rows carry it. Final shape (sjvair.com #308, merged into `develop` with #307; the local stack
  serves both): rows are `{ id, name, slug, type,
  external_id, retired, boundary: { id, version, bbox } | null, county: { type, external_id,
  name } | null }`; `county` is the county holding the region's point-on-surface (lowest code on
  a tie), null on county rows and outside every county; "fre" is 3 KB. `monitors/?region=` is
  repeatable (union), ignores blanks, 404s on an unknown id, and works with `dataset=weather`.
  A row spanning several counties (some school districts, ZIPs, urban areas, the Valley air
  district) names one county only; listing every county is deferred by the user
  (`DEFERRED.md` → "Every county on multi-county place search rows").
- **So the fallbacks are about SDK types, not the server:** beta.2 still types search rows as
  full `RegionData` (with geometry) and has no `getMonitorsList` region option or
  `label_plural`. Never read `boundary.geometry` from search rows, even though beta.2's types
  allow it.

## Constraints (project rules that bite here)

- **First commit:** pin `@sjvair/sdk` exactly to `npm:@jsr/sjvair__sdk@5.0.0-beta.2` (no caret;
  check the lockfile's root entry too), and in the same commit drop `exact: true` from
  `rawTasks` and its doc comment in `src/lib/data/adapters/air-quality-fetch.ts` and `{ exact }`
  from `src/lib/data/adapters/air-quality.test.ts` (`getValidDateRange` takes `wholeDays`
  now). Tell the coordinator when it lands.
- **Then merge `origin/main` into `step-4`** (the user, 2026-11-04; about 50 commits behind)
  through a small PR into `step-4` (the user took my recommendation), keeping both sides' entries in
  conflicts; tell the coordinator about any unclear one. Then rebase/merge `step-4` into this
  branch.
- **When beta.3 is out (only when the user says so):** pin it, use `label_plural`, and update
  the e2e fixture `e2e/fixtures/api/2.0/monitors/meta.json` (drop the legacy `levels` dict, add
  `school_guidelines`, required and nullable; pm25's value from sjvair.com #306's
  `camp/apps/entries/guidelines.py` or the SDK fixture).
- **Metadata is the source of truth** (labels, plurals, browsable/count/parents, location
  types, monitor networks and their entry types).
- **Paraglide for all text,** no concatenated sentences; formatting through `$lib/format`;
  never store generated English (titles and labels are generated at render).
- **Untrusted documents:** `PlaceRef` and `SpatialSelection` are already schema-validated with
  limits (`src/lib/data/schema.ts`); recent places are validated on read.
- **Platform adapter only** for geolocation and the recent-places preference.
- **Theme tokens only** (`src/lib/theme/token-discipline.test.ts`); shadcn-svelte/bits-ui
  primitives (Dialog, the combobox built on bits-ui where it fits the ARIA pattern).
- **Bundle:** the picker and its search code load lazily (when a picker opens), never in the
  initial bundle (195.9 KB gzip today, soft budget 200). The "Change place" menu entry and the
  idle-state button stay tiny in the initial chunk. A new barrel-imported package used only by
  lazy code goes in `vite.config.ts`'s `BARRELED` list.
- **Nothing touches production;** no releases or publishes without the user's yes each time.

## Testing (what must be shown)

- Unit: search merging/grouping/ranking and abort; pollutant-fit filtering from metadata; the
  mixed-kind and cap rules; place ↔ selection storage; recent-places read/write/validation; the
  point and school fallback (ZIP → city → county, "has data"); the share swap (copy link,
  export, copy from share) and its "exact instead" choice; the unknown-monitor rule (list loaded
  vs failed).
- Browser component tests: the picker's keyboard model (combobox pattern), greyed-out reasons,
  chips, browse narrowing and "Inside ›", the live-region announcements, axe clean (as in
  `LevelSwatch.browser.test.ts`), desktop (`page.viewport(1280, 800)`) and phone widths; wait
  for animations with `animationsSettled(el)`.
- E2E (fixtures): Change place on a Chart and a Data table, Undo; Choose a place from idle;
  Choose another from "no longer available"; Use my location with a granted and a denied
  permission (Playwright geolocation); the Share dialog's live-link prompt and the copy link's
  swap; "Use my location" on a live-shared dashboard saving the region; a copy made from an
  exact share getting the region; "(shared location)" in the live-link view.
- A local stack check against `develop`: search "fre"/"roo", browse ZIPs in Tulare County, a
  school's chart, my location (a scripted position). Time-sensitive code under
  `npm run test:unit:tz`; formatted times match an optional " PT".
- `npm run check:budget` after a build: the initial bundle doesn't grow beyond noise.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Comparing mixed kinds in one widget** (a school, a monitor, and a county side by side). Why:
  the shared `SpatialSelection` shape is all monitors or all regions, and mixing needs a new
  shape across map-sdk and the data layer. Revisit if users ask, or when Release 3 analysis
  needs it.
- **Per-monitor pollutant coverage.** Why: the fit rule is per monitor type, so a site without
  the pollutant can still be offered. Revisit when the server exposes per-monitor entry types.
- **Singular browse headings until `label_plural` is in the pinned SDK.** Revisit when the user
  says 5.0.0-beta.3 is out.
- **Monitors browse can't narrow by county,** and region search rows are heavy and carry no
  county. Revisit when the user says the SDK beta with `monitors/?region=` and the lighter
  `searchRegionPlaces` rows is out (approved 2026-11-04, aiming for 5.0.0-beta.3).
- **Location type and region filters in the picker UI.** Why: one search box covers the brief.
  Revisit if school searches return too many unrelated rows.
- **Recent places don't follow the account across devices.** Why: kept in this browser only.
  Revisit if people ask for them on another device.
- (The existing "Greying out places with no data" and "Stopped reporting for monitors" stay.)

## Docs changed with this spec

- `ARCHITECTURE.md` → "Widget data selection" → "Places" (picker modes, the kind rule, pollutant
  fit, monitors list contents, recent places, the live-link privacy prompt, the fallback's
  "has data"), "Saving & sharing documents" (the share swap and live-link prompt), and
  "Platform strategy" (the geolocation capability).
- `TODO.md` / `ROADMAP.md`: step 4's sections only.
- `DEFERRED.md`: the deferrals above; the two settled monitor entries move to Done.

## After the merge into `step-4`

Rewrite `prompt-map-widget.txt` (untracked, top of the checkout) with what the picker and data
layer became (selection shape, request shapes, the map-sdk `DataSource` feed; see
`../map-sdk/demo/date-range-source.svelte.ts`) and tell the coordinator. No map code in step 4.

## Left to the builder

- Component structure, the combobox's implementation on bits-ui, how the dialog and inline hosts
  share state.
- Debounce timing, ranking details, caching of searches and browse lists.
- How the point/school fallback fits the adapter, target, and cache keys.
- Exact wording of messages (through Paraglide, in the spirit of the examples here).
