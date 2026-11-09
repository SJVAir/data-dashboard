import type { Platform, SpaceId } from "$lib/platform/types";

/** Preference key (per space): the contribution calendar's "Show patterns" switch. */
export const PATTERNS_KEY = "calendarPatterns";

/** One state for every contribution calendar in this tab. On by default. */
const pref = $state({ on: true });
let bound: { p: Pick<Platform, "preferences">; space: SpaceId } | null = null;
/** Bumped by each load and set, so a late read never undoes a newer choice. */
let generation = 0;

/** Whether "Show patterns" is on (reactive). */
export function patternsOn(): boolean {
	return pref.on;
}

/**
 * Reads the space's stored choice, once per platform and space: a calendar calls this as it
 * opens. Another space starts on until its own value arrives.
 */
export function loadPatterns(p: Pick<Platform, "preferences">, space: SpaceId): void {
	if (bound?.p === p && bound.space === space) return;
	bound = { p, space };
	pref.on = true;
	const mine = ++generation;
	p.preferences
		.get<boolean>(space, PATTERNS_KEY)
		.then((stored) => {
			if (mine === generation && stored === false) pref.on = false;
		})
		.catch(() => {
			// Unreadable: patterns stay on.
		});
}

/** Turns "Show patterns" on or off for every calendar, and stores it (this device, this space). */
export async function setPatternsOn(on: boolean): Promise<void> {
	generation++;
	pref.on = on;
	if (bound) await bound.p.preferences.set(bound.space, PATTERNS_KEY, on);
}
