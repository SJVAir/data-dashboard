# Server-backed documents (sync): design

Date: 2026-10-28. Release 1, parallel track. Branch `sync` (data-dashboard, from `main`);
sjvair.com work branches from and PRs into `develop`; sdk-js work goes on its own branch.

This document turns the decisions already in `ARCHITECTURE.md` ("Saving & sharing
documents", "Accounts & anonymous use", "Routing, URL state & undo") into one buildable
design, adds what this brainstorm decided, and splits the track into four specs. Where it
says **(my call)**, the choice was made while writing and wasn't discussed with the user;
check those first.

## Why

The people who need this first (from the user, 2026-10-28):

- **A teacher sharing a dashboard link with their class.** Students open it with no account
  and see the teacher's current version.
- **A school keeping a dashboard for parents.** One long-lived link that stays current as
  the school changes it.
- **A researcher sharing a dashboard with a peer.** The peer looks, then makes a copy to
  work on.
- **One person on two devices.** They add a widget on the desktop and later open the same
  dashboard on their phone. Or both are open at once while they look for a layout that works
  on both.

So the track's first job is **live share links**, and the same sync makes **moving between
devices** work. Protection from the browser clearing its storage comes with it.

## Hard rules (anti-goals)

From the user: what would make this a failure even if it technically works.

### Never lose a teacher's edits

- A change leaves the local unsynced queue **only after the server confirms** the save that
  contains it. Until then it survives reloads, crashes, and going offline (the queue is
  already persisted in IndexedDB, and the journal covers `pagehide`).
- **Sign-out never removes a dashboard with unsynced changes.** It says so and offers to
  finish syncing first. "Sign out anyway" hides that account's space instead of removing it
  (see "Account spaces").
- **An account change or an expired session hides the space, never deletes it.** Signing back
  in as the same person resumes it.
- **"Use the other version" and "Keep mine" both keep the version they replace** as a server
  snapshot (forced, even if a snapshot already exists for that day), so either choice can be
  undone through "Restore an earlier version".
- Daily server snapshots for 30 days, and a block list for bad builds.
- Every conflict path has automated tests, including **two browsers with one offline**.

### Never show a private dashboard

- Dashboards are **private by default**. A live link exists only after an explicit "Create
  link"; revoking takes effect on the next request.
- `/shared/:token` serves only a document whose visibility is `link` (or `public`), whose
  token matches, and that isn't deleted. **Private, deleted, revoked, and unknown tokens all
  get the same response** (the "no longer available" page).
- Reading, listing, and changing documents by id is **owner-only**. Someone else's id answers
  **exactly like a missing one** on reads. (A save to an id someone else owns has to say the id
  is taken so the client can make a copy; that reveals only that the id exists, never content,
  and ids already travel inside link and file shares as `copiedFrom`.)
- **Shared responses carry no personal information**: the optional public display name only,
  never the owner's id, name, email, or phone.
- Shared pages are `noindex` (already true for `/workspace/shared/*`) and every document
  response is `Cache-Control: no-store` **(my call: `no-store` rather than revalidation, so no
  cache anywhere holds a document)**.
- Error reports never include document bodies or names (the existing scrubber already strips
  them; add a test).
- Server tests check each of these directly.

## Goals

1. Signed-in work saves to sjvair.com and opens on any signed-in device.
2. Live share links: read-only, no account needed to open, "Make a copy".
3. Open pages pick up newer versions within about a minute.
4. Conflicts merge silently when they can; layout moves never prompt.
5. The account-space behavior held from spec 5b (`DEFERRED.md` → "Accounts") ships.
6. Recovery: synced Recently deleted, server snapshots, "Restore an earlier version", the
   bad-build block list, and account deletion covering everything.

## Non-goals

- **Real-time push** (WebSockets, server-sent events). sjvair.com runs WSGI under gunicorn;
  push would need an async server, Redis channels, and new Heroku limits. Polling is enough
  for these users. Deferred (added to `DEFERRED.md`).
- Real-time co-editing, CRDTs, multiple editors (already deferred).
- Public listing, search, curated templates (already deferred; `public` stays reserved and
  behaves like `link`).
- Server-synced preferences (already deferred; last-opened dashboard etc. stay per device).
- Token-mode (Tauri / standalone) sync. The adapter's `authMode` is always `"cookie"` in
  Release 1; already deferred under "Account UI in token-mode builds".
- Collections and analyses. The model has a `kind` field and the endpoints take it, but
  only `dashboard` is accepted in Release 1.
- The sign-up return trip (owned by the email-only accounts track).

## Constraints

- **Nothing reaches production until everything is ready** (from the user, 2026-10-28). No
  version of the dashboard is published yet, and during Release 1 sjvair.com's `develop` is
  treated as its main line, so the production gate is the user's own sjvair.com `develop` →
  `main` deploy. Specs 2–4 merge into data-dashboard `main` on the normal schedule (with
  approval) and need **no feature switch** to stay dark.
- **Cookie-authenticated writes need the CSRF fix.** sjvair.com #292 is on `develop`;
  resticus #25/#26 wait until #292 reaches `main`. Both are part of "everything ready" before
  that production deploy. Local development already runs the fix through the override (see
  the data-dashboard-status memory). Saves send `X-CSRFToken` (the SDK does this since 4.7.0).
- **sjvair.com needs an approved plan first**, branching from and PRing into `develop`.
- **sdk-js changes need an approved plan**; every release or prerelease needs the user's
  explicit yes, every time.
- Never merge to `main` (any repo), release, or publish without asking.
- **Step 2 is in progress on `layout`.** Spec 1 (server) can start now. Specs 2–4 touch the
  change code step 2 is changing (it adds `setLayout`), so they start from `main` after step 2
  merges, or stack on `layout` if step 2 runs long. Everything here treats changes
  generically through `ChangeSchema`, `changesOverlap`, `rebase`, and `applyForced`; the only
  op named specially is `setLayout` (below).
- Existing rules apply: metadata as source of truth, Paraglide strings, Pacific dates through
  `format`, the platform adapter for browser storage, WCAG 2.2 AA, schemas and size limits on
  every incoming document, the bundle budget (sync code that isn't needed at startup is
  lazy-loaded; the shared page's code is its own chunk).

## The split

One design (this document), then a plan and a PR per spec, like Foundations:

| Spec | What | Repos | Can start |
| --- | --- | --- | --- |
| 1 | Server model, endpoints, limits, admin, purge, account deletion; SDK wrappers | sjvair.com, sdk-js | now |
| 2 | Dashboard sync: account spaces, migration prompt, background saves, polling, replay, sign-out | data-dashboard | after step 2 |
| 3 | Live share links, `/shared/:token`, display name, "Based on…", report link | data-dashboard (+ small sjvair.com) | after spec 2 |
| 4 | Recovery: server snapshots in "Restore an earlier version", synced Recently deleted, "account gone" | data-dashboard | after spec 2 |

Specs 3 and 4 are independent of each other. All server endpoints, including the ones specs
3 and 4 use, land in spec 1 so the server plan is approved and reviewed once **(my call)**.

## How it works

### Versions: local and server

Locally nothing changes: each change bumps the local `version`, and the change log records
it (`LOG_LIMIT` = 500). The server has **its own version**, one per accepted save (a save
carries a batch of changes). Each local document records:

- `serverVersion`: the server version its synced state matches (absent = never uploaded);
- `syncedThrough`: the local version included in that server version.

The **unsynced changes** are the local log entries after `syncedThrough`. Field names are the
builder's; the two values are what matter. They live in the account space with the document,
so they survive like everything else.

### Saving to the server

- After each local commit (already debounced 500 ms), the sync worker sends the unsynced
  changes, **at most one save per document every 2 seconds** while editing **(my call)**, and
  immediately when the tab is hidden (a normal fetch; if it doesn't finish, the queue is still
  there next time).
- A save sends: `kind`, `schemaVersion`, `name`, `body`, `deletedAt`, `copiedFrom`,
  `baseVersion` (the `serverVersion`, or `null` to create), the `changes` it contains (each
  with its `schemaVersion`), the space's `accountId`, and the `buildId`.
- The server accepts it only if the stored version is still `baseVersion`, then stores the body
  and the changes as one new version.
- Offline or a server error: retry on the existing backoff timer and on the `online` event. A
  failing save never blocks local editing.
- The "Saved" indicator distinguishes saved on this device from saved to the account (wording
  in the design pass); its popover says when the account last confirmed a save.

### Picking up newer versions (polling)

- **An open dashboard** asks the server "anything newer than N?" **every 60 seconds while the
  tab is visible**, and at once when the tab becomes visible or the connection returns.
  Hidden tabs don't poll.
- **The dashboards list** (and the app on load and focus) asks for every document changed
  since a cursor, so a dashboard made on another device appears.
- One tab per browser does the polling for a document and passes results to the others over
  the existing tab channel **(my call; avoids N tabs × N requests)**.
- The poll answer for an unchanged document is tiny (`{ version }`). A changed one returns
  the changes since N and the new body.

Cost, for the record: 30 students with the link open ≈ 0.5 requests/second; 200 parents ≈
3/second; each is one indexed lookup. Live data refresh already costs more per request.

### Conflicts: replay, prompt only on true overlaps

When a save comes back "your base is stale", or a poll brings changes while this device has
unsynced ones, the client runs the existing `rebase(current, theirs, mine)`:

- `theirs` comes from the server's change log for the versions since `baseVersion`.
- No overlap: `mine` is replayed on the newer version (`applyForced`) and saved on top.
- Overlap: the existing three-choice prompt (Keep mine / Use the other version / Save mine as
  a copy), now also for conflicts with other devices. Saving pauses for that document until it
  is settled; other documents keep syncing.

**Layout moves never prompt** (decided with the user, 2026-10-28). Two `setLayout` changes
are never an overlap, between devices or between tabs. Mine is replayed over theirs (the last
save wins), widgets that now overlap are tidied by step 2's engine, and moves of widgets the
other side deleted are dropped (`applyForced` already does that). Reason: layout tuning is
quick trial and error and is easy to redo; a widget's settings take effort, so those still
prompt. **This changes step 2's rule** ("two `setLayout`s overlap if they share a widget id
with different `to`"). Spec 2 makes the change in `changesOverlap` on top of step 2; the step 2
session doesn't need to change course. `setLayout` against `removeWidget` also stops
prompting (the delete wins and the move is dropped) **(my call, following the same reasoning)**.

**If the server log doesn't reach back** to `baseVersion` (a device offline for a very long
time), there is no telling what overlapped, so the client **always prompts**, treating it as a
whole-document overlap. It never replays blindly over a server version **(my call; the local
cross-tab code replays without checks in this case, which is acceptable between tabs of one
browser but not across devices)**.

**Edits to a document deleted elsewhere** ("theirs" sets `deletedAt`, "mine" has other
changes): "This dashboard was deleted on another device. Restore it, or discard your
changes?" (already designed). Restore = `setField deletedAt → null` plus mine.

**A newer `schemaVersion` on the server** than this app knows: the document opens read-only
with "Reload to edit" (rule 1), and its unsynced changes stay queued until the reload.

**Format upgrades and the server (my call).** The local amendment from Foundations spec 3
applies to sync too, replacing `ARCHITECTURE.md`'s server-side rule 2 (which this track
updates): a newer build can't run old-format code, so pending changes are upgraded with
`migrateChange` when the document opens, and **"their" changes from the server log are
upgraded the same way before `rebase`** (a change that can't be carried over counts as an
overlap, so it prompts). An upgraded document is **not pushed until its first real edit**, so
merely opening a dashboard on a new build doesn't turn other devices still on the old build
read-only. That first save carries the new `schemaVersion`; the server takes a `schema`
snapshot of the stored version before accepting it. The upgrade itself isn't a change op: the
save's body is already upgraded, and its change list holds only the edits.

