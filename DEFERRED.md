# Deferred work

**The single register of everything deliberately deferred or ruled out.** Nothing leaves this
file except by being done (move it to `TODO.md` → Done) or explicitly dropped by the user
(move it to "Dropped" with the date and reason). Specs, plans, and other docs link here
instead of keeping their own deferred lists.

Each entry records **why** it was deferred and **what should trigger revisiting it**.

---

## Platform & infrastructure

- **Initial bundle: the hand-kept `BARRELED` list and further trims.** _Deferred 2026-11-04
  (step 4 spec 1, Task 15)._ The build keeps the app chunk's modules in one file
  (`appGroup()` in `vite.config.ts`), found by walking the static imports from `src/main.ts`.
  Packages reached through a barrel (today date-fns' index and Paraglide's `m`) are listed by
  hand in `BARRELED` and left to the bundler, since the walk reaches all of them but only the
  used ones are bundled; a new barrel-imported package used only by lazy code would otherwise
  land in the initial bundle. Further trims found but not needed to get under budget (195.7 KB
  after Task 15): Conflict and Remote decision as on-demand dialogs (about 1.5 KB), mounting
  the toaster at idle (about 8 KB), and `zod/mini` in place of classic zod (whose
  `toJSONSchema` processors add about 8.5 KB; a bigger change). **Revisit when**
  `check:budget` jumps after adding a package (check whether it needs a `BARRELED` entry), or
  when the budget is next over.
- **bits-ui helpers in `BARRELED` (initial bundle near the budget).** _Deferred 2026-11-05
  (step 4 spec 3, Tasks 9–11)._ To keep Get data's bits-ui primitives (Select, Accordion,
  Collapsible, Toggle Group, Alert Dialog) out of the initial bundle, `vite.config.ts`'s
  `BARRELED` names them and some bits-ui helpers by hand (some used only by Select); a bits-ui
  upgrade that renames or moves them may pull them back into the app chunk. After this spec the
  initial bundle is about 199.6 KB of the 200 KB soft budget. **Revisit on** a bits-ui upgrade (re-run
  `check:budget`), or a change to how `appGroup()` treats re-exports.
- **The initial bundle over 200 KB again.** _Trimmed 2026-11-04 (step 4 spec 1)_, this once:
  from 213.9 KB gzip (the design pass plus the SDK bump and the widget groundwork) to 195.9 KB,
  by loading rarely used dialogs and the dashboards list on demand and keeping uPlot, the data
  layer, and each widget type's code out of the initial bundle. The budget is a soft limit
  (`check:budget` warns, never fails). **Revisit when** `check:budget` warns again (the user:
  decide then, trim or raise the budget, rather than trimming every time).
- **The initial bundle size (soft budget raised to 250 KB, 2026-11-10).** The user, during step
  4 spec 6 (205.3 KB then): change the limit to 250 KB "so this question stops being a pain
  point halting our work"; if the bundle is too big, address it later. Sessions no longer stop to
  ask about growth under 250 KB. History below.
  **Earlier: a little over 200 KB after step 4 specs 4 and 5 (accepted for now).**
  _Deferred 2026-11-08 (step 4 spec 4, Task 10 and Task 14); updated 2026-11-09 (spec 5)._
  `check:budget` reads 204.8 KB gzip against the 200 KB soft budget (199.7 KB before spec 4,
  202.1 KB after it). Spec 4's growth is the three widget descriptors, the dashboard menu's
  Notifications item, and the `thresholds` field in the change schema; spec 5's is the two calendar
  descriptors, their date and place-spot helpers, and the registry's new fields (`defaultRange`,
  `menu(ctx, env)`, `accepts.onlyPollutant`); the calendars' own code is lazy. The user accepted
  the spec 4 growth on 2026-11-08 and the calendars' on 2026-11-09, and accepted the final
  204.8 KB for now on 2026-11-09 (no trim, budget unchanged).
  Candidates if trimming later: lazy-load the widget type icons, drop the menu item's icon.
  **Revisit when** `check:budget` grows further, or before step 4 merges into `main`.
- **Upload compression, cache headers, ordered upload passes, and a post-deploy header
  check for the dashboard's static files.** _Deferred 2026-10-26 (the user, in the hosting
  track and Foundations spec 5a)._ The dashboard is uploaded to S3 exactly as monitor-map is
  today (one `aws s3 sync`, uncompressed, no `Cache-Control`, no ordering, the sync not
  failing the release on error), to keep shipping identical to monitor-map. Costs: about 3–4×
  the bytes on the wire against the 200 KB compressed budget; browsers may heuristically cache
  the fixed-name `app.js`/`app.css` after a deploy (spec 5a's reload button re-fetches them
  with `cache: "reload"` first); a page loading mid-deploy can hit a missing chunk (the reload
  bar covers it). **Revisit together with** monitor-map's upload, or when the low-end device
  check shows slow loads.
- **Testing cross-origin static serving before the preview.** _Deferred 2026-10-26 (the
  user, Foundations spec 5a and the hosting track)._ Locally, the dashboard's static files are
  served from the page's own origin, as monitor-map's are; nothing stands in for S3. So
  relative chunk loading from S3, fonts and `version.json` under the bucket's cross-origin
  rule, and the CSP's `{static}` entry are first exercised in the beta preview on production
  (CSP report-only, errors to Sentry, beta testers only). This replaces `ARCHITECTURE.md`'s
  earlier plan of a second-origin E2E smoke run. **Revisit if** the preview shows a
  cross-origin problem, or before public go-live if the preview hasn't exercised it.
- **Remove the `@jsr/sjvair__sdk` license exception.** _Deferred 2026-10-26 (Foundations spec
  5a)._ The license check names `@jsr/sjvair__sdk` as an exception because the JSR build has no
  license field and no license text, so the third-party notices carry none for it. **Revisit
  when** sdk-js ships a `LICENSE` file (and a license field in its JSR package): remove the
  exception and check the notices include its text.
- **A test of the real Sentry envelope.** _Deferred 2026-10-26 (Foundations spec 5a, final
  review)._ The scrubbing is unit-tested on the event the app hands to `@sentry/browser`, but
  nothing checks the envelope the SDK actually sends (no `user`, `infer_ip: "never"`, the
  scrubbed fields). A test with a capturing transport would. **Revisit when** the dashboard's
  Sentry project exists, together with the hand check of a real report.
- **CSP violations before IndexedDB opens aren't seen by the app.** _Deferred 2026-10-26
  (Foundations spec 5a, final review)._ The app's `securitypolicyviolation` listener starts
  only after the platform (IndexedDB) is ready, so violations during the bootstrap are missed
  in the app's own reports; the CSP header's `report-uri` still covers them. **Revisit if**
  the violation reports show gaps.
- **WebKit and a failed chunk after reload.** _Deferred 2026-10-26 (Foundations spec 5a,
  final review)._ In the E2E suite, once Playwright's WebKit fails to import the app chunk
  (a routed 404 or abort, even with `no-store`), a reload or a fresh navigation in the same
  page fails the same import again without requesting the file. So the load-failed test checks
  recovery only on Chromium and Firefox; on WebKit it checks the message and that Reload
  refreshes the entry files and reloads. Unknown whether real Safari does the same after a
  real 404 (a page loading mid-deploy). **Revisit in** the beta preview: check a reload in
  Safari after a missing chunk; if it stays broken, retry the import under a new URL.
- **Check the built app for zod eval violations before go-live.** _Deferred 2026-10-26 (Foundations
  spec 5a, final fix-wave review); reworded as a go-live check 2026-11-11 (the user)._ **Before
  go-live**, check the built app for `script-src` eval violations from zod on every route,
  including the routes and contexts the E2E CSP fixture doesn't cover (see "Gaps in the E2E CSP
  checks" below). If any appear, fix it in sdk-js (build its schemas lazily, or set `jitless`
  there), not with an import-order workaround here.
  **Why it's safe today:** the dashboard imports zod only through `$lib/zod`, which sets
  `z.config({ jitless: true })`. `@sjvair/sdk` (`5.0.0-beta.8`) imports zod itself and builds
  `z.object` schemas when its modules load (the root `schema.ts` and the schema modules of
  `account`, `calenviroscreen`, `calheatscore`, `collocation_sites`, `forecasts`, `hms`, `meta`,
  `monitors`, `pesticides` and `regions`; the documents schemas moved into `src/lib/api/documents/`
  on 2026-11-11 and build under `$lib/zod`). Since step 4, the widgets load the SDK root in the
  built app's initial bundle. There's only one copy of zod in `node_modules` (4.6.7), so the
  `jitless` setting applies to the SDK's schemas too. zod 4.6.7 runs its `new Function` probe
  when an object schema is created, unless `jitless` is already set
  (`node_modules/zod/v4/core/util.js`, `allowsEval`). So the app is clean only because `$lib/zod`
  runs before the SDK's schema modules, which is the import order that `$lib/zod` itself says not
  to rely on. The E2E suite runs under the contract CSP and fails on any
  `securitypolicyviolation` (`e2e/fixtures.ts`), and it passes. A one-off check on 2026-11-11 (the
  built app in the E2E preview, every route in `src/router.ts` loaded fresh, on Chromium,
  Firefox and WebKit) found no violations.
  **Revisit:** before go-live (listed under "Production deploy of sjvair.com `develop` → `main`"
  below); when the E2E CSP fixture reports the probe; or when someone next works on the SDK's
  schemas.
- **Gaps in the E2E CSP checks.** _Deferred 2026-10-26 (Foundations spec 5a, final fix-wave
  review)._ The ESLint rule bans only the exact `"zod"` import, not `zod/*` subpaths or dynamic
  `import("zod")` (add `patterns: ["zod/*"]`). The CSP fixture doesn't cover contexts made with
  `browser.newContext()` (the sharing and backup specs). And `e2e/csp.spec.ts`'s "eval is blocked"
  self-test injects an inline script, so it proves the checker works but not that eval is caught.
  **Revisit when** touching the E2E fixtures or the zod wrapper.
- **Spec 5a polish.** _Deferred 2026-10-26 (Foundations spec 5a, final review)._ Small
  follow-ups, none blocking. **Revisit when** next touching each file:
  - The `/workspace` base path is written in four places and `https://www.sjvair.com` in two;
    share one constant each.
  - No test covers skipping the entry-file refresh when `BUILD_ID === "dev"`.
  - The browser-floor test doesn't assert the exact `color-mix()` string it probes.
  - The host-list logic is duplicated between `csp-hosts.test.ts` and
    `scripts/check-build-output.mjs`, and the list is flat across directives.
  - The license collection skips virtual modules (Vite's and rolldown's MIT helpers).
  - The bare `/account/` dev proxy prefix could shadow a future app route.
  - The embedding suite's "lazy chunk" check doesn't prove the chunk loads lazily.
  - `reload.ts`'s `location.reload` and the entry-file refresh are web-only behavior outside
    the platform adapter (Tauri).
