import "../../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { AdapterRequest, DatasetAdapter } from "$lib/data/adapters/registry";
import type { DailyFigure, MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import {
	addDays,
	formatMonthShort,
	pacificDay,
	weekColumnMonthLabels,
	weekColumns
} from "$lib/format";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Platform } from "$lib/platform/types";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { CONTRIBUTION_CALENDAR_TYPE } from "$lib/calendars/types";
import { PM25_LEVELS } from "../../shared/test-harness/fake-data";
import { PATTERNS_KEY } from "../shared/patterns-pref.svelte";
import ContributionCalendarWidget from "./ContributionCalendarWidget.svelte";
import { component } from "./module";
import ContributionHarness from "./test-harness/ContributionHarness.svelte";

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
/** "Last 12 months" ending today. */
const FIRST = "2025-11-10";
const TODAY = "2026-11-09";

/** A Good year; a few November days as below; today 19.9 so far. */
function figures(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (let d = FIRST; d <= TODAY; d = addDays(d, 1)) out[d] = 5;
	Object.assign(out, {
		"2026-11-03": null,
		"2026-11-05": 20,
		"2026-11-06": 31.9,
		"2026-11-07": 40,
		"2026-11-08": 60,
		"2026-11-09": 19.9
	});
	delete out["2026-11-04"];
	return out;
}

let requests: AdapterRequest[];
let days: Record<string, number | null>;

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
					partial: d === TODAY,
					...(req.dailyFigure ? { figure: v } : {}),
					final: d !== TODAY
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
	await page.viewport(1280, 900);
	requests = [];
	days = figures();
	fake.metadata = fixtureMetadata({
		levels: async (entryType) => (entryType === "pm25" ? PM25_LEVELS : []),
		dailyFigure: async (entryType) => (entryType === "pm25" ? FIGURE : null)
	});
	fake.client = createQueryClient({
		adapters: [adapter()],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	frame = document.createElement("div");
	frame.style.width = "480px";
	document.body.appendChild(frame);
});

afterEach(() => {
	vi.useRealTimers();
	frame.remove();
});

function calendar(id = "cal", extra: Partial<WidgetInstance> = {}): WidgetInstance {
	return {
		id,
		type: CONTRIBUTION_CALENDAR_TYPE,
		title: "A year of days",
		rect: { x: 0, y: 0, w: 12, h: 3 },
		data: {
			dateRange: { kind: "trailing", amount: 12, unit: "month" },
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }]
		},
		...extra
	};
}

