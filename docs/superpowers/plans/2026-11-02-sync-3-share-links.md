# Sync spec 3: Live share links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can turn on a live, read-only link to a dashboard. Anyone, with no
account, opens it at `/workspace/shared/:token`, sees the owner's current version (picked up
within about a minute), and can make their own copy. The page is labeled as made by a user, with
"Report this page". Copies show "Based on …".

**Architecture:** Sharing is not an edit, so it never goes through `applyChange` or the change
log. The server holds a document's share token; the dashboard keeps a copy of it in the
document's **sync record** (`shareToken`), which every record write from a server document
refreshes and the list poll updates when only the token changed (share and revoke bump
`updated_at`, not `version`). The worker gains `share` / `unshare` / profile calls, run under the
document's lock. The shared page and the "Based on …" lookup don't need the sync worker (they
work signed out), so they load `createSdkRemote` on their own through a small lazy module. The
shared page renders the document through `DashboardGrid` in a new **view mode** (a document
passed in, no session, nothing editable).

**Tech Stack:** Svelte 5 runes, TypeScript, `@sjvair/sdk` 4.8.0-beta.3 (`@sjvair/sdk/documents`:
`createShareLink`, `revokeShareLink`, `getSharedDocument`, `getSharedDocumentChanges`,
`getDocumentCredit`, `getDocumentProfile`, `updateDocumentProfile`), Vitest (unit + browser
mode), Playwright, Paraglide, zod via `$lib/zod`.

**Spec:** `docs/superpowers/specs/2026-10-28-server-backed-documents-design.md` (approved
2026-10-28): "Live share links", "Hard rules" → "Never show a private dashboard", "The split",
and "The dashboard (specs 2–4)". Read those, then `ARCHITECTURE.md` → "How the dashboard syncs"
(what spec 2 built) and → "Security baseline" item 6 (user-made pages), before any task.

## Shared with spec 4

Spec 4 (recovery) is planned at the same time and **built on top of this branch**. Both extend
the same server layer and E2E mock. Spec 3's additions, all in **Task 1** (and Task 2 for the
record):

- `src/lib/sync/remote.ts`: `RemoteMeta` / `RemoteDocument` gain `shareToken`; new types
  `SharedRemoteDocument`, `SharedChanges`, `Credit`, `Profile`; `RemoteDocuments` gains `share`,
  `unshare`, `shared`, `sharedChanges`, `credit`, `getProfile`, `setProfile`.
- `remote-sdk.ts`, `remote-fake.ts` (share tokens, visibility, display names, staff switches
  `disableSharing` / `blockSharing`, signed-out reads), `remote-contract.ts` (a "sharing" group),
  `remote-stack.test.ts` (a second, signed-out remote).
- `e2e/documents-server.ts`: the endpoint matcher is rewritten to a small route table (so spec 4
  adds rows rather than another regex), with rows for `share/`, `shared/<token>/`,
  `shared/<token>/changes/`, `<id>/credit/`, and `profile/`; `wireMeta` sends the real
  `visibility` / `share_token`.
- `src/lib/sync/types.ts` (Task 2): `SyncRecord` gains `shareToken: string | null`, and
  `emptyRecord` sets it to `null`. Spec 4 code that builds a record literal must set it too.

Spec 4 rebases onto this branch before building and adds its snapshots and delete calls in the
same places.

## Global Constraints

- **Branch:** `sync-share-links`, from `main` after this plan is approved (the plan itself is on
  `sync-3-plan`). PR into `main`; never merge, release, or publish without the user's explicit
  yes, each time.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies.
- Code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only; all UI text
  through Paraglide (`messages/en.json`), never concatenated; dates through `$lib/format`
  (Pacific); styling from theme tokens; `z` from `$lib/zod`; browser APIs only inside
  `src/lib/platform/` (clipboard, activity, online, identity are already there). `npm run format`
  before each commit.
- **Never show a private dashboard (spec, hard rule):** the client treats every `not_found` from
  `shared` / `sharedChanges` the same: the one "no longer available" page. It never shows why.
  Shared pages show **only** the optional display name, never anything else about the owner.
  Nothing from a shared document (name, body) ever goes into an error report.
- **Every incoming document is validated:** a shared document runs through `loadDashboard`, and
  one whose JSON is over `MAX_DOCUMENT_CHARS` is refused, before anything renders.
- **Timing (from the spec):** the shared page polls **every 60 seconds while visible**, at once
  when it becomes visible or comes back online, never while hidden.
