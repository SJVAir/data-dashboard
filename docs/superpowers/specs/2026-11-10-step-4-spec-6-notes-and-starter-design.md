# Release 1, step 4, spec 6: the Notes widget and the starter dashboard

Status: brainstormed with the user 2026-11-10; checked by a fresh builder read (its four
questions answered below: one by the user's earlier answer, three as my calls); approved by the user
2026-11-10. Branch
`step-4-spec-6` from `step-4` (after #48 merged `origin/main` into `step-4`); its PR goes into
`step-4`.

Calls marked **(my call)** are the brainstorming session's own; everything else is the user's.

## Where this sits

Step 4 is seven specs into `step-4`. Specs 1, 2, 3, 3b, 4 and 5 are merged (#36, #38, #40, #43,
#45, #47). This is the last one. It adds the **Notes** widget type and turns the starter from
three placeholder widgets into the real **starter dashboard** from `ARCHITECTURE.md` →
"Starter dashboard".

**Finding from the brainstorm:** the starter's place plumbing isn't built. `default-place`
exists in the schema, but nothing resolves it: the data layer reports `place-unsupported`
(`src/lib/data/adapters/targets.ts`), there is no "Change place" bar, no place preference, and
no exit (the first-edit copy, "New from starter", duplicating the starter, Export, copy link)
replaces it. Sharing the starter also doesn't copy first, though `ARCHITECTURE.md` says it does.
This spec builds all of that, and the user extended it (below) with a bar that stays on
copies made from the starter and with "Duplicate for another place".

## Why

A first-time visitor (a parent, a teacher) should see an answer right away instead of a blank
page: is the air okay now, where I am, and can the kids go outside? The one thing we most want
them to do next is make it about their place: pick their school or ZIP Code, and every widget
follows. Notes let anyone annotate a dashboard they share, for example a teacher explaining what
the class is tracking.

## Who it's for

- **A parent or teacher, first visit:** reads the welcome Note, sees today's air in Fresno
  County, changes the place to their school, and keeps going.
- **A teacher sharing a dashboard with a class:** writes a Note explaining it, without having to
  learn Markdown.
- **Someone tracking several places:** duplicates a dashboard for another school instead of
  switching one dashboard back and forth.

## Goals

1. A **Notes** widget: formatted-as-you-type editing in a dialog, saved as Markdown, rendered
   safely, loaded lazily.
2. The **starter's contents and layout**, with a welcome Note.
3. **`default-place` resolved** at display time from a preference and replaced at every exit.
4. The **"Change place" bar** on the starter and on copies made from it.
5. **"Duplicate for another place"** for any dashboard. **It is in this spec** (the user: "both
   in spec 6, Duplicate last"): last in the plan, so it could split off as a spec 6b only if
   the plan comes out too big, and only with the user's yes. Build "replace place A with B" and
   "main place" general from the start.

## Non-goals

- The Map widget on the starter (step 6, `ROADMAP.md`).
- General widget linking or cross-filtering (stays in `DEFERRED.md` → "Linking widgets").
- "Mark for analysis" / "Add to collection" (Release 3; they don't exist yet, see "Exits").
- Images, tables, code blocks, quotes, colors or font sizes in Notes.

## Anti-goals

- People having to know Markdown syntax to write a Note (the user: "Teachers and students
  might get confused dealing with markdown syntax").
- Any HTML string from a Note reaching the page (no `innerHTML`, `{@html}`, or inline script).
- Growing the initial bundle with the editor or the renderer.
- A copy, share or export carrying `default-place`.
- The bar silently changing a widget someone pointed at another place on purpose.

## Decisions

### The starter's contents and layout

The user approved this layout (12-column grid, top to bottom):

```
Welcome Note (full width, about 2 rows)
Current conditions (PM2.5) | "Can we go outside?" | Forecast strip (6 wide)
PM2.5 chart, last 30 days (8 wide)        | Month calendar, "This month" (4 wide)
```

- **The heatmap's old slot stays empty**; the year calendar does not take it. The user: "leave
  the map slot empty". The Map joins in step 6 as **a full-width row under the "now" row**
  (inserted there, pushing the chart and calendar down); nothing in this spec reserves blank
  space for it.
- Widgets: Current conditions (PM2.5), "Can we go outside?" (PM2.5), Forecast strip (the chosen
  place's forecast), Chart (PM2.5, trailing 30 days), Month calendar (`calendar-month`, PM2.5,
  "This month"). Each layer's place is `{ kind: "default-place" }`. Titles stay `null`
  (generated from metadata).
- **Sizes (my call):** the "now" row shares one height that fits "Can we go outside?" (at least
  its minimum of 5 rows); the month calendar is at least 4 wide so its legend doesn't wrap
  (`DEFERRED.md` → "Calendars review leftovers"). Exact rects are the builder's, within these.
- **Phones:** reading order is the order above (Note, Current, Outside, Forecast, Chart,
  Calendar), which the layout engine already gives from `y`, then `x`.
- **`StarterHint` goes away (my call):** the bar and the welcome Note now say what it said.

### The welcome Note

- Text (the user approved the draft and asked to say it's an editable Note; final wording goes
  through the copy review):

  > **Welcome to the SJVAir Dashboard.** These widgets show air quality for one place. Use
  > **Change place** above to pick your school, city or ZIP Code. You can move, resize or add
  > widgets, and your first change saves the dashboard as your own. This is a Note: edit it or
  > delete it any time.

- It is a **message key**, not stored English (`ARCHITECTURE.md` → "Internationalization").
  The Note's saved options hold a reference to the message, not its text. **The schema accepts
  any key-shaped reference; the allowlist is checked when rendering** (my call): an unknown key
  renders as an empty Note (with the edit hint where editing is possible), so renaming or
  removing a message never stops a saved copy or share from opening. Keep the key stable
  anyway.
  A personal copy keeps the reference; only when the user edits the Note does it store the
  Markdown they saved. The message's English is itself Markdown and goes through the same
  renderer.

### Notes: writing

- **A dialog** (the user): "Edit note" in the widget menu, or double-clicking an empty Note,
  opens it. Adding a Note from "Add widget" adds the widget and opens the dialog at once (Notes
  are the first `addable` type). Read-only views (a live share someone else owns, an unreadable
  dashboard) offer no editing.
- **Formatted as you type** (the user, after weighing it against Markdown with a preview): bold
  looks bold, a list looks like a list; no Markdown symbols are on screen.
- **Editor: Lexical** (the user chose it over Tiptap; MIT, by Meta). Measured 2026-11-10 as
  about 99 KB gzip for rich text, lists, links, history and Markdown import/export (Tiptap
  about 146 KB, Milkdown 116 KB, hand-built ProseMirror 125 KB). It is pre-1.0 (0.53), so pin
  it exactly. It loads **only when the dialog opens**.
- **Toolbar** (our own buttons, shadcn-svelte): Bold, Italic, Heading, Bulleted list, Numbered
  list, Link. Usual shortcuts (Ctrl/⌘+B, I, K). Typing `- ` or `1. ` at a line start may start
  a list (Lexical's Markdown shortcuts, limited to the allowed set). **Heading has one level
  (my call)**, rendered as a small heading inside the widget.
- **Link** asks for an address; only `http:`, `https:` and `mailto:` are accepted (with a
  message otherwise). Pasted web addresses become links.
- **Paste** keeps only the allowed formatting (Lexical maps pasted HTML onto the allowed nodes;
  everything else becomes plain text).
- **Save** writes the Markdown as one undo step; **Cancel** with changes asks "Discard
  changes?", like Edit data.
- **Length limit (accepted in the brainstorm): 5,000 characters of Markdown,** enforced by the
  schema; the dialog shows a counter near the limit and stops Save over it.

### Notes: saving and the schema

- Note text lives in the widget's **`options`** (the free-form per-type field), parsed by a
  Notes options schema: either `{ text: string }` (max 5,000) or `{ message: <key-shaped string> }`
  for the built-in welcome (allowlisted at render, above). `data` stays `{ layers: [] }`. An invalid or oversized Note fails
  the whole document's validation, as today for every incoming document (the document schema
  must check `options` for `note` widgets, not leave it free-form).
- The saved Markdown is the editor's output, normalized (my call): only the allowed constructs,
  line breaks preserved. A round trip (Markdown → editor → Markdown) must not change a saved
  Note.

### Notes: viewing

- **Renderer: `marked` (my call; MIT, about 15 KB gzip), its lexer only.** Its tokens are drawn
  by Svelte components; nothing renders a string of HTML. Raw HTML tokens show as plain text.
  `markdown-it` (about 42 KB) is the fallback if `marked`'s tokens don't fit.
- Allowed: paragraphs (single line breaks kept), the one heading level, bold, italic, bulleted
  and numbered lists, links, autolinked addresses. Anything else (images, tables, code, quotes,
  other heading levels) renders as plain text.
- **Links:** only `http:`, `https:`, `mailto:` become links, opening in a new tab with
  `rel="ugc nofollow noopener"` (`target="_blank"`); any other URL is plain text. Checked at
  render time, whatever the saved text says.
- The renderer and the Notes component load **lazily** (behind the type's `load`/`loadLazy`),
  only for dashboards with a Note. Long Notes scroll inside the widget.
- An empty Note shows a short hint to edit it (only where editing is possible).
- Generated title: the type's label ("Note"), like every type (my call).
- Notes text is never sent in error reports (already the rule).

### Notes and the widget contract

`time: "none"`, no `accepts`, `analyzable: false`, `downloadable: false`, `thresholds` off,
`addable` returning `{ layers: [] }` with empty text. Minimum 3 × 2, default 4 × 3 (my call).

**The three place spots (`project-new-widget-type-checklist`) need nothing for Notes** (checked
in the code): `lookupInput` and `regionOf` return early when a widget has no places layer, and
Get data's `setType` only receives data types. The plan adds a test for each so that stays
true. The starter's `default-place` must resolve in all three (below).

### `default-place`: resolving it

- **The preference:** the starter's chosen place is a per-space preference (platform adapter)
  holding a `PlaceRef` other than `default-place`; unset means Fresno County (the region read
  from metadata, not hardcoded beyond its identity). A point from "Use my location" may be stored
  there: it stays in this browser.
- **At display time** the starter's widgets get their layers with `default-place` replaced by
  the chosen place, so every widget, the data layer, the picker's `regionOf`, sharing's
  `lookupInput` and Get data see an ordinary place. The data layer never receives
  `default-place` (it stays `place-unsupported` as a backstop).
- **One resolve function** replaces `default-place` in a document with a given place. It runs at
  every exit:
  - the first edit's copy (`starterSession` → `copyOfStarter`), including edits made through
    Get data's "Add to dashboard" and "Edit data" on the starter, calendar selections, and
    "Open these days in a chart";
  - "New from starter" and duplicating the starter;
  - Export / download of the starter;
  - copy link and share: **sharing the starter first makes the personal copy**, then shares it
    (`ARCHITECTURE.md`); the existing point-to-region swap then applies;
  - later, "Mark for analysis" / "Add to collection" (Release 3; not built, so nothing here;
    `ARCHITECTURE.md` already requires it).
- Storage is not validated on write today; the copy must be validated (or built so it can't hold
  `default-place`) before it is stored, so a missed path fails loudly, never stores a placeholder.

### The "Change place" bar

**On the starter** (decided earlier, `ARCHITECTURE.md`): "Showing Fresno County · Change place"
above the widgets, with the shared place picker (single mode; schools, places, monitors, and the
opt-in "Use my location"). Picking a place changes every starter widget at once and saves the
preference; it does **not** make a copy.

**On copies made from the starter** (the user: "Keep the bar on copies made from the starter"):

- The copy remembers the bar's place (a saved dashboard field, schema-validated, set when the
  copy is made from the resolved starter).
- "Change place" there is an ordinary edit: it switches **the widgets showing the bar's place**
  to the new place, in one undo step, autosaved.
- **Widgets someone pointed at another place are left alone** (the user). When some exist, the
  picker offers an unchecked **"Also change the N widgets showing other places"** (the user asked
  for a way to change everything; this is it).
- **Never switched, even with that option:** a widget comparing several places (a `selection`,
  or layers at different places) and data tied to its own place, such as a chosen weather
  station (switching would quietly change what the widget means). (My call on the exact rule:
  a widget switches only when all its place-bearing layers show the same single place and none
  holds a place-tied choice.)
- If no widget shows the bar's place any more, the bar hides (my call).
- On a live share link the viewer sees "Showing …" without "Change place" (my call).
- **The bar's place travels with the dashboard** (my call): share links, Export, live shares
  and copies from shares keep it, so viewers see "Showing …" and someone copying a share gets
  the bar. It is a `PlaceRef` like a layer's place, so **every exact-point rule covers it too**:
  the point-to-region swap for links, Export and copies from shares, the live-link prompt and
  swap, and the upload guard (`src/lib/sync/points.ts`). A swap replaces the bar's point and
  the matching layers' points with the same region, so the bar keeps matching its widgets.

**Under the hood, one mechanism:** "replace place A with place B across this dashboard", under
the switching rule above. The bar, "also change the others", and "Duplicate for another place"
all use it.

### "Duplicate for another place" (last in the plan)

- Any dashboard, not just starter copies (the user). The dashboard menu gains it next to
  Duplicate (my call on placement and label); it asks for a place, then makes the copy with the
  dashboard's **main place** replaced, then the existing rename step.
- **Which place is replaced (my call):** on a dashboard with a visible bar, the bar's place
  (that's what the dashboard is "about"; the bar then shows the new place). Otherwise the
  **main place**: the place most switchable widgets show; on a tie, the person picks which place
  to replace.
- A copy of a starter copy keeps the bar (showing the new place); a copy of any other dashboard
  doesn't gain one (my call).
- Duplicate stays as it is.

## Accessibility (WCAG 2.2 AA)

- The editor dialog: labeled, focus trapped and returned; toolbar buttons are toggle buttons
  with `aria-pressed` and visible labels or tooltips; every toolbar action has a shortcut;
  the editable area has an accessible name; the counter is announced politely near the limit.
- Rendered Notes use real headings, lists and links; links say they open in a new tab
  (accessible text, not color alone).
- The bar is a labeled region; a place change is announced ("Showing Roosevelt High").
- Reduced motion respected; light and dark checked with axe.

## Bundle

The initial bundle is 204.8 KB gzip (accepted by the user for now). Lexical, `marked` and the
Notes component stay out of it. The bar is in the starter's path, so keep it small (the picker is
already lazy). Run `npm run check:budget` after each task that adds imports and **report any
growth to the user before going on** (the user).

## Constraints (project rules that bite here)

- Lexical and `marked` must pass `vite-plugins/licenses.ts`; third-party notices update.
- The CSP stays as is (`img-src` already blocks remote images); no new hosts.
- Paraglide messages, no concatenation, keys matching their text; the welcome Note's key is the
  only Markdown-bearing message (my call). Formatting through `$lib/format`.
- Preferences and geolocation through the platform adapter. Theme tokens only. Svelte 5 runes.
- Every incoming document is validated, including `note` options and the bar's field.
- SDK pin unchanged (`5.0.0-beta.8`); anything missing goes to the coordinator.

## Testing (what must be shown)

- **Unit:** the Notes options schema (limit, message allowlist, junk rejected); Markdown round
  trip; the renderer's token mapping (raw HTML as text, `javascript:` / `data:` / relative links
  as text, `mailto:` allowed, line breaks kept); the resolve function on every widget type;
  "replace A with B" (switching rule, "also change the others", comparisons and weather stations
  untouched); main place and ties; the three place spots with a Note and with a resolved starter.
- **Browser:** the editor dialog (toolbar, shortcuts, paste of HTML, link validation, counter,
  Save as one undo step, Cancel → "Discard changes?"); a rendered Note's link attributes; the bar.
- **E2E:** first visit shows the starter in Fresno County with the welcome Note; Change place
  updates every widget without a copy and survives a reload; the first edit (including a
  calendar selection and "Open these days in a chart") makes a copy holding the chosen place,
  never `default-place`; sharing the starter copies first; the bar on the copy with "also change
  the others"; Duplicate for another place; add a Note, write formatted text, reload, share
  link shows it; a hostile Note (HTML, script and `javascript:` links in a share link) renders
  inert under the CSP fixture; axe on the starter, a Note and the dialog in light and dark.
- **Stack check:** the starter against `develop` in Fresno County and at a school. Local data is
  incomplete; rule out downtime before calling a gap a bug.
- `npm run build && npm run check:build && npm run check:budget`; `gh pr checks` after pushing.
- **Copy review:** a fresh-eyes subagent checks every new string where it renders; the PR lists
  every new key and its English for the user's approval.

## Deferrals (added to `DEFERRED.md` in the same change)

- **The Map joins the starter in step 6** as a full-width row under the "now" row; the
  heatmap's old slot is left empty until then. **Revisit when** step 6 adds the Map widget.
- **More Note formatting** (images, tables, code, quotes, more heading levels). Images would
  also need CSP and privacy work (remote loads from a shared page). **Revisit when** people ask.
- **Lexical is pre-1.0.** Pinned exactly. **Revisit at** its 1.0 or on any upgrade.
- **"Linking widgets"** stays deferred; update its entry: the bar on starter copies and the
  "replace place A with B" mechanism are the narrow form, and a dashboard-wide place should
  build on them.
- **A dashboard bar for non-starter dashboards** ("Duplicate for another place" doesn't add
  one). **Revisit with** "Linking widgets".
- Existing starter entries (the hand-off timing, journal records, `droppedEdits`, fullscreen
  across the first edit) are unchanged by this spec; the builder notes in each whether a real
  starter changes its likelihood.

## Docs changed with this spec

- `ARCHITECTURE.md`: "Starter dashboard" (layout, the bar on copies, "also change the others",
  Duplicate for another place, StarterHint removed, sharing copies first as built); "Security
  baseline" (Lexical + `marked`, the token renderer); "Widget catalog" and "Widget-type
  contract" (Notes as built, `options`); "Tech stack" / CLAUDE.md "Key Libraries" (Lexical and
  `marked` installed; the Markdown renderer row filled in).
- `TODO.md` / `ROADMAP.md`: step 4's sections only. `DEFERRED.md` as above.

## Left to the builder

- **Code shape:** where the display-time resolution happens (a derived view of the starter
  session's document is the likely shape), the bar's saved field name, the Notes options shape's
  field names, the editor component's structure, and how `marked` tokens map to components.
- **Small calls:** exact rects, the dialog's size, the counter threshold, toolbar icons.
- **Wording:** every message, through the copy review.
