import type { WidgetInstance } from "$lib/documents/schema";
import type { Change, Placement } from "$lib/changes/types";
import { getWidgetType } from "$lib/widgets/registry";
import { GRID_COLUMNS } from "./config";
import { placeNew, tidy } from "./engine";
import { FALLBACK_MIN_SIZE, gridItems, layoutChange, placeNewWidget } from "./items";

/** The `order` for the next widget to be minimized: one more than the highest, else 0. */
export function nextMinimizedOrder(widgets: WidgetInstance[]): number {
	let max = -1;
	for (const w of widgets) if (w.minimized && w.minimized.order > max) max = w.minimized.order;
	return max + 1;
}

/**
 * Where a duplicate of `widget` goes: a grid widget's copy in the grid's first free place, a
 * minimized widget's copy minimized too, at the taskbar's right end.
 */
export function copyPlacement(
	widgets: WidgetInstance[],
	widget: WidgetInstance
): Pick<WidgetInstance, "rect" | "minimized"> {
	if (widget.minimized) {
		return { rect: { ...widget.rect }, minimized: { order: nextMinimizedOrder(widgets) } };
	}
	return { rect: placeNewWidget(widgets, { w: widget.rect.w, h: widget.rect.h }) };
}

/** The minimized widgets in taskbar order: by `order`, ties by id. */
export function taskbarWidgets(widgets: WidgetInstance[]): WidgetInstance[] {
	return widgets
		.filter((w) => w.minimized)
		.sort(
			(a, b) => a.minimized!.order - b.minimized!.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		);
}

/**
 * A setLayout for the target plus the tidy fixes due before the change (grid widgets whose
 * saved rect differs from the tidied grid). Minimize deliberately does not save the close-up of
 * the gap, so two tabs minimizing different widgets don't conflict.
 */
function withTarget(widgets: WidgetInstance[], target: WidgetInstance, to: Placement): Change {
	const fixes = layoutChange(widgets, tidy(gridItems(widgets), GRID_COLUMNS));
	const from: Record<string, Placement> = fixes && fixes.op === "setLayout" ? fixes.from : {};
	const toMap: Record<string, Placement> = fixes && fixes.op === "setLayout" ? fixes.to : {};
	from[target.id] = { rect: target.rect, minimized: target.minimized ?? null };
	toMap[target.id] = to;
	return { op: "setLayout", target: { widgetIds: Object.keys(toMap) }, from, to: toMap };
}

/** Minimize a grid widget to the taskbar; null if it is missing or already minimized. */
export function minimizeChange(widgets: WidgetInstance[], id: string): Change | null {
	const target = widgets.find((w) => w.id === id);
	if (!target || target.minimized) return null;
	return withTarget(widgets, target, {
		rect: target.rect,
		minimized: { order: nextMinimizedOrder(widgets) }
	});
}

/** Restore a minimized widget below the grid; null if it is missing or not minimized. */
export function restoreChange(widgets: WidgetInstance[], id: string): Change | null {
	const target = widgets.find((w) => w.id === id);
	if (!target || !target.minimized) return null;
	const min = getWidgetType(target.type)?.minSize ?? FALLBACK_MIN_SIZE;
	const size = {
		w: Math.min(GRID_COLUMNS, Math.max(target.rect.w, min.w)),
		h: Math.max(target.rect.h, min.h)
	};
	const tidied = tidy(gridItems(widgets), GRID_COLUMNS);
	return withTarget(widgets, target, {
		rect: placeNew(tidied, size, GRID_COLUMNS),
		minimized: null
	});
}
