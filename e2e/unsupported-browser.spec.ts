import { expect, test } from "./fixtures";
import { nav } from "./helpers";

test("a browser below the floor gets a notice instead of the app", async ({ page }) => {
	await page.addInitScript(() => {
		delete (CSS as { registerProperty?: unknown }).registerProperty;
	});
	await page.goto("./");
	await expect(page.getByText("Your browser is too old for this app.")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Go to the SJVAir air quality map" })
	).toHaveAttribute("href", "https://www.sjvair.com/");
	await expect(nav(page)).toHaveCount(0);
});
