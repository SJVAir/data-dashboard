import type { Component } from "svelte";
import type { MenuProvider } from "$lib/actions/types";
import type { DateRangeSpec, Resolution, WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { loadLazy } from "$lib/safety/lazy";

/** A widget type's code, loaded the first time a widget of that type is shown. */
export type WidgetModule = {
	component: Component<{ widget: WidgetInstance; fullscreen?: boolean }>;
};

/**
 * A widget type's descriptor. It's in the initial bundle, so it imports neither the data layer
 * nor its component: those come with `load`.
 */
export type WidgetType = {
	type: string;
	label: () => string;
	icon: Component;
	minSize: { w: number; h: number };
	defaultSize: { w: number; h: number };
	time: "range" | "now" | "none";
	thresholds: boolean;
	analyzable: boolean;
	/** Offers "Download data (CSV)". */
	downloadable: boolean;
	accepts?: { datasets?: string[]; maxPollutantLayers?: number; maxPlaces?: number };
	placePicker?: boolean;
	resolution?: Resolution;
	dateMethods?: DateRangeSpec["kind"][];
	span?: { minDays?: number; maxDays?: number };
	menu: MenuProvider;
	/** A dynamic `import()` of the type's code; `loadWidget` caches it after the first call. */
	load: () => Promise<WidgetModule>;
	/** Offered in Add widget until the Data Explorer (spec 3): a new widget's data. */
	addable?: () => WidgetDataConfig;
};

const types = new Map<string, WidgetType>();
const modules = new WeakMap<WidgetType, Promise<WidgetModule>>();
const loaded = new WeakMap<WidgetType, WidgetModule>();

export function registerWidgetType(t: WidgetType): void {
	types.set(t.type, t);
}

export function getWidgetType(type: string): WidgetType | undefined {
	return types.get(type);
}

/** The types offered in Add widget, in registration order. */
export function addableWidgetTypes(): WidgetType[] {
	return [...types.values()].filter((t) => t.addable);
}

/**
 * Loads a type's code once (calls share one load). A failed load isn't kept, so the next call
 * tries again; a chunk that's gone also offers a reload (`loadLazy`).
 */
export function loadWidget(type: WidgetType): Promise<WidgetModule> {
	let module = modules.get(type);
	if (!module) {
		module = loadLazy(type.load).then(
			(mod) => {
				loaded.set(type, mod);
				return mod;
			},
			(error: unknown) => {
				modules.delete(type);
				throw error;
			}
		);
		modules.set(type, module);
	}
	return module;
}

/** A type's code if it has already loaded (so a remounted widget shows without a pending step). */
export function loadedWidget(type: WidgetType): WidgetModule | undefined {
	return loaded.get(type);
}
