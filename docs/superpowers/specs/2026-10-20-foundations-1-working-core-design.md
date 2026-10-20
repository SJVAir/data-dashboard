# Foundations, spec 1: the working core

Date: 2026-10-20. Branch: `foundations`. Release 1, step 1 (Foundations), first of five specs.

## Why

Foundations (Release 1, step 1 in `ROADMAP.md`) is about 30 items. It is split into five
specs, each with its own spec → plan → build cycle, built as stacked PRs on top of
`foundations` (decided 2026-10-20):

1. **The working core** (this spec).
2. **The data layer**: caching, polling, resolution, worker downsampling, the dataset
   registry, `QueryDescriptor`, `DateRangeSpec` resolution, `readableColor` and outlined
   swatches. Blocked on the sdk-js request-options change (`signal`/`init`,
   `setRequestDefaults`), whose own sdk-js plan runs alongside this spec.
3. **Safety and sharing**: Export/Import `.json`, URL-fragment share and `/import`, size
   limits on incoming documents, version skew (`version.json`, chunk-load failures, the
   change-queue replay rule), keeping originals after upgrades, "Recently deleted",
   durability notes and the backup nudge, "Clear my data".
4. **Collections**: the store, the drawer, "Add to collection ▸", staging, and the
   placeholder Analysis view. Needs spec 2 (staging freezes a widget's date range).
5. **Shipping readiness**: build output for the Django template, the CSP host list,
   Sentry, the license check, the bundle budget, the unsupported-browser notice, the
   manifest, the offline banner, the dev proxy, the privacy note and feedback link, and
   **the sign-in side of storage spaces** (identity from the template's data block, the
   "add anonymous work to your account" prompt, sign-out, expired sessions, re-checks on
   focus, cross-tab sign-in).

Order: 1 → 2 → 3 → 4 → 5.

**What spec 1 is for.** The user's finish line: _create a dashboard, add placeholder
widgets, and have it autosave_. Reload the page and everything is still there. Spec 1
builds the pieces underneath that every later step stands on (the document format,
`applyChange`, undo/redo, local storage, the shell, the action registry) and proves them
with a placeholder widget type, before any real widgets or data exist.

## Goals

- A new top-nav app shell replaces the v1 app entirely.
- First-time visitors land on the **starter dashboard**, made of placeholder widgets.
  Their first real edit turns it into their own copy.
- Dashboards can be created (blank or from the starter), duplicated, renamed, and deleted
  (with an undo toast), from a dropdown picker in the top nav.
- Placeholder widgets can be added, renamed, duplicated, and deleted, from a ⋯ menu and
  from right-click (the same shared action registry).
- Every edit goes through `applyChange`, can be undone and redone, autosaves to IndexedDB,
  and appears in other open tabs.
- Widgets render on the real 12-column grid at their stored positions (no dragging or
  resizing yet).
- The groundwork every later UI needs: theme tokens, Paraglide messages, the `format`
  module, the platform adapter's storage, CI, and the test setup.

## Non-goals (in a later spec or step)

- Anything that fetches data (spec 2). Spec 1 makes no API calls.
- Dragging, resizing, collision, compaction, minimize, fullscreen, the taskbar (step 2).
- Widget Creation, real widget types, the "Change place" bar (step 4). Placeholders are
  added directly.
- Export/Import, sharing, "Recently deleted", originals kept after upgrades,
  `version.json` checks, "Clear my data", durability notes (spec 3).
- Collections and the Analysis view (spec 4). The nav shows no Analysis entry until then.
- Sign-in, account spaces in use, the dev proxy, Sentry, the CSP list, the manifest, the
  embedding build output (spec 5).
- Syncing with the server (the parallel server-backed documents track).

## Anti-goals

- **No bolt-ons onto v1 code.** Reuse v1 code only if it is exactly what the new design
  needs; otherwise write it fresh.
- **No throwaway scaffolding that a later step replaces.** The placeholder grid, the
  ⋯ menu, and the starter mechanism are the real ones, so step 2 and step 4 add to them.
- **No stored English.** Generated names and titles are `null` in documents and rendered
  from message keys.
- **No direct `localStorage`/`indexedDB` calls from components or stores**; everything
  goes through the platform adapter.

## Constraints (all already decided; see the named `ARCHITECTURE.md` sections)

- Svelte 5 runes, Tailwind v4, shadcn-svelte / bits-ui, tabs, double quotes, no trailing
  commas, 100-column lines (`CLAUDE.md` → "Code Style").
- Styling values only from theme tokens ("Theme & style").
- All UI strings through Paraglide; no concatenated sentences ("Internationalization").
- Pacific time and Sunday week start through the `format` module ("Time zone & calendar
  conventions").
- WCAG 2.2 AA: keyboard access to every action, ARIA from bits-ui, live regions for
  status, `prefers-reduced-motion` ("Accessibility").
- Only permissively licensed dependencies ("Licensing").
- Routes and `basePath` per "Routing, URL state & undo" and "Deployment".

## What gets built

### 0. Before anything is removed: `docs/reference/v1-lessons.md`

Write down what the v1 code and its tests learned about server behavior and edge cases,
as behaviors rather than code. TODO.md → "Release 1, step 1: Foundations" lists the
starting points (rollups only after the period ends, lazy and deduped region-boundary
fetches, single-parent narrowing and child-type filtering, black borders for regions with
no average, `land_use`/`mtrs` too large to list, globe zoom precision, year/month showing
0 or blank while loading, map/calendar updates not blocking on child-list refetches).
Also harvest the edge cases the v1 tests encode. Commit it before the fresh start.

### 1. The fresh start

Remove the v1 shell (`App.svelte`'s sidebar and sheet), `AppNav`, the tab routes and pages
(`src/routes/*`), `src/lib/monitors/*`, `Calendar.svelte`, `DataBox.svelte`,
`RegionCheckboxList.svelte`, `preferences.ts`, `url-state.ts`, `calendar.ts`, and their
tests. Remove dependencies that only v1 used (likely `@sjvair/monitor-map`,
`@maptiler/sdk`, `@turf/boolean-point-in-polygon`, `@tstk/*`, `@types/geojson`,
`@internationalized/date`; the builder confirms each by usage). **Keep `@sjvair/sdk`**
(spec 2 needs it). Keep shadcn `ui/` primitives that the new shell uses; remove the rest.

`main.ts` no longer sets the SDK origin or requires `VITE_DEV_URL`; spec 2 brings SDK
setup back in its new form (_builder's call to keep the env var in `.env.example`_).

### 2. Platform adapter (storage part)

`src/lib/platform/`: a small set of interfaces plus the web implementation. Spec 1
builds **storage** (documents, the change log, preferences, storage spaces) and an
**identity source** that always answers "anonymous" for now. Other capabilities
(notifications, file export, online status, geolocation, error reporting, auth mode,
token storage) are added by the specs that need them; the adapter's shape must make that
purely additive.

- The web implementation uses IndexedDB. _My call:_ the `idb` wrapper (ISC, ~1 KB).
- **Storage spaces from the first schema**: every document, change record, and
  preference is keyed by a space id. Spec 1 only ever uses the anonymous space, but the
  keys are there so spec 5 needs no data migration.
- Purely cosmetic device settings (none yet) would live outside spaces.
- Preferences in spec 1: the last-opened dashboard id (per space).
- **The IndexedDB layout is reserved for later specs too**: a store for upgrade
  originals (spec 3) and one for unsynced server changes (server-sync track) may be
  created empty now or added by a versioned IndexedDB upgrade later (_builder's call_).
  Unsynced changes are only queued for account spaces, so spec 1 writes none.

### 3. Documents

`SavedDocument` and `DashboardBody` per "Saving & sharing documents", with zod schemas.
Field detail settled here:

- `name: string | null`. **`null` means generated** ("Untitled dashboard", or "My
  dashboard" for a starter copy), rendered from a message key; a rename stores text.
  (_My call_, following the no-stored-English rule; it amends the sketch in
  `ARCHITECTURE.md`, which shows `name: string`; that section is updated alongside this
  spec.)
  - **Duplicating** copies the source's name as-is (text or `null`) and then opens the
    rename dialog with the name selected, so the person can tell the two apart right away
    (_my call_). No "Copy of …" text is generated, since that would be stored English.
  - **Several unnamed dashboards** are told apart at display time: the picker and list
    number them by creation order ("Untitled dashboard", "Untitled dashboard 2", …), from
    a message with a parameter. Nothing is stored.
- `id`: `crypto.randomUUID()`.
- `copiedFrom`, `deletedAt`: present in the schema now. Spec 1 sets `copiedFrom` (starter
  copy, duplicate, new from starter) and `deletedAt` (soft delete); spec 3 adds the
  "Recently deleted" list and the 30-day purge.
- A **document version counter** (local save version, incremented per saved change),
  used by cross-tab replay and later by server sync.
- `WidgetInstance` as sketched (`id`, `type`, `title: string | null`, `rect`,
  `minimized?`, `data`, `options?`, `thresholds?`). For spec 1, `data` is
  `{ layers: [] }` for placeholders; **spec 2 finalizes `WidgetDataConfig` and its
  schema**. `minimized` and `thresholds` stay in the schema, unused until steps 2 and 4.
- **A widget-type registry** with the contract from "Widget-type contract". Spec 1
  registers one type, `placeholder` (`time: "none"`, `analyzable: false`, no layers,
  `thresholds: false`, a `minSize`, a `defaultTitle` from a message key, a `menu`
  provider). Fields that need later specs (`accepts`, `resolution`, `dateMethods`,
  `span`) are typed now and left unused.
- **The migration chain and load pipeline**: read → validate against that
  `schemaVersion`'s schema → migrate step by step → validate against the current schema.
  A document with a **newer** `schemaVersion`, or one that fails validation, opens
  **read-only** with a plain message and is never overwritten; one bad document never
  blocks the others. Spec 3 adds the kept originals and error reports.
- **`schemaVersion` 1 is not frozen until the first build anyone outside development uses**
  (the private preview). Until then the version 1 format may change freely without a
  migration. From then on, fixtures for every past version are kept permanently and CI
  runs the chain against them. Spec 1 tests the chain machinery with a test-only
  migration. (_My call._)

### 4. `applyChange`, undo/redo, autosave, cross-tab sync

Per "Routing, URL state & undo" → "Undo/redo" and "Changes, unsynced edits, and tabs".

- **`applyChange(doc, change) → { doc, inverse }`**: pure, unit-tested. Changes are
  serializable JSON with explicit `target`s. Spec 1's set: add widget, delete widget,
  duplicate widget, rename widget (`setField` on `title`), rename dashboard. Delete
  dashboard is a soft delete through the same path. Each change type has a zod schema.
- **Undo/redo**: per document, per tab, not persisted. Ctrl/⌘+Z and Ctrl/⌘+Shift+Z
  (not while typing in a text field), the global Undo/Redo actions, and **visible undo
  and redo buttons in the nav** (agreed 2026-10-20). Undoing the edit that created a
  starter copy undoes the edit; the copy remains (_my call_).
- **Autosave**: every change persists after about 500 ms of quiet (debounced), with a
  **"Saved" indicator** in the nav: saving, saved, or couldn't save. A failed write keeps
  the in-memory document and says so; spec 3 adds the fuller quota and durability
  messages. Pending saves flush on `pagehide`/`visibilitychange`.
- **Cross-tab sync** with `BroadcastChannel`: a saved change is broadcast and applied in
  other tabs showing that document. Saves are versioned: a save based on an older version
  is replayed on top of the newer one when the targets don't overlap. On a true overlap,
  the three-choice prompt: "Keep mine / Use the other version / Save mine as a copy".
  Undo history stays per tab. The same replay logic is what server sync will reuse, so
  keep it independent of the transport. Rules (_my calls_, settled after the builder
  check):
  - **A local change log.** Every saved change is stored with the document's version
    number it produced, in the current space (the "change log" in section 2). A tab that
    falls behind (it was in the background, frozen, or restored from the back/forward
    cache, or it sees a version gap in broadcasts) reads the log from its base version
    forward. The log is trimmed to recent entries (_builder's call_, e.g. the last few
    hundred per document); if a tab's base version has been trimmed away, it reloads the
    stored document and replays only its own unsaved changes. Broadcasts are a fast path,
    and the log is the source of truth. This log is separate from the server-sync queue,
    which spec 1 doesn't write.
  - **Overlap** is judged by `target`: the same field of the same widget, or the same
    document field (e.g. the dashboard name), changed on both sides; or one side deletes
    a widget that the other side changed. Different fields of the same widget, or
    different widgets, are not an overlap.
  - **"Mine"** means this tab's changes that aren't yet in the stored version.
    **Keep mine** applies them over the other version; **Use the other version** drops
    them; **Save mine as a copy** makes a new document from this tab's base version plus
    its changes (`copiedFrom` set), leaving the original as stored.
  - **Adding a widget at the bottom is placement, not a fixed spot.** Add and duplicate
    changes carry a rect, but when they're replayed onto a newer version, a rect that
    would overlap another widget is re-placed at the new bottom. Two tabs adding widgets
    therefore never stack them on top of each other. Step 2's layout engine takes over
    this rule.
  - **An undo whose target no longer exists** (another tab deleted the widget) is
    skipped, and the next undo entry runs.

### 5. The starter dashboard

Per "Starter dashboard", with placeholder contents until step 4:

- A **built-in document** defined in code and validated by the schema like any other. Its
  name and widget titles are `null` (message keys). Placeholder content and arrangement
  are the builder's call; show a realistic grid, e.g. two half-width placeholders over a
  full-width one.
- `/workspace/` shows the starter to anyone with no dashboards of their own in this space
  (including after deleting them all); otherwise it opens the last-opened dashboard,
  falling back to the most recently changed one.
- **A hint bar** on the starter: "This is the starter dashboard. Any change saves it as
  your own." (agreed 2026-10-20).
- **The first real edit makes a copy**: a new id, `copiedFrom` set to the starter's id,
  the edit applied to the copy, the URL replaced with `/workspace/dashboards/:id` (no new
  history entry), and a toast: "Saved as your own dashboard". The built-in template is
  never modified.
- "New from starter" in the picker makes a copy directly.
- `default-place` doesn't exist yet in spec 1 (placeholders have no places). Step 4 adds
  its resolve-on-exit step to the copy path built here.

### 6. Placeholder widgets on the grid

- Widgets render on a **12-column CSS Grid** at their stored `rect` (`grid-column` /
  `grid-row`). There is no drag, resize, or collision logic yet. On phone widths the
  grid becomes a single column in reading order (top-to-bottom, then left-to-right);
  tablet column counts are the builder's call until step 2.
- **"Add widget"** (an action, a button at the end of the grid, and the empty-state
  button) adds a placeholder below everything else: `x: 0`, `y` = the current bottom, and
  a default size (_builder's call_, at least the type's `minSize`). Duplicate places the
  copy the same way. Step 4 replaces direct adding with a type picker and Widget Creation.
- A placeholder shows its title bar (title and a ⋯ button) and a neutral body saying it's
  a placeholder.
- **A blank dashboard** shows an empty state: "This dashboard is empty" with an "Add
  widget" button.

### 7. Actions and the context menu

Per "Actions & context menu": `MenuItem`, `MenuContext`, `MenuProvider`, the `menuScope`
attachment with its `WeakMap`, resolution by walking DOM ancestry, most-specific-first
merge with `id` overrides, grouped sections. Pure logic is unit-tested. Rendered by the
shadcn-svelte `context-menu` (bits-ui) as one trigger around the dashboard, opened by
right-click, long-press, and Shift+F10 / the Menu key. The widget ⋯ menu calls the same
resolution with that widget as the target.

Spec 1's actions:

- _Global:_ Undo, Redo.
- _Dashboard:_ Add widget; New blank dashboard; New from starter; Duplicate, Rename…,
  Delete dashboard.
- _Widget:_ Rename…, Duplicate, Delete.

Labels come from message keys, so `MenuItem.label` holds a rendered string produced at
resolution time (or a message function; _builder's call_), never stored text.

### 8. App shell, routes, and the picker

- **Top nav** (layout from the 2026-10-20 mockup): the product name, "Dashboards", the
  dashboard picker, then on the right the "Saved" indicator and undo/redo. No Analysis
  entry until spec 4; no sign-in button until spec 5.
- **The dashboard picker** is a dropdown in the nav: this space's dashboards (current one
  marked), then New blank dashboard, New from starter, Duplicate, Rename…, Delete, and a
  link to "All dashboards". It lists the same registered actions, not its own copies.
- **Rename** uses a small dialog for both dashboards and widgets.
- **Delete dashboard** soft-deletes, navigates to the last-opened remaining dashboard (or
  the starter), and shows a toast with **Undo**. Widget delete also gets an undo toast.
  _My call:_ shadcn-svelte's `sonner` toasts, if its license and size check out.
- **Routes** in spec 1: `/` (last-opened or starter), `/dashboards` (a simple list of this
  space's dashboards; open, plus the same actions), `/dashboards/:id`. Unknown paths and
  trimmed paths follow "Routing" (redirect to the section home). An unknown dashboard id
  shows "This dashboard isn't saved in this browser", with a link to your dashboards.
  Later routes (fullscreen, Widget Creation, Analysis, `/shared`, `/import`) come with
  their steps.
- **`basePath` support in `src/router.ts`** so the app runs under `/workspace/`. In dev
  the app is served at `/workspace/` too, so paths match production (_builder's call_ if
  sv-router makes that awkward; say so in the plan).
- **Page titles** per route, through messages.

The navigation can be reorganized later (e.g. a slide-out panel for dashboard controls)
without touching behavior, because every control is a view onto the registered actions
and shared stores. Revisit at the design pass.

### 9. Theme tokens, Paraglide, and the `format` module

- **Theme tokens**: all colors, fonts, radii, spacing, and motion timings as CSS
  variables wired into Tailwind v4's `@theme`, starting from shadcn-svelte's defaults.
  Components use only these. Motion tokens collapse to zero under
  `prefers-reduced-motion`. The design pass later swaps values.
- **Paraglide JS** with one English message file. Every string in this spec goes through
  it, including action labels, toasts, the hint bar, empty states, generated names and
  titles, and page titles.
- **The `format` module**: the Pacific time zone via `@date-fns/tz`, the Sunday
  week-start constant, "today in Pacific time", date/time/number formatters with a locale
  parameter (`en-US`), and the "PT" label shown only when the device's zone differs. Unit
  tests cover the DST days (23- and 25-hour days, repeated and missing hours).
  `DateRangeSpec` resolution is added to this module in spec 2.

### 10. CI and test setup

Per "Testing strategy":

- **Unit**: Vitest (existing) for `applyChange` and inverses, undo/redo, replay and
  overlap detection, menu resolution and merge, schemas, the migration chain, the
  `format` module, grid placement for new widgets.
- **Component**: Vitest browser mode (Playwright provider) + `vitest-browser-svelte`.
- **E2E**: Playwright on Chromium, WebKit, Firefox, with `@axe-core/playwright` on the
  shell screens (starter, a dashboard, an empty dashboard, the picker open, the context
  menu open, the rename dialog). Fixture routing is set up, though spec 1 makes no API
  calls. The finish-line test: open the app, edit the starter (a copy is made), add
  widgets, rename, reload, and everything is still there; undo/redo; a change in one tab
  appears in another.
- **CI (GitHub Actions)**: lint, type-check, unit, component, build, and Chromium E2E on
  every PR; the full set (three engines plus axe) on PRs into `main`. The full set can
  also be **started by hand** on any branch (`workflow_dispatch`), which is how this
  spec's three-engine bar is met before its PR into `foundations` merges (_my call_).
  This is a test run only; it deploys and publishes nothing.
- **Running E2E locally**: the dev machine is CachyOS (Arch-based), where Playwright
  doesn't officially support WebKit. Local three-engine runs use Playwright's official
  container image under podman; Chromium can also run directly (_my call_).
- The dev-stack smoke suite waits for spec 5 (the dev proxy) and spec 2 (the first API
  calls).

## Done when

- The finish-line E2E test passes on all three engines (in the hand-started CI run), and
  axe reports no violations on the listed screens.
- No v1 code or v1-only dependency remains; `v1-lessons.md` is committed.
- `npm run lint`, `check`, `test`, and `build` pass, and CI runs them on PRs.
- No hardcoded UI strings, styling values, or direct storage calls outside the platform
  adapter.

## Left to the builder

Anything marked _builder's call_ above, plus: file and module layout under `src/lib/`;
store design (runes classes or modules); the debounce and flush details; the IndexedDB
object-store layout within the constraints above; placeholder sizes and the starter's
arrangement; the exact wording of messages (plain, short); test file organization.

## Branching

This spec is committed on `foundations`. Implementation goes on a branch stacked on it
(e.g. `foundations-1-core`), with a PR into `foundations`; specs 2–5 stack the same way.
`foundations` merges into `main` only with the user's explicit approval.
