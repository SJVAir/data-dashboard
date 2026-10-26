# Foundations spec 5a: shipping readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's build embeddable in sjvair.com's Django template exactly as the
hosting contract says, and add what shipping needs: the CSP reference list, scrubbed Sentry
reporting, licensing, the bundle budget, the browser floor, the manifest, the offline banner,
the dev proxy, a local embedding check, and the privacy note and feedback link.

**Architecture:** `app.js` becomes a tiny bootstrap that checks the browser floor, then
dynamically imports the real app (`src/main.ts`, now exporting `startApp`) and hands it the
static folder's URL. The build uses a relative base so every file finds its neighbors from
`import.meta.url`. New browser capabilities (`errors`, `online`) go through the platform
adapter like spec 2's `activity`. CI gains build checks (file layout, licenses, budget, Node
26). Two hand-run Playwright projects cover the local dev stack and the real embedding.

**Tech Stack:** Vite 8 (rolldown), Svelte 5 runes, TypeScript, Paraglide, Tailwind v4,
Vitest (unit + browser mode), Playwright, `@sentry/browser` (new, MIT, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` (read its
"Hosting contract" section before Task 1; it is the source of truth for names and paths).

## Global Constraints

- Output folder `dist/workspace/`; top-level fixed names exactly `app.js`, `app.css`,
  `version.json`, `manifest.webmanifest`, `THIRD-PARTY-NOTICES.txt`; everything else under
  `assets/` with a content hash; no `.map`, `.br`, `.gz` files.
- Mount element id `SJVAirDataDashboard`; identity block id `sjvair-identity` (5a doesn't read
  it; the standalone `index.html` carries `{"v":1,"user":null}`).
- `"engines": { "node": ">=24 <27" }`, `.nvmrc` = `24`.
- Build id: `BUILD_ID` → `GITHUB_SHA` → `git rev-parse HEAD`; a production build fails if it
  would be `unknown`; `vite dev` uses `"dev"`.
- Router `basePath` stays `/workspace/`.
- Initial load ≤ 200 KB gzip (bootstrap + app chunk + its static imports, JS and CSS).
- Browser floor: Chrome/Edge 111, Safari 16.4, Firefox 128.
- Licenses allowed for bundled code: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD,
  MPL-2.0 (unmodified), OFL-1.1 for font packages only; explicit exception
  `@inlang/plugin-message-format` (empty npm license, MIT file).
- Error reports never contain document bodies, Notes text, names, emails, coordinates, place
  references, account ids, URL queries or fragments, or dashboard ids.
- No direct browser-API calls outside `src/lib/platform/` (except the dev-only csrf
  bootstrap and the bootstrap's feature test, which run before the platform exists); every UI
  string a Paraglide message; styling from theme tokens; no inline scripts.
- Tabs, double quotes, no trailing commas, width 100; run `npm run format` before each commit.
- Commit messages carry no AI attribution.

## Review Focus

1. **A deep link loaded fresh** (`/workspace/dashboards/<id>`, and `/workspace` with no slash)
   must find `app.js` and its chunks; relative URLs resolved against the page URL instead of
   the module URL break only here. Pinned in Task 1 (E2E deep-link test).
2. **A new deploy while a tab is open**: the reload button must not loop on a cached old
   `app.js`. Pinned in Task 2 (refresh-before-reload test, failure still reloads).
3. **A report whose message or context carries personal data** (an email typed into a
   dashboard name, coordinates in an error message, a dashboard id in the route). Pinned in
   Task 4 (scrubber test with each).
4. **Sentry unreachable or blocked** (no DSN, CSP blocks it, offline): reporting must never
   throw into the app or retry forever. Pinned in Task 4 (no-DSN no-op and failing-import
   tests).
5. **`npm run dev` with no local sjvair.com stack**: the app must still start and the csrf
   bootstrap must fail quietly. Pinned in Task 11 (bootstrap with a rejecting fetch).

---

### Task 1: The embedding build

**Files:**
- Create: `src/bootstrap.ts`, `scripts/check-build-output.mjs`, `.nvmrc`
- Modify: `vite.config.ts`, `vite-plugins/build-info.ts`, `src/main.ts`, `index.html`,
  `package.json`, `.github/workflows/ci.yml`, `scripts/e2e-podman.sh`,
  `playwright.config.ts` (only if preview routing needs it), `e2e/helpers.ts` (if it
  references `#app`)
- Test: `vite-plugins/build-info.test.ts`, `e2e/embedding-build.spec.ts`

**Interfaces:**
- Produces: `startApp(opts: { target: HTMLElement; staticBase: URL }): Promise<void>` exported
  from `src/main.ts` (no top-level side effects any more). `staticBase` is the URL of the
  folder holding `app.js` (`new URL(".", import.meta.url)` in the bootstrap).
- Produces: `src/bootstrap.ts` is the build entry; for now it only does
  `import("./main").then((m) => m.startApp({ target, staticBase }))` with
  `target = document.getElementById("SJVAirDataDashboard")`. Task 3 adds the browser check.
- Produces: `resolveBuildId(command: "serve" | "build", env: NodeJS.ProcessEnv, gitHead: () => string | undefined): string`
  exported from `vite-plugins/build-info.ts`; throws `Error("Build id is unknown …")` for a
  build with nothing found.
- Produces: `npm run check:build` (runs `node scripts/check-build-output.mjs`), used by CI.

- [ ] **Step 1: Write the failing unit tests** in `vite-plugins/build-info.test.ts`:
  `resolveBuildId("serve", {}, () => "abc")` → `"dev"`; `("build", { BUILD_ID: "x" }, …)` →
  `"x"`; `("build", { GITHUB_SHA: "y" }, () => "z")` → `"y"`; `("build", {}, () => "z")` →
  `"z"`; `("build", {}, () => undefined)` throws `/unknown/`.
- [ ] **Step 2: Run** `npx vitest run --project unit vite-plugins/build-info.test.ts` —
  expect FAIL (`resolveBuildId` not exported). Add `vite-plugins/**/*.test.ts` to the unit
  project's `include` if needed.
- [ ] **Step 3: Implement** `resolveBuildId` and use it in `buildInfo()`; emit
  `version.json` at the output's top level (`fileName: "workspace/version.json"` or the
  equivalent for the chosen layout).
