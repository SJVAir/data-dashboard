import "../../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { readableColor } from "$lib/color";
import type { AdapterRequest, DatasetAdapter } from "$lib/data/adapters/registry";
import type { DailyFigure, Level, MetadataSource } from "$lib/data/metadata";
import { createQueryClient, type QueryClient } from "$lib/data/query/client";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { QueryData } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { addDays, pacificDay } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { PM25_LEVELS } from "../../shared/test-harness/fake-data";
import { component } from "./module";
import MonthCalendarWidget from "./MonthCalendarWidget.svelte";
import MonthHarness from "./test-harness/MonthHarness.svelte";

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

/** October all Moderate (Oct 15 not enough data); Nov 1–8 as below; today 19.9 so far. */
function figures(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (let d = "2026-10-01"; d <= "2026-10-31"; d = addDays(d, 1)) out[d] = 20;
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
/** Earlier days the server hasn't finalized. */
let pending: Set<string>;
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
					final: d !== "2026-11-09" && !pending.has(d)
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
	pending = new Set();
	levels = PM25_LEVELS;
	fake.metadata = fixtureMetadata({
		levels: async (entryType) => (entryType === "pm25" ? levels : []),
		dailyFigure: async (entryType) => (entryType === "pm25" ? FIGURE : null)
	});
	fake.client = createQueryClient({
		adapters: [adapter()],
		metadata: fake.metadata,
		regions: { resolve: async () => "unsupported" }
	});
	frame = document.createElement("div");
	frame.style.width = "480px";
	frame.style.height = "640px";
	document.body.appendChild(frame);
});

afterEach(() => {
	vi.useRealTimers();
	frame.remove();
});

const NOVEMBER = { kind: "custom" as const, start: "2026-11-01", end: "2026-11-30" };

function calendar(extra: Partial<WidgetInstance> = {}): WidgetInstance {
	return {
		id: "cal",
		type: MONTH_CALENDAR_TYPE,
		title: "November days",
		rect: { x: 0, y: 0, w: 4, h: 6 },
		data: {
			dateRange: NOVEMBER,
			layers: [{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "a" } }]
		},
		...extra
	};
}

/** A dashboard session holding `widget`, and the widget drawn from it. */
async function show(widget: WidgetInstance, opts: { session?: boolean; ready?: string } = {}) {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	let session: DocumentSession | null = null;
	if (opts.session !== false) {
		const id = await app.index.createBlank();
		const stored = (await platform.documents.get(app.space, id)) as Dashboard;
		await platform.documents.commit(app.space, {
			docId: id,
			baseVersion: stored.version,
			doc: { ...stored, body: { widgets: [widget] } },
			entries: []
		});
		session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
		app.current = { session, isStarter: false };
	} else {
		app.current = { session: null, isStarter: false };
	}
	const s = session;
	const read = () => (s ? s.doc.body.widgets.find((w) => w.id === widget.id)! : widget);
	const screen = await render(MonthHarness, {
		target: frame,
		props: { widget: read },
		context: new Map<unknown, unknown>([[APP_CONTEXT_KEY, app]])
	});
	await expect
		.poll(() => cellOf(opts.ready ?? "2026-11-01")?.dataset.kind, { timeout: 5000 })
		.toBe("rated");
	return { screen, session: s, read };
}

const cellOf = (date: string) => frame.querySelector<HTMLElement>(`[data-date="${date}"]`);
const inner = (date: string) => cellOf(date)!.querySelector<HTMLElement>("[data-cell]")!;
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim();
/** The words and short stand-ins actually showing. */
const visibleText = (date: string) =>
	[...inner(date).querySelectorAll<HTMLElement>("span")]
		.filter((s) => s.offsetParent !== null || getComputedStyle(s).position === "absolute")
		.map((s) => s.textContent!.trim());
const rgb = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const NOV_6_NAME = "Friday, November 6: 24-hour average 31.9 µg/m³, Moderate";

test("the module's component is the month calendar", () => {
	expect(component).toBe(MonthCalendarWidget);
});

