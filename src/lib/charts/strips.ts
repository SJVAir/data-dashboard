import type { Resolution } from "$lib/data/schema";
import type { SeriesPoint } from "$lib/data/types";
import { nextPeriodStart } from "$lib/format/range";

/**
 * A number overlay drawn in its own strip under the main chart: the same dates, its own value
 * axis. `name` heads its legend row (the layer and its source); `label` and `unit` label its axis
 * and its readout line. `wholePeriod` is set when the strip is coarser than the main chart (a
 * month's pesticide total under a daily chart): each point is then one bar from its period's
 * start to the next period's start. `message`, when set, shows in the strip's place instead of a
 * plot (no data, or the layer failed), so the main chart is never affected.
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
	wholePeriod: boolean;
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

/** The period starting at `t` as `[start, next start)` in epoch ms (Pacific calendar). */
export function periodSpan(t: number, resolution: Resolution): [number, number] {
	if (resolution === "raw") return [t, t];
	return [t, nextPeriodStart(new Date(t), resolution).getTime()];
}

/**
 * The strip's point for the main chart's period starting at `t`: for a whole-period strip, the
 * point whose period holds `t`; otherwise the point at `t` (the strip has the chart's
 * resolution). Null when there is none.
 */
export function stripPointAt(
	strip: Pick<ChartStrip, "points" | "resolution" | "wholePeriod">,
	t: number
): SeriesPoint | null {
	if (!strip.wholePeriod) return strip.points.find((p) => p.t === t) ?? null;
	return (
		strip.points.find((p) => {
			const [start, end] = periodSpan(p.t, strip.resolution);
			return start <= t && t < end;
		}) ?? null
	);
}
