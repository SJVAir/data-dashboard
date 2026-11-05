import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import { DEFAULT_RANGE } from "../defaults";

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
 * The layer a Chart or Data table shows: its first pollutant layer (by the catalog's kind), else
 * the first layer with an entry type (so an unknown one still says so).
 */
export function pollutantLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer | undefined {
	const withEntry = data.layers.filter((l) => l.entryType);
	return (
		withEntry.find((l) => entryMeta(catalog, l)?.entryType.kind === "pollutant") ?? withEntry[0]
	);
}

/**
 * What a Chart asks the query client for: its `pollutantLayer` over the widget's date range, with each
 * day's worst hour, and at most `maxPlaces` of a selection's places. `hidden` counts the places
 * cut. A layer with no place or selection asks for nothing (`input` is null): a chart of every
 * monitor isn't offered.
 */
export function chartInput(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	maxPlaces: number
): { layer: Layer | undefined; input: QueryInput | null; hidden: number } {
	const layer = pollutantLayer(data, catalog);
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
