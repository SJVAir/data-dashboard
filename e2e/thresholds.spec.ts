/**
 * Self-monitoring end to end: a Current conditions tile with an alert level whose hourly average
 * goes from Moderate to Unhealthy for Sensitive Groups between two polls (the page's clock is
 * moved past the next :55 poll). The crossing toasts once, marks the tile, and once the tile is
 * minimized its taskbar entry carries the mark.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	expectNoViolations,
	openPicker,
	shareLinkFor,
	taskbar,
	widgetMenuItem,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

const HOUR = 3_600_000;
/** 12:00 Pacific (PDT): the first stubbed answer's latest complete hour ends here. */
const BASE = Date.parse("2026-06-15T19:00:00Z");
const FRESNO = { kind: "region", type: "county", code: "06019" };
const TITLE = "PM2.5 · Fresno County";
const USG = "Unhealthy for Sensitive Groups";
const HOURLY = /\/api\/2\.0\/regions\/pm25\/summaries\/hourly\/$/;

const doc = {
	kind: "dashboard",
	schemaVersion: 1,
	id: "shared-thresholds-1",
	name: "Fresno air",
	body: {
		widgets: [
			{
				id: "w0",
				type: "current-conditions",
				title: null,
				rect: { x: 0, y: 0, w: 4, h: 6 },
				data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
				thresholds: [{ level: "unhealthy_sensitive" }]
			}
		]
	}
};

/**
 * Answers the region hourly summaries: Moderate (20) for each hour up to `BASE`, then once
 * `worse` is set, the hour after it at 40 (Unhealthy for Sensitive Groups).
 */
async function routeHourly(page: Page, state: { worse: boolean }): Promise<void> {
	await page.route(
		(url) => HOURLY.test(url.pathname),
		async (route) => {
			const url = new URL(route.request().url());
			const ids = url.searchParams.getAll("region").flatMap((v) => v.split(","));
			const hours = state.worse ? 8 : 7;
			const summaries = Array.from({ length: hours }, (_, i) => {
				const t = BASE - 7 * HOUR + i * HOUR;
				const mean = state.worse && i === hours - 1 ? 40 : 20;
				return {
					timestamp: new Date(t).toISOString(),
					entry_type: "pm25",
					resolution: "hour",
					count: 1,
					expected_count: 1,
					minimum: mean,
					maximum: mean,
					mean,
					stddev: 0,
					p25: mean,
					p75: mean,
					station_count: 1
				};
			});
			const data = ids.map((id) => ({ id, name: id, slug: id, type: "county", summaries }));
			await route.fulfill({ json: { data, page: 1, pages: 1, has_next_page: false } });
		}
	);
}

test("a crossing between polls toasts once, marks the tile, then its taskbar entry", async ({
	page
}) => {
	const state = { worse: false };
	await routeHourly(page, state);
	await page.clock.install({ time: new Date(BASE + 5 * 60_000) });
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveText([TITLE]);
	await expect(page.getByText("Moderate", { exact: true })).toBeVisible();
	// Below the alert level: no mark and nothing told.
	await expect(page.getByText("Alert level reached")).toHaveCount(0);
	await expect(page.locator("[data-sonner-toast]", { hasText: "is now" })).toHaveCount(0);

	state.worse = true;
	await page.clock.fastForward("01:00:00");
	// One toast (besides the import's "Saved a copy" one).
	const toast = page.locator("[data-sonner-toast]", { hasText: "is now" });
	await expect(toast).toHaveCount(1);
	await expect(toast).toHaveText(`PM2.5 at Fresno County is now ${USG}`);
	await expect(page.getByText("Alert level reached")).toBeVisible();
	await expect(page.getByText(USG, { exact: true })).toBeVisible();
	await expectNoViolations(page);

	await widgetMenuItem(page, TITLE, "Minimize");
	const entry = taskbar(page).getByRole("button", {
		name: `Restore ${TITLE} (alert level reached)`,
		exact: true
	});
	await expect(entry).toBeVisible();
	await expect(taskbar(page).locator("[data-testid^='taskbar-']")).toHaveAttribute("data-mark", "");
});

test("with the notifications switch on, a crossing shows a desktop notification", async ({
	page
}) => {
	// A stand-in for the browser's Notification: it records the permission asked and each one shown.
	await page.addInitScript(() => {
		const record = { requests: 0, shown: [] as { title: string; body?: string }[] };
		(window as unknown as { __notify: typeof record }).__notify = record;
		class FakeNotification {
			static permission: NotificationPermission = "default";
			static async requestPermission(): Promise<NotificationPermission> {
				record.requests++;
				FakeNotification.permission = "granted";
				return "granted";
			}
			constructor(title: string, options?: NotificationOptions) {
				record.shown.push({ title, body: options?.body });
			}
		}
		Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
	});
	const notify = () =>
		page.evaluate(
			() => (window as unknown as { __notify: { requests: number; shown: unknown[] } }).__notify
		);
	const state = { worse: false };
	await routeHourly(page, state);
	await page.clock.install({ time: new Date(BASE + 5 * 60_000) });
	await page.goto(shareLinkFor(doc));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(page.getByText("Moderate", { exact: true })).toBeVisible();
	expect((await notify()).requests).toBe(0);

	await openPicker(page, "Fresno air");
	await page.getByRole("menuitem", { name: "Notifications…" }).click();
	const toggle = page.getByRole("switch", {
		name: "Show desktop notifications while this dashboard is open"
	});
	await toggle.click();
	await expect(toggle).toBeChecked();
	// Asked from the click, never on load.
	expect((await notify()).requests).toBe(1);
	await page.keyboard.press("Escape");

	state.worse = true;
	await page.clock.fastForward("01:00:00");
	const body = `PM2.5 at Fresno County is now ${USG}`;
	await expect(page.locator("[data-sonner-toast]", { hasText: "is now" })).toHaveText(body);
	await expect.poll(async () => (await notify()).shown).toEqual([{ title: TITLE, body }]);
});