- **Tokens and links:** a share URL is `${location.origin}${BASE}/shared/${token}` (`BASE` from
  `src/lib/routing.ts`). Creating a link again after Stop sharing gives a **new** token (the
  server does this; never cache an old token past a revoke).
- **User-made pages are labeled** (`ARCHITECTURE.md` → "Security baseline" item 6): the "made by
  a user" bar is always shown on a shared page and the owner can't remove it. (Links inside user
  text get `rel="ugc nofollow noopener"`, but no widget renders user text yet; the rule binds
  when Notes ships.)
- **Bundle:** the shared page is its own lazy chunk (`() => import(...)` in the router); the
  sharing remote loads with a dynamic `import()`. `npm run check:budget` stays under 200 KB.
- Accessibility WCAG 2.2 AA: every new dialog and page gets an axe check; status changes
  ("Link copied", "Link turned off") go through a `role="status"` region.
- **Shapes are free before Release 1:** change `SyncRecord`, `DocSyncState`, and the fake in
  place; no version bumps.
- Every deferral goes into `DEFERRED.md` in the same change, with why and a revisit trigger.

## The sjvair.com piece (separate, already done)

The spec puts a small sjvair.com change in spec 3: pre-filling the contact form for "Report
this page". **It is already on sjvair.com `develop`** (#297, recorded in `DEFERRED.md` →
"Pre-filling sjvair.com's contact form"): `/contact/?topic=Report&page=<URL>` pre-fills the
topic "Report a shared dashboard", a subject, and `Page: <URL>` in the message, but only when
`page` is a path under `/workspace/shared/` (or a URL on the same host), at most 500 characters.
Everything else the spec needs from the server (share, revoke, shared reads, credit, profile,
the staff switches, `noindex` on `/workspace/shared/*`) also shipped in spec 1. **So this spec
needs no sjvair.com work and no sjvair.com plan.** Task 8 checks it on the stack. If that check
finds a gap, it becomes its own sjvair.com plan (approved first, branch from and PR into
`develop`), not part of this branch.

## Calls made in this plan

The spec leaves these to the builder. Check them first.

1. **The share token lives in the sync record** (`shareToken`), not in the document: sharing
   isn't an edit (no undo, no change log, no version bump). Every tab sees it through the
   existing `sync` message.
2. **The shared page polls `sharedChanges`** (the spec leaves "changes or re-fetch" open): one
   tiny `{ version }` answer when nothing changed.
3. **Each open shared page polls on its own**, with no cross-tab leader: its viewers are mostly
   signed out, on one tab each, and the spec's cost estimate already assumes one request per
   viewer per minute.
4. **"You already have a copy" matches by source id** (`copiedFrom === shared.id`), not the
   content fingerprint the fragment import uses: a live link's content changes, so a copy made
   last week would never match. The existing `ExistingCopyDialog` asks.
5. **Stop sharing asks first** (`confirmAction`): a mis-click breaks a link a whole class uses,
   and it can't be undone (the next link is different).
6. **"Report this page" sends the path, not the full URL** (`page=/workspace/shared/<token>`):
   the server accepts a path from any origin, so it works from the dev server too. It opens
   sjvair.com's contact page (`https://www.sjvair.com/contact/`, the same address the Help menu
   uses, moved to one `src/lib/links.ts`) in a new tab.
7. **"Based on …" for a duplicate of a dashboard stored here** uses the local name and makes no
   request; otherwise it asks the server's `credit` once per page load per id, and shows nothing
   when offline or refused. The starter's id is never looked up.
8. **The display name has no client-side length limit**: the server's limit (60) is the source
   of truth; a refused name shows "That name can't be used" with the server's field rule
   unread. (The fake mirrors 60, as it mirrors the other server limits.)
9. **A dashboard with unsynced changes still shares** (its last synced version) after one
   upload attempt; the dialog says so. One that has never reached the server can't share yet,
   and the dialog says why (offline, or the "Only on this device" reason).

## Review Focus

1. **The link is revoked, the dashboard deleted, or sharing disabled while a viewer has it
   open.** Expected: the next poll swaps the dashboard for the same "no longer available" page,
   in every case. Pinned in Task 5 (`"a link stopped while open shows no longer available"`).
2. **The server sends a shared document that is invalid, too large, or in a newer format.**
   Expected: nothing unvalidated renders; invalid / too large show the "can't be shown" page;
   newer shows the reload notice. Pinned in Task 5 (`"an invalid or oversized shared document
   never renders"`, `"a newer-format shared document asks for a reload"`).
