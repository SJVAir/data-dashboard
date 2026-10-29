import { changedFields, sameMinimized, sameRect } from "./placement";
import type { Change, SetLayoutChange } from "./types";

/**
 * Whether two changes made on different sides touch the same thing, so neither can be
 * replayed over the other silently: the same field of the same widget (or the same document
 * field; a placement's rect and minimized are separate fields), either side replacing the
 * whole document, or one side removing a widget the other side changed. Both sides removing
 * the same widget, or setting the same field to the same value, agree, so that is not an
 * overlap.
 */
export function changesOverlap(a: Change, b: Change): boolean {
	// Replacing the whole document touches everything, including another replacement.
	if (a.op === "replaceDocument" || b.op === "replaceDocument") return true;
	if (a.op === "setField" && b.op === "setField") {
		return (
			a.target.widgetId === b.target.widgetId && a.target.path === b.target.path && a.to !== b.to
		);
	}
	if (a.op === "setLayout" && b.op === "setLayout") {
		return a.target.widgetIds.some((id) => placementsOverlap(a, b, id));
	}
	if (a.op === "removeWidget" && b.op === "removeWidget") return false;
	if (a.op === "removeWidget") return touches(b, a.target.widgetId);
	if (b.op === "removeWidget") return touches(a, b.target.widgetId);
	return false;
}

/**
 * Whether both sides set the same field of the widget's placement (rect, or minimized) to
 * different values. A tidy fix on one side and a minimize on the other set different fields.
 */
function placementsOverlap(a: SetLayoutChange, b: SetLayoutChange, id: string): boolean {
	if (!Object.hasOwn(a.to, id) || !Object.hasOwn(b.to, id)) return false;
	const aSets = changedFields(Object.hasOwn(a.from, id) ? a.from[id] : undefined, a.to[id]);
	const bSets = changedFields(Object.hasOwn(b.from, id) ? b.from[id] : undefined, b.to[id]);
	return (
		(aSets.rect && bSets.rect && !sameRect(a.to[id].rect, b.to[id].rect)) ||
		(aSets.minimized && bSets.minimized && !sameMinimized(a.to[id].minimized, b.to[id].minimized))
	);
}

/** Whether a (non-removal) change targets the widget. */
function touches(change: Change, widgetId: string): boolean {
	if (change.op === "setLayout") return change.target.widgetIds.includes(widgetId);
	return "widgetId" in change.target && change.target.widgetId === widgetId;
}
