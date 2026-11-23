import { expect, test } from "vitest";
import { figureState, figureValues } from "./figure-values";
import type { QueryData, SeriesPoint } from "./types";

const pt = (t: number, mean: number, extra: Partial<SeriesPoint> = {}): SeriesPoint => ({
	t,
	mean,
	min: 1,
	max: 50,
	count: 24,
	partial: false,
	...extra
});

const data = (points: SeriesPoint[]): QueryData => ({
	series: [{ place: "monitor:a", points }],
	places: [{ place: "monitor:a", name: "A" }],
	resolution: "day",
	fromRaw: false,
	processor: null,
	fetchedAt: 0
});

test("a point's figure becomes its value; null is no value (NaN); min and max stay", () => {
	const out = figureValues(data([pt(1, 10, { figure: 32 }), pt(2, 12, { figure: null })]));
	const [a, b] = out.series[0].points;
	expect(a).toMatchObject({ mean: 32, min: 1, max: 50, figure: 32 });
	expect(b.mean).toBeNaN();
	expect(b.figure).toBeNull();
});

test("points without a figure keep the plain mean, and the data isn't copied", () => {
	const plain = data([pt(1, 10)]);
	expect(figureValues(plain)).toBe(plain);
});

test("a state without data is unchanged", () => {
	const loading = { status: "loading" as const };
	expect(figureState(loading)).toBe(loading);
	const ready = figureState({ status: "ready", data: data([pt(1, 10, { figure: 4 })]) });
	expect(ready.status === "ready" && ready.data.series[0].points[0].mean).toBe(4);
});
