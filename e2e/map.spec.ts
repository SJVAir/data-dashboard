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
// show its error state there: these tests skip there, saying why. Chromium and WebKit must have
// WebGL, and fail without it. Asked once per worker, in a page of its own (about:blank, no
// requests), so the tests' pages are untouched.
test.beforeAll(async ({ browser, browserName }) => {
	const probe = await browser.newPage();
	const webgl = await probe.evaluate(() => {
		const canvas = document.createElement("canvas");
		return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
	});
	await probe.close();
	if (browserName === "firefox") {
		test.skip(!webgl, "Firefox has no WebGL here, so it can't draw a map");
		return;
	}
	expect(webgl, `${browserName} has no WebGL, so it can't draw a map`).toBe(true);
});

const FRESNO_MAP = "PM2.5 · Fresno County";
const THREE_MAP = "PM2.5 · 3 places";
/** In view when the map frames Fresno County: its two monitors and Porterville, not Bakersfield. */
const FRESNO_VIEW = "PM2.5: 2 Good, 1 Moderate";
/**
 * In view when it frames Drummond Street, Porterville and Bakersfield, or is zoomed out from the
 * county: all four monitors.
 */
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

test("fullscreen refits the map to its places, and so does leaving it", async ({ page }) => {
	const map = await addMap(page);
	const zoomOut = map.getByRole("button", { name: "Zoom out" });
	// Zoomed out, the view takes in Bakersfield too; only a refit brings back the county's view.
	await zoomOut.click();
	await expect(inView(map)).toHaveText(THREE_VIEW);

	await enterFullscreen(page, map);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);

	await zoomOut.click();
	await expect(inView(map)).toHaveText(THREE_VIEW);
	await fullscreenFrame(page).getByRole("button", { name: "Exit fullscreen" }).click();
	await expect(fullscreenFrame(page)).toHaveCount(0);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
});

test.describe("on a touch screen", () => {
	test.use({ hasTouch: true });
	// Firefox has no touch emulation in Playwright (`hasTouch` is ignored there).
	test.skip(({ browserName }) => browserName === "firefox", "no touch emulation");

	// map-sdk's pinned card (MapView `card`): a tap pins the reading, which then stays (a tap's
	// emulated `mouseout` hid the hover card right after the tap). The monitors take no selection
	// from the map (selection mode "none"), so the tap only pins: the layer is unchanged.
	test("a tap on a monitor shows its reading", async ({ page }) => {
		await openSharedDoc(page, monitorDoc);
		const title = "PM2.5 · Fresno - Drummond Street";
		await expect(widgetTitles(page)).toHaveText([title]);
		const map = mapOf(page, title);
		await expect(inView(map)).toBeVisible();
		// A one-monitor map centers on its monitor.
		const gl = map.getByRole("region", { name: "Map", exact: true });
		const box = (await gl.boundingBox())!;
		// The monitor place is highlighted (one selected) before the tap, and only it after.
		const selected = map.getByText(/^PM2\.5: \d+ selected$/);
		await expect(selected).toHaveText("PM2.5: 1 selected");
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		const card = map.getByRole("group", { name: "Fresno - Drummond Street" });
		await expect(card).toBeVisible();
		// The reading stays (not just a flash between the tap's mousemove and its click).
		await page.waitForTimeout(1_000);
		await expect(card).toBeVisible({ timeout: 0 });
		await expect(card).toContainText("8");
		await expect(card).toContainText("Good");
		// Only pinned: the selection is as it was, and the dashboard didn't change (nothing to undo).
		await expect(selected).toHaveText("PM2.5: 1 selected");
		await expect(widgetTitles(page)).toHaveText([title]);
		await expect(nav(page).getByRole("button", { name: "Undo" })).toBeDisabled();
		// Close takes it away.
		await card.getByRole("button", { name: "Close" }).click();
		await expect(card).toBeHidden();
	});
});

test("no MapTiler metrics request after a map draws", async ({ page, mapTiler }) => {
	const map = await addMap(page);
	await expect(map.locator("canvas")).toBeVisible();
	// MapTiler's SDK sends its usage report (POST api.maptiler.com/metrics) 2 s after a map is
	// made, unless telemetry is off: wait past that.
	await page.waitForTimeout(3_000);
	expect(mapTiler.seen.filter((url) => url === "api.maptiler.com/metrics")).toEqual([]);
	// The stub did see the map's other requests, so it was watching.
	expect(mapTiler.seen).toContain("api.maptiler.com/maps/streets-v4/style.json");
});

/** A shared dashboard with the Fresno County Map at the top and a tall Note below it. */
const tallDoc = {
	kind: "dashboard",
	schemaVersion: 1,
	id: "shared-map-tall",
	name: "Tall map",
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
							place: { kind: "region", type: "county", code: "06019" }
						}
					]
				}
			},
			{
				id: "w1",
				type: "note",
				title: null,
				rect: { x: 0, y: 6, w: 6, h: 40 },
				data: { layers: [] },
				options: { text: "Below the map" }
			}
		]
	}
};

// FIXME (map-sdk): detaching an off-screen map throws in map-sdk's MapTooltip (beta.7 and beta.8):
// with `tooltip="pointer"`, its `zoomstart` cleanup reads the `gl` prop after MapView has set it to
// null ("Cannot read properties of null (reading 'off')"), and the map never comes back. Taking
// `gl` into a local in that effect fixes it (checked by patching it locally: this test passes).
// Not worked around in the dashboard; lift when map-sdk ships the fix (seen 2026-11-11).
test.fixme("a map scrolled off screen and back draws again", async ({ page }) => {
	await openSharedDoc(page, tallDoc);
	const map = mapOf(page, FRESNO_MAP);
	await expect(map.locator("canvas")).toBeVisible();
	await expect(inView(map)).toHaveText(FRESNO_VIEW);

	// Off screen (past the Note's bottom) for longer than the detach delay (5 s): the GL map goes.
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	await expect(map).not.toBeInViewport();
	await expect(map.locator("canvas")).toHaveCount(0, { timeout: 15_000 });

	// Back on screen: a new GL map, drawing its monitors again.
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(map).toBeInViewport();
	await expect(map.locator("canvas")).toBeVisible();
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
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
