/**
 * The starter dashboard end to end, on the API fixtures: the place bar and the chosen place, the
 * hand-off to the person's own copy, the bar on a copy ("Also change…"), "Duplicate for another
 * place…", and accessibility of the starter in both modes at desktop and phone widths. The
 * first visit, the first-edit copy by renaming and the Share hand-off are in `finish-line` and
 * `sharing`; the point and its ZIP are in `place-picker`.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { EVERY_MONITOR_TYPE, routeMapMeta } from "./map-data-server";
import {
	CHART_TITLE,
	DASHBOARD_URL,
	NOTE,
	hasWebGL,
	STARTER_TITLES,
	expectNoViolations,
	expectSaved,
	openPicker,
	renameWidget,
	shareLinkFor,
	titleBar,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

const TULARE_TITLES = STARTER_TITLES.map((t) => t.replace("Fresno County", "Tulare County"));
/** Where the Map's title is in reading order (the fifth widget, under the now row). */
const MAP_INDEX = 4;
/**
 * The titles on a phone before the Map is scrolled near: its code (which works out its generated
 * title) loads only once its frame nears the screen, so until then it reads its type's label.
 */
const PHONE_TITLES = STARTER_TITLES.with(MAP_INDEX, "Map");

function bar(page: Page): Locator {
	return page.getByRole("region", { name: "This dashboard's place" });
}

function picker(page: Page): Locator {
	return page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
}

/** Opens the bar's picker and picks the county `name` from the Counties list. */
async function changeBarPlace(page: Page, name: string): Promise<void> {
	await bar(page).getByRole("button", { name: "Change place" }).click();
	await expect(picker(page)).toBeVisible();
	await picker(page)
		.getByRole("button", { name: /^Counties/ })
		.click();
	await picker(page)
		.getByRole("grid", { name: "Places in this list" })
		.getByRole("row", { name: new RegExp(name) })
		.click();
	const done = picker(page).getByRole("button", { name: "Done" });
	if (await done.isVisible()) await done.click();
	await expect(picker(page)).toBeHidden();
}

/** Every stored dashboard document, read straight from IndexedDB. */
async function storedDashboards(page: Page): Promise<unknown[]> {
	return page.evaluate(
		() =>
			new Promise<unknown[]>((resolve, reject) => {
				const open = indexedDB.open("sjvair-workspace");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					const all = db.transaction("documents").objectStore("documents").getAll();
					all.onsuccess = () => {
						db.close();
						resolve(all.result.map((r: { doc: unknown }) => r.doc));
					};
					all.onerror = () => reject(all.error);
				};
			})
	);
}

test("first visit: the bar names Fresno County and the welcome Note comes first", async ({
	page
}) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
	await expect(bar(page).getByText("Showing Fresno County")).toBeVisible();
	await expect(bar(page).getByRole("button", { name: "Change place" })).toBeVisible();
	await expect(page.getByText("Welcome to the SJVAir Dashboard.")).toBeVisible();
});

test("Change place on the starter makes no copy and survives a reload", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
	await changeBarPlace(page, "Tulare County");
	await expect(widgetTitles(page)).toHaveText(TULARE_TITLES);
	await expect(bar(page).getByText("Showing Tulare County")).toBeVisible();
	// Still the starter: the address didn't change and nothing was stored as a dashboard.
	await expect(page).toHaveURL(/\/workspace\/$/);
	expect(await storedDashboards(page)).toEqual([]);

	await page.reload();
	await expect(widgetTitles(page)).toHaveText(TULARE_TITLES);
	await expect(bar(page).getByText("Showing Tulare County")).toBeVisible();
	await expect(page).toHaveURL(/\/workspace\/$/);
});

/** The starter's Map (its region, holding the GL map and its toolbar). */
function starterMap(page: Page, place = "Fresno County"): Locator {
	return page.getByRole("region", { name: `PM2.5 map · ${place}`, exact: true });
}

