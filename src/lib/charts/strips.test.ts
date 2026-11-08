import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "$lib/data/types";
import { MIN_STRIP_HEIGHT, periodSpan, stripLayout, stripPointAt } from "./strips";

/** Pacific midnight on the first of a 2026 month (0-based): PDT (UTC-7) from April to November. */
const pacificMonth = (month: number) => Date.UTC(2026, month, 1, month >= 3 && month <= 10 ? 7 : 8);

function point(t: number, mean: number): SeriesPoint {
	return { t, mean, min: mean, max: mean, count: 1, partial: false };
}

describe("stripLayout", () => {
	it("the main chart keeps half with two strips", () => {
		const { main, strip, gap } = stripLayout(400, 2);
		expect(main).toBeGreaterThanOrEqual(200);
		expect(main + 2 * (strip + gap)).toBe(400);
	});

	it("strips share the rest equally", () => {
		for (const height of [240, 400, 517]) {
			for (const strips of [1, 2]) {
				const { main, strip, gap } = stripLayout(height, strips);
				expect(main + strips * (strip + gap)).toBe(height);
				expect(main).toBeGreaterThanOrEqual(height / 2);
				expect(strip).toBeGreaterThan(0);
			}
		}
	});

	it("no strips leaves the whole height to the main chart", () => {
		expect(stripLayout(300, 0)).toEqual({ main: 300, strip: 0, gap: 0 });
	});

	it("a short chart gives a strip at least the minimum when the main can still keep half", () => {
		const { main, strip } = stripLayout(160, 1);
		expect(strip).toBe(MIN_STRIP_HEIGHT);
		expect(main).toBeGreaterThanOrEqual(80);
	});

	it("below the minimum, strips still draw and the main keeps half", () => {
		const { main, strip } = stripLayout(120, 2);
		expect(strip).toBeGreaterThan(0);
		expect(strip).toBeLessThan(MIN_STRIP_HEIGHT);
		expect(main).toBe(60);
	});
});

describe("periodSpan", () => {
	it("a month bar spans its month", () => {
		// February (28 days, PST) and March (DST starts on the 8th, so 31 days less an hour).
		const feb = pacificMonth(1);
		const mar = pacificMonth(2);
		const apr = pacificMonth(3);
		expect(periodSpan(feb, "month")).toEqual([feb, mar]);
		expect(periodSpan(mar, "month")).toEqual([mar, apr]);
		expect(apr - mar).toBe(31 * 86_400_000 - 3_600_000);
	});

	it("a year bar spans its year", () => {
		const jan = pacificMonth(0);
		const next = Date.UTC(2027, 0, 1, 8);
		expect(periodSpan(jan, "year")).toEqual([jan, next]);
	});
});

describe("stripPointAt", () => {
	const feb = pacificMonth(1);
	const mar = pacificMonth(2);
	const points = [point(feb, 10), point(mar, 20)];

	it("a whole-period strip gives the period holding the time", () => {
		const strip = { points, resolution: "month" as const, wholePeriod: true };
		expect(stripPointAt(strip, feb + 15 * 86_400_000)?.mean).toBe(10);
		expect(stripPointAt(strip, mar)?.mean).toBe(20);
		expect(stripPointAt(strip, mar - 1)?.mean).toBe(10);
		expect(stripPointAt(strip, pacificMonth(3))).toBeNull();
	});

	it("a strip at the chart's resolution gives the point at that time only", () => {
		const strip = { points, resolution: "month" as const, wholePeriod: false };
		expect(stripPointAt(strip, mar)?.mean).toBe(20);
		expect(stripPointAt(strip, mar + 86_400_000)).toBeNull();
	});
});
