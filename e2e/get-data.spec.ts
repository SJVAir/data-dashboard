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
