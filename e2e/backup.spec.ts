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
