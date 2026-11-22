import "../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import {
	mapDatasetCatalog,
	type CatalogEntry,
	type Level,
	type MetadataSource
} from "$lib/data/metadata";
import { createNowClient, type NowClient } from "$lib/data/now/client";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import { formatDate, formatDateRange, todayPacific } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { thresholdMarks } from "$lib/thresholds/marks.svelte";
import { chartType } from "$lib/widgets/chart";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import {
	FORECASTS_ENTRY,
	fakeForecastsAdapter,
	fakeNumberAdapter
} from "$lib/widgets/shared/test-harness/fake-data";
import { animationsSettled } from "../../test/animations";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { makeDoc } from "$lib/sync/test-support";
import { defaultDraft, type Draft } from "./draft.svelte";
import { editDraft, saveEdit } from "./edit";
import GetDataView from "./GetDataView.svelte";

type Hit = { id: string; name: string; detail: string; placeholder?: boolean };
type Station = { id: string; name: string; distance: number; inside: boolean; active: boolean };

const fake = vi.hoisted(() => ({
	client: undefined as unknown as QueryClient,
	now: undefined as unknown as NowClient,
	metadata: undefined as unknown as MetadataSource,
	/** The station list every place gets. */
	stations: [] as Station[],
	/** Each pesticide search asked for. */
	searches: [] as { type: string; q: string; limit?: number }[],
	/** What a search answers. */
	hits: { results: [] as Hit[], more: false },
	/** Names of the chemical, crop and product ids. */
	names: {} as Record<string, string>,
	/** Holds a search's answer back (by its query) until the promise settles. */
	delay: undefined as ((q: string) => Promise<void>) | undefined,
	/**
	 * The region types the directory offers (default: none, so no test asks the network for the
	 * regions meta).
	 */
	regionTypes: undefined as (() => Promise<unknown[]>) | undefined,
	/** The pesticide meta's answer (default: `PESTICIDE_META`). */
	pesticideMeta: undefined as (() => Promise<unknown>) | undefined,
	/** The regions the resolver knows, by `type:code`, with their names (default: none). */
	regionNames: {} as Record<string, string>,
	/** The schools the resolver knows, by `source:code`, with their names (default: none). */
	locations: {} as Record<string, string>,
	/** The region resolver fails (a lookup that can't be made). */
	regionFail: false
}));
const PESTICIDE_META = vi.hoisted(() => ({
	categories: [
		{ key: "insecticide", label: "Insecticides", description: "Kill insects", in_use: true },
		{ key: "old", label: "Retired category", description: "", in_use: false }
	],
	iarc_groups: [{ key: "1", label: "Carcinogens", description: "Group 1" }],
	methods: [{ key: "A", label: "Air" }],
	narrows: [{ key: "concern", label: "Chemicals of concern", description: "A list" }],
	placeholder_chemicals: [{ id: "unk", name: "UNKNOWN" }],
	years: [2023, 2022, 2021],
	// The notice endpoints take no commodity.
	notice_filters: ["chemical_id", "product_id", "category", "iarc_group", "narrow", "aerial_ground"]
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
		regions: {
			resolve: async (type: string, code: string) => {
				if (fake.regionFail) throw new Error("offline");
				const name = fake.regionNames[`${type}:${code}`];
				return name ? { id: `sq-${code}`, name } : null;
			}
		},
		locations: {
			resolve: async (source: string, code: string) => {
				const name = fake.locations[`${source}:${code}`];
				return name
					? {
							name,
							keys: [],
							details: { type: "school", city: "Fresno", zip: "93702", address: "1" }
						}
					: null;
			}
		},
		points: { keys: async () => [] }
	}),
	placeRegion: async () => null
}));
vi.mock("$lib/data/now", () => ({ getNowClient: () => fake.now }));
vi.mock("$lib/places/host", async (original) => {
	const actual = await original<typeof import("$lib/places/host")>();
	return {
		...actual,
		directoryFor: (...args: Parameters<typeof actual.directoryFor>) => {
			const real = actual.directoryFor(...args);
			const known = Object.keys(fake.regionNames).length > 0;
			return {
				...real,
				...(fake.regionTypes ? { regionTypes: fake.regionTypes } : {}),
				...(Object.keys(fake.locations).length > 0
					? { locationTypes: async () => [{ type: "school", label: "School", source: "schools" }] }
					: {}),
				...(known ? { regionTypeLabels: async () => new Map([["county", "County"]]) } : {})
			};
		}
	};
});
vi.mock("./sources", () => ({
	stationsForLayer: async () => fake.stations,
	searchPesticides: async (params: { type: string; q: string; limit?: number }) => {
		fake.searches.push({ type: params.type, q: params.q, limit: params.limit });
		// Read before waiting, so a late answer is what was found when it was asked.
		const hits = fake.hits;
		await fake.delay?.(params.q);
		return params.q.trim().length < 2 ? { results: [], more: false } : hits;
	},
	pesticideMeta: async () => (fake.pesticideMeta ? fake.pesticideMeta() : PESTICIDE_META),
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
	},
	{
		id: "pesticide-notices",
		label: "Pesticide Spray Notices",
		description: "Notices of intent to spray.",
		entryTypes: [{ ...FORECASTS_ENTRY.entryTypes[0], id: "spray-notice", label: "Spray notice" }],
		geographies: ["point"]
	} as CatalogEntry
];

/** Air quality for monitors and regions: three daily points per place. */
function airQuality(requests: AdapterRequest[]): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			if (layer.monitors?.length) return { kind: "monitors", ids: [...layer.monitors] };
			// Ticked types: the types' monitors (t1, t2), alongside a county's own place.
			if (layer.monitorTypes?.length) {
				if (layer.place?.kind === "region") {
					return {
						kind: "regions",
						keys: [`${layer.place.type}:${layer.place.code}`, "monitor:t1", "monitor:t2"]
					};
				}
				return { kind: "monitors", ids: ["t1", "t2"] };
			}
			if (layer.place?.kind === "region") {
				return { kind: "regions", keys: [`${layer.place.type}:${layer.place.code}`] };
			}
			if (layer.selection) return { kind: "regions", keys: [...layer.selection.ids] };
			return { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		async fetch(req): Promise<QueryData> {
			requests.push(req);
			if (fetchMode === "fail") throw new Error("offline");
			if (fetchMode === "hang") await new Promise(() => {});
			const keys =
				req.target.kind === "monitors"
					? req.target.ids.map((id) => `monitor:${id}`)
					: (req.target as { keys: string[] }).keys;
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
					name:
						fake.regionNames[key] ??
						(key === "county:06019" ? "Fresno County" : `Monitor ${key.replace("monitor:", "")}`)
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
	fake.delay = undefined;
	fake.regionTypes = async () => [];
	fake.pesticideMeta = undefined;
	fake.regionNames = {};
	fake.locations = {};
	fake.regionFail = false;
	fake.metadata = fixtureMetadata({ catalog: async () => CATALOG });
	makeClient();
	fake.now = createNowClient({ activity: createMemoryPlatform().activity });
});

afterEach(() => {
	document.body.querySelectorAll("[data-get-data-host]").forEach((el) => el.remove());
});

/**
 * A Chart of PM2.5 (and `overlays`) in the counties `codes` (a Where selection; one is a place),
 * each named "Area <code>" by the region resolver.
 */
function areasDraft(codes: string[], extra: Partial<Draft> = {}, overlays: string[] = []): Draft {
	for (const code of codes) fake.regionNames[`county:${code}`] = `Area ${code}`;
	const ids = codes.map((code) => `county:${code}`);
	return {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			...(ids.length === 1
				? { place: { kind: "region", type: "county", code: codes[0] } }
				: { selection: { kind: "regions", ids } }),
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				...overlays.map((entryType) => ({ dataset: "forecasts", entryType }))
			]
		},
		...extra
	};
}

/** A Chart of PM2.5 (and `overlays`) at the searched monitors `ids`. */
function monitorsDraft(ids: string[], extra: Partial<Draft> = {}, overlays: string[] = []): Draft {
	return {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				{ dataset: "air-quality", entryType: "pm25", monitors: [...ids] },
				...overlays.map((entryType) => ({ dataset: "forecasts", entryType }))
			]
		},
		...extra
	};
}

async function show(initial: Draft = defaultDraft()) {
	// The default draft's county, named by the region resolver (unless a test named it already).
	fake.regionNames["county:06019"] ??= "Fresno County";
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const host = document.createElement("div");
	host.dataset.getDataHost = "";
	document.body.appendChild(host);
	const added: Draft[] = [];
	const targets: string[] = [];
	const changes: Draft[] = [];
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
			onCancel: () => {},
			onchange: (draft: Draft) => changes.push(draft)
		},
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	/** The draft as "Add to Home" hands it over. */
	const current = async () => {
		await page.getByRole("button", { name: "Add to Home" }).click();
		return added.at(-1)!;
	};
	/** The draft as it stands, without adding it (for a draft that can't be added). */
	const latest = () => changes.at(-1)!;
	return { screen, host, platform, current, latest, targets };
}

/** The preview's canvas appears. The first test pays for loading the chart code, so it waits longer. */
async function drawn(host: HTMLElement) {
	await expect
		.poll(() => host.querySelector("[data-testid=get-data-preview] canvas"), { timeout: 5000 })
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
	expect((await second.current()).options).toEqual({ overlayFor: { kind: "monitor", id: "m2" } });
});

test("Overlay for lists a monitor set's monitors; the overlay is fetched for the one chosen", async () => {
	const draft = monitorsDraft([], {}, ["burn-status"]);
	draft.data.layers[0] = { dataset: "air-quality", entryType: "pm25", monitorTypes: ["purpleair"] };
	const { current } = await show(draft);
	// Same zone or not, a set's monitors are listed: only the chosen one's overlay is fetched.
	const choice = page.getByRole("combobox", { name: "Overlay for" });
	await expect.element(choice).toBeVisible();
	await expect
		.poll(() => forecastRequests.at(-1)?.target)
		.toEqual({ kind: "monitors", ids: ["t1"] });
	await choice.selectOptions("Monitor t2");
	expect((await current()).options).toEqual({ overlayFor: { kind: "monitor", id: "t2" } });
	await expect
		.poll(() => forecastRequests.at(-1)?.target)
		.toEqual({ kind: "monitors", ids: ["t2"] });
	expect(
		forecastRequests.every((r) => r.target.kind === "monitors" && r.target.ids.length === 1)
	).toBe(true);
});