- [ ] **Step 4: Run** the unit test — expect PASS.
- [ ] **Step 5: Reshape the build.**
  - `vite.config.ts`: `base: command === "build" ? "./" : "/workspace/"`; input `index.html`;
    `entryFileNames: "workspace/app.js"`; entry CSS named `workspace/app.css`;
    `chunkFileNames: "workspace/assets/[name]-[hash].js"`, `assetFileNames:
    "workspace/assets/[name]-[hash][extname]"` (except the entry CSS);
    `build.modulePreload: { polyfill: false }`; `build.sourcemap: false`;
    `build.target: ["chrome111", "edge111", "safari16.4", "firefox128"]`;
    `build.manifest: true` (written to `dist/.vite/`, outside `dist/workspace/`, for Task 8).
  - `dist/index.html` is the standalone shell; its references to `app.js`/`app.css` must be
    absolute `/workspace/…` so deep routes work under `vite preview` (a small
    `transformIndexHtml` plugin, or whatever produces that; _your call_).
  - `index.html`: mount `<div id="SJVAirDataDashboard"></div>`, the anonymous identity block
    `<script type="application/json" id="sjvair-identity">{"v":1,"user":null}</script>`,
    `<link rel="manifest" href="/workspace/manifest.webmanifest">` (the file arrives in
    Task 9), `<title>SJVAir Dashboard</title>`, entry `src/bootstrap.ts`.
  - `vite preview` must serve `dist/` so that `/workspace/app.js` is
    `dist/workspace/app.js` and every `/workspace/*` route falls back to `dist/index.html`.
  - `src/main.ts`: export `startApp`; the version check fetches
    `new URL("version.json", staticBase)`.
- [ ] **Step 6: Write `scripts/check-build-output.mjs`**: fails (exit 1, listing problems)
  unless `dist/workspace/`'s top level holds only the contract's five names, with a
  `REQUIRED` list that starts as `app.js`, `app.css`, `version.json` (Task 7 adds
  `THIRD-PARTY-NOTICES.txt`, Task 9 adds `manifest.webmanifest`), every other file is under `assets/`
  and matches `-[A-Za-z0-9_-]{8,}\.`, and no file ends `.map`, `.br`, or `.gz`. Add
  `"check:build"` to `package.json`.
- [ ] **Step 7: Write the E2E test** `e2e/embedding-build.spec.ts`: going straight to
  `dashboards/<new id>` (create one first via the UI, then `page.goto` its URL in a new page)
  and to `/workspace` (no slash) both render the shell; `app.js` was requested from
  `/workspace/app.js` and at least one chunk from `/workspace/assets/`.
- [ ] **Step 8: Engines and CI.** `package.json`: `"engines": { "node": ">=24 <27" }`;
  `.nvmrc`: `24`. CI `checks` job: add `- run: npm run check:build` after `npm run build`.
  New job `build-node26` (Node 26, `npm ci`, `npm run build`, `npm run check:build`).
  `scripts/e2e-podman.sh`: pass `BUILD_ID` into the container (e.g. `BUILD_ID=$(git rev-parse HEAD)`)
  so the build there can't be `unknown`.
- [ ] **Step 9: Verify.** `npm run build && npm run check:build` passes; `npm test` and
  `npm run test:e2e` pass (existing suite plus the new spec); `ls dist/workspace` shows
  `app.js app.css version.json assets`.
- [ ] **Step 10: Commit** (`Build the embedding output for sjvair.com`).
- [ ] **Step 11: Tell the sjvair.com session** (SendMessage `sjvair-com-0e`) that
  `foundations-5a-shipping` builds `dist/workspace/` (with the commit hash, and that the
  manifest and notices arrive in later tasks), and push the branch so it can clone it.

