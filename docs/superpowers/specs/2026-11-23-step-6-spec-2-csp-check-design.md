# Release 1, step 6, spec 2: the pre-go-live CSP check, and the starter's parked behaviour items

Status: brainstormed with the user 2026-11-23; checked by a fresh builder read (three questions:
one answered by the user, decision 6; two as my calls, decision 6 and "Left to the builder").
Branch `step-6-spec-2` from `step-6` (1cd53ec);
its PR goes into `step-6`.

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's,
or was decided before this spec (noted where it matters).

## Where this sits

Step 6 spec 1 (the Map in the starter, and the Lighthouse check) is merged into `step-6` (#69).
This spec does the last check step 6 has before go-live, the CSP check, and fixes the starter
behaviour items spec 1 parked (the user, 2026-11-23: "fold the behaviour items into spec 2").

## Why

- **Release 1 launches with phone-only accounts** (the user, 2026-11-23); the startup-chain LCP
  and the screen-reader check move to shortly after launch. The CSP check stays before launch.
- sjvair.com's CSP on `/workspace/*` is report-only unless `WORKSPACE_CSP_ENFORCE=1`
  (`../sjvair.com/camp/settings/base.py`), and production switches enforcement on before public
  go-live. `ARCHITECTURE.md`'s rollout is "report-only first, then enforce once clean". This
  spec is the "clean" proof that switch needs: under the enforced policy, a violation is a
  broken feature, not a report.
- The starter items are what a first-time visitor meets in their first seconds (edits that
  don't show, focus that goes missing, a Map saved with no monitor types).

## Goals

1. **A rerunnable CSP check of the production build**: every route in `src/router.ts` and every
   lazy part a person can open, every directive (not only `script-src` eval), on Chromium,
   Firefox and WebKit. It runs under the contract CSP in the E2E suite (so in CI), and once
   against the local stack's real enforced header. It reruns with one command on go-live day.
2. **The E2E CSP gaps closed** (DEFERRED "Gaps in the E2E CSP checks.").
3. **Spec 1's parked starter behaviour items fixed**, each with a test, and removed from
   DEFERRED "Step 6 spec 1 review leftovers", together with the three test items whose
   triggers these fixes fire.
4. **Any violation found is fixed where it belongs**, never by loosening the CSP without the
   user's yes.

## Non-goals

- **Changing `@sjvair/sdk`** (the user, 2026-11-23, decision 1). Lazily built SDK schemas go to
  DEFERRED for after launch.
- **T6-b** (`OnScreen` and iframes): no iframe embed is planned.
- **Cross-origin static serving** (DEFERRED "Testing cross-origin static serving before the
  preview."): files from S3 on another origin can't be tested locally; that stays a check in
  the private preview on production. Not fired by this spec.
- The startup-chain LCP and the screen-reader check (after launch).
- Anything in production, and swapping the stack's `/workspace/` build (the coordinator does
  that).

## Anti-goals

- Loosening the CSP (a new host, `'unsafe-eval'`, `'unsafe-inline'` scripts) to make a violation
  go away, without the user's yes.
- An import-order workaround here for the SDK's schemas (the fix, if ever, is in sdk-js).
- A stack run that writes anything but dashboards: no subscriptions, no alerts, no account
  changes (it may save dashboards to the local test account; the user, 2026-11-23, decision 6).
- Two lists of what the check opens that can drift apart.
- A starter that stores a copy without the catalog's monitor types (spec 1's decision 11 stays).
- Compatibility code for older saved documents (nothing is live). The document versioning code
  stays.

## Constraints

- Pins stay exact: `@sjvair/sdk` `5.0.0-beta.17`, `@sjvair/map-sdk` `0.1.0-beta.22`.
- The stack is shared: only logins and page loads, outside :40–:50, after messaging the
  coordinator. The stack's web request log isn't readable, so violations are collected in the
  browser.
- Local WebKit E2E can't start on this machine; WebKit runs in CI or `npm run test:e2e:podman`.
  CI's Firefox has no WebGL.
- Bundle: report the number (215.8 KB after spec 1; soft budget 250 KB).

## Approaches

### The SDK's schemas (decision 1)

`@sjvair/sdk` `5.0.0-beta.17` still builds `z.object` schemas when its modules load (checked
2026-11-23: for example `node_modules/@sjvair/sdk/lib/meta/schemas/scale.js`, which does
`import * as z from "zod"`). zod 4.6.7 reads `allowsEval` when an object schema is created
(`node_modules/zod/v4/core/schemas.js`, `const fastEnabled = jit && allowsEval.value`), and the
probe (`new Function("")`, `node_modules/zod/v4/core/util.js`) runs unless `jitless` is already
set. One copy of zod is installed. So the app is still clean only because `$lib/zod` runs first.

- **A. Leave the SDK as is; the CSP check in CI is the guard (picked, the user).** A reorder
  fires the probe on every page load, so every E2E test would fail before a merge.
- B. sdk-js builds its schemas lazily: robust, but about 40 modules and an export change in a
  beta right before launch. Deferred for after launch.
- C. sdk-js sets `jitless` itself: a library changing a global zod setting for the mobile app and
  monitor-map too.

### The starter's first edit during the types wait (decision 2)

- **A. Show the edit at once (picked, the user).** Edits made while the hand-off waits for the
  types show on the starter at once; storing still waits for the types. The copy is built with
  the types and the same edits are replayed onto it, so what's shown is what's stored.
- B. Store the copy at once and add the types later: breaks decision 11 and changes a person's
  dashboard behind their back.
- C. Keep the wait (spec 1's decision 11 as it was).

### How the CSP check is built (decision 3)

- **A. One shared walk, run two ways (picked, the user).** One list of steps opens every route
  and lazy part. It runs in the E2E suite against the fakes (CI), and in a new local-only
  Playwright project against the stack, beside `test:embedding`.
- B. Separate scripts per target: the lists drift.
- C. The stack only: never in CI, so a regression shows only when someone remembers to run it.

## Decisions

### The CSP check

1. **The SDK stays as is** (the user). DEFERRED gains "The SDK builds its zod schemas when its
   modules load": why (decision 1's trade-off), and **revisit** after launch, when sdk-js next
   works on its schemas, or when the CSP check reports the probe.
2. **The walk is one module** (for example `e2e/csp-walk.ts`) that both runs import. It is a list
   of named steps; each opens one route or lazy part and waits for it to settle (its content
   visible, then the network idle). Steps may make and edit dashboards (on the stack, these
   sync to the local test account; decision 6). The walk covers:
   - a first visit to the starter (fresh context, no storage), with its Map's code, workers,
     tiles, glyphs and sprites loaded (MapLibre's `blob:` workers and MapTiler). On the stack a
     signed-in `/` opens one of the test account's dashboards, not the starter (signed out,
     `/workspace/` is a 404), so there the starter is reached signed in through its own way in
     **(my call; the builder picks the route that shows it)**;
   - every route in `src/router.ts`: `/`, `/dashboards`, `/dashboards/:id`,
     `/dashboards/:id/widgets/new`, `/dashboards/:id/widgets/:widgetId/edit` (the Data Portal,
     both ways in), `/data`, `/import`, `/shared/:token`, and the trimmed paths that redirect
     (`/dashboards/:id/widgets`, `/shared`, an unknown path). The ids come from a dashboard the
     walk makes itself, so the steps don't depend on what the account already holds;
   - rendered Notes (`marked`) and the Notes editor (Lexical);
   - Show in a chart and Show in a table, from the Map;
   - fullscreen for a widget, and the dialogs a person can open from the dashboard and widget
     menus (rename, share, export, import, place picker, sign-in links), opened and closed;
   - the share page from a real share link the walk makes.
   A test fails if `ROUTE_KEYS` gains a route the walk doesn't name **(my call)**, so a new
   route can't skip the check.
3. **Every directive is reported.** The listener is added before any page script
   (`addInitScript`, as `watchCsp` does), and records the effective directive, blocked URI and
   source file. The walk also records console messages that mention the Content Security
   Policy, since some engines log a blocked worker or font only there. Any violation fails the
   run and is printed with the step it happened in.
4. **In the E2E suite and CI** (my call, the prompt asked): a new `e2e/csp-walk.spec.ts` runs
   the walk on the fakes under the contract CSP. PRs into `step-6` run it
   on Chromium (`e2e-chromium`); `e2e-full` runs it on all three engines. On Firefox in CI (no
   WebGL) the Map's steps still run and must raise no violation, but they can't prove MapLibre's
   workers start; the Chromium and WebKit runs and the stack run cover that.
5. **Against the stack:** a new project in `playwright.local.config.ts` (for example
   `csp-stack`, `testDir: "e2e-local"`, `baseURL: "http://localhost:8000/workspace/"`) and an
   `npm run test:csp-stack` script. It logs in as the test user (`WORKSPACE_E2E_IDENTIFIER`,
   `WORKSPACE_E2E_PASSWORD`, as `test:embedding` does), checks the response's
   `Content-Security-Policy` header is the enforced one (not `-Report-Only`; the stack's
   `WORKSPACE_CSP_ENFORCE` defaults to `DEBUG`, which is on), and runs every step of the walk
   on Chromium and Firefox (WebKit through the podman image if it can reach
   `localhost:8000`; if not, say so in the results, and CI's WebKit run on the fakes stands).
   The stack has no report URI, so violations come from the listener and the console only.
6. **The stack run writes only dashboards** (the user, 2026-11-23: "it can save a dashboard
   locally"). The stack is the local sjvair.com in podman, never production. The run records
   every request other than `GET` and `HEAD`, and fails on any but the login, the documents API
   (`api/2.0/documents/…`: saving, syncing and share links of the walk's own dashboards) and the
   session requests those need. Subscriptions, alerts and account changes are never touched
   (the stack sends real texts). Each run leaves its dashboard in the local test account, as
   `test:embedding` does. **(my call)** If the builder finds the app makes some other write just
   by opening a page (for example `move-to-account` on a fresh signed-in context), that's a
   finding: fixed in this spec if it's the dashboard's bug, or brought to the user, never
   allow-listed silently. Steps that only open dialogs don't confirm them.
7. **Rerunnable on go-live day:** the stack command is the one to put in the deploy entry's
   "Dashboard CSP check, before" line (the coordinator writes that line; this spec hands it the
   command). The results of this spec's run are written to `docs/reference/csp-check-<date>.md`:
   the build checked, the header seen, engines, steps, and violations (expected none).
8. **A violation found** is fixed in the dashboard, or brought to the coordinator for sdk-js,
   map-sdk or sjvair.com's `csp.py` and host list. A host-list change is made in this repo's
   `csp-hosts.json` with the user's yes, and the PR says the server's copy must match.

### The E2E CSP gaps

9. **ESLint:** the zod ban also covers `zod/*` subpaths (`patterns`) and dynamic `import("zod")`
   or `import("zod/…")` (a `no-restricted-syntax` rule on `ImportExpression`), with the same
   message; `src/lib/zod.ts` stays exempt.
10. **Contexts made with `browser.newContext()`** (`e2e/sharing.spec.ts`, `e2e/backup.spec.ts`)
    get the CSP watch: through a fixture helper the specs call to make a context, so a new spec
    can't forget it **(my call)**. The fixture's `newDevice` already watches its contexts.
11. **The "eval is blocked" self-test proves eval is caught:** it runs an `eval` from a page
    script (for example through `page.evaluate` calling a `setTimeout` with a string, or a script
    file served by the preview, not an inline script) and expects a `script-src` violation whose
    sample or source shows an eval, not an inline-script one. The inline-script test stays as a
    second self-test.

### The starter's parked behaviour items

12. **The first edit shows at once** (the user, decision 2). While a starter's hand-off waits
    for the types, each queued edit is also applied to the starter's own document, so the page
    shows it. Nothing is stored or journalled from the starter (its document is never saved).
    When the copy is stored, it's built from the template with the types and the queued edits are
    applied to it in order, as today. Undo and redo stay unavailable until the copy takes over,
    then undo reverts the edits but keeps the copy (as today). If the hand-off fails, the shown
    edits stay shown and queued (the existing save error shows), and the next edit retries, as
    today. Spec 1's decision 11 is amended in its Build calls (what's shown changes; what's
    stored doesn't).
13. **Export of the starter during the wait** exports what's shown: if the hand-off started, it
    waits for it and exports the copy's stored document (as `duplicateSource` does for
    Duplicate); if it fails, nothing is exported and the existing error shows. **(my call)**
    Share one helper between Export and Duplicate for "the starter, or its copy".
14. **"Duplicate for another place" from the starter** re-reads the place to replace from the
    source it actually copies (the starter, or its copy once handed off), after the types wait.
    If the picked place is no longer in it, the copy isn't made and the existing "no single
    place" message shows. **(my call)**
15. **A kept starter session can't leak its listeners:** a replaced starter that was kept
    (`#replaceStarter(..., keep = true)`) is discarded once it can no longer be shown: when
    another dashboard or the starter's replacement becomes current, or its hand-off finishes. A
    test checks a replaced, kept starter removes its `pagehide` and `pageshow` listeners after
    leaving for `/dashboards` before the catalog answers.
16. **Focus:**
    - A pending focus request is dropped on a browser Back or Forward (`popstate`), as it is on a
      press or key **(my call)**.
    - After a failed hand-off, the starter no longer counts as handing off: `edited` (or what the
      frame reads) is false again, so the next focus request is taken by the starter's frame.
    - Moving a starter widget from the ⋯ menu by mouse during the wait keeps focus on that
      widget's title bar (not `<body>`) until the copy shows, as the keyboard path does.
17. **During a catalog outage** the starter asks once per page: a failed load (an error, which
    is reported) is kept as an empty list for the page's life, so later exits and starter builds
    don't wait again and only one failure report is sent; a reload asks again. A late load (no
    answer in `CATALOG_WAIT_MS`) is still asked again by the next exit, as today, so a slow
    connection still gets its types **(my call)**. A new Map's add keeps its own ask, unchanged.
18. **Edit data opened on the starter's Map before the types arrive** stores the catalog's types:
    saving waits for the types and fills them into a Map layer whose types the person didn't
    set, the same as the hand-off does **(my call: the builder picks the exact point, the draft
    or the save, as long as the stored Map has the types)**.
19. **An empty typed Map title** counts as no title: an empty or whitespace-only `title` shows
    the generated title, and the map's region label is kept. **(my call)** The rule goes in
    `widgetTitle` (so every widget type gets it) and the Map's title, and the places that save
    a typed title store `null` for an empty one. The schema stays as it is.

### Test items whose triggers fire

20. **A component-level test that the types swap keeps focus and fullscreen** (decision 10 of
    spec 1).
21. **The two starter negatives that wait 10 ms** ("New from starter", "an edited starter isn't
    swapped") wait on a signal instead.
22. **A test that Export of an ordinary dashboard doesn't start the catalog load.**
23. The other test-only and nit items in "Step 6 spec 1 review leftovers" stay unless the change
    touches their files; if it does, they're done with it (their triggers say so).

## DEFERRED.md entries this spec touches

- **Done and removed:** "Check the built app for zod eval violations before go-live." (its
  "Why it's safe today" re-checked for `5.0.0-beta.17` moves into the new SDK entry); "Gaps in
  the E2E CSP checks."; the behaviour items and test items 20–22 from "Step 6 spec 1 review
  leftovers".
- **Added:** "The SDK builds its zod schemas when its modules load" (decision 1).
- **Looked at, noted "Looked at in step 6 spec 2":** "CSP violations before IndexedDB opens
  aren't seen by the app." (the stack run catches bootstrap violations in the browser, but the
  app's own reports still miss them); "Spec 5a polish"'s host-list item if `csp-hosts.test.ts` or
  `scripts/check-build-output.mjs` is touched.
- **Not fired, said so in the PR:** "Testing cross-origin static serving before the preview."
- **The deploy entry's** "Dashboard CSP check, before" line: the coordinator rewrites it with
  the stack command (decision 7).
- **The builder greps on the day** for "CSP", "zod", "jitless", "eval" and
  "securitypolicyviolation", in case a session renamed an entry.

## Testing

- The walk in the E2E suite: Chromium locally and on PRs, all three engines in `e2e-full`.
- The stack run: once, against the build the coordinator swaps in (this branch's head), outside
  :40–:50, with the results in `docs/reference/`.
- Unit and browser tests for decisions 12–22, each written to fail first.
- Per task: focused tests for the touched files plus `npm run test:unit`. The full browser and
  E2E suites at tasks that change E2E paths and once at the end; `e2e-full` dispatched early on
  an intermediate head (the Map on CI's Firefox), and on the final head before the merge.

## Left to the builder

- The walk's exact steps, helpers and names, and how a step waits to settle.
- How the console is read per engine for CSP messages.
- Where the "shown but not stored" edits live in `DocumentSession` (decision 12), as long as the
  copy gets the same edits once, in order.
- How the stack project logs in (reuse `e2e-local`'s embedding login if it fits).
- The stack's build carries the real MapTiler key (checked 2026-11-23 without printing it: the
  key in the main checkout's `.env` is in `../sjvair.com/dist/workspace`). If a build the
  coordinator swaps in has no key, the results file says the Map's tiles weren't checked.
- Whether the podman image can reach the stack for WebKit.

## Build calls

- **Sign-in links are dropped from the walk.** They leave the app (to sjvair.com's own pages), so
  the walk has nothing to check there.
- **The stack's starter is reached through New from starter,** not by opening the root route.
- **Decision 19's save sites already store `null`.** `normalizeName` in
  `src/lib/documents/schema.ts` returns `null` for an empty or whitespace-only name, so the
  places that save a typed title need no change.
- **Decision 17 is refined:** a late catalog (no answer in `CATALOG_WAIT_MS`) is still asked
  again by the next exit; only a failed load is kept as an empty list for the page's life.
