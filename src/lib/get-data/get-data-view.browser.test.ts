import "../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import { mapDatasetCatalog, type CatalogEntry, type MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import { formatDateRange } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { chartType } from "$lib/widgets/chart";
import {
	FORECASTS_ENTRY,
	fakeForecastsAdapter,
	fakeNumberAdapter
} from "$lib/widgets/shared/test-harness/fake-data";
import { animationsSettled } from "../../test/animations";
import { defaultDraft, type Draft } from "./draft.svelte";
import GetDataView from "./GetDataView.svelte";

type Hit = { id: string; name: string; detail: string; placeholder?: boolean };
type Station = { id: string; name: string; distance: number; inside: boolean; active: boolean };

const fake = vi.hoisted(() => ({
	client: undefined as unknown as QueryClient,
	metadata: undefined as unknown as MetadataSource,
	/** The station list every place gets. */
	stations: [] as Station[],
	/** Each pesticide search asked for. */
	searches: [] as { type: string; q: string; limit?: number }[],
	/** What a search answers. */
	hits: { results: [] as Hit[], more: false },
	/** Names of the chemical, crop and product ids. */
	names: {} as Record<string, string>
}));
const PESTICIDE_META = vi.hoisted(() => ({
	categories: [
		{ key: "insecticide", label: "Insecticides", description: "Kill insects", in_use: true },
		{ key: "old", label: "Retired category", description: "", in_use: false }
	],
	iarc_groups: [{ key: "1", label: "Carcinogens", description: "Group 1" }],
	methods: [{ key: "A", label: "Air" }],
	narrows: [{ key: "concern", label: "Chemicals of concern", description: "A list" }],
	placeholder_chemicals: [{ id: "unk", name: "UNKNOWN" }]
}));
vi.mock("$lib/data", () => ({
	adapterOffers: () => [
		{ id: "air-quality" },
		{ id: "forecasts", overlays: () => true },
		{
			id: "weather",
			offered: (base: string[]) => base.filter((r) => r !== "raw"),
			overlays: () => true
		},
		{ id: "hms-smoke", overlays: () => true },
		{
			id: "pesticide-use",
			offered: (base: string[]) => base.filter((r) => r === "month" || r === "year"),
			overlays: () => true
		}
	],
	getQueryClient: () => fake.client,
	getMetadata: () => fake.metadata,
	getResolvers: () => ({
		regions: { resolve: async () => null },
		locations: { resolve: async () => null },
		points: { keys: async () => [] }
	}),
	placeRegion: async () => null
}));
vi.mock("./sources", () => ({
	stationsForLayer: async () => fake.stations,
	searchPesticides: async (params: { type: string; q: string; limit?: number }) => {
		fake.searches.push({ type: params.type, q: params.q, limit: params.limit });
		return params.q.trim().length < 2 ? { results: [], more: false } : fake.hits;
	},
	pesticideMeta: async () => PESTICIDE_META,
	filterLabels: async (f: Record<string, string | undefined>) =>
		Object.fromEntries(
			["chemical", "commodity", "product"]
				.filter((k) => f[k])
				.map((k) => [k, fake.names[f[k]!] ?? f[k]])
		),
	filterSummary: async (f: Record<string, unknown> | undefined) => {
		const labels: string[] = [];
		for (const k of ["chemical", "commodity", "product"]) {
			const id = f?.[k] as string | undefined;
			if (id) labels.push(fake.names[id] ?? id);
		}
		if (f?.iarcGroup) labels.push("Carcinogens");
		return labels;
	},
	FilterGone: class extends Error {}
}));

const DAY = 86_400_000;

/**
 * Air Quality (from the fixtures), Forecasts with a third overlay (to reach the cap), Weather,
 * Wildfire Smoke and Pesticide Use.
 */
