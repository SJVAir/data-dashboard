import "../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import type { CatalogEntry, MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import { formatDateRange } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { chartType } from "$lib/widgets/chart";
import { FORECASTS_ENTRY, fakeForecastsAdapter } from "$lib/widgets/shared/test-harness/fake-data";
import { animationsSettled } from "../../test/animations";
import { defaultDraft, type Draft } from "./draft.svelte";
import GetDataView from "./GetDataView.svelte";

const fake = vi.hoisted(() => ({
	client: undefined as unknown as QueryClient,
	metadata: undefined as unknown as MetadataSource
}));
vi.mock("$lib/data", () => ({
	adapterIds: () => ["air-quality", "forecasts"],
	getQueryClient: () => fake.client,
	getMetadata: () => fake.metadata,
	getResolvers: () => ({
		regions: { resolve: async () => null },
		locations: { resolve: async () => null },
		points: { keys: async () => [] }
	}),
	placeRegion: async () => null
}));

const DAY = 86_400_000;

/** Air Quality (from the fixtures) and Forecasts with a third overlay, to reach the cap. */
const CATALOG: CatalogEntry[] = [
	FIXTURE_CATALOG[0],
	{
		...FORECASTS_ENTRY,
		entryTypes: [
			...FORECASTS_ENTRY.entryTypes,
			{ ...FORECASTS_ENTRY.entryTypes[1], id: "smoke-forecast", label: "Smoke forecast" }
		]
	}
];

/** Air quality for monitors and regions: three daily points per place. */
function airQuality(requests: AdapterRequest[]): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			if (layer.selection?.kind === "monitors") {
				return { kind: "monitors", ids: [...layer.selection.ids] };
			}
			if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
			if (layer.place?.kind === "region") {
				return { kind: "regions", keys: [`${layer.place.type}:${layer.place.code}`] };
			}
			return { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		async fetch(req): Promise<QueryData> {
			requests.push(req);
			if (fetchMode === "fail") throw new Error("offline");
			if (fetchMode === "hang") await new Promise(() => {});
			const keys =
				req.target.kind === "monitors" ? req.target.ids : (req.target as { keys: string[] }).keys;
			const start = req.range.start.getTime();
			return {
				series: keys.map((key, n) => ({
					place: key,
					points: [0, 1, 2].map((i) => ({
						t: start + i * DAY,
						mean: 5 + i + n,
						min: 5 + i + n,
						max: 5 + i + n,
						count: 24,
						partial: false
					}))
				})),
				places: keys.map((key) => ({
					place: key,
					name: key === "county:06019" ? "Fresno County" : `Monitor ${key}`
				})),
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}

let requests: AdapterRequest[];
let forecastRequests: AdapterRequest[];
let missingForecasts: string[];
/** How the air-quality fake answers: normally, never, or with an error. */
let fetchMode: "ok" | "hang" | "fail";

function makeClient(): void {
	const regions: RegionResolver = { resolve: async () => "unsupported" };
	fake.client = createQueryClient({
		adapters: [airQuality(requests), fakeForecastsAdapter(forecastRequests, missingForecasts)],
		metadata: fake.metadata,
		regions
	});
}

beforeEach(async () => {
	await page.viewport(1280, 800);
	requests = [];
	forecastRequests = [];
	missingForecasts = [];
	fetchMode = "ok";
	fake.metadata = fixtureMetadata({ catalog: async () => CATALOG });
	makeClient();
});

afterEach(() => {
	document.body.querySelectorAll("[data-get-data-host]").forEach((el) => el.remove());
});

function monitorsDraft(ids: string[], extra: Partial<Draft> = {}, overlays: string[] = []): Draft {
	return {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				{ dataset: "air-quality", entryType: "pm25", selection: { kind: "monitors", ids } },
				...overlays.map((entryType) => ({ dataset: "forecasts", entryType }))
			]
		},
		...extra
	};
}

