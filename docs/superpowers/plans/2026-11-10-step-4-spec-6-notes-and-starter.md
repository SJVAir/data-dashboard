# Step 4 spec 6: the Notes widget and the starter dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Notes widget (formatted-as-you-type editing, saved as Markdown, rendered safely), the
real starter dashboard with its welcome Note, the starter's chosen place (a preference, resolved
everywhere), the "Change place" bar on the starter and on copies made from it, and "Duplicate for
another place".

**Architecture:** Notes keep their Markdown (or a welcome-message reference) in the widget's
`options`, validated by a Notes options schema inside the document schema. Viewing turns
`marked`'s tokens into a small block model that Svelte components draw (no HTML strings); editing
is a lazily loaded Lexical dialog that imports and exports the same Markdown subset. The starter
template keeps `default-place`; **the starter session's document is the template resolved with the
chosen place** (plus the bar's saved field), so every widget, Get data, the picker and every exit
see ordinary places, and only the template ever holds `default-place`. One pure module, "replace
place A with B", serves the bar on copies, "Also change the others" and "Duplicate for another
place".

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind v4 theme tokens, shadcn-svelte / bits-ui,
Paraglide, zod (`$lib/zod`), `marked` (new), `lexical` + `@lexical/*` (new), Vitest (unit +
browser), Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-11-10-step-4-spec-6-notes-and-starter-design.md` (approved
2026-11-10). Read it first; this plan argues from it.

## Global Constraints

- Branch `step-4-spec-6` (from `step-4`); the PR goes into `step-4`. Never merge without the
  user's own yes. No Claude or AI attribution in commits, PRs or docs.
- SDK pin unchanged: `npm:@jsr/sjvair__sdk@5.0.0-beta.8`. Anything missing goes to the
  coordinator (`data-dashboard-bd`), never worked around.
- New dependencies pinned exactly: `marked` and `lexical` + `@lexical/rich-text`,
  `@lexical/list`, `@lexical/link`, `@lexical/markdown`, `@lexical/history`, `@lexical/utils`
  (all MIT; one Lexical version for all). `npm run build` must pass `vite-plugins/licenses.ts`
  and regenerate the third-party notices.
- **Nothing new in the initial bundle except the Notes descriptor and the bar's small shell.**
  `marked` loads with the Notes component (`load`, through `loadLazy`); Lexical loads with the
  editor dialog (`dialogLoaders`). The initial bundle is 204.8 KB gzip (accepted). Run
  `npm run build && npm run check:budget` after every task that touches a descriptor, the
  registry, `app.svelte.ts`, `DashboardGrid.svelte` or the starter, and **report any growth to the
  user before going on**.
- Never inject HTML: no `{@html}`, `innerHTML`, or inline script anywhere in Notes. Links only
  `http:`, `https:`, `mailto:`, rendered with `target="_blank"` and `rel="ugc nofollow noopener"`.
  The CSP and `csp-hosts.json` stay unchanged.
- Note limit: **5,000** characters of Markdown (`NOTE_TEXT_MAX = 5000`).
- `default-place` exists only in the starter template (`starterTemplate()`); every stored,
  shared, exported or copied document passes `DashboardSchema` (which rejects it) before it is
  stored or sent.
- Fresno County is `DEFAULT_LAYER.place` (`src/lib/widgets/defaults.ts`); don't add another
  literal.
- Paraglide for every string, keys matching their text, no concatenation; the welcome Note is a
  message (Markdown English) referenced by key, never stored as text until the user edits it.
  Formatting through `$lib/format`. Preferences and geolocation through the platform adapter.
  Theme tokens only (token-discipline test). Svelte 5 runes. WCAG 2.2 AA; reduced motion.
- Style: tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- New English strings: a fresh-eyes copy review (Task 10), then every new key and its English in
  the PR for the user's approval.
- Every deferral goes into `DEFERRED.md` in the same commit, with why and the revisit trigger.
  Re-read a doc right before editing it (other sessions edit docs in this checkout).
- Known flaky tests (`DEFERRED.md`): note, don't chase, if one fails under load and passes alone.
  Don't run two e2e suites at once (port 4173).

## Review Focus

1. **A hostile Note arriving in a share link** (raw `<script>`/`<img onerror>`, `javascript:` /
   `data:` / `vbscript:` / protocol-relative links, a 5,001-character Note, a `message` key that
   doesn't exist): the link either fails validation with the usual message (too long) or renders
   inert text; never a live element or a broken page. Tests: Task 1 (schema, tokens), Task 9 (e2e
   under the CSP fixture).
2. **Change place on the starter just as a first edit hands off** (an edit is mid-copy when the
   bar's Done lands): the place change must reach the copy (as a bar change on the copy), not be
   lost on the discarded starter. Test: Task 6 (`starter bar during hand-off applies to the copy`).
3. **A chosen place that no longer exists** (a removed monitor, a closed school saved in the
   preference): the starter still opens, its widgets show their usual "no longer available", and
   the bar still offers Change place. Test: Task 4 (`starter with a gone place still builds`) and
   Task 6 (bar names an unknown place with the generic fallback).
4. **"Use my location" on the starter, then share or export:** the copy holds the point
   (personal), but the link/file has the region in every layer **and in the bar**; with no
   region, the bar's place is dropped. Test: Task 7.
5. **Pasting from Word or a web page into the editor** (images, tables, colors, `<a
   href="javascript:…">`): only the allowed formatting survives, unsafe links become text, and the
   saved Markdown round-trips. Test: Task 3 (`paste keeps only the allowed formatting`).

---

### Task 1: Notes options schema and the safe Markdown model

**Files:**
- Create: `src/lib/notes/options.ts` (+ `options.test.ts`)
- Create: `src/lib/notes/markdown.ts` (+ `markdown.test.ts`)
- Modify: `src/lib/documents/schema.ts` (validate `note` widgets' `options`), `schema.test.ts`
- Modify: `package.json` (add `marked`, pinned exactly)

**Interfaces:**
- Produces:
  - `NOTE_TYPE = "note"`, `NOTE_TEXT_MAX = 5000`
  - `NoteOptionsSchema`: `z.union([z.object({ text: z.string().max(NOTE_TEXT_MAX) }), z.object({ message: z.string().regex(/^[a-z0-9_]{1,64}$/) })])` (strict objects)
  - `type NoteOptions = z.infer<typeof NoteOptionsSchema>`
  - `noteOptions(widget: WidgetInstance): NoteOptions` — `safeParse`; invalid or missing →
    `{ text: "" }` (a read-only document isn't validated)
  - `type NoteInline = { kind: "text"; text: string } | { kind: "strong" | "em"; children: NoteInline[] } | { kind: "link"; href: string; children: NoteInline[] } | { kind: "break" }`
  - `type NoteBlock = { kind: "paragraph" | "heading"; children: NoteInline[] } | { kind: "list"; ordered: boolean; start: number; items: NoteInline[][] }`
  - `toNoteBlocks(markdown: string): NoteBlock[]` — `marked.lexer` with `{ gfm: true, breaks: true }`
  - `safeHref(url: string): string | null` — `URL` parse; protocol in `http:`, `https:`,
    `mailto:` → the URL, else `null` (relative and protocol-relative → `null`)

- [ ] **Step 1: Write the failing tests.** `options.test.ts`: `{ text }` at 5,000 passes, 5,001
  fails; `{ message: "starter_note_welcome" }` passes; `{ message: "Bad Key" }`, `{ text, message }`,
  `{}` fail; `noteOptions` falls back to `{ text: "" }`. `schema.test.ts`: a dashboard with a
  `note` widget whose options fail is rejected by `DashboardSchema`; other types' `options` stay
  free-form. `markdown.test.ts`:
  - `"a\nb"` → one paragraph `[text a, break, text b]`; a blank line → two paragraphs
  - `"## Hi"` → heading; `"# Hi"` and `"### Hi"` → a paragraph with the source text (`"# Hi"`)
  - `**b**`, `*i*`, `- a\n- b`, `3. a\n4. b` (`start: 3`)
  - `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` → text containing the literal
    source; never another kind
  - `[x](javascript:alert(1))`, `[x](data:text/html,hi)`, `[x](//evil.test)`, `[x](/rel)` →
    text `x` (no link); `[x](mailto:a@b.test)` and `https://sjvair.com` (bare) → link
  - images, tables, code, quotes → paragraph text of their source
- [ ] **Step 2: Run** `npx vitest run --project unit src/lib/notes src/lib/documents` — FAIL.
- [ ] **Step 3: Implement.** In `markdown.ts`, map only the token kinds above; every other block
  or inline token becomes text from its `raw`. Links go through `safeHref`; a `null` href keeps
  the link's children as text. In `documents/schema.ts`, refine `DashboardBodySchema`: each
  widget with `type === NOTE_TYPE` must pass `NoteOptionsSchema` (issue path
  `["widgets", i, "options"]`). `options.ts` imports only `$lib/zod`; `markdown.ts` is never
  imported from the initial bundle (it's for the lazy component and dialog).
- [ ] **Step 4: Run** the tests — PASS; `npm run check`.
- [ ] **Step 5: Commit** `feat: Notes options schema and the safe Markdown model`

### Task 2: The Notes widget type (viewing)

**Files:**
- Create: `src/lib/widgets/notes/index.ts` (descriptor), `module.ts`, `NoteWidget.svelte`,
  `NoteBlocks.svelte` (+ `NoteWidget.browser.test.ts`)
- Create: `src/lib/notes/messages.ts` (the allowlist)
- Modify: `src/lib/widgets/registry.ts` (`addable` shape, `onAdded`), `registry.test.ts`
- Modify: `src/lib/actions/dashboard.ts` (`addWidget` uses the new `addable` and calls `onAdded`)
- Modify: `src/lib/store/app.svelte.ts` (register Notes last)
- Modify: `messages/en.json` (`widget_note_title` "Note", the empty hint, `starter_note_welcome`)
- Test: `src/lib/sharing/points.test.ts`, the `regionOf`/picker test, `src/lib/get-data/*.test.ts`
  (a Note in each place spot)

**Interfaces:**
- Consumes: Task 1's `NOTE_TYPE`, `noteOptions`, `toNoteBlocks`.
- Produces:
  - `WidgetType.addable?: () => { data: WidgetDataConfig; options?: Record<string, unknown> }`
    (Notes is the only addable type; no other caller to migrate)
  - `WidgetType.onAdded?: (app: AppContext, widgetId: string) => void` — Notes opens its editor
    (Task 3 fills it; here it's a no-op)
  - `NOTE_MESSAGES: Record<string, () => string>` — `{ starter_note_welcome: m.starter_note_welcome }`
  - `noteMarkdown(options: NoteOptions): string` — the text, or the message's Markdown, or `""`
    for an unknown key
  - Descriptor: `time: "none"`, no `accepts`, `analyzable: false`, `downloadable: false`,
    `thresholds: false`, `minSize: { w: 3, h: 2 }`, `defaultSize: { w: 4, h: 3 }`, lucide
    `sticky-note` icon, `label: m.widget_note_title`, `addable: () => ({ data: { layers: [] }, options: { text: "" } })`

- [ ] **Step 1: Write the failing tests.** Browser: a Note with each block kind renders real
  `h3`/`strong`/`em`/`ul`/`ol`/`a` elements; links have `target="_blank"` and
  `rel="ugc nofollow noopener"` and an accessible "opens in a new tab"; a `{ message:
  "starter_note_welcome" }` Note shows the welcome text; an unknown key shows the empty hint where
  editable and nothing where read-only; long text scrolls inside the widget. Unit: Add widget lists
  Notes and adds `{ layers: [] }` + `{ text: "" }` in one `addWidget` change; `lookupInput` and the
  picker's `regionOf` return `null` for a Note; Get data's `dataTypes()` excludes Notes.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.** `NoteBlocks.svelte` renders the block model with `{#each}` and
  elements only. The heading renders as `h3` (my call in the spec: one level). The descriptor's
  `load` imports `module.ts`, which imports the component and `markdown.ts`.
- [ ] **Step 4: Run** the tests, `npm run check`, `npm run build && npm run check:budget`
  (report the size).
- [ ] **Step 5: Commit** `feat: the Notes widget type`

### Task 3: The Note editor dialog (Lexical)

**Files:**
- Create: `src/lib/notes/NoteEditorDialog.svelte`, `src/lib/notes/editor.ts` (Lexical setup and
  Markdown transformers), `src/lib/notes/NoteToolbar.svelte`, `src/lib/notes/LinkPopover.svelte`
  (+ `editor.browser.test.ts`, `NoteEditorDialog.browser.test.ts`)
- Modify: `src/lib/components/dialogs/lazy.svelte.ts` (`noteEditor` state, `openNoteEditor`,
  loader)
- Modify: `src/lib/widgets/notes/index.ts` (`menu`: "Edit note"; `onAdded` opens the editor),
  `NoteWidget.svelte` (double-click on an empty, editable Note opens it)
- Modify: `package.json` (Lexical packages, pinned exactly)

**Interfaces:**
- Consumes: Task 1 (`NOTE_TEXT_MAX`, `safeHref`, `NoteOptions`), Task 2 (`noteMarkdown`).
- Produces:
  - `openNoteEditor(opts: { widgetId: string }): void`
  - `createNoteEditor(root: HTMLElement, markdown: string): NoteEditor` with
    `NoteEditor = { markdown(): string; toggle(format: "bold" | "italic"): void; heading(): void; list(ordered: boolean): void; link(url: string | null): boolean; state(): ToolbarState; destroy(): void }`
  - `NOTE_TRANSFORMERS`: Lexical's `BOLD_STAR`, `ITALIC_STAR`, `UNORDERED_LIST`, `ORDERED_LIST`,
    `LINK`, and a heading transformer for `## ` only

- [ ] **Step 1: Write the failing tests.**
  - `editor.browser.test.ts`: Markdown round trip unchanged for a sample using every construct and
    single line breaks; `toggle("bold")` on a selection exports `**…**`; `heading()` exports `## `;
    `link("javascript:alert(1)")` returns `false` and adds nothing; **paste keeps only the allowed
    formatting** (HTML with `<img>`, `<table>`, `<span style=color>`, `<h1>`, `<a href="javascript:…">`
    → text, one heading level, no unsafe link).
  - `NoteEditorDialog.browser.test.ts`: opens with the Note's text (a `message` Note opens with the
    welcome's text); Save applies one `setWidgetData` with `options: { from, to: { text } }`
    (data unchanged) — one undo step; Cancel with changes asks "Discard changes?"; the counter
    appears near the limit, and Save is disabled over 5,000; toolbar buttons are toggle buttons
    with `aria-pressed`; Ctrl/⌘+B, I, K work; focus returns to the opener.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.** Lexical's vanilla API (`createEditor`, `registerRichText`,
  `registerList`, `registerHistory`, `registerMarkdownShortcuts(editor, NOTE_TRANSFORMERS)`),
  nodes `HeadingNode`, `ListNode`, `ListItemNode`, `LinkNode`. On import and paste, normalize any
  heading to the one level and drop link nodes whose URL fails `safeHref`. Export with
  `$convertToMarkdownString(NOTE_TRANSFORMERS, undefined, true)` (keep new lines). The dialog
  follows Edit data's discard pattern and the existing dialog components; the counter shows from
  4,500 (my call) and is announced politely. "Edit note" appears only for editable widgets.
- [ ] **Step 4: Run** the tests, `npm run check`, `npm run build && npm run check:budget`
  (confirm Lexical is only in the dialog's chunk; report the size).
- [ ] **Step 5: Commit** `feat: the Note editor (Lexical), formatted as you type`

### Task 4: The starter: contents, layout, the chosen place, and every exit

**Files:**
- Create: `src/lib/starter/place.svelte.ts` (the preference) (+ `place.test.ts`)
- Create: `src/lib/starter/resolve.ts` (+ `resolve.test.ts`)
- Modify: `src/lib/starter/starter.ts`, `starter.test.ts`
- Modify: `src/lib/documents/schema.ts` (`placeBar` on the body)
- Modify: `src/lib/store/app.svelte.ts` (load the place before building the starter; pass it on)
- Modify: `src/lib/store/dashboard-index.svelte.ts` (`createFromStarter(place)`,
  `duplicate(STARTER_ID)` with the place)
- Modify: `src/lib/sharing/actions.ts` (`targetOf` builds the starter with the place)
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte` (remove `StarterHint`)
- Delete: `src/lib/components/dashboard/StarterHint.svelte`; drop the `starter_hint` message
- Modify: `DEFERRED.md` (other tabs see a new starter place only after reload)

**Interfaces:**
- Consumes: Task 2 (`NOTE_TYPE`), `DEFAULT_LAYER`, `MONTH_CALENDAR_TYPE`, the type ids of
  Current, Forecast, Outside and Chart.
- Produces:
  - `type ChosenPlace = Exclude<PlaceRef, { kind: "default-place" }>`
  - `DashboardBody.placeBar?: { place: ChosenPlace }` (schema rejects `default-place` there)
  - `STARTER_PLACE_KEY = "starterPlace"`; `readStarterPlace(platform, space): Promise<ChosenPlace>`
    (unset or invalid → `DEFAULT_LAYER.place`); `saveStarterPlace(platform, space, place): Promise<void>`
  - `resolveDefaultPlace(doc: Dashboard, place: ChosenPlace): Dashboard` — every layer's
    `default-place` replaced; returns a new object
  - `starterTemplate(): Dashboard` — the contents, with `default-place` (passes
    `StarterDashboardSchema`, fails `DashboardSchema`)
  - `starterDashboard(place: ChosenPlace): Dashboard` — `resolveDefaultPlace(starterTemplate(), place)`
    with `body.placeBar = { place }`; passes `DashboardSchema`
  - `copyOfStarter(now: Date, place: ChosenPlace): Dashboard`
  - `StarterSessionOptions.place: ChosenPlace`
  - `App.starterPlace: ChosenPlace` (`$state`), loaded before the first starter session

- [ ] **Step 1: Write the failing tests.**
  - `starterTemplate()`: widgets in reading order Note (`{ message: "starter_note_welcome" }`),
    Current (PM2.5), Outside, Forecast, Chart (PM2.5, `DEFAULT_RANGE`), month calendar (PM2.5,
    `{ kind: "to-date", unit: "month" }`); every place `default-place`; rects: the Note 12 wide
    × 2, the now row one shared height ≥ Outside's `minSize.h` (Current 3, Outside 3, Forecast 6
    wide), then Chart 8 wide and the calendar 4 wide sharing one height ≥ 6; every rect ≥ its
    type's `minSize`; no overlaps; each widget's `data` equals what Get data stores for that type
    with PM2.5 in Fresno County (build it through the same Get data helpers, not by hand).
  - `starterDashboard(place)` passes `DashboardSchema` for each `PlaceRef` kind (region, monitor,
    location, point) and holds no `default-place`; **a gone place still builds**.
  - `copyOfStarter`, `createFromStarter`, `duplicate(STARTER_ID)`, Export's target and the
    first-edit hand-off (`starterSession`, including via Get data's `addFromDraft` and a calendar
    selection) all produce documents with the chosen place, `placeBar`, `copiedFrom: "starter"`,
    and passing `DashboardSchema`; the hand-off validates before `commit` (a document that fails
    isn't stored and the edit reports the save error).
  - `readStarterPlace`: unset → Fresno County; a stored `default-place` or junk → Fresno County.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.** `app.svelte.ts` reads the preference once at startup (and after a
  space switch or "Clear my data") before `#starter()` builds a session; `#starter()` passes
  `this.starterPlace`. Remove the old placeholder rects. Add the `DEFERRED.md` entry: **"Another
  tab's starter shows a new chosen place only after reload"** (preferences have no change event;
  revisit if people notice, or when preferences gain one).
- [ ] **Step 4: Run** `npm run check`, `npm run test:unit`, the touched browser tests,
  `npm run build && npm run check:budget` (report the size).
- [ ] **Step 5: Commit** `feat: the starter's contents and chosen place, resolved at every exit`

### Task 5: Replace place A with B

**Files:**
- Create: `src/lib/places/replace.ts` (+ `replace.test.ts`)

**Interfaces:**
- Consumes: `sameRef`, `Layer`, `Dashboard`, Task 4's `ChosenPlace`.
- Produces:
  - `widgetPlace(widget: WidgetInstance): ChosenPlace | "mixed" | null` — the one place all its
    place-bearing layers share; `"mixed"` for a `selection`, layers at different places, or a
    layer holding a place-tied choice (a weather layer's chosen station, `filters.station` or
    whatever field spec 3b uses — find it, don't guess); `null` for no places (a Note)
  - `replacePlace(doc: Dashboard, from: ChosenPlace, to: ChosenPlace, opts: { others: boolean }): Dashboard`
    — switches widgets whose `widgetPlace` equals `from` (and, with `others`, every widget with a
    single other place); `"mixed"` and `null` never change; also moves `body.placeBar` when it
    equals `from`
  - `othersCount(doc: Dashboard, place: ChosenPlace): number` — single-place widgets at another place
  - `barVisible(doc: Dashboard): boolean` — `placeBar` set and at least one widget at its place
  - `mainPlaces(doc: Dashboard): ChosenPlace[]` — the most common single places (more than one on
    a tie; empty when none)
  - `replaceChange(doc: Dashboard, next: Dashboard): Change | null` — `setWidgetData` for one
    changed widget without a bar move, else one `replaceDocument`

- [ ] **Step 1: Write the failing tests:** each `widgetPlace` case (including a Chart with two
  monitors and a Chart with a weather station); `replacePlace` leaves mixed, Note and
  other-place widgets alone without `others` and switches the single-place others with it;
  the bar moves with `from`; `mainPlaces` with a tie; `replaceChange` gives one undo step.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: replace one place with another across a dashboard`

### Task 6: The "Change place" bar

**Files:**
- Create: `src/lib/components/dashboard/PlaceBar.svelte` (+ `PlaceBar.browser.test.ts`)
- Modify: `src/lib/components/dashboard/DashboardGrid.svelte` (render the bar above the grid)
- Modify: `src/lib/components/dialogs/lazy.svelte.ts` (`openPlacePicker` takes
  `{ widgetId: string } | { dashboardPlace: true }`)
- Modify: `src/lib/places/PlacePickerDialog.svelte` (dashboard-place mode)
- Modify: `src/lib/store/app.svelte.ts` (`changeStarterPlace`)
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: Task 4 (`saveStarterPlace`, `starterPlace`, `placeBar`), Task 5 (`replacePlace`,
  `othersCount`, `barVisible`, `replaceChange`).
- Produces:
  - `App.changeStarterPlace(place: ChosenPlace): Promise<void>` — saves the preference, sets
    `starterPlace`, and replaces the current starter session with a fresh one (no copy, no undo).
    **If the starter has already handed off to a copy**, it applies the copy's bar change instead.
  - The picker's dashboard-place mode: single mode, the `pm25` purpose, an unchecked "Also change
    the {count} widgets showing other places" when `othersCount > 0` (copies only), and the
    live-link point rule from widget mode (a point on a live link without "Share my exact
    location" is saved as its region, using the first switching widget for the lookup).

- [ ] **Step 1: Write the failing tests.** Browser: the starter shows "Showing Fresno County ·
  Change place"; Done on another place changes every widget, makes no copy and no undo entry,
  saves the preference, and survives a reload; "Use my location" is offered and opt-in; on a copy
  with `placeBar`, Done is one undo step switching only the bar's widgets, "Also change…" appears
  only when others exist and switches them; mixed widgets never switch; the bar hides when no
  widget is at its place; a live-share viewer sees "Showing …" without "Change place"; the place
  change is announced politely; **starter bar during hand-off applies to the copy**; an unknown
  place is named with the generic fallback.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** The bar names the place through the picker's existing directory and
  resolvers, imported lazily (the bar's shell stays small; show a short skeleton while naming).
  It's a labeled region (`role="region"`), inert while a widget is fullscreen (like the old hint).
- [ ] **Step 4: Run** the tests, `npm run check`, `npm run build && npm run check:budget`
  (report the size).
- [ ] **Step 5: Commit** `feat: the Change place bar on the starter and its copies`

### Task 7: Privacy for the bar's place, and sharing the starter copies first

**Files:**
- Modify: `src/lib/sharing/point-layers.ts` (`hasPoints` counts a point in `placeBar`)
- Modify: `src/lib/sharing/points.ts` (`withSwaps`, `swapChange`, `pointsCovered` cover the bar)
- Modify: `src/lib/sharing/actions.ts` (`shareDashboard` on the starter makes the copy first)
- Modify: `src/lib/store/app.svelte.ts` (`copyStarter(): Promise<DocumentSession | null>`, sharing
  the hand-off code with `starterSession`'s first edit)
- Modify: `src/lib/starter/starter.ts` (the hand-off as a reusable function)
- Test: `points.test.ts`, `actions` tests, `src/lib/sync/points.test.ts`

**Interfaces:**
- Consumes: Task 4, Task 5.
- Produces: `App.copyStarter()` — stores the copy (validated), makes it current (URL replaced, the
  "Saved as your own dashboard" toast), resolves to its session; `null` on failure.

- [ ] **Step 1: Write the failing tests:** a bar point equal to a swapped layer point becomes the
  same region; a bar point with no matching layer is dropped (`placeBar` removed); `hasPoints` and
  `pointsHeld` see a bar-only point; `swapChange` with a bar move is one `replaceDocument`;
  sharing the starter stores a copy first and opens the Share dialog for it (live share then
  available with an account); Export of the starter makes no copy and holds no `default-place`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, plus
  `npm run check`.
- [ ] **Step 5: Commit** `feat: the bar's place in the location-privacy rules; sharing the starter copies it first`

### Task 8: Duplicate for another place

**Files:**
- Modify: `src/lib/actions/dashboard.ts` ("Duplicate for another place…" next to Duplicate)
- Modify: `src/lib/store/dashboard-index.svelte.ts` (`duplicate(id, replace?)`)
- Modify: `src/lib/places/PlacePickerDialog.svelte` (a "for a copy" mode returning the pick)
- Create: a small "Which place?" chooser for ties (shadcn radio group in a dialog)
- Modify: `messages/en.json`

**Interfaces:**
- Consumes: Task 5 (`mainPlaces`, `replacePlace`, `barVisible`), the existing `nameOpenedCopy`.
- Produces:
  - `DashboardIndex.duplicate(id: string, replace?: { from: ChosenPlace; to: ChosenPlace }): Promise<string>`
  - `openPlacePicker` gains a third form, `{ pick: (place: ChosenPlace) => void }`: single mode,
    `pm25` purpose, no edit applied; Done calls `pick` (the copy isn't live-shared, so no
    live-link rule)

- [ ] **Step 1: Write the failing tests:** the item is hidden when `mainPlaces` is empty and the
  dashboard has no visible bar; with a visible bar, the bar's place is replaced and the copy's bar
  shows the new place; otherwise the main place is replaced (a tie asks which first); mixed and
  other-place widgets unchanged; the copy goes through the existing rename step; the original is
  untouched; a copy of a non-starter dashboard gains no bar; the starter itself duplicates with its
  chosen place replaced.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, `npm run check`.
- [ ] **Step 5: Commit** `feat: Duplicate for another place`

### Task 9: E2E and accessibility

**Files:**
- Create: `e2e/starter.spec.ts`, `e2e/notes.spec.ts`

- [ ] **Step 1: Write the specs** (spec "Testing" → E2E): first visit in Fresno County with the
  welcome Note; Change place without a copy, across a reload; the first edit (a move, a calendar
  selection, "Open these days in a chart") makes a copy with the place and no `default-place`;
  sharing the starter copies first; the bar on the copy with "Also change…"; Duplicate for another
  place; add a Note, format it with the toolbar, reload, open its share link; **a hostile share
  link** (HTML, script, `javascript:` links, an unknown `message` key) renders inert with no CSP
  violation, and a 5,001-character Note is rejected; axe on the starter, a Note and the editor in
  light and dark, at desktop and phone widths (reading order Note → Current → Outside → Forecast →
  Chart → Calendar).
- [ ] **Step 2: Run** `npm run test:e2e` — PASS (fix in the owning task's code if not).
- [ ] **Step 3: Commit** `test: starter and Notes e2e and accessibility`

### Task 10: Docs, deferrals, copy review, stack check

- [ ] **Step 1: Docs** (re-read each file right before editing): `ARCHITECTURE.md` "Starter
  dashboard", "Security baseline", "Widget catalog", "Widget-type contract", "Tech stack";
  `CLAUDE.md` "Key Libraries" (Lexical, `marked` installed; the Markdown renderer row filled);
  `TODO.md`/`ROADMAP.md` step 4 sections only.
- [ ] **Step 2: `DEFERRED.md`** (spec "Deferrals"): the Map joins the starter in step 6 (heatmap
  slot empty); more Note formatting; Lexical pre-1.0; "Linking widgets" updated; a bar for
  non-starter dashboards; and a line in each existing starter entry (hand-off timing, journal
  records, `droppedEdits`, fullscreen across the first edit) on whether a real starter changes it.
- [ ] **Step 3: Copy review.** A fresh-eyes subagent reads every new string where it renders
  (the welcome Note, the bar, "Also change…", the editor, the empty hint, Duplicate for another
  place, the tie chooser) and checks keys match their text.
- [ ] **Step 4: Stack check** against `develop`: the starter in Fresno County and at a school
  (local data is incomplete; rule out downtime first). Screenshots to the user as images.
- [ ] **Step 5: Full run:** `npm run lint`, `npm run check`, `npm run test`, `npm run test:e2e`,
  `npm run build && npm run check:build && npm run check:budget`. Commit `docs: spec 6 docs and
  deferrals`; open the PR into `step-4` listing every new key and its English and the bundle
  number; `gh pr checks` after pushing; tell the coordinator.