test.describe("the starter's Map", () => {
	test("shows full width under the now row, with smoke and fire", async ({
		page,
		context,
		browserName
	}) => {
		// The metadata with the smoke and fire datasets, so the toolbar has its Layers menu.
		await routeMapMeta(context);
		test.skip(browserName === "firefox", "no WebGL for the toolbar in Firefox here");
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		const map = starterMap(page);
		await expect(map).toBeVisible();
		const main = (await page.getByRole("main").boundingBox())!;
		const frame = (await map.boundingBox())!;
		// Full width: it spans the grid, whatever the page's padding.
		expect(frame.width).toBeGreaterThan(main.width * 0.85);
		// Under the now row: below the Forecast, the last of the three above it.
		const forecast = (await titleBar(page, STARTER_TITLES[3]).boundingBox())!;
		expect(frame.y).toBeGreaterThan(forecast.y + forecast.height);
		const toolbar = map.getByRole("group", { name: "Map options", exact: true });
		const layers = toolbar.getByRole("button", { name: "Layers", exact: true });
		await expect(layers).toBeVisible();
		await layers.click();
		await expect(
			toolbar.getByRole("checkbox", { name: "Fire & Smoke", exact: true })
		).toBeChecked();
	});

	test("Change place moves the Map", async ({ page }) => {
		await page.goto("./");
		const webgl = await hasWebGL(page);
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		if (webgl) await expect(starterMap(page)).toBeVisible();
		await changeBarPlace(page, "Tulare County");
		await expect(widgetTitles(page)).toHaveText(TULARE_TITLES);
		await expect(widgetTitles(page).nth(4)).toHaveText("PM2.5 map · Tulare County");
		if (webgl) await expect(starterMap(page, "Tulare County")).toBeVisible();
	});

	test("the first edit's copy keeps the Map's monitor types", async ({ page }) => {
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		await renameWidget(page, NOTE, "My first widget");
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expectSaved(page);
		const docs = (await storedDashboards(page)) as {
			body: { widgets: { type: string; data: { layers?: { monitorTypes?: string[] }[] } }[] };
		}[];
		expect(docs).toHaveLength(1);
		const map = docs[0].body.widgets.find((w) => w.type === "map")!;
		expect(map.data.layers![0].monitorTypes).toEqual(EVERY_MONITOR_TYPE);
	});

	test("on a phone it is full width", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveText(PHONE_TITLES);
		// Below the fold, its code waits until it's scrolled near.
		await titleBar(page, "Map").scrollIntoViewIfNeeded();
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		// The widget's frame, which a browser with no WebGL shows too (it has no map region).
		const map = page.getByTestId("widget-starter-5");
		if (await hasWebGL(page)) await expect(starterMap(page)).toBeVisible();
		await expect(map).toBeVisible();
		const frame = (await map.boundingBox())!;
		expect(frame.width).toBeGreaterThan(390 * 0.85);
		expect(frame.x + frame.width).toBeLessThanOrEqual(390);
	});
});

/** The one stored dashboard: its bar's place, and each data widget's place (its Where). */
async function copyPlaces(page: Page) {
	const docs = (await storedDashboards(page)) as {
		body: {
			placeBar?: { place: unknown };
			widgets: { data: { place?: unknown; layers?: unknown[] } }[];
		};
	}[];
	expect(docs).toHaveLength(1);
	const body = docs[0].body;
	// A Note has no layers, so no Where.
	const places = body.widgets.flatMap((w) => ((w.data.layers ?? []).length ? [w.data.place] : []));
	return { bar: body.placeBar?.place, places, json: JSON.stringify(body) };
}

const TULARE = { kind: "region", type: "county", code: "06107" };

test("the first edit (a move) makes a copy that keeps the chosen place and no default-place", async ({
	page
}) => {
	await page.goto("./");
	await changeBarPlace(page, "Tulare County");
	await expect(widgetTitles(page)).toHaveText(TULARE_TITLES);
	await titleBar(page, TULARE_TITLES[1]).focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expectSaved(page);
	// The move reordered the widgets, but each is still at Tulare County.
	await expect(widgetTitles(page)).toHaveCount(TULARE_TITLES.length);
	await expect(widgetTitles(page).filter({ hasText: "Fresno" })).toHaveCount(0);
	const copy = await copyPlaces(page);
	expect(copy.bar).toEqual(TULARE);
	expect(copy.json).not.toContain("default-place");
	for (const place of copy.places) expect(place).toEqual(TULARE);
	expect(copy.places.length).toBeGreaterThan(0);
});

