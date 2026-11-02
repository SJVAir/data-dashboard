# Sync spec 2: Dashboard sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in work lives in a per-account space that saves to sjvair.com in the background,
picks up newer versions from other devices within about a minute, merges silently when it can
(layout moves never prompt), and never loses edits through sign-out, expiry, or an account change.

**Architecture:** A **sync worker** per account space sits beside `DocumentSession`, not inside
it. It treats the server like another tab: what it pulls from the server is **committed into local
storage** as log entries with the reserved tab id `SYNC_TAB`, and a `committed` message makes the
open sessions catch up through their existing fast-forward/rebase/conflict path. What it uploads is
the **unsynced changes**: local log entries after the document's `syncedThrough` that aren't
`SYNC_TAB` entries. Each document's sync state (`serverVersion`, `syncedThrough`, a hold such as a
device conflict) is a **sync record** in the reserved `syncQueue` store, written in the same
transaction as the document. A `RemoteDocuments` interface wraps the SDK; an in-memory fake
behaves like the server, and one contract test runs against both. Server I/O for a document
happens under a per-document Web Lock, so any tab can upload; one visible tab per browser holds the
poll lock and polls.

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/sdk` 4.8.0-beta.2 (`@sjvair/sdk/documents`),
IndexedDB via `idb`, Web Locks (`navigator.locks`), Vitest (unit + browser mode), Playwright,
Paraglide, zod via `$lib/zod`.

**Spec:** `docs/superpowers/specs/2026-10-28-server-backed-documents-design.md` (approved
2026-10-28): "How it works" and "The dashboard (specs 2–4)". Read both, plus "Hard rules", before
any task. Spec 2's scope (from "The split"): account spaces, the migration prompt, background
saves, polling, replay, sign-out.

## Global Constraints

- **Branch:** `sync-dashboard`, from `main` (created; the SDK pin is already moved to
  `npm:@jsr/sjvair__sdk@4.8.0-beta.2`, commit `f5964e8`). PR into `main`; never merge, release,
  or publish without the user's explicit yes, each time.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only; all UI text
  through Paraglide (`messages/en.json`), plurals as message variants, never concatenated; dates
  and times through `$lib/format` (Pacific); styling from theme tokens; `z` from `$lib/zod`;
  browser APIs (`navigator.locks`, storage) only inside `src/lib/platform/`. `npm run format`
  before each commit.
- **Timing values (from the spec):** at most **one save per document every 2 seconds** while
  editing; **immediately when the tab is hidden**; retries on `RETRY_DELAYS_MS` (reuse it from
  `document-session.svelte.ts`) and on the `online` event; polling **every 60 seconds while a tab
  is visible**, and at once on becoming visible or coming back online; hidden tabs never poll;
  identity re-check before a sync batch if the last is older than **30 seconds** (the existing
  `recheck()` throttle); hidden spaces removed after **30 days** (`RETENTION_MS`).
- **Limits:** the server refuses bodies over 1 MB and saves whose changes exceed 2 MB. The client
  caps a save's changes at `MAX_SAVE_CHANGES_CHARS = 1_500_000` (UTF-16 units, like
  `MAX_DOCUMENT_CHARS`).
- **Space ids:** `account:<user.id>` (the server's user id from the identity), `"anonymous"`
  otherwise. Every save sends that id as `account_id` and `BUILD_ID` as `build_id`.
- **Sync code stays out of the initial bundle:** `src/lib/sync/` (and the SDK documents module) is
  loaded with a dynamic `import()` only when the space is an account space. `npm run
  check:budget` must stay under 200 KB.
- **Every new message** is a Paraglide string; no generated English is stored in documents or
  sync records (holds store codes, never text).
- **Shapes are free before Release 1:** change `syncQueue` rows, `TabMessage`, and `Platform` in
  place; no version bumps for unreleased shapes. The `syncQueue` store already exists (no
  `DB_LAYOUT_VERSION` bump needed).
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.

## Calls made in this plan (check these first)

The spec leaves these to the builder or doesn't cover them; each is my call.

1. **Server changes enter local storage as `SYNC_TAB` log entries.** Unsynced = entries after
   `syncedThrough` whose `tabId !== SYNC_TAB`. This keeps the spec's two values and lets open
   tabs use their existing catch-up code unchanged.
2. **One poll per browser lists changes since a cursor** (`listDocuments({ since })`) every 60 s,
   then fetches `changes` only for documents that moved. This replaces one `changes?since=N`
   request per open dashboard. It covers both "an open dashboard" and "the dashboards list" with
   one small request per minute.
3. **The poller is one visible tab, chosen by a Web Lock** it gives up when hidden. Uploads run in
   any tab under a per-document lock.
4. **A device conflict is a hold in the sync record** (so it survives reloads and every tab sees
   it), shown with the existing three-choice `ConflictDialog`.
5. **"Use the other version" makes two saves** so the replaced version is kept as a server
   snapshot (the hard rule): first the local version with `snapshot: "conflict"`, then the
   server's content back with `snapshot: "conflict"`. The SDK's `snapshot` flag only keeps the
   version a save replaces, and "mine" was never on the server.
6. **A lost save answer is recognized:** the record notes the batch in flight; if the server's
   next version is exactly that batch, it counts as saved (no prompt, no duplicate).
7. **An oversized queue sends one `replaceDocument`** (from the server's content to the local
   one) instead of uploading in batches; true batching is deferred (it needs intermediate bodies,
   which the local log can't rebuild once server entries are interleaved).
8. **Switching spaces remounts the app** (flush every session, stop the worker, unmount,
   `initApp` for the new space, mount, go to `/`).
9. **Account spaces don't purge Recently deleted locally:** the server purges and reports the ids
   in `purged`. "Delete permanently" doesn't exist yet; its server call is spec 4.
10. **Refusals with no fix in this spec** (`too_large`, `limit_documents`, `limit_storage`,
    `invalid`) hold that document as "Only on this device", retried on the next local commit in
    the space. The Saved popover says why.
11. **Build blocked** shows a new update-notice reason, `"build-blocked"`, and stops all uploads
    until reload.

## Review Focus

1. **The answer to a save is lost** (network drops after the server accepted it). Expected: the
   next attempt sees its own batch as the server's next version, marks it saved, and neither
   prompts nor saves twice. Pinned in Task 6 (`"a save whose answer was lost counts as saved"`).
2. **The page dies between the server accepting a save and the record being updated, or between
   a pull's local write and its record.** Expected: the document and its record are written in
   one transaction, so a restart either has both or neither, and resumes. Pinned in Task 2
   (`"commit writes the sync record in the same transaction"`) and Task 6.
3. **Another tab signs out (or the session expires) while an upload is in flight.** Expected:
   the save is refused (`account_mismatch` / `unauthorized`) or aborted, nothing is lost, the space
   is hidden with its queue, and signing back in finishes the upload. Pinned in Task 9 (`"sign-out
   elsewhere mid-upload keeps the queue"`).
