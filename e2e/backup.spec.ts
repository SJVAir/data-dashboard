import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { DASHBOARD_URL, dashboardHeading, makeOwnCopy, widgetTitles } from "./helpers";

test.use({ reducedMotion: "reduce" });

/** Two dashboards: the person's copy of the starter, and a blank one. */
async function makeTwoDashboards(page: Page): Promise<string[]> {
	await makeOwnCopy(page);
	const first = page.url();
	await page.goto("./dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toBe(first);
	return [first, page.url()];
}

async function downloadBackup(page: Page, path: string): Promise<void> {
	await page.goto("./dashboards");
	const download = page.waitForEvent("download");
	// The storage note repeats this button where storage is unprotected.
	await page.getByRole("button", { name: "Download a backup" }).first().click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^sjvair-dashboards-backup-\d{4}-\d{2}-\d{2}\.json$/);
	await file.saveAs(path);
}

async function importFile(page: Page, path: string): Promise<void> {
	await page.goto("./dashboards");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import…" }).click();
	await (await chooser).setFiles(path);
}

async function freshPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
	const context = await browser.newContext({ reducedMotion: "reduce" });
	return { page: await context.newPage(), close: () => context.close() };
}

test("backup, delete everything, restore brings the same ids back", async ({ page, browser }) => {
	const urls = await makeTwoDashboards(page);
	const path = test.info().outputPath("backup.json");
	await downloadBackup(page, path);

	const other = await freshPage(browser);
	try {
		await importFile(other.page, path);
		await expect(other.page).toHaveURL(/\/workspace\/dashboards\/?$/);
		await expect(other.page.getByText("Restored 2 dashboards.")).toBeVisible();
		await expect(other.page.getByRole("list").getByRole("link")).toHaveCount(2);

		await other.page.goto(urls[0]);
		await expect(other.page).toHaveURL(urls[0]);
		await expect(dashboardHeading(other.page, "My dashboard")).toBeAttached();
		await expect(widgetTitles(other.page).first()).toHaveText("My first widget");
		await other.page.goto(urls[1]);
		await expect(other.page).toHaveURL(urls[1]);
		await expect(other.page.getByRole("heading", { level: 1 })).toBeAttached();
		await expect(widgetTitles(other.page)).toHaveCount(0);
	} finally {
		await other.close();
	}
});

test("restoring twice keeps everything as it is", async ({ page, browser }) => {
	await makeTwoDashboards(page);
	const path = test.info().outputPath("backup.json");
	await downloadBackup(page, path);

	const other = await freshPage(browser);
	try {
		await importFile(other.page, path);
		await expect(other.page.getByText("Restored 2 dashboards.")).toBeVisible();

		await importFile(other.page, path);
		await expect(other.page.getByText("2 were already here and kept as they are.")).toBeVisible();
		await expect(other.page.getByText("Restored 2 dashboards.")).toBeHidden();
		await expect(other.page.getByRole("list").getByRole("link")).toHaveCount(2);
	} finally {
		await other.close();
	}
});

test("backup, Clear my data, restore in the same browser brings everything back", async ({
	page
}) => {
	const urls = await makeTwoDashboards(page);
	const path = test.info().outputPath("backup.json");
	await downloadBackup(page, path);

	await page.getByRole("button", { name: "Clear my data…" }).click();
	const dialog = page.getByRole("dialog", { name: "Clear my data?" });
	await dialog.getByRole("button", { name: "Clear everything" }).click();
	await expect(dialog).toBeHidden();
	await page.goto("./dashboards");
	await expect(page.getByText("You don't have any dashboards yet.")).toBeVisible();

	await importFile(page, path);
	await expect(page.getByText("Restored 2 dashboards.")).toBeVisible();
	await expect(page.getByRole("list").getByRole("link")).toHaveCount(2);
	await page.goto(urls[0]);
	await expect(page).toHaveURL(urls[0]);
	await expect(widgetTitles(page).first()).toHaveText("My first widget");
	await page.goto(urls[1]);
	await expect(page).toHaveURL(urls[1]);
	await expect(widgetTitles(page)).toHaveCount(0);
});

test("the reminder bar goes away once its backup is downloaded", async ({ page }) => {
	// Storage reads as unprotected in every engine.
	await page.addInitScript(() => {
		if (navigator.storage) navigator.storage.persisted = async () => false;
	});
	await makeOwnCopy(page);
	// A later Pacific day, so the dashboard counts as made on an earlier one.
	await page.clock.setFixedTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
	await page.goto("./");
	const bar = page.getByRole("status").filter({ hasText: /only stored in this browser/ });
	await expect(bar).toBeVisible();
	const download = page.waitForEvent("download");
	await bar.getByRole("button", { name: "Download a backup" }).click();
	await download;
	await expect(page.getByText(/only stored in this browser/)).toBeHidden();
});
