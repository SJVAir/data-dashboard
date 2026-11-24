/**
 * The Get data view end to end, on the API fixtures: adding from the top nav and from "Add
 * widget", editing a widget's data, and a CSV of the draft with an overlay. The forecasts (burn
 * status) come from `e2e/forecasts-server.ts`, re-dated to the days asked for.
 */
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	AIR_QUALITY_SECTION,
	CHART_TITLE,
	DASHBOARD_URL,
	STARTER_TITLES,
	addToButton,
	addWidget,
	expectSaved,
	makeOwnCopy,
	nav,
	openSection,
	shareLinkFor,
	titleBar,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

const GET_DATA = { level: 1, name: "Data Portal" } as const;
const STARTER = STARTER_TITLES.length;

/** The CSV `page`'s Download CSV button saves, as rows of cells (simple: no quoted commas). */
async function downloadCsv(page: Page): Promise<Record<string, string>[]> {
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download CSV" }).click();
	const path = test.info().outputPath("get-data.csv");
	await (await download).saveAs(path);
	const [header, ...rows] = (await readFile(path, "utf8")).split("\r\n").filter(Boolean);
	const columns = header.split(",");
	return rows.map((row) => Object.fromEntries(row.split(",").map((v, i) => [columns[i], v])));
}

test("Data nav → Add to dashboard lands highlighted, Undo removes it", async ({ page }) => {
	await makeOwnCopy(page);
	const dashboardUrl = page.url();
	await expect(widgetTitles(page)).toHaveCount(STARTER);

	await nav(page).getByRole("link", { name: "Data Portal", exact: true }).click();
	await expect(page).toHaveURL(/\/workspace\/data$/);
	await expect(page.getByRole("heading", GET_DATA)).toBeFocused();
	// It opens filled in: Fresno County PM2.5 for the last 30 days, previewed.
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();

	await page.getByRole("button", { name: "Add to My dashboard", exact: true }).click();
	await expect(page).toHaveURL(dashboardUrl);
	await expect(widgetTitles(page)).toHaveCount(STARTER + 1);
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	// Briefly highlighted, and focused.
	const added = page.locator("[data-added]");
	await expect(added).toHaveCount(1);
	await expect(added.getByRole("heading", { name: CHART_TITLE })).toBeVisible();
	await expect(added.getByRole("group", { name: CHART_TITLE })).toBeFocused();
	// The highlight goes after a moment.
	await expect(added).toHaveCount(0, { timeout: 5000 });

	// One undo step.
	await page.keyboard.press("Control+z");
	await expect(widgetTitles(page)).toHaveCount(STARTER);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveCount(STARTER);
});

test("Edit data → Save changes, Undo restores", async ({ page }) => {
	await makeOwnCopy(page);
	await addWidget(page, "Chart");
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);

	// The one just added, after the starter's own Chart.
	await widgetMenuItem(page, CHART_TITLE, "Open in Data Portal", 1);
	await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeFocused();
	await page.getByRole("button", { name: /^Dates / }).click();
	await page.getByRole("option", { name: "Last 7 days" }).click();
	await page.getByRole("button", { name: "Save changes" }).click();

	await expect(page).toHaveURL(DASHBOARD_URL);
	const edited = "PM2.5 · Fresno County · Last 7 days";
	await expect(widgetTitles(page)).toHaveCount(STARTER + 1);
	await expect(widgetTitles(page).last()).toHaveText(edited);
	await expect(titleBar(page, edited)).toBeFocused();

	// Saving was one undo step; redo brings it back.
	await page.keyboard.press("Control+z");
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expect(widgetTitles(page)).toHaveCount(STARTER + 1);
	await page.keyboard.press("Control+Shift+z");
	await expect(widgetTitles(page).last()).toHaveText(edited);
});

