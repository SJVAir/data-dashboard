# Architecture

This document describes the design of SJVAir's data dashboard. The current direction
comes from `IDEA.md` (planning brief) and the decisions made while working through its
Open Questions and follow-up reviews (2026-09-23 → 2026-09-28); each section below notes which question it resolves.
Deferred and ruled-out items live in `DEFERRED.md`; the server's actual data is
catalogued in `docs/reference/server-data-inventory.md`. The original v1 tab-based
design (`docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md`) is superseded,
and its code is removed in Release 1's Foundations step. See "Legacy: v1 tab model" at
the end.

**A fresh start, not a retrofit** (decided 2026-09-24). The new direction is built as
one cohesive design. The v1 layout and tab code are not kept or adapted. Existing code is
reused only when it is exactly what the new design needs (e.g. a well-tested pure
helper), never to save effort at the cost of fitting the new architecture. Before the v1
code is removed, its _lessons_ (server behaviors and edge cases, not code) are captured
in `docs/reference/v1-lessons.md`.

## Product direction

**A personal, interactive dashboard and data-analysis toolbox for all public SJVAir
data** (historical and live). Three uses:

- **Day-to-day monitoring** of conditions.
- **Exploring trends** local to a region.
- **Staying on top of live data for alerts** — both _self-monitoring_ (live data shown
  clearly enough to spot concerning values as they arrive) and _automated alerting_
  (the system notifies the user when values cross a threshold).

**Audiences:** everyday community members, schools, and research scholars. Intuitive
for basic users, feature-rich for power users.

### Views

- **Dashboard** (primary) — horizontal navigation bar on top (replacing the v1 vertical
  sidebar), dashboard area below. Holds widgets (see "Dashboard layout mechanics",
  "Widget catalog"). Multiple saved dashboards, selectable at minimum via a dropdown
  (decided 2026-09-24: a **dropdown in the top nav** for Release 1, with new / duplicate /
  rename / delete at its bottom; a visual thumbnail picker is deferred). "Add widget" picks a type
  from the predefined list, then opens Widget Creation to configure its data.
- **Widget Creation** — configures one widget's data (see below).
- **Analysis** — Collections, starter and user-defined analyses, notebooks (see
  "Analysis: Collections & engine", "Notebooks").

These may change if a better structure emerges.

### Starter dashboard

Decided 2026-09-28. The dashboard a first-time visitor sees (not a blank page):

- A **built-in document** whose place defaults to **Fresno County**. Automatic location is
  ruled out (geolocation is opt-in only), and there is no Valley-wide region.
- A **"Showing Fresno County · Change place"** bar offers the shared place picker plus an
  opt-in "Use my location". It **changes the place for all of the starter's widgets at
  once**. This is a feature of the built-in starter only, not general widget linking
  (which stays deferred).
- **URL and copies** (decided 2026-09-28):
  - The starter lives at **`/explore/`** for first-time visitors and anyone with no
    dashboards of their own. Once someone has dashboards, `/explore/` opens their
    last-opened one, and the starter stays reachable from the picker ("New from starter").
  - **"Change place" does not create a copy.** The chosen place is saved as a
    **preference** (through the platform adapter).
  - **A real edit creates the visitor's own copy**: moving, resizing, adding, removing,
    or configuring a widget, or renaming. The copy gets a new id, the URL is replaced with
    `/explore/dashboards/:id` (no new history entry), it carries over the chosen place,
    and a toast says "Saved as your own dashboard". The built-in template is never
    modified.
  - **Sharing the starter** first makes a copy, then shares that.
- Titles are generated from metadata (nothing English is stored in the template).
- **Contents** (decided 2026-09-28; layout settled in the step 4 spec): Current conditions
  (PM2.5), Forecast strip, "Can we go outside?", a PM2.5 chart (last 30 days), a
  day-colored calendar (this month), the hour × weekday heatmap, and a short welcome Note.
  The Map widget joins in step 6.

### Widget Creation view

Built fresh. The only carry-over from v1 is the _idea_ of per-data-type filter options
(e.g. pollutant, regions), now living inside the new dataset accordions:

- **Date selection sits above** the option accordions. **One date range per widget**
  (dashboard display widgets only — time-offset/lag comparison belongs to Analysis).
- **Three date-range methods**, one visible at a time, toggled via a dropdown (unless
  something more elegant fits; decided in the Widget Creation spec, see `DEFERRED.md` →
  "Open decisions"):
  - **Set ranges** — year, month, week, day
  - **Rolling ranges** — year-to-date, month-to-date, week-to-date
  - **Custom ranges** — user-selected
- **The v1 sidebar tabs themselves become accordion sections** (decided 2026-09-24).
  No tab view or side menu survives. Where v1 had a "Monitors" tab leading to a page of
  Monitors filters, Widget Creation has a **"Monitors" accordion** that expands to those
  options (pollutant, monitors/regions). The same goes for "HMS Smoke/Fire" and the
  others. The accordion list is **generated from the `meta/datasets/` catalog**, so new
  data types (Pesticides, Weather, Forecasts, …) appear as new accordions without code
  changes.
- **Multiple accordions per widget.** A widget combines dataset **layers**, one per
  accordion used, e.g. a map with PM2.5 plus smoke, or a chart overlaying PM2.5 with
  smoke days. All layers share the widget's single date range.
- **Pollutants: at most one pollutant layer per widget** (no mixing O3 and PM2.5 in one
  widget). Non-pollutant layers can be combined freely.
- Which accordions a widget offers, and whether the date section appears at all, comes
  from its **widget type** (see "Widget catalog" → "Widget-type contract"). For example,
  Notes has no date or data, and Current conditions picks a place instead of a range.
- **Live preview on the right**, itself a drag-and-drop, resizable area matching
  dashboard behavior.

### Shared widget behavior

- **Title bar** defaults to the dataset name(s) + date range; user-renamable.
- Every widget with data (`analyzable`; see "Widget-type contract") contributes **"Mark for analysis"** (add its data — or current selection —
  to a Collection) and **"Analyze"** (add + navigate to Analysis) via the shared action
  list (see "Actions & context menu"). Widgets with a selection (map features/regions,
  calendar day ranges) add "Mark selected data for analysis" / "Analyze selected data"
  alongside the whole-dataset options.
- Minimize, fullscreen, drag, resize per "Dashboard layout mechanics".

### Theme & style

- **Theme tokens from Foundations; design pass before the widgets** (decided 2026-09-28).
  Foundations builds on shadcn-svelte defaults, but **only through a theme layer**: all
  colors, fonts, radii, spacing, and motion timings are CSS variables, and components never
  hardcode them. A **design pass is its own small sub-project, scheduled before Release 1
  step 4** (at the latest before the private preview). It covers the palette (drawn from
  sjvair.com's pages, working around the fixed EPA level colors), typography, spacing,
  motion, and component styling. Applying it mostly means swapping token values.
- **Tailwind CSS + shadcn-svelte** for components. **Never Bulma** (the server uses it;
  this project never will).
- No SJVAir ecosystem theme exists yet; colors and style direction may be derived from
  the server's existing pages/templates (a dedicated design pass is in `DEFERRED.md`).
- Modern component/layout practice; **animations for transitions encouraged**. Tone:
  clean, not messy — but not plain, boring, or corporate. Use layout patterns users
  already know.
- **Responsive required** — phones aren't the primary target but must work.

### Charting

**uPlot for all charts.** Nearly all data is time series, so chart configuration should
converge on a consistent, shared pattern.

### Alerts

The server already has an alert/notification system; **extend it** for dashboard
alerting rather than building a separate one. Current shape (see
`docs/reference/server-data-inventory.md`): `Subscription(user, monitor, level)`,
level-category thresholds, evaluated every 10 min for PM2.5 (most monitors) / O3
(AirNow, AQLite), **SMS only**; no push infrastructure exists on the server or in
`v3-mobile`.

Decided 2026-09-24: **two separate mechanisms.**

**1. Self-monitoring — client-side, no account.** Widgets make threshold states obvious:
level-colored threshold lines on charts, current-conditions tiles that change color /
pulse on a level change, a toast when a newly arrived value crosses a threshold, and an
opt-in browser notification **while the dashboard is open** (through the platform
adapter). **Desktop browsers only in Release 1:** Android Chrome and iOS need a service
worker to show notifications, and that arrives with web push (see `DEFERRED.md`). Thresholds default to metadata levels and are overridable per widget. Needs
no server changes; ships with the widgets.

**2. Automated alerting — server-side, requires an account.** The dashboard only
_creates rules_; the server evaluates them on its periodic task and delivers through a
channel that reaches the user when the dashboard is closed. Extends `Subscription` into
a general alert rule (target monitor _or region_, entry type, condition, channels).
Region targets fit naturally: `RegionSummary` is already computed hourly. Needs an
approved sjvair.com plan.

**What automated alerts watch (first server iteration, decided 2026-09-24):**

- **Pollutants** — on **monitor** targets (existing 10-min evaluation) and **region**
  targets (county, city, ZIP, **school district**, …; evaluated from hourly
  `RegionSummary`, so ~1 h latency). Limited to the **available pollutants** list
  (below) — PM2.5 and O3 today — though the rule model supports every summarized entry
  type (pm25, o3, no2, so2, co).
- **Forecasts** — tomorrow's AQI category, no-burn days, declared air alerts (per
  forecast zone): before-the-fact warnings, especially for schools.
- **Pesticide notices nearby** — a SprayDays application scheduled within N miles of a
  chosen place.

Smoke, heat (CalHeatScore), fire-proximity, and drawn-area targets are deferred — see
`DEFERRED.md`.

**Thresholds & notification behavior (decided 2026-09-24):**

