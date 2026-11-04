import { TZDate } from "@date-fns/tz";
import { TIME_ZONE } from "$lib/format";
import type { Segment } from "./periods";

/**
 * Largest raw-entry span per request, in days. Source: the server's bulk summaries form
 * (../sjvair.com/camp/api/v2/summaries/forms.py) caps hourly at 31 days. Summaries are
 * requested by whole calendar unit instead (see `calendarUnits`).
 */
export const CHUNK_DAYS = { raw: 31 } as const;

/** One request's worth of a segment: the whole calendar unit and the part inside the segment. */
export type Unit = { fetchStart: Date; fetchEnd: Date; start: Date; end: Date };

/**
 * Whole Pacific calendar units overlapping `seg`: `fetch*` is the whole unit, `start`/`end` the
 * part inside `seg`. A unit is a month for raw/hour/day, a year for month/quarter/season, and
 * one unit spanning everything for year. Whole past units give URLs that never change, so the
 * server can cache them for a day.
 */
export function calendarUnits(seg: Segment): Unit[] {
	if (seg.resolution === "year") {
		return [{ fetchStart: seg.start, fetchEnd: seg.end, start: seg.start, end: seg.end }];
	}
	const byYear =
		seg.resolution === "month" || seg.resolution === "quarter" || seg.resolution === "season";
	const first = new TZDate(seg.start.getTime(), TIME_ZONE);
	const units: Unit[] = [];
	let y = first.getFullYear();
	let m = byYear ? 0 : first.getMonth();
	for (;;) {
		const fetchStart = new Date(new TZDate(y, m, 1, 0, 0, 0, 0, TIME_ZONE).getTime());
		if (fetchStart >= seg.end) break;
		const fetchEnd = new Date(
			new TZDate(byYear ? y + 1 : y, byYear ? 0 : m + 1, 1, 0, 0, 0, 0, TIME_ZONE).getTime()
		);
		units.push({
			fetchStart,
			fetchEnd,
			start: new Date(Math.max(fetchStart.getTime(), seg.start.getTime())),
			end: new Date(Math.min(fetchEnd.getTime(), seg.end.getTime()))
		});
		if (byYear || m === 11) {
			y++;
			m = 0;
		} else m++;
	}
	return units;
}

/** Splits a segment into consecutive pieces of at most `maxDays` Pacific calendar days. */
export function splitChunks(seg: Segment, maxDays: number): Segment[] {
	const chunks: Segment[] = [];
	let cursor = seg.start;
	while (cursor < seg.end) {
		const t = new TZDate(cursor.getTime(), TIME_ZONE);
		t.setDate(t.getDate() + maxDays);
		const next = new Date(Math.min(t.getTime(), seg.end.getTime()));
		chunks.push({ ...seg, start: cursor, end: next });
		cursor = next;
	}
	return chunks.length > 0 ? chunks : [seg];
}

/**
 * Runs tasks with at most `limit` in flight, resolving in task order. Rejects with the abort
 * reason once `signal` aborts (no further tasks start) or with the first task failure.
 */
export function runLimited<T>(
	tasks: Array<() => Promise<T>>,
	limit: number,
	signal?: AbortSignal
): Promise<T[]> {
	return new Promise<T[]>((resolve, reject) => {
		const results: T[] = new Array(tasks.length);
		let next = 0;
		let done = 0;
		let settled = false;

		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		};
		const onAbort = () => fail(signal?.reason);

		if (signal?.aborted) return fail(signal.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (tasks.length === 0) {
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			return resolve(results);
		}

		const launch = () => {
			while (!settled && !signal?.aborted && next < tasks.length && next - done < limit) {
				const i = next++;
				tasks[i]().then((value) => {
					if (settled) return;
					results[i] = value;
					done++;
					if (done === tasks.length) {
						settled = true;
						signal?.removeEventListener("abort", onAbort);
						resolve(results);
					} else launch();
				}, fail);
			}
		};
		launch();
	});
}
