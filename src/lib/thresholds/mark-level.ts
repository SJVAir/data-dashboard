import type { Level } from "$lib/data/metadata";
import { STALE_MS, type CurrentReading } from "$lib/data/now/current";

function atOrAbove(level: Level, threshold: Level, levels: Level[]): boolean {
	const index = levels.findIndex((l) => l.key === level.key);
	const limit = levels.findIndex((l) => l.key === threshold.key);
	return index !== -1 && limit !== -1 && index >= limit;
}

/**
 * The level a "now" tile's mark shows for `reading`: its level when at or above `threshold`;
 * null below it, with no threshold, or when the place has no current value (pending,
 * insufficient, no recent data, no data, or a reading older than `STALE_MS` at `now`);
 * `undefined` (leave the mark as it is) with no reading (loading, or a failed fetch that still
 * holds the last data) or a value with no level.
 */
export function markLevel(
	reading: CurrentReading | undefined,
	threshold: Level | null,
	levels: Level[],
	now: number
): Level | null | undefined {
	if (!threshold) return null;
	if (reading && reading.status !== "ok") return null;
	if (reading && now - reading.at > STALE_MS) return null;
	if (!reading?.level) return undefined;
	return atOrAbove(reading.level, threshold, levels) ? reading.level : null;
}

/**
 * Context key: when true, "now" tiles mark themselves from their own reading (the Get data
 * preview, which no watcher watches: a mark, never a toast or "last told").
 */
export const LOCAL_MARKS_KEY = Symbol("local-marks");
