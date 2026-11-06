import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import {
	CHART_TITLE,
	DASHBOARD_URL,
	addWidget,
	expectSaved,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

const CHART = "Chart of Fresno County";

/** `CSV_COLUMNS` (src/lib/data/csv.ts), the documented column order. */
const CSV_HEADER =
	"period_start,period_end,place_kind,place_id,place_name,entry_type,entry_type_label,unit," +
	"mean,min,max,worst_hour_mean,worst_hour_start,count,resolution,partial,computed_from_raw," +
	"level_key,level_label";

test("a Chart and a Data table: data, readout, CSV, duplicate, reload", async ({ page }) => {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);

	// A Chart and a Data table, both on the default layer (Fresno County PM2.5, last 30 days).
	await addWidget(page, "Chart");
	await expect(page).toHaveURL(DASHBOARD_URL);
	await addWidget(page, "Data table");
	await expect(widgetTitles(page)).toHaveCount(5);
	const chart = page.getByRole("group", { name: CHART });
	await expect(chart).toBeVisible();
	await expect(widgetTitles(page).nth(3)).toHaveText(CHART_TITLE);
	await expect(chart.getByRole("list", { name: "Series" })).toBeVisible();
	await expect(chart.getByRole("list", { name: "Levels" }).getByRole("listitem")).not.toHaveCount(
		0
	);

	const table = page.getByRole("region", { name: "Data table values" });
	await expect(table.getByRole("columnheader", { name: /^Date/ })).toBeVisible();
	await expect(table.getByRole("columnheader", { name: /Fresno County/ })).toBeVisible();
	// 30 daily rows (the fake server answers every day that has begun).
	await expect(table.getByRole("rowheader")).toHaveCount(30);

	// The readout steps through the points with the keyboard.
	await chart.focus();
	await page.keyboard.press("Home");
	const readout = chart.locator("[aria-live=polite]");
	await expect(readout).not.toBeEmpty();
	const first = await readout.textContent();
	await page.keyboard.press("ArrowRight");
	await expect(readout).not.toHaveText(first ?? "");
	await page.keyboard.press("End");
	await expect(readout).toContainText("Incomplete: so far");

	// Download the Data table's CSV: named after the data, header row in the documented order.
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download CSV" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(
		/^pm25-fresno-county-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/
	);
	const path = test.info().outputPath("data.csv");
	await file.saveAs(path);
	const lines = (await readFile(path, "utf8")).split("\r\n");
	expect(lines[0]).toBe(CSV_HEADER);
	expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00-0[78]:00,/);
	expect(lines.filter(Boolean)).toHaveLength(31);

	// The Chart's frame menu downloads the same way.
	const chartDownload = page.waitForEvent("download");
	await widgetMenuItem(page, CHART_TITLE, "Download data (CSV)");
	expect((await chartDownload).suggestedFilename()).toBe(file.suggestedFilename());

	// Duplicate the Chart; the copy draws its own data.
	await widgetMenuItem(page, CHART_TITLE, "Duplicate widget");
	await expect(widgetTitles(page)).toHaveCount(6);
	await expect(page.getByRole("group", { name: CHART })).toHaveCount(2);
	await expectSaved(page);

	await page.reload();
	await expect(widgetTitles(page)).toHaveCount(6);
	await expect(page.getByRole("group", { name: CHART })).toHaveCount(2);
	await expect(table.getByRole("rowheader")).toHaveCount(30);
});
