import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	expect,
	test as base,
	type BrowserContext,
	type BrowserContextOptions,
	type Page
} from "@playwright/test";
import type { AccountUser } from "../src/lib/account/identity";
import { createFakeRemote, type FakeRemote } from "../src/lib/sync/remote-fake";
import { CSRF_TOKEN, routeDocuments } from "./documents-server";
import { routeForecasts } from "./forecasts-server";
import { routePlaces } from "./places-server";
import { routeSummaries } from "./summaries-server";

const API_FIXTURES = fileURLToPath(new URL("./fixtures/api/", import.meta.url));

/** A CSP violation, as the page saw it. */
export type CspViolation = { directive: string; blockedURI: string; sourceFile: string };

/** The mocked account server of one context: change who it says is signed in. */
export type AccountServer = { set(user: AccountUser | null): void; get(): AccountUser | null };

/** Another device: its own context (storage, session, connection) on the same servers. */
export type Device = { context: BrowserContext; page: Page; account: AccountServer };

/** The mocked documents server, shared by every context in the test. */
export type DocumentsServer = {
	fake: FakeRemote;
	/** A second device, signed in as the test's `account` (closed after the test). */
	newDevice(): Promise<Device>;
};

/** Reports CSP violations in `context`'s pages into `violations`. */
async function watchCsp(context: BrowserContext, violations: CspViolation[]): Promise<void> {
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
}

/** Answers `/api/…` from the fixture files, recording requests with none in `unmatched`. */
async function routeApiFixtures(context: BrowserContext, unmatched: string[]): Promise<void> {
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
}

/** The session account (`api/2.0/account/`) and the site's logout, which signs this context out. */
async function routeAccount(
	context: BrowserContext,
	initial: AccountUser | null
): Promise<AccountServer> {
	let user = initial;
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
		if (route.request().headers()["x-csrftoken"] !== CSRF_TOKEN) {
			await route.fulfill({ status: 403, contentType: "text/html", body: "<h1>Forbidden</h1>" });
			return;
		}
		user = null;
		await route.fulfill({ status: 200, body: "" });
	});
	return {
		set(next) {
			user = next;
		},
		get: () => user
	};
}

const offlineContexts = new WeakSet<BrowserContext>();

/**
 * Takes `context` off the network or back. Playwright's offline mode still answers routed
 * requests, so routed servers (`/api/`, `/account/`) fail too while it's offline.
 */
export async function setOffline(context: BrowserContext, offline: boolean): Promise<void> {
	if (offline) offlineContexts.add(context);
	else offlineContexts.delete(context);
	await context.setOffline(offline);
}

/** Registered last, so it runs before the other routes: fails server requests while offline. */
async function routeOffline(context: BrowserContext): Promise<void> {
	await context.route(
		(url) => url.pathname.includes("/api/") || url.pathname.includes("/account/"),
		async (route) => {
			if (offlineContexts.has(context)) await route.abort("internetdisconnected");
			else await route.fallback();
		}
	);
}

/** The CSRF cookie Django sets, which the SDK and the logout echo as `X-CSRFToken`. */
async function addCsrfCookie(context: BrowserContext, baseURL: string): Promise<void> {
	await context.addCookies([{ name: "csrftoken", value: CSRF_TOKEN, url: baseURL }]);
}

/**
 * `test` with API fixture routing and CSP checking. The preview server sends the contract CSP
 * (`csp-hosts.json`), and any `securitypolicyviolation` in the test's contexts fails the test.
 * API fixture routing: every request to `/api/…` is answered from
 * `e2e/fixtures/api/<path after /api/, trailing slash dropped>.json` (query ignored), and a
 * request with no fixture file fails the test, except the summaries endpoints, which
 * `routeSummaries` answers from the query, the forecasts for a place, which `routeForecasts`
 * answers for the requested days, and the place searches and region lists, which
 * `routePlaces` answers from fixture files picked by the query. The account server answers the session account
 * (`api/2.0/account/`: 401 signed out, or the `account` option's user) and the site's logout,
 * which signs out. The documents server (`api/2.0/documents/…`) is an in-memory fake shared by
 * every context in the test (`documentsServer.newDevice()` makes another). Specs import `test`
 * and `expect` from here.
 */
export const test = base.extend<{
	account: AccountUser | null;
	apiFixtures: string[];
	accountServer: AccountServer;
	cspViolations: CspViolation[];
	documentsServer: DocumentsServer;
}>({
	account: [null, { option: true }],
	cspViolations: [
		async ({ context }, use) => {
			const violations: CspViolation[] = [];
			await watchCsp(context, violations);
			await use(violations);
			expect(violations, "CSP violations").toEqual([]);
		},
		{ auto: true }
	],
	apiFixtures: [
		async ({ context }, use) => {
			const unmatched: string[] = [];
			await routeApiFixtures(context, unmatched);
			await routeSummaries(context);
			await routeForecasts(context);
			await routePlaces(context);
			await use(unmatched);
			expect(unmatched, "API requests with no fixture file").toEqual([]);
		},
		{ auto: true }
	],
	// Depends on apiFixtures so its routes are registered later and take precedence.
	accountServer: [
		async ({ context, account, apiFixtures }, use) => {
			void apiFixtures;
			await use(await routeAccount(context, account));
		},
		{ auto: true }
	],
	documentsServer: [
		async (
			{
				context,
				browser,
				account,
				apiFixtures,
				accountServer,
				cspViolations,
				baseURL,
				viewport,
				reducedMotion,
				userAgent,
				deviceScaleFactor,
				hasTouch,
				locale,
				timezoneId
			},
			use
		) => {
			const fake = createFakeRemote({ accountId: account?.id ?? "nobody" });
			const unmatched: string[] = [];
			const devices: BrowserContext[] = [];
			const origin = baseURL ?? "http://localhost:4173/workspace/";
			const options: BrowserContextOptions = {
				baseURL,
				viewport,
				reducedMotion,
				userAgent,
				deviceScaleFactor,
				hasTouch,
				locale,
				timezoneId
			};

			await addCsrfCookie(context, origin);
			await routeDocuments(context, fake, () => accountServer.get()?.id ?? null, unmatched);
			await routeOffline(context);

			async function newDevice(): Promise<Device> {
				const device = await browser.newContext(options);
				devices.push(device);
				await watchCsp(device, cspViolations);
				await addCsrfCookie(device, origin);
				await routeApiFixtures(device, apiFixtures);
				await routeSummaries(device);
				await routeForecasts(device);
				await routePlaces(device);
				const deviceAccount = await routeAccount(device, account);
				await routeDocuments(device, fake, () => deviceAccount.get()?.id ?? null, unmatched);
				await routeOffline(device);
				return { context: device, page: await device.newPage(), account: deviceAccount };
			}

			await use({ fake, newDevice });
			for (const device of devices) await device.close();
			expect(unmatched, "Documents requests the server doesn't answer").toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };
