import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Harness from "$lib/components/dashboard/test-harness/Harness.svelte";
import type { AdapterRequest, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { chartWidget, fakeAdapter } from "./shared/test-harness/fake-data";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

let requests: AdapterRequest[];

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
});
afterEach(() => toast.dismiss());

function dashboard(widgets: WidgetInstance[]): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: "Test",
		version: 0,
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		body: { widgets }
	};
}

async function show(widgets: WidgetInstance[]) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await render(Harness, {
		props: { view: dashboard(widgets) },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return platform;
}

const items = () =>
	[...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());

test.each([
	["chart", "chart"],
	["data-table", "data-table"]
])("the %s menu has Download data (CSV), which saves text/csv", async (_name, type) => {
	const platform = await show([
		{ ...chartWidget(["m1"], { title: "Readings" }), type, rect: { x: 0, y: 0, w: 6, h: 8 } }
	]);
	await page.getByRole("button", { name: "Actions for Readings" }).click();
	await expect.element(page.getByRole("menuitem", { name: m.widget_download_csv() })).toBeVisible();
	await page.getByRole("menuitem", { name: m.widget_download_csv() }).click();
	await expect.poll(() => platform.files.saved.length).toBe(1);
	const saved = platform.files.saved[0];
	expect(saved.type).toBe("text/csv");
	expect(saved.name).toMatch(/^pm25-monitor-m1-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
	const lines = saved.contents.split("\r\n");
	expect(lines[0]).toContain("period_start");
	expect(lines).toHaveLength(5);
	// One place, daily view, so the worst hour is carried.
	expect(lines[1].split(",")[11]).toBe("12");
});

test("a placeholder widget's menu has no download", async () => {
	await show([
		{
			id: "p",
			type: "placeholder",
			title: "Plain",
			rect: { x: 0, y: 0, w: 6, h: 4 },
			data: { layers: [] }
		}
	]);
	await page.getByRole("button", { name: "Actions for Plain" }).click();
	await expect.element(page.getByRole("menuitem", { name: "Fullscreen" })).toBeVisible();
	expect(items()).not.toContain(m.widget_download_csv());
});

test("the Data table has its own Download CSV button", async () => {
	const platform = await show([
		{ ...chartWidget(["m1", "m2"]), type: "data-table", rect: { x: 0, y: 0, w: 6, h: 8 } }
	]);
	await page.getByRole("button", { name: m.table_download_csv() }).click();
	await expect.poll(() => platform.files.saved.length).toBe(1);
	const lines = platform.files.saved[0].contents.split("\r\n");
	// Two places: three days each, and no worst hour.
	expect(lines).toHaveLength(8);
	expect(lines[1].split(",")[11]).toBe("");
	expect(platform.files.saved[0].name).toContain("pm25-2-places-");
});

test("a minimized data widget's taskbar menu has Download data (CSV)", async () => {
	const platform = await show([
		{
			...chartWidget(["m1"], { title: "Readings" }),
			rect: { x: 0, y: 0, w: 6, h: 8 },
			minimized: { order: 0 }
		}
	]);
	await page
		.getByTestId(
			`taskbar-${document.querySelector("[data-testid^=taskbar-]")!.getAttribute("data-testid")!.slice(8)}`
		)
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: m.widget_download_csv() }).click();
	await expect.poll(() => platform.files.saved.length).toBe(1);
	expect(platform.files.saved[0].type).toBe("text/csv");
});