test("a calendar day selection is the first edit and makes the copy", async ({ page }) => {
	await page.goto("./");
	const calendar = page.getByRole("grid").first();
	const cells = calendar.locator("[role=gridcell][data-date]");
	await expect(cells.first()).toBeAttached();
	await cells.filter({ hasText: /\S/ }).first().click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	const copy = await copyPlaces(page);
	expect(copy.json).not.toContain("default-place");
	expect(copy.bar).toEqual({ kind: "region", type: "county", code: "06019" });
});

test("Open these days in a chart from the starter's calendar makes a copy", async ({ page }) => {
	await page.goto("./");
	const calendar = page.getByRole("grid").first();
	const cells = calendar.locator("[role=gridcell][data-date]");
	await expect(cells.first()).toBeAttached();
	await cells.filter({ hasText: /\S/ }).first().click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	const title = STARTER_TITLES[STARTER_TITLES.length - 1];
	await widgetMenuItem(page, title, "Open these days in a chart");
	await expect(widgetTitles(page)).toHaveCount(STARTER_TITLES.length + 1);
	const copy = await copyPlaces(page);
	expect(copy.json).not.toContain("default-place");
});

test.describe("the bar on a copy", () => {
	test("Change place changes every widget; Also change brings the others along", async ({
		page
	}) => {
		// Two picker flows over the six-widget starter: past 30 s on a slow WebKit runner.
		test.slow();
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		// One Chart shows another place now (the first edit, so the starter is saved as a copy).
		await widgetMenuItem(page, CHART_TITLE, "Change place");
		await picker(page).getByRole("button", { name: "Remove Fresno County" }).click();
		await picker(page)
			.getByRole("button", { name: /^Counties/ })
			.click();
		const grid = picker(page).getByRole("grid", { name: "Places in this list" });
		await grid.getByRole("row", { name: /Madera County/ }).click();
		await picker(page).getByRole("button", { name: "Done" }).click();
		await expect(picker(page)).toBeHidden();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page)).toContainText(
			["PM2.5 · Madera County · Last 30 days"].map((t) => t)
		);
		await expect(widgetTitles(page).filter({ hasText: "Madera County" })).toHaveCount(1);

		await bar(page).getByRole("button", { name: "Change place" }).click();
		const also = picker(page).getByRole("checkbox", {
			name: "Also change the widget showing another place to the new one"
		});
		await expect(also).toBeVisible();
		await also.check();
		await picker(page)
			.getByRole("button", { name: /^Counties/ })
			.click();
		await picker(page)
			.getByRole("grid", { name: "Places in this list" })
			.getByRole("row", { name: /Tulare County/ })
			.click();
		const done = picker(page).getByRole("button", { name: "Done" });
		if (await done.isVisible()) await done.click();
		await expect(picker(page)).toBeHidden();
		await expect(widgetTitles(page).filter({ hasText: "Madera County" })).toHaveCount(0);
		await expect(widgetTitles(page).filter({ hasText: "Tulare County" })).toHaveCount(
			STARTER_TITLES.length - 1
		);
		await expect(bar(page).getByText("Showing Tulare County")).toBeVisible();
		await expectSaved(page);
	});
});

