# TODO / Current Status

Last updated: 2026-09-15

## Start here (next session)

**Monitors tab (map + calendar views) is shipped.** Implementation is complete per
`docs/superpowers/plans/2026-09-15-monitors-tab.md` and the corresponding design spec
(`docs/superpowers/specs/2026-09-15-monitors-tab-design.md`). See those for the full
scope and decisions.

Shipped in this cycle:

- Date-range picker: two `<input type="date">` (Start/End) driving both map averages
  and calendar refresh together; wired to URL state and localStorage preferences.
- County selector: shadcn-svelte `Select` filtering which monitors show on map and
  which county's data populates the calendar (calendar doesn't render until a county
  is selected).
- Map view: shows monitor locations, colors by PM2.5/O3 average over selected date
  range, clusters at zoom, supports click drill-down via `MapShell` + custom `MonitorsDataSource`.
- Calendar view: color-coded day grid showing the selected county's daily `RegionSummary`
  averages; reusable component wired to `manager.calendarDays` and `manager.refreshCalendar()`.
- State management: `MonitorsTabManager` with cached monitor summaries and region
  summaries, reactive updates for county/pollutant/date, resolution policy for summary
  fetch (weekly `daily`, yearly `monthly`, etc.).

Explicitly deferred to future work:

- Chart/spreadsheet views (noted as "TBD" in the design spec).
- Entry-type selector still restricted to PM2.5/O3 only (per design spec scope).
- HMS Smoke/Fire and Collocation Sites tabs.
- Type-check, build, and automated tests all pass; interactive visual browser
  verification was not completed during implementation — UI/UX validation is still
  outstanding and should be done before shipping.

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
- [x] **Monitors tab (map + calendar)** — map view showing monitor locations colored by
      PM2.5/O3 average over selected date range, calendar view for date selection, state
      management via `MonitorsTabManager` with cached summaries. Wired to `@sjvair/sdk`
      and `@sjvair/monitor-map`'s `MapShell` with county filter and pollutant toggle.
      Chart/spreadsheet views and HMS/Collocation tabs still deferred.
      Plan: `docs/superpowers/plans/2026-09-15-monitors-tab.md`
      Spec: `docs/superpowers/specs/2026-09-15-monitors-tab-design.md`

## Next up

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
