# SJVAir server data inventory

Snapshot taken 2026-09-23 from a read-only survey of `sjvair.com` (`camp/`), `sdk-js`, and
`monitor-map`. It supports IDEA.md Open Questions #6 (analysis) and #7 (metadata).
Re-verify against the code before relying on a detail: this is a point-in-time reference.

Abbreviations: S = `sjvair.com/camp`, MM = `monitor-map/src/lib`. All API URLs sit under
`/api/2.0/`.

## Datasets

| Domain                  | Resolution                                                                                                                            | Geography                     | Endpoints                                                     | SDK     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- | ------- |
| Monitors + entries      | Raw at 1 min (AirGradient) to 1 h (AirNow/AQview/BAM/CIMIS)                                                                           | Point                         | `monitors/`, `monitors/<id>/entries/<type>/` (+`/csv/`)       | Yes     |
| Summaries               | hour/day/month/quarter/season/year; count, mean, min, max, stddev, p25, p75, t-digest. **Only pm25, o3, no2, so2, co** are summarized | Monitor or region             | `monitors\|regions/<id>/summaries/<type>/<res>/…`, bulk forms | Yes     |
| Monthly CSV archive     | Monthly files                                                                                                                         | Monitor                       | `monitors/<id>/archive/…`                                     | Yes     |
| HMS smoke               | Daily polygons, density light/medium/heavy                                                                                            | MultiPolygon (region-clipped) | `hms/smoke/`                                                  | Yes     |
| HMS fire                | Detections with FRP                                                                                                                   | Point                         | `hms/fire/`                                                   | Yes     |
| Weather                 | CIMIS station entry types only (hourly: temperature, humidity, wind, precipitation, solar, ETo…). No gridded weather on the server    | Station point                 | Same as monitors                                              | Yes     |
| Pesticides (CDPR PUR)   | `year` + nullable `application_date`; lbs, acres, aerial/ground; chemical × commodity × product                                       | County, MTRS section          | `pesticides/*` (13 routes)                                    | Yes     |
| Pesticide notices       | Daily SprayDays notices, 8 SJV counties                                                                                               | Point, MTRS                   | `pesticides/*`                                                | Yes     |
| Collocation/calibration | Periodic fits (r2, rmse, mae, formula)                                                                                                | Monitor pairs                 | `calibrations/`                                               | Yes     |
| QA/QC health checks     | Hourly score 0–3                                                                                                                      | Monitor                       | Not standalone (uncertain)                                    | Partial |
| CalEnviroScreen 4/5     | Static indicators incl. asthma, CVD, low birth weight percentiles; SB535 DAC                                                          | Census tract                  | `calenviroscreen/4.0\|5.0/`                                   | **No**  |
| CalHeatScore            | Daily 0–4                                                                                                                             | ZIP                           | `calheatscore/`                                               | **No**  |
| CEIDARS emissions       | Yearly facility emissions + health risk indices                                                                                       | Facility point                | `ceidars/`, `ceidars/years/`                                  | **No**  |
| AQ forecasts            | Daily AQI category, pollutant, burn status, air alert window                                                                          | Forecast zone (custom region) | `forecasts/`                                                  | **No**  |
| TEMPO satellite         | Hourly rasters: no2, o3tot, hcho, cldo4                                                                                               | SJV raster                    | `tempo/…` (point, region queries)                             | **No**  |

Not on the server: EV stations (monitor-map calls NREL directly), the wind layer (MapTiler
weather SDK), and map temperature (api.weather.gov).

**Health data:** the server holds **no** ER visit, hospitalization, or incidence data. The
only health-related values are CalEnviroScreen's static tract-level indicators and CEIDARS
facility health risk indices.

**Pesticide summaries:** the region summary endpoint aggregates by chemical × commodity ×
**year only**. Anything finer needs `application_date`, which is nullable.

**Time coverage:** unknown from the code. Query the API to establish it.

## Regions

Types: county, city, zipcode, tract, cdp, congressional_district, state_assembly,
state_senate, school_district, urban_area, land_use, protected, place (a synthetic union),
mtrs, custom (forecast zones). Boundaries are versioned MultiPolygons.

Region summaries are recomputed hourly for every region that contains at least one monitor,
from monitors' hourly summaries. Calibrated summaries are preferred. The mean is weighted:
FEM/FRM = 3.0; LCS = 1.0 × health score / 3. `station_count` and `weight` are stored.
Coarser resolutions roll up from finer ones by cron. Monthly and longer rollups exist only
after the period ends.

**Place endpoints** (added 2026-09-28; the original survey missed them). All are wrapped by the SDK:

- `regions/places/search/?q=&type=`: name search, high-confidence matches ranked by
  similarity (`searchRegionPlaces`).
- `regions/places/lookup/?q=&type=`: a name resolved to the single best region; without
  `type`, the containing "place" via City/CDP fallback (`lookupRegionPlace`).
- `regions/?within=<id>&type=`: children inside a parent region (excludes border-touching
  and sliver overlaps).
- There is **no lookup by coordinates or monitor** yet; extending `places/lookup/` is
  planned.

## Alerts

- `Subscription(user, monitor, level)`. The threshold is an AQ **level category**, not a
  number, and subscriptions are **per monitor only** (no region alerts).
- `periodic_alerts` runs every 10 minutes. It uses a 30-minute average to create an alert and
  a 60-minute average to update it (the latest value for hourly monitors). An alert opens at
  Moderate or above and ends when the reading returns to Good for at least 60 minutes.
- Every level change while not Good sends an update to subscribers whose threshold is ≤
  the new level. The final ✅ "Good" update therefore only reaches Good-level
  subscribers, and dropping below a subscriber's threshold is silent (verified
  2026-09-28).
- Only entry types with an `alerts` config are evaluated: PM2.5 on most monitors, O3 on
  AirNow/AQLite.
- The only channel is **SMS** to a verified phone. There is no email or push.
- Endpoints: `alerts/subscriptions/`, `monitors/<id>/alerts/subscribe|unsubscribe/`,
  `account/alerts/`, `account/phone/…`. All are login-only and all are wrapped by the SDK.

## Metadata endpoints

| URL                                            | Returns                                                                                                                                                                                            | SDK |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `monitors/meta/`                               | Default pollutant; per monitor type: label, interval, entries (sensors, stages, calibration, processors); per entry type: label, units, AQS code, **levels** (name, label, color, range, guidance) | Yes |
| `regions/meta/`                                | Region types, labels, categories                                                                                                                                                                   | Yes |
| `pesticides/chemicals\|commodities\|products/` | Lookup tables                                                                                                                                                                                      | Yes |
| `ceidars/years/`, `tempo/`                     | Available years, TEMPO products                                                                                                                                                                    | No  |

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
