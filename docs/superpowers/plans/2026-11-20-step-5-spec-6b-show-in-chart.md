# Step 5 spec 6b: "Show in a chart" / "Show in a table" from a Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a Map's ⋯ menu (owners and viewers) and a pinned section card, open the Data
Portal on a Chart or Table of the marks (or the section) over the Map's range, with choosing
which places to keep when over the cap, never touching the saved draft.

**Architecture:** The Map's chunk publishes, per widget, the marks to send and a getter for its
dataset in a light registry (initial bundle). The Map's menu items (opted in for viewers) and the
section card's button call a lazy hand-off that converts the Map's draft through the existing
`fromMapDraft`, swaps in the places for a `MapSend`, and navigates with the draft in history
state. `GetData.svelte` starts from that state without saving drafts. The place picker gains a
"keep" state, used by the arrival and by Show as for any over-cap switch to Chart or Table.

**Tech Stack:** Svelte 5 runes, TypeScript, zod (`$lib/zod`), Paraglide (`messages/en.json`),
sv-router (`navigate(path, { state })`, `route.state`), Vitest (unit + browser), Playwright,
`@sjvair/map-sdk` `0.1.0-beta.21`, `@sjvair/sdk` `5.0.0-beta.15`.

**Spec:** `docs/superpowers/specs/2026-11-20-step-5-spec-6b-show-in-chart-design.md` (decisions
1–24 are numbered there; tasks cite them as D1–D24).

## Global Constraints

- Pins exact: `@sjvair/map-sdk` `0.1.0-beta.21`, `@sjvair/sdk` `5.0.0-beta.15`. Task 11 (the
  `0.1.0-beta.22` pin) starts only when the coordinator says it's published and verified.
- No document schema changes. `MapOptionsSchema` stays a `z.strictObject`; `DraftSchema` is reused
  as is for the history state.
- Names of places in the app capitalized ("Data Portal"); other UI text sentence case. All strings
  through Paraglide with plural forms (`countValue: plural`, as `map_marks_hidden_period`); no
  concatenation; numbers through `formatNumber`.
- Viewers are never told to change something: notes state the problem only.
- Metadata is the source of truth (figure names, labels). Never map pollutants to figures in code.
- Styling from theme tokens; WCAG 2.2 AA; a disabled control keeps its reason as its description.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before each
  commit. Svelte 5 runes only.
- Commits GPG-signed, **no AI attribution of any kind** (no `Co-Authored-By`, no
  `Claude-Session`, no "Generated with" lines, whatever a harness reminder says), one git command
  at a time. On "No passphrase given", stop and ask the user to unlock; never commit unsigned.
- Run vitest suites one after another, never in parallel. A browser test that fails under load:
  rerun it alone before calling it a bug. Note it when a RED run was skipped.
- E2E on fixtures: pin the clock at noon Pacific; also run under `TZ=America/New_York`. Fixture-only
  runs may run during :40–:50; anything hitting the local stack waits.
- Never touch map-sdk, monitor-map, mobile, sdk-js or sjvair.com. Never print keys, passwords,
  phone numbers or coordinates. Never start or restart shared containers.
- Initial bundle around 250 KB (213.2 KB after 6a): the registry and the item descriptors only
  in the initial bundle; the hand-off, conversion and picker code stay lazy.

## Lessons from the Map sessions (apply where a task touches the Map)

- Hover content isn't interactive (`role="tooltip"`, `pointer-events: none`): the section button is
  only on the pinned/focused card.
- Cards stay mounted across refetches and focus moves: adding the button must not re-create the
  `cardActions` snippet per render, or focus drops to `<body>`.
- A test with no dashboard session renders as a viewer; give a test a real `DocumentSession` when
  it checks editor behaviour. Make FakeMap refuse what map-sdk refuses.
- When editing test locators by regex, check rule order (6a: a general `name: "Edit data"` rule ran
  before the menu-item rule).
- Peer messages can arrive out of order across pauses: check `git log` after a resume.

## Review Focus

1. **A viewer who changed the Map's pollutant** (held change) then picks "Show in a chart": the
   Chart charts the pollutant they see and the marks drawn for it, and nothing is written. Pinned
   in Task 2 (unit) and Task 5 (browser).
