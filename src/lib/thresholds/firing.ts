import type { Level } from "$lib/data/metadata";

export const REARM_MS = 2 * 60 * 60 * 1000;

/** What we last told the person: the level (null = armed) and when (epoch ms). */
export type Told = { level: string | null; at: number };

/**
 * Whether a reading should fire a toast. Fires on reaching the threshold, then again only when
 * worse (later in the scale's order). A below-threshold reading 2 h or more after the last
 * toast re-arms. The very first reading never fires.
 */
export function decide(
	told: Told | undefined,
	reading: { level: string; at: number },
	threshold: Level,
	levels: Level[]
): { fire: boolean; told: Told } {
	const unchanged = told ?? { level: null, at: reading.at };
	const index = levels.findIndex((level) => level.key === reading.level);
	if (index === -1) return { fire: false, told: unchanged };
	const limit = levels.findIndex((level) => level.key === threshold.key);
	const atOrAbove = index >= limit;

	if (!told) {
		return { fire: false, told: { level: atOrAbove ? reading.level : null, at: reading.at } };
	}
	if (!atOrAbove) {
		if (told.level !== null && reading.at - told.at >= REARM_MS) {
			return { fire: false, told: { level: null, at: reading.at } };
		}
		return { fire: false, told };
	}
	const toldIndex = told.level === null ? -1 : levels.findIndex((l) => l.key === told.level);
	if (index > toldIndex) return { fire: true, told: { level: reading.level, at: reading.at } };
	return { fire: false, told };
}
