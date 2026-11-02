import SquareDashed from "@lucide/svelte/icons/square-dashed";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { FALLBACK_MIN_SIZE, placeNewWidget } from "$lib/layout/items";
import type { WidgetType } from "../registry";
import Placeholder from "./Placeholder.svelte";

export const PLACEHOLDER_TYPE = "placeholder";

export const placeholderType: WidgetType = {
	type: PLACEHOLDER_TYPE,
	label: () => m.widget_placeholder_title(),
	minSize: FALLBACK_MIN_SIZE,
	defaultSize: { w: 6, h: 4 },
	time: "none",
	thresholds: false,
	analyzable: false,
	defaultTitle: () => m.widget_placeholder_title(),
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	icon: SquareDashed,
	component: Placeholder
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
