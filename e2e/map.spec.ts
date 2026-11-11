/**
 * The Map widget end to end, with real WebGL (MapLibre through map-sdk). MapTiler is stubbed with
 * a blank style (`e2e/maptiler.ts`; the test build has a dummy key), and the monitors and region
 * shapes come from the API fixtures: Fresno County's outline, and four monitors with PM2.5
 * readings (Drummond Street and the Science Building, Good, in Fresno County; Porterville,
 * Moderate, just south of it; Bakersfield, Unhealthy for Sensitive Groups, well south).
 *
 * What's on screen is read from map-sdk's summary line, which counts the monitors in view by level.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	expectNoViolations,
	fullscreenFrame,
	nav,
	newBlankDashboard,
	openSharedDoc,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

// Firefox in Playwright's container (CI and `test:e2e:podman`) has no WebGL, so a map can only
// show its error state there; these tests skip, saying why, in a browser without it. The probe
// runs in a page of its own, so the test's page is untouched.
test.beforeEach(async ({ browser }) => {
	const probe = await browser.newPage();
	const webgl = await probe.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
	await probe.close();
	test.skip(!webgl, "This browser has no WebGL here, so it can't draw a map");
});

const FRESNO_MAP = "PM2.5 · Fresno County";
const THREE_MAP = "PM2.5 · 3 places";
/** In view when the map frames Fresno County: its two monitors and Porterville, not Bakersfield. */
const FRESNO_VIEW = "PM2.5: 2 Good, 1 Moderate";
/** In view when it frames Drummond Street, Porterville and Bakersfield (and the Science Building). */
const THREE_VIEW = "PM2.5: 2 Good, 1 Moderate, 1 Unhealthy for Sensitive Groups";

/** The map of the widget titled `title` (its region, which holds the GL map and its UI). */
function mapOf(page: Page, title: string): Locator {
	return page.getByRole("region", { name: `${title} map`, exact: true });
}

/**
 * The map's summary line: the monitors in view, counted by level (not the selection's line, "PM2.5:
 * 3 selected" or "PM2.5: Selection cleared").
 */
function inView(map: Locator): Locator {
	return map.getByText(/^PM2\.5: \d+ (?!selected$)/);
}

function picker(page: Page): Locator {
	return page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
}

/** Searches the open picker for `query` and picks the monitor named `name`. */
async function pickMonitor(page: Page, query: string, name: string): Promise<void> {
	await picker(page).getByRole("combobox", { name: "Search for a place" }).fill(query);
	await picker(page)
		.getByRole("listbox", { name: "Places found" })
		.getByRole("group", { name: "Monitors" })
		.getByRole("option", { name: new RegExp(`^${name}`) })
		.click();
}

/** A new blank dashboard with a Map added from Add widget, drawn and framed. */
async function addMap(page: Page): Promise<Locator> {
	await newBlankDashboard(page);
	await page.getByRole("button", { name: "Add widget" }).click();
	await page.getByRole("menuitem", { name: "Map", exact: true }).click();
	await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
	const map = mapOf(page, FRESNO_MAP);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
	return map;
}

/** A shared dashboard holding one Map on the Drummond Street monitor. */
const monitorDoc = {
	kind: "dashboard",
	schemaVersion: 1,
	id: "shared-map-1",
	name: "Monitor map",
	body: {
		widgets: [
			{
				id: "w0",
				type: "map",
				title: null,
				rect: { x: 0, y: 0, w: 6, h: 6 },
				data: {
					layers: [
						{
							dataset: "air-quality",
							entryType: "pm25",
							place: { kind: "monitor", id: "4Mb0j33kTnS0qzeE4iDGWw" }
						}
					]
				}
			}
		]
	}
};

test("adds a Map from Add widget at the dashboard's place", async ({ page, mapTiler }) => {
	await newBlankDashboard(page);
	await page.getByRole("button", { name: "Add widget" }).click();
	await expect(page.getByRole("menuitem", { name: "Map", exact: true })).toHaveCount(1);
	await page.getByRole("menuitem", { name: "Map", exact: true }).click();

	await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
	const map = mapOf(page, FRESNO_MAP);
	await expect(map.locator("canvas")).toBeVisible();
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
	await expect(map.getByRole("region", { name: "Legend" })).toBeVisible();
	// The basemap came from the stub.
	expect(mapTiler.stubbed).toContain("api.maptiler.com/maps/streets-v4/style.json");
});

