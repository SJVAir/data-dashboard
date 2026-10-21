# monitor-map upgrade to @sjvair/sdk 4.7.0 — design

Date: 2026-10-21. Repo changed: `../monitor-map` (`@sjvair/monitor-map`, currently 4.2.0 on
`main`). Target release: **4.3.0** (minor; nothing breaks). Merging to monitor-map `main` is
effectively a production deploy (sjvair.com builds `main` unpinned), and publishing to npm is
a release: **each needs the user's explicit approval at the time**, separately from approving
this design or its plan.

## Why

- **The CSRF rollout needs it.** The planned django-resticus fix will run Django's CSRF check
  on session-authenticated API writes (`ARCHITECTURE.md` → "CSRF protection"). monitor-map's
  subscribe button is the only cookie-based API write on sjvair.com today: `window.USER` has
  no `api_token`, so `MonitorSubscriptionManager` passes `""` and the request rides on the
  session cookie. @sjvair/sdk 4.7.0 adds `X-CSRFToken` automatically on same-origin browser
  writes, and monitor-map's production build sets the SDK origin to
  `window.location.origin` (`src/main.ts`), so its writes are same-origin. **Rollout order:**
  sdk-js 4.7.0 (released 2026-10-21) → this upgrade on monitor-map `main` → the resticus merge.