describe("Show as with many places", () => {
	const ids = Array.from({ length: 40 }, (_, i) => `k${i + 1}`);
	const selected = (d: Draft) => d.data.selection?.ids.map((id) => id.slice("county:".length));

	test("a 40-area Table shows as a Chart of all 40, with no keep dialog", async () => {
		const { latest } = await show(areasDraft(ids, { type: "data-table" }));
		const chart = page.getByRole("radio", { name: "Chart" });
		await expect.element(chart).toBeEnabled();
		await expect.element(chart).not.toHaveAccessibleDescription();
		await chart.click();
		await expect.element(chart).toBeChecked();
		expect(page.getByRole("dialog").query()).toBeNull();
		expect(latest().type).toBe("chart");
		expect(selected(latest())).toEqual(ids);
		expect(page.getByText(/places, so the others were left out/).query()).toBeNull();
		// Back to the Table: all 40 still.
		await page.getByRole("radio", { name: "Data table" }).click();
		expect(selected(latest())).toEqual(ids);
	});
});

test("opens a Chart draft with 6 places without looping", async () => {
	const errors: string[] = [];
	const onError = (e: ErrorEvent) => {
		errors.push(String(e.error?.message ?? e.message));
		e.preventDefault();
	};
	window.addEventListener("error", onError);
	const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
		errors.push(args.map(String).join(" "));
	});
	try {
		const ids = ["m1", "m2", "m3", "m4", "m5", "m6"];
		const { host } = await show(monitorsDraft(ids));
		await drawn(host);
		await new Promise((r) => setTimeout(r, 500));
		expect(errors.filter((e) => e.includes("effect_update_depth_exceeded"))).toEqual([]);
		expect(host.querySelector("[data-testid=get-data-preview]")).not.toBeNull();
	} finally {
		window.removeEventListener("error", onError);
		spy.mockRestore();
	}
});

test("Data resolution hides for a pinned type; Every measurement is disabled over 90 days with a reason", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 90, unit: "day" };
	const { host } = await show(draft);
	const raw = page.getByRole("radio", { name: m.get_data_resolution_raw() });
	await expect.element(raw).toBeDisabled();
	await expect.element(raw).toHaveAccessibleDescription(m.get_data_resolution_too_many());
	// Hourly over more than 31 days is served (a month per request).
	await expect.element(page.getByRole("radio", { name: "Hourly" })).toBeEnabled();
	await expect.element(page.getByRole("radio", { name: "Daily" })).toBeEnabled();
	host.remove();

	chartType.resolution = "day";
	try {
		await show(draft);
		await expect.element(page.getByRole("radio", { name: "PM2.5" })).toBeVisible();
		expect(page.getByRole("heading", { name: m.get_data_resolution() }).elements()).toHaveLength(0);
		expect(page.getByRole("radio", { name: "Automatic" }).elements()).toHaveLength(0);
	} finally {
		delete chartType.resolution;
	}
});

test("Data resolution is its own section after What, with a help button; the line is in More options", async () => {
	const { host } = await show(monitorsDraft(["m1"]));
	const heading = page.getByRole("heading", { name: m.get_data_resolution(), exact: true });
	await expect.element(heading).toBeVisible();
	expect(m.get_data_resolution()).toBe("Data resolution");
	// After What, and not inside More options (visible without opening it).
	const what = page.getByRole("heading", { name: m.get_data_what(), exact: true }).element();
	expect(
		what.compareDocumentPosition(heading.element()) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	const more = page.getByRole("button", { name: "More options" });
	expect(more.element().closest("[data-state]")?.contains(heading.element())).toBe(false);
	await expect.element(page.getByRole("radio", { name: "Automatic" })).toBeVisible();
	// The help button sits beside the group's name, not inside it.
	await expect
		.element(page.getByRole("group", { name: m.get_data_resolution(), exact: true }))
		.toBeVisible();
	const help = page.getByRole("button", { name: m.get_data_resolution_help_label() });
	await expect.element(help).toBeVisible();
	await help.click();
	await expect
		.element(page.getByRole("status").filter({ hasText: m.get_data_resolution_help() }))
		.toBeVisible();
	// The threshold line control is what More options holds.
	const line = page.getByRole("combobox", { name: m.get_data_line_at_level() });
	expect(line.elements()).toHaveLength(0);
	await more.click();
	await expect.element(line).toBeVisible();
	host.remove();
});

test("adding pesticide use on Automatic says Automatic moved to Monthly; removing it clears the note", async () => {
	const { host, current } = await show(monitorsDraft(["m1"]));
	const note = page.getByTestId("resolution-note");
	await expect.element(note).toHaveTextContent("");
	await openSection(/^Pesticide Use/);
	await page.getByRole("button", { name: m.get_data_pesticide_add_first() }).click();
	await page.getByRole("menuitem", { name: "Pounds Applied" }).click();
	await expect
		.element(note)
		.toHaveTextContent(
			"Automatic data resolution is now Monthly: Pesticide Use is reported by month."
		);
	await expect.element(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
	// The finer levels are greyed, naming the dataset.
	const daily = page.getByRole("radio", { name: "Daily" });
	await expect.element(daily).toBeDisabled();
	await expect.element(daily).toHaveAccessibleDescription("Pesticide Use isn't reported daily");
	await expect.element(page.getByRole("radio", { name: "Monthly" })).toBeEnabled();
	// Automatic is never stored.
	expect((await current()).data).not.toHaveProperty("resolution");
	// Last 30 days at Monthly covers whole months, so the dates widen (to today, so far).
	await expect.element(page.getByTestId("range-widened-note")).toHaveTextContent(
		m.get_data_range_widened_so_far({
			start: formatDate(
				resolveRange({ kind: "trailing", amount: 30, unit: "day" }, new Date(), "month").firstDate
			),
			end: formatDate(todayPacific())
		})
	);
	await page.getByRole("button", { name: /^Remove/ }).click();
	await expect.element(note).toHaveTextContent("");
	await expect.element(daily).toBeEnabled();
	await expect.element(page.getByTestId("range-widened-note")).toHaveTextContent("");
	host.remove();
});

test("a custom range at Monthly shows the whole months it covers", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "custom", start: "2026-03-10", end: "2026-04-20" };
	draft.data.resolution = "month";
	const { host } = await show(draft);
	await expect.element(page.getByTestId("range-widened-note")).toHaveTextContent(
		m.get_data_range_widened({
			start: formatDate("2026-03-01"),
			end: formatDate("2026-04-30")
		})
	);
	await expect
		.element(page.getByTestId("resolved-range"))
		.toHaveTextContent(formatDateRange("2026-03-01", "2026-04-30"));
	host.remove();
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
	// The other types follow the Chart (the now types are never blocked: choosing one converts the
	// draft); the arrow keys reach Current conditions past the calendars.
	const current = page.getByRole("radio", { name: "Current conditions" });
	for (let i = 0; i < 6 && document.activeElement !== current.element(); i++) {
		await userEvent.keyboard("{ArrowRight}");
	}
	await expect.element(current).toHaveFocus();
	await userEvent.keyboard(" ");
	await expect.element(current).toBeChecked();
});

test("get data view: None is never disabled", async () => {
	for (const type of ["chart", "map"]) {
		const { current, host, screen } = await show(areasDraft(["06019"], { type }));
		// The Map's Fill regions by has a None of its own.
		const scope = type === "map" ? page.getByRole("group", { name: "Air quality" }) : page;
		const none = scope.getByRole("radio", { name: "None" });
		await expect.element(none).toBeEnabled();
		expect(none.element().getAttribute("aria-describedby")).toBeNull();
		await none.click();
		await expect.element(none).toBeChecked();
		expect((await current()).data.layers).toEqual([]);
		screen.unmount();
		host.remove();
	}
});

test("get data view: Where shows with no pollutant and reads Everywhere", async () => {
	const draft = areasDraft(["06019"]);
	draft.data.layers = [];
	delete draft.data.place;
	await show(draft);
	await expect.element(page.getByRole("heading", { name: "Where" })).toBeVisible();
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Everywhere");
});

test("get data view: searched monitors with no Where read Everywhere", async () => {
	await show(monitorsDraft(["m1", "m2"]));
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Everywhere");
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await expect.element(page.getByTestId("where-summary")).not.toHaveTextContent("Monitor");
});

test("get data view: a single-place widget with no Where and no monitor asks for one", async () => {
	await show({
		type: "current-conditions",
		data: { layers: [{ dataset: "air-quality", entryType: "pm25" }] }
	});
	await expect
		.element(page.getByTestId("where-summary"))
		.toHaveTextContent("Choose a place or a monitor");
});

test("get data view: Reference-grade ticked with no Where reads Everywhere", async () => {
	const draft = areasDraft([]);
	draft.data.layers[0] = { dataset: "air-quality", entryType: "pm25", monitorTypes: ["airnow"] };
	await show(draft);
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Everywhere");
	await expect.element(page.getByTestId("where-summary")).not.toHaveTextContent("Monitor");
});

test("get data view: a county Where with ticked types names the county, not the monitors", async () => {
	const draft = areasDraft(["06019"]);
	draft.data.layers[0] = { dataset: "air-quality", entryType: "pm25", monitorTypes: ["airnow"] };
	await show(draft);
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area 06019");
	await expect.element(page.getByTestId("where-summary")).not.toHaveTextContent("Monitor");
});

test("get data view: the Map offers radios, one pollutant", async () => {
	fake.metadata = fixtureMetadata({
		catalog: async () => CATALOG,
		mapPollutants: async () => ["pm25", "o3"]
	});
	const { current } = await show(areasDraft(["06019"], { type: "map" }));
	const group = page.getByRole("group", { name: "Air quality" });
	const radios = group.getByRole("radio");
	await expect.element(group.getByRole("radio", { name: "PM2.5" })).toBeChecked();
	expect(radios.elements().map((r) => r.closest("label")?.textContent?.trim())).toEqual([
		m.get_data_none(),
		"PM2.5",
		"Ozone"
	]);
	await expect.element(group.getByRole("checkbox")).not.toBeInTheDocument();
	await group.getByRole("radio", { name: "Ozone" }).click();
	await expect.element(group.getByRole("radio", { name: "PM2.5" })).not.toBeChecked();
	expect((await current()).data.layers).toEqual([{ dataset: "air-quality", entryType: "o3" }]);
	expect((await current()).data.place).toEqual({ kind: "region", type: "county", code: "06019" });
});

