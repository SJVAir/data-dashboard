import type { EntryTypeMeta } from "$lib/data/metadata";
import type { DateRangeSpec, Resolution } from "$lib/data/schema";
import { calendarSpanDays, resolveRange } from "$lib/format/range";

export type DetailChoice = {
	level: "auto" | Resolution;
	blocked: "too-many-points" | null;
};

/** The levels "Detail" lists, finest first (when the entry type offers them). */
const LEVELS = ["raw", "hour", "day", "month"] as const;

/**
 * The most points (places × periods) a preview is asked to draw. No level has a range cap of
 * its own: the server's per-request caps (31 days of raw or hourly) are met by the adapters,
 * which ask a calendar month (or 31 raw days) at a time.
 */
export const MAX_POINTS = 50_000;

/** Periods per day at each level; raw assumes a reading every two minutes (PurpleAir's rate). */
const PER_DAY: Record<(typeof LEVELS)[number], number> = {
	raw: 720,
	hour: 24,
	day: 1,
	month: 1 / 30
};

/**
 * The "Detail" choices for the main layer over `range` at `places` places: Automatic, then each
 * level the entry type offers, greyed when the point budget rules it out.
 * `null` when the widget type pins its resolution (the control is hidden).
 */
export function detailChoices(
	entry: EntryTypeMeta,
	range: DateRangeSpec,
	places: number,
	pin: Resolution | undefined,
	now: Date
): DetailChoice[] | null {
	if (pin) return null;
	const days = calendarSpanDays(range, resolveRange(range, now));
	const choices: DetailChoice[] = [{ level: "auto", blocked: null }];
	for (const level of LEVELS) {
		if (!entry.resolutions.includes(level)) continue;
		const points = Math.max(1, places) * days * PER_DAY[level];
		choices.push({ level, blocked: points > MAX_POINTS ? "too-many-points" : null });
	}
	return choices;
}
