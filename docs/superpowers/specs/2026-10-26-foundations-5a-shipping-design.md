# Foundations, spec 5a: shipping readiness

Date: 2026-10-26. Branch: `foundations-5a-shipping` (stacked on `foundations`, PR into it).
Release 1, step 1 (Foundations). Specs 1–3 are merged into `foundations`; spec 4 was dropped
(Collections moved to Release 3).

## Why

After specs 1–3 the dashboard works, saves, and shares, but only from `vite preview`. It
can't yet be embedded in sjvair.com, has no error reporting, no license, and nothing stops
it from growing past its size budget. Spec 5a makes the build shippable on sjvair.com, so the
hosting track (planned in a parallel sjvair.com session) has a real build to embed, and so
beta testers can use it behind the `beta_tools` flag.

**Spec 5 is split (decided 2026-10-26):**

- **5a, shipping readiness** (this spec): everything that can be built now.
- **5b, the sign-in side**: identity from the template's data block, the "add anonymous work
  to your account" prompt, sign-out, expired sessions, re-checks on focus, cross-tab sign-in,
  and the "sign in to keep this safe everywhere" line. It needs a server session-identity
  endpoint without the API token and the sdk-js change making `apiToken` optional, and it
  leans on the server-backed documents track. 5b gets its own spec.

5a defines the identity block in the hosting contract (because the template is built now),
but nothing in 5a reads it.

## Goals

1. **The embedding build** that the hosting contract describes, plus a standalone
   `index.html` for local dev, E2E, and future standalone builds.
2. **The hosting contract**, recorded here as the single source of truth for both repos.
3. **The CSP reference list** with a test that fails on an unlisted host, and the app's own
   violation reports.
4. **Scrubbed error reporting to Sentry** through the platform adapter, wired into spec 3's
   `report()` hook, closing the `DEFERRED.md` items waiting on it.
5. **Licensing**: the MIT `LICENSE`, a CI license check, and generated third-party notices.
6. **A CI bundle budget** and the unsupported-browser notice.
7. **Installable**: the web app manifest and icons; and an **offline banner**.
8. **Local dev against the real server**: the Vite dev proxy, the `csrftoken` bootstrap, and
   a dev-stack smoke suite.
9. **A local check of the real embedding** against the sjvair.com session's template, set up
   the way monitor-map is (same-origin static files), with the CSP enforced.
10. **A privacy note and a feedback link.**
11. **Living with monitor-map's upload process** (no cache headers): the reload button
    refreshes the cached entry files first.

## Non-goals

- Everything in 5b (above). No sign-in button, no account spaces in use.
- Anything server-side. sjvair.com's template, view, route, import script, CSP header, and S3
  upload belong to the hosting track; this spec only states the contract they implement.
- Map keys in use (MapTiler, NREL arrive with the map widget, Release 1 step 5) and their CSP
  hosts.
- Source-map upload to Sentry, upload compression, cache headers, ordered upload passes, and a
  post-deploy header check (all deferred; see "Deferrals").
- A service worker (arrives with web push, Release 2).
- The design pass. Icons and the notices' styling are placeholders that use the theme tokens.

## Anti-goals

- **Personal data in error reports.** Never document bodies, Notes text, names, emails,
  coordinates, place references, URLs with fragments, or account ids.
- **A second copy of the truth.** Hosts, file names, and the identity shape are written once
  (here, and in `csp-hosts.json`); sjvair.com mirrors them. No hardcoded host strings outside
  that list.
- **Error reporting that costs the initial bundle.** Sentry's code must not count against the
  200 KB budget.
- **Breaking local dev.** `npm run dev` without a local sjvair.com stack must still start.
- The usual rules in `CLAUDE.md`: no direct browser-API calls outside the platform adapter, no
  stored English, no hardcoded styling values, no inline scripts.

## Constraints

