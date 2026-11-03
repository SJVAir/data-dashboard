# Release 1: the design pass

Date: 2026-11-03. Branch: `design-pass` (from `main`), one PR into `main` with the user's
approval.

Repo: **data-dashboard only.** It reads files from `../monitor-map` and `../mobile` (assets) and
`../sjvair.com` (colors), but changes none of them. If a sibling change turns up, it needs an
approved plan in that repo first.

Runs in parallel with step 3's metadata work (from `../sjvair.com`) and `map-sdk` (from
`../map-sdk`); see `TODO.md` → "Start here". It comes before step 4 (the widgets) and the private
preview.

Mockups from the brainstorm are kept (git-ignored) in `.superpowers/session-prompts/`:
`palette-directions-full.png`, `palette-blend.png`, `density.png`, `density-mid.png`. The chosen
ones are `palette-blend.png` option B and `density-mid.png` option B.

## Why

Foundations built the app on shadcn-svelte's stock look (neutral grays, black primary buttons)
through a theme-token layer, so that a later design pass could change the look by changing token
values. This is that pass. Without it, step 4's widgets would be built and reviewed on a
placeholder look, and the private preview's testers would see something that doesn't feel like
SJVAir.

**Its own product in the SJVAir family** (the user, 2026-11-03). Not a page of sjvair.com, and not
a copy of its Bulma look, but recognizably SJVAir: the logo's colors, the site's tested link blue,
and monitor-map's floating cards.

**This becomes the family's shared style.** monitor-map and the mobile app never had a deliberate
style (both still run shadcn's stock neutrals with a few unmatched blues), and the user felt
mobile "was missing a bit of style". Once the dashboard launches, they'll be restyled to match it.
So the tokens defined here should be written as a reusable family palette, not dashboard-only
values (see "Later: the rest of the family").

## Goals

- A finished light look (direction B below) and a dark look, both WCAG 2.2 AA.
- A Light / Dark / System switch.
- A density that fits a laptop full of widgets (the "in between, closer to packed" spacing).
- A type scale, focus ring, motion tuning, and chart-series colors that step 4 builds on.
- The brand assets the app needs (logo, app icons including a maskable one, data-source logos,
  pollutant icons) copied in.
- Every existing component restyled through tokens, so nothing still looks like stock shadcn.

## Non-goals

- New widgets, new screens, or changes to how arranging works (default sizes do change; see "Density").
- Restyling monitor-map, mobile, or sjvair.com (later; see "Later: the rest of the family").
- Wording changes. Many `DEFERRED.md` entries say "revisit in the design pass" about wording or
  behavior; see "Existing deferrals" for which ones this pass takes.
- Livelier motion (numbers counting up, widgets sliding into place). Deferred; see "Motion".

## Anti-goals (failure even if it works)

- **UI colors that can be mistaken for air-quality levels.** A green "Saved" next to a green
  "Good", or a purple chart line next to EPA's purple "Very Unhealthy".
- **Sky blue used for text** or anything people must read. It's about 2.3:1 on white.
- **A flash of the wrong theme** on load for someone following their computer's setting.
- **Any component still hardcoding a color, size, radius, or duration.** That would break the
  next token swap, and the family restyle after launch.
- **Dark mode as an afterthought.** Every screen gets checked in both modes, including the level
  colors.

## The look (decided)

Chosen by the user from the mockups: **"A with C's cards"** (`palette-blend.png`, option B).

### Colors

| Role                                    | Light                                          | Source                                  |
| --------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| Brand navy: primary buttons, headings   | `#1c4482`                                      | the SJVAir logo                         |
| Sky blue: highlights only               | `#1fb9ef`                                      | the SJVAir logo                         |
| Link blue: links, chart line 1          | `#1f6fae`                                      | sjvair.com (`$link-blue`, contrast-tested) |
| Page background                         | a faint blue-gray, about `#f2f6fa`             | the mockup                              |
| Cards, menus, dialogs, top bar          | white                                          |                                         |
| Text                                    | a deep navy-gray, about `#0f2340`              | the mockup                              |
| Muted text                              | a blue-gray, about `#5d6f86` (must pass 4.5:1 on the page and on cards) | the mockup |
| Borders                                 | a light blue-gray, about `#dbe4ee` (bar) and `#e3eaf2` (cards) | the mockup             |

- **Blue-tinted grays replace shadcn's neutral grays everywhere** (backgrounds, borders, muted
  text, secondary buttons). No pure-gray surfaces, no black primary buttons.