### Task 2: Reload refreshes the cached entry files

**Files:**
- Create: `src/lib/safety/reload.ts`
- Modify: `src/lib/components/shell/NoticeBars.svelte` (its `reload()`), `src/main.ts`
  (provide the base)
- Test: `src/lib/safety/reload.test.ts`

**Interfaces:**
- Consumes: `staticBase: URL` from Task 1.
- Produces: `refreshEntryFiles(staticBase: URL, fetchFn?: typeof fetch): Promise<void>` —
  fetches `app.js` and `app.css` relative to `staticBase` with `{ cache: "reload" }` in
  parallel, never rejects, gives up after 5 s. `NoticeBars`'s reload awaits it, then
  reloads. It gets `staticBase` from the app context (add `staticBase` to `AppContext`), and
  skips the refresh when `BUILD_ID === "dev"`.

- [ ] **Step 1: Write failing tests**: called with a fake fetch, it requests exactly
  `https://s.example/static/workspace/app.js` and `…/app.css` with `cache: "reload"` for
  `staticBase = new URL("https://s.example/static/workspace/")`; resolves when fetch rejects;
  resolves within the timeout when fetch never settles (fake timers).
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/safety/reload.test.ts` — FAIL.
- [ ] **Step 3: Implement** `refreshEntryFiles` and wire `NoticeBars` (existing
  `notice-bars.browser.test.ts` keeps passing; add a case that reload calls the refresh
  before `location.reload`, through whatever seam the component already uses for reload).
- [ ] **Step 4: Run** unit + browser tests — PASS.
- [ ] **Step 5: Commit** (`Refresh cached entry files before reloading`).

### Task 3: Unsupported-browser notice

**Files:**
- Modify: `src/bootstrap.ts`, `messages/en.json`, `scripts/check-build-output.mjs`
- Create: `src/lib/browser-floor.ts`
- Test: `src/lib/browser-floor.test.ts`, `e2e/unsupported-browser.spec.ts`

**Interfaces:**
- Produces: `meetsFloor(css: { supports(p: string, v: string): boolean; registerProperty?: unknown } | undefined): boolean`
  — true only if `typeof css.registerProperty === "function"` and
  `css.supports("color", "color-mix(in lab, red, red)")` (together these match the floor:
  `@property` reached Firefox 128 and Safari 16.4; `color-mix()` reached Chrome 111).
- Produces: `renderTooOld(target: HTMLElement): void` — replaces the target's children with a
  paragraph `m.browser_too_old()` and a link `m.browser_too_old_link()` to
  `https://www.sjvair.com/`.
- New messages: `browser_too_old`: "Your browser is too old for this app. Please update it, or
  use another browser." `browser_too_old_link`: "Go to the SJVAir air quality map".

- [ ] **Step 1: Failing unit tests** for `meetsFloor`: `undefined` → false; no
  `registerProperty` → false; `supports` false → false; both → true.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both functions; `bootstrap.ts` calls
  `meetsFloor(globalThis.CSS)` first and renders the notice instead of importing the app.
  Write `bootstrap.ts` and `browser-floor.ts` in plain syntax (no optional chaining or `??`
  needed); keep the bootstrap's import graph to these two modules plus the Paraglide messages
  it uses.
- [ ] **Step 4: Extend `check-build-output.mjs`**: parse `dist/workspace/app.js` with acorn
  (`ecmaVersion: 2020, sourceType: "module"`) and fail if it doesn't parse, so the bootstrap
  stays readable by browsers older than the floor.
- [ ] **Step 5: E2E** `e2e/unsupported-browser.spec.ts`: with `page.addInitScript` deleting
  `CSS.registerProperty`, the page shows the too-old text and link and no app nav.
- [ ] **Step 6: Run** unit tests, `npm run build && npm run check:build`, the new E2E — PASS.
- [ ] **Step 7: Commit** (`Show a notice in browsers below the floor`).

### Task 4: Error reporting through the platform

**Files:**
- Create: `src/lib/platform/web/errors.ts`, `src/lib/errors/scrub.ts`
- Modify: `src/lib/platform/types.ts`, `src/lib/platform/memory.ts`,
  `src/lib/platform/web/storage.ts` (`createWebPlatform` wires it), `src/lib/safety/report.ts`,
  `src/vite-env.d.ts` (`VITE_SENTRY_DSN`), `.env.example`, `package.json`
