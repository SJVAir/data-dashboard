# Foundations, spec 5b: the sign-in side

Date: 2026-10-27. Branch: `foundations-5b-sign-in` (stacked on `foundations`, PR into it).
Release 1, step 1 (Foundations), the last Foundations spec. Spec 5a (shipping readiness) is
merged into `foundations` (PR #9), and the sjvair.com hosting track into sjvair.com `develop`
(PR #295).

Repos: **data-dashboard** (most of the work), **sjvair.com** (small; branch from `develop`, PR
into `develop`), **sdk-js** (types only; branch from `release/4.8.0`). Each sibling repo needs an
approved plan before it is changed. Production is out of scope; the server side is verified on
the local podman stack.

## Why

After 5a the dashboard ships on sjvair.com behind `beta_tools`, but it has no idea who is
using it. 5b makes it know who is signed in. It shows a "Sign in" button, greets a signed-in
person by name in an account menu, signs out, and stays correct when the session changes
somewhere else: another tab, another sjvair.com page, or an expired session.

What signing in gives a person in 5b is small on purpose: being recognized, the account menu,
and a correct picture of who is signed in across tabs. **Server-backed documents (sync) don't
exist yet**, and the parts of the storage-spaces design that only make sense with sync wait
for it (see "Held for sync"). That keeps 5b from promising anything it can't deliver, such as
"your dashboards are in your account" when they are only in this browser.

## Decisions made while designing (with the user, 2026-10-27)

1. **No new session-identity endpoint.** The existing `GET /api/2.0/account/` serves token
   callers, session-cookie callers, and signed-out callers:
   - **Token requests** (the mobile app): unchanged, including `api_token`.
   - **Session-cookie requests**: the same fields **without `api_token`**. This applies to every
     response from that serializer to a session request: `GET`/`PATCH`/`DELETE account/` and
     `POST account/password/`.
   - **Signed out**: `401`. Today it is a `500` (checked on the local stack: there is no login
     check, so it serializes an anonymous user).

   Why: dropping the token for session requests is the actual protection. A separate token-free
   endpoint alone leaves the token reachable to injected code through `account/`. With the token
   dropped, one endpoint for "the current account" is the cleaner design.
2. **Session responses keep `phone`.** The session and token shapes stay the same apart from
   the token. This replaces the hosting contract's "never the phone number" rule (5a §4).
3. **The identity block becomes the session response.** The `sjvair-identity` block's `user`
   is exactly what a session-cookie `GET account/` returns. **It stays `v: 1`**, redefined in
   place: nothing reads the block yet, and nothing is released, so shapes can change freely
   before the first release.
4. **The storage-space switch waits for sync.** Everyone keeps working in the anonymous space
   whether signed in or not. The space switch, the "add your work to your account" prompt,
   sign-out removing local copies, and the rest wait for the server-backed documents track
   (see "Held for sync").
5. **Placement (mockup option A).** A "Sign in" button at the far right of the top bar, after
   Help. Signed in, it becomes a circle with the person's initials that opens the account menu.
   The menu's first line is the greeting ("Hi, Maria" above "Signed in as Maria Lopez").
6. **sjvair.com's own Logout link gets fixed in the same PR.** Today it is a plain link (a
   GET), and Django 5.2's `LogoutView` only signs out on POST, so it returns `405` (checked on
   the local stack). It becomes a small POST form with `{% csrf_token %}`.
7. **sjvair.com's login page keeps `next`, in the same PR.** Today
   `registration/login.html` posts to `/account/login/` with no query string and no hidden
   `next` field, so everyone lands on `LOGIN_REDIRECT_URL` (`/`) after signing in. The form
   gets a hidden `next` field (when one was given). This changes the whole site: any page that
   already sends people to `/account/login/?next=…` now returns them there, which is what was
   intended.
8. **The return trip after sign-up waits for the email-only accounts track.** A new account
   still goes sign-up → the "enter your code" page → the profile page, not back to the
   dashboard. Why:
   - During the preview, `/workspace/` is behind `beta_tools`, so only people who already have
     accounts can open it, and they use the login page. Sign-up from the dashboard is first
     reachable at go-live.
   - The email-only accounts track rewrites sign-up and verification, so the return trip is
     designed once there.
   - Simply passing `next` to sign-up would skip phone verification: `SignupView` already sends
     the person to `next` when it has one, instead of the code page. Doing it right means
     carrying `next` through sign-up and the code page.

   The login page's "Sign up" link and the sign-up form are left as they are. (The sign-up form
   posts without a query string, so a `next` on the link would be dropped anyway.)

