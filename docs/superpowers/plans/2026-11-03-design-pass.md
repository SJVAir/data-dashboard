# Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the SJVAir Dashboard its finished look (light and dark, with a switch), the in-between
density, the brand assets, and the wording and behavior fixes parked for the design pass.

**Architecture:** Almost everything is token values in `src/app.css` plus small component changes.
Dark mode works in CSS alone for "System"; a saved override is a `data-theme` attribute set by
`bootstrap.ts` from a new synchronous platform capability. Part 2 fixes wording and small behaviors
in place, all strings through Paraglide.

**Tech Stack:** Svelte 5 (runes), Tailwind CSS v4, shadcn-svelte/bits-ui, Paraglide, Vitest (unit +
browser mode), Playwright + axe, color2k, sharp (dev, already installed through enhanced-img).

**Spec:** `docs/superpowers/specs/2026-11-03-design-pass-design.md` (approved 2026-11-03). Read it
first; this plan argues from it.

## Global Constraints

- Two stacked PRs: **PR 1** is branch `design-pass` (Tasks 1–10) into `main`; **PR 2** is branch
  `design-pass-wording` (Tasks 11–21, branched from `design-pass`) into `design-pass`. Merging either
  needs the user's explicit yes.
- No Claude or AI attribution in commits or PRs.
- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit; Svelte 5
  runes only.
- **No hardcoded colors, sizes, radii, or durations in components**: tokens only (Task 9 enforces).
- **Never call `localStorage` (or other browser storage) outside `src/lib/platform/`.**
- **All UI text through Paraglide** (`messages/en.json`, snake_case keys); no concatenated
  sentences; dates and numbers through `$lib/format`.
- **Sky blue (`#1fb9ef`) is never text** and never the only boundary of a control.
- **No UI color in the health-level hues** (EPA levels, heat, smoke, fire, forecasts): no greens,
  yellows, oranges, reds, purples, or maroons for success/warning/info states. Destructive red only
  with text or an icon.
- Level swatches keep their outline and label in both modes; text on level colors uses
  `readableColor` (`src/lib/color.ts`).
- WCAG 2.2 AA in both modes; text never under 12px; click targets ≥ 24×24px (touch handles 44px).
- `prefers-reduced-motion` still turns motion off, including anything new.
- Inline scripts are not allowed (CSP). `bootstrap.ts` and anything it imports stay in plain syntax
  (no optional chaining, no `??`), like `browser-floor.ts`.
- Nothing is live: layout defaults, the starter, and stored shapes may change freely; tests follow.

## Decided values (from the spec and the mockups, converted to oklch)

Tokens stay `oklch(L C H)` (the manifest plugin parses `--primary` and `--background` that way).

