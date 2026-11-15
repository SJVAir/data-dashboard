/**
 * The Map widget end to end, with real WebGL (MapLibre through map-sdk). MapTiler is stubbed with
 * a blank style (`e2e/maptiler.ts`; the test build has a dummy key), and the monitors and region
 * shapes come from the API fixtures: Fresno County's outline, and four monitors with PM2.5
 * readings (Drummond Street and the Science Building, Good, in Fresno County; Porterville,
 * Moderate, just south of it in Tulare County; Bakersfield, Unhealthy for Sensitive Groups, well
 * south). The Science Building is inactive and indoors, so a Map draws it only once the toolbar's
 * Inactive and Inside are on (both off by default). A tile draws only its places' monitors: a region's come from the region-scoped readings
 * (`e2e/map-data-server.ts`), monitor places' from the current list.
 *
 * What's on screen is read from map-sdk's summary line, which counts the monitors in view by level,
 * and from its feature list. Marks are read from the summary's selection line ("PM2.5: 1
 * selected"), which map-sdk keeps in step with the ring it draws.
 */
import type { Browser, Locator, Page } from "@playwright/test";
import type { AccountUser } from "../src/lib/account/identity";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
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
import { routeMapMeta, routeMapReadings, routeOneOutline } from "./map-data-server";

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
 * Drawn when the map shows Fresno County: Drummond Street only (Porterville is in view, just
 * outside the county, but isn't drawn; the Science Building is inactive and indoors).
 */
const FRESNO_VIEW = "PM2.5: 1 Good";
/** Drawn when it shows Fresno County with Inactive and Inside on: its two monitors. */
const FRESNO_ALL_VIEW = "PM2.5: 2 Good";
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

const FRESNO_COUNTY = { kind: "region", type: "county", code: "06019" };

/**
 * A shared dashboard holding one full-width Map of Fresno County's PM2.5 (wide enough for the
 * toolbar's dropdowns), with `more` layers after it.
 */
function wideDoc(more: Array<Record<string, string>> = []) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-map-wide",
		name: "County map",
		body: {
			widgets: [
				{
					id: "w0",
					type: "map",
					title: null,
					rect: { x: 0, y: 0, w: 12, h: 8 },
					data: {
						layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO_COUNTY }, ...more]
					}
				}
			]
		}
	};
}

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

/**
 * Turns the toolbar's Inactive and Inside on (the Monitors dropdown on a wide map, the Map
 * Options panel on a narrow one), then closes it.
 */
async function showInactiveAndInside(map: Locator): Promise<void> {
	const toolbar = map.getByRole("group", { name: "Map options", exact: true });
	const open = toolbar.getByRole("button", { name: "Open map options", exact: true });
	const monitors = toolbar.getByRole("button", { name: "Monitors", exact: true });
	// The layout settles a frame after mount.
	await expect(open.or(monitors).first()).toBeVisible();
	const narrow = await open.isVisible();
	if (narrow) {
		await open.click();
		await expect(open).toHaveAttribute("aria-expanded", "true");
	}
	// The Monitors dropdown, or the panel's Monitors section.
	await monitors.click();
	await expect(monitors).toHaveAttribute("aria-expanded", "true");
	await toolbar.getByRole("checkbox", { name: "Inactive", exact: true }).check();
	await toolbar.getByRole("checkbox", { name: "Inside", exact: true }).check();
	await map.page().keyboard.press("Escape");
	await expect(narrow ? open : monitors).toHaveAttribute("aria-expanded", "false");
}

/** The map's options toolbar (map-sdk's `OptionsToolbar`). */
function toolbarOf(map: Locator): Locator {
	return map.getByRole("group", { name: "Map options", exact: true });
}

/**
 * Opens the wide toolbar's dropdown named `name` (its group: Monitors, Layers, Settings, or the
 * pollutant showing), unless it's open already.
 */
async function openMenu(map: Locator, name: string): Promise<void> {
	const button = toolbarOf(map).getByRole("button", { name, exact: true });
	// The layout settles a frame after mount.
	await expect(button).toBeVisible();
	if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
	await expect(button).toHaveAttribute("aria-expanded", "true");
}

