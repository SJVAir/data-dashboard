import { describe, expect, it } from "vitest";
import { aggregate } from "./aggregate";
import type { SeriesPoint } from "./types";

const NOW = new Date("2026-10-22T19:00:00Z");
const pt = (t: string, mean: number, count: number, partial = false): SeriesPoint => ({
	t: new Date(t).getTime(),
	mean,
	min: mean - 1,
	max: mean + 1,
	count,
	partial
});

describe("aggregate", () => {
	it("weights by count", () => {
		const out = aggregate(
			[pt("2026-09-01T07:00:00Z", 10, 1), pt("2026-09-02T07:00:00Z", 20, 3)],
			"month",
			NOW
		);
		expect(out).toHaveLength(1);
		expect(out[0].mean).toBe(17.5);
		expect(out[0].count).toBe(4);
		expect(out[0].min).toBe(9);
		expect(out[0].max).toBe(21);
		expect(out[0].partial).toBe(false);
		expect(out[0].t).toBe(new Date("2026-09-01T07:00:00Z").getTime());
	});

	it("open month with missing today is still partial, not empty", () => {
		const points = Array.from({ length: 21 }, (_, i) =>
			pt(new Date(Date.UTC(2026, 9, 1 + i, 7)).toISOString(), 10 + i, 24)
		);
		const out = aggregate(points, "month", NOW);
		expect(out).toHaveLength(1);
		expect(out[0].partial).toBe(true);
		const sum = points.reduce((a, p) => a + p.mean * p.count, 0);
		expect(out[0].mean).toBeCloseTo(sum / (21 * 24));
	});

	it("any partial input makes the output partial", () => {
		const out = aggregate(
			[pt("2026-09-01T07:00:00Z", 1, 1), pt("2026-09-02T07:00:00Z", 1, 1, true)],
			"month",
			NOW
		);
		expect(out[0].partial).toBe(true);
	});

	it("skips zero-count points", () => {
		const out = aggregate(
			[pt("2026-09-01T07:00:00Z", 999, 0), pt("2026-09-02T07:00:00Z", 5, 2)],
			"month",
			NOW
		);
		expect(out[0].mean).toBe(5);
		expect(out[0].min).toBe(4);
		expect(aggregate([pt("2026-09-01T07:00:00Z", 1, 0)], "month", NOW)).toEqual([]);
	});

	it("groups 25 hours of a DST fall-back day into one point", () => {
		const start = Date.UTC(2026, 10, 1, 7); // Nov 1 00:00 PDT
		const points = Array.from({ length: 25 }, (_, i) =>
			pt(new Date(start + i * 3_600_000).toISOString(), 10, 2)
		);
		const out = aggregate(points, "day", NOW);
		expect(out).toHaveLength(1);
		expect(out[0].count).toBe(50);
		expect(out[0].t).toBe(start);
	});

	it("sorts groups by time", () => {
		const out = aggregate(
			[pt("2026-09-02T07:00:00Z", 1, 1), pt("2026-08-02T07:00:00Z", 1, 1)],
			"month",
			NOW
		);
		expect(out.map((p) => p.t)).toEqual([...out.map((p) => p.t)].sort((a, b) => a - b));
	});
});
