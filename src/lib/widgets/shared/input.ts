import {
	effectiveResolution,
	MAP_LEVELS,
	type Effective,
	type Level,
	type PlaceKind
} from "$lib/data/dataset-rules";
import type { CatalogEntry, EntryTypeMeta, Figure } from "$lib/data/metadata";
import { AIR_QUALITY, layerKind } from "$lib/data/layer-kind";
import { currentInput } from "$lib/data/now/current";
import type {
	DateRangeSpec,
	Layer,
	PlaceRef,
	Resolution,
	SpatialSelection,
	WidgetDataConfig
} from "$lib/data/schema";
import type { QueryInput, QueryLayer } from "$lib/data/types";
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
 * What a widget's places are picked and looked up for: its pollutant layer's entry type (with no
 * catalog, its first air-quality layer's), else PM2.5 (`DEFAULT_LAYER`, as a new widget's): a
 * Forecast strip, or a widget of weather alone, picks any place PM2.5 is offered for.
 */
export function wherePurpose(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): { dataset: string; entryType: string } {
	const pollutant = data.layers.find(
		(l) =>
			l.entryType && (catalog ? layerKind(l, catalog) === "pollutant" : l.dataset === AIR_QUALITY)
	);
	return pollutant?.entryType
		? { dataset: pollutant.dataset, entryType: pollutant.entryType }
		: { dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType! };
}

/** A JSON-shaped value's deep copy; unlike `structuredClone`, it also copies a reactive draft. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A widget's Where: its place or selection (a copy), or neither (everywhere). */
export function widgetWhere(data: WidgetDataConfig): {
	place?: PlaceRef;
	selection?: SpatialSelection;
} {
	if (data.place) return { place: copy(data.place) };
	if (data.selection) return { selection: copy(data.selection) };
	return {};
}

/** Whether a widget has a Where (a place or a selection). */
export function hasWhere(data: WidgetDataConfig): boolean {
	return !!(data.place || data.selection);
}

/** Whether `layer` is an air-quality layer that can fetch its monitors (it has an entry type). */
function fetchesMonitors(layer: Layer): boolean {
	return layer.dataset === AIR_QUALITY && !!layer.entryType;
}

/**
 * The layer as the query client reads it: its own fields at the widget's Where (`widgetWhere`).
 * The one place a query layer is built, so the saved shape can change behind it. Every layer
 * built here is fetched by place; the Map's place-less layers (smoke, fire, spray notices, its
 * pesticide use) never come through here (its plugins fetch them), so they get no Where. Only an
 * air-quality layer with an entry type carries its `monitors` and `monitorTypes` (non-empty):
 * with None chosen they stay saved but fetch nothing.
 */
export function queryLayer(data: WidgetDataConfig, layer: Layer): QueryLayer {
	const { monitors, monitorTypes, ...rest } = layer;
	const out: QueryLayer = { ...rest, ...widgetWhere(data) };
	if (fetchesMonitors(layer)) {
		if (monitors && monitors.length > 0) out.monitors = [...monitors];
		if (monitorTypes && monitorTypes.length > 0) out.monitorTypes = [...monitorTypes];
	}
	return out;
}

/** The widget's air-quality layer's searched monitors and ticked types (none when it has none). */
export function widgetMonitors(data: WidgetDataConfig): { monitors: string[]; types: string[] } {
	const layer = data.layers.find(fetchesMonitors);
	return { monitors: layer?.monitors ?? [], types: layer?.monitorTypes ?? [] };
}

/**
 * A single-place widget's monitor: its air-quality layer's one searched monitor when it has no
 * ticked types (spec decision 11), else `undefined`.
 */
export function singleMonitor(data: WidgetDataConfig): string | undefined {
	const { monitors, types } = widgetMonitors(data);
	return monitors.length === 1 && types.length === 0 ? monitors[0] : undefined;
}

/** Whether a widget has a place to fetch: a Where, or monitors on its air-quality layer. */
export function hasPlaces(data: WidgetDataConfig): boolean {
	const { monitors, types } = widgetMonitors(data);
	return hasWhere(data) || monitors.length > 0 || types.length > 0;
}

/**
 * What a "now" tile asks the query client for: the layer's hourly averages (`currentInput`) at the
 * widget's Where or its monitor. A widget with neither asks for nothing (null): a tile of every
 * monitor isn't offered.
 */
export function nowInput(data: WidgetDataConfig, layer: Layer | undefined): QueryInput | null {
	return layer && hasPlaces(data) ? currentInput(queryLayer(data, layer)) : null;
}

