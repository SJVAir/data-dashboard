# Architecture

This document describes the design of SJVAir's data dashboard. The current direction
comes from `IDEA.md` (planning brief) and the decisions made while working through its
Open Questions on 2026-09-23 — each section below notes which question it resolves.
Deferred and ruled-out items live in `DEFERRED.md`; the server's actual data is
catalogued in `docs/reference/server-data-inventory.md`. The original v1 tab-based
design (`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`) is being
superseded — see "Legacy: v1 tab model" at the end.

## Product direction

**A personal, interactive dashboard and data-analysis toolbox for all public SJVAir
data** (historical and live). Three uses:

- **Day-to-day monitoring** of conditions.
- **Exploring trends** local to a region.
- **Staying on top of live data for alerts** — both _self-monitoring_ (live data shown
  clearly enough to spot concerning values as they arrive) and _automated alerting_
  (the system notifies the user when values cross a threshold).

**Audiences:** everyday community members, schools, and research scholars. Intuitive
for basic users, feature-rich for power users.

### Views

- **Dashboard** (primary) — horizontal navigation bar on top (replacing the v1 vertical
  sidebar), dashboard area below. Holds widgets (see "Dashboard layout mechanics",
  "Widget catalog"). Multiple saved dashboards, selectable at minimum via a dropdown
  (ideally a nicer visual picker if it proves more intuitive). "Add widget" picks a type
  from the predefined list, then opens Widget Creation to configure its data.
- **Widget Creation** — configures one widget's data (see below).
- **Analysis** — Collections, starter and user-defined analyses, notebooks (see
  "Analysis: Collections & engine", "Notebooks").

These may change if a better structure emerges.

### Widget Creation view

Starting point: the v1 app's data-type tabs and their filter options, adapted:

- **Date selection sits above** the option accordions. **One date range per widget**
  (dashboard display widgets only — time-offset/lag comparison belongs to Analysis).
- **Three date-range methods**, one visible at a time, toggled via a dropdown (unless
  something more elegant fits):
  - **Set ranges** — year, month, week, day
  - **Rolling ranges** — year-to-date, month-to-date, week-to-date
  - **Custom ranges** — user-selected
- **The v1 sidebar tabs themselves become accordion sections** (decided 2026-09-24).
  No tab view or side menu survives. Where v1 had a "Monitors" tab leading to a page of
  Monitors filters, Widget Creation has a **"Monitors" accordion** that expands to those
  options (pollutant, monitors/regions). The same goes for "HMS Smoke/Fire" and the
  others. The accordion list is **generated from the `meta/datasets/` catalog**, so new
  data types (Pesticides, Weather, Forecasts, …) appear as new accordions without code
  changes.
- **Multiple accordions per widget.** A widget combines dataset **layers**, one per
  accordion used, e.g. a map with PM2.5 plus smoke, or a chart overlaying PM2.5 with
  smoke days. All layers share the widget's single date range.
- **Pollutants: at most one pollutant layer per widget** (no mixing O3 and PM2.5 in one
  widget). Non-pollutant layers can be combined freely.
- Which accordions a widget offers, and whether the date section appears at all, comes
  from its **widget type** (see "Widget catalog" → "Widget-type contract"). For example,
  Notes has no date or data, and Current conditions picks a place instead of a range.
- **Live preview on the right**, itself a drag-and-drop, resizable area matching
  dashboard behavior.

### Shared widget behavior

- **Title bar** defaults to the dataset name(s) + date range; user-renamable.
- Every widget contributes **"Mark for analysis"** (add its data — or current selection —
  to a Collection) and **"Analyze"** (add + navigate to Analysis) via the shared action
  list (see "Actions & context menu"). Widgets with a selection (map features/regions,
  calendar day ranges) add "Mark selected data for analysis" / "Analyze selected data"
  alongside the whole-dataset options.
- Minimize, fullscreen, drag, resize per "Dashboard layout mechanics".

### Theme & style

- **Tailwind CSS + shadcn-svelte** for components. **Never Bulma** (the server uses it;
  this project never will).
- No SJVAir ecosystem theme exists yet; colors and style direction may be derived from
  the server's existing pages/templates (a dedicated design pass is in `DEFERRED.md`).
- Modern component/layout practice; **animations for transitions encouraged**. Tone:
  clean, not messy — but not plain, boring, or corporate. Use layout patterns users
  already know.
- **Responsive required** — phones aren't the primary target but must work.

### Charting

**uPlot for all charts.** Nearly all data is time series, so chart configuration should
converge on a consistent, shared pattern.

### Alerts

The server already has an alert/notification system; **extend it** for dashboard
alerting rather than building a separate one. Current shape (see
`docs/reference/server-data-inventory.md`): `Subscription(user, monitor, level)`,
level-category thresholds, evaluated every 10 min for PM2.5 (most monitors) / O3
(AirNow, AQLite), **SMS only**; no push infrastructure exists on the server or in
`v3-mobile`.

Decided 2026-09-24: **two separate mechanisms.**

**1. Self-monitoring — client-side, no account.** Widgets make threshold states obvious:
level-colored threshold lines on charts, current-conditions tiles that change color /
pulse on a level change, a toast when a newly arrived value crosses a threshold, and an
opt-in browser notification **while the dashboard is open** (through the platform
adapter). Thresholds default to metadata levels and are overridable per widget. Needs
no server changes; ships with the widgets.

**2. Automated alerting — server-side, requires an account.** The dashboard only
_creates rules_; the server evaluates them on its periodic task and delivers through a
channel that reaches the user when the dashboard is closed. Extends `Subscription` into
a general alert rule (target monitor _or region_, entry type, condition, channels).
Region targets fit naturally: `RegionSummary` is already computed hourly. Needs an
approved sjvair.com plan.

**What automated alerts watch (first server iteration, decided 2026-09-24):**

- **Pollutants** — on **monitor** targets (existing 10-min evaluation) and **region**
  targets (county, city, ZIP, **school district**, …; evaluated from hourly
  `RegionSummary`, so ~1 h latency). Limited to the **available pollutants** list
  (below) — PM2.5 and O3 today — though the rule model supports every summarized entry
  type (pm25, o3, no2, so2, co).
- **Forecasts** — tomorrow's AQI category, no-burn days, declared air alerts (per
  forecast zone): before-the-fact warnings, especially for schools.
- **Pesticide notices nearby** — a SprayDays application scheduled within N miles of a
  chosen place.

Smoke, heat (CalHeatScore), fire-proximity, and drawn-area targets are deferred — see
`DEFERRED.md`.

**Thresholds & notification behavior (decided 2026-09-24):**

