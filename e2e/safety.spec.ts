import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DASHBOARD_URL, dashboardHeading, makeOwnCopy, openPicker } from "./helpers";

test.use({ reducedMotion: "reduce" });

/** Deletes the open dashboard from the picker and waits for its Undo toast to go away. */
async function deleteCurrent(page: Page, name: string): Promise<void> {
	await openPicker(page, name);
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toast = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect(toast).toBeVisible();
	await expect(toast).toBeHidden({ timeout: 15_000 });
}

/** The person's own copy, then a blank dashboard to land on; returns the copy's URL. */
async function copyThenBlank(page: Page): Promise<string> {
	await makeOwnCopy(page);
	const copyUrl = page.url();
	await openPicker(page, "My dashboard");
	await page.getByRole("menuitem", { name: "New blank dashboard" }).click();
	await expect(page).not.toHaveURL(copyUrl);
	await expect(page).toHaveURL(DASHBOARD_URL);
	await page.goto(copyUrl);
	await expect(dashboardHeading(page, "My dashboard")).toBeAttached();
	return copyUrl;
}

test("delete from the picker, then restore from Recently deleted", async ({ page }) => {
	const copyUrl = await copyThenBlank(page);
	await deleteCurrent(page, "My dashboard");
	await expect(page).not.toHaveURL(copyUrl);

	await openPicker(page, "Untitled dashboard");
	await page.getByRole("menuitem", { name: "Recently deleted (1)" }).click();
	await expect(page).toHaveURL(/\/workspace\/dashboards#recently-deleted$/);
	const heading = page.getByRole("heading", { level: 2, name: "Recently deleted" });
	await expect(heading).toBeFocused();

	await page.getByRole("button", { name: "Restore My dashboard" }).click();
	await expect(page).toHaveURL(copyUrl);
	await expect(dashboardHeading(page, "My dashboard")).toBeAttached();

	await page.goto("./dashboards");
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toHaveCount(0);
});

test("Delete now removes it for good", async ({ page }) => {
	await copyThenBlank(page);
	await deleteCurrent(page, "My dashboard");

	await page.goto("./dashboards#recently-deleted");
	await page.getByRole("button", { name: "Delete My dashboard now" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete this dashboard now?" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Delete now" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: "Your dashboards" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toHaveCount(0);
});