test("get data view: a pollutant the catalog doesn't know is replaced or removed, never doubled", async () => {
	for (const type of ["map", "chart"]) {
		const unknown = (): Draft => {
			const draft = monitorsDraft(["m1"], { type });
			draft.data.layers = [{ dataset: "air-quality", entryType: "mystery" }];
			return draft;
		};
		const scope = () => (type === "map" ? page.getByRole("group", { name: "Air quality" }) : page);
		let shown = await show(unknown());
		// It's the pollutant chosen: None isn't checked.
		await expect.element(scope().getByRole("radio", { name: "None" })).not.toBeChecked();
		await scope().getByRole("radio", { name: "PM2.5" }).click();
		expect((await shown.current()).data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" }
		]);
		shown.screen.unmount();
		shown.host.remove();
		shown = await show(unknown());
		await scope().getByRole("radio", { name: "None" }).click();
		await expect.element(scope().getByRole("radio", { name: "None" })).toBeChecked();
		expect((await shown.current()).data.layers).toEqual([]);
		shown.screen.unmount();
		shown.host.remove();
	}
});

test("the pollutant radios switch the pollutant; overlays follow the main layer", async () => {
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
	// The pollutant's searched monitors stay with it.
	expect(layers[0].monitors).toEqual(["m1"]);
	// The overlay holds no place of its own: it follows the main layer.
	expect(layers[1]).toEqual({ dataset: "forecasts", entryType: "burn-status" });
});

test("choosing Hourly stores the data's resolution: 'hour'; Automatic stores none", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
	const { current } = await show(draft);
	await page.getByRole("radio", { name: "Hourly" }).click();
	expect((await current()).data.resolution).toBe("hour");
	await page.getByRole("radio", { name: "Automatic" }).click();
	expect((await current()).data).not.toHaveProperty("resolution");
});

test("Download CSV saves the draft's data", async () => {
	const { host, platform } = await show(monitorsDraft(["m1"]));
	await drawn(host);
	await page.getByRole("button", { name: "Download CSV" }).click();
	const files = platform.files as unknown as { saved: { name: string; contents: string }[] };
	await expect.poll(() => files.saved.length).toBe(1);
	expect(files.saved[0].contents).toContain("pm25");
});

test("a refetch keeps the place names; a place that can't be looked up shows the count", async () => {
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

	fake.regionFail = true;
	makeClient();
	await show();
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("1 place");
});

test("get data view: a county Where with searched monitors names the county", async () => {
	const draft = areasDraft(["06019"]);
	draft.data.layers[0] = { dataset: "air-quality", entryType: "pm25", monitors: ["m1"] };
	await show(draft);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area 06019");
});

test("get data view: a point Where reads its label, else Your location", async () => {
	const draft = areasDraft([]);
	draft.data.place = { kind: "point", lat: 36.7, lon: -119.8, label: "Home" };
	const { screen, host } = await show(draft);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Home");
	screen.unmount();
	host.remove();
	const plain = areasDraft([]);
	plain.data.place = { kind: "point", lat: 36.7, lon: -119.8 };
	await show(plain);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Your location");
});

test("get data view: a school Where names the school", async () => {
	fake.locations = { "schools:s1": "Roosevelt High" };
	const draft = areasDraft([]);
	draft.data.place = { kind: "location", source: "schools", code: "s1" };
	await show(draft);
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Roosevelt High");
});

test("a chosen level the new range can't serve stays, blocked, and Add waits", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
	const { current } = await show(draft);
	const raw = page.getByRole("radio", { name: m.get_data_resolution_raw() });
	await raw.click();
	expect((await current()).data.resolution).toBe("raw");
	// 90 days of raw readings is more than the point budget: it never changes by itself.
	await chooseDates("Last 90 days");
	await expect.element(raw).toBeChecked();
	await expect.element(raw).toHaveAccessibleDescription(m.get_data_resolution_too_many());
	const add = page.getByRole("button", { name: "Add to Home" });
	await expect.element(add).toBeDisabled();
	await expect.element(add).toHaveAccessibleDescription(m.get_data_resolution_blocked());
	// Choosing another level unblocks it.
	await page.getByRole("radio", { name: "Automatic" }).click();
	await expect.element(add).toBeEnabled();
	expect((await current()).data).not.toHaveProperty("resolution");
});

test("a stored level outside the levels (a quarter, untrusted) blocks Add with its own reason", async () => {
	const draft = monitorsDraft(["m1"]);
	(draft.data as { resolution?: string }).resolution = "quarter";
	const { current } = await show(draft);
	const add = page.getByRole("button", { name: "Add to Home" });
	await expect.element(add).toBeDisabled();
	await expect.element(add).toHaveAccessibleDescription(m.get_data_resolution_unknown_blocked());
	await page.getByRole("radio", { name: "Automatic" }).click();
	await expect.element(add).toBeEnabled();
	expect((await current()).data).not.toHaveProperty("resolution");
});

test("a draft carrying a dataset that doesn't line up (untrusted) blocks Add, naming it, until it's fixed", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.resolution = "day";
	draft.data.layers.push({ dataset: "pesticide-use", entryType: "pounds-applied" });
	const { current } = await show(draft);
	const daily = page.getByRole("radio", { name: "Daily" });
	await expect.element(daily).toBeChecked();
	await expect.element(daily).toHaveAccessibleDescription("Pesticide Use isn't reported daily");
	const add = page.getByRole("button", { name: "Add to Home" });
	await expect.element(add).toBeDisabled();
	await expect
		.element(add)
		.toHaveAccessibleDescription(
			"Pesticide Use doesn't line up with the data resolution. Remove it or choose another data resolution."
		);
	await page.getByRole("radio", { name: "Monthly" }).click();
	await expect.element(add).toBeEnabled();
	expect((await current()).data.resolution).toBe("month");
});

test("a mixed draft on Automatic blocks Add, naming the dataset the main layer can't line up with", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.layers.push(
		{ dataset: "hms-smoke", entryType: "smoke-density" },
		{ dataset: "pesticide-use", entryType: "pounds-applied" }
	);
	await show(draft);
	const add = page.getByRole("button", { name: "Add to Home" });
	await expect.element(add).toBeDisabled();
	await expect
		.element(add)
		.toHaveAccessibleDescription(
			"Pesticide Use doesn't line up with the data resolution. Remove it or choose another data resolution."
		);
	await openSection(/^Pesticide Use/);
	await page.getByRole("button", { name: /^Remove/ }).click();
	await expect.element(add).toBeEnabled();
});

test("at Daily, pesticide use is greyed: it's reported by month", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.resolution = "day";
	await show(draft);
	await openSection(/^Pesticide Use/);
	const addUse = page.getByRole("button", { name: m.get_data_pesticide_add_first() });
	await expect.element(addUse).toBeDisabled();
	await expect
		.element(addUse)
		.toHaveAccessibleDescription(
			"Reported by month. Set the data resolution to Monthly to add it."
		);
	await page.getByRole("radio", { name: "Monthly" }).click();
	await expect.element(addUse).toBeEnabled();
});

test("at Hourly, smoke and forecasts are greyed (reported by day); weather is not", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.resolution = "hour";
	await show(draft);
	await openSection(/^Wildfire Smoke/);
	const smoke = page.getByRole("checkbox", { name: "Smoke density" });
	await expect.element(smoke).toBeDisabled();
	await expect
		.element(smoke)
		.toHaveAccessibleDescription("Reported by day. Set the data resolution to Daily to add it.");
	await openSection(/^Weather/);
	await expect
		.element(page.getByRole("checkbox", { name: "Temperature", exact: true }))
		.toBeEnabled();
});

test("at Every measurement, weather is greyed: it has no individual measurements", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "trailing", amount: 2, unit: "day" };
	draft.data.resolution = "raw";
	await show(draft);
	await openSection(/^Weather/);
	const temperature = page.getByRole("checkbox", { name: "Temperature", exact: true });
	await expect.element(temperature).toBeDisabled();
	await expect
		.element(temperature)
		.toHaveAccessibleDescription(
			"Has no individual measurements. Set the data resolution to Hourly to add it."
		);
});

test("with weather chosen, Every measurement says weather has no individual measurements", async () => {
	const draft = withLayers(["m1"], TEMPERATURE);
	draft.data.dateRange = { kind: "trailing", amount: 2, unit: "day" };
	await show(draft);
	const raw = page.getByRole("radio", { name: m.get_data_resolution_raw() });
	await expect.element(raw).toBeDisabled();
	await expect.element(raw).toHaveAccessibleDescription("Weather has no individual measurements");
});

test("on Automatic, only a dataset sharing no level with those chosen is greyed", async () => {
	await show(monitorsDraft(["m1"]));
	await openSection(/^Wildfire Smoke/);
	const smoke = page.getByRole("checkbox", { name: "Smoke density" });
	await expect.element(smoke).toBeEnabled();
	await openSection(/^Pesticide Use/);
	const addUse = page.getByRole("button", { name: m.get_data_pesticide_add_first() });
	await expect.element(addUse).toBeEnabled();
	// Smoke is reported by day and pesticide use by month: once smoke is on, use can't line up.
	await smoke.click();
	await expect.element(addUse).toBeDisabled();
	await expect
		.element(addUse)
		.toHaveAccessibleDescription(
			"Can't line up with the datasets you chose: it's reported by month."
		);
	await expect.element(page.getByText(/line up with the datasets you chose/)).toBeVisible();
	await smoke.click();
	await expect.element(addUse).toBeEnabled();
});

test("Show as greys the Map at Hourly, and a calendar at Monthly", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.resolution = "hour";
	await show(draft);
	const map = page.getByRole("radio", { name: "Map" });
	await expect.element(map).toBeDisabled();
	await expect.element(map).toHaveAccessibleDescription(m.get_data_map_resolution());
	await page.getByRole("radio", { name: "Monthly" }).click();
	await expect.element(map).toBeEnabled();
	const calendar = page.getByRole("radio", { name: "Month calendar" });
	await expect.element(calendar).toBeDisabled();
	await expect
		.element(calendar)
		.toHaveAccessibleDescription("Month calendar can't show monthly data.");
});

