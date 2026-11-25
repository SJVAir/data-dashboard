# Lighthouse: the starter on a low-end phone (2026-11-23)

The low-end device check from step 6 spec 1 (decisions 15–19 in
`docs/superpowers/specs/2026-11-23-step-6-spec-1-starter-map-design.md`). The starter now holds a
Map widget, whose lazy chunk (map-sdk with MapLibre) is about 431 KB gzipped, or 1.58 MB
uncompressed. The initial bundle is 215.6 KB gzipped.

**After the fix (Task 6)**, a Map off screen no longer loads its code, so the starter's first
visit on a phone loads no Map chunk. TBT is under 200 ms in all four cases (115–152 ms; every run
under 200 ms), and LCP still misses in all four. See "After the fix (Task 6)".

Rerun it with:

```bash
npm run build && npm run perf:lighthouse
```

Against the local stack (page loads and the sign-in only; nothing is written):

```bash
LIGHTHOUSE_ORIGIN=http://localhost:8000 WORKSPACE_E2E_IDENTIFIER=… WORKSPACE_E2E_PASSWORD=… \
  npm run perf:lighthouse
```

The variables go right before the command and are never stored. Set both credential variables or
neither: signed out, the stack's `/workspace/` is a 404, and the script refuses to measure it.
`LIGHTHOUSE_ORIGIN` must never be production. The script accepts only `localhost` or `127.0.0.1`
unless `LIGHTHOUSE_ALLOW_REMOTE=1` is set.

Build the way the E2E suite does, so no real key is embedded:
`VITE_SENTRY_DSN= VITE_PROD_URL= VITE_MAPTILER_KEY=e2e-dummy-key npm run build`. The script is
`e2e/lighthouse/lighthouse.perf.ts`, with the fake server in `e2e/lighthouse/fake-server.ts`.
Raw reports and a `summary.json` go to `lighthouse-results/`, which git ignores. A run of the four
cases takes about 7 minutes.

## Method

- **Lighthouse 13.6.0**, run with its CLI through a pinned `npx -y lighthouse@13.6.0`. It is
  not a dev dependency: Lighthouse itself is Apache-2.0, but its transitive dependencies include
  FSL-1.1 (`sentry`, via `@sentry/node`) and BlueOak-1.0.0 (`glob`, `minimatch` and others)
  packages, which aren't on the project's licence allow-list (the user, 2026-11-23). The first run
  downloads it into npm's cache. The numbers below came from the same version through its Node
  API, with the same settings, before the switch; a check run after it matched them. It drives
  Playwright's Chromium (`chromium-1254`, new headless, software WebGL) over a DevTools port. The
  performance category only, with the **mobile preset** (Moto G Power viewport, 4× CPU slowdown,
  slow 4G). Each case gets **3 runs**, and the median is taken for each metric separately. Each run
  starts a fresh browser on a fresh copy of the case's profile, with no HTTP or code cache.
  Lighthouse's storage reset is off, so a saved dashboard stays saved.
- **The fakes are served over real HTTP.** One Node server answers `/api/…` and `/account/…`
  with the E2E suite's own route handlers (`e2e/fixtures.ts`, `*-server.ts`). Those handlers are
  registered on a small stand-in for a Playwright `BrowserContext`, so no fixture data is copied.
  The server serves the build from `dist/` laid out as `vite preview` lays it out, with the
  contract CSP. **gzip is switched on or off by the script** (level 9, as `check:budget` measures),
  so the result doesn't depend on `vite preview`'s defaults (that server gzips). MapTiler
  (`https://api.maptiler.com`) is the E2E stub (`e2e/maptiler.ts`): a blank style and a 404 for
  everything else. It runs on a local HTTPS server with a throwaway self-signed certificate.
  Chromium reaches it through `--host-resolver-rules` and `--ignore-certificate-errors`.
- **Why real HTTP and not Playwright routes.** Lighthouse runs its own throttling. With real
  requests, both of its methods see the actual network: simulated throttling builds its model
  from them, and DevTools throttling slows them down. Playwright-intercepted responses were not
  tried.