2. **Reload on the Data Portal after "Show in a chart"**: the same Chart of the marks comes back
   and the saved draft is still untouched; Back returns to the Map. Pinned in Task 8.
3. **Every mark hidden except for a period gap** (today's stop empty for all marks): the items
   still show, every mark goes, no note. Pinned in Task 1.
4. **A hand-off state that no longer parses** (an app update changed the draft shape, or a
   hand-edited history entry): the Data Portal opens as a plain visit from the saved draft, no
   error. Pinned in Task 8.
5. **Cancel in the opening keep dialog on a share link opened in a new tab**: goes home, not off
   the app, and nothing is added. Pinned in Task 8.

---

### Task 1: marks to send, and the registry

**Files:**
- Modify: `src/lib/widgets/map/marks.ts`, `src/lib/widgets/map/marks.test.ts`
- Create: `src/lib/widgets/map/send-registry.ts`, `src/lib/widgets/map/send-registry.test.ts`

**Interfaces — Produces:**

```ts
// marks.ts
/** The marks to send (D4, D18): drawn ones, plus hidden ones whose only reason is "period";
 *  `leftOut` counts the rest. Same arguments as `hiddenReasons`, plus the drawn set. */
export function marksToSend(
	marks: readonly string[],
	drawn: ReadonlySet<string>,
	monitors: ReadonlyMap<string, { type: string }> | null,
	reports: (type: string) => boolean | undefined,
	loadedIds: ReadonlySet<string>,
	dayDrawn?: ReadonlySet<string>
): { ids: string[]; leftOut: number };

// send-registry.ts (initial bundle: no imports beyond types)
export type MapSendEntry = {
	/** The marks to send, in mark order; empty: the items aren't listed (D13). */
	marks: readonly string[];
	leftOut: number;
	/** The Map's dataset as this person sees it: data plus `tileOptions` (D21). */
	draft: () => { type: string; data: WidgetDataConfig; options?: Record<string, unknown> };
};
export function setMapSend(widgetId: string, owner: symbol, entry: MapSendEntry | null): () => void;
export function mapSend(widgetId: string): MapSendEntry | null; // the latest-set copy's entry
```

- [ ] **Step 1: failing tests.** `marks.test.ts`: `marksToSend` keeps a drawn mark; keeps a mark
  hidden only for `"period"`; leaves out `"pollutant"`, `"options"`, `"places"`, `"unknown"` and
  counts them (`leftOut`); keeps mark order; with every mark hidden for `"period"` returns all ids
  and `leftOut: 0`. `send-registry.test.ts`: set/get, removal function, two owners (the latest
  wins; removing one leaves the other), `null` clears.
- [ ] **Step 2:** `npx vitest run src/lib/widgets/map/marks.test.ts src/lib/widgets/map/send-registry.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Reuse `hiddenReasons`' per-mark reason (extract a `hiddenReasonOf`
  helper inside `marks.ts` so both share one rule). Registry modelled on
  `src/lib/calendars/shown-registry.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(map): marks to send and the send registry`.

### Task 2: the hand-off

**Files:**
- Create: `src/lib/widgets/map/show-in.ts`, `src/lib/widgets/map/show-in.test.ts`

**Interfaces:**
- Consumes: `fromMapDraft` (`src/lib/get-data/map.ts`), `toLayerPlaces` (`$lib/places/selection`),
  `useFigureOf`, `mapOptions` (`./options`), `CHART_TYPE` (`$lib/widgets/chart`), `DATA_TABLE_TYPE` (`$lib/widgets/table`), `STARTER_ID`.
- Produces:

```ts
export type MapSend =
	| { kind: "monitors"; ids: string[]; leftOut: number }
	| { kind: "section"; code: string };
// spec 7 adds a kind here and a case in sendPlaces; nothing else changes.

/** The main layer's places for a send (the plug-in point). */
export function sendPlaces(send: MapSend): { place?: PlaceRef; selection?: SpatialSelection };

/** What travels in history state (validated on arrival with `HandOffSchema`). */
export const HandOffSchema: ZodType<HandOff>;
export type HandOff = { draft: Draft; leftOut: number; overCap: boolean; skip?: string };

export type ShowInTarget =
	| { path: "/dashboards/:id/widgets/new"; id: string }
	| { path: "/data" };

/** Where to open (D2, D11): `app.current.session`'s dashboard when it holds `widgetId` and is
 *  editable (the starter as STARTER_ID), else /data (also returns `skip`: that dashboard's id when
 *  it holds the widget but is read-only). */
export function showInTarget(app: AppContext, widgetId: string): { target: ShowInTarget; skip?: string };

/** The Data Portal's starting draft for `send` to `type` (Chart or Table). */
export function showInDraft(
	map: Draft, send: MapSend, type: WidgetType,
	catalog: CatalogEntry[], drawable: readonly string[], now: Date
): HandOff;

/** Loads what's needed (catalog, map pollutants), builds, and navigates with `{ state: { getData: handOff } }`. */
export function showIn(app: AppContext, widgetId: string, send: MapSend,
	type: "chart" | "table"): Promise<void>;
```

`skip` is the Map's dashboard id when it's read-only (Task 3 uses it). Monitors: `fromMapDraft`
result, then the main layer's places replaced by `sendPlaces` (D7); `overCap` when the ids exceed
the type's `accepts.maxPlaces`; the resolution exactly as `fromMapDraft` leaves it (D19). Section:
a Chart with `{ dataset: "pesticide-use", entryType: useFigureOf(mapOptions(map), catalog), place:
{ kind: "region", type: "mtrs", code }, filters }`, the Map's `dateRange` and saved `resolution`
(D10). `title: null` stays the Data Portal's concern (no title in a draft).

- [ ] **Step 1: failing tests** (`show-in.test.ts`, fixtures from `src/lib/get-data/map.test.ts`):
  - monitors → Chart: layers are `fromMapDraft`'s with places = the ids in order; 1 id gives
    `place`, 2+ give `selection: { kind: "monitors" }`; `overCap` false at 5, true at 6;
    Table: true at 11.
  - a Map at Monthly (saved) gives a Monthly Chart; an Automatic Map gives no `resolution`; a Now
    Map gives the Chart's default range (D14, D19).
  - the Map's smoke and fire, notices, fill and marks don't reach the Chart; use reaches the Chart
    and not the Table (as `fromMapDraft`); the held-pollutant case: `options.showing` from the
    passed draft (a viewer's) decides the pollutant.
  - section → Chart: the layer above, the Map's range and `resolution`, filters copied.
  - `sendPlaces`: never returns a `point` (checklist: `points.ts`).
  - `showInTarget`: current editable dashboard → widgets/new with its id; starter → `STARTER_ID`;
    read-only session (`"newer"`, `"invalid"`, `"unkept"`) → `/data`; no session (share link) →
    `/data`.
  - `HandOffSchema` accepts `showInDraft`'s output and rejects one whose `draft` fails
    `DraftSchema` (a layer with an unknown key shape) or whose `leftOut` is negative.
- [ ] **Step 2:** `npx vitest run src/lib/widgets/map/show-in.test.ts` → FAIL.
- [ ] **Step 3:** Implement. `showIn` uses `getMetadata().catalog()` and `.mapPollutants()`
  (as `GetDataView`'s `loadMapPollutants`) and `navigate(..., { state: { getData } })`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(map): the Show in a chart hand-off`.

### Task 3: "Add to" never targets a read-only dashboard

**Files:**
- Modify: `src/lib/store/dashboard-index.svelte.ts` (`DashboardSummary.readOnly?: true` for a
  `"newer"` document), `src/lib/get-data/add.ts`, `src/lib/get-data/add.test.ts`,
  the index's test file.

**Interfaces — Produces:** `addTargets(app, routeId, lastOpened, skip?: ReadonlySet<string>)`:
items with `readOnly` and ids in `skip` are neither `selected` nor in `others` (D22). The starter
fallback stays.

- [ ] **Step 1: failing tests:** a `"newer"` item is listed with `readOnly: true`; `addTargets`
  skips it as button and in others; skips an id in `skip` even when it's last-opened (falls to the
  next rule: starter); unchanged results without either.
