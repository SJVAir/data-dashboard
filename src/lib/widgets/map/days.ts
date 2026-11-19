import type { Level } from "$lib/data/dataset-rules";
import {
	formatLongWeekdayDate,
	formatMonth,
	formatYear,
	pacificDay,
	parseDateKey
} from "$lib/format";
import { resolveRange, type DateRangeSpec } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import { MAP_MAX_STOPS } from "./options";

/** The levels a Map steps by. */
export type MapLevel = "day" | "month" | "year";

/**
 * A stop: a period's Pacific start key (a day, a month's first day, a year's first day), or
 * `"now"`. `soFar` marks the current month or year (the last stop of a range reaching today).
 */
export type Stop = { at: string; soFar?: true } | "now";

/** The level a Map steps by at `resolution`: a day below Daily (the Map offers nothing finer). */
export function mapLevel(resolution: Level): MapLevel {
	return resolution === "month" || resolution === "year" ? resolution : "day";
}

/** A stop as a primitive: its start key, or "now". */
export const stopKey = (stop: Stop): string => (stop === "now" ? "now" : stop.at);

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` plus `days`, by calendar (UTC) arithmetic so a DST change never shifts a day. */
function plusDays(date: string, days: number): string {
	const { y, m, d } = parseDateKey(date);
	return new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The start key of the period after the one starting at `start`. */
function nextStart(start: string, level: MapLevel): string {
	if (level === "day") return plusDays(start, 1);
	const { y, m } = parseDateKey(start);
	if (level === "year") return `${String(y + 1).padStart(4, "0")}-01-01`;
	const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
	return `${String(next.y).padStart(4, "0")}-${String(next.m).padStart(2, "0")}-01`;
}

/** Each period start of a resolved (widened) range, from its first date through its last. */
function starts(firstDate: string, lastDate: string, level: MapLevel, until: string): string[] {
	const out: string[] = [];
	for (let p = firstDate; p <= lastDate && p <= until; p = nextStart(p, level)) out.push(p);
	return out;
}

/**
 * The range's stops at `resolution`, over the range widened to whole periods (`resolveRange`).
 * Daily: each Pacific day up to today, then "now" if the range includes today. Monthly and
 * Yearly: each period up to the current one, which is the last stop and marked `soFar`.
 */
export function periodStops(range: DateRangeSpec, resolution: Level, today: string): Stop[] {
	const level = mapLevel(resolution);
	const r = resolveRange(range, pacificDay(today, 12), level);
	if (level === "day") {
		const stops: Stop[] = starts(r.firstDate, r.lastDate, level, plusDays(today, -1)).map((at) => ({
			at
		}));
		if (r.firstDate <= today && today <= r.lastDate) stops.push("now");
		return stops;
	}
	return starts(r.firstDate, r.lastDate, level, today).map((at) =>
		today < nextStart(at, level) ? { at, soFar: true } : { at }
	);
}

/** How many stops `range` widens to at `resolution`, counting periods after today too. */
export function stopCount(range: DateRangeSpec, resolution: Level, now: Date): number {
	const level = mapLevel(resolution);
	const r = resolveRange(range, now, level);
	if (level === "day") {
		const day = (key: string) => {
			const { y, m, d } = parseDateKey(key);
			return Date.UTC(y, m - 1, d) / MS_PER_DAY;
		};
		return day(r.lastDate) - day(r.firstDate) + 1;
	}
	const a = parseDateKey(r.firstDate);
	const b = parseDateKey(r.lastDate);
	return level === "year" ? b.y - a.y + 1 : (b.y - a.y) * 12 + (b.m - a.m) + 1;
}

/** Whether `range` has more than the Map's `MAP_MAX_STOPS` stops at `resolution`. */
export function stopsOverCap(range: DateRangeSpec, resolution: Level, now: Date): boolean {
	return stopCount(range, resolution, now) > MAP_MAX_STOPS;
}

/** A stop's label, through `format`: the long date, the month, the year (the current "so far"). */
export function stopLabel(stop: Stop, resolution: Level): string {
	if (stop === "now") return m.map_day_now();
	const level = mapLevel(resolution);
	if (level === "day") return formatLongWeekdayDate(stop.at, { year: true });
	const period = level === "month" ? formatMonth(stop.at) : formatYear(stop.at);
	return stop.soFar ? m.map_stop_so_far({ period }) : period;
}

/** The stop to show: the saved one when it is a stop, else the last stop (null: no stops). */
export function openStop(saved: string | undefined, stops: Stop[]): Stop | null {
	if (stops.length === 0) return null;
	const found = saved === undefined ? undefined : stops.find((s) => s !== "now" && s.at === saved);
	return found ?? stops[stops.length - 1];
}

/** The option value for a stop: the last stop is stored as missing. */
export function stopOption(stop: Stop, stops: Stop[]): string | undefined {
	const last = stops[stops.length - 1];
	if (stop === "now" || (last !== undefined && stopKey(stop) === stopKey(last))) return undefined;
	return stop.at;
}

/** Page Up / Page Down's step at each level: a week, a year of months, a decade. */
export const PAGE_STOPS: Record<MapLevel, number> = { day: 7, month: 12, year: 10 };

/** The stop a key moves to (slider pattern); null for keys it doesn't handle. */
export function stepKey(key: string, at: number, count: number, page = 7): number | null {
	if (count === 0) return null;
	const clamp = (i: number) => Math.min(Math.max(i, 0), count - 1);
	switch (key) {
		case "ArrowLeft":
		case "ArrowDown":
			return clamp(at - 1);
		case "ArrowRight":
		case "ArrowUp":
			return clamp(at + 1);
		case "PageDown":
			return clamp(at - page);
		case "PageUp":
			return clamp(at + page);
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
