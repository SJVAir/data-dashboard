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
