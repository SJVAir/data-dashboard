import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { readTokens } from "../src/lib/theme/tokens";
import { expect, test } from "./fixtures";
import { STARTER_TITLES, widgetTitles } from "./helpers";

const CSS = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
const DARK_BACKGROUND = readTokens(CSS, "dark-system")["--background"];

test.use({ reducedMotion: "reduce" });

type Probe = Window & {
	__firstPaint?: { background: string; expected: string; mounted: boolean };
	__themeAtMount?: string | null;
};

/** Picks a theme in the Help menu ("Light", "Dark", or "Match my device"). */
async function chooseTheme(page: Page, name: string): Promise<void> {
	await page.getByRole("button", { name: "Help" }).click();
	await page.getByRole("menuitemradio", { name }).click();
	// A radio item keeps the menu open (to compare modes); Escape closes it.
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toBeHidden();
}

/** The `<meta name="theme-color">` content, and the page's computed `--background` beside it. */
async function themeColor(page: Page) {
	return page.evaluate(() => ({
		meta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
		background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
	}));
}

test.describe("system dark, no saved choice", () => {
	test.use({ colorScheme: "dark" });

	test("the first paint is already dark, before the app mounts", async ({ page }) => {
		// Measured in the first frame after DOMContentLoaded: the browser doesn't render until the
		// stylesheet in the head has loaded (WebKit may run `app.js` before it applies), and the
		// app, a dynamic import, hasn't mounted. The body's background paints the page (`<html>`
		// has none of its own).
		await page.addInitScript((expected) => {
			document.addEventListener("DOMContentLoaded", () => {
				requestAnimationFrame(() => {
					const probe = document.createElement("i");
					probe.style.backgroundColor = expected;
					document.body.append(probe);
					(window as Probe).__firstPaint = {
						background: getComputedStyle(document.body).backgroundColor,
						expected: getComputedStyle(probe).backgroundColor,
						mounted: !!document.getElementById("SJVAirDataDashboard")?.firstChild
					};
					probe.remove();
				});
			});
		}, DARK_BACKGROUND);
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
		const first = await page.evaluate(() => (window as Probe).__firstPaint);
		expect(first).toBeDefined();
		expect(first!.mounted).toBe(false);
		expect(first!.background).toBe(first!.expected);
		await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
	});

	test("the theme-color meta follows the computed background after load", async ({ page }) => {
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
		// The meta exists once the built stylesheet has loaded, and carries the computed color.
		const dark = await themeColor(page);
		expect(dark.meta).toBeTruthy();
		expect(dark.meta).toBe(dark.background);
		await chooseTheme(page, "Light");
		const light = await themeColor(page);
		expect(light.meta).toBe(light.background);
		expect(light.meta).not.toBe(dark.meta);
	});
});

test("a chosen theme survives a reload, set before the app mounts", async ({ page }) => {
	await page.addInitScript(() => {
		new MutationObserver((_records, observer) => {
			const mount = document.getElementById("SJVAirDataDashboard");
			if (mount && mount.firstChild) {
				(window as Probe).__themeAtMount = document.documentElement.getAttribute("data-theme");
				observer.disconnect();
			}
		}).observe(document, { childList: true, subtree: true });
	});
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
	await chooseTheme(page, "Light");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await page.reload();
	await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
	expect(await page.evaluate(() => (window as Probe).__themeAtMount)).toBe("light");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("switching in one page updates another page of the same browser", async ({
	page,
	context
}) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
	const other = await context.newPage();
	await other.goto("./dashboards");
	await expect(other.getByRole("heading", { level: 1, name: "Your dashboards" })).toBeVisible();
	await chooseTheme(page, "Dark");
	await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
	await chooseTheme(page, "Match my device");
	await expect(other.locator("html")).not.toHaveAttribute("data-theme", /./);
});

// Blocked storage: `localStorage` throws on access (IndexedDB still opens).
test("with storage blocked, the app boots and the switch still works", async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			get() {
				throw new DOMException("Blocked", "SecurityError");
			}
		});
	});
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length);
	await chooseTheme(page, "Dark");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await chooseTheme(page, "Light");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
