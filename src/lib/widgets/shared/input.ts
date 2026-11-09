import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import { layerKind } from "$lib/data/layer-kind";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "../defaults";

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
 * What a Chart asks the query client for: its `mainLayer` over the widget's date range, with each
 * day's worst hour, and at most `maxPlaces` of a selection's places. `hidden` counts the places
 * cut. A layer with no place or selection asks for nothing (`input` is null): a chart of every
 * monitor isn't offered.
 */
export function chartInput(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number
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
		worstHour: true
	};
	if (data.timeSubRange) input.timeSubRange = data.timeSubRange;
	return { layer, input, hidden };
}
