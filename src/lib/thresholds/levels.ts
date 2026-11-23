import type { Level } from "$lib/data/metadata";
import type { Threshold } from "./schema";

/** The first level with tier 2 (the "sensitive groups" tier), or null when there is none. */
export function defaultThresholdLevel(levels: Level[]): string | null {
	return levels.find((level) => level.tier === 2)?.key ?? null;
}

/** The saved threshold for `entryType`, or (without one) the first. */
export function thresholdFor(
	saved: Threshold[] | undefined,
	entryType?: string
): Threshold | undefined {
	if (entryType === undefined) return saved?.[0];
	return saved?.find((t) => t.entryType === entryType);
}

/**
 * Replace or remove one pollutant's threshold, keeping the others in order. `undefined` when
 * nothing is left.
 */
export function withThreshold(
	saved: Threshold[] | undefined,
	entryType: string,
	next: Threshold | undefined
): Threshold[] | undefined {
	const list = saved ?? [];
	const at = list.findIndex((t) => t.entryType === entryType);
	let out: Threshold[];
	if (next === undefined) out = list.filter((_, i) => i !== at);
	else if (at === -1) out = [...list, next];
	else out = list.map((t, i) => (i === at ? next : t));
	return out.length > 0 ? out : undefined;
}

/**
 * The level a widget watches. `null` when Off or the scale has no levels; a saved key the scale
 * no longer has falls back to the default (`fellBack: true`).
 */
export function resolveThreshold(
	saved: Threshold[] | undefined,
	levels: Level[],
	entryType?: string
): { level: Level; fellBack: boolean } | null {
	const key = thresholdFor(saved, entryType)?.level;
	if (key === undefined || levels.length === 0) return null;
	const exact = levels.find((level) => level.key === key);
	if (exact) return { level: exact, fellBack: false };
	const fallbackKey = defaultThresholdLevel(levels);
	const fallback = levels.find((level) => level.key === fallbackKey);
	return fallback ? { level: fallback, fellBack: true } : null;
}
