# django-resticus CSRF fix for session-authenticated writes — design

Date: 2026-10-21. Repo changed: `~/workspace/django-resticus` (remote
`dmpayton/django-resticus`, branch `develop`, version 0.0.10). Also changed: `../sjvair.com`
(one small PR on `develop`, see "The sjvair.com PR"), which is also the test bed (the local
podman stack on `develop`).

**Who merges:** resticus's developer reviews and merges the PR. The user decides when it's
ready and tells the developer themselves. **Nothing in this work merges to resticus
`develop`, and the PR text does not ask for a merge.** sjvair.com installs
`git+https://github.com/dmpayton/django-resticus@develop` unpinned, so that merge is
effectively a production change. Any resticus release (tag, PyPI) is also out of scope and
needs the user's explicit approval at the time.

## Why

`ARCHITECTURE.md` → "CSRF protection for cookie-authenticated API writes" (decided
2026-09-28). In short:

- `Endpoint.dispatch` is `csrf_exempt` (`resticus/views.py:155`).
- `Endpoint.authenticate` returns `request.user` early when Django's session middleware has
  already signed the user in (`resticus/views.py:82-89`), so `SessionAuth.enforce_csrf`
  never runs, even for endpoints that list `SessionAuth`.
- So any site that can get a signed-in visitor's browser to send a cookie-carrying write
  can make that write. Today this is contained by `SameSite=Lax` and by most writes using
  tokens. **Release 1's cookie-based dashboard saves would be the first significant writes
  on this path**, so the fix must land before they ship.

The rollout order prerequisites are done: @sjvair/sdk 4.7.0 sends `X-CSRFToken`
automatically on same-origin browser writes, and monitor-map 4.3.0 (on its `main`, which
sjvair.com builds at deploy) uses it for the subscribe button, the only cookie-based API
write on sjvair.com today.

## Goals

1. A request that is authenticated by the **session** (the early-return path) and uses an
   unsafe method (POST/PUT/PATCH/DELETE) must pass Django's CSRF check, or it gets a 403.
2. Tests cover the four decided cases, plus the ones listed under "Tests".
3. A signed-in, end-to-end subscribe/unsubscribe check on local sjvair.com, using a
   same-origin monitor-map build, passes with the branch installed.
4. sjvair.com's test suite passes with the branch installed.
5. A PR against `dmpayton/django-resticus` `develop`, ready for the user to hand to the
   developer.
6. A small sjvair.com PR on `develop` that makes sjvair.com ready for the fix (its tests and
   the admin Data Export form), safe to merge before the resticus fix.

## Non-goals

- **CORS tightening on sjvair.com.** It stays in `DEFERRED.md` → "Tighten sjvair.com CORS"
  (user, 2026-10-21: "Leave it out, keep it deferred").
- **Pinning resticus in sjvair.com.** Still deferred to the user's conversation with the
  developer.
- No setting to turn the check off. It's always on for session writes, as decided.
- No changes to `SessionAuth`, `TokenAuth`, `BasicHttpAuth`, the `csrf_exempt` on
  `dispatch`, or the login endpoints.
- No production checks or deploys (the user: "We won't deal with the production server").
- No sjvair.com changes beyond "The sjvair.com PR" (and the missing-cookie case below).

## Anti-goals (a failure even if it technically works)

- Anything changes for token-only clients (the mobile app, scripts), for GETs, or for
  anonymous requests.
- A request carrying a valid token (with or without a session cookie) is rejected.
- Which user a request is authenticated as changes. The early return keeps returning the
  session user.
- sjvair.com tests break, or the subscribe button stops working.
- A merge to resticus `develop` happens without the user's word to the developer.

## The change

In `Endpoint.authenticate`, inside the existing early return (`if
request.user.is_authenticated:`), before returning the user:

