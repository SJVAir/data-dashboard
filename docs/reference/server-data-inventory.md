# SJVAir server data inventory

Snapshot taken 2026-09-23 from a read-only survey of `sjvair.com` (`camp/`), `sdk-js`, and
`monitor-map`. It supports IDEA.md Open Questions #6 (analysis) and #7 (metadata).
Re-verify against the code before relying on a detail: this is a point-in-time reference.
**Updated 2026-10-13** after sjvair.com PRs #246 (notifications redesign) and #275
(Pesticides Data Explorer) merged; see "Changes as of 2026-10-13" at the end.

Abbreviations: S = `sjvair.com/camp`, MM = `monitor-map/src/lib`. All API URLs sit under
`/api/2.0/`.

## Datasets

| Domain                  | Resolution                                                                                                                            | Geography                               | Endpoints                                                     | SDK     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- | ------- |
| Monitors + entries      | Raw at 1 min (AirGradient) to 1 h (AirNow/AQview/BAM/CIMIS)                                                                           | Point                                   | `monitors/`, `monitors/<id>/entries/<type>/` (+`/csv/`)       | Yes     |
| Summaries               | hour/day/month/quarter/season/year; count, mean, min, max, stddev, p25, p75, t-digest. **Only pm25, o3, no2, so2, co** are summarized | Monitor or region                       | `monitors\|regions/<id>/summaries/<type>/<res>/…`, bulk forms | Yes     |
| Monthly CSV archive     | Monthly files                                                                                                                         | Monitor                                 | `monitors/<id>/archive/…`                                     | Yes     |
| HMS smoke               | Daily polygons, density light/medium/heavy                                                                                            | MultiPolygon (region-clipped)           | `hms/smoke/`                                                  | Yes     |
| HMS fire                | Detections with FRP                                                                                                                   | Point                                   | `hms/fire/`                                                   | Yes     |
| Weather                 | CIMIS station entry types only (hourly: temperature, humidity, wind, precipitation, solar, ETo…). No gridded weather on the server    | Station point                           | Same as monitors                                              | Yes     |
| Pesticides (CDPR PUR)   | `year` + nullable `application_date`; lbs, acres, aerial/ground; chemical × commodity × product                                       | County, MTRS section                    | `pesticides/*` (13 routes at the time; 21 as of 2026-10-13)   | Yes     |
| Pesticide notices       | Daily SprayDays notices, 8 SJV counties                                                                                               | Point, MTRS                             | `pesticides/*`                                                | Yes     |
| Collocation/calibration | Periodic fits (r2, rmse, mae, formula)                                                                                                | Monitor pairs                           | `calibrations/`                                               | Yes     |
| QA/QC health checks     | Hourly score 0–3                                                                                                                      | Monitor                                 | Not standalone (uncertain)                                    | Partial |
| CalEnviroScreen 4/5     | Static indicators incl. asthma, CVD, low birth weight percentiles; SB535 DAC                                                          | Census tract                            | `calenviroscreen/4.0\|5.0/`                                   | **No**  |
| CalHeatScore            | Daily 0–4                                                                                                                             | ZIP                                     | `calheatscore/`                                               | **No**  |
| CEIDARS emissions       | Yearly facility emissions + health risk indices (now under `emissions/`; see the end)                                                 | Facility point                          | `ceidars/`, `ceidars/years/`                                  | **No**  |
| AQ forecasts            | Daily AQI category, pollutant, burn status, air alert window                                                                          | Forecast zone (county or custom region) | `forecasts/`                                                  | **No**  |
| TEMPO satellite         | Hourly rasters: no2, o3tot, hcho, cldo4                                                                                               | SJV raster                              | `tempo/…` (point, region queries)                             | **No**  |

Not on the server: EV stations (monitor-map calls NREL directly), the wind layer (MapTiler
weather SDK), and map temperature (api.weather.gov).

**Health data:** the server holds **no** ER visit, hospitalization, or incidence data. The
only health-related values are CalEnviroScreen's static tract-level indicators and CEIDARS
facility health risk indices.

**Pesticide summaries:** the region summary endpoint aggregates by chemical × commodity ×
**year only**. Anything finer needs `application_date`, which is nullable.

**Time coverage:** unknown from the code. Query the API to establish it.

## Regions

Local dev (2026-09-28) had 0 rows of `protected`, `custom` and `school_district`; verify
production. Types (2026-10-13): county, city, zipcode, tract, cdp, congressional_district,
state_assembly, state_senate, school_district, air_district, urban_area, land_use,
protected, ab617, mtrs, custom (3 of the 9 forecast zones; the other 6 zones are county
regions). The `place` type was removed. Boundaries are versioned MultiPolygons.