/**
 * Switches AirNow off in the Monitors dropdown. It's the only type in its group, so the group's
 * own checkbox (Reference-grade) goes off with it, and folds its rows away.
 */
async function hideAirNow(map: Locator): Promise<void> {
	await openMenu(map, "Monitors");
	await toolbarOf(map).getByRole("checkbox", { name: "AirNow", exact: true }).click();
	await expect(referenceGrade(map)).not.toBeChecked();
}

/** The Monitors group's Reference-grade checkbox (on while AirNow is). */
function referenceGrade(map: Locator): Locator {
	return toolbarOf(map).getByRole("checkbox", { name: "Reference-grade", exact: true });
}

/** The Settings dropdown's Basemap select (its value is the variant id drawn). */
function basemapSelect(map: Locator): Locator {
	return toolbarOf(map).getByRole("combobox", { name: "Basemap", exact: true });
}

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
	await showInactiveAndInside(map);
	await expect(inView(map)).toHaveText(FRESNO_ALL_VIEW);
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
	await expect(inView(map)).toHaveText(FRESNO_ALL_VIEW);

	await zoomIn();
	await fullscreenFrame(page).getByRole("button", { name: "Exit fullscreen" }).click();
	await expect(fullscreenFrame(page)).toHaveCount(0);
	await expect(inView(map)).toHaveText(FRESNO_ALL_VIEW);
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
	// point, a list row named by its label), read from the feature list.
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

test("the view summary follows a refresh while the view stays still", async ({
	page,
	context,
	browser
}) => {
	// A fake clock, to bring the next poll (every 3 minutes) on at once.
	await page.clock.install();
	const map = await addMap(page);
	const before = await map.locator("canvas").screenshot();

	// The server's next readings for the county add Porterville (Moderate).
	await routeMapReadings(context, "pm25", ["4Mb0j33kTnS0qzeE4iDGWw", "6qEHS0fITHOQYHLN4c9GKA"]);
	await page.clock.fastForward("04:00");
	await expect(inView(map)).toHaveText("PM2.5: 1 Good, 1 Moderate");
	await expectStill(browser, map, before);
});