/** A dashboard session holding `widgets`, drawn from it. */
async function show(widgets: WidgetInstance[], opts: { platform?: Platform } = {}) {
	const platform = opts.platform ?? createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	const read = () => session.doc.body.widgets;
	const screen = await render(ContributionHarness, {
		target: frame,
		props: { widgets: read },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
	await expect.poll(() => cellOf("2026-11-01")?.dataset.kind, { timeout: 5000 }).toBe("rated");
	return { screen, session, platform, app, saved: () => read()[0].data.timeSubRange };
}

const cellOf = (date: string, root: ParentNode = frame) =>
	root.querySelector<HTMLElement>(`[data-date="${date}"]`);
const inner = (date: string, root: ParentNode = frame) =>
	cellOf(date, root)!.querySelector<HTMLElement>("[data-cell]")!;
const nameOf = (date: string) => cellOf(date)!.querySelector("[data-name]")!.textContent;
const rgb = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test("the module's component is the contribution calendar", () => {
	expect(component).toBe(ContributionCalendarWidget);
});

test("Last 12 months: 53 weeks, Sunday on top, month and weekday labels, scrolled to today", async () => {
	await show([calendar()]);
	const columns = weekColumns(FIRST, TODAY);
	expect(columns).toHaveLength(53);
	const grid = frame.querySelector("[role=grid]")!;
	expect(grid.getAttribute("aria-label")).toBe("A year of days");
	// A row per weekday, a cell per week.
	const rows = grid.querySelectorAll("[role=row]");
	expect(rows).toHaveLength(7);
	for (const row of rows) expect(row.querySelectorAll("[role=gridcell]")).toHaveLength(53);

	// Sunday on top of its week's column; the next week to its right.
	const sun = cellOf("2026-11-08")!.getBoundingClientRect();
	const mon = cellOf("2026-11-09")!.getBoundingClientRect();
	const lastSun = cellOf("2026-11-01")!.getBoundingClientRect();
	expect(mon.left).toBe(sun.left);
	expect(mon.top).toBeGreaterThan(sun.top);
	expect(sun.left).toBeGreaterThan(lastSun.left);
	expect(sun.top).toBe(lastSun.top);

	// About 12–16 px.
	expect(sun.width).toBeGreaterThanOrEqual(12);
	expect(sun.width).toBeLessThanOrEqual(16);
	expect(sun.height).toBe(sun.width);

	const labels = [...frame.querySelectorAll<HTMLElement>("[data-month-label]")];
	const expected = weekColumnMonthLabels(columns).filter((l): l is string => l !== null);
	expect(labels.map((l) => l.textContent!.trim())).toEqual(
		expected.map((d) => formatMonthShort(d))
	);
	// Each month's label sits over its first column.
	const novIndex = weekColumnMonthLabels(columns).indexOf("2026-11-01");
	const novDay = columns[novIndex].find((d) => d !== null)!;
	expect(labels.at(-1)!.getBoundingClientRect().left).toBeCloseTo(
		cellOf(novDay)!.getBoundingClientRect().left,
		0
	);
	const weekdays = [...frame.querySelectorAll("[data-weekday-labels] [data-weekday]")].map((e) =>
		e.textContent!.trim()
	);
	expect(weekdays).toEqual(["Sun", "Tue", "Thu", "Sat"]);
	// Each label lines up with its row.
	const sat = frame.querySelectorAll<HTMLElement>("[data-weekday-labels] [data-weekday]")[3];
	const satCell = cellOf("2026-11-07")!.getBoundingClientRect();
	const satLabel = sat.getBoundingClientRect();
	expect(satLabel.top + satLabel.height / 2).toBeCloseTo(satCell.top + satCell.height / 2, 0);

	// Opens on the latest week; the weekday labels stay put while the weeks scroll.
	const scroller = frame.querySelector<HTMLElement>("[data-weeks-scroll]")!;
	expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
	await expect
		.poll(() => scroller.scrollLeft + scroller.clientWidth)
		.toBeGreaterThanOrEqual(scroller.scrollWidth - 1);
	const before = sat.getBoundingClientRect().left;
	scroller.scrollLeft = 0;
	expect(sat.getBoundingClientRect().left).toBe(before);
	expect(cellOf("2026-11-07")!.getBoundingClientRect().left).toBeGreaterThan(satCell.left);
});

test("cells are named in full, with the year (the range spans two years)", async () => {
	await show([calendar()]);
	expect(nameOf("2026-11-06")).toBe(
		"Friday, November 6, 2026: 24-hour average 31.9 µg/m³, Moderate"
	);
	expect(nameOf("2026-11-04")).toBe("Wednesday, November 4, 2026: No data");
});

const patternOf = (date: string, root?: ParentNode) =>
	getComputedStyle(inner(date, root)).backgroundImage;

test("levels draw their tier's pattern; Show patterns turns them off on every calendar", async () => {
	const { platform, app } = await show([calendar("a"), calendar("b")]);
	const style = getComputedStyle(inner("2026-11-06"));
	expect(style.backgroundColor).toBe(rgb("#ffff00"));
	expect(style.outlineStyle).toBe("solid");
	// Moderate: dots on a 5 px grid, in black ink (readable on yellow).
	expect(style.backgroundImage).toContain("radial-gradient");
	expect(style.backgroundImage).toContain("rgb(0, 0, 0)");
	expect(style.backgroundSize).toContain("5px 5px");
	// Good: plain. USG stripes, Unhealthy cross-hatch.
	expect(patternOf("2026-11-01")).toBe("none");
	expect(patternOf("2026-11-07")).toMatch(/^repeating-linear-gradient\(45deg/);
	expect(patternOf("2026-11-08").match(/repeating-linear-gradient/g)).toHaveLength(2);

	const b = frame.querySelector('[data-widget="b"]')!;
	expect(patternOf("2026-11-06", b)).toContain("radial-gradient");
	// The legend's swatches carry them too.
	expect(
		getComputedStyle(frame.querySelector<HTMLElement>('[data-swatch="moderate"]')!).backgroundImage
	).toContain("radial-gradient");

	const switches = page.getByRole("switch", { name: "Show patterns" });
	await expect.element(switches.first()).toBeChecked();
	await switches.first().click();
	await expect.poll(() => patternOf("2026-11-06")).toBe("none");
	expect(patternOf("2026-11-06", b)).toBe("none");
	await expect.element(switches.nth(1)).not.toBeChecked();
	// The color stays; the name still says the level.
	expect(getComputedStyle(inner("2026-11-06")).backgroundColor).toBe(rgb("#ffff00"));
	expect(nameOf("2026-11-06")).toContain("Moderate");
	await expect.poll(() => platform.preferences.get(app.space, PATTERNS_KEY)).toBe(false);
});

test("a fresh space starts with patterns on; a stored off is read back", async () => {
	const first = await show([calendar()]);
	await page.getByRole("switch", { name: "Show patterns" }).click();
	await expect.poll(() => patternOf("2026-11-06")).toBe("none");
	first.screen.unmount();

	await show([calendar()]);
	await expect.element(page.getByRole("switch", { name: "Show patterns" })).toBeChecked();
	expect(patternOf("2026-11-06")).toContain("radial-gradient");
});

test("a stored off is read back on open", async () => {
	const platform = createMemoryPlatform();
	await platform.preferences.set("anonymous", PATTERNS_KEY, false);
	await show([calendar()], { platform });
	await expect.element(page.getByRole("switch", { name: "Show patterns" })).not.toBeChecked();
	expect(patternOf("2026-11-06")).toBe("none");
});

test("the threshold's corner mark, today dashed, thin striped, none grey", async () => {
	await show([calendar("cal", { thresholds: [{ level: "moderate" }] })]);
	const mark = inner("2026-11-06").querySelector<HTMLElement>("[data-mark]")!;
	expect(mark).not.toBeNull();
	expect(getComputedStyle(mark).backgroundColor).toBe(rgb("#000000"));
	const cell = inner("2026-11-06").getBoundingClientRect();
	const m = mark.getBoundingClientRect();
	expect(m.top).toBe(cell.top);
	expect(m.right).toBe(cell.right);
	expect(m.width).toBeLessThan(cell.width / 2);
	expect(inner("2026-11-01").querySelector("[data-mark]")).toBeNull();
	expect(nameOf("2026-11-06")).toMatch(/, at or above Moderate$/);

	expect(getComputedStyle(inner("2026-11-09")).outlineStyle).toBe("dashed");
	expect(cellOf("2026-11-03")!.dataset.kind).toBe("thin");
	expect(inner("2026-11-03").classList).toContain("calendar-stripes");
	expect(cellOf("2026-11-04")!.dataset.kind).toBe("none");
	expect(inner("2026-11-04").classList).toContain("bg-muted");
	expect(patternOf("2026-11-04")).toBe("none");
	await expect.element(page.getByText("At or above Moderate")).toBeVisible();
});

test("the keyboard: Left/Right a week, Up/Down a day, Shift+Right extends by a week", async () => {
	const { saved } = await show([calendar()]);
	const before = document.createElement("button");
	frame.prepend(before);
	before.focus();
	await userEvent.tab();
	const focused = () => (document.activeElement as HTMLElement).dataset.date;
	expect(focused()).toBe(TODAY);
	await userEvent.keyboard("{ArrowLeft}");
	expect(focused()).toBe("2026-11-02");
	await userEvent.keyboard("{ArrowUp}");
	expect(focused()).toBe("2026-11-01");
	await userEvent.keyboard("{ArrowDown}");
	expect(focused()).toBe("2026-11-02");
	await userEvent.keyboard("{ArrowLeft}");
	expect(focused()).toBe("2026-10-26");
	await userEvent.keyboard(" ");
	expect(saved()).toEqual({ start: "2026-10-26", end: "2026-10-26" });
	await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
	expect(saved()).toEqual({ start: "2026-10-26", end: "2026-11-02" });
	await userEvent.keyboard("{Escape}");
	expect(saved()).toBeUndefined();
});

test("a click, then another day, selects the span", async () => {
	const { saved } = await show([calendar()]);
	await userEvent.click(cellOf("2026-11-02")!);
	await userEvent.click(cellOf("2026-11-06")!);
	expect(saved()).toEqual({ start: "2026-11-02", end: "2026-11-06" });
	await expect.poll(() => cellOf("2026-11-04")!.dataset.selected).toBe("");
});

test("the switch is a labeled switch, reached by keyboard, its state announced", async () => {
	await show([calendar()]);
	const toggle = page.getByRole("switch", { name: "Show patterns" });
	const el = toggle.element() as HTMLInputElement;
	// In the legend row, under the grid.
	const legend = frame.querySelector("[data-calendar-legend]")!.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	expect(r.bottom).toBeGreaterThan(legend.top);
	expect(r.top).toBeLessThan(legend.bottom + 24);
	el.focus();
	expect(document.activeElement).toBe(el);
	await userEvent.keyboard(" ");
	await expect.element(toggle).not.toBeChecked();
	await expect.poll(() => patternOf("2026-11-06")).toBe("none");
	await userEvent.keyboard(" ");
	await expect.element(toggle).toBeChecked();
});

test("no motion: cells have no transition or animation", async () => {
	await show([calendar()]);
	for (const el of [cellOf("2026-11-06")!, inner("2026-11-06")]) {
		const style = getComputedStyle(el);
		expect(style.transitionDuration).toBe("0s");
		expect(style.animationName).toBe("none");
	}
});

for (const theme of ["light", "dark"] as const) {
	test(`no axe violations in ${theme} mode`, async () => {
		document.documentElement.dataset.theme = theme;
		try {
			const widget = calendar("cal", { thresholds: [{ level: "moderate" }] });
			widget.data.timeSubRange = { start: "2026-11-05", end: "2026-11-06" };
			await show([widget]);
			const results = await axe.run(frame);
			expect(
				results.violations.flatMap((v) =>
					v.nodes.map((n) => `${v.id}: ${n.target} ${n.html.slice(0, 120)}`)
				)
			).toEqual([]);
		} finally {
			delete document.documentElement.dataset.theme;
		}
	});
}
