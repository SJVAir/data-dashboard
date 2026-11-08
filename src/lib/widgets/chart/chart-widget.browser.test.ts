import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { RegionResolver } from "$lib/data/adapters/registry";
import { mapDatasetCatalog, type MetadataSource } from "$lib/data/metadata";
import { PESTICIDE_USE_DATASET, WEATHER_DATASET } from "$lib/data/testing/dataset-catalog";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import { formatPeriod } from "$lib/format";
import { periodStart, resolveRange } from "$lib/format/range";
import type { AdapterRequest } from "$lib/data/adapters/registry";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
import { generatedTitle } from "../titles.svelte";
import ChartWidget from "./ChartWidget.svelte";
import {
	FORECASTS_ENTRY,
	chartWidget,
	fakeAdapter,
	fakeForecastsAdapter,
	fakeNumberAdapter
} from "../shared/test-harness/fake-data";
import { animationsSettled } from "../../../test/animations";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

let requests: AdapterRequest[];
let frame: HTMLDivElement;

beforeEach(async () => {
	await page.viewport(1280, 800);
	requests = [];
	fake.metadata = fixtureMetadata();
	const regions: RegionResolver = { resolve: async () => "unsupported" };
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests)],
		metadata: fake.metadata,
		regions
	});
	frame = document.createElement("div");
	frame.style.width = "640px";
	frame.style.height = "480px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

async function show(widget: WidgetInstance, viewer?: PlaceViewer) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(ChartWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([
			[APP_CONTEXT_KEY, app],
			...(viewer ? [[PLACE_VIEWER_KEY, viewer] as const] : [])
		])
	});
}

test("renders the time chart and sets the generated title", async () => {
	const widget = chartWidget(["m1"]);
	const screen = await show(widget);
	await expect.element(screen.getByRole("group", { name: "Chart of Monitor m1" })).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · Monitor m1 · Last 30 days");
	// A single place on a daily view asks for the worst hour.
	expect(requests[0].worstHour).toBe(true);
});

test("seven places draw five series and say two aren't shown", async () => {
	const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	const widget = chartWidget(ids);
	const screen = await show(widget);
	const key = screen.getByRole("list", { name: m.chart_series_key() });
	await expect.element(key).toBeVisible();
	expect(key.getByRole("listitem").elements()).toHaveLength(5);
	await expect.element(screen.getByText("2 more places aren't shown.")).toBeVisible();
	expect(requests.at(-1)!.target).toEqual({ kind: "monitors", ids: ids.slice(0, 5) });
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · 5 places · Last 30 days");
});

test("one hidden place is worded singular", async () => {
	const screen = await show(chartWidget(["m1", "m2", "m3", "m4", "m5", "m6"]));
	await expect.element(screen.getByText("1 more place isn't shown.")).toBeVisible();
});

test("a minimized widget's query stops polling", async () => {
	const widget = chartWidget(["m1"]);
	const screen = await show(widget);
	await expect.poll(() => fake.client!.entries()[0]?.polling).toBe(true);
	await screen.rerender({ widget: { ...widget, minimized: { order: 0 } } });
	await expect.poll(() => fake.client!.entries()[0]?.polling).toBe(false);
	await screen.rerender({ widget });
	await expect.poll(() => fake.client!.entries()[0]?.polling).toBe(true);
});

test("a layer with no place asks for one", async () => {
	const widget = chartWidget(["m1"]);
	widget.data.layers[0] = { dataset: "air-quality", entryType: "pm25" };
	const screen = await show(widget);
	await expect.element(screen.getByText(m.widget_state_idle())).toBeVisible();
	expect(requests).toEqual([]);
});

