# Foundations spec 3 (safety and sharing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local-only dashboards shareable (links and files), recoverable (backups, Recently deleted, kept originals), and safe across app updates, and finish the spec-1 robustness leftovers.

**Architecture:** New platform capabilities (originals, clipboard, files, persistence, reset) keep browser APIs behind the adapter. A `src/lib/sharing/` module owns the file/link envelope, the one import pipeline, copies, and restores; it and `lz-string` are lazy-loaded. A `src/lib/safety/` module owns the update notice, version check, storage protection, backup reminder, purge, and Clear my data. `DocumentSession` gains suspend/discard, a save-retry timer, and format-change handling.

**Tech Stack:** Svelte 5 runes, TypeScript, zod, `idb`, `lz-string` 1.5.0 (new, MIT), shadcn-svelte/bits-ui (adds `popover`), Paraglide, Vitest (unit + browser mode), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-25-foundations-3-safety-sharing-design.md` (approved 2026-10-25). Read it alongside this plan; section numbers below (§N) refer to it.

## Global Constraints

- Tabs, double quotes, no trailing commas, 100-column lines; run `npm run format` before each commit.
- All UI strings through Paraglide (`messages/en.json`, then `npm run paraglide`); no concatenated sentences; never store generated English.
- Dates through `$lib/format` (Pacific time); never the browser's zone.
- No direct `localStorage`, `indexedDB`, `navigator.clipboard`, `navigator.storage`, file input, or download calls outside `src/lib/platform/`.
- Styling only from theme tokens; shadcn-svelte components; WCAG 2.2 AA (keyboard, live regions, focus).
- Only permissive dependencies; the only new runtime dependency is `lz-string@1.5.0`.
- Share/import code and `lz-string` are loaded with dynamic `import()`, never from the entry chunk.
- Limits (§2, §3): one document ≤ **1,000,000** characters of JSON; backup file ≤ **50,000,000** bytes; share URL ≤ **8,000** characters; incoming link fragment ≤ **64,000** characters before decompressing.
- Retention: **30 days** for Recently deleted, kept originals, and stale journal records.
- Backup reminder: at most once every **14 days** (§7).
- Journal record limit: **256 KB** (262,144 characters of JSON).
- Commit messages: plain, no AI attribution or `Co-Authored-By` trailers (user's global rule).
- Every deferral goes into `DEFERRED.md` in the same commit (with why and a revisit trigger).

## Review Focus

1. **A link mangled in transit** (an email client wraps it, adds `%0A`, or cuts it off) → "This link can't be opened", nothing saved, no crash. Test in Task 8.
2. **A file that isn't ours** (an empty file, a CSV, random JSON, a `.json` that's an array) → "This file can't be opened", whole file rejected. Test in Task 8.
3. **Another tab open on the dashboards list while a link is imported** → the new copy appears there without a reload. Test in Task 9.
4. **Clipboard blocked** (permission denied, insecure context) → the link stays visible and selected in the field, no error. Test in Task 10.
5. **Sizes right at the edges** (a URL of exactly 8,000 vs 8,001 characters; a document of exactly 1,000,000 vs 1,000,001 characters) → the boundary value is accepted, one more is refused. Tests in Tasks 8 and 10.

---

## File structure

```
src/lib/platform/
  types.ts                 + remove(), OriginalStorage, JournalStorage.list, Clipboard/File/Persistence/Reset
  memory.ts                + in-memory twins of all of the above
  storage-contract.ts      + contract tests for the new storage behavior
  capability-contract.ts   NEW: contract tests for originals and reset
  web/db.ts                DB_VERSION rule, idempotent upgrade, versionchange/terminated hooks
  web/storage.ts           remove, originals, precondition, reopen, reset.clearAll
  web/journal.ts           list(), size limit
  web/clipboard.ts         NEW
  web/files.ts             NEW
  web/persistence.ts       NEW
src/lib/documents/
  schema.ts                normalizeName grapheme-safe cut
  load.ts                  Migration.migrateChange, docs
  migrate-changes.ts       NEW: upgradeChanges()
src/lib/changes/           + replaceDocument (types, apply, overlap)
src/lib/store/
  document-session.svelte.ts   activity, retry, handoff, cross-tab fixes, suspend/discard, format guards, originals
  app.svelte.ts            suspendAll, resetAfterClear, protection, purge on init, session callbacks
  dashboard-index.svelte.ts    deleted list, createFrom, remove, journal names
  tab-channel.ts           + "cleared" message
  journal.ts               older-format records, pendingName()
src/lib/sharing/           NEW (lazy-loaded except envelope types)
  envelope.ts  codec.ts  fingerprint.ts  fingerprints.ts  incoming.ts
  copy.ts  restore.ts  export.ts  file-names.ts  actions.ts
src/lib/safety/            NEW
  build-id.ts  update-notice.svelte.ts  version-check.ts  lazy.ts
  protection.svelte.ts  reminder.ts  purge.ts  clear.ts  restore-version.ts  report.ts
src/lib/components/
  dialogs/ShareDialog.svelte  ExistingCopyDialog.svelte  ConfirmDialog.svelte
  dialogs/ClearDataDialog.svelte  RestoreVersionDialog.svelte
  shell/NoticeBars.svelte  StorageStatus.svelte  (SavedIndicator.svelte becomes its trigger)
  dashboard/RecentlyDeleted.svelte
  ui/popover/              (added with the shadcn-svelte CLI)
