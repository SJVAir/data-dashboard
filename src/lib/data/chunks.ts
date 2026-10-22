import { TZDate } from "@date-fns/tz";
import { TIME_ZONE } from "$lib/format";
import type { Segment } from "./periods";
import type { Resolution } from "./schema";

/**
 * Largest span per request, in days. Source: the server's bulk summaries form
 * (../sjvair.com/camp/api/v2/summaries/forms.py) caps hourly at 31 days and daily at 366;
 * it sets no cap for monthly and coarser, so those are generous stand-ins. Raw uses the
 * hourly figure.
 */
export const CHUNK_DAYS: Record<Resolution, number> = {
	raw: 31,
	hour: 31,
	day: 366,
	month: 1830,
	quarter: 1830,
	season: 1830,
	year: 3660
};

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