3. **Sharing a dashboard that isn't fully on the server** (unsynced edits, never uploaded, held
   "Only on this device", offline). Expected: unsynced edits → link made, and the dialog says it
   shows the last synced version; never uploaded and the upload fails → no link, the reason
   shown. Pinned in Task 2 (`"share uploads first, then shares the synced version"`, `"a
   dashboard never uploaded can't share"`) and Task 3.
4. **Share state on two devices, and record writes racing a share.** Expected: device B learns
   A's link (or its revoke) within one poll; an upload or pull that rewrites the record never
   drops the token. Pinned in Task 2 (`"a share made elsewhere reaches this device's record"`,
   `"record writes keep the share token"`).
5. **Make a copy twice, or after the source changed.** Expected: the second time asks "You
   already have a copy" (open it, or make another); signed in, the copy uploads. Pinned in Task 5
   (`"a second copy asks, even after the source changed"`) and Task 7.

---

## File map

- `src/lib/sync/`: `remote.ts`, `remote-sdk.ts`, `remote-fake.ts`, `remote-contract.ts`,
  `remote-fake.test.ts`, `remote-stack.test.ts` (Task 1); `types.ts`, `local.ts`, `pull.ts`,
  `upload.ts`, `resolve.ts`, `move.ts`, new `share.ts` (+ test), `worker.svelte.ts` (Task 2).
- `src/lib/shared/` (new, lazy): `remote.ts` (the signed-out-capable remote), `poll.svelte.ts`,
  `credit.svelte.ts`, `report.ts`.
- `src/lib/links.ts` (new): `CONTACT_URL`.
- `src/lib/sharing/copy.ts`: `findCopyOf`.
- Components: `ShareDialog.svelte`, `PrivacyDialog.svelte`, `DashboardGrid.svelte`,
  `WidgetFrame.svelte`, `Taskbar.svelte`, `DashboardHeader.svelte`, `HelpMenu.svelte`; new
  `src/lib/components/shared/MadeByBar.svelte`; new route `src/routes/SharedPage.svelte`;
  `src/router.ts`; `src/lib/sharing/actions.ts`; `messages/en.json`.
- E2E: `e2e/documents-server.ts`, `e2e/share-links.spec.ts` (new), `e2e/fixtures.ts`.
- Docs: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`.

---

### Task 1: The server layer: sharing calls, fake, contract, E2E mock

**Files:** Modify `src/lib/sync/remote.ts`, `remote-sdk.ts`, `remote-fake.ts`,
`remote-contract.ts`, `remote-fake.test.ts`, `remote-stack.test.ts`, `e2e/documents-server.ts`.

**Interfaces:**
- Produces (`remote.ts`):
  ```ts
  // RemoteDocument (and so RemoteMeta) gains:
  shareToken: string | null; // the token while visibility is link/public, else null
  export type SharedRemoteDocument = {
  	id: string; kind: string; name: string | null; schemaVersion: number; version: number;
  	body: unknown; updatedAt: string; displayName: string | null;
  };
  export type SharedChanges = { version: number } | { version: number; document: SharedRemoteDocument };
  export type Credit = { name: string | null; displayName: string | null };
  export type Profile = { displayName: string | null };
  // RemoteDocuments gains:
  share(id: string): Promise<string>; // the token; the same one while shared
  unshare(id: string): Promise<void>;
  shared(token: string): Promise<SharedRemoteDocument>; // no sign-in needed
  sharedChanges(token: string, since: number): Promise<SharedChanges>; // no sign-in needed
  credit(id: string): Promise<Credit>; // no sign-in needed
  getProfile(): Promise<Profile>;
  setProfile(displayName: string | null): Promise<Profile>;
  ```
  `remote-sdk.ts` maps `share_token` (null unless `visibility` is `link` or `public`) and wraps
  the seven SDK calls with the existing `call(operation, …)` (operations `documents.share`,
  `documents.unshare`, `documents.shared`, `documents.sharedChanges`, `documents.credit`,
  `documents.getProfile`, `documents.setProfile`), so a malformed shared response reports only
  the operation.
- Fake (`FakeRemote` gains): `disableSharing(id: string): void` (staff: the link stops opening),
  `blockSharing(accountId: string): void` (staff: an account can't share). The fake behaves like
  `camp/api/v2/documents/endpoints.py` (read it): `share` refuses `not_found` for a missing,
  trashed, or other account's document and `sharing_blocked` (403) when disabled or blocked;
  sharing again keeps the token; share and unshare move `updatedAt` but not `version`; `unshare`
  drops the token; `shared` / `sharedChanges` answer `not_found` (404) unless visibility is
  link/public, the token matches, the document isn't trashed, and sharing isn't blocked;
  `sharedChanges` checks the link before `since` (a bad `since` on a dead link is still
  `not_found`); `credit` opens to the owner or while shareable; `shared`, `sharedChanges`, and
  `credit` work with `signedInAs: null`; profile calls need sign-in; `setProfile` trims, `""` or
  `null` clears, over 60 characters is `invalid`. `requests` records `"share <id>"`, `"unshare
  <id>"`, `"shared <token>"`, `"sharedChanges <token> <since>"`, `"credit <id>"`, `"getProfile"`,
  `"setProfile"`. Remove "share links" from the fake's "Not modelled" note.