test("no data shows the empty state, never an unnamed chart", async () => {
	fake.client = createQueryClient({
		adapters: [
			{
				...fakeAdapter(requests),
				fetch: async (req) => ({
					...(await fakeAdapter(requests).fetch(req, null!, null!)),
					series: []
				})
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const screen = await show(chartWidget(["m1"]));
	await expect.element(screen.getByText(m.widget_state_empty())).toBeVisible();
	expect(frame.querySelector("[role=group]")).toBeNull();
});

test("the title waits for ready data, so a new range never pairs with the old places", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const base = fakeAdapter(requests);
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				// The first request answers at once; later ones wait for the gate.
				fetch: async (req, ctx, signal) => {
					if (requests.length > 0) await gate;
					return base.fetch(req, ctx, signal);
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1"]);
	const screen = await show(widget);
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · Monitor m1 · Last 30 days");

	const next = chartWidget(["m1", "m2"], { id: widget.id });
	next.data.dateRange = { kind: "trailing", amount: 90, unit: "day" };
	await screen.rerender({ widget: next });
	await expect.poll(() => fake.client!.entries().some((e) => e.inFlight)).toBe(true);
	// Loading the new input: the title is still the old one, not "Monitor m1 · Last 90 days".
	expect(generatedTitle(widget.id)).toBe("PM2.5 · Monitor m1 · Last 30 days");
	release();
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · 2 places · Last 90 days");
});

test("the time axis spans the whole date range, not just the days with data", async () => {
	const base = fakeAdapter(requests);
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				// Data only for the last four days of the range.
				fetch: async (req, ctx, signal) => {
					const data = await base.fetch(req, ctx, signal);
					const end = req.range.end.getTime();
					const days = [4, 3, 2, 1].map((k) =>
						periodStart(new Date(end - k * 86_400_000 + 3_600_000), "day").getTime()
					);
					data.series = data.series.map((s) => ({
						...s,
						points: days.map((t, i) => ({ ...s.points[0], t, mean: 5 + i }))
					}));
					return data;
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	await show(chartWidget(["m1"]));
	await expect.poll(() => frame.querySelector(".u-over")).not.toBeNull();
	const over = frame.querySelector(".u-over") as HTMLElement;
	await userEvent.hover(page.elementLocator(over), {
		position: { x: 1, y: over.getBoundingClientRect().height / 2 }
	});
	const first = resolveRange({ kind: "trailing", amount: 30, unit: "day" }, new Date()).start;
	const readout = () => frame.querySelector("[aria-live='polite']")?.textContent ?? "";
	await expect.poll(readout).toContain(formatPeriod(first, "day"));
	expect(readout()).toContain(m.chart_no_data());
});

test("values show with the catalog's precision", async () => {
	fake.metadata = fixtureMetadata({
		catalog: async () =>
			FIXTURE_CATALOG.map((d) => ({
				...d,
				entryTypes: d.entryTypes.map((e) => ({ ...e, precision: 1 }))
			}))
	});
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests)],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const screen = await show(chartWidget(["m1"]));
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	// The fake's first value is 5: one decimal reads "5.0".
	await expect
		.poll(() => frame.querySelector("[aria-live='polite']")?.textContent ?? "")
		.toContain("5.0 µg/m³");
});

test("the key names a point place by its source, as the title does", async () => {
	const base = fakeAdapter(requests);
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				async fetch(req, ctx, signal) {
					const data = await base.fetch(req, ctx, signal);
					return {
						...data,
						places: data.places.map((p) => ({ ...p, name: "ZIP 93721", via: { kind: "point" } }))
					};
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1"]);
	const screen = await show(widget, "shared");
	await expect
		.poll(() => generatedTitle(widget.id))
		.toBe("PM2.5 · ZIP 93721 (shared location) · Last 30 days");
	await expect
		.element(screen.getByRole("group", { name: "Chart of ZIP 93721 (shared location)" }))
		.toBeVisible();
});

/** A Chart of PM2.5 at `ids` with a burn-status overlay; forecasts for `missing` 404. */
async function showWithBurnStatus(ids: string[], missing: string[] = []) {
	fake.metadata = fixtureMetadata({ catalog: async () => [...FIXTURE_CATALOG, FORECASTS_ENTRY] });
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests), fakeForecastsAdapter(requests, missing)],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(ids);
	widget.data.layers.push({ dataset: "forecasts", entryType: "burn-status" });
	const screen = await show(widget);
	return { widget, screen };
}

test("burn-status bands render with a legend naming the place", async () => {
	const { widget, screen } = await showWithBurnStatus(["m1"]);
	const key = screen.getByRole("list", { name: "Burn status in Monitor m1" });
	await expect.element(key).toBeVisible();
	// The overlay borrows the main layer's place and asks for days.
	const asked = requests.find((r) => r.target.kind === "monitors" && r.resolution === "day");
	expect(requests.map((r) => r.target)).toContainEqual({ kind: "monitors", ids: ["m1"] });
	expect(asked).toBeDefined();
	// One labeled, outlined swatch per level of the burn-status scale.
	const items = key.getByRole("listitem");
	await expect.element(items.nth(0)).toHaveTextContent("Burning Discouraged");
	await expect.element(items.nth(1)).toHaveTextContent("No Burning Unless Registered");
	for (const chip of frame.querySelectorAll("[data-overlay-swatch]")) {
		expect(chip.getAttribute("data-pattern")).toBeTruthy();
	}
	const patterns = [...frame.querySelectorAll("[data-overlay-swatch]")].map((c) =>
		c.getAttribute("data-pattern")
	);
	expect(new Set(patterns).size).toBe(2);
	// Three days, two runs: two "discouraged" days and one "registered".
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toHaveAttribute("data-day-bands", "3");
	// The band's label on keyboard focus of its legend item, and in the readout.
	(items.nth(0).element() as HTMLElement).focus();
	await expect.element(chart).toHaveAttribute("data-highlight", "discouraged");
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	await expect
		.poll(() => frame.querySelector("[aria-live='polite']")?.textContent ?? "")
		.toContain("Burn status: Burning Discouraged");
	// The title stays about the main layer.
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · Monitor m1 · Last 30 days");
	await animationsSettled(frame);
	const results = await axe.run(frame);
	expect(results.violations).toEqual([]);
});

test("an overlay 404 shows its note and the line still draws", async () => {
	const { screen } = await showWithBurnStatus(["m1"], ["m1"]);
	await expect
		.element(screen.getByText("Burn status isn't available for Monitor m1."))
		.toBeVisible();
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	await expect.element(chart).toHaveAttribute("data-day-bands", "0");
	expect(screen.getByRole("list", { name: "Burn status in Monitor m1" }).query()).toBeNull();
});

test("places with different overlays follow the saved place", async () => {
	fake.metadata = fixtureMetadata({ catalog: async () => [...FIXTURE_CATALOG, FORECASTS_ENTRY] });
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests), fakeForecastsAdapter(requests, ["m1"])],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1", "m2"], {
		options: { overlayFor: { kind: "monitor", id: "m2" } }
	});
	widget.data.layers.push({ dataset: "forecasts", entryType: "burn-status" });
	const screen = await show(widget);
	await expect
		.element(screen.getByRole("list", { name: "Burn status in Monitor m2" }))
		.toBeVisible();
});