- **Pollutants: level categories only** (e.g. "Unhealthy for Sensitive Groups or
  worse"), picked from metadata levels — so thresholds track breakpoint changes
  automatically. Numeric thresholds are deferred (see `DEFERRED.md`).
- **Averaging windows are server-defined, not user-set:** monitors keep today's 30-min
  average to open / 60-min to update; regions use hourly summaries. Published via alert
  metadata (Metadata gap #4) so the UI can explain "based on a 30-minute average".
- **Notify on** (new rules): first crossing, any level change while at or above the
  user's threshold, and an optional **"back to normal"** message, meaning **dropped
  below the user's own threshold** (on by default), e.g. "PM2.5 is now Moderate, below
  your alert level". No repeats while a level holds.
- **Today's behavior, verified in `alerts/models.py` and `evaluator.py`
  (2026-09-28):** every level change while not Good creates an `AlertUpdate` that texts
  subscribers whose threshold is ≤ the new level. The alert ends at Good (after ≥ 60 min)
  with a ✅ update, but `send_notifications` only texts subscribers whose threshold is ≤
  the new level, so **the all-clear only reaches "Good"-level subscribers**, and dropping
  below a subscriber's threshold is silent. The new rule design fixes this for new
  rules.
- **Existing SMS subscriptions** (decided 2026-09-28):
  - Every `Subscription` is **migrated to a monitor rule that reproduces today's
    behavior exactly**, quirks included (SMS, same level, updates on every change at or
    above the threshold, no all-clear for most). The genuinely new features (daily caps,
    quiet hours) default **off** for migrated rules. Users can opt in to the new
    behavior (including the below-threshold all-clear) from the dashboard's rule
    settings.
  - **The legacy endpoints** (`monitors/<id>/alerts/subscribe|unsubscribe`,
    `alerts/subscriptions`) stay as a **compatibility layer** over the new rules, showing
    and editing only rules a `Subscription` can express (single monitor, SMS, level). They
    **log usage with the app version**. v3-mobile works unchanged; dashboard-only rules
    don't appear in it until it is updated.
  - One source of truth: old and new endpoints read and write the same rules.
  - Removing the legacy endpoints later is deferred (see `DEFERRED.md`). Removing them
    never affects anyone's alerts, only the old management API.
- **Guard rails:** per-user daily cap per channel; optional **quiet hours** (e.g.
  overnight SMS).
- **Forecasts:** tomorrow's category ≥ a level, and/or no-burn day, and/or declared air
  alert; checked once daily after forecasts publish.
- **Pesticide notices:** place + radius (e.g. 1/2/5 mi), optional filters for
  application method (aerial/ground) and chemical category (e.g. fumigants); notify when
  the notice is published, optional reminder the day before application.

**Email alerts** (decided 2026-09-28): require a **verified email** (the verification flow in "Accounts & anonymous use") and
include **one-click unsubscribe** (the `List-Unsubscribe` header plus a link), which major
providers expect from automated senders. A rule can't use a channel until it is verified,
and the rule UI prompts for verification when needed.

**Delivery channels (decided 2026-09-24):** channels are chosen **per rule**. First
iteration: **SMS** (available for **every** alert type — daily caps and quiet hours are
the cost control), **email** (new; natural default for schools and slow alerts), and
the **in-app alert inbox** (every fired alert lands there; history, not delivery).
**Web push** is the next iteration; **mobile app push** is a separate `v3-mobile`
project. Both are tracked in `DEFERRED.md`.

Channel reference:

| Channel                  | Reaches user with dashboard closed? | Notes                                                                                                                                     |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SMS                      | Yes                                 | Exists; per-message cost; verified phone                                                                                                  |
| Email                    | Yes                                 | Cheap to add via Django; verified email; one-click unsubscribe (`List-Unsubscribe`)                                                       |
| Web push                 | Mostly                              | Desktop needs the browser running; Android works; iOS only for home-screen-installed sites. Needs a service worker + VAPID + server table |
| Mobile app push          | Yes                                 | Would require FCM/APNs in `v3-mobile` — separate project                                                                                  |
| In-dashboard alert inbox | No                                  | Not delivery — history of what fired, shown on next open                                                                                  |

### Sibling projects

Built with and against `sjvair.com` (server), `sdk-js` (`@sjvair/sdk`), and
`monitor-map` (map experience, also used by sjvair.com and `v3-mobile`), and the planned
`map-sdk` (map library split out of monitor-map), and `django-resticus` (the API framework,
`~/workspace/django-resticus`). They may need changes,
but **must not break their existing use cases**, and **each change needs an approved
plan first**.

## Platform strategy: web-first, Tauri-ready

Decided 2026-09-23 (IDEA.md Open Question #1). **The web build is the primary product;
a Tauri desktop build is a later, additive target** — not the other way around.

Why web-first:

- **Audience reach.** Schools largely run managed Chromebooks / locked-down machines
  where installs are blocked (ChromeOS can't run Tauri at all); community members
  arrive via links from sjvair.com. Only research users are likely to install an app.
- **Embedding** in sjvair.com (see below) is a web-only goal.
- **Tauri is not one engine.** It uses the OS webview — WebView2 (Chromium) on
  Windows, WKWebView (Safari) on macOS, WebKitGTK on Linux. WebKitGTK has known
  WebGL performance/driver problems (relevant to map widgets). A desktop-first build
  would still need cross-engine testing, with worse tooling.
- Tauri's distinctive features (tray, native notifications, local SQLite, background
  polling for alerts, large offline datasets) are **additive capabilities**, not
  foundations — as long as the core never assumes they're absent.

Tauri-ready seams required **from day one**:

- **Platform adapter layer.** A small set of interfaces for storage, notifications,
  file save/export, background tasks, online/offline status, and opt-in geolocation. The web
  implementation uses IndexedDB (for documents and preferences) and browser APIs; a Tauri implementation later
  swaps in SQLite, native notifications, tray, and filesystem access. **Components and
  managers never call `localStorage`, `Notification`, `showSaveFilePicker`, etc.
  directly** — only through the adapter. Preferences (e.g. last-opened dashboard,
  active Collection) are stored through it. The v1 `src/lib/preferences.ts` is removed
  with the rest of the v1 code, not migrated.
- **Documents are local-first; fetched data is not** (revised 2026-09-28). Saved documents
  live locally (IndexedDB), which is required for anonymous users and autosave. Fetched
  air-quality data uses an **in-memory cache** shared across widgets, plus the
  **browser's HTTP cache** for persistence across reloads (long `Cache-Control` on
  completed periods, short on the current one). There is no custom persistent data
  store. A larger on-disk data store is a Tauri-era concern.
- **No server runtime, no origin assumptions** (already true — plain Vite SPA). See
  "Authentication" below for the one origin-sensitive piece.
- **Cross-origin isolation is page-scoped, not global.** Some candidate analysis
  tooling (e.g. JupyterLite's SharedArrayBuffer file access) benefits from COOP/COEP headers,
  which break cross-origin resources (map tiles, API) that don't opt in. Never enable
  isolation app-wide; if needed, confine it to a dedicated page/window (Tauri can set
  headers per window). See Open Question #6 in `IDEA.md`.

**Web offline stance (decided 2026-09-24; revised 2026-09-28): not offline-first.**
Air-quality data is inherently live; schools have connectivity; researchers who need data
offline export a notebook bundle. What Release 1 keeps:

- **Local documents** (above) and **versioned sync**, which are needed regardless:
  anonymous storage, autosave, and conflicts from two tabs or devices even when online.
- **Installable via a web app manifest only** ("Add to Home Screen" / Install). An
  installed site is exempt from Safari's 7-day storage eviction, which protects anonymous
  users' dashboards _created in the installed app_. On iOS the home-screen app likely has
  storage separate from Safari (unverified), so dashboards made in Safari first are moved
  with Export/Import. Modern browsers need only the manifest (and icons), not an offline
  service worker.
- **An offline banner** ("You're offline, data may be out of date") from the browser's
  online/offline events, through the platform adapter.

Removed from Release 1: the **app-shell service worker** (the app opening offline, the
update prompt, cache versioning) and the **persistent data cache**. A service worker
arrives with **web push**, which needs one anyway (including on iOS), scoped to
`/explore/` (JupyterLite's worker stays on `/notebooks/`). Whether it also caches the app
shell then is an optional add-on tracked with web push in `DEFERRED.md`. True offline-first remains a Tauri concern (see `DEFERRED.md`).

When to actually add Tauri: once there's a concrete desktop-only win (most likely
background alerting from the tray, or large offline datasets for researchers). Before
committing, run a short WebKitGTK spike with the map widget to confirm Linux desktop is
viable. See `ROADMAP.md`.

## Authentication

`@sjvair/sdk` supports two auth modes, and which one applies depends on **where this
app is running**, not on a user choice:

| Deployment context                                                                  | Auth mode                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Served from sjvair.com's origin (Release 1: `/explore/`; host-page embedding later) | Django **session cookie** (same-origin)       |
| Standalone on a different origin, or Tauri desktop                                  | **`Authorization: Token <api_token>`** header |
| (Reference: `../v3-mobile`, the mobile app)                                         | Token header                                  |

Release 1 is served from sjvair.com's origin and uses cookie auth (see "Deployment").

How the SDK does it: `account/login` returns `UserDetails` including `api_token`. Some
authenticated calls (e.g. `getSubscriptions`) take an **optional** `apiToken`: when it
is passed a `Token` header is sent, and when it is omitted the request relies on the
browser's same-origin session cookie. Others **require** a token today:
`getUserDetails`, `updateUser`, `getAirAlerts`, `subscribe`/`unsubscribe`, `deleteUser`,
the phone functions, and
change-password (`sdk-js/lib/account/*`). The
server (resticus) accepts an existing session for them, so this is an SDK signature
limitation. Consequences:

- Cookies **only work same-origin**. A standalone deployment (e.g. a separate
  subdomain) or a Tauri window (`tauri://`/`http://tauri.localhost` origin) must use
  tokens.
- Auth mode is a **platform-adapter concern**: the adapter exposes "how to
  authenticate" (cookie vs. token + where the token is stored), and data managers pass
  `apiToken` (or not) accordingly. No component decides this itself.
- Token storage must go through the adapter too (browser storage on web, OS keychain /
  secure store under Tauri).

## Accounts & anonymous use

Decided 2026-09-24. Uses the existing **sjvair.com accounts** (register, login,
password reset, phone verification — all wrapped by `@sjvair/sdk` `account/*`); no new
auth system. See "Authentication" for cookie vs token.

**Email-only accounts (decided 2026-09-28, Release 1).** Today every account **requires a
phone number**: `phone` is unique and required, it is `USERNAME_FIELD`, and registration
immediately texts a verification code. Email is optional and never verified. That would
force teachers, researchers, and anyone without a mobile phone to give and verify a
phone number just to sync dashboards. So in Release 1 (sjvair.com accounts work plus sdk-js
changes, approved plans first):

- **`phone` becomes optional.** An account needs **either a verified phone or a verified
  email**.
- **A new email verification flow**, mirroring phone verification (an emailed link).
- **Login by email or phone** (the existing `identifier` field), and registration by
  either.
- **SMS alerts require a verified phone; email alerts require a verified email.** Users
  can add the other later.
- **Must not break existing consumers:** phone-based registration and login keep working
  for v3-mobile and existing users. The username-field change needs care (phone-less
  users), which the plan must address.

**Everything works anonymously except what needs the server to act or persist for
you:**

| Anonymous (local via platform adapter)                 | Requires an account                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Dashboards, widgets, Widget Creation                   | Automated alerts (SMS/email) + alert inbox                                            |
| Collections, analyses, notebook export, JupyterLite    | Creating server-backed documents & live share links (opening a link needs no account) |
| Self-monitoring (client-side thresholds/notifications) | Cross-device sync                                                                     |
| File / URL sharing (fork on open)                      |                                                                                       |

- **Sign-in is lazy/contextual** — prompted only when needed (e.g. inside the "Create
  alert" flow), never as a gate on first load.
- **Local → account migration:** once server-backed documents exist, first sign-in offers
  to upload local dashboards/Collections/analyses.
- **No teacher/class/org accounts**; teachers share via links.
- **Shared computers:** the **browser profile is the boundary** (as for any website;
  managed Chromebooks usually give each student their own profile). Provide a visible
  **"Clear my data"** action. Signing in **without "remember me"** gives a session that
  ends when the browser closes: under cookie auth that's a browser-session cookie (a
  small server change, see "Sign-in flow"), and for token builds a session-only token
  via the platform adapter. A dedicated guest mode is deferred.

### Security baseline for untrusted content

Decided 2026-09-28. The dashboard runs on **sjvair.com's own origin**, with the session
cookie and a JS-readable CSRF cookie, so an XSS bug in `/explore/` could act as the
signed-in user (change password, delete account, SMS sign-ups). Untrusted content enters
through **Notes Markdown** (shown to anyone opening a share link) and through **`/import#…`**,
files, and server documents.

1. **Validate every incoming document**, from a file, URL fragment, or the server, against
   a schema (zod, as in the SDK) and a size limit **before** migration or use. Invalid
   documents are rejected with a clear message and never partly loaded.
2. **Safe Markdown:** Notes render with **raw HTML off** and a link allowlist (`http`,
   `https`, `mailto`).
3. **A content security policy on `/explore/*`**, sent by the Django view: the
   browser-enforced backstop if a bug slips past 1–2.
   - `script-src 'self'` (plus `'wasm-unsafe-eval'` only where WebAssembly needs it): no
     inline scripts or handlers, and no third-party scripts.
   - `worker-src 'self' blob:`.
   - Explicit `connect-src`/`img-src` hosts (the sjvair.com API, MapTiler, NREL, …), so
     injected code can't send data elsewhere.
   - `style-src` may need `'unsafe-inline'` (Svelte and map libraries set inline styles).
   - **Rollout:** deploy in **report-only** mode first, then enforce once clean. It
     applies only to `/explore/*`.
4. **Unguessable share tokens:** at least 128 bits (`secrets.token_urlsafe(16)` or
   more), revocable.
5. **Abuse limits** in the server-documents plan: per-user caps on document count and save
   rate, alongside the body size limit.

### CSRF protection for cookie-authenticated API writes

Decided 2026-09-28. Verified in code:

- **Website pages and forms are protected.** Django's CSRF middleware is on (it sets the
  `csrftoken` cookie).
- **Session-cookie API requests are not.** sjvair.com's API uses `django-resticus`
  (installed from its unpinned `develop` branch; configured with `TokenAuth` only).
  `Endpoint.dispatch` is `csrf_exempt`, and `Endpoint.authenticate` returns an
  already-logged-in session user early, so resticus's own `SessionAuth.enforce_csrf`
  never runs.
- It is mitigated today by token auth for most API writes (v3-mobile) and by
  `SameSite=Lax`. **Release 1's cookie-based document saves would be the first
  significant writes on this path**, so the fix must land first.

**The fix goes in resticus** (local repo `~/workspace/django-resticus`, remote
`dmpayton/django-resticus`; the user has access and coordinates with its developer). When a
request is authenticated by the **session** (not a token) and **changes data**
(POST/PUT/PATCH/DELETE), run Django's CSRF check. Keep the existing early return (add the
check there) so nothing else changes for existing resticus users. Tests cover:

- session with no CSRF token → rejected
- session with a CSRF token → accepted
- token-only → accepted
- GET → unaffected

**Supporting changes:**

- **The SDK sends `X-CSRFToken`** (from the `csrftoken` cookie) on session-based calls.
  Token clients are unaffected.
- **Update the existing sjvair.com pages that call the API with the cookie** so they send
  the header.

**Ordering, since resticus is not pinned** (decided 2026-09-28; the user is discussing
pinning with its developer): sjvair.com installs resticus `develop`, so merging the fix
there reaches production at the next server deploy. The sjvair.com pages that use the
cookie and the SDK header must therefore be ready **before or together with** that merge,
and all of it must land before the dashboard's cookie-based saves ship. Needs approved
plans in resticus, sjvair.com, and sdk-js. **Merging to resticus `develop` needs explicit
approval** (it's effectively a production deploy while unpinned), as does any resticus release.

### Sign-in flow

Decided 2026-09-24. The API's `account/login` is **token-only**
(`TokenAuthEndpoint`: it returns `api_token` and never calls Django's `login()`). Only the
website form at `/account/login/` (Django `LoginView`) creates a session cookie. The
approach is staged:

- **Release 1: redirect.** "Sign in" / "Create account" go to sjvair.com's own pages
  (`/account/login/?next=/explore/…`, registration likewise) and return to the same
  dashboard route. This reuses the mature Django flows (password reset, phone
  verification, plus the new email verification from "Accounts & anonymous use") and
  adds no new auth endpoint. Known cost: in-progress dialog state
  isn't preserved across the redirect (autosave keeps documents safe). **"Remember me"**
  needs a small sjvair.com change (a checkbox; when unchecked, the session expires at
  browser close) in the **email-only accounts plan** (both change the login page).
- **By Release 2: in-app session login.** A small `POST account/session/` endpoint
  (`{identifier, password, remember}` → Django `login()` plus session expiry, with a
  matching logout) behind an in-app sign-in dialog. That keeps mid-flow sign-in (e.g.
  inside "Create alert") in context and matches the app's design. It needs rate
  limiting and non-enumerating error messages. The same dialog later serves Tauri and
  standalone builds using tokens. The rest of the app only asks "am I signed in?", so
  the switch is contained.
- **SDK:** make `apiToken` optional on the account calls that require it today
  (`getUserDetails`, `updateUser`, `getAirAlerts`, `subscribe`/`unsubscribe`,
  `deleteUser`, the phone functions,
  change-password) so a session works everywhere.
  sdk-js change, approved plan first.
- **Development:** the Vite dev server proxies `/api` (and `/account/`) to the local
  podman sjvair.com, so dev is same-origin and cookies behave as in production.
  Because Vite serves the app itself in dev, Django's `ensure_csrf_cookie` never runs
  there, so dev bootstraps the `csrftoken` cookie once through the proxy (e.g. a GET to a
  Django page or a small cookie-setting endpoint). In production, cookie-based saves depend
  on the hosting track's `ensure_csrf_cookie`.

## SDK request options

Decided 2026-09-28. `@sjvair/sdk`'s data wrappers build `{url, searchParams}` but pass no
`init`, so there is no `AbortSignal` (needed for last-requested-wins), no single place to
set headers (`X-CSRFToken`, a future `Accept-Language`), and no global `credentials`. One
**additive** sdk-js change fixes this:

- **Every data function accepts optional `signal` and `init`**, passed through to `fetch`.
- **A global `setRequestDefaults({ headers, credentials })`** (or a request hook) that the
  dashboard sets once.
- **Nothing breaks:** all additions are optional (monitor-map, v3-mobile, and existing
  code are unaffected).
- It lands in the **first sdk-js plan (the metadata-enablers track)**, since Foundations'
  data layer builds on it. The CSRF header and i18n readiness use it.

## Data resolution & live refresh

Decided 2026-09-24. Implemented once in the data layer (in-memory cache plus HTTP
caching), not per widget.

**Automatic resolution by range span** (bounds fetch size):

| Range span | Resolution        |
| ---------- | ----------------- |
| ≤ 2 days   | Raw entries       |
| ≤ ~60 days | Hourly summaries  |
| ≤ ~2 years | Daily summaries   |
| longer     | Monthly summaries |

- **Datasets without summaries** (decided 2026-09-25). Only pm25, o3, no2, so2 and co have
  server summaries, so the ladder only uses levels the catalog's `resolutions` list:
  - **Naturally daily data** (HMS smoke/fire, forecasts, CalHeatScore) is fetched as-is
    and aggregated for display (e.g. smoke days per month).
  - **Unsummarized time series** (CIMIS weather, PM10) are fetched raw with a span cap
    (about 1 year per request, split into chunks) and **downsampled in a Web Worker** to
    the resolution the ladder would pick. The table and exports say "computed from raw
    data".
  - **Pesticide use** stays yearly (sub-yearly is deferred).
  - Server summaries for weather/PM10 are deferred (see `DEFERRED.md`).
- **Incomplete periods are stitched from finer data** — e.g. the current month (no
  monthly rollup until it ends) is computed from daily summaries so far, today from
  hourly. Fixes the "current month shows nothing" problem for every widget.
- Advanced **resolution override** in Widget Creation (Release 1 step 4); data table and
  exports show the resolution used.
- **Where resolution lives** (decided 2026-09-28): each layer (and so each
  `QueryDescriptor`) carries `resolution` (`"auto"` by default), so Collections and exports
  keep it. A `WidgetType` may **pin** a resolution: calendars `"day"`, the hour × weekday
  heatmap `"hour"` (long hourly fetches still use span caps and chunking). **Priority:
  widget-type pin → user override → automatic ladder.** Pinned widgets don't show the
  override.
- Long raw exports (notebook bundles, CSV) use the monthly **CSV archive** endpoint.

**Live refresh:**

- Only widgets whose date range **includes now** refresh.
- Cadence follows data cadence: raw/current-conditions every 2–5 min; hourly summaries
  hourly, scheduled a few minutes after the server's :50 region-summary task; daily
  after midnight plus hourly for today's partial value.
- **One poll per descriptor**, shared across widgets via the cache; **pause while the
  browser tab is hidden**; back off on errors.
- **Minimized widgets refresh only if they have thresholds configured** — so their
  taskbar entry can flash when a threshold is crossed (self-monitoring). Minimized
  widgets without thresholds don't poll.
- **Caching:** an in-memory cache keyed by descriptor, shared across widgets. Across
  reloads, the **browser's HTTP cache** does the work: completed periods are immutable, so
  the server sends a long `Cache-Control`; open periods get a short one. The server's
  summary cache headers are therefore a **Release 1 requirement** (metadata enablers,
  step 3), not an optional follow-up.
- In-flight requests are superseded by newer ones for the same widget
  (last-requested wins, not last-to-finish).

## Routing, URL state & undo

Decided 2026-09-24. Supersedes the v1 "URL is the source of truth" rule (see "Legacy:
v1 tab model") for the dashboard direction.

**The URL identifies _where you are_; the saved document holds _what's there_.** A
dashboard's layout and widget configs are far too large for a URL and are now saved
documents (see "Saving & sharing documents").

**Routes use readable words, never single-letter segments** (decided 2026-09-25). IDs
stay opaque (no readable slugs). **IDs only appear inside their own plural collection**
(`/dashboards/:id`, `/analysis/collections/:id`), never at the same level as fixed words, so no
reserved-word list is needed. All routes sit under the `/explore/` base path (see
"Deployment"), e.g. `sjvair.com/explore/dashboards/:id`. Where a trimmed URL has a
page, it's the obvious one (e.g. `…/dashboards/:id` → `…/dashboards`, the list). Other
trimmed paths (e.g. `…/analysis/collections`, `…/shared`) redirect to their section's
home.

```
/                                                last-opened dashboard (preference) or the starter
/dashboards                                      all dashboards (list)
/dashboards/:id                                  a dashboard
/dashboards/:id/widgets/new?type=map             Widget Creation for a new widget
/dashboards/:id/widgets/:widgetId                that widget fullscreen (deep-linkable)
/dashboards/:id/widgets/:widgetId/edit           Widget Creation editing an existing widget
/analysis                                        Analysis home (your Collections)
/analysis/collections/:id                        a Collection
/analysis/collections/:id/analyses/:analysisId   an analysis run on it
/shared/:token                                   a server-shared document (read-only + "Make a copy")
/import#<lz-compressed document>                 URL-fragment share → opens a copy (fork on open)
```

- **Back/forward navigates between places** (dashboards, fullscreen, Widget Creation,
  Analysis) — never between edits.
- **Ephemeral UI state stays out of the URL** (open accordions, in-progress map
  selection, calendar drag range).
- **Opening a document from another device:** for signed-in users, synced documents
  open on any device (the server keeps the client UUID). The "This dashboard is saved on
  another device" message, with a pointer to **Share**, appears only for anonymous users
  or documents that were never synced.
- **Embedding:** same routes, held in memory when the host owns the URL (see
  "Embedding").
- The v1 per-tab URL seeding is gone. Preferences hold the "last-opened dashboard" and
  Widget Creation defaults (through the platform adapter).

**Undo/redo (first release).** A **document-level undo/redo stack** (Ctrl+Z /
Ctrl+Shift+Z, plus menu actions via the shared action list), separate from browser
history. All edits to dashboards, Collections, and analyses go through a single
**`applyChange(doc, change)`** function producing a new document version plus an
inverse change — so undo is free by construction and edits are testable. Covers move,
resize, minimize/restore, add/delete/configure widget, rename, and Collection edits.
The stack is per document and per session (not persisted).

**Changes, unsynced edits, and tabs** (decided 2026-09-28):

- **A change is serializable JSON naming exactly what it touches**, e.g.
  `{ op: "moveWidget", target: { widgetId }, from, to }` or
  `{ op: "setField", target: { widgetId, path: "layers.0.entryType" }, value }`. Undo
  stores each change's inverse. Overlap detection for conflict handling compares
  `target`s.
- **Unsynced changes are persisted** in IndexedDB with the document: a queue plus the
  base version they build on. They survive reloads and crashes, and sync resumes on
  reopen.
- **Tabs in the same browser stay in step via `BroadcastChannel`.** A change in one tab is
  broadcast and applied in the others. Local saves are versioned too, and genuine
  same-target edits across tabs go through the **same replay-and-prompt logic** as server
  sync. Undo history stays per tab.

## Widget data selection (partial datasets)

Decided 2026-09-23 (IDEA.md Open Question #2).

**What gets staged is a query descriptor, not copied data.** This is the **single
definition** used by Collections, saved documents, and export manifests. A widget's
config is **one shared date range plus a list of layers** (see "Widget Creation view"),
and each layer resolves to one descriptor:

```ts
type QueryDescriptor = {
	dataset: string; // from the meta/datasets/ catalog
	entryType?: string; // pollutant/entry type where applicable
	dateRange: DateRangeSpec; // set / rolling / custom (see "Widget Creation view")
	timeSubRange?: { start: string; end: string }; // e.g. calendar day-range selection
	selection?: SpatialSelection; // omitted = whole layer
	resolution?: "auto" | Resolution; // default "auto"
};

type Resolution = "raw" | "hour" | "day" | "month" | "quarter" | "season" | "year";

type WidgetDataConfig = {
	dateRange?: DateRangeSpec; // absent for time: "now" | "none" widget types
	target?: PlaceRef; // monitor/region/location for "now" widgets
	layers: Array<Omit<QueryDescriptor, "dateRange" | "timeSubRange">>; // ≤ 1 pollutant layer
};

type PlaceRef =
	| { kind: "monitor"; id: string }
	| { kind: "region"; id: string }
	| { kind: "point"; lat: number; lon: number; label?: string };
```

**Places** (decided 2026-09-28). The shared place picker produces all three `PlaceRef`
kinds. Server support:

- **Existing** (already wrapped by the SDK): `regions/places/search/?q=&type=`
  (`searchRegionPlaces`) for name search in the picker; `regions/places/lookup/?q=&type=`
  (`lookupRegionPlace`) to resolve a name to the best region; `regions/?within=` for a
  parent region's children.
- **Missing: lookup by coordinates or monitor.** Needed for "Use my location" and for
  mapping a monitor to its ZIP (CalHeatScore) or forecast zone. **Extend
  `regions/places/lookup/`** (no new endpoint) to accept rounded coordinates (`lat`/`lon` in a **POST body**; see "Location
  privacy") or `?monitor=`,
  plus `type=`. **Response shape:** in coordinate or monitor mode it always returns a
  **list** of containing regions (only the given `type` when `type=` is set). The existing
  name mode keeps its current single-region response. It uses the same geometry rules as `within=`, and builds on the
  existing `Monitor.regions()` query. The SDK wrapper gains the parameters. This is
  Release 1 step 3 work.
- **What a point shows for air quality** (decided 2026-09-28): the **smallest containing
  region with summaries for the pollutant**, tried in the order ZIP → city → county via the
  coordinate lookup. Region averages use the server's monitor weighting, so they're
  steadier than a single nearest sensor. The widget labels the source (e.g. "PM2.5 for ZIP
  93721 (your location)"). The point itself is kept for display and for the other lookups
  (ZIP for heat, forecast zone for the Forecast strip). The region is resolved when the
  widget renders. **"Mark for analysis" freezes it** to the region actually used, staged as
  a normal region item ("ZIP 93721 (from your location)").
- **Location privacy** (decided 2026-09-28). Exact coordinates are often a home or school,
  and the audience includes students.
  - **The owner's own document keeps the exact point**, private to their browser or
    account.
  - **Server lookups always send a rounded point** (3 decimals, about 100 m; enough for
    ZIP, zone, and region), in a **POST body** rather than URL parameters, so router logs
    never see coordinates. **The server scrubs `lat`/`lon`** from Sentry, Scout, and
    application logs.
  - **Sharing, copying, and exporting default to the resolved region** (e.g. "ZIP 93721"),
    with a notice: "Your location is shared as ZIP 93721, not your exact position." The
    notice offers an explicit **"Share my exact location instead"** option, off by
    default and chosen per share, with a warning that anyone with the link will see it.
- **Geolocation** is a platform-adapter capability: an opt-in "Use my location" button,
  never automatic, with the browser's usual permission prompt. Tauri can supply its own.

"Mark for analysis" on a multi-layer widget adds **one Collection item per layer**, each
with the widget's date range and any current time sub-range or selection.

"Whole widget" is simply the no-selection case,
so partial and all-or-nothing selection are the same mechanism. Descriptors are cheap
to stage, shareable, and reproducible. (These are the items held in analysis
Collections — see "Analysis: Collections & engine".)

**Map widgets select spatially only.** Time is fixed per widget by its single date
range. Narrowing _when_ is done with a calendar or chart widget's **own** time selection
(for staging its data), not a map time scrubber and not by filtering other widgets.

One selection model, three ways to produce it:

```ts
type SpatialSelection = {
	kind: "monitors" | "regions";
	ids: string[];
	source?: GeoJSON.Geometry; // present when produced by a drawn shape
};
```

- **A. Feature picking** — click a monitor/region to select, shift-click to add;
  selection shows as removable chips in the widget title bar; right-click a feature
  for feature-scoped context-menu entries ("Analyze this monitor").
- **B. Region picking**: uses the **shared place picker** (decided 2026-09-28), a non-map
  component built in **Release 1 step 4** that picks monitors, regions (any type in the
  hierarchy), or points (`PlaceRef`), with search, hierarchy browsing, and single or multiple
  selection, built on the region-hierarchy metadata. It's reused by Widget Creation's
  accordions, the "now" widgets, Collections item editing, the Map widget (the same
  picker, with the selection also shown on the map; selections sync both ways), and
  Release 2's alert-rule targets. Step 5 adds only map-specific method A (clicking
  features). The v1 multi-region selector's narrowing rules and
  boundary-loading behavior are captured in `docs/reference/v1-lessons.md`, not reused
  as code. Preferred basis for analysis: regions are stable, meaningful
  units the server already aggregates (`RegionSummary`) and are the natural
  crosswalk to other geographies (health, pesticide data).
- **C. Drawn shapes** — box, lasso, radius-from-point, via `terra-draw` (MIT). The
  shape is **resolved to IDs at selection time**: monitors inside the shape are
  included; regions are included only if their centroid falls inside. The raw
  geometry is kept in `source` so it can be redisplayed and re-resolved later (e.g.
  when new monitors come online). Users can prune the resulting chips.

Build order: A and B first (both share one selection state); C
later. Drawing tools belong in `@sjvair/map-sdk` as an **opt-in plugin, off by
default**, so sjvair.com's map and the mobile app are unaffected (see Open Question #3).

## Map SDK: `@sjvair/map-sdk` + monitor-map rebuilt on it

Decided 2026-09-23 (IDEA.md Open Question #3), **restructured 2026-09-24**. IDEA.md calls
it the "map sdk (formerly 'monitor-map')". The map toolkit is **split into two
packages** instead of doing an in-place 4.0 rewrite:

| Package                                                   | Contains                                                                                                                                                                                                                                             | Used by                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **`@sjvair/map-sdk`** (new repo; pre-1.0 until validated) | Per-map core (`createMap`/`MapContext`), the plugin interface and every data-type plugin, `MapView`, **app-level data stores** (e.g. `createMonitorsStore()`), the `terra-draw` drawing plugin (later), injected config. No routing, no page layouts | This dashboard; `monitor-map`; v3-mobile (directly for stores, and through monitor-map) |
| **`@sjvair/monitor-map`** (existing repo)                 | The SJVAir monitor-map _experience_: `MapShell`/`MonitorMapLayout`, routes and detail panels, legends, load screen, and the standalone build sjvair.com imports. **Rebuilt on `map-sdk`** (its next major version)                                   | sjvair.com (standalone build); v3-mobile (as a library)                                 |

Why: the dashboard depends only on the library (no layouts or routing it has to work
around); monitor-map becomes a real consumer of the plugin API, which keeps it honest;
clear ownership (general map capabilities → `map-sdk`, monitor-map product decisions →
`monitor-map`). Cost: changes that span both need a `map-sdk` release, then a bump in
monitor-map (local linking for development; each publish needs explicit approval).

**The core problem being solved is still "one map per page"**, not a lack of
configurability. As of monitor-map 3.6.x: `mapManager` (one `map`), `integrationsManager`,
and `clickManager` are module-level singletons; integrations are exported singleton
instances (`export const monitorsMapIntegration = new MonitorsMapIntegration()`) that
talk to `mapManager.map`; `MaptilerConfig.apiKey` is set from `import.meta.env` at
import time. v3-mobile also uses `monitorsManager` as an **app-wide data store outside
any map** (`main.ts`, its Subscriptions/Alerts screens, `MonitorSubscription`).

`map-sdk` design:

- **Per-map instance.** `createMap(options)` returns a `MapContext` (own map, plugin
  registry, click manager, tooltips), provided to descendants via Svelte context.
  Nothing module-global.
- **Plugins are factories.** e.g. `monitorsPlugin({ dataSource, entryType })`,
  evolving the existing `MapLayerIntegration`/`MapGeoJSONIntegration`/
  `MapIconLayerIntegration` classes:

  ```ts
  interface MapPlugin {
  	id: string;
  	setup(ctx: MapContext): () => void; // add sources/layers; returns teardown
  	legend?: Snippet;
  	displayOptions?: Snippet; // UI slots the host shell renders
  	contextMenu?(target: unknown): MenuItem[]; // hooks into context-menu registry (Q5)
  	toSelection?(features: MapGeoJSONFeature[]): SpatialSelection; // Q2 selection model
  }
  ```

- **One plugin per data type, each taking a data-source interface** (generalizing
  what `MonitorsDataSource` already does): monitors, region fill/choropleth, HMS
  smoke, HMS fire, collocation, EV stations, wind, weather, and **later** the `terra-draw`
  drawing plugin (Q2, opt-in; see `DEFERRED.md`). Plugins for the remaining server datasets — pesticide
  use/notices, CalEnviroScreen tracts, CalHeatScore ZIPs, forecast zones, CEIDARS
  facilities, TEMPO rasters — are deferred (see `DEFERRED.md` → "Map plugins"), but
  the plugin interface must accommodate points, polygons, choropleths, and rasters so
  they're additive. The same renderer serves live data
  (sjvair.com, mobile) and historical/date-ranged data (this dashboard). New data
  types become new plugins, not edits to a monolith.
- **Data is separate from maps.** App-level stores (e.g. `createMonitorsStore()`) are
  created explicitly by the host, passed to plugins as data sources, and shareable across
  the host's screens. This replaces the `monitorsManager` singleton for v3-mobile.
- **`MapView`** (no routing, no load screen) is the embeddable map, and what dashboard
  widgets use. **`MapShell`** (full-page layout, routed detail panel, router escape
  hatch) moves to monitor-map, built on `MapView`.
- **Config is injected**, not read from `import.meta.env` at import (MapTiler key etc.).
- **Host-provided metadata, messages, and formatting** (decided 2026-09-28). `createMap`
  accepts three **optional providers**:

  ```ts
  createMap({
  	config: { maptilerKey },
  	metadata?: MetadataProvider, // levels, colors, units, labels from the host's cache
  	messages?: MessageProvider, // UI strings for legends/tooltips (key → text)
  	format?: FormatProvider // numbers, dates, times (Pacific)
  });
  ```

  - **The dashboard passes all three** (its metadata cache, its Paraglide messages, and its
    `format` module), so maps follow the metadata, i18n, and Pacific-time rules with a
    single metadata cache.
  - **monitor-map and v3-mobile pass nothing.** The defaults: `map-sdk` fetches metadata
    itself, uses built-in English strings, and formats in Pacific time. Behavior is
    unchanged.
  - `map-sdk`'s strings are defined as **message keys with English defaults**, so it's
    translation-ready.

- **WebGL context budget.** Browsers cap live WebGL contexts per page (~8–16); each
  map is one. Minimized/off-screen map widgets must tear down their map and rebuild on
  restore (affects dashboard layout, Q4).

**Rollout (resolves the "4.0 on an unpinned `main`" risk):** `map-sdk` starts as a
new package, so nothing picks it up by accident. monitor-map migrates onto it **on a
branch**; its `main`, which sjvair.com's import script builds unpinned, changes only once
the standalone app is migrated and verified, and that merge needs explicit approval.
v3-mobile (depending on `^3.x`) keeps working unchanged until it migrates. Each step
needs an approved plan in its repo:

1. `map-sdk` (new repo; pre-1.0, then 1.0 once steps 2 and 3 validate it)
2. monitor-map rebuilt on `map-sdk` (its next major)
3. this dashboard's Map widget on `map-sdk`
4. v3-mobile migrated (stores from `map-sdk`, layout from the new monitor-map)

**Dependencies** (decided 2026-09-28): the dashboard's critical path is only 1 → 3.
monitor-map's rebuild (2) runs **in parallel, started alongside 3**. Both build against
pre-1.0 `map-sdk`, and **1.0 is cut once both have validated the API**. v3-mobile (4) is a **separate later track** that
blocks neither Release 1 nor go-live; it keeps working on monitor-map 3.x until then.

## Dashboard layout mechanics

Decided 2026-09-23 (IDEA.md Open Question #4).

- **Snapping grid, no overlap.** Widgets snap to grid cells when dragged/resized; other
  widgets move out of the way (collision + upward compaction/"gravity"). No free-form
  overlapping windows. The desktop-windowing feel comes from the chrome — title bar,
  minimize, fullscreen, taskbar — not from overlap.
- **Pure layout engine, CSS Grid rendering.** Collision/compaction/placement are pure
  TypeScript functions, unit-tested like `url-state.ts`. Widgets render via CSS Grid
  `grid-column`/`grid-row`; drag by the title bar, **resize via edge/corner hover
  handles** (resize cursors), all via pointer events. Chosen over `gridstack.js`,
  which owns DOM positioning and fights Svelte's rendering; the core algorithm is
  small enough to own.
- **Fullscreen** overlays the dashboard area (not the browser window), animated from
  the widget's grid rect (FLIP-style); the underlying grid layout is untouched.
- **Minimize** moves the widget to the bottom taskbar (horizontally scrolling when
  overloaded) and the grid compacts. Restore returns it to its previous rect if free,
  else the nearest free slot. Minimized/off-screen map widgets release their WebGL
  context (see "Map SDK").
- **Vertical growth/scrolling.** The dashboard grows downward as widgets are added —
  not horizontally. Reasons: mouse wheels scroll vertically (shift+wheel is obscure,
  school machines mostly use mice); the taskbar is already a horizontal scroller;
  phones stack vertically; every familiar dashboard product scrolls down. To avoid
  wheel conflicts, map widgets use MapLibre's `cooperativeGestures` (ctrl/⌘+scroll
  zooms the map; plain scroll scrolls the page). "Too crowded" is answered by
  **multiple saved dashboards**, not a bigger canvas.
- **Responsive.** 12 columns on desktop, fewer on tablet; on phones, a single-column
  stack auto-derived from the desktop layout's reading order. Only the desktop layout
  is persisted in a saved dashboard config.

## Widget catalog

Decided 2026-09-23 (IDEA.md Open Question #8). All charts use uPlot. "SDK+" = needs a new
`@sjvair/sdk` wrapper for an existing server endpoint.

**First widget set** (Release 1, except the Alerts feed, which ships with Release 2):

| Widget                    | What it shows                                                                                          | Notes                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Map                       | `map-sdk` `MapView` + plugins; spatial selection (feature/region, later drawn)                         | See "Map SDK"                |
| Calendar — day-colored    | Each day colored by its average; day-range selection                                                   | Replaces the v1 calendar     |
| Calendar — contribution   | GitHub-style grid with adjustable range (≥ 1 week); day-range selection                                |                              |
| Chart                     | uPlot time series: at most one pollutant plus any non-pollutant layers, over the widget's date range   |                              |
| Current conditions tile   | Big current value, level color, trend arrow, "updated N min ago", level guidance from `monitors/meta/` | Monitor or region            |
| "Can we go outside?" card | Plain-language outdoor-activity recommendation from current level + guidance + today's CalHeatScore    | Schools; SDK+ (CalHeatScore) |
| Forecast strip            | Next days' AQI category + burn-day status                                                              | SDK+ (forecasts)             |
| Alerts feed               | Recently fired alerts from the user's alert inbox (pollutant, forecast, pesticide-notice rules)        | Requires login               |
| Data table                | Sortable table + CSV export; the accessibility fallback for maps/charts                                |                              |
| Notes                     | Markdown text for annotating shared dashboards                                                         | No data source               |
| Hour × weekday heatmap    | Diurnal/weekly pattern (widget form of starter analysis #2)                                            |                              |

The remaining brainstormed widgets are tracked in `DEFERRED.md` → "Widgets".

**Widgets are independent in Release 1** (decided 2026-09-28). Each widget has its own data,
date range, and selection; one widget doesn't drive another (no cross-filtering). Putting
several widgets on the same place is done with the shared place picker and "Duplicate
widget". Linking is deferred (see `DEFERRED.md`).

### Widget-type contract

Each widget type declares what Widget Creation shows and how the dashboard treats it:

```ts
type WidgetType = {
	type: string;
	label: MessageKey; // i18n: message key, never literal English
	minSize: { w: number; h: number }; // grid cells
	time: "range" | "now" | "none"; // the date section is shown only for "range"
	accepts: DatasetFilter; // which accordions/layers apply (enforces ≤ 1 pollutant)
	target?: "place"; // needs a monitor/region/location instead of layers
	thresholds: boolean; // supports self-monitoring thresholds
	analyzable: boolean; // offers Mark for analysis / Analyze
	resolution?: Resolution; // pinned resolution (e.g. calendars "day", heatmap "hour"); hides the override
	defaultTitle(config: WidgetDataConfig, meta: Metadata): string; // generated, not stored
	menu: MenuProvider; // widget-scoped actions (see "Actions & context menu")
	component: Component;
};
```

Examples: **Notes** is `time: "none"` with no layers. **Current conditions**, **Forecast
strip**, and **"Can we go outside?"** are `time: "now"` with `target: "place"`; for those,
Widget Creation hides the date section and shows **the shared place picker** instead of
the dataset accordions, plus a **separate pollutant control** for Current conditions and
"Can we go outside?" (gated by available pollutants); in `WidgetDataConfig` that's a single
pollutant layer alongside `target`. **Map** and **Chart** are `time: "range"` and accept multiple layers.

**Analysis actions on widgets without a date range** (decided 2026-09-24). IDEA.md asks
for "Mark for analysis" / "Analyze" on all widgets, but a Collection item needs a date
range:

- **Notes:** `analyzable: false`. It has no data, so the menu doesn't offer these actions.
- **Current conditions, "Can we go outside?":** stage their place and pollutant with a
  **default trailing window of the last 3 days (Pacific time)**, the "what led up to now"
  question. The Collection item shows that range, and the user can adjust it in the
  Collections drawer.
- **Forecast strip:** stages the forecast zone over the same 3-day trailing window where
  past forecasts exist; otherwise `analyzable: false`.
- **Alerts feed** (Release 2): `analyzable: false`. It lists fired alerts; the data behind
  an alert is reachable from its monitor or region.

## Actions & context menu

Decided 2026-09-23 (IDEA.md Open Question #5). **The right-click menu is one view onto
a shared, scoped action list.** The same actions also populate each widget's title-bar
"⋯" menu, and later a Ctrl+K command palette and keyboard shortcuts — so every action
is reachable without right-clicking (discoverability, keyboard users, accessibility).

```ts
type MenuItem = {
	id: string;
	label: string;
	icon?: Component;
	shortcut?: string;
	group: string; // rendered as separated sections
	disabled?: boolean;
	children?: MenuItem[]; // nesting / submenus
	run(ctx: MenuContext): void;
};
type MenuContext = { event?: Event; target: Element; payload: Record<string, unknown> };
type MenuProvider = (ctx: MenuContext) => MenuItem[];
```

- **Scopes register providers** via a `menuScope(provider)` Svelte attachment, stored
  in a `WeakMap<Element, MenuProvider>` and removed on teardown (no leaks).
- **Resolution walks DOM ancestry** from the event target (`parentElement` chain,
  O(depth)), calling each scope's provider.
- **Scopes enrich the payload before resolution.** Canvas-based widgets can't be
  resolved by DOM ancestry alone: a map widget resolves the feature under the cursor
  (`queryRenderedFeatures`) and adds `{ feature }`; the calendar adds
  `{ selectedRange }`; a uPlot chart adds `{ point }`. That's how "Analyze this monitor"
  or "Analyze selected days" appear only when meaningful. Map plugins contribute
  feature-scoped items through `MapPlugin.contextMenu` (see "Map SDK").
- **Merge order: most specific first** — feature → widget → dashboard → global,
  grouped with separators. An inner item with the same `id` overrides the outer one.
- **Rendered with bits-ui's `ContextMenu`** (shadcn-svelte `context-menu`): one
  trigger around the dashboard, items computed on open. Provides submenus, keyboard
  navigation, ARIA roles, and viewport collision handling. Opens via right-click,
  long-press (touch), and Shift+F10 / Menu key (focused element).
- **Baseline actions** (Release 1; IDEA.md's examples plus decided features):
  - _Global:_ Undo / Redo, "Clear my data", Sign in / out.
  - _Dashboard (blank space):_ **Add widget**, **Save as copy…**, **Export…**, Share…,
    New / Duplicate / Rename / Delete dashboard.
  - _Widget:_ **Refresh** (a manual refetch, alongside automatic live refresh), Edit
    (opens Widget Creation), Rename, **Duplicate**, Minimize, Fullscreen, Move… / Resize… (keyboard
    alternatives), Delete, **Mark for analysis**, **Analyze**, Add to collection ▸.
  - _Selection (map features/regions, calendar range):_ Mark selected data for
    analysis, Analyze selected data.
  - _Map feature:_ e.g. "Analyze this monitor", contributed by map plugins.
- **Reuse:** the widget "⋯" menu calls the same resolution with that widget as target;
  the future command palette queries global + focused-scope actions.

Prior art reviewed: `monitor-inventory-tracker`'s `ContextMenu.svelte`. Kept its core
idea (attachment-registered, ancestry-scoped contributions); dropped Snippet-based
items (not mergeable/testable/reusable), missing cleanup, module-global state,
hand-rolled positioning, and the debounce workaround.

## Analysis: Collections & engine

Decided 2026-09-23 (IDEA.md Open Question #6, staging + engine parts). Data available
to analyze is catalogued in `docs/reference/server-data-inventory.md`.

### Terminology

- **Collection** — a named set of staged **data inputs** (query descriptors). "Mark for
  analysis" adds to a Collection. Collections hold data references, never analyses.
  (Earlier drafts called this the "pool"; use _Collection_ in UI and code.)
- **Analysis** — a saved **recipe** (`AnalysisSpec`) that runs over items from a
  Collection. One Collection can feed many analyses; one analysis can run against
  different Collections.

### Collections

```ts
type CollectionItem = {
	id: string;
	descriptor: QueryDescriptor; // dataset, entry_type, date range, SpatialSelection, optional time sub-range
	label: string;
	origin?: { dashboardId: string; widgetId: string }; // provenance only
	addedAt: string;
};
type Collection = { id: string; name: string; items: CollectionItem[] };
```

- **Multiple named Collections, independent of dashboards.** Analysis routinely spans
  dashboards, and because items are descriptors (not live widget references), a
  Collection survives its source widget/dashboard being edited or deleted.
- **Provenance, not ownership:** `origin` lets the Collection drawer show "from
  _Dashboard → Widget_" and offer "jump back" while that widget exists; if it's gone,
  the item still works.
- **Targeting:** one Collection is **active** (shown in the nav badge, e.g.
  "Analysis · Smoke study · 3"). Each dashboard may set a **default target
  Collection**. "Mark for analysis" adds to the dashboard's default, else the active
  one; the **Add to collection ▸** submenu (existing Collections + "New collection…")
  targets explicitly; "Analyze" adds and navigates to the Analysis view.
- **Rolling ranges** (decided 2026-09-25):
  - **Dashboards keep rolling ranges rolling** (month-to-date moves forward daily; shared
    dashboards stay live).
  - **"Mark for analysis" freezes the range** into fixed Pacific dates when staged, shown
    on the item (e.g. "Sep 1 – Sep 25, 2026 (was: month-to-date)"), so analyses stay
    reproducible. The same applies to the "now" widgets' 3-day window.
  - A **"keep rolling" toggle per Collection item** allows deliberately rolling inputs
    (e.g. a weekly rerun on "the last 30 days"). Analyses and exports show the resolved
    dates they used.
  - **Notebook exports always record fixed dates** in `collection.json`.
- **Lazy data:** staging stores only the descriptor. Data is fetched when an analysis
  runs, through the data layer's cache keyed by descriptor (reusing what widgets
  already fetched).
- Persisted via the platform adapter (IndexedDB on web).
- **Ships in Release 1** (decided 2026-09-24), ahead of the analysis engine: the store,
  the drawer, "Mark for analysis" / "Analyze" / "Add to collection ▸" on every `analyzable` widget,
  and a placeholder Analysis view listing a Collection's items with "starter analyses
  coming soon" until Release 3. That way IDEA.md's shared widget behavior is complete
  from the first release.

### Engine: generic core, curated starters as specs

A generic date-aligned comparison engine, seeded with curated starter analyses —
where **a starter is just a saved `AnalysisSpec`**, identical in format to a
user-defined one:

```ts
type AnalysisSpec = {
	inputs: Record<string, { role: string; accepts: DescriptorFilter }>; // bound to Collection items
	steps: Step[]; // resample → align → lag → aggregate → correlate …
	views: ViewSpec[]; // uPlot charts, tables, stat tiles
	notes?: string; // caveats shown with results
};
```

- **User-defined analyses** = editing a starter or composing from scratch. Applying a
  spec to a Collection prompts the user to bind items to its input roles.
- **Save/share** uses the same JSON-document mechanism as dashboards and Collections.
- **Known cross-dataset pitfalls are first-class steps**, not per-analysis hacks:
  resolution mismatch → explicit resample step with a stated aggregation; geography
  mismatch → region crosswalk (regions from "Widget data selection"); lag effects →
  lag step with a slider; spurious correlation → confidence intervals and a
  "correlation ≠ causation" note shown by default.
- **Compute:** plain TypeScript over typed arrays (uPlot's native format) in a Web
  Worker. Heavier WASM engines (e.g. DuckDB-WASM) deferred until researcher-scale
  datasets demand them; Tauri's native storage is the other lever there.

### Health data scope

Decided 2026-09-23: **CalEnviroScreen only** (static tract-level indicators, e.g. asthma
/ CVD / low-birth-weight percentiles, SB535 DAC). The server holds no ER, hospitalization,
or incidence data; importing outside health data (HCAI ED visits, CDC PLACES) and the
"smoke → ER visits" lag analysis are deferred — see `DEFERRED.md`.

### Starter analyses

Confirmed 2026-09-23: **all 10 ship as starters.** #7 and #8 depend on new `@sjvair/sdk`
wrappers (CalEnviroScreen, CalHeatScore) — a sdk-js change needing its own approved plan.

"SDK+" = the server serves the data but `@sjvair/sdk` must wrap the endpoint first.

| #   | Analysis                                                                       | Data                         | Audience            | Status                        |
| --- | ------------------------------------------------------------------------------ | ---------------------------- | ------------------- | ----------------------------- |
| 1   | Bad-air days: days per AQ level by region, month/season/year, year-over-year   | Region summaries             | Everyone            | Ready                         |
| 2   | When is air cleanest: hour-of-day × weekday heatmap                            | Hourly summaries             | Schools, community  | Ready                         |
| 3   | Smoke days vs PM2.5: share of PM2.5 excess on HMS smoke days, by density       | HMS smoke + region summaries | Everyone            | Ready                         |
| 4   | Fire → air-quality lag: daily FRP near region vs PM2.5, 0–7 day lag slider     | HMS fire + summaries         | Research            | Ready                         |
| 5   | Weather drivers: PM2.5/O₃ vs CIMIS temperature, wind, humidity                 | Entries + CIMIS              | Research, science   | Ready (nearest-station match) |
| 6   | Long-term trend: monthly/yearly means, Theil–Sen slope + Mann–Kendall          | Summaries                    | Research, community | Ready                         |
| 7   | Environmental-justice lens: tract PM2.5 vs CalEnviroScreen indicators          | Tract region summaries + CES | Research, advocates | SDK+ (CES); monitored tracts  |
| 8   | Heat + AQ compound days: CalHeatScore and PM2.5/O₃ both elevated               | CalHeatScore + summaries     | Schools             | SDK+                          |
| 9   | Pesticide use trends: lbs by chemical/commodity/region, category filters       | PUR region summaries         | Community, research | Ready (yearly only)           |
| 10  | Low-cost sensor vs reference: scatter, bias, R² over time for collocated pairs | Collocation + entries        | Research / QA       | Ready                         |

## Notebooks

Decided 2026-09-23 (IDEA.md Open Question #6, Jupyter part). Research:
`docs/reference/jupyterlite-kernels.md`. Licensing is not a blocker (JupyterLite/
JupyterLab BSD-3, Pyodide MPL-2.0 used unmodified — ship license notices).

Notebooks are a **separate power-user path that shares the data layer, not the engine**:
Collections/descriptors are shared; the TypeScript engine and uPlot views are not.

### Export to notebook (all languages)

An "Export to notebook" action on a Collection or analysis downloads a `.zip` bundle:

- `analysis.ipynb` (Python), `analysis-r.ipynb` (R), `analysis-ts.ipynb` (Deno /
  TypeScript) — data-loading cell + the analysis steps written out where practical.
  Generation priority: Python → R → Deno/TS.
- Data as **Parquet + CSV**, and a `collection.json` manifest (descriptors, units, AQ
  levels) so any kernel can load it and live data can be re-fetched.
- A short README: open in JupyterLab, RStudio, Deno's Jupyter kernel, or Google Colab.

This is **language-neutral**: loading needs no SJVAir-specific helper (a helper
package is an optional convenience). Deno's built-in Jupyter kernel gives JS/TS users
real TypeScript and can import `@sjvair/sdk` straight from JSR.

A web page cannot launch a local JupyterLab; that true "Open locally" (write bundle to
a folder, launch `jupyter lab` if installed) is a **Tauri** capability — see `DEFERRED.md`.

### Embedded JupyterLite (Python only)

So schools and community users can write code with **no install** (incl. Chromebooks):

- **Kernel: Pyodide** (`jupyterlite-pyodide-kernel`) — real CPython 3.14 with pandas,
  numpy, scipy, statsmodels, scikit-learn, matplotlib, pyarrow; seaborn/plotly bundled as
  wheels. **Python only**; in-browser R and JavaScript are deferred (see `DEFERRED.md`).
- **Fully bundled for offline**: self-hosted Pyodide, custom `pyodide-lock`, piplite
  wheels, `disablePyPIFallback: true`. Kernel and Pyodide versions upgraded in lockstep.
- **A separate static app** at its own path (`/notebooks/`, see "Deployment"), not inside dashboard pages
  (tens of MB). It is the **only** place cross-origin isolation (COOP/COEP) may be
  enabled, per "Platform strategy"; it also works without isolation (service-worker
  file access).
- **Opens the same export bundle** — "Open in browser notebook" loads the bundle's
  notebook + data into JupyterLite, so there is one bundle format for both paths.
- Known limits to document for users: no threads/multiprocessing, ~2–4 GB memory,
  no installing unbundled packages offline, slower pure-Python code.
- **Timing:** after Collections and the starter analyses exist.

## Saving & sharing documents

Decided 2026-09-23 (IDEA.md Open Question #6, save/share part).

**Dashboards, Collections, and analyses are all "documents"** sharing one mechanism:

```ts
type SavedDocument<K extends "dashboard" | "collection" | "analysis"> = {
	kind: K;
	schemaVersion: number;
	id: string;
	name: string;
	body: DocumentBody<K>;
};
```

- **Versioned from day one.** Every document carries `schemaVersion`; a pure, tested
  migration chain upgrades old documents on load. Shared links live for years.
- **Version skew between app and documents** (decided 2026-09-28):
  1. **Newer documents open read-only in older apps.** If `schemaVersion` is higher than
     the app knows, the document opens **read-only** with "This dashboard was saved by a
     newer version. Reload to edit." It is never overwritten.
  2. **Queued changes record the `schemaVersion` they were written against.** They are
     synced or replayed **before** a document is migrated, and never applied blindly
     across a format change.
  3. **The server refuses downgrades:** a save whose `schemaVersion` is lower than the
     stored one is rejected.
  4. **New deploys are detected.** The build emits `version.json`. The app checks it on tab
     focus and hourly, and shows "A new version is available. Reload" when it changes.
     Code-file (chunk) load failures show the same prompt instead of an error.
- **References, not data.** Documents store query descriptors, never fetched data, so
  they stay small and a recipient sees the same _query_ run against current data.

**Storage (decided 2026-09-24: both layers ship in Release 1):**

1. **Local + files.** Documents persist through the platform adapter
   (IndexedDB on web, filesystem/SQLite under Tauri). Share by **Export/Import `.json`**,
   or for small documents a **link with the document lz-string-compressed into the URL
   fragment** (fragment → never sent to a server). If the encoded link exceeds a safe
   length, the UI falls back to file export.
2. **Server-backed, for signed-in users** (a parallel sjvair.com track in Release 1;
   needs an approved plan). A `SavedDocument` model (`id` (the client UUID), `owner,
kind, name, body, version, visibility: private | link | public, schemaVersion,
share_token` (revocable), `copied_from` (source document id, if a copy), `deleted_at`
   (soft delete)) plus endpoints. Gives
   short links, live share links, cross-device access to documents, protection from
   browser storage eviction, and later
   SJVAir-curated public templates (see `DEFERRED.md`).
   - **Local-first sync, kept simple** (refined 2026-09-25): documents always save
     locally first. For signed-in users the server copy is authoritative. Each save says
     "based on version N"; the server accepts it only if it's still at N, otherwise it
     reports a conflict (the same document edited on two devices, in two tabs, or
     offline).
   - **Automatic replay:** on a conflict the client replays its own `applyChange`
     operations on top of the newer server version, so edits that touch different
     widgets or fields merge silently.
   - **Prompt only on true overlaps** (both sides changed the same widget or field):
     "Keep mine / Use the other version / Save mine as a copy".
   - No real-time co-editing and no CRDT (e.g. Automerge). Research and school
     workflows are solo work with handoffs, and sharing goes through read-only links,
     copies, and notebook export. Multiple editors and real-time co-editing are
     deferred (see `DEFERRED.md`).
   - **Document identity and sharing** (decided 2026-09-25):
     - The client generates a UUID, and the server **keeps the same id** on upload, so
       `/explore/dashboards/:id` works on any signed-in device.
     - Share links use a **separate, revocable token** (`/explore/shared/:token`), not
       the document id. They open a read-only view with "Make a copy".
     - **`link` documents can be opened by anyone with the link, no account needed**
       (teacher → class). A copy saves locally for anonymous users, or to their account
       if signed in.
     - **`public`** is reserved (it behaves like `link`) until curated templates ship.
       There is no public listing or search in Release 1.
     - **The server stores `body` without interpreting it** (JSON, size-limited, e.g.
       1 MB). The server's database table is a normal Django model and migration in
       sjvair.com. The document format inside `body` is defined in this repo's
       TypeScript and upgraded by client-side `schemaVersion` functions on load. The
       trade-off: the server can't query inside documents; specific fields can be
       promoted to real columns later if needed.
   - **Local → account migration:** the first sign-in offers to upload the local
     documents.
   - **Deletion** (decided 2026-09-28):
     - **Delete is synced and recoverable:** a local deleted marker plus a server soft
       delete (`deleted_at`), **purged after about 30 days**. The undo toast restores
       immediately, and a **"Recently deleted"** list in the picker restores within 30
       days. Anonymous users get the same local "Recently deleted" behavior.
     - **Edits to a deleted document** prompt: "This dashboard was deleted on another
       device. Restore it, or discard your changes?"
     - **Share links to deleted documents** show "This shared dashboard is no longer
       available". Restoring brings the link back.
     - **"Remove from this device"** stays a separate, local-only action (like sign-out
       "remove" and "Clear my data").
   - **Ownership and provenance** (decided 2026-09-28):
     - **A single `owner`** per document. **Only the owner can delete.** Future editors
       (deferred) would live in a **separate access table** (document, user, role), so
       adding them is additive; an editor's "delete" would only remove their own access.
     - **`copied_from`** records the source document when a copy is made (from a share
       link, the starter, or another dashboard). It stores only the id; the source's name
       and author are shown ("Based on …") only if that document still exists and is
       visible.
     - **Shared pages show no personal information by default.** An owner may set an
       optional public **display name** (e.g. "Ms. Lopez's class") shown on their shared
       documents and in "Based on …" credits.
   - **Sync scope and sign-out** (decided 2026-09-25):
     - **Every document syncs once signed in**; there's no per-document sync toggle.
     - **Sign-out asks "Keep your dashboards on this device, or remove them?"**, with
       _remove_ as the default (safe, since server copies remain; protects shared
       computers).
     - **Preferences** (last-opened dashboard, active Collection) **stay local per device**
       in Release 1. Server-synced preferences are deferred.
     - **"Clear my data" only clears this browser**, never server copies. Deleting server
       documents is a separate, explicit action (delete a document, or delete the
       account).

**Saving model (decided 2026-09-24): autosave.** Every `applyChange` persists immediately
(debounced about 500 ms), with a small "Saved" indicator; undo covers mistakes. There is
no explicit Save. IDEA.md's example "Save Dashboard" menu action becomes **"Save as
copy…"** and **"Export…"**. The dashboard picker offers new (blank or from the starter
dashboard), duplicate, rename, and delete (with an undo toast).

**Local durability safeguards** (these matter most for anonymous users, whose documents
stay local):

- Request persistent storage (`navigator.storage.persist()`) on the first document
  create or edit.
- Show a quiet status ("Dashboards are stored in this browser") with a note when
  protection isn't granted. Safari always falls in this case: it evicts script-written
  storage after 7 days without a visit unless the site is installed to the home screen.
- When documents aren't protected, show a **backup nudge** after meaningful edits
  ("Download a backup", the `.json` export), plus a gentle "sign in to keep this safe
  everywhere".
- Surface quota and write errors clearly; keep the in-memory copy so nothing is lost
  silently.

**Share semantics:**

- **File / URL share → copy (fork on open).** Opening creates the recipient's own
  independent document.
- **Server share → live link.** Recipients see the owner's current version read-only,
  with **"Make a copy"** to edit their own. Fits teacher → class and SJVAir → public.

## Internationalization: English-only, translation-ready

Decided 2026-09-24. **Ship in English only**; no translations exist and there is no
timeline for them. But build so adding a language is _adding message files_, not a
retrofit. Context: sjvair.com declares `LANGUAGES` = en, es, tl (Filipino), hmn (Hmong)
and stores `User.language`, and server metadata strings are gettext-marked — but no
translation files exist and alerts ignore `User.language`. monitor-map and v3-mobile have
no i18n.

**Day-one practices (cheap now, expensive to retrofit):**

1. **All UI strings via Paraglide JS** (inlang; compiled message functions, works with
   plain Vite, type-checked, tree-shaken) with an **English-only** message file. No inline
   UI strings in components.
2. **No string-concatenated sentences.** One message with parameters (and plural
   variants) per sentence.
3. **One `format` module** for numbers, dates, durations, and units via `Intl`/`date-fns`
   with a locale parameter (always `en-US` for now). No ad-hoc formatting.
4. **Saved documents store meaning, not English.** Default widget titles are stored as
   auto (`title: null`) and generated at render from metadata; only user renames are
   stored as text.
5. **Built-in content uses message keys** — starter-analysis notes/caveats, widget-type
   names, action/menu labels. User-authored text (Notes widget, custom names) is stored
   verbatim.
6. **Alert text is rendered at send time** from the rule's data, never stored at rule
   creation — so `User.language` can apply later without a data migration.
7. **Server-sourced text stays server-sourced** (metadata rule), and the data layer has a
   single place that sends a language (`Accept-Language`), currently always `en`.
8. **Layouts tolerate longer text** (Spanish ≈ 20–30% longer): no fixed-width text
   containers sized for English.

Deferred until translations exist (see `DEFERRED.md`): language picker, translation
files, server `.po` files, per-language metadata caching, alerts in `User.language`,
Hmong formatting fallback, monitor-map / v3-mobile i18n. RTL support is not needed for
the declared languages.

## Time zone & calendar conventions

Decided 2026-09-24. The server stores timestamps in UTC, but **all summary rollups are cut
at America/Los_Angeles boundaries** (`settings.DEFAULT_TIMEZONE`, used in
`summaries/tasks.py`). The dashboard matches that.

- **Pacific time (America/Los_Angeles) everywhere, whatever the viewer's zone.** This
  covers "today", calendar day cells, set ranges (day/week/month/year), rolling ranges,
  and the hour × weekday heatmap. It keeps day boundaries identical to the server's daily
  and monthly summaries.
- **Timestamps display in Pacific time.** A "PT" label appears only when the viewer's
  device is in a different zone.
- **All date calculations go through the `format` module** with a time-zone-aware helper
  (`@date-fns/tz`), never the browser's local zone. Daylight-saving days are handled
  correctly: 23- and 25-hour days, and a repeated or missing hour in hourly data.
- **Weeks start on Sunday** (US convention). This applies to set weeks, week-to-date, and
  the contribution calendar. It is a single constant in the `format` module, so a future
  locale can change it.

## Metadata as source of truth

Decided 2026-09-23 (IDEA.md Open Question #7). Audit basis:
`docs/reference/server-data-inventory.md`.

**Rule:** anything describing data — labels, units, level breakpoints, colors, scales,
resolutions, coverage, attribution — comes from server metadata endpoints. Never
hardcode it in this app, `map-sdk`, `monitor-map`, or `sdk-js`. When a value is missing, add it to
server metadata rather than hardcoding "for now".

**What a dataset is (decided 2026-09-24).** A catalog entry is a **broad data domain**, and
each one is one Widget Creation accordion:

```ts
type DatasetCatalogEntry = {
	id: string; // e.g. "air-quality", "weather", "hms-smoke", "hms-fire", "pesticide-use",
	//          "pesticide-notices", "forecasts", "calheatscore", "calenviroscreen"
	label: string;
	description: string;
	source: string;
	license: string; // attribution
	entryTypes: {
		id: string;
		label: string;
		kind: "pollutant" | "meteorological" | "other";
		units: string;
	}[];
	geographies: ("monitor" | "region" | "polygon" | "point" | "tract" | "zip" | "zone")[];
	resolutions: ("raw" | "hour" | "day" | "month" | "quarter" | "season" | "year")[];
	metaUrl: string; // the domain's own …/meta/ endpoint
};
```

- **Air quality is one dataset.** Its entry types are PM2.5, O3, … (`kind: "pollutant"`).
  Monitor vs. region is a **geography choice inside a layer**, not a separate dataset.
  "At most one pollutant per widget" means at most one layer whose entry type has
  `kind: "pollutant"`, and the available-pollutants list filters which pollutants
  appear.
- **Weather (CIMIS) is its own dataset**, even though the server stores it as monitor
  entries: to users it's a different thing, and it isn't a pollutant.
- **Where "no code changes" ends:** new entry types, levels, labels, or colors inside a
  known dataset need **metadata only** (e.g. enabling NO2). A **new domain** (e.g. TEMPO)
  needs a client **dataset adapter** (fetch and shape), plus a map plugin if it's shown on
  maps. The client keeps an adapter registry keyed by dataset id, and **catalog entries
  without an adapter are hidden**, so the server can list datasets before the dashboard
  supports them.
- **A layer with no selection** means "all features" on a map. Charts and calendars
  **require** a place or selection (a monitor or region). A **point** given to a range
  widget (e.g. from the starter's "Change place" bar) is resolved to its smallest
  containing region with data and stored as that region selection, labeled "(your
  location)".

**Structure: per-domain meta + a catalog index.**

- Each domain owns a `…/meta/` endpoint (existing: `monitors/meta/`, `regions/meta/`;
  new: `hms/meta/`, `pesticides/meta/`, `calheatscore/meta/`, `forecasts/meta/`,
  `calenviroscreen/meta/`, `ceidars/meta/`, `tempo/meta/` as needed).
- A top-level **`meta/datasets/`** catalog lists every dataset and links to its domain
  meta.
- **Coverage is separate** (it changes with the data); everything else is effectively
  static and long-cacheable.

**Gaps, in priority order:**

1. **Dataset catalog**: label, description, geography type, available resolutions,
   units, and source attribution/license. Needed by the Widget Creation picker,
   `AnalysisSpec` input filters, and export manifests. See "What a dataset is" above.
2. **Coverage/availability** — first/last data date per dataset and per
   monitor/region × entry type; which summary resolutions are complete (monthly+
   rollups exist only after the period ends).
3. **Non-pollutant scales**: smoke density, fire FRP tiers, CalHeatScore, AQI 0–500,
   temperature thresholds, forecast categories/burn status (labels + colors). Currently
   hardcoded in `monitor-map` and server Sass. **CalHeatScore meta also carries per-score
   `guidance`**, since the server stores only 0–4 labels today.

4. **Alert metadata** — alertable entry types per monitor type, alert levels,
   evaluation windows (today only in server `ENTRY_CONFIG`).
5. **Region hierarchy** — nesting between region types, counts, which regions have
   summaries.
6. **Choice lists** — stage/processor labels + descriptions, pesticide categories/IARC.
7. **Display hints** — decimal precision, preferred chart type/scale per entry type.

**Shared action tiers** (decided 2026-09-28). Scales with different step counts and names
(6 AQ levels, 5 heat scores, …) are compared by a **`tier` (0–4) in metadata** for every
level of every scale.

- **The tier scale is CalHeatScore's own 0–4 scale.** Heat maps one to one (Low 0, Mild 1,
  Moderate 2, High 3, Severe 4), and each tier's meaning comes from CalHeatScore's
  **official recommended actions**, which are also the heat guidance text stored in
  `calheatscore/meta/`.
- **Only the air-quality side is a judgment call:** which tier each of the 6 AQ levels
  maps to (e.g. is Unhealthy for Sensitive Groups a 2; do Very Unhealthy and Hazardous both
  map to 4). **The user decides these** (see `DEFERRED.md` → "Open decisions"). The
  mapping is kept in server metadata.
- Every other scale in the metadata (including smoke density in Release 1) is mapped onto
  the same tiers. Trade-off: tier meanings are anchored to CalHeatScore's definitions, and
  a change there would mean revisiting the mapping (easy, since it's metadata).

- **Heat for areas larger than a ZIP** (decided 2026-09-28): CalHeatScore is per ZIP, so a
  county, city, or similar target uses the **highest heat score among its ZIPs**, labeled
  (e.g. "Heat: High (highest in Fresno County today)"). That's the safe choice for activity
  advice. A point or ZIP target uses that exact ZIP.
- **Forecasts for areas that aren't a forecast zone:** use the containing zone (via the
  place lookup). An area spanning zones uses the zone containing its center, labeled.
  Fresno County is its own forecast zone.
- **"Can we go outside?"** leads with the **higher-tier condition's guidance** and lists
  both conditions beneath it; ties show both guidance texts. Only tier numbers are
  compared, and all wording is server metadata. With no heat data (uncovered ZIP, or not
  yet published today), it falls back to air quality alone and says so.
- Raising the tier when heat and poor air quality combine is deferred (see
  `DEFERRED.md`).

**Available pollutants (decided 2026-09-24).** The code supports every entry type, but
SJVAir is only confident in some readings (PM2.5 and O3 today). A server-controlled
**available-pollutants list in metadata** (e.g. an `available_pollutants` list or
per-entry-type `available` flag on `monitors/meta/` — ideally admin-editable so changing
it needs no deploy) gates which pollutants the frontend offers in **widgets, analyses,
and alert rules**. Enabling NO2/SO2/CO later is a metadata change, not a code change. The
new code never hardcodes pollutants (the v1 `"pm25" | "o3"` goes away with the v1 code).
Priority: alongside gap #1.

**Cleanup to do alongside** (removing hardcoded duplicates once metadata covers them):
server breakpoints defined twice (`levels.py` + entry classes), legacy
`Subscription.LEVELS`, Sass AQ colors, `generate_group_map.py`; `monitor-map`'s
`colors.ts`, legend gradient, `150.5` fallback, hardcoded "µg/m³", smoke/fire colors;
stale `sdk-js` `api-urls.md`; v3-mobile's `PMGauge.svelte` (old PM2.5 scale, see
`DEFERRED.md`). (This repo's v1 hardcoded values disappear with the v1
code; the new code never hardcodes them.)

## Tech stack

The existing stack stays (IDEA.md: "nothing is being ripped out"); tools are added as
needed. Plain Vite SPA — no SvelteKit, no server runtime — keeping embedding and a Tauri
wrap simple.

- **Current:** Svelte 5 + TypeScript + Vite, `sv-router`, Tailwind CSS v4,
  shadcn-svelte (bits-ui), `@lucide/svelte`, `date-fns`, `uplot` (currently only via
  monitor-map; becomes a direct dependency),
  `@sveltejs/enhanced-img`, `@sjvair/sdk`, `@sjvair/monitor-map` (v1 code; replaced by
  `@sjvair/map-sdk`), Vitest.
- **Planned additions (decided):** Paraglide JS (i18n-ready messages), `@date-fns/tz` (Pacific-time math), `lz-string`
  (URL-fragment sharing), `@sjvair/map-sdk` (the map library), `terra-draw` (drawn-shape selection, via a map-sdk
  plugin), JupyterLite + Pyodide (separate notebook app), and for testing Playwright,
  `vitest-browser-svelte`, and `@axe-core/playwright`.

## Browser support & performance budget

Decided 2026-09-28.

- **Supported browsers = Tailwind v4's minimums: Chrome/Edge 111+, Safari 16.4+, Firefox
  128+.** Older browsers see a friendly "Your browser is too old for this app" notice
  that points to sjvair.com's main map. Some school Chromebooks past their update end
  date may fall below this; check with partner schools during the private preview.
  Dropping to Tailwind v3 was decided against (see `DEFERRED.md`).
- **Performance budget, CI-enforced:** about **200 KB compressed** of initial JS for the app
  shell. **Each widget type loads its own code only when used** (the map library only
  with a Map widget, uPlot only with charts, and so on).
- **A low-end device check before go-live:** Lighthouse with throttled CPU and network,
  plus a real older Chromebook from the private-preview school if possible.

## Telemetry, analytics & privacy

Decided 2026-09-28. The audience includes K-12 students; sjvair.com's `base.html` loads
Google Tag Manager/Analytics; and the dashboard's riskiest logic (sync, migrations,
IndexedDB, conflict replay) runs only in the browser, where no SJVAir front end reports
errors today.

1. **No Google Analytics or Tag Manager on `/explore/`.** The Django view serves the
   dashboard's own `index.html`, not sjvair.com's base template. Aggregate usage counts
   are deferred (see `DEFERRED.md`).
2. **Front-end errors go to the existing Sentry org**, through the platform adapter, with
   strict scrubbing: never document bodies, Notes text, names, emails, or coordinates;
   only the error, the app version, and anonymous technical context. Sentry's host is
   added to the CSP's allowed hosts.
3. **An in-app privacy note** (linked from the footer or account menu) explaining what's
   stored locally, what syncs, and what error data is sent.
4. **A feedback link** (an email address or form) for the private preview.

## Licensing

Decided 2026-09-28.

- **MIT** for `data-dashboard`, `map-sdk`, and `monitor-map`, matching `sdk-js` (and
  `django-resticus`). Before this, `data-dashboard` (now public) and `monitor-map` (on npm)
  had no license, which means "all rights reserved".
- **Dependency policy:** bundled dependencies must be permissively licensed: MIT, BSD,
  Apache-2.0, ISC, or MPL-2.0 when used unmodified (e.g. Pyodide). A **CI license check**
  flags anything else, and the build generates a **third-party notices** file (which
  also covers the JupyterLite/Pyodide notices).
- Adding the license to `monitor-map` is a sibling-repo change: it goes in its next plan,
  or as a tiny standalone change with the user's approval. `map-sdk` is created with MIT.

## Accessibility

**Target: WCAG 2.2 Level AA from Release 1** (decided 2026-09-24). Applies to all widgets
and views.

- **Keyboard move and resize** (WCAG 2.5.7, Dragging Movements). Focus a widget's title
  bar and press Enter to pick it up; arrow keys move it one grid cell, Shift+arrows
  resize, Enter drops, Esc cancels. The same **"Move…" / "Resize…"** actions appear in
  the widget ⋯ menu through the shared action list.
- **Live-region announcements** for layout changes, e.g. "Moved to column 3, row 2" or
  "Widget minimized to taskbar".
- **Focus management:**
  - Fullscreen traps focus; Esc exits and restores focus.
  - Minimize moves focus to the widget's taskbar item; restore returns it to the widget.
  - The taskbar is a keyboard-navigable toolbar (roving tabindex).
- **Animations respect `prefers-reduced-motion`.**
- **Official level colors, used accessibly** (decided 2026-09-28). Server metadata keeps the
  official EPA AQI colors, some of which fail contrast on white (yellow `#ffff00` is about
  1.07:1). So:
  - **Color never carries meaning alone** (WCAG 1.4.1): tiles, chart threshold lines,
    calendar cells, and legends always show the level's label, tier, or an icon.
  - **Swatches and colored areas get a contrasting outline** (WCAG 1.4.11, 3:1).
  - **Text on a level color uses color2k's `readableColor`** (black or white, whichever
    contrasts more, per the WCAG luminance formula), shared through one helper in the
    `format`/theme module (v3-mobile already uses it). No `text_color` metadata field.
  - axe checks and manual passes cover these states (e.g. a yellow-level tile, the
    calendar).

- Every data widget has a non-visual fallback: the **Data table** widget serves chart/map
  data; maps and charts expose their data as summary text or link to a table view.
- Keyboard navigation and ARIA via shadcn-svelte / bits-ui primitives, not hand-rolled
  interactive elements (includes the context menu — Shift+F10 / Menu key).
- Standard loading/error states per widget (skeleton or spinner; inline error with retry).

## Testing strategy

Decided 2026-09-24.

| Layer         | Tool                                                                | Covers                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit          | Vitest (existing)                                                   | Pure logic: layout engine, `applyChange`/undo, menu resolution and merge, `format` and Pacific time/DST, resolution selection and stitching, descriptor codecs, document migrations, analysis steps    |
| Component     | Vitest browser mode (Playwright provider) + `vitest-browser-svelte` | Svelte components in a real browser: widgets, Widget Creation accordions, pickers                                                                                                                      |
| End-to-end    | Playwright on Chromium, WebKit, Firefox                             | Drag/resize and keyboard move/resize, context menus, autosave → reload, undo, the offline banner, fullscreen/taskbar focus, a Map widget WebGL smoke test. WebKit stands in for Safari and Tauri/macOS |
| Accessibility | `@axe-core/playwright` inside E2E                                   | Automated WCAG 2.2 AA checks on key screens. Manual keyboard and screen-reader passes are still required before releases                                                                               |

- **API data:** E2E uses recorded fixtures via Playwright request routing, so runs are
  deterministic. A small **smoke suite against the local sjvair.com dev stack** (podman)
  catches contract drift.
- **CI** (decided 2026-09-24): **PRs into `main` run the full suite**: unit, component,
  and three-engine E2E (Chromium, WebKit, Firefox) plus axe. Merging to `main` is
  effectively a deploy, so this is the pre-production gate. PRs between feature branches
  run the fast set (unit, component, Chromium E2E).

## Deployment

Decided 2026-09-24. **Release 1 is served from sjvair.com under a path**, not from a
separate origin. **The base path is `/explore/`** (decided 2026-09-25).

- **Why `/explore/`:** the base path names the _app_, not one of its resources. The app
  holds Dashboards _and_ Analysis, so `/dashboard/` would either repeat itself
  (`/dashboard/dashboards/:id`) or put Analysis under "dashboard". The product can
  still be called the "SJVAir Dashboard" in the UI; only the URL uses `explore`.
- **Before hosting:** confirm no existing sjvair.com CMS page uses `explore` (Django's
  final catch-all serves prose pages).
- **CSRF cookie and trailing slashes** (docs review 2026-09-28): nothing in sjvair.com
  calls `ensure_csrf_cookie`, so a user landing directly on `/explore/` may have no
  `csrftoken` cookie, and every cookie-based save would fail after the resticus CSRF fix.
  The `/explore/*` view must be decorated with **`ensure_csrf_cookie`**, and must **not
  force trailing-slash redirects** (the catch-all `PageTemplate` does; the route table has
  no trailing slashes). This is the hosting track's responsibility.

- **Same origin, so cookie auth.** Users signed in to sjvair.com are signed in to the
  dashboard. There is no token handling, no token in browser storage, and no dependence
  on CORS. This matters because Release 1 includes sign-in and server-backed documents.
  Token auth stays supported for Tauri and any future standalone build (see
  "Authentication").
- **The monitor-map import pattern, as-is** (decided 2026-09-24). During each Heroku
  deploy, a sjvair.com build step clones this repo's **`main`**, builds it, and copies it
  into `dist/` (like `scripts/import-monitor-map.sh`). A Django catch-all route serves
  `index.html` for `/explore/*`. **No version pinning:** `main` is always
  production-ready and ships with every server deploy. Needs an approved sjvair.com
  plan.
  - **Consequence: merging to dashboard `main` is the deploy approval point**, since any
    server deploy (even an unrelated backend fix) ships it. CI on PRs is the gate.
  - **Before go-live**, the import and route may be merged into sjvair.com but the
    `/explore/*` route stays **disabled or hidden** (except for the private preview),
    so in-progress work on `main` isn't public. Merges still need explicit approval.
  - **After go-live**, unfinished features stay on branches or behind a flag.
  - A broken dashboard build would fail the server deploy. This is the same risk
    monitor-map already carries, accepted for now.
- **Repo visibility** (decided 2026-09-28; done): `SJVAir/data-dashboard` is
  **public** (it was private, which would break the anonymous `git clone` in the
  monitor-map-style import). A history scan found no committed secrets (only
  `.env.example` with public URLs). This matches monitor-map and sdk-js, which are public.
- **Build configuration:** `VITE_*` keys (MapTiler, NREL, …) come from **Heroku config
  vars** at build time, as for monitor-map. These keys end up in the built JavaScript like any
  in-browser map key, so **each must be restricted by domain** in its provider's
  dashboard (MapTiler, NREL). Use separate keys, or extra allowed domains, for localhost
  dev and a staging preview app. Vite `base: "/explore/"` matches the
  router's `basePath`.
- **Same-origin API in production:** when served under `/explore/`, the SDK origin is
  the page's own origin (`setOrigin(location.origin)`), not `VITE_PROD_URL`. This prevents
  `www.sjvair.com` vs `sjvair.com` mismatches from turning API calls cross-origin and
  silently breaking cookie sign-in. `VITE_PROD_URL` remains only for non-same-origin
  builds (Tauri, standalone).
- **`basePath` support in `src/router.ts` is pulled into Release 1**: the one piece of the
  deferred embedding work that serving under a path needs. Full host-page embedding stays
  deferred.
- **Private preview before go-live** (decided 2026-09-24). `sjvair.com/explore/` goes
  public only when Release 1 is complete, but from about Release 1 step 4 an **unlisted
  preview** (a staging Heroku app or a hidden route; chosen in the hosting-track plan)
  lets a pilot teacher and a researcher try it and give feedback early.
- **JupyterLite (Release 3)** lives at its own path (e.g. `/notebooks/`), and COOP/COEP
  headers are set only for that path.
- **CI in this repo** runs lint, type-check, tests, and build on every PR. **Merging to
  `main` needs the user's explicit go-ahead**, because it is effectively a production
  deploy. The same goes for triggering server deploys.
- Server context: `CORS_ORIGIN_ALLOW_ALL = True` with `CORS_ALLOW_CREDENTIALS = True`. This is
  largely contained by Django's default `SameSite=Lax` session cookie. Tightening it is
  tracked in `DEFERRED.md`.

## Embedding (production build)

Like `monitor-map`'s `MapShell`, this app's production build is intended to be
embeddable inside another host app/site, not only run standalone. This shapes several
decisions made along the way:

- **No SvelteKit, plain Vite SPA** — a pure static client with no server runtime to
  strip out, so the same build works standalone, embedded in a host page, and
  eventually wrapped by Tauri.
- **`sv-router` needs a host-safe escape hatch** — same problem `monitor-map` solved
  for `MapShell` with `routerEscapeHatch`/`basePath` (see its `CLAUDE.md`): a host
  page that already has its own router must be able to either mount this app under a
  sub-path (`basePath`) or disable this app's own history/URL manipulation entirely
  when the host is driving navigation. This is **not yet implemented** — `src/router.ts`
  currently assumes it owns top-level routing. **`basePath` ships in Release 1** for
  serving under `/explore/` (see "Deployment"); the escape-hatch/in-memory mode for
  true host-page embedding stays deferred (see `DEFERRED.md` → "Embeddable production
  build").
- **URL state vs. embedding** — decided in "Routing, URL state & undo": when the host
  owns the URL, the same routes are held in memory.

## Legacy: v1 tab model

The sections below describe the original tab-per-data-domain design that the current code
implements. **That code is removed in Release 1's Foundations step** (a fresh start; it
was never deployed). Parts are reused only if they're exactly what the new design needs.
These sections stay only as a record until then. Tech stack and accessibility rules live
in current sections above.

### Repos involved

- **`data-dashboard`** (this repo) — the app itself.
- **`monitor-map`** — provides the embeddable map component (`MapShell`, published
  in `@sjvair/monitor-map` v3.3.0+) used by the Monitors tab's map view.
- **`sdk-js`** (`@sjvair/sdk`) — the API client this app fetches data through.

### Tab structure

One top-level tab per SDK data domain, routed via `sv-router`:

- **Monitors** (`/`) — entry_type filter (pm25/pm10/o3/etc., not a sub-tab), date
  range, client-side county filter (using the `county` field already present on
  `MonitorData` — no SDK changes needed). Map, chart, and spreadsheet views, all
  independently toggleable.
- **HMS Smoke/Fire** (`/hms`) — date range filter. Primarily map-centric (GeoJSON
  polygons); chart/spreadsheet toggles may be hidden or disabled for this tab.
- **Collocation Sites** (`/collocation-sites`) — not a date-range + multi-view tab
  like the others. A collocation "site" pairs a reference monitor with a collocated
  monitor, with no time-series data of its own. The flow is: list/map of pairs →
  select a pair → drill into a comparison view of both monitors' entries over a date
  range (reusing the Monitors tab's chart/spreadsheet views against two monitor IDs).

### State & URL architecture

- **The URL is the source of truth** for current view state: active tab,
  entry_type/filters, date range, county filter, and which views (map/chart/
  spreadsheet) are toggled on. Sharing a URL reproduces the exact same screen for the
  recipient, view toggles included.
- **A preferences store** (`src/lib/preferences.ts`; localStorage in v1; server sync of
  preferences is deferred, see `DEFERRED.md` → "Server-synced preferences") holds only _defaults_: last-used date range and view
  toggles per tab. It seeds the URL only when a tab is opened with no params present
  — not on every navigation. Once URL params exist, they win.
- **`src/lib/url-state.ts`** provides the pure, unit-tested serialization codecs
  (`encodeDateRange`/`decodeDateRange`, `encodeViews`/`decodeViews`) a tab uses to
  read/write its URL search params via `sv-router`'s `route.search`/`searchParams`.
- Each tab owns its own lightweight `*.svelte.ts` manager (mirroring `monitor-map`'s
  `monitorsManager` pattern): fetches from `@sjvair/sdk`, holds `$state`, derives
  view-ready data. These are new, date-ranged/historical-query managers — distinct
  from `monitor-map`'s own managers, which are scoped to "all currently active
  monitors," not arbitrary historical date ranges.

### Views (v1 tabs)

Rendered as simultaneous split panes when more than one is toggled on (side-by-side
on desktop, stacked on mobile), not switchable sub-tabs.

- **Map** — `@sjvair/monitor-map`'s `MapShell` plus the relevant integration(s) for
  that tab (e.g. the Monitors tab passes `[monitorsMapIntegration]`). `MapShell` must
  be used with `routerEscapeHatch={false}` since this app has its own `sv-router`
  navigation — see `monitor-map`'s `CLAUDE.md`.
- **Chart** — `uplot`, following `monitor-map`'s existing `data-chart` module pattern.
- **Spreadsheet** — read-only, sortable/filterable table with CSV export, preferring
  the SDK's existing CSV entries endpoint over re-serializing fetched JSON client-side
  where the endpoint's shape matches what's displayed.

### Out of scope

See `DEFERRED.md`.
