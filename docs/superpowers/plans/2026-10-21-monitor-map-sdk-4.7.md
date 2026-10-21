# monitor-map SDK 4.7 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `@sjvair/monitor-map` to `@sjvair/sdk` 4.7.0, cancel superseded requests
inside monitor-map, and let the exported managers accept a caller's `AbortSignal`, shipping
as monitor-map 4.3.0.

**Architecture:** A small `src/lib/abort.ts` module (signal combining, waiting with an
escape hatch) is used by every fetching site. Each site owns an `AbortController` that a newer
request aborts. Internally superseded work resolves quietly. Only an abort from the caller's
own signal rejects. `monitorsManager.init`'s shared run is aborted only when every waiting
caller has aborted.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (server project for rune modules),
`@sjvair/sdk` 4.7.0 (`RequestOptions` from `@sjvair/sdk/http`).

**Spec:** `/home/alex/workspace/sjvair/data-dashboard/docs/superpowers/specs/2026-10-21-monitor-map-sdk-4.7-design.md`

**Repo:** all paths below are relative to `/home/alex/workspace/sjvair/monitor-map` unless
absolute. Read that repo's `CLAUDE.md` first.

## Global Constraints

- Branch `feat/sdk-4.7-request-options` from monitor-map `main`. Never commit to `main`.
- `@sjvair/sdk` dependency: `"npm:@jsr/sjvair__sdk@^4.7.0"`.
- Target version **4.3.0**. **Never merge to `main` or publish (GitHub Release) without the
  user's explicit yes at that moment**, each one separately. sjvair.com builds `main`
  unpinned, so a merge is a production deploy.
- Nothing breaks: every new parameter is optional; calls without a signal behave exactly as
  in 4.2.0 (same requests, same resolve/reject, same state).
- A cancelled request is silent: no `console.error`, no `"failed"` status, no loading flag
  left on.
- monitor-map never calls `setRequestDefaults`.
- Don't use `AbortSignal.any`. Capacitor 8 supports iOS 15, and `AbortSignal.any` needs
  Safari 17.4. Use `anySignal` from Task 1.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before
  each commit. Conventional-commit subjects (`feat:`, `fix:`, `chore:`, `docs:`), as the repo
  uses. **No AI attribution or `Co-Authored-By` trailers in commits or PRs.**
- The signal option type everywhere is `{ signal?: AbortSignal }`, exported as
  `SignalOptions` from `src/lib/abort.ts`.

## Review Focus

1. **A signal-less caller sharing `init` with a caller who aborts:** the signal-less caller's
   promise resolves and state is set (the mobile app passes no signal). Test in Task 6.
2. **Rapid pollutant switching** (three `update`s in a row): only the last one's results land,
   and the earlier ones resolve with no log. Test in Task 5.
3. **A signal that is already aborted when passed:** the call rejects with `signal.reason` and
   sends no request (or aborts it immediately). Nothing is logged. Tests in Tasks 1, 5, 6, and 7.
4. **The chart's background refresh being superseded by a range change:** an abort must not
   reach the `silent && data.length === 0` path, or leave `loading` on. Test (on
   `fetchChartData`) in Task 3. The component wiring is checked by hand in Task 8.
5. **A non-abort failure after this change** (e.g. 500 during `update` while a caller signal is
   present but not aborted): it still rejects or logs as in 4.2.0, and isn't mistaken for a
   cancel. Tests in Tasks 2 and 5.

---

### Task 1: Branch, SDK bump, and the abort helpers

**Files:**
- Modify: `package.json` (dependency), `package-lock.json` (via `npm install`)
- Create: `src/lib/abort.ts`
- Test: `tests/abort.test.ts`

**Interfaces:**
- Produces (from `src/lib/abort.ts`):
  - `export type SignalOptions = { signal?: AbortSignal }`
  - `export function anySignal(...signals: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose(): void }`
    aborts as soon as any input aborts, with that input's `reason`, and is already aborted
    if any input already is. `dispose()` removes its listeners from the inputs. Undefined
    inputs are ignored.
  - `export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T>`
    settles like `promise`, unless `signal` aborts first, in which case it rejects with
    `signal.reason`. It rejects immediately if `signal` is already aborted, and removes its
    listener once settled. `promise`'s own later rejection must never become unhandled.