- **Wasted requests.** The user sees requests piling up when selecting different things
  quickly (monitors, pollutants, date ranges). Today stale replies are fetched in full and
  then dropped (`MonitorDetailsState`'s and `DataChart`'s request counters, `update()`'s
  pollutant check, the subscription load's `id !== monitorId` check). 4.7.0's `RequestOptions` (`{ signal, init }`) lets monitor-map
  cancel them.
- **Getting ready for later.** The map-sdk split (monitor-map 5.0) and the dashboard's
  "last requested wins" data layer both expect data stores that take an `AbortSignal`. The
  user chose to add that to the exported managers now, since it is additive.

## Goals

1. Depend on `@sjvair/sdk` `^4.7.0` (package.json and lockfile).
2. The subscribe button keeps working after the resticus fix, with no sjvair.com page change.
3. Every in-app selection that starts a fetch cancels the previous fetch it supersedes.
4. Exported managers' fetching methods accept an optional `{ signal }`.
5. A cancelled request is silent: no error state, no console output, no retry.

## Non-goals

- No `setRequestDefaults` call. That setting is page-global and monitor-map runs inside host
  apps (sjvair.com, the mobile app); global defaults are the host's to set. Per-call options
  only. *(Claude's call, stated to the user, not objected to.)*
- No cancelling for loads that happen once and aren't superseded by user selection, beyond
  accepting a caller's signal (HMS smoke/fire, collocation sites).
- No changes to sjvair.com, the mobile app, or the map-sdk split.
- No other SDK-related refactors (e.g. adopting new region types or wrappers).

## Anti-goals (a failure even if it technically works)

- Any behavior change for existing callers that pass no signal — in particular the mobile
  app's `monitorsManager.init(...)` and sjvair.com's embedded map.
- One caller cancelling `monitorsManager.init` breaks the load for another caller sharing it.
- Cancellations surfacing as "failed" states, error toasts, console errors, or reported errors.
- A breaking change to any exported type or signature.

## Constraints

- monitor-map is consumed by sjvair.com (unpinned `main`) and by the mobile app (`^4.2` via
  `/core` and `/routes`). The mobile app also depends on `@sjvair/sdk ^4.6.0` directly; 4.7.0
  satisfies it.
- Follow monitor-map's own `CLAUDE.md` (code style, bundle-size check `npm run test:bundle`,
  release workflow). Feature branch from `main`; never commit to `main` directly.
- `RequestOptions` is exported from `@sjvair/sdk/http`. Relevant 4.7.0 signatures: most
  fetchers take a final `options?: RequestOptions`; `getMonitors(pollutant, options?,
  requestOptions?)`; `getSubscriptions(apiToken?, options?)`;
  `subscribe(config, options?)` / `unsubscribe(config, options?)`. An aborted call rejects
  with the signal's reason (an `AbortError` `DOMException` from a plain `abort()`).

## Design

### 1. Dependency and the subscribe button

- Bump `@sjvair/sdk` to `npm:@jsr/sjvair__sdk@^4.7.0`; refresh the lockfile.
- `MonitorSubscriptionManager.svelte`: `getApiToken()` returns `undefined` instead of `""`
  when `window.USER.api_token` is missing or empty, so the intent ("no token, use the
  session") is explicit. The SDK adds `X-CSRFToken` from the `csrftoken` cookie on its own.
- Switching monitors cancels the in-flight `getSubscriptions` for the previous monitor
  (an `AbortController` per load, aborted by the `$effect` cleanup / next load). Subscribe and
  unsubscribe are user writes and are **not** cancelled.

### 2. Internal cancelling (supersede-on-new-selection)

| Where | Supersedes on | Replaces |
| --- | --- | --- |
| `MonitorDetailsState.load` / `refresh` (`monitors/monitor-details.svelte.ts`) | a new `load` or `refresh` | the `#request` counter's drop-late-reply logic (keep the counter if it stays simpler as a guard; the point is the request is aborted) |
| `fetchChartData` (`data-chart/requests.ts`) and `loadChartData` in `DataChart.svelte` | new monitor, date range, or pollutant | the `chartRequest` counter's drop-late-reply logic (same keep-or-replace choice) |
| `MonitorSubscriptionManager` subscription load | new `monitorId` | the `id !== monitorId` check |
| `monitorsManager.update` | a newer `update` (polling, pollutant change, `resumeAutoUpdate`) | the `this.pollutant !== pollutant` drop check |
| `monitorsManager.#runInit`'s pollutant catch-up loop | — (shares the run's controller; see §3) | — |

`fetchChartData` gains an optional `signal` and must **rethrow** an abort instead of its
current catch-all (which logs and returns `[]`); `DataChart` ignores the abort. Other failures
keep returning `[]`, so `loadChartData`'s `silent && data.length === 0` check is unchanged.

**What a superseded call returns** *(Claude's call, settled after the builder check)*: work
cancelled by monitor-map's own supersede **resolves quietly**, as today's dropped replies
do. Only an abort from the **caller's own signal** rejects. Signal-less callers (the
pollutant `$effect`, which has no `.catch`; `resumeAutoUpdate`'s `.catch(console.error)`;
the polling `Interval`) therefore never see a rejection or log anything. The implementation
must tell the two apart (check which signal is aborted, not just that the request was).

### 3. Exported managers accept `{ signal }`

Each gains an optional last argument `options?: { signal?: AbortSignal }` (a small local
type, or `Pick<RequestOptions, "signal">`):

- `monitorsManager.init(urlPollutant?, options?)` — extends the existing
  `MonitorsInitOptions` with `signal` (no new positional argument).
- `monitorsManager.update(options?)`
- `collocationSitesManager.init(options?)`, `.update(options?)`
- `hmsManager.init(options?)`, `.loadSmoke(options?)`, `.loadFire(options?)`
- `evStationsManager`'s fetching method(s): same `{ signal }`, passed to its plain `fetch`.

`resumeAutoUpdate()` and the pollutant `$effect` take no signal (nobody awaits them); they rely
on `update`'s internal supersede.

**Combining signals.** Where a method both supersedes internally and accepts a caller's
signal (`update`), the request is aborted by either: the internal controller or the caller's
signal (`AbortSignal.any` — supported in all monitor-map target browsers and the mobile
WebViews? **the builder must verify**, else a small manual combiner).

**`monitorsManager.init` — the shared run.** Overlapping `init` calls share one run today.
Rule (proposed by Claude, accepted by the user):

- A caller's signal cancels **only that caller's wait**: its returned promise rejects with
  the signal's reason; the run keeps going for everyone else, and its results still land in
  the manager's state.
- The run itself is aborted only when **every** caller currently waiting on it has aborted.
  Calls without a signal can never abort, so a run with any signal-less caller is never
  cancelled.
- An aborted caller's `urlPollutant` and `autoUpdate: true` **still count** for the run
  (the existing run-wide `#requestedPollutant` / `#requestedAutoUpdate` flags, no per-caller
  bookkeeping) *(Claude's call)*. A stray poll is harmless: `MonitorMapLayout` stops polling
  on destroy, and a host can call `autoUpdate.stop()`.
- An aborted run is forgotten exactly like a failed run today, so the next `init` starts
  fresh. `initialized` stays false; polling does not start.
- Already initialized: `init` resolves immediately as today (an already-aborted signal may
  reject immediately instead — builder's call, document it).

`hmsManager.init` and `collocationSitesManager.init` are not shared-run today; a caller's
signal simply aborts their requests. `collocationSitesManager.init` must leave `initialized`
false when aborted.

### 4. Silent cancellation

A shared helper (e.g. `isAbortError(error)`: `error instanceof DOMException && error.name ===
"AbortError"`, or the error is the signal's `reason`) is used at every catch site so an abort
never sets `"failed"`, never logs, and never leaves a loading flag stuck on. Internally
superseded work must also leave state consistent: the superseding request owns `loading` /
`status`.

### 5. Tests

Vitest, alongside the existing `tests/monitors/*` and `tests/data-chart/*`, mocking the SDK:

- monitor details: a second `load` aborts the first request's signal; the first's rejection
  doesn't change `status`.
- chart: a new range aborts the previous fetch; an abort is rethrown, not turned into `[]`.
- subscriptions: changing `monitorId` aborts the previous `getSubscriptions`; no token →
  `apiToken` is `undefined`.
- `monitorsManager.update`: a second update aborts the first; a caller signal aborts it.
- `monitorsManager.init`: one of two callers aborts → its promise rejects, the other resolves
  and state is set; both abort → the run's requests are aborted, `initialized` stays false,
  a later `init` succeeds; a signal-less caller keeps the run alive.
- collocation/HMS/EV: a passed signal reaches the request.
- No console output on abort (spy on `console.error`).
- Existing tests and `npm run test:bundle` still pass.

Manual check (dev, `npm run dev` against local podman sjvair.com): quick monitor/pollutant/
date switching shows cancelled requests in the network panel and no console errors. Note dev
points the SDK at `http://localhost:8000` (cross-origin), so the CSRF header is **not** sent
in dev; verifying the subscribe button under the resticus fix is part of the resticus /
sjvair.com plans, not this one.

**The `csrftoken` cookie on the map page** (checked after the builder check). The home
template never renders `{% csrf_token %}` or uses `ensure_csrf_cookie`, so the header relies
on the cookie already existing. It does for every signed-in user: sjvair.com keeps Django's
defaults (no `CSRF_*` / `SESSION_*` overrides in `camp/settings/`), the login form renders
`{% csrf_token %}`, Django rotates the cookie at login, and the cookie lasts a year against a
two-week session. Only someone who deletes that one cookie while staying signed in would
lose the header. The resticus rollout plan must include an end-to-end subscribe check
(signed in, under the fix). Adding `ensure_csrf_cookie` to the page is recorded in
`DEFERRED.md` as a fallback.

## Shipping

1. Feature branch from monitor-map `main`; PR into `main`.
2. Version bump to 4.3.0 and README notes for the new `{ signal }` options (monitor-map has
   no CHANGELOG; release notes go in the GitHub Release). The release notes say that a
   consumer which also depends on `@sjvair/sdk` directly must move it to `^4.7.0` at the same
   time. Otherwise npm may nest a second SDK copy under monitor-map, and that copy ignores the
   host's `setOrigin`.
3. **Merge to `main` — ask the user first** (production deploy via sjvair.com).
4. **Publish 4.3.0 (GitHub Release → npm) — ask the user first**, separately.
5. Then data-dashboard docs record it (TODO.md "Start here", ARCHITECTURE.md "CSRF
   protection" rollout order), and the resticus CSRF merge is unblocked.

## Mobile app

The mobile app depends on `@sjvair/sdk ^4.6.0` directly (4.6.0 in its lockfile) and calls
`setOrigin` on that copy (`src/lib/api.ts`). If it takes monitor-map 4.3.0 without moving its
own SDK to `^4.7.0`, npm can nest 4.7 under monitor-map, whose requests then skip mobile's
origin, which would silently break it. This plan doesn't change mobile. The requirement goes in the
4.3.0 release notes and `DEFERRED.md` (mobile section), for whoever next updates mobile's
monitor-map dependency.

## Left to the builder

- Exact helper names and where the abort helper lives (`src/lib/utils.ts` or a new file).
- Whether `MonitorDetailsState` keeps its request counter alongside the controller.
- How `#runInit` threads its controller through the meta/list/latest requests and the
  catch-up loop.
- The `AbortSignal.any` support check and fallback.
- Behavior of `init` with an already-aborted signal when already initialized.