test.describe("Duplicate for another place", () => {
	test("makes a copy at the new place and leaves the original", async ({ page }) => {
		await page.goto("./");
		await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
		await renameWidget(page, NOTE, "My note");
		await expect(page).toHaveURL(DASHBOARD_URL);
		const original = page.url();
		await openPicker(page, "My dashboard");
		await page.getByRole("menuitem", { name: "Duplicate for another place…" }).click();
		await picker(page)
			.getByRole("button", { name: /^Counties/ })
			.click();
		await picker(page)
			.getByRole("grid", { name: "Places in this list" })
			.getByRole("row", { name: /Tulare County/ })
			.click();
		const done = picker(page).getByRole("button", { name: "Done" });
		if (await done.isVisible()) await done.click();
		// The copy opens, with its rename dialog (waiting for the URL to leave the original's).
		await expect(page).not.toHaveURL(original);
		await expect(page).toHaveURL(DASHBOARD_URL);
		await page.keyboard.press("Escape");
		await expect(widgetTitles(page).filter({ hasText: "Tulare County" })).toHaveCount(
			STARTER_TITLES.length - 1
		);
		await expect(bar(page).getByText("Showing Tulare County")).toBeVisible();
		await page.goto(original);
		await expect(bar(page).getByText("Showing Fresno County")).toBeVisible();
	});

	test("on a tie, Which place? asks first (and passes axe)", async ({ page }) => {
		const chart = (id: string, y: number, code: string) => ({
			id,
			type: "chart",
			title: null,
			rect: { x: 0, y, w: 6, h: 6 },
			data: {
				dateRange: { kind: "trailing", amount: 30, unit: "day" },
				place: { kind: "region", type: "county", code },
				layers: [
					{
						dataset: "air-quality",
						entryType: "pm25"
					}
				]
			}
		});
		const doc = {
			kind: "dashboard",
			schemaVersion: 1,
			id: "shared-tie-1",
			name: "Two counties",
			body: { widgets: [chart("w0", 0, "06019"), chart("w1", 6, "06107")] }
		};
		await page.goto(shareLinkFor(doc));
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page)).toHaveCount(2);
		await openPicker(page, "Two counties");
		await page.getByRole("menuitem", { name: "Duplicate for another place…" }).click();
		const dialog = page.getByRole("dialog", { name: "Which place do you want to replace?" });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("radio")).toHaveCount(2);
		await expect(dialog.getByRole("radio", { name: "Fresno County" })).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Continue" })).toBeEnabled();
		await expectNoViolations(page);
		// Cancel asks nothing more and makes no copy.
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
		await expect(picker(page)).toBeHidden();

		// Choosing one asks where it goes instead; the copy swaps only that place.
		await openPicker(page, "Two counties");
		await page.getByRole("menuitem", { name: "Duplicate for another place…" }).click();
		await dialog.getByRole("radio", { name: "Tulare County" }).check();
		await dialog.getByRole("button", { name: "Continue" }).click();
		await expect(picker(page)).toBeVisible();
		await picker(page)
			.getByRole("button", { name: /^Counties/ })
			.click();
		await picker(page)
			.getByRole("grid", { name: "Places in this list" })
			.getByRole("row", { name: /Madera County/ })
			.click();
		const done = picker(page).getByRole("button", { name: "Done" });
		if (await done.isVisible()) await done.click();
		await expect(page.getByRole("dialog", { name: "Rename dashboard" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(widgetTitles(page)).toHaveText([
			"PM2.5 · Fresno County · Last 30 days",
			"PM2.5 · Madera County · Last 30 days"
		]);
	});
});

// The starter, in both modes at desktop and phone widths.
for (const colorScheme of ["light", "dark"] as const) {
	for (const [size, viewport] of [
		["desktop", { width: 1280, height: 800 }],
		["phone", { width: 390, height: 844 }]
	] as const) {
		test.describe(`${colorScheme} mode, ${size}`, () => {
			test.use({ colorScheme, viewport });

			test("the starter has no violations and reads Note, Current, Outside, Forecast, Map, Chart, Calendar", async ({
				page
			}) => {
				await page.goto("./");
				// On a phone the Map is below the fold: until it's scrolled near, its code hasn't
				// loaded and its title is its type's label.
				const titles = size === "phone" ? PHONE_TITLES : STARTER_TITLES;
				await expect(widgetTitles(page)).toHaveText(titles);
				await expect(bar(page)).toBeVisible();
				await expectNoViolations(page);
				// The headings are in document order, so this is the reading order.
				await expect(widgetTitles(page)).toHaveText(titles);
				if (size === "phone") {
					// Scrolled near, the Map loads and takes its full title; checked again with it.
					await titleBar(page, "Map").scrollIntoViewIfNeeded();
					await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
					if (await hasWebGL(page)) await expect(starterMap(page)).toBeVisible();
					await expectNoViolations(page);
					// The welcome Note grows to fit its text on a phone (WCAG reflow): none of it is
					// hidden behind a scroll inside the Note.
					const note = page.getByRole("region", { name: NOTE });
					await expect(note).toContainText(/\S/);
					await expect
						.poll(() => note.evaluate((el) => el.scrollHeight - el.clientHeight))
						.toBeLessThanOrEqual(0);
				}
			});
		});
	}
}
