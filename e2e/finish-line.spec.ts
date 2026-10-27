import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	dashboardHeading,
	expectSaved,
	makeOwnCopy,
	nav,
	openPicker,
	renameWidget,
	saveRename,
	widgetTitles
} from "./helpers";

const HINT = "This is the starter dashboard. Any change saves it as your own.";

test("first visit shows the starter with the hint", async ({ page }) => {
	await page.goto("./");
	await expect(dashboardHeading(page, "Starter dashboard")).toBeAttached();
	await expect(page).toHaveTitle("Starter dashboard · SJVAir Dashboard");
	await expect(page.getByText(HINT)).toBeVisible();
	await expect(widgetTitles(page)).toHaveText([PLACEHOLDER, PLACEHOLDER, PLACEHOLDER]);
	await expect(page).toHaveURL(/\/workspace\/?$/);
});

test("editing the starter makes my own copy", async ({ page }) => {
	await page.goto("./");
	await expect(page.getByText(HINT)).toBeVisible();
	await renameWidget(page, PLACEHOLDER, "Fresno PM2.5");
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(page.getByText("Saved as your own dashboard")).toBeVisible();
	await expect(page.getByText(HINT)).toBeHidden();
	await expect(widgetTitles(page).first()).toHaveText("Fresno PM2.5");
	await expect(dashboardHeading(page, "My dashboard")).toBeAttached();
});

test("add widgets, rename, reload, everything is still there", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await page.getByRole("button", { name: "Add widget", exact: true }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await page.getByRole("button", { name: "Add widget", exact: true }).click();
	await expect(widgetTitles(page)).toHaveCount(5);

	await renameWidget(page, PLACEHOLDER, "Ozone trend", 4);
	await openPicker(page, "My dashboard");
	await page.getByRole("menuitem", { name: "Rename dashboard…" }).click();
	await saveRename(page, "Fresno school");
	await expect(dashboardHeading(page, "Fresno school")).toBeAttached();
	await expectSaved(page);
	const url = page.url();

	await page.reload();
	await expect(page).toHaveURL(url);
	await expect(dashboardHeading(page, "Fresno school")).toBeAttached();
	await expect(widgetTitles(page)).toHaveText([
		PLACEHOLDER,
		PLACEHOLDER,
		PLACEHOLDER,
		PLACEHOLDER,
		"Ozone trend"
	]);
	await expect(nav(page).getByRole("button", { name: "Fresno school" })).toBeVisible();

	// Home now opens the dashboard last opened, not the starter.
	await page.goto("./");
	await expect(page).toHaveURL(url);
});

test("edit then immediate reload keeps the edit", async ({ page }) => {
	await makeOwnCopy(page);
	await renameWidget(page, "My first widget", "Renamed just now");
	await page.reload();
	await expect(widgetTitles(page).first()).toHaveText("Renamed just now");
});

test("undo and redo with the keyboard and buttons", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await page.getByRole("button", { name: "Add widget", exact: true }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(4);

	const undo = nav(page).getByRole("button", { name: "Undo" });
	const redo = nav(page).getByRole("button", { name: "Redo" });
	await expect(redo).toBeDisabled();

	await page.keyboard.press("Control+z");
	await expect(widgetTitles(page)).toHaveCount(3);
	await expect(redo).toBeEnabled();
	await page.keyboard.press("Control+Shift+z");
	await expect(widgetTitles(page)).toHaveCount(4);

	await undo.click();
	await expect(widgetTitles(page)).toHaveCount(3);
	await redo.click();
	await expect(widgetTitles(page)).toHaveCount(4);
	await expect(redo).toBeDisabled();

	// The redone state is what's stored.
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveCount(4);
});

test("new blank dashboard, duplicate (rename dialog opens), delete with undo", async ({ page }) => {
	await page.goto("./");
	await openPicker(page, "Starter dashboard");
	await page.getByRole("menuitem", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(page.getByText("This dashboard is empty.")).toBeVisible();
	await expect(dashboardHeading(page, "Untitled dashboard")).toBeAttached();
	const blankUrl = page.url();

	await openPicker(page, "Untitled dashboard");
	await page.getByRole("menuitem", { name: "Duplicate dashboard" }).click();
	await expect(page.getByRole("dialog", { name: "Rename dashboard" })).toBeVisible();
	await expect(page).not.toHaveURL(blankUrl);
	await expect(page).toHaveURL(DASHBOARD_URL);
	const copyUrl = page.url();
	await saveRename(page, "Copy test");
	await expect(dashboardHeading(page, "Copy test")).toBeAttached();
	await expectSaved(page);

	await openPicker(page, "Copy test");
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toast = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect(toast).toBeVisible();
	await expect(page).toHaveURL(blankUrl);
	await toast.getByRole("button", { name: "Undo" }).click();
	await expect(page).toHaveURL(copyUrl);
	await expect(dashboardHeading(page, "Copy test")).toBeAttached();
});

test("unknown and trimmed paths redirect", async ({ page }) => {
	await page.goto("./nowhere");
	// sv-router writes the home path without its trailing slash.
	await expect(page).toHaveURL(/\/workspace\/?$/);
	await page.goto("./dashboards/abc/widgets");
	await expect(page).toHaveURL(/\/workspace\/dashboards\/abc$/);
});