Found while designing: **the sdk-js `apiToken`-optional change is already done.** Commit
a211be6 made `apiToken` optional on every account call, and it shipped in @sjvair/sdk 4.7.0.
`ARCHITECTURE.md` and `TODO.md` still list it as pending; this spec's doc updates fix that.

## Goals

1. **Know who is signed in** on load, through the platform adapter, from the identity block
   (or `account/` where there is no block).
2. **Stay correct:** re-check on focus, share changes across tabs, and treat a network failure
   as "no news".
3. **The shell:** a "Sign in" button; an account menu with the greeting, an account-settings
   link, the privacy note, and Sign out.
4. **Sign out** from the dashboard, applied to every open tab.
5. **Say so when the session changes** in a way this tab didn't cause.
6. **Server:** `account/` without the token for session requests, `401` when signed out, the
   identity block matching it, the site's Logout link working, and the login page returning
   people to `next`.
7. **SDK types** that say `api_token` is absent on token-free calls, without breaking the
   mobile app's build.

## Non-goals

- **Everything in "Held for sync"** below.
- **In-app sign-in.** Release 1 redirects to sjvair.com's login page; the in-app dialog and a
  `POST account/session/` endpoint are Release 2 (`ARCHITECTURE.md` → "Sign-in flow").
- **"Remember me"**, owned by the email-only accounts track.
- **Account deletion or settings inside the dashboard.** The menu links to sjvair.com's
  account page.
- **Token auth** (Tauri or standalone on another origin). The adapter is shaped for it, but
  only the cookie mode is built.

## Anti-goals

- **The API token reaching the dashboard,** from any response, ever.
- **Losing or hiding anyone's work.** Signing in, signing out, an expired session, or a
  different person signing in leaves this browser's dashboards exactly as they were.
- **Promising what sync will do.** No copy that says dashboards are "in your account", "safe
  everywhere", or "synced".
- **A false sign-out.** Being offline, a timeout, or a server error never shows as signed out.
- **Error reports for normal answers.** A `401` from the re-check is "signed out", not a failure,
  and never goes to Sentry. Identity data (name, email, phone, id) never goes into error reports;
  the existing scrubber stays the backstop.
- **Breaking the mobile app** (token auth, the current `account/` shape) or anything else
  using sjvair.com's API with a token.
- The usual `CLAUDE.md` rules: browser APIs only through the platform adapter, all strings
  through Paraglide, theme tokens for styling, WCAG 2.2 AA.

## Held for sync (into `DEFERRED.md` in the same change)

These are designed in `ARCHITECTURE.md` → "Accounts & anonymous use" and stay as designed. They
move to the server-backed documents track, because without sync each one either promises
something false or can lose work:

- **The space switch**: signed-in work going into a per-account space (`account:<id>`).
  Without sync, an account space exists only in this browser, so a person expects their
  dashboards on another device and doesn't find them.
- **"Add the 3 dashboards made on this browser to your account?"**, for the same reason.
- **Sign-out removing that account's local copies** "because they are on the server": they
  aren't yet, so this would delete work.
- **Hidden spaces on expiry or an account change**, and removing a hidden space after 30 days.
  There are no account spaces to hide yet.
- **Saves bound to an account** (each save names its account; the server refuses a mismatch)
  and **the re-check before each sync**. There are no server saves yet.
- **"Sign in to keep this safe everywhere"** in the backup reminder. Before sync it would be
  false. The existing `DEFERRED.md` entry's revisit trigger changes from "spec 5b" to "the
  server-backed documents track (sync)".

Revisit trigger for all of them: when the server-backed documents track starts building sync.
5b leaves the seams in place (below) so that track switches spaces on without reshaping the
identity code.

Two more deferrals, also into `DEFERRED.md`:

- **Returning to the dashboard after sign-up and verification** (decision 8). Revisit with the
  email-only accounts track, and **before go-live at the latest**, when sign-up from the
  dashboard first becomes reachable.
- **Account UI in token-mode builds** (Tauri, or standalone on another origin via
  `VITE_PROD_URL`). There the cookie re-check can only answer 401 and the relative
  `/account/login/` link goes nowhere. No such build ships in Release 1. In 5b the adapter's
  `authMode` is always `"cookie"`. Revisit when the first token-mode build is planned; it needs
  in-app sign-in (Release 2) and a "no account UI" or token-sign-in state in the shell.

