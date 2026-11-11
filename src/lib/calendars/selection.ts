import type { TimeSubRange } from "$lib/data/schema";
import { addDays, dayOfWeek, daysInMonth } from "$lib/format";

export type Layout = "month" | "weeks";

/** The days a viewer can pick: the range start to the earlier of its end and today. */
export type Selectable = { first: string; last: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function clampSelectable(date: string, s: Selectable): string {
	if (date < s.first) return s.first;
	if (date > s.last) return s.last;
	return date;
}

/** Two dates as an ordered span. */
export function spanOf(anchor: string, to: string): { start: string; end: string } {
	return anchor <= to ? { start: anchor, end: to } : { start: to, end: anchor };
}

function shiftMonth(date: string, n: number): string {
	const [y, m, d] = date.split("-").map(Number);
	const index = y * 12 + (m - 1) + n;
	const year = Math.floor(index / 12);
	const month = (index % 12) + 1;
	const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
	const day = Math.min(d, daysInMonth(`${prefix}-01`));
	return `${prefix}-${String(day).padStart(2, "0")}`;
}

/** Where keyboard focus goes from `date` on `key`; always a selectable day. */
export function moveFocus(date: string, key: string, layout: Layout, s: Selectable): string {
	// Month: a row is a week, so Left/Right step a day and Up/Down a week. Weeks: columns are weeks.
	const day = layout === "month" ? 1 : 7;
	const week = layout === "month" ? 7 : 1;
	let next: string;
	switch (key) {
		case "ArrowLeft":
			next = addDays(date, -day);
			break;
		case "ArrowRight":
			next = addDays(date, day);
			break;
		case "ArrowUp":
			next = addDays(date, -week);
			break;
		case "ArrowDown":
			next = addDays(date, week);
			break;
		case "Home":
			next = addDays(date, -dayOfWeek(date));
			break;
		case "End":
			next = addDays(date, 6 - dayOfWeek(date));
			break;
		case "PageUp":
			next = shiftMonth(date, -1);
			break;
		case "PageDown":
			next = shiftMonth(date, 1);
			break;
		default:
			return date;
	}
	return clampSelectable(next, s);
}

/** The part of a stored date selection shown in the current range, or `null`. */
export function visibleSelection(
	sel: TimeSubRange | undefined,
	s: Selectable,
	rangeEnd: string
): { start: string; end: string } | null {
	if (!sel || !DATE_ONLY.test(sel.start) || !DATE_ONLY.test(sel.end)) return null;
	const start = sel.start < s.first ? s.first : sel.start;
	const end = sel.end > rangeEnd ? rangeEnd : sel.end;
	return start <= end ? { start, end } : null;
}

/** Whether a stored date selection lies wholly inside `first`..`last`. */
export function fitsRange(sel: TimeSubRange, first: string, last: string): boolean {
	return (
		DATE_ONLY.test(sel.start) && DATE_ONLY.test(sel.end) && sel.start >= first && sel.end <= last
	);
}
