import { nextPeriodStart, periodStart } from "$lib/format/range";
import type { Period } from "$lib/format/range";
import type { SeriesPoint } from "./types";

/**
 * Groups points by the Pacific period containing `t`. `mean` is count-weighted, `min`/`max`
 * span the parts (a missing one falls back to the part's mean), `count` is summed, and zero-count
 * points are skipped. A group is `partial` when its period has not ended by `now` or any input
 * point is partial.
 */
export function aggregate(
	points: SeriesPoint[],
	to: Period,
	now: Date = new Date()
): SeriesPoint[] {
	const groups = new Map<number, { sum: number; p: SeriesPoint }>();
	for (const point of points) {
		if (point.count === 0) continue;
		const t = periodStart(new Date(point.t), to).getTime();
		const min = Number.isFinite(point.min) ? point.min : point.mean;
		const max = Number.isFinite(point.max) ? point.max : point.mean;
		const g = groups.get(t);
		if (!g) {
			groups.set(t, {
				sum: point.mean * point.count,
				p: { ...point, t, min, max, partial: point.partial }
			});
			continue;
		}
		g.sum += point.mean * point.count;
		g.p.count += point.count;
		g.p.min = Math.min(g.p.min, min);
		g.p.max = Math.max(g.p.max, max);
		g.p.partial ||= point.partial;
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a - b)
		.map(([t, { sum, p }]) => ({
			...p,
			mean: sum / p.count,
			partial: p.partial || nextPeriodStart(new Date(t), to).getTime() > now.getTime()
		}));
}
