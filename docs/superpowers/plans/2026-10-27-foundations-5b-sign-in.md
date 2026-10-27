# Foundations 5b: the sign-in side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard knows who is signed in (from the page, then re-checks), shows "Sign in" or
an account menu, signs out, and stays correct across tabs; sjvair.com stops handing the API token
to session-cookie requests; sdk-js types say so.

**Architecture:** Three repos, in this order: sjvair.com (Tasks 1–3), sdk-js (Task 4),
data-dashboard (Tasks 5–11). The dashboard validates the account response with its own zod
schema, so it does **not** need a new SDK release to build or ship 5b. The identity logic lives in
the platform adapter (`IdentitySource`); a reactive `AccountState` in the store layer adds
cross-tab messages and toasts; the shell renders it. Storage spaces stay anonymous.

**Tech Stack:** Django 5.2 + django-resticus (sjvair.com); Deno + TypeScript (sdk-js); Svelte 5
runes, Vitest (unit + browser), Playwright, zod via `$lib/zod`, Paraglide, bits-ui
DropdownMenu, svelte-sonner (data-dashboard).

**Spec:** `docs/superpowers/specs/2026-10-27-foundations-5b-sign-in-design.md` (approved
2026-10-27). Read it before any task.

## Global Constraints

- **Branches:** data-dashboard `foundations-5b-sign-in` (exists; PR into `foundations`).
  sjvair.com `feature/workspace-sign-in` from `origin/develop` (PR into `develop`). sdk-js
  `feature/session-user-details` from `origin/release/4.8.0` (PR into `release/4.8.0`).
- **Never** merge to `main`, push to resticus, create a release, publish, or bump an SDK beta
  without the user's explicit go-ahead for that specific action.
- **No AI attribution** anywhere: no `Co-Authored-By` trailers, nothing in PR bodies (user's
  global rule).
- **The API token never reaches the dashboard**, and identity data (name, email, phone, id) never
  goes into error-report messages or contexts.
- **Never put `location.hash` into `next`** (a share link's fragment holds a whole dashboard; it
  would be sent to the server). `next` is `pathname + search` only.
- Dashboard code style: tabs, double quotes, no trailing commas, width 100; Svelte 5 runes only;
  all UI text through Paraglide messages (`messages/en.json`), no concatenated sentences; theme
  tokens only; browser APIs (`document.cookie`, `document.getElementById`, `fetch` to non-API
  pages) only inside `src/lib/platform/web/`; `z` imported from `$lib/zod`, never `zod`.
- sjvair.com style: 4-space Python, `django.test.TestCase` with pytest-style `assert`.
- sdk-js style: `deno fmt`, `deno lint`, JSDoc on exports.
- Values: re-check throttle **30 000 ms**; re-check timeout **10 000 ms**; identity block id
  `sjvair-identity`, shape `{ "v": 1, "user": <session account response> | null }`.
- Tab-channel and toast rules are in the spec, "What gets built: data-dashboard" §2 and §5.

## Review Focus

1. **The re-check gets something that isn't an answer** (an HTML page from a captive portal or
   an error page with 200, a 500, a timeout). Expected: nothing changes, nobody is signed out.
   Pinned in Task 6 (`"a 200 that fails validation changes nothing"`, `"5xx and network errors
   change nothing"`).
2. **Two tabs echo identity messages back and forth.** Expected: a tab that receives an identity
   equal to its own does nothing (no toast, no rebroadcast). Pinned in Task 7 (`"an equal
   identity from another tab is ignored"`).
3. **Signing out while offline or with an expired CSRF cookie.** Expected: an error toast, still
   signed in, then a re-check. Pinned in Task 6 (`"signOut failure keeps signed in and
   re-checks"`) and Task 7 (`"failed sign-out shows the error toast"`).
4. **Names that aren't "First Last"**: empty, whitespace, one word, three words, non-Latin, emoji.
   Expected: sensible initials or the generic icon, and a greeting without a stray comma. Pinned
   in Task 5 (`names.test.ts`).
5. **Signing in from a share link** (`/workspace/import#1.…`). Expected: `next` is
   `/workspace/import` without the fragment. Pinned in Task 8 (`"sign-in link never carries the
   fragment"`).

---

## Part A — sjvair.com

Work in a worktree of `~/workspace/sjvair/sjvair.com` on `feature/workspace-sign-in` (from
`origin/develop`). Run tests with the local podman test image (project memory
`sjvair-com-develop-branch`):

```bash
podman run --rm --network sjvaircom_sjvair-net --env-file .env.test -e BAM_MIRROR_ENABLED=0 \
  -e TWILIO_AUTH_TOKEN=test-token -v <worktree>:/app -w /app sjvair-com-test:latest pytest <path> -v
```

### Task 1: Session-cookie account responses drop `api_token`; signed out is 401

**Files:**

- Create: `camp/api/v2/accounts/session.py`
- Modify: `camp/api/v2/accounts/endpoints.py` (`UserDetail`, `ChangePasswordEndpoint`)
- Modify: `camp/api/v1/accounts/endpoints.py` (`UserDetail`, `ChangePasswordEndpoint`; `/api/1.0/account/` is still routed and would leak the token otherwise)
- Test: `camp/api/v2/accounts/tests.py` (new class `SessionResponseTests`)

**Interfaces:**

- Produces:
  - `SESSION_EXCLUDE: tuple[str, ...] = ('api_token',)`
  - `is_session_request(request) -> bool`: `True` when resticus authenticated by session, i.e. `getattr(request, 'authenticator', None) is None`
  - `class SessionUserMixin`: sets `login_required = True` and overrides `serialize(self, source, fields=None, include=None, exclude=None, fixup=None)` to add `SESSION_EXCLUDE` to `exclude` when `is_session_request(self.request)`
  - `session_user_data(user) -> dict`: `UserSerializer(user, exclude=SESSION_EXCLUDE).data`, JSON-ready (the `id` a string, as the API sends it)

- [ ] **Step 1: Write the failing tests** in `SessionResponseTests(TestCase)` (`fixtures = ['users']`, `self.user = User.objects.get(email="user@sjvair.com")`), using `django.test.Client`, for both `/api/2.0/account/` and `/api/1.0/account/` (loop over the two prefixes inside each test):
  - `test_token_get_includes_api_token`: `Client().get(url, HTTP_AUTHORIZATION=f'Token {get_token(user)}')` → 200 and `data['data']['api_token'] == get_token(user)`
  - `test_session_get_omits_api_token`: `force_login` then GET → 200, `'api_token' not in data['data']`, `data['data']['phone'] == self.user.phone`
  - `test_session_patch_omits_api_token`: `force_login`, PATCH `{"full_name": "New Name"}` (JSON) → 200, no `api_token`, `full_name == "New Name"`
  - `test_session_password_change_omits_api_token`: `force_login`, PUT `password/` with `old_password='letmein'` and a strong new password → 200, no `api_token`
  - `test_session_and_token_together_is_a_session_request`: `force_login` plus the token header → 200, no `api_token`
  - `test_signed_out_is_401`: GET, PATCH, DELETE `account/` and PUT `account/password/` with no credentials → each `401`
  - `test_login_and_register_still_return_the_token`: the existing `test_valid_login`/`test_register_new_user` already assert it; keep them passing (no new test)

- [ ] **Step 2: Run them; they fail** (session GET still has `api_token`; signed-out GET is 500)

Run: `pytest camp/api/v2/accounts/tests.py -k SessionResponseTests -v`

- [ ] **Step 3: Implement `session.py`** as in Interfaces, and put `SessionUserMixin` first in the bases of `UserDetail` and `ChangePasswordEndpoint` in both v1 and v2 (v1 imports from `camp.api.v2.accounts.session`).

- [ ] **Step 4: Run the account tests, v1 and v2; all pass**

Run: `pytest camp/api/v2/accounts/tests.py camp/api/v1/accounts/tests.py -v`

- [ ] **Step 5: Commit** — `git commit -m "Drop the API token from session account responses; 401 when signed out"`

### Task 2: The identity block is the session response

**Files:**

- Modify: `camp/apps/workspace/identity.py`
- Test: `camp/apps/workspace/tests/test_page.py` (`test_identity_signed_in`, new `test_identity_staff`)

**Interfaces:**

- Consumes: `session_user_data(user)` (Task 1)
- Produces: `workspace_identity(user) -> {'v': 1, 'user': session_user_data(user) | None}`

- [ ] **Step 1: Rewrite `test_identity_signed_in`**: create the user as now (name `'Ana </script> B'`, phone verified), `force_login`, GET `/workspace/`, and assert:
  - `identity_of(response)['v'] == 1`
  - `identity_of(response)['user'] == self.client.get('/api/2.0/account/').json()['data']` (byte-for-byte the session response)
  - `'api_token' not in identity_of(response)['user']` and the token string is not in the HTML
  - the `</script>` escaping assertion stays
  - drop the "phone not in HTML" assertions (the phone is now included by decision)
- [ ] **Step 2: Add `test_identity_staff`**: a staff user's block has `is_admin: True` and still no `api_token`.
- [ ] **Step 3: Run; `test_identity_signed_in` fails** — `pytest camp/apps/workspace/tests/test_page.py -v`
- [ ] **Step 4: Implement** `workspace_identity` with `session_user_data`; update its docstring (no longer "never the phone number").
- [ ] **Step 5: Run the workspace tests; all pass**
- [ ] **Step 6: Commit** — `git commit -m "Make the workspace identity block the session account response"`

### Task 3: The site's Logout link posts; the login page keeps `next`

**Files:**

- Modify: `camp/templates/page.html` (the `account:logout` link, around line 123)
- Modify: `camp/templates/registration/login.html` (the form, around line 22)
- Test: `camp/apps/accounts/tests.py` (new class `SignInOutPageTests`)

- [ ] **Step 1: Write the failing tests:**
  - `test_logout_is_a_post_form`: signed in, GET a page that extends `page.html` (`/`) → the HTML contains a `<form` with `method="post"`, `action="/account/logout/"`, and a `csrfmiddlewaretoken` input; there is no `<a href="/account/logout/"`
  - `test_logout_post_signs_out`: signed in, POST `/account/logout/` → redirect, and a following GET of `/api/2.0/account/` is 401
  - `test_login_keeps_next`: GET `/account/login/?next=/workspace/dashboards/x` → HTML has `name="next"` with value `/workspace/dashboards/x`; POST valid credentials (the fields of `camp.apps.accounts.forms.AuthenticationForm`) plus `next=/workspace/dashboards/x` → 302 to `/workspace/dashboards/x`
  - `test_login_ignores_offsite_next`: same POST with `next=https://evil.example/` → 302 to `/`
- [ ] **Step 2: Run; they fail** — `pytest camp/apps/accounts/tests.py -k SignInOutPageTests -v`
- [ ] **Step 3: Implement:**
  - In `page.html`, replace the Logout `<a>` with a `<form method="post" action="{% url 'account:logout' %}">` holding `{% csrf_token %}` and a `<button type="submit" class="navbar-item …">` with the same icon and text. Keep its look: Bulma's button reset, or a minimal inline-flex style in the existing site CSS, builder's call.
  - In `login.html`, add `{% if next %}<input type="hidden" name="next" value="{{ next }}">{% endif %}` inside the form. Leave the "Sign up" link alone.
- [ ] **Step 4: Run the accounts and workspace tests, then the full suite** — `pytest -n 4 --dist loadscope`; expect all pass
- [ ] **Step 5: Hand check in a browser** on the local stack, serving this branch (project memory: "Testing `/workspace` locally"): sign out from the site nav works, and `/account/login/?next=/workspace/` returns to `/workspace/`.
- [ ] **Step 6: Commit, push, and open the PR into `develop`**
  - Commit: `git commit -m "Post the site's Logout link; keep next on the login page"`
  - PR body: what changed, why (link the data-dashboard spec), the test command, and the note that mobile (token auth) is unaffected. No attribution line.

## Part B — sdk-js

### Task 4: Token-free account calls return `SessionUserDetails`

Work on `feature/session-user-details` from `origin/release/4.8.0` in `~/workspace/sjvair/sdk-js`.

**Files:**

- Modify: `lib/account/types.ts`, `lib/account/details.ts`, `lib/account/update.ts`, `lib/account/change-password.ts`, `lib/account/mod.ts` (export the new type if `mod.ts` re-exports types)
- Create: `lib/account/session_types_test.ts`

**Interfaces:**

- Produces:
  - `export type SessionUserDetails = Omit<UserDetails, "api_token">`
  - `getUserDetails(token: string, options?: RequestOptions): Promise<UserDetails>`, `getUserDetails(token?: undefined, options?: RequestOptions): Promise<SessionUserDetails>`, and `getUserDetails(token?: string, options?: RequestOptions): Promise<UserDetails | SessionUserDetails>`
  - The same three-overload pattern on `updateUser(form, options?)` (keyed on `form.api_token`) and `changePassword(config, options?)` (keyed on `config.api_token`)

