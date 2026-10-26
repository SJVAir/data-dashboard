import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.use({ reducedMotion: "reduce" });

test("the help menu opens the privacy note, which passes axe", async ({ page }) => {
	await page.goto("./");
	await page.getByRole("button", { name: "Help" }).click();
	await expect(page.getByRole("menuitem", { name: "Send feedback" })).toHaveAttribute(
		"href",
		"https://www.sjvair.com/contact/"
	);
	await page.getByRole("menuitem", { name: "Your data and privacy" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "Your data and privacy" })).toBeVisible();
	await expect(dialog.getByRole("link", { name: /Licenses/ })).toHaveAttribute(
		"href",
		/THIRD-PARTY-NOTICES\.txt$/
	);
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});
