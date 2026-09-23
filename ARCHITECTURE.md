# Architecture

This document describes the design of the SJVAir data-exploration dashboard. It
reflects the decisions recorded in
`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`; consult that spec
for the full rationale behind each decision.

## Scope (v1)

Data exploration only: browse each data domain, filter by date range (and, where
applicable, county), and view the result as a map, chart, and/or spreadsheet.
Cross-dataset analysis, server-side location search, server-synced preferences, and
a Tauri desktop build are deliberately out of scope for v1 — see `ROADMAP.md`.

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

## Widget data selection (partial datasets)

Decided 2026-09-23 (IDEA.md Open Question #2).

**What gets staged is a query descriptor, not copied data**: dataset + entry_type +
date range + an optional spatial filter. "Whole widget" is simply the no-filter case,
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
  smoke, HMS fire, collocation, EV stations, wind, weather, later pesticides, and the
  `terra-draw` drawing plugin (Q2, opt-in). The same renderer serves live data
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
  `grid-column`/`grid-row`; drag/resize via pointer events. Chosen over `gridstack.js`,
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

**Storage, staged:**

1. **Local + files (first).** Documents persist through the platform adapter
   (IndexedDB on web, filesystem/SQLite under Tauri). Share by **Export/Import `.json`**,
   or for small documents a **link with the document lz-string-compressed into the URL
   fragment** (fragment → never sent to a server). If the encoded link exceeds a safe
   length, the UI falls back to file export.
2. **Server-backed (later; needs an approved sjvair.com plan).** A `SavedDocument`
   model (`owner, kind, name, body, visibility: private | link | public,
schemaVersion`) + endpoints: short links, cross-device access (subsumes server-synced
   preferences), SJVAir-curated public templates. See `DEFERRED.md`.

**Share semantics:**

- **File / URL share → copy (fork on open).** Opening creates the recipient's own
  independent document.
- **Server share → live link.** Recipients see the owner's current version read-only,
  with **"Make a copy"** to edit their own. Fits teacher → class and SJVAir → public.

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

**Cleanup to do alongside** (removing hardcoded duplicates once metadata covers them):
server breakpoints defined twice (`levels.py` + entry classes), legacy
`Subscription.LEVELS`, Sass AQ colors, `generate_group_map.py`; `monitor-map`'s
`colors.ts`, legend gradient, `150.5` fallback, hardcoded "µg/m³", smoke/fire colors;
this repo's `"pm25" | "o3"` restriction and `NO_VALUE_BORDER_COLOR`; stale `sdk-js`
`api-urls.md`.

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
  can actually be embedded (see `ROADMAP.md`).
- **URL-as-source-of-truth vs. embedding** — the state architecture below treats the
  URL as the source of truth for view state. When embedded with the escape hatch
  active, this needs a fallback (e.g. an in-memory store) since the host may not want
  this app touching the outer page's URL at all.

## Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

## Tech stack

Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4, shadcn-svelte (bits-ui),
`@lucide/svelte`, `date-fns`, `uplot`, `@sveltejs/enhanced-img`, `@sjvair/sdk`.

No SvelteKit — a plain Vite SPA, matching `monitor-map` and `v3-mobile`, and keeping
a future Tauri wrap simple (pure static client, no server runtime to strip out).

## Tab structure

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

## State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1, server-backed
  sync is a roadmap item) holds only _defaults_: last-used date range and view
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

## Views

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

## Accessibility

- Every view has a non-visual fallback: the spreadsheet view already serves as one
  for chart/map data; map and chart views should expose their underlying data as
  visible summary text or link to the spreadsheet view.
- Keyboard navigation and ARIA labeling via shadcn-svelte's primitives (bits-ui), not
  hand-rolled interactive elements.
- Standard per-view loading/error states (skeleton or spinner while fetching; inline
  error message with retry).

## Out of scope for v1

See `ROADMAP.md`.
