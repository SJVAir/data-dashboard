import type { Level } from "$lib/data/metadata";
import type { Resolution } from "$lib/data/schema";
import type { PlaceInfo, QueryData, SeriesPoint } from "$lib/data/types";
import { periodSpan } from "$lib/charts/strips";
import { periodStart } from "$lib/format/range";

/**
 * One period: its start, whether any place's value is still incomplete, a cell per place, and an
 * overlay cell per `overlayColumns` column: a level (band overlays) or the point (number
 * overlays), `null` where that period has none.
 */
export type TableRow = {
	t: number;
	partial: boolean;
	cells: Array<SeriesPoint | null>;
	overlays: Array<Level | SeriesPoint | null>;
};

/**
 * An overlay's values (one series per main place, in the same request order). A `level` overlay
 * has day levels on its `levels` scale; a `number` overlay has points. `aggregate` is the entry
 * type's, which says whether a coarser point is a total.
 */
export type OverlayRows = {
	data: QueryData;
	levels: Level[];
	kind: "level" | "number";
	aggregate?: "sum" | "mean" | null;
};

/**
 * An overlay column: which overlay, the main place it's for, that overlay's series key and its
 * own place info (a weather layer's station, a pesticide layer's filters). `whole` is the
 * overlay's resolution when it is coarser than the main's (a month's pesticide use under daily
 * rows): each of its cells then repeats one value for the whole period.
 */
export type OverlayColumn = {
	overlay: number;
	place: PlaceInfo;
	key: string;
	info: PlaceInfo | undefined;
	whole: Resolution | null;
};

/** Day values only line up with periods no longer than a day. */
export function byDay(data: QueryData): boolean {
	return data.resolution === "raw" || data.resolution === "hour" || data.resolution === "day";
}

/**
 * One column per main place per overlay, overlay by overlay. An overlay's places come in the
 * same request order as the main's, so they pair by index (a point's region can differ by
 * dataset). A level overlay has none when the main's periods are longer than a day; a number
 * overlay is pinned to the main's resolution (or the nearest coarser one), so it always lines up.
 */
export function overlayColumns(data: QueryData, overlays: OverlayRows[]): OverlayColumn[] {
	return overlays.flatMap((o, overlay) => {
		if (o.kind === "level" && !byDay(data)) return [];
		const whole = o.kind === "number" && o.data.resolution !== data.resolution;
		return data.places.flatMap((place, i) => {
			const info = o.data.places[i];
			return info === undefined
				? []
				: [{ overlay, place, key: info.place, info, whole: whole ? o.data.resolution : null }];
		});
	});
}

/** A number overlay column's lookup: the point for a main period starting at `t`. */
function pointAt(points: SeriesPoint[], resolution: Resolution, whole: boolean) {
	if (!whole) {
		const byTime = new Map(points.map((p) => [p.t, p]));
		return (t: number) => byTime.get(t) ?? null;
	}
	const spans = points.map((p) => [periodSpan(p.t, resolution), p] as const);
	return (t: number) => spans.find(([[start, end]]) => start <= t && t < end)?.[1] ?? null;
}

/**
 * Wide rows: one per period any place has, one cell per place in `data.places` order (`null`
 * where that place has no point), oldest first. On a daily table, an overlay's days add rows too
 * (a forecast day with no measurement yet), so every overlay value has a row.
 */
export function wideRows(data: QueryData, overlays: OverlayRows[] = []): TableRow[] {
	const byPlace = new Map(
		data.series.map((s) => [s.place, new Map(s.points.map((p) => [p.t, p]))])
	);
	const times = new Set<number>();
	for (const s of data.series) for (const p of s.points) times.add(p.t);

	// Each column: the cell for a main period starting at `t`, and for a level overlay, which
	// day it is (a level is a day's, so an hourly row takes its day's).
	const columns = overlayColumns(data, overlays).map((c) => {
		const { data: od, levels, kind } = overlays[c.overlay];
		const points = od.series.find((s) => s.place === c.key)?.points ?? [];
		if (kind === "number") {
			if (data.resolution === "day" && od.resolution === "day") {
				for (const p of points) times.add(p.t);
			}
			const find = pointAt(points, od.resolution, c.whole !== null);
			return (t: number) => find(t);
		}
		const days = new Map(
			points.flatMap((p) => {
				const level = levels.find((l) => l.key === p.level);
				return level ? [[p.t, level] as const] : [];
			})
		);
		if (data.resolution === "day") for (const t of days.keys()) times.add(t);
		return (t: number) =>
			days.get(data.resolution === "day" ? t : periodStart(new Date(t), "day").getTime()) ?? null;
	});

	return [...times]
		.sort((a, b) => a - b)
		.map((t) => {
			const cells = data.places.map((p) => byPlace.get(p.place)?.get(t) ?? null);
			return {
				t,
				partial: cells.some((c) => c?.partial),
				cells,
				overlays: columns.map((find) => find(t))
			};
		});
}
/** Rows ordered by date (`"t"`) or a place's mean; periods with no value there come last either way. */
export function sortRows(rows: TableRow[], column: "t" | number, dir: "asc" | "desc"): TableRow[] {
	const sign = dir === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => {
		if (column === "t") return sign * (a.t - b.t);
		const x = a.cells[column]?.mean;
		const y = b.cells[column]?.mean;
		if (x === undefined && y === undefined) return a.t - b.t;
		if (x === undefined) return 1;
		if (y === undefined) return -1;
		return sign * (x - y) || a.t - b.t;
	});
}
