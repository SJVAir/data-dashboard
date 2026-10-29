import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	dragTitleBar,
	expectNoViolations,
	expectSaved,
	liveRegion,
	nav,
	openSharedDoc,
	sharedDoc,
	titleBar,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

// Alpha and Beta side by side on top, Gamma full width below (the starter's shape).
const SIDE_BY_SIDE = sharedDoc(
	"Arranging",
	["Alpha", "Beta", "Gamma"],
	[
		{ x: 0, y: 0, w: 6, h: 4 },
		{ x: 6, y: 0, w: 6, h: 4 },
		{ x: 0, y: 4, w: 12, h: 4 }
	]
);
// All three stacked in the left half, two rows tall each.
const STACKED = sharedDoc(
	"Stacked",
	["Alpha", "Beta", "Gamma"],
	[
		{ x: 0, y: 0, w: 6, h: 2 },
		{ x: 0, y: 2, w: 6, h: 2 },
		{ x: 0, y: 4, w: 6, h: 2 }
	]
);

async function box(page: Page, testId: string) {
	const b = await page.getByTestId(testId).boundingBox();
	if (!b) throw new Error(`${testId} isn't shown`);
	return b;
}

/**
 * A touch on the `title` widget's title bar, from dispatched pointer events (the same in every
 * engine): press, hold `hold` ms, slide `dx`, `dy` px in steps (none when both are 0), release.
 */
async function touchTitleBar(
	page: Page,
	title: string,
	{ dx = 0, dy = 0, hold = 700 }: { dx?: number; dy?: number; hold?: number } = {}
): Promise<void> {
	const b = await titleBar(page, title).boundingBox();
	if (!b) throw new Error(`No title bar for ${title}`);
	const start = { x: b.x + 24, y: b.y + b.height / 2 };
	await page.evaluate(
		async ({ start, dx, dy, hold }) => {
			const target = document.elementFromPoint(start.x, start.y);
			if (!target) throw new Error("Nothing under the touch");
			const fire = (type: string, x: number, y: number, buttons: number) =>
				target.dispatchEvent(
					new PointerEvent(type, {
						pointerId: 41,
						pointerType: "touch",
						isPrimary: true,
						bubbles: true,
						cancelable: true,
						composed: true,
						button: 0,
						buttons,
						clientX: x,
						clientY: y
					})
				);
			const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
			fire("pointerdown", start.x, start.y, 1);
			await new Promise((resolve) => setTimeout(resolve, hold));
			const steps = dx === 0 && dy === 0 ? 0 : 20;
			for (let i = 1; i <= steps; i++) {
				fire("pointermove", start.x + (dx * i) / steps, start.y + (dy * i) / steps, 1);
				await frame();
			}
			fire("pointerup", start.x + dx, start.y + dy, 0);
		},
		{ start, dx, dy, hold }
	);
}

test("mouse drag moves a widget and survives a reload", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	const alpha = await titleBar(page, "Alpha").boundingBox();
	const gamma = await titleBar(page, "Gamma").boundingBox();
	// Gamma's top-left onto Alpha's: Gamma goes to the top and pushes the others down.
	await dragTitleBar(page, "Gamma", alpha!.x - gamma!.x, alpha!.y - gamma!.y);

	await expect(widgetTitles(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
	await expect(liveRegion(page)).toHaveText(
		"Dropped Gamma at column 1, row 1. 2 other widgets moved."
	);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveText(["Gamma", "Alpha", "Beta"]);
});

test("a click on the title bar doesn't move the widget", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	// Under the 4 px drag threshold.
	await dragTitleBar(page, "Gamma", 2, -2);
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
	await expect(nav(page).getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("resizing by the right edge", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	const gamma = await box(page, "widget-w2");
	const alpha = await box(page, "widget-w0");
	// Handles show on hover (a fine pointer).
	await page.mouse.move(gamma.x + gamma.width / 2, gamma.y + gamma.height / 2);
	const handle = page.getByTestId("widget-w2").locator("[data-resize=right]");
	const h = await handle.boundingBox();
	if (!h) throw new Error("No right resize handle");
	const x = h.x + h.width / 2;
	const y = h.y + h.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	// Half the width: twelve columns become six.
	await page.mouse.move(x - gamma.width / 2, y, { steps: 20 });
	await page.mouse.up();

	await expect(liveRegion(page)).toHaveText("Dropped Gamma at column 1, row 5.");
	await expect.poll(async () => (await box(page, "widget-w2")).width).toBeCloseTo(alpha.width, 0);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
	expect((await box(page, "widget-w2")).width).toBeCloseTo(alpha.width, 0);
});

test("keyboard move and resize, then undo", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	const beta = await box(page, "widget-w1");
	const bar = titleBar(page, "Alpha");
	await bar.focus();
	await page.keyboard.press("Enter");
	await expect(liveRegion(page)).toHaveText(/^Picked up Alpha\. Column 1, row 1\./);
	// Down passes Gamma, the next widget below in Alpha's columns.
	await page.keyboard.press("ArrowDown");
	await expect(liveRegion(page)).toHaveText("Column 1, row 9.");
	await page.keyboard.press("Shift+ArrowRight");
	await expect(liveRegion(page)).toHaveText("7 columns wide, 4 rows tall.");
	await page.keyboard.press("Enter");
	await expect(liveRegion(page)).toHaveText(/^Dropped Alpha at column 1, row 9\./);
	await expect(bar).toBeFocused();
	await expect(widgetTitles(page)).toHaveText(["Beta", "Gamma", "Alpha"]);
	expect((await box(page, "widget-w0")).width).toBeGreaterThan(beta.width);

	// One drop is one change: one undo puts everything back.
	await page.keyboard.press("Control+z");
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
	await expect.poll(async () => (await box(page, "widget-w0")).width).toBeCloseTo(beta.width, 0);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
});

test("Escape cancels a keyboard move", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	await titleBar(page, "Gamma").focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowUp");
	await expect(liveRegion(page)).toHaveText("Column 1, row 1.");
	await page.keyboard.press("Escape");
	await expect(liveRegion(page)).toHaveText("Cancelled. Gamma is back where it was.");
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
	await expect(page.getByTestId("drop-target")).toHaveCount(0);
});