src/routes/Import.svelte   NEW (lazy route /import)
vite-plugins/build-info.ts NEW
e2e/sharing.spec.ts  e2e/backup.spec.ts  e2e/safety.spec.ts  e2e/version.spec.ts  (+ a11y.spec.ts)
```

---

### Task 1: Storage capabilities: remove, originals, journal list and limit, commit precondition

**Files:**

- Modify: `src/lib/platform/types.ts`, `src/lib/platform/memory.ts`, `src/lib/platform/web/db.ts`, `src/lib/platform/web/storage.ts`, `src/lib/platform/web/journal.ts`, `src/lib/platform/storage-contract.ts`
- Create: `src/lib/platform/capability-contract.ts`
- Test: `src/lib/platform/memory.test.ts`, `src/lib/platform/web/storage.browser.test.ts`, `src/lib/platform/web/journal.test.ts`

**Interfaces:**

- Produces (in `types.ts`):
  - `DocumentStorage.remove(space: SpaceId, id: string): Promise<void>` — deletes the document, its change log, and its kept original.
  - `type KeptOriginal = { id: string; raw: unknown; keptAt: string; fromSchemaVersion: number }`
  - `interface OriginalStorage { get(space, id): Promise<KeptOriginal | undefined>; put(space, original: KeptOriginal): Promise<void>; list(space): Promise<KeptOriginal[]>; remove(space, id): Promise<void> }`
  - `JournalStorage.list(space: SpaceId): Array<{ docId: string; tabId: string; record: unknown }>`
  - `export const JOURNAL_RECORD_MAX = 262_144;`
  - `Platform.originals: OriginalStorage`
  - `class CommitPreconditionError extends Error` thrown by `commit` when `entries` is non-empty and not contiguous from `baseVersion + 1`, or the last entry's version ≠ `doc.version`.

- [ ] **Step 1: Write the failing contract tests** in `storage-contract.ts` (they run against memory and IndexedDB):
  - `"remove deletes the document, its log, and its original"`: after `remove`, `get` → `undefined`, `readLog(…, 0)` → `[]`, `originals.get` → `undefined`; other ids untouched.
  - `"commit on a missing id with a numeric base is refused"` → `{ ok: false, currentVersion: 0 }`, nothing stored.
  - `"readLog for an unknown document is empty"` → `[]`.
  - `"commit rejects entries that don't run contiguously to doc.version"`: entries `[v1, v3]` with doc version 3 → rejects with `CommitPreconditionError`; entries `[v1]` with doc version 2 → rejects; storage unchanged.
  - `"create with no entries accepts any version"`: `baseVersion: null`, doc version 7, `entries: []` → ok, `get` returns version 7.
  - `"a duplicate entry version replaces the earlier entry"`: both adapters agree (`readLog` returns one entry per version, the later one).
- [ ] **Step 2: Write `capability-contract.ts`** with `runCapabilityContract(name, make)` testing originals: `put` then `get` round-trips (cloned), `put` replaces, `list` is per space, `remove`. Call it from `memory.test.ts` and `storage.browser.test.ts`.
- [ ] **Step 3: Add journal tests** in `web/journal.test.ts`: `"list returns every record in a space"` (two docs, two tabs; other space excluded); `"a record over JOURNAL_RECORD_MAX is not written"` (a record whose JSON is 262,145 characters → `readAll` empty; 262,144 → written).
- [ ] **Step 4: Run** `npm run test:unit -- src/lib/platform` and `npm run test:browser -- src/lib/platform` — expect FAIL.
- [ ] **Step 5: Implement.** Memory twin first, then web. `originals` IndexedDB value becomes `{ space } & KeptOriginal` (keyPath unchanged, no DB version bump). Web `remove` runs one `readwrite` transaction over `documents`, `changeLog` (key range from `logRange`), and `originals`. The precondition check runs before any write in both adapters.
- [ ] **Step 6: Run** the same commands — expect PASS.
- [ ] **Step 7: Update `DEFERRED.md`**: remove the "IndexedDB adapter robustness" contract-gap and precondition parts (the reopen part stays until Task 3).
- [ ] **Step 8: Commit** — `git commit -m "Add document removal, kept originals, and journal listing to the platform"`

### Task 2: Browser capabilities: clipboard, files, persistence, reset

**Files:**

- Create: `src/lib/platform/web/clipboard.ts`, `src/lib/platform/web/files.ts`, `src/lib/platform/web/persistence.ts`
- Modify: `src/lib/platform/types.ts`, `src/lib/platform/memory.ts`, `src/lib/platform/web/storage.ts`, `src/lib/platform/capability-contract.ts`
- Test: `src/lib/platform/web/persistence.test.ts`, `src/lib/platform/web/files.browser.test.ts`, contract tests

**Interfaces:**

- Produces:
  - `interface ClipboardAccess { writeText(text: string): Promise<boolean> }` — `false` instead of throwing.
  - `type OpenedFile = { name: string; size: number; text(): Promise<string> }`
  - `interface FileAccess { save(name: string, contents: string, type: string): void; open(accept: string): Promise<OpenedFile | null> }` — `null` when cancelled.
  - `type Protection = "protected" | "unprotected" | "unknown"`
  - `interface PersistenceAccess { persisted(): Promise<Protection>; request(): Promise<Protection>; prompts(): boolean }`
  - `interface ResetAccess { generation(): string; clearAll(): Promise<void> }`
  - `Platform` gains `clipboard`, `files`, `persistence`, `reset`.
  - Memory twins expose test controls: `files.queueOpen(file: OpenedFile | null)`, `files.saved: Array<{ name; contents; type }>`, `clipboard.fail(on: boolean)`, `clipboard.last: string | null`, `persistence.set(state: Protection, prompts: boolean)`.

- [ ] **Step 1: Write failing tests.**
  - Contract (`capability-contract.ts`): `"clearAll removes documents, logs, originals, preferences, and journal records in every space and changes the generation"` (seed anonymous and `account:x`; after `clearAll` every `list`/`get`/`readAll` is empty and `generation()` differs from before); `"generation is stable between calls"`.
  - `persistence.test.ts` (unit, inject a fake `navigator`): `persisted()` maps `true`→`"protected"`, `false`→`"unprotected"`, missing API→`"unknown"`; `request()` same mapping; `prompts()` is `true` for a Firefox user agent (`/\bFirefox\//`) and `false` for Chrome and Safari user agents.
  - `files.browser.test.ts`: `save` creates and clicks an anchor with `download` set to the name (spy on `HTMLAnchorElement.prototype.click`); `open` resolves `null` on the input's `cancel` event.
- [ ] **Step 2: Run** `npm run test:unit -- src/lib/platform` and `npm run test:browser -- src/lib/platform` — expect FAIL.
- [ ] **Step 3: Implement.** `createWebClipboard(nav = navigator)`, `createWebFiles(doc = document)` (hidden `<input type="file">`, resolves on `change` or `cancel`), `createWebPersistence(nav = navigator)`. `prompts()` uses the user-agent check: no feature check distinguishes browsers that prompt (the Permissions API reports `"prompt"` in Chrome too); this is the builder's call the spec allowed. Reset: the generation lives in `localStorage` under `sjvair-workspace:generation` (a `crypto.randomUUID()`, created on first read). `clearAll()` writes the new generation **first** (synchronously), then clears all five IndexedDB stores in one transaction, then removes every other `sjvair-workspace:` key from `localStorage`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add clipboard, file, persistence, and reset capabilities"`

### Task 3: Update notice, build id, version check, chunk failures, and old tabs on a storage change

**Files:**

