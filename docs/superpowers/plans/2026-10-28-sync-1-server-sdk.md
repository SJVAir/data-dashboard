# Sync spec 1: server and SDK — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sjvair.com stores signed-in users' dashboards with version-checked saves, a change log,
share links, snapshots, limits, and full account deletion; sdk-js wraps every endpoint.

**Architecture:** A new Django app `camp.apps.documents` (models, admin, periodic tasks) and API
package `camp.api.v2.documents` (resticus endpoints under `/api/2.0/documents/`). The server
stores `body` and changes as uninterpreted JSON; the only checks inside them are size and type.
sdk-js gains a `lib/documents/` module with typed calls and a `DocumentRefusal` error carrying
the server's refusal code.

**Tech Stack:** Django + django-resticus, PostgreSQL JSONField, django-huey periodic tasks,
pytest; Deno + zod for sdk-js.

**Spec:** `docs/superpowers/specs/2026-10-28-server-backed-documents-design.md` (data-dashboard,
branch `sync`). Read "Hard rules", "How it works", "The server", and "sdk-js" before starting.

## Repos, branches, worktrees

| Repo | Worktree | Branch | From | PR into |
| --- | --- | --- | --- | --- |
| sjvair.com | `~/workspace/sjvair/sjvair.com/.worktrees/saved-documents` | `feature/saved-documents` | `develop` | `develop` |
| sdk-js | `~/workspace/sjvair/sdk-js/.worktrees/documents` | `feature/documents` | `release/4.8.0` | `release/4.8.0` |

- Other sessions use the main checkouts: work only in these worktrees, and re-read any file
  before editing it.
- **sjvair.com tests** (from the worktree; one suite at a time):
  `podman run --rm --network sjvaircom_sjvair-net --env-file .env.test -e BAM_MIRROR_ENABLED=0 -e TWILIO_AUTH_TOKEN=test-token -v $PWD:/app:z -w /app sjvair-com-test:latest pytest <paths> -n 4 --dist loadscope`
  The worktree needs a copy of `.env.test` from the main checkout. For the CSRF test add
  `-v ~/workspace/django-resticus/.worktrees/session-csrf:/resticus:ro -e PYTHONPATH=/resticus`.
- **sdk-js tests:** `deno test --allow-net --allow-env lib/documents/` (stub tests need no server;
  the integration test needs the local stack running this branch, see Task 12).
- No AI attribution in commits or PRs. Never merge, release, or publish without asking: the
  PRs are opened for review only, and **no sdk-js prerelease is cut in this plan**.

## Global Constraints

- All endpoints under `/api/2.0/documents/`, `documented = False` (private API), JSON keys
  `snake_case` like the rest of the API.
