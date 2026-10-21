import type { Component } from "svelte";
import type { MenuProvider } from "$lib/actions/types";
import type { WidgetInstance } from "$lib/documents/schema";

export type WidgetType = {
	type: string;
	label: () => string;
	minSize: { w: number; h: number };
	defaultSize: { w: number; h: number };
	time: "range" | "now" | "none";
	thresholds: boolean;
	analyzable: boolean;
	// Placeholders, finalized in spec 2 / step 4.
	accepts?: unknown;
	placePicker?: unknown;
	resolution?: unknown;
	dateMethods?: unknown;
	span?: unknown;
	defaultTitle(widget: WidgetInstance): string;
	menu: MenuProvider;
	component: Component<{ widget: WidgetInstance }>;
};

const types = new Map<string, WidgetType>();

export function registerWidgetType(t: WidgetType): void {
	types.set(t.type, t);
}

export function getWidgetType(type: string): WidgetType | undefined {
	return types.get(type);
}
