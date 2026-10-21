# API fixtures

Responses for `/api/…` requests in E2E tests (`e2e/fixtures.ts`): a request to
`/api/<path>/` is answered with `<path>.json` from this folder (the query string is ignored),
and any API request without a file here fails the test. Spec 1 makes no API calls, so there are
none yet.
