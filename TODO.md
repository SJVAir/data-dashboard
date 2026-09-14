# TODO / Current Status

Last updated: 2026-09-14

## Start here (next session)

Nothing is in progress — the last session ended cleanly with the scaffold merged and
the worktree/branch cleaned up. The next piece of work is the **Monitors tab**, and it
has **not been brainstormed yet** — do not jump straight to writing an implementation
plan for it. Start with `superpowers:brainstorming` (architectural path likely, given
it introduces new data-fetching/state-manager patterns) to work out:
- The tab's own `*.svelte.ts` manager design (fetching from `@sjvair/sdk`, holding
  `$state`, deriving map/chart/spreadsheet-ready data) — `ARCHITECTURE.md` describes
  the intent at a high level but not the concrete manager API.
- How `src/lib/preferences.ts` and `src/lib/url-state.ts` (already built, unit-tested,
  but **not yet wired into anything**) actually get consumed by this tab's date range,
  county filter, and view toggles.
- How `@sjvair/monitor-map`'s `MapShell` (published v3.3.0) gets embedded for the map
  view — remember it needs `routerEscapeHatch={false}` since this app has its own
  `sv-router`, per `monitor-map`'s `CLAUDE.md`.

Then follow the normal brainstorm → spec → plan → subagent-driven-development cycle
(see the two prior plans in `docs/superpowers/plans/` for the pattern this project uses).

## Done

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
