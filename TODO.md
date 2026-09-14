# TODO / Current Status

Last updated: 2026-09-14

## Done

- [x] Brainstormed and wrote the v1 design spec:
      `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`
- [x] **monitor-map modularization** — `MapShell` extracted as a configurable map-layout
      primitive; `MonitorMapLayout` is now a thin wrapper preserving existing behavior.
      Merged as SJVAir/monitor-map#101, released as `@sjvair/monitor-map@3.3.0`.
- [x] **Data dashboard scaffold** — Vite/Svelte app, tab-routing skeleton (Monitors/HMS/
      Collocation Sites, all placeholders), preferences store + URL-state codec
      utilities (unit-tested), and this set of project docs.
      Plan: `docs/superpowers/plans/2026-09-14-data-dashboard-scaffold.md`

## Next up

- [ ] **Monitors tab** — real content: entry_type filter, date range selector, client-side
      county filter, and map/chart/spreadsheet views wired to `@sjvair/sdk` and
      `@sjvair/monitor-map`'s `MapShell`. Needs its own brainstorm/spec/plan cycle
      before implementation (the existing v1 design spec covers requirements at a
      high level; the tab's own data-fetching/state-manager design still needs to be
      worked out in detail).
- [ ] **HMS Smoke/Fire tab**
- [ ] **Collocation Sites tab**

## Open questions / decisions to revisit

- Whether a spreadsheet view of raw HMS smoke/fire records is worth building for v1,
  or should stay map-only (noted as an open decision in the design spec).
- Exact home for the shared date-range helper currently only in `monitor-map`'s
  `data-chart/DateRange.ts` — extract to `@sjvair/sdk`'s `datetime` module, or a
  `monitor-map` export both projects consume? Decide when building the first tab that
  needs it.
- Visual/brand design (colors, typography beyond the inherited shadcn defaults,
  overall layout polish) is untouched so far — explicitly deferred per the original
  brief ("All initial design ideas are up for debate").
