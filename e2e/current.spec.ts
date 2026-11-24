/**
 * Current conditions end to end: a PurpleAir monitor (the meta says the server evaluates its
 * alerts) reads the server's alert value as a 60-minute average, and an AirNow monitor (the
 * meta's `alerts` is null) reads the hourly average without asking for an alert value. With
 * ozone in the metadata, one card holds PM2.5 and Ozone at a county, each with its own alert
 * level, and Show as Chart keeps PM2.5 and notes Ozone left out.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	addToButton,
	expectSaved,
	makeOwnCopy,
	openSection,
	shareLinkFor,
	widgetMenuItem,
	widgetTitles
} from "./helpers";
import { routeMapMeta } from "./map-data-server";

const PURPLEAIR = "Tt5ixZRKSH-rVKJtwVh-bw";
const AIRNOW = "4Mb0j33kTnS0qzeE4iDGWw";
const ALERTS = /\/api\/2\.0\/monitors\/([A-Za-z0-9_-]+)\/alerts\/current\/$/;

const tile = (id: string, monitor: string, y: number) => ({
	id,
	type: "current-conditions",
	title: null,
	rect: { x: 0, y, w: 6, h: 6 },
	data: {
		layers: [{ dataset: "air-quality", entryType: "pm25", monitors: [monitor] }]
	}
});

const doc = {
	kind: "dashboard",
	schemaVersion: 1,
	id: "shared-current-1",
	name: "Two monitors",
	body: { widgets: [tile("w0", PURPLEAIR, 0), tile("w1", AIRNOW, 6)] }
};

test("a monitor the server evaluates shows its alert value; one it does not shows the hourly average", async ({
	page
}) => {
	const asked: string[] = [];
	await page.route(
		(url) => ALERTS.test(url.pathname),
		async (route) => {
			const id = ALERTS.exec(new URL(route.request().url()).pathname)![1];
			asked.push(id);
			const at = new Date(Date.now() - 2 * 60_000).toISOString();
			await route.fulfill({
				json: {
					data: {
						pm25: {
							status: "ok",
							value: 31.2,
							level: "unhealthy_sensitive",
							window: { start: at, end: at },
							latest_timestamp: at,
							readings: 29,
							required: 15,
							previous: null,
							evaluated_at: at
						}
					}
				}
			});
		}
	);
	// The current partial hour's raw entries: none yet.
	await page.route(
		(url) => /\/api\/2\.0\/monitors\/[A-Za-z0-9_-]+\/entries\/pm25\/$/.test(url.pathname),
		(route) => route.fulfill({ json: { data: [], page: 1, pages: 1, has_next_page: false } })
	);
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveCount(2);

	const purpleair = page.locator("section").filter({ hasText: "Science Building Room 74" });
	await expect(purpleair.getByText("31.2", { exact: true })).toBeVisible();
	await expect(
		purpleair.getByText(/60-minute average · updated (just now|\d+ min ago)/)
	).toBeVisible();

	const airnow = page.locator("section").filter({ hasText: "Fresno - Drummond Street" });
	await expect(airnow.getByText(/Hourly average · updated (just now|\d+ min ago)/)).toBeVisible();
	expect(asked).toEqual([PURPLEAIR]);
});

test.describe("with ozone in the metadata", () => {
	test.use({ reducedMotion: "reduce" });

	test.beforeEach(async ({ context }) => {
		await routeMapMeta(context);
	});

	test("a card holds PM2.5 and Ozone with an alert level each; Show as Chart leaves Ozone out", async ({
		page
	}) => {
		const title = "PM2.5 and Ozone · Fresno County";
		// Noon Pacific.
		await page.clock.install({ time: "2026-11-15T12:00:00-08:00" });
		await makeOwnCopy(page);
		await page.getByRole("button", { name: "Add widget" }).click();
		await page.getByRole("menuitem", { name: "Chart", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeVisible();
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();

		await page.getByRole("button", { name: "Change places" }).click();
		const picker = page.getByRole("dialog", { name: /^Choose (a place|places)$/ });
		await picker.getByRole("combobox", { name: "Search for a place" }).fill("fre");
		await picker.getByRole("option", { name: /^Fresno County/ }).click();
		await expect(picker).toBeHidden();

		// PM2.5 starts ticked; ticking Ozone gives each pollutant its own alert level.
		await openSection(page, /^Air quality(?! forecasts)/i);
		const pm25 = page.getByRole("checkbox", { name: "PM2.5", exact: true });
		const ozone = page.getByRole("checkbox", { name: "Ozone", exact: true });
		await expect(pm25).toBeChecked();
		await ozone.check();
		await expect(page.getByRole("combobox", { name: "Alert level", exact: true })).toHaveCount(0);
		const forPm25 = page.getByRole("combobox", { name: "Alert level for PM2.5" });
		const forOzone = page.getByRole("combobox", { name: "Alert level for Ozone" });
		await forPm25.selectOption("unhealthy");
		await forOzone.selectOption("very_unhealthy");
		await expect(forPm25).toHaveValue("unhealthy");
		await expect(forOzone).toHaveValue("very_unhealthy");

		await addToButton(page).click();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(widgetTitles(page).last()).toHaveText(title);
		// One row per pollutant, each under its own heading.
		const card = page
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: title }) });
		await expect(card.getByRole("heading", { level: 3 })).toHaveText(["PM2.5", "Ozone"]);
		await expectSaved(page);

		// The alert levels are saved per pollutant: a reload keeps both.
		await page.reload();
		await expect(widgetTitles(page).last()).toHaveText(title);
		await widgetMenuItem(page, title, "Open in Data Portal");
		await expect(page.getByRole("heading", { level: 1, name: "Data Portal" })).toBeFocused();
		await openSection(page, /^Air quality(?! forecasts)/i);
		await expect(forPm25).toHaveValue("unhealthy");
		await expect(forOzone).toHaveValue("very_unhealthy");

		// Show as Chart keeps the first pollutant, with a note naming the one left out.
		await page.locator('[data-show-as="chart"]').click();
		await expect(page.locator('[data-show-as="chart"]')).toHaveAttribute("data-state", "on");
		await expect(
			page.getByText("Ozone was left out: this type shows one pollutant.", { exact: true })
		).toBeVisible();
		await expect(page.getByRole("group", { name: "Chart of Fresno County" })).toBeVisible();
		// One line: the draft's rows are all PM2.5.
		const download = page.waitForEvent("download");
		await page.getByRole("button", { name: "Download CSV" }).click();
		const path = test.info().outputPath("current-as-chart.csv");
		await (await download).saveAs(path);
		const [header, ...rows] = (await readFile(path, "utf8")).split("\r\n").filter(Boolean);
		const column = header.split(",").indexOf("entry_type");
		expect(rows.length).toBeGreaterThan(0);
		expect(new Set(rows.map((row) => row.split(",")[column]))).toEqual(new Set(["pm25"]));
	});
});
