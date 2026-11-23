import type { Component } from "svelte";
import type { MenuContext, MenuItem } from "$lib/actions/types";
import type { DateRangeSpec, Resolution, WidgetDataConfig } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
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
/** What a direct add gives a new widget (`WidgetType.addable`). */
export type Addable = { data: WidgetDataConfig; options?: Record<string, unknown> };

export type WidgetType = {
	type: string;
	label: () => string;
	icon: Component;
	minSize: { w: number; h: number };
	defaultSize: { w: number; h: number };
	time: "range" | "now" | "none";
	/**
	 * A range type that also offers "Now" as a When choice (the Map): a widget with no
	 * `dateRange` shows now. Read it through `offersNow` and `showsNow` (`./time`).
	 */
	now?: boolean;
	thresholds: boolean;
	analyzable: boolean;
	/** Offers "Download data (CSV)". */
	downloadable: boolean;
	accepts?: {
		datasets?: string[];
		maxPollutantLayers?: number;
		/**
		 * The most places a single-place type (or the Map) takes; none for a type that takes any
		 * number (a Chart, a Table). Read it through `placeLimit`.
		 */
		maxPlaces?: number;
		/** Only a pollutant (a layer with a daily scale) can be added. */
		onlyPollutant?: boolean;
	};
	placePicker?: boolean;
	resolution?: Resolution;
	dateMethods?: DateRangeSpec["kind"][];
	/**
	 * The range's limits: `minDays` and `maxDays` in Pacific calendar days; `maxStops` in periods
	 * at the dataset's resolution, on the range widened to whole periods (the Map's stops).
	 */
	span?: { minDays?: number; maxDays?: number; maxStops?: number };
	/** The range a new widget of this type (and one with no range of its own) shows. */
	defaultRange?: DateRangeSpec;
	menu: (ctx: MenuContext, env: WidgetMenuEnv) => MenuItem[];
	/** A dynamic `import()` of the type's code; `loadWidget` caches it after the first call. */
	load: () => Promise<WidgetModule>;
	/**
	 * Its code is big (the Map's): a frame loads it only once the frame is within 200 px of the
	 * screen, focus moves into it, it's fullscreen, or the type's code had already loaded when the
	 * frame mounted (a frame already waiting loads once it reports near again); until then the
	 * frame shows its pending state. Other types load as soon as their frame mounts.
	 */
	loadWhenNear?: boolean;
	/**
	 * A direct add: Add widget adds the type with this data. Data types (those with
	 * `accepts.datasets`) go through Get data unless they're also `addable`, which adds them
	 * directly. Gets the dashboard it's added to; returns the new widget's data and, if it has
	 * any, its `options` (or a promise of them, when they need a lookup first: the Map's monitor
	 * types).
	 */
	addable?: (doc: Dashboard) => Addable | Promise<Addable>;
	/** Runs right after Add widget adds a widget of this type (e.g. opening its editor). */
	onAdded?: (app: AppContext, widgetId: string) => void;
};

const types = new Map<string, WidgetType>();
const modules = new WeakMap<WidgetType, Promise<WidgetModule>>();
const loaded = new WeakMap<WidgetType, WidgetModule>();

export function registerWidgetType(t: WidgetType): void {
	types.set(t.type, t);
}

/**
 * How many places `type` takes: its `accepts.maxPlaces`, any number (`Infinity`) for a data type
 * without one (a Chart, a Table), none for a type that takes no data (a Note) or isn't known.
 */
export function placeLimit(type: WidgetType | undefined): number {
	if (!type?.accepts?.datasets?.length) return 0;
	return type.accepts.maxPlaces ?? Infinity;
}

export function getWidgetType(type: string): WidgetType | undefined {
	return types.get(type);
}

/**
 * What Add widget lists, each type once, in registration order: data types open Get data
 * (`direct: false`) unless they're also `addable`, which adds them directly (`direct: true`).
 */
export function addWidgetEntries(): { type: WidgetType; direct: boolean }[] {
	return [...types.values()]
		.filter((t) => t.addable || (t.accepts?.datasets?.length ?? 0) > 0)
		.map((t) => ({ type: t, direct: !!t.addable }));
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
