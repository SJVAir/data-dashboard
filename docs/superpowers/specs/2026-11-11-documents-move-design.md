# Moving the documents client into this repo — design

_2026-11-11. Branch `documents-move` (worktree `.worktrees/documents-move`), PR into `main`._

## Why

`@sjvair/sdk/documents` wraps sjvair.com's private `/documents/` endpoints (saved dashboards,
their change log, share links, snapshots, the public display name). The dashboard is its only
caller; the rest of the SDK is public air data. The user decided on 2026-11-11 that the module
leaves the public SDK and moves **into this repo**, not into a private package: all three repos
are public and the client ships in our JavaScript anyway, so a private package would hide
nothing and would need read tokens in CI, local dev and sjvair.com's Heroku build. Recorded in
`DEFERRED.md` → "Moving the documents SDK code out of the public `@sjvair/sdk` before go-live";
it **blocks go-live**.

The other half (removing the module from sdk-js `release/5.0.0`) is a separate sdk-js session.
Its PR holds its merge until this PR is merged into `main` and the coordinator has checked this
PR's inventory, so the logic is safe here before the SDK drops it.

## Goals

- The dashboard imports nothing from `@sjvair/sdk/documents`. `@sjvair/sdk/http` and the rest
  of the SDK are used as before; the pin stays `npm:@jsr/sjvair__sdk@5.0.0-beta.8` (exact).
- Behavior is unchanged: the same requests, the same refusal handling, the same schemas.
- **Nothing gets lost** (the user's concern): the PR carries an inventory of the module at
  sdk-js 819d152 (see "Inventory").

## Non-goals

- No changes to the client's behavior, signatures or wire names (snake_case stays at this layer;
  `remote-sdk.ts` keeps translating).
- No changes to sdk-js, map-sdk, monitor-map, mobile or sjvair.com. Anything the SDK should
  change goes to the coordinator.
- No dependency or pin changes.

## Anti-goals

- A test case or export that silently disappears.
- A copy that drifts from 819d152 beyond the mechanical changes listed below.

## Decisions

### Where it lives (the user, 2026-11-11)

A new top-level **`src/lib/api/`** holds calls to sjvair.com endpoints that **only the dashboard
uses**. Public data (monitors, HMS, regions, …) stays in `@sjvair/sdk`; `api/` never duplicates
something the SDK has, and when the dashboard needs public data the SDK lacks, the SDK gets it
(the existing "fix it in the SDK" rule). Each server area gets a subfolder; documents is the
first: **`src/lib/api/documents/`**. Code in `api/` is built on `@sjvair/sdk/http`, so origin,
credentials and request defaults still come from `configureSdk` (`src/lib/sdk-setup.ts`).
This rule is recorded in `ARCHITECTURE.md`, citing sdk-js's matching rule (sdk-js `CLAUDE.md`,
approved by the user 2026-11-11, on `feature/remove-documents` at 5008716): the public SDK covers
public data plus site-wide account features (sign-in, profile, subscriptions, alerts); an
endpoint backing only one app's own feature lives in that app, built on `@sjvair/sdk/http`, and
moves into the SDK once a second app needs it. `src/lib/api/` is the dashboard side of that
rule; keep the two worded consistently.

(Not `server/`: it reads as server-side code, which this SPA has none of. Not `documents-api`
or similar inside `src/lib/documents/`, which is the local document model.)

### File split (builder's call, agreed)

The same files as `lib/documents/` at 819d152, same names, so the inventory maps one to one:
`call.ts`, `documents.ts`, `profile.ts`, `refusal.ts`, `schema.ts`, `sharing.ts`,
`snapshots.ts`, `types.ts`, and `mod.ts` → **`index.ts`** (the barrel, same exports). Keep the
module doc comments, updated to say where the code now lives.

### Mechanical changes only

- `"$http"` → `"@sjvair/sdk/http"` (it exports `httpRequest`, `APIRequestConfig`,
  `RequestOptions`).
- Value imports of zod → `import { z } from "$lib/zod"` (it sets `jitless` for the CSP; ESLint
  already bans `"zod"`). Type-only imports (`import type * as z from "zod"`,
  `import type { infer as zinfer } from "zod"`) — whether the ESLint rule allows them, and
  whether to route them through `$lib/zod` too, is the builder's call; prefer `$lib/zod` when it
  type-checks cleanly.
- Drop the `.ts` import extensions; our style (tabs, double quotes, no trailing commas, Prettier
  + ESLint).
- Nothing else. Any other change found necessary goes in the PR description with why.

### Callers

Switch to `$lib/api/documents`: `src/lib/sync/remote-sdk.ts`, `src/lib/sync/remote.ts`,
`src/lib/sync/remote-fake.ts` (`RefusalCode` types), `src/lib/sync/remote-stack.test.ts`
(calls `getDocument`, `saveDocument`, `deleteDocument` directly). Re-check with a grep for any
others (comments included).

