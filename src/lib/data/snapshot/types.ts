import type { DayKind } from "../day-state";
import type { Level } from "../metadata";

/**
 * `now`, one Pacific date key (`YYYY-MM-DD`), or a month or year by its start key (a Map's
 * Monthly or Yearly stop).
 */
export type SnapshotAt = "now" | { day: string } | { start: string; resolution: "month" | "year" };

export type SnapshotFigure = { value: number | null; level: Level | null; kind: DayKind };

export type Snapshot = {
	/** Keyed by monitor id, or by region `type:code`. */
	figures: Map<string, SnapshotFigure>;
	/** Every figure final (a past stop only); false makes the source poll hourly. */
	final: boolean;
	/** The scale has no daily_statistic: every figure is unrated. */
	unrated: boolean;
};

export type MonitorScope =
	{ kind: "regions"; ids: string[] } | { kind: "monitors"; ids: string[] } | { kind: "all" };