Decided earlier; see `CLAUDE.md` and `ARCHITECTURE.md` → "Deployment" (especially "Template
embedding"), "Security baseline for untrusted content", "Telemetry, analytics & privacy",
"Licensing", "Browser support & performance budget", "Platform strategy", "Sign-in flow".

## Hosting contract

Settled 2026-10-26 between this session and the sjvair.com hosting session, with the user.
**Changes go through this repo:** the sjvair.com session proposes, this repo records, both
sides match. Items marked _(sjvair.com)_ are that side's responsibility, recorded so the two
sides agree.

### 1. Build interface

- The import runs `npm ci && npm run build` in a clone of this repo.
- **Node:** `package.json` declares `"engines": { "node": ">=24 <27" }` and the repo gets an
  `.nvmrc` (`24`). This repo's CI tests on Node 24 and adds a build-only job on Node 26
  (sjvair.com's container uses 26). _(sjvair.com)_ The import checks `node --version`
  against `engines` and fails early on a mismatch.
- **Output:** `dist/workspace/`. _(sjvair.com)_ The import copies it to sjvair.com's
  `dist/workspace/`, so it is served at `{% static 'workspace/' %}`. The import fails if
  `dist/workspace/` is missing (no skip mode; nothing ships until Release 1 is done).
- **No separate local build mode.** Files find each other by relative reference and the API
  uses the page origin, so one build works locally (same origin) and on S3 (cross-origin).
  _(sjvair.com)_ The import's local mode only changes the source (a local checkout path or a
  branch instead of GitHub `main`).
- **Build-time variables:** `VITE_SENTRY_DSN` (unset = error reporting off).
  `VITE_MAPTILER_KEY` and `VITE_NREL_KEY` are read once the map widget lands; setting them now
  is harmless. **Never set `VITE_PROD_URL` or `VITE_DEV_URL`** for the sjvair.com build.
- **Build id (Sentry release, `version.json`):** the build reads `BUILD_ID`, then
  `GITHUB_SHA`, then `git rev-parse HEAD` in the working directory. The import sets nothing
  (its fresh clone has `.git`), and must not pass Heroku's `SOURCE_VERSION`, which is
  sjvair.com's commit. **A production build fails if the id would be `unknown`.**

### 2. Files in `dist/workspace/`

- **Top level, fixed names:** `app.js` (the entry module), `app.css` (the entry stylesheet),
  `version.json` (`{"buildId": "<commit>"}`), `manifest.webmanifest`,
  `THIRD-PARTY-NOTICES.txt`.
- **`assets/`:** everything else, with content hashes in the names: JS and CSS chunks, fonts,
  images, icons.
- Plain files only: no `.br`/`.gz` siblings and no source maps.
- Files find each other by relative reference (resolved from `import.meta.url`); no static
  path is passed in by the template.
- **Upload** _(sjvair.com)_: exactly as monitor-map's files are uploaded today (one
  `aws s3 sync`, no compression, no `Cache-Control`, no ordered passes, no post-deploy check;
  decided by the user 2026-10-26). The existing bucket cross-origin rule for
  `https://www.sjvair.com` is enough (the preview is on production; see below). Consequences
  this repo designs around are in section 11 below.

### 3. The template

A dedicated Django template for `/workspace/*` that does not extend `base.html`/`page.html`
_(sjvair.com)_:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>SJVAir Dashboard</title>
		<link rel="icon" href="{% static 'img/favicon/favicon.ico' %}" />
		<link rel="manifest" href="/workspace/manifest.webmanifest" />
		<link rel="stylesheet" href="{% static 'workspace/app.css' %}" />
		<script type="module" src="{% static 'workspace/app.js' %}"></script>
	</head>
	<body>
		<div id="SJVAirDataDashboard"></div>
		{{ workspace_identity|json_script:"sjvair-identity" }}
	</body>
