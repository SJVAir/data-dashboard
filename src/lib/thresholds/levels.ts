import type { Level } from "$lib/data/metadata";
import type { Threshold } from "./schema";

/** The first level with tier 2 (the "sensitive groups" tier), or null when there is none. */
export function defaultThresholdLevel(levels: Level[]): string | null {
	return levels.find((level) => level.tier === 2)?.key ?? null;
}

/**
 * The level a widget watches. `null` when Off or the scale has no levels; a saved key the scale
 * no longer has falls back to the default (`fellBack: true`).
 */
export function resolveThreshold(
	saved: Threshold[] | undefined,
	levels: Level[]
): { level: Level; fellBack: boolean } | null {
	const key = saved?.[0]?.level;
	if (key === undefined || levels.length === 0) return null;
	const exact = levels.find((level) => level.key === key);
	if (exact) return { level: exact, fellBack: false };
	const fallbackKey = defaultThresholdLevel(levels);
	const fallback = levels.find((level) => level.key === fallbackKey);
	return fallback ? { level: fallback, fellBack: true } : null;
}
