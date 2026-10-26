import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";

const API_FIXTURES = fileURLToPath(new URL("./fixtures/api/", import.meta.url));

/** A CSP violation, as the page saw it. */
export type CspViolation = { directive: string; blockedURI: string; sourceFile: string };

/**
 * `test` with API fixture routing and CSP checking. The preview server sends the contract CSP
 * (`csp-hosts.json`), and any `securitypolicyviolation` in the test's context fails the test.
 * API fixture routing: every request to `/api/…` is answered from
 * `e2e/fixtures/api/<path after /api/, trailing slash dropped>.json` (query ignored), and a
 * request with no fixture file fails the test. Specs import `test` and `expect` from here.
 */
export const test = base.extend<{ apiFixtures: void; cspViolations: CspViolation[] }>({
	cspViolations: [
		async ({ context }, use) => {
			const violations: CspViolation[] = [];
			await context.exposeBinding("__reportCspViolation", (_source, v: CspViolation) => {
				violations.push(v);
			});
			await context.addInitScript(() => {
				document.addEventListener("securitypolicyviolation", (event) => {
					const report = (window as unknown as Record<string, (v: unknown) => void>)
						.__reportCspViolation;
					report({
						directive: event.effectiveDirective,
						blockedURI: event.blockedURI,
						sourceFile: event.sourceFile
					});
				});
			});
			await use(violations);
			expect(violations, "CSP violations").toEqual([]);
		},
		{ auto: true }
	],
	apiFixtures: [
		async ({ context }, use) => {
			const unmatched: string[] = [];
			await context.route("**/api/**", async (route) => {
				const url = new URL(route.request().url());
				const rest = url.pathname.slice(url.pathname.indexOf("/api/") + "/api/".length);
				const file = API_FIXTURES + rest.replace(/\/$/, "") + ".json";
				try {
					const body = await readFile(file, "utf8");
					await route.fulfill({ contentType: "application/json", body });
				} catch {
					unmatched.push(`${route.request().method()} ${url.pathname}${url.search}`);
					await route.abort();
				}
			});
			await use();
			expect(unmatched, "API requests with no fixture file").toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };
