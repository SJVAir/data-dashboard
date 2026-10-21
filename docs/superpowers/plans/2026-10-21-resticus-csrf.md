# django-resticus CSRF Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Session-authenticated unsafe API requests through django-resticus must pass
Django's CSRF check, with sjvair.com made ready for it and the subscribe button verified
end to end on local sjvair.com.

**Architecture:** One check added inside `Endpoint.authenticate`'s existing early return
(the session path), reusing resticus's `CSRFCheck`. It is skipped when another configured
authenticator (token, basic) also authenticates the request. A separate small sjvair.com PR
makes its `RequestFactory` tests opt out of CSRF the way Django's test client does, and adds
`{% csrf_token %}` to the admin Data Export form.

**Tech Stack:** Python 3.14, Django 5.2 (sjvair.com's version), django-resticus 0.0.10,
pytest + pytest-django, the local podman sjvair.com stack, monitor-map 4.3.0 (@sjvair/sdk
4.7.0).

**Spec:** `docs/superpowers/specs/2026-10-21-resticus-csrf-design.md`

## Global Constraints

- **Never merge** to resticus `develop` (upstream `dmpayton/django-resticus`) or sjvair.com
  `develop`. Never tag or publish a resticus release. The user tells resticus's developer
  when to merge.
- **Show the user each PR's title and description and get a yes before opening it** (both
  are public, and the resticus one goes to someone else's repo).
- No production checks, deploys, or Heroku commands.
- No AI attribution anywhere (commits, PR text). Commit style per repo: resticus uses
  `fix(auth): …` conventional commits; sjvair.com uses `fix(scope): …` too.
- Feature branches only: resticus `fix/session-csrf` from `origin/develop`; sjvair.com
  `fix/csrf-ready` from `origin/develop`.
- resticus: `~/workspace/django-resticus`, `origin` is the user's fork
  `alexandermccormick/django-resticus` (its `develop` equals upstream's, `15c8624`). Push
  the branch to `origin`; the PR targets `dmpayton/django-resticus:develop`.
- CSRF failures must be a 403 whose message starts `CSRF Failed`
  (`exceptions.Forbidden`), the same as `SessionAuth.enforce_csrf`.
- No resticus setting to turn the check off. No version bump.
- Restore the local podman stack to resticus `develop` and sjvair.com `develop` when done.
- Every deferral goes into `data-dashboard/DEFERRED.md` in the same change, with why and a
  revisit trigger.

## Review Focus

1. **A signed-in browser posting to an API login endpoint** (`TokenAuthEndpoint`,
   `SessionAuthEndpoint`) without a CSRF token now gets 403. That's intended (it's a
   session write); pin it with a test so it's a known behavior, not a surprise.
2. **A malformed `Authorization: Token` header** (no key, or a key with spaces) alongside a
   session: `TokenAuth` raises `AuthenticationFailed`; it must count as "no valid token"
   and fall through to the CSRF check (403 CSRF), not a 401 token error.
3. **A CSRF header that doesn't match the cookie** (rotated after sign-in in another tab)
   → 403 CSRF, not 500.
4. **Session plus valid HTTP Basic credentials** → accepted without CSRF (the generic
   "another authenticator" rule), and the session user is still returned.
5. **HTTPS origin checks in production** aren't testable locally (the stack is HTTP).
   Django's `Origin` check uses the same middleware logic that already protects
   sjvair.com's website forms in production, so it behaves the same as those; note this in
   the resticus PR rather than testing it.

Tests for 1–4 are in Task 1.

---

### Task 1: resticus — CSRF check on the session early return

**Files:**

- Modify: `~/workspace/django-resticus/resticus/auth.py:31-64` (`CSRFCheck`,
  `SessionAuth.enforce_csrf`)
- Modify: `~/workspace/django-resticus/resticus/views.py:82-89` (`Endpoint.authenticate`)
- Modify: `~/workspace/django-resticus/tests/testapp/views.py`,
  `tests/testapp/urls.py` (a probe endpoint)
- Create: `~/workspace/django-resticus/tests/test_csrf.py`

**Interfaces:**

- Produces: `resticus.auth.enforce_csrf(request) -> None` (raises
  `exceptions.Forbidden("CSRF Failed: <reason>")`); `SessionAuth.enforce_csrf(self, request)`
  delegates to it. `Endpoint.authenticate` behavior as in the spec's "The change".
- Produces (tests only): `tests.testapp.views.CsrfProbe` at URL name `csrf_probe`
  (`csrf-probe/`), `authentication_classes = (TokenAuth, BasicHttpAuth)`, with `get`,
  `post`, `put`, `patch`, `delete` each returning
  `{"username": request.user.username if request.user.is_authenticated else None}`.

- [ ] **Step 1: Set up the branch and a test environment**

```bash
cd ~/workspace/django-resticus
git fetch origin && git switch -c fix/session-csrf origin/develop
python3 -m venv ~/.cache/resticus-venv
~/.cache/resticus-venv/bin/pip install -e '.[dev]' 'Django~=5.2.0'
~/.cache/resticus-venv/bin/pytest -q
```

Expected: the existing suite passes (record the count). If it doesn't pass on a clean
`develop`, stop and tell the user before going further.

- [ ] **Step 2: Add the `CsrfProbe` test endpoint and write the failing tests**

`tests/test_csrf.py`, a `TestCase` using `ApiClient(enforce_csrf_checks=True)` (`ApiClient`
subclasses Django's `Client`, so the keyword passes through). Fixtures: a user `foo`/`bar`
with a `resticus.Token`. CSRF value: a fixed 32-character alphanumeric secret
(`CSRF = "a" * 32`), set as `client.cookies["csrftoken"]` and sent as
`extra={"HTTP_X_CSRFTOKEN": CSRF}`. `ApiClient` has no `patch` wrapper; call
`Client.patch(reverse("csrf_probe"), …)` directly for PATCH. Signed in = `client.login(username="foo", password="bar")`.

| Test                                              | Request                                                                    | Expect                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| `test_session_post_without_csrf_rejected`         | signed in, POST `csrf_probe`, no cookie/header                             | 403, `"CSRF Failed"` in body                  |
| `test_session_put_patch_delete_without_csrf_rejected` | signed in, PUT / PATCH / DELETE `csrf_probe`, no CSRF                  | 403 each                                      |
| `test_session_post_with_csrf_accepted`            | signed in, POST with cookie + matching header                              | 200, `json["data"]["username"] == "foo"`      |
| `test_session_post_with_mismatched_csrf_rejected` | signed in, cookie `"a"*32`, header `"b"*32`                                | 403 CSRF                                      |
| `test_token_only_post_accepted`                   | not signed in, `HTTP_AUTHORIZATION="Token <key>"`, no CSRF                 | 200, username `foo`                           |
| `test_session_get_unaffected`                     | signed in, GET, no CSRF                                                    | 200, username `foo`                           |
| `test_session_and_valid_token_skips_csrf`         | signed in as `foo`, token of a second user `baz`, POST, no CSRF            | 200, username `foo` (session user kept)       |
| `test_session_and_invalid_token_checks_csrf`      | signed in, `Token not-a-key`, POST, no CSRF                                | 403 CSRF (not 401)                            |
| `test_session_and_malformed_token_checks_csrf`    | signed in, `HTTP_AUTHORIZATION="Token"` (no key), POST, no CSRF            | 403 CSRF (not 401)                            |
| `test_session_and_valid_basic_skips_csrf`         | signed in as `foo`, Basic credentials for `baz`, POST, no CSRF             | 200, username `foo`                           |
| `test_anonymous_post_unaffected`                  | not signed in, POST `echo_view`, no CSRF                                   | 200                                           |
| `test_session_post_to_token_login_needs_csrf`     | signed in, POST `token_auth` with valid credentials, no CSRF               | 403 CSRF                                      |

`echo_view` uses the default settings (no authenticators, `LOGIN_REQUIRED: False`), so the
anonymous case exercises an endpoint that allows anonymous writes.

- [ ] **Step 3: Run the new tests and confirm the right ones fail**

Run: `~/.cache/resticus-venv/bin/pytest tests/test_csrf.py -v`
Expected: the "rejected" / "checks_csrf" / "needs_csrf" tests FAIL (200 instead of 403);
the "accepted" / "unaffected" / "skips_csrf" tests PASS.

- [ ] **Step 4: Implement**

- `resticus/auth.py`: module-level `enforce_csrf(request)`, holding today's
  `SessionAuth.enforce_csrf` body; `SessionAuth.enforce_csrf` calls it. Add it to
  `__all__`.
- `resticus/views.py`, inside `if request.user.is_authenticated:` and before
  `return request.user`: if no authenticator from `self.get_authenticators()` other than a
  `SessionAuth` instance returns an authenticated user (an `AuthenticationFailed` from one
  counts as "no"), call `enforce_csrf(request)`. Put the "does another authenticator
  succeed" loop in a small method, `_authenticated_without_session(self, request) -> bool`.
  Don't set `request.authenticator` on this path.

- [ ] **Step 5: Run the whole suite**

Run: `~/.cache/resticus-venv/bin/pytest -q`
Expected: all new tests pass and the existing count from Step 1 still passes.

- [ ] **Step 6: Commit**

```bash
git add resticus/auth.py resticus/views.py tests/
git commit -m "fix(auth): Enforce CSRF on session-authenticated unsafe requests"
```

Don't push yet (Task 4).

---

### Task 2: sjvair.com — ready for the CSRF check

**Files:**

- Modify: `~/workspace/sjvair/sjvair.com/camp/utils/test/__init__.py` (a factory)
- Modify: the test files whose `RequestFactory` makes unsafe requests. Expected from a
  2026-10-21 scan (confirm in Step 2): `camp/api/tests.py`,
  `camp/api/v1/accounts/tests.py`, `camp/api/v1/alerts/tests.py`,
  `camp/api/v1/monitors/tests.py`, `camp/api/v2/accounts/tests.py`,
  `camp/api/v2/alerts/tests.py`, `camp/api/v2/monitors/tests/test_endpoints.py`,
  `camp/api/v2/monitors/tests/test_export_endpoint.py`
- Modify: `camp/templates/admin/monitors/monitor/change_form.html:141`

**Interfaces:**

- Consumes: Task 1's branch at `~/workspace/django-resticus` (via `PYTHONPATH`, below).
- Produces: `camp.utils.test.CsrfExemptRequestFactory`, a `RequestFactory` subclass whose
  `request(**request)` returns the request with `_dont_enforce_csrf_checks = True` (the
  same flag Django's test client sets).

The test command (from the `sjvair-com-develop-branch` memory), with the resticus branch
put ahead of the installed package by `PYTHONPATH`. Call it `$TEST` below:

```bash
podman run --rm --network sjvaircom_sjvair-net --env-file .env.test \
  -e BAM_MIRROR_ENABLED=0 -e TWILIO_AUTH_TOKEN=test-token \
  -v ~/workspace/sjvair/sjvair.com:/app -w /app \
  -v ~/workspace/django-resticus:/resticus:ro -e PYTHONPATH=/resticus \
  sjvair-com-test:latest pytest -q
```

Drop the two `/resticus` lines to run against the image's resticus `develop`.

- [ ] **Step 1: Branch**

`cd ~/workspace/sjvair/sjvair.com && git status` must be clean on `develop` (the running
stack mounts this checkout; if it isn't clean, stop and ask). Then
`git fetch origin && git switch -c fix/csrf-ready origin/develop`.

- [ ] **Step 2: Show the failures (the "failing test")**

Run `$TEST` with the resticus branch. Expected: failures with 403 `CSRF Failed` in the
files listed above, and nothing else. Record the failing count and file list; if any
failure is not a CSRF 403, stop and report it.

- [ ] **Step 3: Add `CsrfExemptRequestFactory` and use it** in each failing file's
  `setUp` in place of `RequestFactory()`. Add `{% csrf_token %}` as the first line inside
  the admin Data Export `<form>`.

- [ ] **Step 4: Run both ways**

`$TEST` with the resticus branch → all pass. `$TEST` without it (resticus `develop`) → all
pass. Both counts match plain `develop`'s total.

- [ ] **Step 5: Commit**

```bash
git add camp/utils/test/__init__.py camp/api camp/templates/admin/monitors/monitor/change_form.html
git commit -m "fix(api): Prepare tests and admin export form for resticus CSRF checks"
```

Leave this branch checked out for Task 3.

---

### Task 3: End-to-end check on local sjvair.com

No commits. Record results (with network-panel screenshots or copied request/response
lines) for the PR descriptions. Do the browser steps with the user, or with Claude in
Chrome; the user signs in themselves.

- [ ] **Step 1: Install the resticus branch into the running web container**

```bash
podman exec sjvaircom_web_1 cp -a /usr/local/lib/python3.14/site-packages/resticus /tmp/resticus.develop-backup
podman cp ~/workspace/django-resticus/resticus/. sjvaircom_web_1:/usr/local/lib/python3.14/site-packages/resticus/
podman restart sjvaircom_web_1
```

Expected: `podman exec sjvaircom_web_1 grep -c "def enforce_csrf" /usr/local/lib/python3.14/site-packages/resticus/auth.py`
prints `1`, and the site loads.

- [ ] **Step 2: Same-origin monitor-map build**

From `~/workspace/sjvair/sjvair.com`: `bash scripts/import-monitor-map.sh local` (clones
and builds monitor-map `main`, 4.3.0, into `dist/monitor-map`). Expected: it finishes
without errors; Step 3 proves the build sends `X-CSRFToken`. Don't use the Vite dev server (cross-origin, so cookie calls 401).

- [ ] **Step 3: Subscribe and unsubscribe, signed in**

Signed in through `/account/login/`, on the local map page: open a monitor, subscribe, then
unsubscribe. Expected for each write: request has `X-CSRFToken`, response 200; after a page
reload the subscription state matches. **If there's no `csrftoken` cookie (so no header)
and the write gets 403, stop:** that triggers `DEFERRED.md` → "sjvair.com:
`ensure_csrf_cookie` on the map page" (its own sjvair.com plan first).

- [ ] **Step 4: Negative check**

In the same signed-in tab's console, `fetch` the subscribe URL (resolve with
`podman exec sjvaircom_web_1 python manage.py shell -c "from django.urls import reverse; print(reverse('api:v2:monitors:alerts:subscribe', kwargs={'monitor_id': '<id>'}))"`)
with `method: "POST"`, the same body, `credentials: "same-origin"`, and no `X-CSRFToken`.
Expected: 403 with `CSRF Failed` in the body.

- [ ] **Step 5: Token path**

Get the signed-in user's token key (`manage.py shell`, the user's `api_token`), then
`curl -X POST -H "Authorization: Token <key>" -d level=unhealthy <subscribe URL>` with no
cookie. Expected: 200. Unsubscribe the same way afterwards.

- [ ] **Step 6: Reads and admin export**

Map and monitor details load signed in and signed out. Signed in as staff, open a monitor's
admin page, Data Export, pick a short date range → the export succeeds (no 403).

- [ ] **Step 7: Put the stack back**

```bash
podman exec sjvaircom_web_1 sh -c 'rm -rf /usr/local/lib/python3.14/site-packages/resticus && mv /tmp/resticus.develop-backup /usr/local/lib/python3.14/site-packages/resticus'
podman restart sjvaircom_web_1
cd ~/workspace/sjvair/sjvair.com && git switch develop
```

Expected: the `grep -c "def enforce_csrf"` from Step 1 prints `0`; the site loads; the
sjvair.com checkout is on `develop`. (`dist/monitor-map` is git-ignored build output; the
4.3.0 build can stay.)

---

### Task 4: PRs and docs

**Files (data-dashboard, on `foundations`):** `TODO.md`, `ARCHITECTURE.md` ("CSRF
protection"), `DEFERRED.md`, this plan's checkboxes. Memory:
`~/.claude/projects/-home-alex-workspace-sjvair-data-dashboard/memory/data-dashboard-status.md`.

- [ ] **Step 1: Draft both PR descriptions and show them to the user**

- resticus (`fix/session-csrf` → `dmpayton/django-resticus:develop`): the gap
  (`csrf_exempt` dispatch + session early return), the fix and the "another authenticator
  skips it" rule, the test table, the HTTPS-origin note (Review Focus 5), and the sjvair.com
  verification results from Task 3. States that sjvair.com's own preparation PR should
  reach production first. No merge request wording; no attribution.
- sjvair.com (`fix/csrf-ready` → `develop`): the test factory, the admin form, both test
  runs from Task 2, the link to the resticus PR.

Wait for the user's yes on both texts.

- [ ] **Step 2: Push and open the PRs**

```bash
cd ~/workspace/django-resticus && git push -u origin fix/session-csrf
gh pr create -R dmpayton/django-resticus --base develop --head alexandermccormick:fix/session-csrf --title "…" --body-file …
cd ~/workspace/sjvair/sjvair.com && git push -u origin fix/csrf-ready
gh pr create --base develop --title "…" --body-file …
```

Expected: two PR URLs. Merge neither.

- [ ] **Step 3: Update data-dashboard docs**

- `TODO.md` → "Start here": both PRs open and verified; resticus waits on the user
  telling its developer; the merge-order note (monitor-map 4.3.0 and the sjvair.com PR live
  in production before the resticus merge); next is spec 2.
- `ARCHITECTURE.md` → "CSRF protection": PR links; the "another authenticator succeeds →
  skip" rule; the admin Data Export form as the second cookie-based write; the merge-order
  note.
- `DEFERRED.md` → "sjvair.com: `ensure_csrf_cookie` on the map page": add "Checked
  2026-10-21: the cookie was present; still deferred" (or the opposite outcome). Add any new
  deferrals.
- Update the `data-dashboard-status` memory to match.

Run `npm run format` then `npm run lint` in data-dashboard. Expected: clean.

- [ ] **Step 4: Commit (data-dashboard)**

```bash
git add TODO.md ARCHITECTURE.md DEFERRED.md docs/superpowers/plans/2026-10-21-resticus-csrf.md
git commit -m "Record the resticus CSRF fix PRs"
```