/** Weather and pesticide use as the dashboard maps them, both answering for monitors here. */
const NUMBER_DATASETS = mapDatasetCatalog({
	datasets: [WEATHER_DATASET, PESTICIDE_USE_DATASET]
} as Parameters<typeof mapDatasetCatalog>[0]).map((d) => ({ ...d, geographies: ["monitor"] }));

/** A Chart whose layers are `layers` (the first with the place `m1`), with number adapters. */
async function showLayers(
	layers: { dataset: string; entryType: string }[],
	adapters: Parameters<typeof createQueryClient>[0]["adapters"]
) {
	fake.metadata = fixtureMetadata({
		catalog: async () => [...FIXTURE_CATALOG, FORECASTS_ENTRY, ...NUMBER_DATASETS]
	});
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests), fakeForecastsAdapter(requests), ...adapters],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1"]);
	const [first, ...rest] = layers;
	widget.data.layers = [{ ...first, place: { kind: "monitor", id: "m1" } }, ...rest];
	const screen = await show(widget);
	return { widget, screen };
}

const PM25 = { dataset: "air-quality", entryType: "pm25" };
const POUNDS = { dataset: "pesticide-use", entryType: "pounds-applied" };
const RAIN = { dataset: "weather", entryType: "precipitation" };
const pesticides = (opts: Parameters<typeof fakeNumberAdapter>[2] = {}) =>
	fakeNumberAdapter("pesticide-use", requests, { offered: ["month", "year"], ...opts });

test("an empty pesticide strip says no use reported", async () => {
	const { screen } = await showLayers([PM25, POUNDS], [pesticides({ values: [] })]);
	await expect.element(screen.getByText(m.data_none_pesticides(), { exact: true })).toBeVisible();
	// The main chart is unaffected: no error, and its line draws.
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	// The strip is pinned to the main's days, so it comes back monthly.
	expect(requests.find((r) => r.entryType === "pounds-applied")?.resolution).toBe("month");
});

test("a pesticide-only widget with no use says so, not an error", async () => {
	const { screen } = await showLayers([POUNDS], [pesticides({ values: [] })]);
	await expect.element(screen.getByText(m.data_none_pesticides(), { exact: true })).toBeVisible();
	expect(screen.getByText(m.widget_state_error()).query()).toBeNull();
	expect(screen.getByText(m.widget_state_empty()).query()).toBeNull();
});