- Create: `vite-plugins/build-info.ts`, `src/lib/safety/build-id.ts`, `src/lib/safety/update-notice.svelte.ts`, `src/lib/safety/version-check.ts`, `src/lib/safety/lazy.ts`, `src/lib/components/shell/NoticeBars.svelte`
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `src/lib/platform/web/db.ts`, `src/lib/platform/web/storage.ts`, `src/main.ts`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/safety/version-check.test.ts`, `src/lib/safety/lazy.test.ts`, `src/lib/platform/web/db.browser.test.ts`, `e2e/version.spec.ts`

**Interfaces:**

- Produces:
  - `declare const __BUILD_ID__: string;` and `export const BUILD_ID: string = __BUILD_ID__` (`"dev"` under `vite dev`).
  - `type UpdateReason = "new-version" | "chunk-failed" | "storage-upgraded" | "newer-data"`; `class UpdateNotice { reason: UpdateReason | null; show(reason: UpdateReason): void }`; `export const updateNotice: UpdateNotice`.
  - `startVersionCheck(opts: { activity: ActivitySource; buildId: string; fetchBuildId: () => Promise<string>; notice: Pick<UpdateNotice, "show">; intervalMs?: number }): () => void` — `intervalMs` defaults to `3_600_000`; does nothing when `buildId === "dev"`.
  - `loadLazy<T>(load: () => Promise<T>): Promise<T>` — on rejection calls `updateNotice.show("chunk-failed")` and rethrows.
  - `export const DB_LAYOUT_VERSION = 1;` `export const DB_VERSION = DB_LAYOUT_VERSION + CURRENT_SCHEMA_VERSION - 1;`
  - `OpenOptions.onVersionChange?: () => void` (called before the connection closes in `blocking`).

- [ ] **Step 1: Write failing tests.**
  - `version-check.test.ts` (fake timers, `createMemoryActivity`): shows `"new-version"` when the activity turns visible and the fetched id differs; not when equal; checks again after `intervalMs` while visible; skips the interval tick while hidden; a rejected fetch shows nothing; `buildId: "dev"` never fetches; the returned function stops everything.
  - `lazy.test.ts`: a rejecting loader calls `show("chunk-failed")` and rethrows; a resolving one doesn't.
  - `db.browser.test.ts`: `"an upgrade from another connection calls onVersionChange and closes"` (open with the module's `DB_VERSION`, then `openDB(DB_NAME, DB_VERSION + 1)` succeeds without `blocked`, and the hook ran); `"upgrade is idempotent"` (opening a DB created by version 1 at a higher version keeps existing stores and data).
- [ ] **Step 2: Run** `npm run test:unit -- src/lib/safety` and `npm run test:browser -- src/lib/platform/web/db` — expect FAIL.
- [ ] **Step 3: Implement the build plugin.** `buildInfo(): Plugin` sets `define.__BUILD_ID__` to `process.env.BUILD_ID || process.env.GITHUB_SHA || (git rev-parse HEAD) || "unknown"` for builds and `"dev"` for `serve`, and in `generateBundle` emits `assets/version.json` = `{ "buildId": "<id>" }` (same folder as the entry chunk, so `new URL("version.json", import.meta.url)` finds it). Register it in `vite.config.ts`; declare `__BUILD_ID__` in `src/vite-env.d.ts`.
- [ ] **Step 4: Implement** `update-notice`, `version-check`, `lazy`, and the `db.ts` changes (`upgrade(db)` creates each store only if `!db.objectStoreNames.contains(name)`; `blocking()` calls `onVersionChange` then `close()`). In `storage.ts`, when a call fails because the connection was closed by `terminated`, reopen once and retry; if the reopen fails, rethrow (the session shows "couldn't save").
- [ ] **Step 5: Implement `NoticeBars.svelte`** (rendered in `App.svelte` directly under `<TopNav />`): when `updateNotice.reason` is set, a slim `role="status"` bar with `m.update_available()` and a **Reload** button (flushes the current session, then `location.reload()`). Wire `main.ts`: pass `onVersionChange: () => { updateNotice.show("storage-upgraded"); app?.suspendAll(); }` (`suspendAll` arrives in Task 6; until then guard with `?.`), call `startVersionCheck` with `fetchBuildId = () => fetch(new URL("version.json", import.meta.url), { cache: "no-store" }).then((r) => r.json()).then((j) => String(j.buildId))`, and add `window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); updateNotice.show("chunk-failed"); })`.
- [ ] **Step 6: Messages:** `update_available` = "A new version is available.", `update_reload` = "Reload".
- [ ] **Step 7: Write `e2e/version.spec.ts`**: `"a changed version.json shows the reload bar"` — route `**/assets/version.json` to `{ "buildId": "other" }`, load a dashboard, dispatch `visibilitychange` (`page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))`), expect the "A new version is available." status and a Reload button; the same with the real file shows nothing.
- [ ] **Step 8: Run** unit, browser, and `npm run test:e2e -- e2e/version.spec.ts` — expect PASS.
- [ ] **Step 9: Update `DEFERRED.md`**: remove the "IndexedDB adapter robustness" reopen part (the item is now done). Commit — `git commit -m "Detect new deploys and storage upgrades and offer a reload"`

### Task 4: Documents: grapheme-safe names, migration hardening, change migration

**Files:**

- Create: `src/lib/documents/migrate-changes.ts`
- Modify: `src/lib/documents/schema.ts`, `src/lib/documents/load.ts`, `src/lib/store/journal.ts`
- Test: `src/lib/documents/schema.test.ts`, `src/lib/documents/load.test.ts`, `src/lib/documents/migrate-changes.test.ts`

**Interfaces:**

- Produces:
  - `Migration` gains `migrateChange(change: unknown): unknown | null` (required; `null` = can't be carried over). JSDoc: neither `migrate` nor `migrateChange` may mutate its input.
  - `upgradeChanges(changes: unknown[], fromVersion: number, chain?: Migration[]): { changes: Change[]; dropped: number }` — runs each change through every step from `fromVersion` to `CURRENT_SCHEMA_VERSION`, then validates with `ChangeSchema`; nulls and invalid results count as dropped.
  - `LooseJournalRecordSchema` (any integer `schemaVersion` ≤ current, `changes: unknown[]`) next to `JournalRecordSchema` in `store/journal.ts`.

- [ ] **Step 1: Write failing tests.**
  - `schema.test.ts`: `"normalizeName never splits an emoji at the cut"` — 99 `a`s + `"👍🏽"` → result is the 99 `a`s (no lone surrogate; `result.length ≤ NAME_MAX`); `"normalizeName trims again after the cut"` — 99 `a`s + `" b"` → 99 `a`s.
  - `load.test.ts`: replace the hard-coded `to: 1` with a chain built relative to `CURRENT_SCHEMA_VERSION` (a test migration from `CURRENT_SCHEMA_VERSION - 1`, schemas faked accordingly).
  - `migrate-changes.test.ts`, with a test-only two-step chain: changes pass through both steps in order; a step returning `null` drops that change and counts it; a result failing `ChangeSchema` is dropped; inputs are not mutated (`Object.freeze` the inputs); `fromVersion === CURRENT_SCHEMA_VERSION` returns the parsed changes unchanged.
- [ ] **Step 2: Run** `npm run test:unit -- src/lib/documents` — expect FAIL.
- [ ] **Step 3: Implement.** `normalizeName` cuts with `Intl.Segmenter(undefined, { granularity: "grapheme" })`, keeping whole graphemes while the running length ≤ `NAME_MAX`, then trims. `upgradeChanges` as specified.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Update `DEFERRED.md`**: remove "Name normalization edge cases"; trim "Migration chain hardening" to the bare-`catch` part (spec 5). Commit — `git commit -m "Cut names on grapheme boundaries and migrate pending changes across formats"`

### Task 5: The `replaceDocument` change

**Files:**

- Modify: `src/lib/changes/types.ts`, `src/lib/changes/apply.ts`, `src/lib/changes/overlap.ts`
- Test: `src/lib/changes/apply.test.ts`, `src/lib/changes/overlap.test.ts`, `src/lib/changes/undo.test.ts`

**Interfaces:**

- Produces: `{ op: "replaceDocument"; target: {}; from: DocContent; to: DocContent }` in `ChangeSchema`, where `DocContent = { name: string | null; body: DashboardBody }` (zod: `name` ≤ `NAME_MAX`, nullable; `body: DashboardBodySchema`).

- [ ] **Step 1: Write failing tests:** `applyChange` sets `name` and `body` to `to`, leaves `id`/`version`/`deletedAt` alone, and its inverse has `to` = the document's actual prior content; `appliedChange(inverse)` round-trips; `changesOverlap` is `true` for `replaceDocument` against every change op (either side) and against another `replaceDocument`; an undo of a `replaceDocument` restores the earlier content.
- [ ] **Step 2: Run** `npm run test:unit -- src/lib/changes` — expect FAIL.
- [ ] **Step 3: Implement** in the three files (the `switch` statements stay exhaustive).
- [ ] **Step 4: Run** — expect PASS. **Step 5: Commit** — `git commit -m "Add a replaceDocument change"`

### Task 6: DocumentSession and App robustness: activity, retry, handoff, suspend/discard

**Files:**

- Modify: `src/lib/store/document-session.svelte.ts`, `src/lib/store/app.svelte.ts`, `src/lib/starter/starter.ts`, `src/routes/Home.svelte`
- Test: `src/lib/store/document-session.test.ts`, `src/lib/starter/starter.test.ts`, `src/lib/store/app.test.ts`

**Interfaces:**

- Consumes: `platform.activity` (existing), `updateNotice` (Task 3).
- Produces:
  - `export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 60_000];` (the last repeats).
  - `DocumentSession.errorKind: "quota" | "unavailable" | null` (`$state`; `"quota"` when the failed commit's error name is `"QuotaExceededError"`).
  - `DocumentSession.suspend(): void` — writes the journal synchronously, cancels timers, and makes later commits and journal writes no-ops.
  - `DocumentSession.discard(): void` — removes listeners and drops pending changes without saving or journaling.
  - `AppContext.suspendAll(): void` and `AppContext.resetAfterClear(): Promise<void>` (Task 13 uses the latter; implement it here: discard every open session, empty the session map, set `current` to none, refresh the index, `navigate("/", { replace: true })`).

- [ ] **Step 1: Write failing session tests** (memory platform, fake timers):
  - `"hidden activity journals and flushes; visible activity catches up"` — drive `platform.activity.setVisible(false/true)`; there's no `document` listener left (grep check in review).
  - `"a failed save retries on the backoff timer"` — make `documents.commit` throw twice; after 1 s and 2 s it retries; the third attempt succeeds and status becomes `"saved"`; the delay resets after a success.
  - `"a quota failure sets errorKind to quota"`.
  - `"edits made during the starter hand-off survive a null hand-off"` (in `starter.test.ts`): the hook returns `null` for the first attempt; two edits made meanwhile; the next edit's hand-off succeeds; the copy holds all three edits in order. Same for a rejecting hook.
  - `"pagehide during the starter hand-off journals the queued edits"`: the journal holds a record under `STARTER_ID` with the queued changes; a new starter session built with that journal replays them through the hand-off on its first `open`/mount (expose `starterSession(...).replayPending(): Promise<void>`, called by `Home.svelte` after the starter becomes current).
  - `"suspend writes the journal and stops saving"`; `"discard drops pending changes without saving or journaling"`.
- [ ] **Step 2: Write a failing App test**: `"resetAfterClear discards sessions and empties the index"`.
- [ ] **Step 3: Run** `npm run test:unit -- src/lib/store src/lib/starter` — expect FAIL.
- [ ] **Step 4: Implement.** Replace the `document` `visibilitychange` listener with `platform.activity.onChange`. Retry: on a thrown commit, schedule `flush()` after `RETRY_DELAYS_MS[min(attempt, last)]`; clear on success, `dispose`, `suspend`, or `discard`. Hand-off: keep queued changes in a list owned by the starter session; on `null`/reject, keep them and retry them (first one through the hook) with the next edit; `#writeJournal` includes them under `STARTER_ID` while the hook runs. `suspendAll` calls `suspend()` on every open session.
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Update `DEFERRED.md`**: remove "`DocumentSession` reads page visibility directly"; trim "DocumentSession durability gaps" to the commit-chain error-reporting part (spec 5). Commit — `git commit -m "Retry failed saves, keep hand-off edits, and add suspend and discard to sessions"`

