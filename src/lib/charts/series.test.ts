import { describe, expect, it } from "vitest";
import type { QueryData, SeriesPoint } from "$lib/data/types";
import { alignSeries, chartXRange, seriesStyle } from "./series";

function fakeCss(): CSSStyleDeclaration {
	const vars: Record<string, string> = {
		"--chart-1": "c1",
		"--chart-2": "c2",
		"--chart-3": "c3",
		"--chart-4": "c4",
		"--chart-5": "c5"
	};
	return { getPropertyValue: (name: string) => ` ${vars[name] ?? ""}` } as CSSStyleDeclaration;
}

describe("seriesStyle", () => {
	it("reads --chart-1…5 in order", () => {
		const css = fakeCss();
		expect([0, 1, 2, 3, 4].map((i) => seriesStyle(i, css).color)).toEqual([
			"c1",
			"c2",
			"c3",
			"c4",
			"c5"
		]);
	});

	it("styles 0–4 differ in color and in dash or marker", () => {
		const styles = [0, 1, 2, 3, 4].map((i) => seriesStyle(i, fakeCss()));
		for (let a = 0; a < styles.length; a++) {
			for (let b = a + 1; b < styles.length; b++) {
				expect(styles[a].color).not.toBe(styles[b].color);
				const sameDash = styles[a].dash.join() === styles[b].dash.join();
				const sameMarker = styles[a].marker === styles[b].marker;
				expect(sameDash && sameMarker).toBe(false);
			}
		}
	});
});

const DAY_MS = 86_400_000;
// Pacific midnights in October 2026 (PDT, UTC-7).
const day = (d: number) => Date.UTC(2026, 9, d, 7);
const point = (t: number, mean: number): SeriesPoint => ({
	t,
	mean,
	min: mean,
	max: mean,
	count: 24,
	partial: false
});

function query(series: QueryData["series"], resolution: QueryData["resolution"]): QueryData {
	return {
		series,
		places: series.map((s) => ({ place: s.place, name: s.place })),
		resolution,
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
}

describe("alignSeries", () => {
	it("inserts null at a missing daily period so the line breaks", () => {
		const data = query([{ place: "a", points: [point(day(1), 1), point(day(3), 3)] }], "day");
		const aligned = alignSeries(data);
		expect(aligned.xs).toEqual([day(1), day(2), day(3)]);
		expect(aligned.points[0].map((p) => p?.mean ?? null)).toEqual([1, null, 3]);
	});

	it("steps across the fall-back day by Pacific days, not 24 h", () => {
		// 2026-11-01 is 25 hours long in Pacific time.
		const nov1 = Date.UTC(2026, 10, 1, 7);
		const nov3 = Date.UTC(2026, 10, 3, 8);
		const data = query([{ place: "a", points: [point(nov1, 1), point(nov3, 3)] }], "day");
		expect(alignSeries(data).xs).toEqual([nov1, Date.UTC(2026, 10, 2, 8), nov3]);
		expect(nov3 - nov1).not.toBe(2 * DAY_MS);
	});

	it("never gap-fills raw data", () => {
		const t0 = day(1);
		const data = query(
			[{ place: "a", points: [point(t0, 1), point(t0 + 120_000, 2), point(t0 + 7_200_000, 3)] }],
			"raw"
		);
		expect(alignSeries(data).xs).toEqual([t0, t0 + 120_000, t0 + 7_200_000]);
	});

	it("aligns several places on one x axis, in the order of data.places", () => {
		const data = query(
			[
				{ place: "b", points: [point(day(2), 20)] },
				{ place: "a", points: [point(day(1), 1), point(day(2), 2)] }
			],
			"day"
		);
		data.places = [
			{ place: "a", name: "A" },
			{ place: "b", name: "B" }
		];
		const aligned = alignSeries(data);
		expect(aligned.places).toEqual(["a", "b"]);
		expect(aligned.points[1].map((p) => p?.mean ?? null)).toEqual([null, 20]);
	});

	it("keeps at most five places", () => {
		const series = ["a", "b", "c", "d", "e", "f"].map((place) => ({
			place,
			points: [point(day(1), 1)]
		}));
		expect(alignSeries(query(series, "day")).places).toEqual(["a", "b", "c", "d", "e"]);
	});

	it("fills null periods across the whole range, before the first and after the last point", () => {
		const data = query([{ place: "a", points: [point(day(3), 3), point(day(4), 4)] }], "day");
		const aligned = alignSeries(data, { min: day(1), max: day(6) });
		expect(aligned.xs).toEqual([day(1), day(2), day(3), day(4), day(5), day(6)]);
		expect(aligned.points[0].map((p) => p?.mean ?? null)).toEqual([null, null, 3, 4, null, null]);
	});

	it("doesn't gap-fill raw data across the range", () => {
		const t0 = day(1);
		const data = query([{ place: "a", points: [point(t0 + 60_000, 1)] }], "raw");
		expect(alignSeries(data, { min: t0, max: day(2) }).xs).toEqual([t0 + 60_000]);
	});

	it("keeps unknown places after known ones, in a stable order", () => {
		const data = query(
			[
				{ place: "x", points: [point(day(1), 1)] },
				{ place: "y", points: [point(day(1), 2)] },
				{ place: "a", points: [point(day(1), 3)] }
			],
			"day"
		);
		data.places = [{ place: "a", name: "A" }];
		expect(alignSeries(data).places).toEqual(["a", "x", "y"]);
	});
});

describe("chartXRange", () => {
	// 2026-10-10 15:30 Pacific (PDT).
	const now = new Date(Date.UTC(2026, 9, 10, 22, 30));

	it("spans a trailing range from its first day to today's period", () => {
		const range = chartXRange({ kind: "trailing", amount: 30, unit: "day" }, undefined, "day", now);
		expect(range).toEqual({ min: Date.UTC(2026, 8, 11, 7), max: day(10) });
	});

	it("ends an hourly view at the current hour", () => {
		const range = chartXRange({ kind: "trailing", amount: 7, unit: "day" }, undefined, "hour", now);
		expect(range).toEqual({ min: day(4), max: Date.UTC(2026, 9, 10, 22) });
	});

	it("ends a past range at its last period", () => {
		const range = chartXRange(
			{ kind: "custom", start: "2026-01-01", end: "2026-03-31" },
			undefined,
			"month",
			now
		);
		expect(range).toEqual({ min: Date.UTC(2026, 0, 1, 8), max: Date.UTC(2026, 2, 1, 8) });
	});

	it("narrows to the time sub-range", () => {
		const range = chartXRange(
			{ kind: "trailing", amount: 30, unit: "day" },
			{ start: "2026-10-02", end: "2026-10-05" },
			"day",
			now
		);
		expect(range).toEqual({ min: day(2), max: day(5) });
	});

	it("is undefined for a range entirely in the future", () => {
		const range = chartXRange(
			{ kind: "custom", start: "2026-12-01", end: "2026-12-31" },
			undefined,
			"day",
			now
		);
		expect(range).toBeUndefined();
	});
});
