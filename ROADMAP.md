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

## Deferred past v1

These are explicitly out of scope until v1 (data exploration across the three tabs
above) ships:

- **Unified "Data Analysis" tab** — select multiple data sets for cross-comparison,
  using common data-science tooling (ideally WebAssembly-backed for heavy
  computation, using an existing WASM library rather than building one). Looks for
  trends and comparisons across data sets.
- **Server-side location/radius search** — the API doesn't yet support querying
  monitors by location/radius; each monitor does carry a `county` field today, which
  v1's Monitors tab uses for client-side filtering, but true geo search requires
  `sdk-js` (and likely server) changes.
- **Server-synced preferences** — v1's preferences store is localStorage-only; syncing
  them to a user's account on the server is a later feature.
- **Tauri desktop build** — the app is being built as a plain Vite SPA (no SvelteKit,
  no server runtime) specifically to keep this feasible later, with extended
  capabilities not practical or worth the cost in-browser.
- **Embeddable production build** — like `monitor-map`'s `MapShell`, this app is meant
  to eventually be embeddable inside another host app/site, not just run standalone.
  The SPA architecture is chosen partly to keep this feasible, but the actual escape
  hatch (`routerEscapeHatch`/`basePath`-style options for `src/router.ts`, plus a
  non-URL fallback for view state) isn't built yet — see `ARCHITECTURE.md`'s
  "Embedding" section. Revisit once v1's three tabs are in place.