- [ ] **Step 1: Create the branch and bump the SDK**

```bash
cd /home/alex/workspace/sjvair/monitor-map && git switch main && git pull && git switch -c feat/sdk-4.7-request-options
```
Edit `package.json` to `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@^4.7.0"`, then `npm install`.
Expected: `npm ls @sjvair/sdk` shows `4.7.0` once, and `npm run check` and `npm test` pass unchanged.

- [ ] **Step 2: Write failing tests in `tests/abort.test.ts`**

- `anySignal`: aborting the second of two controllers aborts the result with that reason.
  An already-aborted input gives an already-aborted result. `anySignal(undefined)` never
  aborts. After `dispose()`, aborting an input leaves the result unaborted.
- `untilAborted`: resolves with the promise's value when there's no signal. Rejects with
  `reason` when the signal aborts before the promise settles, even though the promise later
  resolves. Rejects immediately with an already-aborted signal. When the signal aborts and
  then the inner promise rejects, Vitest reports no unhandled rejection (the test passes with
  no "Unhandled" error).

- [ ] **Step 3: Run tests, expect FAIL** — `npx vitest run tests/abort.test.ts` (module not found).

- [ ] **Step 4: Implement `src/lib/abort.ts`** to the interfaces above (an `AbortController`
  plus `addEventListener("abort", …, { once: true })` per input).

- [ ] **Step 5: Run tests, expect PASS** — `npx vitest run tests/abort.test.ts`.

- [ ] **Step 6: Commit** — `chore: depend on @sjvair/sdk 4.7.0 and add abort helpers`.

---

### Task 2: Monitor detail panel cancels superseded loads

**Files:**
- Modify: `src/lib/monitors/monitor-details.svelte.ts`
- Test: `tests/monitors/monitor-details.test.ts`

**Interfaces:**
- Consumes: none from Task 1 (a single controller suffices).
- `MonitorDetailsState`'s public API is unchanged (`load(id)`, `refresh()`, `retry()`).

- [ ] **Step 1: Update existing assertions and add failing tests**

Existing `toHaveBeenCalledWith("a")` becomes
`toHaveBeenCalledWith("a", { signal: expect.any(AbortSignal) })`. New tests:
- `"aborts the previous load when another starts"`: `load("a")` (deferred), then `load("b")`.
  The first call's `signal.aborted` is `true`. Rejecting the first deferred with
  `signal.reason` afterwards leaves `status` as set by `b`, and `logged` is not called.
- `"aborts a pending refresh when a load starts"`: same pattern with `refresh()` then `load`.
- `"still reports a failure that is not a cancel"`: a 500 rejection with no newer request
  gives `status === "failed"` and logs once (it pins Review Focus 5).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/monitors/monitor-details.test.ts`.

- [ ] **Step 3: Implement.** Add `#controller: AbortController | null`. `load` and `refresh`
  each abort the previous controller, create a new one, and pass `{ signal }` to
  `getMonitorDetails(id, { signal })`. Keep the `#request` counter as the drop guard; in each
  `catch`, return without touching state when this call's signal is aborted.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat: cancel superseded monitor detail requests`.

---

### Task 3: Chart cancels superseded fetches

**Files:**
- Modify: `src/lib/data-chart/requests.ts`, `src/lib/data-chart/DataChart.svelte:146-158`
- Test: `tests/data-chart/requests.test.ts` (new)

**Interfaces:**
- Produces: `fetchChartData(m: ChartMonitor, d: DateRange, entryType: PanelPollutant, options?: SignalOptions): Promise<uPlot.AlignedData>`.
  It passes `{ signal }` as `getMonitorEntries`' second argument. When `options.signal` is
  aborted it **rejects with `signal.reason`**, without logging. Any other failure still logs
  and resolves `[]`.

