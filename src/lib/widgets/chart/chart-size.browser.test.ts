import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { mapDatasetCatalog } from "$lib/data/metadata";
import { PESTICIDE_USE_DATASET, WEATHER_DATASET } from "$lib/data/testing/dataset-catalog";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import Harness from "$lib/components/dashboard/test-harness/Harness.svelte";
import { chartType } from "./index";
import {
	PM25_LEVELS,
	chartWidget,
	fakeAdapter,
	fakeNumberAdapter
} from "../shared/test-harness/fake-data";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

beforeEach(async () => {
	await page.viewport(1280, 800);
	const requests: AdapterRequest[] = [];
	fake.metadata = fixtureMetadata({ levels: async () => PM25_LEVELS });
	fake.client = createQueryClient({
		adapters: [fakeAdapter(requests)],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
});

afterEach(() => toast.dismiss());

/** A dashboard holding `widget` alone, rendered in the grid. */
async function showInDashboard(widget: WidgetInstance) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [widget] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	return render(Harness, { context: new Map([[APP_CONTEXT_KEY, app]]) });
}

/** The plot's canvas height in CSS pixels, once the chart has drawn at its settled size. */
async function plotHeight(): Promise<number> {
	await expect.poll(() => document.querySelector("[role=group] canvas")).not.toBeNull();
	const canvas = document.querySelector<HTMLCanvasElement>("[role=group] canvas")!;
	// uPlot's canvas fills the plot area; wait until it matches the area's final size.
	const area = canvas.closest<HTMLElement>("[role=group] > .relative")!;
	await expect
		.poll(() => Math.round(canvas.getBoundingClientRect().height), { interval: 100 })
		.toBe(area.clientHeight);
	return canvas.getBoundingClientRect().height;
}

const rect = { x: 0, y: 0, ...chartType.defaultSize };

test("the default size leaves a usable plot under the six-level key", async () => {
	expect(chartType.defaultSize).toEqual({ w: 3, h: 6 });
	const screen = await showInDashboard(chartWidget(["m1"], {}, rect));
	const key = screen.getByRole("list", { name: m.chart_level_key() });
	await expect.element(key).toBeVisible();
	// Every level, with its full name.
	for (const level of PM25_LEVELS) {
		await expect.element(key.getByText(level.label, { exact: true })).toBeVisible();
	}
	const height = await plotHeight();
	console.log(`plot height, default size, no note: ${height}px`);
	expect(height).toBeGreaterThanOrEqual(120);
});

test("with the hidden-places note the plot stays usable", async () => {
	const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	const screen = await showInDashboard(chartWidget(ids, {}, rect));
	await expect.element(screen.getByText("2 more places aren't shown.")).toBeVisible();
	const height = await plotHeight();
	console.log(`plot height, default size, with note: ${height}px`);
	expect(height).toBeGreaterThanOrEqual(80);
});

test("the minimum size still leaves a usable plot, even with the note", async () => {
	const min = { x: 0, y: 0, ...chartType.minSize };
	const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	const screen = await showInDashboard(chartWidget(ids, {}, min));
	await expect.element(screen.getByText("2 more places aren't shown.")).toBeVisible();
	const height = await plotHeight();
	console.log(
		`plot height, minimum size ${chartType.minSize.w}×${chartType.minSize.h}: ${height}px`
	);
	expect(height).toBeGreaterThanOrEqual(80);
});

test("with two strips the main plot keeps half the plot area", async () => {
	const requests: AdapterRequest[] = [];
	const numbers = mapDatasetCatalog({
		datasets: [WEATHER_DATASET, PESTICIDE_USE_DATASET]
	} as Parameters<typeof mapDatasetCatalog>[0]).map((d) => ({ ...d, geographies: ["monitor"] }));
	fake.metadata = fixtureMetadata({
		catalog: async () => [...FIXTURE_CATALOG, ...numbers],
		levels: async () => PM25_LEVELS
	});
	fake.client = createQueryClient({
		adapters: [
			fakeAdapter(requests),
			fakeNumberAdapter("weather", requests),
			fakeNumberAdapter("pesticide-use", requests, {
				offered: ["month", "year"],
				values: [1200, 340]
			})
		],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	const widget = chartWidget(["m1"], {}, rect);
	widget.data.layers.push(
		{ dataset: "weather", entryType: "precipitation" },
		{ dataset: "pesticide-use", entryType: "pounds-applied" }
	);
	await showInDashboard(widget);
	await expect.poll(() => document.querySelectorAll("[data-strip] canvas").length).toBe(2);
	const area = document.querySelector<HTMLElement>("[role=group] > .relative")!;
	const main = () => document.querySelector<HTMLCanvasElement>("[role=group] canvas")!;
	// Once laid out (the strips take their share, the main plot shrinks to the rest).
	await expect
		.poll(() => {
			const strips = [...document.querySelectorAll<HTMLElement>("[data-strip]")];
			const used = strips.reduce((sum, s) => sum + s.getBoundingClientRect().height, 0);
			return Math.abs(main().getBoundingClientRect().height + used - area.clientHeight) < 16;
		})
		.toBe(true);
	const height = main().getBoundingClientRect().height;
	console.log(
		`main plot height with two strips, default size: ${height}px of ${area.clientHeight}px`
	);
	expect(height).toBeGreaterThanOrEqual(area.clientHeight / 2 - 1);
});
