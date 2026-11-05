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
