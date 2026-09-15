import { differenceInCalendarDays } from "date-fns";

export type SummaryResolution = "daily" | "monthly";

const DAILY_RESOLUTION_THRESHOLD_DAYS = 45;

export function pickSummaryResolution(start: string, end: string): SummaryResolution {
	const days = differenceInCalendarDays(new Date(end), new Date(start));
	return days <= DAILY_RESOLUTION_THRESHOLD_DAYS ? "daily" : "monthly";
}
