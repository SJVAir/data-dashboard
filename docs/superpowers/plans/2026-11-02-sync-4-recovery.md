# Sync spec 4: Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can get back what sync could otherwise lose. "Restore an earlier
version" lists the server's snapshots next to the local kept original. Recently deleted is the
account's trash: "Delete now" really deletes on the server, and a restore on any device brings the
dashboard back. A deleted account leaves nothing behind in the browser where it was deleted.

**Architecture:** Builds on sync spec 2 (`src/lib/sync/`, `ARCHITECTURE.md` → "How the dashboard
syncs") and on spec 3 (live share links, on `main` since PR #26), which extended the same
server layer. Each new server call
goes through `RemoteDocuments` (SDK implementation, fake, shared contract, E2E mock). The new
sync-side logic lives in two small lazy modules, `versions.ts` (list, fetch, and keep snapshots)
and `trash.ts` (permanent delete). They run under the existing per-document lock, and the
`SyncWorker` exposes them like `fetchMissing`. The UI stays in the initial bundle and reaches them
only through `app.sync`, which is `null` in the anonymous space. In the anonymous space everything
behaves as it does today. "Account gone" adds one optional field, `deletedAccount`, to the page's
`sjvair-identity` block. sjvair.com fills it once after an account deletion, and the dashboard
then removes that account's space at once.

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/sdk` 4.8.0-beta.3 (`@sjvair/sdk/documents`:
`listSnapshots`, `getSnapshot`, `deleteDocument`, all already published), IndexedDB via the
platform adapter, Web Locks, Vitest (unit + browser mode), Playwright, Paraglide, zod via
`$lib/zod`.

**Spec:** `docs/superpowers/specs/2026-10-28-server-backed-documents-design.md` (approved
2026-10-28). Read "Hard rules" → "Never lose a teacher's edits", "Recovery", "The split", and "The
dashboard (specs 2–4)", plus `ARCHITECTURE.md` → "Recovery from a bad upgrade or sync bug",
"Accounts & anonymous use" → account deletion, and "How the dashboard syncs", before any task.
Spec 4's scope (from "The split"): server snapshots in "Restore an earlier version", synced
Recently deleted, and "account gone". (The bad-build block list was built in spec 2: call 11.)

## Shared with spec 3

Spec 3 (live share links) is on `main` (PR #26, merged 2026-11-03), and this plan was checked
against its code on 2026-11-03. Spec 4 adds to what spec 3 left, all in **Task 1**:

- `src/lib/sync/remote.ts`: types `SnapshotReason`, `RemoteSnapshotMeta`, `RemoteSnapshot`;
  `RemoteDocuments` gains `listSnapshots`, `getSnapshot`, `deletePermanently`.
- `remote-sdk.ts` (the three SDK calls), `remote-fake.ts` (snapshot ids and dates, the server's
  daily-snapshot rule, 30-day snapshot expiry, permanent delete with `not_deleted`),
  `remote-contract.ts` (a "recovery" group; `runRemoteContract` already takes a signed-out
  caller, `makeSignedOut`, and has a "fake only" group after `if (!options.fakeOnly) return;`),
  `remote-stack.test.ts` (runs the new cases with no change to its setup).
- `worker.svelte.ts`: the `track`-wrapped remote the worker builds lists every
  `RemoteDocuments` method by name; add the three new ones there.
- `e2e/documents-server.ts`: three rows in the `ROUTES` table, for `GET <id>/snapshots/`,
  `GET <id>/snapshots/<n>/`, and `DELETE <id>/`.
- Any `SyncRecord` literal spec 4 writes sets spec 3's `shareToken` field (or uses
  `emptyRecord`). Every server call in the new modules goes through `remoteCall(call,
  operation)` (upload.ts), which since spec 3 takes the operation name its error reports use.

## Global Constraints

- **Branch:** `sync-recovery`, from `main` (fetch first and check `main` matches
  `origin/main`). PR into `main`. Never merge, release, or publish without the user's
  explicit yes, each time.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only; all UI text
  through Paraglide (`messages/en.json`), never concatenated; dates and times through `$lib/format`
  (Pacific); styling from theme tokens; `z` from `$lib/zod`; browser APIs only inside
  `src/lib/platform/`. Run `npm run format` before each commit.
- **Values from the spec and server:** snapshots are kept **30 days**
  (`DOCUMENTS_SNAPSHOT_DAYS`); the trash is purged **30 days** after `deleted_at`
  (`DOCUMENTS_TRASH_DAYS`); a daily snapshot is taken by **the first save of each Pacific day**
  unless a `daily` or `schema` one exists from that day (conflict snapshots don't count); snapshot
  reasons are `schema`, `daily`, `conflict`; the snapshot list is **newest first**
  (`created_at` desc, then `id` desc); `DELETE documents/<id>/` refuses a document not in the
  trash with **`not_deleted` (409)**, answers `204` otherwise, and the server then answers `gone`
  (410) for that id and lists it in `purged`.
- **Sync code stays out of the initial bundle:** `versions.ts` and `trash.ts` load only through the
  worker (`src/lib/sync/load.ts`). `npm run check:budget` stays under 200 KB.
- **Shapes are free before Release 1:** change `Hidden`, the identity block schema, and
  `RemoteDocuments` in place; no version bumps.
- **Hosting contract changes go through this repo** (`ARCHITECTURE.md` → "Template embedding"):
  the `sjvair-identity` block's new optional `deletedAccount` is recorded in
  `docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` → "Hosting contract".
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.
  This plan's four (calls 1, 2, 4, 6) were added to `DEFERRED.md` → "Documents & saving" with
  the plan.
- **Outside this repo:** the "account gone" signal needs a small sjvair.com change into `develop`
  with its own approved plan (see "The sjvair.com change" below). Task 5 builds and tests the
  dashboard side against the block text alone, so it doesn't wait on it. Only the hand check does.

## Calls made in this plan

Item 6 was decided with the user on 2026-11-02. The rest are my calls; check them first.

1. **Restoring keeps the replaced version on the server first.** In an account space, before
   the restore's `replaceDocument` is applied, the current local content is kept with
   `keepSnapshot` (a `conflict` snapshot at the record's `serverVersion`). This is
   `ARCHITECTURE.md`'s "keeps the replaced one as a snapshot", so a restore can be undone after a
   reload too. If the keep fails (offline, refused), nothing is restored and the dialog says why.
   A document never uploaded (`serverVersion: null`) skips the keep; its local log still holds the
   replaced version.
2. **The list shows every earlier version, with no merging.** The local kept original and the
   server's `schema` snapshot can hold the same content. Both are listed, each labelled with its
   source, newest first, with date and time (a day can have a `daily` and a `conflict` snapshot).
3. **Offline, the dialog still lists the local original** and says the account's versions can't
   be loaded right now. The menu item shows for a stored, editable dashboard that is on the
   server (the worker's `states[id].onServer`) or has a kept original; a dashboard that never
   synced has no server versions, so it shows only with a kept original, as in the anonymous
   space today.
4. **"Delete now" in an account space needs the server.** It's destructive and rare, so it isn't
   queued offline: it says it couldn't reach the account and leaves the dashboard in Recently
   deleted. A dashboard never uploaded is removed locally with no request. The button keeps its
   label, "Delete now"; the account-space confirmation says it is removed from every device. A
   shared dashboard's link already stops opening while it's in Recently deleted (spec 3);
   "Delete now" ends it for good.
5. **"Delete now" uploads first, like spec 3's Share** (`shareDocument`): it uploads anything
   pending (so this device's delete reaches the server, merging with whatever another device
   did), then reads the dashboard again. If it's no longer deleted, another device restored it,
   and it stops and says so. If it's held, it stops (not saved). Otherwise it sends `DELETE`. A
   `not_deleted` answer then means a restore landed in between, and it says restored elsewhere.
6. **Account gone, in the browser where it was deleted:** sjvair.com's delete view leaves the old
   account id in the new signed-out session, and the workspace page passes it once as
   `deletedAccount` in the `sjvair-identity` block. The dashboard marks that space hidden with a
   new reason, `"deleted"`, which `tidySpaces` removes at once (no 30-day wait, unsynced changes
   included: the person chose to delete the account and was offered a download). _Decided with the
   user, 2026-11-02, over treating this browser like every other device._ Other devices keep spec
   2's behaviour: a 401 hides the space at once and removes it within 30 days.
7. **`markDeleted` overrides an earlier reason**, unlike `hideSpace`, which keeps the first.
   Another tab of the deleted account may already have hidden the space as `"expired"`.

## Review Focus

1. **Restoring while another device has just saved** (the record's `serverVersion` is stale, so
   `keepSnapshot` answers `stale_base`). Expected: the newer server version is pulled in, the
   merged current content is what gets kept, then the restore applies; nothing is lost and no
   prompt appears unless the pull itself conflicts. Pinned in Task 2 (`"a stale base pulls, then
   keeps the merged content"`).
2. **Offline, or the account unreachable, when restoring.** Expected: the dialog still lists the
   local original, says the account's versions can't be loaded, and a restore that can't keep the
   replaced version changes nothing and says so. Pinned in Task 3 (`"offline lists the local
   original and says the account is unreachable"`, `"a failed keep restores nothing"`).
3. **"Delete now" on a dashboard that another device restored a moment ago.** Expected: nothing is
   deleted anywhere; the dashboard comes back to the list with a message. Pinned in Task 4 (`"a
   dashboard restored elsewhere is not deleted"`, and `"a restore between the upload and the
   delete is not deleted"` for the `not_deleted` race).
4. **"Delete now" on a dashboard whose delete was made offline and never uploaded.** Expected: the
   delete uploads first, then the server purges it, and other devices drop it quietly on their next
   poll. Pinned in Task 4 (`"an unsynced delete uploads, then purges"`) and Task 6.
5. **The "account deleted" signal in a browser with two tabs open on that account, or a browser
   that never had it.** Expected: the space is removed once no tab holds it (the open tab's 401
   switches it away first), and an unknown id is a no-op. Pinned in Task 5 (`"a held space is
   removed after its tab switches away"`, `"an unknown deleted account changes nothing"`).

---

## File map

- `src/lib/sync/`: `remote.ts`, `remote-sdk.ts`, `remote-fake.ts`, `remote-contract.ts`,
  `remote-fake.test.ts`, `remote-stack.test.ts` (Task 1); `versions.ts` (+ test, new; Task 2);
  `trash.ts` (+ test, new; Task 4); `worker.svelte.ts` (Tasks 2, 4).
- `src/lib/safety/restore-version.ts` (+ test), `src/lib/components/dialogs/RestoreVersionDialog.svelte`
  (+ browser test), `src/lib/actions/dashboard.ts` (Task 3).
- `src/lib/components/dashboard/RecentlyDeleted.svelte` (+ browser test) (Task 4).
- `src/lib/account/identity.ts`, `src/lib/platform/types.ts`, `web/identity.ts`, `memory.ts`,
  `src/lib/store/spaces.ts`, `src/lib/store/app.svelte.ts` (+ tests) (Task 5).
- `messages/en.json` (Tasks 3, 4).
- `e2e/documents-server.ts` (Task 1), `e2e/recovery.spec.ts` (new; Task 6).
- Docs: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, the 5a design's "Hosting contract" (Task 7).

---

### Task 1: `RemoteDocuments`: snapshots and permanent delete

**Files:** Modify `src/lib/sync/remote.ts`, `remote-sdk.ts`, `remote-fake.ts`,
`remote-contract.ts`, `remote-fake.test.ts`, `worker.svelte.ts` (the `track`-wrapped remote),
`e2e/documents-server.ts`. `remote-stack.test.ts` needs no change (it runs the contract as is).

**Interfaces:**
- Produces (`remote.ts`):
  ```ts
  export type SnapshotReason = "schema" | "daily" | "conflict";
  export type RemoteSnapshotMeta = {
  	id: number; version: number; schemaVersion: number; reason: SnapshotReason; createdAt: string;
  };
  export type RemoteSnapshot = {
  	id: number; version: number; schemaVersion: number; name: string | null; body: unknown;
  	createdAt: string;
  };
  // RemoteDocuments gains:
  /** The document's snapshots, newest first, without bodies. */
  listSnapshots(id: string): Promise<RemoteSnapshotMeta[]>;
  getSnapshot(id: string, snapshotId: number): Promise<RemoteSnapshot>;
  /** Purges a trashed document; `not_deleted` when it isn't in the trash. */
  deletePermanently(id: string): Promise<void>;
  ```
  `remote-sdk.ts` maps `listSnapshots`, `getSnapshot`, `deleteDocument` (operations
  `documents.listSnapshots`, `documents.getSnapshot`, `documents.deletePermanently`) through the
  existing `call` wrapper.
- Fake (`remote-fake.ts`): each stored snapshot gains `id` (one counter per fake), `createdAt`,
  `schemaVersion`, and `name`. The `snapshots(id)` helper returns those rows, oldest first, as
  today. `save` on an existing document applies the server's `reason_for` order: `schema` if the
  schema goes up, else `conflict` if `snapshot: "conflict"`, else `daily` if no non-`conflict`
  snapshot was created since the start of the current Pacific day (compute the day with
  `Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })`; no `$lib` import).
  `listSnapshots` and `getSnapshot` leave out snapshots older than 30 days (by `now()`).
  `deletePermanently`: `owned()` (so `gone` / `not_found`), then `not_deleted` (409) when
  `deletedAt` is null, else the same as `purge(id)`. Request labels: `"listSnapshots <id>"`,
  `"getSnapshot <id> <n>"`, `"delete <id>"` (add them to the `requests` doc comment). Update the
  header comment, which today reads "Not modelled: daily snapshots and the snapshot storage cap."
  (now only the cap).

- [ ] **Step 1: Write the failing contract cases** in a "recovery" group of
  `runRemoteContract`, next to the "sharing" group (run on the fake and on the stack). Cases
  marked fake-only go in the existing "fake only" group instead:
  - `"the first save of the day keeps the version it replaces"`: create (v1), save (v2) →
    `listSnapshots` has one row, `reason: "daily"`, `version: 1`; `getSnapshot` of it has v1's
    name and body.
  - `"a second save the same day keeps no more"`: a third save → still one row.
  - `"a conflict snapshot doesn't count as the day's"` (fake-only: needs a clock): save with
    `snapshot: "conflict"` first in a new day, then a plain save → rows `daily` and `conflict`.
  - `"snapshots are listed newest first"`.
  - `"snapshots older than 30 days are gone"` (fake-only): advance `now` by 31 days → `[]`.
  - `"delete permanently purges a trashed document"`: save with `deletedAt` set, then
    `deletePermanently` → `get` is refused `gone`, and `list(cursor)` has the id in `purged`.
  - `"delete permanently refuses a live document"`: → `RemoteRefusal` `not_deleted`, status 409;
    `get` still works.
  - `"delete permanently of someone else's or a missing id is not_found"`.
  - `"getSnapshot of a missing snapshot is not_found"`.
  - `"snapshots and delete need sign-in"`: through `signedOut`, `listSnapshots`, `getSnapshot`,
    and `deletePermanently` are each refused `unauthorized` (401).
  - `"delete permanently ends a shared dashboard's link"`: share, trash, `deletePermanently` →
    `signedOut.shared(token)` is `not_found`, and so is `credit(id)`.
  - Existing fake tests that compare `fake.snapshots(id)` rows with `toEqual` move to
    `toMatchObject`, and any that counted snapshots filter by `reason: "conflict"` (saves now
    also take daily ones).
- [ ] **Step 2:** `npx vitest run --project unit src/lib/sync/remote-fake.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `remote.ts`, `remote-sdk.ts`, `remote-fake.ts`, and add
  `listSnapshots`, `getSnapshot`, `deletePermanently` to the worker's `track`-wrapped remote. In
  `e2e/documents-server.ts`, add rows to `ROUTES` (before the `GET`/`PUT ^([^/]+)\/$` rows, with
  the other `<id>/…` paths):
  `GET <id>/snapshots/` → `{ data: [{ id, version, schema_version, reason, created_at }] }`;
  `GET <id>/snapshots/<n>/` → `{ data: { id, version, schema_version, name, body, created_at } }`;
  `DELETE <id>/` → `204` (no body). The POST `snapshots/` row answers the fake's new row (real
  `id` and `created_at`) instead of counting.
- [ ] **Step 4:** Fake run → PASS; `npm run check`. Run `npm run test:sync-stack` once against
  the podman stack (sjvair.com `develop`) and note the result in the PR.
- [ ] **Step 5: Commit** — `git commit -m "Add snapshots and permanent delete to RemoteDocuments"`.

### Task 2: Server versions, kept before a restore

**Files:** Create `src/lib/sync/versions.ts`, `versions.test.ts`. Modify `worker.svelte.ts`
(+ `worker.test.ts`).

**Interfaces:**
- Consumes: `docLock`, `readLocal`, `saveFields` (merge.ts), `pullIntoLocked` (pull.ts),
  `remoteCall` (upload.ts), Task 1's remote calls.
- Produces:
  ```ts
  // versions.ts
  /** The server's snapshots of `docId`, newest first; [] when it was never uploaded. */
  export function serverVersions(ctx: SyncContext, docId: string): Promise<RemoteSnapshotMeta[]>;
  export function serverVersion(ctx: SyncContext, docId: string, snapshotId: number): Promise<RemoteSnapshot>;
  /**
   * Keeps the document's current local content as a `conflict` snapshot (call 1), under the doc
   * lock. "not-on-server" when it was never uploaded. On `stale_base`, pulls the refusal's state
   * in (`pullIntoLocked`) and keeps the merged content once more; a pull that holds the
   * document throws `RemoteRefusal("stale_base")`.
   */
  export function keepBeforeRestore(ctx: SyncContext, docId: string): Promise<"kept" | "not-on-server">;
  // SyncWorker gains (delegating, like fetchMissing):
  versions(docId: string): Promise<RemoteSnapshotMeta[]>;
  version(docId: string, snapshotId: number): Promise<RemoteSnapshot>;
  keepBeforeRestore(docId: string): Promise<"kept" | "not-on-server">;
  ```
  Each throws `RemoteUnavailable` / `RemoteRefusal` as the remote does. `keepBeforeRestore`
  sends `baseVersion: record.serverVersion`, the local `name`, `body`, `schemaVersion`, the
  context's `accountId` and `buildId`. A `gone` refusal sets the `gone` hold, as an upload does.
  Server calls go through `remoteCall` with the operation `"sync-versions"` (list and fetch) or
  `"sync-keep"` (the keep).

- [ ] **Step 1: Write the failing tests** (`versions.test.ts`, memory platform + fake remote, via
  `setupSync`):
  - `"lists the server's snapshots newest first"`; `"a dashboard never uploaded has none and makes
    no request"` (`fake.requests` empty).
  - `"keeps the current local content, unsynced edits included"`: an edit not yet uploaded → the
    fake's last snapshot body has it, `reason: "conflict"`, `version` = the record's
    `serverVersion`; the document's server version is unchanged.
  - `"a stale base pulls, then keeps the merged content"` (Review Focus 1): `otherDevice` saves a
    title on another widget → `keepBeforeRestore` resolves `"kept"`, the kept body has both
    titles, the local document has the other device's title.
  - `"a stale base that conflicts holds and keeps nothing"`.
  - `"offline throws RemoteUnavailable and keeps nothing"`.
  - `worker.test.ts`: `"the worker's recovery calls run under the document lock"` (a concurrent
    upload of the same document waits for `keepBeforeRestore`).
- [ ] **Step 2:** `npx vitest run --project unit src/lib/sync/versions.test.ts
  src/lib/sync/worker.test.ts` → FAIL.
- [ ] **Step 3:** Implement `versions.ts` and the worker methods.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Read server snapshots and keep the current version before a restore"`.

### Task 3: "Restore an earlier version" lists local and server versions

**Files:** Modify `src/lib/safety/restore-version.ts` (+ `restore-version.test.ts`),
`src/lib/components/dialogs/RestoreVersionDialog.svelte` (+ `restore-version.browser.test.ts`),
`src/lib/actions/dashboard.ts`, `messages/en.json`.

**Interfaces:**
- Consumes: `app.sync` (Task 2), `fromRemote` (merge.ts) for upgrading a server snapshot,
  `loadDashboard` for the local original.
- Produces (`restore-version.ts`; `restoreOriginal` is replaced):
  ```ts
  export type EarlierVersion =
  	| { source: "local"; at: string } // the kept original's keptAt
  	| { source: "server"; at: string; id: number; reason: SnapshotReason };
  export type EarlierVersions = { versions: EarlierVersion[]; accountUnreachable: boolean };
  /** Newest first. `accountUnreachable` when the server list couldn't be loaded. */
  export function listEarlierVersions(app: AppContext, session: DocumentSession): Promise<EarlierVersions>;
  export type RestoreResult = "restored" | "unreadable" | "newer" | "unreachable" | "read-only";
  /**
   * Loads the version, keeps the current one on the server (account spaces), then applies one
   * `replaceDocument` change (undoable; it syncs like any edit).
   */
  export function restoreEarlierVersion(
  	app: AppContext, session: DocumentSession, version: EarlierVersion, chain?: Migration[]
  ): Promise<RestoreResult>;
  // RestoreVersionDialog.svelte (module): openRestoreVersion(load: () => Promise<EarlierVersions>,
  //   restore: (v: EarlierVersion) => Promise<RestoreResult>): void
  ```
  Order inside `restoreEarlierVersion`: `session.readOnly` → `"read-only"`; `await
  session.flush()`; load the chosen content (a server snapshot through `app.sync.version`, built
  into a `RemoteDocument` from the current document's id, kind, `copiedFrom`, and dates, with
  `deletedAt: null`, then `fromRemote`; `"newer"` / `"invalid"` → `"newer"` / `"unreadable"`);
  then `app.sync?.keepBeforeRestore` (any throw → `"unreachable"`, nothing applied); then
  `session.apply({ op: "replaceDocument", target: {}, from: { name, body } of session.doc, to: the
  loaded name and body })`.
- Dialog: a `<fieldset>` with a `<legend>` and one native radio per version (the standard
  accessible single-choice pattern; no new UI dependency), newest selected first, then
  **Restore**. It shows a loading line while `load` runs, the `accountUnreachable` line under the
  list when set, `restore_version_none` when the list is empty, and the result's message in the
  existing `role="alert"` paragraph. It closes only on `"restored"` (toast `restore_version_done`).
- Menu (`dashboardActions`): `restorable` = the open dashboard is stored and editable, and either
  `session.hasOriginal` or `app.sync?.states[id]?.onServer` (call 3).
- Messages (exact keys; wording is revisited in the design pass): replace `restore_version_item`
  with `restore_version_local` "{date}: before an app update (kept on this device)",
  `restore_version_schema` "{date}: before an app update", `restore_version_daily` "{date}: before
  that day's first change", `restore_version_conflict` "{date}: set aside when settling a conflict
  or restoring"; add `restore_version_legend` "Choose a version", `restore_version_loading`
  "Loading earlier versions…", `restore_version_none` "No earlier versions yet. Your account keeps
  one a day for 30 days.", `restore_version_account_unreachable` "Earlier versions saved in your
  account can't be loaded right now.", `restore_version_unreachable` "Couldn't reach your account,
  so nothing was restored. Check your connection and try again.", `restore_version_newer` "That
  version was saved by a newer version of the app. Reload to restore it." `{date}` is
  `formatDateTime` (Pacific).

- [ ] **Step 1: Write the failing tests:**
  - `restore-version.test.ts`: `"lists the local original and server snapshots newest first"`;
    `"the anonymous space lists only the local original and asks no server"`; `"offline lists the
    local original and says the account is unreachable"` (Review Focus 2); `"restoring a server
    snapshot replaces the content as one undoable change"` (undo brings the old content back);
    `"restoring keeps the replaced version on the server first"` (the fake's newest `conflict`
    snapshot holds the content before the restore); `"a failed keep restores nothing"` (fake
    offline after listing → `"unreachable"`, document unchanged; Review Focus 2); `"an
    older-format snapshot is upgraded"`; `"a newer-format snapshot is refused as newer"`.
  - Browser test: `"the versions are radios with dates in Pacific time"`; `"Restore applies the
    chosen version and closes"`; `"an empty list says none yet"`; `"a failed restore keeps the
    dialog open with the reason"`; axe on the open dialog.
  - `dashboard.ts` (existing actions test): `"Restore an earlier version shows for a synced
    dashboard without a kept original"`; `"it doesn't show for a dashboard that never synced and
    has no kept original"`.
- [ ] **Step 2:** `npx vitest run src/lib/safety/restore-version
  src/lib/components/dialogs/restore-version` → FAIL.
- [ ] **Step 3:** Implement; remove `restoreOriginal` and its callers.
- [ ] **Step 4:** Same command → PASS; `npm run check`.
- [ ] **Step 5: Commit** — `git commit -m "Restore an earlier version from the account's snapshots"`.

### Task 4: Recently deleted: "Delete now" deletes from the account

**Files:** Create `src/lib/sync/trash.ts`, `trash.test.ts`. Modify `worker.svelte.ts`,
`src/lib/components/dashboard/RecentlyDeleted.svelte` (+ browser test), `messages/en.json`.

**Interfaces:**
- Consumes: `docLock`, `readLocal`, `uploadDocument`, `remoteCall`, `postSync`,
  `remote.deletePermanently`, `app.index.remove` (local removal stays there). Modelled on
  `shareDocument` (`src/lib/sync/share.ts`).
- Produces:
  ```ts
  // trash.ts
  export type DeleteResult = "deleted" | "restored-elsewhere" | "unreachable" | "not-saved";
  /**
   * Permanently deletes a dashboard in Recently deleted from the account (call 4), then the
   * caller removes it locally. Never uploaded: "deleted" with no request.
   */
  export function deletePermanently(ctx: SyncContext, docId: string): Promise<DeleteResult>;
  // SyncWorker gains:
  deletePermanently(docId: string): Promise<DeleteResult>;
  ```
  Steps (call 5): no record or `serverVersion: null` → `"deleted"`, no request. Otherwise
  `await uploadDocument(ctx, docId)` (any result; it takes the doc lock itself), then, under the
  doc lock, `readLocal`: the document no longer deleted → `"restored-elsewhere"`; a hold, or
  unsynced entries left (the upload didn't get through) → `"unreachable"` when the upload
  answered `"retry"` or `"signed-out"`, else `"not-saved"` (`"held"`, `"blocked"`). Otherwise `remoteCall(() =>
  ctx.remote.deletePermanently(docId), "sync-delete")`: success, `gone`, or `not_found` →
  `"deleted"`; `not_deleted` → `"restored-elsewhere"` (the next poll brings it back);
  `RemoteUnavailable`, `rate_limited`, `unknown`, or `unauthorized` → `"unreachable"`.
- `RecentlyDeleted.svelte`: in an account space (`app.sync`), the confirm body is
  `deleted_confirm_body_account`, and after confirming it calls `app.sync.deletePermanently(id)`.
  On `"deleted"` it calls `app.index.remove(id)` as today. Otherwise it shows a toast
  (`deleted_restored_elsewhere`, `deleted_unreachable`, `deleted_not_saved`) and refreshes the
  index. The anonymous space is unchanged.
- Messages: `deleted_confirm_body_account` "It will be removed from your account on every device
  and can't be restored afterwards.", `deleted_restored_elsewhere` "This dashboard was restored on
  another device, so it wasn't deleted.", `deleted_unreachable` "Couldn't reach your account, so
  the dashboard wasn't deleted. Try again when you're online.", `deleted_not_saved` "This
  dashboard has changes that aren't in your account yet, so it wasn't deleted. Try again in a
  moment."

- [ ] **Step 1: Write the failing tests** (`trash.test.ts`):
  - `"a trashed dashboard is purged on the server"` → `"deleted"`; `fake.get` refuses `gone`.
  - `"a dashboard never uploaded is deleted with no request"`.
  - `"an unsynced delete uploads, then purges"` (Review Focus 4): delete locally with the fake
    offline, back online, then `deletePermanently` → one save, then `"delete <id>"` in
    `fake.requests`; `"deleted"`.
  - `"a dashboard restored elsewhere is not deleted"` (Review Focus 3): `otherDevice` clears
    `deletedAt` → `"restored-elsewhere"`; the server copy is live; the local copy is no longer in
    Recently deleted.
  - `"a restore between the upload and the delete is not deleted"`: `fake.refuseNext` gives
    the `DELETE` `not_deleted` (409) → `"restored-elsewhere"`, nothing removed locally.
  - `"a held dashboard is not saved and not deleted"` (a `conflict` hold) → `"not-saved"`, no
    `"delete <id>"` request.
  - `"already purged counts as deleted"` (`fake.purge` first).
  - `"offline is unreachable and changes nothing"`.
  - `"another device drops a purged dashboard quietly"`: a second memory platform on the same fake
    polls and no longer has it (spec 2's purged path, pinned end to end).
  - Browser (`RecentlyDeleted`): `"the account confirmation says every device"`; `"a refused
    delete keeps the row and says why"`; focus after a successful delete is unchanged (the
    existing test still passes).
- [ ] **Step 2:** `npx vitest run src/lib/sync/trash.test.ts src/lib/components/dashboard` →
  FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Delete now removes a dashboard from the account"`.

### Task 5: Account gone: remove the deleted account's space

**Files:** Modify `src/lib/account/identity.ts` (+ test), `src/lib/platform/types.ts`,
`web/identity.ts` (+ test), `memory.ts`, `src/lib/store/spaces.ts` (+ `spaces.test.ts`),
`src/lib/store/app.svelte.ts` (+ `app.test.ts`).

**Interfaces:**
- Produces:
  ```ts
  // identity.ts: blockSchema gains `deletedAccount: z.string().min(1).optional()`
  export function parseIdentityBlock(text: string):
  	{ identity: Identity; unreadable: boolean; deletedAccount: string | null };
  // IdentitySource gains:
  /** The account id the page says was just deleted in this browser (call 6), else null. */
  deletedAccount(): string | null;
  // spaces.ts
  // Hidden["reason"] gains "deleted"
  /** Marks the space hidden as "deleted" (call 7: overrides any earlier reason). */
  export function markDeleted(platform: Platform, space: SpaceId, now: Date): Promise<void>;
  ```
  `tidySpaces` removes a `"deleted"` space at once, whatever its age or unsynced changes, still
  only under `locks.tryRun` (so never while a tab holds it). The memory identity takes
  `deletedAccount` as an option. `initApp`, after `identity.start()`: if `deletedAccount()` is set
  and that `account:<id>` space exists in `platform.spaces.list()`, `markDeleted` it, then run
  `tidySpaces` (in every space, the anonymous one included). An unreadable block gives `null`.

- [ ] **Step 1: Write the failing tests:**
  - `identity.test.ts`: `"the block's deletedAccount is read"`; `"a block without it reads
    null"`; `"a malformed deletedAccount makes the block unreadable"`.
  - `spaces.test.ts`: `"a deleted space is removed at once, unsynced changes included"`;
    `"markDeleted overrides an expired reason"`; `"a held deleted space is left until no tab holds
    it"`.
  - `app.test.ts`: `"opening with a deleted account removes its space"`; `"an unknown deleted
    account changes nothing"` (Review Focus 5); `"a held space is removed after its tab switches
    away"` (Review Focus 5: a second app on the space gets a signed-out re-check, switches, and
    the next tidy removes it).
  - `app.test.ts`: `"another device: a deleted account hides the space and keeps it 30 days"`
    (the fake's `signedInAs: null`, an upload answers `unauthorized` → hidden as `"expired"`; pins
    spec 2's behaviour as this spec's "other devices" rule).
- [ ] **Step 2:** `npx vitest run src/lib/account src/lib/store src/lib/platform` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS; `npm run build && npm run check:budget`.
- [ ] **Step 5: Commit** — `git commit -m "Remove a deleted account's dashboards from this browser"`.

### Task 6: End-to-end: recovery across two devices

**Files:** Create `e2e/recovery.spec.ts`. Use spec 2's two-context helpers and the
`documentsServer` fixture.

- [ ] **Step 1: Write the tests** (`account: maria`):
  - `"a dashboard deleted on one device can be restored on the other"`: A deletes; B (becomes
    visible → polls) shows it under Recently deleted; B restores; A shows it in the list again.
  - `"delete now removes it from the account and from the other device"`: A deletes then Delete
    now → the mock's `fake.get` is `gone`; B's Recently deleted no longer lists it after a poll.
  - `"delete now offline says so and keeps the row"` (`context.setOffline(true)`).
  - `"restore an earlier version from the account"`: seed the fake with a daily snapshot (save
    across a mocked day change, or a save with a clock the fixture controls); open the dialog,
    choose the server version, Restore → the title is back; Undo → the new title again; the fake
    has a `conflict` snapshot of the replaced content.
  - `"a deleted account's dashboards are gone on next open"`: route the workspace page's
    identity block to `{"v":1,"user":null,"deletedAccount":"<maria's id>"}` after an edit, reload
    → the anonymous space shows, and IndexedDB (read through the page) has no `account:<id>`
    space.
  - axe on the new dialog states (`expectNoViolations`).
- [ ] **Step 2:** `npm run test:e2e:all` → PASS on Chromium, Firefox, WebKit.
- [ ] **Step 3: Commit** — `git commit -m "E2E: recovery across two devices"`.

### Task 7: Docs, deferrals, and the hand checks

**Files:** Modify `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`,
`docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` ("Hosting contract").

- [ ] **Step 1: `ARCHITECTURE.md`:** under "How the dashboard syncs", after spec 3's "Live
  share links (built in sync spec 3, …)" list, add a "Recovery (built in sync spec 4, <date>)"
  list in the same form: this plan's calls 1–7 and any made while building.
  Item 9 changes from "'Delete permanently' has its server call in spec 4" to how "Delete now"
  works in an account space. "Recovery from a bad upgrade" item 4 says what the list shows and that
  a restore keeps the replaced version on the server first. "Accounts & anonymous use" → account
  deletion: "Local copies are removed from this browser immediately" names the
  `deletedAccount` signal, and other devices hide at once and remove within 30 days (spec 2).
- [ ] **Step 2: Hosting contract:** the `sjvair-identity` block may carry `deletedAccount` (a
  string account id), set once by sjvair.com after an account deletion; the dashboard ignores it
  when absent.
- [ ] **Step 3: `DEFERRED.md`:**
  - Update "Test-suite cleanups from sync spec 2": the fake now models daily snapshots and their
    expiry, but still not the snapshot storage cap.
  - Add a "looked at in sync spec 4, still deferred" note to "A lost answer to 'Keep mine' or
    'Restore' saves again" (the list now shows any duplicate snapshot, which is the revisit
    trigger to watch) and "Holds on dashboards that aren't open are never asked about" (a held
    dashboard in Recently deleted answers "Delete now" with `deleted_not_saved`).
  - The plan's four deferrals are already recorded (added with this plan, 2026-11-02): "Delete
    now" isn't queued offline; restoring needs the account reachable; the list isn't
    deduplicated; unsynced edits are lost with a deleted account. Update them if building
    changed any of them, and add anything else deferred while building, each with why and a
    revisit trigger.
- [ ] **Step 4: `TODO.md`:** "Start here" and "Sync track" say spec 4 is built (PR number). Add the
  hand check for the real stack: (1) two browsers signed in as the `WORKSPACE_E2E_*` account;
  delete on one, restore on the other; delete on one, Delete now, confirm the other drops it.
  (2) Edit a dashboard on two days (or after a schema bump) and restore from the list. (3) With the
  sjvair.com change on `develop`, delete a throwaway account on `/account/`, open `/workspace/`
  in the same browser, and check (devtools → IndexedDB) that its space is gone.
- [ ] **Step 5:** `npm run lint && npm run check && npm run test && npm run build && npm run
  check:build && npm run check:budget` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "Docs: sync spec 4 is built"`, push, and open the PR into
  `main` (no attribution). Stop: merging needs the user's yes.

---

## The sjvair.com change (outside this repo)

Needs its own short plan, approved by the user, on a branch from sjvair.com `develop`, with a PR
into `develop`. It is small, so its plan can be written in that session from this description:

- `DeleteAccountView.post`: read `user.id` before `logout(request)`. After `user.delete()`, set
  `request.session["workspace_deleted_account"] = str(user_id)` on the new signed-out session.
- `WorkspacePage.get_context_data`: pop that key and pass it to `workspace_identity(user,
  deleted_account=None)`, which adds `"deletedAccount": deleted_account` to the block when set
  (still `v: 1`).
- Tests: after a deletion, the first `/workspace/` page's block has `deletedAccount` with the old
  id; the next page's block doesn't; a normal sign-out never sets it; the block never carries
  anything else about the deleted account.
- Note for that session: the dashboard's schema strips unknown fields, so this can merge before or
  after this plan's Task 5 in either order. While `/workspace/` is behind `beta_tools`, the key
  waits in the session until a page that can render the workspace loads.