test("Download CSV from the draft has overlay rows", async ({ page }) => {
	await page.goto("data");
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
	await openSection(page, /^Air Quality Forecasts/);
	await page.getByRole("checkbox", { name: "Burn Status" }).check();
	// The Chart draws burn status as day bands, named in its legend.
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await expect(page.getByText(/Burn Status/).first()).toBeVisible();

	const rows = await downloadCsv(page);
	const main = rows.filter((r) => r.entry_type === "pm25");
	const burn = rows.filter((r) => r.entry_type === "burn-status");
	expect(main).toHaveLength(30);
	// A burn status row for each of the 30 days (the fixtures forecast every day), labeled.
	expect(burn).toHaveLength(30);
	for (const row of burn) {
		expect(row.place_name).toBe("Fresno County");
		expect(row.entry_type_label).toBe("Burn Status");
		expect(["discouraged", "registered"]).toContain(row.level_key);
		expect(["Burning Discouraged", "No Burning Unless Registered"]).toContain(row.level_label);
	}
	// The main rows carry no level.
	expect(main.every((r) => r.level_key === "" && r.level_label === "")).toBe(true);
});

test("Add widget → Chart on the starter makes a copy", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(STARTER);
	await page.getByRole("button", { name: "Add widget" }).click();
	await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
	await expect(page).toHaveURL(/\/workspace\/dashboards\/starter\/widgets\/new\?type=chart$/);
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();

	// The target is the starter, named as it reads in the nav.
	await expect(addToButton(page)).toHaveText("Add to Starter dashboard");
	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(STARTER + 1);
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expect(nav(page).getByRole("button", { name: "My dashboard", exact: true })).toBeVisible();

	// The starter itself is unchanged.
	await expectSaved(page);
	await nav(page).getByRole("button", { name: "My dashboard", exact: true }).click();
	await page.getByRole("menuitem", { name: "New from starter" }).click();
	await expect(widgetTitles(page)).toHaveText(STARTER_TITLES);
});

