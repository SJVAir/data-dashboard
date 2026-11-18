import { untrack } from "svelte";
import type { MapContext } from "@sjvair/map-sdk";

/** Under the monitors when they're on the map, else on top. */
export function underMonitors(current: MapContext): { before?: string } {
	return untrack(() => current.plugins.some((p) => p.id === "monitors"))
		? { before: "monitors" }
		: {};
}

/**
 * The layers under the focus area, bottom first: the fill, then pesticide use above it (so its
 * classes match the legend, and its shapes take the pointer for the lens).
 */
export const UNDER_FOCUS = ["fill", "townships", "lens", "sections"] as const;

/**
 * Where `id` goes among `UNDER_FOCUS`: just below the first plugin listed after it that is on the
 * map, else just below the focus area. Read untracked.
 */
export function beforeIn(current: MapContext, id: string): { before: string } {
	return untrack(() => {
		const after = UNDER_FOCUS.slice(UNDER_FOCUS.indexOf(id as (typeof UNDER_FOCUS)[number]) + 1);
		const on = new Set(current.plugins.map((p) => p.id));
		return { before: after.find((next) => on.has(next)) ?? "focus" };
	});
}
