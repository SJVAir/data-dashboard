import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import { placeAtBottom } from "../placement";
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
	menu: () => [], // Task 16 adds the widget actions
	component: Placeholder
};

export function newPlaceholder(widgets: WidgetInstance[]): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: PLACEHOLDER_TYPE,
		title: null,
		rect: placeAtBottom(widgets, placeholderType.defaultSize),
		data: { layers: [] }
	};
}
