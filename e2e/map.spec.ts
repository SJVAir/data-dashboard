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
	AIR_QUALITY_SECTION,
	DASHBOARD_URL,
	expectNoViolations,
	expectSaved,
	fullscreenFrame,
	maria,
	nav,
	newBlankDashboard,
	openPicker,
	openSection,
	openSharedDoc,
	widgetMenuItem,
	widgetTitles,
	type SharedDocument
} from "./helpers";
import {
	NOTICE_COMMODITY,
	NOTICES_META,
	routeMapDays,
	routeMapPeriods,
	routeMapFill,
	routeMapFillPeriods,
	routeMapMeta,
	routeMapNotices,
	routeMapReadings,
	routeMapLocations,
	routeMapUse,
	routeOneOutline,
	EVERY_MONITOR_TYPE,
	ROOSEVELT_PLACE,
	USE_CATALOG,
	USE_FILE,
	useFixtures,
	type NoticeFixture,
	type NoticesRequests,
	type UseRequests
} from "./map-data-server";

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

const FRESNO_MAP = "PM2.5 map · Fresno County";
const TWO_MAP = "PM2.5 map · 2 places";
/**
 * Drawn when the map shows Fresno County: Drummond Street only (Porterville is in view, just
 * outside the county, but isn't drawn; the Science Building is inactive and indoors).
 */
const FRESNO_VIEW = "PM2.5: 1 Good";
/** Drawn when it shows Fresno County with Inactive and Inside on: its two monitors. */
const FRESNO_ALL_VIEW = "PM2.5: 2 Good";
/** In view when zoomed in twice on the county: Drummond Street only. */
const ZOOMED_VIEW = "PM2.5: 1 Good";