- Every response from a documents endpoint carries `Cache-Control: no-store`.
- Document ids: `^[A-Za-z0-9_-]{1,64}$`. Only `kind == "dashboard"` is accepted.
- `body` limit: 1,000,000 **characters** of `json.dumps(body, ensure_ascii=False, separators=(",", ":"))`
  (matches the dashboard's `MAX_DOCUMENT_CHARS`). A save's `changes`: 2,000,000 characters, same measure.
- 50 live (not deleted) dashboards per account; 25 MB (26,214,400 characters of `size`) of
  document bodies per account, deleted included; snapshots capped separately at 25 MB per
  account, oldest trimmed first, **never** refusing a save; 120 saves per minute per account;
  server change log kept for the last 500 versions per document; trash and snapshots kept 30 days.
- All of those live in settings (`camp/settings/base.py`) as `DOCUMENTS_*` constants.
- Share tokens: `secrets.token_urlsafe(16)` or longer, unique.
- Shared and credit responses never include the owner's id, name, email, or phone.
- Someone else's document answers exactly like a missing one (same status, same body).
- No admin page, inline, list column, search field, or action exposes a `body`, snapshot, or change log.
- "Pacific day" = `America/Los_Angeles`.
- Python style follows the surrounding code (4 spaces, single quotes as in `camp/apps/workspace`).

## Wire contract

Refusals use resticus's error shape plus an optional payload:

```json
{ "errors": { "detail": [{ "message": "…", "code": "stale_base" }] }, "data": { … } }
```

| Code | Status | `data` |
| --- | --- | --- |
| `invalid` | 400 | `{ "fields": { name: [messages] } }` |
| `too_large` | 413 | — |
| `build_blocked` | 409 | — |
| `account_mismatch` | 403 | `{ "signed_in_as": "<id>" }` |
| `rate_limited` | 429 | — |
| `id_taken` | 409 | — |
| `gone` | 410 | — |
| `not_found` | 404 | — |
| `stale_base` | 409 | `{ "version", "schema_version", "changes": [Entry] \| null, "document": Document }` |
| `schema_downgrade` | 409 | `{ "schema_version" }` |
| `limit_documents` / `limit_storage` | 403 | `{ "limit" }` |
| `sharing_blocked` | 403 | — |
| `not_deleted` | 409 | — |

- `Document` = `{ id, kind, name, schema_version, version, body, copied_from, deleted_at, created_at, updated_at, visibility, share_token }`
- `DocumentMeta` = `Document` without `body`, plus `size`.
- `Entry` = `{ version, schema_version, change }`: one change from the server log, `version` = the
  server version whose save carried it, in order.
- `SharedDocument` = `{ kind, name, schema_version, version, body, updated_at, display_name }`.

Save request (`PUT documents/<id>/`):

```json
{ "kind": "dashboard", "schema_version": 1, "name": null, "body": {…},
  "deleted_at": null, "copied_from": null, "base_version": 3,
  "changes": [{ "schema_version": 1, "change": {…} }],
  "account_id": "<id>", "build_id": "<git sha>", "snapshot": null }
```

`base_version` `null` = create. `snapshot` is `null` or `"conflict"`. Success: `200 { "data": { "version", "updated_at" } }`.

## Review Focus

1. **Two saves on the same base** (two devices) — exactly one is accepted; the second gets
   `stale_base` with the first's changes. Pinned in Task 3 (sequential test; the row lock is
   `select_for_update`).
2. **A client ahead of the server** (`since` greater than the stored version, e.g. after a
   server restore) — `changes` answers with `changes: null` and the document, never an empty
   list that looks like "nothing new". Pinned in Task 5.
3. **Revoke then re-share** — the old token stops working and never comes back. Pinned in Task 7.
4. **Soft delete then restore** — the same share link works again; while deleted it answers
   exactly like an unknown token. Pinned in Task 7.
5. **Size measured in characters** — a body of exactly 1,000,000 characters with non-ASCII text
   is accepted, one more is refused. Pinned in Task 3.

---

### Task 1: The documents app, models, and settings (sjvair.com)

**Files:**
- Create: `camp/apps/documents/{__init__,apps,models}.py`, `camp/apps/documents/migrations/0001_initial.py` (generated)
- Modify: `camp/settings/base.py` (INSTALLED_APPS after `camp.apps.workspace`; `DOCUMENTS_*` constants)
- Test: `camp/apps/documents/tests/test_models.py`

**Interfaces:**
- Produces (models, all `on_delete=CASCADE` from the user):
  - `SavedDocument`: `id` CharField(64, pk, regex validator), `owner` FK User (`related_name='saved_documents'`),
    `kind`, `name` (100, null), `body` JSONField, `size` int, `schema_version` int, `version` int (default 0),
    `visibility` choices `private|link|public` (default `private`), `share_token` (unique, null),
    `copied_from` (64, null), `deleted_at` (null), `sharing_disabled` bool, `created_at`, `updated_at` (auto, db_index).
  - `DocumentChange`: `document` FK, `version`, `entries` JSONField (list of `{schema_version, change}`); unique (`document`, `version`).
  - `DocumentSnapshot`: `document` FK, `owner` FK, `version`, `schema_version`, `name`, `body`, `size`,
    `reason` choices `schema|daily|conflict`, `created_at` (db_index).
  - `DocumentProfile`: `user` OneToOne (`related_name='document_profile'`), `display_name` (60, null), `sharing_blocked` bool.
  - `BlockedBuild`: `build_id` CharField(64, unique), `note`, `created_at`.
  - `PurgedDocument`: `id` CharField(64, pk), `owner` FK, `purged_at`.
  - `measure(value) -> int` in `models.py`: the character count defined in Global Constraints.
  - Settings: `DOCUMENTS_MAX_PER_ACCOUNT = 50`, `DOCUMENTS_MAX_STORAGE = 25 * 1024 * 1024`,
    `DOCUMENTS_MAX_SNAPSHOT_STORAGE = 25 * 1024 * 1024`, `DOCUMENTS_MAX_BODY = 1_000_000`,
    `DOCUMENTS_MAX_CHANGES = 2_000_000`, `DOCUMENTS_SAVES_PER_MINUTE = 120`, `DOCUMENTS_LOG_LIMIT = 500`,
    `DOCUMENTS_TRASH_DAYS = 30`, `DOCUMENTS_SNAPSHOT_DAYS = 30`.

