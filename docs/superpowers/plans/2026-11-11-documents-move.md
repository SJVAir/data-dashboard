# Documents Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy `@sjvair/sdk/documents` (sdk-js 819d152) into `src/lib/api/documents/`, switch the
dashboard to it, and prove nothing was lost.

**Architecture:** A verbatim copy (mechanical changes only) built on `@sjvair/sdk/http`; the sync
layer imports `$lib/api/documents`; an ESLint rule bars the old import.

**Tech Stack:** TypeScript, zod via `$lib/zod`, `@sjvair/sdk` `5.0.0-beta.8` (`/http`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-documents-move-design.md`

## Global Constraints

- Work only in `/home/alex/workspace/sjvair/data-dashboard/.worktrees/documents-move` (branch
  `documents-move`); never switch the main checkout's branch.
- Edit only `src/lib/api/`, `src/lib/sync/`, `eslint.config.js` (the approved guard), and the
  docs named in the spec.
- Pin stays `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.8"`; no dependency changes.
- Source: `git -C /home/alex/workspace/sjvair/sdk-js show 819d152:lib/documents/<file>`.
- Mechanical changes only: `"$http"` → `"@sjvair/sdk/http"`; zod → `$lib/zod`; no `.ts`
  extensions; `mod.ts` → `index.ts`; tabs, double quotes, no trailing commas.
- `test:sync-stack`: `WORKSPACE_E2E_IDENTIFIER=… WORKSPACE_E2E_PASSWORD=… npm run test:sync-stack`
  (vars right before npm; never print or store them).
- No AI attribution in commits or the PR. No releases, publishes or production. Merging needs
  the user's yes.

## Review Focus

- A copied file whose logic differs from 819d152 beyond the listed mechanical changes: Task 2's
  diff check (normalized `diff` against 819d152) must show only import/format lines.
- An export that `mod.ts` re-exported but `index.ts` doesn't: Task 2 adds an export-list test.
- The CSRF header missing in a real browser because the test stubs the wrong global: Task 2's
  CSRF test stubs `document.cookie` and `location.origin` (what `@sjvair/sdk/http`'s
  `environment.ts` reads), and `test:sync-stack` (Task 4) exercises real cookie+CSRF saves.
- A leftover import of `@sjvair/sdk/documents` in a comment-free spot (tests, e2e, scripts):
  Task 3's repo-wide grep and the ESLint guard.
- zod built outside `jitless`: Task 2 uses `$lib/zod` for value imports; the existing ESLint rule
  fails on `"zod"`.

---

### Task 1: Worktree setup and baseline

**Files:** none.

- [ ] **Step 1:** `npm ci` in the worktree (it has no `node_modules`).
- [ ] **Step 2:** Run `npm run check && npm run lint && npm run test`. Expected: all pass (the
      baseline). If anything fails on unchanged `main`, stop and report it.

### Task 2: Copy the module and port `documents_test.ts`

**Files:**

- Create: `src/lib/api/documents/{call,documents,profile,refusal,schema,sharing,snapshots,types,index}.ts`
- Create: `src/lib/api/documents/documents.test.ts` (one file, mirroring `documents_test.ts`)

**Interfaces:**

- Produces: `$lib/api/documents` exporting exactly what 819d152's `mod.ts` exports:
  `deleteDocument, getDocument, getDocumentChanges, listDocuments, saveDocument,
createShareLink, getDocumentCredit, getSharedDocument, getSharedDocumentChanges,
revokeShareLink, createSnapshot, getSnapshot, listSnapshots, getDocumentProfile,
updateDocumentProfile, DocumentRefusal, DocumentResponseError, isDocumentRefusal,
REFUSAL_CODES, type RefusalCode, staleBaseDataSchema`, and `export * from "./types"`.

- [ ] **Step 1: Port the tests first.** Translate all 38 `Deno.test` cases in
      `documents_test.ts` to Vitest `test(...)` with the **same names** and the same assertions
      (`assertEquals` → `toEqual`, `assertRejects` → `rejects`, `assertInstanceOf` →
      `toBeInstanceOf`). Keep its fixtures (`DOCUMENT`, `META`, `ENTRY`, `SHARED`, `FORM`,
      `SNAPSHOT_FORM`, `SNAPSHOT_META`, `refusal()`, `json()`). Replace `withStub` with: a
      `vi.stubGlobal("fetch", …)` that records `{ url: new URL(...), init }` and answers via
      `respond`; `vi.stubGlobal("document", { cookie: "sessionid=s; csrftoken=tok" })` and
      `vi.stubGlobal("location", { origin: "https://www.sjvair.com" })`; `setOrigin(ORIGIN)`
      from `@sjvair/sdk/http`; `vi.unstubAllGlobals()` in `finally`. Add one extra test,
      `"index exports what the SDK module exported"`, asserting `Object.keys(await
import("./index")).sort()` equals the runtime names in the Interfaces list above.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/api/documents`. Expected: FAIL
      (cannot resolve `./index`). (Check the unit project's name in `vitest.config.ts`.)
- [ ] **Step 3: Copy the nine files** from 819d152 with only the mechanical changes. Value zod
      imports (`import * as z from "zod"` in `schema.ts`, `snapshots.ts`) → `import { z } from
"$lib/zod"`; type-only zod imports (`call.ts`, `types.ts`) → `$lib/zod` too if `npm run
check` is clean, else keep `import type` from `"zod"` only if ESLint allows it (say which
      in the PR). Update module doc comments: replace `@sjvair/sdk/documents` in examples with
      `$lib/api/documents`, and add one line in `index.ts` saying the code was copied from
      sdk-js 819d152 (`lib/documents/`) on 2026-11-11.
- [ ] **Step 4:** Run `npx prettier --write src/lib/api` then the Step 2 command. Expected:
      39 pass.
- [ ] **Step 5: Diff check.** For each file, compare against 819d152 ignoring formatting:
      run both through `npx prettier --stdin-filepath x.ts` with this repo's config and `diff`.
      Expected: only import lines and doc-comment lines differ. Record the result for the PR.
- [ ] **Step 6:** `npm run check && npm run lint`. Expected: pass.
- [ ] **Step 7: Commit** `feat(api): copy the documents client from sdk-js 819d152`.

### Task 3: Switch callers and add the ESLint guard

**Files:**

- Modify: `src/lib/sync/remote-sdk.ts:2,30`, `src/lib/sync/remote.ts:3,8`,
  `src/lib/sync/remote-fake.ts:8`, `src/lib/sync/remote-stack.test.ts:14`
- Modify: `eslint.config.js` (the `no-restricted-imports` block holding the `zod` entry, ~line 33)

- [ ] **Step 1: Guard first.** Add to that rule's options: a `paths` entry `{ name:
"@sjvair/sdk/documents", message: 'Import from "$lib/api/documents" instead.' }` and
      `patterns: [{ group: ["@sjvair/sdk/documents/*"], message: <same> }]`. Make sure the
      rule's `ignores` (`src/lib/zod.ts`) doesn't exempt anything else, and that the block's
      `files` covers `src/**/*.ts` including tests.
- [ ] **Step 2:** `npx eslint src/lib/sync`. Expected: FAIL on the four files.
- [ ] **Step 3:** Change the four imports to `$lib/api/documents`; update the comments at
      `remote-sdk.ts:2` and `remote.ts:3` to name `$lib/api/documents`.
- [ ] **Step 4:** `grep -rn "sdk/documents" src e2e scripts vite-plugins *.ts *.js *.json
2>/dev/null`. Expected: only the ESLint
      rule's own lines.
- [ ] **Step 5:** `npm run check && npm run lint && npm run test`. Expected: pass.
- [ ] **Step 6: Commit** `refactor(sync): use $lib/api/documents; lint bars the SDK module`.

### Task 4: Map `mod_test.ts` onto the stack contract

**Files:**

- Modify: `src/lib/sync/remote-stack.test.ts` (only if a step is uncovered)

For each of the 8 steps (plus the cleanup), find the covering test in
`src/lib/sync/remote-contract.ts` (cases with `fakeOnly` gates don't count: those don't run on
the stack) and write the mapping table for the PR. Expected mapping to verify, not assume:

| `mod_test.ts` step                                                         | Likely covered by (verify)                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| signed out: listing is refused as unauthorized                             | ? (contract has "snapshots and delete need sign-in", "profile calls need sign-in"; check list)                                        |
| a reserved id is refused as invalid (400)                                  | ? likely uncovered                                                                                                                    |
| create, save, and read                                                     | "create, then get and list", "a save on the current base bumps the version", "list since a cursor…"                                   |
| changes since a version, and unchanged                                     | "changes since the current version is just the version", "a stale base is refused with the changes…"                                  |
| a save on an old base is refused as stale_base                             | "a stale base is refused with the changes since it and the document"                                                                  |
| snapshots list / keep given content as a snapshot                          | "keepSnapshot leaves the document and its version alone", "snapshots are listed newest first"                                         |
| a snapshot on an old base is stale_base; an unknown id is not_found        | "keepSnapshot on a stale base is stale_base"; not_found part ?                                                                        |
| share, read signed out, then revoke (with display name, credit)            | "create link, then anyone opens it", "credit: …", "the display name is trimmed…", "stop sharing…"                                     |
| soft delete, then permanent delete, then gone (410; `not_deleted` on live) | "delete permanently refuses a live document", "delete permanently purges a trashed document" (check it asserts `gone`/410 or similar) |

- [ ] **Step 1:** Fill the table from the code (cite exact test names). A step counts as
      covered only if the contract asserts the same refusal code (status where `mod_test` checks
      one and `RemoteRefusal` exposes it).
- [ ] **Step 2:** For each uncovered step, add a test to `remote-stack.test.ts` **outside**
      `runRemoteContract` (it's SDK-level, not contract-level), inside `if (ENABLED)`, named
      after the `mod_test.ts` step, calling `$lib/api/documents` directly with the existing
      `signedIn()` options and removing what it creates via the existing `cleanup`.
- [ ] **Step 3:** Ensure the local stack is up (`curl -s -o /dev/null -w "%{http_code}"
http://localhost:8000/`); if it isn't, ask the user. Run `npm run test:sync-stack` with
      the account vars. Expected: all pass. (Heavy work runs :40–:50 past the hour; if a run
      times out then, rerun after.)
- [ ] **Step 4:** `npm run lint`. **Commit** `test(sync): stack coverage for the documents
      client's integration steps` (skip if nothing was uncovered).

### Task 5: Docs

**Files:** `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md` (status line only, if it lists this track)

- [ ] **Step 1: ARCHITECTURE.md.** Item 15 (~line 2585): pin is `5.0.0-beta.8`; the documents
      client lives in `src/lib/api/documents/` (copied from sdk-js 819d152, 2026-11-11). Add the
      `src/lib/api/` rule where the code layout or SDK use is described (find with `grep -n
"@sjvair/sdk" ARCHITECTURE.md`): endpoints only the dashboard uses live in `src/lib/api/<area>/`,
      built on `@sjvair/sdk/http`; public data and site-wide account features (sign-in, profile,
      subscriptions, alerts) stay in `@sjvair/sdk`; `api/` never duplicates the SDK; an endpoint
      moves into the SDK once a second app needs it — the dashboard side of sdk-js's rule in its
      `CLAUDE.md` (the user, 2026-11-11). `grep -n "sdk/documents" ARCHITECTURE.md` afterwards:
      nothing stale left.
- [ ] **Step 2: DEFERRED.md.** Remove "Moving the documents SDK code out of the public
      `@sjvair/sdk` before go-live" (done on this side; sdk-js tracks its removal in its own
      `DEFERRED.md`). Reword "The SDK builds zod schemas outside the `jitless` wrapper": first
      check which SDK modules still build schemas at load (`grep -ln "z\.object" ../../node_modules/@sjvair/sdk/lib/*/*.ts | grep -v documents`), then say documents'
      schemas now build under `$lib/zod` and name what still doesn't; keep the revisit trigger.