/** The map of the widget titled `title` (its region, which holds the GL map and its UI). */
function mapOf(page: Page, title: string): Locator {
	return page.getByRole("region", { name: title, exact: true });
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

/** Opens the map's feature list (its List button), unless it's open, and returns the list. */
async function featureList(map: Locator): Promise<Locator> {
	const list = map.getByRole("listbox", { name: "Features on the map" });
	if (await list.isVisible()) return list;
	// The List button shows only while focused (MapView `reveal: "focus"`), like a skip link.
	const button = map.getByRole("button", { name: "List of features on the map" });
	await button.focus();
	await button.press("Enter");
	await expect(list).toBeVisible();
	return list;
}

function picker(page: Page): Locator {
	return page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
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

/** A shared dashboard holding one Map of the Drummond Street monitor (searched, no Where). */
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
							monitors: ["4Mb0j33kTnS0qzeE4iDGWw"]
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
function wideDoc(more: Array<Record<string, unknown>> = [], dateRange?: Record<string, unknown>) {
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
						place: FRESNO_COUNTY,
						layers: [
							{ dataset: "air-quality", entryType: "pm25", monitorTypes: EVERY_MONITOR_TYPE },
							...more
						],
						...(dateRange && { dateRange })
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

test("a Map from Add widget has every monitor type ticked in its Data Portal, and draws monitors", async ({
	page
}) => {
	await page.clock.install({ time: "2026-11-15T12:00:00-08:00" });
	const map = await addMap(page);
	await expect(inView(map)).toHaveText(FRESNO_VIEW);
	// A drawn monitor: a fixture monitor in Fresno County is a row of the feature list.
	const list = await featureList(map);
	await expect(list.getByRole("option", { name: /Fresno - Drummond Street/ })).toBeVisible();
	await widgetMenuItem(page, FRESNO_MAP, "Open in Data Portal");
	await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
	await openSection(page, AIR_QUALITY_SECTION);
	const types = page.getByRole("group", { name: "Monitors" }).getByRole("checkbox");
	await expect(types.first()).toBeVisible();
	// Every type the Data Portal offers is ticked, among them each fixture network.
	await expect(page.getByRole("checkbox", { name: "AirNow" })).toBeChecked();
	await expect(page.getByRole("checkbox", { name: "PurpleAir" })).toBeChecked();
	for (const box of await types.all()) await expect(box).toBeChecked();
});

test("the picker frames two counties, offers no monitors, and undo brings the region back", async ({
	page
}) => {
	await addMap(page);

	await widgetMenuItem(page, FRESNO_MAP, "Change place");
	await expect(picker(page)).toHaveAccessibleName("Choose places");
	// Where holds areas, schools and "my location", never monitors.
	await picker(page).getByRole("combobox", { name: "Search for a place" }).fill("fre");
	const found = picker(page).getByRole("listbox", { name: "Places found" });
	await expect(found.getByRole("option", { name: /^Fresno County/ })).toBeVisible();
	await expect(found.getByRole("group", { name: "Monitors" })).toHaveCount(0);
	await picker(page).getByRole("combobox", { name: "Search for a place" }).fill("");
	await picker(page)
		.getByRole("button", { name: /^Counties/ })
		.click();
	await picker(page)
		.getByRole("grid", { name: "Places in this list" })
		.getByRole("row", { name: /Tulare County/ })
		.click();
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(picker(page)).toBeHidden();

	await expect(widgetTitles(page)).toHaveText([TWO_MAP]);
	await expect(inView(mapOf(page, TWO_MAP))).toHaveText(/^PM2\.5: \d/);

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
	await expect(frame.getByRole("region", { name: FRESNO_MAP, exact: true })).toBeVisible();
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
		const title = "PM2.5 map · Fresno - Drummond Street";
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
	const title = "PM2.5 map · ZIP 93721 (your location)";
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
	await expect(widgetTitles(page)).toHaveText([/^PM2\.5 map · (?!Fresno County)/]);
	const after = page.getByRole("region", { name: /^PM2\.5 map · .+$/ });
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
 * must cover the same pixels, give or take the markers (under 2% of the map). `style` is CSS for
 * both screenshots, such as hiding an open card that moves.
 */
async function expectStill(
	browser: Browser,
	map: Locator,
	before: Buffer,
	style?: string
): Promise<void> {
	const canvas = map.locator("canvas");
	// The focus area is part of the comparison, so it must be drawn.
	expect((await basemapShares(browser, before)).washed).toBeGreaterThan(0.05);
	await expect
		.poll(async () => washDifference(browser, before, await canvas.screenshot({ style })))
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
const DRUMMOND_MAP = "PM2.5 map · Fresno - Drummond Street";

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

/** The Pacific date every day test's clock stands on (noon), whatever zone the machine is in. */
const TODAY = "2026-11-15T12:00:00-08:00";
/** Fresno County's Drummond Street monitor, by day: Good, Moderate, then Unhealthy for Sensitive Groups. */
const DAYS = {
	"2026-11-09": { figures: { [DRUMMOND]: 5 } },
	"2026-11-10": { figures: { [DRUMMOND]: 20 }, smoke: true },
	"2026-11-11": { figures: { [DRUMMOND]: 40 } }
};
const PAST_RANGE = { kind: "custom", start: "2026-11-09", end: "2026-11-11" };

test.describe("shared by a live link", () => {
	test.use({ account: maria });

	/** Saves `doc` to Maria's account, shares it, and returns its live link. */
	async function liveLinkTo(page: Page, doc: SharedDocument): Promise<string> {
		await openSharedDoc(page, doc);
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

	test("a viewer steps through the days with nothing sent, and Make a copy keeps the day", async ({
		page,
		documentsServer
	}) => {
		const url = await liveLinkTo(page, wideDoc([], PAST_RANGE));
		const viewer = await documentsServer.newDevice();
		viewer.account.set(sam);
		await routeMapDays(viewer.context, DAYS);
		await viewer.page.clock.install({ time: TODAY });
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
		const slider = daySlider(viewer.page);
		await expect(slider).toHaveAttribute("aria-valuetext", /November 11, 2026$/);

		// The stepper is live for a viewer: a button, a key, and the data follows.
		await viewer.page.getByRole("button", { name: "Previous day" }).click();
		await expect(slider).toHaveAttribute("aria-valuetext", /November 10, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Moderate");
		await slider.focus();
		await viewer.page.keyboard.press("Home");
		await expect(slider).toHaveAttribute("aria-valuetext", /November 9, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		// Past the autosave delay (500 ms): nothing was sent, and the owner's document is as it was.
		await viewer.page.waitForTimeout(1_500);
		expect(writes).toEqual([]);
		const token = url.split("/").pop()!;
		documentsServer.fake.signedInAs = null;
		const shared = await documentsServer.fake.shared(token);
		expect(shared.version).toBe(1);

		// Positive control: the copy's upload goes through the same listener.
		await viewer.page.getByRole("button", { name: "Make a copy" }).click();
		await expect(viewer.page).toHaveURL(DASHBOARD_URL);
		await expect(
			nav(viewer.page).getByText("Saved to your account", { exact: true })
		).toBeVisible();
		expect(writes.length).toBeGreaterThan(0);
		// The copy keeps the day the viewer stepped to.
		await expect(daySlider(viewer.page)).toHaveAttribute("aria-valuetext", /November 9, 2026$/);
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

/** The day stepper's slider, below the Map (its value text is the day's long date, or "Now"). */
function daySlider(page: Page): Locator {
	return page.getByRole("slider", { name: "Day", exact: true });
}

/** The map's smoke line ("Wildfire Smoke: 1 Light", or "0 Wildfire Smoke"): the plumes of the day showing. */
function smokeCount(map: Locator): Locator {
	return map.getByText(/^(\d+ Wildfire Smoke|Wildfire Smoke: .+)$/);
}

test.describe("a Map's days", () => {
	test.beforeEach(async ({ context, page }) => {
		await routeMapMeta(context);
		await routeMapDays(context, DAYS);
		await page.clock.install({ time: TODAY });
	});

	test("steps through a past range's days with keys and buttons, with each day's monitors and smoke", async ({
		page
	}) => {
		await openSharedDoc(
			page,
			wideDoc([{ dataset: "hms-smoke" }, { dataset: "hms-fire" }], PAST_RANGE)
		);
		const map = mapOf(page, FRESNO_MAP);
		const slider = daySlider(page);
		// A past range opens on its last day.
		await expect(slider).toHaveAttribute("aria-valuetext", /November 11, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Unhealthy for Sensitive Groups");

		// Buttons: the day before (Moderate, with the day's smoke), then the first (Good).
		await page.getByRole("button", { name: "Previous day" }).click();
		await expect(slider).toHaveAttribute("aria-valuetext", /November 10, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Moderate");
		await expect(smokeCount(map)).toHaveText("Wildfire Smoke: 1 Light");
		await page.getByRole("button", { name: "Previous day" }).click();
		await expect(slider).toHaveAttribute("aria-valuetext", /November 9, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		await expect(page.getByRole("button", { name: "Previous day" })).toBeDisabled();
		// A day with no smoke draws none.
		await expect(smokeCount(map)).toHaveText("0 Wildfire Smoke");

		// Keys on the slider: End and Home go to the last and first day, arrows one day.
		await slider.focus();
		await page.keyboard.press("End");
		await expect(slider).toHaveAttribute("aria-valuetext", /November 11, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Unhealthy for Sensitive Groups");
		await page.keyboard.press("ArrowLeft");
		await expect(slider).toHaveAttribute("aria-valuetext", /November 10, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Moderate");
		await page.keyboard.press("Home");
		await expect(slider).toHaveAttribute("aria-valuetext", /November 9, 2026$/);
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		await page.keyboard.press("ArrowRight");
		await expect(slider).toHaveAttribute("aria-valuetext", /November 10, 2026$/);
		await page.getByRole("button", { name: "Next day" }).click();
		await expect(slider).toHaveAttribute("aria-valuetext", /November 11, 2026$/);
		await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
	});

	test("a Monthly Map steps by month with the keys, each month's figure drawn, the current month last, so far and not final", async ({
		context,
		page
	}) => {
		// Drummond Street's average of 24-hour averages: October Moderate; November so far Good,
		// its nightly row not final; September has no row.
		await routeMapPeriods(context, {
			"2026-10-01": { figures: { [DRUMMOND]: 20 } },
			"2026-11-01": { figures: { [DRUMMOND]: 5 }, final: false }
		});
		const doc = wideDoc([], { kind: "custom", start: "2026-09-01", end: "2026-11-30" });
		Object.assign(doc.body.widgets[0].data, { resolution: "month" });
		await openSharedDoc(page, doc);
		const map = mapOf(page, FRESNO_MAP);
		const slider = page.getByRole("slider", { name: "Month" });
		// The current month is the last stop (no Now at Monthly), so far and not final yet.
		await expect(slider).toHaveAttribute("aria-valuetext", "November 2026 so far, not final yet");
		await expect(page.locator("[data-day-label]")).toHaveText("November 2026 so far");
		await expect(page.locator("[data-day-status]")).toContainText("Not final yet");
		await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		// The figure is named by the scale's period_statistic_label: in the legend, with the units
		// under the title (in place of "(µg/m³)"), and in the feature list's note, above the rows.
		const legend = legendOf(map);
		await expect(legend.getByRole("heading", { level: 3 })).toHaveText("PM2.5");
		await expect(
			legend.getByText("µg/m³ · Average of 24-hour averages", { exact: true })
		).toBeVisible();
		await featureList(map);
		await expect(map.getByText("Average of 24-hour averages", { exact: true })).toBeVisible();
		await closeFeatureList(map);

		await slider.focus();
		await page.keyboard.press("ArrowLeft");
		await expect(slider).toHaveAttribute("aria-valuetext", "October 2026");
		await expect(slider).toBeFocused();
		await expect(inView(map)).toHaveText("PM2.5: 1 Moderate");
		await page.keyboard.press("Home");
		await expect(slider).toHaveAttribute("aria-valuetext", "September 2026");
		await expect(slider).toBeFocused();
		await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
		// No row for September: the month says so.
		await expect(page.getByRole("status").getByText("No figures for this month")).toBeVisible();
		await page.keyboard.press("End");
		await expect(slider).toHaveAttribute("aria-valuetext", "November 2026 so far, not final yet");
		await expect(slider).toBeFocused();
	});

	test("a range with today opens on Now, and the days before it step back", async ({ page }) => {
		await openSharedDoc(
			page,
			wideDoc([], { kind: "custom", start: "2026-11-09", end: "2026-11-15" })
		);
		const map = mapOf(page, FRESNO_MAP);
		const slider = daySlider(page);
		await expect(slider).toHaveAttribute("aria-valuetext", "Now");
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();

		await page.getByRole("button", { name: "Previous day" }).click();
		// The day before today, which the fixtures hold no figures for: the note says so once the
		// day has loaded (so the empty count isn't the day still loading).
		await expect(slider).toHaveAttribute("aria-valuetext", /November 14, 2026$/);
		await expect(page.getByRole("status").getByText("No figures for this day")).toBeVisible();
		// The note is part of the map's name too.
		const noted = page.getByRole("region", {
			name: `${FRESNO_MAP}. No figures for this day`,
			exact: true
		});
		await expect(noted).toBeVisible();
		await expect(inView(noted)).toHaveCount(0);
		await slider.focus();
		await page.keyboard.press("End");
		await expect(slider).toHaveAttribute("aria-valuetext", "Now");
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
	});
});

test.describe("with ozone and smoke and fire in the metadata", () => {
	test.beforeEach(async ({ context }) => {
		await routeMapMeta(context);
	});

	test("Get data picks one pollutant for a Map and adds smoke and fire, and both stay", async ({
		page
	}) => {
		const map = await addMap(page);
		await widgetMenuItem(page, FRESNO_MAP, "Open in Data Portal");
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
		// One pollutant: Ozone replaces PM2.5, and PM2.5 comes back the same way.
		await openSection(page, AIR_QUALITY_SECTION);
		await page.getByRole("radio", { name: "Ozone" }).check();
		await expect(page.getByRole("radio", { name: "PM2.5" })).not.toBeChecked();
		await page.getByRole("radio", { name: "PM2.5" }).check();
		await openSection(page, /^Smoke and fire/);
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

		await widgetMenuItem(page, FRESNO_MAP, "Open in Data Portal");
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
		await openSection(page, AIR_QUALITY_SECTION);
		await expect(page.getByRole("radio", { name: "PM2.5" })).toBeChecked();
		await expect(page.getByRole("radio", { name: "Ozone" })).not.toBeChecked();
		await openSection(page, /^Smoke and fire/);
		await expect(page.getByRole("checkbox", { name: "Smoke and fire" })).toBeChecked();
	});

	test("the toolbar's changes are one undo step each, and stay after a reload", async ({
		page,
		mapTiler
	}) => {
		await openSharedDoc(page, wideDoc([{ dataset: "hms-smoke" }, { dataset: "hms-fire" }]));
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		// Named after its title, which follows its pollutant.
		const map = page.getByRole("region", { name: FRESNO_MAP, exact: true });
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
		// No pollutant choice: a Map holds one.
		await expect(toolbar.getByRole("button", { name: "PM2.5", exact: true })).toHaveCount(0);
		await expectSaved(page);

		// Three changes, three undo steps, back to where it opened.
		for (let i = 0; i < 3; i++) await undo.click();
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
		for (let i = 0; i < 3; i++) await redo.click();
		await expect(redo).toBeDisabled();
		await expectSaved(page);
		await page.reload();
		await expect(widgetTitles(page)).toHaveText([FRESNO_MAP]);
		await openMenu(map, "Settings");
		await expect(basemapSelect(map)).toHaveValue("satellite-v4");
		await openMenu(map, "Layers");
		await expect(fireAndSmoke).not.toBeChecked();
		// AirNow is still off.
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
					place: { kind: "region", type: "county", code: "06019" },
					layers: [
						{
							dataset: "air-quality",
							entryType: "pm25",
							monitorTypes: EVERY_MONITOR_TYPE
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

/** A county map with a ZIP code fill, over `range`. */
function fillDoc(range: Record<string, unknown>) {
	const doc = wideDoc([], range);
	Object.assign(doc.body.widgets[0], { options: { fill: "zipcode" } });
	return doc;
}

test.describe("a Map's region fill", () => {
	test.beforeEach(async ({ context, page }) => {
		await routeMapMeta(context);
		await routeMapDays(context, DAYS);
		await routeMapFill(context, {
			days: { "2026-11-11": { "93721": 5, "93722": 20 } },
			todayDate: "2026-11-15",
			today: { "93721": 8, "93722": 30 }
		});
		await page.clock.install({ time: TODAY });
	});

	/** The map's legend (map-sdk's own): one section for a pollutant, whoever draws it. */
	/** No WCAG 2.2 AA violations with the legend drawn, in light and then dark. */
	/** The map's summary line for the fill ("ZIP Codes, today so far: 1 Good, ..."). */
	function fillLine(map: Locator): Locator {
		return map.getByText(/^ZIP Codes(, today so far)?: /);
	}

	test("on Now the fill reads today so far, shares the legend and says No data where a ZIP has none", async ({
		page
	}) => {
		const zipRequests: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			if (url.searchParams.get("type") === "zipcode") zipRequests.push(url.pathname);
		});
		await openSharedDoc(page, fillDoc({ kind: "custom", start: "2026-11-09", end: "2026-11-15" }));
		const map = mapOf(page, FRESNO_MAP);
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", "Now");
		await expect(inView(map)).toHaveText(FRESNO_VIEW);

		// One legend section, titled by the pollutant once it has loaded (it starts with the scale's
		// label), shared by the monitors and the fill, with a No data row.
		const legend = legendOf(map);
		const titles = legend.getByRole("heading", { level: 3 });
		await expect(titles).toHaveCount(1);
		await expect(titles).toHaveText("PM2.5 (µg/m³)");
		await expect(legend.getByText("No data", { exact: true })).toBeVisible();
		await expectNoViolationsInBothThemes(page);

		// Today's figures so far; the ZIP with none reads No data (not a level).
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: "ZIP 93721, 8.0 µg/m³, Good" })).toHaveCount(1);
		await expect(list.getByRole("option", { name: "ZIP 93722, 30.0 µg/m³, Moderate" })).toHaveCount(
			1
		);
		await expect(list.getByRole("option", { name: "ZIP 93999, No data" })).toHaveCount(1);
		await page.keyboard.press("Escape");
		// The layer reads as today's so far.
		await expect(fillLine(map)).toHaveText(/^ZIP Codes, today so far: /);

		// The Layers row hides the fill and shows it again, with no new request.
		const requests = zipRequests.length;
		await openMenu(map, "Layers");
		const row = toolbarOf(map).getByRole("checkbox", { name: "ZIP Codes", exact: true });
		await expect(row).toBeChecked();
		await row.uncheck();
		await expect(fillLine(map)).toHaveCount(0);
		await expect(legend.getByText("No data", { exact: true })).toHaveCount(0);
		await row.check();
		await expect(fillLine(map)).toHaveText(/^ZIP Codes, today so far: /);
		await expect(legend.getByText("No data", { exact: true })).toBeVisible();
		// Held for a moment: a refetch fired late would still count.
		await page.waitForTimeout(1_000);
		expect(zipRequests.length).toBe(requests);
	});

	test("with no pollutant the fill is the ZIP codes' outlines, with no legend section and no figures", async ({
		page
	}) => {
		const summaries: string[] = [];
		page.on("request", (request) => {
			const url = new URL(request.url());
			// No figures for the fill, and none to name the place (looked up, not fetched).
			if (url.pathname.includes("summar")) summaries.push(url.pathname);
		});
		const doc = fillDoc({ kind: "custom", start: "2026-11-09", end: "2026-11-15" });
		const widget = doc.body.widgets[0] as Record<string, unknown> & {
			data: { layers: Record<string, unknown>[] };
		};
		// None keeps the ticks with no entry type. Its generated title names what it shows.
		delete widget.data.layers[0].entryType;
		await openSharedDoc(page, doc);
		const map = mapOf(page, "ZIP Codes map · Fresno County");
		await expect(map).toBeVisible();
		// Every ZIP is listed, with no figure.
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: "ZIP 93721, No data" })).toHaveCount(1);
		await expect(list.getByRole("option", { name: "ZIP 93999, No data" })).toHaveCount(1);
		await page.keyboard.press("Escape");
		// No legend section for the outlines (map-sdk's own legend, with a null scale).
		await expect(legendOf(map).getByRole("heading", { level: 3 })).toHaveCount(0);
		await expect(legendOf(map).getByText("ZIP Codes")).toHaveCount(0);
		expect(summaries).toEqual([]);
		await expectNoViolationsInBothThemes(page);
	});

	test("on a day the fill is the day's figures, and a ZIP with none reads No data", async ({
		page
	}) => {
		await openSharedDoc(page, fillDoc({ kind: "custom", start: "2026-11-09", end: "2026-11-11" }));
		const map = mapOf(page, FRESNO_MAP);
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", /November 11, 2026$/);
		// The day's monitor is drawn too (Drummond Street, USG that day), under the same one section.
		await expect(inView(map)).toHaveText("PM2.5: 1 Unhealthy for Sensitive Groups");
		const legend = legendOf(map);
		const titles = legend.getByRole("heading", { level: 3 });
		await expect(titles).toHaveCount(1);
		await expect(titles).toHaveText("PM2.5 (µg/m³)");
		await expect(legend.getByText("No data", { exact: true })).toBeVisible();
		await expectNoViolationsInBothThemes(page);
		// The day's fill: the layer is the day's, not today so far.
		await expect(fillLine(map)).toHaveText(/^ZIP Codes: /);

		const list = await featureList(map);
		await expect(list.getByRole("option", { name: "ZIP 93721, 5.0 µg/m³, Good" })).toHaveCount(1);
		await expect(list.getByRole("option", { name: "ZIP 93722, 20.0 µg/m³, Moderate" })).toHaveCount(
			1
		);
		await expect(list.getByRole("option", { name: "ZIP 93999, No data" })).toHaveCount(1);
		await page.keyboard.press("Escape");
	});

	test("on a day a thin ZIP says Not enough data, in its row and its hover card", async ({
		context,
		page
	}) => {
		// Routed after the beforeEach's, so it answers first: 93722 has a final row with no figure.
		await routeMapFill(context, {
			days: { "2026-11-11": { "93721": 5, "93722": null } },
			todayDate: "2026-11-15",
			today: { "93721": 8, "93722": 30 }
		});
		await openSharedDoc(page, fillDoc({ kind: "custom", start: "2026-11-09", end: "2026-11-11" }));
		const map = mapOf(page, FRESNO_MAP);
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", /November 11, 2026$/);
		await expect(fillLine(map)).toHaveText(/^ZIP Codes: /);

		// The thin ZIP's reason is in its accessible name; one with no row reads No data alone.
		const list = await featureList(map);
		await expect(
			list.getByRole("option", { name: "ZIP 93722, No data, Not enough data", exact: true })
		).toHaveCount(1);
		await expect(list.getByRole("option", { name: "ZIP 93999, No data", exact: true })).toHaveCount(
			1
		);
		await closeFeatureList(map);

		// The middle of the GL map (the county's framing) is inside ZIP 93722: its hover card says why.
		const box = (await glMap(map).boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		const tip = map.getByRole("tooltip");
		await expect(tip).toBeVisible();
		await expect(tip).toContainText("93722");
		await expect(tip).toContainText("Not enough data");
	});

	test("on a month the legend names the figure, and a thin ZIP says how many days had one", async ({
		context,
		page
	}) => {
		await routeMapPeriods(context, { "2026-10-01": { figures: { [DRUMMOND]: 20 } } });
		await routeMapFillPeriods(context, {
			"2026-10-01": { "93721": 5, "93722": { thin: [3, 31] } }
		});
		const doc = fillDoc({ kind: "custom", start: "2026-09-01", end: "2026-10-31" });
		Object.assign(doc.body.widgets[0].data, { resolution: "month" });
		await openSharedDoc(page, doc);
		const map = mapOf(page, FRESNO_MAP);
		await expect(page.getByRole("slider", { name: "Month" })).toHaveAttribute(
			"aria-valuetext",
			"October 2026"
		);
		// One section for the monitors and the fill: the units and the scale's
		// period_statistic_label on the line under the title, in place of "(µg/m³)".
		const legend = legendOf(map);
		const titles = legend.getByRole("heading", { level: 3 });
		await expect(titles).toHaveCount(1);
		await expect(titles).toHaveText("PM2.5");
		await expect(
			legend.getByText("µg/m³ · Average of 24-hour averages", { exact: true })
		).toBeVisible();
		await expect(legend.getByText("No data", { exact: true })).toBeVisible();
		await expectNoViolationsInBothThemes(page);

		// The thin ZIP's reason is in its accessible name; one with no row reads No data alone.
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: "ZIP 93721, 5.0 µg/m³, Good" })).toHaveCount(1);
		await expect(
			list.getByRole("option", {
				name: "ZIP 93722, No data, Only 3 of 31 days had a figure",
				exact: true
			})
		).toHaveCount(1);
		await expect(list.getByRole("option", { name: "ZIP 93999, No data", exact: true })).toHaveCount(
			1
		);
		await page.keyboard.press("Escape");
	});
});

/** A range ending today: it opens on Now, and Previous day steps to November 14. */
const NOTICES_RANGE = { kind: "custom", start: "2026-11-09", end: "2026-11-15" };
/**
 * The middle of Fresno County's fixture outline, which a county Map is framed on: the centre of
 * the GL map. Away from Drummond Street, the only monitor drawn.
 */
const COUNTY_MIDDLE: [number, number] = [-119.63965, 36.74635];
/** Now's notices: two in one section in the middle of the county, one in Tulare County. */
const NOTICES_NOW_FIXTURES: NoticeFixture[] = [
	{
		id: "ntc01",
		sectionId: "sec01",
		section: "MDM-T14S-R21E-10",
		county: "Fresno County",
		at: COUNTY_MIDDLE,
		scheduled: "2026-11-15T07:00:00-08:00"
	},
	{
		id: "ntc02",
		sectionId: "sec01",
		section: "MDM-T14S-R21E-10",
		county: "Fresno County",
		at: COUNTY_MIDDLE,
		scheduled: "2026-11-13T07:00:00-08:00"
	},
	{
		id: "ntc03",
		sectionId: "sec02",
		section: "MDM-T19S-R25E-22",
		county: "Tulare County",
		at: [-119.3, 36.3],
		scheduled: "2026-11-14T09:00:00-08:00"
	}
];
/** November 14's: one notice, in the west of the county, its window still open that day. */
const NOTICES_DAY_FIXTURES: NoticeFixture[] = [
	{
		id: "ntc04",
		sectionId: "sec03",
		section: "MDM-T15S-R15E-03",
		county: "Fresno County",
		at: [-120.2, 36.6],
		scheduled: "2026-11-12T08:00:00-08:00",
		past: false
	}
];
const NOW_SECTION = /^2 spray notices, MDM-T14S-R21E-10, Fresno County/;
const NOW_TULARE = /^1 spray notice, MDM-T19S-R25E-22, Tulare County/;
const DAY_SECTION = /^1 spray notice, MDM-T15S-R15E-03, Fresno County/;

/** Closes the map's open feature list with its List button (Esc closes it only from inside). */
async function closeFeatureList(map: Locator): Promise<void> {
	const button = map.getByRole("button", { name: "List of features on the map" });
	await button.focus();
	await button.press("Enter");
	await expect(map.getByRole("listbox", { name: "Features on the map" })).toBeHidden();
}

/** The map's legend (map-sdk's). */
function legendOf(map: Locator): Locator {
	return map.getByRole("region", { name: "Legend", exact: true });
}

async function expectNoViolationsInBothThemes(page: Page): Promise<void> {
	await page.emulateMedia({ colorScheme: "light" });
	await expectNoViolations(page);
	await page.emulateMedia({ colorScheme: "dark" });
	await expectNoViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
}

/**
 * Opens the map's feature list, Tabs into it (past its sort buttons) and moves its active row
 * down to the option named `name` with the arrow keys (the list keeps focus). Returns the list.
 */
async function toListRow(map: Locator, name: RegExp): Promise<Locator> {
	const list = await featureList(map);
	const row = list.getByRole("option", { name });
	await expect(row).toHaveCount(1);
	const page = map.page();
	for (let i = 0; i < 5 && !(await list.evaluate((el) => el === document.activeElement)); i++) {
		await page.keyboard.press("Tab");
	}
	await expect(list).toBeFocused();
	const target = (await row.getAttribute("id"))!;
	await page.keyboard.press("Home");
	const options = await list.getByRole("option").count();
	for (let i = 0; i < options; i++) {
		if ((await list.getAttribute("aria-activedescendant")) === target) break;
		await page.keyboard.press("ArrowDown");
	}
	await expect(list).toHaveAttribute("aria-activedescendant", target);
	return list;
}

test.describe("a Map's spray notices", () => {
	let noticesRequests: NoticesRequests;

	test.beforeEach(async ({ context, page }) => {
		await routeMapMeta(context);
		await routeMapDays(context, DAYS);
		noticesRequests = await routeMapNotices(context, {
			now: NOTICES_NOW_FIXTURES,
			"2026-11-14": NOTICES_DAY_FIXTURES
		});
		// Noon Pacific, as the other day tests: under Playwright's fake clock the app's Pacific
		// "today" follows the machine's zone (with the real clock it doesn't), so a later hour
		// would be the next day in New York or UTC.
		await page.clock.install({ time: TODAY });
	});

	/** A full-width Fresno County Map with spray notices (and `filters` on them), over a week to today. */
	function noticesDoc(filters?: Record<string, unknown>) {
		return wideDoc([{ dataset: "pesticide-notices", ...(filters && { filters }) }], NOTICES_RANGE);
	}

	function legendOf(map: Locator): Locator {
		return map.getByRole("region", { name: "Legend", exact: true });
	}

	/** The feature list's spray notice markers. */
	function noticeOptions(list: Locator): Locator {
		return list.getByRole("option", { name: /spray notices?, / });
	}

	async function expectNoViolationsInBothThemes(page: Page): Promise<void> {
		await page.emulateMedia({ colorScheme: "light" });
		await expectNoViolations(page);
		await page.emulateMedia({ colorScheme: "dark" });
		await expectNoViolations(page);
		await page.emulateMedia({ colorScheme: "light" });
	}

	test("notices on Now: the marker count, the legend row and the explainer", async ({ page }) => {
		await openSharedDoc(page, noticesDoc());
		const map = mapOf(page, FRESNO_MAP);
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", "Now");
		await expect(inView(map)).toHaveText(FRESNO_VIEW);

		// One marker per section, named by its count, section and county; drawn valley-wide, not
		// only in the county.
		const list = await featureList(map);
		await expect(noticeOptions(list)).toHaveCount(2);
		await expect(list.getByRole("option", { name: NOW_SECTION })).toHaveCount(1);
		await expect(list.getByRole("option", { name: NOW_TULARE })).toHaveCount(1);
		await closeFeatureList(map);

		// The legend's notices section: titled by the catalog's name for the layer (not the scale's),
		// the scale's one level, what a marker's number means, and the explainer linking out.
		const legend = legendOf(map);
		await expect(
			legend.getByRole("heading", { level: 3, name: NOTICES_META.catalogLabel, exact: true })
		).toBeVisible();
		await expect(legend.getByText("Spray notice", { exact: true })).toBeVisible();
		await expect(legend.getByText("Numbered: how many notices", { exact: true })).toBeVisible();
		await expect(legend.getByText(NOTICES_META.explainerSummary, { exact: true })).toBeVisible();
		await expect(
			legend.getByRole("link", { name: new RegExp(NOTICES_META.explainerTitle) })
		).toHaveAttribute("href", NOTICES_META.explainerSource);
		// Now's none-for-the-day line is a day's only.
		await expect(legend.getByText("No spray notices for this day")).toHaveCount(0);
		await expectNoViolationsInBothThemes(page);

		// Now asks with no date, valley-wide (no area). The day before is fetched ahead, by its
		// Pacific date.
		expect(noticesRequests.some((params) => !params.has("date"))).toBe(true);
		const dates = noticesRequests.flatMap((params) => params.getAll("date"));
		expect(dates.every((date) => date === "2026-11-14")).toBe(true);
		for (const params of noticesRequests) {
			expect(params.has("bbox")).toBe(false);
			expect(params.has("region")).toBe(false);
		}
	});

	test("notices follow a step to a past day", async ({ page }) => {
		await openSharedDoc(
			page,
			noticesDoc({ chemical: "gs65e", commodity: NOTICE_COMMODITY.id, category: ["fumigant"] })
		);
		// A day with no monitor figures adds its note to the map's name.
		const map = page.getByRole("region", { name: /^PM2\.5 map · Fresno County(?:\.|$)/ });
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", "Now");
		let list = await featureList(map);
		await expect(list.getByRole("option", { name: NOW_SECTION })).toHaveCount(1);
		await closeFeatureList(map);

		await page.getByRole("button", { name: "Previous day" }).click();
		// The Pacific day before today.
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", /November 14, 2026$/);
		list = await featureList(map);
		await expect(list.getByRole("option", { name: DAY_SECTION })).toHaveCount(1);
		await expect(noticeOptions(list)).toHaveCount(1);
		await closeFeatureList(map);

		// The day's request carries its Pacific date, and only the filters the notices take: the
		// chemical and category, never the commodity.
		const dated = noticesRequests.filter((params) => params.has("date"));
		expect(dated.map((params) => params.get("date"))).toContain("2026-11-14");
		for (const params of noticesRequests) {
			expect(params.get("chemical_id")).toBe("gs65e");
			expect(params.getAll("category")).toEqual(["fumigant"]);
			expect(params.has("commodity")).toBe(false);
			expect(params.has("commodity_id")).toBe(false);
		}

		// The legend names the filters that apply, and says the crop doesn't.
		const legend = legendOf(map);
		await expect(legend.getByText("Filtered by Sulfur · Fumigant", { exact: true })).toBeVisible();
		await expect(
			legend.getByText("Crop: doesn't apply to spray notices", { exact: true })
		).toBeVisible();
		await expect(legend.getByText("Grapes")).toHaveCount(0);
		await expectNoViolationsInBothThemes(page);

		// A day with none says so; the explainer stays.
		await page.getByRole("button", { name: "Previous day" }).click();
		await expect(daySlider(page)).toHaveAttribute("aria-valuetext", /November 13, 2026$/);
		await expect(legend.getByText("No spray notices for this day", { exact: true })).toBeVisible();
		await expect(legend.getByText(NOTICES_META.explainerSummary, { exact: true })).toBeVisible();
		await expectNoViolationsInBothThemes(page);
	});

	test("the notice card opens from the feature list by keyboard", async ({ page }) => {
		await openSharedDoc(page, noticesDoc());
		const map = mapOf(page, FRESNO_MAP);
		const list = await toListRow(map, NOW_SECTION);
		await page.keyboard.press("Enter");

		// The section's card, named by the marker, headed by its count of notices, with a row for each.
		const card = map.getByRole("group", { name: NOW_SECTION });
		await expect(card).toBeVisible();
		await expect(card.getByText("2 notices of intent", { exact: true })).toBeVisible();
		await expect(card.getByRole("listitem").getByRole("button")).toHaveCount(2);
		await expect(list).toBeFocused();

		// Esc in the list closes the card first; the list stays open.
		await page.keyboard.press("Escape");
		await expect(card).toBeHidden();
		await expect(list).toBeVisible();
	});

	// When focus leaves the feature list, the list clears the map's focused key and map-sdk asks for
	// the card's content again: the card must stay mounted, so the button Tab reached keeps focus.
	test("Tab from the feature list into a notice card keeps focus there", async ({ page }) => {
		await openSharedDoc(page, noticesDoc());
		const map = mapOf(page, FRESNO_MAP);
		await toListRow(map, NOW_SECTION);
		await page.keyboard.press("Enter");
		const card = map.getByRole("group", { name: NOW_SECTION });
		await expect(card.getByText("2 notices of intent", { exact: true })).toBeVisible();
		await page.keyboard.press("Tab");
		await expect(card.getByRole("listitem").getByRole("button").first()).toBeFocused({
			timeout: 2_000
		});
	});

	test("a notice's hover summary has nothing focusable, and its opened card does", async ({
		page
	}) => {
		await openSharedDoc(page, noticesDoc());
		const map = mapOf(page, FRESNO_MAP);
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: NOW_SECTION })).toHaveCount(1);
		await closeFeatureList(map);

		// The section's marker is in the middle of the GL map (the county's framing): hovered, it
		// shows the static summary, with nothing to focus.
		const box = (await glMap(map).boundingBox())!;
		const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		await page.mouse.move(middle.x, middle.y);
		const tip = map.getByRole("tooltip");
		await expect(tip).toBeVisible();
		await expect(tip).toContainText("2 notices of intent");
		await expect(tip).toContainText("MDM-T14S-R21E-10");
		const focusable = "a[href], button, input, select, textarea, [tabindex]";
		await expect(tip.locator(focusable)).toHaveCount(0);

		// A click pins the card: the same notices, now with a row for each and the SprayDays link.
		await page.mouse.click(middle.x, middle.y);
		const card = map.getByRole("group", { name: NOW_SECTION });
		await expect(card).toBeVisible();
		await expect(tip).toHaveCount(0);
		const rows = card.getByRole("listitem").getByRole("button");
		await expect(rows).toHaveCount(2);
		await expect(card.getByRole("link", { name: /Sign up with SprayDays/ })).toHaveAttribute(
			"href",
			NOTICES_META.signup
		);
		// A row opens its notice (the earliest first), focus moves to Back, and Back returns to
		// the list with focus on that row.
		await rows.first().focus();
		await page.keyboard.press("Enter");
		const back = card.getByRole("button", { name: "Back to all 2 notices" });
		await expect(back).toBeFocused();
		await expect(card.getByText("Method: Field fumigation", { exact: true })).toBeVisible();
		await expect(card.getByText("Example-chem", { exact: true })).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(card.getByText("2 notices of intent", { exact: true })).toBeVisible();
		await expect(rows.first()).toBeFocused();
		await expectNoViolationsInBothThemes(page);

		await card.getByRole("button", { name: "Close" }).click();
		await expect(card).toBeHidden();
	});

	test("the Layers row hides notices", async ({ page }) => {
		await openSharedDoc(page, noticesDoc());
		const map = mapOf(page, FRESNO_MAP);
		const legend = legendOf(map);
		const title = legend.getByRole("heading", {
			level: 3,
			name: NOTICES_META.catalogLabel,
			exact: true
		});
		await expect(title).toBeVisible();

		await openMenu(map, "Layers");
		const row = toolbarOf(map).getByRole("checkbox", {
			name: NOTICES_META.catalogLabel,
			exact: true
		});
		await expect(row).toBeChecked();
		await row.uncheck();
		await expect(title).toHaveCount(0);
		await expect(legend.getByText(NOTICES_META.explainerSummary)).toHaveCount(0);
		let list = await featureList(map);
		await expect(noticeOptions(list)).toHaveCount(0);
		// The monitors stay.
		await expect(list.getByRole("option", { name: /^Fresno - Drummond Street/ })).toHaveCount(1);
		await closeFeatureList(map);
		await expectSaved(page);

		await openMenu(map, "Layers");
		await row.check();
		await expect(title).toBeVisible();
		list = await featureList(map);
		await expect(noticeOptions(list)).toHaveCount(2);
		await closeFeatureList(map);
	});
});

/**
 * Pesticide use: a 5 × 5 grid of fake square townships centred on the county's middle (the GL
 * map's centre), `TST-T03S-R03E` the middle one, with 500 lbs (the top class). Use draws the
 * whole valley's townships under the section zoom, and the view's sections from it.
 */
const USE = useFixtures(COUNTY_MIDDLE);
const MIDDLE_TOWNSHIP = "TST-T03S-R03E";
/** The middle township's feature list row: its pounds and its class, from the server's breaks. */
const MIDDLE_ROW = /^TST-T03S-R03E, 500 lbs, 100 to 1,000$/;
/** A section's feature list row. */
const SECTION_ROW = /^TST-T0\dS-R0\dE-\d\d, /;
const TOWNSHIP_BINS = ["Up to 10", "10 to 100", "100 to 1,000"];
const SECTION_BINS = ["Up to 1", "1 to 10", "10 to 100"];
/** Location params use must never send: only `bbox` (or nothing) says where. */
const PLACE_PARAMS = ["county", "lat", "lng", "lon", "radius", "region"];

test.describe("a Map's pesticide use", () => {
	let useRequests: UseRequests;

	test.beforeEach(async ({ context, page }) => {
		await routeMapMeta(context);
		// Drummond Street's 2023 average of 24-hour averages: Good.
		await routeMapPeriods(context, { "2023-01-01": { figures: { [DRUMMOND]: 5 } } });
		useRequests = await routeMapUse(context, USE);
		// Noon Pacific, as the other day tests.
		await page.clock.install({ time: TODAY });
	});

	// Never county (nor any other place param), in every test: use asks valley-wide or by box.
	test.afterEach(() => {
		for (const params of [...useRequests.townships, ...useRequests.sections]) {
			for (const key of PLACE_PARAMS) expect(params.has(key), `sent ${key}`).toBe(false);
		}
	});

	/**
	 * A full-width Fresno County Map with pesticide use: Yearly over `year` (one stop), or at
	 * `resolution` over `range`; use follows the stop showing.
	 */
	function useDoc(
		year = 2023,
		resolution: "month" | "year" = "year",
		range = { kind: "custom", start: `${year}-01-01`, end: `${year}-12-31` }
	) {
		const doc = wideDoc([{ dataset: "pesticide-use" }], range);
		Object.assign(doc.body.widgets[0].data, { resolution });
		return doc;
	}

	/**
	 * The use Map. At a month with no monitor rows its name says so ("… map. No figures for this
	 * month"), so it's found by the start of its name.
	 */
	function useMapOf(page: Page): Locator {
		return page.getByRole("region", { name: /^PM2\.5 map · Fresno County(?:\.|$)/ });
	}

	/** The map, once its townships are drawn (the middle one in its feature list). */
	async function openUseMap(page: Page): Promise<Locator> {
		await openSharedDoc(page, useDoc());
		const map = useMapOf(page);
		await expect(
			legendOf(map).getByRole("heading", { level: 3, name: "Pounds Applied, 2023", exact: true })
		).toBeVisible();
		await expect.poll(() => useRequests.townships.length).toBeGreaterThan(0);
		// The monitors' line says the map has loaded the year's figures and fitted the county.
		await expect(inView(map)).toHaveText(FRESNO_VIEW);
		return map;
	}

	/** The legend section titled `title` whose units line is `units`. */
	function useSection(map: Locator, title: string, units: string): Locator {
		return legendOf(map)
			.locator(".mapsdk-legend-section")
			.filter({ has: map.page().getByRole("heading", { level: 3, name: title, exact: true }) })
			.filter({ hasText: units });
	}

	/**
	 * A legend section's class labels: map-sdk's labels under its blocks (`legendDisplay:
	 * "blocks"`), one per level, each starting with its label.
	 */
	function bins(section: Locator): Locator {
		return section.locator(".mapsdk-legend-block-labels li");
	}

	/** `labels` as the rows' text: each row starts with its label (a threshold may follow). */
	const binText = (labels: string[]) =>
		labels.map((label) => new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));

	/** The middle of the GL map: the middle township's centre (the county's framing). */
	async function middleOf(map: Locator): Promise<{ x: number; y: number }> {
		const box = (await glMap(map).boundingBox())!;
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	/** Opens the middle township's card from the feature list by keyboard. */
	async function openMiddleTownship(map: Locator): Promise<Locator> {
		await toListRow(map, MIDDLE_ROW);
		await map.page().keyboard.press("Enter");
		const card = map.getByRole("group", { name: MIDDLE_TOWNSHIP, exact: true });
		await expect(card).toBeVisible();
		return card;
	}

	/** Presses Tab until `target` has focus (at most `tries` times). */
	async function tabTo(target: Locator, tries = 8): Promise<void> {
		const page = target.page();
		for (
			let i = 0;
			i < tries && !(await target.evaluate((el) => el === document.activeElement));
			i++
		) {
			await page.keyboard.press("Tab");
		}
		await expect(target).toBeFocused();
	}

	test("townships shade by the server's classes, and the legend names the period and units", async ({
		page
	}) => {
		const map = await openUseMap(page);
		// Titled by the figure and the period, not the catalog's name for the data set.
		const legend = legendOf(map);
		await expect(
			legend.getByRole("heading", { level: 3, name: "Pounds Applied, 2023", exact: true })
		).toBeVisible();
		await expect(
			legend.getByRole("heading", { level: 3, name: USE_CATALOG.label, exact: true })
		).toHaveCount(0);
		const section = useSection(map, "Pounds Applied, 2023", "lbs per township");
		await expect(section.getByText("lbs per township", { exact: true })).toBeVisible();
		// One block row per server break, labelled from the breaks; zero use reads No data.
		await expect(bins(section)).toHaveText(binText(TOWNSHIP_BINS));
		await expect(section.getByText("No data", { exact: true })).toBeVisible();
		// The server's notes on the shades and on when use is released, each linking out.
		for (const note of [USE_FILE.notes.shades_valley, USE_FILE.notes.pur_lag]) {
			await expect(section.getByText(note.summary, { exact: true })).toBeVisible();
			await expect(section.getByRole("link", { name: new RegExp(note.title) })).toHaveAttribute(
				"href",
				note.source_url
			);
		}

		// Each township is classed by the server's breaks.
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: MIDDLE_ROW })).toHaveCount(1);
		await expect(
			list.getByRole("option", { name: /^TST-T01S-R03E, 5 lbs, Up to 10$/ })
		).toHaveCount(1);
		await closeFeatureList(map);
		await expectNoViolationsInBothThemes(page);

		// Valley-wide with the classes, its outlines asked for once.
		const [first] = useRequests.townships;
		expect(first.get("year")).toBe("2023");
		expect(first.get("classes")).toBe("1");
		expect(first.has("geometry")).toBe(false);
		expect(first.has("month")).toBe(false);
		expect(first.has("bbox")).toBe(false);
	});

	test("a Monthly Map's use is the stop's month, and stepping asks for the month before", async ({
		page
	}) => {
		const range = { kind: "custom", start: "2023-06-01", end: "2023-07-31" };
		await openSharedDoc(page, useDoc(2023, "month", range));
		const map = useMapOf(page);
		const legend = legendOf(map);
		await expect(
			legend.getByRole("heading", { level: 3, name: "Pounds Applied, July 2023", exact: true })
		).toBeVisible();
		const inMonth = (month: string) =>
			useRequests.townships.filter((params) => params.get("month") === month);
		expect(inMonth("7").length).toBeGreaterThan(0);
		for (const params of inMonth("7")) {
			expect(params.get("classes")).toBe("1");
			expect(params.get("year")).toBe("2023");
		}
		await page.getByRole("button", { name: "Previous month", exact: true }).click();
		await expect(
			legend.getByRole("heading", { level: 3, name: "Pounds Applied, June 2023", exact: true })
		).toBeVisible();
		// The townships again, values only (the outlines are known).
		await expect.poll(() => inMonth("6").length).toBeGreaterThan(0);
		for (const params of inMonth("6")) expect(params.get("geometry")).toBe("0");
		await expectNoViolationsInBothThemes(page);
	});

	test("zooming in loads sections for the view, and the bins don't change after a pan", async ({
		page
	}) => {
		const map = await openUseMap(page);
		const card = await openMiddleTownship(map);
		const zoom = card.getByRole("button", { name: "Zoom in", exact: true });
		await tabTo(zoom);
		await page.keyboard.press("Enter");

		// At the section zoom: the view's sections, classed by the server's section breaks.
		const section = useSection(map, "Pounds Applied, 2023", "lbs per section");
		await expect(bins(section)).toHaveText(binText(SECTION_BINS));
		const viewRequests = () => useRequests.sections.filter((params) => params.has("bbox"));
		await expect.poll(() => viewRequests().length).toBeGreaterThan(0);
		for (const params of viewRequests()) expect(params.get("classes")).toBe("1");
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: SECTION_ROW }).first()).toBeVisible();
		await closeFeatureList(map);
		await expectNoViolationsInBothThemes(page);

		// A pan well past the fetched box (the keyboard's arrows, 100 px a press): another box, the
		// same bins.
		const before = viewRequests().map((params) => params.get("bbox"));
		await glMap(map).focus();
		for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowRight");
		await expect
			.poll(() => viewRequests().filter((params) => !before.includes(params.get("bbox"))).length)
			.toBeGreaterThan(0);
		await expect(bins(section)).toHaveText(binText(SECTION_BINS));
	});

	test("the lens opens on hover and its section's card opens on click", async ({ page }) => {
		const map = await openUseMap(page);
		// Hovering the middle township opens its block into sections: one request for the block.
		const middle = await middleOf(map);
		const at = { x: middle.x + 3, y: middle.y + 3 };
		await page.mouse.move(at.x, at.y);
		await expect.poll(() => useRequests.sections.length).toBeGreaterThan(0);
		const [block] = useRequests.sections;
		expect(block.get("classes")).toBe("1");
		const [west, south, east, north] = block.get("bbox")!.split(",").map(Number);
		const [mw, ms, me, mn] = USE.townships.find((t) => t.id === MIDDLE_TOWNSHIP)!.box;
		// The 3 × 3 block around the middle township.
		expect(west).toBeLessThan(mw);
		expect(east).toBeGreaterThan(me);
		expect(south).toBeLessThan(ms);
		expect(north).toBeGreaterThan(mn);
		// Once the block's sections are drawn, the pointer is over one of them, named in its hover
		// card (a pointer move finds them once they're drawn).
		const over = { x: at.x + 1, y: at.y + 1 };
		const tip = map.getByRole("tooltip");
		await expect(async () => {
			await page.mouse.move(at.x, at.y);
			await page.mouse.move(over.x, over.y);
			await expect(tip).toContainText(new RegExp(`${MIDDLE_TOWNSHIP}-\\d\\d`), {
				timeout: 500
			});
		}).toPass();
		const name = /TST-T03S-R03E-\d\d/.exec((await tip.textContent()) ?? "")![0];

		// A click opens the section's card, its body drawn under the hover lens too.
		await page.mouse.click(over.x, over.y);
		const card = map.getByRole("group", { name, exact: true }).first();
		await expect(card).toBeVisible();
		await expect(card.getByRole("heading", { name, exact: true })).toBeVisible();
		await expect(card.getByText("Use in 2023", { exact: true })).toBeVisible();
		await expectNoViolationsInBothThemes(page);
	});

	test("the section card's township link opens the township card", async ({ page, browser }) => {
		const map = await openUseMap(page);
		// The lens's legend section shows only while the lens is open.
		const lensLegend = useSection(map, "Pounds Applied, 2023", "lbs per section");
		await expect(lensLegend).toHaveCount(0);
		// Hover the middle township until the lens draws its sections, then pin one.
		const middle = await middleOf(map);
		const at = { x: middle.x + 3, y: middle.y + 3 };
		const over = { x: at.x + 1, y: at.y + 1 };
		const tip = map.getByRole("tooltip");
		const line = `In township ${MIDDLE_TOWNSHIP} · 500 lbs`;
		await expect(async () => {
			await page.mouse.move(at.x, at.y);
			await page.mouse.move(over.x, over.y);
			await expect(tip).toContainText(new RegExp(`${MIDDLE_TOWNSHIP}-\\d\\d`), {
				timeout: 500
			});
		}).toPass();
		// Unheld, a hover lens closes once the pointer leaves for the basemap (outside the county)
		// and its grace is past: the signal the hold is checked by below.
		const box = (await glMap(map).boundingBox())!;
		const offCounty = { x: box.x + box.width - 60, y: box.y + box.height - 60 };
		await expect(lensLegend).toBeVisible();
		await page.mouse.move(offCounty.x, offCounty.y);
		await page.waitForTimeout(500);
		await expect(lensLegend).toHaveCount(0);
		await expect(async () => {
			await page.mouse.move(at.x, at.y);
			await page.mouse.move(over.x, over.y);
			await expect(tip).toContainText(new RegExp(`${MIDDLE_TOWNSHIP}-\\d\\d`), {
				timeout: 500
			});
		}).toPass();
		// On hover the line is text: nothing in the tooltip takes focus.
		await expect(tip).toContainText(line);
		await expect(tip.getByRole("button")).toHaveCount(0);
		const name = /TST-T03S-R03E-\d\d/.exec((await tip.textContent()) ?? "")![0];
		await page.mouse.click(over.x, over.y);
		const sectionCard = map.getByRole("group", { name, exact: true }).first();
		await expect(sectionCard).toBeVisible();
		await expect(lensLegend).toBeVisible();
		// The cards and toasts sit over the canvas: hidden, so only the map is compared.
		const hidden = ".mapsdk-tooltip, [data-sonner-toaster] { visibility: hidden !important; }";
		const before = await map.locator("canvas").screenshot({ style: hidden });

		// The same line in the pinned card, where the township's id is a button (named on its own)
		// that swaps the card for the township's, in place, with focus in it.
		await expect(sectionCard).toContainText(line);
		const button = sectionCard.getByRole("button", {
			name: `Open township ${MIDDLE_TOWNSHIP}`,
			exact: true
		});
		await expect(button).toHaveText(MIDDLE_TOWNSHIP);
		await button.click();
		const townshipCard = map.getByRole("group", { name: MIDDLE_TOWNSHIP, exact: true });
		await expect(townshipCard).toBeVisible();
		await expect(townshipCard.getByRole("button", { name: "Show square miles" })).toBeVisible();
		await expect(map.getByRole("group", { name, exact: true })).toHaveCount(0);
		await expect
			.poll(() => townshipCard.evaluate((el) => el.contains(document.activeElement)))
			.toBe(true);
		// The camera hasn't moved.
		await expectStill(browser, map, before, hidden);
		// The card holds the lens: with the pointer off the township (on the basemap, outside the
		// county) and past the lens's grace, its legend section stays.
		await page.mouse.move(offCounty.x, offCounty.y);
		await page.waitForTimeout(500);
		await expect(lensLegend).toBeVisible();
		await expect(townshipCard).toBeVisible();
		await expectNoViolationsInBothThemes(page);
	});

	test("the township card's Show square miles pins the lens from the keyboard, and Escape clears it", async ({
		page
	}) => {
		const map = await openUseMap(page);
		const card = await openMiddleTownship(map);
		const show = card.getByRole("button", { name: "Show square miles", exact: true });
		await tabTo(show);
		await page.keyboard.press("Enter");

		// The pinned lens lists its block's sections; one opens its card with its months and
		// chemicals (the section's details for the year).
		// The list draws only the rows near its active one: type the section's name to reach it.
		const sectionName = `${MIDDLE_TOWNSHIP}-22`;
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: SECTION_ROW }).first()).toBeVisible();
		await list.focus();
		await page.keyboard.type(sectionName);
		const row = list.getByRole("option", { name: new RegExp(`^${sectionName}, `) });
		await expect(row).toHaveCount(1);
		await expect(list).toHaveAttribute("aria-activedescendant", (await row.getAttribute("id"))!);
		await page.keyboard.press("Enter");
		const sectionCard = map.getByRole("group", { name: sectionName, exact: true }).first();
		await expect(sectionCard).toBeVisible();
		await expect(sectionCard.getByText("Peaks in July", { exact: true })).toBeVisible();
		await expect(sectionCard.getByText("Top chemicals by pounds", { exact: true })).toBeVisible();
		await expect(sectionCard.getByText("Example-chem A", { exact: true })).toBeVisible();
		await expect(sectionCard.getByText("Prop 65", { exact: true })).toBeVisible();
		const id = USE.sections.find((s) => s.mtrs === sectionName)!.id;
		expect(useRequests.details.map((d) => [d.id, d.params.get("year")])).toContainEqual([
			id,
			"2023"
		]);
		await expectNoViolationsInBothThemes(page);

		// Esc closes the card, then lets go of the lens: its sections leave the list.
		await list.focus();
		for (let i = 0; i < 3 && (await list.getByRole("option", { name: SECTION_ROW }).count()); i++) {
			await page.keyboard.press("Escape");
		}
		await expect(list.getByRole("option", { name: SECTION_ROW })).toHaveCount(0);
		await expect(list.getByRole("option", { name: MIDDLE_ROW })).toHaveCount(1);
	});

	test("a period the server doesn't list says no use is reported yet in the legend, asking nothing", async ({
		page
	}) => {
		await openSharedDoc(page, useDoc(2017));
		const map = useMapOf(page);
		const legend = legendOf(map);
		// One row, under the layer's title, with the server's notes under it.
		const none = "No pesticide use reported for 2017 yet.";
		await expect(legend.getByText(none, { exact: true })).toHaveCount(1);
		await expect(legend.getByText(none, { exact: true })).toBeVisible();
		await expect(
			legend.getByText(USE_FILE.notes.shades_valley.summary, { exact: true })
		).toBeVisible();
		expect(useRequests.townships).toEqual([]);
		expect(useRequests.sections).toEqual([]);
		await expectNoViolationsInBothThemes(page);
	});

	test("sections and townships requests never carry county", async ({ page }) => {
		const map = await openUseMap(page);
		// The lens's block, then the view's sections at the section zoom.
		const middle = await middleOf(map);
		await page.mouse.move(middle.x + 3, middle.y + 3);
		await expect.poll(() => useRequests.sections.length).toBeGreaterThan(0);
		await page.mouse.move(middle.x, 1);
		const card = await openMiddleTownship(map);
		await tabTo(card.getByRole("button", { name: "Zoom in", exact: true }));
		await page.keyboard.press("Enter");
		await expect.poll(() => useRequests.sections.length).toBeGreaterThan(1);
		await expectNoViolationsInBothThemes(page);

		expect(useRequests.townships.length).toBeGreaterThan(0);
		for (const params of useRequests.townships) {
			for (const key of [...PLACE_PARAMS, "bbox"]) expect(params.has(key), key).toBe(false);
		}
		for (const params of useRequests.sections) {
			for (const key of PLACE_PARAMS) expect(params.has(key), key).toBe(false);
			expect(params.get("bbox")).toMatch(/^-?[\d.]+(,-?[\d.]+){3}$/);
		}
	});
});

test.describe("schools and child care", () => {
	let locationRequests: URLSearchParams[];

	test.beforeEach(async ({ context, page }) => {
		locationRequests = await routeMapLocations(context);
		// Noon Pacific, as the other day tests.
		await page.clock.install({ time: TODAY });
	});

	/** A full-width Map of Roosevelt High's PM2.5, with its type (Public school) ticked. */
	const rooseveltDoc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-map-school",
		name: "School map",
		body: {
			widgets: [
				{
					id: "w0",
					type: "map",
					title: null,
					rect: { x: 0, y: 0, w: 12, h: 8 },
					data: {
						place: ROOSEVELT_PLACE,
						layers: [
							{ dataset: "air-quality", entryType: "pm25", monitorTypes: EVERY_MONITOR_TYPE },
							{ dataset: "locations", locationTypes: ["public_school"] }
						]
					}
				}
			]
		}
	};

	/** Ticks `types` in the Map's Data Portal and saves. */
	async function tickInDataPortal(page: Page, title: string, types: string[]): Promise<void> {
		await widgetMenuItem(page, title, "Open in Data Portal");
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
		for (const type of types) {
			await openSection(page, type === "Child care" ? /^Child care/ : /^Schools/);
			await page.getByRole("checkbox", { name: type, exact: true }).check();
		}
		await page.getByRole("button", { name: "Save changes" }).click();
		await expect(widgetTitles(page)).toHaveText([title]);
		await expectSaved(page);
	}

	test("ticking a type loads the county's sites once, by its region and every type; the legend names each group", async ({
		page
	}) => {
		const map = await addMap(page);
		await tickInDataPortal(page, FRESNO_MAP, ["Public school"]);

		const legend = legendOf(map);
		await expect(
			legend.getByRole("heading", { level: 3, name: "Schools", exact: true })
		).toBeVisible();
		await expect(legend.getByText("Public school", { exact: true })).toBeVisible();
		// One request: Fresno County's server id, with no type (ticking filters what's loaded).
		expect(locationRequests).toHaveLength(1);
		expect(locationRequests[0].getAll("region")).toEqual(["r6phe"]);
		expect(locationRequests[0].has("type")).toBe(false);
		const list = await featureList(map);
		await expect(
			list.getByRole("option", { name: /^Example (Elementary|Middle|High)\b/ })
		).toHaveCount(3);
		await expect(list.getByRole("option", { name: /^Example Private Academy\b/ })).toHaveCount(0);
		await closeFeatureList(map);

		// Child care too: drawn from what's loaded, asking nothing more.
		await tickInDataPortal(page, FRESNO_MAP, ["Child care"]);
		await expect(
			legend.getByRole("heading", { level: 3, name: "Child care", exact: true })
		).toBeVisible();
		const again = await featureList(map);
		await expect(again.getByRole("option", { name: /^EXAMPLE / })).toHaveCount(3);
		await closeFeatureList(map);
		expect(locationRequests).toHaveLength(1);
	});

	test("a school in Where with its type ticked: the feature list shows it once", async ({
		page
	}) => {
		await openSharedDoc(page, rooseveltDoc);
		const map = page
			.getByRole("region", { name: "PM2.5 map · ZIP 93702 (Roosevelt High)", exact: true })
			.first();
		const list = await featureList(map);
		// The site's own row (the focus pin gives way to it), named with its type.
		await expect(list.getByRole("option", { name: /^Roosevelt High\b/ })).toHaveCount(1);
		await expect(
			list.getByRole("option", { name: "Roosevelt High, Public school", exact: true })
		).toHaveCount(1);
		await closeFeatureList(map);
		// Its first fallback region the server has: ZIP 93702.
		expect(locationRequests.map((p) => p.getAll("region"))).toEqual([["c85na"]]);
	});

	test("a Map with no Where and Child care ticked loads the valley once and draws every site", async ({
		page
	}) => {
		const valleyDoc = structuredClone(rooseveltDoc);
		valleyDoc.id = "shared-map-valley";
		const widget = valleyDoc.body.widgets[0] as { data: Record<string, unknown> };
		widget.data = {
			layers: [
				{ dataset: "air-quality", entryType: "pm25", monitorTypes: EVERY_MONITOR_TYPE },
				{ dataset: "locations", locationTypes: ["child_care"] }
			]
		};
		await openSharedDoc(page, valleyDoc);
		const map = page.getByRole("region", { name: "PM2.5 map", exact: true }).first();
		await expect(
			legendOf(map).getByRole("heading", { level: 3, name: "Child care", exact: true })
		).toBeVisible();
		const list = await featureList(map);
		await expect(list.getByRole("option", { name: /^EXAMPLE / })).toHaveCount(3);
		await expect(list.getByRole("option", { name: /^(Example|Roosevelt) / })).toHaveCount(0);
		await closeFeatureList(map);
		// One valley-wide request: no area, no type.
		expect(locationRequests).toHaveLength(1);
		expect([...locationRequests[0].keys()]).toEqual([]);
	});

	test("Show as Chart from a Map with schools notes them left out", async ({ page }) => {
		await openSharedDoc(page, rooseveltDoc);
		const [title] = await widgetTitles(page).allTextContents();
		await widgetMenuItem(page, title, "Open in Data Portal");
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
		await page.locator('[data-show-as="chart"]').click();
		await expect(page.locator('[data-show-as="chart"]')).toHaveAttribute("data-state", "on");
		await expect(
			page.getByText("Schools: shown only on a map, so left out.", { exact: true })
		).toBeVisible();
	});
});
