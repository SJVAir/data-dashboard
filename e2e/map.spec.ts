/**
 * The Map widget end to end, with real WebGL (MapLibre through map-sdk). MapTiler is stubbed with
 * a blank style (`e2e/maptiler.ts`; the test build has a dummy key), and the monitors and region
 * shapes come from the API fixtures: Fresno County's outline, and four monitors with PM2.5
 * readings (Drummond Street and the Science Building, Good, in Fresno County; Porterville,
 * Moderate, just south of it in Tulare County; Bakersfield, Unhealthy for Sensitive Groups, well
 * south). A tile draws only its places' monitors: a region's come from the region-scoped readings
 * (`e2e/map-data-server.ts`), monitor places' from the current list.
 *
 * What's on screen is read from map-sdk's summary line, which counts the monitors in view by level,
 * and from its feature list. Marks are read from the summary's selection line ("PM2.5: 1
 * selected"), which map-sdk keeps in step with the ring it draws.
 */
import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	expectNoViolations,
	expectSaved,
	fullscreenFrame,
	maria,
	nav,
	newBlankDashboard,
	openPicker,
	openSharedDoc,
	widgetMenuItem,
	widgetTitles
} from "./helpers";
import { routeMapMeta } from "./map-data-server";

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
/**
 * Drawn when the map shows Fresno County: its two monitors only (Porterville is in view, just
 * outside the county, but isn't drawn).
 */
const FRESNO_VIEW = "PM2.5: 2 Good";
/** Drawn when it shows Drummond Street, Porterville and Bakersfield: those three only. */
const THREE_VIEW = "PM2.5: 1 Good, 1 Moderate, 1 Unhealthy for Sensitive Groups";
/** In view when zoomed in twice on the county: Drummond Street only. */
const ZOOMED_VIEW = "PM2.5: 1 Good";

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

/** The map's selection line ("PM2.5: 1 selected"): how many monitors are marked. */
function selectionLine(map: Locator): Locator {
	return map.getByText(/^PM2\.5: (\d+ selected|Selection cleared)$/);
}

/** The GL map itself (MapView's region, inside the widget's). */
function glMap(map: Locator): Locator {
	return map.getByRole("region", { name: "Map", exact: true });
}

/** Drummond Street's reading card (map-sdk's pinned card). */
function readingCard(map: Locator): Locator {
	return map.getByRole("group", { name: "Fresno - Drummond Street" });
}

/** Opens the map's feature list (its List button) and returns the list. */
async function featureList(map: Locator): Promise<Locator> {
	// The List button shows only while focused (MapView `reveal: "focus"`), like a skip link.
	const button = map.getByRole("button", { name: "List of features on the map" });
	await button.focus();
	await button.press("Enter");
	const list = map.getByRole("listbox", { name: "Features on the map" });
	await expect(list).toBeVisible();
	return list;
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
	/** Zoomed in on the county's middle, the view leaves the Science Building out. */
	async function zoomIn(): Promise<void> {
		const button = map.getByRole("button", { name: "Zoom in" });
		await button.click();
		await button.click();
		await button.click();
		await expect(inView(map)).toHaveText(ZOOMED_VIEW);
	}
	// Only a refit brings back the county's view.
	await zoomIn();

	await enterFullscreen(page, map);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);

	await zoomIn();
	await fullscreenFrame(page).getByRole("button", { name: "Exit fullscreen" }).click();
	await expect(fullscreenFrame(page)).toHaveCount(0);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
});

test.describe("on a touch screen", () => {
	test.use({ hasTouch: true });
	// Firefox has no touch emulation in Playwright (`hasTouch` is ignored there).
	test.skip(({ browserName }) => browserName === "firefox", "no touch emulation");

	// map-sdk's pinned card (MapView `card`): a tap pins the reading, which then stays (a tap's
	// emulated `mouseout` hid the hover card right after the tap). A plain tap never marks (only
	// Shift-click or the card's Select do), so the tap only pins: the marks are unchanged.
	test("a tap on a monitor shows its reading", async ({ page }) => {
		await openSharedDoc(page, monitorDoc);
		const title = "PM2.5 · Fresno - Drummond Street";
		await expect(widgetTitles(page)).toHaveText([title]);
		const map = mapOf(page, title);
		await expect(inView(map)).toBeVisible();
		// A one-monitor map centers on its monitor.
		const box = (await glMap(map).boundingBox())!;
		await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		const card = readingCard(map);
		await expect(card).toBeVisible();
		// The reading stays (not just a flash between the tap's mousemove and its click).
		await page.waitForTimeout(1_000);
		await expect(card).toBeVisible({ timeout: 0 });
		await expect(card).toContainText("8");
		await expect(card).toContainText("Good");
		// Only pinned: nothing is marked, and the dashboard didn't change (nothing to undo).
		await expect(card.getByRole("button", { name: "Select" })).toBeVisible();
		await expect(selectionLine(map)).toHaveCount(0);
		await expect(widgetTitles(page)).toHaveText([title]);
		await expect(nav(page).getByRole("button", { name: "Undo" })).toBeDisabled();
		// Close takes it away.
		await card.getByRole("button", { name: "Close" }).click();
		await expect(card).toBeHidden();
	});
});

