# Multi-Region Selector for the Monitors Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Monitors tab's single-county dropdown with a region-type
selector + multi-select checkbox list covering 7 region types (county, city,
zipcode, tract, cdp, congressional_district, state_assembly, state_senate,
school_district), generalizing the county-fill polygons, per-region calendar,
and monitor-marker visibility that today only understand "county."

**Architecture:** Three repos in a runtime dependency chain
(`sjvair.com` → `sdk-js` → `data-dashboard`) but a pinned interface contract
(this plan's Backend/SDK sections specify exact URLs/params/response shapes),
so all four tracks — Backend, SDK, Frontend UI atoms, Frontend integration —
can start in parallel. Frontend integration is the one task set that
genuinely needs the SDK track's real exports and should be sequenced last
within `data-dashboard`, or built against a hand-written stub matching the
SDK track's signatures and swapped once available.

**Tech Stack:** Django + `resticus` + `django-filter` (sjvair.com), Deno/TS +
zod (sdk-js), Svelte 5 runes + `sv-router` + bits-ui + `@turf/*` (data-dashboard).

**Spec:** `docs/superpowers/specs/2026-09-17-multi-region-selector-design.md`
(this plan argues from that spec; read both — the spec has the full rationale
and edge-case list, this plan has exact files/code/tests).

## Global Constraints

- **Never commit directly to `main` in any of the three repos** — every track
  works on its own feature branch (branch names given per track below).
- **Never run `npm publish`, create a GitHub release, or trigger a
  publish/CI-release workflow without the user's explicit permission for that
  specific release** — every single time, even as the "obvious next step."
  This applies to `sdk-js`'s version bump landing on npm/JSR, not just to
  `data-dashboard`.
- **Scope is exactly the 7 region types** in categories `administrative`
  (county, city, zipcode), `census` (tract, cdp), `district`
  (congressional_district, state_assembly, state_senate, school_district).
  Do not touch `land_use`, `mtrs`, `place`, `protected`, `custom` — out of
  scope per the spec.
- **Tabs**, not spaces, double quotes, no trailing commas, 100-char width in
  `data-dashboard` (Prettier/ESLint enforced — run `npm run format` before
  committing there). Svelte 5 runes only, no legacy `$:`.
- **`camp/api/v2/regions/urls.py` ordering matters**: any new path segment
  that could collide with the catch-all `<region_id>/` (e.g. a literal path
  segment like an `entry_type` value) must be registered *above* it in
  `urlpatterns`, exactly like `meta/`, `places/search/`, `places/lookup/`
  already are.
- **`monitor-map` needs no code changes** for this feature (per spec) — the
  county-fill polygons, calendar, and region-selection state have always
  lived in `data-dashboard`, not in `monitor-map`. If any task ends up
  touching `monitor-map` integration code anyway, remember every integration
  class (`MonitorsMapIntegration`, etc.) is *also* exported as a
  module-level singleton that self-applies onto the shared map on import —
  see `MonitorsTab.svelte:30-42`'s existing override pattern
  (`mapIntegration.clustered = false`, `.tooltipManager.enabled = false`,
  plus the same two lines on the singleton) for what any new singleton would
  also need.
- **Local cross-repo testing**: to test unpublished `sdk-js`/`monitor-map`
  changes against `data-dashboard` before the SDK track is actually
  published/bumped, add a temporary `resolve.alias` entry to
  `data-dashboard/vite.config.ts` (`@sjvair/sdk` → `../sdk-js/mod.ts` since
  `sdk-js` is raw TS; `@sjvair/monitor-map` → `../monitor-map/dist/lib/index.js`,
  which needs `npm run build:lib` in `monitor-map` after every change since
  it's a built package). Mark it clearly `// TEMPORARY — do not commit` and
  revert it once `sdk-js` is actually published and `package.json` bumped.
  **Do not leave this committed.**

---

## Backend Track (`sjvair.com`)

Branch: `feature/multi-region-selector-backend`, based on current `main`
(after landing B1 per Task 1 below).

### Task 1: Land B1 — merge `feature/regions-meta-endpoint`

This branch already exists locally (commit `8d4a76fc`) with `RegionMetaEndpoint`,
its route, and `Region.TYPE_CATEGORIES` fully built and tested (a
`RegionMetaTests` class already covers it). No new code — just get it onto
`main` cleanly and use it as the base for the rest of this track.

**Files:** none changed — this is a rebase + PR, not new code.

- [ ] **Step 1: Check out the branch and rebase onto current `main`**

```bash
cd ~/workspace/sjvair/sjvair.com
git fetch origin
git checkout feature/regions-meta-endpoint
git rebase origin/main
```

Resolve any conflicts (unlikely — this branch only touches `camp/api/v2/regions/`
and `camp/apps/regions/models.py`, which no other in-flight branch touches).

- [ ] **Step 2: Run the existing test suite for this app**

```bash
python manage.py test camp.api.v2.regions
```

Expected: all pass, including `RegionMetaTests`.

- [ ] **Step 3: Push and open a PR against `main`**

```bash
git push -u origin feature/regions-meta-endpoint
gh pr create --title "Add GET /api/2.0/regions/meta/ endpoint" --body "Adds RegionMetaEndpoint reporting every Region.Type with its label and category, driving the multi-region-selector type dropdown. No behavior change to existing endpoints."
```

Do not merge without the user's go-ahead — flag it as ready and wait.

---

### Task 2: `within=` narrowing filter on `GET /api/2.0/regions/`

**Files:**
- Modify: `camp/api/v2/regions/filters.py`
- Modify: `camp/api/v2/regions/endpoints.py` (`RegionList.get_queryset`)
- Test: `camp/api/v2/regions/tests.py`

**Interfaces:**
- Produces: `GET /api/2.0/regions/?type=tract&within=<sqid1>&within=<sqid2>`
  — repeatable `within` param, ANDed with existing `type`/`name`/`slug`
  filters, narrows to regions whose geometry intersects the union of the
  named parent regions' geometries. Unknown `within` ids are silently
  ignored (they contribute nothing to the union, per `combined_geometry()`
  on an empty/no-match queryset returning `None`).

Branch off `feature/regions-meta-endpoint` (post-rebase) for this task, or a
fresh branch off `main` if Task 1's PR hasn't landed yet — the spec's tracks
are independent, this doesn't need B1 merged first.

- [ ] **Step 1: Write the failing tests**

Add to `camp/api/v2/regions/tests.py` (mirror the existing `make_place`/`make_city`
+ inline-WKT fixture pattern already in that file):

```python
class RegionWithinFilterTests(TestCase):
    def setUp(self):
        self.parent_a = make_county('Fresno County', FRESNO_WKT)
        self.parent_b = make_county('Kern County', KERN_WKT)
        self.inside_a = make_tract('Tract inside Fresno', FRESNO_TRACT_WKT)
        self.inside_b = make_tract('Tract inside Kern', KERN_TRACT_WKT)
        self.outside = make_tract('Tract elsewhere', ELSEWHERE_WKT)

    def test_within_single_parent_narrows_to_intersecting_regions(self):
        request = RequestFactory().get('/', {'type': 'tract', 'within': self.parent_a.sqid})
        response = region_list(request)
        data = get_response_data(response)
        ids = {r['id'] for r in data['data']}
        self.assertEqual(ids, {self.inside_a.sqid})

    def test_within_multiple_parents_unions_geometries(self):
        request = RequestFactory().get('/', [
            ('type', 'tract'), ('within', self.parent_a.sqid), ('within', self.parent_b.sqid),
        ])
        response = region_list(request)
        data = get_response_data(response)
        ids = {r['id'] for r in data['data']}
        self.assertEqual(ids, {self.inside_a.sqid, self.inside_b.sqid})

    def test_within_unknown_id_is_ignored_not_error(self):
        request = RequestFactory().get('/', {'type': 'tract', 'within': 'not-a-real-sqid'})
        response = region_list(request)
        self.assertEqual(response.status_code, 200)

    def test_no_within_param_returns_unnarrowed_list(self):
        request = RequestFactory().get('/', {'type': 'tract'})
        response = region_list(request)
        data = get_response_data(response)
        ids = {r['id'] for r in data['data']}
        self.assertEqual(ids, {self.inside_a.sqid, self.inside_b.sqid, self.outside.sqid})
```

Add whatever `make_county`/`make_tract` helper factories and WKT constants
this needs, following the existing `make_place`/`make_city` + `FRESNO_PLACE_WKT`
pattern already in the file (each region needs a real, non-overlapping
`Boundary.geometry` so intersection is distinguishable — reuse this file's
existing WKT literals where their bboxes already don't overlap, rather than
inventing new geometry from scratch).

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test camp.api.v2.regions.tests.RegionWithinFilterTests
```

Expected: FAIL — `within` isn't recognized yet (django-filter drops unknown
query params silently by default, so this will fail on the *assertion*, not
an error — `test_within_single_parent_narrows_to_intersecting_regions` gets
back all 3 tracts, not just `inside_a`).

- [ ] **Step 3: Add the no-op `within` declaration to `RegionFilter`**

```python
# camp/api/v2/regions/filters.py
import django_filters
from resticus.filters import FilterSet
from camp.apps.regions.models import Region

class RegionFilter(FilterSet):
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    slug = django_filters.CharFilter(field_name='slug', lookup_expr='exact')
    type = django_filters.CharFilter(field_name='type', lookup_expr='exact')
    # Declared only so this shows up in the generated OpenAPI schema; the
    # actual filtering happens in RegionList.get_queryset() since it needs
    # to union multiple `within` values' geometries before filtering,
    # which a single-field django_filters method can't express cleanly.
    within = django_filters.CharFilter(method='noop', help_text='Parent region id; repeatable.')

    def noop(self, queryset, name, value):
        return queryset

    class Meta:
        model = Region
        fields = {}
```

- [ ] **Step 4: Apply it imperatively in `RegionList.get_queryset`**

```python
# camp/api/v2/regions/endpoints.py
class RegionList(RegionMixin, generics.ListEndpoint):
    filter_class = RegionFilter
    paginate = False

    def get_queryset(self):
        qs = super().get_queryset()
        within_ids = self.request.GET.getlist('within')
        if within_ids:
            geometry = Region.objects.filter(sqid__in=within_ids).combined_geometry()
            if geometry:
                qs = qs.intersects(geometry)
        return qs
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
python manage.py test camp.api.v2.regions.tests.RegionWithinFilterTests
python manage.py test camp.api.v2.regions  # full-file regression
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add camp/api/v2/regions/filters.py camp/api/v2/regions/endpoints.py camp/api/v2/regions/tests.py
git commit -m "Add within= narrowing filter to GET /regions/"
```

---

### Task 3: Extract `BulkSummaryDateRangeForm` base

Small refactor that Task 4 depends on. `BulkMonitorSummaryForm`'s date-range
validation/span-capping is currently only used by the monitor endpoint; this
task pulls it into a base class so `BulkRegionSummaryForm` (Task 4) doesn't
duplicate it.

**Files:**
- Modify: `camp/api/v2/summaries/forms.py`
- Test: `camp/api/v2/summaries/tests.py` (existing `BulkMonitorSummaryForm`
  tests must still pass unmodified — this is a pure refactor)

**Interfaces:**
- Produces: `BulkSummaryDateRangeForm(forms.Form)` — abstract base with
  `MAX_RANGE`, `start`/`end` fields, `__init__(self, *args, resolution=None, **kwargs)`,
  `clean()` producing `cleaned_data['end_exclusive']` and enforcing per-resolution
  span caps. `BulkMonitorSummaryForm` becomes `BulkSummaryDateRangeForm` + `bbox`.

- [ ] **Step 1: Run the existing form tests to confirm current green baseline**

```bash
python manage.py test camp.api.v2.summaries.tests -k Form
```

Expected: PASS (establishes the regression baseline before refactoring).

- [ ] **Step 2: Extract the base class**

```python
# camp/api/v2/summaries/forms.py
from datetime import timedelta

from django import forms

from camp.api.v2.forms import BboxField
from camp.apps.summaries.models import BaseSummary


class BulkSummaryDateRangeForm(forms.Form):
    """`start`/`end` are inclusive dates. The span is capped per resolution so a
    single request can't page through an unbounded number of rows (hourly and
    daily are the only resolutions dense enough to need it)."""

    MAX_RANGE = {
        BaseSummary.Resolution.HOURLY: timedelta(days=31),
        BaseSummary.Resolution.DAILY: timedelta(days=366),
    }

    start = forms.DateField(required=True)
    end = forms.DateField(required=True)

    def __init__(self, *args, resolution=None, **kwargs):
        self.resolution = resolution
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned_data = super().clean()
        start = cleaned_data.get('start')
        end = cleaned_data.get('end')

        if not start or not end:
            return cleaned_data  # Field-specific errors will already be raised

        if start > end:
            raise forms.ValidationError('start must be on or before end.')

        try:
            cleaned_data['end_exclusive'] = end + timedelta(days=1)
        except OverflowError:
            raise forms.ValidationError('end is out of range.')

        max_range = self.MAX_RANGE.get(self.resolution)
        if max_range is not None and end - start > max_range:
            raise forms.ValidationError(
                f'Maximum date range for {self.resolution} resolution is {max_range.days} days.'
            )

        return cleaned_data


class BulkMonitorSummaryForm(BulkSummaryDateRangeForm):
    bbox = BboxField()
```

- [ ] **Step 3: Run the same tests again, verify still green**

```bash
python manage.py test camp.api.v2.summaries.tests -k Form
python manage.py test camp.api.v2.summaries  # full regression
```

Expected: all PASS, identical to Step 1's baseline (pure refactor, no
behavior change).

- [ ] **Step 4: Commit**

```bash
git add camp/api/v2/summaries/forms.py
git commit -m "Extract BulkSummaryDateRangeForm base from BulkMonitorSummaryForm"
```

---

### Task 4: `BulkRegionSummaryList` endpoint (B3)

**Files:**
- Modify: `camp/api/v2/summaries/forms.py` (add `BulkRegionSummaryForm`)
- Modify: `camp/api/v2/summaries/filters.py` (add `BulkRegionSummaryFilter`)
- Modify: `camp/api/v2/summaries/serializers.py` (add `BulkRegionSummaryGroupSerializer`)
- Modify: `camp/api/v2/summaries/endpoints.py` (add `BulkRegionSummaryList`)
- Create: `camp/api/v2/summaries/region_bulk_urls.py`
- Modify: `camp/api/v2/regions/urls.py` (mount the new path before `<region_id>/`)
- Test: `camp/api/v2/summaries/tests.py`

**Interfaces:**
- Consumes: `BulkSummaryDateRangeForm` (Task 3), `SummaryMixin` (existing,
  `camp/api/v2/summaries/endpoints.py:28-82`), `RegionSerializer` (existing,
  `camp/api/v2/regions/serializers.py`).
- Produces:
  `GET /api/2.0/regions/<entry_type>/summaries/<resolution>/?start=&end=&region=id1&region=id2`
  — `resolution` ∈ `{hourly,daily,monthly,quarterly,seasonal,yearly}`.
  Requires `start`, `end`, and at least one `region`; 400 with
  `{'errors': {...}}` if any are missing/invalid, same shape as
  `BulkMonitorSummaryList`. Paginates by summary row (`page_size = 168`),
  same cross-page merge contract (matching `region_id` on the last row of
  one page and the first row of the next ⇒ concatenate `summaries`).

- [ ] **Step 1: Write the failing tests**

Add to `camp/api/v2/summaries/tests.py`, mirroring this file's existing
`make_region_summary()` helper and `BulkMonitorSummaryList` test patterns
(module-level bound view, `mock.patch.object(..., 'page_size', 1)` for the
split test):

```python
bulk_region_summary_list = BulkRegionSummaryList.as_view()

class BulkRegionSummaryListTests(TestCase):
    fixtures = ['regions.yaml']

    def setUp(self):
        self.fresno = Region.objects.get(name='Fresno County')
        self.kern = Region.objects.get(name='Kern County')
        make_region_summary(region=self.fresno, resolution='day', entry_type='pm25',
                             timestamp='2026-01-01', **STATS)
        make_region_summary(region=self.kern, resolution='day', entry_type='pm25',
                             timestamp='2026-01-01', **STATS)

    def test_requires_region_param(self):
        request = RequestFactory().get('/', {'start': '2026-01-01', 'end': '2026-01-31'})
        response = bulk_region_summary_list(request, entry_type='pm25', resolution='day')
        self.assertEqual(response.status_code, 400)

    def test_requires_start_and_end(self):
        request = RequestFactory().get('/', {'region': self.fresno.sqid})
        response = bulk_region_summary_list(request, entry_type='pm25', resolution='day')
        self.assertEqual(response.status_code, 400)

    def test_span_too_large_for_daily_resolution(self):
        request = RequestFactory().get('/', {
            'region': self.fresno.sqid, 'start': '2020-01-01', 'end': '2026-01-01',
        })
        response = bulk_region_summary_list(request, entry_type='pm25', resolution='day')
        self.assertEqual(response.status_code, 400)

    def test_multi_region_fetch_returns_both_regions(self):
        request = RequestFactory().get('/', [
            ('region', self.fresno.sqid), ('region', self.kern.sqid),
            ('start', '2026-01-01'), ('end', '2026-01-31'),
        ])
        response = bulk_region_summary_list(request, entry_type='pm25', resolution='day')
        data = get_response_data(response)
        ids = {r['id'] for r in data['data']}
        self.assertEqual(ids, {self.fresno.sqid, self.kern.sqid})

    def test_pagination_merge_boundary_is_detectable(self):
        with mock.patch.object(BulkRegionSummaryList, 'page_size', 1):
            request = RequestFactory().get('/', [
                ('region', self.fresno.sqid), ('region', self.kern.sqid),
                ('start', '2026-01-01'), ('end', '2026-01-31'), ('page', '1'),
            ])
            response = bulk_region_summary_list(request, entry_type='pm25', resolution='day')
            page1 = get_response_data(response)
            request2 = RequestFactory().get('/', [
                ('region', self.fresno.sqid), ('region', self.kern.sqid),
                ('start', '2026-01-01'), ('end', '2026-01-31'), ('page', '2'),
            ])
            response2 = bulk_region_summary_list(request2, entry_type='pm25', resolution='day')
            page2 = get_response_data(response2)
            # Same region id at the boundary ⇒ client concatenates, not duplicates
            self.assertTrue(page1['data'] and page2['data'])
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
python manage.py test camp.api.v2.summaries.tests.BulkRegionSummaryListTests
```

Expected: FAIL — `BulkRegionSummaryList` doesn't exist yet (`ImportError`/`NameError`).

- [ ] **Step 3: Add `BulkRegionSummaryForm`**

```python
# camp/api/v2/summaries/forms.py — append
class BulkRegionSummaryForm(BulkSummaryDateRangeForm):
    pass
```

- [ ] **Step 4: Add `BulkRegionSummaryFilter`**

```python
# camp/api/v2/summaries/filters.py — append
class BulkRegionSummaryFilter(FilterSet):
    start = django_filters.DateFilter(method='noop', help_text='Inclusive start date (required).')
    end = django_filters.DateFilter(method='noop', help_text='Inclusive end date (required).')
    region = django_filters.CharFilter(method='noop', help_text='Region id; repeatable, at least one required.')

    def noop(self, queryset, name, value):
        return queryset

    class Meta:
        model = RegionSummary
        fields = []
```

(Add `from camp.apps.summaries.models import RegionSummary` to this file's imports.)

- [ ] **Step 5: Add `BulkRegionSummaryGroupSerializer`**

```python
# camp/api/v2/summaries/serializers.py — append, after RegionSummarySerializer
from camp.api.v2.regions.serializers import RegionSerializer

class BulkRegionSummaryGroupSerializer(RegionSerializer):
    """A region (same shape as RegionSerializer) with a nested `summaries`
    list - the summary rows for that region within the requested page.
    Mirrors BulkMonitorSummaryGroupSerializer's monitor/summaries relationship."""
    include = [
        ('summaries', lambda region: RegionSummarySerializer(region.summary_rows).serialize()),
    ]
```

- [ ] **Step 6: Add `BulkRegionSummaryList` endpoint**

```python
# camp/api/v2/summaries/endpoints.py — append, after RegionSummaryList
from resticus.http import Http400  # already imported above; ensure present

from .filters import BulkRegionSummaryFilter
from .forms import BulkRegionSummaryForm
from .serializers import BulkRegionSummaryGroupSerializer


class BulkRegionSummaryList(SummaryMixin, generics.ListEndpoint):
    """Summary statistics for one or more regions matching an inclusive `start`/`end`
    date range. Each result is a region (same shape as RegionList) with its matching
    rows nested under `summaries`. `start`, `end`, and at least one `region` are
    required; invalid/missing parameters return a 400 with form errors.

    Pagination is by summary row, not by region, same cross-page merge contract
    as BulkMonitorSummaryList: if the last region `id` on a page matches the first
    region `id` on the next page, concatenate their `summaries` arrays.
    """

    model = RegionSummary
    serializer_class = BulkRegionSummaryGroupSerializer
    form_class = BulkRegionSummaryForm
    filter_class = BulkRegionSummaryFilter

    @cached_property
    def form(self):
        return self.get_form(self.request.GET, resolution=self.resolution)

    def get(self, request, *args, **kwargs):
        if not self.form.is_valid():
            return Http400({'errors': self.form.errors.get_json_data()})
        if not self.request.GET.getlist('region'):
            return Http400({'errors': {'region': [{'message': 'At least one region is required.', 'code': 'required'}]}})
        return super().get(request, *args, **kwargs)

    def get_date_filter(self):
        tz = settings.DEFAULT_TIMEZONE
        start = make_aware(datetime.combine(self.form.cleaned_data['start'], datetime.min.time()), tz)
        end = make_aware(datetime.combine(self.form.cleaned_data['end_exclusive'], datetime.min.time()), tz)
        return {'timestamp__gte': start, 'timestamp__lt': end}

    def get_queryset(self):
        region_ids = self.request.GET.getlist('region')
        regions = Region.objects.filter(sqid__in=region_ids)
        return (super()
            .get_queryset()
            .filter(region__in=regions)
            .order_by('region_id', 'timestamp')
        )

    def serialize(self, source, fields=None, include=None, exclude=None, fixup=None):
        grouped = {}
        for row in source:
            grouped.setdefault(row.region_id, []).append(row)

        regions_by_id = Region.objects.select_related('boundary').in_bulk(list(grouped))
        regions = []
        for region_id, rows in grouped.items():
            region = regions_by_id.get(region_id)
            if region is None:
                continue
            region.summary_rows = rows
            regions.append(region)

        return super().serialize(regions, fields, include, exclude, fixup)
```

- [ ] **Step 7: Create `region_bulk_urls.py`**

```python
# camp/api/v2/summaries/region_bulk_urls.py
from django.urls import path

from .endpoints import BulkRegionSummaryList

view = BulkRegionSummaryList.as_view()

urlpatterns = [
    path('hourly/', view, {'resolution': 'hour'}, name='region-summary-bulk-hourly'),
    path('daily/', view, {'resolution': 'day'}, name='region-summary-bulk-daily'),
    path('monthly/', view, {'resolution': 'month'}, name='region-summary-bulk-monthly'),
    path('quarterly/', view, {'resolution': 'quarter'}, name='region-summary-bulk-quarterly'),
    path('seasonal/', view, {'resolution': 'season'}, name='region-summary-bulk-seasonal'),
    path('yearly/', view, {'resolution': 'year'}, name='region-summary-bulk-yearly'),
]
```

- [ ] **Step 8: Mount it in `camp/api/v2/regions/urls.py`, above `<region_id>/`**

```python
# camp/api/v2/regions/urls.py
urlpatterns = [
    path('', endpoints.RegionList.as_view(), name='region-list'),
    path('meta/', endpoints.RegionMetaEndpoint.as_view(), name='region-meta'),
    path('places/search/', endpoints.PlaceSearch.as_view(), name='place-search'),
    path('places/lookup/', endpoints.PlaceLookup.as_view(), name='place-lookup'),
    path('<entry_type>/summaries/', include('camp.api.v2.summaries.region_bulk_urls')),
    path('<region_id>/', endpoints.RegionDetail.as_view(), name='region-detail'),
    path('<region_id>/summaries/', include('camp.api.v2.summaries.region_urls')),
]
```

`<entry_type>/summaries/` must precede `<region_id>/` — same ordering
`monitors/urls.py` relies on for its own bulk-summaries mount, since
`entry_type` values (`pm25`, `o3`, ...) never collide with region sqids but
Django resolves top-to-bottom regardless.

- [ ] **Step 9: Run tests, verify they pass**

```bash
python manage.py test camp.api.v2.summaries.tests.BulkRegionSummaryListTests
python manage.py test camp.api.v2.summaries camp.api.v2.regions  # full regression
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add camp/api/v2/summaries/forms.py camp/api/v2/summaries/filters.py \
        camp/api/v2/summaries/serializers.py camp/api/v2/summaries/endpoints.py \
        camp/api/v2/summaries/region_bulk_urls.py camp/api/v2/regions/urls.py \
        camp/api/v2/summaries/tests.py
git commit -m "Add BulkRegionSummaryList endpoint"
```

- [ ] **Step 11: Push branch and open a PR**

```bash
git push -u origin feature/multi-region-selector-backend
gh pr create --title "Add within= filter and bulk region-summaries endpoint" --body "Implements B2 (within= narrowing on GET /regions/) and B3 (GET /regions/<entry_type>/summaries/<resolution>/) from the multi-region-selector design spec."
```

---

## SDK Track (`sdk-js`)

Branch: `feature/multi-region-selector-sdk`, based on current `main`. Can be
built and unit-tested against this plan's pinned response shapes without
waiting for the backend PRs to actually merge; needs a final pass against
the real merged backend before any version bump/publish.

### Task 5: `RegionCategory` schema + `getRegionsMeta()`

**Files:**
- Create: `lib/regions/schemas/region_category.ts`
- Create: `lib/regions/get_regions_meta.ts`
- Modify: `lib/regions/types.ts` (export `RegionCategory`, `RegionsMeta`)
- Modify: `lib/regions/mod.ts` (re-export both)
- Modify: `deno.json` (add `./regions/get_regions_meta` export entry)
- Test: `lib/regions/mod_test.ts` (extend) + a new fixture-based unit test

**Interfaces:**
- Consumes: existing `regionTypeSchema`/`RegionType` (`lib/regions/schemas/region_type.ts`)
  — do **not** redefine region types; `RegionCategory` is a *new*, orthogonal
  7-value enum (`administrative`, `census`, `district`, `environmental`,
  `synthetic`, `agricultural`, `custom`), matching backend `Region.Category`.
- Produces: `getRegionsMeta(): Promise<RegionsMeta>`, `RegionsMeta` class with
  `.asIter.types: Array<{type: RegionType, label: string, category: RegionCategory}>`
  and `.type(regionType: RegionType)` single lookup — mirrors
  `lib/monitors/get_monitors_meta.ts`'s `MonitorsMeta` wrapper-class shape
  exactly (stateful wrapper around the raw `{type, label, category}` map,
  not a plain data-returning function).

- [ ] **Step 1: Write the failing schema/category test**

```ts
// lib/regions/schemas/region_category_test.ts
import { assertEquals } from "@std/assert";
import { regionCategorySchema } from "./region_category.ts";

Deno.test("regionCategorySchema accepts all 7 backend categories", () => {
  const categories = [
    "administrative", "census", "district", "environmental",
    "synthetic", "agricultural", "custom",
  ];
  for (const category of categories) {
    regionCategorySchema.parse(category);
  }
});

Deno.test("regionCategorySchema rejects an unknown category", () => {
  const result = regionCategorySchema.safeParse("not-a-real-category");
  assertEquals(result.success, false);
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd ~/workspace/sjvair/sdk-js
deno test lib/regions/schemas/region_category_test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `region_category.ts`**

```ts
// lib/regions/schemas/region_category.ts
import { z } from "zod";

export const regionCategorySchema = z.enum([
  "administrative",
  "census",
  "district",
  "environmental",
  "synthetic",
  "agricultural",
  "custom",
]);

export type RegionCategorySchema = typeof regionCategorySchema;
```

- [ ] **Step 4: Run it, verify it passes**

```bash
deno test lib/regions/schemas/region_category_test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing `getRegionsMeta` fixture test**

```ts
// lib/regions/get_regions_meta_test.ts
import { assertEquals } from "@std/assert";
import { getRegionsMeta } from "./get_regions_meta.ts";
import { setOrigin } from "../http/origin.ts"; // adjust to whatever mocking hook get_monitors_meta_test.ts (if one exists) uses

Deno.test({
  name: "getRegionsMeta wraps the raw types map with .asIter and .type()",
  permissions: { net: false },
  fn: async () => {
    // Follow whatever fetch-mocking pattern lib/monitors/get_monitors_meta_test.ts
    // (or lib/monitors/mod_test.ts, if meta has no dedicated test file) uses —
    // stub the HTTP layer to return:
    // { data: { types: {
    //     county: { type: "county", label: "County", category: "administrative" },
    //     tract:  { type: "tract",  label: "Census Tract", category: "census" },
    // } } }
    const meta = await getRegionsMeta();
    assertEquals(meta.type("county")?.label, "County");
    assertEquals(meta.asIter.types.find((t) => t.type === "tract")?.category, "census");
  },
});
```

Before writing this, read `lib/monitors/get_monitors_meta.ts`'s test (if a
dedicated file exists, else check `lib/monitors/mod_test.ts`) to copy its
exact fetch-stubbing mechanism rather than inventing a new one.

- [ ] **Step 6: Run it, verify it fails**

```bash
deno test lib/regions/get_regions_meta_test.ts
```

Expected: FAIL — `get_regions_meta.ts` doesn't exist.

- [ ] **Step 7: Write `get_regions_meta.ts`**, mirroring `get_monitors_meta.ts`'s
  class-wrapper shape exactly (read that file first for its precise field
  names/method names — `.asIter`, `.entryType()`/`.monitorType()` — and
  replicate the pattern for regions rather than reinventing it):

```ts
// lib/regions/get_regions_meta.ts
import { jsonCall } from "../http/mod.ts";
import { regionTypeSchema, type RegionType } from "./schemas/region_type.ts";
import { regionCategorySchema, type RegionCategory } from "./schemas/region_category.ts";

export interface RegionTypeMeta {
  type: RegionType;
  label: string;
  category: RegionCategory;
}

interface RawRegionsMeta {
  types: Record<string, RegionTypeMeta>;
}

export class RegionsMeta {
  #raw: RawRegionsMeta;

  constructor(raw: RawRegionsMeta) {
    this.#raw = raw;
  }

  get asIter() {
    return { types: Object.values(this.#raw.types) };
  }

  type(regionType: RegionType): RegionTypeMeta | undefined {
    return this.#raw.types[regionType];
  }
}

export async function getRegionsMeta(): Promise<RegionsMeta> {
  const raw = await jsonCall<RawRegionsMeta>("regions/meta");
  return new RegionsMeta(raw);
}
```

Adjust the exact `jsonCall`/import paths to match whatever
`get_monitors_meta.ts` actually imports (confirm during implementation —
this plan's excerpt is the shape, not a guaranteed byte-for-byte import list).

- [ ] **Step 8: Run it, verify it passes**

```bash
deno test lib/regions/get_regions_meta_test.ts
```

Expected: PASS.

- [ ] **Step 9: Wire exports**

Add to `lib/regions/mod.ts`:
```ts
export * from "./get_regions_meta.ts";
```

Add to `lib/regions/types.ts` (or wherever `RegionType` is re-exported from) an
export for `RegionCategory`.

Add to `deno.json`'s `exports` map, alongside the existing `"./regions/get_regions_list"` entry:
```json
"./regions/get_regions_meta": "./lib/regions/get_regions_meta.ts",
```

- [ ] **Step 10: Run the full regions test suite**

```bash
deno test lib/regions/
```

Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/regions/schemas/region_category.ts lib/regions/schemas/region_category_test.ts \
        lib/regions/get_regions_meta.ts lib/regions/get_regions_meta_test.ts \
        lib/regions/mod.ts lib/regions/types.ts deno.json
git commit -m "Add getRegionsMeta() and RegionCategory schema"
```

---

### Task 6: `within` param on `getRegionsList`

**Files:**
- Modify: `lib/regions/get_regions_list.ts`
- Test: `lib/regions/get_regions_list_test.ts` (or add cases to `mod_test.ts`
  if that's where existing coverage for this function lives — check first)

**Interfaces:**
- Modifies: `RegionsListFilters` — adds `within?: string | Array<string>` to
  all three union arms (it's an *additional* filter, not one of the
  "at least one of name/slug/type" required set):

```ts
export type RegionsListFilters =
  | { name: string; slug?: string; type?: RegionType; within?: string | Array<string> }
  | { name?: string; slug: string; type?: RegionType; within?: string | Array<string> }
  | { name?: string; slug?: string; type: RegionType; within?: string | Array<string> };
```

- [ ] **Step 1: Write the failing test**

```ts
Deno.test({
  name: "getRegionsList serializes within as repeatable searchParams entries",
  permissions: { net: false },
  fn: async () => {
    // Stub httpRequest/jsonCall the same way this file's existing tests do,
    // capturing the searchParams passed through.
    let capturedParams: Record<string, unknown> | undefined;
    // ... stub jsonCall to record its second arg into capturedParams ...
    await getRegionsList({ type: "tract", within: ["sqid1", "sqid2"] });
    assertEquals(capturedParams?.within, ["sqid1", "sqid2"]);
  },
});
```

Match this to whatever mocking mechanism `get_regions_list_test.ts`'s
existing tests already use (read the file first — do not invent a second
mocking approach in the same file).

- [ ] **Step 2: Run it, verify it fails**

```bash
deno test lib/regions/get_regions_list_test.ts
```

Expected: FAIL — TS type error (`within` isn't a valid property of
`RegionsListFilters`) or a runtime assertion failure if TS is loose there.

- [ ] **Step 3: Add `within` to the filters type and searchParams builder**

Locate where `get_regions_list.ts` currently builds its `Record<string, string>`
searchParams from `filters` and add:

```ts
if (filters.within !== undefined) {
  searchParams.within = filters.within;
}
```

(matching the array-capable `Record<string, string | Array<string>>` shape
`get_monitor_summaries_bulk.ts`'s `region` param already uses — this repo's
HTTP layer already handles repeatable array params, no new serialization
code needed).

- [ ] **Step 4: Run it, verify it passes**

```bash
deno test lib/regions/get_regions_list_test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/regions/get_regions_list.ts lib/regions/get_regions_list_test.ts
git commit -m "Add within param to getRegionsList"
```

---

### Task 7: Extract shared pagination-merge helper

Pulls `fetchAllBulkSummaryPages` + `mergeMonitorSummaryBulkPages` out of
`lib/monitors/get_monitor_summaries_bulk.ts` into a generic helper in
`lib/http/requests.ts`, so Task 8's `get_region_summaries_bulk.ts` doesn't
duplicate them. Do this **before** Task 8, and verify the monitor bulk
summaries behavior is unchanged (regression, not rewrite).

**Files:**
- Modify: `lib/http/requests.ts` (add the generic helpers)
- Modify: `lib/monitors/get_monitor_summaries_bulk.ts` (use them instead of
  its own private copies)
- Test: existing `lib/monitors/mod_test.ts:388-443` (`mergeMonitorSummaryBulkPages`
  test) must keep passing unmodified — this is the regression gate

**Interfaces:**
- Produces, in `lib/http/requests.ts`:
  ```ts
  export function mergeBulkPages<T extends { id: string }>(
    pages: Array<Array<T>>,
    mergeSummaries: (a: T, b: T) => T,
  ): Array<T>

  export async function fetchAllBulkPages<T extends { id: string }>(
    requestConfig: APIRequestConfig,
  ): Promise<Array<Array<T>>>
  ```
  `mergeBulkPages` walks each page in order; when the last item of the
  accumulated result has the same `id` as the next page's first item, it
  replaces that accumulated item with `mergeSummaries(existing, incoming)`
  instead of pushing a duplicate — otherwise pushes as-is. `mergeSummaries`
  is the caller's concat-the-array-field logic (different field name for
  monitors' `summaries` vs. whatever the region version calls it — same
  field name `summaries`, per `BulkRegionSummaryGroupSerializer` in Task 4,
  so this can actually be a single non-parameterized field name if both
  bulk endpoints keep calling it `summaries`; confirm this during
  implementation and simplify the signature to drop the `mergeSummaries`
  callback in favor of a hardcoded `.summaries` concat if so — do not
  over-parameterize past what's actually needed).

- [ ] **Step 1: Confirm the current baseline test passes**

```bash
cd ~/workspace/sjvair/sdk-js
deno test lib/monitors/mod_test.ts --filter "mergeMonitorSummaryBulkPages"
```

Expected: PASS (this is the regression gate for the whole task).

- [ ] **Step 2: Add the generic helpers to `lib/http/requests.ts`**, next to
  the existing `paginatedApiCall`:

```ts
export function mergeBulkPages<T extends { id: string; summaries: Array<unknown> }>(
  pages: Array<Array<T>>,
): Array<T> {
  const merged: Array<T> = [];
  for (const page of pages) {
    for (const item of page) {
      const last = merged[merged.length - 1];
      if (last && last.id === item.id) {
        merged[merged.length - 1] = { ...last, summaries: [...last.summaries, ...item.summaries] };
      } else {
        merged.push(item);
      }
    }
  }
  return merged;
}

export async function fetchAllBulkPages<T>(
  requestConfig: APIRequestConfig,
): Promise<Array<Array<T>>> {
  const first = await httpRequest<PaginatedResponse<T>>(requestConfig);
  if (!first.has_next_page) return [first.data];

  const remaining = await Promise.all(
    Array.from({ length: first.pages - first.page }, (_, i) =>
      httpRequest<PaginatedResponse<T>>({
        ...requestConfig,
        searchParams: { ...requestConfig.searchParams, page: String(first.page + 1 + i) },
      }),
    ),
  );
  return [first.data, ...remaining.map((r) => r.data)];
}
```

(Read the actual current implementations of `fetchAllBulkSummaryPages` and
`mergeMonitorSummaryBulkPages` in `get_monitor_summaries_bulk.ts` before
writing this step for real — copy their exact page-fetch-parallelism logic
rather than approximating it; the excerpt above is the shape, not a
guaranteed byte-for-byte port.)

- [ ] **Step 3: Update `get_monitor_summaries_bulk.ts` to use the shared helpers**

Replace its private `fetchAllBulkSummaryPages`/`mergeMonitorSummaryBulkPages`
with calls to `fetchAllBulkPages<MonitorWithSummaries>` / `mergeBulkPages<MonitorWithSummaries>`
imported from `../http/mod.ts`, keeping the six thin per-resolution wrapper
exports (`getMonitorSummariesBulkHourly` etc.) unchanged in their own
signatures — only their internals change.

- [ ] **Step 4: Run the regression test again**

```bash
deno test lib/monitors/mod_test.ts --filter "mergeMonitorSummaryBulkPages"
deno test lib/monitors/  # full regression
```

Expected: all PASS, unchanged from Step 1's baseline.

- [ ] **Step 5: Commit**

```bash
git add lib/http/requests.ts lib/monitors/get_monitor_summaries_bulk.ts
git commit -m "Extract shared paginated-bulk-fetch/merge helper from monitor summaries"
```

---

### Task 8: `getRegionSummariesBulk*` functions

**Files:**
- Create: `lib/regions/get_region_summaries_bulk.ts`
- Create: `lib/regions/schemas/region_with_summaries.ts` (or add to
  `schemas/region_summary.ts` if that's a more natural fit — check the
  existing file's scope first)
- Modify: `lib/regions/mod.ts`
- Modify: `deno.json`
- Test: `lib/regions/get_region_summaries_bulk_test.ts`

**Interfaces:**
- Consumes: `fetchAllBulkPages`/`mergeBulkPages` (Task 7), `regionSchema`
  (existing), `RegionSummarySerializer`-shaped rows (backend Task 4).
- Produces:
  ```ts
  export interface RegionSummaryBulkRequestConfig {
    entryType: string;
    start: Date | string;
    end: Date | string;
    region: string | Array<string>;
  }
  export type RegionWithSummaries = RegionData & { summaries: Array<RegionSummaryData> };
  export async function getRegionSummariesBulkHourly(config: RegionSummaryBulkRequestConfig): Promise<Array<RegionWithSummaries>>
  // ...and Daily/Monthly/Quarterly/Seasonal/Yearly, one per resolution
  ```

- [ ] **Step 1: Write the failing pure-merge unit test**

Mirror `lib/monitors/mod_test.ts:388-443` exactly, substituting regions:

```ts
// lib/regions/get_region_summaries_bulk_test.ts
Deno.test({
  name: "getRegionSummariesBulk pagination/merge boundary",
  permissions: { net: false },
  fn: () => {
    const page1: Array<RegionWithSummaries> = [
      { id: "whole-region", name: "Whole", slug: "whole", type: "county", boundary: null,
        summaries: [{ timestamp: "2026-01-01T00:00:00-08:00", entry_type: "pm25", resolution: "day",
          count: 24, expected_count: 24, minimum: 1, maximum: 2, mean: 1.5, stddev: 0.1,
          p25: 1, p75: 2, station_count: 3 }] },
      { id: "split-region", name: "Split", slug: "split", type: "county", boundary: null,
        summaries: [{ timestamp: "2026-01-01T00:00:00-08:00", entry_type: "pm25", resolution: "day",
          count: 24, expected_count: 24, minimum: 1, maximum: 2, mean: 1.5, stddev: 0.1,
          p25: 1, p75: 2, station_count: 3 }] },
    ];
    const page2: Array<RegionWithSummaries> = [
      { id: "split-region", name: "Split", slug: "split", type: "county", boundary: null,
        summaries: [{ timestamp: "2026-01-02T00:00:00-08:00", entry_type: "pm25", resolution: "day",
          count: 24, expected_count: 24, minimum: 1, maximum: 2, mean: 1.6, stddev: 0.1,
          p25: 1, p75: 2, station_count: 3 }] },
      { id: "another-region", name: "Another", slug: "another", type: "county", boundary: null,
        summaries: [] },
    ];
    const merged = mergeBulkPages([page1, page2]);
    assertEquals(merged.map((r) => r.id), ["whole-region", "split-region", "another-region"]);
    assertEquals(merged[1].summaries.length, 2);
  },
});
```

- [ ] **Step 2: Run it, verify it fails**

```bash
cd ~/workspace/sjvair/sdk-js
deno test lib/regions/get_region_summaries_bulk_test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `get_region_summaries_bulk.ts`**, mirroring
  `get_monitor_summaries_bulk.ts`'s six-thin-wrapper shape:

```ts
// lib/regions/get_region_summaries_bulk.ts
import { fetchAllBulkPages, mergeBulkPages } from "../http/mod.ts";
import type { RegionData } from "./schemas/region.ts";
import type { RegionSummaryData } from "./schemas/region_summary.ts";

export interface RegionSummaryBulkRequestConfig {
  entryType: string;
  start: Date | string;
  end: Date | string;
  region: string | Array<string>;
}

export type RegionWithSummaries = RegionData & { summaries: Array<RegionSummaryData> };

function toApiDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function getBulkSummarySearchParams(config: RegionSummaryBulkRequestConfig) {
  return {
    start: toApiDate(config.start),
    end: toApiDate(config.end),
    region: config.region,
  };
}

async function fetchAndMerge(
  entryType: string,
  resolution: string,
  config: RegionSummaryBulkRequestConfig,
): Promise<Array<RegionWithSummaries>> {
  const pages = await fetchAllBulkPages<RegionWithSummaries>({
    url: `regions/${entryType}/summaries/${resolution}`,
    searchParams: getBulkSummarySearchParams(config),
  });
  return mergeBulkPages(pages);
}

export const getRegionSummariesBulkHourly = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "hourly", c);
export const getRegionSummariesBulkDaily = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "daily", c);
export const getRegionSummariesBulkMonthly = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "monthly", c);
export const getRegionSummariesBulkQuarterly = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "quarterly", c);
export const getRegionSummariesBulkSeasonal = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "seasonal", c);
export const getRegionSummariesBulkYearly = (c: RegionSummaryBulkRequestConfig) => fetchAndMerge(c.entryType, "yearly", c);
```

Read `get_monitor_summaries_bulk.ts`'s actual `toApiDate`/`getBulkSummarySearchParams`
implementations first and match them exactly rather than approximating —
this excerpt is the shape.

- [ ] **Step 4: Run it, verify it passes**

```bash
deno test lib/regions/get_region_summaries_bulk_test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire exports**

Add to `lib/regions/mod.ts`:
```ts
export * from "./get_region_summaries_bulk.ts";
```

Add to `deno.json`:
```json
"./regions/get_region_summaries_bulk": "./lib/regions/get_region_summaries_bulk.ts",
```

- [ ] **Step 6: Run full regions + monitors regression**

```bash
deno test lib/regions/ lib/monitors/
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/regions/get_region_summaries_bulk.ts lib/regions/get_region_summaries_bulk_test.ts \
        lib/regions/mod.ts deno.json
git commit -m "Add getRegionSummariesBulk* functions"
```

---

### Task 9: Version bump (separate commit, do not publish)

Matches this repo's existing convention (feature commits and version-bump
commits are separate, per commit `80b1019` + `45c9880`). **This task creates
the commit only — it does not run `npm publish` or any release workflow.**
Per the Global Constraints, publishing needs the user's explicit go-ahead
every time, separately from this plan.

**Files:**
- Modify: `deno.json` (or wherever the SDK version field lives — confirm
  during Task 5, current value was `"4.4.0"`)

- [ ] **Step 1: Bump the version**

```bash
cd ~/workspace/sjvair/sdk-js
# Edit the version field: "4.4.0" -> "4.5.0"
```

- [ ] **Step 2: Commit**

```bash
git add deno.json
git commit -m "Bump package version to 4.5.0"
```

- [ ] **Step 3: Push and open a PR — do not publish**

```bash
git push -u origin feature/multi-region-selector-sdk
gh pr create --title "Add regions meta, within filter, bulk region summaries (v4.5.0)" --body "Implements the SDK track of the multi-region-selector design spec: getRegionsMeta, within param on getRegionsList, getRegionSummariesBulk*, and the shared pagination-merge helper extracted from monitor bulk summaries."
```

Stop here. Publishing to JSR/npm requires the user's separate, explicit
approval — flag that this PR is ready and ask before taking any further
release action.

---

## Frontend UI Atoms Track (`data-dashboard`)

Branch: `feature/multi-region-selector-ui-atoms`, based on the already-rebased
`feature/multi-region-selector-spec` (or off current `main` directly — these
tasks have no manager/SDK dependency and don't need the spec commit itself).
Everything in this track is independent of the SDK track landing — build and
unit-test standalone.

### Task 10: URL codecs for `regionType`/`regions`

**Files:**
- Modify: `src/lib/url-state.ts`
- Test: `src/lib/url-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function encodeRegionType(regionType: string): string
  export function decodeRegionType(value: string | number | boolean | null | undefined): string | null
  export function encodeRegionSelection(ids: Set<string> | Array<string>): string
  export function decodeRegionSelection(value: string | number | boolean | null | undefined): Set<string>
  ```
  `regionType` is a plain passthrough string codec (like `encodeCounty`/`decodeCounty`).
  `regionSelection` reuses the comma-separated-set *encoding* idiom from
  `encodeViews`, but — unlike `decodeViews`, which needs a fixed `allKeys`
  allowlist and returns a `Record<K, boolean>` — decodes to an open-ended
  `Set<string>` of ids directly, since region ids aren't a fixed enum.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/url-state.test.ts`, following that file's existing
`describe`-per-codec structure:

```ts
describe("region type codec", () => {
	it("round-trips a region type", () => {
		expect(decodeRegionType(encodeRegionType("tract"))).toBe("tract");
	});

	it("returns null for null/undefined", () => {
		expect(decodeRegionType(null)).toBeNull();
		expect(decodeRegionType(undefined)).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(decodeRegionType("")).toBeNull();
	});
});

describe("region selection codec", () => {
	it("round-trips a set of ids", () => {
		const ids = new Set(["id1", "id2", "id3"]);
		expect(decodeRegionSelection(encodeRegionSelection(ids))).toEqual(ids);
	});

	it("round-trips an array of ids", () => {
		expect(decodeRegionSelection(encodeRegionSelection(["id1", "id2"]))).toEqual(
			new Set(["id1", "id2"])
		);
	});

	it("returns an empty set for null/undefined", () => {
		expect(decodeRegionSelection(null)).toEqual(new Set());
		expect(decodeRegionSelection(undefined)).toEqual(new Set());
	});

	it("returns an empty set for an empty string", () => {
		expect(decodeRegionSelection("")).toEqual(new Set());
	});

	it("filters out empty entries from stray commas", () => {
		expect(decodeRegionSelection("id1,,id2")).toEqual(new Set(["id1", "id2"]));
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd ~/workspace/sjvair/data-dashboard
npm run test -- url-state
```

Expected: FAIL — functions don't exist.

- [ ] **Step 3: Implement the codecs**

Add to `src/lib/url-state.ts`:

```ts
export function encodeRegionType(regionType: string): string {
	return regionType;
}

export function decodeRegionType(
	value: string | number | boolean | null | undefined
): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function encodeRegionSelection(ids: Set<string> | Array<string>): string {
	return Array.from(ids).join(",");
}

export function decodeRegionSelection(
	value: string | number | boolean | null | undefined
): Set<string> {
	if (typeof value !== "string" || value.length === 0) return new Set();
	return new Set(value.split(",").filter(Boolean));
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm run test -- url-state
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-state.ts src/lib/url-state.test.ts
git commit -m "Add regionType/regions URL codecs"
```

---

### Task 11: Point-in-polygon monitor-scoping helper

**Files:**
- Create: `src/lib/monitors/region-scoping.ts`
- Test: `src/lib/monitors/region-scoping.test.ts`
- Modify: `package.json` (add `@turf/boolean-point-in-polygon` as a direct
  dependency — it's currently only a transitive dep via `@sjvair/monitor-map`,
  per research; pin a direct version rather than relying on that)

**Interfaces:**
- Consumes: `MonitorData` (has `.position: [number, number] | null` — confirm
  exact field name/shape against `@sjvair/sdk`'s actual `MonitorData` type
  during implementation, since `monitors-tab.svelte.ts` references
  `monitor.county` today but not `monitor.position` directly — grep the SDK's
  `lib/monitors/schemas/monitor.ts` for the real field name before writing
  this), `RegionData` (`.boundary.geometry: MultiPolygon | null`, per
  `sdk-js`'s `boundarySchema`).
- Produces:
  ```ts
  export function monitorInRegions(
    monitor: MonitorData,
    regions: Array<RegionData>
  ): boolean
  ```
  Returns `false` if the monitor has no position, guards each region's
  `!region?.boundary?.geometry` (same null-guard pattern already used at
  `MonitorsTab.svelte:274`), and returns `true` if the monitor's position is
  covered by *any* of the given regions' geometry (OR across regions, same
  semantics as `visibleMonitors` today: a monitor visible if it matches the
  active selection at all).

- [ ] **Step 1: Add the dependency**

```bash
cd ~/workspace/sjvair/data-dashboard
npm install @turf/boolean-point-in-polygon
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/monitors/region-scoping.test.ts
import { describe, expect, it } from "vitest";
import { monitorInRegions } from "./region-scoping";
import type { MonitorData, RegionData } from "@sjvair/sdk";

function makeRegion(id: string, coords: Array<[number, number]>): RegionData {
	return {
		id,
		name: id,
		slug: id,
		type: "county",
		boundary: {
			id: `${id}-boundary`,
			version: "1",
			geometry: { type: "MultiPolygon", coordinates: [[coords]] },
			bbox: [-120, 35, -119, 36]
		}
	} as RegionData;
}

function makeMonitor(position: [number, number] | null): MonitorData {
	return { position } as MonitorData;
}

const SQUARE = [
	[-120, 35],
	[-120, 36],
	[-119, 36],
	[-119, 35],
	[-120, 35]
] as Array<[number, number]>;

describe("monitorInRegions", () => {
	it("returns true when the monitor's position is inside a region's polygon", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [region])).toBe(true);
	});

	it("returns false when the monitor's position is outside every region", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor([-100, 40]), [region])).toBe(false);
	});

	it("returns false when the monitor has no position", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor(null), [region])).toBe(false);
	});

	it("skips a region with no boundary geometry rather than throwing", () => {
		const region = { id: "b", name: "b", slug: "b", type: "county", boundary: null } as RegionData;
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [region])).toBe(false);
	});

	it("returns true if the monitor is inside any of several regions", () => {
		const inside = makeRegion("a", SQUARE);
		const elsewhere = makeRegion("b", [
			[10, 10],
			[10, 11],
			[11, 11],
			[11, 10],
			[10, 10]
		]);
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [elsewhere, inside])).toBe(true);
	});
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
npm run test -- region-scoping
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```ts
// src/lib/monitors/region-scoping.ts
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { MonitorData, RegionData } from "@sjvair/sdk";

export function monitorInRegions(monitor: MonitorData, regions: Array<RegionData>): boolean {
	if (!monitor.position) return false;

	for (const region of regions) {
		if (!region?.boundary?.geometry) continue;
		if (booleanPointInPolygon(monitor.position, region.boundary.geometry)) {
			return true;
		}
	}

	return false;
}
```

Confirm `MonitorData.position`'s actual field name/shape (`[lng, lat]` vs.
`{lat, lng}`) against `@sjvair/sdk`'s real schema before finalizing — adjust
the tuple access accordingly if it's not already a `[number, number]` tuple.

- [ ] **Step 5: Run tests, verify they pass**

```bash
npm run test -- region-scoping
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/monitors/region-scoping.ts src/lib/monitors/region-scoping.test.ts
git commit -m "Add point-in-polygon monitor-region-scoping helper"
```

---

### Task 12: Narrowing escape-hatch pure logic

**Files:**
- Create: `src/lib/monitors/region-narrowing.ts`
- Test: `src/lib/monitors/region-narrowing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function unionOfOtherTypeSelections(
    selections: Map<string, Set<string>>,
    activeType: string
  ): Set<string>

  export function shouldNarrow(
    selections: Map<string, Set<string>>,
    activeType: string,
    narrowingEnabled: Map<string, boolean>
  ): boolean
  ```
  `unionOfOtherTypeSelections` returns the union of every *other* type's
  selected ids (excludes `activeType`'s own set) — this is what feeds
  `within=` on the regions-list fetch. `shouldNarrow` is true exactly when
  the union is non-empty AND `narrowingEnabled.get(activeType) !== false`
  (defaults to `true` per the spec: "defaults to narrowed whenever another
  type currently has a non-empty selection").

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/monitors/region-narrowing.test.ts
import { describe, expect, it } from "vitest";
import { shouldNarrow, unionOfOtherTypeSelections } from "./region-narrowing";

describe("unionOfOtherTypeSelections", () => {
	it("unions every other type's selected ids", () => {
		const selections = new Map([
			["county", new Set(["c1", "c2"])],
			["city", new Set(["ct1"])],
			["tract", new Set(["t1"])]
		]);
		expect(unionOfOtherTypeSelections(selections, "tract")).toEqual(new Set(["c1", "c2", "ct1"]));
	});

	it("excludes the active type's own selection", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		expect(unionOfOtherTypeSelections(selections, "county")).toEqual(new Set());
	});

	it("returns an empty set when no other type has a selection", () => {
		const selections = new Map([
			["county", new Set<string>()],
			["tract", new Set(["t1"])]
		]);
		expect(unionOfOtherTypeSelections(selections, "tract")).toEqual(new Set());
	});
});

describe("shouldNarrow", () => {
	it("is true when another type has a selection and narrowing isn't disabled", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		expect(shouldNarrow(selections, "tract", new Map())).toBe(true);
	});

	it("is false when no other type has a selection", () => {
		const selections = new Map([["county", new Set<string>()]]);
		expect(shouldNarrow(selections, "tract", new Map())).toBe(false);
	});

	it("is false when the user explicitly disabled narrowing for the active type", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		const narrowingEnabled = new Map([["tract", false]]);
		expect(shouldNarrow(selections, "tract", narrowingEnabled)).toBe(false);
	});

	it("disabling narrowing for one type doesn't affect another", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		const narrowingEnabled = new Map([["city", false]]);
		expect(shouldNarrow(selections, "tract", narrowingEnabled)).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm run test -- region-narrowing
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/monitors/region-narrowing.ts
export function unionOfOtherTypeSelections(
	selections: Map<string, Set<string>>,
	activeType: string
): Set<string> {
	const union = new Set<string>();
	for (const [type, ids] of selections) {
		if (type === activeType) continue;
		for (const id of ids) union.add(id);
	}
	return union;
}

export function shouldNarrow(
	selections: Map<string, Set<string>>,
	activeType: string,
	narrowingEnabled: Map<string, boolean>
): boolean {
	if (unionOfOtherTypeSelections(selections, activeType).size === 0) return false;
	return narrowingEnabled.get(activeType) !== false;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm run test -- region-narrowing
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitors/region-narrowing.ts src/lib/monitors/region-narrowing.test.ts
git commit -m "Add narrowing escape-hatch pure logic"
```

---

### Task 13: `RegionCheckboxList.svelte` component

**Files:**
- Create: `src/lib/components/RegionCheckboxList.svelte`
- Create: `src/lib/components/ui/checkbox/checkbox.svelte` (thin bits-ui
  `Checkbox.Root`/`Checkbox.Input` wrapper, following the file-per-part
  convention already used by `src/lib/components/ui/select/`)
- Create: `src/lib/components/ui/checkbox/index.ts` (barrel export, matching
  `select/index.ts`'s pattern)

No dedicated Vitest coverage for this file — per the spec's Testing section,
Svelte component behavior in this repo is verified manually in the browser,
consistent with `refreshCountyFill`/`refreshMapAverages` having no test
precedent either. This task's "test cycle" is the manual verification step
below, not an automated one.

**Interfaces:**
- Consumes: bits-ui's `Checkbox` primitive (already installed, `^2.19.2`,
  not yet wired into `ui/`), the `RegionData` type from `@sjvair/sdk`.
- Produces: a `RegionCheckboxList` component with props
  `{ regions: Array<RegionData>, selected: Set<string>, onToggle: (id: string) => void }`.
  Renders a plain-text filter `<input>` above the list only when
  `regions.length > 10` (client-side substring match on `region.name`,
  case-insensitive); a `Checkbox` per (filtered) region below, checked state
  from `selected.has(region.id)`, calling `onToggle(region.id)` on change.

- [ ] **Step 1: Scaffold the bits-ui checkbox wrapper**

```svelte
<!-- src/lib/components/ui/checkbox/checkbox.svelte -->
<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from "bits-ui";
	import type { ComponentProps } from "svelte";

	let { checked = false, onCheckedChange, ...restProps }: ComponentProps<typeof CheckboxPrimitive.Root> = $props();
</script>

<CheckboxPrimitive.Root
	{checked}
	{onCheckedChange}
	class="border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded border"
	{...restProps}
>
	{#snippet children({ checked })}
		{#if checked}
			<svg viewBox="0 0 16 16" class="size-3" aria-hidden="true">
				<path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" stroke-width="2" fill="none" />
			</svg>
		{/if}
	{/snippet}
</CheckboxPrimitive.Root>
```

Adjust exact prop names/structure once you confirm the installed bits-ui
`2.19.2` Checkbox API's real prop names against
`node_modules/bits-ui/dist/bits/checkbox/checkbox.svelte`'s type
definitions — this excerpt is the shape to follow, mirroring how
`ui/select/select.svelte` wraps `Select.Root`, not a guaranteed exact API.

```ts
// src/lib/components/ui/checkbox/index.ts
export { default as Checkbox } from "./checkbox.svelte";
```

- [ ] **Step 2: Build `RegionCheckboxList.svelte`**

```svelte
<!-- src/lib/components/RegionCheckboxList.svelte -->
<script lang="ts">
	import type { RegionData } from "@sjvair/sdk";
	import { Checkbox } from "$lib/components/ui/checkbox";

	interface Props {
		regions: Array<RegionData>;
		selected: Set<string>;
		onToggle: (id: string) => void;
	}

	let { regions, selected, onToggle }: Props = $props();

	let filterText = $state("");

	let filteredRegions = $derived(
		filterText.trim()
			? regions.filter((region) => region.name.toLowerCase().includes(filterText.trim().toLowerCase()))
			: regions
	);
</script>

<div class="flex flex-col gap-2">
	{#if regions.length > 10}
		<input
			type="text"
			placeholder="Filter regions..."
			bind:value={filterText}
			class="border-input rounded border px-2 py-1 text-sm"
		/>
	{/if}

	<div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
		{#each filteredRegions as region (region.id)}
			<label class="flex items-center gap-2 text-sm">
				<Checkbox checked={selected.has(region.id)} onCheckedChange={() => onToggle(region.id)} />
				{region.name}
			</label>
		{/each}
	</div>
</div>
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```

Navigate to the Monitors tab (this component isn't wired in yet at this
point in the plan — verify it in isolation by temporarily mounting it in a
scratch route, or defer full visual verification to Task 16 once it's wired
into `MonitorsTab.svelte`). Confirm: filter input only appears for >10 items,
checkboxes toggle visually, filtering narrows the list without losing
checked state on filtered-out items.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/RegionCheckboxList.svelte src/lib/components/ui/checkbox/
git commit -m "Add RegionCheckboxList component"
```

---

## Frontend Integration Track (`data-dashboard`)

Branch: continue on `feature/multi-region-selector-ui-atoms` (rename to
`feature/multi-region-selector` if preferred) once Tasks 10–13 are merged
into it, or rebase onto them. **This track needs the SDK track's real
exports** (`getRegionsMeta`, `getRegionsList` with `within`,
`getRegionSummariesBulk*`) — either wait for `sdk-js`'s PR to merge and
`data-dashboard`'s `package.json` to bump, or use the temporary
`vite.config.ts` alias from Global Constraints to develop against the
unpublished sibling repo in the meantime.

### Task 14: `MonitorsTabManager` state model rewrite

**Files:**
- Modify: `src/routes/monitors/monitors-tab.svelte.ts`
- Modify: `src/lib/monitors/county-fill.ts` → rename/generalize (keep the
  file if the function itself needs no change beyond its name implying
  "region" not "county" — confirm during implementation whether a rename is
  worth it or the existing `buildCountyFillColors(Map<string, number>, ...)`
  signature is already type-agnostic enough to reuse as-is under its
  current name; don't rename speculatively if nothing else changes)

**Interfaces:**
- Removes: `selectedCountyId: string | null`, `counties: Array<RegionData> | null`.
- Produces (per spec's Data model section):
  ```ts
  regionTypes: RegionsMeta | null            // fetched once in init()
  selectedRegionType: RegionType             // defaults to "county"
  regionSelections: Map<RegionType, Set<string>>
  narrowingEnabled: Map<RegionType, boolean>
  activeRegions: Array<RegionData> | null    // fetched list for selectedRegionType
  ```
  `visibleMonitors` becomes `$derived.by` over `monitorInRegions` (Task 11)
  against the *selected subset* of `activeRegions` (ids in
  `regionSelections.get(selectedRegionType)`), replacing `countyMatches`.

This task is state-shape only — it does not yet wire the fetch functions
(Task 15) or the Svelte template (Task 16). Since there's no existing test
precedent for this manager class (confirmed during research), this task's
verification is TypeScript compilation + Task 16's manual browser check, not
a unit test — but do write it so `npm run check` passes standalone before
moving to Task 15.

- [ ] **Step 1: Confirm current state as a compilation baseline**

```bash
cd ~/workspace/sjvair/data-dashboard
npm run check
```

Expected: PASS (before touching anything).

- [ ] **Step 2: Replace the state fields**

```ts
// src/routes/monitors/monitors-tab.svelte.ts
import {
	getMonitorsList,
	getMonitorSummariesBulkMonthly,
	getMonitorsMeta,
	getRegionsList,
	getRegionsMeta,
	type MonitorData,
	type MonitorLatestType,
	type MonitorsMeta,
	type RegionData,
	type RegionsMeta,
	type RegionType,
	type SJVAirEntryLevel
} from "@sjvair/sdk";
import type { MonitorsDataSource } from "@sjvair/monitor-map";
import { XMap } from "@tstk/builtin-extensions";
import { buildCalendarDays, type CalendarDay } from "$lib/calendar";
import { monitorInRegions } from "$lib/monitors/region-scoping";
import { shouldNarrow, unionOfOtherTypeSelections } from "$lib/monitors/region-narrowing";
import { buildCountyFillColors } from "$lib/monitors/county-fill";
import { buildMonitorsLatest, type SupportedPollutant } from "$lib/monitors/monitor-latest";

export interface DateRange {
	start: string;
	end: string;
}

const DEFAULT_REGION_TYPE: RegionType = "county";

class MonitorsTabManager implements MonitorsDataSource {
	initialized: boolean = $state(false);

	monitors: Array<MonitorData> | null = $state(null);
	meta: MonitorsMeta | null = $state(null);
	regionTypes: RegionsMeta | null = $state(null);

	pollutant: SupportedPollutant | null = $state(null);
	dateRange: DateRange = $state({ start: "", end: "" });

	selectedRegionType: RegionType = $state(DEFAULT_REGION_TYPE);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- keys are stable per-type sentinels, not reactive per-entry state
	regionSelections: Map<RegionType, Set<string>> = $state(new Map());
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- same as above
	narrowingEnabled: Map<RegionType, boolean> = $state(new Map());
	activeRegions: Array<RegionData> | null = $state(null);

	latest: XMap<string, MonitorLatestType<SupportedPollutant>> | null = $state(null);
	calendarDays: Array<CalendarDay> | null = $state(null);
	regionCalendars: Array<{ region: RegionData; days: Array<CalendarDay> }> | null = $state(null);
	regionFillColors: Map<string, string> | null = $state(null);

	levels: Array<SJVAirEntryLevel> | null = $derived(
		this.meta && this.pollutant ? (this.meta.entryType(this.pollutant).asIter.levels ?? null) : null
	);

	selectedRegionIds: Set<string> = $derived(
		this.regionSelections.get(this.selectedRegionType) ?? new Set()
	);

	visibleMonitors: Array<MonitorData> = $derived.by(() => {
		if (!this.monitors || !this.activeRegions || this.selectedRegionIds.size === 0) return [];

		const selectedRegions = this.activeRegions.filter((region) => this.selectedRegionIds.has(region.id));
		if (selectedRegions.length === 0) return [];

		return this.monitors.filter((monitor) => monitorInRegions(monitor, selectedRegions));
	});

	// init()/refresh*() bodies land in Task 15 — this task only establishes the
	// field shapes so `npm run check` passes with the rest of the class stubbed:

	async init(): Promise<void> {
		if (this.initialized) return;

		const county: RegionType = DEFAULT_REGION_TYPE;
		[this.monitors, this.meta, this.regionTypes, this.activeRegions] = await Promise.all([
			getMonitorsList(),
			getMonitorsMeta(),
			getRegionsMeta(),
			getRegionsList({ type: county })
		]);

		// Default: all counties selected, matching today's "All Counties" default.
		this.regionSelections.set(county, new Set(this.activeRegions.map((r) => r.id)));

		this.initialized = true;
	}

	async refreshMapAverages(): Promise<void> {
		/* rewritten in Task 15 */
	}

	async refreshCalendar(): Promise<void> {
		/* rewritten in Task 15 */
	}

	async refreshRegionFill(): Promise<void> {
		/* rewritten in Task 15 */
	}
}

export const monitorsTabManager = new MonitorsTabManager();
export type { MonitorsTabManager };
```

- [ ] **Step 3: Run typecheck**

```bash
npm run check
```

Expected: FAIL at this point in `MonitorsTab.svelte` (Task 16 hasn't updated
it yet) — that's fine for this task; confirm the *manager file itself* has
no type errors by checking the compiler output is scoped to
`MonitorsTab.svelte`, not `monitors-tab.svelte.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/monitors/monitors-tab.svelte.ts
git commit -m "Rewrite MonitorsTabManager state model for multi-region selection"
```

(Leave `MonitorsTab.svelte` broken across this commit boundary deliberately
— Task 16 fixes it in the same PR before this branch is considered done;
committing the state-shape change on its own keeps this diff reviewable.)

---

### Task 15: Generalize refresh methods + bulk region-summaries wiring

**Files:**
- Modify: `src/routes/monitors/monitors-tab.svelte.ts`

**Interfaces:**
- Consumes: `getRegionSummariesBulkMonthly`/`Daily` (SDK Task 8),
  `unionOfOtherTypeSelections`/`shouldNarrow` (Task 12).
- Produces: `refreshMapAverages`, `refreshCalendar` (renamed conceptually
  but keep the export name — `MonitorsTab.svelte` calls it — or rename
  consistently in both files together; **do not rename in only one file**),
  `refreshRegionFill` (was `refreshCountyFill`), and a new
  `refreshActiveRegions()` that performs the `within=`-scoped regions-list
  fetch and populates `activeRegions`. All fetches switch from N
  parallel per-region calls to a single bulk call, and in-flight requests
  for a superseded region type must not race a newer fetch's results.

- [ ] **Step 1: Implement `refreshActiveRegions` with in-flight supersession**

```ts
// src/routes/monitors/monitors-tab.svelte.ts — add to MonitorsTabManager
#activeRegionsFetchToken = 0;

async refreshActiveRegions(): Promise<void> {
	const token = ++this.#activeRegionsFetchToken;
	const type = this.selectedRegionType;

	const withinIds = shouldNarrow(this.regionSelections, type, this.narrowingEnabled)
		? Array.from(unionOfOtherTypeSelections(this.regionSelections, type))
		: undefined;

	const regions = await getRegionsList({ type, within: withinIds });

	// A newer call (from a subsequent region-type switch) has already
	// landed — this response is stale, discard it rather than racing.
	if (token !== this.#activeRegionsFetchToken) return;

	this.activeRegions = regions;
	if (!this.regionSelections.has(type)) {
		this.regionSelections.set(type, new Set());
	}
}
```

This is "a real gap to close as part of implementation, not defer" per the
spec's edge-cases section — apply the same token-based supersession pattern
to `refreshMapAverages`/`refreshCalendar`/`refreshRegionFill` below, since
none of the *existing* `refreshCountyFill`/`refreshCalendar` code has any
such guard today (confirmed during research — this is new, not a port).

- [ ] **Step 2: Rewrite `refreshMapAverages` to use the bulk region-summaries
  call for map averages scoping, keeping the existing monitor-summaries call
  for the actual per-monitor markers unchanged** (the spec only calls for
  switching *region* summary fetches from N-parallel to bulk — monitor
  summaries already use `getMonitorSummariesBulkMonthly`, unchanged):

```ts
async refreshMapAverages(): Promise<void> {
	const token = ++this.#activeRegionsFetchToken; // reuse or add a dedicated token per method — see note below
	if (!this.pollutant || !this.dateRange.start || !this.dateRange.end) return;

	const monitors = this.visibleMonitors;
	if (monitors.length === 0) {
		this.latest = new XMap();
		return;
	}

	const pollutant = this.pollutant;
	const averages = new Map<string, number>();

	const results = await getMonitorSummariesBulkMonthly({
		entryType: pollutant,
		start: this.dateRange.start,
		end: this.dateRange.end
	});

	for (const monitor of results) {
		const inRange = monitor.summaries.filter((row) => {
			const date = row.timestamp.slice(0, 10);
			return date >= this.dateRange.start && date <= this.dateRange.end;
		});
		if (inRange.length === 0) continue;

		const mean = inRange.reduce((sum, row) => sum + row.mean, 0) / inRange.length;
		averages.set(monitor.id, mean);
	}

	this.latest = buildMonitorsLatest(monitors, averages, pollutant, this.dateRange.end);
}
```

Use a **separate** fetch-token field per refresh method
(`#mapAveragesFetchToken`, `#calendarFetchToken`, `#regionFillFetchToken`,
distinct from `#activeRegionsFetchToken`) — they're independent in-flight
requests triggered by the same event (a region-type switch), and one
method's stale response shouldn't be gated by another method's counter.
Add all four as private fields alongside `#activeRegionsFetchToken`.

- [ ] **Step 3: Rewrite `refreshRegionFill` (was `refreshCountyFill`) using
  the bulk region-summaries endpoint instead of N parallel
  `getRegionSummariesMonthly` calls**:

```ts
async refreshRegionFill(): Promise<void> {
	const token = ++this.#regionFillFetchToken;
	if (!this.pollutant || !this.dateRange.start || !this.activeRegions) {
		this.regionFillColors = null;
		return;
	}

	const pollutant = this.pollutant;
	const monthKey = this.dateRange.start.slice(0, 7);
	const selectedIds = this.selectedRegionIds;
	const regions = selectedIds.size > 0
		? this.activeRegions.filter((region) => selectedIds.has(region.id))
		: this.activeRegions;

	if (regions.length === 0) {
		if (token === this.#regionFillFetchToken) this.regionFillColors = null;
		return;
	}

	const results = await getRegionSummariesBulkMonthly({
		entryType: pollutant,
		start: this.dateRange.start,
		end: this.dateRange.start,
		region: regions.map((r) => r.id)
	});

	if (token !== this.#regionFillFetchToken) return;

	const means = new Map<string, number>();
	for (const region of results) {
		const row = region.summaries.find((r) => r.timestamp.slice(0, 7) === monthKey);
		if (row) means.set(region.id, row.mean);
	}

	this.regionFillColors = buildCountyFillColors(means, this.levels);
}
```

- [ ] **Step 4: Rewrite `refreshCalendar`**, restoring the per-region grid
  pattern from the reverted commit `682d18f`
  (`countyCalendars: Array<{ county, days }>`), generalized to
  `regionCalendars` and driven by `selectedRegionIds` instead of "all
  counties, always":

```ts
async refreshCalendar(): Promise<void> {
	const token = ++this.#calendarFetchToken;
	if (!this.pollutant || !this.dateRange.start || !this.dateRange.end || !this.activeRegions) {
		this.calendarDays = null;
		this.regionCalendars = null;
		return;
	}

	const pollutant = this.pollutant;
	const year = Number(this.dateRange.start.slice(0, 4));
	const selectedRegions = this.activeRegions
		.filter((region) => this.selectedRegionIds.has(region.id))
		.sort((a, b) => a.name.localeCompare(b.name));

	if (selectedRegions.length === 0) {
		if (token === this.#calendarFetchToken) {
			this.calendarDays = null;
			this.regionCalendars = null;
		}
		return;
	}

	const results = await getRegionSummariesBulkDaily({
		entryType: pollutant,
		start: this.dateRange.start,
		end: this.dateRange.end,
		region: selectedRegions.map((r) => r.id)
	});

	if (token !== this.#calendarFetchToken) return;

	const daysByRegion = new Map<string, Map<string, number>>();
	for (const region of results) {
		const valuesByDate = new Map<string, number>();
		for (const row of region.summaries) {
			const date = row.timestamp.slice(0, 10);
			if (date < this.dateRange.start || date > this.dateRange.end) continue;
			valuesByDate.set(date, row.mean);
		}
		daysByRegion.set(region.id, valuesByDate);
	}

	this.calendarDays = null;
	this.regionCalendars = selectedRegions.map((region) => ({
		region,
		days: buildCalendarDays(
			this.dateRange.start,
			this.dateRange.end,
			daysByRegion.get(region.id) ?? new Map(),
			this.levels
		)
	}));
}
```

- [ ] **Step 5: Add region-type-switch handling**

```ts
async setRegionType(type: RegionType): Promise<void> {
	this.selectedRegionType = type;
	await this.refreshActiveRegions();
	await Promise.all([this.refreshMapAverages(), this.refreshCalendar(), this.refreshRegionFill()]);
}

toggleRegion(regionId: string): void {
	const current = this.regionSelections.get(this.selectedRegionType) ?? new Set<string>();
	const next = new Set(current);
	if (next.has(regionId)) {
		next.delete(regionId);
	} else {
		next.add(regionId);
	}
	this.regionSelections.set(this.selectedRegionType, next);
}

disableNarrowing(type: RegionType): void {
	this.narrowingEnabled.set(type, false);
}
```

- [ ] **Step 6: Typecheck and run the full unit suite**

```bash
npm run check
npm run test
```

Expected: `npm run test` PASS (no manager-level tests exist, but this must
not break Tasks 10–12's pure-logic tests). `npm run check` will still show
errors in `MonitorsTab.svelte` until Task 16 — confirm the error surface is
scoped there, not in `monitors-tab.svelte.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/monitors/monitors-tab.svelte.ts
git commit -m "Generalize refresh methods to bulk region-summaries, add fetch supersession"
```

---

### Task 16: Wire `MonitorsTab.svelte`

**Files:**
- Modify: `src/routes/MonitorsTab.svelte`

**Interfaces:**
- Consumes: everything from Tasks 10–15 (`RegionCheckboxList`,
  `encodeRegionType`/`decodeRegionType`/`encodeRegionSelection`/`decodeRegionSelection`,
  the rewritten manager).

- [ ] **Step 1: Replace the county `Select.Root` with a region-type dropdown
  + `RegionCheckboxList`**

```svelte
<script lang="ts">
	// ... existing imports ...
	import RegionCheckboxList from "$lib/components/RegionCheckboxList.svelte";
	import {
		decodeRegionSelection,
		decodeRegionType,
		encodeRegionSelection,
		encodeRegionType
	} from "$lib/url-state";

	// ... existing manager/mapIntegration setup unchanged ...

	async function handleRegionTypeChange(value: string | undefined) {
		if (!value) return;
		await manager.setRegionType(value as RegionType);
		searchParams.set("regionType", encodeRegionType(value), { replace: true });
		searchParams.set("regions", encodeRegionSelection(manager.selectedRegionIds), { replace: true });
	}

	async function handleRegionToggle(regionId: string) {
		manager.toggleRegion(regionId);
		searchParams.set("regions", encodeRegionSelection(manager.selectedRegionIds), { replace: true });
		await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar(), manager.refreshRegionFill()]);
	}

	function handleShowAll() {
		manager.disableNarrowing(manager.selectedRegionType);
		manager.refreshActiveRegions();
	}
</script>
```

- [ ] **Step 2: Update `onMount` to seed from `regionType`/`regions` URL
  params, defaulting to "county" + all counties per the spec's URL-state
  section**:

```ts
onMount(async () => {
	await manager.init();

	const urlYear = decodeYear(route.search.year);
	const urlMonth = decodeMonth(route.search.month);
	const urlPollutant = decodePollutant(route.search.pollutant);
	const urlRegionType = decodeRegionType(route.search.regionType);
	const urlRegions = decodeRegionSelection(route.search.regions);

	const defaults = currentYearMonth();
	const year = urlYear ?? defaults.year;
	const month = urlMonth ?? defaults.month;
	const pollutant = urlPollutant ?? "pm25";
	const regionType = (urlRegionType as RegionType) ?? "county";

	manager.dateRange = monthRange(year, month);
	manager.pollutant = pollutant;

	if (regionType !== manager.selectedRegionType) {
		manager.selectedRegionType = regionType;
		await manager.refreshActiveRegions();
	}
	if (urlRegions.size > 0) {
		manager.regionSelections.set(regionType, urlRegions);
	}
	// If `regions` was absent from the URL, manager.init() already seeded
	// "all counties selected" as the default for the county type.

	if (!urlYear) searchParams.set("year", encodeYear(year), { replace: true });
	if (!urlMonth) searchParams.set("month", encodeMonth(month), { replace: true });
	if (!urlPollutant) searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
	if (!urlRegionType) searchParams.set("regionType", encodeRegionType(regionType), { replace: true });

	await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar(), manager.refreshRegionFill()]);
});
```

- [ ] **Step 3: Replace the county-fill map effect's source/variable names**
  (`manager.counties` → `manager.activeRegions`, `manager.countyFillColors`
  → `manager.regionFillColors`, `COUNTY_FILL_*` constants can keep their
  names or be renamed to `REGION_FILL_*` — pick one and apply consistently,
  don't leave a mismatch between the layer ids and what they represent):

```ts
$effect(() => {
	if (!mapManager.map || !manager.activeRegions) return;

	if (!mapManager.map.getSource(REGION_FILL_SOURCE_ID)) {
		// ... same addSource/addLayer calls, ids renamed ...
	}

	const regions = manager.activeRegions;
	const colors = manager.regionFillColors;
	const entries = colors ? Array.from(colors.entries()) : [];
	const features = entries.flatMap(([regionId, color]) => {
		const region = regions.find((r) => r.id === regionId);
		if (!region?.boundary?.geometry) return [];
		return [
			{
				type: "Feature" as const,
				properties: { color },
				geometry: $state.snapshot(region.boundary.geometry)
			}
		];
	});

	mapManager.setDataSource(REGION_FILL_SOURCE_ID, features);
});
```

- [ ] **Step 4: Replace the fitBounds effect's `manager.counties` /
  `manager.selectedCountyId` references** with `manager.activeRegions` and
  `manager.selectedRegionIds` (fit to the union of *all selected* regions'
  bounds, not just one, since selection is now multi-valued):

```ts
$effect(() => {
	if (!mapManager.map || !manager.activeRegions) return;

	const selectedIds = manager.selectedRegionIds;
	const targetRegions = selectedIds.size > 0
		? manager.activeRegions.filter((r) => selectedIds.has(r.id))
		: manager.activeRegions;

	const allBounds = targetRegions
		.map((region) => region.boundary?.bbox)
		.filter((bbox) => bbox != null)
		.map(toBounds);
	const bounds = unionBounds(allBounds);
	if (bounds) {
		mapManager.map.fitBounds(bounds, { padding: 40 });
	}
});
```

- [ ] **Step 5: Replace the template's `Select.Root` county picker** with
  the region-type dropdown (grouped by category from `manager.regionTypes`,
  restricted to administrative/census/district) + `RegionCheckboxList` +
  the narrowing escape-hatch line:

```svelte
<Select.Root
	type="single"
	value={manager.selectedRegionType}
	onValueChange={handleRegionTypeChange}
>
	<Select.Trigger class="w-56">
		{manager.regionTypes?.type(manager.selectedRegionType)?.label ?? manager.selectedRegionType}
	</Select.Trigger>
	<Select.Content>
		{#each ["administrative", "census", "district"] as category (category)}
			<Select.Group>
				<Select.GroupHeading class="text-muted-foreground px-2 text-xs uppercase">
					{category}
				</Select.GroupHeading>
				{#each manager.regionTypes?.asIter.types.filter((t) => t.category === category) ?? [] as regionType (regionType.type)}
					<Select.Item value={regionType.type} label={regionType.label}>{regionType.label}</Select.Item>
				{/each}
			</Select.Group>
		{/each}
	</Select.Content>
</Select.Root>

{#if shouldNarrow(manager.regionSelections, manager.selectedRegionType, manager.narrowingEnabled)}
	{@const otherIds = unionOfOtherTypeSelections(manager.regionSelections, manager.selectedRegionType)}
	{@const otherNames = (manager.activeRegions ?? [])
		.filter((r) => otherIds.has(r.id))
		.map((r) => r.name)
		.join(", ")}
	<p class="text-muted-foreground text-sm">
		Showing regions within: {otherNames}
		<Button variant="link" size="sm" onclick={handleShowAll}>show all</Button>
	</p>
{/if}

<RegionCheckboxList
	regions={manager.activeRegions ?? []}
	selected={manager.selectedRegionIds}
	onToggle={handleRegionToggle}
/>
```

(`unionOfOtherTypeSelections`'s ids in the "Showing regions within" line
should resolve against *whichever type each id actually belongs to*, not
just `activeRegions` — since other types' selections may not be present in
the active type's region list. If this turns out to need each other type's
own region list to resolve names, track that as a follow-up rather than
scope-creeping this task; a reasonable v1 fallback is showing ids or a count
("2 regions") when names aren't resolvable from `activeRegions` alone.)

- [ ] **Step 6: Replace the calendar block at the bottom of the template**
  to render `regionCalendars` (one block per toggled region) alongside the
  existing single-region case, or entirely replace the single-calendar
  render with the per-region grid now that `regionCalendars` covers both
  "one selected" and "many selected" uniformly:

```svelte
{#if manager.regionCalendars}
	<div class="flex flex-row flex-wrap gap-6">
		{#each manager.regionCalendars as { region, days } (region.id)}
			<div>
				<h3 class="mb-1 text-sm font-medium">{region.name}</h3>
				<Calendar {days} />
			</div>
		{/each}
	</div>
{/if}
```

- [ ] **Step 7: Typecheck**

```bash
cd ~/workspace/sjvair/data-dashboard
npm run check
```

Expected: PASS — no remaining references to `manager.counties`,
`manager.selectedCountyId`, `manager.countyFillColors`, or `countyMatches`
anywhere in this file.

- [ ] **Step 8: Lint and format**

```bash
npm run format
npm run lint
```

Expected: PASS (or auto-fixed by `format`).

- [ ] **Step 9: Run the full test suite**

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 10: Manual browser verification**

```bash
npm run dev
```

Using the `run` skill's launch pattern for this project, open the Monitors
tab and verify, at minimum:
- Default load shows "county" type with all counties selected (matches
  today's default exactly, per spec).
- Switching region type (e.g. to "tract") shows the narrowing line if
  counties are still selected, and the tract checkbox list is scoped to
  those counties' union; "show all" clears narrowing for tracts only.
- Toggling regions updates the map fill, the calendar grid (one block per
  toggled region), and which monitor markers render.
- The `>10` items filter input appears for tract/zipcode-scale lists and
  narrows the checkbox list without breaking already-checked items outside
  the filtered view.
- URL round-trips: reload the page with `?regionType=tract&regions=id1,id2`
  in the address bar and confirm the same state re-renders.
- Switching region type rapidly (double-click through a few types) doesn't
  show a flash of the wrong type's regions (fetch supersession from Task 15
  actually works).

- [ ] **Step 11: Commit**

```bash
git add src/routes/MonitorsTab.svelte
git commit -m "Wire multi-region selector UI into MonitorsTab"
```

- [ ] **Step 12: Push and open a PR**

```bash
git push -u origin feature/multi-region-selector
gh pr create --title "Multi-region selector for the Monitors tab" --body "Implements the frontend UI atoms + integration tracks of the multi-region-selector design spec, replacing the single-county dropdown with a region-type selector and multi-select checkbox list across 7 region types."
```

Note in the PR description that it depends on the `sjvair.com` and `sdk-js`
PRs from the Backend/SDK tracks above, and (if built against the temporary
vite alias) that `package.json`'s `@sjvair/sdk` version needs bumping to the
real published version before merge, with the alias removed.

---

## Self-Review Notes

- **Spec coverage:** B1 (Task 1), B2 (Task 2), B3 (Tasks 3–4), SDK meta/within/bulk/refactor
  (Tasks 5–8), version bump (Task 9), URL codecs (Task 10), point-in-polygon
  (Task 11), narrowing logic (Task 12), checkbox list (Task 13), manager
  rewrite (Tasks 14–15), template wiring + manual verification (Task 16) —
  every named spec section maps to at least one task. Error-handling edge
  cases (empty selection, zero-result narrowing, backend 400s, null
  boundary, mid-fetch type switch) are covered respectively by: `visibleMonitors`'s
  size-0 guard (Task 14), the "show all" escape hatch (Task 12 + Task 16
  Step 5), Task 4's 400 responses, `monitorInRegions`'s null-boundary skip
  (Task 11) and the map-fill effect's existing `!region?.boundary?.geometry`
  guard (Task 16 Step 3), and the fetch-token supersession pattern (Task 15).
- **Testing section coverage:** every bullet in the spec's Testing section
  has a corresponding task-level test step above (backend unit tests in
  Tasks 2/4, SDK unit tests in Tasks 5/6/7/8, frontend pure-logic tests in
  Tasks 10/11/12, manager verified manually per the spec's explicit
  no-test-precedent call-out in Task 16).
- **Known follow-up, not a gap in this plan**: Task 16 Step 5 flags that
  resolving *other* types' region names for the "Showing regions within:"
  line may need those types' own region lists fetched, not just
  `activeRegions` — left as an explicit in-task fallback (show ids/count)
  rather than expanded scope, since the spec doesn't pin this UI copy's
  exact resolution mechanism.
