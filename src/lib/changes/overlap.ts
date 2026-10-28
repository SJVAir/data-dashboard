import type { Change } from "./types";

/**
 * Whether two changes made on different sides touch the same thing, so neither can be
 * replayed over the other silently: the same field of the same widget (or the same document
 * field), either side replacing the whole document, or one side removing a widget the other
 * side changed. Both sides removing the same widget, or setting the same field to the same
 * value, agree, so that is not an overlap.
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
		return a.target.widgetIds.some(
			(id) => id in b.to && JSON.stringify(a.to[id]) !== JSON.stringify(b.to[id])
		);
	}
	if (a.op === "removeWidget" && b.op === "removeWidget") return false;
	if (a.op === "removeWidget") return touches(b, a.target.widgetId);
	if (b.op === "removeWidget") return touches(a, b.target.widgetId);
	return false;
}

/** Whether a (non-removal) change targets the widget. */
function touches(change: Change, widgetId: string): boolean {
	if (change.op === "setLayout") return change.target.widgetIds.includes(widgetId);
	return "widgetId" in change.target && change.target.widgetId === widgetId;
}