- [ ] **Step 3:** `grep -n "documents move\|sdk/documents" TODO.md` and update this track's line
      to "in review (PR #…)" after Task 6 opens it (amend then).
- [ ] **Step 4:** `npx prettier --write ARCHITECTURE.md DEFERRED.md TODO.md && npm run lint`.
      **Commit** `docs: the documents client lives in src/lib/api/documents`.

### Task 6: Verify, PR, inventory

- [ ] **Step 1:** `npm run check && npm run lint && npm run test && npm run test:e2e`. Expected:
      all pass.
- [ ] **Step 2:** `npm run build && npm run check:build && npm run check:budget`. Record the
      initial bundle size and compare it with the latest figure on `main` (its CI budget output).
- [ ] **Step 3: Inventory** (for the PR body). (a) Every export of every 819d152 file (`grep -n
"^export" ` per file, including `call.ts`'s internal helpers) → its new file, and whether
      `index.ts` re-exports it. (b) Every `documents_test.ts` case → ported (test name in
      `src/lib/api/documents/documents.test.ts`) or adapted (what changed). (c) Every
      `mod_test.ts` step → Task 4's table (ported/covered/dropped with why). (d) Task 2's diff
      check result.
- [ ] **Step 4:** Push `documents-move`; open the PR into `main` with: summary, the ESLint
      guard, the inventory, the bundle number, a note that the sdk-js half (removing the module
      from `release/5.0.0`) is a separate PR that waits on this one. No AI attribution.
- [ ] **Step 5:** `gh pr checks <n> --watch`. Expected: green. (CI isn't on Pacific time; if a
      time test fails only there, reproduce with `TZ=America/New_York`.)
- [ ] **Step 6:** Send the coordinator (`data-dashboard-8a`, via ListAgents/SendMessage) the PR
      link and the full inventory text. Ask the user for the merge; after it merges, run
      `git cherry origin/main documents-move` (every commit landed) and tell the coordinator.
