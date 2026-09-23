# Roadmap

## Plan sequence

1. ~~**monitor-map modularization**~~ — done. `MapShell`, a configurable map-layout
   primitive, published in `@sjvair/monitor-map` v3.3.0.
2. ~~**Data dashboard scaffold**~~ — done. App skeleton, tab routing, preferences/
   URL-state utilities, project docs. Merged as SJVAir/data-dashboard#1.
3. **Monitors tab** — entry_type/date/county filters, map/chart/spreadsheet views.
   **Not started — see TODO.md for where to pick this up.**
4. **HMS Smoke/Fire tab**.
5. **Collocation Sites tab**.

See `docs/superpowers/plans/` for each plan's full task breakdown, and `TODO.md` for
current status.

## Prerequisites for the dashboard direction (IDEA.md)

- **`@sjvair/monitor-map` 4.0** — instance-scoped maps + plugin system, required for
  multiple map widgets on one dashboard. Clean major-version break; sjvair.com
  and `v3-mobile` migrated in the same effort. See `ARCHITECTURE.md` →
  "Map SDK".

## Deferred work

All deferred and ruled-out items live in **`DEFERRED.md`**, the single register. Each
entry records why it was deferred and what should trigger revisiting it. Don't keep
separate deferred lists here or in specs.
