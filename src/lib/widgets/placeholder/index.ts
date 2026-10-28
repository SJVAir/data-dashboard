import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { placeNew, toItems } from "$lib/layout/engine";
import { GRID_COLUMNS } from "$lib/layout/config";
import type { WidgetType } from "../registry";
import Placeholder from "./Placeholder.svelte";

export const PLACEHOLDER_TYPE = "placeholder";

export const placeholderType: WidgetType = {
	type: PLACEHOLDER_TYPE,
	label: () => m.widget_placeholder_title(),
	minSize: { w: 2, h: 2 },
	defaultSize: { w: 6, h: 4 },
	time: "none",
	thresholds: false,
	analyzable: false,
	defaultTitle: () => m.widget_placeholder_title(),
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	component: Placeholder
};

export function newPlaceholder(widgets: WidgetInstance[]): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: PLACEHOLDER_TYPE,
		title: null,
		rect: placeNew(toItems(widgets), placeholderType.defaultSize, GRID_COLUMNS),
		data: { layers: [] }
	};
}
