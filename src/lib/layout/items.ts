import type { Rect, WidgetInstance } from "$lib/documents/schema";
import { getWidgetType } from "$lib/widgets/registry";
import { GRID_COLUMNS } from "./config";
import { placeNew, tidy, type Layout, type LayoutItem, type Size } from "./engine";

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
