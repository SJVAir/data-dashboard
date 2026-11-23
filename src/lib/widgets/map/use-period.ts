import type { SnapshotAt } from "$lib/data/snapshot";
import { formatMonth, formatYear, parseDateKey } from "$lib/format";

/** A pesticide use period: a year, or one month of it. */
export type UsePeriod = { year: number; month: number | null };

/** The use period of a month or year stop (by its start key); null for a day or Now. */
export function periodOfStop(at: SnapshotAt): UsePeriod | null {
	if (at === "now" || !("start" in at)) return null;
	const { y, m } = parseDateKey(at.start);
	return { year: y, month: at.resolution === "month" ? m : null };
}

/** `"2023"` or `"2023-07"`. */
export function periodKey(p: UsePeriod): string {
	const year = String(p.year).padStart(4, "0");
	return p.month === null ? year : `${year}-${String(p.month).padStart(2, "0")}`;
}

/** Whether the server lists the period's year. */
export function periodListed(p: UsePeriod, years: readonly number[]): boolean {
	return years.includes(p.year);
}

/** "2023" or "July 2023". */
export function periodLabel(p: UsePeriod): string {
	const key = periodKey(p);
	return p.month === null ? formatYear(`${key}-01-01`) : formatMonth(`${key}-01`);
}