/**
 * Where a widget's places are fetched for, as the dataset rules count it (`PlaceKind`):
 * `monitor-types` when its air-quality layer (with an entry type) has ticked types; `monitors`
 * for searched monitors alone; else `regions` for any Where (a point or a school resolves to
 * regions), else `none` (also for only the starter's unresolved `default-place`, which isn't
 * fetched).
 */
export function widgetPlaceKind(data: WidgetDataConfig): PlaceKind {
	const { monitors, types } = widgetMonitors(data);
	if (types.length > 0) return "monitor-types";
	if (monitors.length > 0) return "monitors";
	if (data.selection) return "regions";
	switch (data.place?.kind) {
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

/** Why a Chart or Table asks for nothing: no Where and no monitors, or no layers at all. */
export type ChartEmpty = "add-where-or-monitors" | "add-layers";

/**
 * What a Chart asks the query client for: its `mainLayer` over the widget's date range at
 * `resolution` (the dataset's), with each day's worst hour, at every place of its Where (there is
 * no cap on a Chart's lines or a Table's columns). A widget with no Where and no monitors
 * asks for nothing (`input` is null) and says what to add (`empty`): monitors or a Where, or, with
 * no layers at all, what to show.
 */
export function chartInput(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	resolution: Resolution
): { layer: Layer | undefined; input: QueryInput | null; empty?: ChartEmpty } {
	const layer = mainLayer(data, catalog);
	if (data.layers.length === 0) return { layer, input: null, empty: "add-layers" };
	if (!hasPlaces(data)) return { layer, input: null, empty: "add-where-or-monitors" };
	if (!layer) return { layer, input: null };
	const input: QueryInput = {
		layer: queryLayer(data, layer),
		dateRange: data.dateRange ?? DEFAULT_RANGE,
		resolution,
		worstHour: true
	};
	if (data.timeSubRange) input.timeSubRange = data.timeSubRange;
	return { layer, input };
}

/** Everything a Chart or Data table asks the query client for (see `widgetInputs`). */
export type WidgetInputs = {
	/** The main layer (`mainLayer`); every input uses the widget's Where. */
	layer: Layer | undefined;
	main: QueryInput | null;
	/** What the widget asks to be given when it has nothing to ask for (`chartInput`). */
	empty?: ChartEmpty;
	/** One per `overlayLayers` entry; `null` for a misfit (it doesn't offer the resolution). */
	overlays: (QueryInput | null)[];
	effective: Effective;
	/**
	 * The figure the main needs (`MetadataSource.figure` of its entry type at the dataset's
	 * resolution) when it is a pollutant with a place; `null` when it reads the plain mean.
	 */
	figureFor: { entryType: string; resolution: Level } | null;
};

/**
 * A widget's queries: the main layer (`chartInput`) and each overlay (`overlayInput`), all at the
 * dataset's resolution (`widgetEffective` as of `now`). An overlay that doesn't offer that
 * resolution (from untrusted input, a share link or an import; or while the catalog isn't known
 * yet) gets no input and isn't fetched. No main input (no place, or a stored level the widget
 * doesn't offer: `Effective.unusable`), no overlays.
 *
 * `figure` is the looked-up figure for `figureFor` (the caller looks it up, since it is async):
 * the main reads it (`QueryInput.figure`); `null` or absent reads the plain mean. Overlays never
 * carry one: only a pollutant has a figure, and a pollutant is always the main.
 */
export function widgetInputs(
	widget: { type: string; data: WidgetDataConfig },
	catalog: CatalogEntry[] | undefined,
	place: PlaceKind,
	now: Date | number = new Date(),
	figure?: Figure | null
): WidgetInputs {
	const effective = widgetEffective(widget, catalog, place, undefined, new Date(now));
	if (effective.unusable) {
		// A stored level the widget doesn't offer: nothing is fetched (the widget says why).
		const layer = mainLayer(widget.data, catalog);
		return { layer, main: null, overlays: [], effective, figureFor: null };
	}
	const { layer, input, empty } = chartInput(widget.data, catalog, effective.resolution);
	const overlays = input
		? overlayLayers(widget.data, catalog).map((l) =>
				effective.misfits.includes(l) ? null : overlayInput(input, queryLayer(widget.data, l))
			)
		: [];
	const figureFor =
		input && layer?.entryType && layerKind(layer, catalog) === "pollutant"
			? { entryType: layer.entryType, resolution: effective.resolution }
			: null;
	const main = input && figureFor && figure ? { ...input, figure: figure.field } : input;
	return { layer, main, ...(empty ? { empty } : {}), overlays, effective, figureFor };
}