/** Somewhere in downtown Fresno (the point lookup answers ZIP 93721 for any point). */
const POSITION = { latitude: 36.7372, longitude: -119.7871 };

test("a point tile sends no coordinates and no MapTiler metrics", async ({
	page,
	context,
	mapTiler
}) => {
	const urls: string[] = [];
	page.on("request", (request) => urls.push(request.url()));
	await context.grantPermissions(["geolocation"]);
	await context.setGeolocation(POSITION);
	await addMap(page);

	await widgetMenuItem(page, FRESNO_MAP, "Change place");
	await picker(page).getByRole("button", { name: "Remove Fresno County" }).click();
	await picker(page).getByRole("button", { name: "Use my location" }).click();
	const title = "PM2.5 · ZIP 93721 (your location)";
	await expect(widgetTitles(page)).toHaveText([title]);
	const map = mapOf(page, title);
	// The point's region's monitors (ZIP 93721's: Drummond Street), and the pin (the focus area's
	// point, a list row named by its label). Read from the list, not the summary line: map-sdk
	// works the summary out again only when the view or the selection changes, and the view
	// doesn't move here (the fixtures' one outline frames ZIP 93721 as it did the county).
	const list = await featureList(map);
	await expect(list.getByRole("option")).toHaveText([/Fresno - Drummond Street/, /Your location/]);

	// MapTiler's SDK sends its usage report (POST api.maptiler.com/metrics) 2 s after a map is
	// made, unless telemetry is off: wait past that.
	await page.waitForTimeout(3_000);
	expect(mapTiler.seen.filter((url) => url === "api.maptiler.com/metrics")).toEqual([]);
	// The stub did see the map's other requests, so it was watching.
	expect(mapTiler.seen).toContain("api.maptiler.com/maps/streets-v4/style.json");
	// The monitors were asked for by region, and no request carried the point.
	expect(urls.some((url) => /\/monitors\/pm25\/at\/.*region=yd7ru/.test(url))).toBe(true);
	const coordinates = /36\.73|119\.78/;
	expect(urls.filter((url) => coordinates.test(decodeURIComponent(url)))).toEqual([]);
});

/** The basemap's color in the MapTiler stub's blank style (`fixtures/maptiler-style.json`). */
const BASEMAP = [0xdf, 0xe6, 0xe9];

/**
 * How much of `png` is the plain basemap, and how much is the basemap under the focus area's wash
 * (map-sdk's white at 55%), each as a share of its pixels. Decoded in a page of its
 * own (about:blank), so the test's page is untouched.
 */
async function basemapShares(
	browser: Browser,
	png: Buffer
): Promise<{ plain: number; washed: number }> {
	const probe = await browser.newPage();
	try {
		return await probe.evaluate(
			async ({ data, basemap }) => {
				const img = new Image();
				img.src = `data:image/png;base64,${data}`;
				await img.decode();
				const canvas = document.createElement("canvas");
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext("2d")!;
				ctx.drawImage(img, 0, 0);
				const px = ctx.getImageData(0, 0, img.width, img.height).data;
				const wash = basemap.map((c) => c + (255 - c) * 0.55);
				const near = (rgb: number[], to: number[]) => rgb.every((c, j) => Math.abs(c - to[j]) <= 3);
				let plain = 0;
				let washed = 0;
				for (let i = 0; i < px.length; i += 4) {
					const rgb = [px[i], px[i + 1], px[i + 2]];
					if (near(rgb, basemap)) plain++;
					else if (near(rgb, wash)) washed++;
				}
				const total = px.length / 4;
				return { plain: plain / total, washed: washed / total };
			},
			{ data: png.toString("base64"), basemap: BASEMAP }
		);
	} finally {
		await probe.close();
	}
}

test("a region tile shows its focus area and only its region's monitors", async ({
	page,
	browser
}) => {
	const urls: string[] = [];
	page.on("request", (request) => urls.push(request.url()));
	const map = await addMap(page);
	// The county's monitors were asked for by its server id.
	expect(urls.some((url) => /\/monitors\/pm25\/at\/.*region=r6phe/.test(url))).toBe(true);

	// The focus area: the county's outline, the surround washed. Both the plain basemap (in the
	// county) and the washed one (around it) cover a good part of the map.
	const canvas = map.locator("canvas");
	await expect
		.poll(async () => {
			const { plain, washed } = await basemapShares(browser, await canvas.screenshot());
			return Math.min(plain, washed);
		})
		.toBeGreaterThan(0.1);

	// Only the county's two monitors are listed, not Porterville, which is in view just south of it.
	const list = await featureList(map);
	await expect(list.getByRole("option")).toHaveText([
		/Fresno - Drummond Street/,
		/Science Building Room 74/
	]);
});