- Test: `src/lib/errors/scrub.test.ts`, `src/lib/platform/web/errors.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  ```ts
  export type ReportContext = Record<string, string | number | boolean | null | undefined>;
  export interface ErrorReporter {
  	/** Never throws; drops the report if it can't be sent. */
  	report(error: unknown, context?: ReportContext): void;
  }
  ```
  and `errors: ErrorReporter` on `Platform`. The memory platform records calls in
  `reports: Array<{ error: unknown; context?: ReportContext }>`.
- Produces in `scrub.ts`: `ALLOWED_CONTEXT_KEYS` (exactly: `operation`, `schemaVersion`,
  `fromSchemaVersion`, `storeName`, `reason`, `directive`, `blockedHost`, `status`, `kind`),
  `scrubText(s: string): string` (replaces emails with `[email]`, runs of 6+ digits with
  `[number]`, decimal coordinate-like numbers `-?\d{1,3}\.\d{3,}` with `[coord]`, UUIDs with
  `[id]`), `scrubContext(c?: ReportContext): ReportContext` (drops unlisted keys, scrubs
  string values), `routePattern(pathname: string): string` (`/workspace/dashboards/abc` →
  `/dashboards/:id`; unknown paths → `/other`).
- Produces in `web/errors.ts`: `createWebErrors(opts: { dsn: string | undefined; release: string; dev: boolean; loadSentry?: () => Promise<SentryLike> }): ErrorReporter`.
  No DSN: logs to the console in dev, otherwise does nothing. With a DSN: buffers up to 10
  reports, imports `@sentry/browser` on the first report, initializes it once with
  `dsn`, `release`, `sendDefaultPii: false`, `defaultIntegrations: false` plus only the
  global-error and unhandled-rejection handlers, no tracing, no replay, `beforeSend` and
  `beforeBreadcrumb` (drops all breadcrumbs) applying the scrubber to the message, exception
  values, stack frame file names (base name only), `request.url` (replaced by the route
  pattern), and `contexts`/`extra` (via `scrubContext`). A failed import empties the buffer
  and disables reporting for the session. At most 20 reports per page load.
- Produces: `report(error, context)` in `src/lib/safety/report.ts` calls
  `platform().errors.report`, falling back to the dev console log if the platform isn't set.
- Also in `web/errors.ts`: `listenForCspViolations(reporter: ErrorReporter, target: EventTarget): () => void`
  — on `securitypolicyviolation`, reports `new Error("CSP violation")` with
  `{ directive: e.effectiveDirective, blockedHost: <host of e.blockedURI, or the keyword like "inline"> }`,
  at most 5 per page load. `createWebPlatform` starts it on `document`.

- [ ] **Step 1: Failing scrub tests**: `scrubText("mail ana@example.org at 36.7378, -119.7871")`
  contains neither `ana@example.org` nor `36.7378` nor `-119.7871`;
  `scrubContext({ operation: "save", name: "Ana's class", docId: "x", note: "hi" })` →
  `{ operation: "save" }`; `routePattern("/workspace/dashboards/3f2a…")` →
  `"/dashboards/:id"`, `routePattern("/workspace/import")` → `"/import"`.
- [ ] **Step 2: Failing reporter tests** with a fake `loadSentry`: no DSN → `loadSentry` never
  called and nothing throws; with a DSN, two reports before the import resolves are both
  captured after it; `loadSentry` rejecting → later reports are dropped without throwing; the
  21st report is dropped; the `beforeSend` passed to `init` turns an event containing an email
  in `message`, a dashboard URL in `request.url`, and `extra.docId` into one with none of
  them; three CSP events with the same directive produce reports carrying only `directive`
  and `blockedHost`.
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement**; add `@sentry/browser` to `dependencies`; `VITE_SENTRY_DSN=` to
  `.env.example` with a comment ("unset = error reporting off"); add the memory platform's
  `errors`; the capability contract needs no change (reporting isn't storage).
- [ ] **Step 5: Run** unit + browser tests and `npm run build`; confirm with the build
  manifest that `@sentry/browser` code is only in a lazily imported chunk.
- [ ] **Step 6: Commit** (`Report errors to Sentry through the platform, scrubbed`).

### Task 5: Close the deferred items waiting on the reporter

**Files:**
- Modify: `src/lib/documents/load.ts` (the bare `catch` near line 52),
  `src/lib/changes/rebase.ts`/`undo.ts` only if they swallow errors silently,
  `src/lib/store/document-session.svelte.ts` (each place that sets `status = "error"`, and
  the starter hand-off), `src/lib/boot.ts`, `src/lib/platform/web/storage.ts` (`clearAll`),
  `messages/en.json`, `DEFERRED.md`
- Test: existing `*.test.ts` beside each file, plus `src/lib/boot.test.ts` if missing

**Interfaces:**
- Consumes: `report()` (Task 4) and the memory platform's `reports`.
- New message `startup_failed`: "Something went wrong while starting the workspace. Reloading
  the page may help."

- [ ] **Step 1: Failing tests**, one per item:
  - `loadDashboard` given a document whose migration throws returns the invalid result **and**
    one report with `operation: "migrate"`;
  - a `DocumentSession` whose storage commit rejects ends in `status === "error"` and has one
    report with `operation: "save"` (likewise one catch-up failure → `operation: "catch-up"`);
  - `boot` whose `start` throws a non-storage error shows `m.startup_failed()` (not
    `storage_unavailable`) and reports it; a `createPlatform` rejection still shows
    `storage_unavailable`;
  - `clearAll` where two stores reject produces no unhandled rejection (listen for
    `unhandledrejection`) and rejects once;
  - a starter session whose hand-off fails (storage full) shows `status === "error"`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the reports (context keys only from `ALLOWED_CONTEXT_KEYS`), the
  new boot message, the `clearAll` catch (settle all clears, then rethrow the first error),
  and the starter status.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: `DEFERRED.md`**: remove "Migration chain hardening", "DocumentSession
  durability gaps", "Startup failures all read as 'storage unavailable'", "`clearAll` leaves
  sibling rejections unhandled", and "A failed starter hand-off (storage full) shows no save
  error on the starter" (done).
- [ ] **Step 6: Commit** (`Report recovered errors and fix the reporter-dependent leftovers`).

### Task 6: The CSP reference list

**Files:**
- Create: `csp-hosts.json`, `src/csp-hosts.test.ts`
- Modify: `scripts/check-build-output.mjs`

**Interfaces:**
- Produces: `csp-hosts.json` exactly the contract's table (directive → array of sources,
  `{static}` placeholder; `font-src` is `["'self'", "{static}"]`; no Sentry host yet).

- [ ] **Step 1: Write the test** `src/csp-hosts.test.ts` (unit project): (a) the JSON has
  exactly the 12 directives from the contract with the contract's sources; (b) every
  absolute `http(s)://` URL in `src/**/*.{ts,svelte,css}` (excluding tests and
  `src/lib/paraglide/`) has a host that is in some directive's list, or is on the test's
  explicit navigation allowlist (`www.sjvair.com` for links the person follows), with a
  comment saying why each allowlisted host isn't fetched.
