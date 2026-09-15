# TODO / Current Status

Last updated: 2026-09-15

## Start here (next session)

**Mid-brainstorm on the Monitors tab.** All the cross-repo prerequisite plumbing is
now done and merged/released; what's left is the actual design work below, which
hasn't started yet — do that before writing the design spec.

Decided so far:

- **Map data comes from summaries, not live/per-entry data.** Stakeholders want the
  Monitors tab's map to plot each monitor's **average of the summary data
  (`getMonitorSummariesDaily`/etc.) over the selected date range**, not a live reading
  and not raw per-entry data. The tab is still controlled by a date range picker; that
  range picks which summary rows get averaged.
- **`@sjvair/sdk` v4.0.0** renamed the old no-arg `getMonitors()` to `getMonitorsList()`,
  folded `getMonitorsLatest(pollutant)` into `getMonitors(entryType, options?)` (which
  now also supports a historical `timestamp` via the new `/monitors/{entry_type}/at/`
  endpoint), and added `getMonitorSummariesHourly/Daily/Monthly/Quarterly/Seasonal/
Yearly` and `getMonitorEntriesExportCSVUrl/JSON`. See sdk-js's `CLAUDE.md`/
  `api-urls.md` for the full surface.
- **How the map reuses `monitor-map`'s rendering code:** `monitor-map`'s
  `MonitorsMapIntegration`/`MonitorShapeIconManager` used to hardcode the live,
  auto-polling `monitorsManager` singleton, which made them unusable for
  summary-derived data. Fixed upstream by having both accept an injected
  `MonitorsDataSource` (`{ meta, pollutant, latest, levels }`), defaulting to
  `monitorsManager` so existing consumers are unaffected. **This tab will implement its
  own `MonitorsDataSource`**: fetch `getMonitorsList()` once for the roster
  (county/position/type), fetch summaries per visible monitor for the selected range
  and entry type, average `.mean` across them, and pack the result into the `latest`
  shape the interface expects — then construct `new MonitorsMapIntegration(thisSource)`
  to get clustering/icon-coloring/filters/tooltips/click-handling for free.
- **All prerequisite work is merged, released, and installed** — see "Done" below.
  `@sjvair/monitor-map@^3.5.0` is now a dependency of this repo; nothing left to do
  upstream before starting the manager implementation.

Still open, to work out before writing the design spec:

- The tab's own `*.svelte.ts` manager design in full: how the per-monitor summary
  fetch-and-average work is triggered/cached/invalidated as the date range or entry
  type changes, and which summary resolution (`daily`/`monthly`/etc.) to request for a
  given range length (a week of `daily` summaries vs. a year of `monthly`, say).
- How the chart/spreadsheet views (also summary-driven, presumably, for consistency —
  not yet decided) relate to the map's per-monitor averages once a monitor is
  selected — do they show the same summary rows unaveraged (a time series), or drill
  into raw entries for the selected monitor?
- How `src/lib/preferences.ts` and `src/lib/url-state.ts` (already built, unit-tested,
  but **not yet wired into anything**) actually get consumed by this tab's date range,
  county filter, and view toggles.
- `MapShell`'s `routerEscapeHatch={false}` embedding is unaffected by any of the above
  — still needed since this app has its own `sv-router`, per `monitor-map`'s
  `CLAUDE.md`/`README.md`.

Then follow the normal brainstorm → spec → plan → subagent-driven-development cycle
(see the two prior plans in `docs/superpowers/plans/` for the pattern this project uses).

## Done

- [x] **`@sjvair/monitor-map` added as a dependency** (`^3.5.0`). Its `@tstk/*` jsr
      dependencies (`@tstk/builtin-extensions`, `@tstk/utils` — real runtime deps of
      `monitorsManager`/map-integration plumbing, not just types) are non-root/transitive
      from this repo's perspective, which this repo's `.npmrc` (`allow-remote=root`)
      blocks by design. Resolved by declaring both directly as root dependencies here
      too (pinned to the same ranges `monitor-map` uses) rather than loosening the
      policy to `allow-remote=all` project-wide.
