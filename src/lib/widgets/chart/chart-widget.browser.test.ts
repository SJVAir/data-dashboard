import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { AdapterRequest } from "$lib/data/adapters/registry";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { generatedTitle } from "../titles.svelte";
import ChartWidget from "./ChartWidget.svelte";
import { chartWidget, fakeAdapter } from "./test-harness/fake-data";

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