| Token                         | Light (hex → oklch)                     | Dark (hex → oklch)                     |
| ----------------------------- | --------------------------------------- | -------------------------------------- |
| `--background` (page)         | `#f2f6fa` → `oklch(0.971 0.007 247.9)`  | `#0b1626` → `oklch(0.199 0.036 257.7)` |
| `--card`, `--popover`         | `#ffffff` → `oklch(1 0 0)`              | `#13223a` → `oklch(0.252 0.05 259.4)`  |
| `--foreground` (+ card/popover fg) | `#0f2340` → `oklch(0.257 0.061 257.8)` | `#e6eef7` → `oklch(0.946 0.015 251.2)` |
| `--primary`                   | `#1c4482` → `oklch(0.394 0.114 259.1)`  | `#6fb3ea` → `oklch(0.743 0.106 244.3)` |
| `--primary-foreground`        | white                                   | `#0b1626`                              |
| `--link` (new)                | `#1f6fae` → `oklch(0.527 0.124 247.4)`  | `#7cc4f5` → `oklch(0.791 0.101 239.5)` |
| `--highlight` (new; sky)      | `#1fb9ef` → `oklch(0.736 0.139 229)`    | same                                   |
| `--highlight-subtle` (new; selected tab bg) | `#e3f5fd` → `oklch(0.959 0.022 226.1)` | `#0f3b52` → `oklch(0.335 0.062 236.1)` |
| `--highlight-foreground` (new; text on it) | `#0b4f6c` → `oklch(0.403 0.079 233.2)` | `#cdeefc` → `oklch(0.93 0.039 225.3)` |
| `--muted-foreground`          | `#5d6f86` → `oklch(0.536 0.042 254.7)`  | `#9fb2c8` → `oklch(0.756 0.038 252.2)` |
| `--secondary`, `--muted`, `--accent` | `#eaf0f6` → `oklch(0.952 0.01 247.9)` | `#1b2c47` (builder converts)      |
| `--border`, `--input`         | `#dbe4ee` → `oklch(0.915 0.017 250.9)`  | `#24364f` → `oklch(0.33 0.05 256.7)`   |
| `--card-border` (new)         | `#e3eaf2` → `oklch(0.934 0.013 251.6)`  | `#24364f`                              |
| `--ring` (focus, sky)         | `--highlight`                           | `--highlight`                          |
| `--ring-edge` (new)           | `--primary`                             | `--background`                         |
| `--destructive`               | `#b42318` → `oklch(0.5 0.182 29.5)`     | `#f97066` → `oklch(0.709 0.17 26.5)`   |
| `--chart-1…5`                 | navy `#1c4482`, link `#1f6fae`, teal `#0f766e`, slate `#475569`, indigo `#4338ca` | `#8fb8ff`, `#7cc4f5`, `#2dd4bf`, `#cbd5e1`, `#a5b4fc` |
| `--shadow-card` (new)         | `0 1px 2px #1c448212, 0 4px 14px #1c448214` | `0 1px 2px #0006`                  |
| `--overlay` (new; dialog backdrop) | `oklch(0.257 0.061 257.8 / 10%)`   | `oklch(0 0 0 / 40%)`                   |
| `--radius` (cards)            | `0.75rem` (12px)                        |                                        |
| `--radius-control` (new; buttons, inputs) | `0.5rem` (8px)              |                                        |
| `--grid-gap`                  | `0.75rem` (12px)                        |                                        |
| `--card-padding` (new)        | `0.75rem` (12px)                        |                                        |
| Tailwind `--text-xs/sm/base/lg/3xl` | 12px / **13px** / 15px / 18px / 32px (override Tailwind's `@theme` sizes) |       |

Measured contrast (WCAG): text on page 14.5, muted on page 4.74, muted on card 5.14, link on card
5.33, link on page 4.9, white on primary 9.55, tab text 7.98, destructive on card 6.57; dark: text
15.5, muted on card 7.34, link on card 8.4, primary button text 8.05, destructive 5.72; chart series
light 5.3–9.6 on white, dark 6.0–10.7 on the dark card. Sky on white is 2.27 (never text). EPA purple
and maroon on the dark card are 2.5 and 1.45, so their swatch outline (`--swatch-outline-color`,
which follows `--foreground`) carries the 3:1 boundary.

## Review Focus

1. **Theme switch in two tabs:** switching in one tab should switch the other open tabs too (the
   choice is per device). Pinned in Task 3 (`storage` event) and Task 4.
2. **System theme changing while the page is open** (OS goes dark at sunset): the page, the
   `theme-color` meta follow without a reload. Pinned in Task 3.
3. **Blocked storage** (private mode, storage disabled): the switch still works for the session and
   the app never fails to boot. Pinned in Task 3.
4. **Phone width with the new density:** four-across is a laptop default; on a phone the grid is
   one column and nothing overflows or drops under 24px targets. Pinned in Task 6.
5. **Level swatches on dark cards** (EPA purple/maroon): visibly outlined and labelled. Pinned in
   Task 10.

---

## Part 1: the look (PR 1, branch `design-pass`)

### Task 1: Light color, shape, and type tokens, with a contrast test

**Files:**
- Modify: `src/app.css` (the `@theme` block and `:root`)
- Create: `src/lib/theme/tokens.ts` (reads token blocks from `app.css` text, for tests)
- Create: `src/lib/theme/contrast.test.ts`

**Interfaces:**
- Produces: `readTokens(css: string, block: "light" | "dark-system" | "dark-override"): Record<string, string>`
  and `contrast(a: string, b: string): number` (oklch or hex in; uses `oklchToHex` from
  `vite-plugins/web-manifest.ts` and color2k's `getContrast`). Task 2 extends the test to dark.

- [ ] **Step 1: Write the failing test** `contrast.test.ts` → `describe("light tokens")`, one `it` per
  pair, asserting `contrast(...) >= min`: foreground/background 4.5, foreground/card 4.5,
  muted-foreground/background 4.5, muted-foreground/card 4.5, link/card 4.5, link/background 4.5,
  primary-foreground/primary 4.5, highlight-foreground/highlight-subtle 4.5, destructive/card 4.5,
  ring/card 3, ring-edge/card 3, each chart-1…5 against card 3. Plus `it("sky blue stays a highlight")`:
  `contrast(highlight, card) < 3` documents why it's never text.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/theme/contrast.test.ts` → FAIL (no tokens).
- [ ] **Step 3: Set the light values** from "Decided values" in `:root`; add the new tokens and their
  `--color-*` aliases in `@theme` (`--color-link`, `--color-highlight`, `--color-highlight-subtle`,
  `--color-highlight-foreground`, `--color-card-border`, `--color-overlay`); set `--radius`, add
  `--radius-control`, `--shadow-card` (as `--shadow-card` in `@theme` so `shadow-card` works),
  `--card-padding`; override `--text-xs/sm/base/lg/3xl` (with matching line heights). Implement
  `tokens.ts` (plain regex over the named block; scoping `:root` blocks correctly is the point).
- [ ] **Step 4: Run** the test → PASS. Run `npm run check` → no errors.
- [ ] **Step 5: Commit** `git commit -m "Design pass: light color, shape, and type tokens"`.

### Task 2: Dark tokens and wiring (System in CSS, overrides by attribute)

**Files:**
- Modify: `src/app.css` (replace `@custom-variant dark` and the `.dark` block)
- Modify: `src/lib/theme/contrast.test.ts`

**Interfaces:**
- Produces: the attribute contract `document.documentElement.dataset.theme` ∈ `"light" | "dark"` or
  absent (= System). Task 3 sets it.

- [ ] **Step 1: Extend the test:** run the same pair list for the dark tokens (`readTokens(css,
  "dark-system")`), and `it("both dark blocks are identical")`: `dark-system` deep-equals
  `dark-override`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Wire it.** Dark values from "Decided values" go in two identical blocks:
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and
  `:root[data-theme="dark"] { … }`. Replace the variant with a block `@custom-variant dark` that
  matches both (Tailwind v4 `@slot` form). Set `color-scheme: light` on `:root`, `dark` in both dark
  blocks. Remove the old `.dark` block.
- [ ] **Step 4: Run** the test → PASS; `npm run test:browser` → no regressions.
- [ ] **Step 5: Commit** `"Design pass: dark tokens following the system, with an override attribute"`.

### Task 3: The theme preference capability and startup apply

**Files:**
- Modify: `src/lib/platform/types.ts` (add `DisplayPreferences`, `Platform.display`)
- Create: `src/lib/platform/web/theme.ts`, `src/lib/platform/web/theme.test.ts`
- Modify: `src/lib/platform/web/storage.ts` (wire `display`), `src/lib/platform/memory.ts` (memory
  version), `src/bootstrap.ts`

**Interfaces:**
- Produces:
  - `type ThemeChoice = "light" | "dark" | "system"` (in `types.ts`).
  - `interface DisplayPreferences { theme(): ThemeChoice; setTheme(choice: ThemeChoice): void;
    onThemeChange(listener: (choice: ThemeChoice) => void): () => void }` on `Platform.display`.
  - In `web/theme.ts` (plain syntax): `readThemeChoice(storage: Storage | null): ThemeChoice`,
    `writeThemeChoice(storage: Storage | null, choice: ThemeChoice): void`,
    `applyTheme(root: HTMLElement, choice: ThemeChoice): void` (sets/removes `data-theme`, then
    `syncThemeColor`), `syncThemeColor(doc: Document): void` (creates or updates
    `<meta name="theme-color">` from the computed `--background`), `watchSystemTheme(doc: Document):
    () => void` (matchMedia change → `syncThemeColor`). Storage key `sjvair-workspace:theme`.
- Consumes: Task 2's attribute contract.

- [ ] **Step 1: Write failing tests** in `theme.test.ts`: `readThemeChoice` returns `"system"` for
  null storage, a missing key, an unknown value, and a storage whose `getItem` throws; round-trips
  each choice through `writeThemeChoice`; `writeThemeChoice` swallows a throwing `setItem`;
  `applyTheme` sets `data-theme="dark"`, sets `"light"`, and removes it for `"system"`; the web
  `display.onThemeChange` fires on a `storage` event for the key from another tab (dispatch a
  `StorageEvent`) and not for other keys; the memory platform's `display` round-trips and notifies;
  `watchSystemTheme` updates the `theme-color` meta when a stubbed `matchMedia("(prefers-color-scheme: dark)")`
  fires `change`, and its returned function stops it.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/platform/web/theme.test.ts` → FAIL.
- [ ] **Step 3: Implement** the module, the memory version, and `Platform.display` in both factories;
  in `bootstrap.ts`, before `import("./main")`: `applyTheme(document.documentElement,
  readThemeChoice(safeLocalStorage()))` and `watchSystemTheme(document)`, where `safeLocalStorage`
  lives in `web/theme.ts` and returns `null` when access throws.
- [ ] **Step 4: Run** the test → PASS; `npm run check`; `npm run test:unit`.
- [ ] **Step 5: Commit** `"Design pass: per-device theme choice through the platform adapter"`.

### Task 4: The Light / Dark / System switch, and the Help menu's link cue

**Files:**
- Create: `src/lib/store/theme.svelte.ts`
- Modify: `src/lib/components/shell/HelpMenu.svelte`, `messages/en.json`
- Test: `src/lib/components/shell/help-menu.browser.test.ts` (create)

**Interfaces:**
- Consumes: `platform().display` (Task 3), `applyTheme` (Task 3).
- Produces: `themeState` with `choice: ThemeChoice` ($state) and `set(choice: ThemeChoice): void`
  (writes through `platform().display`, applies, and follows `onThemeChange` from other tabs).

- [ ] **Step 1: Write failing browser tests:** the Help menu shows an "Appearance" radio group with
  Light, Dark, System (System checked by default, using the memory platform); choosing Dark sets
  `data-theme="dark"` on `<html>` and stores `"dark"`; a theme change from another tab (memory
  platform notify) updates the checked item; the feedback link's accessible name includes "(opens
  in a new tab)" and it shows an external-link icon.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/components/shell/help-menu.browser.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `DropdownMenu.RadioGroup` (+ `DropdownMenu.Label`), Lucide `Sun`,
  `Moon`, `Monitor` icons, `ExternalLink` on the feedback item. New messages: `theme_label`
  ("Appearance"), `theme_light` ("Light"), `theme_dark` ("Dark"), `theme_system` ("Match my
  device"), `opens_in_new_tab` ("(opens in a new tab)", visually hidden).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: Light / Dark / System switch in the Help menu"`.

### Task 5: Restyle components through the tokens (shape, focus, motion)

**Files:**
- Modify: `src/lib/components/ui/**` as needed (button, dropdown-menu, dialog incl.
  `dialog-overlay.svelte`, popover, input, sonner), `src/lib/components/dashboard/WidgetFrame.svelte`,
  `DashboardGrid.svelte`, the taskbar, `src/lib/components/shell/TopNav.svelte`,
  `AccountMenu.svelte`, `src/app.css` (`@layer base`)
- Test: existing browser tests; `src/lib/components/shell/shell.browser.test.ts` (one new test)

- [ ] **Step 1: Write a failing test** in `shell.browser.test.ts`: the current page's nav link has
  `aria-current="page"` and a computed `box-shadow`/border using `--highlight` (assert the class
  `shadow-[inset_0_-2px_var(--color-highlight)]` or equivalent token class is present); and the
  account menu's greeting labels sit inside a `[role=group]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Restyle**, all through tokens:
  - Cards (widgets, menus, popovers, dialogs, toasts): `rounded-[var(--radius)]`, 1px
    `border-card-border`, `shadow-card`; widget body padding `p-(--card-padding)`.
  - Buttons and inputs: `rounded-[var(--radius-control)]`; primary navy; secondary white with
    `border` and navy text; ghost hover `bg-secondary`.
  - Tabs/segmented controls and selected items: `bg-highlight-subtle text-highlight-foreground`.
  - Top bar: `bg-card border-b`; current link navy with a 2px `--highlight` underline.
  - Links: `text-link underline`.
  - Focus: one base rule in `@layer base` for `:focus-visible`: 2px `--ring` outline with a 1px
    `--ring-edge` (e.g. `outline` + `box-shadow`), replacing ad-hoc `ring-3`/`ring-ring/50`
    classes where they duplicate it.
  - Dialog overlay: `bg-overlay` (removes the only raw color class).
  - Wrap the account menu's greeting in `DropdownMenu.Group` (DEFERRED, spec 5b polish).
  - Motion: decide whether the `--duration-*`/`--ease-*` `@theme` aliases are used
    (`src/lib/layout/flip.ts` reads the motion tokens); make Tailwind's `duration-fast`/`duration-base`/
    `ease-standard` utilities work and use them for menus, dialogs, toasts, taskbar, minimize and
    restore, or remove the aliases if nothing should use them. Keep the reduced-motion block.
- [ ] **Step 4: Run** `npm run test:browser` and `npm run test:e2e` → PASS (fix selectors that
  depended on old classes, not behavior).
- [ ] **Step 5: Commit** `"Design pass: restyle components through the tokens"`.

### Task 6: Density and four-across defaults

**Files:**
- Modify: `src/app.css` (`--grid-gap`), `src/lib/widgets/placeholder/index.ts` (`defaultSize`),
  `src/lib/starter/starter.ts` (`STARTER_RECTS`), tests that assert starter rects (at least
  `src/lib/starter/starter.test.ts`, `src/lib/components/dashboard/*.browser.test.ts`,
  `src/lib/layout/arrangement.browser.test.ts`, `e2e/*.spec.ts` that count or position starter widgets)

- [ ] **Step 1: Write failing tests:** in `starter.test.ts`, the starter's rects are
  `[{x:0,y:0,w:3,h:4},{x:3,y:0,w:3,h:4},{x:6,y:0,w:6,h:4}]` (three widgets, a four-across row); a new
  placeholder's `rect.w` is 3. In a browser test at `page.viewport(1280, 800)`, the starter's first
  two widgets render ≤ 320px wide; at `page.viewport(390, 844)` every widget spans the full grid
  width (one column) and the widget menu button is ≥ 24px.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** `--grid-gap: 0.75rem`, placeholder `defaultSize: { w: 3, h: 4 }`, the
  starter rects above. Keep `GRID_COLUMNS = 12` and `--grid-row-height: 4rem` unless the new type
  sizes clip the title bar (then adjust the token and say so in the PR).
- [ ] **Step 4: Run** `npm run test` and `npm run test:e2e`; update tests that hard-code the old
  rects (positions only; keep what they prove).
- [ ] **Step 5: Commit** `"Design pass: tighter grid and four-across defaults"`.

### Task 7: Brand assets and the logo in the top bar

**Files:**
- Create: `src/lib/assets/logos/sjvair.svg`, `sjvair-white.svg`, `sjvair-parts/{sjvair-icon,sjvair-sjv,sjvair-air}.webp`,
  `airgradient-blue.svg`, `airnow-compact.jpg`, `carb-compact.jpg`, `purpleair-compact.png`
  (all from `../monitor-map/src/lib/assets/logos/`); `src/lib/assets/icons/ozone/ozone-08-sunrise-haze.svg`,
  `src/lib/assets/icons/pm25/pm25-02-particle-field.svg` (from `../monitor-map/src/lib/assets/icons/`),
  `src/lib/assets/icons/lungs.svg` (from `../monitor-map/static/icons/`)
- Modify: `src/lib/components/shell/TopNav.svelte`
- Test: `src/lib/components/shell/shell.browser.test.ts`

- [ ] **Step 1: Write failing tests:** the home link's accessible name is the app name
  (`m.app_name()`), it contains an `img` with `alt=""` (decorative; the link text names it); at
  desktop width the full logo shows, at 390px the compact mark shows; in dark mode
  (`data-theme="dark"`) the white logo is the visible one.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Copy the files** (`cp`, byte-identical) and render them in `TopNav` via imports
  (`import logo from "$lib/assets/logos/sjvair.svg"`), light/dark with `dark:hidden` /
  `hidden dark:block`, compact on narrow widths; "Dashboard" in navy medium weight beside it; the
  visually hidden app name keeps the link's name. Unused assets (data-source logos, pollutant icons)
  are copied but not imported.
- [ ] **Step 4: Run** → PASS; `npm run build && npm run check:build && npm run check:budget`.
- [ ] **Step 5: Commit** `"Design pass: SJVAir logo and brand assets"`.

### Task 8: App icons, the maskable icon, and the manifest

**Files:**
- Create: `scripts/make-icons.mjs` (sharp; committed as the icons' source), outputs in
  `static-src/icons/`: `icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`
- Modify: `vite-plugins/web-manifest.ts`, `vite-plugins/web-manifest.test.ts`

**Interfaces:**
- Produces: `buildManifest` icons accept `purpose?: "any" | "maskable"`.

- [ ] **Step 1: Write failing tests** in `web-manifest.test.ts`: the manifest lists four icons, two
  with `purpose: "maskable"` at 192 and 512; `lightToken` reads `--primary` from the `:root` block
  even when a dark block earlier in the file defines it too (DEFERRED, spec 5a polish); the theme
  color is the light `--primary` (`#1c4482` ± rounding).
- [ ] **Step 2: Run** `npx vitest run --project unit vite-plugins/web-manifest.test.ts` → FAIL.
- [ ] **Step 3: Implement:** `make-icons.mjs` takes `../mobile/src/assets/icons/icon-512.webp` for the
  regular icons and composes the maskable ones (logo mark scaled to fit inside the central 80% on a
  solid white background); run it once and commit its output. Extend `ICONS` with `purpose`, scope
  `lightToken` to the `:root { … }` block. Also make the dev-route test cover every icon (DEFERRED:
  "E2E test loads only `icons[0]`").
- [ ] **Step 4: Run** the unit test and `npx playwright test e2e/embedding-build.spec.ts` → PASS.
  Check the maskable icon in Chrome DevTools → Application → Manifest (safe-zone preview) and note
  it in the PR.
- [ ] **Step 5: Commit** `"Design pass: SJVAir app icons with a maskable icon"`.

### Task 9: Token discipline check

**Files:**
- Create: `src/lib/theme/token-discipline.test.ts`

- [ ] **Step 1: Write the test:** scans `src/**/*.svelte` and `src/**/*.ts` (excluding `*.test.ts`,
  `src/lib/color.ts`, `src/lib/theme/**`, `src/lib/paraglide/**`) and fails on raw Tailwind palette
  classes (`/\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|shadow|divide)-(?:black|white|
  (?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|
  indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/`) and hex colors (`/#[0-9a-fA-F]{3,8}\b/` in
  `class=` or `style=` contexts), reporting file and line.
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/theme/token-discipline.test.ts` → PASS
  (Task 5 removed `bg-black/10`). If it fails, fix the component, not the test.
- [ ] **Step 3: Add** the rule to `CLAUDE.md` → "Code Style" ("enforced by
  `src/lib/theme/token-discipline.test.ts`").
- [ ] **Step 4: Commit** `"Design pass: test that components use tokens only"`.

### Task 10: Both modes in the end-to-end and axe checks; screenshots; Part 1 docs

**Files:**
- Modify: `e2e/a11y.spec.ts` (and the per-feature axe tests: `arranging.spec.ts` "axe: …",
  `account.spec.ts`), `e2e/helpers.ts`
- Create: `e2e/theme.spec.ts`
- Modify: `ARCHITECTURE.md` ("Theme & style", "Platform strategy", "Accessibility"), `TODO.md`
  ("Release 1: design pass", the "Start here" row, "Release 1, step 4" four-across target),
  `DEFERRED.md`

- [ ] **Step 1: Write failing e2e tests:**
  - `a11y.spec.ts`: wrap the existing tests in `for (const colorScheme of ["light", "dark"] as const)`
    with `test.use({ colorScheme })`; titles get the mode. Same for the per-feature axe tests.
  - `theme.spec.ts`: with `colorScheme: "dark"` and no saved choice, the first paint's `<html>`
    computed background is the dark `--background` (check from `page.on("domcontentloaded")` before
    the app mounts); choosing Light in the Help menu survives a reload with `data-theme="light"` set
    before `#SJVAirDataDashboard` has children (use `page.addInitScript` to record the attribute at
    the first mutation of the mount element); switching in one page updates a second page of the
    same context; with storage blocked (`addInitScript` making `localStorage` throw) the app boots
    and the switch still changes the theme.
  - A level swatch on a dark card has a computed outline width ≥ 1px and its label text is visible
    (use the existing swatch component's test page or fixture).
- [ ] **Step 2: Run** `npx playwright test e2e/theme.spec.ts e2e/a11y.spec.ts --project=chromium` →
  FAIL, then fix what axe reports (values, not rules).
- [ ] **Step 3: Screenshot review:** a temporary script in `e2e-local/` (not committed) captures the
  starter, a dashboard with widgets, the picker, a menu, and a dialog at 1280×800 and 390×844 in both
  modes; attach them to the PR.
- [ ] **Step 4: Docs** per the spec's "Docs to update" (Part 1 items): close the DEFERRED entries this
  part finishes (maskable icon; dark-mode destructive contrast; the `--duration-*` aliases; the 5a
  polish new-tab cue and `lightToken` scoping, the icon-route test; the 5b greeting group), add the
  new ones (livelier motion; family restyle; background flash for saved overrides), each with why and
  a revisit trigger.
- [ ] **Step 5: Run** `npm run lint && npm run check && npm run test && npm run test:e2e:all`
  (or `npm run test:e2e:podman`), `npm run build && npm run check:build && npm run check:budget`
  (report the size in the PR).
- [ ] **Step 6: Commit and open PR 1** `"Design pass, part 1: the look"` into `main` (do not merge).
  Tell the `map-sdk` session (ListAgents / SendMessage) the final token names: shadcn's plus `--link`,
  `--highlight*`, `--card-border`, `--shadow-card`, `--radius-control`, `--chart-1…5`, `--overlay`.

---

## Part 2: wording and behavior (PR 2, branch `design-pass-wording` from `design-pass`)

The rules for every new message (spec → "Wording rules"): plain words; say what happened and what
the person can do next; one message per cause; no blame; informational notices use `toast.info`/
`toast.success`, never `toast.error`. Draft English is given for each new key; the user reviews it in
PR 2. Run `npm run paraglide` after editing `messages/en.json`. DEFERRED line numbers below are as of
2026-11-03 and will drift; find entries by title.

### Task 11: Save status: conflicts and screen-reader announcements

**Files:**
- Modify: `src/lib/components/shell/SavedIndicator.svelte`, `messages/en.json`
- Test: `src/lib/components/shell/storage-status.browser.test.ts`

**Interfaces:**
- Consumes: `session.status: SaveStatus`, `session.conflict` (`src/lib/store/document-session.svelte.ts`
  L13, L99), device holds `app.sync?.states[id]?.hold?.kind === "conflict"`, `announce(message)`
  (`src/lib/a11y/announcer.svelte.ts`).

- [ ] **Step 1: Write failing tests:** with `session.conflict` set (or a device conflict hold), the
  indicator reads "Changed elsewhere" (`save_conflict`), not "Couldn't save", and isn't
  `text-destructive`; the indicator has no `aria-live` of its own; `announce` is called with "Couldn't
  save" when status goes saved → error, with "Saved again" (`save_recovered`) when it goes error →
  saved, with `save_conflict_announce` ("This dashboard was changed somewhere else. Choose which
  version to keep.") when a conflict appears, and is **not** called for saved → saving → saved.
  Update "colour is never the only signal" (L138) to read the visible label instead of `[aria-live]`.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/components/shell/storage-status.browser.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `SavedIndicator.svelte`: the label checks conflict first; an `$effect`
  remembers the previous status and calls `announce` only on those transitions; remove `aria-live`
  from the span. Keep `SaveStatus` as is (conflict is read from `session.conflict`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: conflicts get their own save status; quieter announcements"`.

### Task 12: Share dialog: name errors, retry, read-only reason, download confirmation

**Files:**
- Modify: `src/lib/components/dialogs/ShareDialog.svelte`, `src/lib/sharing/actions.ts`,
  `messages/en.json`
- Test: `src/lib/components/dialogs/share-dialog.browser.test.ts`

**Interfaces:**
- Changes: `ShareOptions.url: string | null` gains `linkUnavailable: "too-big" | "read-only" | null`
  (set by `shareDashboard`: `"read-only"` when `target.readOnly`, `"too-big"` when the link would be
  too long, else `null`).

- [ ] **Step 1: Write failing tests** (fake remote: `fake.refuseNext.push({ code, status })`,
  `fake.offline`, `memory.online.setOnline`):
  - saving a name refused with `rate_limited` shows `share_name_rate_limited` ("You've changed your
    name a lot just now. Wait a minute and try again."); `unauthorized` shows `share_name_signed_out`
    ("You're signed out, so the name wasn't saved. Sign in and try again."); `invalid` still shows
    `share_name_refused`; offline still shows `share_live_offline`.
  - after the name fails to load, a "Try again" button (`share_name_retry`) reloads it, and going
    back online (`setOnline(true)`) reloads it by itself; the field is enabled once loaded.
  - a read-only dashboard's dialog says `share_read_only` ("This dashboard is open read-only, so it
    can't be shared as a link. You can download it as a file instead."), not the too-big text.
  - clicking Download puts `share_downloaded` ("Your file is downloading.") in the dialog's status
    region.
- [ ] **Step 2: Run** `npx vitest run --project browser src/lib/components/dialogs/share-dialog.browser.test.ts` → FAIL.
- [ ] **Step 3: Implement:** branch the `saveName` catch on `RemoteRefusal.code`; add the retry button
  and an `$effect` on `app.platform.online.onChange` while `nameState === "failed"`; choose the note by
  `linkUnavailable`; set the status text after `onDownload()`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: clearer Share dialog messages, with retry and download confirmation"`.

### Task 13: Restore an earlier version: causes, focus, closing, and duplicates

**Files:**
- Modify: `src/lib/safety/restore-version.ts`, `src/lib/components/dialogs/RestoreVersionDialog.svelte`,
  `messages/en.json`
- Test: `src/lib/safety/restore-version.test.ts`, `src/lib/components/dialogs/restore-version.browser.test.ts`

**Interfaces:**
- Changes: `EarlierVersions = { versions: EarlierVersion[]; account: "ok" | "offline" | "gone" | "none" }`
  (replaces `accountUnreachable: boolean`; `"none"` = anonymous or never uploaded). The local entry
  becomes `{ source: "local"; at; alsoInAccount: boolean }`.

- [ ] **Step 1: Write failing tests:**
  - unit: `RemoteUnavailable` from `app.sync.versions` gives `account: "offline"`; a `RemoteRefusal`
    `gone`/`not_found` gives `"gone"`; when the server's `schema` snapshot has the same `version` and
    `schemaVersion` as the kept original (`raw.version`, `fromSchemaVersion`), it's left out and the
    local entry has `alsoInAccount: true`.
  - browser: `"offline"` shows `restore_version_account_offline` ("Versions saved in your account
    can't be loaded while you're offline.") and `"gone"` shows `restore_version_account_gone` ("This
    dashboard is no longer in your account, so only the copy on this device is listed."); a
    `role="status"` element is always in the dialog (empty when idle) and holds the loading text while
    loading; when the list arrives, focus moves to the first radio; while a restore runs, Escape and
    Cancel don't close the dialog; after closing, reopening shows a fresh list with nothing selected
    and no old failure; `alsoInAccount` shows `restore_version_local_and_account` ("Kept on this device
    and in your account").
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** in those two files; block close with `onOpenChange` (refuse `false` while
  busy) and reset module state when it closes. Update `src/lib/actions/dashboard.ts` callers for the
  new type.
- [ ] **Step 4: Run** → PASS; `npm run check`.
- [ ] **Step 5: Commit** `"Design pass: Restore dialog says why, keeps focus, and lists each version once"`.

### Task 14: Recently deleted: honest results and informational toasts

**Files:**
- Modify: `src/lib/sync/trash.ts`, `src/lib/components/dashboard/RecentlyDeleted.svelte`,
  `src/lib/actions/dashboard.ts` (`restoreDeleted`), `messages/en.json`
- Test: `src/lib/sync/trash.test.ts`, `src/lib/components/dashboard/recently-deleted.browser.test.ts`

**Interfaces:**
- Changes: `DeleteResult` adds `"unreadable" | "newer"` (from `readLocal`'s `"invalid"`/`"newer"`;
  `"missing"` stays `"unreachable"` only if that's what it means, else its own `"missing"`).

- [ ] **Step 1: Write failing tests:** a local copy that `readLocal` reports `"invalid"` gives
  `"unreadable"` and the toast `deleted_unreadable` ("This dashboard can't be read on this device, so
  it can't be deleted from your account here. Try from another device, or use Clear my data.");
  `"newer"` gives `deleted_newer` ("This dashboard was saved by a newer version of the app. Reload the
  page, then try again."); `restored-elsewhere` uses `toast.info`; `restoreDeleted`'s read-only notice
  uses `toast.info`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: Recently deleted says what actually happened"`.

### Task 15: Unreadable dashboards in the list and in Clear my data

**Files:**
- Modify: `src/lib/store/dashboard-index.svelte.ts`, `src/routes/DashboardList.svelte`,
  `src/lib/components/dialogs/ClearDataDialog.svelte`, `messages/en.json`
- Test: `src/lib/store/dashboard-index.test.ts`, `src/routes/dashboard-list.browser.test.ts`,
  `src/lib/components/dialogs/clear-data.browser.test.ts`

**Interfaces:**
- Produces: `DashboardIndex.unreadable: Array<{ id: string }>` (stored documents that fail validation
  but have a string `id`) and `DashboardIndex.storedCount: number` (every stored document, readable
  or not, including deleted ones).

- [ ] **Step 1: Write failing tests:** the index lists an invalid document with a string id in
  `unreadable` (and still not in `items`); the list page shows it as a row named
  `dashboard_unreadable` ("A dashboard that can't be opened") with Download (its raw JSON through
  `platform().files.save`) and Delete (removes it from storage, with the usual confirmation); Clear my
  data's count uses `storedCount`.
- [ ] **Step 2: Run** the three files → FAIL.
- [ ] **Step 3: Implement.** Documents without a string id can't be addressed: count them in
  `storedCount`, don't list them.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: list and count dashboards that can't be opened"`.

### Task 16: Names of copies, and pending names

**Files:**
- Modify: `src/lib/documents/names.ts`, `src/lib/store/journal.ts` (or its caller in
  `dashboard-index.svelte.ts` L124–127), `src/lib/components/dialogs/ConflictDialog.svelte`,
  `messages/en.json`
- Test: `src/lib/documents/names.test.ts`, `src/lib/store/dashboard-index.test.ts`,
  `src/routes/dashboard-list.browser.test.ts`

- [ ] **Step 1: Write failing tests:**
  - `displayNames`: an unnamed dashboard whose `copiedFrom` is another listed dashboard displays as
    `dashboard_copy_of` ("Copy of {name}", with that dashboard's display name); two such copies number
    as "Copy of My dashboard 2"; an unnamed copy of the starter is still "My dashboard". Nothing new is
    stored (`name` stays `null`).
  - choosing "Save mine as a copy" opens the copy with the rename dialog (as Duplicate does).
  - a journal-only name `"  Field   trip  "` is listed as `normalizeName`'s result.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; reuse `renameDashboard` from `src/lib/actions/dashboard.ts` for the
  conflict copy; apply `normalizeName` (`src/lib/documents/schema.ts` L81) to `pendingName`'s result.
- [ ] **Step 4: Run** → PASS (update `names.test.ts` "numbers the My dashboard group separately" if
  its expectations move).
- [ ] **Step 5: Commit** `"Design pass: clearer names for copies"`.

### Task 17: Wording for "read-only because the original couldn't be kept"

**Files:**
- Modify: `src/lib/store/document-session.svelte.ts` (`ReadOnly` adds `"unkept"`; `open` L231–232),
  `src/lib/components/dashboard/DashboardGrid.svelte` L291–295, `messages/en.json`; check other
  `ReadOnly` consumers (`DashboardPage.svelte`, `SavedIndicator.svelte`, `sharing/actions.ts`)
- Test: `src/lib/store/document-session.test.ts` (L936), `src/lib/components/dashboard/dashboard.browser.test.ts`

- [ ] **Step 1: Write failing tests:** a failed keep opens with `readOnly === "unkept"`; the grid shows
  `doc_readonly_unkept` ("This dashboard was updated to a new format, but the original couldn't be
  saved on this device, so it's open read-only to keep your work safe. Free up space or download a
  backup, then reload.").
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: its own message for a dashboard whose original couldn't be kept"`.

### Task 18: The "Only on this device" bar

**Files:**
- Modify: `src/lib/components/shell/NoticeBars.svelte` (L30–39, L137–149)
- Test: `src/lib/components/shell/notice-bars.browser.test.ts`

- [ ] **Step 1: Write failing tests:** a refused hold on a dashboard that's in `app.index.deleted`
  isn't counted (and with only such holds the bar doesn't show); on `/dashboards` the bar shows
  without its "See your dashboards" link.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (filter by `app.index.deleted` ids; hide the link
  when `isActive("/dashboards")`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: the device-only bar counts and links correctly"`.

### Task 19: Announcements during dialogs, and new-tab cues everywhere

**Files:**
- Modify: `src/lib/components/a11y/LiveRegion.svelte`, `src/App.svelte` (and the two test harnesses
  that mount `LiveRegion`), `src/lib/components/shell/AccountMenu.svelte` (L147),
  `src/lib/components/dialogs/PrivacyDialog.svelte` (L43), `src/lib/components/shared/MadeByBar.svelte`
  (L16–20)
- Create: `src/lib/components/shared/ExternalLinkCue.svelte` (icon + visually hidden
  `m.opens_in_new_tab()`, from Task 4; Task 4's Help menu switches to it)
- Test: `src/lib/components/a11y/live-region.browser.test.ts` (create), the existing tests of those
  components

- [ ] **Step 1: Write failing tests:** with a bits-ui `Dialog` open, `announce("x")` puts "x" in a live
  region that has no `aria-hidden="true"` ancestor; every `target="_blank"` link in `src/` has the cue
  (a unit test that scans `.svelte` files for `target="_blank"` without `ExternalLinkCue` nearby, or
  per-component browser assertions; builder's choice).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** For the live region, the builder picks the mechanism (for example a
  second region rendered inside each open dialog's content, fed by the same announcer, or
  re-parenting the region into the topmost open portal); one announcement must not be read twice.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Design pass: announcements reach screen readers during dialogs; new-tab cues"`.

### Task 20: Arranging loose ends

**Files:**
- Modify: `src/lib/layout/flip.ts`, `src/lib/layout/pointer-drag.ts`,
  `src/lib/components/dashboard/WidgetFrame.svelte`, `src/lib/layout/arrangement.svelte.ts`,
  `src/lib/layout/items.ts`, `src/lib/layout/engine.ts` (comment), `src/lib/components/dashboard/DashboardGrid.svelte`
  and the tests that pass `onArrangement`
- Test: `src/lib/layout/pointer-drag.test.ts`, `src/lib/layout/items.test.ts`,
  `src/lib/components/dashboard/arranging.browser.test.ts`, `src/lib/layout/arrangement.browser.test.ts`

- [ ] **Step 1: Write failing tests:**
  - a keyboard or pointer resize animates size (FLIP with scale, `flipRect` L68) using
    `--motion-duration-base`, and not at all with reduced motion;
  - during a pointer drag outside the edge zone (`AUTOSCROLL_EDGE`), no animation frame is queued; one
    starts on entering the zone and stops on leaving it;
  - during a touch selection, a `touchmove` starting on the widget body or on Done is
    `defaultPrevented`;
  - after a second drop on the starter (which saves a copy and switches pages), focus lands on the
    dropped widget's title bar;
  - `Object.isFrozen(FALLBACK_MIN_SIZE)`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Replace the tests-only `onArrangement` prop: tests read the arrangement
  through the existing test harness (`src/lib/components/dashboard/test-harness/Harness.svelte`) via
  a context or a module accessor that production code doesn't import. Fix the `stepDown` comment
  (`engine.ts` L122–126) to say what it does.
- [ ] **Step 4: Run** `npm run test:browser`, `npm run test:e2e` (arranging, windowing,
  drag-performance) → PASS, with the drag p95 still under 34 ms.
- [ ] **Step 5: Commit** `"Design pass: arranging loose ends"`.

### Task 21: Wording review, Part 2 docs, and PR 2

**Files:**
- Modify: `DEFERRED.md`, `TODO.md`, `messages/en.json` (only if the review changes text)

- [ ] **Step 1: List every message added or changed in Part 2** (key and English) in the PR
  description, so the user can review the wording in one place, with screenshots of each in context
  (the Task 10 screenshot script, extended).
- [ ] **Step 2: Docs:** close the DEFERRED entries Part 2 finishes (conflict status wording; the
  display-name and name-field entries; sync spec 4 tidy-ups (1)–(3), keeping (4)–(6); restored
  unreadable dashboards; earlier-versions dedup; save-status announcements; names of copies; read-only
  Share and Download; read-only unkept wording; `pendingName`; RestoreVersionDialog closing; spec 2a
  loose ends; the device-only bar). Anything a task found bigger than expected and split out stays,
  with the user's agreement and a new trigger. Update `TODO.md` → "Release 1: design pass" and the
  "Start here" row.
- [ ] **Step 3: Run** `npm run lint && npm run check && npm run test && npm run test:e2e:all` (or
  podman) and `npm run build && npm run check:build && npm run check:budget`.
- [ ] **Step 4: Commit and open PR 2** `"Design pass, part 2: wording and behavior"` into `design-pass`
  (do not merge).
