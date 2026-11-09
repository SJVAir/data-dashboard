// Light on purpose: the widget descriptors (in the initial bundle) import from here, so no data
// layer comes with it.
export const MONTH_CALENDAR_TYPE = "calendar-month";
export const CONTRIBUTION_CALENDAR_TYPE = "calendar-contribution";

/** Whether a widget type is one of the two calendars. */
export function isCalendarType(type: string): boolean {
	return type === MONTH_CALENDAR_TYPE || type === CONTRIBUTION_CALENDAR_TYPE;
}