## What gets built: sjvair.com

Branch from `develop`, PR into `develop`. Approved sjvair.com plan first.

The live endpoints are in `camp/api/v2/accounts/` (`endpoints.py`, `serializers.py`); the v1
files are not what `/api/2.0/account/` serves.

1. **`account/` and session requests.** When resticus authenticated the request by session
   (on the session path `request.authenticator` is `None`; token requests set it to the
   authenticator), every `UserSerializer` response leaves out `api_token`. That covers
   `UserDetail` (GET, PATCH, DELETE) and `ChangePasswordEndpoint`. `LoginEndpoint` and
   `RegisterEndpoint` are unchanged: they authenticate by credentials and exist to hand out
   the token. _Builder's call:_ how the field is left out (a serializer variant, a context
   flag, or popping the key in the endpoint), as long as it is one shared helper.
   **`is_admin`** (added by `UserSerializer.fixup` for staff) stays in session responses and
   the block, which keeps the shapes the same (_my call_). The dashboard's schema ignores
   fields it doesn't know (below), so staff accounts parse normally.
2. **Signed-out `GET account/`** returns `401`, not `500` (setting `login_required` gives 401
   with TokenAuth's `WWW-Authenticate` header). Also check that signed-out
   `PATCH`/`DELETE account/` and `password/` give 401 rather than 500.
3. **`workspace_identity()`** returns `{ "v": 1, "user": <the session response> | null }`,
   built from the same helper as item 1 so the two can't drift.
4. **The site's Logout link** (`camp/templates/page.html`, the only GET link to
   `account:logout`) becomes a POST form with `{% csrf_token %}`, styled to look as it does now.
5. **The login page keeps `next`** (decision 7): `registration/login.html` adds a hidden
   `next` field holding the view's `next` value when there is one. `LoginView` already checks
   it is a same-site URL. The "Sign up" link and the sign-up pages are unchanged (decision 8).
6. **Tests:**
   - token GET still includes `api_token`
   - session GET, PATCH, and password change omit it
   - a request with both a session and a token behaves as a session request (today's resticus
     early return); assert whatever it does
   - signed-out requests give 401
   - the identity block's shape matches the session response
   - the Logout form signs out
   - signing in at `/account/login/?next=/workspace/dashboards/x` lands on that path, and an
     off-site `next` is ignored

## What gets built: sdk-js

Branch from `release/4.8.0`, PR into it. Approved sdk-js plan first. **No release** without the
user's explicit go-ahead (a 4.8.0 beta or 4.8.0 itself).

- **Types only.** `getUserDetails`, `updateUser`, and `changePassword` get overloads: with a
  token they return `UserDetails` as today; without one they return a new exported
  `SessionUserDetails` (`UserDetails` without `api_token`). The mobile app always passes a
  token (`mobile/src/lib/users/account/service.ts`), so its types don't change. _Builder's call:_
  overloads or another type-level approach, as long as the mobile app's code compiles unchanged.
- Docs: the JSDoc for those calls says the session response has no `api_token`, and a signed-out
  call is a `401`.
- No new wrapper: `getUserDetails()` without a token is the identity re-check.
- The dashboard needs the new types: it takes them from a new beta (asked for when ready) or,
  until then, works with a local type alias that is removed when the beta lands. Recorded in
  `DEFERRED.md` if the beta doesn't happen inside 5b.

## What gets built: data-dashboard

### 1. Identity in the platform adapter

`IdentitySource` grows from `currentSpace()` into the one place that knows who is signed in
(`ARCHITECTURE.md` → "Platform strategy" puts identity and auth mode in the adapter):

- **`Identity`**: `{ state: "signed-in", user: AccountUser } | { state: "signed-out" }`.
  `AccountUser` is the session response's fields (`id`, `full_name`, `email`, `phone`,
  `phone_verified`, `language`), validated with zod (via `$lib/zod`). The schema drops fields
  it doesn't know (such as `is_admin`) instead of rejecting them, so a server-side addition
  never makes someone look signed out. There's also an initial
  "unknown" until the first answer, for the dev/standalone path where there is no block.
- **`current()`**, **`onChange(cb)`**, and **`recheck()`**.
- **`signInUrl(returnPath)`** (web: `/account/login/?next=…`) and **`signOut()`** (web: below). A
  Tauri build later swaps these for its own dialog and token storage. _`signUpUrl` was not
  built: there is no "Create account" button (see the shell, below)._