- **Why DevTools throttling.** It is the script's default, and the numbers below use it. Both
  methods were run on the same build (tables below). Under DevTools throttling, the browser
  really runs at a quarter speed on slow 4G. Lighthouse's own values for that are 150 ms RTT,
  1.6 Mbps down and 750 Kbps up, applied per request: 562.5 ms latency, 1,474.56 Kbps down and
  675 Kbps up. With this method, the three runs agreed to within about 1% on LCP. Each request's
  timing is its real throttled timing, which shows where the time goes. Simulated throttling
  ("lantern", Lighthouse's own default) estimates the timings from an unthrottled load, which took
  about 0.25 s here. Its LCP estimate jumped between runs of the same case: 4.8, 7.8 and 5.0 s for
  a first visit with gzip, and 18.0, 18.0 and 9.5 s uncompressed. The estimate depended on how the
  fast load happened to order its requests. Simulated throttling is still available with
  `LIGHTHOUSE_THROTTLING=simulate`.
- **The machine.** An AMD Ryzen 9 8940HX (32 threads, 31 GB), Linux. Lighthouse's benchmark index
  was about 3,600–4,500 across runs. That is a fast host, and the preset's fixed 4× slowdown was
  used as the spec says. A real low-end phone may block its main thread longer than this does
  (TBT).
- **The four cases:**
  - _First visit_: a fresh profile opening `/workspace/`. It lands on the starter: a Note, the
    now row, the Map, a chart and calendars, at Fresno County.
  - _Saved dashboard_: a profile in which the starter's first edit made a copy. The edit is a
    click on a calendar day, as in `e2e/starter.spec.ts`. `/workspace/` then opens
    `/workspace/dashboards/<id>`: the same widgets, now as the person's own copy.
  - Each case runs once with the build's text files **gzipped**, and once **uncompressed**, the
    way S3 serves them today (DEFERRED "Upload compression, cache headers…").
- Every API request had a fake answer, and every MapTiler request was stubbed.

## Results: DevTools throttling (the method used)

Median of 3 runs. KB = 1,024 bytes, as `check:budget` counts.

| Case                          | Score | FCP    | LCP    | TBT    | CLS   | Speed Index | Total bytes | Script bytes | Map chunk  |
| ----------------------------- | ----- | ------ | ------ | ------ | ----- | ----------- | ----------- | ------------ | ---------- |
| First visit, gzip             | 67    | 3.80 s | 5.37 s | 276 ms | 0.055 | 2.26 s      | 1,405.3 KB  | 765.1 KB     | 430.7 KB   |
| First visit, uncompressed     | 57    | 6.79 s | 9.14 s | 295 ms | 0.054 | 3.41 s      | 3,410.4 KB  | 2,580.3 KB   | 1,580.2 KB |
| Saved dashboard, gzip         | 64    | 3.86 s | 5.32 s | 357 ms | 0.056 | 1.83 s      | 1,406.2 KB  | 765.1 KB     | 430.7 KB   |
| Saved dashboard, uncompressed | 59    | 6.80 s | 8.85 s | 273 ms | 0.054 | 2.90 s      | 3,411.4 KB  | 2,580.3 KB   | 1,580.2 KB |

The TBT of the three runs in each case: 271–317, 268–331, 275–393 and 269–341 ms. Every run of
every case was over 200 ms.

Total bytes include about **516 KB of API responses**. They are the E2E fixtures, which the fake
server never compresses, so their size says nothing about the real server: two hourly-summary
fixtures alone are 441 KB. Script bytes and the Map chunk are the real build's.

## Results: simulated throttling (cross-check)

Median of 3 runs, on the same build.

| Case                          | Score | FCP    | LCP     | TBT    | CLS   | Speed Index | Total bytes | Script bytes | Map chunk  |
| ----------------------------- | ----- | ------ | ------- | ------ | ----- | ----------- | ----------- | ------------ | ---------- |
| First visit, gzip             | 76    | 2.21 s | 5.04 s  | 186 ms | 0.055 | 2.96 s      | 1,405.3 KB  | 765.1 KB     | 430.7 KB   |
| First visit, uncompressed     | 59    | 4.60 s | 18.04 s | 176 ms | 0.055 | 5.79 s      | 3,410.4 KB  | 2,580.3 KB   | 1,580.2 KB |
| Saved dashboard, gzip         | 75    | 2.21 s | 5.12 s  | 185 ms | 0.057 | 2.95 s      | 1,406.2 KB  | 765.1 KB     | 430.7 KB   |
| Saved dashboard, uncompressed | 58    | 4.61 s | 9.55 s  | 192 ms | 0.056 | 5.70 s      | 3,411.4 KB  | 2,580.3 KB   | 1,580.2 KB |

The LCP of the individual runs: 4.83, 7.83 and 5.04 s; 18.05, 18.04 and 9.53 s; 5.13, 5.04 and
5.12 s; 9.55, 9.55 and 9.61 s. TBT ranged from 165 to 226 ms (one run over 200 ms).

## Findings (decision 19: LCP > 2.5 s, TBT > 200 ms, CLS > 0.1)

1. **LCP misses in all four cases.** It is 5.3–5.4 s with gzip and 8.9–9.1 s uncompressed under
   DevTools throttling. Simulated throttling gives 5.0–5.1 s with gzip and 9.5–18 s uncompressed.
2. **TBT misses in all four cases under DevTools throttling.** The medians are 273–357 ms, and
   every run was over 200 ms. Under simulated throttling the medians are just under the limit
   (176–192 ms), with one run at 226 ms.
3. **On the local stack, LCP and TBT miss too** (see "The local stack run"). LCP is 10.35 s, and
   the median TBT is 224 ms (one run of the three was under 200 ms). The run is a saved dashboard
   with a Map, served uncompressed.
4. **CLS passes** in every case, at 0.054–0.057. Nearly all of it is one shift of the now-row
   widget ("PM2.5 · Fresno County", about 0.054). The page title's text shifts by about 0.0002
   when the web font loads.

These findings are from before the fix; "After the fix (Task 6)" has the numbers with it.

Both pages behave the same: the saved dashboard is a copy of the starter, so it has the same
widgets, bytes and LCP element.

### Where the time goes on a first visit (DevTools throttling, gzip, one median run)

- **The LCP element is the welcome Note's paragraph** ("Welcome to the SJVAir Dashboard…"). It
  is text, so it doesn't wait for the Map. The map is drawn on a canvas, which can't be an LCP
  element, so LCP doesn't measure when the Map appears. In the LCP breakdown, time to first byte
  is about 1 ms and element render delay is all the rest (about 5.4 s).
- **Before the first paint (FCP 3.8 s).** The chain is the HTML (about 0.6 s), then `app.js` and
  `app.css`, then the app chunk (`app-*.js`, 188 KB gzipped), which downloads from 1.3 to 3.0 s.
  The app chunk then runs its startup tasks of 60–125 ms from 3.0 to 3.9 s. Uncompressed, the app
  chunk is 629 KB and downloads from 1.7 to 6.0 s, which puts FCP at 6.8 s.
- **The widgets' code all starts at about 3.9 s, and the Map chunk is the largest download.**
  The Map chunk (431 KB) downloads from 3.87 to **10.0 s**, sharing the bandwidth with the
  widgets' smaller files. The calendars' `DayGrid` (9 KB) finishes at 9.3 s, `monitors/meta/`
  (12 KB) at 9.9 s, and the first daily-summary data request starts at about 10 s. The Note's
  text (LCP, 5.4 s) arrives while the Map chunk is still downloading. **Uncompressed, the Map
  chunk (1.58 MB) downloads from 6.9 to 23.1 s.** The baseline below shows how much of that
  lateness is the Map's: without it, the widgets' data still starts late, at about 9.1 s (gzip),
  so the Map adds about 1 s there.
- **The longest task is the Map chunk's evaluation**, at 211–238 ms, once it has arrived (10.1 s
  with gzip, 23.1 s uncompressed). It is the largest single part of TBT: about 160–190 ms over the
  50 ms allowance. The rest comes from the app chunk's startup tasks (60–154 ms each) and two of
  its later tasks (65–89 ms).
