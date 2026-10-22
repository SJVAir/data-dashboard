import { TZDate } from "@date-fns/tz";
import { addDays, startOfWeek, subMonths } from "date-fns";
import type { DateRangeSpec } from "$lib/data/schema";
import { TIME_ZONE, WEEK_STARTS_ON, pacificDay, parseDateKey, toKey, todayPacific } from "./index";

export type { DateRangeSpec };

export type ResolvedRange = {
	/** Inclusive Pacific `YYYY-MM-DD`. */
	firstDate: string;
	/** Inclusive Pacific `YYYY-MM-DD`. */
	lastDate: string;
	/** Instant, inclusive. */
	start: Date;
	/** Instant, exclusive (the current instant for a trailing-hours range). */
	end: Date;
	/** To-date or trailing: the range moves with the clock. */
	rolling: boolean;
	includesNow: boolean;
};

export type Period = "hour" | "day" | "month" | "quarter" | "season" | "year";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

function pacific(instant: Date): TZDate {
	return new TZDate(instant.getTime(), TIME_ZONE);
}

function plusDays(date: string, days: number): string {
	return toKey(addDays(pacificDay(date), days));
}

function lastDayOfMonth(date: string): string {
	const { y, m } = parseDateKey(date);
	return toKey(new TZDate(y, m, 0, 0, 0, 0, 0, TIME_ZONE));
}

function fromDates(
	firstDate: string,
	lastDate: string,
	rolling: boolean,
	now: Date,
	end?: Date,
	start?: Date
): ResolvedRange {
	const today = todayPacific(now);
	return {
		firstDate,
		lastDate,
		start: start ?? new Date(pacificDay(firstDate).getTime()),
		end: end ?? new Date(pacificDay(plusDays(lastDate, 1)).getTime()),
		rolling,
		includesNow: firstDate <= today && today <= lastDate
	};
}

export function resolveRange(spec: DateRangeSpec, now: Date): ResolvedRange {
	const today = todayPacific(now);
	switch (spec.kind) {
		case "set": {
			parseDateKey(spec.start);
			const first =
				spec.unit === "day"
					? spec.start
					: spec.unit === "week"
						? toKey(startOfWeek(pacificDay(spec.start), { weekStartsOn: WEEK_STARTS_ON }))
						: spec.unit === "month"
							? `${spec.start.slice(0, 7)}-01`
							: `${spec.start.slice(0, 4)}-01-01`;
			const last =
				spec.unit === "day"
					? first
					: spec.unit === "week"
						? plusDays(first, 6)
						: spec.unit === "month"
							? lastDayOfMonth(first)
							: `${first.slice(0, 4)}-12-31`;
			return fromDates(first, last, false, now);
		}
		case "to-date": {
			const first =
				spec.unit === "week"
					? toKey(startOfWeek(pacificDay(today), { weekStartsOn: WEEK_STARTS_ON }))
					: spec.unit === "month"
						? `${today.slice(0, 7)}-01`
						: `${today.slice(0, 4)}-01-01`;
			return fromDates(first, today, true, now);
		}
		case "trailing": {
			if (!Number.isInteger(spec.amount) || spec.amount < 1) {
				throw new RangeError(`Trailing amount must be a positive integer: ${spec.amount}`);
			}
			if (spec.unit === "hour") {
				const start = new Date(now.getTime() - spec.amount * MS_PER_HOUR);
				return fromDates(toKey(pacific(start)), today, true, now, new Date(now.getTime()), start);
			}
			const first =
				spec.unit === "day"
					? plusDays(today, -(spec.amount - 1))
					: toKey(addDays(subMonths(pacificDay(today), spec.amount), 1));
			return fromDates(first, today, true, now);
		}
		case "custom": {
			parseDateKey(spec.start);
			parseDateKey(spec.end);
			if (spec.start > spec.end) {
				throw new RangeError(`Range ends before it starts: ${spec.start} to ${spec.end}`);
			}
			return fromDates(spec.start, spec.end, false, now);
		}
	}
}

/** Length of the range in days (end minus start), not rounded; a DST day is 23 or 25 hours. */
export function rangeSpanDays(r: ResolvedRange): number {
	return (r.end.getTime() - r.start.getTime()) / MS_PER_DAY;
}

/** Turns any spec into the fixed custom dates it resolves to right now. */
export function freezeRange(
	spec: DateRangeSpec,
	now: Date
): { kind: "custom"; start: string; end: string } {
	const r = resolveRange(spec, now);
	return { kind: "custom", start: r.firstDate, end: r.lastDate };
}

/**
 * First month (1-12) of the season containing month `m`. Matches the server's seasonal
 * summaries (../sjvair.com/camp/apps/summaries/tasks.py: `seasonal_*_summaries` run on Mar 1,
 * Jun 1, Sep 1 and Dec 1 over three months, i.e. meteorological seasons Dec-Feb, Mar-May,
 * Jun-Aug, Sep-Nov). A season starting in December belongs to the following year.
 */
function seasonStartMonth(m: number): number {
	return m >= 3 ? Math.floor(m / 3) * 3 : 12;
}

/** The Pacific boundary of `period` at or before `instant`. */
export function periodStart(instant: Date, period: Period): Date {
	if (period === "hour") {
		// Pacific offsets are whole hours, so flooring the instant lands on a Pacific hour.
		return new Date(Math.floor(instant.getTime() / MS_PER_HOUR) * MS_PER_HOUR);
	}
	const t = pacific(instant);
	const y = t.getFullYear();
	const m = t.getMonth() + 1;
	let boundary: TZDate;
	switch (period) {
		case "day":
			boundary = new TZDate(y, m - 1, t.getDate(), TIME_ZONE);
			break;
		case "month":
			boundary = new TZDate(y, m - 1, 1, TIME_ZONE);
			break;
		case "quarter":
			boundary = new TZDate(y, Math.floor((m - 1) / 3) * 3, 1, TIME_ZONE);
			break;
		case "season": {
			const sm = seasonStartMonth(m);
			boundary = new TZDate(sm === 12 && m < 12 ? y - 1 : y, sm - 1, 1, TIME_ZONE);
			break;
		}
		case "year":
			boundary = new TZDate(y, 0, 1, TIME_ZONE);
			break;
	}
	return new Date(boundary.getTime());
}

/** The start of the period after the one that begins at `start` (a value from `periodStart`). */
export function nextPeriodStart(start: Date, period: Period): Date {
	if (period === "hour") return new Date(start.getTime() + MS_PER_HOUR);
	const t = pacific(start);
	const y = t.getFullYear();
	const mo = t.getMonth();
	const next =
		period === "day"
			? new TZDate(y, mo, t.getDate() + 1, TIME_ZONE)
			: period === "month"
				? new TZDate(y, mo + 1, 1, TIME_ZONE)
				: period === "year"
					? new TZDate(y + 1, 0, 1, TIME_ZONE)
					: new TZDate(y, mo + 3, 1, TIME_ZONE); // quarter and season are 3 months
	return new Date(next.getTime());
}
