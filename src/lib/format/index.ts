import { TZDate } from "@date-fns/tz";
import { m } from "$lib/paraglide/messages.js";
import { addHours, startOfWeek } from "date-fns";

export const TIME_ZONE = "America/Los_Angeles";
export const WEEK_STARTS_ON = 0;
export const LOCALE = "en-US";

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function toKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Splits a real `YYYY-MM-DD` calendar date into numbers; throws `RangeError` otherwise. */
export function parseDateKey(date: string): { y: number; m: number; d: number } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
	}
	const [y, mo, d] = date.split("-").map(Number);
	const check = new Date(Date.UTC(y, mo - 1, d));
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
		throw new RangeError(`Not a real calendar date: "${date}"`);
	}
	return { y, m: mo, d };
}

/** Midnight Pacific at the start of a `YYYY-MM-DD` date. `hour` lets callers pick another hour. */
export function pacificDay(date: string, hour = 0): TZDate {
	const { y, m, d } = parseDateKey(date);
	return new TZDate(y, m - 1, d, hour, 0, 0, 0, TIME_ZONE);
}

/** Today's date in Pacific time as `YYYY-MM-DD`. */
export function todayPacific(now: Date = new Date()): string {
	return toKey(new TZDate(now.getTime(), TIME_ZONE));
}

/** The Sunday that starts the Pacific week containing `date` (`YYYY-MM-DD`). */
export function startOfPacificWeek(date: string): string {
	return toKey(startOfWeek(pacificDay(date), { weekStartsOn: WEEK_STARTS_ON }));
}

/** Every hour start (as instants) within the given Pacific day: 23, 24, or 25 entries. */
export function pacificHoursOfDay(date: string): Date[] {
	const start = pacificDay(date);
	const { y, m, d } = parseDateKey(date);
	const end = new TZDate(y, m - 1, d + 1, 0, 0, 0, 0, TIME_ZONE).getTime();
	const hours: Date[] = [];
	for (let t = new Date(start.getTime()); t.getTime() < end; t = addHours(t, 1)) {
		hours.push(t);
	}
	return hours;
}

/** Whether the device zone differs from Pacific, so times need a PT label. */
export function needsZoneLabel(
	deviceZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): boolean {
	return deviceZone !== TIME_ZONE;
}

/** A calendar date (`YYYY-MM-DD` or an instant) shown as a Pacific date. */
export function formatDate(date: string | Date, locale: string = LOCALE): string {
	const instant = typeof date === "string" ? new Date(pacificDay(date, 12).getTime()) : date;
	return new Intl.DateTimeFormat(locale, {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "short",
		day: "numeric"
	}).format(instant);
}

/** Pacific noon of a calendar date, as a plain `Date` (safely inside the day for formatting). */
function noon(date: string): Date {
	return new Date(pacificDay(date, 12).getTime());
}

/** A calendar month (any `YYYY-MM-DD` in it) shown as "October 2026". */
export function formatMonth(date: string, locale: string = LOCALE): string {
	return new Intl.DateTimeFormat(locale, {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "long"
	}).format(noon(date));
}

/** A calendar year (any `YYYY-MM-DD` in it) shown as "2026". */
export function formatYear(date: string, locale: string = LOCALE): string {
	return new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, year: "numeric" }).format(
		noon(date)
	);
}

/** Two calendar dates as one span, shared parts once: "Oct 1 – 14, 2026". */
export function formatDateRange(start: string, end: string, locale: string = LOCALE): string {
	return new Intl.DateTimeFormat(locale, {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "short",
		day: "numeric"
	}).formatRange(noon(start), noon(end));
}

/** An instant shown in Pacific time; the PT label is appended only when the device zone differs. */
export function formatDateTime(
	instant: Date,
	opts: { deviceZone?: string; locale?: string } = {}
): string {
	const text = new Intl.DateTimeFormat(opts.locale ?? LOCALE, {
		timeZone: TIME_ZONE,
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit"
	}).format(instant);
	return needsZoneLabel(opts.deviceZone) ? m.time_zone_suffix({ time: text }) : text;
}

export function formatNumber(
	n: number,
	opts?: Intl.NumberFormatOptions,
	locale: string = LOCALE
): string {
	return new Intl.NumberFormat(locale, opts).format(n);
}

/**
 * A measured value with exactly `precision` decimals (the catalog's display precision), or as
 * `formatNumber` shows it when the catalog gives none.
 */
export function formatValue(
	n: number,
	precision: number | null | undefined,
	locale: string = LOCALE
): string {
	if (precision === null || precision === undefined) return formatNumber(n, undefined, locale);
	return formatNumber(
		n,
		{ minimumFractionDigits: precision, maximumFractionDigits: precision },
		locale
	);
}

/** A Pacific hour span such as "3 – 4 PM"; the PT label is appended only outside Pacific. */
export function formatHourRange(
	start: Date,
	end: Date,
	opts: { deviceZone?: string; locale?: string } = {}
): string {
	const text = new Intl.DateTimeFormat(opts.locale ?? LOCALE, {
		timeZone: TIME_ZONE,
		hour: "numeric"
	}).formatRange(start, end);
	return needsZoneLabel(opts.deviceZone) ? m.time_zone_suffix({ time: text }) : text;
}

/** The label for the period starting at `start`, at a data resolution (`raw` is an instant). */
export function formatPeriod(
	start: Date,
	resolution: "raw" | "hour" | "day" | "month" | "quarter" | "season" | "year",
	opts: { deviceZone?: string; locale?: string } = {}
): string {
	if (resolution === "raw" || resolution === "hour") return formatDateTime(start, opts);
	if (resolution === "day") return formatDate(start, opts.locale);
	return new Intl.DateTimeFormat(opts.locale ?? LOCALE, {
		timeZone: TIME_ZONE,
		year: "numeric",
		...(resolution === "year" ? {} : { month: "short" })
	}).format(start);
}

/**
 * A compact axis tick in Pacific time: "3 PM", "Oct 1", "Oct", or "2026". An hourly tick on a
 * Pacific midnight names the day instead ("Oct 2", not "12 AM"), so hourly axes show the date.
 */
export function formatTick(
	instant: Date,
	unit: "hour" | "day" | "month" | "year",
	locale: string = LOCALE
): string {
	const pacific = new TZDate(instant.getTime(), TIME_ZONE);
	const midnight = pacific.getHours() === 0 && pacific.getMinutes() === 0;
	const options: Intl.DateTimeFormatOptions =
		unit === "hour" && !midnight
			? { hour: "numeric" }
			: unit === "day" || unit === "hour"
				? { month: "short", day: "numeric" }
				: unit === "month"
					? { month: "short" }
					: { year: "numeric" };
	return new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...options }).format(instant);
}

/** Names joined as a sentence list ("A, B, and C"). */
export function formatList(items: string[], locale: string = LOCALE): string {
	return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}
