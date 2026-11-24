/**
 * The CSP walk (`e2e/csp-walk.ts`) against the local sjvair.com stack, signed in, under the
 * server's real enforced header. Local only (needs the stack on :8000 and the seeded beta tester):
 *   WORKSPACE_E2E_IDENTIFIER=... WORKSPACE_E2E_PASSWORD=... npm run test:csp-stack
 * The run may save the walk's own dashboards; any other request that isn't GET or HEAD fails it.
 * Only methods and paths are recorded, never bodies or headers.
 */
import { expect, test, type Page } from "@playwright/test";
import { watchCsp, type CspViolation } from "../e2e/fixtures";
import { runWalk, watchCspConsole, watchWorkerCsp } from "../e2e/csp-walk";

const identifier = process.env.WORKSPACE_E2E_IDENTIFIER;
const password = process.env.WORKSPACE_E2E_PASSWORD;

test.skip(
	!identifier || !password,
	"Set WORKSPACE_E2E_IDENTIFIER and WORKSPACE_E2E_PASSWORD (the seeded beta tester)."
);

/** Writes the walk may make: the sign-in, and saving its own dashboards. */
function allowedWrite(method: string, path: string): boolean {
	return (
		(method === "POST" && path === "/account/login/") || path.startsWith("/api/2.0/documents/")
	);
}

/** Signs in through the site's login form. */
async function signIn(page: Page, origin: string): Promise<void> {
	await page.goto(`${origin}/account/login/`);
	await page.locator("[name=identifier]").fill(identifier!);
	await page.locator("[name=password]").fill(password!);
	await page
		.locator("form", { has: page.locator("[name=identifier]") })
		.locator("[type=submit]")
		.first()
		.click();
	await page.waitForURL((url) => !url.pathname.startsWith("/account/login"));
}

/** A violation as a failure line: the step it happened in, the directive, what, and where. */
function line(step: string, v: CspViolation): string {
	return `${step}: ${v.directive} ${v.blockedURI} (${v.sourceFile})`;
}

test("the walk raises no CSP violation under the stack's enforced header", async ({
	page,
	context,
	baseURL
}) => {
	test.setTimeout(300_000);
	const origin = new URL(baseURL!).origin;
	let step = "sign in";
	const violations: CspViolation[] = [];
	const messages: string[] = [];
	const writes: string[] = [];
	const reports: string[] = [];
	await watchCsp(context, violations);
	watchCspConsole(context, messages, () => step);
	await watchWorkerCsp(context, page, messages, () => step);
	page.on("request", (request) => {
		const url = new URL(request.url());
		const method = request.method();
		// A request to the Sentry ingest host means an error report was sent.
		if (/(^|\.)sentry\.io$/.test(url.hostname) || /ingest/.test(url.hostname)) {
			reports.push(`${step}: ${method} ${url.hostname}${url.pathname}`);
		}
		if (url.origin !== origin || method === "GET" || method === "HEAD") return;
		if (!allowedWrite(method, url.pathname)) writes.push(`${step}: ${method} ${url.pathname}`);
	});

	await signIn(page, origin);

	step = "header";
	const first = await page.goto("");
	expect(first!.status(), "/workspace/ status").toBe(200);
	const headers = first!.headers();
	const policy = headers["content-security-policy"];
	expect(policy, "content-security-policy header").toBeDefined();
	expect(headers["content-security-policy-report-only"], "report-only header").toBeUndefined();
	expect(policy).toContain("default-src 'none'");
	expect(policy).not.toContain("unsafe-eval");

	let seen = 0;
	const summary: string[] = [];
	const flush = (name: string) => {
		const fresh = violations.slice(seen);
		seen = violations.length;
		summary.push(`${name}: violations ${fresh.length}`);
		return fresh.map((v) => line(name, v));
	};
	const found: string[] = [];
	await runWalk(page, "stack", (name) => {
		// A violation is reported against the step it happened in (the one still current).
		if (step !== "header") found.push(...flush(step));
		step = name;
	});
	found.push(...flush(step));
	console.log(summary.join("\n"));

	expect(found, "CSP violations").toEqual([]);
	expect(messages, "CSP console and worker messages").toEqual([]);
	expect(writes, "requests that aren't GET, HEAD or the walk's own saves").toEqual([]);
	expect(reports, "requests to the error-report host").toEqual([]);
});
