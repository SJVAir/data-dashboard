import { expect, test } from "vitest";
import type { SeriesPoint } from "$lib/data/types";
import { drawMarkers } from "./sticks";

const pt = (t: number, mean: number): SeriesPoint => ({
	t,
	mean,
	min: mean,
	max: mean,
	count: 1,
	partial: false
});

/** A canvas context that records where each dot is drawn (each shape starts with `beginPath`). */
function recorder() {
	const dots: number[] = [];
	let x = 0;
	const ctx = {
		save() {},
		restore() {},
		setLineDash() {},
		beginPath() {},
		arc(cx: number) {
			x = cx;
		},
		moveTo(mx: number) {
			x = mx;
		},
		lineTo() {},
		rect(rx: number) {
			x = rx;
		},
		closePath() {},
		fill() {},
		stroke() {
			dots.push(x);
		}
	} as unknown as CanvasRenderingContext2D;
	return { ctx, dots };
}

const at = { x: (i: number) => i * 10, y: (v: number) => v };
const style = { color: "c", background: "b", marker: "circle" as const, radius: 2, line: 1 };
const dense = { average: 1, min: 4 };

test("on a dense chart, a value between two not-enough-data points still gets its dot", () => {
	// The NaN neighbours are gaps in the line, so the points at 0 and 2 have no line to either side;
	// the points at 4 and 5 are joined by one.
	const { ctx, dots } = recorder();
	drawMarkers(
		ctx,
		[pt(0, 5), pt(1, NaN), pt(2, 7), pt(3, NaN), pt(4, 6), pt(5, 6)],
		at,
		style,
		dense
	);
	expect(dots).toEqual([0, 20]);
});

test("on a dense chart, points with real neighbours get no dot", () => {
	const { ctx, dots } = recorder();
	drawMarkers(ctx, [pt(0, 5), pt(1, 6), pt(2, 7)], at, style, dense);
	expect(dots).toEqual([]);
});
