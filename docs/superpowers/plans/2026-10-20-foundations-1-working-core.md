# Foundations Spec 1: The Working Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 app with a new top-nav shell where you can create a dashboard
(blank or from a placeholder starter), add placeholder widgets on the 12-column grid,
rename/duplicate/delete them with undo, and have every edit autosave to IndexedDB and
appear in other tabs.

**Architecture:** Pure, unit-tested core modules (document schemas, `applyChange`,
overlap/rebase, undo stack, menu resolution, `format`) sit under a platform adapter
(IndexedDB on web, an in-memory twin for tests) and a `DocumentSession` store that owns
autosave, the change log, and cross-tab catch-up. Svelte 5 components are thin views over
the stores and the shared action registry.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite 8, sv-router 0.19 (`base` option),
Tailwind v4 + shadcn-svelte/bits-ui, zod 4, idb, @date-fns/tz, Paraglide JS,
svelte-sonner, Vitest 5 (node + browser mode), vitest-browser-svelte, Playwright,
@axe-core/playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-foundations-1-working-core-design.md`
(read it first; `ARCHITECTURE.md` sections it names are the source for anything this plan
doesn't restate).

**Branch:** create `foundations-1-core` from `foundations`; all tasks commit there. The PR
goes into `foundations`, never `main`. Do not merge, release, or publish anything.
Commits carry no AI attribution trailers.

## Global Constraints

- Tabs, double quotes, no trailing commas, 100-column lines; run `npm run format` before each commit.
- Svelte 5 runes only; no `$:`.
- Every UI string comes from Paraglide (`m.*()`); no concatenated sentences; documents never store generated English (`name: null`, `title: null` mean generated).
- Styling values only from theme tokens (CSS variables); no hex/rgb/px literals in components except `0`.
- Components and stores never touch `localStorage`, `indexedDB`, or `BroadcastChannel` directly except inside `src/lib/platform/` and `src/lib/store/tab-channel.ts`.
- Dates go through `src/lib/format/` (America/Los_Angeles, weeks start Sunday).
- New dependencies must be MIT, BSD, Apache-2.0, or ISC (check each before installing).
- Autosave debounce: 500 ms. Change log keeps the last 500 entries per document.
- Names and titles: trimmed, max 100 characters; empty after trimming means `null` (generated).
- Grid: 12 columns; placeholder default size `{ w: 6, h: 4 }`, min size `{ w: 2, h: 2 }`.
- Base path: `/workspace/` (router `base: "/workspace"`, Vite `base: "/workspace/"`).
- WCAG 2.2 AA; motion collapses under `prefers-reduced-motion`.

## Review Focus

1. **Reload or close right after an edit** (inside the 500 ms window): the edit must survive. → Task 11, test `flushes pending changes on pagehide`; Task 18, E2E `edit then immediate reload keeps the edit`.
2. **A corrupt or newer-version document in IndexedDB**: that one opens read-only with a message, others still list and open. → Task 6, tests `newer schemaVersion loads read-only` and `invalid document loads read-only without throwing`; Task 11, test `read-only session refuses apply`.
3. **IndexedDB write fails** (quota, blocked, private mode): the in-memory document stays, status says "couldn't save", nothing is thrown at the user. → Task 11, test `failed commit keeps doc and sets status error`.
4. **Last-opened preference points at a deleted or missing dashboard**: `/workspace/` falls back to the most recently changed one, or the starter. → Task 13, `resolveHome` tests.
5. **Ctrl/⌘+Z while typing in the rename field** undoes the text, not the dashboard. → Task 15, component test `undo shortcut ignored in text inputs`.

---

## File structure

```
docs/reference/v1-lessons.md                 Task 1
project.inlang/settings.json, messages/en.json   Task 3 (messages grow in later tasks)
src/main.ts, src/App.svelte, src/router.ts    Tasks 2, 15
src/app.css                                   Task 3 (tokens)
src/lib/format/index.ts                       Task 4
src/lib/documents/schema.ts                   Task 5 (zod schemas + inferred types)
src/lib/documents/names.ts                    Task 5 (display names)
src/lib/documents/load.ts                     Task 6 (migration chain + load pipeline)
src/lib/widgets/registry.ts                   Task 7
src/lib/widgets/placement.ts                  Task 7
src/lib/widgets/placeholder/{index.ts,Placeholder.svelte}   Task 7
src/lib/changes/{types.ts,apply.ts}           Task 8
src/lib/changes/{overlap.ts,rebase.ts}        Task 9
src/lib/changes/undo.ts                       Task 9
src/lib/platform/{types.ts,index.ts}          Task 10
src/lib/platform/memory.ts                    Task 10
src/lib/platform/web/{db.ts,storage.ts}       Task 10
src/lib/platform/storage-contract.ts          Task 10 (shared test suite)
src/lib/store/document-session.svelte.ts      Task 11
src/lib/store/tab-channel.ts                  Task 12
src/lib/store/dashboard-index.svelte.ts       Task 13
src/lib/starter/starter.ts                    Task 13
src/lib/actions/{types.ts,resolve.ts,scope.ts}   Task 14
src/lib/actions/{global.ts,dashboard.ts,widget.ts}   Task 16
src/lib/components/shell/*                    Task 15
src/lib/components/dashboard/*                Task 16
src/lib/components/dialogs/*                  Task 16, 17
src/routes/{Home,DashboardPage,DashboardList,NotFound}.svelte   Tasks 15–17
e2e/*.spec.ts, playwright.config.ts           Tasks 3, 18
scripts/e2e-podman.sh                         Task 3
.github/workflows/ci.yml                      Task 3, 18
```

Test naming: `*.test.ts` run in Node; `*.browser.test.ts` run in Vitest browser mode
(Chromium); `e2e/*.spec.ts` run in Playwright.

---

### Task 1: Write `docs/reference/v1-lessons.md`

**Files:**
- Create: `docs/reference/v1-lessons.md`

**Interfaces:** none (documentation; must land before Task 2 deletes the code).

- [ ] **Step 1: Read the v1 code and tests**

Read `src/lib/monitors/*`, `src/routes/monitors/*`, `src/routes/*.svelte`,
`src/lib/{calendar,preferences,url-state}.ts`, `src/lib/components/*.svelte`, every
`*.test.ts` beside them, and the v1 specs/plans in `docs/superpowers/{specs,plans}/2026-09-1*`.

- [ ] **Step 2: Write the doc**

Sections: "Server behavior" (rollup timing, endpoint quirks, sizes), "Regions"
(boundary fetching and dedupe, single-parent narrowing, child-type filtering, no-average
black border, `land_use`/`mtrs` too large to list), "Map" (globe zoom precision), "Loading
states" (year/month 0 or blank during initial load; map/calendar not blocking on child
refetches), "Edge cases the tests encode" (one bullet per distinct case found in the 78
tests, phrased as behavior, citing the test file). Start from the list in `TODO.md` →
"Release 1, step 1: Foundations". Describe behaviors, not code; no code blocks over 5
lines.

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write docs/reference/v1-lessons.md
git add docs/reference/v1-lessons.md
git commit -m "Capture what the v1 code learned about server behavior"
```

---

### Task 2: The fresh start

**Files:**
- Delete: `src/routes/` (all), `src/lib/monitors/`, `src/lib/components/{AppNav,Calendar,DataBox,RegionCheckboxList}.svelte`, `src/lib/{calendar,preferences,url-state}.ts` and their tests, `src/lib/components/ui/{checkbox,select,sheet}`
- Modify: `src/App.svelte`, `src/router.ts`, `src/main.ts`, `package.json`, `tsconfig.json`, `.env.example`
- Keep: `src/lib/utils.ts`, `src/lib/components/ui/{button,separator}`

**Interfaces:**
- Produces: an app that builds and renders a single `<h1>` from a temporary `Home.svelte` route at `/`; `router.ts` exports `{ route, navigate, p, isActive }` with `base: "/workspace"`.

- [ ] **Step 1: Delete the v1 files listed above**

- [ ] **Step 2: Remove v1-only dependencies**

For each of `@sjvair/monitor-map`, `@maptiler/sdk`, `@turf/boolean-point-in-polygon`,
`@tstk/builtin-extensions`, `@tstk/utils`, `@types/geojson`, `@internationalized/date`:
`grep -r "<name>" src` must return nothing, then `npm uninstall <name>`. Keep `@sjvair/sdk`.

- [ ] **Step 3: Clean up config**

`tsconfig.json`: remove the TEMPORARY `@sjvair/sdk`, `$http`, `$datetime` path entries and
the `zod` path (keep `$lib`). `src/main.ts`: only imports `app.css` and mounts `App` (no
`setOrigin`, no env check). `.env.example`: keep `VITE_DEV_URL` with a comment that spec 2
uses it again. `vite.config.ts`: add `base: "/workspace/"`. `router.ts`:
`createRouter({ "/": Home }, { base: "/workspace" })` (check sv-router's `createRouter`
options signature in `node_modules/sv-router/src/index.d.ts`). `App.svelte`: just
`<Router />`.

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint && npm run build && npm test`
Expected: all pass (Vitest reports "No test files found" — pass `--passWithNoTests` in the
`test` script if needed). `npm run dev`, open `http://localhost:5173/workspace/`: the
heading renders.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Remove the v1 app for the fresh start"
```

---

### Task 3: Tooling — Paraglide, theme tokens, test layers, CI

**Files:**
- Create: `project.inlang/settings.json`, `messages/en.json`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `scripts/e2e-podman.sh`, `.github/workflows/ci.yml`, `src/lib/smoke.browser.test.ts`
- Modify: `vite.config.ts`, `package.json`, `.gitignore`, `.prettierignore`, `src/app.css`, `src/routes/Home.svelte`

**Interfaces:**
- Produces: `import { m } from "$lib/paraglide/messages.js"`; npm scripts `test` (all Vitest projects), `test:unit`, `test:browser`, `test:e2e` (Chromium), `test:e2e:all` (three engines), `test:e2e:podman`; theme tokens `--space-*`, `--motion-duration-*`, `--motion-ease-*`, `--grid-row-height`, `--grid-gap`, `--font-sans`, existing shadcn color/radius tokens.

- [ ] **Step 1: Install dev dependencies (check each license first)**

```bash
npm i -D @inlang/paraglide-js @vitest/browser-playwright vitest-browser-svelte @playwright/test @axe-core/playwright
npm i zod idb @date-fns/tz svelte-sonner
npx playwright install chromium
```

- [ ] **Step 2: Paraglide**

`project.inlang/settings.json` with `baseLocale: "en"`, `locales: ["en"]`, the message
format plugin pointing at `messages/{locale}.json`. Add `paraglideVitePlugin({ project:
"./project.inlang", outdir: "./src/lib/paraglide" })` to `vite.config.ts`. Add script
`"paraglide": "paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide"`
and run it first in `check`, `test`, `build`. Gitignore and prettierignore
`src/lib/paraglide/`. First message: `"app_name": "SJVAir Workspace"`; `Home.svelte` renders
`m.app_name()`.

- [ ] **Step 3: Theme tokens in `src/app.css`**

Keep the shadcn color and radius tokens. Add to `:root`: `--space-1…8` (0.25rem steps),
`--motion-duration-fast: 120ms`, `--motion-duration-base: 200ms`,
`--motion-ease-standard: cubic-bezier(0.2, 0, 0, 1)`, `--grid-row-height: 4rem`,
`--grid-gap: var(--space-3)`; expose them through `@theme` where Tailwind needs them. Add
`@media (prefers-reduced-motion: reduce)` setting both durations to `0ms`. Remove the
`--color-sidebar*` and `--sidebar*` tokens (no sidebar).

- [ ] **Step 4: Vitest projects**

In `vite.config.ts`, `test.projects`: `unit` (node, `src/**/*.test.ts`, excluding
`src/**/*.browser.test.ts`) and `browser` (`src/**/*.browser.test.ts`, `browser: {
enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium"
}] }`). Write `src/lib/smoke.browser.test.ts` that renders `Home.svelte` with
`vitest-browser-svelte` and expects text "SJVAir Workspace".

Run: `npm test` → Expected: 1 passed (browser).

- [ ] **Step 5: Playwright**

`playwright.config.ts`: `testDir: "e2e"`, `webServer: { command: "npm run build && npx vite
preview --port 4173 --strictPort", url: "http://localhost:4173/workspace/" }`, `use: {
baseURL: "http://localhost:4173/workspace/" }`, projects `chromium`, `firefox`, `webkit`.
`e2e/smoke.spec.ts`: visits `./` and expects heading "SJVAir Workspace", then runs axe
(`new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])`)
and expects zero violations. `scripts/e2e-podman.sh` runs `playwright test` (all three
projects, args passed through) in `mcr.microsoft.com/playwright:v<installed version>-noble`
with the repo mounted, via `podman run --rm --ipc=host`.

Run: `npm run test:e2e` → Expected: 1 passed. Run: `npm run test:e2e:podman` → Expected:
3 passed (if podman can't pull the image, note it in the PR and rely on CI).

- [ ] **Step 6: CI (`.github/workflows/ci.yml`)**

Triggers: `pull_request` and `workflow_dispatch`. Node 24, `npm ci`. Job `checks`:
paraglide, lint, check, `npx playwright install --with-deps chromium`, `npm test`, build.
Job `e2e-chromium` (needs checks): `npm run test:e2e`. Job `e2e-full` (needs checks; `if:
github.event_name == 'workflow_dispatch' || github.base_ref == 'main'`): matrix `[chromium,
firefox, webkit]`, installs that browser with deps, runs `npx playwright test
--project=${{ matrix.browser }}`. Upload the Playwright report on failure. No deploy or
publish steps.

- [ ] **Step 7: Verify and commit**

Run: `npm run format && npm run lint && npm run check && npm test && npm run build`
Expected: all pass.

```bash
git add -A && git commit -m "Add Paraglide, theme tokens, test layers, and CI"
```

---

### Task 4: The `format` module

**Files:**
- Create: `src/lib/format/index.ts`, `src/lib/format/format.test.ts`

**Interfaces:**
- Produces:
  - `TIME_ZONE = "America/Los_Angeles"`, `WEEK_STARTS_ON = 0`, `LOCALE = "en-US"`
  - `todayPacific(now?: Date): string` — `YYYY-MM-DD`
  - `startOfPacificWeek(date: string): string`
  - `pacificHoursOfDay(date: string): Date[]` — every hour start in that Pacific day
  - `formatDate(date: string | Date, locale?: string): string`
  - `formatDateTime(instant: Date, opts?: { deviceZone?: string; locale?: string }): string` — appends " PT" only when `needsZoneLabel(deviceZone)`
  - `formatNumber(n: number, opts?: Intl.NumberFormatOptions, locale?: string): string`
  - `needsZoneLabel(deviceZone?: string): boolean` — default from `Intl.DateTimeFormat().resolvedOptions().timeZone`

- [ ] **Step 1: Write the failing tests**

```ts
it("todayPacific uses Pacific, not UTC", () => {
	expect(todayPacific(new Date("2026-10-21T06:30:00Z"))).toBe("2026-10-20");
});
it("weeks start on Sunday", () => {
	expect(startOfPacificWeek("2026-10-20")).toBe("2026-10-18");
	expect(startOfPacificWeek("2026-10-18")).toBe("2026-10-18");
});
it("spring-forward day has 23 hours", () => {
	expect(pacificHoursOfDay("2026-03-08")).toHaveLength(23);
});
it("fall-back day has 25 distinct hours", () => {
	const hours = pacificHoursOfDay("2026-11-01");
	expect(hours).toHaveLength(25);
	expect(new Set(hours.map((d) => d.getTime())).size).toBe(25);
});
it("ordinary day has 24 hours", () => {
	expect(pacificHoursOfDay("2026-10-20")).toHaveLength(24);
});
it("PT label only outside Pacific", () => {
	expect(needsZoneLabel("America/Los_Angeles")).toBe(false);
	expect(needsZoneLabel("America/New_York")).toBe(true);
	const t = new Date("2026-10-20T19:00:00Z");
	expect(formatDateTime(t, { deviceZone: "America/Los_Angeles" })).not.toContain("PT");
	expect(formatDateTime(t, { deviceZone: "America/New_York" })).toContain("PT");
	expect(formatDateTime(t, { deviceZone: "America/New_York" })).toContain("12:00");
});
it("formats numbers with the locale", () => {
	expect(formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe("12,345.6");
});
```

- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/format` → FAIL (module missing).

- [ ] **Step 3: Implement** with `TZDate`/`tz()` from `@date-fns/tz` and `date-fns`
(`startOfWeek` with `weekStartsOn: WEEK_STARTS_ON`, `addHours`); `Intl.DateTimeFormat`
with `timeZone: TIME_ZONE` for display.

- [ ] **Step 4: Run** the same command → PASS.

- [ ] **Step 5: Commit** `git commit -m "Add the format module with Pacific time rules"`

---

### Task 5: Document schemas and display names

**Files:**
- Create: `src/lib/documents/schema.ts`, `src/lib/documents/names.ts`, `src/lib/documents/schema.test.ts`, `src/lib/documents/names.test.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Produces (`schema.ts`, zod 4; types via `z.infer`):
  - `CURRENT_SCHEMA_VERSION = 1`, `GRID_COLUMNS = 12`, `NAME_MAX = 100`
  - `RectSchema`/`Rect` `{ x, y, w, h }` integers, `x ≥ 0`, `y ≥ 0`, `w ≥ 1`, `h ≥ 1`, `x + w ≤ 12`
  - `WidgetInstanceSchema`/`WidgetInstance` `{ id: string; type: string; title: string | null; rect: Rect; minimized?: { restoreRect: Rect }; data: { layers: unknown[] }; options?: Record<string, unknown>; thresholds?: unknown[] }` (`data` is finalized in spec 2)
  - `DashboardBodySchema` `{ widgets: WidgetInstance[]; defaultCollectionId?: string }` (widget ids unique — refine)
  - `DashboardSchema`/`Dashboard` `{ kind: "dashboard"; schemaVersion: 1; id: string (1–64 chars); name: string | null (≤ NAME_MAX); copiedFrom?: string; deletedAt?: string (ISO); version: number (int ≥ 0); createdAt: string (ISO); updatedAt: string (ISO); body: DashboardBody }`
  - `normalizeName(input: string): string | null` — trim, cut to `NAME_MAX`, `""` → `null`
- Produces (`names.ts`):
  - `type DashboardSummary = Pick<Dashboard, "id" | "name" | "copiedFrom" | "createdAt" | "updatedAt" | "deletedAt">`
  - `displayNames(dashboards: DashboardSummary[], starterId: string): Map<string, string>` — text names as-is; `null` names become `m.dashboard_untitled()` or, when `copiedFrom === starterId`, `m.dashboard_my()`; within each generated group, numbered by `createdAt` from the second one on (`m.dashboard_untitled_numbered({ number })`, `m.dashboard_my_numbered({ number })`)
  - Messages: `dashboard_untitled` "Untitled dashboard", `dashboard_untitled_numbered` "Untitled dashboard {number}", `dashboard_my` "My dashboard", `dashboard_my_numbered` "My dashboard {number}", `dashboard_starter` "Starter dashboard"

- [ ] **Step 1: Write the failing tests**

`schema.test.ts`: a valid dashboard parses; `x: 8, w: 6` fails; duplicate widget ids
fail; `name` of 101 chars fails; `schemaVersion: 2` fails; `normalizeName("   ")` is
`null`; `normalizeName("  Air  ")` is `"Air"`; `normalizeName("a".repeat(150))` has
length 100.

`names.test.ts`:

```ts
it("numbers generated names by creation order", () => {
	const names = displayNames(
		[
			summary({ id: "b", name: null, createdAt: "2026-10-20T02:00:00Z" }),
			summary({ id: "a", name: null, createdAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "c", name: "Air at school" }),
			summary({ id: "d", name: null, copiedFrom: "starter" })
		],
		"starter"
	);
	expect(names.get("a")).toBe("Untitled dashboard");
	expect(names.get("b")).toBe("Untitled dashboard 2");
	expect(names.get("c")).toBe("Air at school");
	expect(names.get("d")).toBe("My dashboard");
});
```

- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/documents` → FAIL.
- [ ] **Step 3: Implement** both files and add the messages.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add dashboard document schemas and display names"`

---

### Task 6: Migration chain and load pipeline

**Files:**
- Create: `src/lib/documents/load.ts`, `src/lib/documents/load.test.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `DashboardSchema`, `CURRENT_SCHEMA_VERSION` (Task 5)
- Produces:
  - `type Migration = { from: number; to: number; migrate(raw: unknown): unknown; schema: z.ZodType }` (`schema` validates the input version)
  - `type LoadResult = { status: "ok"; doc: Dashboard; upgraded: boolean } | { status: "read-only"; reason: "newer" | "invalid"; raw: unknown }`
  - `loadDashboard(raw: unknown, migrations?: Migration[]): LoadResult` — default `migrations` is the app's chain (empty until the format freezes)
  - Messages: `doc_readonly_newer` "This dashboard was saved by a newer version. Reload to edit.", `doc_readonly_invalid` "This dashboard couldn't be read, so it's open read-only."

- [ ] **Step 1: Write the failing tests**

- `current version loads ok, upgraded false`
- `newer schemaVersion loads read-only` (`{ ...valid, schemaVersion: 99 }` → `reason: "newer"`)
- `invalid document loads read-only without throwing` (`{ kind: "dashboard" }`, `null`, `"x"` → `reason: "invalid"`)
- `runs the chain step by step and validates the result` — with a test-only chain `[{ from: 0, to: 1, … }]` that renames a field, a v0 input loads `ok` with `upgraded: true`
- `a migration that produces an invalid document is read-only invalid`
- `missing step is read-only invalid` (input `schemaVersion: -1`)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (read `schemaVersion`; if `>
CURRENT` → newer; walk migrations validating each input with its `schema`; validate the
final result with `DashboardSchema`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the document migration chain and load pipeline"`

---

### Task 7: Widget-type registry, placement, and the placeholder type

**Files:**
- Create: `src/lib/widgets/registry.ts`, `src/lib/widgets/placement.ts`, `src/lib/widgets/placement.test.ts`, `src/lib/widgets/placeholder/index.ts`, `src/lib/widgets/placeholder/Placeholder.svelte`, `src/lib/widgets/placeholder/placeholder.browser.test.ts`
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: `Rect`, `WidgetInstance`, `GRID_COLUMNS` (Task 5); `MenuProvider` type (declare it here in `src/lib/actions/types.ts` as specified in Task 14, created now with only the types)
- Produces:
  - `WidgetType` per `ARCHITECTURE.md` → "Widget-type contract", with `label: () => string` (a message function), `defaultTitle(widget: WidgetInstance): string`, `defaultSize: { w: number; h: number }`, `component: Component<{ widget: WidgetInstance }>`; `accepts`, `resolution`, `dateMethods`, `span`, `placePicker` typed as optional `unknown`-based placeholders for spec 2/step 4
  - `registerWidgetType(t: WidgetType): void`, `getWidgetType(type: string): WidgetType | undefined`
  - `rectsOverlap(a: Rect, b: Rect): boolean`
  - `placeAtBottom(widgets: WidgetInstance[], size: { w: number; h: number }): Rect` → `{ x: 0, y: max(y + h) or 0, w, h }`
  - `readingOrder(widgets: WidgetInstance[]): WidgetInstance[]` — sorted by `y`, then `x`
  - `PLACEHOLDER_TYPE = "placeholder"`; `placeholderType` (`time: "none"`, `analyzable: false`, `thresholds: false`, `minSize { w: 2, h: 2 }`, `defaultSize { w: 6, h: 4 }`, `defaultTitle` → `m.widget_placeholder_title()` "Placeholder widget", `menu` → `[]` until Task 16)
  - `newPlaceholder(widgets: WidgetInstance[]): WidgetInstance` — fresh `crypto.randomUUID()` id, `title: null`, `data: { layers: [] }`, `rect: placeAtBottom(...)`

- [ ] **Step 1: Write the failing tests** (`placement.test.ts`): `rectsOverlap` true for
shared cells, false for edge-touching; `placeAtBottom([], {w:6,h:4})` → `{x:0,y:0,w:6,h:4}`;
with widgets at `{0,0,6,4}` and `{6,0,6,5}` → `y: 5`; `readingOrder` sorts `{6,0}` before
`{0,4}`. Browser test: `Placeholder.svelte` renders `m.widget_placeholder_body()` "This is a
placeholder widget."
- [ ] **Step 2: Run** `npm test -- src/lib/widgets` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the widget-type registry, placement, and placeholder type"`

---

### Task 8: Changes and `applyChange`

**Files:**
- Create: `src/lib/changes/types.ts`, `src/lib/changes/apply.ts`, `src/lib/changes/apply.test.ts`

**Interfaces:**
- Consumes: `Dashboard`, `WidgetInstance`, `normalizeName` (Task 5)
- Produces:
  - `ChangeSchema`/`Change` (zod discriminated union on `op`):
    - `{ op: "addWidget"; target: { widgetId: string }; widget: WidgetInstance; index: number }`
    - `{ op: "removeWidget"; target: { widgetId: string }; widget: WidgetInstance; index: number }`
    - `{ op: "setField"; target: { widgetId?: string; path: "title" | "name" | "deletedAt" }; from: string | null; to: string | null }` (`widgetId` present ⇔ `path === "title"`)
  - `class ChangeTargetMissing extends Error`
  - `applyChange(doc: Dashboard, change: Change): { doc: Dashboard; inverse: Change }` — pure; never mutates `doc`; does not touch `version`/`updatedAt`; `deletedAt: null` removes the field; throws `ChangeTargetMissing` when the widget isn't there (or, for `addWidget`, when its id already exists)

- [ ] **Step 1: Write the failing tests**

- `addWidget inserts at index and inverse removes it` (apply, then apply inverse → deep-equals original)
- `removeWidget inverse restores widget at its index`
- `setField title round-trips; inverse has from/to swapped`
- `setField name on the document`
- `setField deletedAt null removes the key`
- `does not mutate input` (`Object.freeze` deep on input)
- `throws ChangeTargetMissing for unknown widgetId`
- `ChangeSchema rejects title change without widgetId`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the change format and applyChange"`

---

### Task 9: Overlap, rebase, and the undo stack

**Files:**
- Create: `src/lib/changes/overlap.ts`, `src/lib/changes/rebase.ts`, `src/lib/changes/undo.ts`, and a `.test.ts` beside each

**Interfaces:**
- Consumes: `Change`, `applyChange`, `ChangeTargetMissing` (Task 8); `rectsOverlap`, `placeAtBottom` (Task 7)
- Produces:
  - `changesOverlap(a: Change, b: Change): boolean` — true when both are `setField` with the same `widgetId` (or both document-level) and same `path`; or one is `removeWidget` and the other targets the same `widgetId`
  - `type RebaseResult = { kind: "clean"; doc: Dashboard; changes: Change[] } | { kind: "conflict"; pairs: Array<[mine: Change, theirs: Change]> }`
  - `rebase(current: Dashboard, theirs: Change[], mine: Change[]): RebaseResult` — `current` already includes `theirs`. Conflict if any `changesOverlap(m, t)`. Otherwise apply each of `mine` to `current` in order; an `addWidget` whose rect overlaps an existing widget is rewritten with `rect: placeAtBottom(...)` keeping its size; a change hitting `ChangeTargetMissing` is dropped. `changes` are the rewritten changes actually applied.
  - `applyForced(current: Dashboard, changes: Change[]): { doc: Dashboard; applied: Change[] }` — apply in order, skipping `ChangeTargetMissing` and re-placing overlapping adds; used for "Keep mine" (`applyForced(myDoc, theirsNonOverlapping)`)
  - `class UndoStack { push(change: Change, inverse: Change): void; takeUndo(doc: Dashboard): { doc: Dashboard; change: Change; inverse: Change } | null; takeRedo(doc: Dashboard): same | null; canUndo: boolean; canRedo: boolean; clear(): void }` — `takeUndo` applies the top inverse; on `ChangeTargetMissing` it discards that entry and tries the next; a new `push` clears redo

- [ ] **Step 1: Write the failing tests**

- overlap: `same widget same path overlaps`; `same widget different path does not`; `different widgets do not`; `remove vs title edit of that widget overlaps`; `two name edits overlap`
- rebase: `non-overlapping edits merge cleanly`; `overlapping title edits conflict with the pair`; `two adds at the bottom never overlap` (theirs added `{0,4,6,4}`, mine adds `{0,4,6,4}` → mine re-placed at `y: 8`); `my edit to a widget they removed conflicts`
- undo: `undo then redo returns to the same doc`; `undo skips an entry whose widget is gone and runs the next`; `push after undo clears redo`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add overlap detection, rebase, and the undo stack"`

---

### Task 10: Platform adapter — storage

**Files:**
- Create: `src/lib/platform/types.ts`, `src/lib/platform/index.ts`, `src/lib/platform/memory.ts`, `src/lib/platform/web/db.ts`, `src/lib/platform/web/storage.ts`, `src/lib/platform/storage-contract.ts`, `src/lib/platform/memory.test.ts`, `src/lib/platform/web/storage.browser.test.ts`

**Interfaces:**
- Consumes: `Change` (Task 8)
- Produces (`types.ts`):
  - `type SpaceId = "anonymous" | \`account:${string}\``
  - `type LogEntry = { docId: string; version: number; change: Change; tabId: string; schemaVersion: number }`
  - `type CommitInput = { docId: string; baseVersion: number | null; doc: unknown; entries: LogEntry[] }` — `baseVersion: null` = create; the stored `doc` must have `version === last entry's version` (or `0` on create with no entries)
  - `type CommitResult = { ok: true } | { ok: false; currentVersion: number }`
  - `interface DocumentStorage { list(space: SpaceId): Promise<unknown[]>; get(space: SpaceId, id: string): Promise<unknown | undefined>; commit(space: SpaceId, input: CommitInput): Promise<CommitResult>; readLog(space: SpaceId, docId: string, afterVersion: number): Promise<LogEntry[] | "trimmed"> }` — `commit` is atomic: refuses when the stored version ≠ `baseVersion` (or the id exists on create); writes the doc and entries; trims the log to the last `LOG_LIMIT = 500` entries for that doc. `readLog` returns `"trimmed"` if entries after `afterVersion` are no longer complete.
  - `interface PreferenceStorage { get<T>(space: SpaceId, key: string): Promise<T | undefined>; set(space: SpaceId, key: string, value: unknown): Promise<void> }`
  - `interface IdentitySource { currentSpace(): Promise<SpaceId> }` (always `"anonymous"` in spec 1)
  - `type Platform = { documents: DocumentStorage; preferences: PreferenceStorage; identity: IdentitySource }`
- Produces (`index.ts`): `setPlatform(p: Platform): void`, `platform(): Platform` (throws if unset); (`memory.ts`) `createMemoryPlatform(): Platform`; (`web/storage.ts`) `createWebPlatform(): Promise<Platform>`
- `web/db.ts`: database `sjvair-workspace`, version 1, stores `documents` (key `[space, id]`), `changeLog` (key `[space, docId, version]`), `preferences` (key `[space, key]`), and empty reserved stores `originals` and `syncQueue` (same keying as `documents`). Commit runs in one `readwrite` transaction over `documents` + `changeLog`.

- [ ] **Step 1: Write the shared contract suite** — `storage-contract.ts` exports
`runStorageContract(name: string, make: () => Promise<Platform>)` with tests:
`create then get`; `create refuses an existing id`; `commit with stale baseVersion is refused with currentVersion`; `commit appends log entries readable after a version`; `log trims to 500 and reports trimmed`; `spaces are isolated` (same id in `anonymous` and `account:1`); `list returns only that space`; `preferences round-trip per space`.
`memory.test.ts` and `web/storage.browser.test.ts` each call it (the browser one deletes
the database in `beforeEach`).

- [ ] **Step 2: Run** `npm test -- src/lib/platform` → FAIL.
- [ ] **Step 3: Implement** memory first, then IndexedDB with `idb`.
- [ ] **Step 4: Run** → PASS in both projects.
- [ ] **Step 5: Commit** `git commit -m "Add the platform adapter's document and preference storage"`

---

### Task 11: `DocumentSession` — apply, undo, autosave

**Files:**
- Create: `src/lib/store/document-session.svelte.ts`, `src/lib/store/document-session.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 8, 9, 10
- Produces:
  - `type SaveStatus = "saved" | "saving" | "error"`
  - `type Conflict = { pairs: Array<[Change, Change]> }`
  - `class DocumentSession` (runes class):
    - `constructor(opts: { platform: Platform; space: SpaceId; doc: Dashboard; readOnly?: false | "newer" | "invalid"; tabId: string; debounceMs?: number /* 500 */; now?: () => Date; onBeforeFirstEdit?: (change: Change) => Promise<DocumentSession | null> })`
    - `$state` fields: `doc: Dashboard`, `status: SaveStatus`, `readOnly`, `conflict: Conflict | null`; getters `canUndo`, `canRedo`
    - `apply(change: Change): void` — no-op when read-only; applies, pushes undo, queues it as pending, schedules a commit
    - `undo(): void`, `redo(): void` — via `UndoStack`; the applied inverse is queued like any change
    - `flush(): Promise<void>` — commits pending now; sets `version += pending.length`, `updatedAt = now()`; on `{ ok: false }` runs catch-up (Task 12); on a thrown storage error sets `status = "error"` and keeps `doc` and pending
    - `dispose(): void` — flushes and removes listeners
  - `static async open(platform, space, id, tabId): Promise<DocumentSession | null>` — `null` when the id isn't stored; uses `loadDashboard`
  - Registers `pagehide` and `visibilitychange` (hidden) to call `flush()`.

- [ ] **Step 1: Write the failing tests** (memory platform, fake timers)

- `apply updates doc immediately and saves after 500 ms` (status `saving` → `saved`; stored version `1`)
- `several quick edits commit once with consecutive versions`
- `undo and redo are saved too`
- `flushes pending changes on pagehide` (dispatch `pagehide` on a stubbed `window`; stored doc has the edit before timers advance)
- `failed commit keeps doc and sets status error` (platform whose `commit` throws)
- `read-only session refuses apply` (`readOnly: "newer"`; `apply` leaves `doc` unchanged and stores nothing)
- `stored log entries carry tabId and schemaVersion 1`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add DocumentSession with undo and autosave"`

---

### Task 12: Cross-tab sync and conflicts

**Files:**
- Create: `src/lib/store/tab-channel.ts`, `src/lib/store/cross-tab.test.ts`
- Modify: `src/lib/store/document-session.svelte.ts`

**Interfaces:**
- Consumes: Tasks 9–11
- Produces:
  - `type TabMessage = { type: "committed"; space: SpaceId; docId: string; version: number; tabId: string }`
  - `interface TabChannel { post(msg: TabMessage): void; subscribe(fn: (msg: TabMessage) => void): () => void }`; `createTabChannel(): TabChannel` (`BroadcastChannel("sjvair-workspace")`; a no-op channel when unavailable); `createMemoryTabHub(): { channel(): TabChannel }` for tests
  - `DocumentSession` gains `channel: TabChannel` in its options; after each successful commit it posts `committed`
  - `catchUp(): Promise<void>` (called on a `committed` message from another tab for this doc, on a version gap, on `visibilitychange` → visible, and after a refused commit): reads the log after the session's version; if `"trimmed"`, reloads the stored doc and replays pending via `rebase`; with no pending changes, fast-forwards by applying their changes; with pending changes, `rebase(storedDoc, theirs, pending)` → clean: commit the rewritten changes; conflict: set `conflict`
  - `resolveConflict(choice: "keep-mine" | "use-other" | "save-copy"): Promise<string | null>` — keep-mine: `applyForced(myDoc, theirsNonOverlapping)` committed on top of the stored version; use-other: drop pending, load stored; save-copy: create a new dashboard from this tab's doc (new id, `copiedFrom` = this id, `version: 0`, same name), load stored here, return the new id

- [ ] **Step 1: Write the failing tests** (two sessions on one memory platform and hub)

- `a change in tab A appears in tab B`
- `edits to different widgets in both tabs merge with no prompt`
- `same-field edits in both tabs raise a conflict in the later tab`
- `keep-mine keeps my title and their other edits`
- `use-other drops my pending change`
- `save-copy creates a copy with copiedFrom and leaves the original as stored`
- `two tabs adding widgets never overlap` (final stored doc has no two overlapping rects)
- `a tab behind a trimmed log reloads and replays its own pending changes`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add cross-tab sync with replay and conflict choices"`

---

### Task 13: Starter dashboard, dashboard index, and home resolution

**Files:**
- Create: `src/lib/starter/starter.ts`, `src/lib/starter/starter.test.ts`, `src/lib/store/dashboard-index.svelte.ts`, `src/lib/store/dashboard-index.test.ts`, `src/lib/store/app.svelte.ts`

**Interfaces:**
- Consumes: Tasks 5, 7, 10–12
- Produces:
  - `STARTER_ID = "starter"`; `starterDashboard(): Dashboard` — fixed, schema-valid: `name: null`, three placeholders `{0,0,6,4}`, `{6,0,6,4}`, `{0,4,12,4}` with ids `starter-1…3`, `version: 0`, fixed `createdAt`/`updatedAt` `"2026-10-20T00:00:00Z"`
  - `copyOfStarter(now: Date): Dashboard` — new id, `copiedFrom: STARTER_ID`, `name: null`, `version: 0`, timestamps `now`
  - `blankDashboard(now: Date): Dashboard`; `duplicateDashboard(source: Dashboard, now: Date): Dashboard` (same name, `copiedFrom: source.id`, new id, version 0)
  - `resolveHome(summaries: DashboardSummary[], lastOpened: string | undefined): { kind: "starter" } | { kind: "dashboard"; id: string }` — ignores deleted; last-opened if present and not deleted; else most recent `updatedAt`; else starter
  - `class DashboardIndex` (runes): `items: DashboardSummary[]` (not deleted), `names: Map<string,string>` (from `displayNames`), `refresh(): Promise<void>` (also on any `committed` message), `createBlank()`, `createFromStarter()`, `duplicate(id)` → each `Promise<string>` (new id)
  - `app.svelte.ts`: `type AppContext = { platform: Platform; space: SpaceId; tabId: string; channel: TabChannel; index: DashboardIndex; sessions: { get(id: string): Promise<DocumentSession | null> }; current: { session: DocumentSession | null; isStarter: boolean } }`; `initApp(platform: Platform): Promise<AppContext>`; `useApp(): AppContext` (Svelte context)
  - Starter session: a `DocumentSession` over `starterDashboard()` whose `onBeforeFirstEdit` creates `copyOfStarter`, applies the change there, commits, and returns the new session, which replaces `app.current.session` (with `isStarter: false`) before the page navigates; the starter itself is never stored. Preference key `lastOpened` is set whenever a dashboard opens.

- [ ] **Step 1: Write the failing tests**

- `starter is schema-valid and has three placeholders`
- `resolveHome`: `no dashboards → starter`; `last-opened wins`; `deleted last-opened falls back to most recently updated`; `missing last-opened falls back`; `all deleted → starter`
- `first edit of the starter creates a stored copy with copiedFrom starter and the edit applied`; `the starter stays unchanged`; `undo after the copy reverts the edit but the copy remains`
- `index lists new dashboards and numbers untitled ones`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the starter dashboard, dashboard index, and home resolution"`

---

### Task 14: Action registry and context-menu host

**Files:**
- Create: `src/lib/actions/resolve.ts`, `src/lib/actions/scope.ts`, `src/lib/actions/resolve.browser.test.ts`, `src/lib/components/menu/ContextMenuHost.svelte`, `src/lib/components/menu/MenuItems.svelte`, `src/lib/components/menu/context-menu.browser.test.ts`
- Modify: `src/lib/actions/types.ts` (from Task 7)
- Install: `npx shadcn-svelte@latest add context-menu dropdown-menu dialog input label sonner`

**Interfaces:**
- Produces (`types.ts`): `MenuItem`, `MenuContext`, `MenuProvider` exactly as in `ARCHITECTURE.md` → "Actions & context menu" (`label: string` rendered at resolution from a message)
- Produces (`scope.ts`): `menuScope(provider: MenuProvider): Attachment` (registers in a module `WeakMap<Element, MenuProvider>`, removed on teardown); `providerFor(el: Element): MenuProvider | undefined`
- Produces (`resolve.ts`): `resolveMenu(target: Element, ctx: Omit<MenuContext, "target">): MenuItem[]` — walks `parentElement` from `target`, calls each provider, merges most specific first, drops outer items whose `id` an inner one already has, keeps group order of first appearance; `groupItems(items: MenuItem[]): MenuItem[][]`
- `ContextMenuHost.svelte`: wraps children in one bits-ui `ContextMenu`; computes items on open from the event target; renders groups with separators and submenus via `MenuItems.svelte`; also exports `openMenuFor(target: Element)` for the ⋯ buttons (renders the same items in a `DropdownMenu`)

- [ ] **Step 1: Write the failing tests**

`resolve.browser.test.ts` (real DOM elements): `inner items come first`; `inner id
overrides outer`; `elements without providers are skipped`; `groups keep first-seen
order`. `context-menu.browser.test.ts`: right-click inside a scope shows its items;
`Shift+F10` on a focused element opens the same menu; selecting an item calls `run`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the action registry and context-menu host"`

---

### Task 15: App shell, routes, picker, Saved indicator, undo/redo

**Files:**
- Create: `src/lib/components/shell/{TopNav,DashboardPicker,SavedIndicator,UndoRedo}.svelte`, `src/lib/components/shell/shell.browser.test.ts`, `src/routes/{Home,DashboardPage,DashboardList,NotFound}.svelte` (DashboardPage/List bodies filled in Tasks 16–17), `src/lib/actions/global.ts`
- Modify: `src/App.svelte`, `src/router.ts`, `src/main.ts`, `messages/en.json`

**Interfaces:**
- Consumes: Tasks 13, 14
- Produces:
  - Routes (`base: "/workspace"`): `/` → `Home` (resolves via `resolveHome`; renders the starter in place, or `navigate` with `replace` to `/dashboards/:id`), `/dashboards` → `DashboardList`, `/dashboards/:id` → `DashboardPage`, `*` → redirect to `/` (trimmed paths per "Routing"; e.g. `/dashboards/:id/widgets` → `/dashboards/:id`)
  - `main.ts`: `setPlatform(await createWebPlatform())`, `initApp`, mount `App` with the context, register `<Toaster />`
  - `globalActions(app: AppContext): MenuProvider` — Undo (`Ctrl+Z`), Redo (`Ctrl+Shift+Z`), disabled when unavailable; provided on the app root
  - A window `keydown` handler for the shortcuts that ignores events from `input`, `textarea`, `select`, and `[contenteditable]`
  - `TopNav`: `m.app_name()`, a "Dashboards" link, `DashboardPicker`, then right-aligned `SavedIndicator` (`aria-live="polite"`; texts `m.saving()` "Saving…", `m.saved()` "Saved", `m.save_failed()` "Couldn't save") and `UndoRedo` (two icon buttons with `aria-label`s `m.undo()`/`m.redo()`)
  - `DashboardPicker`: a `DropdownMenu` listing `index.items` with `index.names` (current marked with a check and `aria-current`), then the registered dashboard actions (Task 16 supplies them; until then render the list and an "All dashboards" link), then `m.all_dashboards()`
  - Page titles: `document.title` = `m.page_title({ name })` "{name} · SJVAir Workspace" per dashboard; `m.page_title_list()` for the list

- [ ] **Step 1: Write the failing tests** (`shell.browser.test.ts`, memory platform)

- `nav shows the app name, picker, saved status, and undo/redo`
- `undo shortcut ignored in text inputs` (focus an `<input>`, press `Ctrl+Z`, session `canUndo` still true)
- `undo button undoes the last change and is disabled when nothing to undo`
- `picker lists dashboards by display name with the current one marked`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run dev`, `/workspace/` shows the starter (grid comes in Task 16).
- [ ] **Step 5: Commit** `git commit -m "Add the app shell, routes, picker, and save status"`

---

### Task 16: Dashboard page — grid, widgets, actions, starter hint

**Files:**
- Create: `src/lib/components/dashboard/{DashboardGrid,WidgetFrame,EmptyState,StarterHint,AddWidgetButton}.svelte`, `src/lib/components/dialogs/RenameDialog.svelte`, `src/lib/actions/{dashboard,widget}.ts`, `src/lib/components/dashboard/dashboard.browser.test.ts`
- Modify: `src/routes/DashboardPage.svelte`, `src/routes/Home.svelte`, `src/lib/widgets/placeholder/index.ts` (menu), `src/lib/components/shell/DashboardPicker.svelte`, `messages/en.json`

**Interfaces:**
- Consumes: Tasks 7, 11–15
- Produces:
  - `dashboardActions(app: AppContext): MenuProvider` — groups: `add` (Add widget), `create` (New blank dashboard, New from starter), `manage` (Duplicate, Rename…, Delete dashboard). Delete applies `setField deletedAt = now`, navigates to `resolveHome` of the rest, and shows a toast `m.dashboard_deleted()` "Dashboard deleted" with action `m.undo()` that applies the inverse and navigates back. Duplicate navigates to the copy and opens the rename dialog with the text selected. New-from-starter navigates to the copy.
  - `widgetActions(app: AppContext, widgetId: string): MenuProvider` — Rename…, Duplicate (adds a copy with a new id, `placeAtBottom`), Delete (with toast + undo)
  - `openRename(opts: { title: string; initial: string; onSave(value: string | null): void })` via `RenameDialog` (input `maxlength=100`, value passed through `normalizeName`)
  - `DashboardGrid`: CSS Grid with `grid-template-columns: repeat(12, minmax(0, 1fr))`, `grid-auto-rows: var(--grid-row-height)`, gap `var(--grid-gap)`; each widget at `grid-column: x+1 / span w; grid-row: y+1 / span h`; below the `md` breakpoint a single column in `readingOrder` with each widget's height from `h`; the whole grid is a `menuScope(dashboardActions)` inside `ContextMenuHost`
  - `WidgetFrame`: title bar (the title or `type.defaultTitle`, and a ⋯ button with `aria-label` `m.widget_menu({ title })` that opens the same items), body renders `type.component`; `menuScope(widgetActions)`; focusable title bar
  - `EmptyState`: `m.dashboard_empty()` "This dashboard is empty." and an Add widget button
  - `StarterHint`: `m.starter_hint()` "This is the starter dashboard. Any change saves it as your own." (shown only for the starter)
  - After the starter's first edit: `navigate("/dashboards/:id", { replace: true })` and toast `m.starter_copied()` "Saved as your own dashboard"
  - Unknown id on `/dashboards/:id`: `m.dashboard_not_here()` "This dashboard isn't saved in this browser." with a link `m.your_dashboards()` to `/dashboards`; read-only docs show the Task 6 messages above the grid and disable editing actions

- [ ] **Step 1: Write the failing tests** (`dashboard.browser.test.ts`)

- `widgets render at their grid positions` (computed `grid-column-start` of `{6,0,6,4}` is `7`)
- `add widget appends a placeholder at the bottom`
- `widget ⋯ menu and right-click show the same items`
- `rename widget to blank shows the generated title`
- `delete widget shows a toast whose undo restores it`
- `editing the starter creates a copy, replaces the URL, and shows the toast`
- `empty dashboard shows the empty state`
- `read-only dashboard shows the message and no edit actions`

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the dashboard grid, widget frames, and dashboard actions"`

---

### Task 17: Dashboards list page and conflict dialog

**Files:**
- Create: `src/lib/components/dialogs/ConflictDialog.svelte`, `src/routes/dashboard-list.browser.test.ts`
- Modify: `src/routes/DashboardList.svelte`, `src/routes/DashboardPage.svelte`, `messages/en.json`

**Interfaces:**
- Consumes: Tasks 12, 13, 16
- Produces:
  - `DashboardList`: heading `m.page_title_list()` "Your dashboards"; one row per `index.items` (display name, `formatDate(updatedAt)`), each a link plus a ⋯ menu with the dashboard actions for that id; New blank / New from starter buttons; when empty, `m.no_dashboards()` "You don't have any dashboards yet." with both buttons
  - `ConflictDialog`: opens when `session.conflict` is set; text `m.conflict_body()` "This dashboard was changed in another tab while you were editing the same thing."; buttons `m.conflict_keep_mine()` "Keep mine", `m.conflict_use_other()` "Use the other version", `m.conflict_save_copy()` "Save mine as a copy" → `resolveConflict`; save-copy navigates to the new id

- [ ] **Step 1: Write the failing tests**: `list shows dashboards by display name, newest first`; `empty list offers both create buttons`; `conflict dialog choices call resolveConflict` (session stub).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the dashboards list and the conflict dialog"`

---

### Task 18: End-to-end finish line, accessibility, and the full CI run

**Files:**
- Create: `e2e/finish-line.spec.ts`, `e2e/cross-tab.spec.ts`, `e2e/a11y.spec.ts`
- Delete: `e2e/smoke.spec.ts`, `src/lib/smoke.browser.test.ts`
- Modify: `TODO.md` (mark spec 1 items done under "Release 1, step 1: Foundations"), `CLAUDE.md` (Key Libraries: move installed ones out of "Planned"; remove `@sjvair/monitor-map` from installed), `ARCHITECTURE.md` (Tech stack "Current" list to match)

**Interfaces:**
- Consumes: the whole app.

- [ ] **Step 1: Write the E2E tests**

`finish-line.spec.ts`:
- `first visit shows the starter with the hint`
- `editing the starter makes my own copy` (rename a widget → URL matches `/workspace/dashboards/[0-9a-f-]{36}$`, toast visible, hint gone)
- `add widgets, rename, reload, everything is still there`
- `edit then immediate reload keeps the edit` (rename, then `page.reload()` with no wait)
- `undo and redo with the keyboard and buttons`
- `new blank dashboard, duplicate (rename dialog opens), delete with undo`

`cross-tab.spec.ts` (two pages in one context): `a rename in one tab appears in the other`;
`same widget renamed in both tabs within the save window shows the conflict dialog`.

`a11y.spec.ts`: axe with the Task 3 tags, zero violations on: the starter, a dashboard with
widgets, an empty dashboard, the picker open, the context menu open, the rename dialog,
the list page. Also `the context menu opens with Shift+F10 on a focused widget title bar`.

- [ ] **Step 2: Run** `npm run test:e2e` → Expected: all pass on Chromium. Fix failures in
the owning task's code, re-running that task's tests too.

- [ ] **Step 3: Run three engines locally** `npm run test:e2e:podman` → Expected: all pass
on Chromium, Firefox, WebKit.

- [ ] **Step 4: Full checks**

Run: `npm run format && npm run lint && npm run check && npm test && npm run build`
Expected: all pass. `grep -rnE "localStorage|indexedDB\.|new BroadcastChannel" src --include=*.ts --include=*.svelte | grep -v "src/lib/platform/\|src/lib/store/tab-channel.ts"`
→ no output.

- [ ] **Step 5: Update the docs and commit**

```bash
git add -A && git commit -m "Add the finish-line, cross-tab, and accessibility E2E tests"
```

- [ ] **Step 6: Push and open the PR into `foundations`** (not `main`), then start the
full CI run on the branch with `gh workflow run ci.yml --ref foundations-1-core` and
confirm `e2e-full` passes on all three engines. The PR description lists anything the
spec marked _builder's call_ and what was chosen. Do not merge; the user decides.
