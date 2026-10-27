import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";
import type { AccountUser } from "../src/lib/account/identity";

const API_FIXTURES = fileURLToPath(new URL("./fixtures/api/", import.meta.url));

/** A CSP violation, as the page saw it. */
export type CspViolation = { directive: string; blockedURI: string; sourceFile: string };

/** The mocked account server: change who it says is signed in. */
export type AccountServer = { set(user: AccountUser | null): void };

/**
 * `test` with API fixture routing and CSP checking. The preview server sends the contract CSP
 * (`csp-hosts.json`), and any `securitypolicyviolation` in the test's context fails the test.
 * API fixture routing: every request to `/api/…` is answered from
 * `e2e/fixtures/api/<path after /api/, trailing slash dropped>.json` (query ignored), and a
 * request with no fixture file fails the test. The account server answers the session account
 * (`api/2.0/account/`: 401 signed out, or the `account` option's user) and the site's logout,
 * which signs out. Specs import `test` and `expect` from here.
 */
export const test = base.extend<{
	account: AccountUser | null;
	apiFixtures: void;
	accountServer: AccountServer;
	cspViolations: CspViolation[];
}>({
	account: [null, { option: true }],
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
	],
	// Depends on apiFixtures so its routes are registered last and take precedence.
	accountServer: [
		async ({ context, account, apiFixtures }, use) => {
			void apiFixtures;
			let user = account;
			await context.route("**/api/2.0/account/", async (route) => {
				if (route.request().method() !== "GET") return route.fallback();
				if (user) {
					await route.fulfill({ json: { data: user } });
				} else {
					await route.fulfill({
						status: 401,
						json: { detail: "Authentication credentials were not provided." }
					});
				}
			});
			await context.route("**/account/logout/", async (route) => {
				if (route.request().method() !== "POST") return route.fallback();
				user = null;
				await route.fulfill({ status: 200, body: "" });
			});
			await use({
				set(next) {
					user = next;
				}
			});
		},
		{ auto: true }
	]
});

export { expect };