Region summaries are recomputed hourly for every region that contains at least one monitor,
from monitors' hourly summaries. Calibrated summaries are preferred. The mean is weighted:
FEM/FRM = 3.0; LCS = 1.0 × health score / 3. `station_count` and `weight` are stored.
Coarser resolutions roll up from finer ones by cron. Monthly and longer rollups exist only
after the period ends.

**Place endpoints** (added 2026-09-28; the original survey missed them). All are wrapped by the SDK:

- `regions/places/search/?q=&type=`: name search, high-confidence matches ranked by
  similarity (`searchRegionPlaces`).
- `regions/places/lookup/?q=&type=`: a name resolved to the single best region; without
  `type`, it tries city, then CDP, then urban area (`lookupRegionPlace`).
- `regions/?within=<id>&type=`: children inside a parent region (excludes border-touching
  and sliver overlaps).
- There is **no lookup by coordinates or monitor** yet; extending `places/lookup/` is
  planned.

## Alerts

Rewritten 2026-10-13 for the redesign merged in sjvair.com PR #246.

- `Subscription(user, monitor, level)`: the threshold is an AQ **level category**, and
  subscriptions are **per monitor only**. New fields: `last_notified_level`,
  `last_notified_at`, `below_threshold_since`. A `good` subscription behaves as
  `moderate`.
- `Alert` and `AlertUpdate` use integer keys plus a `sqid`; one open alert per monitor and
  entry type. A new **`Notification`** model logs every delivery (kind alert or reminder,
  level, status, message, provider id). There is no `channel` field.
- `periodic_alerts` runs every 10 minutes and uses **one trailing 60-minute average** (at
  least 50% coverage) to create, escalate, and de-escalate; feeds of 1 h or longer use the
  latest reading. An alert opens at Moderate or above and closes at Good after 60 minutes.
- **Texts go out only on escalation** (at or above the subscriber's threshold and above
  the last level texted). Nothing is sent when air improves; there is no all-clear.
  Throttles: one text per 2 hours and three per Pacific day per subscription, bypassed by
  a jump of two or more levels; re-arms after 2 hours below the threshold. A daily 10 AM
  "still bad" reminder exists. The worst pollutant drives the text.
- Only entry types with an `alerts` config are evaluated: PM2.5 on most monitors, O3 on
  AirNow/AQLite.
- The only channel is **SMS**, sent in the user's language, and only to users with the
  **`sms_alerts` waffle flag** (plus `SEND_SMS_ALERTS`). STOP/START are handled
  (`User.sms_blocked`). There is no email or push.
- Endpoints (same paths): `alerts/subscriptions/`,
  `monitors/<id>/alerts/subscribe|unsubscribe/`, `account/alerts/`, `account/phone/…`.
  **`account/alerts/` now returns `sqid` and no longer returns `id` or `latest`**, which
  `@sjvair/sdk` 4.5.0's schema and the mobile Alerts screen still expect.

## Metadata endpoints

| URL                                                 | Returns                                                                                                                                                                                            | SDK |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `monitors/meta/`                                    | Default pollutant; per monitor type: label, interval, entries (sensors, stages, calibration, processors); per entry type: label, units, AQS code, **levels** (name, label, color, range, guidance) | Yes |
| `regions/meta/`                                     | Region types, labels, categories                                                                                                                                                                   | Yes |
| `pesticides/chemicals\|commodities\|products/`      | Lookup tables                                                                                                                                                                                      | Yes |
| `ceidars/years/` (now `emissions/years/`), `tempo/` | Available years, TEMPO products                                                                                                                                                                    | No  |

`monitors/meta/` does not expose: the EPA AQI 0–500 level set, stage choices, CalHeatScore
labels, smoke density values, or pesticide category/IARC choices.

### Known hardcoded duplicates (candidates to replace with metadata)

- **Server**
  - Breakpoints appear in both `entries/levels.py` and inline in each entry class.
  - `utils/aqi.py` labels, `Subscription.LEVELS` (legacy), and the colors in
    `assets/sass/sjvair/variables.sass`.
  - Guideline templates hardcode PM2.5 ranges, including **55.5–125.4**, which conflicts with
    the 150.4 in `levels.py`.
  - `generate_group_map.py` has its own colors and ranges.
- **monitor-map**
  - AQ palette in `colors.ts`, the legend gradient, and the 150.5 fallback in the cluster
    renderer.
  - Temperature thresholds (65/78/95 °F) and the hardcoded "µg/m³" in a tooltip.
  - Smoke density colors, and the fire FRP tiers and colors.
- **data-dashboard**
  - Pollutants are restricted to `"pm25" | "o3"` (`url-state.ts`, `monitor-latest.ts`,
    `MonitorsTab.svelte`).
  - `NO_VALUE_BORDER_COLOR`.
- **sdk-js docs:** `api-urls.md` lists stale `/hms-smoke/` paths and omits `regions/meta/`
  and bulk region summaries.

## Confirmed issue: PM2.5 breakpoints (2026-09-23)

`camp/apps/entries/levels.py` `PM25` = GOOD 0.0, MODERATE 9.1, USG 35.5, UNHEALTHY 55.5,
**VERY_UNHEALTHY 150.5, HAZARDOUS 250.5**. The first boundaries follow EPA's 2024 revision
but the top two are pre-2024 values (2024: 125.5 / 225.5). The guideline templates'
55.5–125.4 range is the correct one. Tracked as an urgent standalone fix in `TODO.md`.

## Changes as of 2026-10-13

From a re-survey of sjvair.com `origin/main` (`560e01c3`), monitor-map 4.2.0, the mobile
app 4.0.5, and sdk-js 4.5.0.

- **Merged:** #246 (notifications redesign; see "Alerts") and #275 (Pesticides Data
  Explorer). **Merged 2026-10-13 (after this survey):** #282 (Facility Emissions Explorer).
  The API moved from `ceidars/` to `/api/2.0/emissions/…` (years, areas, places,
  districts, facility GeoJSON and detail, dairies, wells, schools, and Carbon Mapper
  methane sources and plumes); the `ceidars` app remains installed for its data. **Still
  open:** #261 (legacy-entries backfill).
- **Regions:** new `Location` model (public school, private school, child care; a point
  with links to county, city, ZIP, school district); new types `air_district` and `ab617`;
  `place` removed; `regions/geojson/?type=` (with `simplify=1`); `regions/<id>/?buffer=1|3|5`;
  the `regions/` list returns `bbox` only (no boundary geometry). Tracts are 2020-only.
- **Pesticides:** 21 API routes. New: `townships/`, `sections/` (bbox, or
  `lat,lng,radius` of 1/3/5 mi, or `region` + `buffer`) and `sections/<id>/`, `locations/`
  (bbox, region + buffer, or radius up to 10 mi), `notices/active/` and `notices/archive/`
  (GeoJSON; bbox or region + buffer), and `search/`; a `narrow=` filter (concern,
  restricted, fumigant, aerial). New models include `FumigationMethod` and monthly
  `PesticideUseRollup`. `region/<id>/summary/` is still chemical × commodity × year. The
  web UI at `/tools/pesticides/` is gated by the waffle `beta_tools` flag; the APIs are not.
- **Unchanged:** PM2.5 breakpoints (`levels.py` still 150.5/250.5); `monitors/meta/` (note
  its existing per-monitor-type `published` flag); `regions/meta/` (types only);
  summarized entry types (pm25, o3, no2, so2, co) with no cache headers; accounts (phone
  required and the username field, no email verification, token login only; new
  `sms_blocked`); resticus installed from `@develop` unpinned; CORS allow-all with
  credentials; no CSRF cookie handling or CSP; GTM/GA in `base.html`; the monitor-map
  import script (clones `main` unpinned, so it builds 4.2.0); forecasts (6 county + 3
  custom zones; the 3 custom are missing on production, see below), CalHeatScore, and TEMPO.
- **Translations:** locale catalogs exist for es, tl, and hmn (395 entries each), all
  untranslated.
- **SDK gaps** (`@sjvair/sdk` 4.5.0 has no wrapper): `forecasts/`, `calheatscore/`,
  `calenviroscreen/`, `emissions/` (was `ceidars/`), `tempo/`; pesticide `townships/`, `sections/`,
  `locations/`, `notices/active|archive/`, `search/`; `regions/geojson/` and the `buffer`
  parameter. No data function exposes `init` or `signal`; only `getSubscriptions` takes an
  optional token.
- **monitor-map 4.2.0:** still one map per page (singleton `mapManager`, integrations,
  click and tooltip managers; config from `import.meta.env`). Still hardcoded: the `150.5`
  fallback, "µg/m³", smoke and fire colors. Improved: the legend gradient comes from
  metadata levels. No license file yet.
- **Mobile app (`../mobile`, sjvair-mobile 4.0.5):** token auth only; no push (local
  notifications only); no i18n; hardcodes the old PM2.5 scale in `PMGauge.svelte`,
  `colors.ts`, and `AirQualityGuidelines.svelte`.
- **Production checks (2026-10-14, public API):** regions by type: 201 school districts, 8
  counties, 62 cities, 237 ZIP codes, 2 air districts, 4 AB 617 communities, and **0
  `custom`** (so the 3 non-county forecast zones are missing). `forecasts/` returns only the
  6 county zones. Schools are loaded (685 `Location` rows in a Fresno-area bounding box).
  The region list returns `id` (sqid), `name`, `slug`, `type`, and `boundary` (with `bbox`),
  not `external_id`.
- **`account/alerts/` `latest` (traced 2026-10-14):** it was the `Alert.latest` foreign key
  serialized as the `AlertUpdate` primary key, never a reading; see `TODO.md`.