- [x] **`@sjvair/sdk` upgraded to v4.0.0** in this repo's `package.json` (jsr-backed
      npm alias). No call sites in this repo used the renamed/removed functions yet,
      so this was a version-bump-only change.
- [x] **`monitor-map`: `MonitorsDataSource` decoupling + sdk v4 upgrade + full dependency
      update** — see "Start here" above for the `MonitorsDataSource` details. Merged via
      SJVAir/monitor-map#102 and #103 (stacked), plus a follow-up dependency sweep
      (every dep except TypeScript, notably `sv-router` peer range widened to `^0.19.0`
      and `@maptiler/weather` bumped to 4.0.1). Released as `@sjvair/monitor-map@3.4.0`
      then `3.5.0`.
- [x] **Vertical nav sidebar** — replaced the horizontal top-bar nav (`App.svelte`) with
      a vertical sidebar on desktop (`sm:` and up) and an off-canvas overlay drawer on
      mobile (shadcn-svelte `Sheet`, triggered by a hamburger button in a slim mobile
      top bar). Nav links extracted to `src/lib/components/AppNav.svelte`, shared by
      both. Also installed shadcn-svelte's `sheet`/`button` components for the first
      time, which required adding the standard `WithElementRef`/`WithoutChildrenOrChild`
      helper types to `src/lib/utils.ts` (missing since the scaffold predated any
      component install).
- [x] Brainstormed and wrote the v1 design spec:
      `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`
- [x] **monitor-map modularization** — `MapShell` extracted as a configurable map-layout
      primitive; `MonitorMapLayout` is now a thin wrapper preserving existing behavior.
      Merged as SJVAir/monitor-map#101, released as `@sjvair/monitor-map@3.3.0`.
- [x] **Data dashboard scaffold** — Vite/Svelte app, tab-routing skeleton (Monitors/HMS/
      Collocation Sites, all placeholders), preferences store + URL-state codec
      utilities (unit-tested), and this set of project docs. Merged as
      SJVAir/data-dashboard#1 into `main`.
      Plan: `docs/superpowers/plans/2026-09-14-data-dashboard-scaffold.md`

## Next up

- [ ] **Monitors tab** — real content: entry_type filter, date range selector, client-side
      county filter, and map/chart/spreadsheet views wired to `@sjvair/sdk` and
      `@sjvair/monitor-map`'s `MapShell`. Needs its own brainstorm/spec/plan cycle
      before implementation — see "Start here" above.
- [ ] **HMS Smoke/Fire tab**
- [ ] **Collocation Sites tab**

## Open questions / decisions to revisit

- **Deferred: icon-only collapse for the sidebar.** The vertical nav sidebar
  (`App.svelte`/`AppNav.svelte`) intentionally does not yet support collapsing to an
  icon-only rail on desktop — noted as future work once more tabs are added and the
  full-width labels stop being worth the horizontal space. The current split between
  the desktop sidebar and the mobile `Sheet` drawer was structured so this can be
  added later as a self-contained change (a collapsed/expanded `$state` toggle plus
  per-link icons) without restructuring the responsive layout itself.
- This app is meant to be embeddable in a host site/app the same way `monitor-map`'s
  `MapShell` is (plus a future Tauri desktop wrap — both now documented in
  `ARCHITECTURE.md`'s "Embedding" section and `ROADMAP.md`). The `sv-router`
  escape hatch (`routerEscapeHatch`/`basePath`-style options) this needs is not yet
  built — worth keeping in mind when designing each tab's state manager so URL-state
  wiring doesn't get too deeply hardcoded to owning the top-level route.

- Whether a spreadsheet view of raw HMS smoke/fire records is worth building for v1,
  or should stay map-only (noted as an open decision in the design spec).
- Exact home for the shared date-range helper currently only in `monitor-map`'s
  `data-chart/DateRange.ts` — extract to `@sjvair/sdk`'s `datetime` module, or a
  `monitor-map` export both projects consume? Decide when building the first tab that
  needs it.
- Visual/brand design (colors, typography beyond the inherited shadcn defaults,
  overall layout polish) is untouched so far — explicitly deferred per the original
  brief ("All initial design ideas are up for debate").
