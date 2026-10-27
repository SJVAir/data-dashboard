import { pacificDay } from "$lib/format";
import { nextPeriodStart } from "$lib/format/range";
import type { TimeSubRange } from "./schema";
import type { QueryData } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A sub-range as inclusive epoch-ms bounds: whole Pacific days for dates, as given otherwise. */
function bounds(sub: TimeSubRange): [number, number] {
	if (DATE.test(sub.start)) {
		const last = new Date(pacificDay(sub.end).getTime());
		return [pacificDay(sub.start).getTime(), nextPeriodStart(last, "day").getTime() - 1];
	}
	return [Date.parse(sub.start), Date.parse(sub.end)];
}

/** `data` with each series keeping only the points whose period starts inside `sub`. */
export function filterToSubRange(data: QueryData, sub: TimeSubRange): QueryData {
	const [from, to] = bounds(sub);
	return {
		...data,
		series: data.series.map((s) => ({
			...s,
			points: s.points.filter((p) => p.t >= from && p.t <= to)
		}))
	};
}
