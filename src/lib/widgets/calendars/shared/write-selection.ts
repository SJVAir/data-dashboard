import type { WidgetInstance } from "$lib/documents/schema";
import type { AppContext } from "$lib/store/app.svelte";

export type DaySpan = { start: string; end: string };

/**
 * Whether a calendar's selection is saved: the widget is in the current, editable dashboard.
 * Shared and read-only views, and Get data's preview, keep it in the component instead.
 */
export function canWriteSelection(app: AppContext, widgetId: string): boolean {
	const session = app.current.session;
	return !!session && !session.readOnly && session.doc.body.widgets.some((w) => w.id === widgetId);
}

/**
 * Saves the selected days as the widget's `timeSubRange` (or removes it), as one `setWidgetData`
 * change: one undo step. Nothing is applied when it wouldn't change anything or can't be saved.
 */
export function writeSelection(app: AppContext, widget: WidgetInstance, sel: DaySpan | null): void {
	const session = app.current.session;
	if (!session || session.readOnly) return;
	const current = session.doc.body.widgets.find((w) => w.id === widget.id);
	if (!current) return;
	const { timeSubRange: old, ...rest } = current.data;
	if (sel ? old?.start === sel.start && old?.end === sel.end : !old) return;
	const to = structuredClone(rest);
	session.apply({
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: current.data,
		to: sel ? { ...to, timeSubRange: { start: sel.start, end: sel.end } } : to
	});
}