test("at Monthly, a custom range is picked in whole months: the first and last days are stored", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "custom", start: "2026-03-10", end: "2026-04-20" };
	draft.data.resolution = "month";
	const { current } = await show(draft);
	const start = page.getByRole("group", { name: m.get_data_custom_start_month() });
	const end = page.getByRole("group", { name: m.get_data_custom_end_month() });
	await expect.element(start.getByRole("combobox", { name: "Month" })).toHaveValue("03");
	await expect.element(start.getByRole("spinbutton", { name: "Year" })).toHaveValue(2026);
	await expect.element(end.getByRole("combobox", { name: "Month" })).toHaveValue("04");
	expect(page.getByRole("textbox", { name: m.get_data_custom_start() }).query()).toBeNull();
	await start.getByRole("combobox", { name: "Month" }).selectOptions("01");
	await expect
		.poll(async () => (await current()).data.dateRange)
		.toEqual({ kind: "custom", start: "2026-01-01", end: "2026-04-30" });
	await end.getByRole("combobox", { name: "Month" }).selectOptions("02");
	await expect
		.poll(async () => (await current()).data.dateRange)
		.toEqual({ kind: "custom", start: "2026-01-01", end: "2026-02-28" });
	// An end before the start says so, and stores nothing.
	await start.getByRole("spinbutton", { name: "Year" }).fill("2027");
	await userEvent.keyboard("{Tab}");
	await expect.element(page.getByText(m.get_data_custom_order())).toBeVisible();
	expect((await current()).data.dateRange).toEqual({
		kind: "custom",
		start: "2026-01-01",
		end: "2026-02-28"
	});
});

test("at Yearly, a custom range is picked in whole years", async () => {
	const draft = monitorsDraft(["m1"]);
	draft.data.dateRange = { kind: "custom", start: "2022-03-10", end: "2024-04-20" };
	draft.data.resolution = "year";
	const { current } = await show(draft);
	const start = page.getByRole("spinbutton", { name: m.get_data_custom_start_year() });
	await expect.element(start).toHaveValue(2022);
	await start.fill("2021");
	await userEvent.keyboard("{Tab}");
	await expect
		.poll(async () => (await current()).data.dateRange)
		.toEqual({ kind: "custom", start: "2021-01-01", end: "2024-12-31" });
	// A year that isn't four digits says so (never dropped silently), and stores nothing.
	await start.fill("21");
	await userEvent.keyboard("{Tab}");
	await expect.element(page.getByText(m.get_data_custom_year_invalid())).toBeVisible();
	await expect.element(start).toHaveAccessibleDescription(m.get_data_custom_year_invalid());
	expect((await current()).data.dateRange).toEqual({
		kind: "custom",
		start: "2021-01-01",
		end: "2024-12-31"
	});
});

function withLayers(ids: string[], ...rest: Draft["data"]["layers"]): Draft {
	const draft = monitorsDraft(ids);
	draft.data.layers.push(...rest);
	return draft;
}

/** `areasDraft(codes)` with `rest` after its PM2.5 layer. */
function withAreaLayers(codes: string[], ...rest: Draft["data"]["layers"]): Draft {
	const draft = areasDraft(codes);
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
	const { current } = await show(areasDraft(["06019"]));
	await openSection(/^Weather/);
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).click();
	await page.getByRole("radio", { name: "None" }).click();
	expect((await current()).data.layers).toEqual([{ ...TEMPERATURE }]);
	expect((await current()).data.place).toEqual({ kind: "region", type: "county", code: "06019" });
	// The last number layer can be unchecked too: a widget may hold nothing.
	const box = page.getByRole("checkbox", { name: "Temperature", exact: true });
	await expect.element(box).toBeEnabled();
	await box.click();
	expect((await current()).data.layers).toEqual([]);
});

test("choosing None for Air Quality keeps the places", async () => {
	const { current } = await show(withAreaLayers(["a1", "a2"], { ...TEMPERATURE }));
	const where = { kind: "regions", ids: ["county:a1", "county:a2"] };
	await page.getByRole("radio", { name: "None" }).click();
	await expect.element(page.getByRole("radio", { name: "None" })).toBeChecked();
	// The Where names its own places, whatever the layers.
	await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area a1 and Area a2");
	expect((await current()).data.layers).toEqual([{ ...TEMPERATURE }]);
	expect((await current()).data.selection).toEqual(where);
	// Choosing a pollutant again makes it the main layer; Where stays.
	await page.getByRole("radio", { name: "Ozone" }).click();
	expect((await current()).data.layers).toEqual([
		{ dataset: "air-quality", entryType: "o3" },
		{ ...TEMPERATURE }
	]);
	expect((await current()).data.selection).toEqual(where);
});

test("choosing None keeps the searched monitors, with no pollutant (decision 31)", async () => {
	const { current } = await show(withLayers(["m1", "m2"], { ...TEMPERATURE }));
	await page.getByRole("radio", { name: "None" }).click();
	await expect.element(page.getByRole("radio", { name: "None" })).toBeChecked();
	expect((await current()).data.layers).toEqual([
		{ dataset: "air-quality", monitors: ["m1", "m2"] },
		{ ...TEMPERATURE }
	]);
	// Choosing a pollutant again gives the monitors back to it.
	await page.getByRole("radio", { name: "Ozone" }).click();
	expect((await current()).data.layers).toEqual([
		{ dataset: "air-quality", entryType: "o3", monitors: ["m1", "m2"] },
		{ ...TEMPERATURE }
	]);
});

test("the station choice shows only with one place", async () => {
	fake.stations = [
		{ id: "st1", name: "Fresno State", distance: 0, inside: true, active: true },
		{ id: "st2", name: "Parlier", distance: 4.2, inside: false, active: false }
	];
	const one = await show(withAreaLayers(["06019"], { ...TEMPERATURE }));
	await openSection(/^Weather/);
	const station = page.getByRole("combobox", { name: "Station" });
	await expect.element(station).toHaveValue("st1");
	expect(
		[...(station.element() as HTMLSelectElement).options].map((o) => o.textContent?.trim())
	).toEqual(["Fresno State", "Parlier (4.2 mi away), no recent data"]);
	await station.selectOptions("st2");
	expect((await one.current()).data.layers[1].station).toBe("st2");
	// The first (default) station stores nothing.
	await station.selectOptions("st1");
	expect((await one.current()).data.layers[1]).toEqual(TEMPERATURE);
	one.screen.unmount();
	one.host.remove();

	await show(withAreaLayers(["a1", "a2"], { ...TEMPERATURE }));
	await openSection(/^Weather/);
	await expect
		.element(page.getByRole("checkbox", { name: "Temperature", exact: true }))
		.toBeChecked();
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
	await page.getByRole("button", { name: "Filters" }).click();
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
	// The section's heading names the measure once.
	await expect
		.element(page.getByRole("button", { name: /^Pesticide Use/ }))
		.toHaveAccessibleName("Pesticide Use Pounds Applied");
	// At the overlay limit, no more can be added.
	const add = page.getByRole("button", { name: "Add another pesticide layer" });
	await expect.element(add).toBeDisabled();
	await expect.element(add).toHaveAccessibleDescription("Up to 2 overlays");
});

test("a slow search's results never replace a newer one's", async () => {
	let release!: () => void;
	const slow = new Promise<void>((r) => (release = r));
	fake.hits = {
		results: [{ id: "c1", name: "Chlorpyrifos", detail: "", placeholder: false }],
		more: false
	};
	await show(withLayers(["m1"], { ...POUNDS }));
	await openSection(/^Pesticide Use/);
	await page.getByRole("button", { name: "Filters" }).click();
	const chemical = page.getByRole("combobox", { name: "Chemical" });
	await chemical.click();
	// The first search ("ch") answers late, after "chx" found nothing.
	fake.delay = (q) => (q === "ch" ? slow : Promise.resolve());
	await userEvent.keyboard("ch");
	await expect.poll(() => fake.searches.length).toBe(1);
	fake.hits = { results: [], more: false };
	await userEvent.keyboard("x");
	await expect.poll(() => fake.searches.length).toBe(2);
	await expect.element(page.getByText(m.get_data_search_none()).first()).toBeVisible();
	release();
	await new Promise((r) => setTimeout(r, 50));
	expect(page.getByRole("option", { name: /Chlorpyrifos/ }).elements()).toHaveLength(0);
});

test("a long result list scrolls; its rows keep their full height and never overlap", async () => {
	fake.hits = {
		results: Array.from({ length: 25 }, (_, i) => ({
			id: `c${i}`,
			name:
				i === 3 ? "Benzyldiethyl [(2,6-xylylcarbamoyl)methyl] ammonium saccharide" : `Chem ${i}`,
			detail: `CDPR chem code ${i}`,
			placeholder: false
		})),
		more: true
	};
	await show(withLayers(["m1"], { ...POUNDS }));
	await openSection(/^Pesticide Use/);
	await page.getByRole("button", { name: "Filters" }).click();
	await page.getByRole("combobox", { name: "Chemical" }).click();
	await userEvent.keyboard("ch");
	await expect.element(page.getByRole("option", { name: /Chem 0/ })).toBeVisible();
	const rows = page
		.getByRole("option")
		.elements()
		.filter((el) => el.closest("[role=listbox]"));
	expect(rows).toHaveLength(25);
	for (const row of rows) expect(row.clientHeight).toBeGreaterThanOrEqual(row.scrollHeight);
	for (let i = 1; i < rows.length; i++) {
		const above = rows[i - 1].getBoundingClientRect();
		expect(rows[i].getBoundingClientRect().top).toBeGreaterThanOrEqual(above.bottom - 0.5);
	}
});

