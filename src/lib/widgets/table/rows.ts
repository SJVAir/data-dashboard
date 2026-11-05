import type { Level } from "$lib/data/metadata";
import type { PlaceInfo, QueryData, SeriesPoint } from "$lib/data/types";
import { periodStart } from "$lib/format/range";

/**
 * One period: its start, whether any place's value is still incomplete, a cell per place, and an
 * overlay level per `overlayColumns` column (`null` where that day has none).
 */
export type TableRow = {
	t: number;
	partial: boolean;
	cells: Array<SeriesPoint | null>;
	overlays: Array<Level | null>;
};

/** An overlay's day values (one series per main place, in the same request order) and scale. */
export type OverlayRows = { data: QueryData; levels: Level[] };

/** An overlay column: which overlay, the main place it's for, and that overlay's series key. */
export type OverlayColumn = { overlay: number; place: PlaceInfo; key: string };

/** Day values only line up with periods no longer than a day. */
function byDay(data: QueryData): boolean {
	return data.resolution === "raw" || data.resolution === "hour" || data.resolution === "day";
}

/**
 * One column per main place per overlay, overlay by overlay. An overlay's places come in the
 * same request order as the main's, so they pair by index (a point's region can differ by
 * dataset). None when the main's periods are longer than a day.
 */
export function overlayColumns(data: QueryData, overlays: OverlayRows[]): OverlayColumn[] {
	if (!byDay(data)) return [];
	return overlays.flatMap((o, overlay) =>
		data.places.flatMap((place, i) => {
			const key = o.data.places[i]?.place;
			return key === undefined ? [] : [{ overlay, place, key }];
		})
	);
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

	const columns = overlayColumns(data, overlays).map((c) => {
		const { data: od, levels } = overlays[c.overlay];
		const points = od.series.find((s) => s.place === c.key)?.points ?? [];
		const days = new Map(
			points.flatMap((p) => {
				const level = levels.find((l) => l.key === p.level);
				return level ? [[p.t, level] as const] : [];
			})
		);
		if (data.resolution === "day") for (const t of days.keys()) times.add(t);
		return days;
	});

	return [...times]
		.sort((a, b) => a - b)
		.map((t) => {
			const cells = data.places.map((p) => byPlace.get(p.place)?.get(t) ?? null);
			const day = data.resolution === "day" ? t : periodStart(new Date(t), "day").getTime();
			return {
				t,
				partial: cells.some((c) => c?.partial),
				cells,
				overlays: columns.map((days) => days.get(day) ?? null)
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