- **Sky blue is for highlights:** the selected tab's underline and fill tint, the light fill under
  chart lines, the focus ring, selected states. Never text, and never the only boundary of a
  control.
- **Links are underlined**, as on sjvair.com (WCAG 1.4.1).
- **Destructive** stays a red that is clearly UI, not a level color. It's always shown with text
  or an icon (for example "Delete"), never as a bare color. The builder picks a value that passes
  AA in both modes.
- **The "about" values come from the mockups.** The builder may adjust them to meet contrast or
  to make a coherent token scale (writing them in `oklch` like today's tokens is fine), as long as
  the look matches the chosen mockup.

### Level colors (unchanged)

EPA's colors come from server metadata and aren't theme tokens; this pass doesn't change them.
The same goes for the other **health-level scales** step 3 is adding to the metadata, the ones
with action tiers: CalHeatScore heat, smoke density, fire tiers, and forecast categories (see
`ARCHITECTURE.md` → "Metadata as source of truth"). "Level colors" below means all of these.

**Not included** (my call, after the builder check): data-magnitude scales such as the pesticide
maps' blue, pink, and purple ramps (`camp/apps/pesticides/maps.py`). They say "more" or "less",
not "how risky", always come with a legend, and blues are SJVAir's brand color, so excluding them
would leave no brand at all. The rule that matters is that nobody mistakes a UI color for a
health level.

This pass makes sure level colors sit well in the new look:

- Swatches keep their outline and always show the level label (the existing rules), in both
  modes. Text on a level color uses the shared `readableColor` helper.
- The UI's own colors stay out of the level-color hues: no greens, yellows, oranges, reds,
  purples, or maroons for success, warning, or info states. "Saved" and similar states use navy,
  blue, or neutral text with an icon.

### Shape and depth

- **Cards** (widgets, menus, popovers, dialogs, the taskbar's chips where it makes sense): white,
  **12px corners**, a 1px light border, and a **soft blue-tinted shadow**, about
  `0 1px 2px #1c448212, 0 4px 14px #1c448214`. This matches monitor-map's floating toolbar and
  legend.
- **Buttons and inputs:** 8px corners. The primary button is navy with white text and a slight
  shadow. Secondary buttons are white with a blue-gray border and navy text.
- **Tabs and segmented controls:** the selected item gets a pale sky tint with dark text
  (`#e3f5fd` on `#0b4f6c` in the mockup).
- **Top bar:** white, with a 1px border below. The logo carries the brand, and the current page's
  link gets navy text with a sky-blue underline.
- **No pill buttons and no gradient stripe** (seen in option C; the user picked A's frame).

### Density (decided)

The user chose **"in between, closer to packed"** (`density-mid.png`, option B): on a laptop,
about four columns of widgets fit, so a dashboard of seven or eight fits on one screen.

- Space between cards about **12px**; padding inside cards about **12px**.
- **13px body text**; widget titles about 12.5–13px semibold; headline numbers about **32px**.
- Minimums still hold: no text under 12px, and click targets at least 24×24px (WCAG 2.5.8).
- **This pass delivers four across, including widget widths.** Nothing is live, so there are no
  saved dashboards to protect (the user, 2026-11-03), and layout defaults can change freely. The
  grid keeps `GRID_COLUMNS = 12` (`src/lib/layout/config.ts`): 3 columns per widget already gives
  four across. Today the placeholder widget (`src/lib/widgets/placeholder/index.ts`,
  `defaultSize: { w: 6, h: 4 }`) and the starter (`src/lib/starter/starter.ts`, two widgets of
  `w: 6`) show two across; this pass makes the placeholder's default width 3 and lays the starter
  out four across. The builder may also change the column count, `--grid-row-height` (4rem),
  default heights, or minimum sizes if the new density works better that way; the stored layouts
  and tests just follow. Step 4's widget types then default to about 3 columns too (recorded in
  `TODO.md`). This pass sets `--grid-gap` to the new spacing and checks that step 2's arranging,
  touch handles (44px), and phone layout still work.

### Type

- **Inter** stays (the user, 2026-11-03), already installed as `@fontsource-variable/inter`.
- A small scale built around 13px: about 12 (small), 13 (body), 15 (card titles where larger), 18
  (page titles), 32 (headline numbers). Defined as tokens, used everywhere instead of ad-hoc
  sizes.
- Numbers use tabular figures (`font-variant-numeric: tabular-nums`) wherever they line up:
  readings, tables, axes.
- Headings are semibold to bold. Page titles are navy (as in the mockup).

### Focus

A visible ring on every focusable thing: about 2px sky blue with a navy edge (or the reverse in
dark mode), so it reads on white cards, the blue-gray page, and dark cards. It must meet WCAG
2.4.11 (focus not obscured) and 1.4.11 (3:1 against what's next to it).

### Motion

**Quick and subtle** (the user, 2026-11-03: start simple, it's easy to change later). The existing
tokens stay the controls: `--motion-duration-fast` (120ms), `--motion-duration-base` (200ms),
`--motion-ease-standard`. This pass:

- Tunes those values if needed and uses them consistently: menus, popovers, dialogs, toasts, the
  taskbar, minimize and restore, and the theme switch.
- Settles the `--duration-*` `@theme` aliases that may be inert (a `DEFERRED.md` entry): either
  make them work or remove them.
- Keeps `prefers-reduced-motion` turning motion off, including for anything new.

**Deferred:** livelier motion such as numbers counting up and widgets sliding into place. It goes
into `DEFERRED.md`, to revisit after preview testers have used the app.

### Chart-series colors

Step 4's charts (uPlot) need colors for several lines on one chart. This pass defines them as
tokens (`--chart-1` … `--chart-5`, replacing today's grays), in both modes:

- **Never a level-color hue** (EPA's, or heat's yellows to reds). Smoke density's levels are
  grays, so slate must stay clearly bluer than them. The direction (my call): navy, link blue,
  teal, slate, and a magenta-pink. The builder settles exact values, checking them against the
  scale colors in step 3's metadata once it's on `develop`.
- **At least 3:1 against the card background** in each mode (WCAG 1.4.11; lines are graphics
  people need to read).
- **Distinguishable for common color blindness**, and never the only difference: each series also
  gets its own dash pattern or marker (step 4 applies them; this pass defines the order).
- The light sky-blue fill under a single line (from the mockup) is decorative and doesn't need
  contrast.

## Dark mode (decided)

**In this pass, with a switch** (the user, 2026-11-03). Doing it now while the app is almost all
tokens is cheap: there was one hardcoded color class in 103 components (the dialog overlay's
`bg-black/10`), and the shadcn components already have dark styles. After step 4, every widget
would need fixing.

- **Default: follow the computer's setting.** A **Light / Dark / System** switch overrides it.
- **No flash.** sjvair.com's template (`camp/apps/workspace/templates/workspace/index.html`)
  links `workspace/app.css` in the `<head>` before the app loads, so the System choice must work in
  CSS alone (`prefers-color-scheme`), with no flash at all. Only a saved Light or Dark override
  needs code, applied in `bootstrap.ts` before the app mounts. Inline scripts aren't allowed (CSP).
- **A saved override that differs from the computer's setting may flash the page background
  briefly** before `app.js` runs (my call, after the builder check). The template loads `app.js`
  as a deferred module, so the browser can paint once from the CSS first. The app's content
  itself always renders in the right theme. Ruling out that flash would need sjvair.com's template
  to render the theme on the server (for example from a cookie), which needs a plan in that repo.
  Recorded in `DEFERRED.md`, to revisit if people notice it. The test asserts no flash for System
  and "applied before the app's first render" for overrides.
- **Where the switch lives:** a menu everyone can reach, signed in or out. Today that's the Help
  menu in the top bar (`src/lib/components/shell/HelpMenu.svelte`), as a radio group (my call; the
  builder may propose a better place, for example a small settings menu).
- **The choice is per device, not per account,** and is stored through the platform adapter, not
  `localStorage` directly. It must be readable synchronously at startup, which the existing
  `PreferenceStorage` (async, per space) isn't, so the builder adds a small synchronous preference
  capability to the platform adapter (`src/lib/platform/`), with a memory version for tests and a
  web version.
- **Dark colors:** a deep navy-slate page, not pure black; slightly lighter cards; text and muted
  text at AA; navy lifted to a lighter blue for primary buttons and links so they read; sky blue
  stays the highlight. Borders and shadows adjusted (shadows mostly disappear in dark).
- **Level colors on dark cards:** the outline and the label keep them readable. This needs a
  check, not new colors.
- **The browser's own controls** (scrollbars, form widgets) follow the theme (`color-scheme`).
- **The address-bar color** (`theme-color`) follows the theme where the browser supports it. The
  Django template has no `theme-color` meta tag, and this repo can't change sjvair.com's template
  without a plan there, so the app sets it at startup (my call). The web manifest's
  `theme_color` and `background_color` stay light.

## Assets (decided)

The user, 2026-11-03: copy what we might need from monitor-map and mobile. Copy a **selected set**
(not whole directories) into `src/lib/assets/`, and import each where it's used, so it loads only
on screens that need it and stays out of the initial bundle:

- **SJVAir logo:** `sjvair.svg` and `sjvair-white.svg` (identical in both repos), plus monitor-map's
  logo parts (`src/lib/assets/logos/sjvair-parts/`: `sjvair-icon`, `sjvair-sjv`, `sjvair-air`) for a
  compact logo on phones. The top bar shows the logo (white version in dark mode) with "Dashboard"
  beside it, replacing today's text name. The accessible name stays the app name from the
  messages.
- **App icons:** mobile's `src/assets/icons/icon-*.webp` (48–512) as sources. The manifest
  (`vite-plugins/web-manifest.ts`, icons in `static-src/icons/`) moves from sjvair.com's
  placeholder favicons to SJVAir app icons.
- **A maskable icon** (closes the `DEFERRED.md` entry): the logo mark centered inside the safe
  zone (the middle 80%) on a solid background, at 192 and 512, listed with `purpose: "maskable"`.
  The manifest keeps PNGs. The tab favicon stays sjvair.com's (the template sets it).
- **Data-source logos:** AirGradient, AirNow, CARB, PurpleAir (from monitor-map's
  `src/lib/assets/logos/`), for crediting where readings come from. They're used the same way
  monitor-map and mobile use them.
- **Pollutant icons** (monitor-map's `ozone/` and `pm25/` icons) and `lungs.svg` (health
  guidance).
- The data-source logos and pollutant icons have no screen to appear on until step 4. They're
  copied now and stay unused until then (unused files add nothing to the bundle).
- **Not copied:** the Material icons (the dashboard uses Lucide, which covers them) and the large
  photos (`sky.webp`, 150 KB; `stars_milky_way_space.jpg`, 495 KB). They're easy to fetch later if
  a design needs one; that isn't a deferral, just not needed.
- Raster images go through `@sveltejs/enhanced-img` where it helps. SVGs stay SVG.

## Phones

Responsive layouts are already required; the same tokens apply. On narrow screens the top bar uses
the compact logo, and the density rules don't push text under 12px or targets under 24px (44px for
touch handles, as today). Checked with step 2's phone layout.

## Existing deferrals this pass takes

From `DEFERRED.md`, the entries that are about the look:

- "A maskable icon and real app icons" (see "Assets").
- "Dark-mode `--destructive` contrast isn't covered by axe": the axe checks run in both modes.
- The `--duration-*` alias half of "CI and dependency loose ends".
- From "Spec 5a polish": the feedback link's missing new-tab cue, and scoping the manifest's
  `lightToken` match to `:root` (this pass edits that code anyway).
- From "Spec 5b polish": wrapping the account menu's greeting labels in a `DropdownMenu.Group`.
- From "Spec 2a robustness loose ends": the focus ring after touch drops, checked by hand as part
  of the focus-ring work.

**Not taken:** the wording and behavior entries that also say "revisit in the design pass"
(conflict status wording, error wording, names of copies, the read-only Share dialog text,
Download feedback, the save-status announcements, the restore dialog's behavior, the "Only on this
device" bar's count, list deduplication, `pendingName`). They aren't about the look. This pass
re-points their "Revisit" lines to a later wording and polish pass before the private preview,
recorded in `DEFERRED.md` (see "Open question for the user").

## Testing

- **Contrast:** a unit test that checks the token pairs that matter (text on page and card,
  muted text, links, primary button text, focus ring, chart series against cards, destructive) in
  both modes, the way sjvair.com pins its colors in `camp/tests/test_contrast.py`.
- **axe in both modes:** the existing Playwright axe checks (`e2e/a11y.spec.ts` and the
  per-feature ones) also run with dark mode on.
- **Theme switch:** System follows `prefers-color-scheme` (emulated), an override survives a
  reload, and an override is applied before the app's first render (no flash).
- **Token discipline:** a check (lint rule or test) that components don't use raw palette classes
  (`bg-black`, `text-gray-500`, …) or hex colors, so the next restyle stays a token swap. Today's
  one exception (`bg-black/10` on the dialog overlay) moves to a token.
- **A screenshot review** of the main screens in light and dark, on a laptop and a phone, before
  the PR (by hand or a scripted Playwright pass), since visual problems slip past text checks.
- **Budget:** the initial bundle was 199.2 KB of the 200 KB soft budget after sync spec 4, and CSS
  counts. This pass will likely cross it (CI warns, doesn't fail). Report the new size in the PR,
  and keep assets and the switch's menu code out of the initial load where practical.

## Docs to update in the same change

- `ARCHITECTURE.md` → "Theme & style": the decided look, dark mode and the switch, density, type
  scale, chart-series rules, and that this is the family palette.
- `ARCHITECTURE.md` → "Platform strategy": the new synchronous preference capability.
- `ARCHITECTURE.md` → "Accessibility": axe in both modes; the contrast test.
- `TODO.md` → "Release 1: design pass" and the "Start here" table row.
- `DEFERRED.md`: close the entries this pass finishes, add the new deferrals (livelier motion; the
  family restyle; the background flash for saved theme overrides), and re-point the wording
  entries (see above).
- `TODO.md` → "Release 1, step 4": widget types default to about 3 of 12 columns wide, so a
  laptop shows about four across (this pass's density).
- `CLAUDE.md` → "Code Style": the token-discipline rule if a lint check enforces it.

## Later: the rest of the family

After the dashboard launches, monitor-map, mobile, and `map-sdk` adopt this palette. Not this
pass. Two things make that easier now:

- **Token names stay shadcn's** (`--primary`, `--card`, `--border`, …) plus the few new ones
  (`--chart-*`, type sizes, the focus ring), so any shadcn-based family app can adopt the palette
  by copying the token block.
- **`map-sdk`** is being built now (its own session). Its legends and tooltips render inside the
  dashboard, so it should style them with the same shadcn token names and inherit the host's
  theme. This spec's author should tell that session (message it) once the token list is final.

Recorded in `DEFERRED.md`: "Restyle monitor-map, mobile, and map-sdk's defaults to the family
palette", revisit when the dashboard launches.

## Left to the builder

- Exact color values (within the rules above), the dark palette, and the token scale's names.
- How the synchronous preference capability is shaped, as long as it's in the platform adapter
  and testable with a memory version.
- How the dark variant is wired (`.dark` class, a `data-theme` attribute, or both), as long as
  System works in CSS alone.
- The maskable icon's background (white or navy) and how it's produced, with the source committed.
- Which components need more than token changes, and in what order the plan restyles them.
- Whether the token-discipline check is an ESLint rule or a test.

## Open question for the user

- **The wording and behavior deferrals.** This spec leaves them out (see "Existing deferrals this
  pass takes") and re-points them to a separate wording and polish pass before the private
  preview. If you'd rather this pass include them, it grows by a dozen small fixes across dialogs
  and messages.
