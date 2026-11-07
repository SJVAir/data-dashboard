import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Level } from "$lib/data/metadata";
import type { QueryData, SeriesPoint } from "$lib/data/types";
import type { ChartStrip } from "./strips";
import TimeChart from "./TimeChart.svelte";

const LEVELS: Level[] = [
	{ key: "good", label: "Good", color: "#00e400", opacity: null, tier: 1, min: 0, max: 9 },
	{
		key: "moderate",
		label: "Moderate",
		color: "#ffff00",
		opacity: null,
		tier: 2,
		min: 9,
		max: 35.4
	},
	{
		key: "usg",
		label: "Unhealthy for Sensitive Groups",
		color: "#ff7e00",
		opacity: null,
		tier: 3,
		min: 35.4,
		max: 55.4
	},
	{
		key: "unhealthy",
		label: "Unhealthy",
		color: null,
		opacity: null,
		tier: 4,
		min: 55.4,
		max: null
	}
];

/** Pacific midnight of an October 2026 day (PDT, UTC-7). */
const day = (d: number) => Date.UTC(2026, 9, d, 7);
/** 3 PM Pacific on that day. */
const threePm = (d: number) => Date.UTC(2026, 9, d, 22);

function daily(means: Record<number, number>, worst: boolean, partialDay?: number): SeriesPoint[] {
	return Object.entries(means).map(([d, mean]) => ({
		t: day(Number(d)),
		mean,
		min: mean,
		max: mean,
		count: 24,
		partial: Number(d) === partialDay,
		// Day 1's worst hour equals its average, so it has no stick to draw.
		...(worst
			? { worstHour: { t: threePm(Number(d)), value: Number(d) === 1 ? mean : mean + 10 } }
			: {})
	}));
}

// Day 4 is missing (a gap); day 10 is today so far (partial).
const MEANS = { 1: 5, 2: 12, 3: 23.4, 5: 40, 6: 60, 7: 30, 8: 8, 9: 15, 10: 20 };

