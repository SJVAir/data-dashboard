/**
 * The two calendars end to end, on the API fixtures: choosing them in Get data, the reasons they
 * are greyed out, a point place swapping to its region, selecting days, and opening the selection
 * in a chart. The web metadata has no `daily_statistic` yet, so every past day is unrated and the
 * calendars say so once; the colored cells are checked once the server's metadata carries it.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	addToButton,
	expectNoViolations,
	expectSaved,
	makeOwnCopy,
	nav,
	shareLinkFor,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

const GET_DATA = { level: 1, name: "Get data" } as const;
const NOT_RATED_NOTE =
	"SJVAir doesn't say yet how to rate a whole day of this pollutant, so its days aren't rated.";
const FRESNO = { kind: "region", type: "county", code: "06019" };

/** The days drawn in `scope`, in order, as grid cells. */
function dayCells(scope: Locator): Locator {
	return scope.locator("[role=gridcell][data-date]");
}

/** The `n`th day (oldest first) that has begun, whatever order the grid lays its cells in. */
async function pastDay(scope: Locator, n: number): Promise<Locator> {
	const dates = await scope
		.locator("[role=gridcell][data-date]:not([data-kind=future])")
		.evaluateAll((cells) => cells.map((c) => (c as HTMLElement).dataset.date ?? ""));
	return scope.locator(`[data-date="${dates.sort()[n]}"]`);
}

/** Opens Get data from the top nav and picks the calendar `name` under "Show as". */
async function showAs(page: Page, name: string): Promise<void> {
	await nav(page).getByRole("link", { name: "Data", exact: true }).click();
	await expect(page.getByRole("heading", GET_DATA)).toBeVisible();
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
	await page.getByRole("radio", { name }).click();
	await expect(page.getByRole("radio", { name })).toBeChecked();
}

for (const name of ["Month calendar", "Contribution calendar"]) {
	test(`Get data → ${name}: preview, Add, and it reloads`, async ({ page }) => {
		await makeOwnCopy(page);
		const before = await widgetTitles(page).count();
		await showAs(page, name);
		// The preview draws the calendar and says why its days aren't rated, once.
		const preview = page.getByRole("grid").first();
		await expect(preview).toBeVisible();
		await expect(dayCells(preview).first()).toBeAttached();
		await expect(page.getByText(NOT_RATED_NOTE)).toHaveCount(1);

		await addToButton(page).click();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page)).toHaveCount(before + 1);
		await expect(page.getByRole("grid").first()).toBeVisible();
		await expectSaved(page);
		await page.reload();
		await expect(widgetTitles(page)).toHaveCount(before + 1);
		await expect(page.getByRole("grid").first()).toBeVisible();
		await expect(page.getByText(NOT_RATED_NOTE).first()).toBeVisible();
	});
}

test("a calendar is greyed out with its reason for two places and for a weather layer", async ({
	page
}) => {
	await page.goto("data");
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();

	// A weather layer.
	await page.getByRole("button", { name: /^Weather/ }).click();
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).check();
	for (const name of ["Month calendar", "Contribution calendar"]) {
		await expect(page.getByRole("radio", { name })).toBeDisabled();
	}
	await expect(page.getByText(/Month calendar: /).first()).toBeVisible();
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).uncheck();
	await expect(page.getByRole("radio", { name: "Month calendar" })).toBeEnabled();

	// Two places.
	await page.getByRole("button", { name: "Change places" }).click();
	const picker = page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
	await picker.getByRole("button", { name: /^Counties/ }).click();
	await picker
		.getByRole("grid", { name: "Places in this list" })
		.getByRole("row", { name: /Tulare County/ })
		.click();
	await picker.getByRole("button", { name: "Done" }).click();
	await expect(picker).toBeHidden();
	for (const name of ["Month calendar", "Contribution calendar"]) {
		await expect(page.getByRole("radio", { name })).toBeDisabled();
	}
	await expect(page.getByText(/Contribution calendar: Shows up to 1 place/)).toBeVisible();
});

