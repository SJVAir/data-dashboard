import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	dashboardHeading,
	makeOwnCopy,
	openPicker,
	saveRename,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

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
	await page.getByRole("button", { name: "Delete now: My dashboard" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete this dashboard now?" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Delete now" }).click();
	await expect(dialog).toBeHidden();
	// The section is gone; focus moves to the page heading, not the body.
	await expect(page.getByRole("heading", { level: 1, name: "Your dashboards" })).toBeFocused();
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole("heading", { level: 1, name: "Your dashboards" })).toBeVisible();
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toHaveCount(0);
});

test("Delete now moves focus to the next row's Restore button", async ({ page }) => {
	await copyThenBlank(page);
	await deleteCurrent(page, "My dashboard");
	// A second deleted dashboard: the blank one we are on.
	await openPicker(page, "Untitled dashboard");
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toast = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect(toast).toBeVisible();
	await expect(toast).toBeHidden({ timeout: 15_000 });

	await page.goto("./dashboards#recently-deleted");
	const restores = page.getByRole("button", { name: /^Restore / });
	await expect(restores).toHaveCount(2);
	const second = await restores.nth(1).getAttribute("aria-label");
	await page
		.getByRole("button", { name: /^Delete now: / })
		.first()
		.click();
	const dialog = page.getByRole("dialog", { name: "Delete this dashboard now?" });
	await dialog.getByRole("button", { name: "Delete now" }).click();
	await expect(dialog).toBeHidden();
	await expect(restores).toHaveCount(1);
	await expect(page.getByRole("button", { name: second! })).toBeFocused();
});

test("Clear my data with two tabs leaves both on the starter and nothing comes back", async ({
	page
}) => {
	await makeOwnCopy(page, "Shared widget");
	const other = await page.context().newPage();
	await other.goto(page.url());
	await expect(widgetTitles(other).first()).toHaveText("Shared widget");
	// An edit in the second tab that hasn't been saved yet.
	await widgetMenuItem(other, "Shared widget", "Rename widget…");
	await saveRename(other, "Never saved");

	await page.goto("./dashboards");
	await page.getByRole("button", { name: "Clear my data…" }).click();
	const dialog = page.getByRole("dialog", { name: "Clear my data?" });
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Clear everything" }).click();
	await expect(dialog).toBeHidden();
	// Focus lands on the starter's page, not the body.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const active = document.activeElement;
				return active !== document.body && !!document.querySelector("main")?.contains(active);
			})
		)
		.toBe(true);

	for (const tab of [page, other]) {
		await expect(tab).toHaveURL(/\/workspace\/$/);
		await expect(widgetTitles(tab)).toHaveText([PLACEHOLDER, /./, /./]);
	}
	await page.waitForTimeout(1000);
	for (const tab of [page, other]) {
		await tab.goto("./");
		await expect(widgetTitles(tab).first()).toHaveText(PLACEHOLDER);
		await tab.goto("./dashboards");
		await expect(tab.getByText("You don't have any dashboards yet.")).toBeVisible();
	}
});
