import { ratedForCount, type DayState } from "$lib/calendars/day-state";
import type { Level } from "$lib/data/metadata";
import { formatLongWeekdayDate, formatValue } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";

/** Whether a day gets the threshold mark: a counted day at or above the level. */
export function isMarked(s: DayState, threshold: Level | null): boolean {
	return !!threshold && ratedForCount(s) && s.value! >= threshold.min;
}

export type DayLabelContext = {
	/** The figure's name (`figureName`). */
	figure: string;
	unit: string;
	precision: number | null | undefined;
	threshold: Level | null;
	/** Name the year too (the range spans more than one calendar year). */
	withYear?: boolean;
};

/** What a day's state says, after its date: "24-hour average 31.9 µg/m³, Moderate". */
function stateText(s: DayState, c: DayLabelContext): string {
	const value = s.value === null ? "" : formatValue(s.value, c.precision);
	const parts = { figure: c.figure, value, unit: c.unit };
	switch (s.kind) {
		case "rated":
			return s.level
				? m.calendar_day_rated({ ...parts, level: s.level.label })
				: m.calendar_day_value(parts);
		case "today":
			if (s.value === null) return m.calendar_day_no_data_so_far();
			return s.level
				? m.calendar_day_so_far_rated({ ...parts, level: s.level.label })
				: m.calendar_day_so_far_value(parts);
		case "thin":
			return m.calendar_not_enough_data();
		case "none":
			return m.calendar_no_data();
		case "pending":
			return m.calendar_day_not_final_yet();
		case "future":
			return m.calendar_day_still_to_come();
		case "unrated":
			return m.calendar_day_not_rated();
	}
}

/**
 * A day cell's accessible name: "Friday, November 6: 24-hour average 31.9 µg/m³, Moderate", then
 * ", at or above Moderate" when marked and ", selected" when selected.
 */
export function dayLabel(s: DayState, c: DayLabelContext, selected: boolean): string {
	return m.calendar_day_name({
		date: formatLongWeekdayDate(s.date, { year: c.withYear }),
		state: stateText(s, c),
		level: c.threshold?.label ?? "",
		marked: isMarked(s, c.threshold) ? "yes" : "no",
		selected: selected ? "yes" : "no"
	});
}
