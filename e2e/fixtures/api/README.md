# API fixtures

Responses for `/api/…` requests in E2E tests (`e2e/fixtures.ts`): a request to
`/api/<path>/` is answered with `<path>.json` from this folder (the query string is ignored),
and any API request without a file here fails the test.

- `2.0/documents.json`: the signed-in sync worker's poll (an empty account), so specs that sign
  in without testing sync see a quiet server.
