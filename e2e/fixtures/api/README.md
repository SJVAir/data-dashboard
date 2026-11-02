# API fixtures

Responses for `/api/…` requests in E2E tests (`e2e/fixtures.ts`): a request to
`/api/<path>/` is answered with `<path>.json` from this folder (the query string is ignored),
and any API request without a file here fails the test.

The session account (`2.0/account/`) and the documents endpoints (`2.0/documents/…`) aren't
files: `e2e/fixtures.ts` serves them (the documents from an in-memory fake server, see
`e2e/documents-server.ts`).
