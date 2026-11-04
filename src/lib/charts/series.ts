import type { DateRangeSpec, Resolution, TimeSubRange } from "$lib/data/schema";
import { subRangeBounds } from "$lib/data/sub-range";
import { byPlaceOrder, type QueryData, type SeriesPoint } from "$lib/data/types";
import { nextPeriodStart, periodStart, resolveRange } from "$lib/format/range";

/** A Chart draws at most this many places, one per series color. */
export const MAX_CHART_PLACES = 5;

export type Marker = "circle" | "square" | "triangle" | "diamond" | "cross";

export type SeriesStyle = { color: string; dash: number[]; marker: Marker };

/** Dash patterns in CSS px; the first place is solid. */
const DASHES: number[][] = [[], [6, 3], [2, 3], [9, 3, 2, 3], [4, 2]];
const MARKERS: Marker[] = ["circle", "square", "triangle", "diamond", "cross"];

/** The i-th place's dash and marker, which differ for every place (color is never the only cue). */
export function seriesShape(i: number): Omit<SeriesStyle, "color"> {
	const n = i % MAX_CHART_PLACES;
	return { dash: DASHES[n], marker: MARKERS[n] };
}

/** Style for the i-th place: --chart-(i+1) read from CSS, plus a distinct dash and marker. */
export function seriesStyle(i: number, css: CSSStyleDeclaration): SeriesStyle {
	const n = i % MAX_CHART_PLACES;
	return { color: css.getPropertyValue(`--chart-${n + 1}`).trim(), ...seriesShape(n) };
}

export type AlignedSeries = {
	/** Shared x values (period starts, epoch ms), with every missing expected period included. */
	xs: number[];
	/** Place keys, in `data.places` order, at most `MAX_CHART_PLACES`. */
	places: string[];
	/** One row per place, aligned to `xs`; `null` where the place has no point (a gap). */
	points: (SeriesPoint | null)[][];
};

/** The time axis's extent in epoch ms, both ends inclusive (for a period resolution, both are
 *  period starts). */
export type XRange = { min: number; max: number };

/**
 * The time axis's extent for a widget's date range: the range (narrowed to `sub` when set) with
 * its end clipped to `now`. For a period resolution both ends are period starts, the last being
 * the period at or before now, so a partial period's dot sits at the edge. Undefined when nothing
 * of the range has happened yet.
 */
export function chartXRange(
	dateRange: DateRangeSpec,
	sub: TimeSubRange | undefined,
	resolution: Resolution,
	now: Date
): XRange | undefined {
	const r = resolveRange(dateRange, now);
	let from = r.start.getTime();
	// Exclusive.
	let to = Math.min(r.end.getTime(), now.getTime());
	if (sub) {
		const [a, b] = subRangeBounds(sub);
		from = Math.max(from, a);
		to = Math.min(to, b + 1);
	}
	if (to <= from) return undefined;
	if (resolution === "raw") return { min: from, max: to };
	return {
		min: periodStart(new Date(from), resolution).getTime(),
		max: periodStart(new Date(to - 1), resolution).getTime()
	};
}

/**
 * Puts every place's points on one x axis. For a regular resolution, each missing period start
 * between the first and last point (stepped with `nextPeriodStart`, so Pacific calendar rules
 * hold) is kept as `null`, so the line breaks there; with `range`, the missing periods from its
 * start to its end are kept too, so empty stretches before and after the data are explicit. Raw
 * data has no regular period and isn't gap-filled.
 */
export function alignSeries(data: QueryData, range?: XRange): AlignedSeries {
	const order = new Map(data.places.map((p, i) => [p.place, i]));
	const series = [...data.series].sort(byPlaceOrder(order)).slice(0, MAX_CHART_PLACES);

	const resolution = data.resolution;
	const anchors = range && resolution !== "raw" ? [range.min, range.max] : [];
	const times = [...new Set([...anchors, ...series.flatMap((s) => s.points.map((p) => p.t))])].sort(
		(a, b) => a - b
	);
	const xs: number[] = [];
	for (const t of times) {
		const last = xs.at(-1);
		if (resolution !== "raw" && last !== undefined) {
			let next = nextPeriodStart(new Date(last), resolution).getTime();
			while (next < t) {
				xs.push(next);
				next = nextPeriodStart(new Date(next), resolution).getTime();
			}
		}
		xs.push(t);
	}

	const index = new Map(xs.map((t, i) => [t, i]));
	const points = series.map((s) => {
		const row: (SeriesPoint | null)[] = xs.map(() => null);
		for (const p of s.points) row[index.get(p.t)!] = p;
		return row;
	});
	return { xs, places: series.map((s) => s.place), points };
}