- [ ] **Step 2:** run `npx vitest run src/lib/get-data/add.test.ts` and the index test → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5:** Commit `fix(get-data): Add to skips read-only dashboards`.

### Task 4: viewers see opted-in type menu items

**Files:**
- Modify: `src/lib/actions/types.ts` (`MenuItem.forViewers?: boolean` — "shown on a read-only
  frame too; only for items that change nothing"), `src/lib/components/dashboard/WidgetFrame.svelte`
  (the read-only provider adds `type.menu(ctx, env).filter((i) => i.forViewers)` first)
- Test: the WidgetFrame browser test file (find with `grep -rl WidgetFrame src --include='*.browser.test.ts'`)

- [ ] **Step 1: failing tests:** on a read-only frame, a fake type's item with `forViewers: true`
  is listed, one without isn't; the calendars' "Open these days in a chart" isn't listed read-only
  (D20); editable frames unchanged.
- [ ] **Step 2:** run that browser file alone → FAIL.
- [ ] **Step 3:** Implement. The taskbar menu of a minimized widget uses the same provider (check;
  if it doesn't, apply the same filter there).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(menus): type items can opt in for viewers`.

### Task 5: the Map's menu items

**Files:**
- Modify: `src/lib/widgets/map/index.ts` (`menu`), `src/lib/widgets/map/MapWidget.svelte` (write
  the registry), `messages/en.json` (`map_show_in_chart`: "Show in a chart", `map_show_in_table`:
  "Show in a table")
- Create: `src/lib/widgets/map/show-in-items.ts` (descriptors, initial bundle)
- Test: `src/lib/widgets/map/map-widget.browser.test.ts`, `src/lib/widgets/map/show-in-items.test.ts`

**Interfaces:** `showInItems(env: WidgetMenuEnv): MenuItem[]` — two items (`id`s
`map_show_in_chart`, `map_show_in_table`, group `"data"`, icons `ChartLine` and `Table`,
`forViewers: true`), only while `mapSend(widget.id)?.marks.length`; `run` loads `./show-in` with
`loadLazy` (as `openInChartItems`) and calls `showIn(env.app, id, { kind: "monitors", ids,
leftOut }, type)`. `MapWidget` sets its entry from `MapNoteLines`' inputs
via `marksToSend` (expose what's needed from `MapNoteLines`: add a `send` getter there rather than
repeating its lookups) and `draft: () => ({ type, data: widget.data, options: wiring.options })`;
**not in a preview** (`!tileOptionsContext`: no entry; D23).

- [ ] **Step 1: failing tests:** items absent with no marks; absent with every mark hidden for
  pollutant or places; present with one drawn; present for a viewer (`tileOptions` view mode)
  and its held pollutant reaches `draft()`; absent in a preview mount; the registry entry is
  cleared on unmount; clicking runs `showIn` (spy) with the sent ids.
- [ ] **Step 2:** run the two files alone → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(map): Show in a chart / Show in a table`.

### Task 6: the section card's button

**Files:** `src/lib/widgets/map/MapWidget.svelte` (`cardActions`), `messages/en.json` (reuse
`map_show_in_chart`), test `src/lib/widgets/map/section-card.browser.test.ts` or
`map-widget.browser.test.ts`.

A card is a section's when its feature's properties have `level === "section"` (`UseProps`; the
`"sections"` and `"lens"` plugins). The MTRS code is the feature's `name` (`p.mtrs`), not `id`.
Shown on pinned/focused cards (map-sdk renders `actions` only there), not in a preview (D23),
for editors and viewers (D15). Runs `showIn(..., { kind: "section", code }, "chart")`.

- [ ] **Step 1: failing tests:** a pinned section card has "Show in a chart" and its click sends
  the code from `name`; a township card has none; the hover form has none; a preview has none;
  focus stays on the button across a refetch (cards stay mounted).
- [ ] **Step 2:** run alone → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(map): Show in a chart from a section card`.

### Task 7: the place picker's keep state

**Files:** `src/lib/places/PlacePicker.svelte`, `src/lib/places/picker-state.svelte.ts`,
`src/lib/get-data/WhereControl.svelte`, `messages/en.json` (`place_picker_keep`, plural: "Choose
up to {count} place to keep." / "Choose up to {count} places to keep."), tests
`src/lib/places/place-picker.browser.test.ts`, `src/lib/get-data/get-data-view.browser.test.ts`.

**Interfaces — Produces:** `PlacePicker` accepts `initial.length > mode.max` (keep state while
over): the keep line shows above the chips; Done is `disabled` with the line's id as
`aria-describedby`; adding stays blocked (`at-cap`). `WhereControl` gains
`keep?: { max: number; onkeep: (picks: Picks) => void; oncancel: () => void }`: when set, its dialog
opens at once in multiple mode at `keep.max` with the current picks, Done calls `onkeep`, Cancel /
Escape / close calls `oncancel`.

- [ ] **Step 1: failing tests:** 7 initial picks at max 5: line reads "Choose up to 5 places to
  keep.", Done disabled and described by it, removing 2 enables Done, the line goes at ≤ max; no
  row can be added while over; `WhereControl` with `keep` opens on mount and routes Done/Cancel.
- [ ] **Step 2:** run each file alone → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(places): choose which places to keep`.

### Task 8: the Data Portal opened from a Map, and Show as's keep

**Files:** `src/routes/GetData.svelte`, `src/lib/get-data/GetDataView.svelte`,
`src/lib/get-data/offer.ts`, `src/lib/get-data/offer.test.ts`, `messages/en.json`
(`get_data_marks_hidden_left_out`, plural: "{count} marked monitor isn't shown on the map, so it
was left out." / "{count} marked monitors aren't shown on the map, so they were left out."),
tests `src/lib/get-data/get-data-view.browser.test.ts` and a new
`src/routes/get-data.browser.test.ts` if none covers the route.

**Interfaces:**
- `GetDataView` new props: `saves?: boolean` (default true; false: never `saveDraft`/`flushDraft`,
  D3), `leftOut?: number` (the note, D4), `keepOnOpen?: { oncancel: () => void }` (open the Where
  keep dialog at once, D17).
- `GetData.svelte` on a `new` visit: `HandOffSchema.safeParse((route.state as any)?.getData)`;
  valid → `initial = handOff.draft`, `saves = false`, targets from `addTargets(..., skip)`;
  invalid/missing → today's path. `dirty` for a hand-off visit compares with the baseline, which
  becomes the kept draft after the opening Done (D24). Cancel in the opening dialog runs
  `cancelPlan` (Back, else the dashboard, else home).
- `offer.ts`: `typeBlock` no longer returns `"places"` for Chart and Table (types with
  `maxPlaces > 1` that aren't the Map); ShowAs then calls `setType`, which, when the picks exceed
  the new cap, opens the keep dialog and converts on `onkeep` with the kept places; on cancel
  nothing changes (D17). The conversion's `"places"` cut note doesn't show after a keep.

- [ ] **Step 1: failing tests:**
  - offer: a 25-place Map's draft isn't blocked for Chart or Table; a now type still is.
  - view: Show as Chart from a 7-place Table opens the keep dialog; Cancel keeps Table and its 7;
    Done with 5 gives a Chart with those 5 and no "places left out" note.
  - route: a valid hand-off opens on its Chart with its places, `platform.preferences.set` never
    called for `DRAFT_KEY` (also after an edit and `pagehide`); `leftOut: 2` shows the note;
    `overCap` opens the dialog, Cancel calls Back (router index > 0) or navigates home (index 0,
    `/data`); after Done, leaving without edits doesn't ask; after an edit it asks "Discard
    changes?"; an invalid `getData` state opens the saved draft; `skip` keeps a read-only
    dashboard out of Add to; a reload (remount with the same `history.state`) gives the same
    Chart (Review Focus 2, 4, 5).
  - editor wording: tests that check editor text use a real `DocumentSession`.
- [ ] **Step 2:** run each file alone → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(get-data): open from a Map; choose which places to keep`.

### Task 9: the new widget type checklist

**Files:** tests only, beside the code: `src/lib/sharing/points.test.ts` (or its browser test),
`src/lib/places/place-picker-dialog.browser.test.ts`, `src/lib/get-data/notes-excluded.test.ts`.

- [ ] **Step 1:** Add: a Chart added from a hand-off (monitors; and the section's `mtrs` region)
  needs no point swap on share (`pointSwaps` returns `[]`); "Change place" on that Chart opens with
  the monitors (and the section) as chips (`regionOf` not reached); `fromMapDraft`'s notes for a
  Map with pollutants, smoke and fire, notices, use and a fill, at Daily, Monthly, Yearly and Now,
  minus the marks note, are what the hand-off view shows.
- [ ] **Step 2:** Run each alone; they should pass on Tasks 1–8's code. A failure is a bug in the
  owning task's code: fix it there.
- [ ] **Step 3:** Commit `test: Show in a chart across sharing, Change place and notes`.

### Task 10: E2E

**Files:** `e2e/map.spec.ts` (or a new `e2e/show-in.spec.ts`), fixtures under `e2e/fixtures/` and
`e2e/map-data-server.ts`.

- [ ] **Step 1:** Scenarios (clock pinned at noon Pacific): mark 3 monitors on a Map, ⋯ → Show in
  a chart, the Chart of the 3 in the Data Portal with the Map's range, Add to the dashboard, the
  widget lands; mark 7 → Show in a chart → keep dialog, untick 2, Done, Chart of 5; Show in a table
  with 7 → no dialog (cap 10); from a share link, Show in a chart, Add to names the viewer's own
  dashboard; a Monthly Map with pesticide use, pin a section card, Show in a chart, a Chart named
  with the PLSS code; axe check on the Data Portal with the keep dialog open.
- [ ] **Step 2:** `npm run test:e2e -- e2e/show-in.spec.ts`, then `TZ=America/New_York npm run test:e2e -- e2e/show-in.spec.ts` → PASS.
- [ ] **Step 3:** Commit `test(e2e): Show in a chart from a Map`.

### Task 11 (gated on the coordinator): `@sjvair/map-sdk` `0.1.0-beta.22`

Start only when the coordinator says it's published and verified.

**Files:** `package.json`, `package-lock.json`, `CLAUDE.md` (Key Libraries row),
`src/lib/widgets/map/host/messages.ts` (add `mapsdk_list_row_level_detail`), the monitors plugin's
`legendUnits`/`legendNote` (name the month or year figure from `period_statistic_label`), the
regions plugin's `noFigureLabel` and `detail(props)` (a no-figure region's reason), `DEFERRED.md`
(remove "map-sdk: list the two new `Scale` keys in `NO_SCALE`" and "The Map's legend doesn't name
the month or year figure").

- [ ] **Step 1:** `npm install --save-exact @sjvair/map-sdk@0.1.0-beta.22`.
- [ ] **Step 2:** Wire the three additions per the coordinator's notes; tests through map-sdk's real
  Legend or E2E (not FakeMap's snippet); a `null` scale still draws no legend section.
- [ ] **Step 3:** `npm run check`, `npm run test:unit`, then `npm run test:browser` → PASS.
- [ ] **Step 4:** Commit `chore: @sjvair/map-sdk 0.1.0-beta.22 (figure names, no-figure reasons)`.

### Task 12: docs

**Files:** `ARCHITECTURE.md` ("Map SDK": the Map's items and the section button; "Viewer changes":
viewers' opted-in items, what is sent; the Data Portal section: opened from a Map, history state,
no saved draft, keep dialog; "25 places at most": replace "choosing which places to keep comes in
step 5 spec 6" with the keep dialog), `DEFERRED.md` (the spec's Deferrals list exactly: remove
"Spec 6b charts only the drawn marks"; re-trigger the spec 4 past-day entry and `land_use`/`mtrs`
browsing; update "Readable names for MTRS sections"; add "Show a township in a chart"), `TODO.md`
(step 5 status line for 6b), the spec's post-approval calls section (any call made during the
build).

- [ ] **Step 1:** Write them. **Step 2:** `npm run lint`. **Step 3:** Commit `docs: spec 6b`.

## After the tasks

Final whole-branch review and its one fix wave; `npm run check`, `npm run test`, `npm run build`,
`npm run check:build`, `npm run check:budget` (report the number; 250 KB soft); merge
`origin/step-5`; push; open the PR into `step-5` (no AI attribution); tell the coordinator so it
holds TODO pushes; raise "Comparing two datasets" with the user; ask the user before merging.
