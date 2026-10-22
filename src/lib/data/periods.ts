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
 * the open part of the one above it. Fill segments carry `aggregateTo: resolution`.
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

	const openStart = periodStart(now, resolution as Period);
	if (openStart >= end) return [{ resolution, start, end }];

	const levels = FINER[resolution].filter((r) => offered.includes(r));
	// Nothing finer to fill with: the open period stays with the coarse segment.
	if (levels.length === 0) return [{ resolution, start, end }];

	const segments: Segment[] = [];
	if (start < openStart) segments.push({ resolution, start, end: openStart });
	fill(
		segments,
		resolution,
		levels,
		new Date(Math.max(start.getTime(), openStart.getTime())),
		end,
		now
	);
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