- [ ] **Step 1:** Create the worktree and branch (table above); copy `.env.test`.
- [ ] **Step 2: Write failing tests** `test_id_validator_rejects` (`"a b"`, `"x" * 65`, `""` fail `full_clean`; `"Ab-_9"` passes),
  `test_share_token_unique` (IntegrityError on a duplicate non-null token; two `None` allowed),
  `test_user_delete_cascades` (deleting the owner removes their SavedDocument, DocumentChange,
  DocumentSnapshot, DocumentProfile, PurgedDocument rows), `test_measure_counts_characters`
  (`measure({"a": "é"}) == len('{"a":"é"}')`).
- [ ] **Step 3:** Run them; expect import errors.
- [ ] **Step 4:** Implement the models and settings; `python manage.py makemigrations documents` inside the web container.
- [ ] **Step 5:** Run the tests; expect PASS.
- [ ] **Step 6: Commit** `Add the documents app and models`.

### Task 2: Endpoint plumbing, list, and detail

**Files:**
- Create: `camp/api/v2/documents/{__init__,urls,endpoints,responses,serializers}.py`
- Modify: `camp/api/v2/urls.py` (`path('documents/', include('camp.api.v2.documents.urls', namespace='documents'))`)
- Test: `camp/api/v2/documents/tests/test_read.py`, `camp/api/v2/documents/tests/helpers.py`

**Interfaces:**
- Produces:
  - `responses.refuse(code: str, status: int, message: str, data: dict | None = None) -> HttpResponse` (the wire shape, `no-store`).
  - `endpoints.NoStoreMixin`: sets `Cache-Control: no-store` on every response, including errors.
  - `endpoints.owned_document(request, id) -> SavedDocument | None` (owner-filtered; `None` for missing **or** not yours).
  - `serializers.document(doc) -> dict` (`Document`), `serializers.meta(doc) -> dict` (`DocumentMeta`), `serializers.entries(changes) -> list` (flattened `Entry`s in order).
  - `helpers.make_user(n: int) -> User`, `helpers.save(client, id, **overrides) -> Response` (a valid save body with defaults), `helpers.body(widgets=0) -> dict`.
  - `GET documents/` → `200 { data: { documents: [DocumentMeta], purged: [id], cursor } }`; with `?since=<iso>`:
    documents with `updated_at >= since` and purged ids with `purged_at >= since`; without `since`: all the owner's documents
    (deleted included) and `purged: []`. `cursor` = server now minus 10 seconds (overlap so a commit in flight isn't missed;
    clients ignore versions they already have).
  - `GET documents/<id>/` → `200 { data: Document }`; missing or not owner → `refuse("not_found", 404, …)`; own purged → `refuse("gone", 410, …)`.
  - Signed out → 401 (resticus `login_required = True`).