4. **Several tabs of one account are open.** Expected: one tab polls; two tabs never upload the
   same batch twice; every tab shows the merged result. Pinned in Task 7 (`"three tabs make one
   poll request per interval"`, `"two tabs uploading the same document make one save"`).
5. **Moving 60 anonymous dashboards into an account** (over the 50 limit). Expected: 50 upload,
   the rest stay "Only on this device" with the reason shown, nothing loops or is lost, and
   deleting one lets the next upload. Pinned in Task 10 (`"over the limit, the rest stay on this
   device"`).

---

## File map

- `src/lib/changes/overlap.ts`: layout never overlaps.
- `src/lib/platform/types.ts`, `memory.ts`, `web/storage.ts`, `web/locks.ts` (new),
  `storage-contract.ts`, `capability-contract.ts`: sync records, spaces, locks, trim floor.
- `src/lib/sync/` (new, lazy-loaded): `types.ts`, `remote.ts`, `remote-sdk.ts`, `remote-fake.ts`,
  `remote-contract.ts`, `merge.ts`, `local.ts`, `upload.ts`, `pull.ts`, `resolve.ts`,
  `worker.svelte.ts`, `load.ts` (the dynamic import).
- `src/lib/store/`: `spaces.ts` (new), `app.svelte.ts`, `tab-channel.ts`,
  `document-session.svelte.ts` (`clearHistory`), `space-switch.ts` (new).
- `src/lib/safety/purge.ts`, `reminder.ts`, `update-notice.svelte.ts`.
- `src/main.ts`: remount on space change.
- Components: `ConflictDialog.svelte`, new `RemoteDecisionDialog.svelte`,
  `MoveToAccountDialog.svelte`, `SignOutDialog.svelte`; `SavedIndicator.svelte`,
  `StorageStatus.svelte`, `AccountMenu.svelte`, `NoticeBars.svelte`, `DashboardPage.svelte`,
  `DashboardList.svelte`, `App.svelte`; `messages/en.json`.
- Tests next to each file; `e2e/sync.spec.ts`, `e2e/documents-server.ts` (new);
  `src/lib/sync/remote-stack.test.ts` (local-only).
- Docs: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`.

---

### Task 1: Layout moves never overlap

**Files:** Modify `src/lib/changes/overlap.ts`, `src/lib/changes/overlap.test.ts`,
`src/lib/changes/rebase.test.ts`; update any `cross-tab.test.ts` / `document-session.test.ts`
case that expected a layout prompt.

**Interfaces:** `changesOverlap(a, b)` keeps its signature. `setLayout` × `setLayout` → `false`;
`setLayout` × `removeWidget` (either order) → `false`. Everything else is unchanged.

- [ ] **Step 1: Write the failing tests** in `overlap.test.ts`:
  - `"two setLayouts never overlap"`: both move widget `a` to different rects → `false`; both
    minimize `a` with different orders → `false`.
  - `"setLayout against removeWidget doesn't overlap"`: in both argument orders → `false`.
  - `"removeWidget still overlaps a title change"` (unchanged rule, guards the edit).
  - In `rebase.test.ts`: `"a layout move over theirs: the last save wins"`: theirs moves `a` to
    `{0,4,6,4}`, mine moves it to `{6,0,6,4}` → `clean`, `a` at mine's rect; `"a move of a
    widget they deleted is dropped"` → `clean`, no `a`, `changes` without the move.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/changes` → FAIL.
- [ ] **Step 3:** In `changesOverlap`, return `false` for any pair where either side is
  `setLayout` and the other is `setLayout` or `removeWidget`. Delete `placementsOverlap` if
  nothing else uses it.
- [ ] **Step 4:** `npm run test:unit` → PASS; fix the store tests that asserted a layout prompt
  (they now expect a silent merge).
- [ ] **Step 5: Commit** — `git commit -m "Layout moves never overlap: the last save wins"`.

### Task 2: Storage: sync records, a trim floor, and spaces

**Files:** Modify `src/lib/platform/types.ts`, `memory.ts`, `web/storage.ts`, `web/db.ts` (the
`syncQueue` row type), `web/journal.ts`, `storage-contract.ts`. Create `src/lib/sync/types.ts`.