test("the view summary follows a place change that leaves the view still", async ({
	page,
	context,
	browser
}) => {
	// Every region gets the county's outline, so the city of Fresno frames as the county does.
	await routeOneOutline(context);
	const map = await addMap(page);
	await showInactiveAndInside(map);
	await expect(inView(map)).toHaveText(FRESNO_ALL_VIEW);
	const before = await map.locator("canvas").screenshot();

	// The city holds Drummond Street only.
	await widgetMenuItem(page, FRESNO_MAP, "Change place");
	await picker(page).getByRole("button", { name: "Remove Fresno County" }).click();
	await picker(page).getByRole("combobox", { name: "Search for a place" }).fill("fre");
	await picker(page)
		.getByRole("listbox", { name: "Places found" })
		.getByRole("group", { name: "Places" })
		.getByRole("option", { name: /^Fresno(?! County| Unified)/ })
		.click();
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(picker(page)).toBeHidden();
	await expect(widgetTitles(page)).toHaveText([/^PM2\.5 · (?!Fresno County)/]);
	const after = page.getByRole("region", { name: /^PM2\.5 · .+ map$/ });
	await expect(inView(after)).toHaveText("PM2.5: 1 Good");
	await expectStill(browser, after, before);
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

/**
 * How many of the pixels of `a` and `b` (same-sized PNGs) differ in kind: plain basemap, basemap
 * under the focus area's wash, or anything else. A camera move shifts the focus area's edge and
 * the wash with it; a few markers coming or going change only their own pixels.
 */
async function washDifference(browser: Browser, a: Buffer, b: Buffer): Promise<number> {
	const probe = await browser.newPage();
	try {
		return await probe.evaluate(
			async ({ pngs, basemap }) => {
				const wash = basemap.map((c) => c + (255 - c) * 0.55);
				const near = (rgb: number[], to: number[]) => rgb.every((c, j) => Math.abs(c - to[j]) <= 3);
				const kinds = await Promise.all(
					pngs.map(async (data) => {
						const img = new Image();
						img.src = `data:image/png;base64,${data}`;
						await img.decode();
						const canvas = document.createElement("canvas");
						canvas.width = img.width;
						canvas.height = img.height;
						const ctx = canvas.getContext("2d")!;
						ctx.drawImage(img, 0, 0);
						const px = ctx.getImageData(0, 0, img.width, img.height).data;
						const out = new Uint8Array(px.length / 4);
						for (let i = 0; i < px.length; i += 4) {
							const rgb = [px[i], px[i + 1], px[i + 2]];
							out[i / 4] = near(rgb, basemap) ? 1 : near(rgb, wash) ? 2 : 0;
						}
						return out;
					})
				);
				const [x, y] = kinds;
				if (x.length !== y.length) return 1;
				let differ = 0;
				for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) differ++;
				return differ / x.length;
			},
			{ pngs: [a.toString("base64"), b.toString("base64")], basemap: BASEMAP }
		);
	} finally {
		await probe.close();
	}
}

/**
 * Checks that the camera didn't move since `before` (a screenshot of the map's canvas): there is no
 * handle on the GL map's center and zoom in E2E, so the focus area's wash stands in for them. It
 * must cover the same pixels, give or take the markers (under 2% of the map).
 */
async function expectStill(browser: Browser, map: Locator, before: Buffer): Promise<void> {
	const canvas = map.locator("canvas");
	// The focus area is part of the comparison, so it must be drawn.
	expect((await basemapShares(browser, before)).washed).toBeGreaterThan(0.05);
	await expect
		.poll(async () => washDifference(browser, before, await canvas.screenshot()))
		.toBeLessThan(0.02);
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
		.toBeGreaterThan(0.05);

	// Only the county's two monitors are listed, not Porterville, which is in view just south of it
	// (the Science Building once Inactive and Inside are on).
	await showInactiveAndInside(map);
	const list = await featureList(map);
	await expect(list.getByRole("option")).toHaveText([
		/Fresno - Drummond Street/,
		/Science Building Room 74/
	]);
});

