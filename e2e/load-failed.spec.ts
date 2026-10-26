import { expect, test } from "./fixtures";
import { nav } from "./helpers";

test("an app file that won't load shows a reload message instead of a blank page", async ({
	page
}) => {
	await page.route("**/assets/main-*.js", (route) => route.fulfill({ status: 404 }));
	await page.goto("./");
	await expect(
		page.getByText("The workspace couldn't load. This can happen right after an update.")
	).toBeVisible();
	await expect(nav(page)).toHaveCount(0);
	await page.unroute("**/assets/main-*.js");
	await page.getByRole("button", { name: "Reload" }).click();
	await expect(nav(page)).toBeVisible();
});
