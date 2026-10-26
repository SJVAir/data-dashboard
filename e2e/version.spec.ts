import { expect, test } from "./fixtures";
import { DASHBOARD_URL, makeOwnCopy } from "./helpers";

async function checkAgain(page: import("@playwright/test").Page): Promise<void> {
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

test("a changed version.json shows the reload bar", async ({ page }) => {
	await page.route("**/assets/version.json", (route) =>
		route.fulfill({ contentType: "application/json", body: JSON.stringify({ buildId: "other" }) })
	);
	await page.goto("/workspace/");
	await makeOwnCopy(page, "Version widget");
	await expect(page).toHaveURL(DASHBOARD_URL);
	await checkAgain(page);
	await expect(page.getByRole("status").getByText("A new version is available.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("the real version.json shows nothing", async ({ page }) => {
	const fetched = page.waitForResponse("**/assets/version.json");
	await page.goto("/workspace/");
	await makeOwnCopy(page, "Version widget");
	await checkAgain(page);
	await fetched;
	await expect(page.getByText("A new version is available.")).toHaveCount(0);
});

test("a failed lazy chunk shows the reload bar", async ({ page }) => {
	await page.route(/\/assets\/(actions|incoming)-.*\.js$/, (route) => route.abort());
	await page.goto("/workspace/");
	await makeOwnCopy(page, "Chunk widget");
	await page.getByRole("button", { name: "My dashboard", exact: true }).click();
	await page.getByRole("menuitem", { name: "Share…" }).click();
	await expect(page.getByRole("status").getByText("A new version is available.")).toBeVisible();
});
