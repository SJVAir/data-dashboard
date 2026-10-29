import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import LZString from "lz-string";

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

/** Opens the `index`th widget titled `title`'s ⋯ menu and picks `item`. */
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
	await page.getByRole("menuitem", { name: item }).click();
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
	await widgetMenuItem(page, title, "Rename widget…", index);
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

type Rect = { x: number; y: number; w: number; h: number };

/**
 * A placeholder-widget dashboard document as a link or file carries it. Widget `i` has id `w{i}`
 * and `rects[i]` (default: stacked in the left half).
 */
export function sharedDoc(name: string, widgetTitles: string[], rects?: Rect[]) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-source-1",
		name,
		body: {
			widgets: widgetTitles.map((title, i) => ({
				id: `w${i}`,
				type: "placeholder",
				title,
				rect: rects?.[i] ?? { x: 0, y: i, w: 6, h: 1 },
				data: { layers: [] }
			}))
		}
	};
}

/** The `import#…` path for a shared document, built the way the app builds it (`1.` + lz-string). */
export function shareLinkFor(doc: unknown): string {
	const envelope = {
		format: "sjvair-workspace",
		type: "document",
		formatVersion: 1,
		exportedAt: new Date().toISOString(),
		documents: [doc]
	};
	return `import#1.${LZString.compressToEncodedURIComponent(JSON.stringify(envelope))}`;
}

/** Opens `doc` through a share link (which saves a copy) and waits for its widgets. */
export async function openSharedDoc(page: Page, doc: ReturnType<typeof sharedDoc>): Promise<void> {
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(doc.body.widgets.length);
}

/** The `index`th widget titled `title`'s title bar (its drag handle; focusable). */
export function titleBar(page: Page, title: string, index = 0): Locator {
	return page.getByRole("group", { name: title, exact: true }).nth(index);
}

/**
 * Drags the `index`th widget titled `title` by its title bar with the mouse, `dx`, `dy` px, in
 * steps (pressed near the title, clear of the ⋯ button).
 */
export async function dragTitleBar(
	page: Page,
	title: string,
	dx: number,
	dy: number,
	index = 0
): Promise<void> {
	const box = await titleBar(page, title, index).boundingBox();
	if (!box) throw new Error(`No title bar for ${title}`);
	const x = box.x + 24;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, { steps: 20 });
	await page.mouse.up();
}

/** The page's polite live region (where arranging is announced). */
export function liveRegion(page: Page): Locator {
	return page.locator("[role=status][aria-live=polite][aria-atomic=true]");
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Fails on any WCAG 2.2 AA violation axe finds on the page. */
export async function expectNoViolations(page: Page): Promise<void> {
	const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
	expect(results.violations).toEqual([]);
}