test("a drop on the starter makes the copy", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	// The full-width third widget, up to the top.
	await titleBar(page, PLACEHOLDER, 2).focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Enter");

	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(liveRegion(page)).toHaveText(
		"Dropped Placeholder widget at column 1, row 1. 2 other widgets moved."
	);
	const moved = page.getByTestId("widget-starter-3");
	await expect(moved.getByRole("group", { name: PLACEHOLDER })).toBeFocused();
	const [third, first, second] = await Promise.all(
		["widget-starter-3", "widget-starter-1", "widget-starter-2"].map((id) => box(page, id))
	);
	expect(third.y).toBeLessThan(first.y);
	expect(first.y).toBe(second.y);
	expect(third.width).toBeGreaterThan(first.width);
	await expectSaved(page);
	await page.reload();
	expect((await box(page, "widget-starter-3")).y).toBeLessThan(
		(await box(page, "widget-starter-1")).y
	);
});

test.describe("phone width", () => {
	test.use({ viewport: { width: 400, height: 800 } });

	test("keyboard reorder", async ({ page }) => {
		await openSharedDoc(page, STACKED);
		await titleBar(page, "Gamma").focus();
		await page.keyboard.press("Enter");
		await expect(liveRegion(page)).toHaveText(/^Picked up Gamma\. Position 3 of 3\./);
		await page.keyboard.press("ArrowUp");
		await expect(liveRegion(page)).toHaveText("Position 2 of 3.");
		// Left and right do nothing on one column.
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("Enter");
		await expect(liveRegion(page)).toHaveText("Dropped Gamma at position 2 of 3.");
		await expect(titleBar(page, "Gamma")).toBeFocused();
		await expect(widgetTitles(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
		// One column: every widget is the grid's full width.
		const [alpha, gamma] = await Promise.all([box(page, "widget-w0"), box(page, "widget-w2")]);
		expect(gamma.width).toBeCloseTo(alpha.width, 0);
		await expectSaved(page);
		await page.reload();
		await expect(widgetTitles(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
	});
});

test("touch long-press drag", async ({ page }) => {
	await openSharedDoc(page, STACKED);
	const alpha = await box(page, "widget-w0");
	// Half the grid's width to the right: Gamma lands beside Alpha, at the top.
	await touchTitleBar(page, "Gamma", { dx: alpha.width + 12 });

	await expect(liveRegion(page)).toHaveText(/^Dropped Gamma at column 7, row 1\./);
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Gamma", "Beta"]);
});

test("touch: a short press doesn't lift the widget", async ({ page }) => {
	await openSharedDoc(page, STACKED);
	await touchTitleBar(page, "Gamma", { dx: 300, hold: 100 });
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
	await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
	await expect(nav(page).getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("touch: a long-press without sliding selects, and Done finishes", async ({ page }) => {
	await openSharedDoc(page, STACKED);
	await touchTitleBar(page, "Gamma");
	const done = page.getByTestId("widget-w2").getByRole("button", { name: "Done" });
	await expect(done).toBeVisible();
	const size = await done.boundingBox();
	expect(size!.width).toBeGreaterThanOrEqual(44);
	expect(size!.height).toBeGreaterThanOrEqual(44);
	await done.click();
	await expect(done).toHaveCount(0);
	await expect(widgetTitles(page)).toHaveText(["Alpha", "Beta", "Gamma"]);
});

test("axe: picked-up state", async ({ page }) => {
	await openSharedDoc(page, SIDE_BY_SIDE);
	await titleBar(page, "Alpha").focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowRight");
	await expect(liveRegion(page)).toHaveText("Column 2, row 1.");
	await expect(page.getByTestId("drop-target")).toBeAttached();
	await expectNoViolations(page);
});

test("axe: a touch selection", async ({ page }) => {
	await openSharedDoc(page, STACKED);
	await touchTitleBar(page, "Gamma");
	await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
	await expectNoViolations(page);
});
