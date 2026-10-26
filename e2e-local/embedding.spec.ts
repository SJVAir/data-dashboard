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
	await page.addInitScript(() => {
		const w = window as unknown as { __cspViolations: string[] };
		w.__cspViolations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			w.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});
	page.on("console", (message: ConsoleMessage) => {
		if (/Content Security Policy/i.test(message.text())) cspMessages.push(message.text());
	});
	page.on("response", (response) => fetched.push(response.url()));
	const collectViolations = async () =>
		violations.push(
			...(await page.evaluate(
				() => (window as unknown as { __cspViolations: string[] }).__cspViolations
			))
		);

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

	// Create a dashboard, then load it directly.
	await page.goto("dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(/\/workspace\/dashboards\/[0-9a-f-]{36}$/);
	const dashboardUrl = page.url();
	await collectViolations();

	for (const url of [dashboardUrl, new URL("/workspace", baseURL).href]) {
		const response = await page.goto(url);
		expect(response!.request().redirectedFrom(), `${url} redirected`).toBeNull();
		expect(response!.status()).toBe(200);
		await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
		await collectViolations();
	}

	// The version check runs when the tab turns visible; it reads version.json from the static folder.
	const versionFetched = page.waitForResponse(`${staticFolder}version.json`);
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
	expect((await versionFetched).ok()).toBe(true);

	// A lazy chunk and a font come from the static folder too.
	const fromStatic = fetched.filter((url) => url.startsWith(staticFolder));
	expect(fromStatic.some((url) => /\/assets\/.+\.js$/.test(url))).toBe(true);
	expect(fromStatic.some((url) => /\.(woff2?|ttf|otf)$/.test(url))).toBe(true);

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

	// The identity block carries no secrets.
	const identity = JSON.parse((await page.locator("#sjvair-identity").textContent())!);
	expect(identity.v).toBe(1);
	expect(identity.user).toBeTruthy();
	expect(identity.user).not.toHaveProperty("api_token");
	expect(identity.user).not.toHaveProperty("phone");

	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === "csrftoken")).toBe(true);
});
