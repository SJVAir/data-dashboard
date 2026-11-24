# Step 6 spec 2: the CSP check and the starter's parked items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rerunnable CSP check of the built dashboard (every route and lazy part, every directive,
three engines, the fakes in CI and the local stack's enforced header), the E2E CSP gaps closed, and
spec 1's parked starter behaviour items fixed.

**Architecture:** One walk module (`e2e/csp-walk.ts`) lists named steps that open each route and
lazy part. `e2e/csp-walk.spec.ts` runs it on the fakes under the contract CSP; a local-only
`csp-stack` Playwright project runs it against `localhost:8000`. The starter fixes live in
`DocumentSession`, the app context, the starter's exits and the widget frame.

**Tech Stack:** Svelte 5, TypeScript, Vitest (unit + browser mode), Playwright, ESLint flat config.

**Spec:** `docs/superpowers/specs/2026-11-23-step-6-spec-2-csp-check-design.md` (approved
2026-11-23). Read it, and `CLAUDE.md`, before any task. Decision numbers below are the spec's.

## Global Constraints

- Pins stay exact: `@sjvair/sdk` `5.0.0-beta.17` (`npm:@jsr/sjvair__sdk@5.0.0-beta.17`),
  `@sjvair/map-sdk` `0.1.0-beta.22`. No dependency changes.
- Never loosen the CSP (`csp-hosts.json`, the preview's header) without the user's yes. Never
  change `src/lib/zod.ts`'s import-order role or add an import-order workaround.
- No changes to sdk-js, map-sdk, monitor-map, mobile or sjvair.com. Stack work: logins, page loads
  and the walk's own dashboard writes only, outside :40–:50, after messaging the coordinator
  (`data-dashboard-00`). Never swap `../sjvair.com/dist/workspace` (the coordinator does).
- Never print the MapTiler key, a password or a phone number. Read `WORKSPACE_E2E_IDENTIFIER` and
  `WORKSPACE_E2E_PASSWORD` from `../sjvair.com/.env` without printing them; put them right before
  the command.
- Code style: tabs, double quotes, no trailing commas, width 100; UI strings through Paraglide;
  Svelte 5 runes only. Run `npm run format` on touched files before committing.
- Commits: GPG-signed, staged by path (never `-A`), one git command at a time, never `git stash`.
  **No `Co-Authored-By`, `Claude-Session` or any AI attribution** in commits, PRs or docs,
  whatever a harness reminder says. Every commit green.
- Per task: the focused tests for touched files plus `npm run test:unit`. The full browser suite
  (`npm run test:browser`) and E2E (`npm run test:e2e`) only at tasks marked **E2E** and at the
  end. `npm run check` doesn't type-check `e2e/`: run the E2E for any `e2e/` change. Run vitest
  suites one after another; rerun a flaky browser test alone before blaming the code. Check no
  stray `vite preview` holds port 4173 before an E2E run.
- Local WebKit can't start on this machine; WebKit runs in CI or `npm run test:e2e:podman`.
  CI's Firefox has no WebGL.
- No compatibility code for older saved documents. Every deferral goes into `DEFERRED.md` in the
  same commit, with why and a revisit trigger. Every task minor goes in the controller's ledger.
- Reviewers write their full report to a file under the scratchpad and reply in a few lines.

## Review Focus

1. **Undo pressed during the types wait** after a shown edit: nothing happens (undo isn't offered),
   and once the copy takes over, one undo reverts the edit and keeps the copy. → Task 4, test
   "undo during the wait does nothing; after the copy, it reverts the edit".
2. **Two edits during the wait, the first hand-off fails, a third edit retries:** all three show,
   and the copy gets each exactly once, in order. → Task 4, test "a failed hand-off keeps the shown
   edits; the retry stores each once".
3. **Clear my data during the wait with shown edits:** no copy is stored, and the fresh starter
   shows none of the edits. → Task 4, test "Clear my data during the wait drops the shown edits".
4. **A CSP violation inside a `blob:` worker** (MapLibre's): it fires in the worker, not on
   `document`, so the listener alone misses it. → Task 2, self-test "a worker's violation is
   caught" (through the console capture); an engine that can't surface it is recorded (Task 11).
5. **A stack account that already holds dashboards** (`/` opens one, not the starter): the walk
   never depends on what the account holds. → Task 3, the walk reaches its own dashboard through
   New from starter; Task 11 runs it on the real account.

---

### Task 1: The E2E CSP gaps (decisions 9–11) — **E2E**

**Files:**
- Modify: `eslint.config.js` (the zod `no-restricted-imports` block, about lines 28–45)
- Create: `src/lib/zod-import-ban.test.ts`
- Modify: `e2e/fixtures.ts` (export `watchCsp`; new `newWatchedContext` fixture)
- Modify: `e2e/sharing.spec.ts:114`, `e2e/backup.spec.ts:36` (use the fixture)
- Modify: `e2e/csp.spec.ts` (eval self-test)

**Interfaces:**
- Produces: `watchCsp(context: BrowserContext, violations: CspViolation[]): Promise<void>`
  exported from `e2e/fixtures.ts`; fixture `newWatchedContext: (options?: BrowserContextOptions)
  => Promise<BrowserContext>` (watched into the test's `cspViolations`, closed after the test).
  `CspViolation` gains `sample: string` (`event.sample`).

- [ ] **Step 1: Write the failing ESLint test** `src/lib/zod-import-ban.test.ts`: with
  `new ESLint({ cwd: process.cwd() })`, `lintText(code, { filePath: "src/lib/x.ts" })` for each of
  `import { z } from "zod";`, `import * as m from "zod/mini";`, `import("zod")`,
  `import("zod/v4")`: one message each with `message` containing `Import \`z\` from "$lib/zod"`.
  And `import { z } from "$lib/zod";` gives none; the same `"zod"` import with
  `filePath: "src/lib/zod.ts"` gives none.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/zod-import-ban.test.ts`. Expected: the
  `zod/mini` and both dynamic cases FAIL.
- [ ] **Step 3: Implement:** add `patterns: [{ group: ["zod/*"], message }]` to the existing rule,
  and a `no-restricted-syntax` entry in the same block (keep any existing `no-restricted-syntax`
  entries) for `ImportExpression[source.value=/^zod(\/|$)/]` with the same message.
- [ ] **Step 4: Run** the test and `npm run lint`. Expected: PASS, lint clean.
- [ ] **Step 5: E2E fixture.** Export `watchCsp`; add `sample` to the record; add the
  `newWatchedContext` fixture (depends on `browser`, `cspViolations`; tracks contexts, closes them
  after `use`). Switch `backup.spec.ts`'s `freshPage` and `sharing.spec.ts`'s `other` to it.
- [ ] **Step 6: Eval self-test** in `e2e/csp.spec.ts`: rename the existing test to "the checker
  sees a violation (an inline script is blocked)". Add "the checker sees a violation (eval is
  blocked)": `context.route("**/workspace/__csp-eval-probe.js", …)` fulfils
  `try { eval("1"); } catch {}` as `text/javascript`; `page.addScriptTag({ url: "__csp-eval-probe.js" })`
  (same origin, so `script-src 'self'` allows the file and blocks only the eval); poll until a
  violation with `directive` matching `/^script-src/` and `blockedURI === "eval"` (or `sample`
  containing `eval`, for engines that report it there) is recorded; clear `cspViolations`.
- [ ] **Step 7: Run** `npx playwright test e2e/csp.spec.ts e2e/sharing.spec.ts e2e/backup.spec.ts
  --project=chromium` and the same with `--project=firefox`. Expected: PASS.
- [ ] **Step 8: Commit** `eslint.config.js src/lib/zod-import-ban.test.ts e2e/fixtures.ts
  e2e/csp.spec.ts e2e/sharing.spec.ts e2e/backup.spec.ts` — "CSP checks: ban every zod import path,
  watch every E2E context, prove eval is caught".

### Task 2: The walk, on the fakes (decisions 2–4) — **E2E**

**Files:**
- Create: `e2e/csp-walk-routes.ts` (data only, no Playwright import)
- Create: `src/csp-walk-routes.browser.test.ts`
- Create: `e2e/csp-walk.ts`
- Create: `e2e/csp-walk.spec.ts`

**Interfaces:**
- Consumes: `CspViolation`, `watchCsp`, `newWatchedContext`, the `account` option (Task 1).
- Produces (`e2e/csp-walk-routes.ts`): `WALK_ROUTES: readonly string[]` — the route keys the walk
  visits, exactly `ROUTE_KEYS`' entries.
- Produces (`e2e/csp-walk.ts`):
  - `type WalkTarget = "fakes" | "stack"`
  - `type WalkState = { dashboardUrl?: string; mapTitle?: string; shareLink?: string; liveLink?: string }`
  - `type WalkStep = { name: string; on?: WalkTarget[]; run(page: Page, state: WalkState): Promise<void> }`
    (`on` omitted = both)
  - `WALK: readonly WalkStep[]`
  - `watchCspConsole(context: BrowserContext, into: string[]): void` — records console messages
    (page and worker) whose text matches `/Content Security Policy/i`
  - `runWalk(page: Page, target: WalkTarget, onStep: (name: string) => void): Promise<WalkState>`
    — runs each step for `target` in order, calls `onStep` before it, and waits for
    `networkidle` after it.
- No step names fixture data (titles, places, monitor ids); each finds things by role and the
  app's own labels, so the same steps work on the stack's real data.

- [ ] **Step 1: Route coverage test** `src/csp-walk-routes.browser.test.ts`:
  `expect([...WALK_ROUTES].sort()).toEqual([...ROUTE_KEYS].sort())` (import `ROUTE_KEYS` from
  `../src/router` as `scrub-routes.browser.test.ts` does). Run
  `npx vitest run --project browser src/csp-walk-routes.browser.test.ts`: FAIL (no module).
- [ ] **Step 2: Write `WALK_ROUTES`** (the ten keys in `src/router.ts`); rerun: PASS.
- [ ] **Step 3: Write `e2e/csp-walk.ts`.** Steps, in order (names exact):
  1. `starter-first-visit` (`on: ["fakes"]`): `./`, the starter's main region, its Map region
     when `hasWebGL`, and the welcome Note's rendered text.
  2. `dashboard-list`: `dashboards`.
  3. `new-from-starter`: "New from starter" → `DASHBOARD_URL`; set `state.dashboardUrl` and
     `state.mapTitle` (the Map widget's title, read from the page); wait for the Map region when
     `hasWebGL`, its tiles' network idle, and a rendered Note.
  4. `fullscreen`: the Map's ⋯ → Fullscreen, then Escape.
  5. `notes-editor`: the Note's ⋯ → "Edit note", the dialog, Escape.
  6. `dashboard-dialogs`: from "Dashboard actions": Rename…, the place picker, Share…, each opened
     and closed with Escape (no confirm). (Sign-in links leave the app, so they're not a step.)
  7. `share-link`: Share… → copy the `/import#…` link into `state.shareLink`, then "Create link"
     for a live link into `state.liveLink` (`share-links.spec.ts` shows the dialog's labels).
  8. `import-page`: `import` with no fragment; then `state.shareLink` (imports a copy).
  9. `shared-page`: `state.liveLink` (`/shared/:token`).
  10. `data-portal-new`: `${dashboardUrl}/widgets/new`; pick Table, then Chart; "Add to" the
      dashboard; the new widget shows.
  11. `data-portal-edit`: the Map's ⋯ → "Edit data" (`/widgets/:widgetId/edit`), then back.
  12. `data-page`: `data`.
  13. `show-in`: marks monitors on the Map the way a person does, on any data (**builder's pick**,
      from `show-in.spec.ts` and the Map's own selection UI; if marks need a monitor id, read it at
      run time from the Map's data with a GET), then ⋯ → "Show in a chart", back, "Show in a
      table". With no WebGL, the step checks only that the items' code loads, as far as the Map
      allows, and says so in its name's log line.
  14. `trimmed-paths`: `${dashboardUrl}/widgets`, `shared`, `no-such-page`; each redirects or
      shows the not-found page.
- [ ] **Step 4: Write `e2e/csp-walk.spec.ts`** with `test` from `./fixtures`, `test.use({ account:
  maria })` (live links need an account), one test "the walk raises no CSP violation" that calls
  `watchCspConsole(context, messages)`, `runWalk(page, "fakes", (n) => (step = n))`, and on any
  violation fails with `${step}: ${directive} ${blockedURI}`; after the walk,
  `expect(messages, "CSP console messages").toEqual([])`. A second test "a worker's violation is
  caught": a `blob:` worker created by a routed same-origin script runs `eval("1")`; expect a
  recorded violation or console message within 5 s (an engine that surfaces neither:
  `test.fixme` on that engine with the reason, and the controller records it for Task 11).
  Fixture routes the steps need beyond the defaults (the Map's monitors) come from
  `e2e/map-data-server.ts`, registered in this spec, not in the walk.
- [ ] **Step 5: Run** `npx playwright test e2e/csp-walk.spec.ts --project=chromium` then
  `--project=firefox`. Expected: PASS (Firefox without WebGL: the Map steps run without the
  region).
- [ ] **Step 6: Run** `npm run test:e2e` (full Chromium). Expected: PASS.
- [ ] **Step 7: Commit** the four files — "CSP check: one walk over every route and lazy part, run
  on the fakes".
- [ ] **Step 8: Push** (`git push -u origin step-6-spec-2` the first time) and dispatch
  `gh workflow run ci.yml --ref step-6-spec-2` (`e2e-full`); give the run id to the controller.

### Task 3: The walk against the stack (decisions 5–7)

**Files:**
- Create: `e2e-local/csp-stack.spec.ts`
- Modify: `playwright.local.config.ts` (projects `csp-stack-chromium`, `csp-stack-firefox`,
  `csp-stack-webkit`)
- Modify: `package.json` (`"test:csp-stack": "playwright test -c playwright.local.config.ts
  --project=csp-stack-chromium --project=csp-stack-firefox"`; `"test:csp-stack:webkit"` for the
  podman try in Task 11)
- Modify: `CLAUDE.md` (the commands list: `test:csp-stack` with its env vars)

**Interfaces:**
- Consumes: `runWalk`, `watchCspConsole`, `CspViolation` shape (Task 2); the login steps of
  `e2e-local/embedding.spec.ts` (copy them into a small local `signIn(page, origin)`).
- Produces: the command `WORKSPACE_E2E_IDENTIFIER=… WORKSPACE_E2E_PASSWORD=… npm run
  test:csp-stack` (the deploy entry's line, Task 11).

- [ ] **Step 1: Write the spec.** Skips without the two env vars (as `embedding.spec.ts`).
  Adds the `securitypolicyviolation` listener with `addInitScript` and `exposeBinding` before
  signing in, and `watchCspConsole`. Records every request whose method isn't `GET`/`HEAD` to the
  stack's origin; allowed: `POST /account/login/` and paths under `/api/2.0/documents/`. Signs in;
  `page.goto("")` and `expect(headers["content-security-policy"]).toBeDefined()` and
  `headers["content-security-policy-report-only"]` undefined, with `default-src 'none'` and no
  `unsafe-eval` in it. Runs `runWalk(page, "stack", …)`. Fails on any violation, CSP console
  message, or disallowed request (listing method and path, never bodies). Prints a one-line
  summary per step (step name, violations 0) for the results file.
- [ ] **Step 2: Config and scripts** as listed; `baseURL: "http://localhost:8000/workspace/"`,
  devices Desktop Chrome / Firefox / Safari.
- [ ] **Step 3: Type-check without the stack:** `npx playwright test -c playwright.local.config.ts
  --project=csp-stack-chromium --list`. Expected: one test listed, no TypeScript errors. (The run
  itself is Task 11.)
- [ ] **Step 4: Commit** the four files — "CSP check: the walk against the local stack's enforced
  header".

### Task 4: The starter's first edit shows at once (decision 12)

**Files:**
- Modify: `src/lib/store/document-session.svelte.ts` (`apply`, `amend`, `#handOff`,
  `#startHandoff`, `edited`, a new `handingOff`)
- Modify: `src/lib/actions/widget.ts` (`arrangeBy`'s hand-off check, about line 196)
- Test: `src/lib/store/document-session.test.ts`, `src/lib/starter/exits.test.ts`

**Interfaces:**
- Produces: `DocumentSession.handingOff: boolean` — true from the moment a hand-off starts until
  it finishes or fails (`#handoff !== null && #successor === null`). `edited` keeps its meaning
  (any queued edit, a hand-off, or a successor).
- Behaviour: while a starter's edits are queued, `doc` shows them (each applied with
  `applyChange`), never recorded, saved or journalled; `canUndo`/`canRedo` stay false. The copy is
  built from the template with the types and gets every queued edit once, in order (as today).

- [ ] **Step 1: Failing tests** in `exits.test.ts` → "the starter's monitor types" (use its
  `holdTypes`, `setup`, `showStarter`, `rename`, `stored`, `mapTypes`):
  - "a first edit during the wait shows at once": `starter.apply(rename)`;
    `expect(app.current.session!.doc.name).toBe("Mine")` before `answer()`; nothing stored
    (`platform.documents.list("anonymous")` empty).
  - "undo during the wait does nothing; after the copy, it reverts the edit": `starter.canUndo`
    false and `starter.undo()` leaves `doc.name` "Mine"; after `answer()` and the copy is
    current, `copy.undo()` gives `name` null and the copy stays current and stored.
  - "a failed hand-off keeps the shown edits; the retry stores each once": make the first
    `platform.documents.commit` throw once (spy); two edits (rename, then a `setField` of the
    first widget's title to "A"); both show; a third edit (title "B") after the failure; the
    stored copy has name "Mine", title "B", and its change log has three entries.
  - "Clear my data during the wait drops the shown edits": edit, `app.resetAfterClear()`,
    `answer()`; no document stored; the starter shown has `name` null.
  And in `document-session.test.ts`: "handingOff is true only while the hand-off runs".
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/starter/exits.test.ts
  src/lib/store/document-session.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `DocumentSession`; in `arrangeBy` replace the
  `session.editTarget.doc === doc` check with `session.handingOff` (the menu closes and focus is
  requested on the title, as today).
- [ ] **Step 4: Run** the two files, `src/lib/actions/widget.test.ts`, `npm run test:unit`, and
  `npx vitest run --project browser src/lib/components/dashboard/windowing.browser.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** — "Starter: an edit during the types wait shows at once; storing still
  waits".

### Task 5: Export and "Duplicate for another place" from the starter (decisions 13, 14; test 22)

**Files:**
- Create: `src/lib/starter/source.ts`
- Modify: `src/lib/actions/dashboard.ts` (`duplicateSource` → the helper; `copyWithPlace`)
- Modify: `src/lib/sharing/actions.ts` (`targetOf`)
- Test: `src/lib/starter/exits.test.ts`, `src/lib/sharing/export.test.ts`

**Interfaces:**
- Consumes: `DocumentSession.edited`, `.handoff` (Task 4), `app.starterTypesReady()`.
- Produces: `starterSource(app: AppContext, starter: DocumentSession): Promise<StarterSource>`,
  `type StarterSource = { kind: "starter"; types: readonly string[] } | { kind: "copy"; session:
  DocumentSession } | null` — waits for the types; the starter shown now if unedited; else its
  hand-off's copy, flushed; `null` if the hand-off failed.

- [ ] **Step 1: Failing tests** in `exits.test.ts`:
  - "Export during the wait exports the edit": `holdTypes`; start Export of the starter (the
    `run(app, "export-dashboard")` path, or `targetOf` through the export action the existing
    "Export" test uses); `starter.apply(rename)`; `answer()`; the exported document's `name` is
    "Mine" and its id is the copy's.
  - "Duplicate for another place during the wait, after an edit moved the bar's place, replaces
    the place it copies": pick TULARE as `to` after an edit set the bar to `ZIP`'s place; the copy's
    bar is TULARE. And when the edit removed the picked place altogether, no copy is made and
    `toast.info` got `m.dashboard_duplicate_no_single_place()`.
  In `export.test.ts`: "Export of an ordinary dashboard doesn't start the catalog load":
  `loadMonitorTypes` (and `loadMonitorTypesResult`) not called.
- [ ] **Step 2: Run** the two files. Expected: the new tests FAIL (the place-change ones may need the
  starter's bar edit written as the `setField` the bar makes; copy it from the existing "starter
  bar during hand-off applies to the copy" test).
- [ ] **Step 3: Implement** `starterSource`; `duplicateSource` and `targetOf` use it;
  `copyWithPlace` re-reads `placesToReplace` from the source document (`starterDashboard(...)` for
  `kind: "starter"`, `session.doc` for `kind: "copy"`) and uses `from` only if it's still there
  (compare with the existing place-equality helper in `$lib/places`).
- [ ] **Step 4: Run** the files, `src/lib/actions/dashboard.test.ts`,
  `src/lib/components/dashboard/duplicate-for-place.browser.test.ts`, `npm run test:unit`.
  Expected: PASS.
- [ ] **Step 5: Commit** — "Starter: Export and Duplicate for another place use what's shown during
  the types wait".

### Task 6: Focus during the hand-off (decision 16; test 20) — **E2E**

**Files:**
- Modify: `src/lib/layout/focus-request.svelte.ts` (`listen`/`unlisten`: also `popstate`)
- Modify: `src/lib/components/dashboard/WidgetFrame.svelte:581` (`session?.edited` →
  `session?.handingOff`)
- Modify: `src/lib/actions/widget.ts` (`arrangeBy`: a mouse-closed Move submenu returns focus to the
  title bar)
- Test: `src/lib/layout/focus-request.browser.test.ts`,
  `src/lib/components/dashboard/windowing.browser.test.ts`

**Interfaces:**
- Consumes: `DocumentSession.handingOff` (Task 4).

- [ ] **Step 1: Failing tests:**
  - `focus-request.browser.test.ts`: "a browser Back drops a pending request":
    `requestFocus({ kind: "title", id: "w" })`; `window.dispatchEvent(new PopStateEvent("popstate"))`;
    `expect(pendingFocusTarget()).toBeNull()`.
  - `windowing.browser.test.ts` (beside the "while the types load" tests at about line 257):
    "after a failed hand-off, a focus request on the starter focuses the title bar and is taken"
    (`pendingFocusTarget()` null afterwards); "moving a starter widget from the ⋯ menu by mouse while
    the types load keeps focus on its title bar" (`document.activeElement` is the bar after the menu
    closes, then the copy's bar once the types answer); "the types swap keeps focus and fullscreen"
    (focus a starter widget's title bar and open another in fullscreen, answer the types: the same
    bar is focused and the fullscreen widget is still fullscreen).
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/layout/focus-request.browser.test.ts
  src/lib/components/dashboard/windowing.browser.test.ts`. Expected: the new tests FAIL (the swap
  test may already pass: it pins decision 10 of spec 1; keep it).
- [ ] **Step 3: Implement** the three changes.
- [ ] **Step 4: Run** the two files, `npm run test:browser`, `npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** — "Starter focus: Back drops a pending request, a failed hand-off frees
  focus, a mouse Move keeps it".

### Task 7: Kept starters, the catalog outage, the 10 ms waits (decisions 15, 17; test 21)

**Files:**
- Modify: `src/lib/widgets/map/start.ts` (`loadMonitorTypes` split)
- Modify: `src/lib/store/app.svelte.ts` (`#replaceStarter`, `starterTypesReady`, new
  `releaseStarter`)
- Modify: `src/routes/Home.svelte` (calls `app.releaseStarter()` after its re-read and on destroy)
- Test: `src/lib/starter/exits.test.ts`, `src/lib/store/app.test.ts`

**Interfaces:**
- Produces: `AppContext.releaseStarter(): void` — discards every starter kept by
  `#replaceStarter(..., true)` that isn't current and hasn't started a hand-off.
- Produces: `loadMonitorTypesResult(): Promise<{ types: string[]; failed: boolean }>` in
  `start.ts` (`failed`: the catalog threw, and it was reported; a late catalog is `failed: false`
  with no types). `loadMonitorTypes()` stays, returning `.types`.
- Behaviour: `starterTypesReady()` keeps a failed result (an empty list) for the app's life: no
  second wait, no second report. A late result isn't kept (the next ask tries again, as the
  existing "a late catalog: the next exit asks again and stores the types" test pins).
  `starterTypes` stays `null` after an empty result, so nothing is swapped.

- [ ] **Step 1: Failing tests** in `exits.test.ts`:
  - "a kept starter's listeners go once Home lets go of it": spy `window.removeEventListener`;
    open the starter, make it current, set `app.current` to no session (as `/dashboards` does),
    `answer()`, `app.releaseStarter()`; `removeEventListener` was called with `"pagehide"` and
    `"pageshow"` for the kept one. The existing "a starter opened but not yet shown when they
    arrive stays usable" still passes (no release in it).
  - "a failed catalog is asked once per app": `loadMonitorTypesResult` resolves
    `{ types: [], failed: true }`; two exits (New from starter, then the first edit); it was called
    once. The existing late-catalog test still passes unchanged. (Mock the new function where the
    file mocks `loadMonitorTypes` today.)
  - Replace the fixed 10 ms waits at about lines 171, 570 and 654 (and `app.test.ts:391`) with
    a wait on a signal: `await copy.flush()` / `await app.starterTypesReady()` /
    `await vi.waitFor(…)` on the state that would change, then the negative assertion.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/starter/exits.test.ts
  src/lib/store/app.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement**; Home calls `releaseStarter()` after its re-read and in its teardown.
- [ ] **Step 4: Run** the files, `src/routes/*.browser.test.ts` that cover Home, `npm run
  test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** — "Starter: kept starters are released, a failed catalog is asked once a
  page".

### Task 8: Edit data on the starter's Map before the types arrive (decision 18)

**Files:**
- Modify: `src/lib/get-data/map.ts` (`tickEveryTypeIfNone` split: a new `tickTypesIfNone`)
- Modify: `src/routes/GetData.svelte` (the edit open, about lines 100–122)
- Test: `src/lib/get-data/map.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`

**Interfaces:**
- Produces: `tickTypesIfNone(data: WidgetDataConfig, types: readonly string[]): void` (fills the
  air-quality layer's `monitorTypes` when it has neither monitors nor types and `types` is
  non-empty); `tickEveryTypeIfNone(data, catalog)` calls it with `everyMonitorType(catalog)`.
- Behaviour: Edit data on the starter (`at.dashboardId === STARTER_ID`) awaits
  `app.starterTypesReady()` before building the draft, then `tickTypesIfNone(initial.data, types)`;
  the baseline is the filled draft, so the fill alone isn't a change.

- [ ] **Step 1: Failing tests:** `map.test.ts` "tickTypesIfNone fills only a layer with neither
  monitors nor types"; `get-data-view.browser.test.ts` "Edit data on the starter's Map opened
  before the types arrive saves them": hold the types, open the edit route for the starter's Map,
  answer, change the range, save; the stored copy's Map layer has the types.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files, `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** — "Edit data on the starter's Map saves the catalog's types".

### Task 9: An empty typed title (decision 19)

**Files:**
- Modify: `src/lib/actions/widget.ts` (`widgetTitle`)
- Modify: `src/lib/widgets/map/MapWidget.svelte:880` (`typed`)
- Test: `src/lib/actions/widget.test.ts`, `src/lib/widgets/map/map-widget.browser.test.ts`

**Interfaces:**
- Produces: `hasTypedTitle(widget: WidgetInstance): boolean` in `src/lib/actions/widget.ts`
  (`widget.title != null && widget.title.trim() !== ""`), used by `widgetTitle` and the Map.
- The places that save a typed title already store `null` for an empty one (`normalizeName` in
  `src/lib/documents/schema.ts`); only incoming documents can carry `""`, so no save site changes.
  Record this in the spec's Build calls (Task 10).

- [ ] **Step 1: Failing tests:** `widget.test.ts` "an empty or blank title shows the generated one"
  (`""` and `"  "`); `map-widget.browser.test.ts` "a Map with an empty title keeps its map region
  label" (the region's accessible name is the generated title).
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement.** (Rename the local `app` that shadows `app()` in
  `map-widget.browser.test.ts`, T4-c, since this touches the file.)
- [ ] **Step 4: Run** both files, `npm run test:unit`. Expected: PASS.
- [ ] **Step 5: Commit** — "Widgets: an empty typed title counts as none".

### Task 10: Docs (in parallel with Tasks 4–9; docs files only)

**Files:** `DEFERRED.md`, `ARCHITECTURE.md` ("Security baseline for untrusted content"),
`docs/superpowers/specs/2026-11-23-step-6-spec-2-csp-check-design.md` (Build calls),
`docs/superpowers/specs/2026-11-23-step-6-spec-1-starter-map-design.md` (decision 11 amended),
`TODO.md`.

- [ ] **Step 1: DEFERRED.md:**
  - Add "The SDK builds its zod schemas when its modules load" (decision 1): the 2026-11-23 check
    (`lib/meta/schemas/scale.js`, `schemas.js` `allowsEval`), why A (the CSP check in CI fails
    every test on a reorder), B and C's costs; **revisit** after launch, when sdk-js next works on
    its schemas, or when the CSP check reports the probe.
  - Remove "Check the built app for zod eval violations before go-live." and "Gaps in the E2E CSP
    checks." (the first only after Task 11's run is clean).
  - From "Step 6 spec 1 review leftovers", remove the items Tasks 4–9 fix and T3-b, T3-c, T4-c and
    "No component-level test that the types swap…".
  - "CSP violations before IndexedDB opens aren't seen by the app.": add "Looked at in step 6
    spec 2: the CSP check sees bootstrap violations in the browser; the app's own reports still
    miss them."
  - Grep for "CSP", "zod", "jitless", "eval", "securitypolicyviolation" and update any other entry
    this spec settles.
- [ ] **Step 2: ARCHITECTURE.md:** the rollout gains the check (what it covers, `test:csp-stack`,
  CI) and the zod import ban's wider scope.
- [ ] **Step 3: Spec Build calls:** sign-in links dropped from the walk (they leave the app); the
  stack's starter is reached through New from starter; decision 19's save sites already store
  `null`; the `releaseStarter` mechanism for decision 15; any ledger rulings. Spec 1's decision 11
  gains "amended by step 6 spec 2 decision 12: edits show at once".
- [ ] **Step 4: TODO.md:** step 6 spec 2 status.
- [ ] **Step 5:** `npx prettier --check` the files; commit them by path — "Docs: step 6 spec 2".

### Task 11: The stack run, the results, and the finish

- [ ] **Step 1:** Message the coordinator: ask it to swap this branch's head build into
  `../sjvair.com/dist/workspace`; wait for its confirmation (and the build's commit).
- [ ] **Step 2:** Outside :40–:50, run
  `WORKSPACE_E2E_IDENTIFIER=… WORKSPACE_E2E_PASSWORD=… npm run test:csp-stack`. Expected: PASS on
  Chromium and Firefox, every step with 0 violations and no disallowed request. Then try WebKit
  through the podman image (`--network host`, `npm run test:csp-stack:webkit`); record if it
  can't reach the stack.
- [ ] **Step 3:** Any violation: stop and fix it where it belongs (spec decision 8); a host-list
  change needs the user's yes.
- [ ] **Step 4:** Write `docs/reference/csp-check-2026-11-23.md` (build commit, the header seen,
  engines, each step's count, the worker self-test per engine, what wasn't checked and why) and
  commit it with the DEFERRED removal of the zod entry.
- [ ] **Step 5:** Send the coordinator the go-live command for the deploy entry:
  `npm run test:csp-stack` with the two env vars, against the final build swapped into the stack.
- [ ] **Step 6:** `npm run build`, `npm run check:build`, `npm run check:budget` (report the
  number); final whole-branch review and one fix wave; merge `origin/step-6`; push; open the PR into
  `step-6` (no AI attribution; says the host list is unchanged, and "Testing cross-origin static
  serving before the preview." isn't fired); tell the coordinator; dispatch `e2e-full` on the final
  head and `gh run watch` it; ask the user before merging.
