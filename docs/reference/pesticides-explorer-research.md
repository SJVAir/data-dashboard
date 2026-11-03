# Pesticides Explorer research (input for the later pesticide spec)

Date: 2026-11-03 (step 3 second batch session). Research only, no decisions beyond:
**pesticide widgets get their own sjvair.com spec after step 3's spec 1**
(`sjvair.com/docs/superpowers/specs/2026-11-03-metadata-scales-design.md`), agreed with the
user. Tracked in `DEFERRED.md` → "Widgets". Sources: a code read of sjvair.com's
`camp/apps/pesticides/`, `camp/templates/pesticides/`, and `camp/api/v2/pesticides/`, and a
look at the local Fresno County page (`/tools/pesticides/region/r6phe/fresno/`, behind the
`beta_tools` flag). Paths are in sjvair.com; file:line refs are as of `develop` at
5561cfa1.

## What the explorer shows

- **Home**: entry cards (products, chemicals, commodities, records, notices, schools near
  use), stat row (lbs with change vs prior year, lbs per acre, flagged share, largest
  county share, lbs per application), county table and choropleth with a "rank by" picker,
  valley trend, top-N boards with sparklines, biggest movers.
- **Place page** (region or near-me point + 1/3/5 mi radius), tabs from `AREA_TABS`
  (`views.py:2379`):
  - Overview: lbs, lbs/sq mi (whole area and where used), applications, sections with use,
    chemicals used (N flagged); section map shaded by pounds; "How it was applied" (Ground,
    Field fumigation, Air, Other, Not reported: pounds, share, applications, with a
    footnote); lbs by year vs "Average valley county" (valley total ÷ 8); method share by
    year; month × year heat grid ("Spraying peaks in June here"); upcoming notices count;
    top 5 products, chemicals, commodities; biggest risers and fallers; "In and around"
    lists (communities, school districts, ZIPs).
  - Records, Notices, Schools (per-site lbs in a 3×3 block of sections, district
    demographics).
- **Lists and details** for chemicals, products, commodities; a records browser; section
  detail; notices (active vs archive); a long About page.
- **One site-wide filter** (`?narrow=`): All use, Flagged chemicals, Restricted materials,
  Fumigants (and "Applied by air"), plus a year picker.

## Measures and grain

- `lbs_chemical` (active ingredient: chemicals, commodities, places); `lbs_product` /
  `lbs_product_once` (products only, never added to AI lbs); `acres_treated` /
  `acres_once` ("acre-treatments"); `applications` (one per ingredient row) vs `records`
  (once per use report) (`models.py:612-624`, `stats.py:492-514`).
- Finest grain year × month (month 0 = undated) in `PesticideUseRollup`; scope is one year
  or all years. Notices are timestamps grouped by local day (next 7 days, 4-day grace).
- Comparisons: vs prior year (`trend_deltas`, "Unchanged" under 0.5%), vs first year, vs
  average valley county, county rankings by quantile, top-N (`RELATED_LIMIT=5`), movers
  (percent shown only when the base is at least 100 lbs).
- Local data: PUR 2018–2023; notices fetched daily.

## Categorical dimensions (all candidates for `pesticides/meta/`)