- **Spec 5b polish.** _Deferred 2026-10-27 (Foundations spec 5b, task reviews and final
  review)._ Small follow-ups, none affecting correctness, security, or the token boundary.
  **Revisit when** next touching each file:
  - sjvair.com: v1 `accounts/endpoints.py` imports the session module in its own import
    block; tidy with the imports.
  - sjvair.com: the session password-change test juggles old and new passwords across the v1
    and v2 URLs and is hard to read; split it per version.
  - sjvair.com: `session_user_data()` round-trips through `json.dumps`/`loads`. Intentional
    (it matches the API's encoder, so the block equals the `account/` response); revisit only
    if it shows up in profiling.
  - sjvair.com: the staff identity-block test doesn't re-check that the page has no token
    (the signed-in test covers it).
  - sdk-js: bare `b.api_token;` statements exist only to hold `@ts-expect-error`; and callers
    passing a value typed as `UpdateUserForm`/`ChangePasswordConfig` (with `api_token?:
string`) now get the union return type. The mobile app passes a string token, so it's
    unaffected; revisit if a loosely typed caller appears.
  - Initials use `toLocaleUpperCase()` with the runtime's default locale; pass the UI locale
    when translations arrive.
  - The identity block's tests don't cover non-object JSON (`null`, `1`) or a missing `user`
    key (the schema already rejects them).
  - The identity source: a stale in-flight request can answer a forced re-check after the
    generation bump; an equal identity in `accept()` still bumps the generation; and the memory
    source reports cause `"recheck"` where the web source says `"load"` for the first answer
    (nothing depends on the difference).
  - One browser-test load failure on a first run (Vite re-optimizing dependencies), not
    reproduced; revisit if it recurs.
  - `AccountState` passes a received tab identity to `accept()` as validated, not as the
    parsed (normalized) value; mixes TypeScript private parameters with `#private` fields (as
    `App` does); and its `dispose()` is never called (the app lives as long as the tab).
  - Untested: the tab channel's own-echo `tabId` filter, and the signed-out → signed-in toast
    across tabs.
  - The account menu's keyboard test steps with `ArrowDown` and sleeps; use focus assertions.
    Its test user is cast `as never`, which hides type drift.
  - `returnPath`'s query comes from `serializeSearch(route.search)`, which rebuilds it from an
    object and collapses repeated keys. No route uses repeated keys; read the browser's real
    query through the router if one does.
  - E2E `account.spec.ts`: a redundant `page.goto` after "New blank dashboard", and the
    logout fixture's glob `**/account/logout/` also matches `/api/2.0/account/logout/`.
  - `identity.ts`'s `statusOf` has a long inline cast type; name it.

- **Tauri desktop build.** _Deferred 2026-09-23 (IDEA.md Q1)._ The web build comes first
  and the app is kept Tauri-ready (see `ARCHITECTURE.md` → "Platform strategy").
  **Revisit when** there is a concrete desktop-only win, such as tray-based background
  alerting or large offline datasets for researchers. **Prerequisite:** a WebKitGTK spike
  with a map widget to confirm Linux desktop is viable. The spike must also confirm JupyterLite
  kernels can access files under Tauri-set COOP/COEP headers (service workers don't
  register on `tauri://` on macOS — see `docs/reference/jupyterlite-kernels.md`).
- **"Open locally" for notebooks (Tauri).** _Deferred 2026-09-23 (IDEA.md Q6)._ Write an
  export bundle to a folder and launch the user's `jupyter lab` if installed. Not
  possible from a web page. (IDEA.md asked for "JupyterLabs for the desktop app". Bundling
  JupyterLab into Tauri was not chosen because it means shipping a full Python runtime and
  packages, which is large and hard to maintain; JupyterLite already works offline in
  Tauri, and researchers usually have their own Jupyter.) **Revisit when** the Tauri build starts.
- **Embeddable production build.** _Deferred 2026-09-14 (v1 spec)._ Needs a `sv-router`
  escape hatch (`routerEscapeHatch`/`basePath`) and a non-URL fallback for view state.
  **Revisit when** the dashboard's core views exist. Keep state managers from hardcoding
  ownership of the top-level route in the meantime. **Partly pulled forward 2026-09-24:** `basePath` support ships in
  Release 1 for serving under `sjvair.com/workspace/`. Still deferred: embedding in a
  host app with its own router, and the in-memory router mode. (The Django-template
  embedding on sjvair.com is decided and not part of this.)
- **Tighten sjvair.com CORS.** _Noted 2026-09-24._ `CORS_ORIGIN_ALLOW_ALL` plus
  `CORS_ALLOW_CREDENTIALS` is normally risky; it's largely contained by Django's default
  `SameSite=Lax` session cookie. The dashboard doesn't need it, since it's served from the
  same origin. **Revisit when** server security settings are next touched, or when
  non-browser/standalone clients are reviewed. Needs an approved sjvair.com plan.
  **Related:** the CSRF fix for session-authenticated API writes is decided for
  Release 1 (in django-resticus; see `ARCHITECTURE.md` → "CSRF protection"). CORS
  tightening can ride along with it.
- **Pinning django-resticus in sjvair.com.** _Deferred 2026-09-28 by the user, who is
  discussing it with resticus's developer._ sjvair.com installs
  `git+https://github.com/dmpayton/django-resticus@develop` unpinned, so any commit to
  `develop` reaches production at the next deploy. That is why the CSRF fix's rollout
  order matters. **Revisit after** the user's conversation with the resticus developer.
- **Server-backed saved documents & live share links.** _Sequenced later 2026-09-23;
  **scheduled into Release 1 on 2026-09-24** as a parallel server track (see
  `ROADMAP.md`)._ This includes local → account migration. It stays listed here until it ships, then moves to TODO → Done.
  **Still deferred within it:**
  - SJVAir-curated public templates, which come after the basic model ships.
  - A public listing or search of documents. `public` visibility is reserved until
    templates ship. **Revisit with** templates.
  - Promoting fields inside `body` to real database columns (the server stores `body`
    without interpreting it, so it can't query inside documents). **Revisit when** a
    server-side feature needs to query documents (e.g. "dashboards using monitor X").
  - **Real-time push of document changes** (WebSockets or server-sent events). _Deferred
    2026-10-28 (sync design)._ Open pages poll about once a minute while visible instead.
    sjvair.com runs WSGI under gunicorn, so push would need an async server, a Redis channel
    layer, and new Heroku connection limits; a minute's delay suits teachers, schools, and
    one person on two devices. **Revisit when** someone needs changes to appear instantly
    (e.g. live classroom editing), or polling load becomes noticeable.
  - **Server change-log retention beyond the last 500 versions.** _Deferred 2026-10-28 (sync
    design)._ A device offline for longer than that can't tell which edits overlapped, so it
    always gets the three-choice prompt rather than a silent merge. **Revisit if** those
    prompts are reported.
  - **Merging colliding layout moves more cleverly.** _Deferred 2026-10-28 (sync design;
    decided with the user)._ Layout moves never prompt: the last save wins, and step 2's
    tidy fixes any overlap. Keeping both sides' intent (e.g. per-widget last-writer) isn't
    attempted. **Revisit if** people report layouts jumping back while tuning on two devices.
    _Seen in the spec 3 hand check, 2026-11-02 (the user; reproduced against the stack with two
    browser contexts); left as designed for now (the user's call)._ What a person sees: both
    devices offline, device A moves widget 2 down and renames another widget, device B moves
    widget 3 to the top. After both sync, both show B's whole arrangement: A's rename survives,
    A's move of widget 2 doesn't, though B never moved widget 2 on purpose. Why: a `setLayout`
    records the new rect of **every widget the move pushed** (its `to`, and `target.widgetIds`
    equals `to`'s keys), and nothing in it says which widget the person moved, so replaying B's
    move over A's puts every pushed widget back where B's grid had it. A rename names one
    widget, so two renames of different widgets both survive; one device renaming and the
    other moving also merges fine, in either order. **The likely fix:** have `setLayout` also
    record the widget(s) the person moved (a new field, set by the arrangement and windowing
    code that builds it), and when replaying one over theirs, apply only those rects and let
    step 2's tidy settle the rest, so both devices' deliberate moves survive. It changes the
    change format and `rebase`/`applyForced` for `setLayout` (sync spec 2's merge rule), so
    it's its own small branch, not part of a spec.
  - **A new display name reaches open shared pages only with the dashboard's next edit.**
    _Deferred 2026-11-02 (sync spec 3 plan)._ An open shared page polls
    `shared/<token>/changes/?since=N`, which answers just `{ version }` while the version is
    unchanged, and setting a display name isn't an edit. A fresh load always shows the new name.
    **Revisit if** an owner reports a stale name on an open page, or with any server change to
    that endpoint.
  - **Shared pages don't show their own "Based on …".** _Deferred 2026-11-02 (sync spec 3
    plan)._ The shared response carries no `copied_from` (by design: it's the owner's data), so
    a shared copy of a copy shows only the made-by bar. Copies people make still show "Based on
    …" for the dashboard they copied. **Revisit if** people ask where a shared dashboard came
    from.
  - **Each open shared page polls on its own** (no one-tab-per-browser leader as signed-in
    dashboards have). _Deferred 2026-11-02 (sync spec 3 plan)._ Viewers are mostly signed out on
    one tab each, and the sync design's cost estimate already counts one request per viewer per
    minute. **Revisit if** load from shared pages shows up in the server's monitoring.
  - **An open shared page whose next version is invalid stops polling.** _Deferred 2026-11-02
    (sync spec 3, while building)._ The page refuses a version that fails validation or is too
    large, switches to the "can't be opened" view, and stops polling; the owner's fix shows only
    after a reload. Refusing is the safe side. **Revisit if** an owner reports it, or if the
    format's validation gets stricter.
  - **A share made or stopped in one tab can briefly show the old state in another tab of the
    same account.** _Deferred 2026-11-02 (sync spec 3, while building)._ A list answered just
    before the change can overwrite the newer state; it heals on the next poll (up to 60 s).
    **Revisit if** the dialog showing a stale link is reported.
  - **The starter hand-off can set the current dashboard after the person has left for a shared
    page.** _Deferred 2026-11-02 (sync spec 3, while building)._ This is the existing `onCopied`
    in `src/lib/store/app.svelte.ts`, so Ctrl+Z there could reach that new copy. Very narrow
    timing. **Revisit on a report, or when the hand-off is next changed.** _Looked at in step 4
    spec 6, 2026-11-10: unchanged; Share on the starter now also uses the hand-off (through
    `copyStarter`), so there is one more caller, with the same timing window._
  - **`?widget=` stays in the address bar when a fullscreen shared dashboard becomes
    unavailable.** _Deferred 2026-11-02 (sync spec 3, while building)._ Nothing shows; it is
    harmless. **Revisit with** any URL-state cleanup.
  - **"Based on …" looked up while offline stays hidden until the next page load.**
    _Deferred 2026-11-02 (sync spec 3, final review)._ The answer is cached per page load, so a
    lookup that failed offline is not retried. **Revisit if** people report a missing credit.
  - **The Help menu's feedback link still opens sjvair.com's contact form with no topic
    pre-filled.** _Deferred 2026-11-02 (sync spec 3, final review)._ The server pre-fills only
    the shared-page report. This was part of the removed "Pre-filling sjvair.com's contact form"
    entry. It needs a small server change to accept a Feedback topic. **Revisit with** the next
    sjvair.com contact-form change.
- **Server-synced preferences** (last-opened dashboard, active Collection, Widget
  Creation defaults). _Deferred 2026-09-14 (v1 spec); re-confirmed 2026-09-25._ Documents
  sync in Release 1; preferences stay local per device (they're conveniences, and devices
  can reasonably differ). **Revisit when** users ask for preferences to follow them
  across devices; this would add a `preferences` kind of `SavedDocument` or a user-settings
  endpoint.
- **Heavier WASM analysis engine (e.g. DuckDB-WASM).** _Deferred 2026-09-23 (IDEA.md Q6)._
  Plain TypeScript over typed arrays in a worker is enough for now. **Revisit when**
  researcher-scale datasets make the TypeScript engine too slow or memory-bound.
- **Server-side location/radius search.** _Deferred 2026-09-14 (v1 spec); narrowed
  2026-09-28; updated 2026-10-13._ Point → containing-region lookup is **scheduled**
  (Release 1 step 3, `regions/places/lookup/`; still name-only on the server today). The
  server now has radius and buffer queries for pesticides (`sections/` by
  `lat,lng,radius`; `locations/` by radius up to 10 mi; `notices/active/` by bbox or
  `region`+`buffer`, but not by radius) and `regions/<id>/?buffer=1|3|5`, which Release
  2's pesticide-notice rules can build on. Still deferred: general
  monitor search by location/radius. Needs sdk-js and server changes. Drawn-shape selection resolves on the client, so it doesn't depend
  on this. **Revisit when** client-side resolution gets too slow or needs data the client
  doesn't have.
- **Pinned dashboard versions and runtime config injection.** _Deferred 2026-09-24._
  sjvair.com builds dashboard `main` on each Heroku deploy, the same as monitor-map, and
  `VITE_*` keys come from Heroku config vars at build time. **Revisit when** dashboard and
  server deploys need to diverge (e.g. a server hotfix blocked by a dashboard build, or
  a need to hold the dashboard back), or when keys must rotate without a redeploy. The
  options then are a tag/version pin, a CI artifact, and config injected by the Django
  view.

- **Branch protection on `main`** (PRs only, required CI). _Deferred 2026-09-28._ The user
  sometimes pushes small fixes straight to `main`. **Revisit when** more contributors join,
  or at go-live, when `main` becomes the production deploy.
- **Uploading source maps to Sentry.** _Deferred 2026-10-13._ It needs a secret Sentry
  token in sjvair.com's Heroku build. Errors are reported without it, but with minified
  stack traces. The repo is public and MIT, so serving source maps publicly is a simpler
  alternative. **Revisit when** an unreadable stack trace first costs real debugging time.
- **Bulk migration of saved references on the server** (rewriting every saved widget or
  rule from a retired id to its replacement). _Deferred 2026-10-13._ The `replacedBy`
  pointer handles it one widget at a time, as an undoable edit. **Revisit when** a
  widely used id is retired and per-widget switching would affect many people.
- **Full version history for documents** (previews, side-by-side comparison, named
  versions). _Deferred 2026-10-13._ Release 1 has a dated "Restore an earlier version"
  list for recovery only. **Revisit when** people use restore for everyday undo rather
  than recovery, or ask to compare versions.

- **sjvair.com API v2 archive links point at v1.** _Noted 2026-10-19 (Alerts fix)._ The
  v2 monthly-archive list builds each file's `url` with `Archive.get_csv_url()`, which
  reverses the **v1** route (`/api/1.0/.../archive/<year>/<month>/`), and the v2 archive
  tests (`camp/api/v2/archive/tests.py`) also exercise the v1 routes, so the v2 endpoints
  are untested. No current client uses archives (the SDK wraps them). **Revisit when**
  anything starts using monthly archives (e.g. a dashboard download feature), or with the
  next sjvair.com API cleanup. Needs an approved sjvair.com plan.
- **sjvair.com test settings depend on the local env.** _Noted 2026-10-19._ Without
  `TWILIO_AUTH_TOKEN`, 23 Twilio signature tests fail; with `BAM_MIRROR_ENABLED=1` in the
  local `.env.test`, 2 BAM tests fail (they expect it off by default). `camp/settings/test.py`
  could pin a dummy token and `BAM_MIRROR_ENABLED = False` so the suite runs the same
  everywhere. **Revisit with** the next sjvair.com test or settings change. Needs an
  approved sjvair.com plan.
- **CI and dependency loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review)._ None
  affects what ships: Playwright runs with no retries in CI. (Resolved in the design pass: the
  inert `--duration-*` `@theme` aliases became `--transition-duration-*`, so `duration-fast` and
  `duration-base` work. Resolved in spec 5a: the inlang plugin is a named exception in
  the license check; sharp's install script is allowed, see the Task 7 commit, because it is
  dev-only through `@sveltejs/enhanced-img` and needs the script to fetch its binary.)
  **Revisit when** CI first flakes (retries).
- **sdk-js: no runtime validation of responses.** _Deferred 2026-10-19 (Alerts fix)._ SDK
  calls return API data without checking it against their Zod schemas, which is how the
  stale `airAlertSchema` went unnoticed when the server dropped `id`/`latest`. Adding
  validation would change behavior for every call. **Revisit when** the dashboard's data
  layer (Foundations) decides where responses are validated. Needs an sdk-js plan and a
  release (explicit approval).
- **sdk-js: subscription levels are incomplete.** _Noted 2026-10-19._
  `monitorSubscriptionSchema.level` only allows `unhealthy_sensitive` and above, but the
  server also accepts `good` and `moderate` (treated as Moderate). **Revisit with** the
  Release 2 alert-rule SDK work. Needs an sdk-js plan and a release.
- **sdk-js: CSRF header can follow a cross-origin redirect.** _Deferred 2026-10-21._ The
  SDK's origin check applies to the initial URL. If a same-origin write got a 307/308
  redirect to another origin, the request would carry `X-CSRFToken` along (browsers strip
  only `Authorization`). Contained today: the custom header forces a CORS preflight, so it
  only reaches a target that explicitly allows it, and the API's writes don't redirect.
  **Revisit when** the API starts redirecting writes or the dashboard is deployed
  cross-origin; the fix then is `redirect: "error"` on requests that carry the CSRF header.
- **`@sjvair/sdk` is pinned to a 4.8.0 pre-release (now 4.8.0-beta.6).** _Deferred 2026-10-22
  (Foundations spec 2, PR #7 follow-up)._ The data layer needs `getDatasetCatalog`,
  `getRegionsByCode`, and `getMonitorEntries` with `processor`, `Date` bounds, and `exact`, which
  are only in that pre-release; it is pinned exactly because a caret range skips pre-releases.
  The pin now follows the 5.0.0 betas (the next stable release was renamed from 4.8.0 on
  2026-11-04). **Revisit when** sdk-js 5.0.0 is released (after sjvair.com `develop` reaches
  production and the user approves the release): switch to `^5.0.0`.
- **Drop `exact: true` when sdk-js makes exact bounds the default.** _Deferred 2026-10-25
  (decided by the user)._ The user wants the next major sdk-js version to send entry bounds
  unchanged by default, with an opt-in flag for rounding to whole Pacific days; it's recorded
  in sdk-js's `DEFERRED.md`. That major version is now 5.0.0; the change is planned as its own
  5.0.0 spec (likely `5.0.0-beta.2`), ideally before step 4 builds more on `getMonitorEntries`'
  current widening (sdk-js-6a's handoff, 2026-11-04). **Shipped in `5.0.0-beta.2`**
  (2026-11-04, sdk-js #44): `exact` is removed, not checked, so a leftover one is ignored.
  **Revisit when** the dashboard pins beta.2: remove `exact: true` from the air-quality adapter's
  `getMonitorEntries` call and the `{ exact }` option in `air-quality.test.ts`.
- **sdk-js doc-lint errors.** _Noted 2026-11-04 (sdk-js-6a's handoff)._ `deno doc --lint`
  reports 17 errors that predate the SDK quick batch; `deno publish --dry-run` passes, so
  publishing isn't blocked. **Revisit when** an SDK session has spare time or before 5.0.0
  final, if the user wants doc-lint clean.
- **sjvair.com: `ensure_csrf_cookie` on the map page.** _Deferred 2026-10-21 (monitor-map
  SDK 4.7 design)._ The subscribe button's `X-CSRFToken` relies on the `csrftoken` cookie
  that Django sets at login (1-year cookie vs. a 2-week session), so the page doesn't set it
  itself. **Revisit if** the resticus rollout's end-to-end subscribe check finds the cookie
  missing, or sjvair.com changes its CSRF/session settings. Needs a sjvair.com plan.
  **Checked 2026-10-22:** the signed-in check on local sjvair.com found the cookie present,
  so it stays deferred.
- **resticus: credential lookups on safe methods.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF
  fix review)._ For a session-signed-in request that also sends an `Authorization` header,
  the fix tries the other authenticators before the CSRF check, even on GETs, where the
  check does nothing: an extra token query, or a password hash and `user_login_failed`
  signal for Basic. Rare from browsers. **Revisit if** the resticus developer asks, or such
  requests show up in practice; the fix is to skip the lookup for safe methods.
- **resticus: a non-UTF-8 token header gives 500.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF fix
  review)._ `TokenAuth.lookup_user` raises `UnicodeDecodeError` on a non-UTF-8 key. This was
  already true without a session; with a session it used to be ignored (200). Not a
  security issue (a cross-site page can't set the header). **Revisit with** the next
  resticus change; fix by raising `AuthenticationFailed` there.
- **sjvair.com: a malformed id on `hms/smoke/<id>/` and `hms/fire/<id>/` isn't a 404.** _Found
  2026-11-05 (Get data layers); narrowed 2026-11-06._ Monitors are fixed: sjvair.com #314 (merged)
  answers one JSON 404 `"Resource not found"` for bad and unknown monitor ids on every route,
  writes with an access key included. Smoke and Fire detail go through resticus's `get_object`,
  which doesn't treat an unparseable id as not found: production answers 400 with the unfilled
  template `"'%(value)s' is not a valid short-form UUID."`, and DEBUG crashes to a 500. Fixed in
  resticus draft PR [#27](https://github.com/dmpayton/django-resticus/pull/27), which also fixes
  the DEBUG crash on lazy messages and the `ValidationError` 400 body. It merges with #25 and #26
  at go-live. The local stack runs it from the fork's `go-live` branch. **Revisit when** #27 is
  merged and sjvair.com's image is rebuilt: add sjvair.com tests for Smoke and Fire bad ids
  (404 `Resource not found`), then remove this entry.
- **resticus: CSRF skip trusts any non-session authenticator.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22
  (resticus CSRF fix review)._ A custom authenticator that reads a cookie (e.g. a JWT in a
  cookie) and doesn't subclass `SessionAuth` would let cookie-only requests skip the CSRF
  check. sjvair.com uses only `TokenAuth`. **Revisit if** the resticus developer wants it
  documented, or anyone adds a cookie-based authenticator; a docstring/README note is enough.
- **resticus: PATCH test goes around `ApiClient`.** **In draft PR [#26](https://github.com/dmpayton/django-resticus/pull/26) (2026-10-22), stacked on #25; leaves this register when it merges.** _Deferred 2026-10-22 (resticus CSRF fix
  review)._ `ApiClient` has no `patch` wrapper, so `tests/test_csrf.py` calls Django's
  `Client.patch` directly. Cosmetic. **Revisit if** the resticus developer asks.

- **Mobile's `/api/1.0` Vite dev proxy.** _Deferred 2026-11-09 (mobile on monitor-map 5.0,
  a library-switch-only change)._ Mobile's `vite.config.ts` forwards `/api/1.0` to
  `localhost:8000`, but SDK 5 calls `/api/2.0` on the origin set by `VITE_DEV_URL`, so the proxy
  is no longer used. Left alone to keep that work to the library switch. **Revisit when**
  mobile's dev setup is next touched, or after go-live.
- **Mobile: README's missing-MapTiler-key note and `user.ts`'s import-order comment.**
  _Deferred 2026-11-09 (mobile #114, final review, minor)._ `README.md` still says that without
  `VITE_MAPTILER_KEY` the map falls back to a default style with a console warning, which was
  monitor-map 4.x. With 5.0 the app passes `""` and map-sdk sends an empty `key=`, so the
  basemap most likely fails to load without that warning. Separately, `src/lib/users/account/user.ts`
  syncs the map login when it loads and relies on being imported only after `initPreferences()`;
  a comment is the only guard, and it could point to `ARCHITECTURE.md`'s bootstrap-ordering note.
  **Revisit when** mobile's README or bootstrap code is next touched.
- **sjvair.com closest-monitor latency (and the full monitor list).** _Held by the user until
  2026-11-10 (brief of 2026-10-12, `closest-endpoint.prompt.txt` in the workspace root); started
  2026-11-10 in `sjvair-com-92` from the refreshed `prompt-server-closest-monitor.txt`._
  `monitors/<entry_type>/closest/` (mobile's "My air" reading) took 0.5–6.5 s in production on
  2026-10-08. Found locally (verified by the coordinator): Postgres JIT compiled about 410 ms of
  the query's 460 ms, because `get_active()`'s `LatestEntry` join and `DISTINCT` make the planner
  overestimate rows (cost 2.0M against `jit_above_cost` 100k), and `with_latest_entry()` loaded
  every candidate monitor before taking three. **Fix approved by the user 2026-11-10** (closest
  queryset only: `EXISTS`, slice before attaching entries; about 15–18 ms locally, same output;
  no migration), merged into `develop` 2026-11-10 as #326, with follow-ups #327 (the full list: N+1 fixed, cached as encoded bytes) and #328 (`current/`: `EXISTS` active check). **Still deferred:** production before/after
  timing, which waits for the `develop` deploy (step in the deploy entry below).
- **App-wide Postgres JIT off, or fixing the queries that trip it (sjvair.com).** _Deferred
  2026-11-10 (the user, closest-monitor work)._ Option: `-c jit=off` in `DATABASES` `OPTIONS`
  (`camp/settings/test.py` already sets it for tests), or rewriting the queries whose planner cost
  crosses `jit_above_cost`. Deferred because it affects every query, summary rollups included, so
  it needs its own measurement; the closest fix doesn't need it (its rewritten query costs about
  16k, below the 100k threshold). Related: switching `get_active()` itself from the join and
  `DISTINCT` to `EXISTS`, which may have the same cost in its other callers (the list,
  `current/`, `at/`, alerts); that needs a caller list and tests pinning each caller's rows.
  A likely candidate (sjvair.com #327's measurements, 2026-11-10): `pm25/current/` cache misses still
  take about 950 ms with 4 queries locally, probably the same join plus `filter_healthy`; it's
  prewarmed, so most readers hit the cache. Its join was replaced in `CurrentData` by #328
  (2026-11-10), but JIT still fires on the new `current/` plans for about 25–50 ms (cost
  320k–410k), so this entry still covers it.
  **Revisit when** the post-deploy check shows production has JIT on, or another endpoint's
  `EXPLAIN` shows JIT time dominating.
- **`with_latest_entry()` picks a `LatestEntry` row without an order (sjvair.com).** _Deferred
  2026-11-10 (closest-monitor work, #326)._ It takes the first `LatestEntry` row per monitor and
  entry type with no `ORDER BY`; for a monitor with both cleaned and calibrated PM2.5 rows it
  returns the calibrated one only because of index order. Unchanged by #326, which kept the
  behavior. **Revisit when** anyone touches `LatestEntry` or the published-series logic.
- **resticus streams JSON one token at a time (django-resticus).** _Deferred 2026-11-10 (the
  user, sjvair.com monitor-list work)._ `StreamingJSONResponse` (`resticus/http.py`) passes
  `JSON_ENCODER().iterencode(data)` straight to `StreamingHttpResponse`, so the 486 KB monitor
  list goes out as about 87,000 pieces; the per-piece cost in Django's streaming path and
  `GZipMiddleware` is about 160 ms of a 170 ms cache hit locally. Fix in resticus: group the
  pieces into chunks of about 64 KB. Deferred because it's a change to the resticus fork (a
  separate repo; sjvair.com installs `develop` unpinned, and the local stack mounts the
  `go-live` branch); sjvair.com's follow-up PR (`select_related('airgradient__place')` in
  `MonitorMixin`, and `CachedEndpointMixin` caching encoded bytes, opt-in for `MonitorList` and
  `CurrentData`) sidesteps it for those two endpoints. **Revisit when** another large streaming
  endpoint (such as entries JSON lists) shows slow body time, or at the next resticus release
  work.
- **Production deploy of sjvair.com `develop` → `main` (the "everything ready" deploy).**
  _Deferred 2026-11-04 (the user): `develop` is not deployed until the data dashboard is
  done._ It carries #292, #293, #295, #296, #297, #298, #299, #300 and #301 (and whatever else
  lands on `develop` for Release 1). A production deploy, so it needs the user's explicit yes.
  Checklist for that day:
  - **Released together** (the user, 2026-11-04: the updated mobile app and sjvair.com `develop` are released the same day, with map-sdk on the latest sdk-js, monitor-map rebuilt on map-sdk, and mobile on that monitor-map, all done before `develop` is released; mobile auto-updates, most likely overnight, the day a release is published): map-sdk on the latest @sjvair/sdk 5.0 beta, monitor-map 5.0
    rebuilt on map-sdk, and a mobile release on monitor-map 5.0 must all be ready first. SDK 5.0
    has no fallbacks for older servers, so the new mobile build needs the deployed server; on the
    day, **deploy `develop` first, then publish the mobile release** (the user, 2026-11-04).
    **monitor-map 5.0 reaches `main` only on that day** (the user, 2026-11-05): 5.0 work goes
    into monitor-map's `release/5.0.0` through PRs, and mobile tries it through npm betas
    published from that branch. Since sjvair.com builds monitor-map `main` unpinned on each
    deploy, merge `release/5.0.0` into `main` (the user's yes) right before deploying `develop`,
    not earlier.
    map-sdk must already be on npm by then: monitor-map 5.0 depends on it, and sjvair.com's
    deploy runs `npm i` on monitor-map `main`.
    The server also drops `monitors/meta/`'s legacy `levels` dict (the user, 2026-11-04, in the
    hardcoded-value cleanup, spec 5), so every consumer must read `scale` first: monitor-map
    (tooltips, legend, clusters, charts, subscription manager), mobile
    (`MonitorSubscription.svelte`, `Subscriptions.svelte`, `Alerts.svelte`, `alert-level.ts`;
    subscription levels need a not-found path, since not every level key exists in every
    pollutant's scale), map-sdk's legacy fallback (`src/lib/data/metadata.ts`, which won't
    type-check once the SDK drops `levels`, so it must go when map-sdk pins that beta), and sdk-js (schema, the `levels` getter,
    `asIter.levels`, fixtures, plus `SJVAirEntryLevel`, `sjvairEntryLevelMetaSchema` and
    `EntriesMeta.asIter`, the user's call 2026-11-04). monitor-map (13 files, including the
    monitor tooltips, cluster renderer, icon manager and detail panel) and mobile (`Alerts.svelte`,
    `Subscriptions.svelte`, `alert-level.ts`) import `SJVAirEntryLevel` or use `asIter`, so both
    change when they move to that SDK beta; map-sdk and the dashboard don't use them. The dashboard reads `scale`; its e2e
    fixtures still contain `levels`. **Mobile done** (mobile #114 into its `release/5.0.0`,
    2026-11-09): it reads `scale`, and a subscription level missing from the PM2.5 scale shows
    "—" instead of disappearing; `MonitorSubscription.svelte` was removed.
  - **Mobile 5.0.0 on the day, after `develop` is deployed** (the user, 2026-11-09). Each step
    needs the user's own yes; none is done earlier. Mobile's 5.0 work waits on its
    `release/5.0.0` branch (`main` stays on 4.x for hotfixes):
    1. Switch mobile to the final `@sjvair/monitor-map` `5.0.0` and `@sjvair/sdk` `5.0.0`
       (pinned exactly; PR into `release/5.0.0`).
    2. Rerun `TZ=America/Los_Angeles npx vitest run` and the Android emulator map check (the
       map renders, a panel opens, subscribing from the map works).
    3. Date the `## [5.0.0]` CHANGELOG entry.
    4. Merge `release/5.0.0` → `main`.
    5. Create the GitHub Release `v5.0.0` targeting `main`'s full SHA. It ships to TestFlight and
       the Play beta track.
    6. The user tests on iOS.
  - **Before:** resticus #25 merged upstream (#297's cookie-authenticated writes need it; #26 and
    #27, the bad-id 404s and the 400 body, merge with it at go-live, as agreed with the code owner,
    the user, 2026-11-06); the
    credentialed-CORS review below; the Heroku config vars from #295 (`VITE_SENTRY_DSN`,
    `WORKSPACE_CSP_REPORT_URI`); run `import_forecast_zones` first or clear the
    `forecast_zone_for:` cache keys after (see "Production deploy step for the place
    endpoints" below).
  - **Dashboard CSP check, before:** check the built app for zod eval violations on every route
    (see "Check the built app for zod eval violations before go-live" above).
  - **Migrations at deploy:** `hms/0003_smoke_date_index` (sjvair.com #314), a plain `AddIndex` on
    `hms_smoke.date`; runs with `migrate`, quick on a small table; undo with `migrate hms 0002`.
    Nothing to run by hand.
  - **Alert current (sjvair.com #319):** nothing to run. After the deploy,
    `monitors/<id>/alerts/current/` answers `pending` until the first 10-minute alert run (up to
    10 minutes), then real values. The Current conditions tile works against production only
    once this is deployed: SDK 5.0.0-beta.7 expects the new fields.
  - **Scale averaging periods, daily peaks and open days (sjvair.com #320, #321, #323, merged into `develop` 2026-11-09;
    steps from sjvair-com-64), in order:**
    1. **Deploy** away from :40–:50 and with no `SummaryBackfillJob` running. The release phase runs
       `summaries/0007_summary_peaks`, which sets `lock_timeout` to 10 s, so a blocked migration fails the release fast; rerun
       it at a quiet time.
    2. **AirNow -999 hours already stored** (found 2026-11-09): the importer has skipped AirNow's -999 missing-value code
       since sjvair.com a7507e9d (2026-10-22, already on `main`), but earlier hours stay. Public data from www.sjvair.com
       showed an O3 hourly summary of -999 (count 1, `is_complete` true) for Fresno – Garland at 2026-09-24 17:00 PT (spec 5
       session, one read-only pull, with the user's yes). Run `backfill_airnow` (scoped) over the -999 range, then rebuild
       those monitors' summaries. The daily peaks also skip hourly values ≤ -900 and print a skip count (the user,
       2026-11-09: both the order and the skip).
       2b. **Rebuild region summaries over the same -999 range,** after the AirNow monitor rebuild and before any region fill:
       `rebuild_summaries <start> <end> --monitor=<id> --regions-only` per affected AirNow monitor (it rebuilds exactly that
       monitor's regions; there's no region-type flag). Region hourly rows are weighted means, so a -999 monitor hour usually
       lands above -900 and the skip doesn't catch it (sjvair-com-64's final review, 2026-11-09). Count the regions first (the
       sum of `monitor.regions` over those monitors; the query comes with the PR).
    3. `rebuild_summaries --monitor=<id> --monitors-only` per AQLite monitor (its O3 hourly `is_complete` fix).
    4. `fill_daily_peaks`, scoped, `--dry-run` first and then for real: monitor types `airnow`, `aqlite`, `vozbox`,
       `purpleair`, `airgradient`, `aqview` and `bam1022`, then each region type (`mean_24h` makes PM types part of it).
    5. Run the backfill **before announcing** the dashboard: settled daily responses are cached for 24 hours.
       **Pass monitor ids as `--monitor=<id>`** in every command here and in the CIMIS steps: a sqid can start with `-`,
       which argparse reads as a flag (suspected cause of a flaky `restamp_cimis` test, 2026-11-09). 6. **After the deploy, in sdk-js:** remove `ignore: isRemote` from the open-day integration steps in
       `lib/monitors/mod_test.ts` and `lib/regions/mod_test.ts` (sdk-js #59), so `TEST_REMOTE` runs check production.
       Exact commands come with the merged PR. **Why deferred:** nothing touches production until `develop` deploys.
       **Revisit:** at the deploy.
  - **Deploy window:** between about 17:15 and 01:00 Pacific (#301 moved the rollups from
    01:00 UTC to 01:00 Pacific; deploying 01:00–17:00 Pacific skips a day). Otherwise run
    `daily_monitor_summaries(day=<yesterday>)` and `daily_region_summaries(day=<yesterday>)`
    once after.
  - **Summary catch-up, promptly after:** settled periods are cached 24 hours, so an empty
    answer fetched before the catch-up sticks. Until the deploy, production keeps the old UTC
    schedule, which rolls up each month, quarter and season one period late, so recompute the
    missing list from the deploy date: as of 2026-11-04 it was October 2026 monthly, Q3 2026
    quarterly, and maybe the Jun–Aug 2026 season; every later period the old schedule misses
    adds to it. Use the rollup tasks with a scope, one monitor and one region first, then the
    wider run only after a blast-radius check and a yes (exact commands in sjvair.com #301's
    "Deploy notes"; never unscoped bulk commands).
  - **CIMIS re-stamp, then weather summaries (sjvair.com #313), after the deploy, in order.**
    #313 stamps CIMIS readings at the start of their hour in fixed PST (UTC−8); readings stored
    before the deploy keep the old end-of-hour stamps until re-stamped (no double rows in
    between). Each step is scoped to one station; the user's yes before the first.
    1. Per CIMIS station (all 23, largest first; avoid :40–:50 past the hour, when the live
       import runs at :45): `heroku run -a <app> -- python manage.py restamp_cimis --monitor
<id> --dry-run`, then the same without `--dry-run`. It runs from the station's first
       stored date through today, aborts that station without writing if CIMIS returns no
       labels for a stored date, and a re-run is safe (also after a collision with the live
       import).
    2. Once all 23 are re-stamped, per station: `heroku run -a <app> -- python manage.py
rebuild_summaries <first CIMIS date> <today> --monitor=<id> --monitors-only`.
  - **Summaries repair (sjvair.com #305):** findings 2 and 3 of the 2026-11-03 rollup report.
    Production has backfill rows stamped an hour early (some correctly stamped months,
    quarters, seasons and years also hold one extra row), seasons starting May 1 from the old
    schedule, and hourly region rows skipped since about September. #305 fixes the code and
    adds `repair_summaries` (always scoped, `--dry-run` first) and the daily
    `check_summary_integrity`. Nothing runs on production before that day. In order:
    1. **Before the deploy, read-only checks:**
       - the summaries worker logs: when `hourly_region_summaries` starts against its :50
         schedule, and when the hour's last `summarize_monitor_hour` finishes. This confirms
         finding 3's cause;
       - `heroku ps`: whether `huey_summaries_worker` is scaled, and `HUEY_SUMMARIES_WORKERS`;
       - Sentry: errors from `summarize_region_hour`;
       - Redis: memory and eviction policy;
       - `backfill_summaries status`: no job running. Don't start a backfill on production
         before the deploy; it's what wrote the hour-early rows.
    2. **Deploy**, inside #301's window above.
    3. **Explain the large queries on production** (`heroku run python manage.py shell`, plain
       `.explain()` only). Check the weekly monitor-hours query and the region-hours query in
       `repair.missing_region_hours`, and `check_summary_integrity`'s 400-day `DISTINCT`. Local
       tables were too small to prove their plans; each should use the `(resolution,
timestamp)` index or the unique index's leading columns, not a full scan.
    4. **Size it:**
       - `check_summary_integrity.call_local()` gives the network-wide misaligned count and
         yesterday's skipped region hours, and logs its run time;
       - then `repair_summaries <first summary date> <deploy date> --monitor=<pk> --region
<pk> --region-hours --dry-run` for one monitor and one county (Fresno, `r6phe`). The
         first summary date is the earliest non-hourly row, or the old backfill's `--from`.
       - The dry run prints the spans it widens to, what it will delete and re-roll, and the
         rows it leaves in place. Record those counts.
    5. **Repair that one scope** (same command without `--dry-run`). **Check after** with the
       report's requests:
       - `monitors/<id>/summaries/pm25/monthly/2025/` returns Jan–Dec 2025, each at 00:00;
       - `yearly/` and the seasonal rows start at Pacific midnight, and no row starts May 1;
       - Fresno's `hourly/2026/11/2/` has 24 rows and `daily/2026/10/` has 31.
       - A second run should report 0 misaligned.
    6. **Wider, with a yes:** after a blast-radius check (the dry-run totals), run it per
       monitor type (`--monitor-type purpleair`, …) and per region type (`--region-type
county`, then the other types the dashboard reads), each with `--dry-run` first.
       - The repair re-rolls every finished period in its range, so it also does #301's
         catch-up for that scope. Still confirm October monthly, Q3 quarterly and Jun–Aug 2026.
       - Run it promptly after the deploy, before the dashboard's monthly and region widgets
         go live: settled periods are cached 24 hours in browsers. While one resolution of
         one kind is being repaired, its misaligned rows are briefly absent.
    7. **The next day:** `check_summary_integrity` logs no error, and there are no "started …
       after its :50 run" warnings.

    Known leftovers: an hour where every monitor's health score is 0 correctly gets no region
    row, and `--region-hours` keeps listing it. Retired regions need `--region=<pk>`, since
    `--region-type` covers current regions only. Misaligned rows of unfinished periods (such
    as the current year's) are deleted and come back at the scheduled rollup.

    **How the list grows until the deploy:**
    - Skipped region hours: about every hour the old code's region job starts late.
    - #301's late months, quarters and seasons: each period the old schedule misses.
    - Misaligned seasons: two more from the old schedule (Aug–Oct written on Nov 30, Nov–Jan
      on Feb 28).
    - Hour-early rows don't grow, unless someone runs a backfill.

  - **Client updates for the SDK call changes (sdk-js #40):** monitor-map (pins `^4.7.0`; the release is 5.0.0, so it
    can't pick it up by accident) calls `getHMSSmoke({ signal })`/`getHMSFire({ signal })`; they become
    `getHMSSmoke(undefined, { signal })`/`getHMSFire(undefined, { signal })` when it moves to
    SDK 5.0, which it and mobile (`^4.6.0`) must do before `develop` goes live. TypeScript flags the old call; plain JS would
    silently drop the signal. `getRegionDetails(id, options)` also became
    `getRegionDetails(id, query, options)` (no external callers found). SDK 5.0 also makes entry bounds exact by default (sdk-js-8c's spec, 2026-11-04, likely `5.0.0-beta.2`): monitor-map's `getMonitorEntries`/`getMonitorEntriesCSVUrl` calls need no code change (only a today–today request in the first 5 minutes after Pacific midnight gets a near-empty window; it could pass `wholeDays: true` for that), and mobile has no calls, so both just need the 5.0 bump.
  - **Spec 5 and the picker changes (#306, #307, #308, from sjvair-com-c9 2026-11-04):** no migrations
    or data commands, and no server cache to clear. Forecast `aqi_category` is computed on read, so
    stored "Out of Range" rows serve as "Hazardous" with no backfill. The forecast import task
    changed (the deploy restarts workers anyway). `/guidelines/` pages need the new compiled CSS
    (the normal `invoke build` covers it). `levels` is gone from `monitors/meta/`, so this deploy
    goes out the same day as the map-sdk, monitor-map and mobile releases (the plan above).
  - **After:** the dashboard is live behind `beta_tools` at `/workspace/`; @sjvair/sdk 5.0.0
    final (renamed from 4.8.0, 2026-11-04; betas only until then) can be cut (with the user's yes) once #293 and #302 are in production (from sdk-js #39, `getRegionsMeta` reads #302's `location_types`; SDK and server go live together, no compatibility shim, the user's call 2026-11-04). Note: JSR's npm mirror (npm.jsr.io) lists the newest beta as `dist-tags.latest` (5.0.0-beta.3 on
    2026-11-05) while JSR's own `latest` stays 4.7.0, so an unpinned `npm i @jsr/sjvair__sdk` gets the
    beta; ranges and exact pins are unaffected. Check both read 5.0.0 after the final release.
  - **Closest-monitor timing, after the deploy:** sample `monitors/pm25/closest/` (Fresno,
    Bakersfield, Stockton) and `monitors/` from production with curl, spaced out, and compare
    with the 2026-10-08 numbers (0.5–6.5 s; about 3 s for the list) and the local before/after
    from the closest-monitor work (the user's yes needed for the production requests). Also
    check whether production Postgres has JIT on (locally JIT was ~410 ms of the closest query's
    ~460 ms, 2026-11-10) and whether `monitors/` and `current/` responses are cache hits with a `Content-Length` (`X-Cache-Status`; #327), and that the refresh worker's per-minute `current/` runs no longer take about 0.4–0.6 s each (#328).

  **Revisit when** the data dashboard (Release 1) is done, or the user decides to deploy
  sooner. Related: the summaries follow-up (standard-time period starts, missing region
  summaries, misaligned seasons, under "Analysis & data") is sjvair.com #305 (merged into
  `develop` 2026-11-04, so this deploy carries it); its repair steps are above.

- **Credentialed CORS from any origin in front of private documents.** _Deferred 2026-10-28
  (Sync spec 1)._ sjvair.com already sets `CORS_ORIGIN_ALLOW_ALL` with
  `CORS_ALLOW_CREDENTIALS`, so private documents now sit behind credentialed CORS from any
  origin. `SameSite=Lax` cookies block cross-site reads, but same-site origins (other
  `*.sjvair.com` hosts) could read them. Not changed in spec 1: it is site-wide config other
  clients may rely on. **Revisit before** the sjvair.com `develop` to `main` deploy that
  carries the documents API (part of "everything ready").

- **Storage rough edges from sync spec 2.** _Deferred 2026-11-02 (Sync spec 2, Tasks 2 and
  4)._ The web adapter's `spaces.move` and `spaces.list` may leave a transaction's `done`
  rejection unhandled (as `commit` can; `clearAll` uses `allSettled`); `spaces.move` awaits
  each id in turn instead of batching; and the remote's validation error report could carry
  the failing zod issue paths (never values) to make server drift easier to read. **Revisit
  if** unhandled-rejection reports show up from storage, moves of many dashboards are slow, or
  a validation report is hard to act on.

- **"No Burning For All" burn status.** _Deferred 2026-11-03 (step 3 spec 1)._ The forecast
  feed's exact `status` string for it is unconfirmed, so the `burn-status` scale has no level
  for it. The server stores unknown values as received and logs them. **Revisit when** the
  ingest log shows the new value: add the level in sjvair.com `camp/apps/forecasts/scales.py`.
  Meanwhile the Forecast strip shows the feed's text (step 4 spec 4, 2026-11-08).

- **Production deploy step for the place endpoints.** _Deferred 2026-11-03 (step 3 spec 1)._
  `forecasts/place/` caches its zone answers for 24 hours, so a place resolved before the 3
  `custom` forecast zones exist keeps its answer after they are imported. Run
  `import_forecast_zones` before deploying, or clear the `forecast_zone_for:` cache keys
  after the import. **Revisit when** shipping sjvair.com `develop` to production (with the
  "everything ready" deploy above).

- **Region meta counts are cached for 1 hour with no invalidation.** _Deferred 2026-11-03
  (step 3 spec 1)._ `regions/meta/` `count` can lag an import by up to an hour. **Revisit if**
  an import flow needs the new counts immediately (then invalidate the key from the import
  commands).

- **sjvair.com: flaky `restamp_cimis` test (found 2026-11-09).** `camp/apps/monitors/cimis/test_restamp.py::test_command_restamps_and_prints_counts`
  failed once in a full run (sjvair-com-64) and passed alone and on a rerun. Suspected cause, not yet confirmed: the test
  calls `call_command('restamp_cimis', '--monitor', monitor.pk, ...)`, and a sqid starting with `-` reads as a flag. A fix
  would be `--monitor=<id>` in the test and the docs (the deploy steps already say so). **Why deferred:** outside the
  scale-averaging work and intermittent. **Revisit:** when `restamp_cimis` is next touched, or if it fails in CI.

- **sjvair.com `CLAUDE.md`: monitor and region ids in command examples (found 2026-11-09).** The CIMIS section
  (`restamp_cimis`, `rebuild_summaries`) and the `repair_summaries` example still show `--monitor <id>` / `--region <pk>`.
  A sqid can start with `-`, which argparse reads as a flag, so the `=` form is safe. **Why deferred:** it predates the
  scale-averaging branch and only affects ids that start with `-`. **Revisit:** the next time those docs are touched, or
  before any production CIMIS re-stamp (the deploy steps here already use the `=` form).

## Documents & saving

- **Copying a shared dashboard with a point needs the network.** _Deferred 2026-11-04 (step 4
  spec 2, Task 13 review)._ A copy made from a share (link, file, or live link) always swaps a
  point for its region, and that lookup needs the server; offline the copy fails with the
  generic "couldn't save" message. **Revisit on** reports of people copying shared dashboards
  offline, or if a share starts carrying the region along with the point.
- **The live-link point check trusts the stored copy.** _Deferred 2026-11-04 (step 4 spec 2,
  Task 13 review)._ Before a live link goes on without "Share my exact location", the share
  checks the stored dashboard for points (`onlyIf`) and refuses while edits wait to upload. When
  nothing is waiting it assumes the server's copy equals the stored one; if another device
  uploaded a newer version with a point and this device's swap was a no-op, that version could
  be shared. Why: needs two devices, a point added on one, and a share from the other within a
  sync interval. **Revisit if** multi-device sharing is common: check the server's copy (or its
  version) instead.
- **The Share dialog reads a dashboard's points once, when it opens.** _Deferred 2026-11-04
  (step 4 spec 2, Task 13 review)._ The notice and the live-link prompt come from the points
  present at opening, so a point added in another tab before "Create link" gets no prompt and
  skips the point check, and could be shared. Why: needs a second tab editing the same
  dashboard while the dialog is open. **Revisit if** it's seen: reread the points when the
  stored document changes while the dialog is open (or always pass the check).
- **"Share my exact location" is remembered on one device.** _Deferred 2026-11-05 (step 4
  spec 2, Task 16)._ The choice lives in this device's sync record (`shareExact`), not on the
  server. Another signed-in device sees the link as not exact, so its next edit of that
  dashboard (or a held upload there) swaps the exact points the owner chose for their regions.
  Why: it errs toward privacy, and needs the owner editing one live-shared dashboard from two
  devices after choosing exact. **Revisit if** that's seen, or when the server can store the
  choice with the link.
- **Server snapshots of a live-shared dashboard aren't held for points.** _Deferred 2026-11-05
  (step 4 spec 2, Task 16)._ The snapshot kept before restoring a version, and the one kept for
  "use theirs" or "discard" when settling a hold, send the local dashboard as it is, so an exact
  point waiting to be swapped can reach the account's snapshots. Why: snapshots are the owner's
  only (like the account copy of a dashboard without a link) and never shown on the link; holding
  them would lose the safety copy. **Revisit if** snapshots ever become visible to link viewers
  (or shareable), or the server starts reading points out of them.
- **A lookup that never succeeds leaves the dashboard unsynced.** _Deferred 2026-11-05 (step 4
  spec 2, Task 16)._ On a live-shared dashboard, a point whose region can't be looked up stays
  held: retried with the toast's Retry, when the connection returns, on the next edit, and when
  the dashboard opens, but not on a timer, and a held dashboard is only shown as having changes
  waiting. Why: the lookup fails only offline or with the server down, which those retries
  cover. **Revisit on** reports of a live-shared dashboard stuck unsynced with a point.
- **The live-point guard's retry outlives its session.** _Deferred 2026-11-05 (step 4 spec
  2, final review)._ After a failed lookup, the `online` listener and the persistent Retry toast
  stay after the dashboard is closed, so the toast can show on another dashboard, and a
  reconnect runs a guard on a closed session (harmless: the version check makes it a no-op).
  Why: needs a failed lookup and then leaving the dashboard before reconnecting. **Revisit if**
  it confuses anyone: tie the listener and toast to the session and drop them when it closes.
- **"Keep mine" during a failed lookup shows a generic error.** _Deferred 2026-11-05 (step 4
  spec 2, final review)._ In a conflict on a live-shared dashboard whose point can't be looked
  up, "Keep mine" fails with the generic error, not "Can't look up your area right now." Why:
  needs a conflict and a lookup failure at once; nothing exact is shared either way. **Revisit
  on** a report of it, or when the conflict dialog's messages are next reworked.
- **Exporting with points reports no errors.** _Deferred 2026-11-05 (step 4 spec 2, final
  review)._ `exportDashboard`'s catch turns every error from the swap (a bug included) into
  "Can't look up your area" with Retry, without `report()`. Telling a lookup failure from a bug
  needs a typed lookup error from `pointSwaps`, used by its four callers (export, copy link,
  copies from shares, the live-point guard). **Revisit when** the swap code is next touched, or
  on a report of an export that always fails with the lookup message.
- **A shared exact point outside SJVAir's area reads as the viewer's location.** _Deferred
  2026-11-05 (step 4 spec 2, final review)._ A viewer of an exact share whose point is outside
  the area sees "Your location is outside the area SJVAir covers.", worded as if it were the
  viewer's own location. Why: an owner can only pick a point inside the area, so it needs an
  edited or very old document. **Revisit on** a report of it: word it for the place, not the
  viewer, when the document isn't the viewer's own.
- **Points in a newer-format dashboard's export.** _Deferred 2026-11-04 (step 4 spec 2, Task 13)._
  A read-only (newer or invalid) dashboard is exported as stored; the location-privacy swap
  finds only points in today's shape (`body.widgets[].data.layers[].place`). A future format
  that keeps an exact location elsewhere would be exported as is by this build. **Revisit on**
  any schema change that stores a coordinate in a new place (that build's own export swaps it,
  but older builds sharing the same storage won't).

- **Deleting an unreadable dashboard is local only.** _Deferred 2026-11-03 (design pass, Task 15)._
  The list's Delete for a dashboard that can't be opened removes only this browser's copy; in an
  account space, sync may download a valid server copy again (arguably a repair). **Revisit on** a
  report of a deleted unreadable dashboard coming back, or with account-side deletion of
  unreadable documents.
- **A starter journal record can outlive its copy.** _Deferred 2026-10-25 (Foundations spec 3,
  task 6)._ If the page goes away mid-hand-off after the copy was stored but before its first
  save, the next load opens the (unedited) copy, not the starter, so the starter's journal
  record (its queued edits) is never replayed; it stays until journal cleanup removes it.
  Needs the page to die in a window of a few milliseconds. **Revisit on** a report of lost
  first edits: replay a `starter` record into a version-0 copy whose `copiedFrom` is the
  starter. _Looked at in step 4 spec 6, 2026-11-10: unchanged; the hand-off is the same code,
  though Share on the starter now hands off too (through `copyStarter`), a second way to start
  it._
- **A starter replay can take a live tab's journal record.** _Deferred 2026-10-25
  (Foundations spec 3, task 7 review)._ `replayPending` replays every other tab's `starter`
  journal record, including one from a tab that is still open (hidden mid-hand-off, or whose
  hand-off failed); both tabs then hand the same edits off, making a duplicate copy. Narrow:
  it needs a storage failure or unlucky timing in the other tab. **Revisit on** a report of
  duplicate starter copies, or with server sync. _Looked at in sync spec 2, 2026-11-02: still
  deferred._ Sync dedupes nothing extra here; an account space would sync a duplicate copy as
  two dashboards, which the person can delete or restore. _Looked at in step 4 spec 6,
  2026-11-10: unchanged; Share on the starter's hand-off adds one more way to hit it._
- **Another tab's starter shows a new chosen place only after reload.** _Deferred 2026-11-10
  (step 4 spec 6, Task 4)._ The starter's chosen place is a per-space preference, read when the
  app opens (and after "Clear my data"); preferences have no change event, so a starter already
  open in another tab keeps the place it opened with until that tab reloads (its first edit's
  copy keeps that place too). **Revisit if** people notice, or when preferences gain a change
  event.
- **Link decompression has no output limit.** _Deferred 2026-10-25 (Foundations spec 3,
  Task 8 review)._ `lz-string` can't cap its output, so a hostile 64,000-character link
  fragment can expand to a very large transient string before the post-decompression size
  check (a `RangeError` is caught and shown as an invalid link). **Revisit if** memory
  spikes are reported, or if a streaming or limited decoder becomes available.

- **`droppedEdits` on the starter is never shown.** _Deferred 2026-10-25 (Foundations spec 3, final review)._ Edits that can't be carried over
  from an older format are counted on the starter session too, but only an opened dashboard's
  page tells the person. Nothing can be dropped until a format changes. **Revisit at** the
  first `schemaVersion` bump. _Looked at in step 4 spec 6, 2026-11-10: unchanged; the real
  starter doesn't change this, since nothing can be dropped yet._
- **`files.open` can hang where the input's `cancel` event is missing.** _Deferred 2026-10-25 (Foundations spec 3, final review)._ Chrome 111–112
  don't fire `cancel` on a file input, so dismissing the picker there leaves "Import…" waiting
  forever. **Revisit if** a stuck import is
  reported.
- **IndexedDB reopen isn't memoized, and any `InvalidStateError` triggers it.** _Deferred 2026-10-25 (Foundations spec 3, final review)._
  Concurrent operations that fail together each open their own connection, and an
  `InvalidStateError` from another cause also reopens. **Revisit before** the next IndexedDB version bump.
- **`DocumentSession` is large (~870 lines).** _Deferred 2026-10-25 (Foundations spec 3, final review)._ The format-upgrade and hand-off helpers
  could move out. **Revisit when** a second document kind (Collections, Release 3) needs a
  session, or sooner if it keeps growing.
- **An unreadable journal `writtenAt` never expires.** _Deferred 2026-10-25 (Foundations spec 3, final review)._ The 30-day purge skips a journal
  record whose `writtenAt` can't be read, so it stays. Records are small and rare.
  **Revisit if** journal storage grows.
- **`rememberCopy` failing after a restore's commit counts it as skipped.** _Deferred 2026-10-25 (Foundations spec 3, final review)._ The
  dashboard is restored, but the summary says skipped and its fingerprint is missing (so "You
  already have a copy" won't find it). Low impact. **Revisit with** server sync. _Looked at in
  sync spec 2, 2026-11-02: still deferred._ Sync doesn't change it; the fingerprint is
  per browser, so the miss stays local.
- **A failed `lastShownAt` write lets the reminder show again next load.** _Deferred 2026-10-25 (Foundations spec 3, final review)._ And
  `NoticeBars` keeps its own guard around reading the reminder prefs instead of sharing one.
  **Revisit if** a repeating reminder is reported.

- **Upgrading `bits-ui` past 2.19.2.** _Deferred 2026-10-25 (Foundations spec 3, Task 13)._
  `npx shadcn-svelte add popover` bumped `bits-ui` from 2.19.2 to 2.20.2, which broke
  `src/lib/components/menu/context-menu.browser.test.ts` ("openMenuFor passes its payload to
  run": the menu item detaches and the click times out). It is held at 2.19.2 (the popover works
  there). **Revisit when** upgrading `bits-ui` or on the next `shadcn-svelte add`: check that
  test first.

- **Link length in Google Classroom and webmail.** _Deferred 2026-10-25 (Foundations spec 3)._
  The 8,000-character share-link cap (`MAX_LINK_URL`) is provisional: it needs a manual check
  that long links survive Google Classroom and a common webmail client, which needs real
  accounts. **Revisit before** the private preview.
- **Collections and analyses in Share, Export, and backups.** _Deferred 2026-10-25
  (Foundations spec 3)._ Only dashboards can be shared, exported, and backed up; the envelope
  is shaped so other kinds can be added without a new format. **Revisit with** Collections and
  the Analysis step (Release 3).
- **Token-auth document saves are capped at 2.5 MB.** _Deferred 2026-10-28 (Sync spec 1)._
  The larger 16 MiB cap is lifted only for signed-in session PUTs, because resticus reads the
  body before authenticating and a site-wide raise would let anonymous callers make every
  endpoint buffer 16 MiB. Token saves keep the site's 2.5 MB request size. **Revisit when**
  token-mode (standalone or Tauri) sync is built: the pre-read step would need to
  authenticate tokens too.
- **Per-account document limits are soft under concurrency.** _Deferred 2026-10-28 (Sync spec
  1)._ The limits (50 dashboards, 25 MB) use a row lock per document, so simultaneous creates
  of different ids can overshoot slightly, bounded by the 120 saves per minute limit. A save
  that doesn't grow storage is always allowed. **Revisit if** overshoot is observed or abuse
  appears; the fix is to lock per owner.
- **Server Sentry scrubbing for documents is partial.** _Deferred 2026-10-28 (Sync spec 1)._
  It drops request data and frame locals only; exception messages and log breadcrumbs are left
  as they are. No current code puts document content in exception text. **Revisit if** any
  documents code formats content into exceptions or logs, or when the Sentry IP and scrubber
  settings are reviewed.
- **sdk-js `parseBody` matches `Content-Type` exactly.** _Deferred 2026-10-28 (Sync spec 1)._
  A JSON error with `; charset=...` (from a proxy) gets a fallback refusal code instead of the
  server's. Pre-existing and SDK-wide. **Revisit if** any server or proxy in front of the API
  adds a charset.
- **sdk-js documents schemas use strict enums.** _Deferred 2026-10-28 (Sync spec 1)._
  `visibility` and the snapshot `reason` are strict, so a new server value would fail
  validation. **Revisit when** `public` visibility or a new snapshot reason ships.
- **Share, revoke, and credit load the whole document body.** _Deferred 2026-10-28 (Sync
  spec 1)._ They only need metadata. **Revisit if** dashboards get large or those endpoints
  show up in performance work.
- **Sync spec 1 review leftovers.** _Deferred 2026-10-28 (Sync spec 1)._ Test and style polish
  with no behavior impact: no test at exactly the 16 MiB request cap; a missing
  `Content-Length` gets resticus's 400 instead of `too_large`; the rate-limit counter can
  undercount by one at a key-expiry race; the limit refusal tests don't also assert no
  snapshot or change rows; a few lines over 100 characters and import-order nits; the CSRF
  test's token setup could be simpler; no export test with non-ASCII bodies or many
  documents. **Revisit when** the files are next touched.
- **Oversized sync queues aren't uploaded in batches.** _Deferred 2026-11-02 (Sync spec 2,
  Task 6; call 7 of the plan)._ A queue whose changes pass `MAX_SAVE_CHANGES_CHARS` (1.5 M
  characters) is sent as one `replaceDocument` from the server's copy to the local one, so
  other devices with unsaved edits to it get a prompt instead of a silent merge. True batching
  needs the body after each batch, which the local log can't rebuild once server entries are
  interleaved. **Revisit if** people report prompts after long offline sessions.
- **A lost save answer is recognized only within one upload.** _Deferred 2026-11-02 (Sync spec
  2, Task 6)._ The record keeps one `inFlight` batch, and a retry overwrites it with its own
  before sending; the earlier batch is kept in memory for that retry's stale-base check. If the
  page closes during that retry and its answer is lost too, the server's copy of the first batch
  later looks like another device's edit: a conflict prompt, with nothing lost. **Revisit if**
  spurious conflict prompts are reported after flaky connections; the fix is a list of
  unanswered batches in the record.
- **Journal records of a moved document aren't carried over.** _Deferred 2026-11-02 (Sync spec
  2, Task 6)._ `finishMoves` carries the old id's log entries to the copy, but a tab still on
  the old id that journals edits on `pagehide` after the old document is removed leaves a
  record nothing replays. It needs a tab to miss the `moved` message and close within moments.
  **Revisit with** Task 8's moved-document handling, or on a report of lost edits after an id
  collision. (Task 8 made an open page flush its edits and follow the `moved` message; journal
  records written after that are still not carried over.)
- **"Keep mine" after a server log gap can't undo their widget deletes.** _Deferred 2026-11-02
  (Sync spec 2, Task 8)._ When the server's log no longer reaches the local base, their changes
  are unknown, so "Keep mine" replays mine over the server's version without first re-adding
  widgets they deleted; my edits to those widgets are dropped (the server keeps a snapshot of
  their version, and the local log keeps mine). Fixing it means sending the local document
  whole. **Revisit if** a log-gap conflict is reported (it needs 500 server versions while a
  device is offline).
- **A lost answer to "Keep mine" or "Restore" saves again on the next try.** _Deferred
  2026-11-02 (Sync spec 2, Task 8)._ The choice's save isn't recorded as `inFlight`, so if its
  answer is lost the hold stays and choosing again saves mine a second time on top of the first
  (an extra `conflict` snapshot; nothing lost). **Revisit if** duplicate snapshots show up in
  "Restore an earlier version". _Looked at in sync spec 4, still deferred:_ the list now shows
  any duplicate snapshot, which is the trigger to watch.
- **Another tab showing a purged dashboard that was discarded keeps its session.** _Deferred
  2026-11-02 (Sync spec 2, Task 8; the list part was fixed in the final review: every tab's
  list now refreshes on `sync`)._ "Discard" removes it here and posts `sync`, as the quiet
  purge does; a tab that has it open keeps showing it until it navigates, and its later edits
  store a new local copy. **Revisit if** a discarded dashboard is reported coming back.
- **One `BroadcastChannel` is left open per remount.** _Deferred 2026-11-02 (sync spec 2,
  Task 14)._ `TabChannel` has no `close()`, so each remount (an account switch) leaves the old
  app's channel open until the page goes away. They hold no document data of their own,
  though old subscribers may stay referenced; a handful is harmless.
  **Revisit if** tabs that switch accounts many times misbehave, or when the channel gains
  other resources to release.
- **The E2E documents mock's wire shapes aren't checked against the SDK's response schemas.**
  _Deferred 2026-11-02 (sync spec 2, Task 14)._ The mock server in the E2E tests answers with
  hand-written JSON, and the SDK doesn't export its response schemas, so a drift between the
  two would show only against the real stack (`npm run test:sync-stack`). **Revisit if** the SDK
  exports its schemas, or a mock drift bug recurs.
- **Rare two-write gaps when a dashboard moves to a new id.** _Deferred 2026-11-02 (Sync spec
  2, Tasks 6 and 8; triaged in the final review)._ (1) "Keep as a new dashboard" removes the
  old id right after posting `moved`; a tab flushing its last edits to the old id in that
  instant loses them (a few seconds of edits, in a rare race). (2) `finishMoveLocked` commits
  the carried-over edits and then records `through` in a second write; a storage failure
  between them carries the same edits over again (a duplicate change, such as a widget added
  twice). (3) `moveLocked` stores the copy and then the `moved` hold in a second write; a crash
  between them makes a second copy on the next try. Each needs a storage failure or a tab
  closing within moments; closing them needs the document, its log, and its sync record in
  one transaction. (4) To upload a moved copy at once, `moveLocked` posts a `committed`
  message; the app also reads that as the tab's first edit and asks the browser to protect
  storage (Firefox can show a prompt nobody asked for), and the worker retries every refused
  save. No data is lost; a direct upload request from the worker would avoid both (found in
  the final fix wave's re-review). **Revisit if** lost edits, duplicate widgets, or duplicate
  copies are reported after an id collision or "Keep as a new dashboard", or anyone sees an
  unexpected storage prompt.
- **Holds on dashboards that aren't open are never asked about.** _Deferred 2026-11-02 (Sync
  spec 2; found in the final review)._ The conflict, deleted-elsewhere, and purged dialogs
  open only for the dashboard on screen, so a hold on a dashboard in Recently deleted or one
  never opened in this tab is never prompted, and it counts as unsynced when signing out
  ("Finish saving" can't settle it). Related gaps in the dialogs: a server change while a
  choice is saved (a stale base) merges or holds again with no sign the dialog's choice
  didn't apply; "Keep as a new dashboard" is navigated twice (the dialog and the page's
  `moved` handler, harmless); and settling a purge clears other tabs' journal records for the
  old id. **Revisit with** spec 3's dashboards-list work, or if people report sign-out asking
  about dashboards they can't find. _Looked at in sync spec 4, still deferred:_ a held
  dashboard in Recently deleted answers "Delete now" with `deleted_not_saved`.
- **Sync worker edge cases.** _Deferred 2026-11-02 (Sync spec 2, Tasks 6 and 7)._ A local
  copy in a newer format (saved by a newer build in this browser) can show as synced in the
  Saved popover, since its log can't be read here; a tab that becomes visible polls at once
  only if it gets the poll lock (otherwise the poller's next minute); the worker can run two
  sweeps at start when the poll lock is granted during the first poll; `#refresh` rescans
  every stored document after each commit (fine at the 50-dashboard limit); and an oversized
  queue's single `replaceDocument` carries both bodies, so a large dashboard can pass the
  server's 2 MB limit and be held as too large. **Revisit if** the dashboard limit grows, a
  newer build is deployed alongside an older one, or a too-large hold is reported for a
  dashboard under 1 MB.
- **Test-suite cleanups from sync spec 2.** _Deferred 2026-11-02 (Sync spec 2, Tasks 1–13)._
  Test-only nits, none a gap in what's checked: an `overlap.test.ts` comment says both
  `setLayout`s move `a` (the first case shares only `b`); the storage contract's `record()`
  helper fixes `serverVersion` at 4; the web locks' fallback (no `navigator.locks`) is covered
  only through the memory platform's contract run of the same queue; the fake server's request
  label for a list is `list <cursor>`, it models daily snapshots and their expiry (added in sync spec 4) but not the snapshot cap, and
  `SYNC_STACK=1` lifts the network guard for the whole run; a `merge.test.ts` upgrade test
  mutates the global migrations (pass a chain to `fromRemote`); a `refuseNext` test in
  resolve hits `changes`, not `keepSnapshot`; `watchSpace` uses `new Date()`, not an injectable
  clock; the notice-bars test sleeps a fixed 100 ms; the E2E move test pins exact overlapping
  rects; the E2E sign-out test's request snapshot could race a late shutdown request; and the
  E2E helpers' `fromWireChanges` uses an `as never` escape, shadows `answer`, and `newDevice`
  copies only some context options. **Revisit when** a test in that area is next touched or
  turns flaky.
- **Code tidy-ups from sync spec 2.** _Deferred 2026-11-02 (Sync spec 2, Tasks 3–11)._
  Cosmetic only: `createQueueLocks` lives in `web/locks.ts` though the memory platform uses it
  (move to `platform/locks.ts`); a nested `if` in `overlap.ts` could be one condition; the
  upload's `confirmed` flag comment says "lost answer only" but it's set after any merge;
  `hold` (pull.ts) and `setHold` (upload.ts) are duplicates; `worker.svelte.ts` (about 420
  lines) and `app.svelte.ts` (about 390) could be split; `#onMessage` checks `SYNC_TAB`
  redundantly; and `beginSignOut` checks for the anonymous space twice. **Revisit when** that
  code is next changed.
- **Code tidy-ups from sync spec 4.** _Deferred 2026-11-03 (sync spec 4, task reviews)._ (5) After a
  restore's keep pulls in another device's change (stale base), the restore's `from` is built from
  the open session's document, which may lag the merged storage for a moment; undoing that restore
  could then drop the other device's merged-in edit, which stays recoverable from the conflict
  snapshot just kept. Rare. (6) Test gaps: the keep's `not_found` refusal (shares the `gone`
  branch); restoring with the keep skipped (anonymous or never uploaded); the "newer" message
  reaching the dialog; flush-before-load order; "Delete now" pulling in a real concurrent restore
  (the test uses a synthetic `not_deleted`); the two-tab "switches away" half of the account-gone
  flow (pinned by `space-switch` closing the old app first, not by a test). _Items (1)-(3) (error
  wording, the loading line and focus, and the "Delete now" wording) were done in the design pass,
  part 2; item (4), the initial bundle over budget, was done in step 4 spec 1._ **Revisit** (5) if
  an undo after a restore is reported to lose an edit, and (6) when next touching those files.
- **"Delete now" isn't queued offline in an account space.** _Deferred 2026-11-02 (sync spec 4
  plan, call 4)._ A permanent delete is destructive and rare, so offline it says it couldn't
  reach the account and leaves the dashboard in Recently deleted, rather than holding a pending
  purge that could fire later against a copy restored on another device. **Revisit if** people
  report needing to empty Recently deleted while offline.
- **Restoring an earlier version needs the account reachable in an account space.** _Deferred
  2026-11-02 (sync spec 4 plan, call 1)._ The restore first keeps the replaced version as a
  server snapshot, so it can be undone after a reload; offline (or refused) nothing is restored,
  even for the local kept original. A queued keep would need a new hold kind. **Revisit if**
  people report restoring while offline.
- **Unsynced edits in the browser where an account is deleted are lost with it.** _Deferred
  2026-11-02 (sync spec 4 plan, call 6)._ The dashboard removes the deleted account's space at
  once, and "Download my documents" on sjvair.com's delete page has only the server's copies, so
  edits that never reached the server go too. The person chose to delete the account. **Revisit
  if** anyone reports it; the fix is a dashboard-side "download a backup first" step before the
  account menu's link to the account page.

## Map & selection

- **Comparing mixed kinds of place in one widget.** _Deferred 2026-11-04 (step 4 spec 2)._ A
  school, a monitor and a county side by side in one Chart: several places are one
  `SpatialSelection`, which is all monitors or all regions, so the picker greys out the other
  kind (with a reason) and schools and "your location" are single-place only. Mixing needs a new
  shape across map-sdk and the data layer. **Revisit if** users ask, or when Release 3 analysis
  needs it.
- **Per-monitor pollutant coverage in the place picker.** _Deferred 2026-11-04 (step 4 spec
  2)._ Monitors are offered by type (`monitors/meta/` `monitors[<type>].entries`), so a site
  whose type takes a pollutant but that doesn't measure it (an AirNow site without ozone) can be
  picked and then shows "No data". **Revisit when** the server exposes per-monitor entry types.
- **Location type and region filters in the place picker.** _Deferred 2026-11-04 (step 4 spec
  2)._ One search box covers the brief; `searchLocations`' `type` and `region` options stay
  unused. **Revisit if** school searches return too many unrelated rows.
- **Recent places don't follow the account across devices.** _Deferred 2026-11-04 (step 4 spec
  2)._ They're kept per space in this browser's preferences, never sent to the server or saved
  in documents. **Revisit if** people ask for them on another device.

- **Per-type counts in Browse's "Inside" list.** _Deferred 2026-11-04 (step 4 spec 2)._ The
  list of child types under a region ("Inside Tulare County") shows names only; counts would
  need one `regionsIn` fetch per child type. **Revisit when** people need the counts, or the
  server adds counts within a parent.

- **A picked region whose type has no metadata label is dropped on Done.** _Deferred
  2026-11-05 (step 4 spec 2, final review)._ The picker names a picked region with its type's
  label from `regions/meta/`; a region whose type has none resolves as gone, so it isn't picked
  again and Done saves the widget without it. Why: every region type the server serves has a
  label today, and a gone place is already handled (see `ARCHITECTURE.md`). **Revisit if** the
  server adds a region type without a label, or a saved region vanishes after "Change place".

- **Browse's list state and paging semantics.** _Deferred 2026-11-05 (step 4 spec 2, final
  review)._ Back returns to a list with its filter cleared and only the first page shown; the
  paged grid (50 rows drawn of, say, ~1,160 ZIP codes) has no `aria-rowcount` or
  `aria-setsize`, so a screen reader hears the rows drawn, not the total (the count is
  announced once in the status); and Browse's "Loading…" isn't announced (the count is, when
  the list settles). Why: minor next to the rest of the picker; each is a small change. **Revisit
  on** a screen-reader or usability report about Browse, or with the accessibility audit.

- **Map views and shapes across the antimeridian.** _Deferred 2026-11-08 (map-sdk in-view
  shapes fix, `docs/superpowers/specs/2026-11-08-in-view-shapes-design.md`)._ map-sdk's
  in-view test (the feature list, the view summary, and the focus and hover tooltip anchors)
  treats lng/lat as flat, so bounds or shapes that cross 180° are measured wrong. Points had
  the same limit before the fix. Every SJVAir map shows the San Joaquin Valley, far from the
  date line. **Revisit when** a host map can pan across the date line (a world or Pacific
  view): split bounds and shapes at 180° before testing.

- **Polygons with fewer than 3 points in the in-view test.** _Deferred 2026-11-08 (map-sdk
  [#18](https://github.com/SJVAir/map-sdk/pull/18) review)._ map-sdk never counts a polygon ring
  with fewer than 3 points as in view, even with a vertex on screen. Valid GeoJSON rings have at
  least 4 positions, so no SJVAir data hits it. **Revisit when** a source is found sending
  degenerate polygons.

- **`MapContext` stand-ins and the two new members.** _Deferred 2026-11-08 (map-sdk
  [#18](https://github.com/SJVAir/map-sdk/pull/18) review)._ `MapContext` gains required
  `focusedAnchor` and `anchorFor(item)`. Only code that writes its own `MapContext` (a test
  double) must add them; no host does. Making them optional would make every caller handle
  their absence. **Revisit when** a host or a test outside map-sdk implements `MapContext`.

- **A faster in-view test for shapes.** _Deferred 2026-11-08 (map-sdk
  [#18](https://github.com/SJVAir/map-sdk/pull/18) review)._ map-sdk's `inView` could skip the
  exact test when a shape's label point or whole bbox is inside the view. The bbox pre-check
  already rejects most shapes, and no slowdown has been measured. **Revisit when** moving the map
  with many detailed shapes (all counties, a big plume day) is measurably slow.

- **Every county on multi-county place search rows.** _Deferred 2026-11-04 (sjvair.com
  [#308](https://github.com/SJVAir/sjvair.com/pull/308), the user: "option 2 might be the better
  way to go in the long run")._ `regions/places/search/` rows carry one `county`: the county
  holding the region's point-on-surface. A region that crosses county lines shows only that one.
  Locally, with a 1%-of-area threshold, that's 20 of 200 school districts, 21 of 237 ZIP codes,
  5 of 56 urban areas, and the Valley air district (8 counties). Cities, CDPs and AB 617
  communities sit in one county. Fine for telling same-named results apart; misleading if the
  picker shows it as the place's county. **Revisit when** the picker labels places with their
  county, or users read the one county as the whole story: serve `counties: [...]` using the
  region list's `also_in` 1%-of-area rule (measure search time first; the per-row area math is
  the cost).

- **The Census Bureau's short name for census tracts.** _Deferred 2026-11-05 (sjvair.com region
  display names, the user)._ A tract's display name is its full code, "Census Tract
  06019000100", from the `regions/meta/` `name_template` "Census Tract {name}". The Bureau's
  own form, "Census Tract 1, Fresno County", is friendlier, but a pattern around `{name}` can't
  produce it, and the short number alone is ambiguous: 274 short tract numbers repeat across the
  eight counties locally. The server already has the parts (each tract's `metadata` holds
  `namelsad` and `countyfp`). **Revisit when** tracts show up in resident-facing views (picker
  results, starter dashboards) or users ask what a tract code means: the server would then
  send a computed name for each tract.

- **Region GeoJSON lookups beyond about 10 requests.** _Deferred 2026-11-04 (step 3 spec 4,
  the user)._ `getRegionsGeoJSON` (and the by-code lookups) send one request per 100 codes,
  concurrently; all 2020 tracts (~980) is about 10. A whole area doesn't need codes at all
  (`within` is one request). **Revisit when** a map regularly needs more than about 10
  requests, or the server slows under them: a POST lookup with codes in the body, or a higher
  cap for simplified shapes.

- **Saving land-use regions by code.** _Deferred 2026-10-22 (sjvair.com metadata plan,
  decided by the user)._ Land-use codes include the state dataset's `OBJECTID`, which a
  refresh can renumber, so they are excluded from code lookup and the permanence promise;
  the dashboard can't save a land-use region as a reference. **Revisit when** someone needs
  land-use areas in a saved widget or rule; the server first needs a stable code built from
  fields that survive a refresh.
- **Greying out places with no data in the place picker.** _Deferred 2026-10-22
  (sjvair.com metadata plan, coverage endpoint)._ Coverage has no bulk mode in Release 1
  (only per dataset and per single place), so the picker can't know which places lack
  data. A place without data shows a "no data for this range" state once chosen.
  **Revisit when** users struggle to find places with data; it would need a bulk coverage
  mode, probably backed by a precomputed table on the server.
- **Region display names: ZIPs and tracts show bare codes ("93702"), and a city, urban area and
  CDP can share a name ("Arvin").** _Deferred 2026-11-05 (step 4 spec 2, the user)._ The server
  names these regions bare, so the picker, chips and titles show "93702"; the user wants "ZIP
  93702" built from metadata, not hardcoded. **Revisit when** sjvair.com adds a display name or
  a per-type name template to `regions/meta/`.
- **Drawn-shape map selection (box/lasso/radius).** _Sequenced later 2026-09-23 (IDEA.md
  Q2)._ This comes after feature and region picking. It will be an opt-in `terra-draw`
  plugin in `map-sdk`. **Revisit when** feature and region selection have shipped.
- **Globe-projection zoom precision.** _Noted 2026-09-16._ Large counties are under-zoomed
  in the globe projection. **Revisit when** building the Map widget on `map-sdk`.
- **`land_use` / `mtrs` region browsing ("progressive unlock").** _Deferred 2026-09-17
  (multi-region selector spec)._ These tables have roughly 66k and 28k rows. Browsing them
  only after narrowing to a small parent area needs its own design. **Revisit when**
  pesticide analyses need parcel-level (MTRS) selection.
- **`protected` / `custom` / `school_district` region data.** _Deferred 2026-09-17; re-checked
  2026-09-28 and 2026-10-13._ The `place` region type was **removed** from the server
  (migrations 0009/0010); name lookup now tries city, then CDP, then urban area. New types
  exist: `air_district` and `ab617`. `school_district` has an import command
  (`import_school_districts`), and there is a new **`Location`** model for schools and
  child care (`import_schools`). Plans rely on **`school_district`** (school region
  alerts, the picker) and on the **3 `custom` forecast zones** (Tulare, Kern, Sequoia);
  the other 6 forecast zones, including Fresno, are county regions, so a zone lookup goes
  through the forecasts data or a metadata zone list, not `type=custom`. **Production checked
  2026-10-14** (public API): 201 school districts and the schools are loaded, but there
  are **0 `custom` regions**, so the 3 forecast zones are missing and production has no
  forecasts for them (tracked as a separate fix in `TODO.md`). Nothing planned uses
  `protected`. **Revisit when** the step 3 metadata plan and the Release 2 alerts plan
  start, to confirm the zones were imported.
- **"All counties" aggregate view.** _Deferred 2026-09-15._ The server doesn't support it,
  and we chose not to approximate it on the client. **Revisit when** the server gains a
  valley-wide region, or a custom region is defined for it.

- **monitor-map 5.0: an expanded legend can run under the zoom and compass buttons at 390 px (found 2026-11-09).**
  monitor-map-18's legend fix (spec `docs/superpowers/specs/2026-11-09-user-contract-and-legend-design.md`) collapses the
  legend when a monitor panel opens on narrow screens and caps its height so it never covers Options and Search. If the
  user expands it again with the panel open, at 390 px wide the card can still reach under the zoom and compass buttons
  on the right. **Why deferred:** minor, and it only happens after the user expands the legend with a panel open.
  **Revisit:** if it's reported, or when monitor-map's map controls are next laid out.
- **monitor-map 5.0: final-review minors from #131 and #132 (2026-11-09, monitor-map-18).**
  (1) No test checks that subscribing sends the current token after a user switch. **Why:** the panel's
  `{#key getApiToken()}` remounts the control, and that remount is tested. **Revisit:** if the subscribe path changes or
  mobile reports a wrong-account subscription. (2) The README doesn't warn hosts against calling `monitorMapUserChanged()`
  inside a `$derived` (it writes `$state`). **Why:** mobile calls it from event handlers. **Revisit:** if a host hits
  Svelte's `state_unsafe_mutation` error. (3) No comment ties the legend wrapper's `top-18` / `md:top-32` offsets to
  OptionsBar's height. **Why:** cosmetic. **Revisit:** when OptionsBar's height changes. (4) Ruling: two cookie-only users
  (no `api_token`) switching in place don't remount the subscription control. **Revisit:** if mobile ever signs in
  without a token.
- **map-sdk: "MapTiler Cloud API key is not set" console warning (found 2026-11-09).** Every map open logs it, because
  map-sdk deliberately puts the key on each request (`maptilerKeyTransform` in `src/lib/view/create-gl-map.ts`) rather
  than on `@maptiler/sdk`'s global `config.apiKey`, so two maps with different keys don't clash. Maps work. **Why
  deferred:** console noise only, and the design is intended. **Revisit:** if a map-sdk feature starts relying on the
  global config, or before map-sdk's first stable release, to silence the warning.

## Analysis & data

- **A server test for the lone empty `?date=` on the HMS lists.** _Deferred 2026-11-04 (step 3
  spec 4 final review, graded minor)._ Since sjvair.com #303, an empty `date` counts as no date
  filter, so `hms/smoke/?date=` alone now gets the today default (before, it returned every
  row). That was a deliberate call, but no test pins it. **Revisit when** someone next touches
  `camp/api/v2/hms/` (add the test to `DateRangeTestsMixin`).

- **Places in one forecast zone share no request.** _Deferred 2026-11-05 (step 4 spec 3, Task
  5)._ The forecasts overlay asks once per place per month, even when several places map to
  the same zone (the spec's "one request per distinct source"): the zone is only known from the
  answer. A 10-place Data table makes up to 10 small requests a month. **Revisit if** request
  counts matter, or the server returns the zone up front (then group places by zone first).

- **`calenviroscreen/meta/`.** _Deferred 2026-11-04 (step 3 spec 4, the coordinator and the
  user)._ The sdk-js CalEnviroScreen wrapper takes the version (`4.0`/`5.0`) as a required
  argument and returns raw indicator fields, because no metadata describes them: the catalog's
  `calenviroscreen` entry has an empty `meta_url` on purpose. Clients need the indicator
  labels, units and the versions on offer from the server rather than hardcoding CES field
  names or picking a version. Needs sjvair.com work (the endpoint) and an sdk-js wrapper.
  **Revisit before** Release 3 starter analysis #7 or any CES display.

- **Collections and "Mark for analysis" in Release 1.** _Deferred 2026-10-25 (Foundations
  spec 4 planning, decided by the user)._ The 2026-09-24 plan shipped a minimal Collections
  (the store, the drawer, "Mark for analysis" / "Analyze" / "Add to collection ▸", staging
  that freezes rolling ranges, and a placeholder Analysis view) in Release 1, so IDEA.md's
  widget actions were complete from the start. But a Release 1 Collection could only be
  gathered, not used: there are no analyses and no download until Release 3's notebook
  bundle, and Release 3 still has to decide the Analysis view's layout and how items bind
  to an analysis, so a drawer built now would likely be redone. Foundations spec 4 is
  dropped; Collections move to Release 3 step 1. Release 1 widgets keep `analyzable`, and
  `defaultCollectionId` stays an optional field. **Revisit with** the Release 3 step 1 spec
  (Collections and the analysis engine), or sooner if people ask to gather data across
  dashboards before then.
- **Outside health data (HCAI ED visits, CDC PLACES, etc.) and the "smoke → ER visits"
  lag analysis.** _Deferred 2026-09-23 (IDEA.md Q6)._ The server holds no ER,
  hospitalization, or incidence data, so health analysis is limited to CalEnviroScreen's
  tract indicators for now. Adding outside data needs new server importers plus a
  privacy and small-number-suppression policy. **Revisit when** the pre-built analyses
  have shipped and there's demand, or when a data partner is available.
- **Entry types beyond PM2.5/O3.** _Deferred 2026-09-15; mechanism decided 2026-09-24._
  Pollutants offered in the frontend (widgets, analyses, alerts) will be gated by a
  server **available-pollutants** metadata list (PM2.5 + O3 today), replacing the
  v1 hardcoded `"pm25" | "o3"` (which goes away with the v1 code).
  **Revisit when** SJVAir is confident in NO2/SO2/CO (or others) — enabling them is then a
  metadata change.

- **In-browser R and JavaScript kernels in JupyterLite.** _Deferred 2026-09-23
  (IDEA.md Q6)._ Embedded JupyterLite ships Python (Pyodide) only; R/JS/TS users use
  export bundles in their local tools. xeus-r lacks `openair`/`sf`/CRAN; the webR
  JupyterLite kernel is stale; xeus-javascript can't start offline and
  `jupyterlite/javascript-kernel` is alpha. Full findings in
  `docs/reference/jupyterlite-kernels.md`. **Revisit when** `openair`/`sf` reach
  emscripten-forge or webR's kernel is revived (R), `jupyterlite/javascript-kernel`
  ships a stable 0.4 (JS), or schools/community users ask for them.

- **CEIDARS facility emissions.** _Deferred 2026-09-24 (docs review); updated 2026-10-13._ On
  the server (yearly facility emissions + health risk indices) but no widget, analysis,
  or SDK wrapper is planned. sjvair.com PR #282
  (Facility Emissions Explorer, merged 2026-10-13) moved the API to
  `/api/2.0/emissions/…` and added CEPAM, dairies, wells, and toxics, so anything we build
  uses `emissions`. **Revisit when** an emissions or facility-proximity use case comes up.
- **Combined heat + air-quality tier bump** (raise the tier by one when both conditions
  are at tier ≥ 2, reflecting combined heat and ozone effects). _Deferred 2026-09-28._ It
  is a health claim needing expert backing. **Revisit when** the user or a health advisor
  confirms a rule.
- **Pesticide timing → health analysis** (from IDEA.md's prior brainstorm). _Deferred
  2026-09-24._ No health outcome data beyond CalEnviroScreen; closest planned work is
  starter #9 (use trends) and #7 (CES indicators). **Revisit with** the outside-health-data
  entry above.
- **Server summaries for PM10.** _Deferred 2026-09-25; updated 2026-11-05._ CIMIS weather now
  has monitor summaries (sjvair.com #313: 11 types, all but wind direction, through a
  per-monitor-type switch). PM10 is still raw: the client fetches it span-capped and chunked and
  downsamples it in a worker. **Revisit when** raw PM10 fetches get slow or large. It's now a
  one-line switch per monitor type (or the model flag, if regions should get it too).
- **To-date summary rows for the current month, quarter, season and year.** _Deferred
  2026-11-05 (the user, on sjvair.com #313)._ The scheduled rollups write those rows only once a
  period has ended. `rebuild_summaries` used to also write the current period's rows, which then
  froze at the rebuild time (and existed only for rebuilt stations), so #313 makes it roll only
  finished periods, like `repair_summaries`. A proper to-date value needs a small scheduled task
  that re-rolls the current periods from day rows after each daily rollup, plus decisions on
  settling, what `is_complete` means mid-period, and region rows. Until then the dashboard
  computes "so far this month/year" from daily rows. **Revisit when** a widget wants a to-date
  value or computing it from daily rows gets slow.
- **Region-level weather summaries.** _Deferred 2026-11-05 (Get data layers, the user)._ CIMIS
  stations get monitor summaries only; there are never region rows for weather. Region
  weighting is built on air-sensor grades and health checks, so weather would need its own
  rule. Get data gives a place its weather through the nearby-stations list
  (`monitors/weather/place/`) and one station's summaries. **Revisit when** a place needs one
  blended weather value instead of a station's.
- **Wind direction summaries (circular mean).** _Deferred 2026-11-05 (Get data layers, the
  user)._ `winddirection` stays raw: averaging angles is wrong. A circular mean (and perhaps a
  prevailing-direction stat) would need its own aggregation. **Revisit when** a chart or the
  pollution-rose preset needs daily or monthly prevailing wind.
- **Sub-yearly pesticide analysis.** _Deferred 2026-09-24; updated 2026-10-13._ The server
  now has **monthly pesticide rollups** (`PesticideUseRollup`, with month 0 for undated
  records), exposed through the new `sections/` and `townships/` endpoints (`month=`) and
  section detail. The `region/<id>/summary/` endpoint is still chemical × commodity ×
  year. **Updated 2026-11-05:** `pesticides/place/` (sjvair.com #310) now serves monthly
  pounds, acres and applications for any place, for the Get data page. Starter analysis #9
  stays yearly for now. **Revisit when** users need seasonal pesticide timing in an
  analysis; it now needs only a client adapter on `getPesticidesForPlace`.
- **Pesticide use within a distance of a place.** _Deferred 2026-11-05 (Get data layers,
  the user)._ `pesticides/place/` counts a place's use by region membership: a region's
  touching MTRS sections, a monitor (or a school, via the client) by its ZIP. "Use within 1
  mile of this school" would need a buffer (the `shapes.BUFFERS` choices, as `sections/`
  already takes). Region membership is the rule for every Get data layer today. **Revisit
  when** the dashboard wants a distance option or users ask about nearby use.
- **Fast pesticide totals for multi-county places.** _Deferred 2026-11-05 (sjvair.com #310
  final review)._ `pesticides/place/` sums a non-county place through the MTRS sections it
  touches. A place spanning several counties takes that path too: the SJV air district
  touches 24,090 sections, and its aggregate took about 5 s cold locally (cached for 24h
  afterwards; counties themselves take a fast path, ~1.2 s cold). Counting whole counties
  with `county__in` and only partial ones by section would fix it. **Revisit when** a
  widget uses a multi-county place (air district, legislative district) or cold requests
  show up as slow in production timing.
- **Smoke "no data" vs "no smoke".** _Deferred 2026-11-05 (Get data layers, the user)._
  `hms/smoke/place/` (sjvair.com #312) reads a day with no stored HMS outlines as no smoke
  (`density: null`). An empty HMS file and a fetch that never ran store the same nothing, so a
  missed day reads as clear sky. Fix: record each successful daily fetch (a small per-day
  table) so a missed day reads as unknown. The user decided a new table isn't worth it yet:
  production fetches about 13 times a day plus a final pass. **Revisit when** a missed day
  turns up in production data or users report false clear days.
- **`pesticides/place/`: a buffer and a radius.** _Deferred 2026-11-06 (sjvair.com pesticide
  place filters spec)._ The Pesticides Explorer's region pages take a 0/1/3/5 mi buffer
  (`regions/meta/` `buffers`), and its near-me pages take a point plus 1/3/5 mi. `place/`
  addresses only a region or a monitor. **Revisit when** the dashboard wants "around this place"
  or "near me" pesticide totals.
- **A per-place pesticide breakdown endpoint.** _Deferred 2026-11-06 (same spec)._ The explorer
  shows per-place top chemicals, products and commodities, use by application method, and
  biggest movers between years. `place/` returns only monthly and yearly totals. One
  `pesticides/place/breakdown/?by=chemical|product|commodity|method` could serve them all.
  **Revisit when** the dashboard designs a "what's used here" view.
- **Schools' 3×3 section block for pesticide totals.** _Deferred 2026-11-06 (same spec)._ The
  explorer answers "within about a mile" of a school from the section holding it plus the eight
  around it (`stats.block_sections_many`). `place/` can't address a location, and the shared
  place resolver would need a location form.
  - **Until then** (the user, 2026-11-06), a school or "my location" uses its ZIP, then its
    city, then its county for pesticide totals (the dashboard's `placeRegion`), and the legend
    names that area.
  - **Revisit when** the dashboard or its users need "within about a mile" totals.
- **`hms/smoke/place/` speed.** _Noted 2026-11-06 (sjvair.com #314)._ The `Smoke` date index
  (#314, migration `hms/0003`) made `hms/smoke/` list and range queries index scans (a month's
  first page: 1.6 ms → 0.07 ms on five synthetic seasons), but it didn't speed up the place
  endpoint. A county over a year still takes 1.6–1.9 s on a synthetic heavy season (2,460
  outlines; 12,300 over five seasons): the planner keeps the GiST index, and about 1.3 s is
  `ST_Union`/`ST_Intersection` on the outlines. A ZIP takes 51–67 ms. Ranges ending today
  aren't server-cached. A fix would change the query or the geometry (e.g. simplified or
  pre-clipped outlines). **Revisit when** production timings for `hms/smoke/place/` show slow
  requests, or the dashboard's smoke layer feels slow on county or larger places.
- **CarbonMapper data source.** _Noted 2026-09-24; updated 2026-10-14._ The server now
  imports Carbon Mapper methane sources and plumes and serves them under
  `emissions/methane/` (merged with #282), so the dashboard would read them from the
  server and needs no `VITE_CARBONMAPPER_KEY` (remove it from `.env.example` when
  convenient). Carbon Mapper's terms are **non-commercial and share-alike**, which its
  catalog entry's `license` and any export must carry. Nothing is designed in the
  dashboard. **Revisit when** a methane layer or analysis is scoped. Same for the unused
  `VITE_OPENWEATHERMAP_KEY` — remove it if no use appears.
- **Calibration choice on layers.** _Deferred 2026-10-22 (Foundations spec 2)._ The data
  layer always uses each monitor type's published series (e.g. EPA-calibrated PM2.5 for
  PurpleAir) and reports which one it used; `QueryDescriptor` has no processor field. An
  optional field can be added later without a document migration. **Revisit when**
  researchers ask for uncalibrated or alternative-calibration data.
- **The query client has no `dispose()`, and its poller is never stopped.** _Deferred
  2026-10-22 (Foundations spec 2)._ `getQueryClient()` returns one app-wide client, so nothing
  needed teardown. **Revisit when** HMR or tests recreate clients, or anything creates more
  than one.
- **`adapter.target` takes no `AbortSignal`.** _Deferred 2026-10-22 (Foundations spec 2 final
  review)._ Resolving a layer's target can't be cancelled when its subscriber moves on; today
  it makes no network calls (the web region resolver answers at once), so nothing is wasted.
  **Revisit when** step 3's region resolver makes network calls: pass the subscription's
  signal through.
- **Updating a subscription to an input with the same key detaches first.** _Deferred
  2026-10-22 (Foundations spec 2 final review)._ `Subscription.update()` with a different
  input that resolves to the same cache key (e.g. a selection's ids reordered) shows
  `loading` for a moment and, if it was the entry's only subscriber with a fetch in flight,
  aborts and restarts that fetch. **Revisit when** widgets edit selections in place (Release
  1 step 4) and the flash or the extra fetch shows. The same detach shows when a poll finds the
  range has grown across a resolution boundary (_noted 2026-11-04, step 4 spec 1 final
  review_): the subscribers move to the new resolution's entry and the widget shows loading
  once, without the old data, until it arrives. **Revisit** both together: keep the old data
  showing while the new entry loads.
- **A new subscriber refetches an errored entry at once.** _Deferred 2026-10-22 (Foundations
  spec 2 final review)._ Attaching to a cache entry whose last fetch failed refetches
  immediately, skipping the poller's backoff, so widgets opening one after another against a
  failing server each send a request. **Revisit if** that shows up as load during an outage;
  the fix is to respect the entry's backoff when attaching.
- **Midnight race on rolling keys.** _Deferred 2026-10-22 (Foundations spec 2 final review)._
  A subscriber that attaches across midnight to a rolling entry ("last 7 days") whose fetch
  started before midnight gets the older dates until the next poll. **Revisit if** a widget
  shows yesterday's window after midnight for longer than a poll; the fix is to compare the
  in-flight request's dates when attaching.
- **A point's or school's fallback isn't shared with plain region widgets, and re-runs each
  poll.** _Deferred 2026-11-04 (step 4 spec 2, Task 7 review)._ A fallback query (ZIP → city →
  county) is its own cache entry, so a ZIP widget and a point widget using that ZIP fetch it
  separately, and each poll walks the chain again from the ZIP (a point with data only at the
  county makes 3 requests per poll). Why: correct, and the HTTP cache absorbs most repeats.
  **Revisit if** point or school widgets show up as load, or the polls are slow: share the
  per-region entries, or remember the region used until the range changes.
- **The monitors list is fetched once per session.** _Deferred 2026-11-04 (step 4 spec 2, Task
  9 review)._ It's memoized, so a monitor added to the server after the page loaded isn't in it:
  a widget saved with it elsewhere reads "no longer available" here, and the picker doesn't
  offer it, until a reload. Why: new monitors are rare, and a reload fixes it. **Revisit if**
  it's reported, or a long-lived page (Tauri, a kiosk) needs it: refresh the list on a miss, or
  on a timer.
- **A failure fetching monitor names fails the whole data query.** _Deferred 2026-11-04 (step 4
  spec 1 final review)._ Monitor places are named from the monitors list; if that fetch fails,
  the query fails with it, though the readings themselves came back. Why: the list is memoized
  and shared with the processor lookup, so it rarely fails alone. **Revisit if** it's seen: fall
  back to the monitor ids as names and let the next poll fill them in.
- **Yearly requests' `fetchEnd` is the segment end.** _Deferred 2026-11-04 (step 4 spec 1 final
  review)._ Yearly summaries come in one call whose end date is the segment's end, not a whole
  year's, so the same fixed past range can produce different request URLs depending on where its
  segment ends, and those URLs don't cache as stable ones. Why: correctness is fine, only
  caching suffers, and yearly views are rare. **Revisit when** HTTP caching of past summaries
  matters (the server or a CDN caches them): round the end up to the year.
- **The seasonal `{year}` path for a winter season is unverified.** _Deferred 2026-11-04 (step 4
  spec 1 final review)._ Single-monitor seasonal summaries are fetched by year from the unit's
  first month (`pathConfig` in `src/lib/data/adapters/air-quality-fetch.ts`), so the season
  starting December 2025 goes to the 2025 path, while the dashboard's own season rules put that
  season in 2026 (`seasonStartMonth` in `src/lib/format/range.ts`). Not checked against the
  server. **Revisit when** a seasonal view is first tested against sjvair.com (check which year
  the server files December under, and fix the path or the rule).
- **Whole-layer backfill gaps.** _Deferred 2026-11-04 (step 4 spec 1 final review)._ For a
  whole-layer (every monitor) query, the backfill that fills recent periods drops a monitor that
  appears only in the backfill response, and a place with no data in the window costs a backfill
  request on every poll. Why: whole-layer queries feed only the map (not built yet). **Revisit
  when** the map widget uses whole-layer queries (Release 1 step 5).

- **Summary period starts in standard time are stamped an hour early on production.**
  _Deferred 2026-11-04 (summary cache and place lookup; finding 2 of sjvair.com
  `docs/superpowers/reports/2026-11-03-summary-rollups.md`)._ Not fixed by the Pacific
  schedule change. **Cause found** (2026-11-04): the backfill job stepped its UTC-reloaded
  cursor by 24-hour days, so standard-time days, months, seasons and years landed at 23:00 the
  day before. Fixed in sjvair.com #305 (merged into `develop` 2026-11-04). Production's rows are repaired by
  `repair_summaries` at the deploy (steps in the deploy entry above). **Revisit when** #305 is
  deployed and the repair has run; local winter rows from a backfill may show the same stamps
  until then.
- **Region summaries are mostly missing on production.** _Deferred 2026-11-04 (summary cache
  and place lookup; finding 3 of the same report)._ **Cause found** (2026-11-04): the hourly
  region job took its hour from when it ran. Queued behind the monitor tasks, a start after the
  top of the hour summarized an hour with no monitor rows yet and wrote nothing. Fixed in #305.
  The production worker logs that would confirm it, and the refill, are in the deploy entry.
  **Revisit when** #305 is deployed and the region hours are refilled, before region-summary
  widgets ship.
- **Misaligned seasonal rows already in production.** _Deferred 2026-11-04 (summary cache and
  place lookup)._ The old UTC schedule wrote seasonal windows starting in May (for example
  `2026-05-01`); the Pacific fix only affects new runs. `repair_summaries` (#305) deletes them
  and rebuilds the real seasons at the deploy. **Revisit when** that repair has run.
- **`schedule.hour_for_run` docstring overstates the integrity check.** _Deferred 2026-11-04
  (summary-rollup follow-up, sjvair.com #305)._ It implies `check_summary_integrity` catches a
  late run, but when both hourly jobs (monitors and regions) are an hour late together the check
  doesn't flag it. Docs only; the behavior is as designed. **Revisit when** someone next edits
  `camp/apps/summaries/schedule.py`.
- **Hidden monitors' summaries are readable by anyone with the id.** _Deferred 2026-11-04
  (summary cache and place lookup; predates this work)._ **Revisit when** "hidden" gets a
  defined read policy.
- **`regions/places/lookup/` answers are cached 24 hours.** _Deferred 2026-11-04 (summary
  cache and place lookup)._ After a boundary re-import, cached answers stay stale until they
  expire (like spec 1's place endpoints). **Revisit if** an import flow needs fresh answers:
  invalidate the keys from the import commands.

## Map plugins

- **Map plugins for the remaining server datasets.** _Deferred 2026-09-24 (docs review);
  updated 2026-11-03 (map-sdk milestone 1 spec)._ map-sdk milestone 1 covers monitors, region
  fill, HMS smoke and fire, **CalHeatScore ZIPs, and forecast zones** (the user moved the last
  two in). Collocation, EV, and wind are milestone 2 (below); "weather" in monitor-map is only
  the detail panel's temperature lookup, not a map layer. Deferred: pesticide use and
  SprayDays notices, CalEnviroScreen tracts, CEIDARS facilities, TEMPO rasters. Most can run
  on map-sdk's general points and shapes plugins plus their metadata scale with little or no
  preset code; rasters need the raster plugin (below). **Revisit when** a widget or analysis
  needs one on a map (pesticide notices likely first, alongside the alerts work).
- **map-sdk: monitor readings round in the list but are cut off in the tooltip.** _Deferred
  2026-11-08 (map-sdk parity defaults, [#15](https://github.com/SJVAir/map-sdk/pull/15); the
  user chose to fix fire only)._ The monitor tooltip cuts its reading to a whole number, as
  sjvair.com's map does, while the feature list and its accessible names round to the
  metadata's precision. Near a level boundary they disagree: a PM2.5 reading of 9.06 shows "9"
  in the box but "9.1 µg/m³, Good" in the list, and Moderate starts at 9.1. Fire values now use
  the same cut-off in the box, list and accessible names (`pointsPlugin`'s `truncateValues`);
  monitors were out of that work's scope. **Revisit when** monitor values or list formatting
  are next touched, or a user reports a number that disagrees with its level: turn on
  `truncateValues` for monitors (rows would then read "9.0").
- **A heatmap layer over the map, of daily values.** _Deferred 2026-11-09 (step 4 spec 5
  brainstorm; the user's idea)._ What the user means by "heatmap": a map layer shading the area
  by each day's values, the way GitHub shades a day by its commits, not an hour × weekday grid
  (that widget was dropped; see "Dropped"). It belongs to the Map widget and map-sdk (step 5),
  not spec 5. To settle when designed: a smooth heatmap fills in between monitors, so it shows
  values where nothing was measured; the day it shows; and which daily figure (spec 5's
  per-scale daily figure, `scale.daily_statistic`). **Revisit when** the Map widget is designed
  (step 4 → step 5/6), or map-sdk takes on a new layer type.
- **Wind layer license.** _Found 2026-11-03 (map-sdk milestone 1 spec)._ `@maptiler/weather`
  is proprietary ("All rights reserved", only for use with an active MapTiler account), so
  map-sdk can't depend on it under the license policy. monitor-map 4.x uses it today. Options:
  monitor-map keeps wind as its own plugin outside map-sdk, or wind moves to an open data
  source. **Decided 2026-11-04 (the user, milestone 2 spec):** monitor-map keeps its own wind
  layer on `@maptiler/weather`; map-sdk only lets a host plugin add a custom layer in its
  draw-order slot. See "Wind from open data" below.
- **Wind from open data.** _Deferred 2026-11-04 (map-sdk milestone 2 spec, the user's call:
  "option 1 for now")._ A map-sdk wind plugin on open data, e.g. NOAA GFS winds (public
  domain) processed by the server into textures and drawn with an open-source wind layer
  (`webgl-wind`, ISC), would let every map, the dashboard included, show wind and drop the
  proprietary `@maptiler/weather`. It needs new server work and would look different, so it
  isn't on the go-live path. **Revisit if** the dashboard wants wind on a map, or to drop
  `@maptiler/weather`.
- **Server EV charger integration, then a map-sdk EV layer.** _Deferred 2026-11-04 (map-sdk
  milestone 2 spec, the user)._ EV chargers come straight from NREL (with a public key and a
  hardcoded ZIP list of the 8 valley counties plus Calaveras, Tuolumne, Mariposa, Mono and
  Inyo) and stay in monitor-map, since map-sdk layers read SJVAir server data. If the server
  integrates chargers (or at least serves the ZIP list, which would need ZIP regions for the
  5 mountain counties), map-sdk gets an EV layer through `@sjvair/sdk`. Needs a sjvair.com
  plan first. **Revisit when** the server integrates EV chargers, or a dashboard widget wants
  them.
- **map-sdk raster plugin.** _Deferred 2026-11-03 (map-sdk milestone 1 spec)._ The plugin
  interface and legends allow rasters, but nothing is built. **Revisit with** TEMPO on a map,
  or wind if it moves to an open raster source.
- **Mapping user GeoJSON or CSV files.** _Deferred 2026-11-03 (map-sdk milestone 1 spec, the
  user's call: "prepare for it")._ map-sdk's data sources accept plain GeoJSON and a
  host-supplied scale, so only the importer and a "pick a column and colors" step are missing.
  **Revisit when** users ask to put their own data on a map.
- **Arrow keys jumping to the nearest map feature.** _Deferred 2026-11-03 (map-sdk milestone 1
  spec)._ Keyboard and screen-reader users reach features through map-sdk's feature list (one
  tab stop, features in view). Spatial arrow-key navigation is tricky to get right and the
  list covers the need. **Revisit if** keyboard users find the list too indirect.
- **"hms-fire icon could not be loaded" warning in map-sdk's e2e tests.** _Found 2026-11-03
  (map-sdk milestone 1 build)._ The demo's browser tests log this MapLibre warning; fires still
  draw with their level icons, and the cause hasn't been traced (most likely the map asks for
  the icon before the plugin has added it). **Revisit when** someone next works on the fire
  plugin, or sooner if fire icons go missing on a map. Milestone 2 (map-sdk #4) couldn't
  reproduce it in the Chromium e2e, a probe spec, or the browser tests; the suspect is
  `pointsPlugin` adding icon images in `image.onload` after its layers.
- **map-sdk milestone 2 review leftovers.** _Deferred 2026-11-04 (map-sdk #4 reviews)._ Small
  gaps the reviews found that don't affect today's maps:
  - A collocation site whose collocated monitor isn't in the store shows no name for it (its
    id is available).
  - On a map 640px or narrower, data credits arriving after the user collapsed the credits
    re-open them, because the control is replaced. Data credits are blank today.
  - After `dispose()` mid-load, a load-once store (HMS, collocation) stays `loading`, as the
    monitors store does.
  - No e2e covers fire's zoom-10 switch or the Live map's click easing (client tests cover the
    layer zoom ranges).
  - Readings are cut to whole numbers on every map. A ppm-scale entry type such as CO would read
    "4" in Moderate's color.

  **Revisit when** the Map widget or monitor-map 5.0 hits one of these, before map-sdk 1.0, or
  if the dashboard shows a ppm-scale entry type.

- **map-sdk List button options leftovers.** _Deferred 2026-11-05 (map-sdk #5 review)._ Edge
  cases of the new `featureList` position and reveal that monitor-map's top-right setup and
  ordinary map sizes don't hit:
  - On a map under about 175px tall with the engine's controls, a top-right List button can sit
    past the map's bottom edge (the list shrinks, the button doesn't).
  - On a wide map, full credits plus several data credits can wrap along the whole bottom edge,
    under a bottom-left button or a left-hand panel's bottom (only the button's own corner and
    the far corner on its side are measured).
  - On a short map, a bottom-corner panel can grow under the selection bar.
  - Tab order stays engine controls → credits → List button; getting the button before the
    credits means mounting it inside the engine's control container, which is rebuilt when
    `active` toggles.
  - The panel's offsets are the custom properties `--mapsdk-list-near`/`-far`; a host setting
    those names would move it.

  **Revisit when** the Map widget allows very short maps or bottom-corner lists, data credits
  become non-blank, or before map-sdk 1.0.

- **map-sdk: plugin effects added from inside a host `$effect` can stop.** _Deferred 2026-11-05
  (the user; map-sdk #7)._ **✅ Fixed 2026-11-07 ([map-sdk
  #13](https://github.com/SJVAir/map-sdk/pull/13), merged b1ca49b):** plugin setup runs in a
  microtask, and `ready` waits for it; proven with `c-reset3.mjs` (Ozone 0 monitor layers on
  beta.2, 18 = PM2.5 with the fix). On npm in `0.1.0-beta.3` (`next`, 2026-11-08).
  monitor-map's workaround (#126) was reverted in monitor-map #128 (on beta.3, merged 2026-11-07). monitor-map found that a plugin's `ctx.effect` can stop re-running for
  good when the host adds the plugin from inside its own `$effect`. The cause: map-sdk's
  `plugin-host` creates the effect's `$effect.root` under whatever effect is active, and Svelte
  detaches that root when the host's effect re-runs. It reproduces in monitor-map (Svelte 5.57.0
  and 5.57.3) but not in map-sdk's client tests, across several models of that pattern, so no
  fix can be proven yet. monitor-map no longer triggers it (its add/remove runs outside the
  effect, monitor-map #126). **In progress (the user, 2026-11-07):** monitor-map keeps its
  workaround (#126) for now, but the map-sdk fix comes next. **Cause found 2026-11-07** (map-sdk
  session, reproduced with `c-reset3.mjs`, Ozone 0 layers vs 15 without the clusters toggle):
  a Svelte bug. When an effect re-runs, Svelte cuts loose the `$effect.root`s created inside it
  but keeps their sibling links, so walking one root also walks the later ones and leaves them
  never scheduled again. It needs 2+ roots under one effect, which the monitors plugin's
  `ctx.effect`s provide. **Fix approved (the user, 2026-11-07):** map-sdk sets plugins up in a
  microtask, outside the caller's code (spec and plan
  `docs/superpowers/{specs,plans}/2026-11-07-plugin-setup-outside-effects*` in map-sdk). A
  host-owned effect was tried and fails the same way.
- **map-sdk: report the Svelte root-detach bug upstream.** _Deferred 2026-11-07 (the user)._ A
  Svelte playground repro of the bug above: two `$effect.root`s created in one `$effect`, that
  effect re-runs, one update dirties both, then an update to the second alone never runs it. The
  20-line client-test version exists (untracked, in
  `map-sdk/.superpowers/c2-repro/svelte-repro/`, gitignored, with a `README.md`), plus
  the versions (5.57.0, 5.57.3) and the lines involved
  (`destroy_effect_children` keeps `next`; `Batch#traverse` climbs past the root). Why deferred:
  filing on Svelte's GitHub is public and needs the user's yes. Revisit: when the user says to
  file it, or when a Svelte release fixes it. map-sdk's microtask setup stays either way.

## Widgets

- **Pesticide widgets and `pesticides/meta/`.** _Deferred 2026-11-03 (step 3 second batch,
  agreed with the user)._ No step 4 widget shows pesticide data, and widgets need more than
  metadata: the numbers the Pesticides Explorer shows (year-over-year change, month × year
  grid, top lists, movers, method breakdown, average-county comparison) are computed only
  for its HTML pages, and the one API place summary returns raw rows (Fresno County 2023:
  about 1.8 MB, 2.5 s, uncached). Its labels, badges, colors, the "flagged" rule, and health
  notes are scattered across the server's models, templates, Sass, and JavaScript. The later
  sjvair.com spec covers `pesticides/meta/`, aggregate endpoints reusing the explorer's
  cached stats, and the explorer reading the same metadata. Also found: the region summary
  probably counts a multi-ingredient record's acres once per ingredient (not yet proven
  with data). Research and widget ideas: `docs/reference/pesticides-explorer-research.md`.
  **Revisit when** step 3's spec 1 is done, or pesticide widgets are planned.
- **Widget state across the starter's first edit in fullscreen.** _Deferred 2026-10-29 (spec
  2b)._ An edit made while a starter widget is fullscreen hands off to the copy and keeps
  `?widget`, but the page moves from Home to the copy's dashboard page, so the grid and the
  fullscreen widget are mounted again once (a widget's own state, such as zoom, resets). Why:
  keeping the grid mounted across Home → the dashboard page needs a router restructure.
  **Revisit when** a step 4 widget has internal state (zoom, scrub position) that is visibly
  lost on the starter's first edit. _Looked at in step 4 spec 6, 2026-11-10: this may now apply.
  The real starter has a chart (with zoom) and a month calendar (with a selection), so an edit
  made in fullscreen resets them once. Not measured or reported; revisit if anyone notices._
- **Widget state when another tab minimizes or restores a fullscreen widget.** _Deferred
  2026-10-29 (spec 2b)._ The widget stays fullscreen, and focus moves back into it, but it moves
  between its grid frame and the frame a minimized fullscreen widget gets, so it's mounted again
  (a widget's own state, such as zoom, resets). Why: the widget moves between the grid frame and
  the minimized-fullscreen frame, so it remounts. **Revisit when** a step 4 widget has internal
  state that's visibly lost.
- **The page behind a fullscreen widget is not fully scroll-locked.** _Deferred 2026-10-29
  (spec 2b)._ The fullscreen frame uses `overscroll-contain`, so the page behind it can still
  scroll in some cases. Why: it's cosmetic, and a full scroll lock is fragile across browsers.
  **Revisit when** people report the background scrolling, especially on iOS Safari.
- **A no-op `setLayout` entry still counts in overlap detection.** _Deferred 2026-10-29 (spec
  2b)._ `touches()` in `src/lib/changes/overlap.ts` counts a `setLayout` entry whose fields
  are unchanged against a concurrent `removeWidget`, so it can raise a rare spurious conflict
  dialog. Why: it is harmless to correctness and rare. **Revisit when** it's reported, or when
  sync spec 2 touches overlap detection.
- **Fixed sleeps in the "no stray toast" fullscreen tests.** _Deferred 2026-10-29 (spec 2b
  final review)._ Three tests in `src/lib/components/dashboard/windowing.browser.test.ts` (a
  deep link that waits for the dashboard, Delete in fullscreen, a deep link on a read-only
  dashboard) wait a fixed 100 ms before checking that no "isn't on this dashboard" notice
  appeared. Why: such a wait can only miss a late toast, never fail falsely, and there's no
  event to wait on for something that shouldn't happen. **Revisit when** one of them is seen to
  pass while the notice shows up later by hand, or the suite gets a shared "settled" helper.
- **Focus when another tab deletes the focused widget.** _Deferred 2026-10-29 (spec 2b final
  fix wave)._ A focused grid widget that leaves the grid by undo or another tab's minimize now
  hands focus to its taskbar item (or its title bar after a page swap), but one deleted in
  another tab drops focus to the page, as before. Why: the hand-off has no widget left to
  target, and choosing a neighbour is a separate design question. **Revisit when** cross-tab
  editing gets its keyboard and screen-reader pass, or it's reported.
- **Zoom and pan on charts.** _Deferred 2026-11-04 (step 4 spec 1, the user)._ Changing the
  date range covers looking closer, and zoom needs its own keyboard design. **Revisit when**
  people ask to zoom, or with the Analysis view (Release 3).
- **The worst hour beyond 3 months, or with several places.** _Deferred 2026-11-04 (step 4
  spec 1)._ Daily views show each day's worst hourly average only up to 92 days and for a single
  place (chart, Data table, and CSV): longer or multi-place views would fetch up to 8,760 hourly
  points per place, and overlapping sticks are unreadable. **Revisit if** people ask for it, or
  if sjvair.com adds a daily worst-hourly-average to its summaries (the better fix; tell the
  coordinator).
- **"Stopped reporting" for monitors.** _Deferred 2026-11-04 (step 4 spec 1, builder check)._
  Retired regions get the "stopped reporting" note and "Switch to the replacement", but there's
  no server lookup telling a retired monitor from one that never existed. **Revisit when**
  sjvair.com adds that lookup.
- **Generated widget titles are never cleared.** _Deferred 2026-11-04 (step 4 spec 1 final
  review)._ The map of generated titles (`src/lib/widgets/titles.svelte.ts`) only gains
  entries: an undone delete can briefly show the old generated title until the widget's data is
  ready again, and the map grows by one entry per data widget opened in a session. Why: each
  entry is a short string, and a stale one is replaced as soon as data arrives. **Revisit if** a
  stale title is noticed, or long sessions open many widgets (clear an entry when its widget
  unmounts or is deleted).
- **A widget whose code fails to load has no Retry button.** _Deferred 2026-11-04 (step 4
  spec 1 final review)._ When a widget type's lazily loaded file can't load (offline, a deploy
  replaced it), the widget shows the failure without a Retry; remounting it (minimize and
  restore, switch dashboards) or reloading the page tries again. Why: rare, and a reload is the
  usual fix after a deploy. **Revisit if** it's reported, or with the offline work.
- **A free "last N days" entry for trailing ranges.** _Deferred 2026-10-13._ The Rolling
  method offers presets (24 hours to 12 months) and Custom covers anything else; the
  saved format already holds any amount and unit. **Revisit when** people ask for a
  length the presets lack.
- **Linking widgets**: _deferred 2026-09-28._ (The "Change place" bar on the starter and its
  copies is the narrow form, and "replace place A with place B across a dashboard"
  (`src/lib/places/replace.ts`, built in step 4 spec 6, 2026-11-10) is the mechanism it uses.
  A dashboard-wide place should build on both; design the two together.) First step: a **dashboard-wide place and date
  range** that widgets can choose to follow ("change the county once, everything
  updates"). Later: full **cross-filtering** (e.g. clicking a map region filters a chart and
  calendar; a calendar selection narrows a chart). Both touch the document model, Widget
  Creation, and undo. **Revisit when** pilot or private-preview users ask for it.
- **A "Change place" bar for dashboards not made from the starter.** _Deferred 2026-11-10
  (step 4 spec 6, Task 8)._ "Duplicate for another place" works on any dashboard, but a copy of
  one without a bar doesn't gain one (only the starter and its copies have the bar), so such a
  copy is changed widget by widget afterwards. A dashboard-wide place belongs with "Linking
  widgets" above. **Revisit with** "Linking widgets".
- **"Duplicate for another place…" in the dashboards list always shows.** _Deferred 2026-11-10
  (step 4 spec 6, Task 8)._ The list's rows don't have their documents loaded when the menu is
  built, so the item can't tell whether the dashboard has a place to replace; when it has none, a
  toast says so after the click (it is hidden on the open dashboard). **Revisit if** people find
  it confusing; the fix is a replaceable-place flag on `DashboardSummary`.
- **The Map joins the starter in step 6.** _Deferred 2026-11-10 (step 4 spec 6)._ It goes in as
  a full-width row under the "now" row, pushing the chart and calendar down; the hour × weekday
  heatmap's old slot stays empty until then (the year calendar does not take it). **Revisit
  when** step 6 adds the Map widget.
- **More Note formatting.** _Deferred 2026-11-10 (step 4 spec 6)._ Notes allow paragraphs, one
  heading level, bold, italic, bulleted and numbered lists and links. Images, tables, code,
  quotes and more heading levels show as plain text; images would also need CSP and privacy work
  (remote loads from a shared page). **Revisit when** people ask.
- **Nested lists in Notes flatten to text.** _Deferred 2026-11-10 (step 4 spec 6, Task 1
  review)._ The viewer draws one list level; a nested list shows its inner lines as plain text.
  **Revisit if** people ask for nested lists.
- **Lexical is pre-1.0.** _Deferred 2026-11-10 (step 4 spec 6)._ The Notes editor uses Lexical
  0.53.0, pinned exactly (with every `@lexical/*` package), so a minor release can't break
  it unseen. **Revisit at** Lexical 1.0 or on any upgrade (re-run the editor round-trip tests).
- **A content fit applied during an effect flush remounts widgets.** _Deferred 2026-11-10
  (step 4 spec 6, phone Note fit)._ A Note reports its text's height through `FitContent`, and
  the frame applies it to the grid in a microtask. Applied during an effect flush instead, the
  state write re-runs every frame's `{#await loadWidget(type)}` block, remounting the widgets
  (and looping, for a widget that measures on mount). The microtask and the `FitContent` doc
  comment guard against it, but the frame's load block is still fragile. **Revisit when**
  another widget type adopts `FitContent`, or the frame's load block changes (e.g. hold the
  loaded module in state instead of an `{#await}`).
- **"Shorter" on a phone Note grown to fit its text changes nothing you can see.** _Ruled
  acceptable 2026-11-10 (step 4 spec 6 follow-ups)._ Shift+Up, Size ▸ Shorter or the handle
  dragged up shrink the Note's own height (growing starts from the rows shown), but its text still
  needs the rows it shows, so the Note looks the same and the announcement repeats its height.
  The drop still writes the smaller height: an undo step, and a shorter Note on a desktop.
  Starting from the rows shown instead would raise the desktop height on "Shorter". **Revisit if**
  people find it confusing.
- **A Note fitted on a phone can leave a gap under its text.** _Deferred 2026-11-10 (step 4
  spec 6, phone Note fit)._ It grows in whole rows (4 rem plus a gap), so up to about 75 px can
  stay blank under the text. **Revisit if** it looks odd (e.g. finer rows on phones).
- **Crossing the phone breakpoint mid-arrangement can slide widgets on a dashboard with a
  Note.** _Deferred 2026-11-10 (step 4 spec 6, phone Note fit, CI fix)._ The grid watches the
  phone query while some Note has phone rows, which is most real dashboards, the starter
  included (its welcome Note). Then crossing the breakpoint in either direction re-renders the
  grid, which uses up the FLIP's breakpoint jump, so the drop or cancel that follows slides
  every widget instead of jumping. It happens only when the breakpoint is crossed while a
  widget is being arranged (e.g. rotating a phone or resizing the window mid-drag); dashboards
  without a fitted Note are unchanged. A sticky jump (kept until a play that moves something)
  was tried, but a spurious column change at startup then made the first real move jump.
  **Revisit if** someone sees it, or the FLIP's breakpoint handling changes (e.g. tie the jump
  to the arrangement that spans the breakpoint).
- **Step 4 spec 6 review leftovers.** _Deferred 2026-11-10 (step 4 spec 6, per-task and final
  reviews)._ Small things the reviews let stay; the first ones a person could meet:
  - **A task list shows its box and label on separate lines.** `- [ ] c` reads as the text
    "[ ]", a line break, then "c", with no checkbox. Only in a document the editor didn't save
    (the editor writes a typed `[ ]` as `\[ \]`, which is text). **Revisit if** people write
    checklists in Notes.
  - **Link reference definitions show as their source.** `[r]: https://…` stays visible text
    (its `[x][r]` link works when the address is allowed). Showing it is the safe choice.
    **Revisit if** people paste Markdown with reference links.
  - **`safeHref` accepts `https://user:pass@host`.** The link text is the author's anyway, so a
    hostile link can already say anything; the userinfo adds no new power. **Revisit if** links
    get a visible-host cue.
  - **The character counter counts Markdown,** so `**`, `## `, each link's whole address and
    the backslashes that keep typed `[`, `_`, `*`, `\` and the like as text count but don't
    show; "too long" says "Formatting and link addresses count too". **Revisit if** people find
    the count confusing (count visible text instead).
  - **A typed email address with `_` after the `@` doesn't link** (the editor escapes the `_`,
    which ends the address there); it shows as typed, as text. Hostnames can't hold `_`, so no
    real address is affected. **Revisit if** one turns up.
  - **Change place on the starter drops the pick if the hand-off fails.** The session already
    shows its save error and the edits stay queued. **Revisit on** a report.
  - **A thrown hand-off on Share gives two failure signals** (the save status and a toast). Only
    on a storage failure. **Revisit if** it happens outside storage failures.
  - **Double-clicking Share opens the dialog twice** (one copy is made). Harmless. **Revisit
    with** the next Share dialog change.
  - **"Duplicate for another place…" edge cases:** a pick that resolves to `default-place` closes
    silently (unreachable: the picker never offers it), and picking the same place makes a plain
    copy with no feedback (still a correct copy). **Revisit if** someone is confused by either.
  - **The welcome Note's bold "Change place" must match the bar's button** (`place_bar_change`)
    in every translation, and Paraglide's message files have no comment field to say so. **Revisit
    when** translation starts (put it in the translator hand-off, with `app_name_product`).
  - **Test gaps:** `notes-excluded.test.ts` has no positive control, and `NoteWidget`'s imports
    aren't in the usual order; the `setWidgetData` case in the `replaceChange` tests is muddled;
    axe on "Which place?" runs only in the default scheme and viewport (the spec asks light and
    dark only for the starter, a Note and its editor); a duplicate `toHaveText` in the starter
    e2e; the starter chart layer's days aren't asserted; no browser test for
    `DashboardPicker`'s `afterMenuClose` fix (the e2e that found it covers it). **Add with** the
    next change to each.
- **Additional widget types.** _Deferred 2026-09-23 (IDEA.md Q8)._ Brainstormed but not in
  the first-release widget set (see `ARCHITECTURE.md` → "Widget catalog"). **Revisit
  when** the first-release widgets ship, or a specific audience asks for one. The list:
  - **Rankings**: worst-N monitors/regions right now, with sparklines.
  - **Days-per-level stacked bars**: by month (widget form of starter analysis #1).
  - **Range bands chart**: mean + p25/p75/min/max bands from summaries.
  - **Pollution rose**: pollutant by wind direction/speed from CIMIS stations.
  - **Region comparison bars**: regions ranked by mean over the date range.
  - **Smoke & fire map preset**: map widget + HMS plugins.
  - **TEMPO satellite layer**: NO₂/O₃ raster overlays. Needs SDK wrapper + a raster map
    plugin.
  - **Pesticide notices**: upcoming/recent SprayDays applications near a place (list or
    timeline).
  - **Monitor health**: QA/QC scores and sensor agreement (research).
- **Chart axis numbers aren't tabular figures.** _Deferred 2026-11-04 (step 4 spec 1, Task 11)._
  uPlot draws its axes on a canvas, and canvas text can't turn on font features, so Inter's
  tabular figures (`tnum`) aren't used there; value-axis labels are right-aligned, so they still
  line up at the right. The readout, keys, and table are HTML and use `tabular-nums`. **Revisit
  if** the axes look uneven in testing (then draw the axis labels as HTML, or bundle a font face
  with tabular digits as the default).
- **A fifth place's partial dot isn't hollow.** _Deferred 2026-11-04 (step 4 spec 1, Task 11)._
  The fifth series' marker is a cross, which has no fill to leave out, so its partial (today so
  far) point looks like any other; the readout still says it's incomplete. **Revisit if** five-
  place charts are common, or when the series markers are reviewed.

- **Air monitors' temperature and humidity as Get data overlays.** _Deferred 2026-11-05 (step 4
  spec 3)._ They stay unsummarized on the server (raw readings only), so the weather summaries
  work (CIMIS stations only) doesn't bring them. **Revisit if** the server summarizes them, or a
  raw-only overlay is wanted.
- **Fires near a place or per day, TEMPO, and emissions series in Get data.** _Deferred
  2026-11-05 (step 4 spec 3)._ None has a per-place time series today: TEMPO isn't in the SDK,
  and emissions are yearly snapshots. **Revisit when** a widget needs one of them, or the Map
  widget (fires) is built.
- **An overlay on its own.** _Deferred 2026-11-05 (step 4 spec 3); updated 2026-11-07 (step 4
  spec 3b)._ Number layers (a temperature-only chart, pesticide use alone) are done in spec 3b.
  Level layers alone (smoke days, no-burn days) still can't make a widget or a CSV: the reason
  shows. Spec 5's calendars kept to pollutants, so this waits on "Other data in the calendars"
  (under Widgets). **Revisit with** that item.
- **Wind direction in Get data.** _Deferred 2026-11-07 (step 4 spec 3b)._ It's raw-only, and a
  compass bearing is circular (a line jumps between 359 and 0). **Revisit if** the server
  summarizes it (a prevailing direction), or someone asks for a wind rose.
- **"Every measurement" for weather.** _Deferred 2026-11-07 (step 4 spec 3b)._ Weather offers
  no raw level: "Show values" lists Hourly and coarser, and the raw CIMIS readings (with their
  dew point and soil temperature `*_f`/`*_c` fields) aren't offered. CIMIS readings are hourly,
  so Hourly shows the same values, and raw rows carry no `value`. A small narrowing of the spec
  ("read the °F field when Every measurement is chosen"). **Revisit if** someone asks for the
  raw CIMIS readings, or the server adds `value` to them.
- **Pesticide breakdowns** ("top chemicals, products or crops here", by method, biggest
  movers). _Deferred 2026-11-07 (step 4 spec 3b)._ Needs a ranked-list widget and a server
  breakdown endpoint. **Revisit when** a later step adds ranked-list widgets, or users ask.
- **The school "within about a mile" pesticide block, and buffer or radius.** _Deferred
  2026-11-07 (step 4 spec 3b)._ Server-side deferrals (the coordinator records them). The
  dashboard side (a school uses its ZIP, then city, then county) **revisits when** the server
  adds a location place.
- **A note on when pesticide data is released.** _Deferred 2026-11-07 (step 4 spec 3b)._ A
  neutral note in the dataset's catalog description (server text), offered and not taken.
  **Revisit if** people ask why recent months are empty.
- **Choosing a weather station per place or per layer.** _Deferred 2026-11-07 (step 4 spec
  3b)._ One station per Weather section, and the choice shows only for one place (rain from two
  stations, or a station for each of several places, can't be asked for). **Revisit if**
  researchers ask to compare stations.
- **One chart row per place (small multiples) for overlays.** _Deferred 2026-11-05 (step 4 spec
  3)._ When a Chart's places fall in different forecast zones, the Chart's "Overlay for" choice
  picks which place's overlay it draws (the Data table and CSV have every place's). **Revisit
  when** users ask to compare overlays across places, or with spec 5's chart work.
- **Get data's Detail limits are estimates.** _Deferred 2026-11-05 (step 4 spec 3, Task 9)._
  "More options" → Detail greys out levels using guessed limits: places × periods over 50 000
  blocked, and 720 raw readings a day per place. No level has a range cap of its own: the
  server's 31-day cap is per request, and the adapters ask a month (or 31 raw days) at a time
  (settled in the final review). **Revisit after** real use, or when the metadata gives reading
  intervals.
- **A possible bug in the custom date range picker with the year calendar.** _Noted
  2026-11-09 (the user, after spec 5)._ The user saw what looks like an error when choosing a
  custom range of 8/10/24 to 10/09/24 (read as Aug 10 – Oct 9, 2024) while the year calendar
  (the contribution calendar, `calendar-contribution`) was shown. Not investigated yet: the
  exact symptom and the cause are unknown. **Revisit when** the user picks it up (they said "we
  will revisit this later"): reproduce with that range on a year calendar in Get data first.
- **Get data review leftovers.** _Deferred 2026-11-05 (step 4 spec 3, final review)._ Small
  things the review let stay, each rare or harmless today:
  - **A forecasts 404 gives an empty series, not "unavailable"** (Task 5 ruling): `fetch` can't
    return unavailable per place, so "this place isn't covered" reads the same as "no forecasts
    yet". **Revisit if** users ask, or the server says which it is.
  - **One month's 404 drops every month** of that place's forecasts (it assumes a 404 means the
    region, not the dates). **Revisit if** the server ever 404s for a date range.
  - **A failed overlay can't be retried on its own:** Retry also refetches the main layer's
    levels (the shared `#levelsTry`). **Revisit if** overlay failures are reported.
  - **The overlay legend's highlight matches level keys across overlay lanes.** **Revisit
    when** two overlays share level keys.
  - **Overlay rows carry the main place's columns**, not the zone or region the value came from
    (by design: "a column per place"). **Revisit if** researchers want the source zone's id.
  - **The draft's debounce timer is module-level, shared across spaces.** **Revisit if** a
    draft is lost on a space switch.
  - **A `?type=` override keeps Chart options on a Data table draft** (harmless; Show as does
    the same by design). **Revisit when** a non-Chart type has options of its own.
  - **Dashboard size measures the whole view's width,** so a wide `defaultSize` may clip.
    **Revisit with** spec 5's wider types.
  - **Rare storage failures when adding:** a failed starter hand-off keeps the add queued (a
    retry adds two widgets), and `createBlank` followed by a session-open failure leaves an
    empty dashboard. **Revisit if** reported.
  - **Edit data edges:** a replayed size clamp overwrites a concurrent move (last wins); Back
    while dirty flickers the URL, and a second Back while the dialog is open isn't handled; a
    dataset gone entirely shows no "Choose another" (⋯ Edit data still works); the
    unknown-widget page links only to "Your dashboards". **Revisit if** reported, or with
    sv-router's next `blockNavigation` change.
  - **Two `regions/meta` fetches** (the resolver's and the directory's), and `regionsMeta()`
    adds a `.catch` per call (harmless). **Revisit if** request counts matter.
  - **The Add widget list is built twice** (`src/lib/actions/dashboard.ts` and
    `AddWidgetButton.svelte`). **Revisit when** a third caller appears.
  - **The Data table shows an AQI forecast's level, not its number** (the CSV has the number in
    `mean`). Showing "Moderate (72)" needs a wording choice and the value in `TableRow`.
    **Revisit when** the new strings go to the user with the PR, or someone asks for the number.
  - **Test gaps and one duplication** (the user kept these 2026-11-06 out of the review's
    eight nits): no test pins the Add widget menu's order (data types first) or `typeBlock`
    with no layers; the Chart's "borrowed place" test doesn't prove the overlay asked for the
    main layer's place, and nothing tests an overlay whose levels fail to load; Edit data
    repeats `DashboardPage.svelte`'s fetch-a-server-only-dashboard steps and its not-found
    markup (`src/routes/GetData.svelte`), so the two can drift. **Revisit when** those files
    are next touched (the duplication first: a shared helper and not-found component).
- **Get data layers review leftovers.** _Deferred 2026-11-07 (step 4 spec 3b, final review)._
  Small things the review let stay, each rare or harmless today:
  - **With the catalog down, `mainLayer` falls back to the first layer with an entry type,**
    which can be a level layer, so the place picker could write places onto an overlay.
    **Revisit with** the next place-picker change.
  - **The weather station fallback from ZIP to city is untested** (when the first region key
    has no stations). **Revisit at** the next weather adapter change.
  - **Smoke chunks are fetched with `Promise.all`** (not `runLimited`), and a 404 on one chunk
    drops that place's whole smoke series. **Revisit if** multi-year smoke ranges become common
    or users report missing smoke.
  - **Pesticide filter labels are fetched in the same `Promise.all` as the data,** so a
    transient meta failure fails the fetch (Retry), and an id removed mid-session can loop on
    Retry instead of showing "filter gone". **Revisit if** seen.
  - **The last covered pesticide month is marked complete** even when coverage ends mid-month.
    **Revisit when** coverage stops being month-aligned.
  - **Main-chart month bars are centred on the month's start,** while strip bars span
    `[start, next)`, and a strip's value axis counts points outside the visible range.
    **Revisit in** the next chart design pass.
  - **The pesticide empty text is keyed on the dataset id** in `ChartWidget` and `DataTable`.
    **Revisit when** a second dataset needs its own empty text (then the adapter supplies it).
  - **The category checkbox at `CATEGORIES_MAX` is disabled without a visible reason**
    (unreachable today: 6 categories are in use). **Revisit if** the server has more than 10
    in-use categories.
  - **Pesticide layer rows are keyed by index:** after Remove, a neighbour's open "Filters"
    and typed query shift rows. **Revisit if** layers get stable ids, or users report it.
  - **The filter search shows an empty input when a saved id's name lookup fails** (the layer
    itself shows "filter gone"). **Revisit with** the next picker change.
  - **The Data table's note for an unavailable number overlay doesn't name the layer** (it reads
    "A filter this widget uses is no longer available."), so with two number overlays it's
    unclear which one it means. The Chart shows it in that layer's own strip. **Revisit with**
    the next Data table change, or if users report it.
  - **Missing `layers.ts` unit tests** for removing a middle layer, and for removing the
    pollutant when the next number layer is a pesticide layer. **Add with** the next
    `layers.ts` change.
  - **No smoke e2e coverage:** the `hms` fixtures are there, but the e2e catalog has no
    `hms-smoke`. **Revisit at** the next smoke change.
- **Other data in the calendars** (weather, smoke days, pesticide use, forecasts). _Deferred
  2026-11-09 (step 4 spec 5, the user: "keep it to air quality and defer the rest")._ Each kind
  needs its own daily figure named in metadata (as `daily_statistic` does for pollutants), and
  coloring for scales without levels (temperature); a "smoke day" at a point or school needs an
  area rule; pesticide use is monthly; forecasts must not be confused with measured days. The
  calendars read their datasets and day figure from the type and metadata, so adding one is
  registration. Smoke days (HMS, one category per day with levels) are the likely first.
  **Revisit when** someone asks for a non-pollutant calendar.
- **The Chart's worst hour could use the server's `max_1h`.** _Deferred 2026-11-09 (step 4 spec
  5)._ The Chart computes each day's worst hourly average in the browser from hourly summaries
  (`src/lib/data/worst-hour.ts`, up to 92 days, no completeness rule). The server's daily
  `max_1h` (SDK 5.0.0-beta.8) could replace it and save the hourly fetch, but it's only published
  for 1-hour scales and is null on incomplete days, so the Chart's meaning would change. **Revisit
  when** beta.8 is pinned and the Chart's daily view is next touched.
- **The Data table's column for the day's figure.** _Deferred 2026-11-09 (step 4 spec 5, builder
  check)._ The calendars' CSV gets the figure that colors a day and whether it was rated; the
  Data table still shows the daily mean, which for ozone, NO2, SO2 and CO isn't the colored
  number. **Revisit when** the Data table is next touched, or a screen-reader user needs the
  figure in the table.
- **Several places in one calendar** (a row of calendars per place). _Deferred 2026-11-09 (step
  4 spec 5)._ One place keeps cells readable, and `maxPlaces: 1` greys the calendars out for a
  multi-place draft. **Revisit if** people ask to compare places day by day.
- **Dragging across days by touch.** _Deferred 2026-11-09 (step 4 spec 5, Task 8; Ruling 12)._
  A swipe over a calendar scrolls the widget (the month calendar stacks months on phones and
  needs it), so a touch drag doesn't extend the selection. Touch already has a full alternative:
  tap a day, then tap another to select the days between (the range-picker pattern every pointer
  uses); a mouse can also drag or Shift-click, and the keyboard uses Shift+arrows. A
  long-press-then-drag (like the title bar's lift) would add touch dragging without taking the
  scroll. **Revisit if** phone or tablet users find tap-tap slow for long ranges, or ask to drag.
- **Calendars review leftovers.** _Deferred 2026-11-09 (step 4 spec 5, per-task reviews and the
  final review)._ Small things the reviews let stay; the first ones a person could meet:
  - **The narrowest month calendar scrolls.** At 3 columns and the default height the legend wraps
    to four lines, so the last week sits below the fold (the default 4 columns fits). **Revisit
    if** people use the month calendar that narrow, or with the next legend change.
  - **A saved selection the range has moved past stays saved.** "This month" on the 1st no longer
    shows last month's days (and no longer offers "Open these days in a chart"), but the stored
    `timeSubRange` stays until the next selection replaces it, and Escape can't clear what isn't
    shown. Harmless, but a shared copy carries it. **Revisit if** it confuses anyone, or with the
    next selection change (clear it on the next pick, or when the range moves).
  - **The tooltip holds while the pointer is on it** (WCAG 1.4.13, final review M8). It lets clicks
    through, but moving the pointer across it (say up a column) keeps the first day's tip until
    the pointer leaves the tip's box. **Revisit if** that feels sticky in the year calendar.
  - **Leaving the grid with the pointer clears a tooltip the focused day was showing.** Moving
    focus brings it back. **Revisit with** the next tooltip change.
  - **The year calendar scrolls back to the latest week at midnight** (its range moves). **Revisit
    if** someone scrolled back loses their place.
  - **The live region can announce a selection again when its values refresh,** at most hourly
    (the summary poll) and only while the selection includes today. **Revisit if** screen-reader
    users find it noisy.
  - **Small month cells drop the words for days that aren't rated** (Not rated, No data so far):
    the number shows, and the name and tooltip carry the state. **Revisit if** people miss it.
  - **Selected days are named ", selected" with no `aria-selected`** (chosen in Task 8 so the state
    reads with the rest of the name; not yet tried with screen readers). **Revisit at** the manual
    screen-reader pass.
  - **The year calendar's patterns are drawn in full ink** (the user's visual review is pending).
    **Revisit with** that review.
  - **Switching a calendar whose range is exactly "Last 30 days"** (the app default) to the other
    calendar gives it the new type's default range, as an untouched range would (Ruling 9's
    `wasDefault`). **Revisit if** someone loses a chosen 30-day range that way.
  - **Get data keeps one note slot:** a range note replaces an earlier conversion note.
    **Revisit if** both are needed at once.
  - **`moveFocus` assumes the selectable days run first ≤ last.** Today a range with no selectable
    day (all still to come) sets `selectable: null`, so the grid never calls it then. **Revisit
    if** `selectable` is ever built another way, or with the next keyboard-navigation change (add
    the guard and a test).
  - **Code tidying:** the hardcoded ring widths in the selection shadow (token discipline, low
    risk), the year calendar's `pt-5.5` label offset, the `$derived.by` comment in
    `calendar-data.svelte.ts` stating a cause as fact, the `hidden: 0` that wants a comment, the
    `export *` at the bottom of `format/index.ts`, `final` copying `is_final` without a boolean
    check (the SDK types it), `dailyFigure` in the query key at non-day resolutions (a harmless
    extra key), and open-day loaders built for non-figure requests (cheap closures). **Revisit
    with** the next change to each file.
  - **Test gaps:** `daysInclusive` across spring-forward and with start after end, an all-null
    column, six-row months; `ratedForCount`'s positive cases, pending and today days in a summary
    fixture, the `unrated` doc comment, duplicate same-date points (the later wins); a selection
    after a range change; Home/End/Page Up/Page Down, drag and Shift-click in the year calendar's
    weeks layout; the cross-widget patterns on-again check and the misnamed "a fresh space starts
    with patterns on" test; races and midnight rollover in the calendar data; real (not synthetic)
    drags, including a release outside the grid; Escape's `stopPropagation`; the Get data keyboard
    Show-as test (loose), its weather case using census, and the span reason; the adapter's bulk
    all-places path, figure at non-day resolutions, with `worstHour`, and the client carrying
    `dailyFigure`; an open-days call failing the whole query (deliberate: no partial data), a
    monitor with no published processor, the bulk memo across units, and a yesterday-only open
    row; the e2e's hard-coded ZIP 93721 and its empty bulk-monitor open route. **Add with** the next
    change to each.

- **Hiding activities on the "Can we go outside?" card.** _Deferred 2026-11-08 (step 4 spec 4,
  brainstorm)._ The card shows all four school activities compactly (layout B); a way to hide
  the ones a school does not have was offered and left out. **Revisit if** schools ask to hide
  activities.
- **Now widgets review leftovers.** _Deferred 2026-11-08 (step 4 spec 4, per-task reviews)._
  Small things the reviews let stay; the first ones a person could meet:
  - **A failed `setNotifyEnabled` write is not handled:** the Notifications switch should revert
    and say so. **Revisit if** storage write failures are reported.
  - **The now client reports a throwing listener with `console.error`,** not
    `platform().errors` as the project rule says; its subscribe-time and `changed()` listener
    calls are unguarded. **Revisit with** the next now client change.
  - **A failed watcher chunk load retries only on the next dashboard or watched-set change.**
    **Revisit if** seen on flaky connections.
  - **A fell-back default alert level cannot be confirmed in the form** (a stored bad key
    persists until the person picks a level). **Revisit with** the next thresholds form change.
  - **The Forecast strip's Where list is filtered to PM2.5 monitors** (coverage unconfirmed), and
    a names-only Data widget runs a 30-day query. **Revisit** when coverage is checked, or if
    seen.
  - **Air Alert dates are evaluated at fetch time,** so the banner can be stale across midnight
    until the next hourly poll; a heat score with an unknown level reads "No heat score today".
    **Revisit if** seen.
  - **The Chart threshold label on the canvas is not accessible text** (the key item under the
    chart is). **Revisit with** the chart accessibility pass.
  - **Unit-test gaps:** re-arm through the watcher and after firing, `decide` with a threshold
    missing from the scale, the alert banner's timestamp bounds, a retired-school tile, and
    `convertToNow` edit-during-load. **Add with** the next change to each.
  - **A live stack check of a PurpleAir tile at `ok` ("60-minute average") did not run;**
    browser tests and `e2e/current.spec.ts` cover it. PurpleAir's alert series is PM2.5
    `PM25_UnivariateLinearRegression`, and the local stack has no trained calibrations (no rows
    with that processor, and no calibration rows). So every local PurpleAir alert row reads
    `no_data`, even though raw and `PM25_EPA_Oct2021` data are current. **Revisit** when the
    local stack has a trained linear calibration, at the first check against production after
    the develop deploy, or before step 4 merges into `main`.
  - **While a tile has fallen back from the alert value to hourly averages** (the alert request
    failed or timed out), a crossing can be told up to about an hour late: the watcher skips
    hourly readings older than the last alert evaluation. The tile's mark stays right meanwhile,
    and nothing is told twice. **Revisit if** alert-request failures turn out to be common.

## Alerts

- **Thresholds on the Forecast strip** (tomorrow's category or a no-burn day). _(step 4 spec 4, 2026-11-08)_ Left out
  of spec 4 so the strip stays plain display; Release 2's server forecast rules cover it with
  the dashboard closed. **Revisit with** Release 2's rule UI, or if people ask for an
  in-dashboard heads-up.
- **Toasts or notifications from Chart threshold lines.** _(step 4 spec 4, 2026-11-08)_ Charts only display the line,
  to avoid noise from widgets people are not watching. **Revisit if** people ask to be told
  from a Chart.
- **A client-side daily "still bad" reminder.** _(step 4 spec 4, 2026-11-08)_ The server's 10 AM reminder is for
  texts; the dashboard tells you once per rise. **Revisit if** people keep a dashboard open all
  day and ask for one.
- **A sub-hourly value for regions.** _(step 4 spec 4, 2026-11-08)_ Regions show hourly averages in Current
  conditions, and Release 2's region alerts use the same. **Revisit if** people find region
  tiles too slow to react.
- **Additional automated-alert sources and targets.** _Deferred 2026-09-24 (alerting
  design)._ First server iteration covers pollutants (monitor/region targets),
  forecasts, and nearby pesticide notices. Deferred: **HMS smoke** over an area
  (density ≥ X), **heat** (CalHeatScore ≥ level), **fire detections** within N miles,
  and **drawn-area / near-a-point targets** (resolved to monitor sets per Q2).
  **Updated 2026-11-05:** the server now has the per-day smoke a smoke alert would read:
  `hms/smoke/place/` (sjvair.com #312) gives the heaviest density and the share covered for
  any place. The alert source itself is still deferred. **Revisit when** the first alert-rule
  iteration ships, or ahead of wildfire/heat season if demand appears.

- **Should hidden monitors be subscribable and send alert texts?** _Deferred 2026-11-08
  (sjvair.com alert current value spec)._ `is_hidden` only hides a monitor on the map. The
  subscribe endpoint accepts hidden monitors, and `periodic_alerts` evaluates and texts them
  like any other. Monitors are usually hidden for a reason, so texting from one may be wrong.
  Changing it alters SMS behaviour and raises its own questions: existing subscribers, whether
  they're told, and refusing new subscriptions. The new `monitors/<id>/alerts/current/`
  endpoint serves hidden monitors so the tile matches the texts. If hidden monitors stop being
  evaluated, it follows on its own. **Revisit before** public go-live, or when a monitor is
  first hidden on purpose while it has subscribers.

- **An opt-in "back to normal" message by email.** _Deferred 2026-10-13._ All channels follow
  the server's escalation-only rules, with no all-clear; the in-app inbox shows when an
  alert eased or ended. An email-only all-clear has no per-message cost and could be
  offered as an opt-in. **Revisit when** users ask to be told when conditions improve.
- **Opt-in quiet hours for alert texts** (e.g. none between 10 PM and 7 AM). _Deferred
  2026-10-13._ The server's escalation logic makes this safe: a held text leaves the user
  "not yet told", so the alert goes out at the next check after quiet hours. It could
  only be opt-in, since smoke often worsens overnight. **Revisit when** people complain
  about night texts, or when the rule UI gains a settings page.
- **Numeric alert thresholds** (e.g. "PM2.5 > 25 µg/m³"). _Deferred 2026-09-24 (alerting
  design)._ First iteration uses level categories only: simpler for community/schools
  and consistent with the level colors shown everywhere. **Revisit when** researchers or
  advocates ask for raw-value alerts; offer as an "advanced" option.

- **Web push for alerts.** _Sequenced as next iteration 2026-09-24._ Reaches desktop
  and Android with the dashboard closed, no per-message cost; iOS only for home-screen-
  installed sites. Brings in the dashboard's **first service worker** (served by Django under `/workspace/`,
  since static files are on another origin; none in Release 1;
  `ARCHITECTURE.md` → "Platform strategy"),
  VAPID keys, and a server push-subscription table. **Revisit when** the first alerting
  iteration (SMS and email, plus the inbox) ships. **Constraint:** the bad-build block list
  relies on a reload always fetching the current build, so this worker must not serve a
  stale app shell. That service worker also enables **in-browser
  self-monitoring notifications on Android/iOS** (desktop-only in Release 1). **Optional
  add-on:** app-shell caching, decided when the worker is built.
- **Mobile app on the new alert-rule endpoints.** _Deferred 2026-09-28._ Release 2 keeps
  mobile working through the legacy subscription endpoints, but dashboard-only rules
  (regions, forecasts, pesticide notices) don't appear in the app. **Revisit when**
  Release 2 ships, or when mobile users ask to see or manage those rules. Needs an
  approved mobile plan.
- **Remove the legacy subscription endpoints.** _Deferred 2026-09-28._ They remain a
  compatibility layer over alert rules, with usage logged by app version. **Revisit when**
  mobile **and** any sjvair.com pages use the new rule endpoints, **and** legacy usage
  has been near zero for a set period (e.g. 4–8 weeks), or a mobile minimum-version
  prompt guarantees nobody needs them. Removing them doesn't affect anyone's alerts.
- **Mobile app push for alerts (`mobile`).** _Deferred 2026-09-24._ No FCM/APNs setup
  exists in `mobile` or the server. **Revisit when** `mobile` plans push
  notifications; needs its own approved plan.

## Mobile app (`../mobile`)

- **Retire the old air-quality `levels` format in `monitors/meta/`.** _Deferred 2026-11-03
  (sjvair.com step 3 spec 1, the user's call)._ Spec 1 keeps each entry type's existing
  `levels` dict (uppercase keys, `name`, `range` with "next minus 0.1"), adding only `tier`,
  and serves the shared-shape `scale` alongside it for the dashboard. Why: installed mobile
  apps read the old dict through sdk-js for alert levels and subscriptions
  (`MonitorSubscription.svelte`, `Subscriptions.svelte`, `alert-level.ts`) and can't be
  forced to update; monitor-map reads it too. Both formats come from the same `LevelSet`,
  with a test that they agree. **Revisit when** a mobile release reads `scale` and the
  monitor-map rebuild on map-sdk ships: mark `levels` deprecated, then remove it once older
  app versions have aged out. **Resolved by sjvair.com spec 5,
  [#306](https://github.com/SJVAir/sjvair.com/pull/306) (open into `develop`, 2026-11-04):** the user
  decided to remove `levels` outright rather than deprecate it, since mobile, map-sdk and
  monitor-map all update to `scale` before `develop` is released the same day. `LevelSet.as_dict`
  is gone too; the SDK side is TODO "Release 1, step 3" → "Removing `levels` from the SDK".
- **Mobile migration to `map-sdk` and the rebuilt monitor-map (5.0).** _Deferred
  2026-09-28; updated 2026-10-13; **now on the go-live path** (the user, 2026-11-04: the updated mobile app and sjvair.com `develop` are released the same day, with map-sdk on the latest sdk-js, monitor-map rebuilt on map-sdk, and mobile on that monitor-map, all done before `develop` is released; mobile auto-updates, most likely overnight, the day a release is published)._ It no longer waits: it
  must be done before sjvair.com `develop` is deployed (see the deploy entry). The mobile app
  is on monitor-map `^4.2.0` and keeps working on 4.x. It depends on
  `@sjvair/monitor-map/core` (`monitorsManager` as an app-wide store,
  `provideMonitorMapRouter`) and `/routes` (`monitorMapRoutes`), which the rebuild must
  keep. **Revisit when** the monitor-map 5.0 rebuild is far enough along to migrate onto. Bundle the
  other mobile follow-ups into the same effort where timing allows: the new alert-rule
  endpoints, and the hardcoded PM2.5 scale unless it has already shipped with the
  breakpoint fix. Needs a mobile plan and an app release (explicit approval; publishing
  a GitHub Release there ships to TestFlight and the Play beta track).
- **Mobile: move `@sjvair/sdk` to `^4.7.0` when taking monitor-map 4.3.0.** _Noted
  2026-10-21 (monitor-map SDK 4.7 design)._ Mobile depends on the SDK directly (`^4.6.0`)
  and calls `setOrigin` on its copy. monitor-map 4.3.0 needs `^4.7.0`. Without the bump,
  npm can nest a second SDK under monitor-map whose requests ignore mobile's origin.
  **Revisit when** mobile next updates its monitor-map dependency. Needs a mobile plan and
  an app release (explicit approval). **Update 2026-11-05:** monitor-map 5.0 makes
  `@sjvair/sdk` a peer dependency (`^5.0.0-beta.3`), so mobile's own copy is the only one;
  the mobile migration onto 5.0 takes the SDK 5.0 beta instead of `^4.7.0`.
- **Mobile app's hardcoded PM2.5 scale.** _Noted 2026-09-28; widened 2026-10-13._ Three
  files hardcode the pre-2024 scale: `src/components/PMGauge.svelte`
  (12.1/35.5/55.5/150.5/250.5), `src/lib/colors.ts` (`pmValueColors`,
  `ozoneValueColors`), and `src/components/AirQualityGuidelines.svelte`. Only its Alerts
  and Subscriptions screens read levels from metadata. The sjvair.com breakpoint fix
  doesn't reach these. **Revisit when** the server fix (sjvair.com #288, in `develop`
  since 2026-10-20) is on its way to production (ideally they read metadata levels), or
  with the mobile migration, whichever comes first. Needs a mobile plan and an app release
  (explicit approval).

- **Mobile dev proxy still points at API v1.** _Noted 2026-10-19 (Alerts fix)._
  `vite.config.ts` proxies only `/api/1.0` to `localhost:8000`, but the app calls
  `/api/2.0` through the SDK at the full origin from `VITE_DEV_URL`, so the proxy is never
  used. Harmless leftover. **Revisit with** the next mobile build-tooling change, or the
  mobile migration. Needs a mobile plan.
- **Monitors without a county show a bare "County".** _Noted 2026-10-20 (Alerts QA)._ The
  Alerts and Subscriptions screens render `{monitor.county} County`, so a monitor with no
  county reads "County". Pre-existing, not caused by the Alerts fix. **Revisit with** the
  next change to those screens. Needs a mobile plan and an app release.

## Accounts

- **Gaps in "Add the dashboards made on this browser to your account?"** _Deferred 2026-11-02
  (sync spec 2, Task 10; other tabs' stale lists were fixed in the final review)._ (1) Journal
  records the browser refused to move (quota) stay in the anonymous space; the move reports
  how many (`move-to-account`) but doesn't retry them. (2) Anonymous dashboards whose ids the
  account space already holds aren't offered (the move would replace them), and a space with
  only Recently deleted dashboards isn't asked (there's nothing to count in the question).
  (3) The "Couldn't add the dashboards" toast also shows when the move worked but a step after
  the answer was stored failed (the upload, say); two tabs answering yes at once both move
  (by id, so harmlessly); and a failed move of the "You already have a copy" fingerprints
  leaves them in the anonymous space. **Revisit when** the error report shows stranded
  journal records or failed fingerprint moves, the toast is reported as wrong, or the
  account-space ids start to collide.
- **Sign-out and space-switch rough edges.** _Deferred 2026-11-02 (sync spec 2, Tasks 9 and
  11)._ Identity messages from other tabs can be missed during a remount (the next re-check
  heals it); when "Sign out" itself fails the dialog closes and only a toast explains (not
  covered by a test); an Escape blocked while the dialog is busy drops its request to return
  focus to Sign in; and the sign-out lock is exclusive, so a second tab signing out at the
  same moment waits its turn. **Revisit if** people report a tab stuck in the wrong account,
  a confusing failed sign-out, or lost focus after the dialog.
- **A sign-out dialog that fails to load says only "reload".** _Deferred 2026-11-04 (step 4
  spec 1 final review)._ The sign-out dialog now loads on demand; if its file can't load, the
  sign-out is cancelled and only the generic reload bar shows, with nothing saying the sign-out
  didn't happen. Why: rare (offline or a deploy replacing the file), and the person is still
  signed in, so nothing is lost. **Revisit if** it's reported, or with the offline work (add a
  message that sign-out didn't happen).
- **Returning to the dashboard after sign-up and verification.** _Deferred 2026-10-27
  (Foundations spec 5b)._ A new account still goes sign-up, the "enter your code" page, then
  the profile page. During the preview `/workspace/` is behind `beta_tools`, so only people who
  already have accounts reach it and they use the login page; sign-up from the dashboard is
  first reachable at go-live. The email-only accounts track rewrites sign-up and verification,
  so the return trip is designed once there. Passing `next` to sign-up would skip phone
  verification (`SignupView` sends the person to `next` instead of the code page); doing it
  right means carrying `next` through sign-up and the code page. The dashboard has no "Create
  account" button for the same reason. **Revisit with** the email-only accounts track, and
  **before go-live at the latest**.
- **Account UI in token-mode builds.** _Deferred 2026-10-27 (Foundations spec 5b)._ In a Tauri
  build, or a standalone one on another origin (`VITE_PROD_URL`), the cookie re-check can only
  answer 401 and the relative `/account/login/` link goes nowhere. No such build ships in
  Release 1, and the adapter's `authMode` is always `"cookie"`. **Revisit when** the first
  token-mode build is planned. It needs in-app sign-in (Release 2) and a "no account UI" or
  token-sign-in state in the shell.
- **Shared-computer guest mode.** _Deferred 2026-09-24._ A mode (e.g. enabled by a
  teacher-distributed `?guest` link) where nothing persists after the tab closes.
  Current approach: per-account local spaces (sign-out removes them), the browser profile
  as the boundary for signed-out work, "Clear my data", and session-only sign-in. **Revisit when** a school reports shared-device problems (i.e. students share
  one browser profile).
- **Accounts for children under 13** (with verifiable parental or school consent).
  _Deferred 2026-10-13._ It needs consent workflows, record-keeping, and stricter data
  rules. Under-13s use the dashboard anonymously. **Revisit when** a school partner needs
  student accounts, together with class accounts below.
- **Teacher / class / organization accounts.** _Deferred 2026-09-24._ Rosters, class
  dashboards, shared org alerts. Teachers share via links for now. **Revisit when**
  schools ask for managed class use, likely after server-backed live share links exist.

- **Multiple editors on a shared document** (group/co-owner permissions). _Deferred
  2026-09-25; model prepared 2026-09-28: editors would be a separate access table (document,
  user, role); only the owner deletes._ The most plausible real need is a community group maintaining one
  dashboard, taking turns. It works with the existing versioned sync plus automatic
  replay, and needs no CRDT. **Revisit when** community groups or schools ask for shared
  ownership.
- **Real-time co-editing (Automerge or similar CRDT).** _Deferred 2026-09-25._ Automerge's
  core library works over our existing Django HTTP API (it merges in the browser and
  Django stores bytes); its optional `automerge-repo` sync server isn't required. No
  demand is expected: research and school workflows are solo work with handoffs.
  **Revisit when** simultaneous editing is actually requested, or overlap prompts turn
  out to be common. **Note:** adopting it means a one-time conversion of all stored JSON
  documents to Automerge's format, plus reworking `schemaVersion` upgrades as CRDT
  changes.

## Internationalization

- **Translations and language switching.** _Deferred 2026-09-24; re-checked 2026-10-13._ The
  server now has empty locale catalogs (es, tl, hmn; 395 untranslated entries each) and
  sends SMS in the user's language, but no actual translations exist and there's no
  timeline; the app ships English-only but translation-ready (see
  `ARCHITECTURE.md` → "Internationalization"). Deferred together: Spanish, Filipino (tl),
  and Hmong (hmn) message files; a language picker (saving to `User.language` when
  signed in); translated content for sjvair.com's catalogs (metadata labels/guidance, alert
  text; the mechanism already sends SMS in `User.language`); per-language metadata
  caching; a formatting fallback
  for `hmn` (thin CLDR/`Intl` data); i18n in monitor-map and mobile (`map-sdk` is translation-ready via its `messages`
  provider but ships English defaults). Health guidance
  and alert text need human translation or review, not machine-only. **Revisit when**
  translators or funding for translation are available.

## UI & UX

- **Command palette (Ctrl+K) and per-action keyboard shortcuts** (beyond undo/redo and
  menu-opening keys, which ship in Release 1). _Deferred 2026-09-23 (IDEA.md
  Q5)._ The shared action registry is designed to feed these. **Revisit when** the action
  registry and the widget "⋯" menus have shipped.
- **Asking before closing the tab or reloading with unsaved Edit data changes** (a browser
  `beforeunload` prompt). _Deferred 2026-11-05 (step 4 spec 3, Edit data; ruled out of scope
  for the task)._ Cancel, Back, forward and in-app links ask "Discard changes?"; closing the
  tab or reloading drops the unsaved edit without asking (the dashboard itself is untouched,
  since nothing is applied before Save changes). sv-router's `blockNavigation` already takes a
  `beforeUnload` callback. **Revisit when** people report losing Edit data work to a closed tab
  or reload, or when Edit data grows long-running edits.
- **Rare read-only dashboards in Get data's "Add to" menu.** _Deferred 2026-11-05 (step 4 spec
  3, Task 10)._ A dashboard saved by a newer build, or one that couldn't keep its original, opens
  read-only, but the dashboard index carries no read-only flag, so Get data's target menu still
  lists it and adding fails with an error toast. Shared dashboards are never offered. **Revisit
  if** it's reported (then put a read-only flag on the index).
- **A toast that appears under a still pointer can stay up forever in Firefox** (svelte-sonner
  1.2.1–1.2.3). _Deferred 2026-11-10 (the Firefox e2e failure on PR #50)._ Firefox fires
  `mouseenter` when a toast appears under the pointer, then `mouseleave` 1px away as the toast
  settles; svelte-sonner's Firefox workaround ignores a leave within 1px of the last position,
  so the toaster stays "expanded" (paused) until the pointer enters and leaves it again. Seen
  after "Add to …" (the "Saved as your own dashboard" toast lands where the pointer was). Why
  deferred: it's in the library, and since toasts now sit above Get data's action bar
  (`toastClearance`) the stuck toast covers nothing the person is using; moving the mouse over
  it and off dismisses it. **Revisit when** svelte-sonner changes that check (report it
  upstream), or if people report toasts that don't go away.
- **Visual and brand design system.** _Deferred 2026-09-14; **scheduled 2026-09-28** as its
  own sub-project before Release 1 step 4 (Foundations builds the theme-token layer it
  plugs into)._ It stays listed here until it ships.

- **Aggregate usage counts** (e.g. which widgets get used; cookieless, never per-person).
  _Deferred 2026-09-28._ Release 1 sends no analytics, only scrubbed error reports.
  **Revisit when** someone needs usage numbers (e.g. for funding reports or prioritizing
  widgets).
- **Context menu loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review); narrowed
  2026-10-29 (step 2, the Move and Size submenus)._ Done in that change: the menu items,
  context, and dropdown state are `$state.raw`, the module-singleton dropdown state has a
  comment, and submenus, disabled items (live and at their limits), `keepOpen` items, and
  separators have tests. Still open: menus have no reduced-motion test (the existing one checks
  a dialog), and whether the Windows Menu key opens the menu twice is unverified (it needs a
  Windows machine). **Revisit in** the first Windows testing pass, or when menus next get an
  animation change.
- **Shell keyboard handling.** _Deferred 2026-10-20 (Foundations spec 1 review)._ The
  text-entry check treats every `input` as text entry; IME composition (`isComposing`) isn't
  skipped; shortcut labels say Ctrl on macOS; `contenteditable` is untested; and the
  undo/redo buttons and shortcuts call `session.undo()` directly instead of the registered
  global actions (the spec has nav controls be views onto actions). **Revisit in** Release 1
  step 4 (its first checkbox or range input), with the command palette (the actions), and
  before translations ship (IME).
- **Read-only dashboards in Recently deleted can't be undeleted by a restore.**
  _Deferred 2026-10-25 (Foundations spec 3, Task 11 review)._ Restoring a backup undeletes
  a stored dashboard that is in Recently deleted through an ordinary edit, and read-only
  sessions (newer or unreadable documents) refuse edits, so such a dashboard is counted as
  kept and stays deleted. The Recently deleted list's **Restore** has the same limit: for a
  read-only dashboard it only shows a toast saying it can't be restored here. **Revisit if** read-only dashboards become restorable or
  undeletable.
- **Dashboard page and list loose ends.** _Deferred 2026-10-20 (Foundations spec 1 review)._
  The delete action's `deletedAt` comes from `new Date()`, not an injected clock; the
  previous `document.title` lingers while a session loads; the conflict dialog watches only
  the current session; list-row sessions are never disposed. Untested: leaving when another
  tab deletes the dashboard, save-as-copy navigation, the `conflict_failed` toast, and
  row-duplicate navigation. **Revisit with** the next change to the dashboard page or list,
  or if many open list-row sessions start to cost memory.
- **Visual dashboard picker** (thumbnail grid instead of the dropdown). _Deferred
  2026-09-24._ IDEA.md: "at minimum via dropdown; ideally via a nicer visual picker".
  Release 1 uses a top-nav dropdown. **Revisit when** people routinely keep more than
  about 5–7 dashboards, or public templates ship and need browsing.
- **A "present" mode using the browser's own full screen.** _Deferred 2026-10-28 (step 2
  design)._ Widget fullscreen covers the dashboard area only; the browser's F11 / fullscreen key
  already gives an edge-to-edge projector view. The Fullscreen API would add a second Esc-to-exit
  that fights our own focus restore, and needs its own exit control. **Revisit if** teachers in
  the private preview ask for one-click projector mode.
- **A separate tablet layout (fewer columns).** _Deferred 2026-10-28 (step 2 design)._ Release 1
  has two layouts: the 12-column grid from ~768 px up, one column below. A derived 6- or 8-column
  view would have to translate tablet moves back to 12 columns. Only the desktop layout is saved
  and the engine takes the column count as input, so adding one later is a display change.
  **Revisit if** preview users find portrait tablets cramped.
- **Spot-specific context menus on touchscreens.** _Deferred 2026-10-28 (step 2 design)._ On touch,
  long-press no longer opens the context menu (it picks up widgets and is the browser's own
  gesture); the ⋯ buttons open the same menus but have no "point". Items tied to a pressed spot
  (e.g. "Analyze this monitor" on a map feature) need another touch path, such as the feature's
  own tap popup. **Revisit with** the map widget (step 5) and Release 3's analysis actions.
- **Drag performance threshold is loose, and its calibration is approximate.** _Deferred
  2026-10-28 (step 2, spec 2a)._ The check requires p95 under 34 ms at 4x CPU (2x the 16.7 ms
  baseline). Frame times come in 16.7 ms steps, so it catches only about 2 dropped frames at p95.
  After it failed on GitHub's runner (p95 50 ms on a CPU about half as fast as the reference
  desktop), the throttle became calibrated: a fixed piece of JavaScript is timed and the rate set
  so the page runs at 4x the reference machine's time (`REFERENCE_WORK_MS`, 10.3 ms), and the
  check runs alone in its own Playwright project. The calibration times JavaScript only, not
  style, layout, or painting, and the reference value is tied to one machine and Chromium
  version. **Revisit with** the low-end Chromebook check before go-live, if CI flakes again, or
  when a Playwright upgrade moves the reference timing (re-measure it as the spec's comment
  says).
- **Pen long-press still opens the context menu.** _Deferred 2026-10-28 (step 2, spec 2a)._ Only
  touch is blocked. **Revisit if** pen users report it.
- **Screen-reader check of keyboard arranging (NVDA/JAWS browse mode, VoiceOver).** _Deferred
  2026-10-28 (step 2, spec 2a final review)._ The title bar is a focusable group, and browse
  mode may intercept Enter and the arrows before they reach it. A mitigation is in (a click
  with `detail` 0 on the title bar acts like Enter), but no real screen reader has been tried.
  On 2026-11-02 the user chose to merge `layout` into `main` first and do this check later
  (the touch check had passed). **Revisit before** Release 1 goes live (step 6) or beta testers
  get the dashboard, whichever comes first, or sooner when the user has time: a hand check with
  NVDA (and JAWS if available) on Windows and VoiceOver on macOS/iOS, also covering the Move ▸
  and Size ▸ submenus (#18), their announcements, and the taskbar. _Widened 2026-11-03 (design
  pass Task 19):_ also check that announcements and toasts made while a dialog is open are read
  once, from the dialog's own live region (tested only against Chromium's `aria-modal` pruning).
- **An announcement still being read when its dialog closes is cut off.** _Deferred 2026-11-03
  (design pass Task 19 review)._ A message belongs to the topmost dialog's live region and is
  dropped when that dialog starts closing (moving it to the page's region would read it again;
  a message sent after that waits and is read from the page's region once the dialog is gone). An
  announcement or toast made in the same 100 ms as another also replaces it. **Revisit if** the
  screen-reader check above finds messages lost this way.
- **The e2e `liveRegion()` helper assumes one live region.** _Deferred 2026-11-03 (design pass
  Task 19 review)._ Each open dialog now has its own region with the same attributes, so a test
  that reads announcements with a dialog open would match two (a strict-mode error). No e2e does
  today. **Revisit when** one does: pick the region holding text, or the topmost dialog's.
- **Keyboard arrangement request-chain cache can thrash in very long pick-ups.** _Deferred
  2026-10-28 (step 2, spec 2a final review)._ The preview cache keeps 512 request prefixes;
  past 512 keyboard steps in one pick-up it evicts the current chain, and each keypress then
  recomputes every step. Nobody makes 500 moves in one pick-up in practice. **Revisit if**
  keyboard arranging feels slow on long dashboards; fix by never evicting the current chain or
  by collapsing the steps into one request.
- **Spec 2a test-coverage gaps.** _Deferred 2026-10-28 (step 2, spec 2a final review)._ The
  behavior is in place and covered elsewhere; these tests are missing or loose: a `setLayout`
  journal / `upgradeChanges` round trip; keyboard replay after a remote change; a pointer move
  after keyboard steps; no animation on rename, remote save, or viewport switch; listeners
  released when a frame is destroyed mid-drag; the click test asserting title-bar focus; the
  Tab test asserting the focus target; the locked/minimized test via the real menu (it builds
  its own `Arrangement`); a synthetic window blur; the width-change test relying on a viewport
  resize; E2E `boundingBox` reads right after a reload without a web-first wait, and ±0.5 px
  tolerances; the perf check's throttle reset not in `finally` and idle frames in its sample;
  engine calls with unknown ids; and `items.test` not unregistering its test widget type.
  **Revisit when** touching each area, or if any of these tests flakes.
- **"The live region is polite and announces" flakes under full-suite load.** _Noted 2026-11-05
  (step 4 spec 2 final checks)._ `src/lib/components/dashboard/dashboard.browser.test.ts`
  checks the region is still empty two animation frames after a repeated `announce`, assuming
  both frames land inside `ANNOUNCE_GAP_MS` (100 ms). Under a loaded full `npm run test` run
  they sometimes don't, so the text is already back; it failed in 2 of 4 local full runs and
  passes alone (3/3). Neither the test nor the announcer changed in spec 2; the suite just grew.
  **Revisit when** it flakes in CI, or when touching the announcer: assert against the gap with
  fake timers instead of frames.
- **Two more browser tests flake under full-suite load.** _Noted 2026-11-08 (step 4 spec 3b)._
  Each failed once in six back-to-back local `npm run test` runs and passed in the rest; neither
  file changed in spec 3b:
  - `src/lib/components/dashboard/arranging.browser.test.ts`, "a keyboard resize animates the
    frame's size, not under reduced motion": the 200 ms width animation can finish before the
    poll first sees it (0 animations, not 1).
  - `src/lib/components/a11y/live-region.browser.test.ts`, "a toast shown just before its dialog
    closes is read once, from the page": the page region was still empty when checked.

  **Revisit when** either flakes in CI, or when touching that test: check the animation is
  started with a paused or longer-running animation, and wait on the announcement rather than a
  fixed moment.

- **A chart browser test flakes under full-suite load.** _Noted 2026-11-08 (step 4 spec 4,
  Task 13)._ `src/lib/charts/time-chart.browser.test.ts`, "keyboard stepping moves the strips'
  cursors" (added in spec 3b), failed in 2 of 3 full local `npm run test` runs and passes alone
  (6 of 6); Task 13 did not touch charts. It fails at line 410: after `{End}` the strip's
  cursor is still where `{Home}` put it, so the key seems not to reach the focused chart under
  load (the `{Home}` check, `>= 0`, does not prove it did). **Revisit when** it flakes in CI, or
  when touching that test: assert the chart has focus and that `{Home}` moved the cursor before
  pressing `{End}`.

- **The WebKit E2E job is slow on CI, and a heavy share test flaked there once.** _Noted
  2026-11-10 (the `step-4` → `main` PR, #50)._ The `e2e-full (webkit)` job takes 10–13 minutes
  on GitHub's runner, against about 4 for Chromium and 6 for Firefox, and about 2 minutes for
  the same suite locally in the same Playwright image (podman). Two WebKit-only timeouts came
  from it:
  - the starter's "the bar on a copy" test, about 30 s of clicks on the runner (fixed in #50:
    one step fewer and `test.slow()`);
  - `e2e/sharing.spec.ts`, "a dashboard too big for a link offers only the file" (1,000 widgets),
    whose Share dialog didn't show "too big to share as a link" within the 5 s expect timeout. It
    passed on a re-run of the job, and the test hasn't changed since spec 3.

  The user found the WebKit job too slow (2026-11-10). Candidate speed-ups, none tried yet: shard
  the WebKit job, set its workers explicitly, or add `--ipc=host` to the container options (a
  guess). The largest file is `e2e/a11y.spec.ts` (about 4 minutes). **Revisit when** the WebKit
  job flakes again or the user asks to speed it up; any CI configuration change needs the user's
  okay.

- **Livelier motion.** _Deferred 2026-11-03 (design pass spec)._ Motion is quick and subtle
  for now: menus, dialogs, toasts, the taskbar, and the theme switch use the two motion tokens.
  Numbers counting up and widgets sliding into place were left out to start simple; the tokens
  make them easy to add. **Revisit after** preview testers have used the app.
- **Restyle monitor-map, mobile, and map-sdk's defaults to the family palette.** _Deferred
  2026-11-03 (design pass spec)._ The design pass's palette is meant for every SJVAir app, but
  restyling the others now would change live apps before the dashboard has proven the look.
  Token names stay shadcn's (plus `--link`, `--highlight*`, `--card-border`, `--shadow-card`,
  `--shadow-lifted`, `--radius-control`, `--chart-1…5`, `--overlay`), so each app can copy the
  token blocks.
  `map-sdk`'s legends and tooltips should use the same names and inherit the dashboard's theme
  (the token list goes to the map-sdk session after the design pass's first PR).
  **Revisit when** the dashboard launches. Each repo needs its own approved plan.
- **The page background can flash for a saved theme override.** _Deferred 2026-11-03 (design pass
  spec)._ System mode is CSS only and never flashes. A saved Light or Dark that differs from the
  system is applied by `app.js`, which sjvair.com's template loads as a deferred module, so the
  browser can paint the page background once in the other mode first. The app itself always
  renders in the right mode. Ruling it out needs sjvair.com's template to render the theme on the
  server (for example from a cookie), which needs a plan in that repo. **Revisit if** people
  notice the flash.
- **Map widgets redraw every frame of a resize animation.** _Deferred 2026-11-03
  (design pass, Task 20 review)._ The widget being resized animates its width and height for
  `--motion-duration-base` (200 ms), so its content reflows rather than being stretched. A
  widget that redraws on a `ResizeObserver` (uPlot charts, map-sdk's `MapView`) would redraw on
  every frame of it. Placeholders don't redraw, so nothing does today. **Charts are done**
  (step 4 spec 1, Task 11: the shared `TimeChart` waits for the frame's animations to finish
  before it redraws). **Revisit when** map widgets land: throttle their redraw the same way, or
  switch to scale with counter-scaled content.
- **A selected widget taller than a phone's screen.** _Deferred 2026-11-03 (design pass, Task 20
  review)._ During a touch selection the widget's body is `touch-action: none`, so the page
  can't be scrolled by touching the widget, and Done (centered in the body) may be off-screen.
  A swipe outside the widget still scrolls, and a tap outside finishes, as Done does. Keeping
  Done sticky within the visible part wasn't cheap enough to add now. **Revisit if** phone
  testers get stuck with a tall selected widget, or when widgets get taller defaults.
- **The token-discipline check reads one line at a time.** _Deferred 2026-11-03 (design pass,
  Task 9)._ `src/lib/theme/token-discipline.test.ts` finds a hex color only when it shares a
  line with `class=` or `style=`, so it misses a `style` attribute split over several lines and
  hex constants in `.ts` files. Today none exist; the check stays simple. **Revisit if** a
  hardcoded color slips through review, or before the family restyle copies the check.
- **The theme store applies the theme through web code.** _Deferred 2026-11-03 (design pass,
  Task 4)._ `src/lib/store/theme.svelte.ts` imports `applyTheme` from
  `$lib/platform/web/theme` directly, outside the adapter boundary. Fine on the web; a Tauri
  build would want applying to live in `platform.display`. **Revisit when** the Tauri build
  starts, or if a second place needs theme state (then the store also moves to app context).
- **Design pass, part 1 polish.** _Deferred 2026-11-03 (design pass, task reviews)._ Small
  follow-ups, none affecting correctness or accessibility. **Revisit with** step 4, or when next
  touching each file:
  - The `secondary` button variant is still the old blue-gray fill; the spec's secondary look
    lives in `outline`. Pick one when step 4 needs secondary buttons.
  - "Sign in" is an outline button; the mockup showed a link.
  - All three logo images are in the DOM (two hidden by breakpoint or mode), so a browser may
    fetch the hidden ones.
  - The theme's color fade can cut its last frame (the class is removed on a timer).
  - `readTokens` and the manifest's `lightToken` stop at the first `}` (nested blocks would
    truncate); `scripts/make-icons.mjs` needs `../mobile`'s art and uses `sharp` without
    declaring it.
  - The dark token list is written twice (the system and override blocks), because CSS can't
    share one block between a media query and an attribute selector. A test fails if they
    differ.
  - `HelpMenu` casts the radio value `as ThemeChoice`; `parseThemeChoice` would be safer. No
    test checks that destroying the theme store stops listening.
  - The `@theme inline` `--shadow-card` refers to itself (on purpose, commented), which reads
    oddly.
  - `--grid-gap` is the literal `0.75rem`, not `var(--space-3)` (same value). The rewritten
    starter-drop E2E test checks less layout detail than before (the live-region text backs
    it).
  - `app_name_product` ("Dashboard" beside the logo) has no translator note.
  - The dev manifest middleware test reads the icons through a path relative to the working
    directory.
  - `syncThemeColorWhenStyled` adds a `load` listener even if the page has already loaded (it
    can't happen today: it runs from `bootstrap.ts`). The destructive tint check doesn't cover
    the page background (axe covers today's uses).
  - From the screenshot review: the full-width "Clear my data…" button on the list page,
    tall placeholder widgets on phones, and toasts covering "Add widget" on phones.
- **Phone check of the focus ring after touch drops.** _Deferred 2026-10-28 (step 2, spec 2a final
  review); narrowed 2026-11-03 (design pass, Task 20)._ The rest of the spec 2a robustness loose
  ends are done. This one can't be scripted: synthetic touch events don't change
  `:focus-visible`, so it needs a real phone. **Revisit in** the next hand check or the private
  preview.
- **Design pass, part 2 polish.** _Deferred 2026-11-03 (design pass, Tasks 11-20 reviews)._ Small
  follow-ups, none affecting correctness for people today. **Revisit when** next touching each
  file, or if one is reported:
  - The `SavedIndicator` tests cast a local conflict with `{} as never`.
  - The scan that finds `LiveRegion` uses in tests can pair a self-closing component with a later
    closing tag (pre-existing).
  - The Share dialog's carry-over test checks for absence right after `setOnline(true)` without a
    settle step, so a late request could slip past it. `linkUnavailable` is inferred from "no
    url" rather than from the result kind of `shareUrl`, and the download confirmation has no
    timeout. `share_downloaded` ("Your file is downloading.") also shows when a native save
    dialog is cancelled, since the download call doesn't say; revisit with the Tauri build's
    file-save adapter.
  - The Recently deleted list has no explicit focus target in its empty or load-failed states,
    and an empty `{#if loading}` branch holds only a comment. The "missing" delete result has no
    unit test at the `deletePermanently` level (a `documents.get` stub returning nothing would
    cover it).
  - `DashboardGrid` no longer wraps the probe callback in `untrack` (harmless), the read-only
    message there is a nested ternary, carried focus stays set if the page never switches
    (guarded, pre-existing), and no test covers a cancelled resize animating back under
    reduced motion (the zero-duration guard covers it).
- **Tidying child-care names in the place picker.** _Deferred 2026-11-04 (sjvair.com step 3
  spec 3, the user's call)._ The state's child-care list stores names and cities in capitals,
  some cut off (`BCSD/ROOSEVELT ELEMENTARY PRE-KINDERGAR`), and the location search returns
  them as published. A rule-based tidy (title case plus an acronym list) would get acronyms
  and names like McKinley wrong, which looks worse than the state's own capitals, and can't
  restore cut-off names. **Revisit if** parents or partners find the capitals confusing in
  the picker.
- **Accent-insensitive location search.** _Deferred 2026-11-04 (sjvair.com step 3 spec 3)._
  No school or child-care name in the data has an accent today, so `ninos` vs `Niños`
  doesn't come up. **Revisit when** an import brings in accented names (Postgres `unaccent`
  is the likely fix).

## Legacy Monitors-tab follow-ups

These came from the Monitors-tab work. That code is removed in Release 1's Foundations
step (a fresh start), so each item stays here only until the new design delivers what
it describes.

- **Chart and spreadsheet views**: _deferred 2026-09-15; superseded 2026-09-24_: now the
  Chart and Data table widgets (ROADMAP Release 1 step 4). Close when they ship.
- **HMS Smoke/Fire and Collocation Sites tabs**: _v1 roadmap; superseded 2026-09-24_ —
  the v1 tabs are removed in Release 1's Foundations step (a fresh start). HMS
  becomes the smoke & fire map preset (see "Widgets"); collocation becomes the
  low-cost-vs-reference starter analysis (#10). Close when those ship.

## Open decisions

Undecided items that don't block current work but must be answered before the listed
point.

- **Dataset license and attribution text.** _Decided 2026-10-22 to leave empty for now (user,
  sjvair.com metadata plan, #293)._ In `meta/datasets/`, every dataset has `license: ""`
  except NOAA HMS smoke/fire and NASA TEMPO ("Public domain"). The real license and
  attribution text for air-quality, weather, pesticide-use, pesticide-notices, forecasts,
  calheatscore, calenviroscreen, and emissions must come from the user and must not be
  guessed. Meanwhile the dashboard handles an empty `license` gracefully (shows the `source`
  alone, never a placeholder). **Decide before** dashboard go-live (and before exports,
  CSV downloads, or shared pages show attribution; the step 4 CSV carries none until then).
- **Optional `sjvair` Python helper package** — own published package (PyPI) or a small
  file embedded in notebook bundles? Notebook bundles work without it. **Decide in** the
  Release 3 export-bundle spec.
- **Does email get its own rollout switch for alerts?** (2026-10-14) Text alerts open to
  everyone before Release 2; email is a new channel. The per-account channel list carries
  either answer. **Decide in** the Release 2 server alerting plan.
- **Legal confirmation of the account and privacy approach.** **The user arranges this**
  with whoever advises SJVAir (operated by the Central California Asthma Collaborative),
  before the email-only accounts plan is finalized. The questions (listed 2026-10-14; not
  legal advice):
  1. **Does COPPA apply at all?** It targets commercial operators, and the FTC has said
     nonprofits outside its jurisdiction are generally not covered. If CCAC is a
     nonprofit, is it exempt? (The 13+ policy stays as a safeguard either way.)
  2. **If COPPA applies, is the approach enough?** Accounts for ages 13 and up with a
     neutral age question; under-13s use the dashboard without an account, with their
     work kept in their own browser; teachers share by link. Since schools are a named
     audience, confirm the site isn't treated as directed to children in a way that
     requires parental consent anyway.
  3. **California student privacy law (SOPIPA).** It covers services designed and
     marketed for K-12 school purposes. Does it apply, given we promote the dashboard to
     schools, and what does it require? The design already has no ad tracking, no selling
     of data, no profiling, and complete deletion.
  4. **What the privacy policy must say** (California requires one): what stays in the
     browser and what syncs, scrubbed error reports, the text and email providers, the
     30-day trash and snapshots, and how account deletion works. _Added 2026-10-28 (sync
     design):_ **staff don't view the contents of private dashboards** (the admin shows
     metadata only), shared pages show only the optional display name, and other devices
     hide a deleted account's copies at once and remove them within 30 days.
  5. **Location and anonymous use.** "Use my location" sends a rounded position to the
     server to find the area, and anonymous error reports are sent. Confirm neither
     counts as collecting personal information from anonymous, possibly under-13, users.
  6. **Code ownership.** Confirm CCAC owns the code it licenses: automatic for employees'
     work, but contractors' and volunteers' contributions depend on their agreements.
- **Analysis view layout** (Collections drawer, list of analyses, results area). **Decide
  in** the Release 3 step 1 spec (Analysis engine).
- **User-defined analysis editor UI** (IDEA.md Q6: "What should user-defined analysis
  creation look like"). The data model (`AnalysisSpec`) is decided; the editor UX isn't.
  **Decide in** the Release 3 step 1 spec (Analysis engine).
- **Geographic crosswalk method**: monitor→region, tract (CES), ZIP (CalHeatScore),
  county/MTRS (PUR), and area weighting. **Decide in** the Release 3 step 1 spec (Analysis
  engine).
- **JupyterLite app: owner repo and deploy path** (docs review 2026-09-28). Options: a
  separate build in this repo, or a new repo, imported by sjvair.com like the dashboard,
  with a Django view setting COOP/COEP only on `/notebooks/`. **Constraint found
  2026-10-13:** production static files are on S3 (another origin), but JupyterLite is a
  whole static site with its own service worker and needs cross-origin isolation, so it
  must be served from sjvair.com's own origin. **Decide in** the Release 3 step 4 spec
  (JupyterLite app).

## Decided against (kept for the record, not planned)

Recorded so nobody re-proposes these without the context. Reopen only with a new reason.

- **Desktop-first / "web as a side effect of Tauri"**: _2026-09-23, Q1_. See the
  Tauri-build entry above.
- **Time scrubbing or time selection inside map widgets**: _2026-09-23, Q2_. Time is fixed
  per widget, and calendar and chart widgets handle narrowing the time range.
- **A long-lived monitor-map 3.x compat shim**: _2026-09-23, Q3_. No compat shim; with the
  `map-sdk` split (2026-09-24), consumers migrate one at a time (the mobile app stays on monitor-map 4.x
  until its own migration).
- **Rewriting monitor-map in place as the multi-map library**: _2026-09-24_. Replaced by
  splitting out `@sjvair/map-sdk` (library) with monitor-map rebuilt on it (experience).
  (monitor-map 4.0–4.2 did ship in October 2026, but as a UI and packaging major on the
  same one-map-per-page architecture; the rebuild on `map-sdk` will be monitor-map 5.0.)
- **Keeping the name "monitor-map" for the map library**: _2026-09-24_. The library is
  `map-sdk`; the monitor-map name stays with the monitor-map experience.
- **Free-form, overlapping dashboard windows**: _2026-09-23, Q4_. We chose a snapping grid.
- **A horizontally scrolling dashboard canvas**: _2026-09-23, Q4_. It grows vertically,
  and multiple dashboards handle crowding.
- **`gridstack.js` for the layout engine**: _2026-09-23, Q4_. It owns DOM positioning and
  fights Svelte; we own a small pure layout engine instead.
- **Snippet-based context-menu items** (the monitor-inventory-tracker approach):
  _2026-09-23, Q5_. Items are data so they can be merged, tested, and reused.
- **Staging copied data instead of query descriptors**: _2026-09-23, Q2_. Descriptors stay
  small, stay current, and keep fetched data out of saved documents.
- **Persisting tablet/phone layouts separately**: _2026-09-23, Q4_. Only the desktop
  layout is saved; smaller layouts are derived. Reconsidered 2026-10-28 (step 2 design) as a
  saved phone order, and kept ruled out: phones show the desktop reading order, and rearranging
  on a phone changes the desktop layout.
- **URL as source of truth for dashboards**: _2026-09-24_. The URL holds location; the
  document holds content.
- **JupyterLite inside dashboard pages / app-wide cross-origin isolation**: _2026-09-23,
  Q1/Q6_. JupyterLite is a separate static app.
- **User-set alert averaging windows**: _2026-09-24, alerting_. The server defines one
  window so every subscriber and the UI's explanation agree.
- **Repeat notifications while a level holds**, beyond the server's single daily 10 AM
  "still bad" reminder: _2026-09-24; amended 2026-10-13_ when the redesigned server's
  reminder was adopted. More frequent repeats would undo its throttling.
- **An interim single-map-widget build on monitor-map 3.x**: _2026-09-24, sequencing_. The
  Map widget waits for `map-sdk`.
- **Explicit Save as the primary save model**: _2026-09-24_. Autosave plus undo instead;
  "Save as copy…" and "Export…" remain.
- **Token auth for the Release 1 web build**: _2026-09-24_. It would put tokens in browser
  storage and force a second sign-in for people already signed in to sjvair.com. Cookie
  sessions instead; tokens remain for Tauri and standalone builds.
- **Hosting Release 1 on a separate origin** (e.g. `dashboard.sjvair.com`): _2026-09-24_.
  Chose same-origin hosting under a path for cookie auth; token auth stays supported for
  Tauri and future standalone builds.
- **Keeping or adapting the v1 app while building the new one**: _2026-09-24_. It was
  never deployed. Foundations removes it, and a fresh, cohesive codebase is built
  instead of retrofitting.
- **Single-letter route segments** (e.g. `/d/:id`) and **readable slugs in URLs**:
  _2026-09-25_. Routes use readable words; IDs stay opaque.
- **`/explore/` as the base path**: _2026-10-13_. Chosen 2026-09-25, then replaced by
  `/workspace/` because sjvair.com's `/tools/` section now holds "data explorers"
  (pesticides, then emissions). `/tools/dashboard/` and `/data/` were also considered and
  rejected (a repeated word and longer share links; the same confusion).
- **`/dashboard/` as the base path, and dashboard IDs directly under the base**
  (`/dashboard/:id`): _2026-09-25_. Chose a neutral app-level base (now `/workspace/`) plus plural collections
  (`/workspace/dashboards/:id`) so IDs never share a level with fixed words like
  `analysis` and `shared`, and the base names the whole app.
- **Offline-first for the web build** (a Release 1 app-shell service worker that opens the
  app offline, and a persistent IndexedDB/OPFS data cache): _2026-09-28_. Air-quality data is
  live, schools are online, and researchers export notebooks. Release 1 keeps local
  documents, sync, manifest-based installability, and an offline banner. A service worker
  comes with web push; true offline-first stays a Tauri concern.
- **Keeping the dashboard repo private** (a read-only deploy token for the import, or a
  CI-built artifact): _2026-09-28_. There was no reason to keep it private, so it was made
  public (done 2026-09-28), matching monitor-map and sdk-js.
- **Merging `planning` into `main` before planning is finished**: _2026-09-28_. It merges
  once planning completes, with approval.
- **Dropping to Tailwind v3 for older browsers**: _2026-09-28_. It would go against
  "nothing ripped out" at high cost for a shrinking set of devices. Revisit only if the
  preview shows many partner-school devices below the v4 floor.
- **A server-side `text_color` per level**: _2026-09-28_. It's computed with color2k's
  `readableColor` instead. Add an optional field only if a designer needs a non-black/white
  override.
- **Notifying on every level change, with a default "back to normal" message** (the
  2026-09-28 alert design): _2026-10-13_. Replaced by the server's escalation-only rules
  after its throttling audit (8–27 texts a day per monitor under the earlier behavior).
- **A per-person daily cap across all alert rules**: _2026-10-13_. The server's throttling
  spec (2026-10-06) considered a cross-monitor cap and chose per-subscription limits
  instead; we follow that.
- **Automatic text filtering or pre-publication review of shared pages**: _2026-10-13_.
  Too heavy for the expected volume, and it would delay teachers. Shared pages are
  labeled as user-made, reportable, and removable by staff instead.
- **A grace period for account deletion** (deactivate for 30 days, then delete):
  _2026-10-13_. It would change behavior the mobile app already has and keep personal data
  longer than asked; the backup download covers a change of mind for documents.
- **"Mark for analysis" on every widget** (IDEA.md's wording): _2026-09-28_. Notes and the
  Alerts feed hold no query, so they are `analyzable: false` and don't offer it.
- **Building Widget Creation "based on what we currently have"** (IDEA.md's wording):
  _2026-09-28_. It is built fresh; the v1 tabs' options reappear as accordions, but no
  v1 code is carried over unless it is exactly what the new design needs.
- **Server `sqid`s as the saved reference for regions and locations** (with official codes
  only for built-in documents and fixtures): _2026-10-13_. Two reference styles in one
  format, and a production re-import would still break everyone's saved dashboards.
- **Stretching the server's `Alert` model to non-monitor targets** (an optional monitor plus
  region, zone, and notice targets): _2026-10-13_. It would change a model that was just
  redesigned and approved, and a pesticide notice is not an alert that opens and closes.
  A separate rule-event record covers every kind of rule instead.
- **A client-only identity check before syncing** (no server enforcement): _2026-10-13_. It
  leaves a window where the cookie changes between the check and the save; the server
  refuses mismatched saves instead.
- **Serving the dashboard's own `index.html` from the `/workspace/*` view**: _2026-10-13_. An
  assumption recorded on 2026-09-28; the user corrected it. The dashboard is embedded in
  a Django template view, as the monitor map is.
- **Extending sjvair.com's base template for the dashboard page**: _2026-10-13_. It would
  load Google Tag Manager and Analytics, Bulma's global styles, and inline scripts, and
  wrap the dashboard in the site header and footer. A dedicated bare template is used.
- **A build-manifest file read by the server, or the CSP in a `<meta>` tag**: _2026-10-13_.
  Unnecessary once the page is a Django template: the view holds the host list and sends
  the header, and the build id is stamped into the app's code.
- **Serving the dashboard's built files from sjvair.com's own origin through WhiteNoise**:
  _2026-10-13_. The user chose the map's existing S3 pipeline, with the cross-origin
  accommodations listed in `ARCHITECTURE.md` → "Template embedding". Worth reconsidering
  if those accommodations prove costly (workers, the service worker, or compression).
- **RTL layout support**: _2026-09-24, i18n_. None of the declared languages need it.
- **Dashboard-owned Collections**: _2026-09-23, Q6_. Collections are independent and link
  back to their source dashboards only as provenance.
- **monitor-map: `setRequestDefaults`.** _Ruled out 2026-10-21 (monitor-map SDK 4.7
  design)._ monitor-map passes request options per call and never sets the SDK's page-global
  defaults, because it runs inside host apps that own those settings. **Reopen if** a host
  needs monitor-map to set a header the host can't set itself.
- **monitor-map: border EV ZIPs not added (Galt 95632, Isleton 95641, Discovery Bay 94505).**
  _Ruled out 2026-11-07 (monitor-map 5.0; the user left it to the coordinator)._ The EV
  chargers' ZIP list (`src/lib/ev-stations/zip-codes.ts`) is the user's scraped per-county list
  for the 13 counties, minus ZIPs with no land in them (the 5.0 check against the Census ZCTA
  file, which dropped Livermore 94550, Hollister 95023 and the typo 09534). These three have some
  land in San Joaquin (30.6%, 3.4%, 0.1%) but were never on the list, and adding them would need
  an inclusion rule nobody has set; the ZIP filter would also bring in chargers that sit mostly
  in the towns, outside the valley. **Reopen if** users ask for chargers just over the county
  line, or a rule for border ZIPs is set (e.g. a minimum land share).

## Dropped

Dropped 2026-09-24 with the user's approval (docs review), each overtaken by later decisions:

- **Icon-only collapsed sidebar** (deferred 2026-09-16). The top nav bar replaces the
  sidebar.
- **Cross-type region selection persistence in the URL** (deferred 2026-09-17).
  Selections live in saved widget configs; the URL holds only location.
- **Whether HMS gets a spreadsheet view of raw records** (open since 2026-09-14). The Data
  table widget covers any dataset layer.
- **Preferences persist only the month; URL read once at mount** (deferred 2026-09-16).
  Replaced by autosaved documents and the new routing.
- **Migrating old `?range=` bookmark URLs** (deferred 2026-09-16). Not needed: the v1 app
  was never deployed, so there are no public v1 URLs (a redirect step was briefly planned
  and removed on 2026-09-24).

Dropped 2026-10-20 by the user ("we won't deal with production"):

- **Run `import_forecast_zones` on production** (noted 2026-10-20). The three `custom`
  forecast zones were imported and verified locally (`TODO.md` → the forecast-zones
  warning); production work is out of scope.

Dropped 2026-10-29 by the user (spec 2b review notes, closed as already covered or impossible):

- **Test for restoring a widget wider than the grid.** The document schema caps `w` at 12,
  the grid's width.
- **Taskbar tests for dashboard items absent from an item's menu, and no taskbar on
  read-only.** The taskbar menu test and the read-only tests already cover both.
- **Test that Back exits starter fullscreen after the `/workspace/` rewrite.** A unit test
  pins that the history state survives the rewrite, and the E2E covers Back.
- **Reduced-motion check inspects only the frame's animations; two-tab test's order relies
  on widget id.** Only the frame animates, and the id tie-break is the spec's rule.

Dropped 2026-11-05 by the user (monitor-map 5.0 spec):

- **monitor-map: cancelling one-off loads** (deferred 2026-10-21, monitor-map SDK 4.7 design).
  Closed because HMS smoke and fire and collocation sites move to map-sdk's load-once stores in
  5.0, which already handle a caller's cancel; they still load once.

Dropped 2026-11-06 by the user (step 4 spec 3 final review nits, harmless polish or process
notes):

- **`as never` casts around `regionDisplayName`** (`src/lib/places/directory.ts`,
  `src/lib/data/adapters/registry.ts` and their tests).
- **The "weeks start on Sunday" test lives in `date-presets.test.ts`** but exercises the shared
  range code.
- **The forecasts test fixtures' nested ternary and casts** (`src/lib/data/testing/fixtures.ts`).
- **The Get data view's tests were written after the components** (test-first order skipped;
  the tests cover the behavior).
- **`e2e/get-data.spec.ts` parses CSV by splitting on commas** (fine for its fixtures, which
  have no quoted commas).

Dropped 2026-11-09 by the user (step 4 spec 5 brainstorm, "drop it, just do the two calendars"):

- **The hour × weekday heatmap widget** (planned 2026-09-23 in the first widget set, the widget
  form of starter analysis #2). Each cell averaged one weekday-hour over the range ("every
  Tuesday at 3 pm over 90 days"), which the user didn't find useful. Spec 5 builds only the two
  calendars; spec 6's starter drops the heatmap's slot. Starter analysis #2 (Release 3) is not
  affected. The mockup is kept in
  `docs/superpowers/mockups/2026-11-09-step-4-spec-5-heatmap-coloring.html`.