### Tests (builder's call, agreed)

- **`documents_test.ts`** (38 Deno cases, mocked `fetch`): port all of them to Vitest unit
  tests next to the code (`src/lib/api/documents/*.test.ts`; split by file or one file, the
  builder's call), stubbing `fetch` the way our other unit tests do (`src/test/no-network.ts`
  makes unstubbed `fetch` throw). A case that can't port as-is is adapted, not dropped; a drop
  needs a reason in the inventory. Known adaptation: the Deno tests use SDK test internals that
  aren't exported (`setEnvironmentForTests`, `http/fetch_stub_test_utils.ts`); the CSRF case
  ("saveDocument … with the form as JSON and CSRF") needs `globalThis.document`/`location`
  stubbed for the cookie and page origin instead.
- The copy was checked against the installed beta.8 (`node_modules/@sjvair/sdk/lib/documents/`):
  `refusal.ts` and `schema.ts` are identical to 819d152, the rest differ only in import
  specifiers, so copying 819d152 keeps today's behavior.
- **`mod_test.ts`** (integration against a server, 8 steps): map each step onto what
  `src/lib/sync/remote-contract.ts` (run against the stack by `remote-stack.test.ts`) already
  covers. Port only the uncovered steps, into `remote-stack.test.ts` (so they run under
  `npm run test:sync-stack`). The cookie/CSRF sign-in helper it uses already exists in
  `remote-stack.test.ts`.
- `npm run test:sync-stack` may be run with the `WORKSPACE_E2E_*` account (vars right before
  `npm`, never printed or stored).

### zod `jitless` entry in DEFERRED

`DEFERRED.md` → "The SDK builds zod schemas outside the `jitless` wrapper" **stays open,
reworded**: documents' schemas move under `$lib/zod`, but the rest of the SDK still builds its
own `z.object` schemas at load. Check the wording against what is actually still true (which SDK
modules build schemas at load) before editing.

### ESLint guard (approved by the coordinator, 2026-11-11)

Add `@sjvair/sdk/documents` to `no-restricted-imports` in `eslint.config.js`, next to the
existing `zod` entry: a `paths` entry for `@sjvair/sdk/documents` and a `patterns` entry for
`@sjvair/sdk/documents/*`, with a message pointing at `$lib/api/documents`. It stops the old
import from coming back before the SDK drops the module. Mention it in the PR.

## Inventory (goes in the PR description, and to the coordinator)

From `git -C ../sdk-js show 819d152:lib/documents/<file>`:

1. **Every export** of every file (functions, classes, types, constants, schemas — including
   ones `mod.ts` doesn't re-export, like `call.ts`'s helpers), each with its new home
   (`src/lib/api/documents/<file>.ts`, and whether `index.ts` re-exports it, matching `mod.ts`).
2. **Every test case** in `documents_test.ts` and every step in `mod_test.ts`: **ported**
   (file and test name), **already covered** (which test in `remote-contract.ts` /
   `remote-stack.test.ts`), or **dropped** (why).

Send it to the coordinator (`data-dashboard-8a`), who checks it against 819d152 before telling
sdk-js it can merge.

## Docs

- `ARCHITECTURE.md`: the `@sjvair/sdk/documents` mention (~line 2585, item 15 — its pin is also
  stale: beta.3 → beta.8) and any others; add the `src/lib/api/` rule where the code layout /
  SDK use is described.
- `DEFERRED.md`: close "Moving the documents SDK code out of the public `@sjvair/sdk` before
  go-live" for this repo's half. Per the standing rule an item leaves when done; the sdk-js half
  is tracked in sdk-js's own `DEFERRED.md`, so remove the entry here (or, if the builder finds
  something left on this side, reduce it to that). Reword the zod entry as above.
- `CLAUDE.md` mentions the SDK only generally; update it only if it names `@sjvair/sdk/documents`.
- Older plans under `docs/superpowers/plans/` are historical; leave them.
- The PR says the sdk-js half is separate.

## Done when

- No import of `@sjvair/sdk/documents` anywhere in the repo (grep).
- `npm run check`, `npm run lint`, `npm run test`, `npm run test:e2e` and
  `npm run test:sync-stack` pass; CI is green (check `gh pr checks` after pushing).
- `npm run build` then `npm run check:budget`; report the initial bundle size (it shouldn't move
  much).
- PR into `main` with the inventory; the coordinator has it. **Merging needs the user's yes**;
  tell the coordinator as soon as it merges.

## Constraints

- Work only in `.worktrees/documents-move`; never switch the main checkout's branch (the Map
  widget session uses it).
- Edit only `src/lib/api/`, the sync layer, their tests, and the docs above. Anything else: ask
  the coordinator.
- No releases, publishes or production. No AI attribution in commits or the PR.
