import { expect, test } from "vitest";
import { WALK_ROUTES } from "../e2e/csp-walk-routes";
import { ROUTE_KEYS } from "./router";

// Browser mode because the router needs `location`. A new route fails here until the CSP walk
// (`e2e/csp-walk.ts`) names it, so no route skips the check.
test("the CSP walk names every router route", () => {
	expect([...WALK_ROUTES].sort()).toEqual([...ROUTE_KEYS].sort());
});
