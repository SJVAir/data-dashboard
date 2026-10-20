import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home renders and has no accessibility violations", async ({ page }) => {
	await page.goto("./");
	await expect(page.getByRole("heading", { name: "SJVAir Workspace" })).toBeVisible();
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});
