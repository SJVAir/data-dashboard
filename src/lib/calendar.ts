import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { eachDayOfInterval, format, parseISO } from "date-fns";

export interface CalendarDay {
	date: string;
	value: number | null;
	color: string | null;
}

export function getCurrentLevel(
	value: number,
	levels: Array<SJVAirEntryLevel>
): SJVAirEntryLevel | undefined {
	return levels.find((level) => value >= level.range[0] && value <= level.range[1]);
}

export function buildCalendarDays(
	start: string,
	end: string,
	valuesByDate: Map<string, number>,
	levels: Array<SJVAirEntryLevel> | null
): Array<CalendarDay> {
	return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map((date) => {
		const key = format(date, "yyyy-MM-dd");
		const value = valuesByDate.get(key) ?? null;
		const level = value !== null && levels ? getCurrentLevel(value, levels) : undefined;
		return { date: key, value, color: level?.color ?? null };
	});
}

export function groupDaysByMonth(
	days: Array<CalendarDay>
): Array<{ month: string; days: Array<CalendarDay> }> {
	const groups = new Map<string, Array<CalendarDay>>();

	for (const day of days) {
		const monthKey = day.date.slice(0, 7);
		const group = groups.get(monthKey) ?? [];
		group.push(day);
		groups.set(monthKey, group);
	}

	return Array.from(groups.entries()).map(([month, monthDays]) => ({ month, days: monthDays }));
}
