import { expect, test, type ConsoleMessage } from "@playwright/test";

// Hand-run check of the real embedding: sjvair.com's template, static files, CSP and identity
// block. Needs the local stack on :8000 and the seeded beta tester (`seed_beta_tester`):
//   WORKSPACE_E2E_IDENTIFIER=... WORKSPACE_E2E_PASSWORD=... npm run test:embedding
const identifier = process.env.WORKSPACE_E2E_IDENTIFIER;
const password = process.env.WORKSPACE_E2E_PASSWORD;

test.skip(
	!identifier || !password,
	"Set WORKSPACE_E2E_IDENTIFIER and WORKSPACE_E2E_PASSWORD (the seeded beta tester)."
);

test("the dashboard is embedded correctly in the sjvair.com template", async ({
	page,
	request,
	baseURL
}) => {
	const origin = new URL(baseURL!).origin;
	const violations: string[] = [];
	const cspMessages: string[] = [];
	const fetched: string[] = [];
	// Reported from every document's listener to Node, so no navigation loses a violation.
	await page.exposeBinding("reportCspViolation", (_source, detail: string) => {
		violations.push(detail);
	});
	await page.addInitScript(() => {
		document.addEventListener("securitypolicyviolation", (event) => {
			(window as unknown as { reportCspViolation: (detail: string) => void }).reportCspViolation(
				`${event.violatedDirective} ${event.blockedURI}`
			);
		});
	});
	page.on("console", (message: ConsoleMessage) => {
		if (/Content Security Policy/i.test(message.text())) cspMessages.push(message.text());
	});
	page.on("response", (response) => fetched.push(response.url()));
	// Sign in as the seeded beta tester.
	await page.goto(`${origin}/account/login/`);
	await page.locator("[name=identifier]").fill(identifier!);
	await page.locator("[name=password]").fill(password!);
	await page
		.locator("form", { has: page.locator("[name=identifier]") })
		.locator("[type=submit]")
		.first()
		.click();
	await page.waitForURL((url) => !url.pathname.startsWith("/account/login"));

	// The page mounts, and the static folder comes from the entry script, not a constant.
	const first = await page.goto("");
	expect(first!.status()).toBe(200);
	await expect(page.locator("#SJVAirDataDashboard")).not.toBeEmpty();
	await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
	const entry = await page.locator('script[type="module"][src$="app.js"]').getAttribute("src");
	const staticFolder = new URL(".", new URL(entry!, page.url())).href;
	// Locally static files are served same-origin at /static/; a build under /workspace/ is wrong.
	expect(staticFolder).toBe(process.env.WORKSPACE_E2E_STATIC ?? `${origin}/static/workspace/`);
	expect(new URL(staticFolder).pathname.startsWith("/workspace/")).toBe(false);

	// Create a dashboard, then load it directly.
	await page.goto("dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(/\/workspace\/dashboards\/[0-9a-f-]{36}$/);
	const dashboardUrl = page.url();

	// The view itself must set the csrf cookie: drop it (keeping the session) before the last load.
	for (const url of [dashboardUrl, new URL("/workspace", baseURL).href]) {
		if (url.endsWith("/workspace")) await page.context().clearCookies({ name: "csrftoken" });
		const response = await page.goto(url);
		expect(response!.request().redirectedFrom(), `${url} redirected`).toBeNull();
		expect(response!.status()).toBe(200);
		await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
	}

	// The version check runs when the tab turns visible; it reads version.json from the static folder.
	const versionFetched = page.waitForResponse(`${staticFolder}version.json`);
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
	expect((await versionFetched).ok()).toBe(true);

	// A lazy chunk and a font come from the static folder too.
	const fromStatic = fetched.filter((url) => url.startsWith(staticFolder));
	expect(fromStatic.some((url) => /\/assets\/.+\.js$/.test(url))).toBe(true);
	expect(fromStatic.some((url) => /\.(woff2?|ttf|otf)$/.test(url))).toBe(true);

	await page.waitForTimeout(1000);
	expect(violations).toEqual([]);
	expect(cspMessages).toEqual([]);

	// The manifest sits outside the beta gate and points its icons at the static folder.
	const manifestResponse = await request.get(`${origin}/workspace/manifest.webmanifest`);
	expect(manifestResponse.ok()).toBe(true);
	expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
	const manifest = await manifestResponse.json();
	expect(manifest.icons.length).toBeGreaterThan(0);
	for (const icon of manifest.icons) {
		expect(new URL(icon.src, origin).href.startsWith(staticFolder)).toBe(true);
	}

	// The identity block is the session account response, without the API token, and the top
	// bar reads it.
	const identity = JSON.parse((await page.locator("#sjvair-identity").textContent())!);
	expect(identity.v).toBe(1);
	expect(typeof identity.user === "object" && identity.user !== null).toBe(true);
	expect(identity.user).toHaveProperty("id");
	expect(identity.user).toHaveProperty("full_name");
	expect(identity.user).toHaveProperty("phone_verified");
	expect(identity.user).not.toHaveProperty("api_token");
	await expect(page.getByRole("button", { name: /^Account menu for / })).toBeVisible();

	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === "csrftoken")).toBe(true);
});