- **`authMode`**: `"cookie"` on the web. Nothing else is built for token mode.
- **`currentSpace()`** keeps returning `"anonymous"`. The mapping from identity to a space is
  written as a function that returns `"anonymous"` until sync turns it on; that switch is the
  "Held for sync" seam. _Builder's call:_ whether that function exists now or is just a comment
  at the place it goes. Don't build a dormant code path that needs its own tests.
- **Reading the block on load:** parse `#sjvair-identity` (`textContent`, `JSON.parse`, zod).
  An unknown `v`, a missing or unreadable block, or a `user` that fails validation means signed
  out, plus a scrubbed error report for the unreadable case (a contract drift worth knowing
  about). With no block at all (dev, the standalone `index.html`, E2E), the adapter calls
  `getUserDetails()` once on load and stays "unknown" until it answers.
- **`index.html` loses its stand-in block** (_my call_). 5a put
  `{ "v": 1, "user": null }` into `index.html` to mirror the template. Kept, it would make dev,
  E2E, and the standalone build always signed out, so dev against the local stack and the
  mocked E2E couldn't work. The build-output check and any test expecting the stand-in block
  change with it. `e2e-local/embedding.spec.ts` drops its "no `phone`" assertion and checks
  that there's no `api_token` instead.
- **Re-checks:** `getUserDetails()` with no token.
  - When the app becomes visible again (`platform.activity`), at most once every 30 seconds
    (_my call_).
  - On `platform.online` going back online.
  - When the account menu is opened (_my call_): cheap, and it means the menu never offers
    Sign out to someone already signed out.