test("a pesticide-only widget draws its months as bars", async () => {
	const { screen } = await showLayers([POUNDS], [pesticides({ values: [1200, 340] })]);
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toHaveAttribute("data-bars", "2");
});

test("the legend names the station and its distance", async () => {
	const source = { id: "80", name: "CIMIS #80 Fresno State", distance: 4.2, inside: false };
	const { screen } = await showLayers(
		[PM25, RAIN],
		[fakeNumberAdapter("weather", requests, { source })]
	);
	await expect
		.element(screen.getByText("Precipitation · CIMIS #80 Fresno State (4.2 mi away)"))
		.toBeVisible();
	await expect.element(screen.getByText("Precipitation (in)", { exact: true })).toBeVisible();
	await expect.poll(() => frame.querySelectorAll("[data-strip] canvas").length).toBe(1);
	await animationsSettled(frame);
	expect((await axe.run(frame)).violations).toEqual([]);
});

test("the legend names the active filters", async () => {
	const { screen } = await showLayers(
		[PM25, POUNDS],
		[pesticides({ values: [1200, 340], filters: ["Chlorpyrifos", "Grapes"] })]
	);
	await expect
		.element(screen.getByText("Pounds Applied · Chlorpyrifos · Grapes · Monitor m1"))
		.toBeVisible();
	await expect.element(screen.getByText(m.chart_series_month_total())).toBeVisible();
});

test("a gone filter shows in its strip and the chart still draws", async () => {
	const { screen } = await showLayers([PM25, POUNDS], [pesticides({ unavailable: "filter-gone" })]);
	await expect.element(screen.getByText(m.data_unavailable_filter_gone())).toBeVisible();
	await expect.element(screen.getByText("Pounds Applied (lbs)", { exact: true })).toBeVisible();
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
});

test("a pre-spec widget renders as before", async () => {
	const { screen } = await showWithBurnStatus(["m1"]);
	const chart = screen.getByRole("group", { name: "Chart of Monitor m1" });
	await expect.element(chart).toHaveAttribute("data-day-bands", "3");
	expect(frame.querySelectorAll("[data-strip]")).toHaveLength(0);
	expect(frame.querySelectorAll("canvas")).toHaveLength(1);
	await expect.element(chart).toHaveAttribute("data-bars", "0");
	// The burn-status request isn't pinned: it asks for days as spec 3 did.
	expect(requests.find((r) => r.entryType === "burn-status")?.resolution).toBe("day");
});

test("a weather-only chart names the station, and a summed main is a total", async () => {
	const source = { id: "80", name: "CIMIS #80 Fresno State", distance: 4.2, inside: false };
	const { screen } = await showLayers([RAIN], [fakeNumberAdapter("weather", requests, { source })]);
	const key = screen.getByRole("list", { name: m.chart_series_key() });
	await expect
		.element(key.getByText("Daily total · CIMIS #80 Fresno State (4.2 mi away)", { exact: true }))
		.toBeVisible();
	expect(key.getByText(m.chart_series_day()).query()).toBeNull();
});

test("an averaged main stays an average, with no source to name", async () => {
	const screen = await show(chartWidget(["m1"]));
	const key = screen.getByRole("list", { name: m.chart_series_key() });
	await expect.element(key.getByText(m.chart_series_day(), { exact: true })).toBeVisible();
});

test("a number overlay isn't fetched while the main layer is unavailable", async () => {
	fake.metadata = fixtureMetadata({
		catalog: async () => [...FIXTURE_CATALOG, FORECASTS_ENTRY, ...NUMBER_DATASETS]
	});
	fake.client = createQueryClient({
		adapters: [
			fakeAdapter(requests),
			// Weather would answer for the county (as a monitor's series, to keep the fake small).
			{
				...fakeNumberAdapter("weather", requests),
				target: async () => ({ kind: "monitors", ids: ["m1"] })
			}
		],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1"]);
	// The fake air-quality adapter serves monitors only: a county is unavailable.
	widget.data.layers = [
		{ ...PM25, place: { kind: "region", type: "county", code: "06019" } },
		{ ...RAIN }
	];
	const screen = await show(widget);
	await expect
		.element(screen.getByText(m.widget_state_unavailable_place_unsupported()))
		.toBeVisible();
	await new Promise((r) => setTimeout(r, 100));
	expect(requests.filter((r) => r.entryType === "precipitation")).toEqual([]);
});