- **Main-thread work in total**, under 4× CPU: about 0.78 s of script evaluation, 0.48 s
  "other", 0.14 s of style and layout, and 0.09 s of HTML and CSS parsing. By file: the app chunk
  takes about 0.86 s, the Map chunk 0.18 s, and the document 0.23 s.
- **Lighthouse's "unused JavaScript" at load:** about 330 KB of the Map chunk and 107 KB of the
  app chunk (gzip sizes). This is reported here, but it isn't a finding under decision 19.

### Other audits below 0.9 (not findings under decision 19)

- **Setup only:**
  - "Use efficient cache lifetimes" (870 KB to save with gzip). The fake server sends no
    `Cache-Control`. That is also how S3 serves the files today (DEFERRED "Upload compression,
    cache headers…"), so it is real once deployed, but this run was not designed to measure it.
  - MapTiler is a blank style with no tiles, so the basemap's own bytes and work are missing.
  - The API responses are fixtures, uncompressed, and sized by the fixtures (see above).
- **Not setup, below the decision-19 bar:**
  - "Total byte weight" (uncompressed only: 3,410 KB)
  - "Reduce unused JavaScript" (above)
  - "Reduce unused CSS" (18 KB gzipped; 146 KB uncompressed)
  - "Render-blocking requests" (`app.css`; an estimated 150 ms to save, or 600 ms uncompressed)
  - "Improve image delivery" (the 14 KB `sjvair-icon` WebP)
  - "Network dependency tree" (informational)

## Baseline: the starter without its Map (step 5's layout)

To show what the Map adds, a build of this branch with the Map widget taken out of
`starterWidgets()`, and the Chart and month calendar back at y 9. That change was local only and
never committed. The same method was used (DevTools throttling, gzip and uncompressed), and only
the first-visit cases were run, three runs each, median.

| Case                              | Score | FCP    | LCP    | TBT    | CLS   | Speed Index | Total bytes | Script bytes | Map chunk |
| --------------------------------- | ----- | ------ | ------ | ------ | ----- | ----------- | ----------- | ------------ | --------- |
| First visit, gzip, no Map         | 71    | 3.83 s | 5.33 s | 139 ms | 0.055 | 2.26 s      | 940.1 KB    | 325.7 KB     | none      |
| First visit, uncompressed, no Map | 63    | 6.76 s | 8.65 s | 118 ms | 0.055 | 3.36 s      | 1,677.9 KB  | 977.3 KB     | none      |

The runs: LCP 5.28, 5.33 and 5.35 s with TBT 110, 139 and 181 ms (gzip); LCP 8.64, 8.74 and
8.65 s with TBT 107, 170 and 118 ms (uncompressed). Total bytes include the same API fixtures,
about 510 KB.

What the Map adds, comparing the medians with the first-visit rows above:

- **LCP:** almost nothing with gzip (5.37 s against 5.33 s), and about 0.5 s uncompressed (9.14 s
  against 8.65 s). Without the Map, LCP still misses 2.5 s: with gzip it is the same 5.3 s.
- **TBT:** 276 ms against 139 ms with gzip, and 295 ms against 118 ms uncompressed. Without the
  Map, every run was under 200 ms. With it, every run was over. The Map chunk's evaluation task
  (211–238 ms) is the difference.
- **Score:** 67 against 71 (gzip), and 57 against 63 (uncompressed).
- **Bytes:** about 440 KB more script with gzip (765.1 KB against 325.7 KB), and about 1.6 MB
  more uncompressed (2,580.3 KB against 977.3 KB).
- **The other widgets' data:** the first daily-summary request starts at about 9.1 s without the
  Map and about 10.0 s with it (gzip); uncompressed, at about 12.4 s against 13.8 s. The
  calendars' `DayGrid` finishes at 8.0 s against 9.3 s (gzip).

## After the fix (Task 6): the Map's code loads when its frame nears the screen

The fix the user approved after the results above (decision 20): a Map frame loads its code only
once the frame is within 200 px of the screen, focus moves into it, or it is fullscreen. On the
preset's phone screen the starter's Map is below the fold, so a first visit no longer downloads or
evaluates the Map chunk until the Map is scrolled near. Same method (DevTools throttling), all four
cases on the fakes, three runs each, median. Build of `step-6-spec-1` with the fix (c731bcc), built
the way the E2E suite builds, run at 15:07 PT with no other tests running on the machine.

| Case                          | Score | FCP    | LCP    | TBT    | CLS   | Speed Index | Total bytes | Script bytes | Map chunk |
| ----------------------------- | ----- | ------ | ------ | ------ | ----- | ----------- | ----------- | ------------ | --------- |
| First visit, gzip             | 70    | 3.88 s | 5.39 s | 152 ms | 0.055 | 2.29 s      | 941.5 KB    | 325.8 KB     | none      |
| First visit, uncompressed     | 62    | 6.76 s | 8.63 s | 146 ms | 0.055 | 3.35 s      | 1,679.7 KB  | 977.8 KB     | none      |
| Saved dashboard, gzip         | 72    | 3.81 s | 5.17 s | 116 ms | 0.056 | 1.84 s      | 942.4 KB    | 325.8 KB     | none      |
| Saved dashboard, uncompressed | 64    | 6.79 s | 8.54 s | 115 ms | 0.056 | 2.62 s      | 1,680.8 KB  | 977.8 KB     | none      |

The runs' TBT: 158, 113 and 152 ms; 146, 120 and 171 ms; 116, 179 and 114 ms; 114, 156 and
115 ms. **Every run of every case was under 200 ms.** LCP varied by under 2% within each case.

- **The Map chunk is gone from the page load** in all four cases. Script bytes are now the no-Map
  baseline's (325.8 KB against 325.7 KB with gzip), and so are total bytes.
- **TBT passes in all four cases:** 276 → 152 ms (first visit, gzip), 295 → 146 ms
  (uncompressed), 357 → 116 ms (saved, gzip), 273 → 115 ms (saved, uncompressed). The Map chunk's
  evaluation task (211–238 ms) no longer appears.
- **Against the no-Map baseline** (first visit, gzip: 139 ms, runs 110–181 ms), the median is
  13 ms higher and inside the baseline's range. The long tasks are the same ones at the same
  times, all in the app chunk: startup tasks at about 3.0, 3.7 and 3.8–3.9 s (61–71, 95–131 and
  119–158 ms here; 60–78, 96–129 and 117–149 ms in the baseline), and two after the data arrives
  at about 10.9 and 12.8 s (65–66 and 80–81 ms here; 65–89 and 79–95 ms in the baseline). The only
  task the baseline doesn't have is one of 55 ms at about 5.3 s, in one run of three, which adds
  about 5 ms of blocking time. The difference is within run-to-run variation.
- **A run under load reads higher.** An earlier run of the same build at 14:47 PT, while other
  test suites were running on the machine, measured 230, 165, 148 and 175 ms (first visit with
  gzip over 200 ms in every run). Its long tasks were the same ones, each longer (startup tasks of
  148–184 ms), plus the 5.3 s task in all three runs. The numbers above replace it.
- **LCP still misses** (5.2–5.4 s with gzip, 8.5–8.6 s uncompressed): it is the welcome Note's
  text, as before, which never waited for the Map. Uncompressed, LCP improved by about 0.5 s (9.14
  → 8.63 s), the Map's share found by the baseline.
- **Score:** 67 → 70, 57 → 62, 64 → 72 and 59 → 64.
- Scrolling the Map near still downloads and evaluates the chunk then (one task of about 200 ms
  under 4× CPU); Lighthouse doesn't scroll, so it isn't in these numbers.

## The local stack run

Run 2026-11-23 at 13:51 PT against the local sjvair.com stack's `/workspace/` (the Django
template embedding, real API, real MapTiler tiles), signed in as the E2E test user. Build
`c7c15c7` (`version.json`), imported into the stack by the coordinator just before; the app is the
same as `ba5b99a`. Lighthouse 13.6.0, DevTools throttling, mobile preset, median of 3. Page loads
and the sign-in only; nothing was written.