**Permanently deleted elsewhere (my call).** "Delete permanently" and the 30-day purge leave a
**purged-id record** on the server (document id and owner only). Saves, `changes`, and the
`since` list report a purged document with a distinct `gone` code. A device holding it with
no unsynced changes removes it quietly. With unsynced changes, it asks: "This dashboard was
permanently deleted from your account. Keep your version as a new dashboard, or discard it?"
Keep uploads it as a copy with a new id (never resurrecting the purged id). Purged-id records
are kept as long as the account exists.

**Unsynced changes are never trimmed (my call).** The local change log keeps its 500-entry
limit only for synced entries: the storage contract never trims an entry after the space's
`syncedThrough` for that document. So a save always carries a complete change list, and a gap
in the server log only happens through the server's own retention. Very large queues upload in
batches, oldest first.

### Account spaces (the items held from spec 5b)

Spaces are already in the storage layer (`currentSpace()` returns `"anonymous"` today).

- **Signing in switches to the account space** `account:<id>` (the server's user id). The
  app loads that space, then syncs with the server. All tabs switch together (5b's identity
  message).
- **Once per account per browser**, if the anonymous space has dashboards (not counting the
  starter), ask: "Add the 3 dashboards made on this browser to your account?" Yes moves them
  (same ids, Recently deleted included **(my call)**) into the account space and uploads
  them; No leaves them for signed-out use. The answer is remembered per account in this
  browser's preferences.
- **ID collisions become copies:** an upload refused as "id taken" gets a new id and
  `copiedFrom` = the old id, then uploads again. Nothing is overwritten.
- **Signing out** (the account menu): if every document in the space is synced, the space is
  removed from the browser and the app returns to the anonymous space. If not, a dialog says
  how many dashboards have unsynced changes and offers **"Finish saving, then sign out"** and
  **"Sign out anyway"**, which hides the space (kept 30 days) instead of removing it (decided
  with the user, 2026-10-28). The next person on that browser can't see it; signing back in
  as the same person finishes the sync. This amends `ARCHITECTURE.md`'s "sign-out removes the
  account's local copies" for the unsynced case only; a fully synced space is still removed.
- **Session expired, or a different account signed in** (the 5b re-check, plus a save refused
  for an account mismatch): hide the current space (kept, with its queue), switch to the space
  for whoever is now signed in (or anonymous), and say so. Signing back in as the same person
  resumes and finishes syncing. Hidden spaces nobody returns to are removed after 30 days.
- **Every save names its account**; the server refuses a mismatch with no write and returns
  who is signed in. **Before each sync batch** the client re-checks identity if the last check
  is older than 30 seconds **(my call: reuse 5b's throttle)**.
- **Opening `/dashboards/:id` that isn't local** while signed in: fetch it from the server. Not
  found: the existing "saved on another device" message.
- **The starter** is never uploaded unedited; the existing hand-off makes the user's copy,
  which then syncs.
- **The backup reminder** gets its "Sign in to keep this safe everywhere" line for anonymous
  users (`DEFERRED.md` → "Documents & saving"). In an account space the reminder doesn't show
  (the server copy is the protection) **(my call)**.

### Live share links

- **The Share dialog**, signed in: "Anyone with the link can view" with **Create link**, then
  Copy and **Stop sharing**. Below it, "Send a copy instead" keeps today's fragment link and
  file. Signed out: today's dialog plus a line that signing in gives a live link.
- Create link sets visibility `link` and makes a token (`secrets.token_urlsafe(16)` or longer).
  Stop sharing clears the token and sets visibility `private`; creating a link again makes a
  **new** token, so an old link never comes back **(my call)**. Deleting the dashboard makes
  the link show "no longer available"; restoring it brings the same link back.
- Sharing needs the document on the server: Create link first finishes any pending save. A
  dashboard with unsynced changes shares its last synced version, and the dialog says so.
- **`/workspace/shared/:token`** (route already reserved) renders the dashboard read-only with
  the existing read-only mode, polls every 60 seconds while visible, and offers **Make a copy**
  (into the current space with `copiedFrom`; signed in, it then syncs). The "You already have a
  copy" check applies as for link imports.
- **The "made by a user" bar** on shared pages: the owner's public display name if set, "This
  is not an official SJVAir page", and **Report this page**, which opens sjvair.com's contact
  form pre-filled with a topic and the page's URL (the small sjvair.com change deferred in spec
  5a, done here).
- **Public display name:** optional, set from the Share dialog, stored per account on the
  server, shown on shared pages and in "Based on …" credits. Empty means nothing is shown.
- **"Based on …":** a copy shows its source's name and display name only if the source still
  exists and the viewer could open it (owner, or link-visible). Otherwise nothing.
- Staff can disable a share link or block an account from sharing in the Django admin.

### Recovery

- **Recently deleted syncs:** `deletedAt` is already a change; the server mirrors it into a
  `deleted_at` column. Restore within 30 days on any device. The server purges documents 30
  days after `deleted_at`, plus their snapshots and change log (a huey periodic task, the
  server's existing task system). "Delete permanently" in Recently deleted purges at once on
  the server (owner only).
- **Server snapshots:** the version before each `schemaVersion` change, the version as it stood
  before the first save of each day it changed **(my call for "one per day")**, and the forced
  ones from conflict choices. Kept 30 days.
- **"Restore an earlier version"** lists local kept originals and server snapshots by date.
  Restoring applies a `replaceDocument` change, so it is undoable and syncs like any edit.
- **Bad builds:** saves carry `buildId`; a build on the server's block list (admin-managed) gets
  a "please reload" refusal; documents stay queued locally until the fixed build loads.
- **Account deletion** (sjvair.com's account page): deletes documents, trash, snapshots, change
  logs, share links, and the display name, and lists counts with "Download my documents" (one
  backup file in the existing envelope) first. **Other devices learn the account is gone**: the
  server keeps the deleted account ids (ids only, no personal data), and a client with a hidden
  or current account space asks whether those ids are gone and removes their spaces if so
  **(my call for the mechanism)**.

## The server (spec 1, sjvair.com)

A new app (e.g. `camp.apps.documents`; name is the builder's). Endpoints under `/api/2.0/`
on django-resticus, like the rest of the API. Session-cookie auth for the dashboard; token
auth works too but isn't used in Release 1.

### Model (proposed; the sjvair.com plan finalizes)

- `SavedDocument`: `id` (the client's id, string up to 64 of letters, digits, `-`, `_`),
  `owner`, `kind`, `name`, `body` (JSON, stored uninterpreted), `schema_version`, `version`,
  `visibility` (`private` | `link` | `public`), `share_token` (unique, nullable),
  `copied_from` (id string, no foreign key), `deleted_at`, `created_at`, `updated_at`,
  `sharing_disabled` (staff).
- `DocumentChange`: document, server version, the batch of changes (JSON, uninterpreted), each
  with its `schemaVersion`. Kept for the **last 500 versions** of each document **(my call,
  matching the local log)**.
- `DocumentSnapshot`: document, version, `schema_version`, name, body, reason (`schema`,
  `daily`, `conflict`), created.
- Per account: public display name, a "blocked from sharing" flag (a small profile model or
  fields on `User`; the builder's choice).
- `BlockedBuild`: build id, note.
- `PurgedDocument`: document id, owner, purged at (see "Permanently deleted elsewhere").
- `DeletedAccount`: account id, deleted at.

### Endpoints (proposed shapes)

| Method & path | Who | Does |
| --- | --- | --- |
| `GET documents/?since=<cursor>` | owner | documents changed since the cursor (bodies included, paginated), plus a new cursor |
| `GET documents/<id>/` | owner | one document with `version` |
| `GET documents/<id>/changes/?since=N` | owner | `{ version }` if unchanged; else the changes since N (or `null` if the log doesn't reach) and the current document |
| `PUT documents/<id>/` | owner | create (`baseVersion: null`) or save; see refusals below |
| `DELETE documents/<id>/` | owner | permanent delete (from Recently deleted) |
| `POST` / `DELETE documents/<id>/share/` | owner | create or revoke the link |
| `GET documents/<id>/snapshots/` and `…/snapshots/<n>/` | owner | list; one snapshot's body |
| `GET documents/<id>/credit/` | owner or link-visible | name and display name for "Based on …" |
| `GET documents/shared/<token>/` | anyone | the shared document (name, `schemaVersion`, body, version, `updatedAt`, display name), or not found |
| `GET documents/shared/<token>/changes/?since=N` | anyone | `{ version }` or the new document |
| `GET` / `PUT documents/profile/` | signed in | the public display name |
| `POST documents/accounts-gone/` | anyone | which of the given account ids were deleted |

Refusals on save, each with a distinct machine-readable code: stale base (409, with the
current version, the changes since the base or `null`, and the document), account mismatch
(403, with who is signed in), id taken (409), `schemaVersion` downgrade (409), blocked build
(409, "reload"), body too large (413), over the document-count or storage limit (403), rate
limited (429). Status codes are the builder's; the codes and payloads are the contract.

### Limits (my calls; adjustable in settings)

- `body`: 1 MB of JSON. A save's `changes`: 2 MB.
- 500 documents per account, Recently deleted included.
- 100 MB per account, counting bodies and snapshots.
- 120 saves per minute per account.

### Admin

`SavedDocument` list with owner, kind, visibility, and sizes; actions: disable a share link,
block an account from sharing. **Staff don't browse bodies in the list view**; opening one is
an explicit action (privacy) **(my call)**. `BlockedBuild` editable.

### Tests

Owner-only access (someone else's id answers like a missing one), shared responses for each of
private / revoked / deleted / unknown / disabled being identical, no personal fields in shared
responses, `no-store` on every document response, the version check, downgrade refusal, the
account check, limits, purge, snapshots, account deletion removing everything, and CSRF
required for session writes (with the resticus fix).

## sdk-js

Typed wrappers for the endpoints above, with the refusal codes as typed errors. The version
line (folded into the unreleased 4.8.0 line or a new minor) is decided in the sdk-js plan.
The dashboard pins a prerelease as it does today; each prerelease and release needs the user's
yes. Per the "fix in the SDK" rule, the dashboard doesn't hand-roll these calls.

## The dashboard (specs 2–4)

- A **`RemoteDocuments` interface** (save, fetch, changes-since, list-since, share, snapshots)
  with an SDK-backed implementation and an in-memory fake that behaves like the server
  (version check, log limit, refusals). A shared contract test runs against the fake, and a
  local-only suite runs it against the podman stack (like `test:embedding`).
- A **sync worker** per space beside `DocumentSession`, not inside it (`DocumentSession` is
  already ~870 lines; `DEFERRED.md` flags it). It owns uploading, polling, and the "theirs"
  feed into the session's existing catch-up and conflict path.
- Paraglide strings for every new message; no generated English stored in documents.
- Tests: unit tests for the sync worker against the fake (every refusal, offline, log gap,
  layout-only overlaps, delete-vs-edit, account mismatch); browser tests for the dialogs; a
  Playwright test with **two browser contexts and one offline** against a mocked server; the
  hand-check recipes in the status memory for the real stack.

## Left to the builder

- Field and table names, status codes, the sync worker's internal structure, how the poll
  leader tab is chosen.
- How the dashboards list shows "on this device only" versus "in your account" during the
  first upload.
- Exact wording (the design pass revisits it), within the rules above.
- Whether the shared page polls via `changes` or re-fetches.

## `ARCHITECTURE.md` updates (made with spec 2)

- "Routing, URL state & undo" → changes: two `setLayout`s never overlap; `setLayout` against
  `removeWidget` doesn't prompt.
- "Saving & sharing documents" → version skew rule 2: the local amendment now covers the
  server too ("Format upgrades and the server").
- "Accounts & anonymous use" → local spaces: "Sign out anyway" hides an unsynced space; the
  _held for sync_ markers come off as each item ships.
- Polling (60 seconds while visible) and the permanently-deleted prompt are recorded under
  "Saving & sharing documents".

## Existing deferrals this track picks up

Each leaves `DEFERRED.md` (moving to TODO → Done) when its spec ships:

- "Account-space behavior held for sync" (all items): spec 2, except saves bound to an
  account, whose server half is spec 1.
- "Sign in to keep this safe everywhere" in the backup reminder: spec 2.
- "Pre-filling sjvair.com's contact form" (for "Report this page"): spec 3, server part in
  spec 1.

Entries marked "revisit with server sync" that this track **leaves deferred**, because sync
doesn't change them: "A starter replay can take a live tab's journal record" (an account
space dedupes nothing extra; a duplicate copy would sync as two dashboards, still
recoverable) and "`rememberCopy` failing after a restore's commit". Spec 2 adds a note to each
saying it was looked at.

## Deferrals made here

Recorded in `DEFERRED.md` in the same change:

- Real-time push (WebSockets / server-sent events).
- Server change-log retention beyond 500 versions (a long-offline device prompts instead).
- Choosing which widgets' layout to keep when layout moves collide (the last save wins).
