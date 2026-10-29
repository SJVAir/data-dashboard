import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	PLACEHOLDER,
	expectNoViolations,
	expectSaved,
	fullscreenFrame,
	liveRegion,
	openSharedDoc,
	sharedDoc,
	taskbar,
	taskbarItem,
	titleBar,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.describe("with reduced motion", () => {
	test.use({ reducedMotion: "reduce" });

	const DOC = sharedDoc(
		"Windowing",
		["Alpha", "Beta", "Gamma"],
		[
			{ x: 0, y: 0, w: 6, h: 4 },
			{ x: 6, y: 0, w: 6, h: 4 },
			{ x: 0, y: 4, w: 12, h: 4 }
		]
	);

	test("minimize and restore, with focus and announcements", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await expect(taskbar(page)).toBeHidden();

		await page.getByRole("button", { name: "Minimize Alpha" }).click();
		await expect(widgetTitles(page)).toHaveCount(2);
		await expect(taskbarItem(page, "Alpha")).toBeFocused();
		await expect(liveRegion(page)).toHaveText("Alpha minimized to taskbar.");

		// The ⋯ menu's Minimize item does the same.
		await widgetMenuItem(page, "Beta", "Minimize");
		await expect(widgetTitles(page)).toHaveCount(1);
		await expect(taskbarItem(page, "Beta")).toBeFocused();
		await expect(liveRegion(page)).toHaveText("Beta minimized to taskbar.");

		await taskbarItem(page, "Alpha").click();
		await expect(widgetTitles(page)).toHaveCount(2);
		await expect(titleBar(page, "Alpha")).toBeFocused();
		await expect(liveRegion(page)).toHaveText("Alpha restored.");
		await expect(taskbarItem(page, "Alpha")).toHaveCount(0);
		await expect(taskbarItem(page, "Beta")).toBeVisible();
	});

	test("undo of a minimize", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await page.getByRole("button", { name: "Minimize Alpha" }).click();
		await expect(taskbarItem(page, "Alpha")).toBeVisible();
		await page.keyboard.press("Control+z");
		await expect(taskbarItem(page, "Alpha")).toHaveCount(0);
		await expect(widgetTitles(page)).toHaveCount(3);
	});

	test("a minimize survives a reload", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await page.getByRole("button", { name: "Minimize Alpha" }).click();
		await expectSaved(page);
		await page.reload();
		await expect(taskbarItem(page, "Alpha")).toBeVisible();
		await expect(widgetTitles(page)).toHaveCount(2);
	});

	test("minimize on the starter makes the copy", async ({ page }) => {
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveCount(3);
		await page
			.getByRole("button", { name: `Minimize ${PLACEHOLDER}` })
			.first()
			.click();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page)).toHaveCount(2);
		await expect(taskbarItem(page, PLACEHOLDER)).toBeFocused();
	});

	test("two tabs minimizing different widgets", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await expectSaved(page);
		const other = await page.context().newPage();
		await other.goto(page.url());
		await expect(widgetTitles(other)).toHaveCount(3);

		await Promise.all([
			page.getByRole("button", { name: "Minimize Alpha" }).click(),
			other.getByRole("button", { name: "Minimize Beta" }).click()
		]);

		for (const tab of [page, other]) {
			await expect(taskbarItem(tab, "Alpha")).toBeVisible();
			await expect(taskbarItem(tab, "Beta")).toBeVisible();
			await expect(widgetTitles(tab)).toHaveCount(1);
			await expect(tab.getByRole("dialog", { name: "Changed in another tab" })).toBeHidden();
		}
		const order = async (tab: typeof page) =>
			(
				await taskbar(tab)
					.getByRole("button", { name: /^Restore / })
					.allTextContents()
			).map((t) => t.trim());
		await expect.poll(async () => (await order(page)).join()).toBe((await order(other)).join());
		expect(await order(page)).toHaveLength(2);
	});

	test("fullscreen open and exit by Escape, the close button, and Back", async ({ page }) => {
		await openSharedDoc(page, DOC);
		const dashboardUrl = page.url();

		// Escape.
		await page.getByRole("button", { name: "Show Alpha fullscreen" }).click();
		await expect(page).toHaveURL(`${dashboardUrl}?widget=w0`);
		await expect(fullscreenFrame(page)).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(dashboardUrl);
		await expect(fullscreenFrame(page)).toHaveCount(0);

		// The menu item, then the Exit button.
		await widgetMenuItem(page, "Beta", "Fullscreen");
		await expect(page).toHaveURL(`${dashboardUrl}?widget=w1`);
		await page.getByRole("button", { name: "Exit fullscreen" }).click();
		await expect(page).toHaveURL(dashboardUrl);
		await expect(widgetTitles(page)).toHaveCount(3);

		// Back.
		await page.getByRole("button", { name: "Show Gamma fullscreen" }).click();
		await expect(fullscreenFrame(page)).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(dashboardUrl);
		await expect(page.url()).not.toContain("widget");
		await expect(fullscreenFrame(page)).toHaveCount(0);
		await expect(widgetTitles(page)).toHaveCount(3);
		await expect(page.getByRole("button", { name: "Show Alpha fullscreen" })).toBeVisible();
	});

	test("a deep link to a fullscreen widget", async ({ page }) => {
		await openSharedDoc(page, DOC);
		const url = page.url();
		await page.goto(`${url}?widget=w1`);
		await expect(fullscreenFrame(page)).toBeVisible();
		await expect(fullscreenFrame(page).getByRole("heading", { name: "Beta" })).toBeVisible();
	});

	test("a deep link to a minimized widget", async ({ page }) => {
		await openSharedDoc(page, DOC);
		const url = page.url();
		await page.getByRole("button", { name: "Minimize Beta" }).click();
		await expectSaved(page);
		await page.goto(`${url}?widget=w1`);
		await expect(fullscreenFrame(page)).toBeVisible();
		await expect(fullscreenFrame(page).getByRole("heading", { name: "Beta" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(url);
		await expect(taskbarItem(page, "Beta")).toBeVisible();
	});

	test("a deep link to a missing widget", async ({ page }) => {
		await openSharedDoc(page, DOC);
		const url = page.url();
		await page.goto(`${url}?widget=nope`);
		await expect(page.getByText("That widget isn't on this dashboard anymore.")).toBeVisible();
		await expect(fullscreenFrame(page)).toHaveCount(0);
		await expect(page).toHaveURL(url);
		await expect(widgetTitles(page)).toHaveCount(3);
	});

	test("axe: taskbar", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await page.getByRole("button", { name: "Minimize Alpha" }).click();
		await expect(taskbarItem(page, "Alpha")).toBeVisible();
		await expectNoViolations(page);
	});

	test("axe: fullscreen", async ({ page }) => {
		await openSharedDoc(page, DOC);
		await page.getByRole("button", { name: "Show Alpha fullscreen" }).click();
		await expect(fullscreenFrame(page)).toBeVisible();
		await expectNoViolations(page);
	});
});

test("fullscreen animates without reduced motion", async ({ page, browserName }) => {
	test.skip(browserName !== "chromium", "Chromium only");
	await openSharedDoc(page, sharedDoc("Motion", ["Alpha", "Beta"]));
	await page.getByRole("button", { name: "Show Alpha fullscreen" }).click();
	const running = await fullscreenFrame(page).evaluate(
		(el) => el.getAnimations().filter((a) => a.playState === "running").length
	);
	expect(running).toBeGreaterThan(0);
});
