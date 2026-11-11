/**
 * "Edit data": a widget's data, type, options and alert level as a Get data draft, and Save
 * changes.
 */
import type { SetWidgetDataChange } from "$lib/changes/types";
import { GRID_COLUMNS, type Rect, type WidgetInstance } from "$lib/documents/schema";
import { canonicalJson } from "$lib/sharing/fingerprint";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { getWidgetType } from "$lib/widgets/registry";
import type { Draft } from "./draft.svelte";

/** The draft Edit data starts from: the widget's type, data, options and thresholds. */
export function editDraft(widget: WidgetInstance): Draft {
	return {
		type: widget.type,
		data: structuredClone(widget.data),
		...(widget.options ? { options: structuredClone(widget.options) as Draft["options"] } : {}),
		...(widget.thresholds ? { thresholds: structuredClone(widget.thresholds) } : {})
	};
}

const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** Whether `draft` would change anything about `initial`. */
export function draftChanged(initial: Draft, draft: Draft): boolean {
	return !same(initial, draft);
}

/**
 * Save changes: `draft` as one `setWidgetData` on the widget (one undo step), its type, options
 * and thresholds included, and its size grown to the new type's `minSize` when it's smaller (moved left
 * if it would then leave the grid). False, applying nothing, when nothing differs. Throws when
 * the widget isn't in the document.
 */
export function saveEdit(session: DocumentSession, widgetId: string, draft: Draft): boolean {
	const widget = session.editTarget.doc.body.widgets.find((w) => w.id === widgetId);
	if (!widget) throw new Error(`No widget ${widgetId}`);
	const typeChanged = widget.type !== draft.type;
	const dataChanged = !same(widget.data, draft.data);
	const optionsChanged = !same(widget.options, draft.options);
	// Only a type with thresholds keeps them.
	const kept = getWidgetType(draft.type)?.thresholds === false ? undefined : draft.thresholds;
	const thresholdsChanged = !same(widget.thresholds, kept);
	if (!typeChanged && !dataChanged && !optionsChanged && !thresholdsChanged) return false;
	const change: SetWidgetDataChange = {
		op: "setWidgetData",
		target: { widgetId },
		from: widget.data,
		to: structuredClone(draft.data)
	};
	if (typeChanged) {
		change.type = { from: widget.type, to: draft.type };
		const rect = clampedRect(widget.rect, getWidgetType(draft.type)?.minSize);
		if (rect) change.rect = { from: widget.rect, to: rect };
	}
	if (optionsChanged) {
		change.options = {
			from: widget.options,
			to: draft.options ? structuredClone(draft.options) : undefined
		};
	}
	if (thresholdsChanged) {
		change.thresholds = {
			from: widget.thresholds,
			to: kept ? structuredClone(kept) : undefined
		};
	}
	session.apply(change);
	return true;
}

/** `rect` grown to `min`, or null when it's already that big. */
function clampedRect(rect: Rect, min: { w: number; h: number } | undefined): Rect | null {
	if (!min || (rect.w >= min.w && rect.h >= min.h)) return null;
	const w = Math.min(Math.max(rect.w, min.w), GRID_COLUMNS);
	return { x: Math.min(rect.x, GRID_COLUMNS - w), y: rect.y, w, h: Math.max(rect.h, min.h) };
}