- **Pollutants: level categories only** (e.g. "Unhealthy for Sensitive Groups or
  worse"), picked from metadata levels — so thresholds track breakpoint changes
  automatically. Numeric thresholds are deferred (see `DEFERRED.md`).
- **Averaging windows are server-defined, not user-set:** monitors keep today's 30-min
  average to open / 60-min to update; regions use hourly summaries. Published via alert
  metadata (Metadata gap #4) so the UI can explain "based on a 30-minute average".
- **Notify on:** first crossing, escalation to a worse level, and an optional
  **"back to normal"** message. No repeats while a level holds.
- **Guard rails:** per-user daily cap per channel; optional **quiet hours** (e.g.
  overnight SMS).
- **Forecasts:** tomorrow's category ≥ a level, and/or no-burn day, and/or declared air
  alert; checked once daily after forecasts publish.
- **Pesticide notices:** place + radius (e.g. 1/2/5 mi), optional filters for
  application method (aerial/ground) and chemical category (e.g. fumigants); notify when
  the notice is published, optional reminder the day before application.

**Delivery channels (decided 2026-09-24):** channels are chosen **per rule**. First
iteration: **SMS** (available for **every** alert type — daily caps and quiet hours are
the cost control), **email** (new; natural default for schools and slow alerts), and
the **in-app alert inbox** (every fired alert lands there; history, not delivery).
**Web push** is the next iteration; **mobile app push** is a separate `v3-mobile`
project. Both are tracked in `DEFERRED.md`.

Channel reference:

| Channel                  | Reaches user with dashboard closed? | Notes                                                                                                                                     |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SMS                      | Yes                                 | Exists; per-message cost; verified phone                                                                                                  |
| Email                    | Yes                                 | Cheap to add via Django                                                                                                                   |
| Web push                 | Mostly                              | Desktop needs the browser running; Android works; iOS only for home-screen-installed sites. Needs a service worker + VAPID + server table |
| Mobile app push          | Yes                                 | Would require FCM/APNs in `v3-mobile` — separate project                                                                                  |
| In-dashboard alert inbox | No                                  | Not delivery — history of what fired, shown on next open                                                                                  |

### Sibling projects

Built with and against `sjvair.com` (server), `sdk-js` (`@sjvair/sdk`), and
`monitor-map` (map SDK, also used by sjvair.com and `v3-mobile`). They may need changes,
but **must not break their existing use cases**, and **each change needs an approved
plan first**.

## Platform strategy: web-first, Tauri-ready

Decided 2026-09-23 (IDEA.md Open Question #1). **The web build is the primary product;
a Tauri desktop build is a later, additive target** — not the other way around.

Why web-first:

- **Audience reach.** Schools largely run managed Chromebooks / locked-down machines
  where installs are blocked (ChromeOS can't run Tauri at all); community members
  arrive via links from sjvair.com. Only research users are likely to install an app.
- **Embedding** in sjvair.com (see below) is a web-only goal.
- **Tauri is not one engine.** It uses the OS webview — WebView2 (Chromium) on
  Windows, WKWebView (Safari) on macOS, WebKitGTK on Linux. WebKitGTK has known
  WebGL performance/driver problems (relevant to map widgets). A desktop-first build
  would still need cross-engine testing, with worse tooling.
- Tauri's distinctive features (tray, native notifications, local SQLite, background
  polling for alerts, large offline datasets) are **additive capabilities**, not
  foundations — as long as the core never assumes they're absent.

Tauri-ready seams required **from day one**:

- **Platform adapter layer.** A small set of interfaces for storage, notifications,
  file save/export, background tasks, and online/offline status. The web
  implementation uses IndexedDB/OPFS and browser APIs; a Tauri implementation later
  swaps in SQLite, native notifications, tray, and filesystem access. **Components and
  managers never call `localStorage`, `Notification`, `showSaveFilePicker`, etc.
  directly** — only through the adapter. (`src/lib/preferences.ts` currently uses
  `localStorage` directly and should move behind the adapter when it's built.)
- **Local-first data cache.** Fetched data lands in a local store that widgets read
  from. Benefits the web build immediately (fast reloads, analysis Collections,
  offline tolerance) and becomes a larger on-disk store under Tauri.
- **No server runtime, no origin assumptions** (already true — plain Vite SPA). See
  "Authentication" below for the one origin-sensitive piece.
- **Cross-origin isolation is page-scoped, not global.** Some candidate analysis
  tooling (e.g. JupyterLite's SharedArrayBuffer file access) benefits from COOP/COEP headers,
  which break cross-origin resources (map tiles, API) that don't opt in. Never enable
  isolation app-wide; if needed, confine it to a dedicated page/window (Tauri can set
  headers per window). See Open Question #6 in `IDEA.md`.

When to actually add Tauri: once there's a concrete desktop-only win (most likely
background alerting from the tray, or large offline datasets for researchers). Before
committing, run a short WebKitGTK spike with the map widget to confirm Linux desktop is
viable. See `ROADMAP.md`.

## Authentication

`@sjvair/sdk` supports two auth modes, and which one applies depends on **where this
app is running**, not on a user choice:

| Deployment context                                 | Auth mode                                     |
| -------------------------------------------------- | --------------------------------------------- |
| Embedded in sjvair.com (served from its origin)    | Django **session cookie** (same-origin)       |
| Standalone on a different origin, or Tauri desktop | **`Authorization: Token <api_token>`** header |
| (Reference: `../v3-mobile`, the mobile app)        | Token header                                  |

How the SDK does it: `account/login` returns `UserDetails` including `api_token`;
authenticated calls (e.g. `account/subscriptions`) take an optional `apiToken` — when
passed, a `Token` header is sent; when omitted, the request relies on the browser
sending the same-origin session cookie. Consequences:

- Cookies **only work same-origin**. A standalone deployment (e.g. a separate
  subdomain) or a Tauri window (`tauri://`/`http://tauri.localhost` origin) must use
  tokens.
- Auth mode is a **platform-adapter concern**: the adapter exposes "how to
  authenticate" (cookie vs. token + where the token is stored), and data managers pass
  `apiToken` (or not) accordingly. No component decides this itself.
- Token storage must go through the adapter too (browser storage on web, OS keychain /
  secure store under Tauri).

## Accounts & anonymous use

Decided 2026-09-24. Uses the existing **sjvair.com accounts** (register, login,
password reset, phone verification — all wrapped by `@sjvair/sdk` `account/*`); no new
auth system. See "Authentication" for cookie vs token.

**Everything works anonymously except what needs the server to act or persist for
you:**

| Anonymous (local via platform adapter)                 | Requires an account                        |
| ------------------------------------------------------ | ------------------------------------------ |
| Dashboards, widgets, Widget Creation                   | Automated alerts (SMS/email) + alert inbox |
| Collections, analyses, notebook export, JupyterLite    | Server-backed documents & live share links |
| Self-monitoring (client-side thresholds/notifications) | Cross-device sync                          |
| File / URL sharing (fork on open)                      |                                            |

- **Sign-in is lazy/contextual** — prompted only when needed (e.g. inside the "Create
  alert" flow), never as a gate on first load.
- **Local → account migration:** once server-backed documents exist, first sign-in offers
  to upload local dashboards/Collections/analyses.
- **No teacher/class/org accounts**; teachers share via links.
- **Shared computers:** the **browser profile is the boundary** (as for any website;
  managed Chromebooks usually give each student their own profile). Provide a visible
  **"Clear my data"** action, and sign-in **without "remember me"** keeps the token
  session-only (through the platform adapter). A dedicated guest mode is deferred.

## Data resolution & live refresh

Decided 2026-09-24. Implemented once in the data layer / local-first cache, not per
widget.

**Automatic resolution by range span** (bounds fetch size):

| Range span | Resolution        |
| ---------- | ----------------- |
| ≤ 2 days   | Raw entries       |
| ≤ ~60 days | Hourly summaries  |
| ≤ ~2 years | Daily summaries   |
| longer     | Monthly summaries |

- **Incomplete periods are stitched from finer data** — e.g. the current month (no
  monthly rollup until it ends) is computed from daily summaries so far, today from
  hourly. Fixes the "current month shows nothing" problem for every widget.
- Advanced **resolution override** in Widget Creation; data table and exports show the
  resolution used.
- Long raw exports (notebook bundles, CSV) use the monthly **CSV archive** endpoint.

**Live refresh:**

- Only widgets whose date range **includes now** refresh.
- Cadence follows data cadence: raw/current-conditions every 2–5 min; hourly summaries
  hourly, scheduled a few minutes after the server's :50 region-summary task; daily
  after midnight plus hourly for today's partial value.
- **One poll per descriptor**, shared across widgets via the cache; **pause while the
  browser tab is hidden**; back off on errors.
- **Minimized widgets refresh only if they have thresholds configured** — so their
  taskbar entry can flash when a threshold is crossed (self-monitoring). Minimized
  widgets without thresholds don't poll.
- **Caching:** closed periods are immutable → cached indefinitely; open periods get a
  TTL. Server summary endpoints should send HTTP cache headers (follow-up).
- In-flight requests are superseded by newer ones for the same widget
  (last-requested wins, not last-to-finish).

## Routing, URL state & undo

Decided 2026-09-24. Supersedes the v1 "URL is the source of truth" rule (see "Legacy:
v1 tab model") for the dashboard direction.

**The URL identifies _where you are_; the saved document holds _what's there_.** A
dashboard's layout and widget configs are far too large for a URL and are now saved
documents (see "Saving & sharing documents").

```
/                                     last-opened dashboard (preference) or a starter
/d/:dashboardId                       a dashboard
/d/:dashboardId/w/:widgetId           that widget fullscreen (deep-linkable)
/d/:dashboardId/w/new?type=map        Widget Creation for a new widget
/d/:dashboardId/w/:widgetId/edit      Widget Creation editing an existing widget
/analysis/:collectionId               a Collection in the Analysis view
/analysis/:collectionId/a/:analysisId an analysis run on it
/import#<lz-compressed document>      URL-fragment share → opens a copy (fork on open)
```

- **Back/forward navigates between places** (dashboards, fullscreen, Widget Creation,
  Analysis) — never between edits.
- **Ephemeral UI state stays out of the URL** (open accordions, in-progress map
  selection, calendar drag range).
- **Local IDs are device-local:** opening `/d/:id` for a document not on this device
  shows "This dashboard is saved on another device" with a pointer to **Share**
  (URL-fragment/file now; server-backed live links later work anywhere).
- **Embedding:** same routes, held in memory when the host owns the URL (see
  "Embedding").
- Carried forward from v1: `url-state.ts`'s date-range codec (reused for serializing
  query descriptors); preference seeding becomes "last-opened dashboard" + Widget
  Creation defaults.

**Undo/redo (first release).** A **document-level undo/redo stack** (Ctrl+Z /
Ctrl+Shift+Z, plus menu actions via the shared action list), separate from browser
history. All edits to dashboards, Collections, and analyses go through a single
**`applyChange(doc, change)`** function producing a new document version plus an
inverse change — so undo is free by construction and edits are testable. Covers move,
resize, minimize/restore, add/delete/configure widget, rename, and Collection edits.
The stack is per document and per session (not persisted).

## Widget data selection (partial datasets)

Decided 2026-09-23 (IDEA.md Open Question #2).

**What gets staged is a query descriptor, not copied data.** This is the **single
definition** used by Collections, saved documents, and export manifests. A widget's
config is **one shared date range plus a list of layers** (see "Widget Creation view"),
and each layer resolves to one descriptor:

```ts
type QueryDescriptor = {
	dataset: string; // from the meta/datasets/ catalog
	entryType?: string; // pollutant/entry type where applicable
	dateRange: DateRangeSpec; // set / rolling / custom (see "Widget Creation view")
	timeSubRange?: { start: string; end: string }; // e.g. calendar day-range selection
	selection?: SpatialSelection; // omitted = whole layer
};

type WidgetDataConfig = {
	dateRange?: DateRangeSpec; // absent for time: "now" | "none" widget types
	target?: PlaceRef; // monitor/region/location for "now" widgets
	layers: Array<Omit<QueryDescriptor, "dateRange" | "timeSubRange">>; // ≤ 1 pollutant layer
};
```

"Mark for analysis" on a multi-layer widget adds **one Collection item per layer**, each
with the widget's date range and any current time sub-range or selection.

"Whole widget" is simply the no-selection case,
so partial and all-or-nothing selection are the same mechanism. Descriptors are cheap
to stage, shareable, and reproducible. (These are the items held in analysis
Collections — see "Analysis: Collections & engine".)

**Map widgets select spatially only.** Time is fixed per widget by its single date
range; narrowing _when_ is done via calendar/chart widgets, not a map time scrubber.

One selection model, three ways to produce it:

```ts
type SpatialSelection = {
	kind: "monitors" | "regions";
	ids: string[];
	source?: GeoJSON.Geometry; // present when produced by a drawn shape
};
```

- **A. Feature picking** — click a monitor/region to select, shift-click to add;
  selection shows as removable chips in the widget title bar; right-click a feature
  for feature-scoped context-menu entries ("Analyze this monitor").
- **B. Region picking** — reuse the existing multi-region selector (region hierarchy,
  boundaries, tooltips). Preferred basis for analysis: regions are stable, meaningful
  units the server already aggregates (`RegionSummary`) and are the natural
  crosswalk to other geographies (health, pesticide data).
- **C. Drawn shapes** — box, lasso, radius-from-point, via `terra-draw` (MIT). The
  shape is **resolved to IDs at selection time**: monitors inside the shape are
  included; regions are included only if their centroid falls inside. The raw
  geometry is kept in `source` so it can be redisplayed and re-resolved later (e.g.
  when new monitors come online). Users can prune the resulting chips.

Build order: A and B first (cheap, share state with the existing region selector); C
later. Drawing tools belong in `@sjvair/monitor-map` as an **opt-in plugin, off by
default**, so sjvair.com's map and the mobile app are unaffected (see Open Question #3).

## Map SDK: instance-scoped core + plugins (`@sjvair/monitor-map` 4.0)

Decided 2026-09-23 (IDEA.md Open Question #3). **Clean break as a 4.0 major**, with
all current consumers migrated as part of the same effort (no long-lived compat shim).

**The core problem is that the SDK assumes one map per page**, not a lack of
configurability. As of 3.6.x: `mapManager` (one `map`), `integrationsManager`, and
`clickManager` are module-level singletons; integrations are exported singleton
instances (`export const monitorsMapIntegration = new MonitorsMapIntegration()`) that
talk to `mapManager.map`; `MaptilerConfig.apiKey` is set from `import.meta.env` at
import time. A dashboard with two map widgets would share all of that state.

4.0 design:

- **Per-map instance.** `createMap(options)` returns a `MapContext` (own map, plugin
  registry, click manager, tooltips), provided to descendants via Svelte context.
  Nothing module-global.
- **Plugins are factories.** e.g. `monitorsPlugin({ dataSource, entryType })`,
  evolving the existing `MapLayerIntegration`/`MapGeoJSONIntegration`/
  `MapIconLayerIntegration` classes:

  ```ts
  interface MapPlugin {
  	id: string;
  	setup(ctx: MapContext): () => void; // add sources/layers; returns teardown
  	legend?: Snippet;
  	displayOptions?: Snippet; // UI slots the host shell renders
  	contextMenu?(target: unknown): MenuItem[]; // hooks into context-menu registry (Q5)
  	toSelection?(features: MapGeoJSONFeature[]): SpatialSelection; // Q2 selection model
  }
  ```

- **One plugin per data type, each taking a data-source interface** (generalizing
  what `MonitorsDataSource` already does): monitors, region fill/choropleth, HMS
  smoke, HMS fire, collocation, EV stations, wind, weather, and the `terra-draw`
  drawing plugin (Q2, opt-in). Plugins for the remaining server datasets — pesticide
  use/notices, CalEnviroScreen tracts, CalHeatScore ZIPs, forecast zones, CEIDARS
  facilities, TEMPO rasters — are deferred (see `DEFERRED.md` → "Map plugins"), but
  the plugin interface must accommodate points, polygons, choropleths, and rasters so
  they're additive. The same renderer serves live data
  (sjvair.com, mobile) and historical/date-ranged data (this dashboard). New data
  types become new plugins, not edits to a monolith.
- **Two shells.** `MapShell` stays as the full-page layout (load screen, routed detail
  panel, router escape hatch). A lighter `MapView` (no routing, no load screen) is what
  dashboard widgets use.
- **Config is injected**, not read from `import.meta.env` at import (MapTiler key etc.).
- **WebGL context budget.** Browsers cap live WebGL contexts per page (~8–16); each
  map is one. Minimized/off-screen map widgets must tear down their map and rebuild on
  restore (affects dashboard layout, Q4).

**Consumers to migrate in the same effort** (each needs its own approved plan):
`sjvair.com` (templates `pages/app.html`/`index.html`) and `v3-mobile` (the mobile
app). The major version bump protects anything unmigrated from pulling 4.0
by accident.

## Dashboard layout mechanics

Decided 2026-09-23 (IDEA.md Open Question #4).

- **Snapping grid, no overlap.** Widgets snap to grid cells when dragged/resized; other
  widgets move out of the way (collision + upward compaction/"gravity"). No free-form
  overlapping windows. The desktop-windowing feel comes from the chrome — title bar,
  minimize, fullscreen, taskbar — not from overlap.
- **Pure layout engine, CSS Grid rendering.** Collision/compaction/placement are pure
  TypeScript functions, unit-tested like `url-state.ts`. Widgets render via CSS Grid
  `grid-column`/`grid-row`; drag by the title bar, **resize via edge/corner hover
  handles** (resize cursors), all via pointer events. Chosen over `gridstack.js`,
  which owns DOM positioning and fights Svelte's rendering; the core algorithm is
  small enough to own.
- **Fullscreen** overlays the dashboard area (not the browser window), animated from
  the widget's grid rect (FLIP-style); the underlying grid layout is untouched.
- **Minimize** moves the widget to the bottom taskbar (horizontally scrolling when
  overloaded) and the grid compacts. Restore returns it to its previous rect if free,
  else the nearest free slot. Minimized/off-screen map widgets release their WebGL
  context (see "Map SDK").
- **Vertical growth/scrolling.** The dashboard grows downward as widgets are added —
  not horizontally. Reasons: mouse wheels scroll vertically (shift+wheel is obscure,
  school machines mostly use mice); the taskbar is already a horizontal scroller;
  phones stack vertically; every familiar dashboard product scrolls down. To avoid
  wheel conflicts, map widgets use MapLibre's `cooperativeGestures` (ctrl/⌘+scroll
  zooms the map; plain scroll scrolls the page). "Too crowded" is answered by
  **multiple saved dashboards**, not a bigger canvas.
- **Responsive.** 12 columns on desktop, fewer on tablet; on phones, a single-column
  stack auto-derived from the desktop layout's reading order. Only the desktop layout
  is persisted in a saved dashboard config.

## Widget catalog

Decided 2026-09-23 (IDEA.md Open Question #8). All charts use uPlot. "SDK+" = needs a new
`@sjvair/sdk` wrapper for an existing server endpoint.

**First release:**

| Widget                    | What it shows                                                                                          | Notes                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Map                       | monitor-map 4.0 `MapView` + plugins; spatial selection (feature/region, later drawn)                   | See "Map SDK"                  |
| Calendar — day-colored    | Each day colored by its average; day-range selection                                                   | Existing Monitors-tab calendar |
| Calendar — contribution   | GitHub-style grid with adjustable range (≥ 1 week); day-range selection                                |                                |
| Chart                     | uPlot time series for one pollutant/dataset over the widget's date range                               |                                |
| Current conditions tile   | Big current value, level color, trend arrow, "updated N min ago", level guidance from `monitors/meta/` | Monitor or region              |
| "Can we go outside?" card | Plain-language outdoor-activity recommendation from current level + guidance + today's CalHeatScore    | Schools; SDK+ (CalHeatScore)   |
| Forecast strip            | Next days' AQI category + burn-day status                                                              | SDK+ (forecasts)               |
| Alerts feed               | Recently fired alerts from the user's alert inbox (pollutant, forecast, pesticide-notice rules)        | Requires login                 |
| Data table                | Sortable table + CSV export; the accessibility fallback for maps/charts                                |                                |
| Notes                     | Markdown text for annotating shared dashboards                                                         | No data source                 |
| Hour × weekday heatmap    | Diurnal/weekly pattern (widget form of starter analysis #2)                                            |                                |

The remaining brainstormed widgets are tracked in `DEFERRED.md` → "Widgets".

### Widget-type contract

Each widget type declares what Widget Creation shows and how the dashboard treats it:

```ts
type WidgetType = {
	type: string;
	label: MessageKey; // i18n: message key, never literal English
	minSize: { w: number; h: number }; // grid cells
	time: "range" | "now" | "none"; // the date section is shown only for "range"
	accepts: DatasetFilter; // which accordions/layers apply (enforces ≤ 1 pollutant)
	target?: "place"; // needs a monitor/region/location instead of layers
	thresholds: boolean; // supports self-monitoring thresholds
	defaultTitle(config: WidgetDataConfig, meta: Metadata): string; // generated, not stored
	menu: MenuProvider; // widget-scoped actions (see "Actions & context menu")
	component: Component;
};
```

Examples: **Notes** is `time: "none"` with no layers. **Current conditions**, **Forecast
strip**, and **"Can we go outside?"** are `time: "now"` with `target: "place"`; for those,
Widget Creation hides the date section and shows a place picker instead of the dataset
accordions. **Map** and **Chart** are `time: "range"` and accept multiple layers.

## Actions & context menu

Decided 2026-09-23 (IDEA.md Open Question #5). **The right-click menu is one view onto
a shared, scoped action list.** The same actions also populate each widget's title-bar
"⋯" menu, and later a Ctrl+K command palette and keyboard shortcuts — so every action
is reachable without right-clicking (discoverability, keyboard users, accessibility).

```ts
type MenuItem = {
	id: string;
	label: string;
	icon?: Component;
	shortcut?: string;
	group: string; // rendered as separated sections
	disabled?: boolean;
	children?: MenuItem[]; // nesting / submenus
	run(ctx: MenuContext): void;
};
type MenuContext = { event?: Event; target: Element; payload: Record<string, unknown> };
type MenuProvider = (ctx: MenuContext) => MenuItem[];
```

- **Scopes register providers** via a `menuScope(provider)` Svelte attachment, stored
  in a `WeakMap<Element, MenuProvider>` and removed on teardown (no leaks).
- **Resolution walks DOM ancestry** from the event target (`parentElement` chain,
  O(depth)), calling each scope's provider.
- **Scopes enrich the payload before resolution.** Canvas-based widgets can't be
  resolved by DOM ancestry alone: a map widget resolves the feature under the cursor
  (`queryRenderedFeatures`) and adds `{ feature }`; the calendar adds
  `{ selectedRange }`; a uPlot chart adds `{ point }`. That's how "Analyze this monitor"
  or "Analyze selected days" appear only when meaningful. Map plugins contribute
  feature-scoped items through `MapPlugin.contextMenu` (see "Map SDK").
- **Merge order: most specific first** — feature → widget → dashboard → global,
  grouped with separators. An inner item with the same `id` overrides the outer one.
- **Rendered with bits-ui's `ContextMenu`** (shadcn-svelte `context-menu`): one
  trigger around the dashboard, items computed on open. Provides submenus, keyboard
  navigation, ARIA roles, and viewport collision handling. Opens via right-click,
  long-press (touch), and Shift+F10 / Menu key (focused element).
- **Reuse:** the widget "⋯" menu calls the same resolution with that widget as target;
  the future command palette queries global + focused-scope actions.

Prior art reviewed: `monitor-inventory-tracker`'s `ContextMenu.svelte`. Kept its core
idea (attachment-registered, ancestry-scoped contributions); dropped Snippet-based
items (not mergeable/testable/reusable), missing cleanup, module-global state,
hand-rolled positioning, and the debounce workaround.

## Analysis: Collections & engine

Decided 2026-09-23 (IDEA.md Open Question #6, staging + engine parts). Data available
to analyze is catalogued in `docs/reference/server-data-inventory.md`.

### Terminology

- **Collection** — a named set of staged **data inputs** (query descriptors). "Mark for
  analysis" adds to a Collection. Collections hold data references, never analyses.
  (Earlier drafts called this the "pool"; use _Collection_ in UI and code.)
- **Analysis** — a saved **recipe** (`AnalysisSpec`) that runs over items from a
  Collection. One Collection can feed many analyses; one analysis can run against
  different Collections.

### Collections

```ts
type CollectionItem = {
	id: string;
	descriptor: QueryDescriptor; // dataset, entry_type, date range, SpatialSelection, optional time sub-range
	label: string;
	origin?: { dashboardId: string; widgetId: string }; // provenance only
	addedAt: string;
};
type Collection = { id: string; name: string; items: CollectionItem[] };
```

- **Multiple named Collections, independent of dashboards.** Analysis routinely spans
  dashboards, and because items are descriptors (not live widget references), a
  Collection survives its source widget/dashboard being edited or deleted.
- **Provenance, not ownership:** `origin` lets the Collection drawer show "from
  _Dashboard → Widget_" and offer "jump back" while that widget exists; if it's gone,
  the item still works.
- **Targeting:** one Collection is **active** (shown in the nav badge, e.g.
  "Analysis · Smoke study · 3"). Each dashboard may set a **default target
  Collection**. "Mark for analysis" adds to the dashboard's default, else the active
  one; the **Add to collection ▸** submenu (existing Collections + "New collection…")
  targets explicitly; "Analyze" adds and navigates to the Analysis view.
- **Lazy data:** staging stores only the descriptor. Data is fetched when an analysis
  runs, through the local-first cache keyed by descriptor (reusing what widgets
  already fetched).
- Persisted via the platform adapter (IndexedDB on web).
- **Ships in Release 1** (decided 2026-09-24), ahead of the analysis engine: the store,
  the drawer, "Mark for analysis" / "Analyze" / "Add to collection ▸" on every widget,
  and a placeholder Analysis view listing a Collection's items with "starter analyses
  coming soon" until Release 3. That way IDEA.md's shared widget behavior is complete
  from the first release.

### Engine: generic core, curated starters as specs

A generic date-aligned comparison engine, seeded with curated starter analyses —
where **a starter is just a saved `AnalysisSpec`**, identical in format to a
user-defined one:

```ts
type AnalysisSpec = {
	inputs: Record<string, { role: string; accepts: DescriptorFilter }>; // bound to Collection items
	steps: Step[]; // resample → align → lag → aggregate → correlate …
	views: ViewSpec[]; // uPlot charts, tables, stat tiles
	notes?: string; // caveats shown with results
};
```

- **User-defined analyses** = editing a starter or composing from scratch. Applying a
  spec to a Collection prompts the user to bind items to its input roles.
- **Save/share** uses the same JSON-document mechanism as dashboards and Collections.
- **Known cross-dataset pitfalls are first-class steps**, not per-analysis hacks:
  resolution mismatch → explicit resample step with a stated aggregation; geography
  mismatch → region crosswalk (regions from "Widget data selection"); lag effects →
  lag step with a slider; spurious correlation → confidence intervals and a
  "correlation ≠ causation" note shown by default.
- **Compute:** plain TypeScript over typed arrays (uPlot's native format) in a Web
  Worker. Heavier WASM engines (e.g. DuckDB-WASM) deferred until researcher-scale
  datasets demand them; Tauri's native storage is the other lever there.

### Health data scope

Decided 2026-09-23: **CalEnviroScreen only** (static tract-level indicators, e.g. asthma
/ CVD / low-birth-weight percentiles, SB535 DAC). The server holds no ER, hospitalization,
or incidence data; importing outside health data (HCAI ED visits, CDC PLACES) and the
"smoke → ER visits" lag analysis are deferred — see `DEFERRED.md`.

### Starter analyses

Confirmed 2026-09-23: **all 10 ship as starters.** #7 and #8 depend on new `@sjvair/sdk`
wrappers (CalEnviroScreen, CalHeatScore) — a sdk-js change needing its own approved plan.

"SDK+" = the server serves the data but `@sjvair/sdk` must wrap the endpoint first.

| #   | Analysis                                                                       | Data                         | Audience            | Status                        |
| --- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------- | ----------------------------- |
| 1   | Bad-air days: days per AQ level by region, month/season/year, year-over-year   | Region summaries             | Everyone            | Ready                         |
| 2   | When is air cleanest: hour-of-day × weekday heatmap                            | Hourly summaries             | Schools, community  | Ready                         |
| 3   | Smoke days vs PM2.5: share of PM2.5 excess on HMS smoke days, by density       | HMS smoke + region summaries | Everyone            | Ready                         |
| 4   | Fire → air-quality lag: daily FRP near region vs PM2.5, 0–7 day lag slider     | HMS fire + summaries         | Research            | Ready                         |
| 5   | Weather drivers: PM2.5/O₃ vs CIMIS temperature, wind, humidity                 | Entries + CIMIS              | Research, science   | Ready (nearest-station match) |
| 6   | Long-term trend: monthly/yearly means, Theil–Sen slope + Mann–Kendall          | Summaries                    | Research, community | Ready                         |
| 7   | Environmental-justice lens: tract PM2.5 vs CalEnviroScreen indicators          | Tract region summaries + CES | Research, advocates | SDK+ (CES); monitored tracts  |
| 8   | Heat + AQ compound days: CalHeatScore and PM2.5/O₃ both elevated               | CalHeatScore + summaries     | Schools             | SDK+                          |
| 9   | Pesticide use trends: lbs by chemical/commodity/region, category filters       | PUR region summaries         | Community, research | Ready (yearly only)           |
| 10  | Low-cost sensor vs reference: scatter, bias, R² over time for collocated pairs | Collocation + entries        | Research / QA       | Ready                         |

## Notebooks

Decided 2026-09-23 (IDEA.md Open Question #6, Jupyter part). Research:
`docs/reference/jupyterlite-kernels.md`. Licensing is not a blocker (JupyterLite/
JupyterLab BSD-3, Pyodide MPL-2.0 used unmodified — ship license notices).

Notebooks are a **separate power-user path that shares the data layer, not the engine**:
Collections/descriptors are shared; the TypeScript engine and uPlot views are not.

### Export to notebook (all languages)

An "Export to notebook" action on a Collection or analysis downloads a `.zip` bundle:

- `analysis.ipynb` (Python), `analysis-r.ipynb` (R), `analysis-ts.ipynb` (Deno /
  TypeScript) — data-loading cell + the analysis steps written out where practical.
  Generation priority: Python → R → Deno/TS.
- Data as **Parquet + CSV**, and a `collection.json` manifest (descriptors, units, AQ
  levels) so any kernel can load it and live data can be re-fetched.
- A short README: open in JupyterLab, RStudio, Deno's Jupyter kernel, or Google Colab.

This is **language-neutral**: loading needs no SJVAir-specific helper (a helper
package is an optional convenience). Deno's built-in Jupyter kernel gives JS/TS users
real TypeScript and can import `@sjvair/sdk` straight from JSR.

A web page cannot launch a local JupyterLab; that true "Open locally" (write bundle to
a folder, launch `jupyter lab` if installed) is a **Tauri** capability — see `DEFERRED.md`.

### Embedded JupyterLite (Python only)

So schools and community users can write code with **no install** (incl. Chromebooks):

- **Kernel: Pyodide** (`jupyterlite-pyodide-kernel`) — real CPython 3.14 with pandas,
  numpy, scipy, statsmodels, scikit-learn, matplotlib, pyarrow; seaborn/plotly bundled as
  wheels. **Python only**; in-browser R and JavaScript are deferred (see `DEFERRED.md`).
- **Fully bundled for offline**: self-hosted Pyodide, custom `pyodide-lock`, piplite
  wheels, `disablePyPIFallback: true`. Kernel and Pyodide versions upgraded in lockstep.
- **A separate static app** at its own path/subdomain, not inside dashboard pages
  (tens of MB). It is the **only** place cross-origin isolation (COOP/COEP) may be
  enabled, per "Platform strategy"; it also works without isolation (service-worker
  file access).
- **Opens the same export bundle** — "Open in browser notebook" loads the bundle's
  notebook + data into JupyterLite, so there is one bundle format for both paths.
- Known limits to document for users: no threads/multiprocessing, ~2–4 GB memory,
  no installing unbundled packages offline, slower pure-Python code.
- **Timing:** after Collections and the starter analyses exist.

## Saving & sharing documents

Decided 2026-09-23 (IDEA.md Open Question #6, save/share part).

**Dashboards, Collections, and analyses are all "documents"** sharing one mechanism:

```ts
type SavedDocument<K extends "dashboard" | "collection" | "analysis"> = {
	kind: K;
	schemaVersion: number;
	id: string;
	name: string;
	body: DocumentBody<K>;
};
```

- **Versioned from day one.** Every document carries `schemaVersion`; a pure, tested
  migration chain upgrades old documents on load. Shared links live for years.
- **References, not data.** Documents store query descriptors, never fetched data, so
  they stay small and a recipient sees the same _query_ run against current data.

**Storage (decided 2026-09-24: both layers ship in Release 1):**

1. **Local + files.** Documents persist through the platform adapter
   (IndexedDB on web, filesystem/SQLite under Tauri). Share by **Export/Import `.json`**,
   or for small documents a **link with the document lz-string-compressed into the URL
   fragment** (fragment → never sent to a server). If the encoded link exceeds a safe
   length, the UI falls back to file export.
2. **Server-backed, for signed-in users** (a parallel sjvair.com track in Release 1;
   needs an approved plan). A `SavedDocument` model (`owner, kind, name, body,
version, visibility: private | link | public, schemaVersion`) plus endpoints. Gives
   short links, live share links, cross-device access (which covers server-synced
   preferences), protection from browser storage eviction, and SJVAir-curated public
   templates.
   - **Local-first sync, kept simple:** documents always save locally first. For
     signed-in users the server copy is authoritative, and each save carries a
     `version`. On a conflict (the same document edited on two devices), the user
     picks "keep this version / use the other". No real-time co-editing.
   - **Local → account migration:** the first sign-in offers to upload the local
     documents.

**Saving model (decided 2026-09-24): autosave.** Every `applyChange` persists immediately
(debounced about 500 ms), with a small "Saved" indicator; undo covers mistakes. There is
no explicit Save. IDEA.md's example "Save Dashboard" menu action becomes **"Save as
copy…"** and **"Export…"**. The dashboard picker offers new (blank or from the starter
dashboard), duplicate, rename, and delete (with an undo toast).

**Local durability safeguards** (these matter most for anonymous users, whose documents
stay local):

- Request persistent storage (`navigator.storage.persist()`) on the first document
  create or edit.
- Show a quiet status ("Dashboards are stored in this browser") with a note when
  protection isn't granted. Safari always falls in this case: it evicts script-written
  storage after 7 days without a visit unless the site is installed to the home screen.
- When documents aren't protected, show a **backup nudge** after meaningful edits
  ("Download a backup", the `.json` export), plus a gentle "sign in to keep this safe
  everywhere".
- Surface quota and write errors clearly; keep the in-memory copy so nothing is lost
  silently.

**Share semantics:**

- **File / URL share → copy (fork on open).** Opening creates the recipient's own
  independent document.
- **Server share → live link.** Recipients see the owner's current version read-only,
  with **"Make a copy"** to edit their own. Fits teacher → class and SJVAir → public.

## Internationalization: English-only, translation-ready

Decided 2026-09-24. **Ship in English only**; no translations exist and there is no
timeline for them. But build so adding a language is _adding message files_, not a
retrofit. Context: sjvair.com declares `LANGUAGES` = en, es, tl (Filipino), hmn (Hmong)
and stores `User.language`, and server metadata strings are gettext-marked — but no
translation files exist and alerts ignore `User.language`. monitor-map and v3-mobile have
no i18n.

**Day-one practices (cheap now, expensive to retrofit):**

1. **All UI strings via Paraglide JS** (inlang; compiled message functions, works with
   plain Vite, type-checked, tree-shaken) with an **English-only** message file. No inline
   UI strings in components.
2. **No string-concatenated sentences.** One message with parameters (and plural
   variants) per sentence.
3. **One `format` module** for numbers, dates, durations, and units via `Intl`/`date-fns`
   with a locale parameter (always `en-US` for now). No ad-hoc formatting.
4. **Saved documents store meaning, not English.** Default widget titles are stored as
   auto (`title: null`) and generated at render from metadata; only user renames are
   stored as text.
5. **Built-in content uses message keys** — starter-analysis notes/caveats, widget-type
   names, action/menu labels. User-authored text (Notes widget, custom names) is stored
   verbatim.
6. **Alert text is rendered at send time** from the rule's data, never stored at rule
   creation — so `User.language` can apply later without a data migration.
7. **Server-sourced text stays server-sourced** (metadata rule), and the data layer has a
   single place that sends a language (`Accept-Language`), currently always `en`.
8. **Layouts tolerate longer text** (Spanish ≈ 20–30% longer): no fixed-width text
   containers sized for English.

Deferred until translations exist (see `DEFERRED.md`): language picker, translation
files, server `.po` files, per-language metadata caching, alerts in `User.language`,
Hmong formatting fallback, monitor-map / v3-mobile i18n. RTL support is not needed for
the declared languages.

## Metadata as source of truth

Decided 2026-09-23 (IDEA.md Open Question #7). Audit basis:
`docs/reference/server-data-inventory.md`.

**Rule:** anything describing data — labels, units, level breakpoints, colors, scales,
resolutions, coverage, attribution — comes from server metadata endpoints. Never
hardcode it in this app, `monitor-map`, or `sdk-js`. When a value is missing, add it to
server metadata rather than hardcoding "for now".

**Structure: per-domain meta + a catalog index.**

- Each domain owns a `…/meta/` endpoint (existing: `monitors/meta/`, `regions/meta/`;
  new: `hms/meta/`, `pesticides/meta/`, `calheatscore/meta/`, `forecasts/meta/`,
  `ces/meta/`, `ceidars/meta/`, `tempo/meta/` as needed).
- A top-level **`meta/datasets/`** catalog lists every dataset and links to its domain
  meta.
- **Coverage is separate** (it changes with the data); everything else is effectively
  static and long-cacheable.

**Gaps, in priority order:**

1. **Dataset catalog** — label, description, geography type, available resolutions,
   units, source attribution/license. Needed by the Widget Creation picker,
   `AnalysisSpec` input filters, export manifests.
2. **Coverage/availability** — first/last data date per dataset and per
   monitor/region × entry type; which summary resolutions are complete (monthly+
   rollups exist only after the period ends).
3. **Non-pollutant scales** — smoke density, fire FRP tiers, CalHeatScore, AQI 0–500,
   temperature thresholds, forecast categories/burn status (labels + colors). Currently
   hardcoded in `monitor-map` and server Sass.
4. **Alert metadata** — alertable entry types per monitor type, alert levels,
   evaluation windows (today only in server `ENTRY_CONFIG`).
5. **Region hierarchy** — nesting between region types, counts, which regions have
   summaries.
6. **Choice lists** — stage/processor labels + descriptions, pesticide categories/IARC.
7. **Display hints** — decimal precision, preferred chart type/scale per entry type.

**Available pollutants (decided 2026-09-24).** The code supports every entry type, but
SJVAir is only confident in some readings (PM2.5 and O3 today). A server-controlled
**available-pollutants list in metadata** (e.g. an `available_pollutants` list or
per-entry-type `available` flag on `monitors/meta/` — ideally admin-editable so changing
it needs no deploy) gates which pollutants the frontend offers in **widgets, analyses,
and alert rules**. Enabling NO2/SO2/CO later is a metadata change, not a code change. This
replaces the hardcoded `"pm25" | "o3"` in this repo. Priority: alongside gap #1.

**Cleanup to do alongside** (removing hardcoded duplicates once metadata covers them):
server breakpoints defined twice (`levels.py` + entry classes), legacy
`Subscription.LEVELS`, Sass AQ colors, `generate_group_map.py`; `monitor-map`'s
`colors.ts`, legend gradient, `150.5` fallback, hardcoded "µg/m³", smoke/fire colors;
this repo's `"pm25" | "o3"` restriction and `NO_VALUE_BORDER_COLOR`; stale `sdk-js`
`api-urls.md`.

## Tech stack

The existing stack stays (IDEA.md: "nothing is being ripped out"); tools are added as
needed. Plain Vite SPA — no SvelteKit, no server runtime — keeping embedding and a Tauri
wrap simple.

- **Current:** Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4,
  shadcn-svelte (bits-ui), `@lucide/svelte`, `date-fns`, `uplot`,
  `@sveltejs/enhanced-img`, `@sjvair/sdk`, `@sjvair/monitor-map`, Vitest.
- **Planned additions (decided):** Paraglide JS (i18n-ready messages), `lz-string`
  (URL-fragment sharing), `terra-draw` (drawn-shape selection, via a monitor-map
  plugin), JupyterLite + Pyodide (separate notebook app).

## Accessibility

Applies to all widgets and views.

- Every data widget has a non-visual fallback: the **Data table** widget serves chart/map
  data; maps and charts expose their data as summary text or link to a table view.
- Keyboard navigation and ARIA via shadcn-svelte / bits-ui primitives, not hand-rolled
  interactive elements (includes the context menu — Shift+F10 / Menu key).
- Standard loading/error states per widget (skeleton or spinner; inline error with retry).

## Embedding (production build)

Like `monitor-map`'s `MapShell`, this app's production build is intended to be
embeddable inside another host app/site, not only run standalone. This shapes several
decisions made along the way:

- **No SvelteKit, plain Vite SPA** — a pure static client with no server runtime to
  strip out, so the same build works standalone, embedded in a host page, and
  eventually wrapped by Tauri.
- **`sv-router` needs a host-safe escape hatch** — same problem `monitor-map` solved
  for `MapShell` with `routerEscapeHatch`/`basePath` (see its `CLAUDE.md`): a host
  page that already has its own router must be able to either mount this app under a
  sub-path (`basePath`) or disable this app's own history/URL manipulation entirely
  when the host is driving navigation. This is **not yet implemented** — `src/router.ts`
  currently assumes it owns top-level routing. Needs to be addressed before this app
  can actually be embedded (see `DEFERRED.md` → "Embeddable production build").
- **URL state vs. embedding** — decided in "Routing, URL state & undo": when the host
  owns the URL, the same routes are held in memory.

## Legacy: v1 tab model

The sections below describe the original tab-per-data-domain design that the Monitors
tab was built on. They remain accurate for the **current code** but are being superseded
by the dashboard/widget direction above; the useful parts (URL-state codecs, region
selector, calendar) carry forward into widgets. Tech stack and accessibility rules now
live in current sections above.

### Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

### Tab structure

One top-level tab per SDK data domain, routed via `sv-router`:

- **Monitors** (`/`) — entry_type filter (pm25/pm10/o3/etc., not a sub-tab), date
  range, client-side county filter (using the `county` field already present on
  `MonitorData` — no SDK changes needed). Map, chart, and spreadsheet views, all
  independently toggleable.
- **HMS Smoke/Fire** (`/hms`) — date range filter. Primarily map-centric (GeoJSON
  polygons); chart/spreadsheet toggles may be hidden or disabled for this tab.
- **Collocation Sites** (`/collocation-sites`) — not a date-range + multi-view tab
  like the others. A collocation "site" pairs a reference monitor with a collocated
  monitor, with no time-series data of its own. The flow is: list/map of pairs →
  select a pair → drill into a comparison view of both monitors' entries over a date
  range (reusing the Monitors tab's chart/spreadsheet views against two monitor IDs).

### State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1; server sync is
  subsumed by server-backed documents, see `DEFERRED.md`) holds only _defaults_: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no params present
  — not on every navigation. Once URL params exist, they win.
- **`src/lib/url-state.ts`** provides the pure, unit-tested serialization codecs
  (`encodeDateRange`/`decodeDateRange`, `encodeViews`/`decodeViews`) a tab uses to
  read/write its URL search params via `sv-router`'s `route.search`/`searchParams`.
- Each tab owns its own lightweight `*.svelte.ts` manager (mirroring `monitor-map`'s
  `monitorsManager` pattern): fetches from `@sjvair/sdk`, holds `$state`, derives
  view-ready data. These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s own managers, which are scoped to "all currently active
  monitors," not arbitrary historical date ranges.

### Views (v1 tabs)

Rendered as simultaneous split panes when more than one is toggled on (side-by-side
on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `@sjvair/monitor-map`'s `MapShell` plus the relevant integration(s) for
  that tab (e.g. the Monitors tab passes `[monitorsMapIntegration]`). `MapShell` must
  be used with `routerEscapeHatch={false}` since this app has its own `sv-router`
  navigation — see `monitor-map`'s `CLAUDE.md`.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart` module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export, preferring
  the SDK's existing CSV entries endpoint over re-serializing fetched JSON client-side
  where the endpoint's shape matches what's displayed.

### Out of scope

See `DEFERRED.md`.