- E2E mock: replace `endpoint()`'s regex with a route table `[method, pattern, handler]` over the
  path after `/api/2.0/documents/`, with fixed paths (`profile/`, `shared/<token>/changes/`,
  `shared/<token>/`) before `<id>/…`, as the server's `urls.py` orders them. CSRF stays required
  for every non-GET. `wireMeta` sends `visibility: shareToken ? "link" : "private"` and
  `share_token`.

- [ ] **Step 1: Write the failing contract cases** in a new `"sharing"` group of
  `runRemoteContract` (the stack runs every case not marked fake-only; a case needing a
  signed-out caller gets it from a new `makeSignedOut()` argument):
  - `"create link, then anyone opens it"`: `share(id)` → token; signed-out `shared(token)` has the
    body, `displayName: null`, and exactly the keys of `SharedRemoteDocument` (no owner fields).
  - `"sharing again keeps the token"`; `"list since shows a share without a version change"`
    (`list(cursor)` returns the document, same `version`, new `shareToken`).
  - `"stop sharing: the link stops, and a new link is different"`.
  - `"private, revoked, trashed, and unknown tokens answer the same not_found"` (same `code` and
    `status` for each); `"restoring a trashed dashboard brings the same link back"`.
  - `"shared changes: just the version, then the new document after a save"`; `"a bad since on a
    dead link is still not_found"`.
  - `"credit: the owner, anyone while shared, nobody once private"`.
  - `"the display name is trimmed, shown on the shared document, and cleared by empty"`.
  - Fake-only: `"a disabled link answers not_found"`, `"a blocked account can't share and its links
    stop"` (`sharing_blocked` on `share`), `"a display name over 60 characters is invalid"`,
    `"profile calls need sign-in"` (`unauthorized`).
  - In `remote-fake.test.ts`: `"a malformed shared response reports no name or body"` (stub the
    SDK call; assert on the memory platform's reporter, as spec 2's test does).
- [ ] **Step 2:** `npx vitest run --project unit src/lib/sync/remote-fake.test.ts` → FAIL.
- [ ] **Step 3: Implement** the types, the SDK wrappers, and the fake.
- [ ] **Step 4:** Fake run → PASS. Run `npm run test:sync-stack` once against the podman stack
  (sjvair.com `develop`, `WORKSPACE_E2E_*` set) and note the result in the PR. Rewrite the E2E
  mock's matcher and add the rows; `npm run test:e2e -- e2e/sync.spec.ts` → PASS (the route table
  must not change spec 2's behaviour).
- [ ] **Step 5: Commit** — `git commit -m "Add share links, shared reads, credit, and profile to RemoteDocuments"`.

### Task 2: Share state in the sync record; the worker's share calls

**Files:** Modify `src/lib/sync/types.ts`, `local.ts`, `pull.ts`, `upload.ts`, `resolve.ts`,
`move.ts`, `worker.svelte.ts` (+ `worker.test.ts`, `pull.test.ts`). Create
`src/lib/sync/share.ts`, `share.test.ts`.

**Interfaces:**
- Consumes: Task 1's `share`, `unshare`, `getProfile`, `setProfile`; spec 2's `docLock`,
  `uploadDocument`, `readLocal`, `postSync`.
