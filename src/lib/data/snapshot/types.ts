import type { DayKind } from "../day-state";
import type { Level } from "../metadata";

/**
 * `now`, one Pacific date key (`YYYY-MM-DD`), or a month or year by its start key (a Map's
 * Monthly or Yearly stop).
 */
export type SnapshotAt = "now" | { day: string } | { start: string; resolution: "month" | "year" };

export type SnapshotFigure = {
	value: number | null;
	level: Level | null;
	kind: DayKind;
	/**
	 * A month's or year's too-thin figure: how many days had a figure, of those expected (the row's
	 * `daily_statistic_days` / `daily_statistic_expected_days`), when the row has both.
	 */
	days?: { days: number; expected: number };
};

export type Snapshot = {
	/** Keyed by monitor id, or by region `type:code`. */
	figures: Map<string, SnapshotFigure>;
	/** Every figure final (a past stop only); false makes the source poll hourly. */
	final: boolean;
	/** The scale has no daily_statistic: every figure is unrated. */
	unrated: boolean;
};

export type MonitorScope =
	| { kind: "regions"; ids: string[] }
	| { kind: "monitors"; ids: string[] }
	/**
	 * Every monitor of `types` inside the regions `regionIds` (server ids), plus the searched
	 * monitors `ids` wherever they are.
	 */
	| { kind: "monitor-set"; types: string[]; regionIds: string[]; ids: string[] };
