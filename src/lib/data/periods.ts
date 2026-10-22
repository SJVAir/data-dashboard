import { periodStart } from "$lib/format/range";
import type { Period, ResolvedRange } from "$lib/format/range";
import type { Resolution } from "./schema";

export type Segment = {
	resolution: Resolution;
	start: Date;
	/** Exclusive. */
	end: Date;
	/** Fill segments are aggregated up to the requested resolution. */
	aggregateTo?: Resolution;
	/**
	 * The last completed period at a finer level, used only where the coarse response lacks
	 * that period (its server rollup runs a while after the period ends).
	 */
	backfill?: true;
};

/** Finer levels to try, in order, for the open part of a requested resolution. */
const FINER: Record<Resolution, Resolution[]> = {
	raw: [],
	hour: ["raw"],
	day: ["hour"],
	month: ["day", "hour"],
	quarter: ["month", "day", "hour"],
	season: ["month", "day", "hour"],
	year: ["month", "day", "hour"]
};

/**
 * Splits a range into fetchable segments. Server rollups for a period exist only after it
 * ends, so completed periods come from one segment of the requested resolution and the open
 * period (the one containing `now`) is filled from finer offered levels, each level filling
 * the open part of the one above it. Fill segments carry `aggregateTo: resolution`. Rollups
 * also lag the period's end, so the last completed period is backed up by a `backfill` segment
 * at the next finer offered level, covering exactly that period.
 */
export function planSegments(args: {
	resolution: Resolution;
	range: ResolvedRange;
	now: Date;
	offered: Resolution[];
}): Segment[] {
	const { resolution, range, now, offered } = args;
	if (resolution === "raw") return [];
	const start = range.start;
	const end = new Date(Math.min(range.end.getTime(), now.getTime()));
	if (end <= start) return [];

	const levels = FINER[resolution].filter((r) => offered.includes(r));
	// Nothing finer to fill or backfill with: everything stays with the coarse segment.
	if (levels.length === 0) return [{ resolution, start, end }];

	const openStart = periodStart(now, resolution as Period);
	const segments: Segment[] = [];
	const doneEnd = new Date(Math.min(openStart.getTime(), end.getTime()));
	if (start < doneEnd) segments.push({ resolution, start, end: doneEnd });

	const lastStart = periodStart(new Date(openStart.getTime() - 1), resolution as Period);
	if (lastStart < end && openStart > start) {
		segments.push({
			resolution: levels[0],
			start: lastStart,
			end: openStart,
			aggregateTo: resolution,
			backfill: true
		});
	}

	if (openStart < end) {
		const from = new Date(Math.max(start.getTime(), openStart.getTime()));
		fill(segments, resolution, levels, from, end, now);
	}
	return segments;
}

function fill(
	out: Segment[],
	aggregateTo: Resolution,
	levels: Resolution[],
	from: Date,
	to: Date,
	now: Date
): void {
	if (from >= to) return;
	const [level, ...finer] = levels;
	if (finer.length === 0) {
		out.push({ resolution: level, start: from, end: to, aggregateTo });
		return;
	}
	const open = periodStart(now, level as Period);
	const doneEnd = new Date(Math.min(open.getTime(), to.getTime()));
	if (from < doneEnd) out.push({ resolution: level, start: from, end: doneEnd, aggregateTo });
	fill(out, aggregateTo, finer, new Date(Math.max(from.getTime(), open.getTime())), to, now);
}