test("a rated day: number, value, label, level color, outline, readable ink and its name", async () => {
	await show(calendar());
	const cell = cellOf("2026-11-06")!;
	expect(cell.getAttribute("role")).toBe("gridcell");
	await expect.element(page.elementLocator(cell)).toHaveAccessibleName(NOV_6_NAME);
	expect(visibleText("2026-11-06")).toEqual(["6", "31.9", "Moderate"]);
	const style = getComputedStyle(inner("2026-11-06"));
	expect(style.backgroundColor).toBe(rgb("#ffff00"));
	expect(style.color).toBe(rgb(readableColor("#ffff00")));
	expect(style.outlineStyle).toBe("solid");
	expect(style.outlineWidth).toBe("1px");
	expect(cell.querySelector("[data-name]")!.textContent).toBe(NOV_6_NAME);
	const grid = frame.querySelector("[role=grid]")!;
	expect(grid.getAttribute("aria-label")).toBe("November days");
	expect(grid.querySelector("[role=rowgroup]")?.getAttribute("aria-label")).toBe("November 2026");
	expect(grid.querySelectorAll("[role=columnheader]")).toHaveLength(7);
	expect(text(grid.querySelector("[role=columnheader]"))).toContain("Sunday");
});

test("with a threshold: the mark and 'at or above'; with a selection: 'selected'", async () => {
	const widget = calendar({ thresholds: [{ level: "moderate" }] });
	widget.data.timeSubRange = { start: "2026-11-06", end: "2026-11-06" };
	await show(widget);
	await expect
		.poll(() => cellOf("2026-11-06")!.querySelector("[data-name]")!.textContent)
		.toBe(`${NOV_6_NAME}, at or above Moderate, selected`);
	expect(inner("2026-11-06").querySelector("[data-mark]")?.textContent).toBe("▲");
	expect(inner("2026-11-01").querySelector("[data-mark]")).toBeNull();
	expect(cellOf("2026-11-05")!.querySelector("[data-name]")!.textContent).toBe(
		"Thursday, November 5: 24-hour average 20 µg/m³, Moderate, at or above Moderate"
	);
});

test("the other states: stripes, no data, today so far, not final yet, still to come", async () => {
	days["2026-11-03"] = null;
	delete days["2026-11-04"];
	pending.add("2026-11-08");
	await show(calendar());
	expect(inner("2026-11-03").classList).toContain("calendar-stripes");
	expect(visibleText("2026-11-03")).toEqual(["3", m.calendar_not_enough_data()]);
	expect(visibleText("2026-11-04")).toEqual(["4", "—", "No data"]);
	expect(cellOf("2026-11-04")!.querySelector("[data-name]")!.textContent).toBe(
		"Wednesday, November 4: No data"
	);
	const today = getComputedStyle(inner("2026-11-09"));
	expect(today.outlineStyle).toBe("dashed");
	expect(visibleText("2026-11-09")).toEqual(["9", "19.9", "Moderate · so far"]);
	expect(cellOf("2026-11-09")!.querySelector("[data-name]")!.textContent).toBe(
		"Monday, November 9: 24-hour average so far 19.9 µg/m³, Moderate"
	);
	expect(getComputedStyle(inner("2026-11-08")).outlineStyle).toBe("dashed");
	expect(visibleText("2026-11-08")).toEqual(["8", "…", "Not final yet"]);
	expect(visibleText("2026-11-20")).toEqual(["20"]);
	expect(cellOf("2026-11-20")!.querySelector("[data-name]")!.textContent).toBe(
		"Friday, November 20: Still to come"
	);
});

test("today with no value yet says No data so far", async () => {
	days["2026-11-09"] = null;
	await show(calendar());
	expect(visibleText("2026-11-09")).toEqual(["9", "No data so far"]);
});