### Task 7: Cross-tab fixes and format-change guards in DocumentSession

**Files:**

- Modify: `src/lib/store/document-session.svelte.ts`, `src/lib/store/app.svelte.ts`, `src/routes/DashboardPage.svelte`
- Create: `src/lib/safety/report.ts`
- Test: `src/lib/store/document-session.test.ts`, `src/lib/store/cross-tab.test.ts`

**Interfaces:**

- Consumes: `upgradeChanges`, `LooseJournalRecordSchema` (Task 4); `originals` (Task 1); `reset.generation()` (Task 2); `suspend`/`discard` (Task 6).
- Produces:
  - `DocumentSessionOptions` gains `onNeedsReload?: () => void` and `onCleared?: () => void`; `App` passes `() => { updateNotice.show("newer-data"); this.suspendAll(); }` and `() => void this.resetAfterClear()`.
  - `DocumentSession.hasOriginal: boolean` (`$state`), `DocumentSession.droppedEdits: number` (`$state`).
  - `report(error: unknown, context: Record<string, unknown>): void` — `console.error` in development only (spec 5 wires Sentry).

- [ ] **Step 1: Write failing cross-tab tests** (`cross-tab.test.ts`):
  - `"a trimmed catch-up during a conflict clears the conflict and replays mine"` (spec 1's rule: no overlap checks once the log no longer reaches back).
  - `"keep mine after a journal-replay conflict keeps edits to widgets the other side deleted"` — the session remembers the record's base version as the conflict base and reads `theirs` from it in `#resolve`.
  - `"save mine as a copy after a journal replay"`, `"a catch-up during an in-flight commit"`, `"pageshow from the back/forward cache flushes and catches up"`.
- [ ] **Step 2: Write failing session tests:**
  - `"opening an upgraded document keeps the original once"` — with a test migration chain injected into `DocumentSession.open` (add an optional `chain` option), `originals.get` holds the raw stored document, `fromSchemaVersion`, and `keptAt`; opening again doesn't replace it; `hasOriginal` is `true`.
  - `"an upgrade that fails validation saves nothing and reports"` — opens read-only, the stored document and originals are unchanged, `report` was called.
  - `"older journal records are upgraded before replay"` — one change carried, one dropped; `droppedEdits === 1`.
  - `"older log entries are upgraded during catch-up"`.
  - `"a stored document or log entry from a newer format suspends and asks for a reload"` — `onNeedsReload` called once; no commit happens afterwards.
  - `"a changed generation stops saving and calls onCleared"` — change the memory platform's generation, edit, flush → no commit, no journal write, `onCleared` called.
- [ ] **Step 3: Run** `npm run test:unit -- src/lib/store` — expect FAIL.
- [ ] **Step 4: Implement** in `DocumentSession`: capture `platform.reset.generation()` at construction and check it before every commit and journal write; in `open`, keep the original (only when no original exists with the same `fromSchemaVersion`) before constructing the session; read `hasOriginal` from `originals.get`; replay older records through `upgradeChanges`; in `#readStored`, check the raw `schemaVersion` and every entry's `schemaVersion` before loading and call `onNeedsReload` (then `suspend`) when newer, and upgrade older entries' changes (dropping nulls from `theirs`).
- [ ] **Step 5: Show dropped edits:** `DashboardPage.svelte` shows a toast `m.edits_dropped()` ("Some unsaved edits from before the update couldn't be applied.") when `droppedEdits > 0`.
- [ ] **Step 6: Run** — expect PASS.
- [ ] **Step 7: Update `DEFERRED.md`**: trim "Cross-tab sync edge cases" to the status-wording part (design pass). Commit — `git commit -m "Fix cross-tab conflict edge cases and guard sessions against format changes and cleared data"`

### Task 8: The sharing core: envelope, codec, fingerprints, the import pipeline

**Files:**

- Create: `src/lib/sharing/envelope.ts`, `src/lib/sharing/codec.ts`, `src/lib/sharing/fingerprint.ts`, `src/lib/sharing/incoming.ts`, `src/lib/sharing/export.ts`
- Modify: `package.json` (add `lz-string@1.5.0`)
- Test: `src/lib/sharing/incoming.test.ts`, `src/lib/sharing/codec.test.ts`, `src/lib/sharing/fingerprint.test.ts`, `src/lib/sharing/export.test.ts`

**Interfaces:**

- Produces (`envelope.ts`):
  - `FORMAT = "sjvair-workspace"`, `FORMAT_VERSION = 1`, `MAX_DOCUMENT_CHARS = 1_000_000`, `MAX_BACKUP_BYTES = 50_000_000`, `MAX_LINK_URL = 8_000`, `MAX_INCOMING_FRAGMENT = 64_000`, `LINK_PREFIX = "1."`.
  - `EnvelopeSchema`: `{ format: literal FORMAT; type: "document" | "backup"; formatVersion: literal 1; exportedAt: iso datetime; documents: unknown[]; fingerprints?: Record<string, string> }`, refined so `type: "document"` has exactly one document and no `fingerprints`.
  - `type Envelope = z.infer<typeof EnvelopeSchema>`; `type SharedDocument = Pick<Dashboard, "kind" | "schemaVersion" | "id" | "name" | "body">`.
- Produces (`codec.ts`, lazy): `encodePayload(json: string): string` (`LINK_PREFIX` + `compressToEncodedURIComponent`); `decodePayload(fragment: string): string | null` (`null` on a wrong prefix, too long, or a failed/empty decompress).
- Produces (`fingerprint.ts`): `canonicalJson(value: unknown): string` (sorted keys, no whitespace); `fingerprint(doc: SharedDocument): Promise<string>` (SHA-256 hex of `canonicalJson`).
- Produces (`incoming.ts`):
  - `type IncomingError = "too-large" | "invalid" | "newer"`
  - `type Incoming = { kind: "document"; doc: Dashboard; sourceId: string; fingerprint: string } | { kind: "backup"; envelope: Envelope } | { kind: "error"; reason: IncomingError }`
  - `parseIncoming(text: string, now: Date): Promise<Incoming>` — size check (`text.length ≤ MAX_DOCUMENT_CHARS` for anything that turns out to be a `document` envelope; backups are size-checked by bytes before reading, Task 10), JSON parse, `EnvelopeSchema`, then for a document: pick the `SharedDocument` fields, fill `version: 0`, `createdAt`/`updatedAt` = `now`, run `loadDashboard`; `"newer"` and `"invalid"` map to errors.
  - `parseLinkFragment(fragment: string, now: Date): Promise<Incoming>` — `decodePayload` (`null` → `"invalid"`; fragment over `MAX_INCOMING_FRAGMENT` → `"too-large"`), then `parseIncoming`; a link holding a backup is `"invalid"`.
- Produces (`export.ts`): `sharedDocumentOf(doc: Dashboard): SharedDocument`; `documentFileJson(doc: Dashboard, now: Date): string`; `shareUrl(base: string, doc: Dashboard, now: Date): Promise<{ url: string } | { tooLong: true }>` where `base` is `location.origin + import.meta.env.BASE_URL` and the URL is `${base}import#${payload}`, refused when `url.length > MAX_LINK_URL`.

- [ ] **Step 1: Write failing tests** (`incoming.test.ts`, `codec.test.ts`, `fingerprint.test.ts`, `export.test.ts`):
  - Round trip: `shareUrl` → take the fragment → `parseLinkFragment` → `kind: "document"`, same `name`/`body`, `sourceId` = original id.
  - Review Focus 1: the fragment with `%0A` inserted, with the last 20 characters cut, with trailing spaces, and empty → `{ kind: "error", reason: "invalid" }`.
  - Review Focus 2: `""`, `"a,b\n1,2"`, `"{}"`, `"[]"`, a valid envelope with `format: "other"` → `"invalid"`.
  - Review Focus 5: a document envelope of exactly `MAX_DOCUMENT_CHARS` characters is accepted (pad the name… use a body with many placeholder widgets until the JSON hits the length exactly), one more → `"too-large"`; a fragment that decompresses to more than `MAX_DOCUMENT_CHARS` → `"too-large"`.
  - A document whose `schemaVersion` is `CURRENT_SCHEMA_VERSION + 1` → `"newer"`; one with `default-place` → `"invalid"`; local-only fields in the shared JSON are ignored (not carried).
  - `fingerprint`: equal for the same document with keys in a different order; different when the name changes.
  - `sharedDocumentOf` drops `version`, `createdAt`, `updatedAt`, `copiedFrom`, `deletedAt`.
- [ ] **Step 2: Run** `npm run test:unit -- src/lib/sharing` — expect FAIL.
- [ ] **Step 3: Install** `npm install lz-string@1.5.0` (confirm the MIT license in `node_modules/lz-string/package.json`). **Implement** the five files.
- [ ] **Step 4: Run** — expect PASS. **Step 5: Commit** — `git commit -m "Add the sharing envelope, link codec, fingerprints, and import pipeline"`

### Task 9: Copies, the `/import` route, and "You already have a copy"

**Files:**

- Create: `src/lib/sharing/fingerprints.ts`, `src/lib/sharing/copy.ts`, `src/routes/Import.svelte`, `src/lib/components/dialogs/ExistingCopyDialog.svelte`
- Modify: `src/router.ts`, `src/lib/store/dashboard-index.svelte.ts`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/sharing/copy.test.ts`, `src/lib/store/dashboard-index.test.ts`, `src/lib/components/dialogs/existing-copy.browser.test.ts`, `e2e/sharing.spec.ts`

**Interfaces:**

- Consumes: `parseLinkFragment`, `Incoming` (Task 8).
- Produces:
  - `DashboardIndex.createFrom(doc: Dashboard): Promise<string>` (public form of `#create`; posts `committed`).
  - `fingerprints.ts`: `COPY_FINGERPRINTS_KEY = "copyFingerprints"` (preference value `Record<string, string[]>`, fingerprint → doc ids); `rememberCopy(platform, space, fingerprint, docId)`, `copiesOf(platform, space, fingerprint): Promise<string[]>`, `fingerprintOf(platform, space, docId): Promise<string | undefined>`, `forgetDocument(platform, space, docId)`.
  - `copy.ts`: `findExistingCopy(app: AppContext, fingerprint: string): Promise<DashboardSummary | null>` (live, non-deleted copies only; most recently updated wins); `saveCopy(app: AppContext, incoming: Extract<Incoming, { kind: "document" }>): Promise<string>` (new id, `copiedFrom` = `sourceId`, `version: 0`, now times; remembers the fingerprint).
  - `ExistingCopyDialog.svelte` module export: `askExistingCopy(copy: DashboardSummary): Promise<"open" | "new" | null>`.

- [ ] **Step 1: Write failing unit tests** (`copy.test.ts`, memory platform + `initApp`):
  - `saveCopy` stores a dashboard with a new id and `copiedFrom` = source id, and `findExistingCopy` then finds it.
  - A deleted copy (`deletedAt` set) isn't found. Two live copies → the most recently updated.
  - Review Focus 3: a second app on the same memory hub sees the copy in its `index.items` after `saveCopy` (no manual refresh).
- [ ] **Step 2: Write a failing browser test** for `ExistingCopyDialog`: shows `m.existing_copy_title()`, "Last changed <formatted date>", two buttons of equal variant; each resolves its choice; Escape resolves `null`.
- [ ] **Step 3: Run** unit + browser tests — expect FAIL.
- [ ] **Step 4: Implement.** `Import.svelte` (lazy route `"/import": () => import("./routes/Import.svelte")`): reads `location.hash` (no hash → `navigate("/", { replace: true })`), shows `m.import_opening()`, loads the sharing code through `loadLazy`, runs `parseLinkFragment`. Error → an `<h1>` with `m.import_link_invalid()` or `m.import_newer()` and a link to your dashboards. Document → existing copy? `askExistingCopy`: `"open"` navigates to it (replace), `null` stays on the page with both buttons still offered; otherwise `saveCopy` → `navigate("/dashboards/:id", { replace: true })` and toast `m.import_saved()`. Mount `ExistingCopyDialog` in `App.svelte`.
- [ ] **Step 5: Messages:** `import_opening` "Opening shared dashboard…", `import_saved` "Saved a copy to your dashboards", `import_link_invalid` "This link can't be opened.", `import_file_invalid` "This file can't be opened.", `import_newer` "This was made with a newer version of the dashboard. Reload to open it.", `existing_copy_title` "You already have a copy of this dashboard", `existing_copy_changed` "Last changed {date}", `existing_copy_open` "Open my copy", `existing_copy_new` "Make a new copy".
- [ ] **Step 6: Write `e2e/sharing.spec.ts`**, building links in Node with `lz-string` and the envelope shape (an `e2e/helpers.ts` function `shareLinkFor(doc)`; Task 10 switches the main test to a link copied from the Share dialog): `"opening a link saves a copy and drops the fragment"` (URL matches `DASHBOARD_URL`, toast shown, list shows it); `"reopening the same link asks; Open my copy goes back to it"`; `"…Make a new copy makes a second one"`; `"a tampered link shows the error and saves nothing"`.
- [ ] **Step 7: Run** unit, browser, `npm run test:e2e -- e2e/sharing.spec.ts` — expect PASS. **Step 8: Commit** — `git commit -m "Open shared links as copies, asking when a copy already exists"`

### Task 10: Share, Export, and Import actions

**Files:**

- Create: `src/lib/sharing/actions.ts`, `src/lib/sharing/file-names.ts`, `src/lib/components/dialogs/ShareDialog.svelte`
- Modify: `src/lib/actions/dashboard.ts`, `src/lib/components/shell/DashboardPicker.svelte`, `src/routes/DashboardList.svelte`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/sharing/file-names.test.ts`, `src/lib/components/dialogs/share-dialog.browser.test.ts`, `e2e/sharing.spec.ts`

**Interfaces:**

- Consumes: `shareUrl`, `documentFileJson`, `parseIncoming`, `MAX_BACKUP_BYTES` (Task 8); `findExistingCopy`, `saveCopy`, `askExistingCopy` (Task 9); `platform.clipboard`/`files` (Task 2); `loadLazy` (Task 3).
- Produces:
  - `file-names.ts`: `dashboardFileName(displayName: string, today: string): string` → lowercase slug (non-alphanumerics → `-`, collapsed, trimmed, ≤ 50 chars, fallback `m.file_dashboard_stem()` = "dashboard") + `-${today}.json`; `backupFileName(today: string): string` → `${m.file_backup_stem()}-${today}.json` with `file_backup_stem` = "sjvair-dashboards-backup".
  - `actions.ts` (lazy-loaded by the action handlers): `shareDashboard(app)`, `exportDashboard(app)`, `importFromFile(app): Promise<void>` (dispatches backups to `restoreFromEnvelope`, which Task 11 adds; until then a backup shows `m.import_file_invalid()`).
  - Registered actions: `"share-dashboard"` (`m.share_action()` "Share…", group `"share"`), `"export-dashboard"` (`m.export_action()` "Export…", group `"share"`), `"import"` (`m.import_action()` "Import…", group `"create"`). Share and Export work on the starter (via `starterDashboard()`), and on read-only documents Export saves the stored raw JSON inside a document envelope.
  - `ShareDialog.svelte` module export: `openShare(opts: { url: string | null; onDownload(): void }): void`.

- [ ] **Step 1: Write failing tests.** `file-names.test.ts`: `dashboardFileName("Ms. Lopez's class: PM2.5!", "2026-10-25")` → `"ms-lopez-s-class-pm2-5-2026-10-25.json"`; an all-symbol name → `"dashboard-2026-10-25.json"`; a 200-character name → slug ≤ 50. `share-dialog.browser.test.ts`: Copy calls `clipboard.writeText` and announces `m.share_copied()` in a live region; Review Focus 4: when `writeText` resolves `false`, the read-only field is focused with its whole value selected and no error is shown; `url: null` shows `m.share_too_big()` and only the download button.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `shareDashboard`: flush the current session, build `shareUrl(location.origin + import.meta.env.BASE_URL, doc, now)`, `openShare` (`url: null` when too long), `onDownload` = `exportDashboard`. `exportDashboard`: `platform.files.save(dashboardFileName(name, todayPacific()), documentFileJson(doc, now), "application/json")`. `importFromFile`: `files.open(".json,application/json")`; `size > MAX_BACKUP_BYTES` → error toast; read text; `parseIncoming`; documents follow the same existing-copy flow as `/import`, then navigate and toast. The picker and list include the `"share"` group (picker: after `"manage"`); the list adds an **Import…** button beside the create buttons.
- [ ] **Step 4: Messages:** `share_action`, `export_action`, `import_action`, `share_title` "Share dashboard", `share_note` "Anyone who opens this link gets their own copy. They won't see changes you make later.", `share_copy` "Copy link", `share_copied` "Link copied", `share_download_instead` "Download file instead", `share_too_big` "This dashboard is too big to share as a link. Download it as a file and send that instead.", `file_dashboard_stem`, `file_backup_stem`.
- [ ] **Step 5: Extend `e2e/sharing.spec.ts`**: replace the Node-built link with one copied from the Share dialog's field (`inputValue`), opened in a **new browser context**; `"Export then Import makes a copy"` (`page.waitForEvent("download")`, then `filechooser.setFiles`); Review Focus 5 for links: a dashboard made large enough (many widgets, via repeated Add widget or a seeded document) that its URL exceeds 8,000 → the dialog shows the too-big message.
- [ ] **Step 6: Run** — expect PASS. Check the entry chunk has no `lz-string` (`npm run build` and `grep -L compressToEncodedURIComponent dist/assets/index-*.js`). **Step 7: Commit** — `git commit -m "Add Share, Export, and Import"`

### Task 11: Backups and restore

**Files:**

- Create: `src/lib/sharing/restore.ts`
- Modify: `src/lib/sharing/export.ts`, `src/lib/sharing/actions.ts`, `src/routes/DashboardList.svelte`, `messages/en.json`
- Test: `src/lib/sharing/restore.test.ts`, `e2e/backup.spec.ts`

**Interfaces:**

- Consumes: `fingerprintOf`, `rememberCopy` (Task 9); `EnvelopeSchema` (Task 8).
- Produces:
  - `export.ts`: `backupJson(platform, space, now: Date): Promise<string>` — every stored document without a `deletedAt` string, raw as stored (read-only ones included), plus `fingerprints` for those that have one.
  - `restore.ts`: `type RestoreSummary = { restored: number; kept: number; readOnly: number; skipped: number }`; `restoreFromEnvelope(app: AppContext, envelope: Envelope): Promise<RestoreSummary>`.
  - `actions.ts`: `downloadBackup(app): Promise<void>` — saves `backupJson` as `backupFileName(todayPacific())` and sets `lastBackupAt` in the `backupReminder` preference (Task 12 defines the type; store `{ ...existing, lastBackupAt: now.toISOString() }`).

- [ ] **Step 1: Write failing tests** (`restore.test.ts`):
  - `"missing dashboards come back with the same id and fields"` (`version`, `createdAt`, `updatedAt`, `copiedFrom` preserved) → `restored`.
  - `"a dashboard already here is kept, changed or not"` → `kept`, stored copy unchanged.
  - `"a dashboard in Recently deleted is undeleted, keeping the browser's version"` → `restored`, `deletedAt` cleared through `applyChange` (a log entry exists).
  - `"read-only documents are stored as-is"` (newer `schemaVersion`) → `readOnly`; an invalid one with a string id → `readOnly`; one with no usable id, or whose JSON exceeds `MAX_DOCUMENT_CHARS` → `skipped`.
  - `"fingerprints are restored"` → `findExistingCopy` finds the restored copy.
  - `"backupJson leaves out deleted dashboards and includes read-only ones"`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Restores commit with `baseVersion: null`, `entries: []`, store the raw document as stored (it's upgraded with a kept original when opened), post `committed`, and refresh the index once at the end. `importFromFile` sends backups here, then toasts the summary and navigates to `/dashboards`. The list gets a **Download a backup** button.
- [ ] **Step 4: Messages** (use Paraglide plural variants for counts): `backup_download` "Download a backup", `restore_restored` "Restored {count} dashboards.", `restore_kept` "{count} were already here and kept as they are.", `restore_read_only` "{count} restored read-only.", `restore_skipped` "{count} couldn't be read." (each a whole sentence, shown on separate lines).
- [ ] **Step 5: Write `e2e/backup.spec.ts`**: `"backup, delete everything, restore brings the same ids back"` (make two dashboards, download a backup, open a **new browser context** (empty storage), import the file there; both dashboards' URLs open with the same ids); `"restoring twice keeps everything as it is"`.
- [ ] **Step 6: Run** — expect PASS. **Step 7: Commit** — `git commit -m "Add backups that restore without overwriting"`

### Task 12: Recently deleted, purge, and journal housekeeping

**Files:**

- Create: `src/lib/safety/purge.ts`, `src/lib/components/dashboard/RecentlyDeleted.svelte`, `src/lib/components/dialogs/ConfirmDialog.svelte`
- Modify: `src/lib/store/dashboard-index.svelte.ts`, `src/lib/store/journal.ts`, `src/lib/store/app.svelte.ts`, `src/lib/components/shell/DashboardPicker.svelte`, `src/routes/DashboardList.svelte`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/safety/purge.test.ts`, `src/lib/store/dashboard-index.test.ts`, `src/lib/store/journal.test.ts`, `e2e/safety.spec.ts`

**Interfaces:**

- Consumes: `documents.remove`, `originals`, `journal.list` (Task 1); `forgetDocument` (Task 9).
- Produces:
  - `RETENTION_MS = 30 * 24 * 60 * 60 * 1000` (in `purge.ts`).
  - `purgeExpired(platform: Platform, space: SpaceId, now: Date): Promise<void>` — removes dashboards deleted more than `RETENTION_MS` ago (plus their journal records and fingerprints), originals kept more than `RETENTION_MS` ago, and journal records whose dashboard isn't stored or whose `writtenAt` is older than `RETENTION_MS`. `initApp` runs it before the first `index.refresh()`.
  - `DashboardIndex.deleted: DashboardSummary[]` (`$state.raw`, newest `deletedAt` first); `DashboardIndex.remove(id: string): Promise<void>` ("Delete now": `documents.remove`, journal records, fingerprints, then posts `committed`).
  - `pendingName(records: Array<{ record: unknown }>): string | null | undefined` in `store/journal.ts` — the last `setField` `name` change in the newest valid record; `undefined` when none. The index uses it to override a summary's name.
  - `restoreDeleted(app, id): Promise<void>` in `src/lib/actions/dashboard.ts` — opens the session, applies `setField deletedAt → null`, flushes, refreshes, navigates to it.
  - `ConfirmDialog.svelte`: `confirmAction(opts: { title: string; body: string; confirm: string; destructive?: boolean }): Promise<boolean>`.

- [ ] **Step 1: Write failing tests.** `purge.test.ts` (injected `now`): deleted 31 days ago → gone with its log, original, journal records, fingerprint; deleted 29 days ago → kept; an original kept 31 days ago → gone; a journal record for a missing dashboard → cleared; one written 31 days ago → cleared; a recent one for a stored dashboard → kept. `dashboard-index.test.ts`: `deleted` lists soft-deleted dashboards newest first; `remove` deletes for good; a name pending only in a journal record shows in `items`' display names. `journal.test.ts`: `pendingName` cases.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**, plus the UI: `RecentlyDeleted.svelte` (a section with `id="recently-deleted"` and an `<h2>` `m.deleted_heading()`; rows with the display name, `m.deleted_on({ date })`, **Restore**, **Delete now** → `confirmAction`), rendered on the list when `index.deleted.length > 0`. The picker shows a final **Recently deleted** item (`m.deleted_picker({ count })`) linking to `/dashboards#recently-deleted` when there are any; the list scrolls to and focuses the heading when that hash is present.
- [ ] **Step 4: Messages:** `deleted_heading` "Recently deleted", `deleted_picker` "Recently deleted ({count})", `deleted_on` "Deleted {date}", `deleted_restore` "Restore", `deleted_delete_now` "Delete now", `deleted_confirm_title` "Delete this dashboard now?", `deleted_confirm_body` "It can't be restored afterwards.".
- [ ] **Step 5: Write `e2e/safety.spec.ts`**: `"delete from the picker, then restore from Recently deleted"` (after the toast is gone); `"Delete now removes it for good"`.
- [ ] **Step 6: Run** — expect PASS.
- [ ] **Step 7: Update `DEFERRED.md`**: remove "Journal limits and cleanup"; remove the recovery half of "Save-status and undo-toast timing" (the announcements half stays). Commit — `git commit -m "Add Recently deleted and purge expired data on open"`

### Task 13: Storage protection, the status popover, and the backup reminder

**Files:**

- Create: `src/lib/safety/protection.svelte.ts`, `src/lib/safety/reminder.ts`, `src/lib/components/shell/StorageStatus.svelte`, `src/lib/components/ui/popover/*` (via `npx shadcn-svelte@latest add popover`)
- Modify: `src/lib/components/shell/SavedIndicator.svelte`, `src/lib/components/shell/NoticeBars.svelte`, `src/lib/store/app.svelte.ts`, `src/routes/DashboardList.svelte`, `messages/en.json`
- Test: `src/lib/safety/reminder.test.ts`, `src/lib/safety/protection.test.ts`, `src/lib/components/shell/storage-status.browser.test.ts`

**Interfaces:**

- Consumes: `platform.persistence` (Task 2); `downloadBackup` (Task 11); `DocumentSession.errorKind` (Task 6).
- Produces:
  - `class StorageProtection { state: Protection; ready: boolean; refused: boolean; prompts: boolean; refresh(): Promise<void>; requestAuto(): Promise<void>; requestByClick(): Promise<void> }` — `requestAuto` does nothing when `prompts` is true; `requestByClick` sets and stores `refused` when the result isn't `"protected"`. `AppContext.protection: StorageProtection`. `initApp` calls `refresh()` and calls `requestAuto()` once, on this tab's first `committed` message (the local echo).
  - `reminder.ts`: `REMINDER_KEY = "backupReminder"`; `type ReminderPrefs = { lastBackupAt?: string; lastShownAt?: string; off?: boolean; persistRefused?: boolean }`; `REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000`; `shouldShowReminder(input: { protection: Protection; dashboards: DashboardSummary[]; prefs: ReminderPrefs; now: Date }): boolean`.

- [ ] **Step 1: Write failing tests.** `reminder.test.ts`, one test per rule in §7: `"protected"` → false; no dashboards → false; same Pacific day as the earliest `createdAt` → false, the next Pacific day → true (use a time near midnight Pacific to prove Pacific, not UTC); `off` → false; nothing updated since `lastBackupAt` → false; `lastShownAt` 13 days ago → false, 14 days → true; `"unknown"` counts as unprotected. `protection.test.ts`: `requestAuto` requests when `prompts` is false and not when true; `requestByClick` → `refused` stored on `"unprotected"`. `storage-status.browser.test.ts`: the popover shows `m.storage_note()`; adds `m.storage_note_unprotected()` and the backup link when unprotected; shows **Protect my dashboards** only when `prompts && !refused && state !== "protected"`; shows `m.save_failed_quota()` / `m.save_failed_unavailable()` for each `errorKind`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `SavedIndicator` becomes the popover's trigger button (its label keeps the save status; the button's accessible name adds `m.storage_status_label()` "Storage status"); keep the existing `aria-live` text. `StorageStatus.svelte` is the popover content: note lines, the error explanation, **Download a backup**, **Protect my dashboards**, and a **Clear my data…** button (Task 14 wires it). The list shows the same note lines. `NoticeBars` shows the reminder bar on dashboard routes when `shouldShowReminder(...)` is true (evaluated once per page load after `protection.ready`; writing `lastShownAt` = now when shown): text `m.reminder_text()`, **Download a backup**, **Protect my dashboards** (same condition as above), **Not now** (hides it for this page load), **Don't remind me again** (`off: true`).
- [ ] **Step 4: Messages:** `storage_status_label`, `storage_note` "Dashboards are stored in this browser.", `storage_note_unprotected` "Your browser may clear them to free up space (Safari does after 7 days without a visit).", `protect_button` "Protect my dashboards", `reminder_text` "Your dashboards are only stored in this browser. Download a backup so you don't lose them.", `reminder_not_now` "Not now", `reminder_off` "Don't remind me again", `save_failed_quota` "This browser is out of storage space, so your latest changes aren't saved yet. Download a backup to keep them.", `save_failed_unavailable` "This browser isn't letting the workspace save right now. Your changes are kept while this page stays open.".
- [ ] **Step 5: Run** — expect PASS. **Step 6: Commit** — `git commit -m "Add the storage status note, click-to-protect, and the backup reminder"`