test("adds PM2.5 with a weather strip and a filtered pesticide strip", async ({ page }) => {
	await makeOwnCopy(page);
	await nav(page).getByRole("link", { name: "Data Portal", exact: true }).click();
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();

	// Fresno County has one place, so the station can be chosen: the nearest is the default.
	await openSection(page, /^Weather/);
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).check();
	const station = page.getByRole("combobox", { name: "Station" });
	await expect(station).toHaveValue("I3wADR9bR-2hfub3h3nsJA");
	await expect(page.getByText(/Temperature · CIMIS #80 - Fresno State/).first()).toBeVisible();

	// One filtered pesticide layer: the chemical is searched by name, then picked.
	await openSection(page, /^Pesticide Use/);
	await page.getByRole("button", { name: "Add a pesticide layer" }).click();
	await page.getByRole("menuitem", { name: "Pounds Applied" }).click();
	await page.getByRole("button", { name: "Filters" }).click();
	await page.getByRole("combobox", { name: "Chemical" }).click();
	const asked = page.waitForRequest((r) => /\/pesticides\/place\/\?.*chemical=gs65e/.test(r.url()));
	await page.keyboard.type("su");
	await page
		.getByRole("option", { name: /Sulfur/ })
		.first()
		.click();
	await asked;
	await expect(page.getByTestId("pesticide-summary")).toHaveText(/Sulfur/);
	await expect(page.getByText(/Pounds applied · Sulfur/i).first()).toBeVisible();

	// The draft keeps both layers when added.
	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expect(page.getByText(/Temperature · CIMIS #80 - Fresno State/).first()).toBeVisible();
	await expect(page.getByText(/Pounds applied · Sulfur/i).first()).toBeVisible();
});

test("adds a temperature-only chart", async ({ page }) => {
	await page.goto("data");
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
	await openSection(page, /^Weather/);
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).check();
	await openSection(page, AIR_QUALITY_SECTION);
	await page.getByRole("radio", { name: "None" }).check();
	await expect(page.getByRole("radio", { name: "None" })).toBeChecked();
	// The last number layer can be unchecked too (a widget may hold nothing); it stays on here.
	await expect(page.getByRole("checkbox", { name: "Temperature", exact: true })).toBeEnabled();
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Station" })).toHaveValue(
		"I3wADR9bR-2hfub3h3nsJA"
	);

	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	// The one just added (the starter's own widgets show PM2.5).
	const added = page.getByRole("group", { name: "Chart of Fresno County" }).last();
	await expect(added).toBeVisible();
	await expect(widgetTitles(page).last()).not.toContainText("PM2.5");
	await expect(added.getByText(/PM2\.5/)).toHaveCount(0);
});

test("with no Where, weather draws every station and pesticide use the whole valley", async ({
	page
}) => {
	const range = { kind: "trailing", amount: 12, unit: "month" };
	const widget = (id: string, x: number, layer: object) => ({
		id,
		type: "data-table",
		title: null,
		rect: { x, y: 0, w: 6, h: 6 },
		data: { dateRange: range, resolution: "month", layers: [layer] }
	});
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "no-where-1",
		name: "Everywhere",
		body: {
			widgets: [
				widget("w0", 0, { dataset: "weather", entryType: "temperature" }),
				widget("w1", 6, { dataset: "pesticide-use", entryType: "pounds-applied" })
			]
		}
	};
	// Every station from bulk requests naming the catalog's weather type; the valley's use from
	// a request naming no place.
	const stations = page.waitForRequest((r) =>
		/\/monitors\/temperature\/summaries\/monthly\/\?.*type=cimis/.test(r.url())
	);
	const valley = page.waitForRequest(
		(r) =>
			/\/pesticides\/place\/\?/.test(r.url()) && !new URL(r.url()).searchParams.has("region_type")
	);
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await Promise.all([stations, valley]);
	const tables = page.getByRole("table");
	// One column per station, named from the response; one for the valley.
	await expect(
		tables.getByRole("columnheader", { name: /CIMIS #80 - Fresno State/ }).first()
	).toBeVisible();
	await expect(
		tables.getByRole("columnheader", { name: /CIMIS #15 - Stratford/ }).first()
	).toBeVisible();
	await expect(tables.getByRole("columnheader", { name: /Whole valley/ }).first()).toBeVisible();
});

test("with no Where, a weather overlay on the valley's pesticide use says to add a place", async ({
	page
}) => {
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "no-where-2",
		name: "Everywhere",
		body: {
			widgets: [
				{
					id: "w0",
					type: "chart",
					title: null,
					rect: { x: 0, y: 0, w: 12, h: 8 },
					data: {
						dateRange: { kind: "trailing", amount: 12, unit: "month" },
						resolution: "month",
						layers: [
							{ dataset: "pesticide-use", entryType: "pounds-applied" },
							{ dataset: "weather", entryType: "temperature" }
						]
					}
				}
			]
		}
	};
	const weather: string[] = [];
	page.on("request", (r) => {
		if (
			/\/monitors\/(weather\/place|temperature\/summaries)|\/summaries\/temperature\//.test(r.url())
		) {
			weather.push(r.url());
		}
	});
	const valley = page.waitForRequest(
		(r) =>
			/\/pesticides\/place\/\?/.test(r.url()) && !new URL(r.url()).searchParams.has("region_type")
	);
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await valley;
	// The main draws the valley; the overlay isn't fetched and says why.
	await expect(page.getByText(/Whole valley/).first()).toBeVisible();
	await expect(page.getByText("Add a place to show Temperature beside it.")).toBeVisible();
	expect(weather).toEqual([]);
});

test("with no Where, a pesticide overlay on every station says to add a place", async ({
	page
}) => {
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "no-where-3",
		name: "Everywhere",
		body: {
			widgets: [
				{
					id: "w0",
					type: "chart",
					title: null,
					rect: { x: 0, y: 0, w: 12, h: 8 },
					data: {
						dateRange: { kind: "trailing", amount: 12, unit: "month" },
						resolution: "month",
						layers: [
							{ dataset: "weather", entryType: "temperature" },
							{ dataset: "pesticide-use", entryType: "pounds-applied" }
						]
					}
				}
			]
		}
	};
	const pesticides: string[] = [];
	page.on("request", (r) => {
		if (/\/pesticides\/place\//.test(r.url())) pesticides.push(r.url());
	});
	const stations = page.waitForRequest((r) =>
		/\/monitors\/temperature\/summaries\/monthly\/\?.*type=cimis/.test(r.url())
	);
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await stations;
	// The main draws every station; the overlay isn't fetched and says why.
	await expect(page.getByText(/CIMIS #15 - Stratford/).first()).toBeVisible();
	await expect(page.getByText("Add a place to show Pounds Applied beside it.")).toBeVisible();
	expect(pesticides).toEqual([]);
});

test("downloads a CSV with station and filter columns", async ({ page }) => {
	await page.goto("data");
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await openSection(page, /^Weather/);
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).check();
	await openSection(page, /^Pesticide Use/);
	await page.getByRole("button", { name: "Add a pesticide layer" }).click();
	await page.getByRole("menuitem", { name: "Pounds Applied" }).click();
	await page.getByRole("button", { name: "Filters" }).click();
	await page.getByRole("combobox", { name: "Chemical" }).click();
	await page.keyboard.type("su");
	await page
		.getByRole("option", { name: /Sulfur/ })
		.first()
		.click();
	await expect(page.getByTestId("pesticide-summary")).toHaveText(/Sulfur/);

	const rows = await downloadCsv(page);
	const temperature = rows.filter((r) => r.entry_type === "temperature");
	const pesticides = rows.filter((r) => r.entry_type === "pounds-applied");
	expect(temperature.length).toBeGreaterThan(0);
	expect(pesticides.length).toBeGreaterThan(0);
	for (const row of temperature) {
		expect(row.source_id).toBe("I3wADR9bR-2hfub3h3nsJA");
		expect(row.source_name).toBe("CIMIS #80 - Fresno State");
		expect(row.filters).toBe("");
		expect(row.aggregate).toBe("mean");
	}
	for (const row of pesticides) {
		expect(row.source_id).toBe("");
		expect(row.filters).toBe("Sulfur");
		// Pounds applied is a total.
		expect(row.aggregate).toBe("sum");
	}
	// The main rows carry neither. Pesticide use is monthly at best, so with Automatic the whole
	// dataset is Monthly: the last 30 days reach into two months (the open one is partial: the
	// server's nightly row, read with its figure, the average of 24-hour averages).
	const main = rows.filter((r) => r.entry_type === "pm25");
	expect(main).toHaveLength(2);
	expect(main.every((r) => r.resolution === "month")).toBe(true);
	expect(main.every((r) => r.source_id === "" && r.filters === "")).toBe(true);
	expect(main.every((r) => r.aggregate === "mean")).toBe(true);
});

test("an old PM2.5 + burn status widget still shows its bands", async ({ page }) => {
	const place = { kind: "region", type: "county", code: "06019" };
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "old-burn-1",
		name: "Old burn",
		body: {
			widgets: [
				{
					id: "w0",
					type: "chart",
					title: "Old burn chart",
					rect: { x: 0, y: 0, w: 8, h: 4 },
					data: {
						dateRange: { kind: "trailing", amount: 30, unit: "day" },
						place,
						layers: [
							{ dataset: "air-quality", entryType: "pm25" },
							{ dataset: "forecasts", entryType: "burn-status" }
						]
					}
				}
			]
		}
	};
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	const chart = page.getByRole("group", { name: "Chart of Fresno County" });
	await expect(chart).toBeVisible();
	// The burn status is a band layer, named in the legend, and no station or filter shows.
	await expect(page.getByText(/Burn Status/).first()).toBeVisible();
	await expect(page.getByText(/CIMIS/)).toHaveCount(0);
	// Its bands are drawn, and no strip is.
	await expect
		.poll(async () => Number(await chart.getAttribute("data-day-bands")))
		.toBeGreaterThan(0);
	await expect(chart.locator("[data-strip]")).toHaveCount(0);
});

test("Add widget → Current conditions keeps the default alert level through Edit data", async ({
	page
}) => {
	const title = "PM2.5 · Fresno County";
	const usg = "unhealthy_sensitive";
	await makeOwnCopy(page);
	await page.getByRole("button", { name: "Add widget" }).click();
	await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();

	await page.getByRole("radio", { name: "Current conditions" }).click();
	await expect(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();
	// No dates for a now widget, and the form says they were left out.
	await expect(page.getByRole("button", { name: /^Dates/ })).toHaveCount(0);
	await expect(
		page.getByText("Dates don't apply to this widget, so they were left out.")
	).toBeVisible();

	// One place, picked straight away (single mode).
	await page.getByRole("button", { name: "Change places" }).click();
	const picker = page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
	await picker.getByRole("combobox", { name: "Search for a place" }).fill("fre");
	await picker.getByRole("option", { name: /^Fresno County/ }).click();
	await expect(picker).toBeHidden();
	await expect(page.getByTestId("where-summary")).toHaveText("Fresno County");

	const alert = page.getByRole("combobox", { name: "Alert level" });
	await expect(alert).toHaveValue(usg);
	await expect(alert.locator("option:checked")).toHaveText(
		"Tell me at Unhealthy for Sensitive Groups or worse"
	);

	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page).last()).toHaveText(title);

	// The one just added, after the starter's own Current conditions.
	await widgetMenuItem(page, title, "Open in Data Portal", 1);
	await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeFocused();
	await expect(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();
	await expect(page.getByRole("combobox", { name: "Alert level" })).toHaveValue(usg);
	// Opening a saved now widget converts nothing.
	await expect(page.getByText(/so they were left out/)).toHaveCount(0);
});

test("on two columns the left column scrolls under the top nav; the preview and actions stay", async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("data");
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	const column = page.getByRole("group", { name: "What, When and Where" });
	// What comes first, then When and Where, then Data resolution and More options.
	const headings = column.getByRole("heading", { level: 2 });
	await expect(headings).toHaveText(["What", "When", "Where", "Data resolution", /^More options/]);
	// Open every section the Chart shows, so the column is taller than the screen.
	const closed = column.locator("[data-what-section] h3 button[aria-expanded=false]:enabled");
	while ((await closed.count()) > 0) await closed.first().click();
	await expect.poll(() => column.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	// The page itself doesn't scroll: the view fills the screen below the nav.
	expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
	await column.evaluate((el) => (el.scrollTop = el.scrollHeight));
	const preview = await page.getByTestId("get-data-preview").boundingBox();
	expect(preview!.y).toBeGreaterThanOrEqual(0);
	expect(preview!.y).toBeLessThan(720);
	const add = await addToButton(page).boundingBox();
	expect(add!.y + add!.height).toBeLessThanOrEqual(720);
	// The top nav is still there above the view.
	await expect(nav(page)).toBeInViewport();
});

for (const width of [390, 320]) {
	test(`at ${width} px the Data Portal fits the screen as a Chart and as a Map (no sideways scroll)`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto("data");
		await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
		const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
		expect(await scrollWidth()).toBeLessThanOrEqual(width);
		await page.getByRole("radio", { name: "Map" }).click();
		await expect(page.getByRole("radio", { name: "Map" })).toBeChecked();
		await expect(page.getByRole("button", { name: "Fill regions by" })).toBeEnabled();
		expect(await scrollWidth()).toBeLessThanOrEqual(width);
		// The choices still work from the keyboard: arrows move along the group.
		await page.getByRole("radio", { name: "Map" }).focus();
		await page.keyboard.press("ArrowLeft");
		await expect(page.getByRole("radio", { name: "Data table" })).toBeFocused();
	});
}

test("Show as keeps the ticked monitor types from a Map to a Chart, and a calendar notes them left out", async ({
	page
}) => {
	await page.clock.install({ time: "2026-11-15T12:00:00-08:00" });
	await page.goto("data");
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await openSection(page, AIR_QUALITY_SECTION);
	const purple = page.getByRole("checkbox", { name: "PurpleAir" });
	// A new Chart starts with none ticked; a new Map with every type (decision 8).
	await expect(purple).not.toBeChecked();
	await page.locator('[data-show-as="map"]').click();
	await expect(page.locator('[data-show-as="map"]')).toHaveAttribute("data-state", "on");
	await expect(purple).toBeChecked();
	// Back to a Chart: the ticks are kept, and nothing is noted.
	await page.locator('[data-show-as="chart"]').click();
	await expect(page.locator('[data-show-as="chart"]')).toHaveAttribute("data-state", "on");
	await expect(purple).toBeChecked();
	await expect(page.getByText(/left out/)).toHaveCount(0);
	// A calendar shows one place or one monitor: the ticks go, with a note; the county stays.
	await page.locator('[data-show-as="calendar-month"]').click();
	await expect(page.locator('[data-show-as="calendar-month"]')).toHaveAttribute("data-state", "on");
	await expect(
		page.getByText(
			"This widget shows one place or one monitor, so the chosen monitor types were left out."
		)
	).toBeVisible();
	await expect(page.getByTestId("where-summary")).toHaveText("Fresno County");
	await openSection(page, AIR_QUALITY_SECTION);
	await expect(page.getByRole("checkbox", { name: "PurpleAir" })).toHaveCount(0);
});

test("a Chart of Fresno County with PurpleAir ticked asks once per period for the county's PurpleAirs", async ({
	page
}) => {
	await page.clock.install({ time: "2026-11-15T12:00:00-08:00" });
	await page.goto("data");
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();

	await openSection(page, AIR_QUALITY_SECTION);
	const asked: URL[] = [];
	page.on("request", (r) => {
		const url = new URL(r.url());
		if (/\/monitors\/pm25\/summaries\/(daily|hourly)\/$/.test(url.pathname)) asked.push(url);
	});
	const bulk = page.waitForRequest(
		(r) => /\/monitors\/pm25\/summaries\/daily\/\?/.test(r.url()) && /type=purpleair/.test(r.url())
	);
	await page.getByRole("checkbox", { name: "PurpleAir" }).check();
	const url = new URL((await bulk).url());
	// Fresno County's server id, and the one type: one request holds every PurpleAir there.
	expect(url.searchParams.getAll("region")).toEqual(["r6phe"]);
	expect(url.searchParams.getAll("type")).toEqual(["purpleair"]);

	// One line per PurpleAir in the county, each named for its monitor (the table has a column
	// for each line).
	await page.locator('[data-show-as="data-table"]').click();
	const table = page.getByRole("region", { name: "Data table values" });
	await expect(table.getByRole("columnheader", { name: /Science Building Room 74/ })).toHaveCount(
		1
	);
	await expect(table.getByRole("columnheader", { name: /Clovis Library Room 3/ })).toHaveCount(1);
	await expect(table.getByRole("columnheader", { name: /Fresno County/ })).toHaveCount(0);
	// Every request for the monitor set carried the county and the type: nothing unscoped.
	const sets = asked.filter((u) => u.searchParams.has("type"));
	expect(sets.length).toBeGreaterThan(0);
	for (const set of sets) {
		expect(set.searchParams.getAll("region")).toEqual(["r6phe"]);
		expect(set.searchParams.getAll("type")).toEqual(["purpleair"]);
	}
	// One bulk request per period asked, never one per monitor.
	const periods = sets.map(
		(u) => `${u.pathname}|${u.searchParams.get("start")}|${u.searchParams.get("end")}`
	);
	expect(new Set(periods).size).toBe(periods.length);
});
