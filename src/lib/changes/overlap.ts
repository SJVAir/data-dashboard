import type { Change } from "./types";

/**
 * Whether two changes made on different sides touch the same thing, so neither can be
 * replayed over the other silently: the same field of the same widget (or the same document
 * field; a placement's rect and minimized are separate fields), either side replacing the
 * whole document, or one side removing a widget the other side changed. Both sides deleting the
 * dashboard (any times) agree too. Both sides removing
 * the same widget, or setting the same field to the same value, agree, so that is not an
 * overlap. Layout moves (`setLayout`) never overlap each other or a removal.
 */
export function changesOverlap(a: Change, b: Change): boolean {
	// Replacing the whole document touches everything, including another replacement.
	if (a.op === "replaceDocument" || b.op === "replaceDocument") return true;
	if (a.op === "setField" && b.op === "setField") {
		// Both sides deleted the dashboard: they agree, whatever the times.
		if (a.target.path === "deletedAt" && b.target.path === "deletedAt") {
			if (a.to !== null && b.to !== null) return false;
		}
		return (
			a.target.widgetId === b.target.widgetId && a.target.path === b.target.path && a.to !== b.to
		);
	}
	// Layout moves never overlap another move or a removal: the last save wins, and a move of
	// a removed widget is dropped when replayed.
	if (a.op === "setLayout" && (b.op === "setLayout" || b.op === "removeWidget")) return false;
	if (b.op === "setLayout" && a.op === "removeWidget") return false;
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