- [ ] **Step 1: Write `session_types_test.ts`.** Its compile-time checks fail to type-check before the change:
  - `const a: UserDetails = await getUserDetails("t")` compiles
  - `const b: SessionUserDetails = await getUserDetails()` compiles, and `// @ts-expect-error` on `b.api_token`
  - the mobile app's exact call shapes compile unchanged, with `UserDetails` results:
    - `getUserDetails(user.model.api_token)` where `api_token: string`
    - `updateUser({ ...form, api_token })`
    - `changePassword({ ...form, api_token })`
  - a `string | undefined` token compiles (the union overload)
  - wrap the awaits in a `Deno.test` that stubs fetch with `stubFetch` from `../http/fetch_stub_test_utils.ts`, so the file also runs
- [ ] **Step 2: Run; it fails to type-check** — `deno test lib/account/session_types_test.ts`
- [ ] **Step 3: Implement** the type and the overloads. Update the JSDoc: the token-free response has no `api_token`, and a signed-out call rejects with the server's 401.
- [ ] **Step 4: Run everything; all pass** — `deno test --allow-net --allow-env && deno lint && deno fmt --check`
- [ ] **Step 5: Commit, push, and open the PR into `release/4.8.0`.** Commit with `git commit -m "Type token-free account responses as SessionUserDetails"`. The PR says no release is requested. **Don't** tag or publish.

## Part C — data-dashboard

On `foundations-5b-sign-in`. Unit tests: `npm run test:unit -- <path>`; browser tests:
`npm run test:browser -- <path>`; E2E: `npm run test:e2e -- <spec>`.

### Task 5: Account types, block parsing, and name helpers

**Files:**

- Create: `src/lib/account/identity.ts`, `src/lib/account/identity.test.ts`
- Create: `src/lib/account/names.ts`, `src/lib/account/names.test.ts`

**Interfaces:**

- Produces (`identity.ts`):
  - `accountUserSchema`: a `z.object` with:
    - `id: z.string().min(1)`, `full_name: z.string()`
    - `email: z.string().nullable()`, `phone: z.string().nullable()`
    - `phone_verified: z.boolean()`, `language: z.string()`
    - default strip mode, so unknown keys such as `is_admin` are dropped
  - `type AccountUser = z.infer<typeof accountUserSchema>`
  - `type Identity = { state: "unknown" } | { state: "signed-out" } | { state: "signed-in"; user: AccountUser }`
  - `parseIdentityBlock(text: string): { identity: Identity; unreadable: boolean }`
  - `sameAccount(a: Identity, b: Identity): boolean`: same state and, when signed in, same `user.id`
  - `sameIdentity(a: Identity, b: Identity): boolean`: deep-equal (catches a name change for the same id)
- Produces (`names.ts`):
  - `displayName(fullName: string): string | null`: trimmed, `null` if empty
  - `greetingName(fullName: string): string | null`: the first whitespace-separated word
  - `initials(fullName: string): string | null`: the first code point of the first word plus the first code point of the last word (one word gives one letter), locale-uppercased, `null` if empty

- [ ] **Step 1: Write `identity.test.ts`:**
  - `{"v":1,"user":null}` → signed out, `unreadable: false`
  - a valid user → signed in, with the user equal to the input minus `is_admin`
  - a name holding `</script>` parses to `</script>`
  - `"v": 2` → signed out, `unreadable: true`
  - not JSON → signed out, `unreadable: true`
  - a user missing `id` → signed out, `unreadable: true`
  - `sameAccount` is true for the same id with different names, while `sameIdentity` is false
- [ ] **Step 2: Write `names.test.ts`:**
  - `"Maria Lopez"` → `ML`, `Maria`, `Maria Lopez`
  - `"  maria  "` → `M`, `maria`, `maria`
  - `"Ana María de la Cruz"` → `AC`
  - `"李 小龙"` → `李小`
  - `"🙂 Sam"` → `🙂S`
  - `""` and `"   "` → `null` for all three
