import type { QueryData, SeriesPoint } from "$lib/data/types";

/** One period: its start, whether any place's value is still incomplete, and a cell per place. */
export type TableRow = { t: number; partial: boolean; cells: Array<SeriesPoint | null> };

/**
 * Wide rows: one per period any place has, one cell per place in `data.places` order (`null`
 * where that place has no point), oldest first.
 */
export function wideRows(data: QueryData): TableRow[] {
	const byPlace = new Map(
		data.series.map((s) => [s.place, new Map(s.points.map((p) => [p.t, p]))])
	);
	const times = new Set<number>();
	for (const s of data.series) for (const p of s.points) times.add(p.t);
	return [...times]
		.sort((a, b) => a - b)
		.map((t) => {
			const cells = data.places.map((p) => byPlace.get(p.place)?.get(t) ?? null);
			return { t, partial: cells.some((c) => c?.partial), cells };
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
