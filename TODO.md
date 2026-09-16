# TODO / Current Status

Last updated: 2026-09-15

## Start here (next session)

**Monitors tab (map + calendar views) is implemented and in review.**
Implementation is on branch `worktree-monitors-tab`, open as
[SJVAir/data-dashboard#2](https://github.com/SJVAir/data-dashboard/pull/2), per
`docs/superpowers/plans/2026-09-15-monitors-tab.md` and the design spec
(`docs/superpowers/specs/2026-09-15-monitors-tab-design.md`). See those for the full
scope and decisions. **There is an open design question below that should be resolved
before doing more work on the map view.**

Shipped in this cycle:

- Date-range picker: two `<input type="date">` (Start/End) driving both map averages
  and calendar refresh together; wired to URL state and localStorage preferences.
  Span clamped to 5 years, reversed ranges normalized (see bug note below).
- County selector: shadcn-svelte `Select` filtering which monitors show on map and
  which county's data populates the calendar (calendar doesn't render until a county
  is selected).
- Map view: shows monitor locations, colors by PM2.5/O3 average over selected date
  range. Clustering/click-drill-down behavior is inherited from `monitor-map` and was
  not independently verified in this pass.
- Calendar view: color-coded day grid showing the selected county's daily `RegionSummary`
  averages (not a date picker — the date `<input>`s are the actual range picker). Lays
  out multiple months horizontally, wrapping as needed, and sizes to its content instead
  of stretching full-width. Always fetches at daily resolution regardless of range length
  (deliberate — see spec).
- State management: `MonitorsTabManager` fetches the monitor roster/meta/county list once
  and caches them in `init()`; per-monitor and per-region summaries are refetched from
  scratch on every filter change (date range, pollutant, or county) — no summary caching.

**Open design question (unresolved, paused here):** the map's per-monitor averaging
(`refreshMapAverages` in `src/routes/monitors/monitors-tab.svelte.ts`) picks daily vs.
monthly summary resolution based on a 45-day threshold
(`src/lib/monitors/summary-resolution.ts`). Testing against the local `sjvair.com` dev
backend found that **monthly (and coarser) summary rollups aren't populated there** —
only daily rollups have real data — so any date range over 45 days shows **no monitors
on the map** (empty averages). Also, "monthly" resolution doesn't even save a real
request-volume cost, since `getMonitorSummariesMonthly` without a `month` param fetches
the whole year anyway, same as `getMonitorSummariesDaily` without a `month` param — so
the resolution-switching buys little. Three options were on the table when the session
paused, no decision made:

1. Drop the resolution-switching and always fetch daily for the map too (matches the
   calendar's approach, simpler, removes the dependency on monthly-rollup availability).
2. Drop per-monitor color-coding entirely — map becomes a pure location reference (no
   values shown), calendar remains the only place pollution values are displayed. Would
   make `refreshMapAverages`, `summary-resolution.ts`, and `monitor-latest.ts` dead code.
3. Same as #2, but explicitly as a temporary simplification to revisit later rather than
   a final call.
   **Resolve this before touching `refreshMapAverages`/the map's data source again.**

Explicitly deferred to future work (per spec, or per final code review):

- Chart/spreadsheet views (noted as "TBD" in the design spec).
- Entry-type selector still restricted to PM2.5/O3 only (per design spec scope).
- HMS Smoke/Fire and Collocation Sites tabs.
- Whole-year over-fetch inefficiency (see open design question above — `month` param
  exists on both summary endpoints and isn't used to narrow requests).
- No in-flight request coordination — rapid filter changes can race, last-to-finish wins
  rather than last-requested.
- Preferences only persist date range, not pollutant; URL state is read once at mount,
  not reactive to browser back/forward within the tab.
- Type-check, build, and automated tests all pass (46 tests). Interactive visual browser
  verification was performed during implementation and again during manual testing after
  merge review; it caught the unbounded-date-range hang (fixed: span clamped to 5 years,
  reversed ranges normalized, defensive cap in `buildCalendarDays`) and the monthly-summary
  data-availability issue described above (not yet resolved).

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
      PM2.5/O3 average over selected date range; calendar view is a color-coded day grid
      of the selected county's daily `RegionSummary` averages (not a date picker). State
      management via `MonitorsTabManager`: the monitor roster, meta, and county list are
      fetched once and cached in `init()`; per-monitor and per-region summaries are
      refetched from scratch on every filter change (date range, pollutant, or county).
      Summary resolution policy (`src/lib/monitors/summary-resolution.ts`) is a single
      fixed 45-day threshold — ranges of 45 days or fewer use daily summaries, longer
      ranges use monthly. Wired to `@sjvair/sdk` and `@sjvair/monitor-map`'s `MapShell`
      with county filter and pollutant toggle; clustering/click-drill-down behavior is
      inherited from `monitor-map` and was not independently verified in this pass.
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