const CATALOG: CatalogEntry[] = [
	FIXTURE_CATALOG[0],
	{
		...FORECASTS_ENTRY,
		entryTypes: [
			...FORECASTS_ENTRY.entryTypes,
			{ ...FORECASTS_ENTRY.entryTypes[1], id: "smoke-forecast", label: "Smoke forecast" }
		]
	},
	...mapDatasetCatalog({
		...SDK_DATASET_CATALOG,
		datasets: [WEATHER_DATASET, PESTICIDE_USE_DATASET]
	}),
	{
		id: "hms-smoke",
		label: "Wildfire Smoke",
		entryTypes: [{ ...FORECASTS_ENTRY.entryTypes[0], id: "smoke-density", label: "Smoke density" }],
		geographies: ["region"]
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
		adapters: [
			airQuality(requests),
			fakeForecastsAdapter(forecastRequests, missingForecasts),
			fakeNumberAdapter("weather", []),
			{ ...fakeForecastsAdapter([]), id: "hms-smoke" },
			fakeNumberAdapter("pesticide-use", [], { offered: ["month", "year"] })
		],
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
	fake.stations = [];
	fake.searches = [];
	fake.hits = { results: [], more: false };
	fake.names = {};
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
	const targets: string[] = [];
	const screen = await render(GetDataView, {
		target: host,
		props: {
			mode: { kind: "new" },
			initial,
			add: {
				selected: { id: "d1", name: "Home" },
				others: [{ id: "d2", name: "School" }],
				busy: false,
				onAdd: (targetId: string, draft: Draft) => {
					targets.push(targetId);
					added.push(draft);
				}
			},
			onCancel: () => {}
		},
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	/** The draft as "Add to Home" hands it over. */
	const current = async () => {
		await page.getByRole("button", { name: "Add to Home" }).click();
		return added.at(-1)!;
	};
	return { screen, host, platform, current, targets };
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

test("a rolling length the list doesn't have shows as Custom range, with its dates to edit", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 45, unit: "day" };
	const { current } = await show(draft);
	await expect
		.element(page.getByRole("button", { name: /^Dates/ }))
		.toHaveTextContent(m.getdata_preset_custom());
	const r = resolveRange(draft.data.dateRange, new Date());
	const start = page.getByLabelText("Start date");
	await expect.element(start).toHaveValue(r.firstDate);
	await expect.element(page.getByLabelText("End date")).toHaveValue(r.lastDate);
	await start.fill("2026-09-01");
	expect((await current()).data.dateRange).toEqual({
		kind: "custom",
		start: "2026-09-01",
		end: r.lastDate
	});
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

test("an entry type its adapter doesn't overlay isn't offered; one already chosen can be removed", async () => {
	const humidity = {
		...FIXTURE_CATALOG[0].entryTypes[0],
		id: "humidity",
		label: "Humidity",
		kind: "meteorological" as const,
		resolutions: ["raw" as const]
	};
	const air = { ...FIXTURE_CATALOG[0], entryTypes: [...FIXTURE_CATALOG[0].entryTypes, humidity] };
	fake.metadata = fixtureMetadata({ catalog: async () => [air, CATALOG[1]] });
	makeClient();
	const fresh = await show(monitorsDraft(["m1"]));
	await expect.element(page.getByRole("radio", { name: "PM2.5" })).toBeChecked();
	expect(page.getByRole("checkbox", { name: "Humidity" }).elements()).toHaveLength(0);
	fresh.screen.unmount();
	fresh.host.remove();

	const saved = monitorsDraft(["m1"]);
	saved.data.layers.push({ dataset: "air-quality", entryType: "humidity" });
	const { current } = await show(saved);
	const box = page.getByRole("checkbox", { name: "Humidity" });
	await expect.element(box).toBeChecked();
	await box.click();
	expect((await current()).data.layers.map((l) => l.entryType)).toEqual(["pm25"]);
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

test("Detail hides for a pinned type; Every measurement is disabled over 90 days with a reason", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 90, unit: "day" };
	const { host } = await show(draft);
	await page.getByRole("button", { name: "More options" }).click();
	const raw = page.getByRole("radio", { name: m.get_data_detail_raw() });
	await expect.element(raw).toBeDisabled();
	await expect.element(raw).toHaveAccessibleDescription(m.get_data_detail_too_many());
	// Hourly over more than 31 days is served (a month per request).
	await expect.element(page.getByRole("radio", { name: "Hourly" })).toBeEnabled();
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

test("the pollutant can't be cleared without a number layer; overlays can't stand alone", async () => {
	const { current } = await show(monitorsDraft(["m1"], {}, ["burn-status"]));
	const none = page.getByRole("radio", { name: "None" });
	await expect.element(none).toBeDisabled();
	await expect.element(none).toHaveAccessibleDescription(m.get_data_keep_one());
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
	await page.getByRole("radio", { name: m.get_data_detail_raw() }).click();
	expect((await current()).data.layers[0].resolution).toBe("raw");
	// 90 days of raw readings is more than the point budget.
	await chooseDates("Last 90 days");
	await expect.element(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
	await expect.element(page.getByRole("radio", { name: m.get_data_detail_raw() })).toBeDisabled();
	expect((await current()).data.layers[0]).not.toHaveProperty("resolution");
});

function withLayers(ids: string[], ...rest: Draft["data"]["layers"]): Draft {
	const draft = monitorsDraft(ids);
	draft.data.layers.push(...rest);
	return draft;
}

const TEMPERATURE = { dataset: "weather", entryType: "temperature" };
const POUNDS = { dataset: "pesticide-use", entryType: "pounds-applied" };

async function openSection(name: RegExp) {
	await page.getByRole("button", { name }).click();
	await animationsSettled(document.body);
}

test("a temperature-only chart can be added", async () => {
	const { current } = await show(monitorsDraft(["m1"]));
	await openSection(/^Weather/);
	await page.getByRole("checkbox", { name: "Temperature" }).click();
	await page.getByRole("radio", { name: "None" }).click();
	expect((await current()).data.layers).toEqual([
		{ ...TEMPERATURE, selection: { kind: "monitors", ids: ["m1"] } }
	]);
	// The last number layer can't be unchecked.
	const box = page.getByRole("checkbox", { name: "Temperature" });
	await expect.element(box).toBeDisabled();
	await expect.element(box).toHaveAccessibleDescription(m.get_data_keep_one());
});

test("choosing None for Air Quality keeps the places", async () => {
	const { current } = await show(withLayers(["m1", "m2"], { ...TEMPERATURE }));
	await page.getByRole("radio", { name: "None" }).click();
	await expect.element(page.getByRole("radio", { name: "None" })).toBeChecked();
	await expect
		.element(page.getByTestId("where-summary"))
		.toHaveTextContent("Monitor m1 and Monitor m2");
	expect((await current()).data.layers).toEqual([
		{ ...TEMPERATURE, selection: { kind: "monitors", ids: ["m1", "m2"] } }
	]);
	// Choosing a pollutant again takes them back.
	await page.getByRole("radio", { name: "Ozone" }).click();
	expect((await current()).data.layers).toEqual([
		{ dataset: "air-quality", entryType: "o3", selection: { kind: "monitors", ids: ["m1", "m2"] } },
		{ ...TEMPERATURE }
	]);
});

test("the station choice shows only with one place", async () => {
	fake.stations = [
		{ id: "st1", name: "Fresno State", distance: 0, inside: true, active: true },
		{ id: "st2", name: "Parlier", distance: 4.2, inside: false, active: false }
	];
	const one = await show(withLayers(["m1"], { ...TEMPERATURE }));
	await openSection(/^Weather/);
	const station = page.getByRole("combobox", { name: "Station" });
	await expect.element(station).toHaveValue("st1");
	expect(
		[...(station.element() as HTMLSelectElement).options].map((o) => o.textContent?.trim())
	).toEqual(["Fresno State", "Parlier (4.2 mi), may be behind"]);
	await station.selectOptions("st2");
	expect((await one.current()).data.layers[1].station).toBe("st2");
	// The first (default) station stores nothing.
	await station.selectOptions("st1");
	expect((await one.current()).data.layers[1]).toEqual(TEMPERATURE);
	one.screen.unmount();
	one.host.remove();

	await show(withLayers(["m1", "m2"], { ...TEMPERATURE }));
	await openSection(/^Weather/);
	await expect.element(page.getByRole("checkbox", { name: "Temperature" })).toBeChecked();
	expect(page.getByRole("combobox", { name: "Station" }).elements()).toHaveLength(0);
});

test("a filter search lists results after two letters and picks one", async () => {
	fake.hits = {
		results: [
			{ id: "c1", name: "Chlorpyrifos", detail: "CDPR chem code 253", placeholder: false },
			{ id: "unk", name: "UNKNOWN", detail: "", placeholder: true }
		],
		more: true
	};
	fake.names = { c1: "Chlorpyrifos" };
	const { current } = await show(withLayers(["m1"], { ...POUNDS }));
	await openSection(/^Pesticide Use/);
	await expect.element(page.getByTestId("pesticide-summary")).toHaveTextContent("All pesticides");
	await page.getByRole("button", { name: "Narrow down" }).click();
	const chemical = page.getByRole("combobox", { name: "Chemical" });
	await chemical.click();
	await userEvent.keyboard("c");
	await new Promise((r) => setTimeout(r, 400));
	expect(fake.searches).toEqual([]);
	await userEvent.keyboard("h");
	await expect.element(page.getByRole("option", { name: /Chlorpyrifos/ })).toBeVisible();
	expect(fake.searches).toEqual([{ type: "chemical", q: "ch", limit: 25 }]);
	expect(page.getByRole("option", { name: /UNKNOWN/ }).elements()).toHaveLength(0);
	await expect.element(chemical).toHaveAccessibleDescription(m.get_data_search_more());
	await page.getByRole("option", { name: /Chlorpyrifos/ }).click();
	await expect.element(page.getByTestId("pesticide-summary")).toHaveTextContent("Chlorpyrifos");
	expect((await current()).data.layers[1]).toEqual({ ...POUNDS, filters: { chemical: "c1" } });

	// A second layer of the same measure, with its own filters.
	await page.getByRole("button", { name: "Add another pesticide layer" }).click();
	await page.getByRole("menuitem", { name: "Pounds Applied" }).click();
	const layers = (await current()).data.layers;
	expect(layers.slice(1)).toEqual([{ ...POUNDS, filters: { chemical: "c1" } }, { ...POUNDS }]);
	// At the overlay limit, no more can be added.
	const add = page.getByRole("button", { name: "Add another pesticide layer" });
	await expect.element(add).toBeDisabled();
	await expect.element(add).toHaveAccessibleDescription("Up to 2 overlays");
});

test("smoke alone disables Add with the reason", async () => {
	const draft: Draft = {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				{
					dataset: "hms-smoke",
					entryType: "smoke-density",
					selection: { kind: "monitors", ids: ["m1"] }
				}
			]
		}
	};
	await show(draft);
	const add = page.getByRole("button", { name: "Add to Home" });
	await expect.element(add).toBeDisabled();
	await expect.element(add).toHaveAccessibleDescription(m.get_data_level_only());
	await expect.element(page.getByRole("button", { name: "Download CSV" })).toBeDisabled();
	await expect.element(page.getByText(m.get_data_level_only())).toBeVisible();
	// Adding a number layer makes it chartable, and it takes the places.
	await openSection(/^Weather/);
	await page.getByRole("checkbox", { name: "Temperature" }).click();
	await expect.element(add).toBeEnabled();
});

describe.each([
	["desktop", 1280, 800],
	["phone", 390, 844]
])("with a pesticide layer's Narrow down open on a %s", (_name, width, height) => {
	test("axe passes", async () => {
		await page.viewport(width, height);
		fake.stations = [{ id: "st1", name: "Fresno State", distance: 0, inside: true, active: true }];
		const { host } = await show(withLayers(["m1"], { ...POUNDS, filters: { iarcGroup: "1" } }));
		await openSection(/^Pesticide Use/);
		await page.getByRole("button", { name: "Narrow down" }).click();
		await expect.element(page.getByRole("combobox", { name: "Cancer group" })).toHaveValue("1");
		await openSection(/^Weather/);
		await drawn(host);
		await animationsSettled(host);
		const results = await axe.run(host);
		expect(results.violations).toEqual([]);
	});
});