- **Reading a re-check:**
  - `200` → signed in as that user.
  - `401`/`403` → signed out.
  - Anything else (network error, timeout, `5xx`, a response that fails validation) → no change.
    A failed validation is also reported, scrubbed. Re-checks use the SDK's request options to
    time out (_builder's call_ on the timeout).
- **Comparing identities:** by `id`. A change of name or email for the same id updates the
  greeting silently.

### 2. Cross-tab

The tab channel (`src/lib/store/tab-channel.ts`) gets an identity message: when a tab learns of
a change (from a re-check, or its own sign-out), it broadcasts the new identity, and other tabs
apply it at once without asking the server. Changes made outside `/workspace/` (signing in or
out on another sjvair.com page) reach a tab through its focus re-check.

### 3. The shell (option A)

- **Signed out:** a "Sign in" button at the far right of `TopNav`, after `HelpMenu`. It links
  to `signInUrl(<current path>)`, which works once the login page keeps `next` (decision 7).
  sjvair.com's login page links to sign-up, so there's no separate "Create account" button
  (_my call_; a new account doesn't return to the dashboard yet, see decision 8).
- **Signed in:** a circle with the person's initials (from `full_name`; a generic person icon
  if there's no usable name), with an accessible name like "ML, account menu for Maria Lopez". The visible initials come
  first in the name so it contains the visible label (WCAG 2.5.3, label in name).
  It opens a dropdown (bits-ui, like `HelpMenu`):
  - **Greeting**: "Hi, Maria" (first word of `full_name`, _my call_; the whole name if one
    word) and, below it, "Signed in as Maria Lopez". Formatted through Paraglide messages with
    the name as a parameter.
  - **Account settings**: opens sjvair.com's `/account/` in a new tab (_my call_: the dashboard
    stays open, and a focus re-check picks up anything done there, including deleting the
    account). This is where account deletion and password changes live.
  - **Privacy**: opens the existing privacy dialog (it also stays in Help).
  - **Sign out**.
- **Unknown** (the dev/standalone path before the first answer): neither, so it doesn't flicker
  between the two.
- **Phone width:** the button and circle stay visible; the bar already wraps.
- Theme tokens only, placeholder styling (the design pass comes later). Keyboard and screen
  reader use work like `HelpMenu`.

### 4. Sign out

- The adapter `POST`s to `/account/logout/` with `fetch` (`credentials: "same-origin"`, the
  `X-CSRFToken` header from the `csrftoken` cookie). The CSP's `form-action 'none'` rules out a
  form. It isn't an API endpoint, so it isn't an SDK call (_my call_; the Release 2
  `account/session/` logout will be).
- **Success** (any `2xx` or a redirect followed to a `2xx`): the identity becomes signed out
  here, it is broadcast to other tabs, and a short toast says "Signed out". The page stays where
  it is, with the same dashboards.
- **Failure** (offline, `403` CSRF, `5xx`): stay signed in and show an error toast. Then re-check,
  in case the sign-out went through anyway.
- In dev the proxy forwards `/account/`, so this works against the local stack. Following the
  logout redirect to `/` may not give a `2xx` there (Vite serves `/workspace/` only), so the
  adapter treats the redirect itself as success (`redirect: "manual"`, _builder's call_).

### 5. Telling the person

A toast (the existing `svelte-sonner` `Toaster`) when the identity changes in a way **this tab
didn't cause**, after the first answer on load:

- signed in → signed out: "You've been signed out." The cause (expired, signed out elsewhere,
  account deleted) isn't known and doesn't change anything before sync, so there is one message
  (_my call_).
- signed out → signed in: "Signed in as Maria Lopez."
- one account → another: "Now signed in as Jordan Lee."

The tab that signed out shows its own "Signed out" toast; the other tabs show "You've been
signed out." Nothing else on screen changes. Toasts are announced politely to screen readers
(sonner's live region).

### 6. Docs and register

- **`ARCHITECTURE.md`**:
  - "Authentication": the sdk-js change shipped in 4.7.0; `account/` drops `api_token` for
    session requests.
  - "Accounts & anonymous use": the session-identity response is `account/` (no separate
    endpoint), and the phone number is included. Mark the parts that wait for sync.
  - "Template embedding": the block's new `user` shape, still `v: 1`.
  - "Sign-in flow": the logout POST.
- **The 5a spec's hosting contract §4**: a note that 5b redefined the block's `user` and
  dropped the "never the phone number" rule, pointing here.
- **`DEFERRED.md`**: the "Held for sync" items (as one entry under the server-backed documents
  item, or as separate entries; _builder's call_), with why and the revisit trigger. Also the
  sign-up return trip, the token-mode account UI, the backup-reminder entry's new trigger, and
  the SDK beta note if it applies.
- **`ROADMAP.md`**: the server-backed documents track lists the held items.
- **`TODO.md`** → "Start here", and the project memory.

## Testing

- **sjvair.com:** the tests listed under its section, in the local podman test setup, with the
  full suite passing.
- **sdk-js:** type tests (`deno check`) proving a token call returns `UserDetails` and a
  token-free one returns `SessionUserDetails`. The existing account tests pass. A check that
  the mobile app still type-checks against the branch (_builder's call_ on how: a local link or
  copying the types).
- **data-dashboard unit/browser tests:**
  - **Block parsing:** valid, `user: null`, unknown `v`, malformed, missing.
  - **Re-check answers:** 200, 401, 403, 500, network error, validation failure.
  - **Throttling** and the "unknown" state.
  - **Cross-tab** messages.
  - **Sign-out:** success and failure.
  - **Toasts:** shown only for changes this tab didn't cause.
  - **The menu's keyboard and screen-reader behavior.**
- **E2E (three engines):** the standalone build has no block, so identity comes from a mocked
  `account/` (Playwright route interception, _builder's call_):
  - signed out shows "Sign in" with the right `next`
  - signed in shows the initials and the greeting
  - Sign out posts and flips every open tab
  - a focus re-check returning 401 shows "You've been signed out"
  - axe passes with the menu open
- **Dev-stack smoke / embedding suite** (by hand, against the local stack running the sjvair.com
  branch): the block is read on a real `/workspace/` page; sign in through `/account/login/`
  and come back to the same dashboard; sign out from the dashboard, then from a sjvair.com page,
  and see the dashboard tab notice on focus.

## Done when

- The sjvair.com PR (into `develop`) and the sdk-js PR (into `release/4.8.0`) are open with
  passing suites. Merging them is the user's call; nothing is released.
- The data-dashboard PR into `foundations` passes unit, browser, and E2E on all three engines,
  plus the build, license, and bundle checks. The initial bundle stays within budget: identity
  code is small, and the menu can lazy-load if needed.
- The embedding check above has been run by hand against the local stack, and its result is
  recorded in `TODO.md`.
- `DEFERRED.md`, `ARCHITECTURE.md`, `ROADMAP.md`, the 5a contract note, and `TODO.md` are
  updated in the same change.
- When it merges, Foundations is done; Release 1 step 2 (layout engine and windowing) is next.