- [ ] **Step 1: Write failing tests:** `test_signed_out_401`, `test_list_own_only` (two users' docs; each sees only theirs),
  `test_list_since_returns_changed_and_purged`, `test_list_includes_deleted`, `test_detail_other_owner_same_as_missing`
  (assert status **and** `response.content` byte-identical for another user's id and a never-used id),
  `test_detail_purged_is_gone`, `test_no_store_on_success_and_error`. Seed rows directly through the models.
- [ ] **Step 2:** Run; expect 404s from the router.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `Add the documents list and detail endpoints`.

### Task 3: Saving — the version check and refusals

**Files:**
- Modify: `camp/api/v2/documents/endpoints.py`, `urls.py`
- Create: `camp/api/v2/documents/save.py` (request validation and the save transaction, kept out of the endpoint class)
- Test: `camp/api/v2/documents/tests/test_save.py`

**Interfaces:**
- Consumes: Task 2's `refuse`, `owned_document`, serializers.
- Produces: `PUT documents/<id>/` (same `DocumentDetail` endpoint as Task 2's GET);
  `save.validate(data) -> (cleaned: dict, errors: dict)`; `save.apply_save(user, id, cleaned) -> HttpResponse`.

Check order (each refusal stops the save, with no write):
1. Signed out → 401. 2. Invalid shape → `invalid` (field errors: kind, schema_version ≥ 1, name ≤ 100 or null, body is an object,
`deleted_at`/`copied_from` types, `base_version` int ≥ 0 or null, `changes` a list of `{schema_version, change: object}`,
`account_id`/`build_id` strings ≤ 64, `snapshot` null or `"conflict"`, id matches the regex). 3. Body or changes over the size limit
→ `too_large`. 4. `build_id` in `BlockedBuild` → `build_blocked`. 5. `account_id` ≠ `session_user_data(request.user)['id']` →
`account_mismatch` with `signed_in_as`. 6. Inside `transaction.atomic()` with `select_for_update()` on the row:
id purged (own) → `gone`; id purged by someone else or owned by someone else → `id_taken`; row missing and
`base_version` not null → `not_found`; row exists and `base_version` null or ≠ `version` → `stale_base`
(payload: changes since `base_version` from the log, or `null` if `base_version` is null or the log doesn't reach back);
incoming `schema_version` < stored → `schema_downgrade`. 7. Write: `version += 1`, store fields and `size`, append one
`DocumentChange` with this save's `changes`, delete log rows with `version <= new_version - DOCUMENTS_LOG_LIMIT`.

- [ ] **Step 1: Write failing tests:** `test_create_then_save_increments_version`, `test_same_base_twice_second_is_stale`
  (second save's payload has the first save's `changes` as `Entry`s and the current `document`),
  `test_create_over_existing_own_is_stale_with_null_changes`, `test_other_owner_id_taken`, `test_purged_own_is_gone`,
  `test_purged_other_is_id_taken`, `test_missing_with_base_is_not_found`, `test_schema_downgrade_refused`,
  `test_account_mismatch_has_signed_in_as`, `test_blocked_build`, `test_invalid_fields_listed`,
  `test_kind_other_than_dashboard_invalid`, `test_body_exactly_limit_with_non_ascii_accepted` and `…_plus_one_refused`
  (use `"é"` padding; Review Focus 5), `test_log_trimmed_to_limit` (override `DOCUMENTS_LOG_LIMIT=3`, five saves, versions 3–5 kept),
  `test_log_gap_gives_null_changes`, `test_refusals_write_nothing` (row and log unchanged after each refusal).
- [ ] **Step 2:** Run; expect FAIL (405).
- [ ] **Step 3:** Implement `validate` and `apply_save`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5: Commit** `Save documents with a version check`.

### Task 4: Limits, rate limit, and snapshots on save

**Files:**
- Modify: `camp/api/v2/documents/save.py`
- Create: `camp/apps/documents/snapshots.py`
- Test: `camp/api/v2/documents/tests/test_limits.py`, `camp/apps/documents/tests/test_snapshots.py`

**Interfaces:**
- Produces: `snapshots.take(doc: SavedDocument, reason: str) -> DocumentSnapshot` (copies the **stored** state, then trims the owner's
  oldest snapshots until their total `size` ≤ `DOCUMENTS_MAX_SNAPSHOT_STORAGE`); `snapshots.reason_for(doc, cleaned, now) -> str | None`.
- Rate limit: after `account_mismatch`, before the transaction: a cache counter `documents:saves:<user pk>:<epoch minute>`;
  over `DOCUMENTS_SAVES_PER_MINUTE` → `rate_limited` (429).
- Limits, inside the transaction after the version checks: a save that leaves the doc live (`deleted_at` null) when it is new or was
  deleted, and the owner already has `DOCUMENTS_MAX_PER_ACCOUNT` live docs → `limit_documents`; owner's total `size` minus this doc's old
  size plus the new size > `DOCUMENTS_MAX_STORAGE` → `limit_storage`.
- Snapshot, existing docs only, before the write, at most one per save, by priority: incoming `schema_version` > stored → `schema`;
  `snapshot == "conflict"` → `conflict`; no snapshot of this doc since the start of today (Pacific) → `daily`.

- [ ] **Step 1: Write failing tests:** `test_fifty_live_then_refused`, `test_deleted_dont_count_toward_fifty`,
  `test_undelete_at_fifty_refused`, `test_creating_deleted_at_fifty_allowed`, `test_storage_limit_counts_deleted`,
  `test_rate_limit_121st_save` (override to a small number), `test_first_save_of_day_snapshots_stored_version`,
  `test_second_save_same_day_no_snapshot`, `test_schema_bump_snapshots`, `test_conflict_flag_snapshots_even_same_day`,
  `test_snapshot_cap_trims_oldest_never_refuses` (cap override; the save succeeds and the oldest snapshot is gone),
  `test_create_takes_no_snapshot`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run Tasks 3–4 tests; expect PASS.
- [ ] **Step 5: Commit** `Add document limits, save rate limit, and snapshots`.

### Task 5: Polling — changes since a version

**Files:** Modify `endpoints.py`, `urls.py`; Test `tests/test_changes.py`

**Interfaces:**
- Produces: `GET documents/<id>/changes/?since=N` (owner): `N == version` → `200 { data: { version } }`;
  `N < version` and the log holds `N+1…version` → `{ version, changes: [Entry], document }`; otherwise (gap, or `N > version`)
  → `{ version, changes: null, document }`. Missing `since` or not an int ≥ 0 → `invalid`. Not owner/missing → `not_found`; own purged → `gone`.

- [ ] **Step 1: Write failing tests:** `test_unchanged_is_version_only`, `test_changes_in_order`, `test_gap_is_null`,
  `test_client_ahead_is_null_with_document` (Review Focus 2), `test_other_owner_not_found`, `test_purged_gone`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add the document changes endpoint for polling`.

### Task 6: Permanent delete and the periodic purge

**Files:**
- Modify: `endpoints.py`, `urls.py`
- Create: `camp/apps/documents/tasks.py`, `camp/apps/documents/purge.py`
- Test: `tests/test_delete.py`, `camp/apps/documents/tests/test_purge.py`

**Interfaces:**
- Produces: `DELETE documents/<id>/` (owner; only when `deleted_at` is set, else `not_deleted`) → `204`, removing the row (and by cascade its log and
  snapshots) and creating `PurgedDocument(id, owner)`. `purge.purge_document(doc)`, `purge.purge_expired(now) -> int` (deleted more than
  `DOCUMENTS_TRASH_DAYS` ago), `purge.expire_snapshots(now) -> int` (older than `DOCUMENTS_SNAPSHOT_DAYS`).
  `tasks.py`: two `@db_periodic_task(crontab(hour=…, minute=…))` wrappers, daily, following `camp/apps/archive/tasks.py`.

- [ ] **Step 1: Write failing tests:** `test_delete_requires_deleted_at`, `test_delete_creates_purged_record_and_lists_it`,
  `test_delete_other_owner_not_found`, `test_purge_expired_only_older_than_30_days`, `test_expire_snapshots_30_days`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add permanent delete and the 30-day purge`.

### Task 7: Share links, shared reads, credit, display name

**Files:**
- Modify: `endpoints.py`, `urls.py`, `serializers.py`
- Test: `tests/test_sharing.py`

**Interfaces:**
- Produces:
  - `POST documents/<id>/share/` (owner): `sharing_disabled` or the owner's `document_profile.sharing_blocked` → `sharing_blocked`;
    `deleted_at` set → `not_found`; sets `visibility='link'`, keeps an existing token or makes one → `200 { data: { share_token } }`.
  - `DELETE documents/<id>/share/` (owner): `share_token=None`, `visibility='private'` → `204`.
  - `serializers.shareable(doc) -> bool`: visibility in (`link`, `public`), token set, not deleted, not `sharing_disabled`, owner not `sharing_blocked`.
  - `GET documents/shared/<token>/` (anyone, no login): shareable → `200 { data: SharedDocument }`; otherwise → `refuse("not_found", 404, "This shared dashboard is no longer available.")`, identical for every reason.
  - `GET documents/shared/<token>/changes/?since=N`: `{ version }` when unchanged, else `{ data: SharedDocument }`'s fields; same not-found rule.
  - `GET documents/<id>/credit/` (anyone): owner, or `shareable(doc)` → `{ name, display_name }`; else `not_found`.
  - `GET` / `PUT documents/profile/` (signed in): `{ display_name }`, stripped, ≤ 60, empty → `null`; creates the profile on first use.

- [ ] **Step 1: Write failing tests:** `test_share_creates_token_of_22_plus_chars`, `test_share_twice_same_token`,
  `test_revoke_then_share_new_token_old_dead` (Review Focus 3), `test_soft_delete_hides_then_restore_same_link` (Review Focus 4),
  `test_not_shareable_responses_identical` (private, revoked, deleted, unknown, `sharing_disabled`, owner `sharing_blocked`: same status and
  byte-identical content), `test_shared_has_no_personal_fields` (assert the key set equals `SharedDocument`'s exactly; the owner's email,
  phone, full name, and id appear nowhere in `response.content`), `test_shared_works_signed_out`, `test_shared_changes_unchanged`,
  `test_credit_owner_or_shared_only`, `test_profile_display_name_round_trip_and_blank_is_null`, `test_share_blocked_owner_refused`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add share links, shared reads, credit, and display names`.

### Task 8: Snapshot list and the backup download

**Files:** Modify `endpoints.py`, `urls.py`; Test `tests/test_snapshots_api.py`, `tests/test_export.py`

**Interfaces:**
- Produces:
  - `GET documents/<id>/snapshots/` (owner) → `{ data: [{ id, version, schema_version, reason, created_at }] }`, newest first;
    `GET documents/<id>/snapshots/<int:snapshot_id>/` → `{ data: { id, version, schema_version, name, body, created_at } }`; other owner → `not_found`.
  - `GET documents/export/` (owner) → the dashboard's backup envelope, as an attachment named `sjvair-dashboards-<Pacific YYYY-MM-DD>.json`:
    `{ "format": "sjvair-workspace", "type": "backup", "formatVersion": 1, "exportedAt": <iso>, "documents": [...] }`, live documents only,
    each `{ kind, schemaVersion, id, name, copiedFrom? (omitted when null), version: 0, createdAt, updatedAt, body }` (camelCase: this is the
    dashboard's file format, not the API's).

- [ ] **Step 1: Write failing tests:** `test_snapshot_list_newest_first`, `test_snapshot_detail_other_owner_not_found`,
  `test_export_envelope_shape` (exact top-level keys; deleted docs excluded; `copiedFrom` absent when null; filename header).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add snapshot reads and the dashboards backup download`.

### Task 9: Admin with no access to private contents

**Files:** Create `camp/apps/documents/admin.py`; Test `camp/apps/documents/tests/test_admin.py`

**Interfaces:**
- Produces: `SavedDocumentAdmin` (`list_display`/`fields`: id, owner, kind, name, visibility, size, version, created_at, updated_at, deleted_at,
  sharing_disabled; all read-only except `sharing_disabled`; no add; `search_fields` id and owner email only; actions
  `disable_share_links` / `enable_share_links`); `DocumentProfileAdmin` (user, display_name, sharing_blocked); `BlockedBuildAdmin`.
  `DocumentChange`, `DocumentSnapshot`, and `PurgedDocument` are not registered.

- [ ] **Step 1: Write failing tests** (superuser client, admin at `/batcave/`): `test_change_page_never_shows_body` (a body holding a unique
  marker string; the changelist, change page, and history page don't contain it), `test_disable_share_link_action_stops_shared_read`,
  `test_snapshot_and_change_models_not_registered`, `test_blocked_build_editable`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add the documents admin, metadata only`.

### Task 10: Delete account on the `/account/` page

ARCHITECTURE.md puts account deletion on sjvair.com's account page, but today only the API (mobile)
deletes accounts. This adds a **"Delete account" section to the existing `/account/` profile page**
(decided with the user, 2026-10-28: no separate page). The API path is unchanged and gets documents
removed by cascade.

**Files:**
- Modify: `camp/apps/accounts/{views,urls,forms}.py`, `camp/templates/account/profile.html`
- Create: `camp/templates/account/_delete-account.html` (the section, included below the profile form)
- Test: `camp/apps/accounts/test_delete.py`

**Interfaces:**
- Produces:
  - `ProfileView.get_context_data` adds `delete_form` (a `DeleteAccountForm`: `password`, plus a required "I understand this can't be
    undone" checkbox) and `deletion_counts` = `{ dashboards, share_links, subscriptions }` (dashboards = `saved_documents` incl. deleted;
    share links = shareable ones; subscriptions = alert subscriptions).
  - The section (its own `<form>`, below the "Update profile" form, visually separate) lists what will be deleted with those counts, a
    "Download my dashboards" link to `api:v2:documents:export` (only when dashboards > 0), and the two fields with a "Delete my account" button.
  - `/account/delete/` (`account:delete`), `DeleteAccountView`: **POST only** (GET → redirect to `account:profile`), login required. Valid
    (right password and the checkbox) → delete the user, log out, redirect home with a "Your account was deleted" message. Invalid →
    re-render `account/profile.html` with the profile form unchanged and `delete_form` carrying its errors (status 200).
  - The profile form's own POST never deletes anything. Bulma is fine here (sjvair.com's own page).

- [ ] **Step 1: Write failing tests:** `test_profile_shows_counts_and_delete_form`, `test_download_link_only_with_dashboards`,
  `test_wrong_password_keeps_account`, `test_unchecked_confirmation_keeps_account`, `test_delete_removes_documents_and_logs_out`
  (then `GET documents/shared/<token>/` → not found), `test_get_delete_url_redirects_to_profile`, `test_profile_post_never_deletes`.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `Add an account deletion page covering saved dashboards`.

### Task 11: "Report this page" pre-fill, CSRF check, and PR (sjvair.com)

**Files:** Modify `camp/apps/contact/{forms,views}.py`; Test `camp/apps/contact/tests.py` (create if absent), `camp/api/v2/documents/tests/test_csrf.py`

**Interfaces:**
- Produces: topic `('Report', 'Report a shared dashboard')` added to `ContactForm.TOPICS`; `ContactFormView` initial values from
  `?topic=Report&page=<url>`: topic `Report`, subject `Report a shared dashboard`, message starting `Page: <url>`, only when `page`'s path
  starts with `/workspace/shared/` and its host is empty or the request's host (else `page` is ignored); `page` capped at 500 characters.
  The dashboard (spec 3) links to `/contact/?topic=Report&page=<encoded URL>`.

- [ ] **Step 1: Write failing tests:** `test_report_prefill`, `test_foreign_page_ignored`, and in `test_csrf.py`
  `test_session_save_without_csrf_refused` (`Client(enforce_csrf_checks=True)`, logged in, PUT without the token → 403; with it → 200;
  `pytest.skip` when `resticus.auth` has no `enforce_csrf`, i.e. running without the fix).
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS). Run the CSRF test **with** the resticus mount.
- [ ] **Step 5:** Run the whole `camp/apps/documents camp/api/v2 camp/apps/accounts camp/apps/contact camp/apps/workspace` suites; expect PASS.
- [ ] **Step 6: Commit** `Pre-fill the contact form for shared-page reports`; push; open a PR into `develop` titled
  "Server-backed dashboards: storage, sync, and share-link endpoints" linking the design. **Do not merge.**

### Task 12: sdk-js documents module

**Files:**
- Create: `lib/documents/{mod,schema,types,refusal,documents,sharing,snapshots,profile}.ts`, `lib/documents/documents_test.ts` (fetch-stub),
  `lib/documents/mod_test.ts` (integration)
- Modify: `deno.json` (exports `./documents` and each file), `mod.ts` (re-export), `README.md` (a short Documents section)

**Interfaces:**
- Produces (all take a trailing `options?: RequestOptions`, rely on the session cookie, and throw `DocumentRefusal` for any
  documents error response):
  - `class DocumentRefusal extends Error { code: string; status: number; data: unknown }` and
    `isDocumentRefusal(e: unknown, code?: string): e is DocumentRefusal`.
  - `listDocuments(params?: { since?: string }) -> Promise<DocumentList>` (`{ documents: DocumentMeta[]; purged: string[]; cursor: string }`)
  - `getDocument(id) -> Promise<SavedDocument>`
  - `getDocumentChanges(id, since: number) -> Promise<DocumentChanges>` (`{ version } | { version; changes: ChangeEntry[] | null; document: SavedDocument }`)
  - `saveDocument(id, form: SaveDocumentForm) -> Promise<{ version: number; updated_at: string }>`
  - `deleteDocument(id) -> Promise<void>`
  - `createShareLink(id) -> Promise<{ share_token: string }>`, `revokeShareLink(id) -> Promise<void>`
  - `listSnapshots(id) -> Promise<SnapshotMeta[]>`, `getSnapshot(id, snapshotId: number) -> Promise<Snapshot>`
  - `getDocumentCredit(id) -> Promise<{ name: string | null; display_name: string | null }>`
  - `getSharedDocument(token) -> Promise<SharedDocument>`, `getSharedDocumentChanges(token, since: number) -> Promise<{ version: number } | SharedDocument>`
  - `getDocumentProfile()` / `updateDocumentProfile({ display_name })` → `Promise<{ display_name: string | null }>`
  - Types mirror the wire contract in `snake_case`; `body` and `change` are `unknown` (the dashboard validates them). Zod schemas validate
    every response except `body`/`change` contents. `REFUSAL_CODES` exports the code list as a const tuple.

- [ ] **Step 1:** Create the worktree and branch (table above).
- [ ] **Step 2: Write failing stub tests** in `documents_test.ts` using `stubFetch`/`jsonResponse`: each function's method, path (e.g.
  `PUT …/api/2.0/documents/abc/`), and JSON body; `X-CSRFToken` on writes (as `lib/http/csrf_test.ts` does); a 409
  `stale_base` response becomes `DocumentRefusal` with `code === "stale_base"`, `status === 409`, and `data.changes`; a 404 shared read
  becomes `code === "not_found"`; a malformed success response is rejected by the schema.
- [ ] **Step 3:** Run `deno test lib/documents/documents_test.ts`; expect FAIL.
- [ ] **Step 4:** Implement on `httpRequest`/`jsonCall`, converting the thrown error's `cause.result` into `DocumentRefusal`.
- [ ] **Step 5:** Run; expect PASS. Run `deno lint`, `deno fmt --check`, `deno check mod.ts`.
- [ ] **Step 6: Integration test** `mod_test.ts` (skipped unless `TEST_DOCUMENTS=1`, needs the local stack serving Task 11's branch and a
  session; log in through `login` with the `.env` test account and pass its cookie via `options.init`): create, save, stale save →
  `stale_base`, share, read shared signed out, revoke, soft delete + permanent delete → `gone`. Run it once against the local stack.
- [ ] **Step 7: Commit** `Add the documents module`; push; open a PR into `release/4.8.0`. **Do not merge, bump the version, or publish.**

### Task 13: Record status (data-dashboard, branch `sync`)

**Files:** Modify `TODO.md` (status of this track: spec 1 PRs and what's next), `DEFERRED.md` (any deferral made while building, with why and revisit trigger)

- [ ] **Step 1:** Re-read both files (another session may have changed them), then update.
- [ ] **Step 2: Commit** `Record sync spec 1 status`.
- [ ] **Step 3:** Tell the user both PRs are open and that spec 2 needs an sdk-js prerelease, which needs their yes.