test("a small calendar shows the level's tier number instead of its label", async () => {
	frame.style.width = "240px";
	await show(calendar());
	expect(visibleText("2026-11-06")).toEqual(["6", "31.9", "1"]);
	expect(visibleText("2026-11-01")).toEqual(["1", "5", "0"]);
	// The name still carries the label.
	expect(cellOf("2026-11-06")!.querySelector("[data-name]")!.textContent).toBe(NOV_6_NAME);
});

test("This month draws all 30 days, the ones after today still to come", async () => {
	const widget = calendar();
	widget.data.dateRange = { kind: "to-date", unit: "month" };
	await show(widget);
	const dated = frame.querySelectorAll<HTMLElement>("[data-date]");
	expect(dated).toHaveLength(30);
	for (const el of dated) {
		expect(el.dataset.kind === "future").toBe(el.dataset.date! > "2026-11-09");
	}
});

test("two months sit side by side, and stack at phone width", async () => {
	frame.style.width = "900px";
	const widget = calendar();
	widget.data.dateRange = { kind: "custom", start: "2026-10-01", end: "2026-11-30" };
	await show(widget);
	const [oct, nov] = [...frame.querySelectorAll("[role=rowgroup]")].map((g) =>
		g.getBoundingClientRect()
	);
	expect(nov.top).toBe(oct.top);
	expect(nov.left).toBeGreaterThan(oct.right);

	frame.style.width = "360px";
	await expect
		.poll(() => {
			const [a, b] = [...frame.querySelectorAll("[role=rowgroup]")].map((g) =>
				g.getBoundingClientRect()
			);
			return b.top >= a.bottom;
		})
		.toBe(true);
});

/** The selection saved on the widget. */
const saved = (read: () => WidgetInstance) => read().data.timeSubRange;

test("click, then Shift-click: one change each, the second saving the span", async () => {
	const { session, read } = await show(calendar());
	await userEvent.click(cellOf("2026-11-05")!);
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-05" });
	await userEvent.keyboard("{Shift>}");
	await userEvent.click(cellOf("2026-11-08")!);
	await userEvent.keyboard("{/Shift}");
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-08" });
	await expect.poll(() => cellOf("2026-11-07")!.dataset.selected).toBe("");
	expect(cellOf("2026-11-07")!.querySelector("[data-name]")!.textContent).toMatch(/, selected$/);
	session!.undo();
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-05" });
	session!.undo();
	expect(saved(read)).toBeUndefined();
	expect(session!.canUndo).toBe(false);
});

/** A tap or click on a day's cell, by synthetic pointer events. */
function tap(date: string, pointerType: "touch" | "mouse") {
	const el = cellOf(date)!;
	const r = el.getBoundingClientRect();
	const opts = {
		bubbles: true,
		pointerId: pointerType === "touch" ? 3 : 1,
		pointerType,
		button: 0,
		isPrimary: true,
		clientX: r.left + r.width / 2,
		clientY: r.top + r.height / 2
	};
	el.dispatchEvent(new PointerEvent("pointerdown", opts));
	el.dispatchEvent(new PointerEvent("pointerup", opts));
}

for (const pointerType of ["touch", "mouse"] as const) {
	test(`one pointer is enough (${pointerType}): a day, then another, selects the days between`, async () => {
		const { session, read } = await show(calendar());
		tap("2026-11-03", pointerType);
		expect(saved(read)).toEqual({ start: "2026-11-03", end: "2026-11-03" });
		tap("2026-11-07", pointerType);
		expect(saved(read)).toEqual({ start: "2026-11-03", end: "2026-11-07" });
		session!.undo();
		expect(saved(read)).toEqual({ start: "2026-11-03", end: "2026-11-03" });
		session!.redo();
		// Several days selected: the next tap starts again.
		tap("2026-11-05", pointerType);
		expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-05" });
		// Backwards works too.
		tap("2026-11-01", pointerType);
		expect(saved(read)).toEqual({ start: "2026-11-01", end: "2026-11-05" });
		tap("2026-11-08", pointerType);
		tap("2026-11-08", pointerType);
		expect(saved(read)).toBeUndefined();
	});
}

