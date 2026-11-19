import type { Resolution } from "$lib/data/schema";
import type { SeriesPoint } from "$lib/data/types";

/**
 * A number overlay drawn in its own strip under the main chart: the same dates, its own value
 * axis. `name` heads its legend row (the layer and its source); `label` and `unit` label its axis
 * and its readout line. Its points are at the main chart's resolution. `message`, when set, shows
 * in the strip's place instead of a plot (no data, or the layer failed), so the main chart is
 * never affected.
 */
export type ChartStrip = {
	name: string;
	label: string;
	unit: string;
	chart: "line" | "bar";
	precision: number | null;
	yMin: number | null;
	points: SeriesPoint[];
	resolution: Resolution;
	message?: string;
};

/** Space between the main chart and a strip, and between strips, in CSS px. */
export const STRIP_GAP = 6;
/** The height a strip gets when the main chart can still keep half. */
export const MIN_STRIP_HEIGHT = 48;

/**
 * Heights for the main chart and each of `strips` strips in `height` CSS px. Each strip (with
 * the gap above it) gets a quarter of the height, at least `MIN_STRIP_HEIGHT`, but never so much
 * that the main chart drops below half: below the minimum, strips still draw, smaller.
 */
export function stripLayout(
	height: number,
	strips: number
): { main: number; strip: number; gap: number } {
	if (strips <= 0) return { main: height, strip: 0, gap: 0 };
	const cap = Math.floor(height / 2 / strips);
	const slot = Math.min(Math.max(MIN_STRIP_HEIGHT + STRIP_GAP, Math.floor(height / 4)), cap);
	const strip = Math.max(slot - STRIP_GAP, 0);
	return { main: height - strips * (strip + STRIP_GAP), strip, gap: STRIP_GAP };
}

/** The strip's point for the main chart's period starting at `t`, or null when there is none. */
export function stripPointAt(strip: Pick<ChartStrip, "points">, t: number): SeriesPoint | null {
	return strip.points.find((p) => p.t === t) ?? null;
}