- [ ] **Step 3: Run; both fail** (the modules don't exist)
- [ ] **Step 4: Implement both modules**
- [ ] **Step 5: Run; both pass.** Commit: `git commit -m "Add account identity parsing and name helpers"`

### Task 6: `IdentitySource` in the platform adapter (web and memory); drop the stand-in block

**Files:**

- Modify: `src/lib/platform/types.ts` (the `IdentitySource` interface)
- Create: `src/lib/platform/web/identity.ts`, `src/lib/platform/web/identity.test.ts`
- Modify: `src/lib/platform/web/storage.ts` (wire `identity: createWebIdentity(...)`)
- Modify: `src/lib/platform/memory.ts` (`createMemoryIdentity`, `MemoryPlatform.identity`)
- Modify: `index.html` (remove the `sjvair-identity` block)

**Interfaces:**

- Consumes: `Identity`, `parseIdentityBlock`, `accountUserSchema`, `sameIdentity` (Task 5)
- Produces (`types.ts`):
  ```ts
  export type IdentityCause = "load" | "recheck" | "tab" | "sign-out";
  export interface IdentitySource {
  	currentSpace(): Promise<SpaceId>; // still always "anonymous"
  	readonly authMode: "cookie";
  	current(): Identity;
  	/** Called only when the identity actually changes (`!sameIdentity`). */
  	onChange(cb: (identity: Identity, cause: IdentityCause) => void): () => void;
  	/** Reads the block (or asks the server once) and starts focus/online re-checks. Idempotent. */
  	start(): void;
  	/** Asks the server; `force` skips the 30 s throttle. One request in flight at a time. */
  	recheck(opts?: { force?: boolean }): Promise<void>;
  	/** An identity another tab learned; applies it with cause "tab", no request. */
  	accept(identity: Identity): void;
  	/** POSTs the site's logout; true on success (then signed out, cause "sign-out"). */
  	signOut(): Promise<boolean>;
  	signInUrl(returnPath: string): string; // "/account/login/?next=" + encodeURIComponent(returnPath)
  	accountUrl(): string; // "/account/"
  }
  ```
- Produces (`web/identity.ts`): `createWebIdentity(deps: { blockText(): string | null; cookie(): string; fetchUser(signal: AbortSignal): Promise<unknown>; postLogout(csrfToken: string): Promise<Response>; activity: ActivitySource; online: OnlineSource; errors: ErrorReporter; now(): number }): IdentitySource`. `storage.ts` passes:
  - `blockText: () => document.getElementById("sjvair-identity")?.textContent ?? null`
  - `cookie: () => document.cookie`
  - `fetchUser: (signal) => getUserDetails(undefined, { signal })`, from `@sjvair/sdk` (the `account/details` export)
  - `postLogout: (t) => fetch("/account/logout/", { method: "POST", credentials: "same-origin", redirect: "manual", headers: { "X-CSRFToken": t } })`
- Produces (`memory.ts`): `createMemoryIdentity(initial?: Identity): MemoryIdentity`, where `MemoryIdentity = IdentitySource & { setServer(answer: Identity | "error"): void; setSignOutResult(ok: boolean): void; requests: number }`. The default initial is `{ state: "signed-out" }`. `recheck` applies the server answer, or does nothing on `"error"`, and ignores the throttle.

- [ ] **Step 1: Write `web/identity.test.ts`.** Use fake deps, `vi.fn` for `fetchUser` and `postLogout`, the memory activity and online sources, and a settable `now`:
  - a valid block → `current()` signed in, cause `"load"`, `fetchUser` not called
  - an unreadable block → signed out, plus one `errors.report` whose context is `{ operation: "identity" }` and whose message holds no user data
  - no block → `"unknown"`, then the `fetchUser` answer applies
  - `"401 and 403 sign out"`: `fetchUser` rejects with an `Error` whose `cause.status` is 401 (then 403) → signed out, cause `"recheck"`, no report
  - `"5xx and network errors change nothing"`: `cause.status` 500, or a `TypeError` → unchanged, no report
  - `"a 200 that fails validation changes nothing"`: resolves `"<html>"` → unchanged, plus one report
  - the visible→hidden→visible cycle re-checks at most once per 30 000 ms of `now`, and `force` ignores that
  - coming back online re-checks (forced)
  - two overlapping `recheck()` calls → one `fetchUser` call
  - `accept()` of an equal identity fires nothing; a different one fires cause `"tab"`
  - `signOut()` posts with the `csrftoken` cookie value; a `Response` of type `opaqueredirect` or any `ok` counts as success → returns true, then signed out with cause `"sign-out"`
  - `"signOut failure keeps signed in and re-checks"`: a 403 or a rejected `postLogout` returns false, stays signed in, and calls `fetchUser` (forced)
  - `signInUrl("/workspace/dashboards/a b?x=1")` → `/account/login/?next=%2Fworkspace%2Fdashboards%2Fa%20b%3Fx%3D1`
  - the re-check aborts after 10 000 ms (fake timers): the signal passed to `fetchUser` is aborted, and nothing changes
- [ ] **Step 2: Run it; it fails**
- [ ] **Step 3: Implement** `types.ts`, `web/identity.ts`, the `storage.ts` wiring, and `createMemoryIdentity`. Read the status as `(error as { cause?: { status?: unknown } }).cause?.status`, which is how the SDK rejects; `src/lib/` has no other copy of this check.
- [ ] **Step 4: Remove the `sjvair-identity` block from `index.html`**
- [ ] **Step 5: Run the unit suite and the platform contract tests; all pass** — `npm run test:unit`
- [ ] **Step 6: Commit** — `git commit -m "Add the identity source to the platform adapter"`

### Task 7: `AccountState`: cross-tab and toasts

**Files:**

- Create: `src/lib/store/account.svelte.ts`, `src/lib/store/account.test.ts`
- Modify: `src/lib/store/tab-channel.ts` (new message, validation), `src/lib/store/tab-channel.test.ts`
- Modify: `src/lib/store/app.svelte.ts` (`AppContext.account`, wiring in `initApp`, an optional `notify` in `AppOptions`)
- Modify: `messages/en.json` (the toast messages below)

**Interfaces:**

- Consumes: `IdentitySource` (Task 6); `Identity`, `sameAccount`, `sameIdentity`, `accountUserSchema`, `displayName` (Task 5)
- Produces:
  - `TabMessage` gains `{ type: "identity"; identity: Identity; tabId: string }`. `isTabMessage` accepts it only when `identity` is `signed-out`, or `signed-in` with a user passing `accountUserSchema`. `unknown` is never sent.
  - `type Notify = { info(message: string): void; error(message: string): void }`. In the app it's `svelte-sonner`'s `toast` / `toast.error`.
  - `class AccountState { readonly identity: Identity /* $state */; recheck(): void; signOut(): Promise<void>; dispose(): void }`, constructed as `new AccountState(identity: IdentitySource, channel: TabChannel, tabId: string, notify: Notify)`
  - `changeMessage(prev: Identity, next: Identity): string | null`, exported for tests. It returns `null` when `prev` is unknown or `sameAccount(prev, next)`. Signed in → signed out: `m.account_signed_out_elsewhere()`. Signed out → signed in: `m.account_signed_in_as_toast({ name })`. One account → another: `m.account_switched_to({ name })`. The `name` is `displayName(full_name)`; when there's none, use `m.account_signed_in_unnamed_toast()` and `m.account_switched_unnamed()`.
  - `AppContext.account: AccountState`. `initApp` builds it after the channel and then calls `platform.identity.start()`.
- Behavior, by `IdentityCause`:
  - `load`: set it; no toast, no broadcast.
  - `recheck`: set it, toast `changeMessage`, and broadcast if `!sameIdentity`.
  - `tab`: set it and toast `changeMessage`; no broadcast.
  - `sign-out`: set it, `notify.info(m.account_signed_out())`, and broadcast.
  - A received `identity` message from another `tabId` → `identity.accept(msg.identity)`.
  - `signOut()` returning false → `notify.error(m.account_sign_out_failed())`.
- Messages (`messages/en.json`):
  - `"account_signed_out": "Signed out."`
  - `"account_sign_out_failed": "Couldn't sign out. Check your connection and try again."`
  - `"account_signed_out_elsewhere": "You've been signed out."`
  - `"account_signed_in_as_toast": "Signed in as {name}."`
  - `"account_signed_in_unnamed_toast": "You're signed in."`
  - `"account_switched_to": "Now signed in as {name}."`
  - `"account_switched_unnamed": "You're now signed in to a different account."`

- [ ] **Step 1: Write the tests.** Two apps share one `createMemoryTabHub()`, each on its own `createMemoryPlatform()` with `createMemoryIdentity`, and `notify` records messages:
  - `"tab A's sign-out reaches tab B"`: A says "Signed out."; B becomes signed out and says "You've been signed out."
  - `"a re-check that finds a sign-out tells every tab"`: A's `setServer(signed-out)`, then `recheck()` → both signed out; each says "You've been signed out." once
  - `"an equal identity from another tab is ignored"`: no toast, and no message posted back
  - `"switching accounts says the new name"`
  - `"a name change for the same account is silent"`: the identity updates, no toast
  - `"load sets the identity without a toast"`
  - `"failed sign-out shows the error toast"`
  - `tab-channel.test.ts`: `isTabMessage` rejects an `identity` message whose user lacks `id`, and one with `state: "unknown"`
- [ ] **Step 2: Run them; they fail**
- [ ] **Step 3: Implement it, then run `npm run test:unit`; all pass**
- [ ] **Step 4: Commit** — `git commit -m "Share sign-in changes across tabs and say when they happen"`

### Task 8: The shell: "Sign in" and the account menu (option A)

**Files:**

- Create: `src/lib/components/shell/AccountMenu.svelte`, `src/lib/components/shell/account-menu.browser.test.ts`
- Modify: `src/lib/components/shell/TopNav.svelte` (`<AccountMenu />` after `<HelpMenu />`)
- Modify: `messages/en.json`

**Interfaces:**

- Consumes:
  - `useApp().account` and `app.platform.identity.signInUrl` / `accountUrl` (Tasks 6–7)
  - `initials`, `greetingName`, `displayName` (Task 5)
  - `openPrivacy` (`$lib/components/dialogs/PrivacyDialog.svelte`)
- The return path is `location.pathname + location.search`, never the hash. It's read inside the component, through a small exported helper `returnPath(loc: { pathname: string; search: string }): string` in `AccountMenu.svelte`'s module script, so it can be tested.
- Messages:
  - `"account_sign_in": "Sign in"`
  - `"account_menu_for": "Account menu for {name}"`
  - `"account_menu": "Account menu"`
  - `"account_greeting": "Hi, {name}"`
  - `"account_greeting_unnamed": "Hi!"`
  - `"account_signed_in_as": "Signed in as {name}"`
  - `"account_signed_in_unnamed": "You're signed in"`
  - `"account_settings": "Account settings"`
  - `"account_sign_out": "Sign out"`
  - Privacy reuses `privacy_open`.

- [ ] **Step 1: Write the browser tests.** Follow `shell.browser.test.ts`: `initApp` on a memory platform with `createMemoryIdentity(...)`, rendered inside `TopNav`.
  - signed out → a link named "Sign in" whose `href` is `/account/login/?next=` plus the encoded current path
  - `"sign-in link never carries the fragment"`: `returnPath({ pathname: "/workspace/import", search: "" })` gives `"/workspace/import"`, and the component never reads `hash`
  - unknown → neither "Sign in" nor the account button
  - signed in as "Maria Lopez" → a button named "Account menu for Maria Lopez" showing `ML`
    - opening it shows "Hi, Maria", "Signed in as Maria Lopez", and an "Account settings" link (`href="/account/"`, `target="_blank"`, `rel` includes `noopener`), "Your data and privacy", and "Sign out"
    - opening it calls `recheck` (the memory identity's `requests` goes up by 1)
  - an empty name → a button named "Account menu", a person icon, and "Hi!"
  - keyboard: focus the button, press Enter, ArrowDown to "Sign out", press Enter → the memory identity is signed out
  - when the identity changes from signed in to signed out, the button becomes the "Sign in" link without a reload
- [ ] **Step 2: Run them; they fail**
- [ ] **Step 3: Implement `AccountMenu.svelte`.**
  - Use bits-ui `DropdownMenu` like `HelpMenu.svelte`, and call `app.account.recheck()` from `onOpenChange` when the menu opens.
  - The initials circle uses theme tokens and is outlined.
  - Use the lucide `UserRound` icon when there are no initials.
  - Placeholder styling only.
- [ ] **Step 4: Run `npm run test:browser` and `npm run check`; both pass**
- [ ] **Step 5: Commit** — `git commit -m "Add Sign in and the account menu to the top bar"`

### Task 9: E2E and the hand-run suites

**Files:**

- Modify: `e2e/fixtures.ts`: a new option `account: AccountUser | null` (default `null`) and an auto fixture `accountServer`. It depends on `apiFixtures`, so its routes take precedence.
- Create: `e2e/account.spec.ts`
- Modify: `e2e-local/embedding.spec.ts` (the identity assertions), `e2e-local/dev-stack.spec.ts`

**Interfaces:**

- `accountServer` routes:
  - `**/api/2.0/account/` GET → `401` with a JSON error body when signed out; `200` with `{ "data": user }` when signed in
  - `**/account/logout/` POST → `200`, then signed out
- It exposes `{ set(user: AccountUser | null): void }` so a test can change the server's answer.

- [ ] **Step 1: Write `account.spec.ts`:**
  - signed out: on `/workspace/dashboards/<id>` the "Sign in" link's `href` ends with `next=%2Fworkspace%2Fdashboards%2F<id>`
  - signed in (`test.use({ account: maria })`): the button shows `ML`; opening the menu shows "Hi, Maria"; axe (as in `a11y.spec.ts`) passes with the menu open
  - sign out flips every tab: two pages in one context, sign out in page 1 → page 2 shows "Sign in" and the toast "You've been signed out."
  - a focus re-check returning 401 shows the toast:
    - `page.clock.install()` before load
    - `accountServer.set(null)`
    - fast-forward 31 s
    - send `visibilitychange` hidden, then visible (via `page.evaluate`, overriding `document.visibilityState`)
    - expect "You've been signed out." and the "Sign in" link
- [ ] **Step 2: Run the whole E2E suite on Chromium.** `account.spec.ts` should pass, and every existing spec should still pass now that each page load hits `account/`.
  - Run: `npm run test:e2e`
  - If a console-error check trips on the 401, scope that check to ignore `/api/2.0/account/` 401s only.
- [ ] **Step 3: Run all three engines** — `npm run test:e2e:all` (or `npm run test:e2e:podman`)
- [ ] **Step 4: Update the hand-run suites.**
  - `embedding.spec.ts`: replace `not.toHaveProperty("phone")` with assertions that the `user` has `id`, `full_name`, `phone_verified` and no `api_token`, and that the "Account menu for" button is visible.
  - `dev-stack.spec.ts`: add that `/workspace/` shows "Sign in" when the stack session is signed out.
- [ ] **Step 5: Commit** — `git commit -m "Cover sign-in, the account menu, and sign-out end to end"`

### Task 10: Docs and the deferral register

**Files:** `ARCHITECTURE.md`, `DEFERRED.md`, `ROADMAP.md`, `TODO.md`, `CLAUDE.md` (only if a command changed), `docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` (§4 note)

- [ ] **Step 1: Update `ARCHITECTURE.md`** as listed in the spec's "Docs and register":
  - "Authentication": the SDK change shipped in 4.7.0; session responses drop `api_token`
  - "Accounts & anonymous use": the re-check is `account/`, phone included; mark the held-for-sync parts
  - "Template embedding": the block's `user` is the session response, still `v: 1`
  - "Sign-in flow": the logout POST and the login `next` fix
  - "Platform strategy": the `IdentitySource` capability
- [ ] **Step 2: Update `DEFERRED.md`** (each entry with why and the revisit trigger, copied from the spec):
  - the "Held for sync" items
  - the return trip after sign-up and verification (email-only accounts track; before go-live at the latest)
  - account UI in token-mode builds
  - the backup-reminder line: trigger changed to sync
- [ ] **Step 3: Add the held items to the track in `ROADMAP.md`.** Add a one-line note to the 5a spec's §4 pointing at the 5b spec.
- [ ] **Step 4: Run `npm run lint`; it passes.** Commit: `git commit -m "Record spec 5b in the architecture, roadmap, and deferral register"`

### Task 11: Real-embedding check and PR

- [ ] **Step 1: Prepare the local stack.** Serve the sjvair.com `feature/workspace-sign-in` branch (project memory: "Testing `/workspace` locally"), and import this dashboard branch into it (`invoke import-data-dashboard --ref foundations-5b-sign-in`).
- [ ] **Step 2: Run the embedding suite.** It should pass. Run: `WORKSPACE_E2E_IDENTIFIER=… WORKSPACE_E2E_PASSWORD=… npm run test:embedding`
- [ ] **Step 3: Hand check in Chrome**, with the CSP enforced:
  - sign in from the dashboard and come back to the same dashboard
  - the greeting and menu show
  - sign out from the menu: every `/workspace/` tab flips
  - sign in again, then sign out from a sjvair.com page: the dashboard tab says "You've been signed out." on focus
  - no console or CSP errors
- [ ] **Step 4: Record the result** in `TODO.md` → "Start here", update the project memory, and commit with `git commit -m "Record the 5b embedding check"`.
- [ ] **Step 5: Run `npm run lint`, `npm run check`, `npm run test`, `npm run build`, `npm run check:build`, and `npm run check:budget`; all pass.** Then push and open the PR into `foundations`, linking the sjvair.com and sdk-js PRs. **Don't merge anything** without the user.
