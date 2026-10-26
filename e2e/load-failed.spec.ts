import { expect, test } from "./fixtures";
import { nav } from "./helpers";

test("an app file that won't load shows a reload message instead of a blank page", async ({
	page,
	browserName
}) => {
	await page.route("**/assets/main-*.js", (route) => route.fulfill({ status: 404 }));
	await page.goto("./");
	await expect(
		page.getByText("SJVAir Dashboard couldn't load. This can happen right after an update.")
	).toBeVisible();
	await expect(nav(page)).toHaveCount(0);
	await page.unroute("**/assets/main-*.js");
	// Reload refreshes the fixed-name entry files first, then reloads the page.
	const refreshed = page.waitForRequest((r) => r.url().endsWith("/workspace/app.css"));
	const reloaded = page.waitForEvent("framenavigated");
	await page.getByRole("button", { name: "Reload" }).click();
	await refreshed;
	await reloaded;
	// Playwright's WebKit keeps failing the same module import after a reload without
	// requesting it again (see DEFERRED.md, "WebKit and a failed chunk after reload").
	if (browserName !== "webkit") await expect(nav(page)).toBeVisible();
});
