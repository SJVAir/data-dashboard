/**
 * "Show in a chart" and "Show in a table" from a Map, end to end on the fixtures: the Map's marks
 * (or a pinned pesticide section card) open the Data Portal on a Chart or Table of them, with the
 * Map's range, never asking which places to keep (no cap); "Add to …" adds the widget (for a
 * viewer on a live link, to their own dashboard). Fresno County gets six made-up monitors beside
 * Drummond Street (`routeMoreMonitors`), so a county Map draws seven, all Good. The clock stands
 * at noon Pacific, as in the Map's other day tests.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	AIR_QUALITY_SECTION,
	DASHBOARD_URL,
	STARTER_TITLES,
	addToButton,
	expectNoViolations,
	makeOwnCopy,
	maria,
	nav,
	openPicker,
	openSection,
	openSharedDoc,
	widgetMenuItem,
	widgetTitles
} from "./helpers";
import {
	EVERY_MONITOR_TYPE,
	routeMapMeta,
	routeMapUse,
	routeMoreMonitors,
	routeSectionRegions,
	useFixtures,
	type ExtraMonitor,
	type UseRequests
} from "./map-data-server";

test.use({ reducedMotion: "reduce" });

// As in `map.spec.ts`: Firefox in Playwright's container has no WebGL, so these skip there.
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

/** The Pacific date the clock stands on (noon), whatever zone the machine is in. */
const TODAY = "2026-11-15T12:00:00-08:00";
const PAST_RANGE = { kind: "custom", start: "2026-11-09", end: "2026-11-11" };

const DRUMMOND = "4Mb0j33kTnS0qzeE4iDGWw";
const PORTERVILLE = "6qEHS0fITHOQYHLN4c9GKA";
/** Six made-up Fresno County monitors (A to F). */
const EXTRAS: ExtraMonitor[] = ["A", "B", "C", "D", "E", "F"].map((letter) => ({
	id: `xtraMonitor${letter}0000000000`,
	name: `Fresno - Test Site ${letter}`
}));
const SEVEN = [DRUMMOND, ...EXTRAS.map((m) => m.id)];

const FRESNO_MAP = "PM2.5 map · Fresno County";
const DRUMMOND_MAP = "PM2.5 map · Fresno - Drummond Street";
const GET_DATA = { level: 1, name: "Data Portal" } as const;
const NEW_WIDGET_URL = /\/workspace\/dashboards\/[0-9a-f-]{36}\/widgets\/new$/;

/** A full-width Fresno County Map of PM2.5 over `range`, with `marks` marked. */
function countyDoc(marks: string[], range: Record<string, unknown> | null = PAST_RANGE) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-show-in",
		name: "County map",
		body: {
			widgets: [
				{
					id: "w0",
					type: "map",
					title: null,
					rect: { x: 0, y: 0, w: 12, h: 8 },
					data: {
						place: { kind: "region", type: "county", code: "06019" },
						layers: [
							{
								dataset: "air-quality",
								entryType: "pm25",
								monitorTypes: EVERY_MONITOR_TYPE
							}
						],
						...(range && { dateRange: range })
					},
					options: { marks }
				}
			]
		}
	};
}

/** The map of the widget titled `title` (its region, which holds the GL map and its UI). */
function mapOf(page: Page, title: string): Locator {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return page.getByRole("region", { name: new RegExp(`^${escaped}(?:\\.|$)`) });
}

/** The map's summary line: the monitors in view, counted by level. */
function inView(map: Locator): Locator {
	return map.getByText(/^PM2\.5: \d+ (?!selected$)/);
}

/** The map's selection line ("PM2.5: 3 selected"): how many monitors are marked. */
function selectionLine(map: Locator): Locator {
	return map.getByText(/^PM2\.5: (\d+ selected|Selection cleared)$/);
}

/** The GL map itself (MapView's region, inside the widget's). */
function glMap(map: Locator): Locator {
	return map.getByRole("region", { name: "Map", exact: true });
}

function whereSummary(page: Page): Locator {
	return page.getByTestId("where-summary");
}

/** The place picker: it never opens by itself, since a Chart or Table takes every place. */
function placesDialog(page: Page): Locator {
	return page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
}

/** Opens a county Map with `marks`, drawn with all seven of its monitors. */
async function openCountyMap(page: Page, marks: string[]): Promise<Locator> {
	await openSharedDoc(page, countyDoc(marks));
	const map = mapOf(page, FRESNO_MAP);
	await expect(inView(map)).toHaveText("PM2.5: 7 Good");
	return map;
}