async function show(initial: Draft = defaultDraft()) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const host = document.createElement("div");
	host.dataset.getDataHost = "";
	document.body.appendChild(host);
	const added: Draft[] = [];
	const screen = await render(GetDataView, {
		target: host,
		props: {
			mode: { kind: "new" },
			initial,
			onAdd: (_target: string | undefined, draft: Draft) => added.push(draft),
			onCancel: () => {}
		},
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	/** The draft as "Add to dashboard" hands it over. */
	const current = async () => {
		await page.getByRole("button", { name: "Add to dashboard" }).click();
		return added.at(-1)!;
	};
	return { screen, host, platform, current };
}

async function drawn(host: HTMLElement) {
	await expect
		.poll(() => host.querySelector("[data-testid=get-data-preview] canvas"))
		.not.toBeNull();
}

async function chooseDates(name: string) {
	await page.getByRole("button", { name: /^Dates/ }).click();
	await page.getByRole("option", { name }).click();
	await animationsSettled(document.body);
}

describe.each([
	["desktop", 1280, 800],
	["phone", 390, 844]
])("on a %s", (_name, width, height) => {
	beforeEach(async () => {
		await page.viewport(width, height);
	});

	test("opens filled in: Fresno County, PM2.5, Last 30 days, chart drawn", async () => {
		const { host } = await show();
		await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Fresno County");
		await expect
			.element(page.getByRole("button", { name: /^Dates/ }))
			.toHaveTextContent("Last 30 days");
		await expect.element(page.getByRole("radio", { name: "PM2.5" })).toBeChecked();
		await drawn(host);
		await expect
			.element(page.getByTestId("get-data-announcement"))
			.toHaveTextContent("Showing PM2.5 · Fresno County · Last 30 days");
	});

	test("axe passes", async () => {
		const { host } = await show();
		await drawn(host);
		await animationsSettled(host);
		const results = await axe.run(host);
		expect(results.violations).toEqual([]);
	});
});

test("choosing Last 7 days updates the resolved dates and the preview", async () => {
	const { host } = await show();
	await drawn(host);
	await chooseDates("Last 7 days");
	const r = resolveRange({ kind: "trailing", amount: 7, unit: "day" }, new Date());
	await expect
		.element(page.getByTestId("resolved-range"))
		.toHaveTextContent(
			m.get_data_range_rolling({ range: formatDateRange(r.firstDate, r.lastDate) })
		);
	await expect
		.element(page.getByTestId("get-data-announcement"))
		.toHaveTextContent("Showing PM2.5 · Fresno County · Last 7 days");
	expect(requests.at(-1)!.range.firstDate).toBe(r.firstDate);
});

test("adding Burn status adds an overlay; a third overlay option is disabled with a reason", async () => {
	const { current } = await show(monitorsDraft(["m1"]));
	await page.getByRole("button", { name: /Air Quality Forecasts/ }).click();
	await page.getByRole("checkbox", { name: "Burn status" }).click();
	await expect.poll(() => forecastRequests.length).toBeGreaterThan(0);
	expect((await current()).data.layers.map((l) => l.entryType)).toEqual(["pm25", "burn-status"]);
	await page.getByRole("checkbox", { name: "AQI forecast" }).click();
	const third = page.getByRole("checkbox", { name: "Smoke forecast" });
	await expect.element(third).toBeDisabled();
	await expect.element(third).toHaveAccessibleDescription("Up to 2 overlays");
	expect((await current()).data.layers).toHaveLength(3);
});

test("Overlay for appears only when places are in different zones", async () => {
	const { host } = await show(monitorsDraft(["m1", "m2"], {}, ["burn-status"]));
	await drawn(host);
	await expect.poll(() => forecastRequests.length).toBeGreaterThan(0);
	await animationsSettled(host);
	expect(page.getByRole("combobox", { name: "Overlay for" }).elements()).toHaveLength(0);
	host.remove();

	// m2's zone has no forecasts: its overlay differs from m1's.
	missingForecasts.push("m2");
	makeClient();
	const second = await show(monitorsDraft(["m1", "m2"], {}, ["burn-status"]));
	const choice = page.getByRole("combobox", { name: "Overlay for" });
	await expect.element(choice).toBeVisible();
	await choice.selectOptions("Monitor m2");
	expect((await second.current()).options?.overlayFor).toEqual({ kind: "monitor", id: "m2" });
});

test("Show as Chart is disabled with a reason at 7 places", async () => {
	const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	await show(monitorsDraft(ids, { type: "data-table" }));
	const chart = page.getByRole("radio", { name: "Chart" });
	await expect.element(chart).toBeDisabled();
	await expect.element(chart).toHaveAccessibleDescription("Chart: Shows up to 5 places");
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
});

test("Detail hides for a pinned type; Raw is disabled over 90 days with a reason", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 90, unit: "day" };
	const { host } = await show(draft);
	await page.getByRole("button", { name: "More options" }).click();
	const raw = page.getByRole("radio", { name: "Raw" });
	await expect.element(raw).toBeDisabled();
	await expect.element(raw).toHaveAccessibleDescription("Not available for a range this long");
	await expect.element(page.getByRole("radio", { name: "Daily" })).toBeEnabled();
	host.remove();

	chartType.resolution = "day";
	try {
		await show(draft);
		await expect.element(page.getByRole("radio", { name: "PM2.5" })).toBeVisible();
		expect(page.getByRole("button", { name: "More options" }).elements()).toHaveLength(0);
	} finally {
		delete chartType.resolution;
	}
});

