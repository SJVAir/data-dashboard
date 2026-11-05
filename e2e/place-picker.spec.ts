/**
 * The shared place picker end to end, on the API fixtures (`e2e/places-server.ts`): changing a
 * widget's place, the idle and "no longer available" states, "Use my location", and how a point
 * is shared. The point lookup answers ZIP 93721 for any position.
 */
import type { Locator, Page } from "@playwright/test";
import LZString from "lz-string";
import { expect, test } from "./fixtures";
import {
	CHART_TITLE,
	DASHBOARD_URL,
	expectNoViolations,
	expectSaved,
	maria,
	nav,
	openPicker,
	shareLinkFor,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

const NAME = "Air near school";
const FRESNO = { kind: "region", type: "county", code: "06019" };
const RANGE = { kind: "trailing", amount: 30, unit: "day" };
/** Somewhere in downtown Fresno (ZIP 93721). */
const POSITION = { latitude: 36.7372, longitude: -119.7871 };

const POINT_TITLE = "PM2.5 · 93721 (your location) · Last 30 days";

type Place = Record<string, unknown>;

/** A dashboard document with one data widget (`chart` or `data-table`) on `place` (none: idle). */
function dataDoc(type: "chart" | "data-table", place?: Place) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-places-1",
		name: NAME,
		body: {
			widgets: [
				{
					id: "w0",
					type,
					title: null,
					rect: { x: 0, y: 0, w: 6, h: 6 },
					data: {
						dateRange: RANGE,
						layers: [{ dataset: "air-quality", entryType: "pm25", ...(place ? { place } : {}) }]
					}
				}
			]
		}
	};
}

/** Opens `doc` through a share link (which saves a copy) and waits for its widget. */
async function openDoc(page: Page, doc: ReturnType<typeof dataDoc>): Promise<void> {
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(1);
}

/** The open place picker dialog (single or multiple mode). */
function picker(page: Page): Locator {
	return page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
}

function searchBox(page: Page): Locator {
	return picker(page).getByRole("combobox", { name: "Search for a place" });
}

/** The first document a share link carries. */
function linkDocument(url: string) {
	const packed = url.slice(url.indexOf("#1.") + 3);
	const envelope = JSON.parse(LZString.decompressFromEncodedURIComponent(packed));
	return envelope.documents[0] as ReturnType<typeof dataDoc>;
}

function shareDialog(page: Page): Locator {
	return page.getByRole("dialog", { name: "Share dashboard" });
}

async function openShare(page: Page): Promise<Locator> {
	await openPicker(page, NAME);
	await page.getByRole("menuitem", { name: "Share…" }).click();
	await expect(shareDialog(page)).toBeVisible();
	return shareDialog(page);
}

/** On the Chart titled `title`: Change place, remove its place (`current`), and Use my location. */
async function useMyLocation(page: Page, title = CHART_TITLE, current = "Fresno County") {
	await widgetMenuItem(page, title, "Change place");
	await picker(page)
		.getByRole("button", { name: `Remove ${current}` })
		.click();
	await picker(page).getByRole("button", { name: "Use my location" }).click();
}