- Produces:
  ```ts
  // types.ts — SyncRecord gains:
  shareToken: string | null;
  // worker.svelte.ts — DocSyncState gains:
  shareToken: string | null;
  // share.ts
  export type ShareResult =
  	| { kind: "shared"; token: string; unsynced: boolean } // unsynced: the link shows the last synced version
  	| { kind: "not-on-server"; hold: SyncHold | null } // never uploaded (or trashed on the server)
  	| { kind: "blocked" } // sharing_blocked
  	| { kind: "offline" };
  /** Uploads what's pending, then turns the link on. Under the doc lock for the record write. */
  export function shareDocument(ctx: SyncContext, docId: string): Promise<ShareResult>;
  /** Turns the link off; throws `RemoteUnavailable` / `RemoteRefusal` on failure. */
  export function unshareDocument(ctx: SyncContext, docId: string): Promise<void>;
  // SyncWorker gains:
  share(docId: string): Promise<ShareResult>;
  unshare(docId: string): Promise<void>;
  displayName(): Promise<string | null>;
  setDisplayName(name: string | null): Promise<string | null>; // throws RemoteRefusal("invalid")
  ```
  Rules: every record built from a server document (`storeFromServer`, `pullInto`'s writes,
  `resolve`'s writes) takes `shareToken` from it; every other write spreads the existing record
  (so keeps it); a copy made by `moveToNewId`, `save-copy`, or `keep-as-new` starts with
  `shareToken: null` (a copy is never shared). `pollList`: for a listed meta whose `shareToken`
  differs from the record's, write the record with the new token under the doc lock and
  `postSync`, even when the version didn't move. `shareDocument`: `uploadDocument` once (any
  result), then under the doc lock read the record; `serverVersion === null` → `not-on-server`
  with the record's hold; else `remote.share`, write `shareToken`, `postSync`; `unsynced` = the
  local state still has unsynced entries. Refusals: `not_found` → `not-on-server`;
  `sharing_blocked` → `blocked`; `RemoteUnavailable` → `offline`; anything else rethrows.

- [ ] **Step 1: Write the failing tests** (memory platform + fake, `setupSync()`):
  - `share.test.ts`: `"share uploads first, then shares the synced version"` (an edit pending →
    the fake gets the save before `share`; `unsynced: false`); `"with an edit that can't upload,
    it shares the last synced version"` (fake `offline` only for the save via `refuseNext`
    `rate_limited` → `unsynced: true`); `"a dashboard never uploaded can't share"` (held
    `refused/limit_documents` → `not-on-server` with that hold, no `share` request); `"a blocked
    account gets blocked"`; `"offline gets offline"`; `"stop sharing clears the token"`.
  - `pull.test.ts`: `"a share made elsewhere reaches this device's record"` (another account
    session shares on the fake; `pollList` → record `shareToken` set, a `sync` message posted);
    `"a revoke elsewhere clears it"`; `"record writes keep the share token"` (shared, then an
    upload and a pull → still set); `"a copy made on id_taken is never shared"`.
  - `worker.test.ts`: `"states carry the share token"`.
- [ ] **Step 2:** `npx vitest run --project unit src/lib/sync` → FAIL.
- [ ] **Step 3: Implement.** Adding the required field makes `npm run check` list every record
  literal to fix.
- [ ] **Step 4:** `npm run test:unit && npm run check` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Keep each dashboard's share link in its sync record"`.

### Task 3: The Share dialog: live link, Stop sharing, display name

**Files:** Modify `src/lib/components/dialogs/ShareDialog.svelte` (+
`share-dialog.browser.test.ts`), `src/lib/sharing/actions.ts` (`shareDashboard`),
`PrivacyDialog.svelte` (+ test), `messages/en.json`.

**Interfaces:**
- Consumes: `app.sync` (`share`, `unshare`, `displayName`, `setDisplayName`, `states`),
  `confirmAction` (`ConfirmDialog.svelte`), `platform().identity.signInUrl`.
- Produces: `ShareOptions` gains `live: { docId: string } | null` (`null` signed out, the
  starter, or a read-only document that was never on the server). `shareDashboard` flushes the
  session first (already does) and passes it.

Layout, signed in (`live` set):
1. **"Anyone with the link can view"** section. No token in `app.sync.states[docId]`: a short
   description ("Students and others can open it without an account. They see your changes as
   you make them.") and **Create link**. With a token: the link in a read-only input (selected
   on open, as today), **Copy link**, and **Stop sharing**. After `shareDocument` with
   `unsynced: true`: "The link shows this dashboard as last saved to your account. Your newest
   changes will appear once they're saved." `not-on-server`: "This dashboard isn't saved to your
   account yet, so it can't have a link." plus the hold's reason (reuse spec 2's
   `sync-messages.ts` text for `refused` codes). `blocked`: "Sharing is turned off for this
   dashboard." `offline`: "Couldn't reach SJVAir. Check your connection and try again."
2. **Public name**: an input labelled "Your name on shared dashboards (optional)", loaded with
   `displayName()` when the dialog opens, saved with a **Save name** button; help text "Shown on
   your shared dashboards and on copies made from them. Leave it empty to show no name."; a
   refusal shows "That name can't be used. Try a shorter one."
