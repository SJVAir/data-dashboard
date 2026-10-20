import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	dashboardHeading,
	makeOwnCopy,
	openPicker,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	expect(results.violations).toEqual([]);
}

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
	await expect(menu.getByRole("menuitem", { name: "Rename widget…" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
});
