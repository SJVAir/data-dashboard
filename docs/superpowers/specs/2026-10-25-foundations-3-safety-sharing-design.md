# Foundations, spec 3: safety and sharing

Date: 2026-10-25. Branch: `foundations-3-safety` (stacked on `foundations`, PR into it).
Release 1, step 1 (Foundations), third of five specs. Specs 1 (the working core) and 2 (the
data layer) are merged into `foundations`.

## Why

After specs 1 and 2, people can build dashboards that autosave in their browser, but they
can't give one to anyone, can't back one up, and lose a deleted dashboard for good once the
undo toast disappears. Anonymous users, who will be most people (students especially), only
have their browser's storage, and Safari clears it after 7 days without a visit. Spec 3
makes local-only use safe and shareable without a server:

- **Sharing without accounts.** A teacher clicks Share, copies a link, and each student who
  opens it gets their own copy. Files work the same way for dashboards too big for a link.
- **Not losing work.** Backups that restore cleanly, "Recently deleted", a quiet note about
  how safe storage is, and a backup reminder that doesn't nag.
- **Surviving app updates.** New deploys, old open tabs, and future format changes must
  never corrupt or silently drop a dashboard.
- **Treating everything that comes in as untrusted.** Links and files are the first way
  outside content enters the app (`ARCHITECTURE.md` → "Security baseline for untrusted
  content").

It also folds in the spec-1 robustness leftovers that `DEFERRED.md` tagged for spec 3
(decided by the user 2026-10-25).

## Goals

1. **Share by link**: "Share…" produces a link with the dashboard compressed into the URL
   fragment; opening it saves a copy and opens it.
2. **Export and Import** single dashboards as files (a copy on import), and **Download a
   backup** of every dashboard (a restore on import).
3. **"You already have a copy"**: reopening a link or export file you already imported asks
   whether to open your copy or make a new one.
4. **Validation and size limits** on every incoming document before anything is saved.
5. **"Recently deleted"** with restore and a 30-day purge.
6. **Durability**: request persistent storage, a quiet storage status note, and a rare,
   dismissible backup reminder.
7. **"Clear my data"** for shared computers.
8. **Version skew**: `version.json` deploy detection and a reload bar, chunk-load failures
   showing the same bar, old tabs handling a storage layout change, and pending edits from
   an older format never applied blindly.
9. **Upgrade safety**: keep the untouched original for 30 days before any upgrade, and a
   minimal "Restore an earlier version".
10. **The spec-1 robustness leftovers** (section 11).

## Non-goals

- Anything server-backed: live share links, `/workspace/shared/:token`, server snapshots,
  the server block list for bad builds, sync (the server-backed documents track).
- Sign-in, account spaces in use, and the "sign in to keep this safe everywhere" line
  (spec 5 and the server track; recorded in `DEFERRED.md`).
- Error reporting to Sentry (spec 5). Where this spec says "report", it means a call to a
  reporting hook that spec 5 wires to Sentry; until then it logs in development only.
- Collections and analyses as shareable documents (spec 4 and later). Share, Export, and
  backups handle dashboards only, but the file envelope (section 3) is shaped so other
  kinds can be added without a new format.
- Notes Markdown rendering (Release 1 step 4 builds Notes; its safe renderer lands then).
- The CSP itself, the build output for the Django template, and the S3 upload headers for
  `version.json` (spec 5 and the hosting track). This spec emits `version.json` and finds
  it relative to the entry module, as `ARCHITECTURE.md` → "Template embedding" says.

## Anti-goals

- **Nagging.** The backup reminder must never feel constant (the user's words: "if it
  nags them constantly"). Rare, only when useful, one-click dismiss, and an off switch.
- **Old data overwriting newer work.** A backup restore never replaces a dashboard that is
  already in the browser.
- **Surprise destinations.** Opening a link never silently takes someone to an old copy.
- **Partial imports.** An invalid document is rejected whole, never partly loaded.
- **Stored English**, direct storage or browser-API calls outside the platform adapter, and
  hardcoded styling values (the usual rules in `CLAUDE.md`).

## Constraints

All already decided; see `CLAUDE.md` and the named `ARCHITECTURE.md` sections.

- "Saving & sharing documents" (versioning, version skew, recovery, local durability
  safeguards, share semantics: file and URL shares fork on open).
- "Security baseline for untrusted content" item 1: schema plus size limit **before**
  migration or use.
- "Routing, URL state & undo": `/import#<lz-compressed document>`; trimmed paths redirect.
- "Platform strategy": clipboard, file save/open, storage persistence, and clearing go
  through the platform adapter, added as new capabilities (purely additive, as spec 1
  required).
- New dependency: **`lz-string`** 1.5.0 (MIT), already the decided library. Share and
  import code is lazy-loaded so it stays out of the initial bundle (about 200 KB budget).
- Svelte 5 runes, Tailwind v4 tokens, shadcn-svelte / bits-ui, Paraglide messages, the
  `format` module for dates, WCAG 2.2 AA.

## What gets built

### 1. Platform adapter additions

New capabilities on `Platform` (names are the builder's call), with web and in-memory
implementations, following the existing contract-test pattern
(`src/lib/platform/storage-contract.ts`):

- **`clipboard`**: write text. The web implementation uses `navigator.clipboard.writeText`;
  on failure the Share dialog keeps the link selected in a read-only field so it can be
  copied by hand.
- **`files`**: `save(name, contents, type)` (web: a download through an object URL) and
  `open(accept)` returning the chosen file's text and size, or nothing if cancelled (web: a
  hidden file input). Tauri later swaps in native dialogs.
- **`persistence`**: `persisted()` and `request()` over `navigator.storage`; it answers
  "unknown" where the API is missing.
- **`clearAll()`**: removes everything the dashboard stores in this browser (all IndexedDB
  stores, all journal records, preferences), for "Clear my data".
- The page-visibility reads in `DocumentSession` move onto the existing `platform.activity`
  (a `DEFERRED.md` item).

### 2. The import pipeline (one path for links and files)

Every incoming document, from a link fragment or a file, goes through the same steps, and
nothing is written until all of them pass:

1. **Size check on the raw input** before decompressing or parsing. Limits (_my calls_):
   a single document at most **1 MB** of JSON (matching the planned server body limit;
   the decompressed text is checked too, so a small link can't expand into a huge
   document); a backup file at most **1 MB per document it claims, capped at 50 MB**.
2. **Decompress** (links) and **parse JSON**.
3. **Validate the envelope** (section 3) with zod.
4. **Run each document through the existing load pipeline** (`loadDashboard`: validate
   against its `schemaVersion`, migrate step by step, validate against the current schema).
   - A **newer** `schemaVersion`: refused with "This was made with a newer version of the
     dashboard. Reload to open it." Nothing is saved. (An import can't open read-only the
     way a stored document does, since there's nothing stored to protect.)
   - **Invalid**: refused with "This link can't be opened" / "This file can't be opened".
5. **Save** (as a copy, or as a restore, per section 4), then report the outcome.

Errors are shown in place: on the `/import` page for links, in a toast or dialog for files.
One bad document in a backup is skipped and counted in the summary; it doesn't block the
others.

### 3. File and link formats

- **The envelope** (_my call_; field names are the builder's): a small wrapper that names
  what the file is, so the app can tell a single export from a backup and refuse anything
  else, e.g. `{ format: "sjvair-workspace", type: "document" | "backup", formatVersion: 1,
  exportedAt, documents: [...] }`. A `document` envelope holds exactly one document. The
  envelope has its own version, separate from `schemaVersion`.
- **What goes in a shared document** (links and Export files): `kind`, `schemaVersion`,
  `id` (the source's id, which becomes the copy's `copiedFrom`), `name`, and `body`.
  Local-only fields (`version`, `createdAt`, `updatedAt`, `copiedFrom`, `deletedAt`) are
  left out. On import the copy gets fresh local fields (new id, `version: 0`, `createdAt` and
  `updatedAt` set to now) **before** it enters `loadDashboard`, since the stored schema
  requires them (_my call_).
- **What goes in a backup** (_my call_): each dashboard **exactly as stored**, every field
  included (`version`, `createdAt`, `updatedAt`, `copiedFrom`), plus its local fingerprint
  if it has one (section 4), as backup-only metadata beside the document. A backup is the
  person's own file, so carrying these is fine; it keeps list order, home resolution, "Last
  changed", the reminder's "changed since the last backup" check, and "You already have a
  copy" working after a restore. A restored dashboard keeps its stored `version`; its change
  log starts empty at that version (the commit contract allows it, section 11).
- **Links**: `<origin>/workspace/import#<payload>`, where the payload is the single-document
  envelope compressed with `lz-string`'s URL-safe encoding, plus a short format prefix so a
  later encoding can coexist (_builder's call_). The fragment is never sent to a server.
- **Link length cap**: about **8,000 characters** for the whole URL (_my call_). Email,
  messaging, and class-portal tools such as Google Classroom can mangle very long links. It
  ships as a provisional constant in one place (_my call_); checking it in Google Classroom
  and a common webmail client needs real accounts, so it is a manual check for the user
  before the private preview, recorded in `DEFERRED.md`, not a "done when" item for this
  spec. Over the cap, the Share dialog says the dashboard is too
  big for a link and offers the file instead.
- **File names**: from a message key plus the dashboard's display name or "backup" and the
  Pacific date, with a `.json` extension (_builder's call_ on exact form; no stored English,
  since the name is generated at download time).
- **Read-only documents** (newer or invalid ones stored in this browser) can be exported
  and are included in backups as stored, unvalidated, so they can be moved to a browser
  with a newer version (_my call_). Importing them goes through the full pipeline there.

### 4. Copy versus restore

| What's imported           | Meant for     | Result                                         |
| ------------------------- | ------------- | ---------------------------------------------- |
| A link                    | someone else  | a new copy (new id, `copiedFrom` = source id)  |
| An Export file (one doc)  | someone else  | a new copy, like a link                        |
| A backup file (all docs)  | yourself      | a restore: same ids, never overwrites anything |

**Copies** (links and Export files):

- The copy keeps the shared `name` as-is (text or `null`); the existing duplicate-name
  question stays in `DEFERRED.md` ("Names of copies").
- After saving, the app navigates to `/workspace/dashboards/<new id>`, **replacing** the
  `/import#…` history entry so a reload or Back doesn't import again, and shows a toast:
  "Saved a copy to your dashboards".
- **"You already have a copy"** (agreed 2026-10-25): if this browser already has a
  non-deleted copy made from **the same contents**, the app asks first:
  "You already have a copy of this dashboard. Last changed <date>. [Open my copy]
  [Make a new copy]". Both buttons are equally prominent.
  - **Same contents** means a fingerprint (e.g. SHA-256 through `crypto.subtle`) of the
    imported document's canonical JSON. A teacher who changes the dashboard and sends a new
    link produces a new fingerprint, so students get a fresh copy with no prompt.
  - **A deleted copy doesn't count**, including one still in "Recently deleted".
  - Where the fingerprint lives is the builder's call, but it must stay local and must not
    travel in shares or exports (e.g. a per-space index from fingerprint to document id,
    in preferences or a small store). If several live copies match, "Open my copy" opens
    the most recently changed one.
  - The prompt is a dialog on the `/import` page for links, and the same dialog for files.
- Importing **the starter dashboard** shared unchanged works like any other copy. Share and
  Export are offered on the starter too.

**Restores** (backup files; agreed 2026-10-25):

- A dashboard whose id **isn't in this browser** is restored with the same id, so bookmarks
  to `/workspace/dashboards/<id>` work again.
- A dashboard whose id **is already here** is left alone, whether or not it changed since
  the backup. A backup never overwrites anything.
- A dashboard whose id is here but **in "Recently deleted"** is undeleted, keeping the
  browser's version (the newer one) rather than the backup's (_my call_, consistent with
  "never overwrite newer work").
- Afterwards a summary: "Restored 4 dashboards. 2 were already here and kept as they are."
  (plus a count of any skipped as unreadable). The person stays on, or is taken to, the
  dashboards list.
- **Backups include** every non-deleted dashboard in the current space, plus read-only ones
  as stored (section 3). Dashboards in "Recently deleted" are left out (_my call_).
- **Read-only dashboards in a backup are restored as stored** (_my call_), so they open
  read-only again, exactly as before, with no upgrade attempted. This is the one exception
  to section 2's refusal of newer or invalid documents, and it applies only to restores
  (links and Export files still refuse them), because refusing would lose them for good
  after backup → Clear my data → restore. They still pass the envelope check and the size
  limit, and the summary counts them: "1 was restored read-only".

### 5. Where these live in the UI

- **"Share…"** and **"Export…"**: registered actions in the dashboard's menu and the
  picker (the same action registry, not copies).
- **The Share dialog**: the link in a read-only field, a Copy button (with a "Copied"
  confirmation announced through a live region), a one-line note that the person who opens
  it gets their own copy and won't see later changes, and "Download file instead". When the
  dashboard is too big for a link, the dialog shows that message and the download button
  only.
- **"Import…"**: an action in the picker and on the dashboards list. It opens the file
  chooser; the file decides whether it's a copy or a restore.
- **"Download a backup"**: on the dashboards list, in the storage status popover (section
  7), and in the backup reminder.
- **`/import` route**: shows a brief "Opening shared dashboard…" state, then the prompt, the
  error, or the redirect. `/import` with no fragment redirects to the home route (the
  trimmed-path rule).

### 6. "Recently deleted"

- A **"Recently deleted"** entry at the bottom of the picker and a section on the dashboards
  list, listing this space's soft-deleted dashboards: display name, when deleted (through
  the `format` module), **Restore**, and **Delete now** (with a confirmation dialog).
- **Restore** clears `deletedAt` through `applyChange` (so it syncs across tabs like any
  edit) and opens the dashboard.
- **Purge**: when the app opens, dashboards deleted more than 30 days ago are removed for
  good, along with their change log, kept original, journal records, and fingerprint
  entries. No timers.
- This closes the deferred accessibility gap: a dashboard deleted from the picker is
  recoverable after the 4-second undo toast is gone (`DEFERRED.md` → "Save-status and
  undo-toast timing", the recovery half; the announcement half stays deferred to the design
  pass).

### 7. Durability: persistence, status note, backup reminder

- **Persistent storage: click-to-protect where the browser would prompt** (decided by the
  user 2026-10-25, refining `ARCHITECTURE.md`'s "request on the first create or edit"):
  - Where the browser decides silently (Chrome, Edge, Safari), it is requested
    automatically on the first document create or edit, as before.
  - Where requesting would show a browser permission prompt (**Firefox**), the app never
    requests on its own. Instead the storage status note and the backup reminder bar offer
    **"Protect my dashboards"**, which makes the request (and so shows Firefox's prompt)
    only when clicked, after the person has read why. Until it's granted, storage counts
    as unprotected, so the backup reminder still covers them. If they refuse the prompt,
    the button stays in the status note but leaves the reminder bar.
  - How the app tells the two cases apart is the builder's call (prefer a feature check,
    such as the Permissions API's `persistent-storage` state, over browser sniffing; fall
    back to treating an unknown browser as "would prompt").
  - Why: an unexplained pop-up on a student's first edit gets dismissed with "Don't allow",
    and in Firefox unprotected storage is only cleared under disk pressure, so waiting
    costs little.
- **The storage status note** (agreed 2026-10-25) appears in a small popover from the
  "Saved" indicator and on the dashboards list: "Dashboards are stored in this browser."
  When storage isn't protected, a second line says the browser may clear them (on Safari:
  after 7 days without a visit), with a "Download a backup" link. It never interrupts.
- **The backup reminder** (agreed 2026-10-25; the numbers are the user-approved defaults):
  - Shown **only when storage isn't protected**.
  - **Never on a first visit**: only once this space has a dashboard of its own and it's a
    later Pacific calendar day than the first one was created.
  - **Only when there's something new to back up**: a dashboard changed after the last
    backup download (any export of a backup resets the clock).
  - **At most once every 14 days**, as a slim bar above the dashboard: "Download a backup"
    and "Not now". No dialog, no toast.
  - **"Don't remind me again"** turns it off for good in this browser (stored per space);
    the status note stays available.
  - State (first-dashboard day, last backup, last reminder, turned off) is stored per space
    through preferences.
- **Quota and write errors** (the fuller messages spec 1 deferred): a failed save keeps the
  in-memory document, the "Saved" indicator says it couldn't save, and its popover explains
  why in plain words (storage full versus storage unavailable) and offers "Download a
  backup" so nothing is lost. Failed saves are retried on a backoff timer (section 11).

### 8. "Clear my data"

Agreed 2026-10-25.

- On the dashboards list and in the storage status popover.
- A confirmation dialog says what will be removed ("4 dashboards, including 1 in Recently
  deleted"), offers **"Download a backup first"**, and has a clearly labeled destructive
  **"Clear everything"** button.
- It removes everything the dashboard stores in this browser, in every space: dashboards,
  change logs, kept originals, journal records, preferences, fingerprints, and reminder
  state. It never touches the server (there's nothing there yet).
- **Other open tabs reset at the same moment**: a broadcast tells them to drop their
  sessions **without** flushing pending saves or journal records, so no tab can save an old
  dashboard back. The builder must also make a tab that misses the broadcast (frozen,
  back/forward cache) unable to resurrect data, e.g. with a "cleared" generation marker
  checked before any write.
- Afterwards every tab lands on the starter dashboard, as a first-time visitor would.

### 9. Version skew

- **Build id**: the git commit, stamped into the code at build time (`"dev"` in
  development).
- **`version.json`**: the build emits it with the build id. The app fetches it relative to
  the entry module with `cache: "no-store"` when the tab becomes visible again (through
  `platform.activity`) and once an hour while visible. Disabled in development.
- **The reload bar**: when the fetched build id differs, a slim, non-blocking bar: "A new
  version is available. [Reload]". Reloading first flushes pending saves. It stays until
  reload; it doesn't block editing.
- **Chunk-load failures** (a lazily loaded file from an older deploy is gone) show the same
  bar instead of an error, through Vite's preload-error event and a catch around lazy
  imports.
- **An old tab when the storage layout changes**: when IndexedDB tells a tab another tab
  needs a newer layout (`versionchange` / `blocking`), the tab writes pending changes to the
  journal synchronously, closes its connection so the other tab isn't blocked, stops saving,
  and shows the reload bar. When the browser terminates the connection instead, the tab tries
  to reopen once; if that fails it shows the "couldn't save" state. (This is the "IndexedDB
  adapter robustness" reopen item.) The `originals` and `syncQueue` stores already exist
  from spec 1, so spec 3 itself needs no layout change; this handling is for later ones.
- **Pending edits from an older format** (_my call_; amends `ARCHITECTURE.md` → "Version
  skew" rule 2 for local replay): every log entry and journal record already carries the
  `schemaVersion` it was written against. Each `Migration` gains a required
  **`migrateChange(change)`** that returns the change rewritten for the next format, or
  `null` when it can't be carried over. On open, pending changes older than the current
  format are upgraded through the chain alongside the document and then replayed. Changes
  that can't be carried over are not applied; the person sees "Some unsaved edits from
  before the update couldn't be applied", and the kept original (section 10) still holds
  the pre-upgrade document. Server-side, rule 2 stands as written (sync before migrating);
  that's the server track's concern. Tested with the test-only migration.
- **Old tabs after a format change** (_my call_): **every `schemaVersion` bump also bumps
  the IndexedDB version**, so the `versionchange` handling above forces old tabs to stop
  saving and show the reload bar before they can write old-format documents or log entries.
  As a second guard, a tab that reads a log entry or stored document with a newer
  `schemaVersion` than it knows (during catch-up or rebase) stops saving and shows the
  reload bar instead of applying it. So `migrateChange` only ever runs on journal records
  and log entries older than the current format, at open.

### 10. Upgrade safety: kept originals and "Restore an earlier version"

- **Before a stored dashboard is first saved in an upgraded format**, the untouched
  original is written to the existing `originals` store (one per document, replacing any
  older one), with the date. If the upgraded document fails validation, nothing is saved:
  the original stays as stored, the dashboard opens read-only (already built in spec 1),
  and the reporting hook is called.
- Originals are purged after 30 days, on app open.
- **"Restore an earlier version"** appears in the dashboard menu only when a kept original
  exists. It opens a dialog listing it with its date. Restoring runs the original through
  the current load pipeline (so a fixed migration gets another try) and applies the result
  as one **`replaceDocument`** change through `applyChange` (_my call_). Undo reverses it,
  and it syncs to other tabs like any edit. For conflict handling, `replaceDocument`
  overlaps every other change.
- Server snapshots join this list in the server track; that's already in `ARCHITECTURE.md`.

### 11. The spec-1 robustness leftovers

Each leaves `DEFERRED.md` when done (the parts noted as staying, stay):

- **Name normalization edge cases**: never split a surrogate pair (or, better, a grapheme)
  at the 100-character cut; test trimming after the cut.
- **Migration chain hardening**: the chain's test no longer hard-codes `to: 1`; document
  that migrations (and the new `migrateChange`) must not mutate their input. _Stays:_ the
  bare `catch` hiding migration bugs, which waits for spec 5's reporter.
- **IndexedDB adapter robustness**: the reopen and `versionchange` handling (section 9);
  enforce the commit precondition (`doc.version` equals the last entry's, entries
  contiguous); make the memory and IndexedDB adapters agree on duplicate entry versions;
  define and test a commit on a missing id with a numeric base, and `readLog` for an
  unknown document.
- **DocumentSession durability gaps**: edits queued during the starter hand-off are kept
  (and journaled) when the hook returns `null`, rejects, or is still running; failed saves
  are retried on a backoff timer, not only on the next edit or `pagehide`. _Stays:_
  reporting commit-chain errors (spec 5).
- **Cross-tab sync edge cases**: no stale conflict pairs after a catch-up from a trimmed
  log during a conflict; "Keep mine" after a journal-replay conflict keeps edits to widgets
  the other side deleted (a conflict base); tests for save-as-copy with a replay, a catch-up
  during an in-flight commit, and `pageshow`. _Stays:_ the conflict-versus-error status
  wording (design pass).
- **Journal limits and cleanup**: a size limit per journal record (_builder's call_, e.g.
  256 KB; an oversized record is dropped as a quota failure is today); records for purged or
  long-unopened dashboards removed on app open; the dashboards list shows a name that exists
  only in a journal record.
- **`DocumentSession` reads page visibility directly**: moved onto `platform.activity`
  (section 1).

## Testing

Per `ARCHITECTURE.md` → "Testing strategy".

- **Unit**: the envelope schemas; size checks (including a small link that decompresses to
  over the limit); copy versus restore rules, including undeleting and the summary counts;
  fingerprint stability (the same document gives the same fingerprint regardless of key
  order) and change detection; purge rules; reminder timing rules with an injected clock
  (first visit, later day, nothing new, 14 days, turned off, protected storage);
  `migrateChange` chain behavior with the test-only migration; `replaceDocument` and its
  inverse; the robustness items in section 11.
- **Platform contract tests** for the new capabilities, run against both web and memory
  implementations.
- **Component (browser mode)**: the Share dialog (copy, fallback when clipboard fails, too
  big for a link), the "already have a copy" dialog, Recently deleted, the Clear my data
  dialog, the reminder bar, the reload bar, the storage popover.
- **E2E (three engines)**: share round trip (copy a link in one browser context, open it in
  a fresh one, a copy appears and the URL no longer has the fragment); reopening the same
  link gives the prompt, and both answers work; Export then Import makes a copy; backup then
  Clear my data then restore brings everything back with the same ids; Clear my data with
  two tabs open leaves both on the starter and nothing comes back; delete then restore from
  Recently deleted; a changed `version.json` (served by the test) shows the reload bar; a
  failed lazy chunk shows the same bar; a tampered link shows the error and saves nothing.
- **axe** on the new screens: the Share dialog, the import error page, the "already have a
  copy" dialog, Recently deleted, the Clear my data dialog, and a dashboard showing the
  reminder bar and the reload bar.

## `DEFERRED.md` and docs updates in the same change

- **Remove** the spec-1 items finished in section 11 (keeping the parts marked "stays"),
  and the recovery half of "Save-status and undo-toast timing".
- **Add**: the manual link-length check in Google Classroom and webmail (revisit before
  the private preview); the "sign in to keep this safe everywhere" backup-reminder line (revisit with
  spec 5 / server-backed documents); Collections and analyses in Share, Export, and backups
  (revisit with spec 4 and the Analysis step); anything else deferred while building.
- **`ARCHITECTURE.md` → "Saving & sharing documents"**: the copy-versus-restore rule, the
  "already have a copy" prompt, the backup reminder's rhythm, click-to-protect where the
  browser would prompt, the envelope, the link cap,
  and the local amendment to version-skew rule 2 (`migrateChange`).
- **`TODO.md`** "Start here" when the PR opens and merges.

## Done when

- A link shared from one browser opens as a copy in another, on all three engines, and
  reopening it prompts as described.
- Export, Import, backup, restore, Recently deleted, and Clear my data work as described,
  with E2E coverage on all three engines and no axe violations on the listed screens.
- A changed `version.json` and a failed chunk load both show the reload bar.
- Nothing from a link or file is saved unless it passes the size checks and the full load
  pipeline.
- The section 11 items are done and out of `DEFERRED.md`; new deferrals are in it.
- `npm run lint`, `check`, `test`, and `build` pass; the initial bundle stays within budget
  (share and import code lazy-loaded).

## Left to the builder

Anything marked _builder's call_; module layout (e.g. a `src/lib/sharing/` module);
capability and type names; the envelope's exact field names; the link prefix; the
fingerprint store; dialog and bar layout within the theme tokens; message wording (plain,
short); the backoff timing for save retries; test organization.

## Branching

This spec is committed on `foundations-3-safety`, which also carries the implementation,
with a PR into `foundations`. `foundations` merges into `main` only with the user's
explicit approval.