**Interfaces:**
- Produces (`src/lib/sync/types.ts`, imported by `platform/types.ts` as types only):
  ```ts
  /** Log entries the sync worker writes for changes that came from the server. */
  export const SYNC_TAB = "sync";
  export type SyncHold =
  	| { kind: "conflict"; serverVersion: number; reason: "overlap" | "log-gap" }
  	| { kind: "deleted-elsewhere"; serverVersion: number }
  	| { kind: "gone" }
  	| { kind: "newer"; schemaVersion: number }
  	| { kind: "moved"; to: string; through: number }
  	| { kind: "refused"; code: "too_large" | "limit_documents" | "limit_storage" | "invalid" };
  export type SyncRecord = {
  	docId: string;
  	serverVersion: number | null; // null: never uploaded
  	syncedThrough: number; // the local version included in serverVersion (0 when never)
  	confirmedAt: string | null; // when the server last accepted a save or pull
  	inFlight: { baseVersion: number | null; throughVersion: number; changes: string } | null;
  	hold: SyncHold | null;
  };
  ```
  (`inFlight.changes` is the JSON of the batch sent, for Task 6's lost-answer check.)
- Produces (`platform/types.ts`):
  ```ts
  // CommitInput gains:
  sync?: SyncRecord; // written in the same transaction as the document
  export interface SyncStateStorage {
  	get(space: SpaceId, docId: string): Promise<SyncRecord | undefined>;
  	list(space: SpaceId): Promise<SyncRecord[]>;
  	put(space: SpaceId, record: SyncRecord): Promise<void>;
  }
  export interface SpaceStorage {
  	/** Every space with anything stored (documents, preferences, records, or journal). */
  	list(): Promise<SpaceId[]>;
  	/** Everything in the space: documents, logs, originals, preferences, records, journal. */
  	remove(space: SpaceId): Promise<void>;
  	/** Documents with their logs, originals, records, and journal records; ids unchanged. */
  	move(from: SpaceId, to: SpaceId, ids: string[]): Promise<void>;
  }
  // Platform gains: sync: SyncStateStorage; spaces: SpaceStorage
  ```
  `documents.remove` also deletes the document's sync record.

- [ ] **Step 1: Write the failing contract tests** in `storage-contract.ts` (they run for memory
  and web):
  - `"commit writes the sync record in the same transaction"`: a commit with `sync` stores both;
    a commit refused for a stale base stores neither.
  - `"entries after syncedThrough are never trimmed"`: with a record at `syncedThrough: 10`,
    commit `LOG_LIMIT + 50` entries → `readLog(space, id, 10)` returns all of them; without a
    record the log trims to `LOG_LIMIT` as before.
  - `"remove deletes the sync record"`.
  - `"spaces lists, moves, and removes"`: docs in `anonymous` and `account:a`; `move` two ids
    with their logs, originals, records, and journal records; `list()` includes both spaces;
    `remove("account:a")` leaves `anonymous` untouched and `list()` drops it.
- [ ] **Step 2:** `npm run test:unit -- src/lib/platform` and `npm run test:browser --
  src/lib/platform` → FAIL.
- [ ] **Step 3: Implement** in memory and web. Web `commit` reads the record from `syncQueue` in
  its transaction (add the store to it) and trims only keys at or below `syncedThrough` beyond
  `LOG_LIMIT`. `spaces.move`/`remove` run one IndexedDB transaction over all five stores, then
  move or clear the journal records (localStorage) after it completes.
- [ ] **Step 4:** Both runs → PASS; `npm run check`.
- [ ] **Step 5: Commit** — `git commit -m "Store sync records with documents; never trim unsynced changes"`.

### Task 3: Platform locks

**Files:** Create `src/lib/platform/web/locks.ts`; modify `types.ts`, `memory.ts`,
`web/storage.ts`, `capability-contract.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface LockAccess {
  	/** Runs `fn` holding `name` (one holder per browser profile), waiting its turn. */
  	run<T>(name: string, fn: () => Promise<T>): Promise<T>;
  	/** Waits for `name`, calls `onGranted`, and holds it until `signal` aborts. */
  	hold(name: string, signal: AbortSignal, onGranted: () => void): Promise<void>;
  }
  // Platform gains: locks: LockAccess
  ```
  Web: `navigator.locks.request` (supported by every browser on the floor). Memory: an
  in-process queue per name; two memory "tabs" in a test share one platform, so they share it.

- [ ] **Step 1: Write the failing contract tests** (`capability-contract.ts`): `"run is
  exclusive per name"` (two overlapping `run`s on one name finish in order; different names run
  at once); `"hold is granted in turn and released on abort"`; `"an aborted waiter is never
  granted"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add platform locks (Web Locks on the web)"`.

### Task 4: `RemoteDocuments`: interface, SDK implementation, fake, contract

**Files:** Create `src/lib/sync/remote.ts`, `remote-sdk.ts`, `remote-fake.ts`,
`remote-contract.ts`, `remote-fake.test.ts`, `remote-stack.test.ts`; add the script
`"test:sync-stack"` to `package.json` and a line under Commands in `CLAUDE.md`.

**Interfaces:**
- Produces (`remote.ts`, camelCase; the SDK's wire names stay inside `remote-sdk.ts`):
  ```ts
  export type RemoteDocument = {
  	id: string; kind: string; name: string | null; schemaVersion: number; version: number;
  	body: unknown; deletedAt: string | null; copiedFrom: string | null;
  	createdAt: string; updatedAt: string;
  };
  export type RemoteMeta = Omit<RemoteDocument, "body">;
  export type RemoteChange = { version: number; schemaVersion: number; change: unknown };
  export type RemoteChanges =
  	| { version: number }
  	| { version: number; changes: RemoteChange[] | null; document: RemoteDocument };
  export type SaveInput = {
  	schemaVersion: number; name: string | null; body: unknown; deletedAt: string | null;
  	copiedFrom: string | null; baseVersion: number | null;
  	changes: Array<{ schemaVersion: number; change: unknown }>;
  	accountId: string; buildId: string; snapshot: "conflict" | null;
  };
  export type StaleBase = { version: number; changes: RemoteChange[] | null; document: RemoteDocument };
  /** A refusal (`code` from the SDK's `RefusalCode`); `staleBase` set for `stale_base`. */
  export class RemoteRefusal extends Error { code: RefusalCode; status: number; staleBase?: StaleBase }
  /** The server couldn't be reached, or answered with something unusable. */
  export class RemoteUnavailable extends Error {}
  export interface RemoteDocuments {
  	list(since?: string): Promise<{ documents: RemoteMeta[]; purged: string[]; cursor: string }>;
  	get(id: string): Promise<RemoteDocument>;
  	changes(id: string, since: number): Promise<RemoteChanges>;
  	save(id: string, input: SaveInput): Promise<{ version: number; updatedAt: string }>;
  }
  ```
  `createSdkRemote(opts?: { init?: RequestInit; signal?: AbortSignal }): RemoteDocuments` maps
  `DocumentRefusal` to `RemoteRefusal` (parsing `stale_base` data with the SDK's
  `staleBaseDataSchema`), and network errors, aborts, and `DocumentResponseError` to
  `RemoteUnavailable` (reporting the `DocumentResponseError` through `report`).
  `createFakeRemote(opts: { accountId: string; logLimit?: number; now?: () => Date }):
  FakeRemote`, where `FakeRemote = RemoteDocuments & { offline: boolean; signedInAs: string |
  null; blockedBuilds: Set<string>; maxDocuments: number; requests: string[]; purge(id: string):
  void; ownerOf(id: string, accountId: string): void; snapshots(id: string): Array<{ version:
  number; reason: string; body: unknown }>; trimLog(id: string): void }`. The fake imports
  nothing from `$lib` except types, so Playwright can import it (Task 13).
  Specs 3 and 4 add share, snapshots, and delete to the interface when they need them.

- [ ] **Step 1: Write the contract** `runRemoteContract(name, make, { fakeOnly })` in
  `remote-contract.ts`. Every case:
  - `"create, then get and list"`; `"a save on the current base bumps the version"`;
  - `"a stale base is refused with the changes since it and the document"`;
  - `"changes since the current version is just the version"`;
  - `"list since a cursor returns only what changed"`;
  - `"a schema downgrade is refused"` (`schema_downgrade`);
  - `"a save naming another account is refused"` (`account_mismatch`);
  - fake-only (the stack can't set these up from the client): `"a trimmed log answers null
    changes"` (stale and `changes`), `"an id owned elsewhere is id_taken"`, `"a purged id is gone
    and listed in purged"`, `"a blocked build is refused"`, `"over maxDocuments is
    limit_documents"`, `"snapshot: conflict keeps the replaced version"`, `"offline throws
    RemoteUnavailable"`.
  - In `remote-fake.test.ts`, with the SDK call stubbed to return a malformed body: `"a reported
    response error carries no document body or name"` (the spec's hard rule; assert on the memory
    platform's error reporter).
- [ ] **Step 2:** `remote-fake.test.ts` runs the contract on the fake → FAIL (module missing).
- [ ] **Step 3: Implement** `remote.ts`, `remote-fake.ts`, `remote-sdk.ts`.
- [ ] **Step 4:** Fake run → PASS. `remote-stack.test.ts` runs the non-fake-only cases with
  `createSdkRemote` when `SYNC_STACK=1`, else `describe.skip`. It signs in with
  `WORKSPACE_E2E_IDENTIFIER` / `WORKSPACE_E2E_PASSWORD` the way sdk-js's documents integration test
  does (read `../sdk-js` for the login and CSRF recipe) and passes the session cookie and token
  through `init`. `npm run test:sync-stack` = `SYNC_STACK=1 vitest run --project unit
  src/lib/sync/remote-stack.test.ts`. Run it once against the podman stack (sjvair.com
  `develop` pulled) and note the result in the PR.
- [ ] **Step 5: Commit** — `git commit -m "Add RemoteDocuments with an SDK implementation, a fake, and a contract test"`.

### Task 5: The merge rules (pure)

**Files:** Create `src/lib/sync/merge.ts`, `merge.test.ts`.

**Interfaces:**
- Consumes: `rebase`, `applyForced` (`changes/rebase.ts`), `loadDashboard`, `upgradeChanges`,
  `ChangeSchema`, `CURRENT_SCHEMA_VERSION`.
- Produces:
  ```ts
  /** The server's document as a local one at `localVersion`, upgraded; or why it can't be. */
  export function fromRemote(doc: RemoteDocument, localVersion: number):
  	{ status: "ok"; doc: Dashboard } | { status: "newer" | "invalid" };
  /** The fields of a save taken from a local document. */
  export function saveFields(doc: Dashboard): Pick<SaveInput, "schemaVersion" | "name" | "body" | "deletedAt" | "copiedFrom">;
  /** Their changes, upgraded and validated; `dropped` counts ones that couldn't be. */
  export function theirChanges(changes: RemoteChange[] | null): { changes: Change[] | null; dropped: number };
  export function sameContent(a: Dashboard, b: Dashboard): boolean; // name, body, deletedAt, copiedFrom
  export type MergeOutcome =
  	| { kind: "take-server" }
  	| { kind: "rebased"; doc: Dashboard }
  	| { kind: "conflict"; reason: "overlap" | "log-gap" }
  	| { kind: "deleted-elsewhere" };
  export function mergeRemote(input: {
  	server: Dashboard; theirs: Change[] | null; dropped: number; mine: Change[];
  }): MergeOutcome;
  ```
  Rules, in order: `mine` empty → `take-server`. `theirs` null → `conflict/log-gap` (never replay
  blindly). `dropped > 0` → `conflict/overlap`. Theirs set `deletedAt` to a time and mine has a
  change other than `setField deletedAt` → `deleted-elsewhere`. Otherwise `rebase(server, theirs,
  mine)`: conflict → `conflict/overlap`; clean → `rebased`.

- [ ] **Step 1: Write the failing tests:** `"no unsynced changes takes the server's version"`;
  `"different widgets merge silently"`; `"the same title, different values, conflicts"`; `"layout
  moves on both sides merge, mine last"`; `"a log gap with unsynced changes always conflicts"`;
  `"a change that can't be upgraded conflicts"`; `"deleted elsewhere with my edits asks"`;
  `"deleted elsewhere, mine only restores, merges"`; `"an older-format server document is
  upgraded"`; `"a newer-format server document is newer"`; `"sameContent ignores version and
  timestamps"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add the sync merge rules"`.

### Task 6: Uploading

**Files:** Create `src/lib/sync/context.ts`, `local.ts`, `upload.ts`, `upload.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // context.ts
  export type SyncContext = {
  	platform: Platform; space: `account:${string}`; accountId: string; remote: RemoteDocuments;
  	channel: TabChannel; tabId: string; buildId: string; now: () => Date;
  };
  export const docLock = (space: SpaceId, docId: string) => `sjvair-sync:${space}:${docId}`;
  // local.ts
  export type LocalState = { doc: Dashboard; raw: unknown; record: SyncRecord; unsynced: LogEntry[] };
  export function readLocal(ctx: SyncContext, docId: string): Promise<LocalState | "missing" | "newer" | "invalid">;
  /** Commits `doc` with `entries` (as SYNC_TAB) and `record`, then posts `committed`; false if a tab committed first. */
  export function writeLocal(ctx: SyncContext, from: LocalState, doc: Dashboard, theirs: Change[] | null, record: SyncRecord): Promise<boolean>;
  export const MAX_SAVE_CHANGES_CHARS = 1_500_000;
  // upload.ts
  export type UploadResult = "saved" | "nothing" | "held" | "retry" | "signed-out" | "blocked";
  export function uploadDocument(ctx: SyncContext, docId: string): Promise<UploadResult>;
  ```
  `writeLocal` writes the server's changes as one `SYNC_TAB` entry each, or (when `theirs` is
  null) one `replaceDocument` entry from the local content to the new content, so a tab with
  unsaved edits prompts rather than replaying blindly. A missing record reads as
  `{ serverVersion: null, syncedThrough: 0, confirmedAt: null, inFlight: null, hold: null }`.

  `uploadDocument` runs under `docLock`: read local; skip on a hold (except `refused`, which is
  retried) or no unsynced entries (with `serverVersion` set); `await
  platform.identity.recheck()` and return `"signed-out"` unless the identity is still the
  space's account; write `inFlight`; save (`baseVersion = serverVersion`; on create, `changes:
  []`, since the body is everything); over `MAX_SAVE_CHANGES_CHARS`, `remote.get` the server
  copy and send one `replaceDocument` instead. On success set `serverVersion`, `syncedThrough` to
  the uploaded local version, `confirmedAt`, `inFlight: null`. Refusals:
  - `stale_base`: if `inFlight` is set, the server is at `inFlight.baseVersion + 1`, and its
    changes JSON equals `inFlight.changes`, it was this save: record it as saved and go on.
    Otherwise run Task 7's `pullInto` with the refusal's data and, if it merged, save again (at
    most 3 rounds, then `"retry"`).
  - `account_mismatch`, `unauthorized`: force a re-check; `"signed-out"` (Task 9 hides the space).
  - `id_taken`: Task 8's `moveToNewId`.
  - `gone`: hold `gone` (Task 8 prompts or removes).
  - `schema_downgrade`: hold `newer` with the server's version.
  - `build_blocked`: `"blocked"`.
  - `too_large`, `limit_documents`, `limit_storage`, `invalid`: hold `refused` with the code.
  - `rate_limited`, `forbidden`, `unknown`, `RemoteUnavailable`: `"retry"` (keep `inFlight`).

- [ ] **Step 1: Write the failing tests** (memory platform + fake remote):
  - `"a new dashboard is created with its body"`; `"unsynced changes upload on the server
    base"`; `"nothing unsynced makes no request"` (`fake.requests` empty).
  - `"a save whose answer was lost counts as saved"`: the fake accepts, then the test throws
    `RemoteUnavailable` instead of returning; the next upload makes one request at most, the
    record shows the server version, and the server has one copy of each change.
  - `"a stale base merges and saves on top"`; `"a stale base that overlaps holds a conflict and
    saves nothing"`.
  - `"layout-only edits on two devices never hold"`.
  - `"each refusal sets its hold or result"` (table test over the codes above).
  - `"offline keeps everything and returns retry"`.
  - `"an oversized queue sends one replaceDocument"`.
  - `"an account change before the batch stops it"`: the memory identity switched → no save.
  - `"an upgraded but unedited document isn't pushed"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `context.ts`, `local.ts`, `upload.ts` (the
  `stale_base` merge calls `pullInto`; stub its import until Task 7 if done in order, or do Task
  7's `pullInto` first). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Upload unsynced changes, with every refusal handled"`.

### Task 7: Pulling, polling, and the worker

**Files:** Create `src/lib/sync/pull.ts`, `pull.test.ts`, `worker.svelte.ts`,
`worker.test.ts`, `load.ts`. Modify `src/lib/store/tab-channel.ts` (+ test).

**Interfaces:**
- Produces:
  ```ts
  // pull.ts
  /** Merges a server state into local storage under the doc lock. */
  export function pullInto(ctx: SyncContext, docId: string, server: { version: number; changes: RemoteChange[] | null; document: RemoteDocument }): Promise<"merged" | "held" | "unchanged">;
  /** One list-since poll: new documents, moved ones, purged ids. Saves the new cursor. */
  export function pollList(ctx: SyncContext): Promise<void>;
  /** Fetches a document that isn't stored here; false when the server doesn't have it. */
  export function fetchMissing(ctx: SyncContext, docId: string): Promise<boolean>;
  export const SYNC_CURSOR_KEY = "syncCursor";
  // tab-channel.ts: TabMessage gains
  | { type: "sync"; space: SpaceId; docId: string | null; tabId: string } // records changed
  | { type: "moved"; space: SpaceId; from: string; to: string; tabId: string }
  // worker.svelte.ts
  export type DocSyncState = { state: "synced" | "pending" | "held"; hold: SyncHold | null; confirmedAt: string | null; onServer: boolean };
  export class SyncWorker {
  	states: Record<string, DocSyncState>; // $state.raw, refreshed from records on `sync`/`committed`
  	offline: boolean; // $state: the last request couldn't reach the server
  	constructor(ctx: SyncContext);
  	start(): void; // first poll, backlog upload, poll leadership, listeners
  	stop(): void; // aborts requests and timers, releases locks
  	syncAll(): Promise<number>; // uploads everything; resolves the count still unsynced
  	unsyncedCount(): Promise<number>; // documents with unsynced changes or a hold
  	fetchMissing(docId: string): Promise<boolean>;
  	// Task 8 adds: resolve(docId: string, choice: RemoteChoice): Promise<string | null>;
  }
  // load.ts
  export function loadSyncWorker(ctx: Omit<SyncContext, "remote">): Promise<SyncWorker>; // dynamic import
  ```
  `pullInto`: read local (`newer` locally → leave it); server `fromRemote` `newer` → hold
  `newer`, no local write; `invalid` → report, hold `refused/invalid`. Then `mergeRemote` with
  `mine` = unsynced changes: `take-server` → `writeLocal` with record `{ serverVersion,
  syncedThrough: new local version }`; `rebased` → `writeLocal(rebased doc)`, `serverVersion`
  updated, `syncedThrough` unchanged (mine stay unsynced) and an upload is scheduled; `conflict`
  / `deleted-elsewhere` → hold only. Post `sync` after any record change.
  `pollList`: list since the cursor; for each meta with `version > record.serverVersion` →
  `changes(id, serverVersion)` → `pullInto`; meta not stored and not deleted more than 30 days
  ago → `get` and create locally (version 0, record synced); purged ids → no unsynced: remove
  locally; unsynced: hold `gone`.
  Worker scheduling: on a `committed` message from **this** tab for the space, upload that
  document no sooner than 2 s after its last save; on `activity` hidden, upload now; on `online`,
  `syncAll`; failures retry on `RETRY_DELAYS_MS`. Poll leadership: while visible, `locks.hold
  ("sjvair-sync-poll:<space>")`, released when hidden; the leader polls on grant, every 60 s,
  and on `online`; every tab also polls once at `start`. The leader's poll also uploads anything
  unsynced (the backlog after a crash).

- [ ] **Step 1: Write the failing tests:**
  - `pull.test.ts`: `"a newer server version fast-forwards and open tabs catch up"` (a session
    on the same memory platform shows it after the `committed` message); `"server changes rebase
    under unsynced edits, which then upload"`; `"an overlap holds and writes nothing locally"`;
    `"a log gap with no unsynced edits writes a replaceDocument entry"`; `"a newer-format server
    version holds newer and keeps the queue"`; `"a dashboard made on another device appears"`;
    `"a purged dashboard with no unsynced changes is removed quietly"`; `"a purged dashboard
    with unsynced changes holds gone"`; `"fetchMissing creates it, or answers false"`.
  - `worker.test.ts` (fake timers): `"edits upload at most every 2 seconds"`; `"hiding the tab
    uploads at once"`; `"coming online retries"`; `"a hidden tab never polls"`; `"three tabs make
    one poll request per interval"`; `"two tabs uploading the same document make one save"`;
    `"stop aborts and releases the poll lock"`.
  - `tab-channel.test.ts`: `isTabMessage` accepts the two new messages and rejects malformed ones.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Pull server versions and poll from one visible tab"`.

### Task 8: Settling device conflicts, deletes elsewhere, and moves

**Files:** Create `src/lib/sync/resolve.ts`, `resolve.test.ts`,
`src/lib/components/dialogs/RemoteDecisionDialog.svelte` (+ browser test). Modify
`ConflictDialog.svelte` (+ browser test), `document-session.svelte.ts` (`clearHistory`),
`DashboardPage.svelte` (the `moved` message), `App.svelte`, `messages/en.json`.

**Interfaces:**
- Produces:
  ```ts
  export type RemoteChoice = ConflictChoice | "restore" | "discard" | "keep-as-new";
  export function resolveHold(ctx: SyncContext, docId: string, choice: RemoteChoice): Promise<string | null>; // a new id for save-copy / keep-as-new
  export function moveToNewId(ctx: SyncContext, docId: string): Promise<string>;
  export function finishMoves(ctx: SyncContext): Promise<void>; // run on each sweep
  // DocumentSession gains:
  clearHistory(): void; // empties the undo/redo stacks
  ```
  Each choice re-fetches `changes(id, record.serverVersion)` under the doc lock, then:
  - `keep-mine` (hold `conflict`): their `removeWidget`s that overlap mine are re-added (as the
    local keep-mine does), `applyForced(server, restores + mine)`, saved on the server version
    with `snapshot: "conflict"`, written locally, record synced, hold cleared.
  - `use-other`: save the local content (one `replaceDocument` from the server content) with
    `snapshot: "conflict"`, then save the server content back (one `replaceDocument`) with
    `snapshot: "conflict"`; write the server content locally; hold cleared.
  - `save-copy`: create the local content as a new dashboard (new id, `copiedFrom` = this id,
    version 0, no record, so it uploads as a create); then this document takes the server
    version (as `use-other`, without the snapshots). Returns the copy's id.
  - `restore` (hold `deleted-elsewhere`): `setField deletedAt → null` plus mine over the server
    version, saved (`snapshot: null`).
  - `discard` (`deleted-elsewhere` or `gone`): `deleted-elsewhere` → as `use-other`; `gone` →
    remove locally.
  - `keep-as-new` (hold `gone`): the local content as a new dashboard (new id, `copiedFrom` = the
    purged id); remove the old one. Returns the new id.
  - Any refusal mid-way leaves the hold in place and throws (the dialog shows
    `m.conflict_failed()`).
  `moveToNewId` (on `id_taken`): create the copy (new id, `copiedFrom` = old id), set the old
  record's hold to `{ kind: "moved", to, through: local version }`, post `moved`.
  `finishMoves`: for each `moved` hold, apply the old document's entries after `through` (made in
  a tab that hadn't moved yet) to the new one with `applyForced`, then remove the old one.
  UI: `ConflictDialog` opens for `session.conflict` **or** a `conflict` hold on the current
  dashboard (`app.sync?.states[id]`), and calls `app.sync.resolve` for the hold (after
  `session.flush()`; `clearHistory()` after `use-other` / `save-copy`). `RemoteDecisionDialog`
  covers `deleted-elsewhere` (buttons Restore / Discard my changes) and `gone` (Keep as a new
  dashboard / Discard), with the spec's sentences as its descriptions, and closes only on a
  choice (like `ConflictDialog`). On `moved`, `DashboardPage` flushes the session and navigates
  to the new id (replace).

- [ ] **Step 1: Write the failing tests:**
  - `resolve.test.ts`: `"keep mine saves over theirs and keeps theirs as a snapshot"`; `"use the
    other keeps mine as a snapshot"` (the fake's `snapshots` has the local content); `"save as a
    copy uploads a new dashboard and takes theirs here"`; `"restore after a delete elsewhere"`;
    `"discard after a purge removes it"`; `"keep as new never reuses the purged id"`; `"a refusal
    mid-choice keeps the hold"`; `"id_taken moves to a new id and late edits follow"`.
  - Browser tests: `"a device conflict opens the three choices"`; `"deleted elsewhere offers
    restore or discard"`; `"neither dialog closes on Escape"`; axe on both.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; add the messages (exact copy for the two
  questions from the spec: "This dashboard was deleted on another device. Restore it, or discard
  your changes?" and "This dashboard was permanently deleted from your account. Keep your version
  as a new dashboard, or discard it?"). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Settle device conflicts, deletes elsewhere, purges, and id collisions"`.

### Task 9: Account spaces and switching

**Files:** Create `src/lib/store/spaces.ts`, `spaces.test.ts`, `src/lib/store/space-switch.ts`,
`space-switch.test.ts`. Modify `src/lib/platform/web/identity.ts`, `memory.ts` (identity),
`src/lib/store/app.svelte.ts` (+ `app.test.ts`), `src/main.ts`, `src/lib/safety/purge.ts`
(+ test), `src/lib/safety/update-notice.svelte.ts`, `NoticeBars.svelte`, `DashboardPage.svelte`,
`messages/en.json`.

**Interfaces:**
- Produces:
  ```ts
  // spaces.ts
  export function spaceFor(identity: Identity): SpaceId; // unknown or signed-out → "anonymous"
  export const HIDDEN_KEY = "hidden";
  export type Hidden = { at: string; reason: "signed-out" | "expired" | "switched" };
  export function hideSpace(platform: Platform, space: SpaceId, reason: Hidden["reason"], now: Date): Promise<void>; // keeps an existing reason
  export function unhideSpace(platform: Platform, space: SpaceId): Promise<void>;
  /** Removes hidden spaces older than RETENTION_MS, and signed-out ones with nothing unsynced. */
  export function tidySpaces(platform: Platform, current: SpaceId, now: Date): Promise<void>;
  export function hasUnsynced(platform: Platform, space: SpaceId): Promise<boolean>; // records + log, no network
  // space-switch.ts
  /** Calls `onSwitch(next)` once when the identity's space stops being `app.space`, after hiding it. */
  export function watchSpace(app: AppContext, onSwitch: (next: SpaceId) => void): () => void;
  // AppContext gains:
  sync: SyncWorker | null; // null in the anonymous space
  close(): Promise<void>; // flush and dispose every session, stop the worker
  // UpdateReason gains "build-blocked"
  ```
  `IdentitySource.currentSpace()` (web and memory): after `start()`, waits for the first known
  identity (the page's block answers at once; otherwise the first request, up to the existing
  timeout) and returns `spaceFor` it. `initApp`: `start()` before `currentSpace()`; in an account
  space, `unhideSpace`, `tidySpaces`, and `loadSyncWorker(...)` then `start()`. `purgeExpired`
  skips deleted documents in account spaces (the server's `purged` list removes them).
  `watchSpace`: on an identity change whose space differs, hide the old account space
  (`"expired"` when now signed out, `"switched"` for another account; a tab that signed out on
  purpose already hid it, and `hideSpace` keeps that reason), then `onSwitch`. A worker upload
  answering `"signed-out"` forces `identity.recheck({ force: true })`, which leads here.
  `main.ts`: `onSwitch` → `await app.close()`, `unmount`, `initApp`, `mount`, `tidySpaces`,
  navigate to `/`. Opening `/dashboards/:id` that isn't stored, in an account space: `await
  app.sync.fetchMissing(id)`, then open again; still missing → the existing "not here" message.

- [ ] **Step 1: Write the failing tests:**
  - `spaces.test.ts`: `"spaceFor maps identities"`; `"hiding keeps the first reason"`; `"tidy
    removes a signed-out space with nothing unsynced"`; `"tidy keeps an unsynced signed-out space
    until 30 days"`; `"tidy removes any hidden space after 30 days"`; `"tidy never touches the
    current space or anonymous"`.
  - `space-switch.test.ts` / `app.test.ts`: `"signing in elsewhere switches to the account
    space"`; `"an expired session hides the space with its queue"`; `"signing back in as the same
    person resumes and uploads"` (the fake gets the queued change); `"a different account hides
    the first and opens its own"`; `"sign-out elsewhere mid-upload keeps the queue"` (Review Focus
    3); `"the anonymous space never loads the sync code"` (no `remote-sdk` import: spy on
    `loadSyncWorker`).
  - `purge.test.ts`: `"account spaces keep Recently deleted for the server to purge"`.
  - `DashboardPage` browser test: `"a dashboard from another device opens by its link"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm run build &&
  npm run check:budget` (sync code must not be in the initial chunk).
- [ ] **Step 5: Commit** — `git commit -m "Signed-in work lives in its own account space"`.

### Task 10: "Add the dashboards made on this browser to your account?"

**Files:** Create `src/lib/sync/move-to-account.ts` (+ test),
`src/lib/components/dialogs/MoveToAccountDialog.svelte` (+ browser test). Modify `App.svelte`,
`messages/en.json`.

**Interfaces:**
- Produces:
  ```ts
  export const MOVE_OFFER_KEY = "moveOffer"; // in the account space's preferences: "yes" | "no"
  /** The anonymous dashboards to offer (Recently deleted included), or null when not to ask. */
  export function moveOffer(platform: Platform, space: `account:${string}`): Promise<{ ids: string[]; shown: number } | null>;
  export function answerMoveOffer(app: AppContext, answer: "yes" | "no"): Promise<void>;
  ```
  Ask once per account per browser, only if the anonymous space has stored dashboards (the
  starter is never stored). `shown` counts those not in Recently deleted (the number in the
  question); the move takes all `ids`. Yes → `platform.spaces.move("anonymous", space, ids)`,
  move their entries under `COPY_FINGERPRINTS_KEY` from the anonymous preferences to the
  account's, refresh the index, `app.sync.syncAll()`.
  No → only the answer is stored. The dialog can be dismissed with Escape (that's "ask again next
  time": nothing stored).

- [ ] **Step 1: Write the failing tests:** `"asks once per account"`; `"never asks with no
  anonymous dashboards"`; `"yes moves them with the same ids and uploads them"`; `"no leaves them
  signed-out"`; `"over the limit, the rest stay on this device"` (fake `maxDocuments: 50`, 60
  dashboards: 50 uploaded, 10 hold `refused/limit_documents`; after deleting one and a commit, one
  more uploads; Review Focus 5); browser: `"the question counts dashboards in words"` (one / many
  variants), axe.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Offer to move this browser's dashboards into the account"`.

### Task 11: Signing out

**Files:** Create `src/lib/components/dialogs/SignOutDialog.svelte` (+ browser test),
`src/lib/sync/sign-out.ts` (+ test). Modify `AccountMenu.svelte`, `messages/en.json`.

**Interfaces:**
- Produces:
  ```ts
  /** Flushes every session; signs out at once when nothing is unsynced, else returns the count for the dialog. */
  export function beginSignOut(app: AppContext): Promise<{ done: true } | { unsynced: number }>;
  export function finishThenSignOut(app: AppContext): Promise<boolean>; // false: still unsynced (stay signed in, say so)
  export function signOutAnyway(app: AppContext): Promise<void>;
  ```
  Every path calls `hideSpace(..., "signed-out")` before `account.signOut()`; the switch's
  `tidySpaces` then removes the space only if nothing is unsynced, so a late commit from another
  tab is kept for 30 days instead of lost. Buttons: **"Finish saving, then sign out"** and **"Sign
  out anyway"**; the description says how many dashboards have changes not yet in the account.

- [ ] **Step 1: Write the failing tests:** `"fully synced: signs out and the space is removed"`;
  `"unsynced: the dialog shows the count"`; `"finish saving signs out once everything is up"`;
  `"finish saving offline stays signed in and says so"`; `"sign out anyway hides the space; the
  next person sees the anonymous space"`; `"signing back in finishes the upload"`; browser: focus
  goes back sensibly after the dialog (WCAG 2.4.3), axe.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Sign-out never removes unsynced dashboards"`.

### Task 12: What the person sees: saved state, the reminder, the list

**Files:** Modify `SavedIndicator.svelte`, `StorageStatus.svelte` (+ browser tests),
`DashboardList.svelte` (+ test), `src/lib/safety/reminder.ts`, `NoticeBars.svelte` (+ tests),
`messages/en.json`.

**Interfaces:** consumes `app.sync?.states[id]` and `app.sync?.offline`.

- The indicator distinguishes **saved on this device** (stored, but unsynced, offline, or held)
  from **saved to your account** (`state: "synced"`); in the anonymous space it is unchanged.
  The popover adds when the account last confirmed a save (`formatDateTime` of `confirmedAt`,
  Pacific), and for a `refused` hold, why (one message per code).
- The dashboards list marks a dashboard **"Only on this device"** while `onServer` is false (the
  first upload, or a refusal).
- Backup reminder: never shown in an account space; in the anonymous space it adds **"Sign in to
  keep this safe everywhere"** with a sign-in link (`identity.signInUrl`).

- [ ] **Step 1: Write the failing tests:** `"saved to your account"` / `"saved on this device"`
  labels by state; `"the popover shows the last confirmed time in Pacific time"`; `"a refused
  dashboard says why"`; `"the list marks dashboards only on this device"`; `"no reminder in an
  account space"`; `"the anonymous reminder offers sign-in"`; colour is never the only signal (a
  text label in every state).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Show where a dashboard is saved"`.

### Task 13: End-to-end: two browsers, one offline

**Files:** Create `e2e/documents-server.ts`, `e2e/sync.spec.ts`. Modify `e2e/fixtures.ts`.

**Interfaces:** `documentsServer` fixture: one `createFakeRemote` per test, shared by every
context in it, served through `context.route("**/api/2.0/documents/**")` with the server's error
shape (`{ errors: { detail: [{ code, message }] }, data }`) and status codes. Registered after
`apiFixtures` (like `accountServer`) so it takes precedence. Tests make a second context with
`browser.newContext()` and the same fixtures, and go offline with `context.setOffline(true)`.

- [ ] **Step 1: Write the tests** (`account: maria`):
  - `"an edit on one device appears on the other"` (the second page becomes visible again → poll
    at once).
  - `"offline edits on one device and online edits on the other merge"`: A offline renames
    widget 1; B renames widget 2; A online → both titles on both, no prompt.
  - `"the same title changed on both asks on the later device; keep mine wins and theirs is a
    snapshot"` (assert on the fake's `snapshots`).
  - `"moving widgets on both devices never asks"`.
  - `"sign out with unsaved changes, sign out anyway, sign back in: the change reaches the
    server"`.
  - `"moving this browser's dashboards into the account"`.
  - `"a shared or reloaded page never shows another account's dashboards"` (A signs out; the
    page shows the anonymous space).
  - axe on each new dialog (`expectNoViolations`).
- [ ] **Step 2:** `npm run test:e2e:all` → PASS on Chromium, Firefox, WebKit.
- [ ] **Step 3: Commit** — `git commit -m "E2E: two devices syncing, one offline"`.

### Task 14: Docs, deferrals, and the hand checks

**Files:** Modify `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, `CLAUDE.md` (Commands).

- [ ] **Step 1: `ARCHITECTURE.md`**, the spec's list: two `setLayout`s never overlap and
  `setLayout` × `removeWidget` doesn't prompt ("Routing, URL state & undo"); version-skew rule 2
  covers the server ("Saving & sharing documents"); "Sign out anyway" hides an unsynced space and
  the _held for sync_ markers come off ("Accounts & anonymous use"); polling (one list-since poll
  per browser, every 60 s from a visible tab) and the permanently-deleted prompt; limits are 50
  dashboards and 25 MB without snapshots ("Recovery from a bad upgrade" item 3); other devices
  hide a deleted account's space at once and remove it within 30 days; staff never see private
  contents in the admin. Also record this plan's calls 1–11.
- [ ] **Step 2: `DEFERRED.md`:** move "Account-space behavior held for sync" and "Sign in to keep
  this safe everywhere" out (to `TODO.md` → Done) except anything not built; add a "looked at in
  sync spec 2, still deferred" note to "A starter replay can take a live tab's journal record" and
  "`rememberCopy` failing after a restore's commit"; add new entries: **uploading very large
  queues in batches** (why: needs intermediate bodies the interleaved log can't rebuild; revisit if
  a refused or replaced oversized save is ever reported) and anything else deferred while
  building, each with why and a revisit trigger.
- [ ] **Step 3: `TODO.md`:** "Start here" and "Sync track" say spec 2 is done (PR number) and
  specs 3 and 4 are next; add the hand-check recipe for the real stack (two browsers signed in as
  the `WORKSPACE_E2E_*` account against `npm run dev`, one offline in devtools).
- [ ] **Step 4:** `npm run lint && npm run check && npm run test && npm run build && npm run
  check:build && npm run check:budget` → all pass.
- [ ] **Step 5: Commit** — `git commit -m "Docs: sync spec 2 is built"`, push, and open the PR into
  `main` (no attribution). Stop: merging needs the user's yes.
