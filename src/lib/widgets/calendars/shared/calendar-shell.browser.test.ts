import "../../../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, DatasetAdapter } from "$lib/data/adapters/registry";
import type { DailyFigure, Level, MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { addDays, formatDateRange, formatWeekdayDate, pacificDay } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { PM25_LEVELS } from "../../shared/test-harness/fake-data";
import type { CalendarData } from "./calendar-data.svelte";
import { figureName } from "./calendar-data.svelte";
import ShellHarness from "./test-harness/ShellHarness.svelte";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

/** Noon Pacific on Mon, Nov 9 2026: "today". */
const NOW = new Date("2026-11-09T20:00:00Z");
const FIGURE: DailyFigure = { field: "mean_24h", label: "24-hour average" };

/**
 * The days' figures: Oct 1–2 Good, Oct 15 not enough data, the rest of October Moderate; Nov 1
 * Good, Nov 2–8 Moderate, today (Nov 9) 19.9 so far. 39 rated days, 36 at or above Moderate;
 * November 8 of 9.
 */
function figures(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (let d = "2026-10-01"; d <= "2026-10-31"; d = addDays(d, 1)) out[d] = 20;
	out["2026-10-01"] = 4;
	out["2026-10-02"] = 4;
	out["2026-10-15"] = null;
	Object.assign(out, {
		"2026-11-01": 5,
		"2026-11-02": 12,
		"2026-11-03": 15,
		"2026-11-04": 18,
		"2026-11-05": 20,
		"2026-11-06": 31.9,
		"2026-11-07": 25.1,
		"2026-11-08": 25,
		"2026-11-09": 19.9
	});
	return out;
}

let requests: AdapterRequest[];
let days: Record<string, number | null>;
let figure: DailyFigure | null;
let levels: Level[];

function adapter(): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			return layer.place?.kind === "monitor"
				? { kind: "monitors", ids: [layer.place.id] }
				: { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		async fetch(req): Promise<QueryData> {
			requests.push(req);
			const id = req.target.kind === "monitors" ? req.target.ids[0] : "";
			const points = Object.entries(days)
				.filter(([d]) => d >= req.range.firstDate && d <= req.range.lastDate)
				.map(([d, v]) => ({
					t: pacificDay(d).getTime(),
					mean: v ?? 0,
					min: v ?? 0,
					max: v ?? 0,
					count: 24,
					partial: d === "2026-11-09",
					...(req.dailyFigure ? { figure: v } : {}),
					final: d !== "2026-11-09"
				}));
			return {
				series: [{ place: `monitor:${id}`, points }],
				places: [{ place: `monitor:${id}`, name: `Monitor ${id}` }],
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}

let frame: HTMLDivElement;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
	await page.viewport(1280, 800);
	requests = [];
	days = figures();
	figure = FIGURE;
	levels = PM25_LEVELS;
	fake.metadata = fixtureMetadata({
		levels: async (entryType) => (entryType === "pm25" ? levels : []),
		dailyFigure: async (entryType) => (entryType === "pm25" ? figure : null)
	});
	fake.client = createQueryClient({
		adapters: [adapter()],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	frame = document.createElement("div");
	frame.style.width = "480px";
	frame.style.height = "600px";
	document.body.appendChild(frame);
});

afterEach(() => {
	vi.useRealTimers();
	frame.remove();
});

function calendar(extra: Partial<WidgetInstance> = {}, entryType = "pm25"): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: MONTH_CALENDAR_TYPE,
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 6 },
		data: {
			dateRange: { kind: "custom", start: "2026-10-01", end: "2026-11-30" },
			layers: [{ dataset: "air-quality", entryType, place: { kind: "monitor", id: "a" } }]
		},
		...extra
	};
}