test("a share link with a point place gets its region for a calendar", async ({ page }) => {
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-calendar-1",
		name: "Calendar point",
		body: {
			widgets: [
				{
					id: "w0",
					type: "calendar-month",
					title: null,
					rect: { x: 0, y: 0, w: 6, h: 8 },
					data: {
						dateRange: { kind: "to-date", unit: "month" },
						layers: [
							{
								dataset: "air-quality",
								entryType: "pm25",
								place: { kind: "point", lat: 36.7372, lon: -119.7871 }
							}
						]
					}
				}
			]
		}
	};
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(1);
	// Not "(your location)": the copy holds the ZIP, and the calendar draws it.
	await expect(widgetTitles(page).first()).toContainText("ZIP 93721");
	await expect(widgetTitles(page).first()).not.toContainText("your location");
	await expect(page.getByRole("grid").first()).toBeVisible();
});

/** A saved dashboard with one calendar of `type` on Fresno County, opened through a share link. */
async function openCalendar(page: Page, type: string, dateRange: unknown): Promise<void> {
	const doc = {
		kind: "dashboard",
		schemaVersion: 1,
		id: `shared-${type}-1`,
		name: "Calendar days",
		body: {
			widgets: [
				{
					id: "w0",
					type,
					title: null,
					rect: { x: 0, y: 0, w: 8, h: 8 },
					data: {
						dateRange,
						layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
					}
				}
			]
		}
	};
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(1);
}

test("two clicks select a span, a third starts anew, and the days open in a chart", async ({
	page
}) => {
	await openCalendar(page, "calendar-contribution", { kind: "trailing", amount: 3, unit: "month" });
	const grid = page.getByRole("grid").first();
	await expect(dayCells(grid).first()).toBeAttached();
	const selected = grid.locator("[role=gridcell][data-selected]");

	await (await pastDay(grid, 10)).click();
	await expect(selected).toHaveCount(1);
	await (await pastDay(grid, 14)).click();
	await expect(selected).toHaveCount(5);
	// A third click starts anew.
	await (await pastDay(grid, 3)).click();
	await expect(selected).toHaveCount(1);
	// Clicking the only selected day clears it.
	await (await pastDay(grid, 3)).click();
	await expect(selected).toHaveCount(0);

	await (await pastDay(grid, 10)).click();
	await (await pastDay(grid, 12)).click();
	await expect(selected).toHaveCount(3);
	await expectSaved(page);

	const title = (await widgetTitles(page).first().innerText()).trim();
	await widgetMenuItem(page, title, "Open these days in a chart");
	// A chart over the selected days is added and the page shows it.
	await expect(widgetTitles(page)).toHaveCount(2);
	await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
});

test("Escape clears the selection", async ({ page }) => {
	await openCalendar(page, "calendar-month", { kind: "to-date", unit: "month" });
	const grid = page.getByRole("grid").first();
	await expect(dayCells(grid).first()).toBeAttached();
	await (await pastDay(grid, 0)).click();
	await expect(grid.locator("[role=gridcell][data-selected]")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(grid.locator("[role=gridcell][data-selected]")).toHaveCount(0);
});

for (const colorScheme of ["light", "dark"] as const) {
	test.describe(`${colorScheme} mode`, () => {
		test.use({ colorScheme });

		for (const type of ["calendar-month", "calendar-contribution"]) {
			test(`${type} has no accessibility violations`, async ({ page }) => {
				await openCalendar(page, type, { kind: "trailing", amount: 2, unit: "month" });
				const grid = page.getByRole("grid").first();
				await expect(dayCells(grid).first()).toBeAttached();
				await (await pastDay(grid, 2)).click();
				await (await pastDay(grid, 4)).click();
				await expectNoViolations(page);
				if (type === "calendar-contribution") {
					await page.getByRole("switch", { name: "Show patterns" }).click();
					await expectNoViolations(page);
				}
			});
		}
	});
}
