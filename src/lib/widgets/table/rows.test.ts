import { expect, test } from "vitest";
import type { Level } from "$lib/data/metadata";
import type { QueryData, SeriesPoint } from "$lib/data/types";
import { overlayColumns, sortRows, wideRows, type OverlayRows } from "./rows";

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

test("a figure with not enough data sorts last both ways, as no value does", () => {
	const thin = { ...pt(5, NaN), figure: null };
	const rows = wideRows({
		...data,
		series: [{ place: "monitor:a", points: [pt(1, 5), thin, pt(3, 1)] }],
		places: [{ place: "monitor:a", name: "A" }]
	});
	expect(sortRows(rows, 0, "asc").map((r) => r.t)).toEqual([3, 1, 5]);
	expect(sortRows(rows, 0, "desc").map((r) => r.t)).toEqual([1, 3, 5]);
});

test("sorting by date goes either way", () => {
	const rows = wideRows(data);
	expect(sortRows(rows, "t", "desc").map((r) => r.t)).toEqual([4, 3, 2, 1]);
	expect(sortRows(rows, "t", "asc").map((r) => r.t)).toEqual([1, 2, 3, 4]);
});

const BURN: Level[] = [
	{
		key: "discouraged",
		label: "Burning Discouraged",
		color: "#ffff00",
		opacity: null,
		tier: null,
		guidance: "",
		description: "",
		min: 0,
		max: null
	},
	{
		key: "registered",
		label: "No Burning Unless Registered",
		color: "#ff7e00",
		opacity: null,
		tier: null,
		guidance: "",
		description: "",
		min: 0,
		max: null
	}
];

const burn = (t: number, level: string): SeriesPoint => ({
	t,
	mean: NaN,
	min: NaN,
	max: NaN,
	count: 1,
	partial: false,
	level
});

test("overlay adds a labeled column per place", () => {
	const overlay: QueryData = {
		...data,
		// Matched to the main places by request order, not by key or series order.
		series: [
			{ place: "region:b", points: [burn(4, "discouraged")] },
			{
				place: "region:a",
				points: [burn(1, "registered"), burn(2, "discouraged"), burn(5, "registered")]
			}
		],
		places: [
			{ place: "region:a", name: "A" },
			{ place: "region:b", name: "B" }
		]
	};
	const columns = overlayColumns(data, [{ data: overlay, levels: BURN, kind: "level" }]);
	expect(columns.map((c) => [c.overlay, c.place.name, c.key])).toEqual([
		[0, "A", "region:a"],
		[0, "B", "region:b"]
	]);
	const rows = wideRows(data, [{ data: overlay, levels: BURN, kind: "level" }]);
	// A forecast day with no measurement still gets its row on a daily table.
	expect(rows.map((r) => r.t)).toEqual([1, 2, 3, 4, 5]);
	expect(rows.map((r) => r.overlays.map((l) => (l && "label" in l ? l.label : null)))).toEqual([
		["No Burning Unless Registered", null],
		["Burning Discouraged", null],
		[null, null],
		[null, "Burning Discouraged"],
		["No Burning Unless Registered", null]
	]);
	expect(rows[4].cells).toEqual([null, null]);
});

const DAY = 86_400_000;

test("a weather overlay column holds numbers", () => {
	const weather: QueryData = {
		...data,
		series: [
			{ place: "monitor:a", points: [pt(1, 0.12), pt(2, 0)] },
			{ place: "monitor:b", points: [pt(4, 0.4)] }
		],
		places: [
			{
				place: "monitor:a",
				name: "A",
				source: { id: "80", name: "Fresno State", distance: 4, inside: false }
			},
			{ place: "monitor:b", name: "B" }
		]
	};
	const overlays: OverlayRows[] = [{ data: weather, levels: [], kind: "number", aggregate: "sum" }];
	const columns = overlayColumns(data, overlays);
	expect(columns.map((c) => [c.place.name, c.info?.source?.id ?? null])).toEqual([
		["A", "80"],
		["B", null]
	]);
	const rows = wideRows(data, overlays);
	expect(rows.map((r) => r.t)).toEqual([1, 2, 3, 4]);
	expect(rows.map((r) => r.overlays.map((o) => (o && "mean" in o ? o.mean : null)))).toEqual([
		[0.12, null],
		[0, null],
		[null, null],
		[null, 0.4]
	]);
});

test("a monthly table has one row per month and a monthly pesticide value in its own row", () => {
	const nov = Date.parse("2026-11-01T08:00:00Z");
	const dec = Date.parse("2026-12-01T08:00:00Z");
	const main: QueryData = {
		...data,
		resolution: "month",
		series: [{ place: "monitor:a", points: [pt(nov, 5), pt(dec, 6)] }],
		places: [{ place: "monitor:a", name: "A" }]
	};
	const use: QueryData = {
		...main,
		series: [{ place: "monitor:a", points: [pt(nov, 1200)] }],
		places: [{ place: "monitor:a", name: "A", filters: ["Grapes"] }]
	};
	const overlays: OverlayRows[] = [{ data: use, levels: [], kind: "number", aggregate: "sum" }];
	const rows = wideRows(main, overlays);
	expect(rows.map((r) => r.t)).toEqual([nov, dec]);
	expect(
		rows.map((r) => (r.overlays[0] && "mean" in r.overlays[0] ? r.overlays[0].mean : null))
	).toEqual([1200, null]);
});

test("a daily table shows no monthly value repeated down its days", () => {
	const nov = Date.parse("2026-11-01T08:00:00Z");
	const main: QueryData = {
		...data,
		series: [{ place: "monitor:a", points: [pt(nov + DAY, 5), pt(nov + 2 * DAY, 5)] }],
		places: [{ place: "monitor:a", name: "A" }]
	};
	const use: QueryData = {
		...main,
		resolution: "month",
		series: [{ place: "monitor:a", points: [pt(nov, 1200)] }]
	};
	const rows = wideRows(main, [{ data: use, levels: [], kind: "number", aggregate: "sum" }]);
	expect(rows.map((r) => r.overlays[0])).toEqual([null, null]);
});
