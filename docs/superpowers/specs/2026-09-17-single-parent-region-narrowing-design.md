# Single-Parent Region Narrowing for the Monitors Tab

## Overview

Replaces the multi-region selector's current narrowing model — where any
region type's persisted selection can narrow any other type's list, toggled
on/off per type via a "show all" escape hatch — with a simpler, fixed
hierarchy: the user picks **one** region type as the "parent," and every
other type's checkbox list is always narrowed to what's inside the current
parent selection. Multiple non-parent ("child") types can hold selections
simultaneously, and all of them — parent included — contribute to the map.

This replaces `docs/superpowers/specs/2026-09-17-multi-region-selector-design.md`'s
narrowing design (its "Narrowing UX" section and the `narrowingEnabled`/
`shouldNarrow`/`unionOfOtherTypeSelections` mechanism it specifies), which is
still on an open, unmerged PR (`data-dashboard#4`). Everything else that spec
covers (the 9 in-scope region types, the backend `within=`/bulk-summaries
endpoints, the SDK functions) is unchanged and still applies.

**Motivation:** the existing narrowing model produced two reported problems
in practice — a previously-selected region could silently disappear from
view (and stop affecting the map) when switching between types with
unrelated selections, and the "show all" escape hatch didn't reliably
restore the map even when it restored the checkbox list. Both traced back to
the N-to-N narrowing model itself being hard to reason about (any type can
narrow, or be narrowed by, any other type, independently toggle-able per
type). A single fixed parent removes that ambiguity: there is exactly one
thing that narrows, and it's always on.

## Data model (`MonitorsTabManager`, replaces the existing multi-region-selector fields)

Removed entirely: `selectedRegionType`, `regionSelections`, `narrowingEnabled`,
`activeRegions` (singular), and the `shouldNarrow`/`unionOfOtherTypeSelections`
helpers in `region-narrowing.ts` (that file's logic no longer applies — see
Testing below for what replaces its test coverage).

New fields:

- `parentType: RegionType` — which type drives narrowing. Defaults to
  `"county"`, matching today's default.
- `parentRegions: Array<RegionData> | null` — the full, unfiltered region
  list for `parentType`. Fetched once per `parentType` change, same shape as
  today's `activeRegions` fetch (no `within=`).
- `parentSelection: Set<string>` — selected parent region ids. Plain `Set`
  under `$state()`, always reassigned wholesale on toggle
  (`this.parentSelection = new Set(ids)`), never mutated in place with
  `.add()`/`.delete()` — matches the existing `activeRegions = regions`
  pattern already used for arrays elsewhere in the manager. `$state` field
  reassignment triggers reactivity regardless of the assigned value's
  internal type, so this field doesn't need `SvelteSet` (unlike
  `childSelectionsByType`'s outer `Map`, below, whose *values* get replaced
  via `.set()` on the map itself while the map instance stays the same —
  that call needs to be tracked, which plain `Map` won't do). Multi-select,
  same semantics as today's per-type selection. Defaults to "all" when
  `parentType` is `"county"` on first load, matching the existing "All
  Counties" default; starts empty for any other `parentType` a session
  switches to.
- `childTypes: Array<RegionType>` — derived as every in-scope region type
  except `parentType` (always 8 entries).
- `childRegionsByType: SvelteMap<RegionType, Array<RegionData>>` — one
  fetched, narrowed region list per child type, keyed by type. Re-fetched
  (all 8 in parallel) whenever `parentSelection` changes.
- `childSelectionsByType: SvelteMap<RegionType, Set<string>>` — one
  selection set per child type. Independent of each other — checking a City
  never affects the ZIP Code list or selection.

`childRegionsByType` and `childSelectionsByType` must both be `SvelteMap`
(from `svelte/reactivity`), not plain `Map`, for the same reason the
existing code already uses `SvelteMap` for `regionSelections`/
`narrowingEnabled`: both are updated via `.set()` on the same long-lived map
instance (one entry per child type) to drive derived/template reads, and a
plain `Map` under Svelte 5 `$state()` does not propagate `.set()` calls
reactively (confirmed the hard way — see the git history of
`monitors-tab.svelte.ts` for the bug this caused when `regionSelections` was
briefly a plain `Map`). The *values* inside `childSelectionsByType`
(individual `Set<string>`s) stay plain `Set`, following the same
wholesale-replace-not-mutate convention as `parentSelection` above — a
child's selection is always a freshly built `Set` handed to
`childSelectionsByType.set(type, next)`, never mutated through `.add()`/
`.delete()` on the same `Set` instance.

## UI layout

The existing region-type `Select.Root` dropdown is kept as-is, now
specifically the parent-type selector, with its checkbox list unchanged
(multi-select, same `RegionCheckboxList` component, same >10-item filter
behavior). Below it, one collapsible section per child type, grouped under
the same Administrative/Census/District category headings the dropdown
already uses:

```
Parent: [County ▾]
☑ Fresno County   ☐ Kern County   ☐ Madera County  ...

▸ Administrative
  ▾ City (1 selected)
    ☑ Clovis   ☐ Kerman   ☐ Sanger  ...
  ▸ ZIP Code

▾ Census
  ▸ Census Tract
  ▸ Census Designated Place

▸ District
  ▸ Congressional District
  ▸ State Assembly District
  ▸ State Senate District
  ▸ School District
```

A child section auto-expands when it has a non-empty selection; otherwise it
starts collapsed. Showing all 8 child lists fully expanded at once would be
overwhelming (Census Tract alone can be ~1,200 rows even narrowed). Each
section reuses `RegionCheckboxList` as-is — same component, same filter
threshold, one instance per child type.

If `parentType` itself belongs to, say, the Administrative category, its
own type does not appear a second time under the Administrative child
group (the category heading still lists the other types in that category).