test.describe("from a Map's marks", () => {
	test.beforeEach(async ({ context, page }) => {
		await routeMoreMonitors(context, EXTRAS);
		await page.clock.install({ time: TODAY });
	});

	test("Show in a chart opens a Chart of the marks over the Map's range, and Add to adds it", async ({
		page
	}) => {
		const map = await openCountyMap(page, SEVEN.slice(0, 3));
		await expect(selectionLine(map)).toHaveText("PM2.5: 3 selected");
		const dashboard = page.url();

		await widgetMenuItem(page, FRESNO_MAP, "Show in a chart");
		await expect(page).toHaveURL(NEW_WIDGET_URL);
		await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
		await expect(page.getByRole("radio", { name: "Chart" })).toBeChecked();
		// The Where is the county; the marked monitors are What, not named here.
		await expect(whereSummary(page)).toHaveText("Fresno County");
		// The Map's range.
		await expect(page.getByTestId("resolved-range")).toHaveText("Nov 9 – 11, 2026");
		// The three marks are the Chart's searched monitors, listed in Air quality.
		await openSection(page, AIR_QUALITY_SECTION);
		const searched = page.getByRole("list", { name: "Chosen monitors" }).getByRole("listitem");
		await expect(searched).toHaveCount(3);
		await expect(searched.filter({ hasText: "Fresno - Drummond Street" })).toHaveCount(1);
		await expect(searched.filter({ hasText: "Fresno - Test Site" })).toHaveCount(2);
		// No dialog asked which places to keep, and nothing was left out.
		await expect(placesDialog(page)).toHaveCount(0);
		await expect(page.getByText(/aren't shown on the map|isn't shown on the map/)).toHaveCount(0);

		// A reload keeps the history entry's hand-off: the same Chart comes back (D16).
		await page.reload();
		await expect(page).toHaveURL(NEW_WIDGET_URL);
		await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
		await expect(page.getByRole("radio", { name: "Chart" })).toBeChecked();
		// The Where is the county; the marked monitors are What, not named here.
		await expect(whereSummary(page)).toHaveText("Fresno County");
		await expect(page.getByTestId("resolved-range")).toHaveText("Nov 9 – 11, 2026");

		await expect(addToButton(page)).toHaveText("Add to County map");
		await addToButton(page).click();
		await expect(page).toHaveURL(dashboard);
		await expect(widgetTitles(page)).toHaveCount(2);
		await expect(widgetTitles(page).last()).toHaveText(/^PM2\.5 · 3 places · /);

		// The visit never wrote the device's saved draft: a plain visit opens on the default.
		await nav(page).getByRole("link", { name: "Data Portal", exact: true }).click();
		await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	});

	test("Show in a chart takes seven marks without asking: they're its searched monitors", async ({
		page
	}) => {
		const map = await openCountyMap(page, SEVEN);
		await expect(selectionLine(map)).toHaveText("PM2.5: 7 selected");

		await widgetMenuItem(page, FRESNO_MAP, "Show in a chart");
		await expect(page).toHaveURL(NEW_WIDGET_URL);
		await expect(page.getByRole("radio", { name: "Chart" })).toBeChecked();
		// No cap: no dialog asks which to keep.
		await expect(placesDialog(page)).toHaveCount(0);
		await expect(whereSummary(page)).toHaveText("Fresno County");
		await expectNoViolations(page);
	});

	test("Show in a table takes seven marks without asking, and notes a hidden one", async ({
		page
	}) => {
		// Porterville is in Tulare County, so the county Map doesn't draw it.
		const map = await openCountyMap(page, [...SEVEN, PORTERVILLE]);
		await expect(selectionLine(map)).toHaveText(/selected$/);

		await widgetMenuItem(page, FRESNO_MAP, "Show in a table");
		await expect(page).toHaveURL(NEW_WIDGET_URL);
		await expect(page.getByRole("radio", { name: "Data table" })).toBeChecked();
		await expect(whereSummary(page)).toHaveText("Fresno County");
		await expect(
			page.getByText("1 marked monitor isn't shown on the map, so it was left out.")
		).toBeVisible();
		await expect(placesDialog(page)).toHaveCount(0);
	});
});

