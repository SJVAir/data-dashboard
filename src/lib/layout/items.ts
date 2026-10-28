import type { Rect, WidgetInstance } from "$lib/documents/schema";
import { getWidgetType } from "$lib/widgets/registry";
import { GRID_COLUMNS } from "./config";
import type { Change, Placement } from "$lib/changes/types";
import { diff, placeNew, tidy, type Layout, type LayoutItem, type Size } from "./engine";

/** The placeholder type's minimum size; used for widgets of a type that isn't registered. */
export const FALLBACK_MIN_SIZE: Size = { w: 3, h: 2 };

/** Layout items for the widgets on the grid (minimized ones are off it). */
export function gridItems(widgets: WidgetInstance[]): LayoutItem[] {
	return widgets
		.filter((w) => !w.minimized)
		.map((w) => ({
			id: w.id,
			rect: w.rect,
			minSize: getWidgetType(w.type)?.minSize ?? FALLBACK_MIN_SIZE
		}));
}

/** The tidied layout of the widgets shown on the grid. */
export function shownLayout(widgets: WidgetInstance[], columns?: number): Layout {
	return tidy(gridItems(widgets), columns ?? GRID_COLUMNS);
}

/** A new widget's rect: column 0, below everything on the grid. */
export function placeNewWidget(widgets: WidgetInstance[], size: Size): Rect {
	return placeNew(gridItems(widgets), size, GRID_COLUMNS);
}

/**
 * A setLayout for every grid widget whose saved rect differs from `after` (tidy fixes
 * included), or null when nothing differs. Grid widgets are never minimized.
 */
export function layoutChange(widgets: WidgetInstance[], after: Layout): Change | null {
	const changed = diff(gridItems(widgets), after);
	const ids = Object.keys(changed);
	if (ids.length === 0) return null;
	const from: Record<string, Placement> = {};
	const to: Record<string, Placement> = {};
	for (const id of ids) {
		const saved = widgets.find((w) => w.id === id);
		if (!saved) continue;
		from[id] = { rect: saved.rect, minimized: null };
		to[id] = { rect: changed[id], minimized: null };
	}
	const widgetIds = Object.keys(to);
	return widgetIds.length === 0 ? null : { op: "setLayout", target: { widgetIds }, from, to };
}