/** Another account, viewing Maria's live link. */
const sam: AccountUser = {
	id: "q2Xr7VbcS0mWm2pTj9Lk3A",
	full_name: "Sam Chen",
	email: "sam@example.com",
	phone: null,
	phone_verified: false,
	language: "en"
};

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

	// A one-monitor map centers on its monitor: Shift-click there marks it (the ring), and leaves
	// the reading card closed.
	await gl.click({ modifiers: ["Shift"] });
	await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected");
	await expectSaved(page);
	await expect(readingCard(map)).toBeHidden({ timeout: 0 });

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

	/** Saves `doc` to Maria's account, shares it, and returns its live link. */
	async function liveLinkTo(page: Page, doc: { name: string }): Promise<string> {
		await openSharedDoc(page, doc as typeof monitorDoc);
		await expect(nav(page).getByText("Saved to your account", { exact: true })).toBeVisible();
		await openPicker(page, doc.name);
		await page.getByRole("menuitem", { name: "Share…" }).click();
		const share = page.getByRole("dialog", { name: "Share dashboard" });
		await share.getByRole("button", { name: "Create link" }).click();
		const link = share.getByRole("textbox", { name: "Live link" });
		await expect(link).toHaveValue(/\/workspace\/shared\/[^/]+$/);
		return link.inputValue();
	}

	test("a viewer's toolbar changes stay in the page, and Make a copy keeps them", async ({
		page,
		documentsServer
	}) => {
		const url = await liveLinkTo(page, wideDoc());
		// Signed in as someone else, so Make a copy uploads: the listener's positive control.
		const viewer = await documentsServer.newDevice();
		viewer.account.set(sam);
		// Every write the viewer's page sends to the documents API.
		const writes: string[] = [];
		viewer.page.on("request", (request) => {
			const { pathname } = new URL(request.url());
			if (request.method() !== "GET" && pathname.includes("/api/2.0/documents/")) {
				writes.push(`${request.method()} ${pathname}`);
			}
		});
		await viewer.page.goto(url);
		const map = mapOf(viewer.page, FRESNO_MAP);
		await expect(inView(map)).toHaveText(FRESNO_VIEW);

		// A type and the basemap: both drawn.
		await hideAirNow(map);
		await expect(inView(map)).toHaveCount(0);
		await openMenu(map, "Settings");
		await basemapSelect(map).selectOption({ label: "Satellite" });
		await expect(basemapSelect(map)).toHaveValue("satellite-v4");
		// Past the autosave delay (500 ms): nothing was sent, and the owner's document is as it was.
		await viewer.page.waitForTimeout(1_500);
		expect(writes).toEqual([]);
		const token = url.split("/").pop()!;
		documentsServer.fake.signedInAs = null;
		const shared = await documentsServer.fake.shared(token);
		expect(shared.version).toBe(1);
		expect((shared.body as typeof monitorDoc.body).widgets[0]).not.toHaveProperty("options");

		// The copy keeps both.
		await viewer.page.getByRole("button", { name: "Make a copy" }).click();
		await expect(viewer.page).toHaveURL(DASHBOARD_URL);
		// The copy's upload went through the same listener, so it was listening.
		await expect(
			nav(viewer.page).getByText("Saved to your account", { exact: true })
		).toBeVisible();
		expect(writes.length).toBeGreaterThan(0);
		const copy = mapOf(viewer.page, FRESNO_MAP);
		await expect(copy.locator("canvas")).toBeVisible();
		await openMenu(copy, "Settings");
		await expect(basemapSelect(copy)).toHaveValue("satellite-v4");
		await openMenu(copy, "Monitors");
		await expect(referenceGrade(copy)).not.toBeChecked();
		await expect(inView(copy)).toHaveCount(0);
	});

	test("a viewer sees the card and the saved mark, with no Select or Remove", async ({
		page,
		documentsServer
	}) => {
		const [widget] = monitorDoc.body.widgets;
		const url = await liveLinkTo(page, {
			...monitorDoc,
			body: { widgets: [{ ...widget, options: { marks: [DRUMMOND] } }] }
		});

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

	test("the toolbar's changes are one undo step each, and stay after a reload", async ({
		page,
		mapTiler
	}) => {
		await openSharedDoc(
			page,
			wideDoc([
				{ dataset: "air-quality", entryType: "o3" },
				{ dataset: "hms-smoke" },
				{ dataset: "hms-fire" }
			])
		);
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		// Named after its title, which follows the pollutant showing.
		const map = page.getByRole("region", { name: / · Fresno County map$/ });
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		const toolbar = toolbarOf(map);
		const fireAndSmoke = toolbar.getByRole("checkbox", { name: "Fire & Smoke", exact: true });
		const undo = nav(page).getByRole("button", { name: "Undo" });
		const redo = nav(page).getByRole("button", { name: "Redo" });
		await expect(undo).toBeDisabled();

		// A type: AirNow off takes Drummond Street away.
		await hideAirNow(map);
		await expect(inView(map)).toHaveCount(0);
		// Fire & Smoke hidden.
		await openMenu(map, "Layers");
		await fireAndSmoke.click();
		await expect(fireAndSmoke).not.toBeChecked();
		// The basemap.
		await openMenu(map, "Settings");
		await basemapSelect(map).selectOption({ label: "Satellite" });
		await expect(basemapSelect(map)).toHaveValue("satellite-v4");
		expect(mapTiler.stubbed).toContain("api.maptiler.com/maps/satellite-v4/style.json");
		// The pollutant.
		await openMenu(map, "PM2.5");
		await toolbar.getByRole("radio", { name: /^Ozone/ }).click();
		await expect(widgetTitles(page)).toHaveText(["Ozone · Fresno County"]);
		await expectSaved(page);

		// Four changes, four undo steps, back to where it opened.
		for (let i = 0; i < 4; i++) await undo.click();
		await expect(undo).toBeDisabled();
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		await openMenu(map, "Settings");
		await expect(basemapSelect(map)).toHaveValue("streets-v4");
		await openMenu(map, "Layers");
		await expect(fireAndSmoke).toBeChecked();
		await openMenu(map, "Monitors");
		await expect(referenceGrade(map)).toBeChecked();

		// Redone, saved, and kept after a reload.
		for (let i = 0; i < 4; i++) await redo.click();
		await expect(redo).toBeDisabled();
		await expect(widgetTitles(page)).toHaveText(["Ozone · Fresno County"]);
		await expectSaved(page);
		await page.reload();
		await expect(widgetTitles(page)).toHaveText(["Ozone · Fresno County"]);
		await openMenu(map, "Settings");
		await expect(basemapSelect(map)).toHaveValue("satellite-v4");
		await openMenu(map, "Layers");
		await expect(fireAndSmoke).not.toBeChecked();
		// Back on PM2.5, AirNow is still off.
		await openMenu(map, "Ozone");
		await toolbar.getByRole("radio", { name: /^PM2\.5/ }).click();
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		await openMenu(map, "Monitors");
		await expect(referenceGrade(map)).not.toBeChecked();
		await expect(inView(map)).toHaveCount(0);
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

/** Opens a narrow map's options panel (waiting for the layout) and returns its open button. */
async function openPanel(map: Locator): Promise<Locator> {
	const open = toolbarOf(map).getByRole("button", { name: "Open map options", exact: true });
	// The narrow layout settles a frame after mount.
	await expect(open).toBeVisible();
	await open.click();
	await expect(open).toHaveAttribute("aria-expanded", "true");
	await expect(toolbarOf(map).getByRole("region", { name: "Map Options" })).toBeVisible();
	return open;
}

test("a narrow Map's options open in a panel, and Esc closes it and returns focus", async ({
	page
}) => {
	// A half-width tile is narrower than the wide toolbar's 48rem.
	const map = await addMap(page);
	const open = await openPanel(map);
	const toolbar = toolbarOf(map);
	await expect(toolbar.getByRole("button", { name: "Close map options" })).toBeFocused();
	await toolbar.getByRole("button", { name: "Monitors", exact: true }).click();
	await expect(toolbar.getByRole("checkbox", { name: "Inactive", exact: true })).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(open).toHaveAttribute("aria-expanded", "false");
	await expect(toolbar.getByRole("region", { name: "Map Options" })).toBeHidden();
	await expect(open).toBeFocused();
});

for (const colorScheme of ["light", "dark"] as const) {
	test(`a dashboard with a Map has no WCAG 2.2 AA violations (${colorScheme})`, async ({
		page
	}) => {
		await page.emulateMedia({ colorScheme });
		await addMap(page);
		await expectNoViolations(page);
	});

	test(`a Map's open toolbar has no WCAG 2.2 AA violations (${colorScheme})`, async ({
		page,
		context
	}) => {
		await routeMapMeta(context);
		await page.emulateMedia({ colorScheme });
		// Wide: a dropdown open.
		await openSharedDoc(page, wideDoc([{ dataset: "hms-smoke" }, { dataset: "hms-fire" }]));
		const wide = mapOf(page, FRESNO_MAP);
		await expect(inView(wide)).toHaveText(FRESNO_VIEW);
		await openMenu(wide, "Monitors");
		await expectNoViolations(page);
		await openMenu(wide, "Settings");
		await expectNoViolations(page);

		// Narrow: the panel open, with its Monitors section.
		const narrow = await addMap(page);
		await openPanel(narrow);
		await toolbarOf(narrow).getByRole("button", { name: "Monitors", exact: true }).click();
		await expect(
			toolbarOf(narrow).getByRole("checkbox", { name: "Inactive", exact: true })
		).toBeVisible();
		await expectNoViolations(page);
	});
}
