import type { Rect } from "$lib/documents/schema";
import type { Placement } from "./types";

/**
 * A placement has two fields, its rect and whether it's minimized. A setLayout entry sets only
 * the fields whose `from` and `to` differ, so a tidy fix (rect only) and a minimize (minimized
 * only) of the same widget, made in different tabs, combine instead of undoing each other.
 */
export function sameRect(a: Rect, b: Rect): boolean {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function sameMinimized(a: Placement["minimized"], b: Placement["minimized"]): boolean {
	return a?.order === b?.order;
}

/** Which fields the entry sets (both, when there is no `from` to compare with). */
export function changedFields(
	from: Placement | undefined,
	to: Placement
): { rect: boolean; minimized: boolean } {
	return {
		rect: !from || !sameRect(from.rect, to.rect),
		minimized: !from || !sameMinimized(from.minimized, to.minimized)
	};
}