| Case               | Score | FCP    | LCP     | TBT    | CLS   | Speed Index | Total bytes | Script bytes | Map chunk  |
| ------------------ | ----- | ------ | ------- | ------ | ----- | ----------- | ----------- | ------------ | ---------- |
| origin-first-visit | 66    | 2.58 s | 10.35 s | 224 ms | 0.054 | 3.24 s      | 3,009.7 KB  | 2,643.4 KB   | 1,580.2 KB |

Runs: LCP 10.35, 10.31, 10.37 s; TBT 224, 171, 257 ms.

- **No document writes:** checked read-only in the stack's database for 13:45–14:05 PT (no
  SavedDocument created/updated/deleted, no DocumentSnapshot, BlockedBuild or PurgedDocument rows;
  SavedDocument.updated_at is auto_now, so a sync push would show; one last_login, the script's
  sign-in). The request log wasn't available.
- **What it opened:** the test account has saved dashboards, so `/workspace/` opened a saved
  dashboard (`/workspace/dashboards/<id>`), not the starter. That dashboard holds a Map.
- **Delivery is uncompressed**, as S3 will serve it today: the Map chunk's transfer size equals its
  resource size (1.58 MB). It downloads from 8.0 s to 21.7 s.
- **FCP is faster than on the fakes** (2.58 s against 6.8 s uncompressed): the template embedding
  loads the entry files directly. **LCP is a widget's text** (selector
  `div.relative > div.h-full > div.flex > p`), with almost all of it render delay (about 10.3 s
  after a 25 ms first byte).
- **Findings under decision 19:** LCP (10.35 s) is over 2.5 s, and the median TBT (224 ms) is
  over 200 ms.
- **TBT straddles the threshold** (171–257 ms); the app chunk's scripting is about 470 ms of main
  thread under 4× CPU.
