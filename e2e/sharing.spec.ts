import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	dashboardHeading,
	makeOwnCopy,
	nav,
	openPicker,
	shareLinkFor,
	sharedDoc,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

const link = shareLinkFor(sharedDoc("Fresno schools", ["Alpha", "Beta"]));

test("opening a link saves a copy and drops the fragment", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toContain("#");
	await expect(dashboardHeading(page, "Fresno schools")).toBeAttached();
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta"]);
	await expect(page.getByText("Saved a copy to your dashboards")).toBeVisible();

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Dashboards" })
		.click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(1);
});

test("reopening the same link asks; Open my copy goes back to it", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	const first = page.url();

	await page.goto(link);
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("You already have a copy of this dashboard")).toBeVisible();
	await expect(dialog.getByText(/^Last changed /)).toBeVisible();
	await dialog.getByRole("button", { name: "Open my copy" }).click();
	await expect(page).toHaveURL(first);
});

test("reopening the same link asks; Make a new copy makes a second one", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	const first = page.url();

	await page.goto(link);
	await page.getByRole("dialog").getByRole("button", { name: "Make a new copy" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toBe(first);

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Dashboards" })
		.click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(2);
});

test("closing the question keeps both choices on the page", async ({ page }) => {
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);

	await page.goto(link);
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
	await expect(page.getByRole("button", { name: "Open my copy" })).toBeVisible();
	await page.getByRole("button", { name: "Make a new copy" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
});

test("a tampered link shows the error and saves nothing", async ({ page }) => {
	await page.goto(link.slice(0, -12));
	await expect(
		page.getByRole("heading", { level: 1, name: "This link can't be opened." })
	).toBeVisible();

	await page.getByRole("link", { name: "Dashboards" }).first().click();
	await expect(page.getByRole("link", { name: "Fresno schools" })).toHaveCount(0);
	await expect(page).not.toHaveURL(DASHBOARD_URL);
});

test("/import with no link goes home", async ({ page }) => {
	await page.goto("./import");
	await expect(page).toHaveURL(/\/workspace\/?$/);
});

async function chooseMenuItem(page: Page, current: string, item: string) {
	await openPicker(page, current);
	await page.getByRole("menuitem", { name: item }).click();
}

test("a link copied from the Share dialog opens as a copy in a new browser", async ({
	page,
	browser,
	context
}) => {
	// Only Chromium has clipboard permissions to grant; the others allow writes on a click.
	await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	await chooseMenuItem(page, "Fresno schools", "Share…");
	const dialog = page.getByRole("dialog", { name: "Share dashboard" });
	const shared = await dialog.getByRole("textbox", { name: "Link" }).inputValue();
	expect(shared).toContain("/import#");
	await dialog.getByRole("button", { name: "Copy link" }).click();
	await expect(dialog.getByRole("status")).toHaveText("Link copied");

	const other = await browser.newContext();
	try {
		const otherPage = await other.newPage();
		await otherPage.goto(shared);
		await expect(otherPage).toHaveURL(DASHBOARD_URL);
		await expect(dashboardHeading(otherPage, "Fresno schools")).toBeAttached();
		await expect(widgetTitles(otherPage)).toHaveText(["Alpha", "Beta"]);
	} finally {
		await other.close();
	}
});

test("the starter can be shared too", async ({ page }) => {
	await page.goto("./");
	await chooseMenuItem(page, "Starter dashboard", "Share…");
	await expect(page.getByRole("dialog").getByRole("textbox", { name: "Link" })).toHaveValue(
		/\/import#1\./
	);
});

test("Export then Import makes a copy", async ({ page }) => {
	await makeOwnCopy(page);
	const first = page.url();
	const download = page.waitForEvent("download");
	await chooseMenuItem(page, "My dashboard", "Export…");
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^my-dashboard-\d{4}-\d{2}-\d{2}\.json$/);
	const path = test.info().outputPath("export.json");
	await file.saveAs(path);

	const chooser = page.waitForEvent("filechooser");
	await chooseMenuItem(page, "My dashboard", "Import…");
	await (await chooser).setFiles(path);
	await expect(page.getByText("Saved a copy to your dashboards")).toBeVisible();
	await expect(page).toHaveURL(DASHBOARD_URL);
	expect(page.url()).not.toBe(first);
	await expect(widgetTitles(page).first()).toHaveText("My first widget");

	await nav(page).getByRole("link", { name: "Dashboards" }).click();
	await expect(page.getByRole("list").getByRole("link")).toHaveCount(2);
});

test("a file that isn't a dashboard shows an error and saves nothing", async ({ page }) => {
	await page.goto("./dashboards");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import…" }).click();
	await (
		await chooser
	).setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
	await expect(page.getByText("This file can't be opened.")).toBeVisible();
	await expect(page).not.toHaveURL(DASHBOARD_URL);
});

test("a dashboard too big for a link offers only the file", async ({ page }) => {
	const titles = Array.from({ length: 1000 }, () => randomBytes(16).toString("hex"));
	const envelope = {
		format: "sjvair-workspace",
		type: "document",
		formatVersion: 1,
		exportedAt: new Date().toISOString(),
		documents: [sharedDoc("Huge", titles)]
	};
	await page.goto("./dashboards");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Import…" }).click();
	await (
		await chooser
	).setFiles({
		name: "huge.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify(envelope))
	});
	await expect(page).toHaveURL(DASHBOARD_URL);

	await chooseMenuItem(page, "Huge", "Share…");
	const dialog = page.getByRole("dialog", { name: "Share dashboard" });
	await expect(dialog.getByText(/too big to share as a link/)).toBeVisible();
	await expect(dialog.getByRole("textbox")).toHaveCount(0);
	const download = page.waitForEvent("download");
	await dialog.getByRole("button", { name: "Download file instead" }).click();
	expect((await download).suggestedFilename()).toMatch(/^huge-\d{4}-\d{2}-\d{2}\.json$/);
});
