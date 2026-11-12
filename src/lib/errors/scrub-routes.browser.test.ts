import { expect, test } from "vitest";
import { BASE } from "$lib/routing";
import { ROUTE_KEYS } from "../../router";
import { routePattern } from "./scrub";

// Browser mode because the router needs `location`.
test("routePattern covers every router route", () => {
	for (const key of ROUTE_KEYS) {
		expect(routePattern(BASE + key.replace(/:\w+/g, "abc"))).toBe(key);
	}
});
