import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	dashboardHeading,
	expectNoViolations,
	makeOwnCopy,
	openPicker,
	shareLinkFor,
	sharedDoc,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

// Motion collapses, so menus and dialogs are fully shown when checked.
test.use({ reducedMotion: "reduce" });

test("the starter", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await expectNoViolations(page);
});

test("a dashboard with widgets", async ({ page }) => {
	await makeOwnCopy(page);
	await expectNoViolations(page);
});

test("an empty dashboard", async ({ page }) => {
	await page.goto("./dashboards");
	await page.getByRole("button", { name: "New blank dashboard" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(page.getByText("This dashboard is empty.")).toBeVisible();
	await expectNoViolations(page);
});

test("the picker open", async ({ page }) => {
	await makeOwnCopy(page);
	await openPicker(page, "My dashboard");
	await expectNoViolations(page);
});

test("the context menu open", async ({ page }) => {
	await page.goto("./");
	await page.getByRole("group", { name: PLACEHOLDER }).first().click({ button: "right" });
	await expect(page.getByRole("menu")).toBeVisible();
	await expectNoViolations(page);
});

test("the rename dialog", async ({ page }) => {
	await page.goto("./");
	await widgetMenuItem(page, PLACEHOLDER, "Rename widget…");
	await expect(page.getByRole("dialog", { name: "Rename widget" })).toBeVisible();
	await expectNoViolations(page);
});

test("the list page", async ({ page }) => {
	await makeOwnCopy(page);
	await page.goto("./dashboards");
	await expect(page.getByRole("heading", { level: 1, name: "Your dashboards" })).toBeVisible();
	await expect(page.getByRole("link", { name: /My dashboard/ })).toBeVisible();
	await expectNoViolations(page);
});

test("the Share dialog", async ({ page }) => {
	await makeOwnCopy(page);
	await openPicker(page, "My dashboard");
	await page.getByRole("menuitem", { name: "Share…" }).click();
	const dialog = page.getByRole("dialog", { name: "Share dashboard" });
	await expect(dialog.getByRole("textbox", { name: "Link" })).toBeVisible();
	await expectNoViolations(page);
});

test("the /import error page", async ({ page }) => {
	const link = shareLinkFor(sharedDoc("Fresno schools", ["Alpha"]));
	await page.goto(link.slice(0, -12));
	await expect(
		page.getByRole("heading", { level: 1, name: "This link can't be opened." })
	).toBeVisible();
	await expectNoViolations(page);
});

test("the existing-copy dialog", async ({ page }) => {
	const link = shareLinkFor(sharedDoc("Fresno schools", ["Alpha"]));
	await page.goto(link);
	await expect(page).toHaveURL(DASHBOARD_URL);
	await page.goto(link);
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText("You already have a copy of this dashboard")).toBeVisible();
	await expectNoViolations(page);
});

test("the list with Recently deleted showing", async ({ page }) => {
	await makeOwnCopy(page);
	await openPicker(page, "My dashboard");
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toast = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect(toast).toBeVisible();
	await expect(toast).toBeHidden({ timeout: 15_000 });
	await page.goto("./dashboards#recently-deleted");
	await expect(page.getByRole("heading", { level: 2, name: "Recently deleted" })).toBeVisible();
	await expectNoViolations(page);
});

test("the Clear my data dialog", async ({ page }) => {
	await page.goto("./dashboards");
	await page.getByRole("button", { name: "Clear my data…" }).click();
	await expect(page.getByRole("dialog", { name: "Clear my data?" })).toBeVisible();
	await expectNoViolations(page);
});

test("the storage popover open", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await page.getByRole("button", { name: /Storage status/ }).click();
	await expect(page.getByText("Dashboards are stored in this browser.")).toBeVisible();
	await expectNoViolations(page);
});

test("a dashboard with the backup reminder", async ({ page }) => {
	// Storage reads as unprotected in every engine.
	await page.addInitScript(() => {
		if (navigator.storage) navigator.storage.persisted = async () => false;
	});
	await makeOwnCopy(page);
	// A later Pacific day, so the dashboard counts as made on an earlier one.
	await page.clock.setFixedTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
	await page.goto("./");
	await expect(page.getByRole("status").getByText(/only stored in this browser/)).toBeVisible();
	await expectNoViolations(page);
});

test("a dashboard with the reload bar", async ({ page }) => {
	await page.route("**/workspace/version.json", (route) =>
		route.fulfill({ contentType: "application/json", body: JSON.stringify({ buildId: "other" }) })
	);
	await makeOwnCopy(page);
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
	await expect(page.getByText("A new version is available.")).toBeVisible();
	await expectNoViolations(page);
});

test("menus and dialogs don't animate under reduced motion", async ({ page }) => {
	await page.goto("./");
	await widgetMenuItem(page, PLACEHOLDER, "Rename widget…");
	const dialog = page.getByRole("dialog", { name: "Rename widget" });
	await expect(dialog).toBeVisible();
	const durations = await dialog.evaluate((el) => {
		const overlay = document.querySelector("[data-slot=dialog-overlay]");
		return [el, overlay].map((node) => (node ? getComputedStyle(node).animationDuration : null));
	});
	expect(durations).toEqual(["0s", "0s"]);
});

test("the context menu opens with Shift+F10 on a focused widget title bar", async ({ page }) => {
	await page.goto("./");
	await expect(dashboardHeading(page, "Starter dashboard")).toBeAttached();
	await page.getByRole("group", { name: PLACEHOLDER }).first().focus();
	await page.keyboard.press("Shift+F10");
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	// The first item (Move…, ahead of Rename widget… since spec 2a) takes focus.
	await expect(menu.getByRole("menuitem", { name: "Move…" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
});
