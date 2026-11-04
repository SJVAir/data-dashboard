import "../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { chartWidget, fakeAdapter } from "../chart/test-harness/fake-data";
import { generatedTitle } from "../titles.svelte";
import DataTable from "./DataTable.svelte";

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
	frame.style.width = "400px";
	frame.style.height = "480px";
	document.body.appendChild(frame);
});

afterEach(() => frame.remove());

function tableWidget(ids: string[]): WidgetInstance {
	return { ...chartWidget(ids), type: "data-table" };
}

async function show(widget: WidgetInstance) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	return render(DataTable, {
		target: frame,
		props: { widget },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
}

test("rows start newest first, with the level beside each value", async () => {
	const widget = tableWidget(["m1"]);
	const screen = await show(widget);
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	const date = screen.getByRole("columnheader", { name: m.table_date() });
	await expect.element(date).toHaveAttribute("aria-sort", "descending");
	const rows = [...frame.querySelectorAll("tbody tr")];
	// Values are 5, 6, 7 oldest to newest: newest first reads 7, 6, 5.
	expect(rows.map((r) => r.querySelectorAll("td")[0].textContent)).toEqual([
		expect.stringContaining("7"),
		expect.stringContaining("6"),
		expect.stringContaining("5")
	]);
	expect(rows[0].textContent).toContain("Good");
	expect(frame.querySelector("tbody td:nth-child(2)")!.className).toContain("tabular-nums");
	await expect.poll(() => generatedTitle(widget.id)).toBe("PM2.5 · Monitor m1 · Last 30 days");
});

test("headers sort by keyboard and aria-sort follows", async () => {
	const screen = await show(tableWidget(["m1", "m2"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	const button = screen.getByRole("button", { name: /Monitor m2/ });
	(button.element() as HTMLElement).focus();
	await userEvent.keyboard("{Enter}");
	const header = screen.getByRole("columnheader", { name: /Monitor m2/ });
	await expect.element(header).toHaveAttribute("aria-sort", "ascending");
	await expect
		.element(screen.getByRole("columnheader", { name: m.table_date() }))
		.not.toHaveAttribute("aria-sort");
	await userEvent.keyboard(" ");
	await expect.element(header).toHaveAttribute("aria-sort", "descending");
});

test("narrow shows date, value and level; wide adds worst hour, lowest and highest", async () => {
	const screen = await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	expect(frame.querySelectorAll("thead th")).toHaveLength(2);
	frame.style.width = "800px";
	await expect.poll(() => frame.querySelectorAll("thead th").length).toBe(5);
	await expect.element(screen.getByRole("columnheader", { name: /Worst hour/ })).toBeVisible();
});

test("ten places at most, and the rest are counted", async () => {
	const ids = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
	const screen = await show(tableWidget(ids));
	await expect.element(screen.getByText("2 more places aren't shown.")).toBeVisible();
	expect(requests.at(-1)!.target).toEqual({ kind: "monitors", ids: ids.slice(0, 10) });
});

test("the caption names the resolution", async () => {
	const screen = await show(tableWidget(["m1"]));
	await expect.element(screen.getByText(m.chart_series_day())).toBeVisible();
});