function oneplace(): QueryData {
	return {
		series: [{ place: "region:county:06019", points: daily(MEANS, true, 10) }],
		places: [{ place: "region:county:06019", name: "Fresno County" }],
		resolution: "day",
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
}

function twoPlaces(): QueryData {
	return {
		series: [
			{ place: "monitor:a", points: daily(MEANS, false) },
			{ place: "monitor:b", points: daily({ 1: 7, 2: 9, 3: 11, 5: 13 }, false) }
		],
		places: [
			{ place: "monitor:a", name: "Monitor A" },
			{ place: "monitor:b", name: "Monitor B" }
		],
		resolution: "day",
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
}

let frame: HTMLDivElement;

beforeEach(async () => {
	await page.viewport(1280, 800);
	frame = document.createElement("div");
	frame.style.width = "640px";
	frame.style.height = "420px";
	frame.className = "bg-card text-card-foreground";
	document.body.appendChild(frame);
});

afterEach(() => {
	frame.remove();
	document.documentElement.removeAttribute("data-theme");
});

async function renderChart(
	data: QueryData,
	extra: { precision?: number | null; strips?: ChartStrip[]; mainChart?: "line" | "bar" } = {}
) {
	const names = new Map(data.places.map((p) => [p.place, p.name]));
	const screen = await render(TimeChart, {
		target: frame,
		props: { data, levels: LEVELS, unit: "µg/m³", placeNames: names, ...extra }
	});
	const chart = screen.getByRole("group", { name: /Fresno County|Monitor A/ });
	await expect.element(chart).toBeVisible();
	await expect.poll(() => frame.querySelector("canvas")).not.toBeNull();
	return { screen, chart };
}

/** Hovers the plot at the Pacific day `d` (days 1–10 span the x axis). */
async function hoverDay(d: number) {
	const over = frame.querySelector(".u-over") as HTMLElement;
	const rect = over.getBoundingClientRect();
	const x = ((day(d) - day(1)) / (day(10) - day(1))) * rect.width;
	await userEvent.hover(page.elementLocator(over), {
		position: { x: Math.min(Math.max(x, 1), rect.width - 1), y: rect.height / 2 }
	});
}

const readout = () => frame.querySelector("[aria-live='polite']") as HTMLElement;

test("the level key lists every full level name with outlined swatches", async () => {
	const { screen } = await renderChart(oneplace());
	const key = screen.getByRole("list", { name: "Levels" });
	for (const level of LEVELS) {
		await expect.element(key.getByText(level.label, { exact: true })).toBeVisible();
	}
	const chips = key.element().querySelectorAll("[data-swatch-chip]");
	expect(chips).toHaveLength(4);
	for (const chip of chips) {
		expect(getComputedStyle(chip).outlineStyle).toBe("solid");
	}
});

test("hovering a day shows its date, value with unit, level, and worst hour", async () => {
	await renderChart(oneplace());
	await hoverDay(3);
	await expect.poll(() => readout().textContent).toContain("Oct 3, 2026");
	const text = readout().textContent!;
	expect(text).toContain("23.4 µg/m³");
	expect(text).toContain("Moderate");
	expect(text).toMatch(/Worst hour 33\.4 µg\/m³, 3\s*–\s*4\sPM( PT)?/);
});

test("the readout shows values with the catalog's precision", async () => {
	await renderChart(oneplace(), { precision: 1 });
	await hoverDay(5);
	await expect.poll(() => readout().textContent).toContain("Oct 5, 2026");
	const text = readout().textContent!;
	expect(text).toContain("40.0 µg/m³");
	expect(text).toMatch(/Worst hour 50\.0 µg\/m³/);
});

test("new data keeps the chart and the keyboard's place in it", async () => {
	const { screen, chart } = await renderChart(oneplace());
	const canvas = frame.querySelector("canvas");
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	await userEvent.keyboard("{ArrowRight}");
	await userEvent.keyboard("{ArrowRight}");
	await expect.poll(() => readout().textContent).toContain("Oct 3, 2026");
	// The next poll: today's value has grown, and day 3 was revised.
	const next = oneplace();
	next.series[0].points = daily({ ...MEANS, 3: 24.5, 10: 21 }, true, 10);
	await screen.rerender({ data: next });
	await expect.poll(() => readout().textContent).toContain("24.5 µg/m³");
	expect(readout().textContent).toContain("Oct 3, 2026");
	expect(frame.querySelector("canvas")).toBe(canvas);
	expect(document.activeElement).toBe(chart.element());
	await userEvent.keyboard("{ArrowRight}");
	await expect.poll(() => readout().textContent).toContain("Oct 5, 2026");
});

test("arrow keys step through points, skipping gaps, and End jumps to the last", async () => {
	const { chart } = await renderChart(oneplace());
	await hoverDay(3);
	await expect.poll(() => readout().textContent).toContain("Oct 3, 2026");
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{ArrowRight}");
	await expect.poll(() => readout().textContent).toContain("Oct 5, 2026");
	await userEvent.keyboard("{End}");
	await expect.poll(() => readout().textContent).toContain("Oct 10, 2026");
	expect(readout().textContent).toContain("so far");
	await userEvent.keyboard("{Home}");
	await expect.poll(() => readout().textContent).toContain("Oct 1, 2026");
	expect(readout().textContent).toContain("Good");
});

test("a single place draws worst-hour sticks", async () => {
	const { screen } = await renderChart(oneplace());
	await expect
		.poll(() => Number(frame.querySelector("[data-sticks]")?.getAttribute("data-sticks")))
		.toBe(8);
	await expect.element(screen.getByText("Worst hour", { exact: true })).toBeVisible();
});

test("two places get two series styles and no sticks", async () => {
	const { screen } = await renderChart(twoPlaces());
	const keys = screen.getByRole("list", { name: "Series" });
	await expect.element(keys.getByText("Monitor A")).toBeVisible();
	await expect.element(keys.getByText("Monitor B")).toBeVisible();
	const samples = [...keys.element().querySelectorAll("[data-series-sample]")] as SVGElement[];
	expect(samples).toHaveLength(2);
	const [a, b] = samples.map((s) => ({
		color: getComputedStyle(s).color,
		marker: s.getAttribute("data-marker"),
		dash: s.getAttribute("data-dash")
	}));
	expect(a.color).not.toBe(b.color);
	expect(a.marker !== b.marker || a.dash !== b.dash).toBe(true);
	await expect
		.poll(() => frame.querySelector("[data-sticks]")?.getAttribute("data-sticks"))
		.toBe("0");
	await expect.element(screen.getByText("Worst hour", { exact: true })).not.toBeInTheDocument();
});

test("axe passes in light and dark", async () => {
	await renderChart(oneplace());
	await hoverDay(3);
	await expect.poll(() => readout().textContent).toContain("Oct 3, 2026");
	expect((await axe.run(frame)).violations).toEqual([]);
	document.documentElement.setAttribute("data-theme", "dark");
	expect((await axe.run(frame)).violations).toEqual([]);
});

const canvasWidth = () => (frame.querySelector("canvas") as HTMLCanvasElement).width;

test("a resize animation redraws once, after it ends", async () => {
	await renderChart(oneplace());
	const before = canvasWidth();
	const host = frame.querySelector("[role='group']")!.parentElement!;
	const animation = host.animate([{ width: "640px" }, { width: "400px" }], {
		duration: 300,
		fill: "forwards"
	});
	// Mid-animation the box has shrunk, but the chart hasn't redrawn yet.
	await new Promise((r) => setTimeout(r, 120));
	expect(frame.getBoundingClientRect().width).toBeLessThan(640);
	expect(canvasWidth()).toBe(before);
	await animation.finished;
	await expect.poll(canvasWidth).toBeLessThan(before);
	animation.cancel();
});

test("an endless ancestor animation doesn't hold back resize redraws", async () => {
	await renderChart(oneplace());
	const before = canvasWidth();
	const spinner = frame.animate([{ opacity: 1 }, { opacity: 1 }], {
		duration: 1000,
		iterations: Infinity
	});
	try {
		frame.style.width = "400px";
		await expect.poll(canvasWidth).toBeLessThan(before);
	} finally {
		spinner.cancel();
	}
});

test("under reduced motion a resize redraws at once", async () => {
	await commands.setReducedMotion(true);
	try {
		await renderChart(oneplace());
		const before = canvasWidth();
		frame.style.width = "400px";
		await expect.poll(canvasWidth).toBeLessThan(before);
	} finally {
		await commands.setReducedMotion(null);
	}
});

/** A daily strip over days 1–10 (no day 4), at the main chart's resolution. */
function dailyStrip(extra: Partial<ChartStrip> = {}): ChartStrip {
	const means: Record<number, number> = { 1: 0.12, 2: 0, 3: 0.4, 5: 1.25, 6: 0, 7: 0, 8: 0.5 };
	return {
		name: "Precipitation · CIMIS #80 Fresno State (4.2 mi away)",
		label: "Precipitation",
		unit: "in",
		chart: "bar",
		precision: 2,
		yMin: 0,
		points: daily(means, false),
		resolution: "day",
		wholePeriod: false,
		...extra
	};
}

const temperature = () =>
	dailyStrip({
		name: "Temperature · CIMIS #80 Fresno State (4.2 mi away)",
		label: "Temperature",
		unit: "°F",
		chart: "line",
		precision: 1,
		yMin: null,
		points: daily({ 1: 61.2, 2: 63, 3: 64.5, 5: 60, 6: 58.25 }, false)
	});

const strips = () => [...frame.querySelectorAll<HTMLElement>("[data-strip]")];

test("a strip draws under the main plot with its axis label", async () => {
	const { screen } = await renderChart(oneplace(), { strips: [dailyStrip()] });
	await expect.element(screen.getByText("Precipitation (in)", { exact: true })).toBeVisible();
	await expect.poll(() => strips()[0]?.querySelector("canvas")).not.toBeNull();
	// Once laid out, the strip's plot sits under the main one's.
	const box = (el: Element | null) => el!.getBoundingClientRect();
	await expect
		.poll(
			() => box(strips()[0].querySelector("canvas")).top - box(frame.querySelector("canvas")).bottom
		)
		.toBeGreaterThanOrEqual(0);
	// The same time axis: the plot areas line up.
	const overs = [...frame.querySelectorAll<HTMLElement>(".u-over")].map((o) =>
		o.getBoundingClientRect()
	);
	expect(overs).toHaveLength(2);
	expect(overs[1].left).toBeCloseTo(overs[0].left, 0);
	expect(overs[1].width).toBeCloseTo(overs[0].width, 0);
	// The legend names the layer and its source, with the mark's shape.
	const sample = screen
		.getByText("Precipitation · CIMIS #80 Fresno State (4.2 mi away)")
		.element()
		.parentElement!.querySelector("[data-strip-sample]")!;
	expect(sample.getAttribute("data-shape")).toBe("bar");
});

test("bar strips for bar entry types, a line for line ones", async () => {
	await renderChart(oneplace(), { strips: [dailyStrip(), temperature()] });
	await expect.poll(() => strips().map((s) => s.getAttribute("data-bars"))).toEqual(["7", "0"]);
	expect(strips().map((s) => s.getAttribute("data-strip"))).toEqual(["bar", "line"]);
	const shapes = [...frame.querySelectorAll("[data-strip-sample]")].map((s) =>
		s.getAttribute("data-shape")
	);
	expect(shapes).toEqual(["bar", "line"]);
});

test("the readout shows each strip's value at the cursor", async () => {
	const { chart } = await renderChart(oneplace(), { strips: [dailyStrip(), temperature()] });
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	await expect.poll(() => readout().textContent).toContain("Oct 1, 2026");
	expect(readout().textContent).toContain("Precipitation: 0.12 in");
	expect(readout().textContent).toContain("Temperature: 61.2 °F");
	await userEvent.keyboard("{End}");
	await expect.poll(() => readout().textContent).toContain("Oct 10, 2026");
	expect(readout().textContent).toContain("Precipitation: No data");
});

test("a coarser strip draws one bar per month and marks the whole-month total", async () => {
	const sept = Date.UTC(2026, 8, 1, 7);
	const oct = Date.UTC(2026, 9, 1, 7);
	const strip = dailyStrip({
		name: "Pounds Applied · Monitor A",
		label: "Pounds Applied",
		unit: "lbs",
		precision: 0,
		resolution: "month",
		wholePeriod: true,
		points: [
			{ t: sept, mean: 900, min: 900, max: 900, count: 1, partial: false },
			{ t: oct, mean: 1234, min: 1234, max: 1234, count: 1, partial: false }
		]
	});
	const { screen, chart } = await renderChart(oneplace(), { strips: [strip] });
	await expect.element(screen.getByText("Monthly total", { exact: true })).toBeVisible();
	// September lies wholly before the chart's days, so only October's bar is drawn.
	await expect.poll(() => strips()[0]?.getAttribute("data-bars")).toBe("1");
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	await expect.poll(() => readout().textContent).toContain("Oct 1, 2026");
	expect(readout().textContent).toContain("Pounds Applied: 1,234 lbs");
	expect(readout().textContent).toContain("Total for all of Oct 2026");
	await userEvent.keyboard("{End}");
	await expect.poll(() => readout().textContent).toContain("Oct 10, 2026");
	expect(readout().textContent).toContain("Pounds Applied: 1,234 lbs");
});

test("a strip with a message shows it in the strip's place", async () => {
	const { screen } = await renderChart(oneplace(), {
		strips: [dailyStrip({ points: [], message: "No pesticide use reported for these dates." })]
	});
	await expect
		.element(screen.getByText("No pesticide use reported for these dates."))
		.toBeVisible();
	await expect.element(screen.getByText("Precipitation (in)", { exact: true })).toBeVisible();
	expect(strips()[0].querySelector("canvas")).toBeNull();
});

test("a pesticide-only chart draws bars as the main chart", async () => {
	const months = [Date.UTC(2026, 7, 1, 7), Date.UTC(2026, 8, 1, 7), Date.UTC(2026, 9, 1, 7)];
	const data: QueryData = {
		series: [
			{
				place: "region:county:06019",
				points: months.map((t, i) => ({
					t,
					mean: [1200, 0, 340][i],
					min: 0,
					max: 0,
					count: 1,
					partial: false
				}))
			}
		],
		places: [{ place: "region:county:06019", name: "Fresno County" }],
		resolution: "month",
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
	const names = new Map([["region:county:06019", "Fresno County"]]);
	const screen = await render(TimeChart, {
		target: frame,
		props: { data, levels: [], unit: "lbs", placeNames: names, mainChart: "bar", precision: 0 }
	});
	const chart = screen.getByRole("group", { name: "Chart of Fresno County" });
	await expect.element(chart).toHaveAttribute("data-bars", "3");
	const sample = frame.querySelector("[data-series-sample]")!;
	expect(sample.getAttribute("data-shape")).toBe("bar");
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{End}");
	await expect.poll(() => readout().textContent).toContain("Oct 2026");
	expect(readout().textContent).toContain("340 lbs");
});

test("strips pass axe in light and dark", async () => {
	const { chart } = await renderChart(oneplace(), { strips: [dailyStrip(), temperature()] });
	(chart.element() as HTMLElement).focus();
	await userEvent.keyboard("{Home}");
	await expect.poll(() => readout().textContent).toContain("Precipitation: 0.12 in");
	expect((await axe.run(frame)).violations).toEqual([]);
	document.documentElement.setAttribute("data-theme", "dark");
	expect((await axe.run(frame)).violations).toEqual([]);
});