| Dimension          | Values                                                                                                                                                                            | Where defined today                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chemical category  | biopesticide, california_restricted, carcinogen, cholinesterase_inhibitor, developmental_toxin, fumigant, groundwater_contaminant, oil, reproductive_toxin, toxic_air_contaminant | `models.py:91-101`; four never assigned, hidden in `forms.py:33-36`                                                                                                |
| Prop 65 (derived)  | carcinogen, reproductive, developmental                                                                                                                                           | `models.py:109`; badge `includes/classification-badges.html`                                                                                                       |
| CARB TAC           | toxic_air_contaminant                                                                                                                                                             | badge template                                                                                                                                                     |
| IARC group         | 1, 2A, 2B, 3; concern set {1, 2A, 2B}                                                                                                                                             | `models.py:103-110`; badge styles in templates                                                                                                                     |
| Restricted         | chemical category; product CDPR flag with ingredient fallback                                                                                                                     | `models.py:262-287`, `includes/product-badges.html`                                                                                                                |
| Fumigant           | classified rule (≥100 lbs and ≥90% flagged or method F) vs CDPR raw                                                                                                               | `fumigants.py:14-15`                                                                                                                                               |
| "Flagged"          | Prop 65 ∪ TAC ∪ IARC 1/2A/2B ∪ restricted                                                                                                                                         | defined twice: `models.py:199-212` and `stats.py:1195`                                                                                                             |
| Narrowing          | concern, restricted, fumigant, aerial                                                                                                                                             | `stats.py:58-84`, titles `stats.py:251`                                                                                                                            |
| Application method | G, A, F, O, ''                                                                                                                                                                    | labels `stats.py:376-377` (model labels differ, `models.py:412-416`); colors duplicated in `templatetags/pesticides_explorer.py:371` and `pesticides.sass:506-517` |
| Notice method      | SprayDays free text                                                                                                                                                               | discovered from DB; `stats.py:380` maps Aircraft → Air                                                                                                             |
| Fumigation method  | FumigationMethod rows                                                                                                                                                             | `models.py:356`                                                                                                                                                    |
| Commodity          | CDPR site code + name                                                                                                                                                             | no crop groupings exist                                                                                                                                            |
| Unit treated       | A, S, C, K, P, T, U                                                                                                                                                               | `models.py:395`                                                                                                                                                    |
| Location type      | public/private school, child care                                                                                                                                                 | `regions/models.py:299-304`; marker colors in `section-map.js`                                                                                                     |

Explanatory text: `datafiles/pesticide-health-notes.yaml` via `notes.py` (title, summary,
detail, source_url per key: prop65, iarc_*, carb_tac, fumigant, restricted, noi_meaning,
pur_lag, …). None of it is in the API; chemicals come back with raw category codes and no
labels.

## Hardcoded values a metadata endpoint should own

- Color ramps: `maps.py:37-50` (8-stop) and `assets/js/maps/core.js:33-65` (different 5-stop
  plus diverging), so server and JS maps shade differently. Class counts differ too (8 vs
  6).
- Method colors, badge color roles, notice and location colors.
- Constants: notice grace 4 days, upcoming window 7, movers minimum 100 lbs, top-N 5, county
  count 8, schools-near 1 mi, block 1.5 mi, fumigant rule, radius and buffer choices.
- Labels and units: metric units, county metric column copy, "Lbs of / via / on".
- Catalog mismatch: `meta/catalog.py:83-90` (`acres-treated` labeled in acres, no
  applications, `meta_url` empty).

## API today vs. view-only

- **Exposed**: chemicals/products/commodities (list, detail), `use/`, notices (list,
  active, archive GeoJSON with `is_of_concern`), `region/<id>/summary|use|notice/`,
  `sections/`, `townships/` (GeoJSON with `narrow`, `compare`, `month`, `buffer`),
  `locations/`, `search/`.
- **View-only**: landing stats, by-county rates, by-year and deltas, valley and
  average-county series, by-month, month × year grid, by-method (and by year), fumigation
  breakdown, top related, movers, place totals, upcoming-by-day, school block totals.
- **Region summary** (`endpoints.py:173-230`): reads raw `PesticideUse`, uncached, no month
  grain or narrowing; Fresno County 2023 about 1.8 MB in 2.5 s. **Probable bug**: sums
  `acres_treated` per ingredient row (the explorer uses `acres_once`). Not yet proven with
  data.

## Caching and load notes

`PesticideUseRollup` / `PesticideSectionTotal` / `PesticideUseTotal` pre-sum the data;
`stats.cached()` keys include `data_version` (bumped by each rollup rebuild); `warm.py`
re-renders key pages hourly; API caching via `CachedEndpointMixin`. Non-county places
resolve to intersecting MTRS sections (cached 24 h). Widget endpoints should reuse these
stats functions and cache keys.

## Widget ideas (for the dashboard, later)

1. Spray notices near a place: count plus a 7-day calendar.
2. Place use summary card: lbs, applications, acre-treatments, lbs/sq mi, change vs prior
   year, flagged share.
3. Trend and seasonality charts: by year vs average county, month × year grid, method share.
4. Section/township choropleth map widget (needs one unified ramp first).
5. Top chemicals/products/commodities table with badges, sparklines, and movers.

Each needs `pesticides/meta/` (labels, colors, badge definitions, the flagged rule, notes,
measure definitions, available years) and new aggregate endpoints rather than the raw
region summary.