- [ ] **Step 1: Write failing tests** (mock `@sjvair/sdk`'s `getMonitorEntries`):
  - `"passes the signal to the SDK"`: the second argument is `{ signal }`.
  - `"rejects with the abort reason when cancelled, without logging"`: abort the controller
    and have the mock reject with `signal.reason`. The promise rejects with that reason, and
    `console.error` isn't called.
  - `"still resolves [] and logs on an ordinary failure"`: a mocked `Error("500")` gives
    `[]` and one `console.error`.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/data-chart/requests.test.ts`.

- [ ] **Step 3: Implement `fetchChartData`**, then wire `DataChart.svelte`. Keep a component
  `chartController`. `loadChartData` aborts it, makes a new one, and passes its signal. A
  rejection whose signal is aborted returns before touching `chartManager` (the `chartRequest`
  counter stays as the drop guard). Abort the controller in an `$effect` teardown so a closed
  panel cancels its fetch.

- [ ] **Step 4: Run, expect PASS**; also `npm run check`.

- [ ] **Step 5: Commit** — `feat: cancel superseded chart requests`.

---

### Task 4: Subscription status cancels on monitor switch

**Files:**
- Create: `src/lib/monitors/subscriptions.ts`
- Modify: `src/lib/monitors/components/MonitorSubscriptionManager.svelte`
- Test: `tests/monitors/subscriptions.test.ts`

**Interfaces:**
- Produces (from `src/lib/monitors/subscriptions.ts`):
  - `export function getApiToken(): string | undefined`: `window.USER.api_token` (via
    `globalThis`) when it is a non-empty string, else `undefined`.
  - `export function loadSubscriptionLevel(monitorId: string, options?: SignalOptions): Promise<string | null>`:
    `getSubscriptions(getApiToken(), { signal })`, then the matching subscription's `level`,
    or `null`.

- [ ] **Step 1: Write failing tests** (mock `@sjvair/sdk/account`; set/delete
  `globalThis.USER` per test):
  - `getApiToken` gives `undefined` with no `USER`, with `api_token: ""`, and with no
    `api_token`. It gives `"abc"` for `api_token: "abc"`.
  - `loadSubscriptionLevel("m1", { signal })` calls `getSubscriptions(undefined, { signal })`
    and returns the level for `monitor === "m1"`, or `null` when none matches.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement the module; rewire the component.** The component imports both
  functions and deletes its local `getApiToken`. `subscribe` and `unsubscribe` keep their
  current calls with `apiToken: getApiToken()` and are never cancelled. The load `$effect`
  creates an `AbortController`, calls `loadSubscriptionLevel(monitorId, { signal })`, and
  returns `() => controller.abort()`. The `.then` sets `subscribedLevel`/`loading` only when
  not aborted. An aborted rejection is swallowed, and other rejections keep today's behavior
  (the `finally` clears `loading`).

- [ ] **Step 4: Run, expect PASS**; `npm run check`.

- [ ] **Step 5: Commit** — `feat: cancel superseded subscription loads and stop sending an empty token`.

---

### Task 5: `monitorsManager.update` supersedes itself and takes a signal

**Files:**
- Modify: `src/lib/monitors/monitors.svelte.ts` (`update`, `getMonitorsLatestMap`)
- Test: `tests/monitors/monitors-manager.test.ts`

**Interfaces:**
- Consumes: `anySignal`, `SignalOptions` (Task 1).
- Produces:
  - `update(options?: SignalOptions): Promise<void>`
  - module-private `getMonitorsLatestMap(pollutant, signal?: AbortSignal)`, which calls
    `getMonitors(pollutant, undefined, { signal })`.
  - `getMonitorsList({ signal })` in `update`.

Rules: each `update` aborts the previous in-flight one (`#updateController`). It combines
its own controller with `options.signal` via `anySignal` and disposes the combination in
`finally`. If the **caller's** signal is aborted, it rejects with `options.signal.reason`. If
only its **own** controller was aborted (superseded), it resolves without touching state. Any
other error rejects as today. Keep the existing `this.pollutant !== pollutant` drop guard.

- [ ] **Step 1: Update existing call assertions and write failing tests.** Existing
  `sdk.getMonitors.mock.calls` expectations such as `[["pm25"]]` become
  `[["pm25", undefined, { signal: expect.any(AbortSignal) }]]`; do the same for
  `getMonitorsList`. Write a small test helper `pollutantsRequested()` that maps calls to
  their first argument, and use it where only the pollutant matters. New tests under
  `describe("monitorsManager.update")`:
  - `"aborts an in-flight update when another starts, and the first resolves quietly"`
  - `"applies only the last of three rapid updates"` (Review Focus 2): three deferred
    `getMonitors`. State equals the third's readings, all three promises resolve, and
    `console.error` isn't called.
  - `"rejects with the caller's reason when the caller aborts"`
  - `"rejects immediately for an already-aborted signal"` (Review Focus 3). Either no request
    is sent, or the one sent is already aborted. Assert the rejection reason.
  - `"still rejects an ordinary failure when a live signal is passed"` (Review Focus 5)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/monitors/monitors-manager.test.ts`.

- [ ] **Step 3: Implement `update` as above.** `resumeAutoUpdate`, the polling `Interval`,
  and the pollutant `$effect` keep calling `update()` with no argument.

- [ ] **Step 4: Run, expect PASS** (the whole file, including the existing resume/update tests).

- [ ] **Step 5: Commit** — `feat: monitorsManager.update cancels superseded updates and accepts a signal`.

---

### Task 6: `monitorsManager.init` takes a signal without breaking the shared run

**Files:**
- Modify: `src/lib/monitors/monitors.svelte.ts` (`MonitorsInitOptions`, `init`, `#runInit`)
- Test: `tests/monitors/monitors-manager.test.ts`

**Interfaces:**
- Consumes: `untilAborted` (Task 1); `getMonitorsLatestMap(pollutant, signal)` (Task 5).
- Produces: `MonitorsInitOptions` gains `signal?: AbortSignal` (documented in its JSDoc).
  `init`'s signature is unchanged.

Rules (spec §3, "the shared run"):
- The run owns an `AbortController`, whose signal goes to `getMonitorsMeta`,
  `getMonitorsList`, and every `getMonitorsLatestMap` call, including the catch-up loop.
- Track the run's callers: how many are waiting with a signal, how many of those aborted,
  and whether any caller passed no signal. A signal-less caller gets the shared promise
  itself, so `expect(second).toBe(first)` still holds. A caller with a signal gets
  `untilAborted(shared, signal)`.
- When a caller's signal aborts, if no signal-less caller exists and every signalled caller
  has aborted, abort the run's controller. The run's rejection then clears `#initPromise` and
  both flags in the existing `finally`. `initialized` stays false and polling doesn't start.
  Attach a no-op `.catch` so a run that nobody awaits never becomes an unhandled rejection.
- An aborted caller's `urlPollutant` and `autoUpdate` stay recorded (no per-caller undo).
- An already-aborted signal: reject at once with its reason, and don't start a run if none is
  in flight. When already initialized, `init` resolves as today, whatever the signal.

- [ ] **Step 1: Write failing tests** under `describe("monitorsManager.init")`:
  - `"one caller aborting leaves a signal-less caller's run intact"` (Review Focus 1). A
    caller with a signal plus `init()` with none, with meta deferred. Abort the first. Its
    promise rejects with the reason, the run's requests aren't aborted, the second resolves,
    `initialized` is true, and `start` is called.
  - `"aborts the run when every waiting caller aborts"`. Two signalled callers, both abort.
    The signal passed to `getMonitorsMeta` is aborted, both reject, `initialized` is false,
    and `start` isn't called. A following `init()` succeeds.
  - `"keeps an aborted caller's pollutant"`. `init("o3", { signal })` aborts, then
    `init(undefined, { autoUpdate: false })` waits, giving `pollutant === "o3"`.
  - `"rejects an already-aborted signal without starting a run"`. No SDK call, and the
    promise rejects with the reason.
  - `"resolves once initialized, even with an aborted signal"`.
  - No `console.error` in any of these.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** per the rules above. Run-level bookkeeping lives next to
  `#initPromise` (e.g. a `#run` object). Builder's choice of shape.

- [ ] **Step 4: Run, expect PASS** — the whole manager test file, all existing `init` tests
  unchanged in meaning.

- [ ] **Step 5: Commit** — `feat: monitorsManager.init accepts a signal without cancelling shared runs`.

---

### Task 7: Collocation, HMS, and EV managers accept a signal

**Files:**
- Modify: `src/lib/collocation-sites/collocations.svelte.ts`, `src/lib/hms/hms.svelte.ts`,
  `src/lib/ev-stations/ev-stations.svelte.ts`
- Test: `tests/managers-signal.test.ts` (new; mock `@sjvair/sdk`, `@sjvair/sdk/hms`, and
  `globalThis.fetch`)

**Interfaces:**
- Consumes: `SignalOptions` (Task 1).
- Produces:
  - `collocationSitesManager.init(options?: SignalOptions)`, `.update(options?: SignalOptions)`,
    which pass `{ signal }` to `getCollocationSites`. An aborted `init` rejects with the reason
    and leaves `initialized` false.
  - `hmsManager.init(options?)`, `.loadSmoke(options?)`, `.loadFire(options?)`, which pass
    `{ signal }` to `getHMSSmoke`/`getHMSFire`. `loadFire`'s catch rethrows when the signal is
    aborted (no log). `init` keeps `allSettled`, then rejects with `signal.reason` if the
    signal is aborted.
  - `evStationsManager.loadLvl2Stations(options?)`, `.loadLvl3Stations(options?)`;
    `fetchEvStations(level, signal?)` calls `fetch(url, { signal })`.

- [ ] **Step 1: Write failing tests.** For each method: the signal reaches the SDK or
  `fetch`. An abort rejects with the reason and doesn't log. Calls without a signal behave
  as before. For collocations: `initialized` stays false after an aborted `init`, and a later
  `init()` succeeds. For HMS: an aborted `init` rejects, and `loadFire` with a non-abort error
  still logs and resolves (today's behavior).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/managers-signal.test.ts`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `feat: collocation, HMS and EV managers accept a signal`.

---

### Task 8: Docs, version, full verification, PR

**Files:**
- Modify: `package.json` (`"version": "4.3.0"`), `README.md` (a short "Cancelling requests"
  note: which methods take `{ signal }`, that superseded internal work resolves quietly,
  and the SDK-dedupe note below), `CLAUDE.md` (the test-coverage paragraph lists the new
  specs; a line on the `abort.ts` pattern and the "own controller resolves quietly / caller
  signal rejects" rule).

- [ ] **Step 1: Write the docs and bump the version.** The README dedupe note: a host that
  depends on `@sjvair/sdk` directly must use `^4.7.0` so npm installs one copy (a nested copy
  ignores the host's `setOrigin`).

- [ ] **Step 2: Full verification.** Run `npm run lint`, `npm run check`, `npm test`, and
  `npm run test:bundle`. Expected: all pass, and the bundle check reports maplibre still off
  the eager path.

- [ ] **Step 3: Manual check.** `npm run dev` against the local podman sjvair.com. In the
  network panel, rapidly switch monitors, pollutants, and chart date ranges. Superseded
  requests show as cancelled, the panel and chart show the last selection, and the console
  has no errors. Signed in, subscribe and unsubscribe still work. (Dev is cross-origin, so
  no `X-CSRFToken` is expected here. The resticus rollout checks that.)

- [ ] **Step 4: Commit** — `docs: document request cancelling and bump to 4.3.0`.

- [ ] **Step 5: Push and open a PR into `main`.** The body summarizes the change, links the
  spec, and includes the mobile dedupe note. No AI attribution.

- [ ] **Step 6: STOP.** Report the PR to the user. **Don't merge** (production deploy) and
  **don't create a GitHub Release** (npm publish) until the user explicitly approves each
  one. After the merge (with approval), record it in data-dashboard: `TODO.md` → "Start
  here" (monitor-map 4.7 upgrade on `main`, so the resticus CSRF merge is unblocked), plus
  the project memory status note.
