import { expect, test } from "./fixtures";
import { DASHBOARD_URL, nav } from "./helpers";

test("deep routes and the bare mount path render the shell from /workspace/ files", async ({
	page,
	context,
	baseURL
}) => {
	await page.goto(".");
	await expect(nav(page)).toBeVisible();
	await page.goto("dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	const deepUrl = page.url();

	const fresh = await context.newPage();
	const requested: string[] = [];
	fresh.on("request", (request) => requested.push(new URL(request.url()).pathname));
	await fresh.goto(deepUrl);
	await expect(nav(fresh)).toBeVisible();
	expect(requested).toContain("/workspace/app.js");
	expect(requested.some((path) => path.startsWith("/workspace/assets/"))).toBe(true);

	await fresh.goto(new URL("/workspace", baseURL).href);
	await expect(nav(fresh)).toBeVisible();
});

test("the web app manifest is served and its icon loads", async ({ request, baseURL }) => {
	const response = await request.get(new URL("/workspace/manifest.webmanifest", baseURL).href);
	expect(response.ok()).toBe(true);
	const manifest = await response.json();
	expect(manifest.start_url).toBe("/workspace/");
	expect(manifest.scope).toBe("/workspace/");
	const icon = await request.get(
		new URL(manifest.icons[0].src, new URL("/workspace/manifest.webmanifest", baseURL)).href
	);
	expect(icon.ok()).toBe(true);
	expect(icon.headers()["content-type"]).toContain("image/png");
});
