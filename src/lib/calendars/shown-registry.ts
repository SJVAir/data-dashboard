// Light on purpose: the calendars' menu item (in the initial bundle) reads it; each mounted
// calendar (lazy code) writes it. So the menu needn't resolve date ranges itself.

type Span = { start: string; end: string };

/** Per widget id, what each mounted copy of it shows (a widget and its Get data preview). */
const shown = new Map<string, Map<symbol, Span>>();

/** Records the selected days a mounted calendar shows (`null`: none); returns its removal. */
export function setShownSelection(widgetId: string, owner: symbol, sel: Span | null): () => void {
	let copies = shown.get(widgetId);
	if (sel) {
		if (!copies) shown.set(widgetId, (copies = new Map()));
		copies.set(owner, sel);
	} else {
		copies?.delete(owner);
		if (copies?.size === 0) shown.delete(widgetId);
	}
	return () => setShownSelection(widgetId, owner, null);
}

/** Whether a mounted calendar for the widget shows some selected days. */
export function showsSelection(widgetId: string): boolean {
	return (shown.get(widgetId)?.size ?? 0) > 0;
}
