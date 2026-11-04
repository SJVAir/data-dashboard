import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { DatasetAdapter, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { AdapterRequest } from "$lib/data/adapters/registry";
import type { QueryData } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { generatedTitle } from "../titles.svelte";
import ChartWidget from "./ChartWidget.svelte";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

const DAY = 86_400_000;
let requests: AdapterRequest[];
let frame: HTMLDivElement;

/** Three daily points per requested monitor, named "Monitor <id>". */
const adapter: DatasetAdapter = {
	id: "air-quality",
	async target(layer) {
		if (layer.selection) return { kind: "monitors", ids: [...layer.selection.ids] };
		if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
		return { unavailable: "place-unsupported" };
	},
	offered: (base) => base,
	async fetch(req): Promise<QueryData> {
		requests.push(req);
		const ids = req.target.kind === "monitors" ? req.target.ids : [];
		const start = req.range.start.getTime();
		return {
			series: ids.map((id, n) => ({
				place: `monitor:${id}`,
				points: [0, 1, 2].map((i) => ({
					t: start + i * DAY,
					mean: 5 + i + n,
					min: 5 + i + n,
					max: 5 + i + n,
					count: 24,
					partial: false
				}))
			})),
			places: ids.map((id) => ({ place: `monitor:${id}`, name: `Monitor ${id}` })),
			resolution: req.resolution,
			fromRaw: false,
			processor: null,
			fetchedAt: Date.now()
		};
	}
};

beforeEach(async () => {
	await page.viewport(1280, 800);
	requests = [];
	fake.metadata = fixtureMetadata();
	const regions: RegionResolver = { resolve: async () => "unsupported" };
	fake.client = createQueryClient({ adapters: [adapter], metadata: fake.metadata, regions });
	frame = document.createElement("div");
	frame.style.width = "640px";
	frame.style.height = "480px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function chartWidget(ids: string[], extra: Partial<WidgetInstance> = {}): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 4 },
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				ids.length === 1
					? { dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: ids[0] } }
					: { dataset: "air-quality", entryType: "pm25", selection: { kind: "monitors", ids } }
			]
		},
		...extra
	};
}

async function show(widget: WidgetInstance) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(ChartWidget, {
		target: frame,
		props: { widget },
		context: new Map([[APP_CONTEXT_KEY, app]])
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
				...adapter,
				fetch: async (req) => ({ ...(await adapter.fetch(req, null!, null!)), series: [] })
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const screen = await show(chartWidget(["m1"]));
	await expect.element(screen.getByText(m.widget_state_empty())).toBeVisible();
	expect(frame.querySelector("[role=group]")).toBeNull();
});