### Task 14: Clear my data

**Files:**

- Create: `src/lib/safety/clear.ts`, `src/lib/components/dialogs/ClearDataDialog.svelte`
- Modify: `src/lib/store/tab-channel.ts`, `src/lib/store/app.svelte.ts`, `src/lib/components/shell/StorageStatus.svelte`, `src/routes/DashboardList.svelte`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/safety/clear.test.ts`, `src/lib/store/tab-channel.test.ts`, `e2e/safety.spec.ts`

**Interfaces:**

- Consumes: `reset.clearAll`/`generation` (Task 2); `resetAfterClear` (Task 6); `downloadBackup` (Task 11).
- Produces:
  - `TabMessage` becomes a union adding `{ type: "cleared"; generation: string; tabId: string }` (`isTabMessage` accepts both; sessions and the index ignore it; `App` handles it with `resetAfterClear`).
  - `clearMyData(app: AppContext): Promise<void>` — `platform.reset.clearAll()`, post `cleared`, `app.resetAfterClear()`.
  - `ClearDataDialog.svelte`: `openClearData(): void`.

- [ ] **Step 1: Write failing tests.** `clear.test.ts` (two apps on one memory hub and one memory platform): after `clearMyData` in app A, both indexes are empty, both apps' `current` is none, and an edit still pending in app B's session is **not** saved (flush B → nothing stored); B's pending journal write is a no-op. `tab-channel.test.ts`: `cleared` messages pass `isTabMessage`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the dialog: title `m.clear_title()`, body `m.clear_body({ count, deleted })` with live and deleted counts from the index, **Download a backup first** (`downloadBackup`, dialog stays open), a destructive **Clear everything**, Cancel. Buttons on the list and in the popover open it.
- [ ] **Step 4: Messages:** `clear_action` "Clear my data…", `clear_title` "Clear my data?", `clear_body` "This removes {count} dashboards from this browser, including {deleted} in Recently deleted. It can't be undone." (plural variants), `clear_backup_first` "Download a backup first", `clear_confirm` "Clear everything".
- [ ] **Step 5: Extend `e2e/safety.spec.ts`**: `"Clear my data with two tabs leaves both on the starter and nothing comes back"` (two pages in one context; make an edit in tab 2 without waiting for Saved; clear in tab 1; both show the starter; reload both; still the starter and an empty list).
- [ ] **Step 6: Run** — expect PASS. **Step 7: Commit** — `git commit -m "Add Clear my data"`

### Task 15: Restore an earlier version

**Files:**

- Create: `src/lib/safety/restore-version.ts`, `src/lib/components/dialogs/RestoreVersionDialog.svelte`
- Modify: `src/lib/actions/dashboard.ts`, `src/App.svelte`, `messages/en.json`
- Test: `src/lib/safety/restore-version.test.ts`, `src/lib/components/dialogs/restore-version.browser.test.ts`

**Interfaces:**

- Consumes: `originals.get` (Task 1); `replaceDocument` (Task 5); `DocumentSession.hasOriginal` (Task 7).
- Produces: `restoreOriginal(app: AppContext, session: DocumentSession): Promise<boolean>` (loads the original through `loadDashboard`; on success applies one `replaceDocument` and returns `true`; on failure returns `false`); the `"restore-version"` action (`m.restore_version_action()` "Restore an earlier version…", group `"manage"`), **included only when** `session.hasOriginal`; `openRestoreVersion(original: KeptOriginal): void`.

- [ ] **Step 1: Write failing tests:** with a test chain and a kept original, `restoreOriginal` replaces name and body, and `session.undo()` brings the current version back; an original that fails the pipeline → `false`, document unchanged. Browser test: the dialog lists `m.restore_version_item({ date })` and **Restore** calls through; failure shows `m.restore_version_failed()`.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Messages:** `restore_version_action`, `restore_version_title` "Restore an earlier version", `restore_version_item` "Before the update on {date}", `restore_version_confirm` "Restore", `restore_version_failed` "That version can't be opened.".
- [ ] **Step 5: Run** — expect PASS. **Step 6: Commit** — `git commit -m "Add Restore an earlier version for kept originals"`

### Task 16: Accessibility, the chunk-failure E2E, docs, and the full suite

**Files:**

- Modify: `e2e/a11y.spec.ts`, `e2e/version.spec.ts`, `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, `CLAUDE.md` (Key Libraries: move `lz-string` to Installed)

