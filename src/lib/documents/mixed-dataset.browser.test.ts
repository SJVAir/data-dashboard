import "../../app.css";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest } from "$lib/data/adapters/registry";
import { mapDatasetCatalog, type MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { PESTICIDE_USE_DATASET, SDK_DATASET_CATALOG } from "$lib/data/testing/dataset-catalog";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import ChartWidget from "../widgets/chart/ChartWidget.svelte";
import { fakeAdapter, fakeNumberAdapter } from "../widgets/shared/test-harness/fake-data";
import { loadDashboard } from "./load";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

const CATALOG = [
	...FIXTURE_CATALOG,
	...mapDatasetCatalog({
		datasets: [
			...SDK_DATASET_CATALOG.datasets.filter((d) => d.id === "hms-smoke"),
			PESTICIDE_USE_DATASET
		]
	} as Parameters<typeof mapDatasetCatalog>[0]).map((d) => ({ ...d, geographies: ["monitor"] }))
];

/** What a share link or an import carries: a Chart (the Map half is in map-widget.browser.test.ts) that mixes datasets that don't line up. */
const RAW = JSON.stringify({
	kind: "dashboard",
	schemaVersion: CURRENT_SCHEMA_VERSION,
	id: "shared",
	name: null,
	version: 0,
	createdAt: "2026-10-20T00:00:00Z",
	updatedAt: "2026-10-20T00:00:00Z",
	body: {
		widgets: [
			{
				id: "chart",
				type: "chart",
				title: null,
				rect: { x: 0, y: 0, w: 3, h: 6 },
				data: {
					dateRange: { kind: "trailing", amount: 7, unit: "day" },
					resolution: "hour",
					layers: [
						{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m1" } },
						{ dataset: "hms-smoke", entryType: "smoke-density" },
						{ dataset: "pesticide-use", entryType: "pounds-applied" }
					]
				}
			},
			{
				id: "map",
				type: "map",
				title: null,
				rect: { x: 3, y: 0, w: 6, h: 6 },
				data: {
					dateRange: { kind: "custom", start: "2023-06-01", end: "2023-06-30" },
					resolution: "day",
					layers: [
						{
							dataset: "air-quality",
							entryType: "pm25",
							place: { kind: "region", type: "county", code: "019" }
						},
						{ dataset: "pesticide-use", entryType: "pounds-applied" }
					]
				}
			}
		]
	}
});

let requests: AdapterRequest[];
let frame: HTMLDivElement;

beforeEach(async () => {
	await page.viewport(1280, 800);
	requests = [];
	fake.metadata = fixtureMetadata({ catalog: async () => CATALOG });
	fake.client = createQueryClient({
		adapters: [
			fakeAdapter(requests),
			fakeNumberAdapter("pesticide-use", requests, { offered: ["month", "year"], values: [1200] })
		],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	frame = document.createElement("div");
	frame.style.width = "640px";
	frame.style.height = "480px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function open() {
	const loaded = loadDashboard(JSON.parse(RAW));
	if (loaded.status !== "ok") throw new Error("the mixed document should open");
	return loaded.doc;
}

test("a mixed document opens, and its stored form isn't rewritten", () => {
	const raw = JSON.parse(RAW);
	const doc = open();
	expect(doc.body.widgets).toHaveLength(2);
	expect(JSON.stringify(doc)).toBe(RAW);
	expect(JSON.stringify(raw)).toBe(RAW);
});

test("the Chart at Hourly draws its main layer and says smoke and use don't line up", async () => {
	const widget = open().body.widgets[0];
	const errors = vi.spyOn(console, "error");
	onTestFinished(() => errors.mockRestore());
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	const screen = await render(ChartWidget, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
	const note = (dataset: string) => m.widget_layer_not_lined_up({ dataset, level: "hourly" });
	await expect.element(screen.getByText(note("Pesticide Use"), { exact: true })).toBeVisible();
	const smoke = CATALOG.find((c) => c.id === "hms-smoke")!.label;
	await expect.element(screen.getByText(note(smoke), { exact: true })).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	// Only the main layer was asked for, at the widget's resolution.
	expect(requests.length).toBeGreaterThan(0);
	expect(requests.every((r) => r.entryType === "pm25" && r.resolution === "hour")).toBe(true);
	expect(errors).not.toHaveBeenCalled();
	expect(JSON.stringify(widget)).toBe(JSON.stringify(open().body.widgets[0]));
});