3. **"Send a copy instead"** heading, then today's content unchanged (fragment link, Copy, and
   Download file).

Signed out (`live` null): today's dialog, plus a line with a link: "Sign in to share a live link
that stays up to date." (`signInUrl` of the current path).

Stop sharing: `confirmAction({ title: "Stop sharing this dashboard?", description: "The link
stops working for everyone who has it. If you share again, you'll get a new link.", confirm:
"Stop sharing" })`, then `unshare`; the status region says "Link turned off". Buttons are
disabled while a request runs.

Privacy dialog: the `privacy_server` text is updated for live links ("…A live link (when you're
signed in) shows the dashboard to anyone with the link until you stop sharing. A copy link has
the dashboard inside the link itself…"). Exact wording in the design pass; the legal checklist
item in `DEFERRED.md` already covers the policy.

- [ ] **Step 1: Write the failing browser tests:** `"signed out shows the copy link and a sign-in
  line"`; `"create link shows and selects the live link"`; `"copy puts the live link on the
  clipboard"`; `"stop sharing asks, then turns the link off"`; `"cancelling stop sharing keeps the
  link"`; `"unsynced changes: the dialog says the link shows the last saved version"`; `"never
  uploaded: says why it can't share"`; `"blocked and offline say so"`; `"the display name saves,
  and a refused one says so"`; `"send a copy instead still offers the link and the file"`; axe in
  the signed-in, shared state.
- [ ] **Step 2:** `npm run test:browser -- share-dialog` → FAIL.
- [ ] **Step 3: Implement**; add the messages.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Share dialog: create and stop a live link, set a public name"`.

### Task 4: View mode for the dashboard grid

**Files:** Modify `src/lib/components/dashboard/DashboardGrid.svelte`, `WidgetFrame.svelte`,
`Taskbar.svelte`, `src/lib/layout/fullscreen.ts` (if `checkDeepLink` needs the document rather
than the session); tests in `src/lib/components/dashboard/` (a new `view-mode.browser.test.ts`).

**Interfaces:**
- Produces: `DashboardGrid` gains the prop `view?: Dashboard`. When set, the grid shows that
  document and ignores `app.current`: no arrangement (no drag, no keyboard pick-up, no resize
  handles), no context menus or ⋯ menus other than **Fullscreen**, no `AddWidgetButton`, no
  `DashboardHeader` menu, no `StarterHint`. `WidgetFrame` and `Taskbar` gain `readOnly?: boolean`
  (default `false`): read-only frames have no handles and no Minimize / Move / Size / Rename /
  Delete; read-only taskbar items open the widget fullscreen instead of restoring it. Fullscreen
  (`?widget=<id>`) works in view mode, since it is a view, not an edit.

- [ ] **Step 1: Write the failing browser tests:** `"view mode shows every widget in its place"`;
  `"view mode has no handles, no menu edits, and no add button"`; `"a key press never picks a
  widget up"` (Space / Enter on a frame); `"fullscreen works from the frame and from the
  taskbar"`; `"an edit page is unchanged"` (the existing arranging tests still pass); axe.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (keep one grid; derive `doc` and
  `editable` from `view ?? session`). **Step 4:** `npm run test:browser` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add a view-only mode to the dashboard grid"`.

### Task 5: The shared page

**Files:** Create `src/routes/SharedPage.svelte` (+ `shared-page.browser.test.ts`),
`src/lib/shared/remote.ts`, `poll.svelte.ts` (+ test), `report.ts` (+ test),
`src/lib/components/shared/MadeByBar.svelte`, `src/lib/links.ts`. Modify `src/router.ts`,
`src/lib/sharing/copy.ts` (+ test), `HelpMenu.svelte` (use `CONTACT_URL`), `messages/en.json`.

**Interfaces:**
- Consumes: Task 1's `shared`, `sharedChanges`; Task 4's `DashboardGrid view`;
  `loadDashboard`, `MAX_DOCUMENT_CHARS`, `sharedDocumentOf`, `fingerprint`, `saveCopy`,
  `askExistingCopy`, `updateNotice.show("newer-data")`, `platform().activity`,
  `platform().online`.
- Produces:
  ```ts
  // src/lib/links.ts
  export const CONTACT_URL = "https://www.sjvair.com/contact/";
  // src/lib/shared/remote.ts
  /** The documents remote, loaded on demand; works signed out. One per page load. */
  export function sharedRemote(): Promise<RemoteDocuments>;
  // src/lib/shared/report.ts
  export function reportUrl(token: string): string;
  // → `${CONTACT_URL}?topic=Report&page=${encodeURIComponent(`${BASE}/shared/${token}`)}`
  // src/lib/shared/poll.svelte.ts
  export type SharedView =
  	| { kind: "loading" }
  	| { kind: "shown"; doc: Dashboard; version: number; sourceId: string; displayName: string | null }
  	| { kind: "unavailable" } // any not_found: one page for every reason
  	| { kind: "newer" }
  	| { kind: "invalid" } // invalid or over MAX_DOCUMENT_CHARS
  	| { kind: "offline" }; // first load couldn't reach the server
  export class SharedDocumentView {
  	view: SharedView; // $state.raw
  	constructor(remote: RemoteDocuments, token: string, now?: () => Date);
  	start(): void; // load, then poll every 60 s while visible; at once on visible / online
  	stop(): void;
  	retry(): Promise<void>; // from the offline page
  }
  // src/lib/sharing/copy.ts
  /** The live dashboard copied from `sourceId` that changed most recently, if any. */
  export function findCopyOf(app: AppContext, sourceId: string): Promise<DashboardSummary | null>;
  ```
  The document is loaded as `loadDashboard({ kind, schemaVersion, id, name, body, version: 0,
  createdAt: updatedAt, updatedAt })` after the size check; `read-only` → `newer` / `invalid`. A
  poll that fails with `RemoteUnavailable` keeps the shown version (and tries again next time);
  a poll answering `not_found` switches to `unavailable`.

Page (`/shared/:token`, lazy in the router; add `"/shared": redirect to "/"` as the routing
section says trimmed paths do): sets `app.current = { session: null, isStarter: false }`.
`shown`: the **made-by bar** at the top, then an `h1` with the name (`m.shared_untitled()` when
`null`) and **Make a copy**, then `<DashboardGrid view={doc} />`. `document.title` uses the name.
Other views: one heading and a link to your dashboards; `unavailable` says **"This shared
dashboard is no longer available."**; `offline` adds **Try again**.

Made-by bar (`MadeByBar.svelte`, props `displayName`, `token`), a `<aside>` with an accessible
name, always shown, never dismissable: "Shared by {name}" or "Shared by an SJVAir user";
"This is not an official SJVAir page."; **Report this page** (`reportUrl(token)`,
`target="_blank" rel="noopener"`).

Make a copy: build the incoming document (`{ kind: "document", doc, sourceId, fingerprint }`);
`findCopyOf(app, sourceId)` → if found, `askExistingCopy(existing)` ("open" → go there; "new" →
copy; dismissed → nothing); else `saveCopy`, then navigate to `/dashboards/:id` with the existing
`m.import_saved()` toast. In an account space the copy uploads like any new dashboard.

