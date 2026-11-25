# Data Portal: type options in a dropdown, Map options, one Pesticides section — design

Date: 2026-11-25. A small change from the user's requests on 2026-11-25. Branch `data-portal-options`.

## Why

The user, about the Data Portal: the type's own options under "Show as" take a full row and push
the preview down; "Schools", "Child care" and "Fill regions by" sit greyed out in What on every
type but the Map, though they are Map settings; and Pesticide use and Pesticide notices are split
into two sections. The goal is a calmer page with the main choices in view and no second scrollbar
right away.

## Decided with the user (2026-11-25)

1. **Where and What stay as they are** (not accordions): Where already shows its choice and reads
   better as it is; an accordion around What would hide the page's main choice behind a click.
2. **The type's own options open from a button beside "Show as"**, in a panel floating over the
   preview (like the dashboard picker's dropdown), instead of an always-open section that takes a
   row.
3. **The Map gets options too**: **Points of interest** (the location groups: Schools, Child care,
   and any group the server lists later) and **Fill regions by** move out of What into the Map's
   options panel.
4. **One "Pesticides" section in What** holds **Use** and **Notices**. Notices stays greyed out
   with its reason ("Only for Map") on the Chart and Data table; the whole section is greyed on
   types that show neither.

## Non-goals

- Accordions inside the options panel (flat headings only; the user asked about nesting, and the
  panel is short).
- Changing any saved document shape: the same layers, options and thresholds are written.
- Changing What's other sections (Air quality, Smoke and fire, Weather, forecasts).

## Approaches considered

- **Options: a floating panel (chosen)** vs. a closed accordion section under Show as. The panel
  keeps the preview in place (the user's ask); it covers part of the preview while open. The
  accordion would still push the preview down when opened.
- **Map settings: the Map's options panel (chosen)** vs. staying greyed in What. In What they
  added three greyed rows to every other type and read as data the type can't show.
- **Pesticides: one section with two parts (chosen)** vs. two sections (today), or Notices in Map
  options. Use and Notices share one filter set on the Map, so one section shows it once; Notices
  moving to Map options would split pesticide data across two places (the user's concern).

## Design

**Options button.** Beside the Show as switch (same row, wrapping on a phone): a button with the
type's options label (`optionsLabel`, e.g. "Chart options", "Alert levels", new "Map options") and
a chevron, `aria-haspopup="dialog"`, `aria-expanded`. It shows only when the type has something to
show right now (today's `showTypeOptions` rule, extended for the Map). It opens a bits-ui Popover
(`$lib/components/ui/popover`), non-modal, aligned to the button's end, floating over the preview,
with a max height of the space below and its own scroll when taller. Esc or a click outside closes
it and focus returns to the button. Its content is today's `NowControls` / `ThresholdLineControl`,
unchanged, or the Map's content below. Changes apply live, as now.

**Map options panel.** Plain headings (`h3`), no accordions:

- **Points of interest** (new message): one group of checkboxes per location group (the meta's
  label as its legend, its types as checkboxes, in the meta's order), and the "No longer offered"
  block for saved types the meta dropped, exactly as today's location sections.
- **Fill regions by**: today's radios (None and the fill types).

The Map shows the button when there is a location group, a gone type or a fill type to offer.
`hiddenLocationGroups` handling and every rule in `ARCHITECTURE.md` → "Schools and child care are
What on the Map" stay; only where the controls sit changes.

**What.** The location-group sections, the "No longer offered" block and Fill leave
`whatSections` (they are no longer greyed on other types; they're Map settings, not data the
type can't show). Pesticide use and Pesticide notices become one section, key `pesticides`, label
"Pesticides" (new message), listed where Pesticide use is today, shown when either dataset is
offered or saved:

- **Map:** a "Use" part (its switch, period and retry, as today) and a "Notices" part (its
  switch), each with a small heading (the catalog's dataset labels), then the one shared filter
  set when either is on (today it moves between the two sections).
- **Chart / Data table:** the "Use" part is today's `PesticideLayers`; the "Notices" part shows
  its switch greyed with "Only for Map" (`get_data_section_only_for`).
- **Other types:** the whole section greyed with its reason, as today.
- Closed, the section's detail line names what's chosen in both parts.

**Show as → another type.** The note naming the ticked location groups that a non-Map type leaves
out ("Schools: shown only on a map, so left out.") stays.

**Phones.** The button sits on Show as's row (wrapping under it when narrow); the panel takes the
screen's width less the margins.

## Docs

`ARCHITECTURE.md`: the Data Portal layout ("Layout (option A)": What no longer lists the Map's
settings; the type's options open from a button beside Show as; the Map's options), "Schools and
child care are What on the Map" (now in Map options), and the pesticide sections (one section).
`DEFERRED.md`: nothing deferred so far.

## Left to the builder

Component split (e.g. a `TypeOptionsButton.svelte` wrapping the popover, a `MapOptions.svelte`),
test layout, the exact detail-line wording for Pesticides (through messages, no concatenation).