</html>
```

- **Mount element:** `id="SJVAirDataDashboard"` (the user's choice, matching monitor-map's
  `SJVAirMonitorMap`). `app.js` mounts into it; it doesn't create it.
- The title is a default; the app sets the title per page from its messages.
- No `theme-color` meta (the manifest carries it), no other scripts, no inline script.
- The favicon is sjvair.com's existing one.

### 4. The identity block

`json_script` element id `sjvair-identity`. Shape, version 1:

```json
{ "v": 1, "user": null }
```

```json
{
	"v": 1,
	"user": {
		"id": "<user.pk as a string>",
		"name": "<full_name>",
		"email": "<email, or null>",
		"emailVerified": false,
		"phoneVerified": true
	}
}
```

- **Never** `api_token`, and never the phone number.
- `emailVerified` is `false` until the email-only accounts track adds the field.
- A later shape bumps `v`; the app treats an unknown `v` or an unreadable block as anonymous
  (5b).
- 5a does not read it. The later session-identity endpoint (5b / server track) returns the
  same `user` object.

### 5. The CSP

- **The reference list is `csp-hosts.json` at this repo's root**: a JSON object mapping every
  directive in the header to its source list. `{static}` stands for the dashboard's static
  folder URL, which the view builds as `STATIC_URL + "workspace/"`. Initial content:

  | Directive         | Sources                                     |
  | ----------------- | ------------------------------------------- |
  | `default-src`     | `'none'`                                    |
  | `script-src`      | `'self'` `{static}`                         |
  | `style-src`       | `'self'` `{static}` `'unsafe-inline'`       |
  | `font-src`        | `'self'` `{static}`                         |
  | `img-src`         | `'self'` `{static}` `data:` `blob:`         |
  | `connect-src`     | `'self'` `{static}` (+ the Sentry ingest host) |
  | `worker-src`      | `'self'` `blob:`                            |
  | `manifest-src`    | `'self'`                                    |
  | `frame-ancestors` | `'none'`                                    |
  | `base-uri`        | `'none'`                                    |
  | `object-src`      | `'none'`                                    |
  | `form-action`     | `'none'`                                    |

  The Sentry ingest host is **left out** (no placeholder, so sjvair.com's header is always
  valid) until the user creates the dashboard's Sentry project; it is then added to both
  copies and the sjvair.com session is told. Until then a build with a DSN would have its
  reports blocked under an enforced CSP, which is why the DSN is only set once the host is
  listed. MapTiler and NREL are added with the map
  widget (a change to both copies).

- `'self'` is needed beside `{static}` because local development serves static files from the
  page's own origin. `form-action 'none'` holds because the app has no native form
  submissions (sign-in is a link to `/account/login/`).
- _(sjvair.com)_ The view keeps a copy beside it and builds the header from it; its test
  checks the header against its copy. A PR here that changes `csp-hosts.json` says so in its
  description, and the matching sjvair.com change goes with it.
- **Rollout** _(sjvair.com, decided by the user 2026-10-26)_: report-only while beta testers
  use it; a server setting (`WORKSPACE_CSP_ENFORCE`) switches to enforced before public
  go-live. Locally it is enforced from the start.
- **Reports:** to the dashboard's Sentry project security endpoint, from a server setting
  (`WORKSPACE_CSP_REPORT_URI`); unset means no report directive. The app also reports
  violations itself (section 3 of "What gets built").
- `X-Frame-Options: DENY` _(sjvair.com)_ agrees with `frame-ancestors 'none'`.

### 6. `version.json` and the manifest

- **`version.json`** is on the static host beside `app.js`; the app fetches it relative to the
  entry module with `cache: "no-store"` (already built in spec 3; the file moves from
  `assets/version.json` to the top level).
- **The manifest:** the build emits `dist/workspace/manifest.webmanifest`. _(sjvair.com)_
  Django reads its local copy and serves it at **`/workspace/manifest.webmanifest`** as
  `application/manifest+json`, rewriting each icon's relative `src` (e.g.
  `assets/icon-192-<hash>.png`) to `{% static 'workspace/' %}` plus that path. Icons stay on
  S3. The `/workspace/*` catch-all must not shadow this URL.
- The manifest's `start_url` and `scope` are `/workspace/`.

### 7. The route

_(sjvair.com)_ A `/workspace/*` route placed **before** the site's final catch-all, which
answers both `/workspace` and `/workspace/...` with or without a trailing slash and never
redirects. (The catch-all `PageTemplate` permanently redirects to a trailing slash, and the
dashboard's routes have none; browsers would remember a wrong permanent redirect.) The view
is decorated with `ensure_csrf_cookie`, sends `X-Robots-Tag: noindex` on
`/workspace/shared/*`, is uncached, and is gated by the `beta_tools` flag until go-live.

### 8. `csrftoken`

- **Production:** the view's `ensure_csrf_cookie` sets it on every page load.
- **Dev:** see "Dev proxy" below. The app gets the cookie with a GET of `/account/login/`
  through the proxy (its form renders `{% csrf_token %}`, so Django sets the cookie for
  anyone, signed in or not). Not the `/workspace/` view: the `beta_tools` gate answers 404
  before `ensure_csrf_cookie` runs for an unflagged user. No server endpoint is added.

### 9. The preview

_(sjvair.com, decided by the user 2026-10-26)_ The private preview is the `beta_tools` flag on
production, with a "My Dashboard" link under the existing beta-only "Data Tools" nav menu. No
staging app, so no extra S3 cross-origin origin. This settles the "Private-preview mechanism"
open decision in `DEFERRED.md`.

## What gets built

### 1. The embedding build

- **Vite config:** a relative `base` (so chunks and assets resolve from `import.meta.url`), a
  fixed-name entry (`app.js`, `app.css`), hashed names under `assets/`, output to
  `dist/workspace/`. The router's `basePath` stays `/workspace/`; it is independent of where
  files live.
- **Mount** into `#SJVAirDataDashboard` (replacing `#app` in `src/main.ts`).
- **A standalone `index.html`** is still produced (outside `dist/workspace/`, so the import
  doesn't copy it), with the same markup as the template (mount id, an anonymous identity
  block, the manifest link). `vite preview` and the existing E2E suite keep using it.
  _Builder's call:_ how the two outputs are produced (one build or two passes).
- **`version.json`** moves to the top level; the build-info plugin fails a production build
  when the id is `unknown`.
- `engines`, `.nvmrc`, and the Node 26 build job in CI.
- A test (unit or a build check in CI) asserting the contract's file list: the top-level names
  exist, everything else is under `assets/` with a hash, no `.map`/`.br`/`.gz` files.

### 2. The reload button under monitor-map's upload

Without `Cache-Control`, browsers may keep a heuristically cached old `app.js` after a deploy,
so "Reload" could load the old build again and the bar would come back. **Before reloading,
the update notice's Reload action re-fetches `app.js` and `app.css` (located relative to the
entry module) with `cache: "reload"`**, which refreshes the browser's cached copies, then
reloads. A failed re-fetch still reloads. Chunk-load failures mid-deploy already show the same
bar (spec 3). _My call; no contract change._

### 3. CSP reference list and violation reports

- `csp-hosts.json` as in the contract.
- **A test fails when code references an unlisted host:** it scans the source (and the built
  output) for absolute `http(s)://` URLs and checks each host against the list. Allowed
  exceptions (documentation links in comments, links the person follows such as sjvair.com's
  contact form, which are navigation, not fetches) are listed explicitly in the test.
  _Builder's call:_ the scan's exact mechanics.
- **The app listens for `securitypolicyviolation`** (through the platform adapter's error
  reporting) and reports the directive and the blocked host only (never the full blocked URL
  or the document URL's path beyond `/workspace/`), rate-limited so a loop can't flood.

### 4. Error reporting

- **A platform capability `errors`** (`report(error, context)`), added the same way spec 2
  added `activity`. The web implementation sends to Sentry; the in-memory test platform
  records calls.
- **Sentry loads lazily:** the capability buffers a few reports and dynamically imports the
  Sentry browser SDK on the first one (or after the app is idle; _builder's call_), so it is
  outside the initial bundle. With no `VITE_SENTRY_DSN` it is a no-op (dev logs to the
  console, as `report()` does today).
- **Scrubbing, as an allowlist:** sent are the error type and message, a stack with file
  names reduced to the file's base name, the build id as the release, the browser and OS
  family, the route _pattern_ (e.g. `/dashboards/:id`, not the id), and context keys from a
  fixed list of non-identifying fields (e.g. `operation`, `schemaVersion`, `storeName`). No
  breadcrumbs of user input, no request bodies, no URLs with query or fragment, no IP
  collection (`sendDefaultPii: false`), no session replay, no performance tracing. Messages
  are passed through a scrubber that strips emails, long digit runs, and coordinates. A unit
  test feeds a report containing a document, a Note, an email, and coordinates and checks none
  leave.
- **`report()` from spec 3** calls the capability.
- **The `DEFERRED.md` items waiting on the reporter are closed here:**
  - migration chain hardening: the bare `catch` in `loadDashboard`/`upgradeChanges` reports
    the error before treating the document as invalid;
  - `DocumentSession` commit-chain errors (failed save, catch-up, conflict resolution) are
    reported;
  - startup failures: a non-storage init failure shows a general "couldn't start" message (a
    new Paraglide message) and is reported, instead of "storage unavailable";
  - `clearAll`'s sibling rejections are caught and reported;
  - a failed starter hand-off shows the save-error state on the starter's indicator.

### 5. Licensing

- **`LICENSE`:** MIT, `Copyright (c) 2026 Central California Asthma Collaborative (SJVAir)`.
  `package.json` gets `"license": "MIT"`.
- **CI license check:** every production dependency (bundled into the build) must be MIT,
  BSD-2/3-Clause, Apache-2.0, ISC, 0BSD, MPL-2.0 (unmodified), or **OFL-1.1 for font
  packages only** (decided by the user 2026-10-26: Inter, via `@fontsource-variable/inter`,
  is OFL-1.1, the standard web-font license; its text goes in the notices). An explicit,
  commented exception list covers `@inlang/plugin-message-format` (empty npm `license`, MIT `LICENSE`
  file). Dev-only tools aren't bundled and aren't checked. Settles sharp's `allowScripts`
  question in the same change (sharp is dev-only through `@sveltejs/enhanced-img`; decide
  allow or skip, and record it). _Builder's call:_ the tool, which must itself be permissive.
- **Third-party notices:** the build writes `dist/workspace/THIRD-PARTY-NOTICES.txt` with the
  name, version, license, and license text of every bundled dependency. The privacy note links
  to it.

### 6. Bundle budget and browser floor

- **CI bundle budget:** the initial load (the bootstrap entry, plus the app chunk it imports
  and everything that chunk imports statically, JS and CSS) must be at most **200 KB compressed** (gzip, measured in CI; brotli would be
  smaller). The check fails the build over budget and prints the current size. Sentry and other
  lazy chunks are excluded by construction. Measured compressed even though uploads are
  uncompressed for now (the budget tracks the code, and compression is deferred, not dropped).
- **Build target:** the supported floor (Chrome/Edge 111, Safari 16.4, Firefox 128).
- **Unsupported-browser notice:** browsers below the floor may fail to parse the app's code at
  all, so the check must run before it. `app.js` is a small, conservatively written bootstrap:
  it feature-tests what the floor guarantees (e.g. CSS `@property` and `color-mix()` support,
  which Tailwind v4 needs, and the JS features the app uses), then dynamically imports the
  real app, or renders a short "Your browser is too old for this app" notice with a link to
  sjvair.com's map. _Builder's call:_ the exact feature tests and how the bootstrap stays
  parseable by older browsers. Browsers without module scripts show nothing (accepted; all are
  long out of support). The notice's text is a Paraglide message.

### 7. Installable and offline

- **The manifest** (`manifest.webmanifest`, emitted by the build): name and short name from
  the product name, `start_url` and `scope` `/workspace/`, `display: standalone`, theme and
  background colors from the theme tokens' values at build time, and icons. _Builder's call:_
  how the colors are read from the tokens so they aren't hardcoded twice.
- **Icons:** placeholders until the design pass: sjvair.com's existing
  `android-chrome-192x192.png` and `android-chrome-512x512.png`, copied into this repo, plus a
  maskable variant if one can be made without new art (otherwise recorded in `DEFERRED.md`
  for the design pass).
- **Offline banner:** a platform capability `online` (`online()` and `onChange(cb)`) from the
  browser's online/offline events. While offline, a notice bar says "You're offline. Data
  may be out of date." It uses the existing notice-bar component.

### 8. Dev proxy, `csrftoken`, and the dev-stack smoke suite

- **The Vite dev server proxies `/api/` and `/account/`** to the local podman sjvair.com
  (`http://localhost:8000` by default; overridable by an env var, _builder's call_ for its
  name). Dev becomes same-origin; `configureSdk` uses the page origin in dev, and
  `VITE_DEV_URL` is retired (removed from `.env.example`, `sdk-setup.ts`, and `CLAUDE.md`).
- **`csrftoken` bootstrap in dev:** in dev only, at startup, if there's no `csrftoken`
  cookie, the app does one GET of `/account/login/` through the proxy, which sets it (see the
  contract, section 8). If the stack isn't running it fails quietly; only cookie-based writes
  (none in 5a) would be affected.
- **No stack, no crash:** with nothing on port 8000, `npm run dev` still starts; API calls
  fail as they would offline.
- **Dev-stack smoke suite:** a separate Playwright project (not in CI, run by hand with the
  local stack up) that opens the dev data page and checks real data arrives through the
  proxy.

### 9. Local check of the real embedding

How embedding and the CSP are verified before anything is deployed:

1. Build this branch; the sjvair.com session's import (local mode, pointed at this checkout)
   copies `dist/workspace/` into the local sjvair.com stack.
2. Static files are served from the local stack's own origin, exactly as monitor-map is set
   up locally (the user, 2026-10-26: nothing stands in for S3). Cross-origin behavior
   (relative chunk loading from S3, fonts and `version.json` under the bucket's cross-origin
   rule, the CSP's `{static}` entry) is first exercised in the beta preview on production,
   where the CSP is report-only and errors reach Sentry (recorded in `DEFERRED.md`).
3. The CSP is **enforced** locally.
4. A Playwright suite in this repo (a separate project, run by hand, like the dev-stack
   smoke) gets past the `beta_tools` gate the way the sjvair.com session's plan provides
   (approved by the user 2026-10-26 in that design: a dev-only
   `seed_beta_tester` command creates a non-staff "Beta testers" user from
   `WORKSPACE_E2E_IDENTIFIER` and `WORKSPACE_E2E_PASSWORD`; the suite signs in at
   `/account/login/` with the form fields `identifier` and `password`), then opens `http://localhost:8000/workspace/` and checks: the app mounts; no
   `securitypolicyviolation` events and no console CSP errors; a lazy chunk and a font load
   from the static folder; `version.json` is fetched; a deep URL
   (`/workspace/dashboards/<id>`) and `/workspace` without a slash load without a redirect;
   `/workspace/manifest.webmanifest` returns the manifest with icon URLs in the static folder;
   the identity block is present and has no `api_token`; a `csrftoken` cookie is set.
5. The same suite runs in the sjvair.com session's browser check, so both sides use one
   definition of "embedding works".

### 10. Privacy note and feedback link

- **Privacy note:** a short, self-contained explanation (the user's choice, 2026-10-26),
  shown in a dialog from the shell (the dashboard menu and a footer-level link; _builder's
  call_ for placement): what is stored in this browser (dashboards, preferences); that your
  dashboards are not sent to SJVAir's server (showing data asks the server for that data, and
  a share link carries the dashboard inside the link itself); that error reports are sent without personal data and what they
  contain, that there is no analytics or tracking, and how to remove everything ("Clear my
  data"). It links to the third-party notices. Once sjvair.com has a privacy policy page (the
  email-only accounts track), the note links to it. All text is Paraglide messages.
- **Feedback link:** opens sjvair.com's contact form (`/contact/`) in a new tab (the user's
  choice). The form can't be pre-filled today; pre-filling the topic (and the share link for
  "Report this page") is a later server change (see "Deferrals").

## Testing

- Unit and browser tests for the new capabilities (`errors`, `online`), the scrubber, the
  reload refresh, the bootstrap's feature check, the manifest emission, and the CSP host scan.
- The build-output check and the bundle budget run in CI on every PR; the Node 26 build job
  too.
- Existing E2E keeps passing on all three engines against the standalone `index.html`, plus:
  the offline banner appears and clears; the unsupported-browser path (the bootstrap with a
  failing feature test) shows the notice; the privacy note opens and links to the notices.
- The dev-stack smoke and the embedding suite are separate Playwright projects, run by hand.

## Deferrals (added to `DEFERRED.md` in the same change)

- **Upload compression, cache headers, ordered passes, post-deploy check** (the user,
  2026-10-26: ship exactly as monitor-map does; solve together with monitor-map later). Why:
  keep shipping identical to monitor-map for now. Cost: about 3–4× the bytes on the wire, and
  old entry files may be served from browser caches after a deploy (mitigated by the reload
  refresh). Revisit together with monitor-map's upload, or when the low-end device check
  shows slow loads.
- **Contact form pre-fill** (topic, and the share link for "Report this page"). Revisit with
  the server-backed documents track (which builds "Report this page").
- **A maskable icon and real icons**, if not made in 5a. Revisit in the design pass.
- **Spec 5's sign-in side** is 5b, not a deferral, but the backup reminder's sign-in line
  entry is updated to say 5b.

## Docs updated in the same change

- `ARCHITECTURE.md` → "Template embedding": the mount id, the identity block's id and shape,
  `version.json` at the top level, the upload as monitor-map's (with the reload refresh), the
  `beta_tools` preview, the CSP rollout setting.
- `DEFERRED.md`: the deferrals above; "Private-preview mechanism" leaves "Open decisions" as
  decided; the spec-5 items closed here leave the register.
- `CLAUDE.md`: `VITE_DEV_URL` retired; the dev proxy; the new commands. (The OFL-1.1-for-fonts
  rule and the settled contract summary in `ARCHITECTURE.md` were recorded with this design.)
- `TODO.md` → "Start here".

## Done when

- `npm run build` produces the contract's `dist/workspace/` and the standalone `index.html`;
  the build-output check, license check, bundle budget, and Node 26 build pass in CI.
- All unit, browser, and E2E tests pass on Chromium, Firefox, and WebKit.
- The embedding suite exists and runs. **It is not a merge gate for 5a** (_my call_): it is
  run, and the result recorded in `TODO.md`, once the sjvair.com session's local template
  exists, against the local stack with the CSP enforced.
  Until it has passed, a `DEFERRED.md` entry tracks it (revisit when the hosting track's
  local build is ready).
- With a test DSN, a forced error reaches Sentry with nothing personal in it (checked by hand
  once the project exists; until then, the scrubber's unit test).
