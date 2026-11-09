/**
 * The Get data view end to end, on the API fixtures: adding from the top nav and from "Add
 * widget", editing a widget's data, and a CSV of the draft with an overlay. The forecasts (burn
 * status) come from `e2e/forecasts-server.ts`, re-dated to the days asked for.
 */
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	CHART_TITLE,
	DASHBOARD_URL,
	addToButton,
	addWidget,
	expectSaved,
	makeOwnCopy,
	nav,
	shareLinkFor,
	titleBar,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

const GET_DATA = { level: 1, name: "Get data" } as const;

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
	await expect(widgetTitles(page)).toHaveCount(3);

	await nav(page).getByRole("link", { name: "Data", exact: true }).click();
	await expect(page).toHaveURL(/\/workspace\/data$/);
	await expect(page.getByRole("heading", GET_DATA)).toBeFocused();
	// It opens filled in: Fresno County PM2.5 for the last 30 days, previewed.
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();

	await page.getByRole("button", { name: "Add to My dashboard", exact: true }).click();
	await expect(page).toHaveURL(dashboardUrl);
	await expect(widgetTitles(page)).toHaveCount(4);
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
	await expect(widgetTitles(page)).toHaveCount(3);
	await expectSaved(page);
	await page.reload();
	await expect(widgetTitles(page)).toHaveCount(3);
});

test("Edit data → Save changes, Undo restores", async ({ page }) => {
	await makeOwnCopy(page);
	await addWidget(page, "Chart");
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);

	await widgetMenuItem(page, CHART_TITLE, "Edit data");
	await expect(page.getByRole("heading", { level: 1, name: "Edit data" })).toBeFocused();
	await page.getByRole("button", { name: /^Dates / }).click();
	await page.getByRole("option", { name: "Last 7 days" }).click();
	await page.getByRole("button", { name: "Save changes" }).click();

	await expect(page).toHaveURL(DASHBOARD_URL);
	const edited = "PM2.5 · Fresno County · Last 7 days";
	await expect(widgetTitles(page)).toHaveCount(4);
	await expect(widgetTitles(page).last()).toHaveText(edited);
	await expect(titleBar(page, edited)).toBeFocused();

	// Saving was one undo step; redo brings it back.
	await page.keyboard.press("Control+z");
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expect(widgetTitles(page)).toHaveCount(4);
	await page.keyboard.press("Control+Shift+z");
	await expect(widgetTitles(page).last()).toHaveText(edited);
});

test("Download CSV from the draft has overlay rows", async ({ page }) => {
	await page.goto("data");
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
	await page.getByRole("button", { name: /^Air Quality Forecasts/ }).click();
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
	await expect(widgetTitles(page)).toHaveCount(3);
	await page.getByRole("button", { name: "Add widget" }).click();
	await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
	await expect(page).toHaveURL(/\/workspace\/dashboards\/starter\/widgets\/new\?type=chart$/);
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();

	// The target is the starter, named as it reads in the nav.
	await expect(addToButton(page)).toHaveText("Add to Starter dashboard");
	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(4);
	await expect(widgetTitles(page).last()).toHaveText(CHART_TITLE);
	await expect(nav(page).getByRole("button", { name: "My dashboard", exact: true })).toBeVisible();

	// The starter itself is unchanged.
	await expectSaved(page);
	await nav(page).getByRole("button", { name: "My dashboard", exact: true }).click();
	await page.getByRole("menuitem", { name: "New from starter" }).click();
	await expect(widgetTitles(page)).toHaveCount(3);
});

/** Opens a Get data section (Weather, Pesticide Use, …) by its heading. */
async function openSection(page: Page, name: RegExp): Promise<void> {
	await page.getByRole("button", { name }).click();
}

test("adds PM2.5 with a weather strip and a filtered pesticide strip", async ({ page }) => {
	await makeOwnCopy(page);
	await nav(page).getByRole("link", { name: "Data", exact: true }).click();
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
	await page.getByRole("radio", { name: "None" }).check();
	await expect(page.getByRole("radio", { name: "None" })).toBeChecked();
	// The last number layer can't be unchecked.
	await expect(page.getByRole("checkbox", { name: "Temperature", exact: true })).toBeDisabled();
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Station" })).toHaveValue(
		"I3wADR9bR-2hfub3h3nsJA"
	);

	await addToButton(page).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await expect(page.getByText(/PM2\.5/)).toHaveCount(0);
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
	// The main rows carry neither.
	const main = rows.filter((r) => r.entry_type === "pm25");
	expect(main).toHaveLength(30);
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
						layers: [
							{ dataset: "air-quality", entryType: "pm25", place },
							{ dataset: "forecasts", entryType: "burn-status", place }
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
		page.getByText("Dates and extra places don't apply to this widget, so they were left out.")
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

	await widgetMenuItem(page, title, "Edit data");
	await expect(page.getByRole("heading", { level: 1, name: "Edit data" })).toBeFocused();
	await expect(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();
	await expect(page.getByRole("combobox", { name: "Alert level" })).toHaveValue(usg);
	// Opening a saved now widget converts nothing.
	await expect(page.getByText(/so they were left out/)).toHaveCount(0);
});
