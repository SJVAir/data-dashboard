import type { Level } from "$lib/data/metadata";

/** A widget's standing threshold crossing: the level it reached, when, and a counter that replays the pulse. */
export type ThresholdMark = { level: Level; at: number; pulse: number };

/**
 * The key a mark (and "last told") is held under: the widget id, with the pollutant's entry type
 * for a widget watched per pollutant (Current conditions).
 */
export function markKey(widgetId: string, entryType?: string): string {
	return entryType === undefined ? widgetId : `${widgetId}:${entryType}`;
}

/** The marks by `markKey`; the dashboard's watcher writes them, the tiles read them. */
export const thresholdMarks = $state<Record<string, ThresholdMark>>({});

export function setMark(widgetId: string, mark: ThresholdMark | null): void {
	if (mark) thresholdMarks[widgetId] = mark;
	else delete thresholdMarks[widgetId];
}
