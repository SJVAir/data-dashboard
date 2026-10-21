# sdk-js request options — design

Date: 2026-10-21. Repo changed: `../sdk-js` (`@sjvair/sdk`, Deno, published to JSR). Target
release: **4.7.0** (minor; nothing breaks). Publishing it needs the user's explicit approval,
separately from approving this design or its plan.

## Why

Foundations spec 2 (the dashboard's data layer) needs three things the SDK can't do today:

- **Cancel requests.** The data layer is "last requested wins": a newer request for a widget
  supersedes the older one, which needs an `AbortSignal` passed through to `fetch`.
- **Set request options in one place.** Headers (a future `Accept-Language`) and
  `credentials`, set once by the app instead of per call.
- **CSRF for session-cookie writes.** The dashboard is served from sjvair.com and signs in with
  the Django session cookie (`ARCHITECTURE.md` → "Authentication", "Sign-in flow"). The planned
  django-resticus fix will run Django's CSRF check on session-authenticated
  POST/PUT/PATCH/DELETE API requests, which then need an `X-CSRFToken` header matching the
  `csrftoken` cookie.

Two other pending sdk-js items ride along in the same release: making `apiToken` optional on
the account calls (so a session works everywhere; `ARCHITECTURE.md` → "Sign-in flow") and the
`AirAlert.level` doc fix (`DEFERRED.md`).

## What the server does today (verified 2026-10-21)

- resticus `develop`: `Endpoint.dispatch` is `csrf_exempt`, and `Endpoint.authenticate`
  returns a session user early, before any authenticator runs, so `SessionAuth.enforce_csrf`
  never runs. sjvair.com configures `TokenAuth` only. The browser sends the `csrftoken` and
  session cookies automatically, but nothing checks them on the API.
- **The one cookie-based API write in production is monitor-map's subscribe button.** On
  sjvair.com, `MonitorDetailPanel` shows `MonitorSubscriptionManager` when
  `window.USER.is_authenticated`; it reads `window.USER.api_token`, which the home template
  (`camp/templates/pages/index.html`) never sets, so it passes `""`, the SDK omits
  `Authorization`, and the POST rides on the session cookie. After the resticus fix it 403s
  unless the SDK sends `X-CSRFToken`.
- Unaffected: the mobile app (token-only; `account/login` never creates a session; requests
  are cross-origin from the Capacitor app); sjvair.com's own account pages, which are ordinary
  Django forms with `{% csrf_token %}`; the read-only subscriptions and alerts lists; the
  site's other scripts (GET only); the Twilio callbacks (already `csrf_exempt`, no session).

## Goals

1. **Per-call options on every public function.** An optional **last argument**
   `options?: { signal?: AbortSignal; init?: RequestInit }`, passed through to `fetch`.
2. **Global defaults:** `setRequestDefaults({ headers, credentials, csrf })` in the `http`
   module, set once by the app.
3. **Built-in CSRF header** on data-changing same-origin browser requests.
4. **`apiToken` optional** on every account call that requires it today.
5. **`AirAlert.level` doc fix.**

## Non-goals

- Response validation (still deferred; `DEFERRED.md` → "sdk-js: no runtime validation").
- Subscription level enum completion (deferred to Release 2 alert-rule SDK work).
- Retries, timeouts, caching, or request deduplication. Those belong to the dashboard's
  data layer.
- Changes to monitor-map, resticus, sjvair.com, or data-dashboard. Each has its own plan
  (see "Rollout order").

## Anti-goals

- **Anything breaking.** Every addition is optional. Existing calls by monitor-map
  (`^4.x` via sjvair.com and mobile), mobile, and sjvair.com behave exactly as before, apart
  from gaining the CSRF header on same-origin browser writes.
- **Leaking the CSRF token** to another origin.
- **Swallowing or rewrapping cancellation.** An aborted call must reject with the standard
  `AbortError` (`DOMException`, `name === "AbortError"`), so callers can tell it apart from a
  failure.

## Design

### Per-call options

- Shape: `export interface RequestOptions { signal?: AbortSignal; init?: RequestInit }`,
  exported from `@sjvair/sdk/http`. Every public data/account function gains
  `options?: RequestOptions` as its **final parameter**. It's a separate argument, not new
  fields on existing config objects, because several functions turn their config straight
  into URL parameters (e.g. `MonitorEntryRequestOptions`) and a separate argument keeps one
  shape for every function. *(Design call: Claude.)*
- `signal` is shorthand for `init.signal`; if both are given, `signal` wins.
- `APIRequestConfig` (already has `init`) gains an optional `signal`, and each wrapper
  forwards its `options` into the config it builds.
- **Multi-page fetches** (`paginatedApiCall`, `fetchAllBulkPages`, and anything built on
  them) use the same `signal` and `init` for every page, so one abort cancels them all.
- **Cancellation passes through unchanged.** `genericAPIErrorHandler` rethrows `Error`
  instances as-is today; the builder confirms an `AbortError` reaches the caller unwrapped
  (it is a `DOMException`, which is an `Error` in Deno and browsers) and adds a test.

### Global defaults

```ts
setRequestDefaults({
	headers?: HeadersInit | (() => HeadersInit),   // a function runs on every request
	credentials?: RequestCredentials,               // unset = fetch's own default, as today
	csrf?: false | { cookieName?: string; headerName?: string }
});
```

- Calling it again replaces the defaults (no deep merge). A `getRequestDefaults()` and a way
  to reset (for tests) are left to the builder.
- **Header order (agreed with the user), lowest to highest:** built-in CSRF header → global
  default headers → the function's own headers (e.g. `Authorization`, `Content-Type`) → the
  caller's `options.init.headers`. A later source overrides the same header name from an
  earlier one (case-insensitive, via `Headers`). `credentials` and other `init` fields
  follow the same order: defaults, then the function's, then the caller's.
- All merging happens in one place in `httpRequest`, so every function gets it.

### Built-in CSRF header

- Sent when **all** hold: the method is POST, PUT, PATCH, or DELETE; `document.cookie` is
  available (a browser); a cookie named `csrftoken` (configurable; sjvair.com uses Django's
  default) has a value; and the request URL's origin equals `location.origin`. *(The
  same-origin rule is Claude's design call: a standalone build pointed at another server must
  not send that page's token there.)*
- Header name `X-CSRFToken` (configurable), read fresh on every request (the token rotates at
  sign-in).
- Sent whether or not a token is present: harmless for token requests, and simpler.
- `csrf: false` turns it off. On by default, so monitor-map is fixed by upgrading the SDK,
  with no code change.
- A caller or default that sets the same header overrides it (it's the lowest layer).

### Optional `apiToken`

- `getAirAlerts`, `getUserDetails`, `deleteUser`, `sendPhoneVerification`, `verifyPhone`:
  the token parameter becomes optional (`apiToken?: string`).
- `subscribe`/`unsubscribe` (`MonitorSubscriptionConfig.apiToken`), `updateUser` and
  `changePassword` (`api_token` in their config): the field becomes optional.
  `getSubscriptions` is already optional.
- `Authorization: Token …` is sent only for a non-empty token (the existing
  `getSubscriptionHeaders` rule, applied everywhere; a shared helper is the builder's call).
- Without a token, the call relies on the session cookie, and a missing sign-in surfaces as
  the server's 401/403. Document this on each function.

### `AirAlert.level` doc fix

The doc in `lib/account/schema.ts` calls `level` "a key into the levels" for the entry type.
`monitors/meta/` keys level records in uppercase; `level` matches each level record's
`name`. Reword it to say that. Docs only.

## Testing

- **New unit tests for the request layer that replace `fetch` with a stub** and need no
  server *(Claude's call)*. Cover: defaults (static and function headers, `credentials`), the
  header order, CSRF on/off, same-origin only, method filtering, a custom cookie/header name,
  `signal` reaching every page of `paginatedApiCall` and `fetchAllBulkPages`, abort
  rejecting with an unwrapped `AbortError`, and `Authorization` present/absent for each
  account function.
- Browser globals (`document.cookie`, `location`) are stubbed in tests; Deno has neither by
  default, which also covers the "not a browser" path.
- The existing integration tests (local API) keep passing unchanged.
- `deno check`, `deno lint`, `deno fmt --check`, and a `deno publish --dry-run` before the
  release.

## Docs updated in the same change

- sdk-js `README.md` and `CLAUDE.md`: `RequestOptions`, `setRequestDefaults`, the CSRF
  behavior, optional tokens.
- data-dashboard `ARCHITECTURE.md`:
  - "SDK request options": record this design (final argument, header order, CSRF built in,
    same-origin only).
  - "CSRF protection": the SDK sends `X-CSRFToken` automatically. "Update the sjvair.com
    pages that call the API with the cookie" becomes "monitor-map upgrades the SDK" (no site
    page does cookie-based API writes). The rollout order below. For the resticus fix: if a
    request carries a token as well as a session, skip the CSRF check, so a signed-in
    browser sending a token never gets a 403.
- data-dashboard `DEFERRED.md`: remove the `AirAlert.level` doc item (done).
- data-dashboard `TODO.md`: the follow-on monitor-map step and the rollout order.

## Rollout order (agreed with the user)

1. **sdk-js 4.7.0**: this design. Release only with explicit approval.
2. **monitor-map** upgrades to `@sjvair/sdk` 4.7.0 and reaches `main` (sjvair.com builds it
   unpinned, so merging is a production deploy). Its own plan and approval.
3. **The resticus CSRF fix** merges to `develop` (installed unpinned, so also a production
   deploy). Its own plan and approval.

The dashboard's cookie-based saves ship only after step 3. Spec 2 can start on 4.7.0 as soon
as step 1 is done.

## Settled during the builder check

- **Branch from `origin/main`** in sdk-js (4.6.0 is tagged there; the local `main` is stale at
  4.5.0).
- **Error `cause`:** on a failed request, `httpRequest` puts the `init` it sent into
  `error.cause`. Keep the merged `init` there, but replace the values of `Authorization` and
  the CSRF header with `"[redacted]"`, so error reports can't carry either. *(Claude's call.)*
- **Name clashes:** `getMonitors(entryType, options?: MonitorsAtOptions)` already has an
  `options` parameter, and `listMonitorArchivesPage(id, page = 1)` has a default before the
  new argument. The new last parameter's name there is the builder's call; the type is still
  `RequestOptions`.
- Verified: every request goes through the one `fetch` in `httpRequest`; `AbortError` passes
  `genericAPIErrorHandler` unwrapped; monitor-map calls `setOrigin(window.location.origin)` in
  production, so its writes pass the same-origin rule; sjvair.com's `csrftoken` cookie is
  readable by scripts (no `CSRF_COOKIE_HTTPONLY`, `CSRF_USE_SESSIONS`, or custom name).

## Left to the builder

- Internal structure of the merge helper and where the CSRF cookie read lives.
- `getRequestDefaults()` and a test reset helper.
- How each wrapper threads `options` through (all must; the type signature is fixed above).
- JSDoc wording, beyond each function documenting `options` and, for the account calls, the
  session fallback.
