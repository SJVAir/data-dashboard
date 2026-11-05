import type { EntryTypeMeta } from "$lib/data/metadata";
import type { DateRangeSpec, Resolution } from "$lib/data/schema";
import { calendarSpanDays, resolveRange } from "$lib/format/range";

export type DetailChoice = {
	level: "auto" | Resolution;
	blocked: "server-limit" | "too-many-points" | null;
};

/** The levels "Detail" lists, finest first (when the entry type offers them). */
const LEVELS = ["raw", "hour", "day", "month"] as const;

/**
 * The longest range the server serves at a level, in Pacific days. Raw readings and hourly
 * region summaries are capped at 31 days; daily and monthly are requested by calendar unit, so
 * they have no cap.
 */
const SERVER_LIMIT_DAYS: Partial<Record<Resolution, number>> = { raw: 31, hour: 31 };

/** The most points (places × periods) a preview is asked to draw. */
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
 * level the entry type offers, greyed when the server's limits or the point budget rule it out.
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
		const limit = SERVER_LIMIT_DAYS[level];
		let blocked: DetailChoice["blocked"] = null;
		if (limit !== undefined && days > limit) blocked = "server-limit";
		else if (Math.max(1, places) * days * PER_DAY[level] > MAX_POINTS) blocked = "too-many-points";
		choices.push({ level, blocked });
	}
	return choices;
}
