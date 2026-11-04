import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "$lib/data/testing/fixtures";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { PM25_LEVELS, chartWidget, fakeAdapter } from "../shared/test-harness/fake-data";
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

test("has no axe violations narrow or wide", async () => {
	await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	expect((await axe.run(frame)).violations).toEqual([]);
	frame.style.width = "800px";
	await expect.poll(() => frame.querySelectorAll("thead th").length).toBe(5);
	expect((await axe.run(frame)).violations).toEqual([]);
});

test("every value row has a level label", async () => {
	await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	const names = new Set(PM25_LEVELS.map((l) => l.label));
	for (const row of frame.querySelectorAll("tbody tr")) {
		const cell = row.querySelector("td")!;
		expect([...names].some((n) => cell.textContent!.includes(n))).toBe(true);
	}
});

test("the worst hour column shows the value and its hour range", async () => {
	const screen = await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	frame.style.width = "800px";
	await expect.poll(() => frame.querySelectorAll("thead th").length).toBe(5);
	const cell = frame.querySelector("tbody tr td:nth-child(3)")!;
	// Newest first: the third day's worst hour is 14 at 15:00 Pacific-day offset; a one-hour range.
	expect(cell.textContent).toContain("14");
	expect(cell.textContent).toMatch(/\d.*[–-].*\d/);
	await expect.element(screen.getByRole("columnheader", { name: /Worst hour/ })).toBeVisible();
});

test("values, worst hour, lowest and highest show with the catalog's precision", async () => {
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
	await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	frame.style.width = "800px";
	await expect.poll(() => frame.querySelectorAll("thead th").length).toBe(5);
	// Newest first: mean 7, worst hour 14, lowest 7, highest 7.
	const cells = [...frame.querySelectorAll("tbody tr")[0].querySelectorAll("td")].map(
		(td) => td.textContent ?? ""
	);
	expect(cells[0]).toContain("7.0");
	expect(cells[1]).toContain("14.0");
	expect(cells[2].trim()).toBe("7.0");
	expect(cells[3].trim()).toBe("7.0");
});

test("the caption notes raw-computed data", async () => {
	const base = fakeAdapter(requests);
	fake.client = createQueryClient({
		adapters: [
			{ ...base, fetch: async (r, c, s) => ({ ...(await base.fetch(r, c, s)), fromRaw: true }) }
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	const screen = await show(tableWidget(["m1"]));
	await expect
		.element(screen.getByText(m.table_caption_raw({ resolution: m.chart_series_day() })))
		.toBeVisible();
});

test("a partial period is marked in text", async () => {
	const base = fakeAdapter(requests);
	fake.client = createQueryClient({
		adapters: [
			{
				...base,
				fetch: async (r, c, s) => {
					const d = await base.fetch(r, c, s);
					d.series[0].points[2].partial = true;
					return d;
				}
			}
		],
		metadata: fake.metadata!,
		regions: { resolve: async () => "unsupported" }
	});
	await show(tableWidget(["m1"]));
	await expect.poll(() => frame.querySelectorAll("tbody tr").length).toBe(3);
	expect(frame.querySelector("tbody tr th")!.textContent).toContain(m.table_partial());
});
