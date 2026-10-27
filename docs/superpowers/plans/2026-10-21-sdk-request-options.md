# sdk-js Request Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sdk-js 4.7.0: per-call `signal`/`init` on every fetching function, `setRequestDefaults`, a
built-in same-origin `X-CSRFToken` header, optional `apiToken` on account calls, and the
`AirAlert.level` doc fix, with nothing breaking.

**Architecture:** Every request already goes through the single `fetch` in
`lib/http/requests.ts` `httpRequest`. All merging (CSRF → defaults → the function's own `init`
→ the caller's options) happens there, through a pure helper in a new `lib/http/defaults.ts`.
Each public function gains a trailing `options?: RequestOptions` and forwards it in the
`APIRequestConfig` it builds; multi-page helpers already spread that config into every page.

**Tech Stack:** Deno 2, TypeScript, `@std/assert`, JSR (`@sjvair/sdk`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-sdk-request-options-design.md` (data-dashboard repo;
approved 2026-10-21).

**Repos:** Tasks 1–5 are in `~/workspace/sjvair/sdk-js`. Task 6 is in
`~/workspace/sjvair/data-dashboard` (branch `foundations`).

## Global Constraints

- **Nothing breaking:** every new parameter, field, and option is optional; existing calls
  behave exactly as before, except same-origin browser writes gain `X-CSRFToken`.
- **Header order, lowest to highest:** built-in CSRF → global default headers → the
  function's own headers → the caller's `options.init.headers`. Same order for `credentials`
  and other `init` fields.
- **CSRF header** is sent only when the method is POST, PUT, PATCH, or DELETE; `document.cookie`
  exists; the cookie (default name `csrftoken`) has a value; and the request URL's origin equals
  `location.origin`. Header name default `X-CSRFToken`. Read fresh on every request.
  `csrf: false` disables it.
- **`signal` wins over `init.signal`** when both are given.
- **Aborts reject with the original `AbortError`** (`DOMException`, `name === "AbortError"`),
  never wrapped.
- **Error `cause.init`** keeps the merged `init` with the values of `Authorization` and the CSRF
  header replaced by `"[redacted]"`.
- **`Authorization: Token …`** only for a non-empty token.
- sdk-js style: `deno fmt` (2 spaces), `deno lint`, types derived from Zod where schemas exist,
  JSDoc on every export.
- **Git:** sync sdk-js's local `main` with `origin/main` (`git switch main && git pull --ff-only`)
  and branch `feature/request-options` from it. Never commit to `main`.
- **Never push a tag, create a release, or run `deno publish` (without `--dry-run`)**:
  `.github/workflows/publish.yml` publishes on any tag push. The 4.7.0 release needs the user's
  explicit approval, separately from this plan. Merging the PR also needs approval.
- **No AI attribution** in commits or PR text (the user's global rule overrides any harness
  default).

## Review Focus

1. **A browser on sjvair.com with no `csrftoken` cookie** (e.g. a page that never ran
   `ensure_csrf_cookie`): the write goes out with no `X-CSRFToken` header and no error from the
   SDK. Test in Task 2 (`csrf: cookie missing sends no header`).
2. **Deno or a worker, where `location` is undefined or throws on access** (Deno throws without
   `--location`): CSRF silently does nothing. Test in Task 2 (`csrf: no page origin sends no
   header`).
3. **A signal aborted while later pages are in flight**: the call rejects with `AbortError`,
   not a merged partial result. Test in Task 1 (`signal: abort mid-pagination rejects`).
4. **Header names in different cases** (`authorization` from defaults vs `Authorization` from the
   function): later layer wins, one header sent. Test in Task 1 (`merge: header names are case-insensitive`).
5. **An empty-string token** (monitor-map passes `""`): no `Authorization` header at all, not
   `Token `. Test in Task 4 (`auth: empty token sends no Authorization`).

---

### Task 1: Request options, defaults, and merging in the request layer

**Files:**
- Create: `lib/http/defaults.ts`
- Create: `lib/http/fetch_stub_test_utils.ts` (test-only; not in `deno.json` exports or `mod.ts`)
- Create: `lib/http/requests_test.ts`
- Modify: `lib/http/requests.ts` (`APIRequestConfig`, `httpRequest`, error `cause`)
- Modify: `lib/http/mod.ts` (re-export `defaults.ts`)
- Modify: `deno.json` (add `"./http/defaults"` export)

**Interfaces:**
- Produces (exported from `@sjvair/sdk/http`):
  - `interface RequestOptions { signal?: AbortSignal; init?: RequestInit }`
  - `interface CSRFOptions { cookieName?: string; headerName?: string }`
  - `interface RequestDefaults { headers?: HeadersInit | (() => HeadersInit); credentials?: RequestCredentials; csrf?: false | CSRFOptions }`
  - `setRequestDefaults(defaults: RequestDefaults): void` (replaces, no deep merge)
  - `getRequestDefaults(): RequestDefaults`
  - `resetRequestDefaults(): void`
  - `APIRequestConfig` gains `options?: RequestOptions` (the caller's options; `init` stays the
    function's own).
  - Internal (exported from `defaults.ts`, used by `requests.ts` and Task 2):
    `buildRequestInit(url: URL, functionInit: RequestInit | undefined, options: RequestOptions | undefined): RequestInit`
    and `redactInit(init: RequestInit): RequestInit`.
- Test util produces: `stubFetch(respond?: (url: URL, init: RequestInit, call: number) => Response | Promise<Response>): { calls: Array<{ url: URL; init: RequestInit }>; restore(): void }`.
  The default responder returns `{"data": null}` with `Content-Type: application/json`. The stub
  rejects with `new DOMException("Aborted", "AbortError")` when `init.signal?.aborted` is true,
  before or after awaiting the responder. Also export `jsonResponse(body: unknown): Response`.

- [ ] **Step 1: Sync main and branch**

Run: `cd ~/workspace/sjvair/sdk-js && git switch main && git pull --ff-only && git switch -c feature/request-options && grep '"version"' deno.json`
Expected: `"version": "4.6.0"`.

- [ ] **Step 2: Write the failing tests in `lib/http/requests_test.ts`**

Every test calls `resetRequestDefaults()` and `restore()` in a `finally`. Tests, using
`apiCall`, `paginatedApiCall`, and `fetchAllBulkPages` with `setOrigin("https://www.sjvair.com")`:

- `defaults: static headers are sent`: `setRequestDefaults({ headers: { "Accept-Language": "en" } })`; one call; assert `new Headers(calls[0].init.headers).get("accept-language") === "en"`.
- `defaults: header function runs on every request`: a counter function returning `{ "X-N": String(++n) }`; two calls; assert the values `"1"` then `"2"`.
- `defaults: credentials applied, and unset leaves fetch's default`: with `credentials: "include"` assert `init.credentials === "include"`; after reset assert `init.credentials === undefined`.
- `merge: order is defaults < function < caller`: defaults `{ "X-A": "d", "X-B": "d", "X-C": "d" }`, function `init.headers` `{ "X-B": "f", "X-C": "f" }`, caller `options.init.headers` `{ "X-C": "c" }`; assert A=`d`, B=`f`, C=`c`.
- `merge: header names are case-insensitive`: defaults `{ authorization: "Token d" }`, function `{ Authorization: "Token f" }`; assert exactly one value, `"Token f"`.
- `merge: caller init fields override function init`: function `{ method: "POST" }`, caller `{ cache: "no-store" }`; assert method `POST` and cache `no-store`.
- `signal: forwarded, and wins over init.signal`: two controllers; pass `{ signal: a.signal, init: { signal: b.signal } }`; assert `calls[0].init.signal === a.signal`.
- `signal: reaches every page of paginatedApiCall`: responder returns `{ data: [call], page: call + 1, pages: 3, count: 3, has_next_page: call < 2 }` for call 0 (later pages only need `data`); assert 3 calls, each with the same signal.
- `signal: reaches every page of fetchAllBulkPages`: same shape; same assertion.
- `signal: abort rejects with the original AbortError`: an already-aborted signal; `await assertRejects(...)`, and assert the error `instanceof DOMException` with `name === "AbortError"` and no `cause`.
- `signal: abort mid-pagination rejects`: responder aborts the controller during call 1 and returns page 2; assert the promise rejects with `name === "AbortError"`.
- `error cause: Authorization and CSRF header are redacted`: responder returns status 500 with a JSON body; function headers `{ Authorization: "Token secret" }`; assert `new Headers(err.cause.init.headers).get("authorization") === "[redacted]"`.

- [ ] **Step 3: Run to verify they fail**

Run: `deno test lib/http/requests_test.ts`
Expected: FAIL (compile errors: `setRequestDefaults`/`RequestOptions` not exported).

- [ ] **Step 4: Implement `lib/http/defaults.ts` and wire `httpRequest`**

`buildRequestInit` builds one `Headers` in order: the CSRF header (stub with a
`// Task 2` hook that adds nothing yet) → `defaults.headers` (call it if it's a function) →
`functionInit.headers` → `options.init.headers`, each applied with `Headers.set`. The result is
`{ ...(credentials ? { credentials } : {}), ...functionInit, ...options?.init, headers, signal }`
where `signal = options?.signal ?? options?.init?.signal ?? functionInit?.signal`, omitted when
undefined. `httpRequest` calls it with the URL from `getApiUrl` and puts `redactInit(init)` in
the error `cause`. `getRequestConfig` passes `options` through for both string and object
endpoints.

- [ ] **Step 5: Run to verify they pass**

Run: `deno test lib/http/requests_test.ts && deno check mod.ts && deno lint && deno fmt --check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/http deno.json
git commit -m "Add per-call request options and global request defaults"
```

### Task 2: Built-in CSRF header

**Files:**
- Create: `lib/http/environment.ts` (internal; not re-exported by `mod.ts`)
- Modify: `lib/http/defaults.ts` (fill the CSRF hook)
- Test: `lib/http/csrf_test.ts`

**Interfaces:**
- Consumes: `buildRequestInit`, `setRequestDefaults`, `resetRequestDefaults`, `stubFetch` (Task 1).
- Produces (internal): `readCookie(name: string): string | undefined` (reads `globalThis.document?.cookie`, decodes the value),
  `getPageOrigin(): string | undefined` (`globalThis.location?.origin` inside `try/catch`;
  Deno throws without `--location`), and
  `setEnvironmentForTests(env: { cookie?: string; origin?: string } | null): void`, which
  overrides both readers (null restores the real ones).

- [ ] **Step 1: Write the failing tests in `lib/http/csrf_test.ts`**

Each sets `setEnvironmentForTests({ cookie: "a=1; csrftoken=tok%3D1; b=2", origin: "https://www.sjvair.com" })`
and `setOrigin("https://www.sjvair.com")` unless stated, and restores in `finally`:

- `csrf: sent on POST, PUT, PATCH, DELETE`: loop over the four methods; header `x-csrftoken` is `"tok=1"`.
- `csrf: not sent on GET or HEAD`
- `csrf: method is matched case-insensitively`: method `"post"`; header present.
- `csrf: not sent to another origin`: `setOrigin("https://api.example.com")`; POST; header absent.
- `csrf: cookie missing sends no header`: cookie `"a=1"`; POST; header absent; call succeeds.
- `csrf: no page origin sends no header`: `setEnvironmentForTests({ cookie: "csrftoken=t" })`; POST; header absent.
- `csrf: not in a browser`: `setEnvironmentForTests(null)` under plain `deno test`; POST; header absent and no throw.
- `csrf: disabled with csrf: false`
- `csrf: custom cookie and header names`: `csrf: { cookieName: "ct", headerName: "X-Token" }`, cookie `"ct=v"`; header `x-token` is `"v"`, `x-csrftoken` absent.
- `csrf: overridden by caller and by defaults`: caller `X-CSRFToken: "mine"` wins; separately default headers `X-CSRFToken: "d"` win.
- `csrf: read fresh on every request`: change the cookie between two POSTs; values differ.
- `csrf: sent alongside a token`: function headers `{ Authorization: "Token t" }`; POST; both present.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test lib/http/csrf_test.ts`
Expected: FAIL (`environment.ts` missing).

- [ ] **Step 3: Implement**

`environment.ts` as above. The CSRF layer in `buildRequestInit` applies the Global Constraints
rule, using the merged method (`(options?.init?.method ?? functionInit?.method ?? "GET").toUpperCase()`)
and `url.origin === getPageOrigin()`. Cookie parsing splits on `;`, trims, matches `name=`
exactly, and returns `decodeURIComponent` of the value (empty → undefined). `redactInit`
redacts the configured header name.

- [ ] **Step 4: Run to verify they pass**

Run: `deno test lib/http/ && deno check mod.ts && deno lint && deno fmt --check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/http
git commit -m "Send X-CSRFToken on same-origin browser writes"
```

### Task 3: Thread `options` through every data function

**Files (modify):** all fetching functions in `lib/monitors/`, `lib/regions/`, `lib/hms/fire/`,
`lib/hms/smoke/`, `lib/collocation_sites/`, `lib/pesticides/`.
- Test: `lib/request_options_forwarding_test.ts`

**Interfaces:**
- Consumes: `RequestOptions`, `APIRequestConfig.options` (Task 1); `stubFetch` (Task 1).
- Produces: each function below gains a final `options?: RequestOptions` parameter, forwarded
  as `options` in the `APIRequestConfig` it builds (string endpoints become `{ url, options }`),
  and to any SDK function it calls internally (`getClosestMonitor` → `getClosestMonitors`,
  `lookupRegionPlace` → `searchRegionPlaces`). Exceptions to the name: `getMonitors(entryType, options?: MonitorsAtOptions, requestOptions?: RequestOptions)`; `listMonitorArchivesPage(monitorId, page = 1, options?)`.
- Fetching functions (59): `getCollocationSites`; `getHMSFire`, `getHMSFireById`, `getHMSSmoke`,
  `getHMSSmokeById`; `getClosestMonitors`, `getClosestMonitor`, `listMonitorArchivesPage`,
  `listAllMonitorArchives`, `getMonitorArchive`, `getMonitorDetails`, `getMonitorEntries`,
  `getMonitorEntriesExportJSON`, `getMonitorSummaries{Hourly,Daily,Monthly,Quarterly,Seasonal,Yearly}`,
  `getMonitorSummariesBulk{Hourly,Daily,Monthly,Quarterly,Seasonal,Yearly}`, `getMonitors`,
  `getMonitorsList`, `getMonitorsMeta`; `getChemicalDetails`, `getChemicalsList`,
  `getCommoditiesList`, `getCommodityDetails`, `getPesticideNoticeDetails`,
  `getPesticideNoticeList`, `getPesticideUseDetails`, `getPesticideUseList`,
  `getProductDetails`, `getProductsList`, `getRegionPesticideNotices`,
  `getRegionPesticideSummary`, `getRegionPesticideUse`; `getRegionDetails`,
  `searchRegionPlaces`, `lookupRegionPlace`, `getRegionSummaries{Hourly,…,Yearly}`,
  `getRegionSummariesBulk{Hourly,…,Yearly}`, `getRegionsList`, `getRegionsMeta`.
- Not changed (they don't fetch): `getMonitorEntriesCSVUrl`, `getMonitorEntriesExportCSVUrl`,
  `isValidClosestMonitor`, `merge*BulkPages`, `toSearchParams`.

- [ ] **Step 1: Write the failing test**

`lib/request_options_forwarding_test.ts`: a table of `[name, (options: RequestOptions) => Promise<unknown>]`
covering every function in the list above, with minimal valid arguments (e.g. `getMonitorEntries({ monitorId: "m", entryType: "pm25" }, o)`,
`getMonitorArchive({ url: "/api/2.0/x/", … } as MonitorEntriesArchive, o)`). One `Deno.test`
per row, named `forwards signal: <name>`: with `stubFetch()` and an already-aborted signal,
assert the call rejects with `name === "AbortError"` and `calls.length >= 1`. A function that
drops the signal gets the stub's normal response and fails the assertion. Add one more test,
`forwards caller init headers: getMonitorDetails`, asserting a caller header `X-Test: 1` reaches `fetch`.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test lib/request_options_forwarding_test.ts`
Expected: FAIL (type errors on the extra argument, then failed rows).

- [ ] **Step 3: Add the parameter to each function, with JSDoc** (`@param options Optional per-request options: an AbortSignal and extra fetch init.`).

- [ ] **Step 4: Run to verify it passes**

Run: `deno test lib/request_options_forwarding_test.ts lib/http/ && deno check mod.ts && deno lint && deno fmt --check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "Accept request options on every data function"
```

### Task 4: Account functions — options and optional `apiToken`

**Files:**
- Create: `lib/account/auth_headers.ts`
- Modify: every file in `lib/account/` with a fetching function (14 functions)
- Modify: `lib/account/subscriptions.ts` (replace `getSubscriptionHeaders` with the shared helper)
- Test: `lib/account/request_options_test.ts`

**Interfaces:**
- Consumes: `RequestOptions` (Task 1), `stubFetch` (Task 1).
- Produces:
  - `authHeaders(apiToken?: string, headers?: HeadersInit): Headers`: returns `headers` plus
    `Authorization: Token <apiToken>` only for a non-empty string. Each function passes its
    existing non-auth headers as `headers`, unchanged.
  - New signatures (each also gains a final `options?: RequestOptions`):
    `getAirAlerts(apiToken?, options?)`, `getUserDetails(token?, options?)`,
    `deleteUser(password, apiToken?, options?)`, `sendPhoneVerification(apiToken?, options?)`,
    `verifyPhone(code, apiToken?, options?)`, `getSubscriptions(apiToken?, options?)`,
    `subscribe(config, options?)`, `unsubscribe(config, options?)`, `updateUser(form, options?)`,
    `changePassword(config, options?)`, `login(identifier, password, options?)`,
    `createUser(form, options?)`, `passwordResetRequest(phone, options?)`, `resetPassword(config, options?)`.
  - `MonitorSubscriptionConfig.apiToken?: string`; `api_token` optional in `UpdateUserForm` and
    `ChangePasswordConfig` (in their Zod schema/type source, wherever each is defined).
  - JSDoc on each token parameter: "Optional. Without it, the call relies on the session
    cookie; a missing sign-in surfaces as the server's 401/403."

- [ ] **Step 1: Write the failing tests in `lib/account/request_options_test.ts`**

- `auth: token sends Authorization`: one row per token-taking function; `new Headers(init.headers).get("authorization") === "Token t"`.
- `auth: no token sends no Authorization`: same rows, token omitted; header `null`.
- `auth: empty token sends no Authorization`: same rows with `""`; header `null`.
- `auth: existing headers kept`: `subscribe` still sends `Content-Type: application/json` and `Accept: application/json`.
- `forwards signal: <name>`: one per account function, same pattern as Task 3.

- [ ] **Step 2: Run to verify they fail**

Run: `deno test lib/account/request_options_test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the helper, the signatures, and the type changes above.

- [ ] **Step 4: Run to verify they pass**

Run: `deno test lib/account/request_options_test.ts lib/account/air_alert_schema_test.ts lib/http/ lib/request_options_forwarding_test.ts && deno check mod.ts && deno lint && deno fmt --check`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/account
git commit -m "Make apiToken optional and accept request options on account calls"
```

### Task 5: Docs, the `AirAlert.level` fix, version, and the PR

**Files:**
- Modify: `lib/account/schema.ts:19-23` (the `level` JSDoc)
- Modify: `README.md`, `CLAUDE.md`, `mod.ts` (module example only if it shows a token call)
- Modify: `deno.json` (`"version": "4.7.0"`)

- [ ] **Step 1: Fix the `level` doc.** Replace the "level key … each entry type has its own level keys" text with: the alert's current level, matching the `name` of one of the level records for its `entry_type` in `monitors/meta/` (records there are keyed in uppercase), or `null` before its first update.

- [ ] **Step 2: Document the new API** in `README.md` and the "HTTP Layer" section of `CLAUDE.md`: `RequestOptions` (with a cancellation example), `setRequestDefaults` (headers as value or function, `credentials`, `csrf`), the header order, the CSRF rule from Global Constraints, and that `apiToken` is optional (session fallback).

- [ ] **Step 3: Bump `deno.json` to `4.7.0`.**

- [ ] **Step 4: Full verification**

Run: `deno fmt --check && deno lint && deno check mod.ts && deno test lib/http/ lib/request_options_forwarding_test.ts lib/account/request_options_test.ts lib/account/air_alert_schema_test.ts lib/regions/get_region_summaries_bulk_test.ts && deno publish --dry-run`
Expected: all pass; the dry run reports `@sjvair/sdk@4.7.0` with no errors. If a local
sjvair.com API is running (`podman ps`), also run `deno test --allow-net --allow-env` and
expect the existing integration tests to pass unchanged; otherwise report that they were not run.

- [ ] **Step 5: Commit, push the branch, and open a PR into `main`**

```bash
git add -A && git commit -m "Document request options and bump to 4.7.0"
git push -u origin feature/request-options
gh pr create --base main --title "Request options, request defaults, and CSRF header (4.7.0)" --body "<summary of the four changes, the header order, the CSRF rule, and that nothing breaks; no attribution>"
```

Stop here. Merging and tagging `v4.7.0` (which publishes) each need the user's explicit approval.

### Task 6: Record the outcome in data-dashboard

**Files (modify, in `~/workspace/sjvair/data-dashboard` on `foundations`):** `ARCHITECTURE.md`,
`DEFERRED.md`, `TODO.md`.

- [ ] **Step 1: `ARCHITECTURE.md` → "SDK request options"**: replace the bullets with the built
  design: final `options` argument (`{ signal, init }`), `setRequestDefaults({ headers, credentials, csrf })`,
  the header order, the CSRF rule (same-origin only, on by default), optional `apiToken`, and
  "lands in sdk-js 4.7.0 (PR link)".
- [ ] **Step 2: `ARCHITECTURE.md` → "CSRF protection"**: "The SDK sends `X-CSRFToken`"
  becomes automatic on same-origin writes; replace "Update the existing sjvair.com pages that
  call the API with the cookie" with: the only cookie-based API write is monitor-map's
  subscribe button (`window.USER` has no `api_token`), fixed by upgrading it to sdk-js 4.7.0;
  record the rollout order (sdk-js 4.7.0 → monitor-map on `main` → resticus merge); add to the
  resticus fix: skip the CSRF check when the request also carries a valid token.
- [ ] **Step 3: `DEFERRED.md`**: remove the "sdk-js: misleading `AirAlert.level` doc" item
  (done in 4.7.0).
- [ ] **Step 4: `TODO.md` "Start here"**: sdk-js request options done (PR open, release awaiting
  approval); next: the monitor-map SDK upgrade plan, then spec 2.
- [ ] **Step 5: Verify and commit**

Run: `npx prettier --check ARCHITECTURE.md DEFERRED.md TODO.md`
Expected: pass.

```bash
git add ARCHITECTURE.md DEFERRED.md TODO.md
git commit -m "Record the sdk-js request-options design and rollout order"
```
