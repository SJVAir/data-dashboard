import type { Component } from "svelte";
import type { MenuContext, MenuItem } from "$lib/actions/types";
import type { DateRangeSpec, Resolution, WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { loadLazy } from "$lib/safety/lazy";
import type { AppContext } from "$lib/store/app.svelte";

/** A widget type's code, loaded the first time a widget of that type is shown. */
export type WidgetModule = {
	component: Component<{ widget: WidgetInstance; fullscreen?: boolean }>;
};

/** What a type's menu items may read: the app, and the widget as it is now (null if gone). */
export type WidgetMenuEnv = { app: AppContext; widget: () => WidgetInstance | null };

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
	accepts?: {
		datasets?: string[];
		maxPollutantLayers?: number;
		maxPlaces?: number;
		/** Only a pollutant (a layer with a daily scale) can be added. */
		onlyPollutant?: boolean;
	};
	placePicker?: boolean;
	resolution?: Resolution;
	dateMethods?: DateRangeSpec["kind"][];
	span?: { minDays?: number; maxDays?: number };
	/** The range a new widget of this type (and one with no range of its own) shows. */
	defaultRange?: DateRangeSpec;
	menu: (ctx: MenuContext, env: WidgetMenuEnv) => MenuItem[];
	/** A dynamic `import()` of the type's code; `loadWidget` caches it after the first call. */
	load: () => Promise<WidgetModule>;
	/**
	 * A direct add: Add widget lists the type (after the data types) and adds it with this data.
	 * Data types (those with `accepts.datasets`) go through Get data instead. Returns the new
	 * widget's data and, if it has any, its `options`.
	 */
	addable?: () => { data: WidgetDataConfig; options?: Record<string, unknown> };
	/** Runs right after Add widget adds a widget of this type (e.g. opening its editor). */
	onAdded?: (app: AppContext, widgetId: string) => void;
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

/** The non-data types Add widget adds directly, in registration order. */
export function addableWidgetTypes(): WidgetType[] {
	return [...types.values()].filter((t) => t.addable);
}

/** The types that take data from Get data (any `accepts.datasets`), in registration order. */
export function dataTypes(): WidgetType[] {
	return [...types.values()].filter((t) => (t.accepts?.datasets?.length ?? 0) > 0);
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
