import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home shows the starter and has no accessibility violations", async ({ page }) => {
	await page.goto("./");
	const nav = page.getByRole("navigation", { name: "Main" });
	await expect(nav.getByRole("link", { name: "SJVAir Workspace" })).toBeVisible();
	await expect(nav.getByRole("button", { name: "Starter dashboard" })).toBeVisible();
	await expect(page).toHaveTitle("Starter dashboard · SJVAir Workspace");
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});

test("unknown and trimmed paths redirect", async ({ page }) => {
	await page.goto("./nowhere");
	// sv-router writes the home path without its trailing slash.
	await expect(page).toHaveURL(/\/workspace\/?$/);
	await page.goto("./dashboards/abc/widgets");
	await expect(page).toHaveURL(/\/workspace\/dashboards\/abc$/);
});