test("Shift-click extends from a stored selection's start, then keeps that anchor", async () => {
	const widget = calendar();
	widget.data.timeSubRange = { start: "2026-11-05", end: "2026-11-08" };
	const { read } = await show(widget);
	await userEvent.keyboard("{Shift>}");
	await userEvent.click(cellOf("2026-11-02")!);
	expect(saved(read)).toEqual({ start: "2026-11-02", end: "2026-11-05" });
	await userEvent.click(cellOf("2026-11-09")!);
	await userEvent.keyboard("{/Shift}");
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-09" });
});

test("a range across years names each day's year", async () => {
	const widget = calendar();
	widget.data.dateRange = { kind: "custom", start: "2025-12-01", end: "2026-01-31" };
	days = { "2025-12-05": 20 };
	await show(widget, { ready: "2025-12-05" });
	expect(cellOf("2025-12-05")!.querySelector("[data-name]")!.textContent).toBe(
		"Friday, December 5, 2025: 24-hour average 20 µg/m³, Moderate"
	);
});

test("the focused day draws above its neighbours, so its ring isn't covered", async () => {
	await show(calendar());
	const before = document.createElement("button");
	frame.prepend(before);
	before.focus();
	await userEvent.tab();
	const cell = cellOf("2026-11-09")!;
	expect(document.activeElement).toBe(cell);
	const style = getComputedStyle(cell);
	expect(style.position).toBe("relative");
	expect(style.zIndex).toBe("10");
	expect(getComputedStyle(cellOf("2026-11-08")!).zIndex).toBe("auto");
});

/** A pointer drag from one day's cell to another's, by synthetic pointer events. */
function drag(from: string, to: string) {
	const center = (el: Element) => {
		const r = el.getBoundingClientRect();
		return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
	};
	const opts = { bubbles: true, pointerId: 7, pointerType: "mouse", button: 0, isPrimary: true };
	const a = cellOf(from)!;
	const b = cellOf(to)!;
	a.dispatchEvent(new PointerEvent("pointerdown", { ...opts, ...center(a) }));
	b.dispatchEvent(new PointerEvent("pointermove", { ...opts, ...center(b) }));
	b.dispatchEvent(new PointerEvent("pointerup", { ...opts, ...center(b) }));
}

test("a drag past today stops at today, as one undo step", async () => {
	const { session, read } = await show(calendar());
	drag("2026-11-05", "2026-11-20");
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-09" });
	session!.undo();
	expect(saved(read)).toBeUndefined();
	expect(session!.canUndo).toBe(false);
});

test("a day still to come can't be picked", async () => {
	const { session, read } = await show(calendar());
	await userEvent.click(cellOf("2026-11-20")!);
	expect(saved(read)).toBeUndefined();
	expect(session!.canUndo).toBe(false);
});

test("clicking the only selected day clears it; so does Escape", async () => {
	const widget = calendar();
	widget.data.timeSubRange = { start: "2026-11-06", end: "2026-11-06" };
	const { read } = await show(widget);
	await userEvent.click(cellOf("2026-11-06")!);
	expect(saved(read)).toBeUndefined();

	await userEvent.click(cellOf("2026-11-02")!);
	await userEvent.keyboard("{Shift>}");
	await userEvent.click(cellOf("2026-11-04")!);
	await userEvent.keyboard("{/Shift}");
	expect(saved(read)).toEqual({ start: "2026-11-02", end: "2026-11-04" });
	await userEvent.keyboard("{Escape}");
	expect(saved(read)).toBeUndefined();
});

