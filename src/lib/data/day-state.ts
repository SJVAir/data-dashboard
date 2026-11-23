import { TZDate } from "@date-fns/tz";
import { TIME_ZONE, toKey } from "$lib/format";
import { levelFor, type Figure, type Level } from "$lib/data/metadata";
import type { SeriesPoint } from "$lib/data/types";

/**
 * `thin`: not enough data; `pending`: not final yet; `unrated`: the scale has no
 * `daily_statistic`.
 */
export type DayKind = "rated" | "thin" | "none" | "today" | "pending" | "future" | "unrated";

export type DayState = { date: string; kind: DayKind; value: number | null; level: Level | null };

/** The Pacific date a daily point starts on. */
function pointDate(point: SeriesPoint): string {
	return toKey(new TZDate(point.t, TIME_ZONE));
}

/** The state of each of `dates`, from the daily points read with a figure. */
export function dayStates(args: {
	points: SeriesPoint[];
	dates: string[];
	today: string;
	figure: Figure | null;
	levels: Level[];
}): Map<string, DayState> {
	const { points, dates, today, figure, levels } = args;
	const byDate = new Map<string, SeriesPoint>();
	for (const point of points) byDate.set(pointDate(point), point);

	const states = new Map<string, DayState>();
	for (const date of dates) {
		const point = byDate.get(date);
		const row = point && { figure: point.figure ?? null, final: point.final };
		states.set(date, dayState({ date, today, row, figure, levels }));
	}
	return states;
}

/** One day's state, from its row (if any) read with a figure. */
export function dayState(args: {
	date: string;
	today: string;
	row: { figure: number | null; final?: boolean } | undefined;
	figure: Figure | null;
	levels: Level[];
}): DayState {
	const { date, today, row, figure, levels } = args;
	const make = (kind: DayKind, value: number | null = null): DayState => ({
		date,
		kind,
		value,
		level: value === null ? null : (levelFor(levels, value) ?? null)
	});
	if (date > today) return make("future");
	if (figure === null) return make(date === today ? "today" : "unrated");
	const value = row?.figure ?? null;
	if (date === today) return make("today", value);
	if (!row) return make("none");
	if (row.final === false) return make("pending", value);
	return make(value === null ? "thin" : "rated", value);
}

/** Whether the day's figure counts toward threshold counts and summaries. */
export function ratedForCount(s: DayState): boolean {
	return s.value !== null && (s.kind === "rated" || s.kind === "today");
}

/** How many counted days sit at or above `level`, out of all counted days. */
export function thresholdCount(states: DayState[], level: Level): { at: number; rated: number } {
	let at = 0;
	let rated = 0;
	for (const s of states) {
		if (!ratedForCount(s)) continue;
		rated += 1;
		if (s.value! >= level.min) at += 1;
	}
	return { at, rated };
}
