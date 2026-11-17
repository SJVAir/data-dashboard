import { formatMonth, formatYear } from "$lib/format";

/** A pesticide use period: a year, or one month of it. */
export type UsePeriod = { year: number; month: number | null };

/** The period a `usePeriod` option names (`YYYY` or `YYYY-MM`), or null. */
export function parsePeriod(value: string | undefined): UsePeriod | null {
	const match = value ? /^(\d{4})(?:-(0[1-9]|1[0-2]))?$/.exec(value) : null;
	if (!match) return null;
	return { year: Number(match[1]), month: match[2] ? Number(match[2]) : null };
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
