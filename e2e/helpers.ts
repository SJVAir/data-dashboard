import { expect, type Locator, type Page } from "@playwright/test";

export const PLACEHOLDER = "Placeholder widget";
export const DASHBOARD_URL = /\/workspace\/dashboards\/[0-9a-f-]{36}$/;

export function nav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Main" });
}

/** The widgets' titles, in reading order. */
export function widgetTitles(page: Page): Locator {
	return page.getByRole("main").getByRole("heading", { level: 2 });
}

/** The dashboard's name (a visually hidden heading). */
export function dashboardHeading(page: Page, name: string): Locator {
	return page.getByRole("heading", { level: 1, name, exact: true });
}

/** Waits until the current dashboard's edits are stored. */
export async function expectSaved(page: Page): Promise<void> {
	await expect(nav(page).getByText("Saved", { exact: true })).toBeVisible();
}

/**
 * Opens the `index`th widget titled `title`'s ⋯ menu and picks `item`. The widget's own items
 * come first; the dashboard's (which include another "Rename…") follow.
 */
export async function widgetMenuItem(
	page: Page,
	title: string,
	item: string,
	index = 0
): Promise<void> {
	await page
		.getByRole("button", { name: `Actions for ${title}`, exact: true })
		.nth(index)
		.click();
	await page.getByRole("menuitem", { name: item }).first().click();
}

/** Fills the open rename dialog with `value` and saves. */
export async function saveRename(page: Page, value: string): Promise<void> {
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("textbox", { name: "Name" }).fill(value);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
}

export async function renameWidget(
	page: Page,
	title: string,
	to: string,
	index = 0
): Promise<void> {
	await widgetMenuItem(page, title, "Rename…", index);
	await saveRename(page, to);
}

/** Opens the dashboard picker (its trigger is named after the current dashboard). */
export async function openPicker(page: Page, current: string): Promise<void> {
	await nav(page).getByRole("button", { name: current, exact: true }).click();
	await expect(page.getByRole("menu")).toBeVisible();
}

/** From the starter: rename its first widget, which saves it as the person's own copy. */
export async function makeOwnCopy(page: Page, title = "My first widget"): Promise<void> {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await renameWidget(page, PLACEHOLDER, title);
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expectSaved(page);
}
