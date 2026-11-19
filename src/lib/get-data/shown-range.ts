import type { DateRangeSpec, Resolution } from "$lib/data/schema";
import { todayPacific } from "$lib/format";
import { rangeWidened, resolveRange, type ResolvedRange } from "$lib/format/range";

/** The dates Get data shows for a range at a resolution (Pacific `YYYY-MM-DD`). */
export type ShownRange = {
	start: string;
	/** Never in the future: today when the range runs on past it. */
	end: string;
	/** The range includes the current period, which ends after today: it's shown "so far". */
	soFar: boolean;
	/** The resolution widened the dates the person picked (to whole months or years). */
	widened: boolean;
	resolved: ResolvedRange;
};

/**
 * `spec` as it resolves at `resolution` (`resolveRange`: whole months at Monthly, whole years at
 * Yearly), with its end cut to today when the current period runs on past it.
 */
export function shownRange(spec: DateRangeSpec, now: Date, resolution?: Resolution): ShownRange {
	const resolved = resolveRange(spec, now, resolution);
	const today = todayPacific(now);
	const soFar = resolved.lastDate > today && resolved.firstDate <= today;
	const coarse = resolution === "month" || resolution === "year";
	return {
		start: resolved.firstDate,
		end: soFar && coarse ? today : resolved.lastDate,
		soFar: soFar && coarse,
		widened: rangeWidened(spec, now, resolution),
		resolved
	};
}
