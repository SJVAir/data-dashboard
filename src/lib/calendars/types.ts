// Light on purpose: the widget descriptors (in the initial bundle) import from here, so no data
// layer comes with it.
import type { DateRangeSpec } from "$lib/data/schema";

export const MONTH_CALENDAR_TYPE = "calendar-month";
export const CONTRIBUTION_CALENDAR_TYPE = "calendar-contribution";

/** Whether a widget type is one of the two calendars. */
export function isCalendarType(type: string): boolean {
	return type === MONTH_CALENDAR_TYPE || type === CONTRIBUTION_CALENDAR_TYPE;
}

/** The date range a calendar type shows when its widget sets none. */
export const CALENDAR_DEFAULT_RANGES: Record<string, DateRangeSpec> = {
	[MONTH_CALENDAR_TYPE]: { kind: "to-date", unit: "month" },
	[CONTRIBUTION_CALENDAR_TYPE]: { kind: "trailing", amount: 12, unit: "month" }
};