test("the keyboard: one Tab stop, arrows, Home/End, Page Up/Down, Space, Shift+arrows", async () => {
	const { read } = await show(calendar());
	const stops = () => [...frame.querySelectorAll("[data-date][tabindex='0']")];
	expect(stops()).toHaveLength(1);
	expect((stops()[0] as HTMLElement).dataset.date).toBe("2026-11-09");

	const before = document.createElement("button");
	frame.prepend(before);
	before.focus();
	await userEvent.tab();
	const focused = () => (document.activeElement as HTMLElement).dataset.date;
	expect(focused()).toBe("2026-11-09");

	await userEvent.keyboard("{ArrowLeft}");
	expect(focused()).toBe("2026-11-08");
	await userEvent.keyboard("{ArrowUp}");
	expect(focused()).toBe("2026-11-01");
	await userEvent.keyboard("{ArrowDown}");
	expect(focused()).toBe("2026-11-08");
	await userEvent.keyboard("{ArrowRight}");
	expect(focused()).toBe("2026-11-09");
	// Never past today.
	await userEvent.keyboard("{ArrowRight}");
	expect(focused()).toBe("2026-11-09");
	await userEvent.keyboard("{Home}");
	expect(focused()).toBe("2026-11-08");
	await userEvent.keyboard("{End}");
	expect(focused()).toBe("2026-11-09");
	await userEvent.keyboard("{PageUp}");
	// The range starts Nov 1.
	expect(focused()).toBe("2026-11-01");
	await userEvent.keyboard("{PageDown}");
	expect(focused()).toBe("2026-11-09");

	await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
	await userEvent.keyboard(" ");
	expect(saved(read)).toEqual({ start: "2026-11-07", end: "2026-11-07" });
	await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
	expect(saved(read)).toEqual({ start: "2026-11-07", end: "2026-11-08" });
	await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-07" });
	await userEvent.keyboard("{Enter}");
	expect(saved(read)).toEqual({ start: "2026-11-05", end: "2026-11-05" });
	expect(focused()).toBe("2026-11-05");

	// The focus ring (sky, outside the cell) isn't the selection ring (navy, inside).
	const cell = getComputedStyle(cellOf("2026-11-05")!);
	const ring = getComputedStyle(inner("2026-11-05"));
	expect(cell.outlineStyle).toBe("solid");
	expect(ring.boxShadow).toContain("inset");
	expect(ring.boxShadow).not.toContain(cell.outlineColor);
	expect(getComputedStyle(inner("2026-11-06")).boxShadow).toBe("none");
});

test("a shared view selects in memory and saves nothing", async () => {
	const widget = calendar();
	widget.data.timeSubRange = { start: "2026-11-06", end: "2026-11-06" };
	await show(widget, { session: false });
	expect(cellOf("2026-11-06")!.dataset.selected).toBe("");
	// One day selected: a click on another extends to it, in memory.
	await userEvent.click(cellOf("2026-11-02")!);
	await expect.poll(() => cellOf("2026-11-04")!.dataset.selected).toBe("");
	expect(cellOf("2026-11-06")!.dataset.selected).toBe("");
	expect(cellOf("2026-11-01")!.dataset.selected).toBeUndefined();
	expect(widget.data.timeSubRange).toEqual({ start: "2026-11-06", end: "2026-11-06" });
	await expect
		.poll(() => text(frame.querySelector("[data-calendar-summary]")))
		.toContain("Nov 2 – 6, 2026");
});

test("a read-only session also keeps the selection in memory", async () => {
	const { session, read } = await show(calendar());
	session!.readOnly = "newer";
	await userEvent.click(cellOf("2026-11-03")!);
	await expect.poll(() => cellOf("2026-11-03")!.dataset.selected).toBe("");
	expect(saved(read)).toBeUndefined();
});

test("no motion: day cells have no transition or animation", async () => {
	await show(calendar());
	for (const el of [cellOf("2026-11-06")!, inner("2026-11-06")]) {
		const style = getComputedStyle(el);
		expect(style.transitionDuration).toBe("0s");
		expect(style.animationName).toBe("none");
	}
});

for (const theme of ["light", "dark"] as const) {
	test(`no axe violations in ${theme} mode, a Moderate (yellow) day included`, async () => {
		document.documentElement.dataset.theme = theme;
		try {
			const widget = calendar({ thresholds: [{ level: "moderate" }] });
			widget.data.timeSubRange = { start: "2026-11-05", end: "2026-11-06" };
			days["2026-11-03"] = null;
			await show(widget);
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
