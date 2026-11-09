import { addDays as addDaysTo, differenceInCalendarDays } from "date-fns";
import { WEEK_STARTS_ON, pacificDay, parseDateKey, startOfPacificWeek, toKey } from "./index";

/** The Pacific date `n` days after `date` (before, if negative). */
export function addDays(date: string, n: number): string {
	return toKey(addDaysTo(pacificDay(date), n));
}

/** How many Pacific days `start` to `end` cover, both included. */
export function daysInclusive(start: string, end: string): number {
	return differenceInCalendarDays(pacificDay(end), pacificDay(start)) + 1;
}

/** The weekday of a Pacific date; 0 is Sunday. */
export function dayOfWeek(date: string): number {
	return pacificDay(date).getDay();
}

function firstOfMonth(date: string): string {
	const { y, m } = parseDateKey(date);
	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/** The first-of-month keys of every month the range touches. */
export function monthStarts(start: string, end: string): string[] {
	const months: string[] = [];
	let month = firstOfMonth(start);
	while (month <= end) {
		months.push(month);
		month = firstOfMonth(addDays(month, 31));
	}
	return months;
}

/** Weeks as rows, Sunday first, with `null` for cells outside the month. */
export function monthGrid(month: string): (string | null)[][] {
	const first = firstOfMonth(month);
	const next = firstOfMonth(addDays(first, 31));
	const lead = (dayOfWeek(first) - WEEK_STARTS_ON + 7) % 7;
	const cells: (string | null)[] = Array.from({ length: lead }, () => null);
	for (let day = first; day < next; day = addDays(day, 1)) cells.push(day);
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks: (string | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** One column per week, from the week start on or before `start` to the week end on or after
 * `end`; `null` for days outside `[start, end]`. */
export function weekColumns(start: string, end: string): (string | null)[][] {
	const columns: (string | null)[][] = [];
	for (let week = startOfPacificWeek(start); week <= end; week = addDays(week, 7)) {
		columns.push(
			Array.from({ length: 7 }, (_, i) => {
				const day = addDays(week, i);
				return day >= start && day <= end ? day : null;
			})
		);
	}
	return columns;
}

/** The first-of-month key on the column where each month first shows as that column's first
 * in-range day, else `null`. The first column always carries its month; a month that starts
 * partway down a column is labeled on the next column. */
export function weekColumnMonthLabels(columns: (string | null)[][]): (string | null)[] {
	let current: string | null = null;
	return columns.map((column) => {
		const first = column.find((day) => day !== null);
		if (!first) return null;
		const month = firstOfMonth(first);
		if (month === current) return null;
		current = month;
		return month;
	});
}