- [ ] **Step 2: Run** — it fails until the file exists; create `csp-hosts.json`; run — PASS.
  Prove the scan bites: temporarily add `fetch("https://evil.example/x")` to a source file,
  see the test fail naming `evil.example`, remove it.
- [ ] **Step 3: Built-output scan** in `check-build-output.mjs` (telling fetch URLs apart in
  minified code isn't practical, so it's deliberately broad): list every distinct `https?://host` in `dist/workspace/**/*.{js,css}` and fail on a
  host that is neither in `csp-hosts.json` nor in a commented allowlist of known non-fetch
  strings (e.g. `www.w3.org` namespaces, documentation links inside dependencies, Sentry's
  own default hosts which are unused while no DSN host is listed). Print the hosts found.
- [ ] **Step 4: Run** `npm run build && npm run check:build` — PASS.
- [ ] **Step 5: Commit** (`Add the CSP reference list and host checks`). The PR description
  must say `csp-hosts.json` is new, for the sjvair.com mirror.

### Task 7: Licensing

**Files:**
- Create: `LICENSE`, `scripts/licenses.mjs` (only if the plugin route below doesn't work)
- Modify: `package.json`, `vite.config.ts` (or the script), `.github/workflows/ci.yml`,
  `scripts/check-build-output.mjs` (add the notices file to `REQUIRED`)
- Test: `scripts/licenses.test.mjs` or a unit test of the allow function

**Interfaces:**
- Produces: `isAllowedLicense(pkg: { name: string; license?: string; isFont?: boolean }): boolean`
  implementing the Global Constraints list (SPDX expressions with `OR` pass if any side
  passes; `AND` needs all; OFL-1.1 only when the package is a font, detected as a
  `@fontsource*` scope or a `fonts` keyword).
- Produces: `dist/workspace/THIRD-PARTY-NOTICES.txt` listing, for every package with code in
  the bundle, name, version, license, and full license text.

- [ ] **Step 1: Failing tests** for `isAllowedLicense`: MIT, ISC, `(MIT OR GPL-3.0)` → true;
  `GPL-3.0`, `UNLICENSED`, missing → false; `OFL-1.1` for `@fontsource-variable/inter` → true,
  for a non-font package → false; `@inlang/plugin-message-format` with empty license → true
  (named exception).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Preferred: `rollup-plugin-license`
  (MIT) in the Vite build, with `thirdParty.allow` calling `isAllowedLicense` and
  `thirdParty.output` writing the notices file — but only if it works with Vite 8's rolldown
  (verify that the notices list includes `svelte`, `bits-ui`, `@fontsource-variable/inter`).
  Otherwise a script that reads the module list from the build (the rolldown/Vite manifest or
  a small plugin recording `moduleParsed` package roots) and does both. Either way the build
  fails on a disallowed license.
- [ ] **Step 4: `LICENSE`** (MIT, `Copyright (c) 2026 Central California Asthma
  Collaborative (SJVAir)`), `"license": "MIT"` in `package.json`.
- [ ] **Step 5: sharp's install script**: decide `allowScripts` (sharp is dev-only through
  `@sveltejs/enhanced-img`; it needs its script to fetch its binary) and record the decision
  in the commit message and `DEFERRED.md` (remove the sharp half of "CI and dependency loose
  ends"; also its inlang-license half, now handled).
- [ ] **Step 6: Run** `npm run build && npm run check:build` (notices file present, mentions
  Inter's OFL text) and the tests — PASS.
- [ ] **Step 7: Commit** (`Add the MIT license, a license check, and third-party notices`).

### Task 8: The bundle budget

**Files:**
- Create: `scripts/check-budget.mjs`
- Modify: `package.json` (`"check:budget"`), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `dist/.vite/manifest.json` (Task 1).
- Produces: `npm run check:budget` — sums gzip sizes (Node `zlib.gzipSync`, level 9) of the
  bootstrap entry, the chunk it dynamically imports for the app (`src/main.ts`), and every
  chunk and CSS file reachable from those through **static** imports; prints each file and
  the total; exits 1 above `200 * 1024` bytes.

- [ ] **Step 1:** Write the script with an exported `initialFiles(manifest, entryKey): string[]`
  and a test (`scripts/check-budget.test.mjs`, run in the unit project) using a fake manifest:
  static imports included, dynamic imports other than `src/main.ts` excluded, CSS included,
  no file counted twice.
- [ ] **Step 2: Run** — FAIL, implement, PASS.
- [ ] **Step 3:** `npm run build && npm run check:budget` prints a total under 200 KB (about
  172 KB expected); confirm the Sentry chunk is not listed. CI `checks` job runs it after the
  build.
- [ ] **Step 4: Commit** (`Enforce the initial bundle budget in CI`).

### Task 9: The web app manifest

**Files:**
- Create: `vite-plugins/web-manifest.ts`, `static-src/icons/icon-192.png`,
  `static-src/icons/icon-512.png` (copied from
  `../sjvair.com/assets/img/favicon/android-chrome-192x192.png` and `-512x512.png`)
- Modify: `vite.config.ts`, `scripts/check-build-output.mjs` (add the manifest to `REQUIRED`),
  `messages/en.json` if names come from messages
- Test: `vite-plugins/web-manifest.test.ts`

**Interfaces:**
- Produces: `buildManifest(opts: { name: string; shortName: string; themeColor: string; backgroundColor: string; icons: Array<{ src: string; sizes: string }> }): object`
  and the plugin `webManifest()`, which emits the icons as hashed assets under
  `workspace/assets/` and writes `workspace/manifest.webmanifest` with icon `src` values
  **relative to the manifest file** (e.g. `assets/icon-192-<hash>.png`), `start_url` and
  `scope` `/workspace/`, `display: "standalone"`, `type: "image/png"`.
- Colors: the light theme's `--background` (background) and `--primary` (theme) from
  `src/app.css`, converted from `oklch(...)` to `#rrggbb` at build time (_your call_ how;
  a tiny conversion function with a test beats a new dependency).
- Name: `m.app_name()`'s English value from `messages/en.json` read at build time, so it
  isn't written twice.

- [ ] **Step 1: Failing tests**: `buildManifest` output has the fields above;
  `oklch(1 0 0)` → `#ffffff`, `oklch(0.205 0 0)` → `#171717` (±1 per channel); the plugin
  run in a test build (or via `generateBundle` with a fake context) emits a manifest whose
  icon `src` values point at emitted files.
- [ ] **Step 2: Run** — FAIL, implement, PASS.
- [ ] **Step 3:** For `vite dev` and `vite preview`, serve `/workspace/manifest.webmanifest`
  (dev: a middleware returning the generated manifest; preview: the built file is at
  `dist/workspace/manifest.webmanifest`, already at that URL). E2E (add to
  `e2e/embedding-build.spec.ts`): the manifest URL returns JSON with `start_url`
  `/workspace/` and an icon that loads.
- [ ] **Step 4: Run** `npm run build && npm run check:build` — PASS with all five top-level
  files required. Record "a maskable icon and real icons" in `DEFERRED.md` (design pass) if
  no maskable icon was made.
- [ ] **Step 5: Commit** (`Emit the web app manifest and placeholder icons`).

### Task 10: Offline banner

**Files:**
- Create: `src/lib/platform/web/online.ts`
- Modify: `src/lib/platform/types.ts`, `src/lib/platform/memory.ts`,
  `src/lib/platform/web/storage.ts`, `src/lib/components/shell/NoticeBars.svelte`,
  `messages/en.json`
- Test: `src/lib/platform/web/online.test.ts`, `notice-bars.browser.test.ts`,
  `e2e/offline.spec.ts`

**Interfaces:**
- Produces: `export interface OnlineSource { online(): boolean; onChange(cb: (online: boolean) => void): () => void; }`
  and `online: OnlineSource` on `Platform`; `createWebOnline(win: Pick<Window, "addEventListener" | "removeEventListener">, nav: { onLine: boolean }): OnlineSource`;
  the memory platform's version has `setOnline(v: boolean)`.
- New message `offline_notice`: "You're offline. Data may be out of date."

- [ ] **Step 1: Failing tests**: the web source reports `nav.onLine`, calls back on
  `offline`/`online` events, and the returned function stops it; `NoticeBars` shows
  `offline_notice` while the memory platform is offline and hides it after `setOnline(true)`.
- [ ] **Step 2: Run** — FAIL, implement, PASS.
- [ ] **Step 3: E2E** `e2e/offline.spec.ts`: `context.setOffline(true)` shows the notice;
  `setOffline(false)` hides it.
- [ ] **Step 4: Commit** (`Show an offline banner`).

### Task 11: Dev proxy, csrf bootstrap, dev-stack smoke suite

**Files:**
- Create: `src/lib/dev/csrf-bootstrap.ts`, `playwright.local.config.ts`,
  `e2e-local/dev-stack.spec.ts`
- Modify: `vite.config.ts` (`server.proxy`), `src/lib/sdk-setup.ts`, `src/vite-env.d.ts`,
  `src/main.ts`, `.env.example`, `package.json`, `CLAUDE.md`
- Test: `src/lib/dev/csrf-bootstrap.test.ts`, `src/lib/sdk-setup.test.ts`

**Interfaces:**
- Produces: dev proxy for `/api/` and `/account/` to `process.env.SJVAIR_DEV_SERVER ??
  "http://localhost:8000"` (`changeOrigin: false` so Django sees the dev host; adjust only if
  Django's `ALLOWED_HOSTS` rejects it locally, and note it).
- Produces: `ensureDevCsrfCookie(opts: { dev: boolean; cookie: string; fetchFn: typeof fetch }): Promise<void>`
  — does nothing unless `dev` and `cookie` has no `csrftoken=`; then one
  `fetchFn("/account/login/", { credentials: "same-origin" })`; never rejects.
  `startApp` calls it with `document.cookie` (dev-only, so outside the platform adapter
  rule; say so in a comment).
- `configureSdk(env: { DEV: boolean; VITE_PROD_URL?: string }, pageOrigin: string)` —
  `VITE_DEV_URL` removed; dev always uses the page origin.
- npm scripts: `"test:dev-stack": "playwright test -c playwright.local.config.ts --project=dev-stack"`.

- [ ] **Step 1: Failing tests**: `ensureDevCsrfCookie` with `dev: false` or a cookie
  containing `csrftoken=abc` makes no request; with `dev: true` and no cookie it requests
  `/account/login/` once; with a rejecting fetch it resolves. `sdk-setup.test.ts`: drop the
  `VITE_DEV_URL` cases; dev uses the page origin; `VITE_PROD_URL` still overrides in
  production.
- [ ] **Step 2: Run** — FAIL, implement, PASS.
- [ ] **Step 3: Local Playwright config** `playwright.local.config.ts`: no `webServer`;
  projects `dev-stack` (`testDir: "e2e-local"`, `testMatch: "dev-stack.spec.ts"`, baseURL
  `http://localhost:5173/workspace/`) and `embedding` (Task 12). Not run in CI.
  `e2e-local/dev-stack.spec.ts`: opens `dev/data`, waits for a real API response through
  `/api/` with status 200, and checks a `csrftoken` cookie exists afterwards.
- [ ] **Step 4: Verify by hand** with the local podman stack up: `npm run dev`, then
  `npm run test:dev-stack` passes. With the stack down, `npm run dev` still serves the app
  (the dev data page shows its fetch error; no crash).
- [ ] **Step 5: Docs**: `.env.example` drops `VITE_DEV_URL`, adds
  `# SJVAIR_DEV_SERVER=http://localhost:8000  (dev proxy target)`; `CLAUDE.md` → Commands
  (`test:dev-stack`, `test:embedding`, `check:build`, `check:budget`) and Environment
  Variables (`VITE_DEV_URL` gone, `VITE_SENTRY_DSN` live, the proxy).
- [ ] **Step 6: Commit** (`Proxy dev to the local sjvair.com stack`).

### Task 12: The embedding suite

**Files:**
- Create: `e2e-local/embedding.spec.ts`
- Modify: `playwright.local.config.ts`, `package.json`

**Interfaces:**
- Consumes: the hosting track's local stack (template, `seed_beta_tester`, env vars
  `WORKSPACE_E2E_IDENTIFIER`, `WORKSPACE_E2E_PASSWORD`).
- Produces: `"test:embedding": "playwright test -c playwright.local.config.ts --project=embedding"`;
  project `embedding` with baseURL `http://localhost:8000/workspace/`. The spec skips with a
  clear message when the env vars are unset.

- [ ] **Step 1: Write the spec**: sign in at `/account/login/` (fields `identifier`,
  `password`), then on `/workspace/`, collecting `securitypolicyviolation` events through
  `page.addInitScript` and console messages:
  - the app mounts in `#SJVAirDataDashboard`;
  - zero violations and no console messages matching `/Content Security Policy/i`;
  - a lazily loaded chunk and a font were fetched from the static folder (`/static/workspace/`
    locally);
  - `version.json` was fetched;
  - `/workspace/dashboards/<id of a dashboard created in the test>` and `/workspace` (no
    slash) load with no redirect (`response.request().redirectedFrom()` is null) and render;
  - `/workspace/manifest.webmanifest` is `application/manifest+json` and its icon `src` values
    start with the static folder URL;
  - `#sjvair-identity` parses, has `v: 1` and a `user` object without `api_token` or `phone`;
  - a `csrftoken` cookie is set.
- [ ] **Step 2: Run it** if the hosting track's local build exists
  (`npm run test:embedding`); otherwise run the parts that work against `vite preview` by
  pointing baseURL there to prove the spec itself is sound, and leave the `DEFERRED.md`
  "embedding suite's first run" entry in place.
- [ ] **Step 3: Commit** (`Add the hand-run embedding suite`). Tell the sjvair.com session
  the suite exists and how to run it.

### Task 13: Privacy note and feedback link

**Files:**
- Create: `src/lib/components/dialogs/PrivacyDialog.svelte`,
  `src/lib/components/shell/HelpMenu.svelte`
- Modify: `src/lib/components/shell/TopNav.svelte`, `src/App.svelte`, `messages/en.json`,
  the dialog state store the other dialogs use
- Test: `src/lib/components/dialogs/privacy-dialog.browser.test.ts`, `e2e/privacy.spec.ts`

**Interfaces:**
- Produces: a help menu at the right of the top nav (an icon button labeled
  `m.help_menu()`) with two items: `m.privacy_open()` ("Your data and privacy") opening
  `PrivacyDialog`, and `m.feedback_link()` ("Send feedback") — a link to
  `https://www.sjvair.com/contact/` with `target="_blank" rel="noopener"`. _Your call_ whether
  the items are registered actions or plain menu items, following how `DashboardPicker` does
  it.
- `PrivacyDialog` content, each paragraph its own message (`privacy_title`,
  `privacy_local`, `privacy_server`, `privacy_errors`, `privacy_no_tracking`,
  `privacy_clear`, `privacy_notices_link`). The substance (final wording is the
  implementer's, plain and short, in the spec's tone):
  - dashboards and settings are stored in this browser;
  - your dashboards aren't sent to SJVAir's server; showing data asks the server for that
    data; a share link carries the dashboard inside the link itself;
  - when something breaks, an error report is sent without your dashboards, names, emails, or
    locations: just what went wrong, the app version, and the browser type;
  - no analytics or tracking;
  - "Clear my data" removes everything from this browser (a button that opens the existing
    Clear my data dialog);
  - a link to the third-party notices (`new URL("THIRD-PARTY-NOTICES.txt", staticBase)`).

- [ ] **Step 1: Failing browser test**: opening the dialog shows the title and each
  paragraph; the Clear button opens the Clear my data dialog; the notices link's `href` ends
  with `THIRD-PARTY-NOTICES.txt`; the feedback link points at `/contact/` and opens in a new
  tab.
- [ ] **Step 2: Run** — FAIL, implement, PASS.
- [ ] **Step 3: E2E** `e2e/privacy.spec.ts` (the menu opens, the dialog opens, axe finds no
  violations with it open — reuse the a11y helper).
- [ ] **Step 4: Commit** (`Add the privacy note and feedback link`).

### Task 14: Docs and the finish

**Files:**
- Modify: `ARCHITECTURE.md`, `DEFERRED.md`, `TODO.md`, `CLAUDE.md`,
  `docs/superpowers/specs/2026-10-26-foundations-5a-shipping-design.md` (only the seeded
  beta tester's status: approved 2026-10-26)

- [ ] **Step 1: `ARCHITECTURE.md`**: "Template embedding" — the bootstrap entry and
  `startApp(staticBase)`, `version.json` at the top level, the reload refresh; "Platform
  strategy" — the `errors` and `online` capabilities; "Sign-in flow" → Development — the proxy
  target variable and the `/account/login/` csrf bootstrap; "Licensing" — the check's
  mechanism; "Browser support" — the bootstrap's feature test.
- [ ] **Step 2: `DEFERRED.md`**: confirm every item closed by Tasks 5 and 7 is gone and every
  new deferral (maskable icon if any; anything deferred during the build) is there with why
  and a trigger.
- [ ] **Step 3: `TODO.md` → "Start here"**: 5a built, what's left (Sentry project and its
  host, the embedding suite's first run, 5b next).
- [ ] **Step 4: Full verification**: `npm run lint && npm run check && npm test && npm run
  build && npm run check:build && npm run check:budget && npm run test:e2e:podman` — all
  pass on Chromium, Firefox, and WebKit.
- [ ] **Step 5: Commit** (`Update docs for spec 5a`), then a whole-branch review before the PR
  into `foundations`.