test("smoke alone disables Add with the reason", async () => {
	const draft: Draft = {
		type: "chart",
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			place: { kind: "region", type: "county", code: "06019" },
			layers: [
				{
					dataset: "hms-smoke",
					entryType: "smoke-density"
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
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).click();
	await expect.element(add).toBeEnabled();
});

describe.each([
	["desktop", 1280, 800],
	["phone", 390, 844]
])("with a pesticide layer's Filters open on a %s", (_name, width, height) => {
	test("axe passes", async () => {
		await page.viewport(width, height);
		fake.stations = [{ id: "st1", name: "Fresno State", distance: 0, inside: true, active: true }];
		const { host } = await show(withLayers(["m1"], { ...POUNDS, filters: { iarcGroup: "1" } }));
		await openSection(/^Pesticide Use/);
		await page.getByRole("button", { name: "Filters" }).click();
		await expect.element(page.getByRole("combobox", { name: "Cancer group" })).toHaveValue("1");
		await openSection(/^Weather/);
		await drawn(host);
		await animationsSettled(host);
		const results = await axe.run(host);
		expect(results.violations).toEqual([]);
	});
});

describe("now widgets", () => {
	const alert = () => page.getByRole("combobox", { name: "Alert level" });
	const currentDraft = (thresholds?: Draft["thresholds"]): Draft => ({
		type: "current-conditions",
		data: {
			layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
		},
		...(thresholds ? { thresholds } : {})
	});

	test("Show as Current conditions: no When, one place, the pollutant and alert level, a note", async () => {
		const { host, current } = await show(areasDraft(["a1", "a2", "a3"], {}, ["burn-status"]));
		await expect.element(page.getByRole("heading", { name: "When" })).toBeInTheDocument();
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();
		await expect.element(page.getByRole("heading", { name: "When" })).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: /^Dates/ })).not.toBeInTheDocument();
		await expect.element(page.getByText(m.get_data_dates_left_out())).toBeVisible();
		await expect.element(page.getByText(m.get_data_overlays_left_out())).toBeVisible();
		await expect.element(page.getByText(m.get_data_extra_places_left_out())).toBeVisible();
		// One place: the first.
		await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area a1");
		// The pollutants on offer (PM10 isn't available), and the alert level at its default.
		const pollutant = page.getByRole("group", { name: "Pollutant" });
		await expect.element(pollutant.getByRole("radio", { name: "PM2.5" })).toBeChecked();
		await expect.element(pollutant.getByRole("radio", { name: "Ozone" })).toBeVisible();
		await expect.element(pollutant.getByRole("radio", { name: "PM10" })).not.toBeInTheDocument();
		await expect.element(alert()).toHaveValue("unhealthy-sensitive");
		const options = [...(alert().element() as HTMLSelectElement).options].map((o) => o.text);
		expect(options).toEqual([
			"Off",
			"Tell me at Good or worse",
			"Tell me at Moderate or worse",
			"Tell me at Unhealthy for Sensitive Groups or worse",
			"Tell me at Unhealthy or worse"
		]);
		// The preview is the Current conditions tile.
		await expect
			.poll(() => host.querySelector("[data-testid=get-data-preview]")?.textContent ?? "", {
				timeout: 5000
			})
			.toContain("Area a1");
		expect(await current()).toEqual({
			type: "current-conditions",
			data: {
				place: { kind: "region", type: "county", code: "a1" },
				layers: [{ dataset: "air-quality", entryType: "pm25" }]
			},
			thresholds: [{ level: "unhealthy-sensitive" }]
		});
		// The next edit takes the note away; Off stores no alert level.
		await alert().selectOptions("Off");
		await expect.element(page.getByText(m.get_data_dates_left_out())).not.toBeInTheDocument();
		expect("thresholds" in (await current())).toBe(false);
	});

	test("Show as Map keeps the chart's places; its untouched 30 days become Now", async () => {
		const { current } = await show(areasDraft(["a1", "a2", "a3"]));
		await page.getByRole("radio", { name: "Map" }).click();
		await expect.element(page.getByRole("radio", { name: "Map" })).toBeChecked();
		await expect.element(page.getByText(m.get_data_dates_left_out())).not.toBeInTheDocument();
		await expect
			.element(page.getByText(m.get_data_extra_places_left_out()))
			.not.toBeInTheDocument();
		await expect.element(alert()).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("button", { name: /^Dates/ }))
			.toHaveTextContent(m.getdata_when_now());
		expect(await current()).toEqual({
			type: "map",
			data: {
				selection: { kind: "regions", ids: ["county:a1", "county:a2", "county:a3"] },
				layers: [
					{
						dataset: "air-quality",
						entryType: "pm25"
					}
				]
			}
		});
	});

	test("Show as Map keeps a range the person chose", async () => {
		const chart = monitorsDraft(["m1"]);
		chart.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
		const { current } = await show(chart);
		await page.getByRole("radio", { name: "Map" }).click();
		await expect.element(page.getByRole("radio", { name: "Map" })).toBeChecked();
		await expect
			.element(page.getByRole("button", { name: /^Dates/ }))
			.toHaveTextContent(m.getdata_preset_last_7_days());
		expect((await current()).data.dateRange).toEqual({ kind: "trailing", amount: 7, unit: "day" });
	});

	test("a Map's When offers Now and the date methods; Data resolution only with a range", async () => {
		const { current } = await show({
			type: "map",
			data: {
				layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
			}
		});
		const dates = page.getByRole("button", { name: /^Dates/ });
		await expect.element(dates).toHaveTextContent(m.getdata_when_now());
		await expect.element(page.getByTestId("resolved-range")).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("heading", { name: m.get_data_resolution(), exact: true }))
			.not.toBeInTheDocument();
		await dates.click();
		await expect
			.element(page.getByRole("option", { name: m.getdata_when_now(), exact: true }))
			.toHaveAttribute("aria-selected", "true");
		// Every date method: trailing, to-date, a specific period and a custom range.
		for (const name of [
			m.getdata_preset_last_7_days(),
			m.getdata_preset_this_month(),
			m.getdata_preset_specific_day(),
			m.getdata_preset_custom()
		]) {
			await expect.element(page.getByRole("option", { name, exact: true })).toBeVisible();
		}
		await page.getByRole("option", { name: "Last 7 days" }).click();
		await animationsSettled(document.body);
		await expect.element(dates).toHaveTextContent("Last 7 days");
		// With a range, the Map offers Daily, Monthly and Yearly only.
		await expect
			.element(page.getByRole("heading", { name: m.get_data_resolution(), exact: true }))
			.toBeVisible();
		const levels = page
			.getByRole("group", { name: m.get_data_resolution(), exact: true })
			.getByRole("radio")
			.elements()
			.map((el) => el.closest("label")?.textContent?.trim());
		expect(levels).toEqual(["Automatic", "Daily", "Monthly", "Yearly"]);
		expect((await current()).data.dateRange).toEqual({ kind: "trailing", amount: 7, unit: "day" });
		await chooseDates(m.getdata_when_now());
		await expect.element(dates).toHaveTextContent(m.getdata_when_now());
		expect("dateRange" in (await current()).data).toBe(false);
	});

	test("a Map greys pesticide use on Now, and smoke, fire and notices at Monthly", async () => {
		const { current } = await show({
			type: "map",
			data: {
				layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
			}
		});
		const use = page.getByRole("switch", { name: m.getdata_map_use_switch() });
		await expect.element(use).toBeDisabled();
		await expect
			.element(use)
			.toHaveAccessibleDescription(
				"Reported by month, so it isn't shown on Now. Choose dates to add it."
			);
		const smoke = page.getByRole("checkbox", { name: m.get_data_smoke_and_fire() });
		await expect.element(smoke).toBeEnabled();
		await chooseDates("Last 7 days");
		await expect.element(use).toBeEnabled();
		await page.getByRole("radio", { name: "Monthly" }).click();
		await expect.element(smoke).toBeDisabled();
		await expect
			.element(smoke)
			.toHaveAccessibleDescription("Reported by day. Set the data resolution to Daily to add it.");
		const notices = page.getByRole("switch", { name: m.getdata_map_notices_switch() });
		await expect.element(notices).toBeDisabled();
		await use.click();
		expect((await current()).data.layers.slice(1)).toEqual([{ dataset: "pesticide-use" }]);
	});

	test("a Map on Now carrying pesticide use (untrusted) blocks Add until dates are chosen", async () => {
		await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] },
					{ dataset: "pesticide-use" }
				]
			}
		});
		const add = page.getByRole("button", { name: "Add to Home" });
		await expect.element(add).toBeDisabled();
		await expect
			.element(add)
			.toHaveAccessibleDescription(
				"Pesticide Use isn't shown on Now. Choose dates, or turn it off."
			);
		await chooseDates("Last 7 days");
		await expect.element(add).toBeEnabled();
	});

	test("turns smoke and fire on and off together", async () => {
		const { current, host } = await show(monitorsDraft(["m1"], { type: "map" }));
		const smoke = page.getByRole("checkbox", { name: m.get_data_smoke_and_fire() });
		await expect.element(smoke).not.toBeChecked();
		await animationsSettled(host);
		const what = host.querySelector("[aria-labelledby$=-what]")!;
		expect((await axe.run(what)).violations).toEqual([]);
		await expect
			.element(page.getByRole("button", { name: m.get_data_map_smoke_help_label() }))
			.toBeVisible();
		await smoke.click();
		expect((await current()).data.layers.slice(1)).toEqual([
			{ dataset: "hms-smoke" },
			{ dataset: "hms-fire" }
		]);
		await smoke.click();
		expect((await current()).data.layers).toHaveLength(1);
	});

	test("the Spray notices section switches the layer on and shows its filters", async () => {
		const { current, host } = await show(monitorsDraft(["m1"], { type: "map" }));
		await expect
			.element(page.getByRole("heading", { name: "Pesticide Spray Notices" }))
			.toBeVisible();
		await expect.element(page.getByText("Notices of intent to spray.")).toBeVisible();
		const notices = page.getByRole("switch", { name: m.getdata_map_notices_switch() });
		await expect.element(notices).not.toBeChecked();
		await expect
			.element(page.getByRole("group", { name: m.getdata_map_pesticide_filters() }))
			.not.toBeInTheDocument();
		await notices.click();
		await expect.element(notices).toBeChecked();
		await expect
			.element(page.getByRole("group", { name: m.getdata_map_pesticide_filters() }))
			.toBeVisible();
		await animationsSettled(host);
		expect((await current()).data.layers.slice(1)).toEqual([{ dataset: "pesticide-notices" }]);
		await notices.click();
		expect((await current()).data.layers).toHaveLength(1);
	});

	test("the Spray notices section names a saved filter that doesn't apply to notices, and keeps it", async () => {
		const skipped = m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_crop() });
		const { current } = await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] },
					{ dataset: "pesticide-notices", filters: { chemical: "c1", commodity: "k1" } }
				]
			}
		});
		await expect.element(page.getByText(skipped)).toBeVisible();
		// Only the commodity: the chemical applies.
		expect(
			page
				.getByText(m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_chemical() }))
				.query()
		).toBeNull();
		// The filter is still shown and kept.
		await expect
			.element(page.getByRole("group", { name: m.getdata_map_pesticide_filters() }))
			.toBeVisible();
		expect((await current()).data.layers[1]).toEqual({
			dataset: "pesticide-notices",
			filters: { chemical: "c1", commodity: "k1" }
		});
		// With the switch off, the section says nothing about the filters.
		await page.getByRole("switch", { name: m.getdata_map_notices_switch() }).click();
		await expect.element(page.getByText(skipped)).not.toBeInTheDocument();
	});

	test("the Pesticide use section switches the layer on, with no period of its own (the Map's stops are)", async () => {
		const { current, host } = await show(monitorsDraft(["m1"], { type: "map" }));
		await expect.element(page.getByRole("heading", { name: "Pesticide Use" })).toBeVisible();
		const use = page.getByRole("switch", { name: m.getdata_map_use_switch() });
		await expect.element(use).not.toBeChecked();
		await use.click();
		await expect.element(use).toBeChecked();
		await animationsSettled(host);
		expect((await current()).data.layers.slice(1)).toEqual([{ dataset: "pesticide-use" }]);
		expect((await current()).options).toBeUndefined();
		expect(page.getByRole("combobox", { name: "Year" }).query()).toBeNull();
		expect(page.getByRole("combobox", { name: "Month" }).query()).toBeNull();
		expect((await axe.run(host.querySelector("[aria-labelledby$=-what]")!)).violations).toEqual([]);
		await use.click();
		expect((await current()).data.layers).toHaveLength(1);
		expect((await current()).options).toBeUndefined();
	});

	test("the Pesticide use switch says why it's off: the years couldn't load (Retry asks again), or none are listed", async () => {
		let fail = true;
		fake.pesticideMeta = async () => {
			if (fail) throw new Error("offline");
			return PESTICIDE_META;
		};
		const { current } = await show(monitorsDraft(["m1"], { type: "map" }));
		const use = page.getByRole("switch", { name: m.getdata_map_use_switch() });
		await expect.element(page.getByText(m.getdata_map_use_years_unavailable())).toBeVisible();
		await expect.element(use).toBeDisabled();
		await expect.element(use).toHaveAccessibleDescription(m.getdata_map_use_years_unavailable());
		fail = false;
		await page.getByRole("button", { name: m.get_data_retry() }).click();
		await expect.element(use).toBeEnabled();
		await expect
			.element(page.getByText(m.getdata_map_use_years_unavailable()))
			.not.toBeInTheDocument();
		await use.click();
		expect((await current()).data.layers.slice(1)).toEqual([{ dataset: "pesticide-use" }]);
	});

	test("with no years listed, the Pesticide use switch is off with a neutral note", async () => {
		fake.pesticideMeta = async () => ({ ...PESTICIDE_META, years: [] });
		await show(monitorsDraft(["m1"], { type: "map" }));
		const use = page.getByRole("switch", { name: m.getdata_map_use_switch() });
		await expect.element(page.getByText(m.getdata_map_use_no_years())).toBeVisible();
		await expect.element(use).toBeDisabled();
		expect(page.getByRole("button", { name: m.get_data_retry() }).query()).toBeNull();
	});

	test("one filter set shows once for both pesticide layers", async () => {
		const { latest } = await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] },
					{ dataset: "pesticide-notices", filters: { chemical: "c1", commodity: "k1" } },
					{ dataset: "pesticide-use", filters: { chemical: "c1", commodity: "k1" } }
				]
			}
		});
		// Notices (by day) and use (by month) never line up, and use isn't shown on Now: only a link
		// can carry both, and it can't be added as it is.
		await expect.element(page.getByRole("button", { name: "Add to Home" })).toBeDisabled();
		const group = page.getByRole("group", { name: m.getdata_map_pesticide_filters() });
		await expect.element(group).toBeVisible();
		expect(group.all()).toHaveLength(1);
		// The crop still doesn't apply to the notices.
		await expect
			.element(
				page.getByText(m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_crop() }))
			)
			.toBeVisible();
		// A change reaches both layers.
		await group.getByRole("checkbox", { name: /^Insecticides/ }).click();
		await expect
			.poll(async () =>
				latest()
					.data.layers.slice(1)
					.map((l) => l.filters)
			)
			.toEqual([
				{ chemical: "c1", commodity: "k1", category: ["insecticide"] },
				{ chemical: "c1", commodity: "k1", category: ["insecticide"] }
			]);
		// With notices off, the set stays for the use, and the notices line goes.
		await page.getByRole("switch", { name: m.getdata_map_notices_switch() }).click();
		await expect.element(group).toBeVisible();
		await expect
			.element(
				page.getByText(m.getdata_map_notices_filter_skipped({ filter: m.get_data_filter_crop() }))
			)
			.not.toBeInTheDocument();
		// Back on, the notices take the kept filters.
		await page.getByRole("switch", { name: m.getdata_map_notices_switch() }).click();
		expect(latest().data.layers.slice(1)).toEqual([
			{
				dataset: "pesticide-notices",
				filters: { chemical: "c1", commodity: "k1", category: ["insecticide"] }
			},
			{
				dataset: "pesticide-use",
				filters: { chemical: "c1", commodity: "k1", category: ["insecticide"] }
			}
		]);
		// With both off, there's no filter set.
		await page.getByRole("switch", { name: m.getdata_map_notices_switch() }).click();
		await page.getByRole("switch", { name: m.getdata_map_use_switch() }).click();
		await expect.element(group).not.toBeInTheDocument();
	});

	test("the sections show a fallback heading without a catalog entry", async () => {
		fake.metadata = fixtureMetadata({
			catalog: async () =>
				CATALOG.filter((c) => c.id !== "pesticide-notices" && c.id !== "pesticide-use")
		});
		await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] },
					{ dataset: "pesticide-notices" },
					{ dataset: "pesticide-use" }
				]
			}
		});
		await expect
			.element(
				page.getByRole("heading", { name: m.getdata_map_section_fallback({ section: "notices" }) })
			)
			.toBeVisible();
		await expect
			.element(
				page.getByRole("heading", { name: m.getdata_map_section_fallback({ section: "use" }) })
			)
			.toBeVisible();
		expect(page.getByRole("heading", { name: "pesticide-notices" }).query()).toBeNull();
		expect(page.getByRole("heading", { name: "pesticide-use" }).query()).toBeNull();
	});

	test("a Chart's smoke turns smoke and fire on; back to a Chart notes what's left out", async () => {
		const chart = monitorsDraft(["m1"]);
		chart.data.layers.push({ dataset: "hms-smoke", entryType: "smoke-density" });
		const { current } = await show(chart);
		await page.getByRole("radio", { name: "Map" }).click();
		await expect
			.element(page.getByRole("checkbox", { name: m.get_data_smoke_and_fire() }))
			.toBeChecked();
		await expect.element(page.getByText(m.get_data_overlays_left_out())).not.toBeInTheDocument();
		await page.getByRole("radio", { name: "Ozone" }).click();
		await page.getByRole("radio", { name: "Chart" }).click();
		await expect.element(page.getByRole("radio", { name: "Chart" })).toBeChecked();
		await expect.element(page.getByText(m.get_data_overlays_left_out())).toBeVisible();
		const out = await current();
		expect(out.type).toBe("chart");
		expect(out.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", monitors: ["m1"] }
		]);
		expect(out.data.place).toBeUndefined();
	});

	test("Show as Current conditions from a Map uses its pollutant and drops the marks", async () => {
		const { current } = await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "o3", monitors: ["m1"] },
					{ dataset: "hms-smoke" },
					{ dataset: "hms-fire" }
				]
			},
			options: { marks: ["m1"] }
		});
		await expect.element(page.getByRole("radio", { name: "Ozone" })).toBeChecked();
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(page.getByText(m.get_data_marks_left_out())).toBeVisible();
		await expect.element(page.getByText(m.get_data_overlays_left_out())).toBeVisible();
		const out = await current();
		expect(out.type).toBe("current-conditions");
		// The Map's one searched monitor is the tile's.
		expect(out.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", monitors: ["m1"] }
		]);
		expect(out.data.place).toBeUndefined();
		expect("options" in out).toBe(false);
	});

	test("a Map draft with marks, switched to Current conditions, notes the marks left out", async () => {
		await show({
			type: "map",
			data: {
				layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }],
				dateRange: { kind: "trailing", amount: 7, unit: "day" }
			},
			options: { marks: ["m1"] }
		});
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(page.getByText(m.get_data_marks_left_out())).toBeVisible();
	});

	test("a Map draft not yet in the Map's shape (a Chart's smoke layer), with several pollutants, can switch to Chart or Data table", async () => {
		// Holding the map's pollutant list back keeps the draft as the link gave it (with dates).
		let release!: (p: string[]) => void;
		fake.metadata = fixtureMetadata({
			catalog: async () => CATALOG,
			mapPollutants: () => new Promise<string[]>((r) => (release = r))
		});
		const { current } = await show({
			type: "map",
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] },
					{ dataset: "air-quality", entryType: "o3" },
					// A Chart's smoke layer (an entry type) isn't the Map's place-less smoke.
					{ dataset: "hms-smoke", entryType: "smoke-density" }
				],
				dateRange: { kind: "trailing", amount: 7, unit: "day" }
			}
		});
		await expect.element(page.getByRole("radio", { name: "Chart" })).toBeEnabled();
		await expect.element(page.getByRole("radio", { name: "Data table" })).toBeEnabled();
		await expect.poll(() => release).toBeTypeOf("function");
		release(["o3", "pm25"]);
		await page.getByRole("radio", { name: "Chart" }).click();
		expect((await current()).type).toBe("chart");
	});

	test("saves a Map edit as one undo step", async () => {
		const platform = createMemoryPlatform();
		const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
		const widget: WidgetInstance = {
			id: "w1",
			type: "map",
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
			},
			options: { marks: ["m1"] }
		};
		const doc: Dashboard = { ...makeDoc("d1"), body: { widgets: [widget] } };
		await platform.documents.commit("anonymous", {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
		const session = (await app.sessions.get("d1"))!;
		const host = document.createElement("div");
		host.dataset.getDataHost = "";
		document.body.appendChild(host);
		render(GetDataView, {
			target: host,
			props: {
				mode: { kind: "edit", dashboardId: "d1", widgetId: "w1" },
				initial: editDraft(widget),
				onSave: (draft: Draft) => saveEdit(session, "w1", draft),
				onCancel: () => {}
			},
			context: new Map([[APP_CONTEXT_KEY, app]])
		});
		await page.getByRole("radio", { name: "Ozone" }).click();
		await page.getByRole("checkbox", { name: m.get_data_smoke_and_fire() }).click();
		await page.getByRole("button", { name: "Save changes" }).click();
		const saved = session.doc.body.widgets[0];
		expect(saved.data.layers.map((l) => l.entryType ?? l.dataset)).toEqual([
			"o3",
			"hms-smoke",
			"hms-fire"
		]);
		expect(saved.options).toEqual({ marks: ["m1"] });
		session.undo();
		expect(session.doc.body.widgets[0].data).toEqual(widget.data);
		expect(session.canUndo).toBe(false);
	});

	describe("Fill regions by", () => {
		const type = (t: string, label: string, plural: string) => ({
			type: t,
			label,
			plural,
			count: 5,
			parents: []
		});
		const fillGroup = () => page.getByRole("group", { name: m.getdata_map_fill() });

		test("lists None and the directory's types the Map draws, None chosen; choosing saves the fill, None removes it", async () => {
			fake.regionTypes = async () => [
				type("county", "County", "Counties"),
				type("land_use", "Land use", "Land uses"),
				type("zipcode", "ZIP code", "ZIP codes")
			];
			const { current } = await show(monitorsDraft(["m1"], { type: "map" }));
			const none = fillGroup().getByRole("radio", { name: m.getdata_map_fill_none() });
			await expect.element(none).toBeChecked();
			await expect.element(fillGroup().getByRole("radio", { name: "Counties" })).toBeVisible();
			// Land use is browsable, but the bulk summaries don't take it: the Map can't fill by it.
			await expect
				.element(fillGroup().getByRole("radio", { name: "Land uses" }))
				.not.toBeInTheDocument();
			expect(fillGroup().getByRole("radio").elements()).toHaveLength(3);
			await fillGroup().getByRole("radio", { name: "ZIP codes" }).click();
			expect((await current()).options).toEqual({ fill: "zipcode" });
			await none.click();
			expect((await current()).options).toBeUndefined();
		});

		test("a saved fill is checked, and converting to a Chart drops it with a note", async () => {
			fake.regionTypes = async () => [type("zipcode", "ZIP code", "ZIP codes")];
			const { current } = await show(
				monitorsDraft(["m1"], { type: "map", options: { fill: "zipcode" } })
			);
			await expect.element(fillGroup().getByRole("radio", { name: "ZIP codes" })).toBeChecked();
			await page.getByRole("radio", { name: "Chart" }).click();
			await expect.element(page.getByText(m.getdata_note_fill_dropped())).toBeVisible();
			expect((await current()).options).toBeUndefined();
			await page.getByRole("radio", { name: "Map" }).click();
			await expect
				.element(fillGroup().getByRole("radio", { name: m.getdata_map_fill_none() }))
				.toBeChecked();
		});

		test("a saved fill survives the directory failing; only None shows", async () => {
			fake.regionTypes = async () => {
				throw new Error("offline");
			};
			const { current } = await show(
				monitorsDraft(["m1"], { type: "map", options: { fill: "zipcode" } })
			);
			await expect
				.element(fillGroup().getByRole("radio", { name: m.getdata_map_fill_none() }))
				.toBeVisible();
			expect(fillGroup().getByRole("radio").elements()).toHaveLength(1);
			expect((await current()).options).toEqual({ fill: "zipcode" });
		});
	});

	test("a Map link with 30 places opens cut to 25, and says so", async () => {
		const codes = Array.from({ length: 30 }, (_, i) => `a${i + 1}`);
		const { current } = await show(areasDraft(codes, { type: "map" }));
		await expect
			.element(page.getByText(m.get_data_places_over_cap_left_out({ count: 25, countValue: 25 })))
			.toBeVisible();
		expect((await current()).data.selection).toEqual({
			kind: "regions",
			ids: codes.slice(0, 25).map((code) => `county:${code}`)
		});
	});

	test("a Map preview raises no unhandled errors", async () => {
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
		const onRejection = (e: PromiseRejectionEvent) => errors.push(e.reason);
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		try {
			const { host } = await show(monitorsDraft(["m1"], { type: "map" }));
			await expect
				.poll(() => host.querySelector("[data-testid=get-data-preview]"), { timeout: 5000 })
				.not.toBeNull();
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(errors).toEqual([]);
		} finally {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		}
	});

	test("Outside has the alert level but no pollutant control; the Forecast strip has neither", async () => {
		const { current } = await show(areasDraft(["a1"]));
		await page.getByRole("radio", { name: "Can we go outside?" }).click();
		await expect.element(alert()).toHaveValue("unhealthy-sensitive");
		// Not a downloadable type.
		await expect
			.element(page.getByRole("button", { name: "Download CSV" }))
			.not.toBeInTheDocument();
		await expect.element(page.getByRole("group", { name: "Pollutant" })).not.toBeInTheDocument();
		// A one-place draft over dates still says the dates were left out.
		await expect.element(page.getByText(m.get_data_dates_left_out())).toBeVisible();
		await expect
			.element(page.getByText(m.get_data_extra_places_left_out()))
			.not.toBeInTheDocument();
		await page.getByRole("radio", { name: "Forecast" }).click();
		await expect.element(page.getByRole("radio", { name: "Forecast" })).toBeChecked();
		await expect.element(alert()).not.toBeInTheDocument();
		await expect.element(page.getByRole("group", { name: "Pollutant" })).not.toBeInTheDocument();
		// The place is still named (through a PM2.5 query of it).
		await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area a1");
		expect(await current()).toEqual({
			type: "forecast-strip",
			data: {
				place: { kind: "region", type: "county", code: "a1" },
				layers: [{ dataset: "forecasts" }]
			}
		});
		// Back to a Chart: the default range.
		await page.getByRole("radio", { name: "Chart" }).click();
		await expect
			.element(page.getByRole("button", { name: /^Dates/ }))
			.toHaveTextContent("Last 30 days");
		expect((await current()).data).toEqual({
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			place: { kind: "region", type: "county", code: "a1" },
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
	});

	test("a pollutant change keeps the alert level its scale has, else its default", async () => {
		const pm25 = await fixtureMetadata().levels("pm25");
		const level = (key: string) => pm25.find((l) => l.key === key)!;
		const o3: Level[] = [
			level("good"),
			{ ...level("unhealthy-sensitive"), key: "usg-o3" },
			{ ...level("unhealthy"), key: "unhealthy-o3" }
		];
		fake.metadata = fixtureMetadata({
			catalog: async () => CATALOG,
			levels: async (e) => (e === "o3" ? o3 : e === "pm25" ? pm25 : [])
		});
		makeClient();
		const { current } = await show(currentDraft([{ level: "unhealthy" }]));
		await expect.element(alert()).toHaveValue("unhealthy");
		await page.getByRole("radio", { name: "Ozone" }).click();
		// "unhealthy" isn't on the ozone scale: its default, with no note (the person chose).
		await expect.element(alert()).toHaveValue("usg-o3");
		await expect.element(page.getByText(/isn't on this pollutant's scale/)).not.toBeInTheDocument();
		await alert().selectOptions("good");
		await page.getByRole("radio", { name: "PM2.5" }).click();
		await expect.element(alert()).toHaveValue("good");
		expect((await current()).thresholds).toEqual([{ level: "good" }]);
	});

	test("the preview shows the tile's mark when the air is already at the level, and tells nothing", async () => {
		const { host } = await show(currentDraft([{ level: "good" }]));
		const preview = () => host.querySelector<HTMLElement>("[data-testid=get-data-preview]")!;
		// The fake's reading is Good: at the alert level.
		await expect
			.poll(() => preview().querySelector("[data-mark]") !== null, { timeout: 5000 })
			.toBe(true);
		await expect
			.element(page.getByTestId("get-data-preview").getByText(m.current_alert_level_reached()))
			.toBeVisible();
		// No watcher: nothing in the dashboard's marks.
		expect(Object.keys(thresholdMarks)).toEqual([]);
		// Above the reading: no mark.
		await alert().selectOptions("unhealthy");
		await expect.poll(() => preview().querySelector("[data-mark]")).toBeNull();
	});

	test("a Chart's low line carried to a tile as its alert level is named", async () => {
		const { current } = await show(monitorsDraft(["m1"], { thresholds: [{ level: "good" }] }));
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(alert()).toHaveValue("good");
		const note = m.get_data_alert_level_from_low_line({ level: "Good" });
		expect(note).toBe(
			"The chart's line was at Good, so the alert level starts there. At that level you'd be told even when the air is fine for most people. You can change it under Alert level."
		);
		await expect.element(page.getByText(note)).toBeVisible();
		expect((await current()).thresholds).toEqual([{ level: "good" }]);
	});

	test("a saved level the scale no longer has shows its default, and says so", async () => {
		await show(currentDraft([{ level: "gone" }]));
		await expect.element(alert()).toHaveValue("unhealthy-sensitive");
		await expect
			.element(
				page.getByText(m.get_data_alert_level_replaced({ level: "Unhealthy for Sensitive Groups" }))
			)
			.toBeVisible();
		// Opening a saved now widget converts nothing.
		await expect.element(page.getByText(m.get_data_dates_left_out())).not.toBeInTheDocument();
	});

	test("a Current conditions link opens a range draft converted", async () => {
		await show({ ...areasDraft(["a1", "a2"]), type: "current-conditions" });
		await expect.element(page.getByText(m.get_data_dates_left_out())).toBeVisible();
		await expect.element(page.getByText(m.get_data_extra_places_left_out())).toBeVisible();
		await expect.element(page.getByTestId("where-summary")).toHaveTextContent("Area a1");
		await expect.element(alert()).toHaveValue("unhealthy-sensitive");
	});

	test("an Off alert level stays Off from Can we go outside? to Current conditions", async () => {
		const { current } = await show({ ...currentDraft(), type: "outside" });
		await expect.element(alert()).toHaveValue("");
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(page.getByRole("radio", { name: "Current conditions" })).toBeChecked();
		await expect.element(alert()).toHaveValue("");
		expect("thresholds" in (await current())).toBe(false);
	});

	test("what a conversion changes is said: the pollutant, then the alert level", async () => {
		const ozone: Draft = {
			type: "current-conditions",
			data: {
				layers: [{ dataset: "air-quality", entryType: "o3", monitors: ["m1"] }]
			}
		};
		await show(ozone);
		await page.getByRole("radio", { name: "Can we go outside?" }).click();
		const instead = m.get_data_pollutant_instead({ pollutant: "PM2.5", previous: "Ozone" });
		expect(instead).toBe("This widget shows only PM2.5, so it uses that instead of Ozone.");
		await expect.element(page.getByText(instead)).toBeVisible();
		await expect.element(alert()).toHaveValue("");
		await alert().selectOptions("unhealthy");
		await expect.element(page.getByText(instead)).not.toBeInTheDocument();
		await page.getByRole("radio", { name: "Forecast" }).click();
		await expect.element(page.getByText(m.get_data_level_left_out())).toBeVisible();
		await page.getByRole("radio", { name: "Chart" }).click();
		await expect.element(page.getByText(m.get_data_level_left_out())).not.toBeInTheDocument();
	});

	test("a scale that can't load keeps the alert level, says so, and Retry loads it", async () => {
		let failing = true;
		const pm25 = await fixtureMetadata().levels("pm25");
		fake.metadata = fixtureMetadata({
			catalog: async () => CATALOG,
			levels: async (e) => {
				if (failing) throw new Error("offline");
				return e === "pm25" ? pm25 : [];
			}
		});
		makeClient();
		const { current } = await show(monitorsDraft(["m1"]));
		await page.getByRole("radio", { name: "Current conditions" }).click();
		await expect.element(page.getByText(m.get_data_levels_unavailable())).toBeVisible();
		await expect.element(alert()).not.toBeInTheDocument();
		failing = false;
		await page.getByRole("button", { name: m.get_data_retry() }).click();
		// The default the conversion owed is set once the scale loads.
		await expect.element(alert()).toHaveValue("unhealthy-sensitive");
		expect((await current()).thresholds).toEqual([{ level: "unhealthy-sensitive" }]);

		// A pollutant change whose scale can't load keeps the alert level as it is.
		await alert().selectOptions("unhealthy");
		failing = true;
		await page.getByRole("radio", { name: "Ozone" }).click();
		await expect.element(page.getByText(m.get_data_levels_unavailable())).toBeVisible();
		const kept = await current();
		expect(kept.data.layers[0].entryType).toBe("o3");
		expect(kept.thresholds).toEqual([{ level: "unhealthy" }]);
	});

	test("axe passes", async () => {
		const { host } = await show(currentDraft([{ level: "gone" }]));
		await expect.element(alert()).toBeVisible();
		await animationsSettled(host);
		const results = await axe.run(host);
		expect(results.violations).toEqual([]);
	});
});

test("a Chart's Threshold line defaults to Off and saves the chosen level", async () => {
	const { host, current } = await show(monitorsDraft(["m1"]));
	await page.getByRole("button", { name: "More options" }).click();
	const select = page.getByRole("combobox", { name: m.get_data_line_at_level() });
	await expect.element(select).toBeVisible();
	await expect.element(select).toHaveValue("");
	expect(await current()).not.toHaveProperty("thresholds");
	await select.selectOptions("unhealthy-sensitive");
	expect((await current()).thresholds).toEqual([{ level: "unhealthy-sensitive" }]);
	await select.selectOptions("");
	expect(await current()).not.toHaveProperty("thresholds");
	host.remove();
});

test("a saved level the scale lacks shows Off and says so", async () => {
	const { host } = await show(monitorsDraft(["m1"], { thresholds: [{ level: "gone" }] }));
	await page.getByRole("button", { name: "More options" }).click();
	const select = page.getByRole("combobox", { name: m.get_data_line_at_level() });
	await expect.element(select).toHaveValue("");
	await expect.element(page.getByText(m.chart_level_line_missing()).first()).toBeVisible();
	host.remove();
});

test("Threshold line: Chart → Data table drops it with a note, and it isn't added", async () => {
	const { host, current } = await show(
		monitorsDraft(["m1"], { thresholds: [{ level: "unhealthy-sensitive" }] })
	);
	await page.getByRole("radio", { name: "Data table" }).click();
	await expect.element(page.getByRole("radio", { name: "Data table" })).toBeChecked();
	await expect.element(page.getByText(m.get_data_level_left_out())).toBeVisible();
	const added = await current();
	expect(added.type).toBe("data-table");
	expect(added).not.toHaveProperty("thresholds");
	host.remove();
});

test("Threshold line: Chart → Data table → Current conditions gets the default, not the stale key", async () => {
	const { host, current } = await show(monitorsDraft(["m1"], { thresholds: [{ level: "gone" }] }));
	await page.getByRole("radio", { name: "Data table" }).click();
	await page.getByRole("radio", { name: "Current conditions" }).click();
	await expect
		.element(page.getByRole("combobox", { name: "Alert level" }))
		.toHaveValue("unhealthy-sensitive");
	expect((await current()).thresholds).toEqual([{ level: "unhealthy-sensitive" }]);
	host.remove();
});

test("Threshold line: Chart → Current conditions carries the line's level", async () => {
	const { host } = await show(monitorsDraft(["m1"], { thresholds: [{ level: "unhealthy" }] }));
	await page.getByRole("radio", { name: "Current conditions" }).click();
	await expect
		.element(page.getByRole("combobox", { name: "Alert level" }))
		.toHaveValue("unhealthy");
	host.remove();
});

test("Threshold line is hidden for a non-pollutant main layer, and the saved one is dropped", async () => {
	const { host, current } = await show(
		monitorsDraft(["m1"], { thresholds: [{ level: "unhealthy-sensitive" }] })
	);
	await openSection(/^Weather/);
	await page.getByRole("checkbox", { name: "Temperature", exact: true }).click();
	await page.getByRole("radio", { name: "None" }).click();
	// More options holds only the line, so it goes with it.
	await expect.element(page.getByRole("button", { name: "More options" })).not.toBeInTheDocument();
	await expect
		.element(page.getByRole("combobox", { name: m.get_data_line_at_level() }))
		.not.toBeInTheDocument();
	expect(await current()).not.toHaveProperty("thresholds");
	host.remove();
});

describe("calendar types", () => {
	test("a calendar's level control says it marks days, and its missing-level hint to choose another", async () => {
		const { host } = await show({
			...monthDraft(),
			thresholds: [{ level: "gone" }]
		});
		await expect
			.element(page.getByRole("combobox", { name: m.get_data_mark_days_at_level() }))
			.toHaveValue("");
		expect(
			page.getByRole("combobox", { name: m.get_data_line_at_level() }).elements()
		).toHaveLength(0);
		await expect
			.element(page.getByText(m.get_data_mark_days_level_missing_choose_another()).first())
			.toBeVisible();
		host.remove();
	});

	const monthDraft = (): Draft => ({
		type: "calendar-month",
		data: {
			dateRange: { kind: "to-date", unit: "month" },
			timeSubRange: { start: "2026-11-02", end: "2026-11-03" },
			layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
		}
	});

	test("greyed out with its reason when the data has two places", async () => {
		await show(areasDraft(["a1", "a2"]));
		await expect.element(page.getByRole("radio", { name: "Month calendar" })).toBeDisabled();
		await expect.element(page.getByText(/Month calendar:/).first()).toBeInTheDocument();
	});

	test("leaving a calendar drops its day selection and says so", async () => {
		const { current } = await show(monthDraft());
		await page.getByRole("radio", { name: "Chart" }).click();
		await expect
			.element(
				page.getByText(
					m.get_data_selection_left_out({ days: formatDateRange("2026-11-02", "2026-11-03") })
				)
			)
			.toBeVisible();
		expect("timeSubRange" in (await current()).data).toBe(false);
	});

	const daysAgo = (n: number) => {
		const d = new Date(Date.now() - n * DAY);
		return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
	};
	const rangedMonth = (start: string, end: string): Draft => ({
		...monthDraft(),
		data: {
			...monthDraft().data,
			dateRange: { kind: "trailing", amount: 90, unit: "day" },
			timeSubRange: { start, end }
		}
	});

	test("Chart to month calendar: the default range changes and the line is kept both ways", async () => {
		const line = [{ level: "unhealthy-sensitive" }];
		const base = monitorsDraft(["m1"], { thresholds: line });
		const { current } = await show({
			...base,
			data: { ...base.data, dateRange: DEFAULT_RANGE }
		});
		await page.getByRole("radio", { name: "Month calendar" }).click();
		let now = await current();
		expect(now.type).toBe("calendar-month");
		expect(now.data.dateRange).toEqual({ kind: "to-date", unit: "month" });
		expect(now.thresholds).toEqual(line);
		await page.getByRole("radio", { name: "Chart" }).click();
		now = await current();
		expect(now.type).toBe("chart");
		expect(now.data.dateRange).toEqual(DEFAULT_RANGE);
		expect(now.thresholds).toEqual(line);
	});

	test("Chart to month calendar keeps a chosen range that the span allows", async () => {
		const own = { kind: "trailing", amount: 20, unit: "day" } as const;
		const base = monitorsDraft(["m1"]);
		const { current } = await show({ ...base, data: { ...base.data, dateRange: own } });
		await page.getByRole("radio", { name: "Month calendar" }).click();
		expect((await current()).data.dateRange).toEqual(own);
	});

	test("a When edit that leaves the selection outside the range drops it with a note", async () => {
		const { current } = await show(rangedMonth(daysAgo(60), daysAgo(59)));
		await chooseDates("Last 7 days");
		await expect
			.element(
				page.getByText(
					m.get_data_selection_outside_range({
						days: formatDateRange(daysAgo(60), daysAgo(59))
					})
				)
			)
			.toBeVisible();
		expect("timeSubRange" in (await current()).data).toBe(false);
	});

	test("a When edit that still holds the selection keeps it", async () => {
		const { current } = await show(rangedMonth(daysAgo(2), daysAgo(1)));
		await chooseDates("Last 90 days");
		expect((await current()).data.timeSubRange).toEqual({ start: daysAgo(2), end: daysAgo(1) });
	});
});
