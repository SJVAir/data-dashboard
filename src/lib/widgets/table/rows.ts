import type { Level } from "$lib/data/metadata";
import type { PlaceInfo, QueryData, SeriesPoint } from "$lib/data/types";
import { pairsByKey } from "../shared/overlays";

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
 * own place info (a weather layer's station, a pesticide layer's filters).
 */
export type OverlayColumn = {
	overlay: number;
	place: PlaceInfo;
	key: string;
	info: PlaceInfo | undefined;
};

/**
 * One column per main place per overlay, overlay by overlay. An overlay's places come in the
 * same request order as the main's, so they pair by index (a point's region can differ by
 * dataset); a monitor set's overlay is fetched for one of its monitors, so it pairs by key
 * (`pairsByKey`) and gives that monitor's column alone. Every overlay is fetched at the main's
 * resolution, so its periods are the main's.
 */
export function overlayColumns(data: QueryData, overlays: OverlayRows[]): OverlayColumn[] {
	return overlays.flatMap((o, overlay) => {
		const byKey = pairsByKey(data.places, o.data.places);
		return data.places.flatMap((place, i) => {
			const info = byKey ? o.data.places.find((p) => p.place === place.place) : o.data.places[i];
			return info === undefined ? [] : [{ overlay, place, key: info.place, info }];
		});
	});
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

	// Each column: the cell for a main period starting at `t`.
	const columns = overlayColumns(data, overlays).map((c) => {
		const { data: od, levels, kind } = overlays[c.overlay];
		const points = od.series.find((s) => s.place === c.key)?.points ?? [];
		if (kind === "number") {
			if (data.resolution === "day" && od.resolution === "day") {
				for (const p of points) times.add(p.t);
			}
			const byTime = new Map(points.map((p) => [p.t, p]));
			return (t: number) => byTime.get(t) ?? null;
		}
		const days = new Map(
			points.flatMap((p) => {
				const level = levels.find((l) => l.key === p.level);
				return level ? [[p.t, level] as const] : [];
			})
		);
		if (data.resolution === "day") for (const t of days.keys()) times.add(t);
		return (t: number) => days.get(t) ?? null;
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
/**
 * Rows ordered by date (`"t"`) or a place's value; periods with no value there (no point, or a
 * figure with not enough data) come last either way.
 */
export function sortRows(rows: TableRow[], column: "t" | number, dir: "asc" | "desc"): TableRow[] {
	const sign = dir === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => {
		if (column === "t") return sign * (a.t - b.t);
		const value = (r: TableRow) => {
			const v = r.cells[column]?.mean;
			return v !== undefined && Number.isFinite(v) ? v : undefined;
		};
		const x = value(a);
		const y = value(b);
		if (x === undefined && y === undefined) return a.t - b.t;
		if (x === undefined) return 1;
		if (y === undefined) return -1;
		return sign * (x - y) || a.t - b.t;
	});
}