- [ ] **Step 1: Write the failing tests:**
  - `poll.test.ts` (fake remote, fake timers, memory platform): `"opens the shared document"`;
    `"polls every 60 seconds while visible and never while hidden"`; `"polls at once on becoming
    visible and on coming online"`; `"an unchanged poll keeps the view"`; `"a newer version
    replaces the view"`; `"a link stopped while open shows no longer available"` (revoke, trash,
    and `disableSharing` each → `unavailable`); `"offline keeps the shown version"`; `"an invalid
    or oversized shared document never renders"`; `"a newer-format shared document asks for a
    reload"`; `"unknown, revoked, and private tokens give the same view"`.
  - `report.test.ts`: `"the report link carries the topic and the shared path"`.
  - `copy.test.ts`: `"findCopyOf finds the newest live copy by source id"`; `"a trashed copy
    doesn't count"`.
  - `shared-page.browser.test.ts`: `"shows the dashboard read-only under the made-by bar"`; `"the
    bar shows the display name, or a generic label"`; `"the bar shows nothing else about the
    owner"` (the bar's text is exactly its two sentences and the link); `"make a copy saves it and
    opens it"`;
    `"a second copy asks, even after the source changed"`; `"the unavailable page"`; axe on the
    shown and unavailable pages.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; add the messages. **Step 4:** Run → PASS;
  `npm run build && npm run check:budget` (the page and the remote are not in the initial chunk).
- [ ] **Step 5: Commit** — `git commit -m "Open live share links at /shared/:token"`.

### Task 6: "Based on …"

**Files:** Create `src/lib/shared/credit.svelte.ts` (+ test). Modify `DashboardHeader.svelte`
(+ a browser test), `messages/en.json`.

**Interfaces:**
- Consumes: Task 1's `credit`; Task 5's `sharedRemote`; `app.index`; `STARTER_ID`.
- Produces:
  ```ts
  export type BasedOn = { name: string | null; displayName: string | null };
  /** The credit for a copy's source, or null: none, the starter, refused, or offline. Cached per id for the page load. */
  export function basedOn(app: AppContext, copiedFrom: string | undefined): Promise<BasedOn | null>;
  ```
  A source stored here and not deleted → `{ name: its display name from app.index.names, displayName: null }`
  with no request. Otherwise `credit(copiedFrom)`; `not_found` or `RemoteUnavailable` → `null`
  (cached too, so a refused id isn't asked again this page load).
  The header shows, at its start, a muted line: "Based on {name} by {displayName}", "Based on
  {name}", "Based on a shared dashboard by {displayName}", or "Based on a shared dashboard"
  (four messages, picked by which values are present). Nothing while loading or when `null`.

- [ ] **Step 1: Write the failing tests:** `"a duplicate of a stored dashboard uses its name with
  no request"`; `"a copy of a shared dashboard shows its name and display name"`; `"a source
  that's private again, gone, or unreachable shows nothing"`; `"the starter is never looked up"`;
  `"each id is asked once per page load"`; browser: `"the header shows the credit line"` (each of
  the four variants).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Show what a copy is based on"`.

### Task 7: End-to-end: share, open signed out, stop

**Files:** Create `e2e/share-links.spec.ts`. Modify `e2e/fixtures.ts` if a signed-out second
context needs a helper.

**Interfaces:** the `documentsServer` fixture from spec 2 (one fake per test, every context).
Device A: `account: maria`. Viewer: a second context with no account.

- [ ] **Step 1: Write the tests:**
  - `"a teacher's link opens for a student with no account"`: A creates a link and copies it; the
    viewer opens it, sees the widgets, the made-by bar, and no edit controls.
  - `"the viewer sees the owner's change after a poll"` (A renames a widget; the viewer's page
    becomes visible again → polls at once → new title).
  - `"stop sharing: the open page and a fresh load both say no longer available"`.
  - `"make a copy, signed out, then again: the second time asks"`.
  - `"make a copy signed in: it uploads"` (a third context, another account; the fake has the copy
    with `copiedFrom`).
  - `"the copy shows Based on with the display name"` (A sets a display name first).
  - `"report this page links to the contact form with the shared path"` (assert the `href`; don't
    follow it).
  - `"a link shared on one device shows on the other"` (A2, same account: its Share dialog shows
    the link after a poll).
  - axe on the shared page and the Share dialog (`expectNoViolations`).
- [ ] **Step 2:** `npm run test:e2e:all` → PASS on Chromium, Firefox, WebKit.
- [ ] **Step 3: Commit** — `git commit -m "E2E: live share links"`.

### Task 8: Docs, deferrals, the stack check

**Files:** Modify `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`.

- [ ] **Step 1: `ARCHITECTURE.md`:** under "How the dashboard syncs", a "Live share links (sync
  spec 3)" list with this plan's calls 1–9; in "Routing, URL state & undo", `/shared/:token`
  is built and `/shared` redirects home; "Security baseline" item 6 notes the made-by bar and
  report link are built.
- [ ] **Step 2: `DEFERRED.md`:** move "Pre-filling sjvair.com's contact form" to `TODO.md` →
  Done. The three deferrals this plan makes (a new display name reaching open shared pages only
  with the next edit; no "Based on …" on shared pages; each shared tab polling on its own) were
  added with the plan, under "Server-backed saved documents & live share links"; update them if
  building changed anything. Add anything else deferred while building, with why and a revisit
  trigger.
- [ ] **Step 3: The stack check** (needs the podman stack on sjvair.com `develop` and `npm run
  dev`), recorded in `TODO.md` → "Sync track" as a hand check for the user, and run once by the
  builder where possible: create a link signed in as the `WORKSPACE_E2E_*` account; open it in a
  private window (signed out); the response headers carry `noindex` and `no-store`; follow
  "Report this page" on the real site and see the form pre-filled; stop sharing and reload the
  private window. A gap found here goes to the user as a separate sjvair.com plan (on
  `develop`), not into this branch.
- [ ] **Step 4: `TODO.md`:** "Start here" and "Sync track" say spec 3 is done (PR number) and
  spec 4 is next, built on this branch's `main` merge.
- [ ] **Step 5:** `npm run lint && npm run check && npm run test && npm run build && npm run
  check:build && npm run check:budget` → all pass.
- [ ] **Step 6: Commit** — `git commit -m "Docs: sync spec 3 is built"`, push, open the PR into
  `main` (no attribution). Stop: merging needs the user's yes.
