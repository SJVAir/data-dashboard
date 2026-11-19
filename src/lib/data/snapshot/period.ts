import { addDays, daysInMonth } from "$lib/format";
import { levelFor, type Figure, type Level } from "../metadata";
import { numberOf } from "./rows";
import type { SnapshotAt, SnapshotFigure } from "./types";

/** A month or year stop. */
export type PeriodAt = Extract<SnapshotAt, { start: string }>;

/** The period's last Pacific date key (inclusive). */
export function periodEnd(at: PeriodAt): string {
	return at.resolution === "year"
		? `${at.start.slice(0, 4)}-12-31`
		: addDays(at.start, daysInMonth(at.start) - 1);
}

/** Whether the period holds `today` (it is the current month or year, drawn so far). */
export function periodHolds(at: PeriodAt, today: string): boolean {
	return at.start <= today && today <= periodEnd(at);
}

/**
 * One place's figure for a month or year, from its row read with the period's figure (the
 * average of the daily figures, `scale.period_statistic`), coloured by the daily scale's levels.
 * A null figure (fewer than 75% of the days had one) is `thin`, not final or not; a not-final
 * row with a figure is `pending`; no figure for the scale, `unrated`.
 */
export function periodFigure(args: {
	row: Record<string, unknown> & { is_final: boolean };
	figure: Figure | null;
	levels: Level[];
}): SnapshotFigure {
	const { row, figure, levels } = args;
	if (figure === null) return { value: null, level: null, kind: "unrated" };
	const value = numberOf(row[figure.field]);
	if (value === null) return { value: null, level: null, kind: "thin" };
	return {
		value,
		level: levelFor(levels, value) ?? null,
		kind: row.is_final ? "rated" : "pending"
	};
}
