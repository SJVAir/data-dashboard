import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Level } from "$lib/data/metadata";
import type { QueryData, SeriesPoint } from "$lib/data/types";
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
		...(worst ? { worstHour: { t: threePm(Number(d)), value: mean + 10 } } : {})
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

async function renderChart(data: QueryData) {
	const names = new Map(data.places.map((p) => [p.place, p.name]));
	const screen = await render(TimeChart, {
		target: frame,
		props: { data, levels: LEVELS, unit: "µg/m³", placeNames: names }
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
		.toBe(9);
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