/** The Drummond Street monitor's id. */
const DRUMMOND = "4Mb0j33kTnS0qzeE4iDGWw";
const DRUMMOND_MAP = "PM2.5 · Fresno - Drummond Street";

test("Shift-click marks a monitor, the card's Remove unmarks it, and undo marks it again", async ({
	page
}) => {
	await openSharedDoc(page, monitorDoc);
	const map = mapOf(page, DRUMMOND_MAP);
	await expect(inView(map)).toHaveText("PM2.5: 1 Good");
	await expect(selectionLine(map)).toHaveCount(0);
	const gl = glMap(map);

	// A one-monitor map centers on its monitor: Shift-click there marks it (the ring).
	await gl.click({ modifiers: ["Shift"] });
	await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected");
	await expectSaved(page);

	// A plain click pins the card, which offers Remove; Remove unmarks.
	await gl.click();
	const card = readingCard(map);
	await card.getByRole("button", { name: "Remove" }).click();
	await expect(card.getByRole("button", { name: "Select" })).toBeVisible();
	await expect(map.getByText("PM2.5: 1 selected")).toHaveCount(0);

	// Undo marks it again; the list says so too.
	await page.keyboard.press("ControlOrMeta+z");
	await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected");
	await expect(card.getByRole("button", { name: "Remove" })).toBeVisible();
	await card.getByRole("button", { name: "Close" }).click();
	const list = await featureList(map);
	await expect(list.getByRole("option", { name: /^Fresno - Drummond Street/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
});

test.describe("shared by a live link", () => {
	test.use({ account: maria });

	test("a viewer sees the card and the saved mark, with no Select or Remove", async ({
		page,
		documentsServer
	}) => {
		const [widget] = monitorDoc.body.widgets;
		await openSharedDoc(page, {
			...monitorDoc,
			body: { widgets: [{ ...widget, options: { marks: [DRUMMOND] } }] }
		});
		await expect(nav(page).getByText("Saved to your account", { exact: true })).toBeVisible();
		await openPicker(page, monitorDoc.name);
		await page.getByRole("menuitem", { name: "Share…" }).click();
		const share = page.getByRole("dialog", { name: "Share dashboard" });
		await share.getByRole("button", { name: "Create link" }).click();
		const link = share.getByRole("textbox", { name: "Live link" });
		await expect(link).toHaveValue(/\/workspace\/shared\/[^/]+$/);
		const url = await link.inputValue();

		const viewer = await documentsServer.newDevice();
		viewer.account.set(null);
		await viewer.page.goto(url);
		const map = mapOf(viewer.page, DRUMMOND_MAP);
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		// The saved mark shows.
		await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected");

		// The card shows the reading, with no Select or Remove.
		const gl = glMap(map);
		await gl.click();
		const card = readingCard(map);
		await expect(card).toBeVisible();
		await expect(card).toContainText("Good");
		await expect(card.getByRole("button", { name: /^(Select|Remove)$/ })).toHaveCount(0);
		await card.getByRole("button", { name: "Close" }).click();
		await expect(card).toBeHidden();

		// Shift-click changes nothing: the mark stays.
		await gl.click({ modifiers: ["Shift"] });
		await viewer.page.waitForTimeout(1_000);
		await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected", { timeout: 0 });
	});
});

test.describe("with ozone and smoke and fire in the metadata", () => {
	test.beforeEach(async ({ context }) => {
		await routeMapMeta(context);
	});

	test("Get data adds ozone and smoke and fire to a Map, and both stay", async ({ page }) => {
		const map = await addMap(page);
		await widgetMenuItem(page, FRESNO_MAP, "Edit data");
		await expect(page.getByRole("heading", { level: 1, name: "Edit data" })).toBeVisible();
		await page.getByRole("checkbox", { name: "Ozone" }).check();
		await page.getByRole("checkbox", { name: "Smoke and fire" }).check();
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		await expectSaved(page);

		await page.reload();
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		// Still PM2.5 on show, with today's smoke and fire drawn over the county.
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: /^Smoke, Light/ })).toHaveCount(1);
		await expect(list.getByRole("option", { name: /^2 fire detections/ })).toHaveCount(1);
		await page.keyboard.press("Escape");

		await widgetMenuItem(page, FRESNO_MAP, "Edit data");
		await expect(page.getByRole("heading", { level: 1, name: "Edit data" })).toBeVisible();
		await expect(page.getByRole("checkbox", { name: "PM2.5" })).toBeChecked();
		await expect(page.getByRole("checkbox", { name: "Ozone" })).toBeChecked();
		await expect(page.getByRole("checkbox", { name: "Smoke and fire" })).toBeChecked();
	});
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

test("a map scrolled off screen and back draws again", async ({ page }) => {
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
