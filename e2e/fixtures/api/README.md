# API fixtures

Responses for `/api/…` requests in E2E tests (`e2e/fixtures.ts`): a request to
`/api/<path>/` is answered with `<path>.json` from this folder (the query string is ignored),
and any API request without a file here fails the test.

The session account (`2.0/account/`) and the documents endpoints (`2.0/documents/…`) aren't
files: `e2e/fixtures.ts` serves them (the documents from an in-memory fake server, see
`e2e/documents-server.ts`).

The summaries endpoints (`2.0/{regions,monitors}/<entry type>/summaries/{hourly,daily}/`) aren't
files either: `e2e/summaries-server.ts` answers them from the query (a row for each period in the
requested dates that has begun), since the Chart asks for whole months around today. The other
files here are trimmed from `@sjvair/sdk`'s own fixtures (`sdk-js/lib/*/fixtures/`): the
dataset catalog and monitors meta to PM2.5, and the regions lookup to Fresno County.

The place picker's endpoints whose answer depends on the query are answered by
`e2e/places-server.ts`, still from files here: the searches
(`2.0/regions/{places,locations}/search/`) from the file named after the query
(`…/search/fre.json`, none: nothing found), and the region list (`2.0/regions/`) from
`regions.json`, or `regions/within/<parent id>.json` for `?within=`, narrowed to the `type` and
`external_id` asked for. The place files (`regions.json`, `regions/…`, `monitors.json`) are
trimmed from the local sjvair.com stack (`develop`, 2026-11-04): Fresno, Madera and Tulare
counties with a few of their cities and ZIPs, the "fre" and "roo" searches, Roosevelt High's
location, three monitors, and the point lookup, which answers ZIP 93721 for any point.

The forecasts files come from the local stack too (`develop`, 2026-11-05): the catalog's
`forecasts` dataset in `2.0/meta/datasets.json`, `2.0/forecasts/meta.json` (the real scales,
zones trimmed to Fresno and Madera), and `2.0/forecasts/place.json`, Fresno County's real answer
for 2026-10-20 to 2026-11-06. `e2e/forecasts-server.ts` answers `2.0/forecasts/place/` for any
place from that file, its rows re-dated to one forecast per requested day (up to tomorrow), since
widgets ask for days around today.

The Get data layers' files come from `sdk-js`'s own fixtures (`lib/*/fixtures/`): the nearest
weather stations of Fresno County (`2.0/monitors/weather/place.json`), the pesticide meta, the
chemical search and Fresno County's pesticide use (`2.0/pesticides/…`; the months cover
2025–2027 so the default last 30 days has data), Sulfur's details
(`2.0/pesticides/chemicals/gs65e.json`, written by hand), a pesticide coverage that reaches 2030
(`2.0/meta/coverage.json`), and the smoke meta and days (`2.0/hms/…`, not in the catalog yet).
A weather station's own summaries
(`2.0/monitors/<id>/summaries/<entry>/{daily,hourly}/<year>/<month>[/<day>]/`) are answered by
`e2e/summaries-server.ts` like the bulk ones.

The Map's readings: `2.0/monitors/<type>/current.json` is the whole Valley's list (`o3` written
from the `pm25` file: the three AirNow monitors, with made-up ozone readings), and the
region-scoped `2.0/monitors/<type>/at/?region=` is answered by `e2e/map-data-server.ts` from that
file, keeping the monitors in the regions asked for (Fresno County's two, Tulare County's
Porterville, and Drummond Street for the city of Fresno and ZIP 93721). Today's smoke and fire
(`2.0/hms/smoke.json`, `2.0/hms/fire.json`) are written by hand: one light plume over Fresno and
two fire detections close together in the Sierra. Ozone and the smoke and fire datasets aren't in
the catalog or monitors meta files here (other specs' Get data offers only PM2.5);
`routeMapMeta` adds them for the Map specs from `../map-meta.json` (trimmed from `sdk-js`'s
dataset catalog and monitors meta fixtures).