- **If the request also authenticates through a non-session authenticator, skip the
  check.** Run the view's configured authenticators (`self.get_authenticators()`), except
  `SessionAuth`. If one returns an authenticated user, the request carries credentials a
  cross-site page can't attach (an `Authorization` header), so it isn't a CSRF risk. An
  authenticator that raises `AuthenticationFailed` (a bad or unknown token) counts as "no
  valid token": the check runs, and the request is not rejected for the bad token itself
  (that matches today, where the session wins). The session user is still the one
  returned. _(Claude's call: generic over configured authenticators rather than
  hardcoding `TokenAuth`, so `BasicHttpAuth` users are covered the same way. sjvair.com
  configures only `TokenAuth`.)_
- **Otherwise, run the existing CSRF check**: the same logic as
  `SessionAuth.enforce_csrf` (the `CSRFCheck` subclass of `CsrfViewMiddleware`), raising
  `exceptions.Forbidden("CSRF Failed: …")`. Reuse it; don't write a second check.
  `CsrfViewMiddleware.process_view` already skips safe methods (GET/HEAD/OPTIONS/TRACE),
  honors `request._dont_enforce_csrf_checks` (Django's test client), and does Django's
  `Origin`/`Referer` checks. _(Claude's call: how to share the code, e.g. a module-level
  `enforce_csrf(request)` that `SessionAuth.enforce_csrf` also calls, is the builder's.)_
- Only touch the early-return path. `request.authenticator` stays `None` there, as today.

Expected effect on sjvair.com: session writes without `X-CSRFToken` get a 403 with a
"CSRF Failed" message. The subscribe button (monitor-map 4.3.0) sends the header and keeps
working. Website forms are unaffected, **except the admin Data Export form**, which posts
straight to a resticus endpoint (see "The sjvair.com PR"). The builder check (2026-10-21)
found no other cookie-based API writes on sjvair.com: `CreateEntry` and the PurpleAir /
AirGradient ingestion endpoints are anonymous, and the site's own JavaScript only sends GETs.

## Tests (in resticus)

Use a client with CSRF enforcement on (`enforce_csrf_checks=True`) for the cases that need
it; resticus's `tests/client.py` `ApiClient` may need to accept that option. Write the
tests first and watch them fail on `develop`.

1. Session, unsafe method, no CSRF token → 403, message starts "CSRF Failed".
2. Session, unsafe method, valid `X-CSRFToken` matching the `csrftoken` cookie → accepted.
3. Token only, unsafe method → accepted.
4. Session, GET, no CSRF token → accepted (unaffected).
5. Session **and** a valid token, unsafe method, no CSRF token → accepted, and the
   response shows the session user.
6. Session and an **invalid** token, unsafe method, no CSRF token → 403 (CSRF), not a
   token error.
7. Anonymous, unsafe method, on an endpoint that allows anonymous → unaffected.

All existing resticus tests still pass. Use the repo's own test setup (`pyproject.toml`,
`tests/settings.py`).

## The sjvair.com PR

Found by the builder check and confirmed (2026-10-21); the user approved one small
sjvair.com PR for it ("sure"). Branch from `origin/develop`, PR into `develop`.

1. **Tests that build requests with `RequestFactory`** and set `request.user` directly
   (about 50 unsafe-method cases in `camp/api/v1/accounts/tests.py`,
   `camp/api/v2/accounts/tests.py`, `camp/api/v1/alerts/tests.py`,
   `camp/api/v2/alerts/tests.py`, `camp/api/v2/monitors/tests/test_export_endpoint.py`) look
   to resticus like a signed-in browser posting without a token, so they'd get 403 after
   the fix. `RequestFactory`, unlike Django's test `Client`, never sets
   `request._dont_enforce_csrf_checks`. Fix the tests so they opt out of CSRF the way
   Django's test client does (e.g. a shared factory/helper in `camp/utils/test.py` that sets
   `_dont_enforce_csrf_checks = True`, or switching those tests to `Client` with
   `force_login`; builder's choice). Don't loosen resticus to make them pass.
2. **Admin Data Export form** (`camp/templates/admin/monitors/monitor/change_form.html:141`)
   gets `{% csrf_token %}`. It sits outside the admin's main form, so it's a standalone POST
   to `api:v2:monitors:entry-export` and would get 403 after the fix.

Both changes are harmless without the resticus fix, so this PR can merge first. Its tests
must pass both on `develop` as is and with the resticus branch installed. Merging into
sjvair.com `develop` follows the usual sjvair.com flow (the user's call, not part of the
plan's steps).

## Verification on local sjvair.com

On the local podman stack (sjvair.com on `develop`):

1. **Install the branch into the running stack** temporarily (only `sjvaircom_web_1`
   serves the API), and restart it. Record exactly how, so it can be undone.
2. **Run sjvair.com's test suite** with the sjvair.com PR's branch checked out and the
   resticus branch installed (the test-image command in the project memory
   `sjvair-com-develop-branch`). All tests must pass. Also confirm the suite on plain
   `develop` with the resticus branch fails as expected (proves the tests exercise the
   check), and that the sjvair.com branch passes with resticus `develop`.
3. **Same-origin monitor-map build:** build monitor-map `main` (4.3.0) and copy it into
   `sjvair.com/dist/monitor-map` (the `local` mode of `scripts/import-monitor-map.sh`, or
   the same steps by hand). The Vite dev server is cross-origin and won't work for this.
4. **Signed in, in a browser,** on the local map page: pick a monitor, subscribe, then
   unsubscribe. Confirm in the network panel that each write sends `X-CSRFToken` and
   succeeds, and that the subscription list reflects it after a reload.
5. **Negative check:** the same subscribe request without the header (e.g. `fetch` from the
   console with `X-CSRFToken` omitted, or `curl` with the session cookie) → 403
   "CSRF Failed".
6. **Token path:** a subscribe with only `Authorization: Token …` and no cookie → succeeds.
7. **GETs** (map loads, monitor details) work signed in and signed out.
7a. **Admin Data Export:** signed in as staff, with the sjvair.com branch checked out, export
   a monitor's data from its admin page → the file downloads. (Optionally confirm that
   without `{% csrf_token %}` it gets 403.)
8. **Put the stack back** on resticus `develop` and restart it, and confirm it's back.

Steps 4–7 should be done with the user watching, or with screenshots/network logs
recorded in the PR or the plan's notes.

### When the cookie is missing

If step 4 fails because there's no `csrftoken` cookie (the SDK only sends the header when
the cookie exists), stop. That revives `DEFERRED.md` → "sjvair.com: `ensure_csrf_cookie` on
the map page", which needs its own approved sjvair.com plan, and the resticus PR waits for
it. If the cookie is present, mark that entry as checked (it stays deferred; its trigger
didn't fire).

## The PR

- Branch from resticus `develop` (e.g. `fix/session-csrf`); commit style follows the repo's
  log (`fix(auth): …`). No AI attribution (user's global rule).
- PR against `dmpayton/django-resticus` `develop`. Description: the gap, the fix, the test
  list, and the sjvair.com verification results. No version bump unless the developer asks.
- **The plan ends with both PRs open and verified.** The user tells the developer when to
  merge.

**Merge-order note for the user (not a plan step):** the resticus fix reaches production at
sjvair.com's next deploy after it merges. Before telling the developer to merge, the live
site should already have (a) monitor-map 4.3.0 (built from monitor-map `main` at deploy)
and (b) the admin form fix (sjvair.com `develop` → `main` → deploy). Otherwise the
subscribe button or admin export breaks in production until they land. Production itself
stays out of scope for this work.

## Docs (data-dashboard, same change as the PR)

- `TODO.md` → "Start here": the resticus PR is open and verified, waiting on the
  developer; next is spec 2.
- `ARCHITECTURE.md` → "CSRF protection": the PR links, the "skip when another
  authenticator succeeds" detail, the admin export form as a second cookie-based write,
  and the merge-order note.
- `DEFERRED.md`: the `ensure_csrf_cookie` entry updated with the check's result. Anything
  newly deferred while building goes in too, with why and a revisit trigger.
- The project memory `data-dashboard-status` updated to match.

## Left to the builder

- How to share the CSRF check code between `SessionAuth` and `Endpoint`.
- How to install the branch into the podman stack (and undo it).
- How the sjvair.com tests opt out of CSRF (shared helper vs. `Client` + `force_login`).
- Test names and fixtures, and whether `ApiClient` needs a CSRF option.