test("Change place on a Chart to two counties, then Undo", async ({ page }) => {
	await openDoc(page, dataDoc("chart", FRESNO));
	await expect(widgetTitles(page)).toHaveText([CHART_TITLE]);

	await widgetMenuItem(page, CHART_TITLE, "Change place");
	await expect(picker(page)).toHaveAccessibleName("Choose places");
	await expect(searchBox(page)).toBeFocused();
	await expect(picker(page).getByRole("list", { name: "Chosen places" })).toContainText(
		"Fresno County"
	);

	// Browse the counties (singular heading until the SDK has label_plural) and tick Tulare.
	await picker(page)
		.getByRole("button", { name: /^Counties/ })
		.click();
	const grid = picker(page).getByRole("grid", { name: "Places in this list" });
	await expect(grid.getByRole("row", { name: /Fresno County/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
	await grid.getByRole("row", { name: /Tulare County/ }).click();
	await expect(grid.getByRole("row", { name: /Tulare County/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(picker(page)).toBeHidden();

	await expect(widgetTitles(page)).toHaveText(["PM2.5 · 2 places · Last 30 days"]);
	await expectSaved(page);

	await nav(page).getByRole("button", { name: "Undo" }).click();
	await expect(widgetTitles(page)).toHaveText([CHART_TITLE]);
});

test("Choose a place on an idle Data table: a school shows its ZIP's data", async ({ page }) => {
	await openDoc(page, dataDoc("data-table"));
	await expect(page.getByText("Choose a place to show data.")).toBeVisible();
	await page.getByRole("button", { name: "Choose a place" }).click();

	// One box searches schools, places and monitors at once, grouped by kind.
	await searchBox(page).fill("roo");
	const results = picker(page).getByRole("listbox", { name: "Places found" });
	await expect(results.getByRole("group", { name: "Schools & child care" })).toBeVisible();
	await expect(results.getByRole("group", { name: "Places" })).toBeVisible();
	const school = results.getByRole("option", { name: /^Roosevelt High/ });
	await school.click();
	// A school is the only pick it can be: everything else is greyed out with a reason.
	await expect(results.getByRole("option", { name: /^Rosamond/ }).first()).toHaveAttribute(
		"aria-disabled",
		"true"
	);
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(picker(page)).toBeHidden();

	const title = "PM2.5 · 93702 (Roosevelt High) · Last 30 days";
	await expect(widgetTitles(page)).toHaveText([title]);
	const table = page.getByRole("region", { name: "Data table values" });
	await expect(table.getByRole("columnheader", { name: /93702 \(Roosevelt High\)/ })).toBeVisible();
	await expect(table.getByRole("rowheader")).toHaveCount(30);
});

test("Choose another on a monitor that's no longer available", async ({ page }) => {
	await openDoc(page, dataDoc("chart", { kind: "monitor", id: "GoneMonitor1" }));
	await expect(page.getByText("This place is no longer available.")).toBeVisible();
	await page.getByRole("button", { name: "Choose another" }).click();

	// Monitors are searched in the browser over the monitors list; a county replaces the monitor.
	await searchBox(page).fill("fre");
	const results = picker(page).getByRole("listbox", { name: "Places found" });
	await expect(
		results.getByRole("group", { name: "Monitors" }).getByRole("option", {
			name: /^Fresno - Drummond Street/
		})
	).toBeVisible();
	await results.getByRole("option", { name: /^Fresno County/ }).click();
	await picker(page).getByRole("button", { name: "Done" }).click();
	await expect(widgetTitles(page)).toHaveText([CHART_TITLE]);
	await expect(page.getByText("This place is no longer available.")).toBeHidden();
});

test("Use my location picks the point and names the ZIP it shows", async ({ page, context }) => {
	await context.grantPermissions(["geolocation"]);
	await context.setGeolocation(POSITION);
	await openDoc(page, dataDoc("chart", FRESNO));

	await useMyLocation(page);
	await expect(picker(page)).toBeHidden();
	await expect(widgetTitles(page)).toHaveText([POINT_TITLE]);
});

test("Use my location with location access off picks nothing", async ({
	page,
	context,
	browserName
}) => {
	// With no grant, Chromium and WebKit deny at once; Firefox leaves its prompt waiting, so there
	// the page gets the error a browser reports when the person blocks it (code 1).
	if (browserName === "firefox") {
		await context.addInitScript(() => {
			navigator.geolocation.getCurrentPosition = (_ok, fail) =>
				fail?.({ code: 1, message: "User denied geolocation" } as GeolocationPositionError);
		});
	}
	await openDoc(page, dataDoc("chart", FRESNO));

	await useMyLocation(page);
	await expect(
		picker(page).getByText("Location access is off. Search for a place instead.")
	).toBeVisible();
	await picker(page).getByRole("button", { name: "Cancel" }).click();
	await expect(widgetTitles(page)).toHaveText([CHART_TITLE]);
});

test("the open picker has no WCAG 2.2 AA violations", async ({ page }) => {
	await openDoc(page, dataDoc("chart", FRESNO));
	await widgetMenuItem(page, CHART_TITLE, "Change place");
	await expect(picker(page).getByRole("button", { name: /^Counties/ })).toBeVisible();
	await expectNoViolations(page);

	await searchBox(page).fill("fre");
	await expect(picker(page).getByRole("option", { name: /^Fresno Unified/ })).toBeVisible();
	await expectNoViolations(page);
});

test("a copy link shares the point as its ZIP unless the owner chooses exact", async ({
	page,
	context
}) => {
	await context.grantPermissions(["geolocation"]);
	await context.setGeolocation(POSITION);
	await openDoc(page, dataDoc("chart", FRESNO));
	await useMyLocation(page);
	await expect(widgetTitles(page)).toHaveText([POINT_TITLE]);
	await expectSaved(page);

	const dialog = await openShare(page);
	await expect(
		dialog.getByText("Your location is shared as 93721, not your exact position.")
	).toBeVisible();
	const link = dialog.getByRole("textbox", { name: "Link", exact: true });
	await expect(link).toHaveValue(/#1\./);
	const swappedUrl = await link.inputValue();
	const swapped = linkDocument(swappedUrl);
	expect(swapped.body.widgets[0].data.layers[0].place).toEqual({
		kind: "region",
		type: "zipcode",
		code: "93721"
	});

	await dialog.getByRole("checkbox", { name: "Share my exact location instead" }).check();
	await expect(
		dialog.getByText("Anyone with the link or file will see your exact location.")
	).toBeVisible();
	await expect(link).not.toHaveValue(swappedUrl);
	const exact = linkDocument(await link.inputValue());
	expect(exact.body.widgets[0].data.layers[0].place).toMatchObject({ kind: "point" });
});

test("a copy made from a link with an exact point gets the region", async ({ page }) => {
	await openDoc(page, dataDoc("chart", { kind: "point", lat: 36.7372, lon: -119.7871 }));
	// Not "(your location)": the copy holds ZIP 93721, not the sender's point.
	await expect(widgetTitles(page)).toHaveText(["PM2.5 · 93721 · Last 30 days"]);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveText(["PM2.5 · 93721 · Last 30 days"]);
});

test.describe("signed in, with a live link", () => {
	test.use({ account: maria });

	/** Opens the dashboard, saves it to Maria's account, and picks "your location" on it. */
	async function pointOnAccount(page: Page): Promise<void> {
		await openDoc(page, dataDoc("chart", FRESNO));
		await expect(nav(page).getByText("Saved to your account", { exact: true })).toBeVisible();
		await useMyLocation(page);
		await expect(widgetTitles(page)).toHaveText([POINT_TITLE]);
	}

	test.beforeEach(async ({ context }) => {
		await context.grantPermissions(["geolocation"]);
		await context.setGeolocation(POSITION);
	});

	test("the Share dialog asks before a live link carries the point; Use 93721 instead", async ({
		page,
		documentsServer
	}) => {
		await pointOnAccount(page);
		const dialog = await openShare(page);
		await expect(dialog.getByText("This dashboard includes your exact location.")).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Create link" })).toBeHidden();
		await dialog.getByRole("button", { name: "Use 93721 instead" }).click();
		const live = dialog.getByRole("textbox", { name: "Live link" });
		await expect(live).toHaveValue(/\/workspace\/shared\/[^/]+$/);
		const url = await live.inputValue();
		await page.keyboard.press("Escape");
		await expect(widgetTitles(page)).toHaveText(["PM2.5 · 93721 · Last 30 days"]);

		// Viewers read the region, not the point.
		const viewer = await documentsServer.newDevice();
		viewer.account.set(null);
		await viewer.page.goto(url);
		await expect(widgetTitles(viewer.page)).toHaveText(["PM2.5 · 93721 · Last 30 days"]);

		// With the link on, Use my location (from another place) saves the region and says so.
		await widgetMenuItem(page, "PM2.5 · 93721 · Last 30 days", "Change place");
		await picker(page).getByRole("button", { name: "Remove 93721" }).click();
		await searchBox(page).fill("fre");
		await picker(page)
			.getByRole("option", { name: /^Fresno County/ })
			.click();
		await picker(page).getByRole("button", { name: "Done" }).click();
		await expect(widgetTitles(page)).toHaveText([CHART_TITLE]);
		await useMyLocation(page);
		await expect(
			page.getByText("This dashboard is shared by link, so your location is saved as 93721.")
		).toBeVisible();
		await expect(widgetTitles(page)).toHaveText(["PM2.5 · 93721 · Last 30 days"]);
	});

	test("an exact location shared by live link reads (shared location) to viewers", async ({
		page,
		documentsServer
	}) => {
		await pointOnAccount(page);
		const dialog = await openShare(page);
		await dialog.getByRole("button", { name: "Share my exact location" }).click();
		const live = dialog.getByRole("textbox", { name: "Live link" });
		await expect(live).toHaveValue(/\/workspace\/shared\/[^/]+$/);
		const url = await live.inputValue();

		const viewer = await documentsServer.newDevice();
		viewer.account.set(null);
		await viewer.page.goto(url);
		await expect(widgetTitles(viewer.page)).toHaveText([
			"PM2.5 · 93721 (shared location) · Last 30 days"
		]);
	});
});
