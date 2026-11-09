/**
 * Current conditions end to end: a PurpleAir monitor (the meta says the server evaluates its
 * alerts) reads the server's alert value as a 60-minute average, and an AirNow monitor (the
 * meta's `alerts` is null) reads the hourly average without asking for an alert value.
 */
import { expect, test } from "./fixtures";
import { DASHBOARD_URL, shareLinkFor, widgetTitles } from "./helpers";

const PURPLEAIR = "Tt5ixZRKSH-rVKJtwVh-bw";
const AIRNOW = "4Mb0j33kTnS0qzeE4iDGWw";
const ALERTS = /\/api\/2\.0\/monitors\/([A-Za-z0-9_-]+)\/alerts\/current\/$/;

const tile = (id: string, monitor: string, y: number) => ({
	id,
	type: "current-conditions",
	title: null,
	rect: { x: 0, y, w: 6, h: 6 },
	data: {
		layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: monitor } }]
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
	await expect(purpleair.getByText(/60-minute average · updated \d+ min ago/)).toBeVisible();

	const airnow = page.locator("section").filter({ hasText: "Fresno - Drummond Street" });
	await expect(airnow.getByText(/Hourly average · updated \d+ min ago/)).toBeVisible();
	expect(asked).toEqual([PURPLEAIR]);
});
