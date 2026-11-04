import SquareDashed from "@lucide/svelte/icons/square-dashed";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { FALLBACK_MIN_SIZE, placeNewWidget } from "$lib/layout/items";
import type { WidgetType } from "../registry";

export const PLACEHOLDER_TYPE = "placeholder";

export const placeholderType: WidgetType = {
	type: PLACEHOLDER_TYPE,
	label: () => m.widget_placeholder_title(),
	minSize: FALLBACK_MIN_SIZE,
	defaultSize: { w: 3, h: 4 },
	time: "none",
	thresholds: false,
	analyzable: false,
	downloadable: false,
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	icon: SquareDashed,
	load: () => import("./Placeholder.svelte").then((mod) => ({ component: mod.default }))
	// Not `addable`: it's for tests and the starter, never offered in Add widget.
};

export function newPlaceholder(widgets: WidgetInstance[]): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: PLACEHOLDER_TYPE,
		title: null,
		rect: placeNewWidget(widgets, placeholderType.defaultSize),
		data: { layers: [] }
	};
}