test("keyboard: the date list, accordion and Show as work without a mouse", async () => {
	const { host } = await show(monitorsDraft(["m1"]));
	await drawn(host);
	const dates = page.getByRole("button", { name: /^Dates/ });
	(dates.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expect.element(page.getByRole("listbox")).toBeVisible();
	// The list opens on the selected preset (Last 30 days); the next one down is Last 90 days.
	await userEvent.keyboard("{ArrowDown}{Enter}");
	await expect.element(dates).toHaveTextContent("Last 90 days");

	const forecasts = page.getByRole("button", { name: /Air Quality Forecasts/ });
	(forecasts.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	await expect.element(forecasts).toHaveAttribute("aria-expanded", "true");

	const chart = page.getByRole("radio", { name: "Chart" });
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowRight}");
	await expect.element(page.getByRole("radio", { name: "Data table" })).toHaveFocus();
	await userEvent.keyboard(" ");
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
});

test("the pollutant can't be cleared; overlays can't stand alone", async () => {
	const { current } = await show(monitorsDraft(["m1"], {}, ["burn-status"]));
	const pm25 = page.getByRole("radio", { name: "PM2.5" });
	await pm25.click();
	await expect.element(pm25).toBeChecked();
	(pm25.element() as HTMLElement).focus();
	await userEvent.keyboard(" ");
	await expect.element(pm25).toBeChecked();
	await page.getByRole("radio", { name: "Ozone" }).click();
	await expect.element(pm25).not.toBeChecked();
	const layers = (await current()).data.layers;
	expect(layers.map((l) => l.entryType)).toEqual(["o3", "burn-status"]);
	expect(layers[0].selection).toEqual({ kind: "monitors", ids: ["m1"] });
	// The overlay holds no place of its own: it follows the main layer.
	expect(layers[1]).toEqual({ dataset: "forecasts", entryType: "burn-status" });
});

test("choosing Hourly stores resolution: 'hour' on the main layer; Automatic stores none", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
	const { current } = await show(draft);
	await page.getByRole("button", { name: "More options" }).click();
	await page.getByRole("radio", { name: "Hourly" }).click();
	expect((await current()).data.layers[0].resolution).toBe("hour");
	await page.getByRole("radio", { name: "Automatic" }).click();
	expect((await current()).data.layers[0]).not.toHaveProperty("resolution");
});

test("Download CSV saves the draft's data", async () => {
	const { host, platform } = await show(monitorsDraft(["m1"]));
	await drawn(host);
	await page.getByRole("button", { name: "Download CSV" }).click();
	const files = platform.files as unknown as { saved: { name: string; contents: string }[] };
	await expect.poll(() => files.saved.length).toBe(1);
	expect(files.saved[0].contents).toContain("pm25");
});

test("a refetch keeps the place names; a failed query shows the count", async () => {
	const { host } = await show();
	const summary = page.getByTestId("where-summary");
	await expect.element(summary).toHaveTextContent("Fresno County");
	await drawn(host);
	fetchMode = "hang";
	const before = requests.length;
	await chooseDates("Last 7 days");
	await expect.poll(() => requests.length).toBeGreaterThan(before);
	await expect.element(summary).toHaveTextContent("Fresno County");
	host.remove();

	fetchMode = "fail";
	makeClient();
	await show();
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("1 place");
});

test("a detail level the new range can't serve goes back to Automatic", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
	const { current } = await show(draft);
	await page.getByRole("button", { name: "More options" }).click();
	await page.getByRole("radio", { name: "Hourly" }).click();
	expect((await current()).data.layers[0].resolution).toBe("hour");
	await chooseDates("Last 90 days");
	await expect.element(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
	await expect.element(page.getByRole("radio", { name: "Hourly" })).toBeDisabled();
	expect((await current()).data.layers[0]).not.toHaveProperty("resolution");
});