test("the picker frames three monitors, and undo brings the region back", async ({ page }) => {
	await addMap(page);

	await widgetMenuItem(page, FRESNO_MAP, "Change place");
	await expect(picker(page)).toHaveAccessibleName("Choose places");
	await picker(page).getByRole("button", { name: "Remove Fresno County" }).click();
	await pickMonitor(page, "fre", "Fresno - Drummond Street");
	await pickMonitor(page, "por", "Porterville-NFS");
	await pickMonitor(page, "bak", "Bakersfield - California Avenue");
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(picker(page)).toBeHidden();

	await expect(widgetTitles(page)).toHaveText([THREE_MAP]);
	await expect(inView(mapOf(page, THREE_MAP))).toHaveText(THREE_VIEW);

	await nav(page).getByRole("button", { name: "Undo" }).click();
	await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
	await expect(inView(mapOf(page, FRESNO_MAP))).toHaveText(FRESNO_VIEW);
});

/** Shows the Map fullscreen and waits until its GL map has grown into the bigger frame. */
async function enterFullscreen(page: Page, map: Locator): Promise<Locator> {
	const small = (await map.boundingBox())!;
	await page.getByRole("button", { name: `Show ${FRESNO_MAP} fullscreen` }).click();
	const frame = fullscreenFrame(page);
	await expect(frame.getByRole("region", { name: `${FRESNO_MAP} map` })).toBeVisible();
	await expect
		.poll(async () => (await map.boundingBox())?.width ?? 0)
		.toBeGreaterThan(small.width * 1.5);
	return frame;
}

test("fullscreen keeps the map", async ({ page }) => {
	const map = await addMap(page);
	const canvas = await map.locator("canvas").elementHandle();

	const frame = await enterFullscreen(page, map);
	// The same GL map, not a new one.
	expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
	await expect(inView(map)).toBeVisible();

	await frame.getByRole("button", { name: "Exit fullscreen" }).click();
	await expect(fullscreenFrame(page)).toHaveCount(0);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
	expect(await canvas!.evaluate((el) => el.isConnected)).toBe(true);
});

// FIXME (the widget, not this test): fullscreen doesn't refit. The spec ("Resizing": the map
// waits for `ancestorAnimationsSettled` before refitting) has the map refit after the fullscreen
// animation, but MapWidget only fits when its places change or the map re-attaches, and
// fullscreen keeps the same mounted map. In fullscreen it stays at the small widget's zoom, so
// the county sits small in the middle and Bakersfield comes into view (seen 2026-11-11).
test.fixme("fullscreen refits the map to its places", async ({ page }) => {
	const map = await addMap(page);
	await enterFullscreen(page, map);
	// Past the summary's debounce (750 ms), so the line describes the bigger view. At the small
	// widget's camera, the bigger view would take in Bakersfield too.
	await page.waitForTimeout(1_000);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
});

test.describe("on a touch screen", () => {
	test.use({ hasTouch: true });
	// Firefox has no touch emulation in Playwright (`hasTouch` is ignored there).
	test.skip(({ browserName }) => browserName === "firefox", "no touch emulation");

	// FIXME (map-sdk change 4, the pinned card): a tap doesn't reliably leave the reading showing.
	// The tap's emulated mousemove shows map-sdk's hover tooltip, and it's gone again right after
	// the tap's click (Chromium, every run). Yet the same test passes on Chromium and WebKit when
	// anything is evaluated in the page before it navigates, so emulation decides the outcome, not
	// the map. Hover isn't a dependable tap path; the pinned card (shown on click or tap) is. Not
	// worked around in the dashboard (seen 2026-11-11).
	test.fixme("a tap on a monitor shows its reading", async ({ page }) => {
		await openSharedDoc(page, monitorDoc);
		const title = "PM2.5 · Fresno - Drummond Street";
		await expect(widgetTitles(page)).toHaveText([title]);
		const map = mapOf(page, title);
		await expect(inView(map)).toBeVisible();
		// A one-monitor map centers on its monitor.
		const gl = map.getByRole("region", { name: "Map", exact: true });
		const box = (await gl.boundingBox())!;
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		// The reading stays (not just a flash between the tap's mousemove and its click).
		await page.waitForTimeout(1_000);
		const tooltip = page.getByRole("tooltip");
		await expect(tooltip).toBeVisible({ timeout: 0 });
		await expect(tooltip).toContainText("Fresno - Drummond Street");
		await expect(tooltip).toContainText("8");
		await expect(tooltip).toContainText("Good");
	});
});

test("a Map raises no CSP violation", async ({ page }) => {
	// The fixture fails the test on any violation; let the map's requests settle first.
	const map = await addMap(page);
	await expect(map.locator("canvas")).toBeVisible();
	await page.waitForLoadState("networkidle");
});

for (const colorScheme of ["light", "dark"] as const) {
	test(`a dashboard with a Map has no WCAG 2.2 AA violations (${colorScheme})`, async ({
		page
	}) => {
		await page.emulateMedia({ colorScheme });
		await addMap(page);
		await expectNoViolations(page);
	});
}
