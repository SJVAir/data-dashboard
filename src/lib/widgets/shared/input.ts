import {
	effectiveResolution,
	MAP_LEVELS,
	type Effective,
	type Level,
	type PlaceKind
} from "$lib/data/dataset-rules";
import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import { layerKind } from "$lib/data/layer-kind";
import { currentInput } from "$lib/data/now/current";
import {
	LIMITS,
	type DateRangeSpec,
	type Layer,
	type Resolution,
	type WidgetDataConfig
} from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import { calendarSpanDays, resolveRange } from "$lib/format/range";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "../defaults";
import { MAP_TYPE } from "../map/options";
import { getWidgetType } from "../registry";
import { overlayInput, overlayLayers } from "./overlays";

/** The catalog's entry type (and its dataset) a layer reads, if the catalog has them. */
export function entryMeta(
	catalog: CatalogEntry[] | undefined,
	layer: Layer | undefined
): { dataset: CatalogEntry; entryType: EntryTypeMeta } | undefined {
	const dataset = catalog?.find((d) => d.id === layer?.dataset);
	const entryType = dataset?.entryTypes.find((e) => e.id === layer?.entryType);
	return dataset && entryType ? { dataset, entryType } : undefined;
}

/**
 * The layer a Chart or Data table shows (the one that sets its places and resolution): its first
 * pollutant layer, else its first number layer, else the first layer with an entry type (so an
 * unknown one still says so). A level layer is never main while a number layer exists.
 */
export function mainLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer | undefined {
	const withEntry = data.layers.filter((l) => l.entryType);
	return (
		withEntry.find((l) => layerKind(l, catalog) === "pollutant") ??
		withEntry.find((l) => layerKind(l, catalog) === "number") ??
		withEntry[0]
	);
}

/**
 * The layer holding a widget's places: its `mainLayer`, else a lone layer with no entry type (a
 * Forecast strip's forecasts layer).
 */
export function placesLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer | undefined {
	const main = mainLayer(data, catalog);
	if (main) return main;
	const only = data.layers.length === 1 ? data.layers[0] : undefined;
	return only && !only.entryType ? only : undefined;
}

/**
 * The entry type a places layer's places are picked and looked up for: its own, else (a
 * Forecast strip's layer) PM2.5, as a new widget's.
 */
export function placesEntryType(layer: Layer): string {
	return layer.entryType ?? DEFAULT_LAYER.entryType!;
}

/**
 * `layer` as one the query client can look its places up with: a layer with no entry type (a
 * Forecast strip's) as `DEFAULT_LAYER`'s pollutant at the same places.
 */
export function placesQueryLayer(layer: Layer): Layer {
	if (layer.entryType) return layer;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- replaced in the copy
	const { dataset, ...rest } = layer;
	return { ...rest, dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType };
}

/**
 * What a "now" tile asks the query client for: the layer's hourly averages (`currentInput`). A
 * layer with no place or selection asks for nothing (null): a tile of every monitor isn't offered.
 */
export function nowInput(layer: Layer | undefined): QueryInput | null {
	return layer && (layer.place || layer.selection) ? currentInput(layer) : null;
}

/**
 * Where a widget's places are fetched for, as the dataset rules count it (`PlaceKind`), read from
 * its places layer (`placesLayer`): `monitors` for a monitor place or selection; `regions` for a
 * region place or selection, and for a point or a school, which the query client resolves to
 * regions; `none` when there is no place (or only the starter's unresolved `default-place`, which
 * isn't fetched).
 */
export function widgetPlaceKind(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): PlaceKind {
	const layer = placesLayer(data, catalog);
	if (layer?.selection) return layer.selection.kind;
	switch (layer?.place?.kind) {
		case "monitor":
			return "monitors";
		case "region":
		case "point":
		case "location":
			return "regions";
		default:
			return "none";
	}
}

/** What a widget type adds to the dataset rules: a pin, or (the Map) its levels and floor. */
function typeRules(type: string): { pin?: Level; within?: readonly Level[]; floor?: Level } {
	if (type === MAP_TYPE) return { within: MAP_LEVELS, floor: "day" };
	const pin = getWidgetType(type)?.resolution;
	return pin ? { pin: pin as Level } : {};
}

/**
 * The resolution a widget's dataset is fetched at (`effectiveResolution`) over `range` (its date
 * range, or the type's default), with the type's pin or levels. An unknown catalog counts as
 * empty (the query client reports it).
 */
export function widgetEffective(
	widget: { type: string; data: WidgetDataConfig },
	catalog: CatalogEntry[] | undefined,
	place: PlaceKind,
	range: DateRangeSpec = widget.data.dateRange ?? DEFAULT_RANGE,
	now: Date = new Date()
): Effective {
	return effectiveResolution({
		data: widget.data,
		catalog: catalog ?? [],
		place,
		spanDays: calendarSpanDays(range, resolveRange(range, now)),
		...typeRules(widget.type)
	});
}

/**
 * What a Chart asks the query client for: its `mainLayer` over the widget's date range at
 * `resolution` (the dataset's), with each day's worst hour, and at most `maxPlaces` of a
 * selection's places. `hidden` counts the places cut. A layer with no place or selection asks for
 * nothing (`input` is null): a chart of every monitor isn't offered.
 */
export function chartInput(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number,
	resolution: Resolution
): { layer: Layer | undefined; input: QueryInput | null; hidden: number } {
	const layer = mainLayer(data, catalog);
	if (!layer || (!layer.place && !layer.selection)) return { layer, input: null, hidden: 0 };
	let shown = layer;
	let hidden = 0;
	if (layer.selection && layer.selection.ids.length > maxPlaces) {
		hidden = layer.selection.ids.length - maxPlaces;
		shown = {
			...layer,
			selection: { ...layer.selection, ids: layer.selection.ids.slice(0, maxPlaces) }
		};
	}
	const input: QueryInput = {
		layer: shown,
		dateRange: data.dateRange ?? DEFAULT_RANGE,
		resolution,
		worstHour: true
	};
	if (data.timeSubRange) input.timeSubRange = data.timeSubRange;
	return { layer, input, hidden };
}

/** Everything a Chart or Data table asks the query client for (see `widgetInputs`). */
export type WidgetInputs = {
	/** The main layer (`mainLayer`), whose places every input uses. */
	layer: Layer | undefined;
	main: QueryInput | null;
	/** Places of the main layer's selection cut to fit `maxPlaces`. */
	hidden: number;
	/** One per `overlayLayers` entry; `null` for a misfit (it doesn't offer the resolution). */
	overlays: (QueryInput | null)[];
	effective: Effective;
};

/**
 * A widget's queries: the main layer (`chartInput`) and each overlay (`overlayInput`), all at the
 * dataset's resolution (`widgetEffective`). An overlay that doesn't offer that resolution (from
 * untrusted input, a share link or an import; or while the catalog isn't known yet) gets no input
 * and isn't fetched. No main input (no place), no overlays.
 */
export function widgetInputs(
	widget: { type: string; data: WidgetDataConfig },
	catalog: CatalogEntry[] | undefined,
	place: PlaceKind,
	maxPlaces: number = LIMITS.SELECTION_MAX
): WidgetInputs {
	const effective = widgetEffective(widget, catalog, place);
	const { layer, input, hidden } = chartInput(
		widget.data,
		catalog,
		maxPlaces,
		effective.resolution
	);
	const overlays = input
		? overlayLayers(widget.data, catalog).map((l) =>
				effective.misfits.includes(l) ? null : overlayInput(input, l)
			)
		: [];
	return { layer, main: input, hidden, overlays, effective };
}
