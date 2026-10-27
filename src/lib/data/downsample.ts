import { nextPeriodStart, periodStart } from "$lib/format/range";
import type { Period } from "$lib/format/range";
import type { SeriesPoint } from "./types";

export type RawReading = { t: number; value: number };

/**
 * Buckets raw readings by the Pacific period containing `t`. Buckets starting at or after
 * `openFrom` (epoch ms) are `partial`, since more readings may still arrive. Pure, so the same
 * code runs in the worker and on the main thread.
 */
export function downsample(points: RawReading[], to: Period, openFrom?: number): SeriesPoint[] {
	const buckets = new Map<number, { sum: number; min: number; max: number; count: number }>();
	// Readings arrive nearly sorted, so remember the current bucket's span to skip the date math.
	let spanStart = NaN;
	let spanEnd = NaN;
	for (const { t, value } of points) {
		if (!(t >= spanStart && t < spanEnd)) {
			const start = periodStart(new Date(t), to);
			spanStart = start.getTime();
			spanEnd = nextPeriodStart(start, to).getTime();
		}
		const b = buckets.get(spanStart);
		if (b) {
			b.sum += value;
			b.min = Math.min(b.min, value);
			b.max = Math.max(b.max, value);
			b.count++;
		} else {
			buckets.set(spanStart, { sum: value, min: value, max: value, count: 1 });
		}
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => a - b)
		.map(([t, b]) => ({
			t,
			mean: b.sum / b.count,
			min: b.min,
			max: b.max,
			count: b.count,
			partial: openFrom !== undefined && t >= openFrom
		}));
}
