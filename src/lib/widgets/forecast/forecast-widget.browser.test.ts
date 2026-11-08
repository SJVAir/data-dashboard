import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterContext } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import { forecastRow, placeResponse } from "$lib/data/testing/forecasts-fixtures";
import type { WidgetInstance } from "$lib/documents/schema";
import { formatDate, formatWeekdayDate, formatWeekdayTime, todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { generatedTitle } from "../titles.svelte";
import ForecastWidget from "./ForecastWidget.svelte";

const fake = vi.hoisted(() => ({
	client: undefined as NowClient | undefined,
	metadata: undefined as MetadataSource | undefined,
	forecast: undefined as (() => Promise<unknown>) | undefined
}));
vi.mock("$lib/data", () => ({
	getMetadata: () => fake.metadata!,
	getResolvers: (): Pick<AdapterContext, "regions" | "locations" | "points"> => ({
		regions: {
			resolve: async (type, code) =>
				type === "county" && code === "06019"
					? { id: "sq1", name: "Fresno County" }
					: type === "county" && code === "gone"
						? null
						: "unsupported"
		},
		locations: { resolve: async () => null },
		points: { keys: async () => [] }
	})
}));
vi.mock("$lib/data/now", () => ({ getNowClient: () => fake.client! }));
vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getForecastForPlace: () => fake.forecast!()
}));

const PUBLISHED = new Date("2026-11-07T21:42:00Z");
let frame: HTMLDivElement;

function rows(extra: Partial<ReturnType<typeof forecastRow>> = {}) {
	const today = todayPacific();
	const tomorrow = todayPacific(new Date(Date.now() + 24 * 3_600_000));
	const make = (date: string, aqi: number, burn: string) => ({
		...forecastRow(date, today, aqi, burn),
		published_at: PUBLISHED.toISOString(),
		...extra
	});
	return [make(today, 62, "Registered"), make(tomorrow, 48, "Prohibited")];
}

beforeEach(async () => {
	// A client for each test, so cached forecasts don't carry over.
	fake.client = createNowClient();
	await page.viewport(1280, 800);
	fake.metadata = fixtureMetadata({
		scaleSource: async (_d, entryType) =>
			entryType === "aqi-forecast" ? { name: "AirNow", url: "https://airnow.example" } : null
	});
	fake.forecast = async () => placeResponse(rows());
	frame = document.createElement("div");
	frame.style.width = "320px";
	frame.style.height = "420px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function widgetFor(code = "06019"): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "forecast-strip",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 4 },
		data: {
			layers: [
				{
					dataset: "forecasts",
					entryType: "aqi-forecast",
					place: { kind: "region", type: "county", code }
				}
			]
		}
	};
}

async function show(widget: WidgetInstance) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(ForecastWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
}

test("shows Today and Tomorrow with level chips, AQI text, burn status and footer", async () => {
	const widget = widgetFor();
	const screen = await show(widget);
	await expect.element(screen.getByText(m.forecast_today()), { timeout: 5000 }).toBeVisible();
	await expect.element(screen.getByText(m.forecast_tomorrow())).toBeVisible();
	await expect.element(screen.getByText(formatWeekdayDate(todayPacific()))).toBeVisible();
	await expect.element(screen.getByText("AQI 62 · PM2.5")).toBeVisible();
	await expect.element(screen.getByText("AQI 48 · PM2.5")).toBeVisible();
	expect(frame.querySelectorAll("[data-forecast-day]")).toHaveLength(2);
	await expect.element(screen.getByText("Moderate", { exact: true })).toBeVisible();
	await expect.element(screen.getByText("Good", { exact: true })).toBeVisible();
	await expect
		.element(screen.getByText("No Burning Unless Registered", { exact: true }))
		.toBeVisible();
	// An unknown burn status shows the feed's own text.
	await expect.element(screen.getByText("Prohibited: text")).toBeVisible();
	await expect
		.element(screen.getByText(m.forecast_issued({ time: formatWeekdayTime(PUBLISHED) })))
		.toBeVisible();
	await expect.element(screen.getByRole("link", { name: /Source: AirNow/ })).toBeVisible();
	await expect.element(screen.getByText(m.forecast_zone({ zone: "Fresno County" }))).toBeVisible();
	expect(frame.querySelector("[data-air-alert]")).toBeNull();
	await expect.poll(() => generatedTitle(widget.id)).toBe("Forecast · Fresno County");
});

test("an Air Alert shows a banner above the rows, in text", async () => {
	const today = todayPacific();
	fake.forecast = async () =>
		placeResponse(rows({ air_alert: true, air_alert_start: today, air_alert_end: today }));
	const screen = await show(widgetFor());
	const text = m.forecast_air_alert({ start: formatDate(today), end: formatDate(today) });
	await expect.element(screen.getByText(text), { timeout: 5000 }).toBeVisible();
	const banner = frame.querySelector("[data-air-alert]")!;
	const first = frame.querySelector("[data-forecast-day]")!;
	expect(banner.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a place the feed has no zone for says there is no forecast", async () => {
	fake.forecast = async () => ({ ...placeResponse([]), zone: null, rule: null });
	const screen = await show(widgetFor());
	await expect.element(screen.getByText(m.forecast_none_here()), { timeout: 5000 }).toBeVisible();
});

test("a zone with nothing for today says the forecast is not out yet", async () => {
	fake.forecast = async () => placeResponse([]);
	const screen = await show(widgetFor());
	await expect.element(screen.getByText(m.forecast_none_yet()), { timeout: 5000 }).toBeVisible();
});

test("a nearest-zone match says so", async () => {
	fake.forecast = async () => ({ ...placeResponse(rows()), rule: "center" });
	const screen = await show(widgetFor());
	await expect
		.element(screen.getByText(m.forecast_zone_nearest({ zone: "Fresno County" })), {
			timeout: 5000
		})
		.toBeVisible();
});

test("an unresolved place shows the no-longer-available card", async () => {
	const screen = await show(widgetFor("gone"));
	await expect
		.element(screen.getByText(m.widget_state_gone_title()), { timeout: 5000 })
		.toBeVisible();
});

test("a failed fetch shows the error with Retry, then recovers", async () => {
	fake.forecast = async () => {
		throw new Error("boom");
	};
	const screen = await show(widgetFor());
	await expect.element(screen.getByText(m.widget_state_error()), { timeout: 5000 }).toBeVisible();
	fake.forecast = async () => placeResponse(rows());
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	await expect.element(screen.getByText("AQI 62 · PM2.5")).toBeVisible();
});

test("has no axe violations", async () => {
	const today = todayPacific();
	fake.forecast = async () =>
		placeResponse(rows({ air_alert: true, air_alert_start: today, air_alert_end: today }));
	const screen = await show(widgetFor());
	await expect.element(screen.getByText("AQI 62 · PM2.5"), { timeout: 5000 }).toBeVisible();
	const results = await axe.run(frame);
	expect(results.violations).toEqual([]);
});