async function show(
	widget: WidgetInstance,
	props: { selection?: { start: string; end: string } | null; dragging?: boolean } = {}
) {
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	let data: CalendarData | undefined;
	const screen = await render(ShellHarness, {
		target: frame,
		props: { widget, ...props, ondata: (d: CalendarData) => (data = d) },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
	await expect.element(screen.getByTestId("grid"), { timeout: 5000 }).toBeVisible();
	await expect.poll(() => data!.states.size).toBeGreaterThan(0);
	return { screen, data: data! };
}

const MODERATE = [{ level: "moderate" }];

/** The count line's text, spaces collapsed. */
const countLine = () =>
	frame.querySelector("[data-calendar-count]")?.textContent?.replace(/\s+/g, " ").trim();

test("asks once for the daily figure the metadata names, and reads the day states", async () => {
	const { data } = await show(calendar());
	expect(requests).toHaveLength(1);
	expect(requests[0].dailyFigure).toBe("mean_24h");
	expect(requests[0].resolution).toBe("day");
	expect(data.figure).toEqual(FIGURE);
	expect(data.today).toBe("2026-11-09");
	expect(data.range).toEqual({ first: "2026-10-01", last: "2026-11-30" });
	expect(data.selectable).toEqual({ first: "2026-10-01", last: "2026-11-09" });
	expect(data.states.size).toBe(61);
	expect(data.states.get("2026-11-06")).toMatchObject({ kind: "rated", value: 31.9 });
	expect(data.states.get("2026-10-15")?.kind).toBe("thin");
	expect(data.states.get("2026-11-09")?.kind).toBe("today");
	expect(data.states.get("2026-11-10")?.kind).toBe("future");
	expect(data.levels).toEqual(PM25_LEVELS);
});

test("figureName: the server's label, else Daily value", () => {
	expect(figureName(FIGURE)).toBe("24-hour average");
	expect(figureName({ field: "max_1h", label: null })).toBe(m.calendar_daily_value());
	expect(figureName(null)).toBe("Daily value");
});

test("a threshold shows the count line, and the month's count for a range across months", async () => {
	const { screen, data } = await show(calendar({ thresholds: MODERATE }));
	expect(data.threshold?.key).toBe("moderate");
	expect(data.thresholdMissing).toBe(false);
	const line = frame.querySelector("[data-calendar-count]");
	await expect
		.poll(() => line?.textContent?.replace(/\s+/g, " ").trim())
		.toBe("▲ 36 of 39 rated days at or above Moderate");
	expect(
		m.calendar_threshold_count({
			at: "36",
			rated: "39",
			ratedValue: 39,
			level: "Moderate"
		})
	).toBe("36 of 39 rated days at or above Moderate");
	expect(m.calendar_threshold_count({ at: "1", rated: "1", ratedValue: 1, level: "Good" })).toBe(
		"1 of 1 rated day at or above Good"
	);
	await expect.element(screen.getByText("8 of 9 in November so far")).toBeVisible();
});

test("a range inside one month has no month count", async () => {
	const widget = calendar({ thresholds: MODERATE });
	widget.data.dateRange = { kind: "custom", start: "2026-11-01", end: "2026-11-30" };
	await show(widget);
	await expect.poll(countLine).toBe("▲ 8 of 9 rated days at or above Moderate");
	expect(frame.textContent).not.toContain("in November so far");
});

test("a range across months that ended before this month has no month count", async () => {
	const widget = calendar({ thresholds: MODERATE });
	widget.data.dateRange = { kind: "custom", start: "2026-09-01", end: "2026-10-31" };
	await show(widget);
	await expect.poll(countLine).toBe("▲ 28 of 30 rated days at or above Moderate");
	expect(frame.textContent).not.toContain("so far");
});

test("no threshold: no count line and no threshold mark in the legend", async () => {
	const { screen } = await show(calendar());
	await expect.element(screen.getByText(m.calendar_not_enough_data())).toBeVisible();
	expect(frame.querySelector("[data-calendar-count]")).toBeNull();
	expect(frame.querySelector("[data-legend-threshold]")).toBeNull();
});

test("a stored level the scale lacks: no count, no mark, and the missing-level note", async () => {
	const { screen, data } = await show(calendar({ thresholds: [{ level: "gone" }] }));
	await expect.element(screen.getByText(m.calendar_level_missing())).toBeVisible();
	expect(data.threshold).toBeNull();
	expect(data.thresholdMissing).toBe(true);
	expect(frame.querySelector("[data-calendar-count]")).toBeNull();
	expect(frame.querySelector("[data-legend-threshold]")).toBeNull();
});

test("a pollutant with no levels: the no-levels note, no count, no crash", async () => {
	levels = [];
	const { screen, data } = await show(calendar({ thresholds: MODERATE }));
	await expect.element(screen.getByText(m.calendar_no_levels())).toBeVisible();
	expect(data.threshold).toBeNull();
	expect(data.thresholdMissing).toBe(false);
	expect(frame.querySelector("[data-calendar-count]")).toBeNull();
	expect(frame.textContent).not.toContain(m.calendar_day_rating_unknown());
});

test("no daily figure: one note, no figure asked for, every past day unrated", async () => {
	figure = null;
	const { screen, data } = await show(calendar());
	await expect.element(screen.getByText(m.calendar_day_rating_unknown())).toBeVisible();
	expect(screen.getByText(m.calendar_day_rating_unknown()).elements()).toHaveLength(1);
	expect(requests).toHaveLength(1);
	expect(requests[0].dailyFigure).toBeUndefined();
	expect(data.figure).toBeNull();
	for (const [date, s] of data.states) {
		if (date < "2026-11-09") expect(s.kind).toBe("unrated");
	}
});

test("a failed figure lookup proceeds without the figure", async () => {
	fake.metadata = { ...fake.metadata!, dailyFigure: async () => Promise.reject(new Error("x")) };
	const { screen, data } = await show(calendar());
	await expect.element(screen.getByText(m.calendar_day_rating_unavailable())).toBeVisible();
	expect(requests).toHaveLength(1);
	expect(requests[0].dailyFigure).toBeUndefined();
	expect(data.figure).toBeNull();
});

const NOV_5_8 = { start: "2026-11-05", end: "2026-11-08" };

test("the summary line for a selection, with the worst day's chip and the threshold count", async () => {
	await show(calendar({ thresholds: MODERATE }), { selection: NOV_5_8 });
	const summary = m.calendar_selection_summary({
		dates: formatDateRange("2026-11-05", "2026-11-08"),
		days: "4",
		daysValue: 4,
		figure: "24-hour average",
		average: "25.5",
		unit: "µg/m³",
		worstDate: formatWeekdayDate("2026-11-06"),
		worstValue: "31.9"
	});
	expect(summary).toBe(
		"Nov 5 – 8, 2026 · 4 days · 24-hour average · average day 25.5 µg/m³ · worst day Fri, Nov 6, 31.9 µg/m³"
	);
	const line = frame.querySelector("[data-calendar-summary]") as HTMLElement;
	await expect.poll(() => line?.textContent).toContain(summary);
	expect(line.querySelector("[data-level-chip]")?.textContent?.trim()).toBe("Moderate");
	expect(line.textContent).toContain("4 days at or above Moderate");
	expect(line.textContent).toContain(m.calendar_selection_clear_hint());
	expect(line.textContent).not.toContain("not rated");
});

test("unrated days in a selection are named and left out of the average", async () => {
	days["2026-11-05"] = null;
	days["2026-11-07"] = null;
	const { screen } = await show(calendar(), { selection: NOV_5_8 });
	await expect.element(screen.getByText("2 days not rated")).toBeVisible();
	const line = frame.querySelector("[data-calendar-summary]") as HTMLElement;
	// (31.9 + 25) / 2
	expect(line.textContent).toContain("average day 28.4");
	expect(line.textContent).not.toContain("at or above");
});

test("a selection with no rated day says so", async () => {
	figure = null;
	const { screen } = await show(calendar(), { selection: NOV_5_8 });
	await expect
		.element(
			screen.getByText(
				m.calendar_selection_summary_none_rated({
					dates: formatDateRange("2026-11-05", "2026-11-08"),
					days: "4",
					daysValue: 4
				})
			)
		)
		.toBeVisible();
	// The line says so; no second "4 days not rated" repeats it.
	const line = frame.querySelector("[data-calendar-summary]") as HTMLElement;
	expect(line.textContent).not.toContain("4 days not rated");
});

test("the live region announces the summary once the selection settles, not while dragging", async () => {
	const { screen } = await show(calendar());
	const live = frame.querySelector("[aria-live=polite]") as HTMLElement;
	expect(live).not.toBeNull();
	expect(frame.querySelectorAll("[aria-live]")).toHaveLength(1);
	expect(live.textContent?.trim()).toBe("");

	await screen.rerender({ selection: { start: "2026-11-05", end: "2026-11-06" }, dragging: true });
	await expect
		.poll(() => frame.querySelector("[data-calendar-summary]")?.textContent)
		.toContain("2 days");
	expect(live.textContent?.trim()).toBe("");

	await screen.rerender({ selection: NOV_5_8, dragging: false });
	await expect.poll(() => live.textContent).toContain("4 days");
	expect(live.textContent).toContain("worst day Fri, Nov 6");

	await screen.rerender({ selection: null });
	await expect.poll(() => live.textContent?.trim()).toBe("");
});

test("a stored selection on load isn't announced", async () => {
	await show(calendar(), { selection: NOV_5_8 });
	const live = frame.querySelector("[aria-live=polite]") as HTMLElement;
	await expect.poll(() => frame.querySelector("[data-calendar-summary]")).not.toBeNull();
	expect(live.textContent?.trim()).toBe("");
});

test("the legend: levels up to one above the highest shown, the other states, the mark", async () => {
	const { screen } = await show(calendar({ thresholds: MODERATE }));
	const legend = frame.querySelector("[data-calendar-legend]") as HTMLElement;
	await expect.poll(() => legend?.querySelectorAll("[data-level-chip]").length).toBe(3);
	const chips = [...legend.querySelectorAll("[data-level-chip]")].map((c) => c.textContent?.trim());
	expect(chips).toEqual(["Good", "Moderate", "Unhealthy for Sensitive Groups"]);
	await expect.element(screen.getByText(m.calendar_not_enough_data())).toBeVisible();
	await expect.element(screen.getByText(m.calendar_no_data())).toBeVisible();
	const mark = legend.querySelector("[data-legend-threshold]");
	expect(mark?.textContent?.replace(/\s+/g, " ").trim()).toBe("▲ At or above Moderate");
});

test("the legend shows no level swatches when no day is rated", async () => {
	figure = null;
	await show(calendar());
	const legend = frame.querySelector("[data-calendar-legend]") as HTMLElement;
	await expect.poll(() => legend?.textContent).toContain(m.calendar_no_data());
	expect(legend.querySelectorAll("[data-level-chip]")).toHaveLength(0);
});

test("a widget with no place asks for nothing and offers the place picker state", async () => {
	const widget = calendar();
	widget.data.layers = [{ dataset: "air-quality", entryType: "pm25" }];
	const app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
	await render(ShellHarness, {
		target: frame,
		props: { widget },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
	await expect.poll(() => frame.textContent).toContain(m.widget_state_idle());
	expect(requests).toHaveLength(0);
});

test("a clock tick within the same day keeps the range, selectable days and states as they were", async () => {
	vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: NOW });
	const { data } = await show(calendar());
	const { states, range, selectable } = data;
	vi.advanceTimersByTime(60_000);
	await new Promise((r) => setTimeout(r, 0));
	expect(data.today).toBe("2026-11-09");
	expect(data.range).toBe(range);
	expect(data.selectable).toBe(selectable);
	expect(data.states).toBe(states);
});