## Fetching / data flow

- Changing `parentType` (the dropdown): fetch the new type's full,
  unfiltered `parentRegions` list. If this type has never been visited this
  session, `parentSelection` starts empty (except `"county"`, which seeds
  "all" on first-ever load exactly as today). Then fetch all 8
  `childRegionsByType` entries in parallel, each narrowed by the (possibly
  now-different) `parentSelection`.
- Changing `parentSelection` (checking/unchecking a parent region): re-fetch
  all 8 `childRegionsByType` entries in parallel with the updated `within=`
  union. Apply the pruning rule below before refreshing the map.
- Changing a child type's own selection: no re-fetch of any region list
  (nothing narrows a child's own list except the parent) — only the map/
  calendar/fill summary data refreshes, same as today's per-toggle refresh.
- Fetch-supersession tokens (already used for `refreshActiveRegions`/
  `refreshMapAverages`/`refreshCalendar`/`refreshRegionFill`) apply the same
  way, one per concurrently-fetchable thing — each of the 8 child-region
  fetches needs its own token so a rapid double-toggle of the parent
  selection can't let a stale child-list response clobber a newer one.

## Selection pruning

When `parentSelection` shrinks (a parent region gets unchecked) and a
child's current selection includes an id that falls outside the newly
narrowed scope for that child type, that id is removed from the child's
selection automatically. This is a deliberate, expected consequence of the
single fixed parent — the parent is the one thing the user explicitly
controls, so narrowing it is a deliberate action, not an incidental side
effect of switching between two independently-selected types (which is what
made the old model's silent disappearance confusing).

Pruning happens as part of the same re-fetch step that follows a parent
selection change (compare each child type's new narrowed id set against its
current selection, drop anything not in the new set), before the map/
calendar/fill refresh runs — so the map never briefly shows a
now-out-of-scope region.

## What drives the map

Fill polygons, calendar blocks, and monitor markers reflect the union of
every currently-selected region across the parent and all 8 child types
simultaneously — not just one "active" type's selection, as today. A
region contributes exactly once even if (hypothetically) the same id
appeared in two places, though in practice region ids are unique per type
and never collide across types (single `Region` table, `sqid` per row), so
this is not actually reachable.

## URL state

One query param per type with a non-empty selection, keyed by type name,
plus `parentType`:

```
?parentType=county&parent=r6phe&city=vx9ka&tract=abc123,def456
```

Only types with an actual selection appear — the common case (just a parent
selection, e.g. "All Counties") stays as clean as today's
`?regionType=county&regions=...` URLs. `parentType` always appears (defaults
to `county` when absent, matching today's default-seeding behavior). Absent
child-type params decode to an empty selection for that type.

This replaces the existing `encodeRegionType`/`decodeRegionType`/
`encodeRegionSelection`/`decodeRegionSelection` codecs' *usage* in
`MonitorsTab.svelte` (the codecs themselves — encode/decode a single type
name, encode/decode a comma-separated id set — are still exactly the right
shape, just called once for the parent and once per child type with a
selection, rather than once for a single "active" type).

## Error handling & edge cases

- **Parent selection empty:** every child type's fetch still runs, but with
  `within=` omitted (unfiltered) — mirrors today's "no narrowing" case
  exactly, since an empty parent selection means there's no scope to narrow
  by. Every child list shows in full.
- **A child's narrowed list comes back empty:** no special-case UI needed —
  it's just an empty checkbox list under that child's (auto-collapsed,
  since nothing is selected there) section. No equivalent of the old "show
  all" escape hatch is needed since there's nothing to escape: the child
  list is always exactly "what's narrowed by the current parent selection,"
  full stop.
- **Backend 400 from bulk endpoints:** unchanged — still surfaced via the
  existing `lastError` state field and inline message near the map.
- **Switching parent type mid-fetch:** unchanged pattern — fetch-token
  supersession, extended to cover 8 concurrent child fetches instead of 1.

## Testing

- `region-narrowing.ts`'s existing pure-logic tests
  (`unionOfOtherTypeSelections`/`shouldNarrow`) are deleted along with the
  functions they test. New pure-logic coverage: a pruning helper (given a
  child type's previous selection and its newly-narrowed region list,
  return the selection with out-of-scope ids removed) gets the same kind of
  standalone unit test coverage `region-narrowing.ts` had.
- URL codec round-tripping: extend `url-state.test.ts` with cases for the
  new per-type child param scheme (multiple child types present, one
  present, none present, malformed values).
- Manager-level behavior (fetch orchestration, pruning-on-parent-change,
  map aggregation across parent+children) has no existing test precedent in
  this repo (same as the rest of `MonitorsTabManager`) — verified manually
  in the browser, consistent with how the rest of the manager is handled.

## Implementation sequencing

This is a rewrite of the narrowing portion of the already-built (but not yet
merged) multi-region-selector feature on `data-dashboard#4` — not new
scaffolding. It touches:

- `src/routes/monitors/monitors-tab.svelte.ts` — the data-model and
  fetching changes above (largest change).
- `src/routes/MonitorsTab.svelte` — the UI layout change (parent dropdown +
  8 collapsible child sections) and URL state wiring.
- `src/lib/monitors/region-narrowing.ts` — delete `shouldNarrow`/
  `unionOfOtherTypeSelections` and their tests; add the pruning helper and
  its tests.
- `src/lib/url-state.ts` — extend with per-type child param encode/decode
  usage (the underlying codecs are unchanged; only how `MonitorsTab.svelte`
  calls them changes).

No backend or SDK changes — this only touches how `data-dashboard` already-
existing endpoints/functions (`getRegionsList` with `within=`,
`getRegionSummariesBulk*`) get called and composed.