- [ ] **Step 1: Extend `e2e/a11y.spec.ts`** (axe, no violations): the Share dialog, the `/import` error page, the existing-copy dialog, the list with Recently deleted showing, the Clear my data dialog, the storage popover open, a dashboard with the reminder bar (seed preferences so it shows), and a dashboard with the reload bar.
- [ ] **Step 2: Add to `e2e/version.spec.ts`**: `"a failed lazy chunk shows the reload bar"` — `page.route(/\/assets\/(actions|codec)-.*\.js$/, (r) => r.abort())`, click Share…, expect the reload bar.
- [ ] **Step 3: Run** `npm run test:e2e` — expect PASS; then the three engines (`npm run test:e2e:podman`) — expect PASS.
- [ ] **Step 4: Update docs.** `ARCHITECTURE.md` → "Saving & sharing documents": copy versus restore, "You already have a copy" (content fingerprints, local only), the envelope, the 8,000-character link cap, backup contents, the backup reminder's rules, click-to-protect where the browser would prompt, the local amendment to version-skew rule 2 (`migrateChange`, and every `schemaVersion` bump also bumps the IndexedDB version). `DEFERRED.md` → add: the manual link-length check in Google Classroom and webmail (revisit before the private preview); the "sign in to keep this safe everywhere" reminder line (revisit with spec 5 / server-backed documents); Collections and analyses in Share, Export, and backups (revisit with spec 4 and the Analysis step); confirm every spec-1 item finished here is gone and the parts marked "stays" remain. `TODO.md` "Start here": spec 3 built, PR open.
- [ ] **Step 5: Run the full gate:** `npm run lint`, `npm run check`, `npm run test`, `npm run build` — all pass; the entry chunk contains no `lz-string` code.
- [ ] **Step 6: Commit** — `git commit -m "Cover spec 3 screens with axe, and update the docs"`
