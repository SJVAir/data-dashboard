import { expect, test } from "vitest";
import type { QueryData, SeriesPoint } from "$lib/data/types";
import { sortRows, wideRows } from "./rows";

const pt = (t: number, mean: number, partial = false): SeriesPoint => ({
	t,
	mean,
	min: mean,
	max: mean,
	count: 1,
	partial
});

const data: QueryData = {
	series: [
		{ place: "monitor:a", points: [pt(1, 5), pt(2, 9), pt(3, 1, true)] },
		{ place: "monitor:b", points: [pt(2, 7), pt(4, 3)] }
	],
	places: [
		{ place: "monitor:a", name: "A" },
		{ place: "monitor:b", name: "B" }
	],
	resolution: "day",
	fromRaw: false,
	processor: null,
	fetchedAt: 0
};

test("two places with different missing periods give null cells", () => {
	const rows = wideRows(data);
	expect(rows.map((r) => r.t)).toEqual([1, 2, 3, 4]);
	expect(rows.map((r) => r.cells.map((c) => c?.mean ?? null))).toEqual([
		[5, null],
		[9, 7],
		[1, null],
		[null, 3]
	]);
	expect(rows.map((r) => r.partial)).toEqual([false, false, true, false]);
});

test("sorting by a place puts nulls last both ways", () => {
	const rows = wideRows(data);
	const mean = (r: ReturnType<typeof wideRows>) => r.map((x) => x.cells[1]?.mean ?? null);
	expect(mean(sortRows(rows, 1, "asc"))).toEqual([3, 7, null, null]);
	expect(mean(sortRows(rows, 1, "desc"))).toEqual([7, 3, null, null]);
});

test("sorting by date goes either way", () => {
	const rows = wideRows(data);
	expect(sortRows(rows, "t", "desc").map((r) => r.t)).toEqual([4, 3, 2, 1]);
	expect(sortRows(rows, "t", "asc").map((r) => r.t)).toEqual([1, 2, 3, 4]);
});