test.describe("shared by a live link", () => {
	test.use({ account: maria });

	test("a viewer's Show in a chart adds to their own dashboard", async ({
		page,
		documentsServer
	}) => {
		const doc = countyDoc([DRUMMOND], null);
		doc.name = "Monitor map";
		// A Map of the one searched monitor, with no Where.
		delete (doc.body.widgets[0].data as { place?: unknown }).place;
		doc.body.widgets[0].data.layers[0] = {
			dataset: "air-quality",
			entryType: "pm25",
			monitors: [DRUMMOND]
		} as never;
		await openSharedDoc(page, doc);
		await expect(nav(page).getByText("Saved to your account", { exact: true })).toBeVisible();
		await openPicker(page, doc.name);
		await page.getByRole("menuitem", { name: "Share…" }).click();
		const share = page.getByRole("dialog", { name: "Share dashboard" });
		await share.getByRole("button", { name: "Create link" }).click();
		const link = share.getByRole("textbox", { name: "Live link" });
		await expect(link).toHaveValue(/\/workspace\/shared\/[^/]+$/);
		const url = await link.inputValue();

		// Signed out, on a device with a dashboard of their own (the last opened).
		const viewer = await documentsServer.newDevice();
		viewer.account.set(null);
		await viewer.page.clock.install({ time: TODAY });
		await makeOwnCopy(viewer.page);
		const own = viewer.page.url();
		await viewer.page.goto(url);
		const map = mapOf(viewer.page, DRUMMOND_MAP);
		await expect(inView(map)).toHaveText("PM2.5: 1 Good");
		await expect(selectionLine(map)).toHaveText("PM2.5: 1 selected");

		await widgetMenuItem(viewer.page, DRUMMOND_MAP, "Show in a chart");
		await expect(viewer.page).toHaveURL(/\/workspace\/data$/);
		await expect(viewer.page.getByRole("radio", { name: "Chart" })).toBeChecked();
		await expect(whereSummary(viewer.page)).toHaveText("Everywhere");
		await expect(addToButton(viewer.page)).toHaveText("Add to My dashboard");
		await addToButton(viewer.page).click();
		await expect(viewer.page).toHaveURL(own);
		await expect(widgetTitles(viewer.page)).toHaveCount(STARTER_TITLES.length + 1);
		await expect(widgetTitles(viewer.page).last()).toHaveText(
			/^PM2\.5 · Fresno - Drummond Street · /
		);
	});
});

/** The middle of Fresno County's fixture outline: the centre of a county Map. */
const COUNTY_MIDDLE: [number, number] = [-119.63965, 36.74635];
const USE = useFixtures(COUNTY_MIDDLE);
const MIDDLE_TOWNSHIP = "TST-T03S-R03E";

test.describe("from a pesticide section card", () => {
	let useRequests: UseRequests;

	test.beforeEach(async ({ context, page }) => {
		await routeMapMeta(context);
		useRequests = await routeMapUse(context, USE);
		await routeSectionRegions(context, USE);
		await page.clock.install({ time: TODAY });
	});

	test("a Monthly Map's pinned section card shows a Chart of that section", async ({ page }) => {
		const doc = countyDoc([], { kind: "custom", start: "2023-06-01", end: "2023-07-31" });
		doc.body.widgets[0].data.layers.push({ dataset: "pesticide-use" } as never);
		Object.assign(doc.body.widgets[0].data, { resolution: "month" });
		await openSharedDoc(page, doc);
		const map = mapOf(page, FRESNO_MAP);
		await expect(
			map
				.getByRole("region", { name: "Legend", exact: true })
				.getByRole("heading", { level: 3, name: "Pounds Applied, July 2023", exact: true })
		).toBeVisible();
		await expect.poll(() => useRequests.townships.length).toBeGreaterThan(0);

		// Hover the middle township until the lens draws its sections, then pin one.
		const box = (await glMap(map).boundingBox())!;
		const at = { x: box.x + box.width / 2 + 3, y: box.y + box.height / 2 + 3 };
		const over = { x: at.x + 1, y: at.y + 1 };
		const tip = map.getByRole("tooltip");
		await expect(async () => {
			await page.mouse.move(at.x, at.y);
			await page.mouse.move(over.x, over.y);
			await expect(tip).toContainText(new RegExp(`${MIDDLE_TOWNSHIP}-\\d\\d`), {
				timeout: 500
			});
		}).toPass();
		const name = new RegExp(`${MIDDLE_TOWNSHIP}-\\d\\d`).exec((await tip.textContent()) ?? "")![0];
		// The hover card has no button (it isn't interactive).
		await expect(tip.getByRole("button")).toHaveCount(0);
		await page.mouse.click(over.x, over.y);
		const card = map.getByRole("group", { name, exact: true }).first();
		await expect(card).toBeVisible();

		await card.getByRole("button", { name: "Show in a chart", exact: true }).click();
		await expect(page).toHaveURL(NEW_WIDGET_URL);
		await expect(page.getByRole("radio", { name: "Chart" })).toBeChecked();
		await expect(whereSummary(page)).toHaveText(name);
		await expect(page.getByRole("group", { name: `Chart of ${name}` })).toBeVisible();
		// The Map's range, by month.
		await expect(page.getByTestId("resolved-range")).toHaveText("Jun 1 – Jul 31, 2023");
		await addToButton(page).click();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page).last()).toContainText(name);
	});
});
