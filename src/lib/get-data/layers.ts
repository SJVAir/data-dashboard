import type { CatalogEntry } from "$lib/data/metadata";
import { isPollutantLayer, layerKind } from "$lib/data/layer-kind";
import type { Layer, PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
import { mainLayer } from "$lib/widgets/shared/input";
import { MAX_OVERLAYS } from "$lib/widgets/shared/overlays";

/**
 * Get data's edits to a draft's layers, each mutating `data` in place (the view's draft). Where
 * is on the data, not a layer, so no edit here touches it. An edit that would break a rule (too
 * many overlays) changes nothing; any layer can be removed (a widget may hold none). The
 * dataset's resolution (`data.resolution`) always stays: a specific resolution never changes by
 * itself (Get data shows it blocked, with its reason, when a layer doesn't offer it).
 *
 * Kept free of the SDK and adapters, so it can be unit-tested and stays out of the initial bundle.
 */

/** A catalog entry type, by its dataset. */
export type EntryPick = { dataset: string; entryType: string };

/** The weather dataset, whose layers share one station. */
export const WEATHER = "weather";
/** The pesticide use dataset, whose layers each carry their own filters. */
export const PESTICIDES = "pesticide-use";

/** The overlays `data` has: every layer with an entry type but the main one. */
function overlayCount(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): number {
	const main = mainLayer(data, catalog);
	return data.layers.filter((l) => l !== main && l.entryType).length;
}

/** Whether one more layer fits under `MAX_OVERLAYS` (the main layer isn't an overlay). */
export function canAddLayer(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): boolean {
	const withEntry = data.layers.filter((l) => l.entryType).length;
	// After the add there's a main layer, and every other layer is an overlay.
	return withEntry === 0 || overlayCount(data, catalog) + 1 <= MAX_OVERLAYS;
}

/**
 * Chooses the widget's pollutant, or (`null`) removes it. A pollutant chosen where there was
 * none becomes the main layer, unless the old main would then be one overlay too many. None
 * always removes it, even when it was the last layer. The pollutant is `isPollutantLayer`'s (an
 * air-quality layer the catalog doesn't know counts), so it's replaced or removed, never doubled.
 */
export function setPollutant(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	pick: EntryPick | null
): void {
	const at = data.layers.findIndex((l) => isPollutantLayer(l, catalog));
	if (pick === null) {
		if (at >= 0) removeLayer(data, at);
		return;
	}
	if (at >= 0) {
		const layer = data.layers[at];
		layer.dataset = pick.dataset;
		layer.entryType = pick.entryType;
		return;
	}
	if (!canAddLayer(data, catalog)) return;
	data.layers.unshift({ dataset: pick.dataset, entryType: pick.entryType });
}

function addLayer(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined, layer: Layer) {
	if (!canAddLayer(data, catalog)) return;
	// Weather layers share one station.
	const station = data.layers.find((l) => l.dataset === WEATHER && l.station)?.station;
	if (layer.dataset === WEATHER && station) layer.station = station;
	data.layers.push(layer);
}

/**
 * Turns a weather, smoke or forecast layer on or off (one layer per entry type). A number layer
 * added where there's no number layer becomes the main.
 */
export function toggleLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	pick: EntryPick,
	on: boolean
): void {
	const at = data.layers.findIndex(
		(l) => l.dataset === pick.dataset && l.entryType === pick.entryType
	);
	if (on && at < 0) addLayer(data, catalog, { dataset: pick.dataset, entryType: pick.entryType });
	else if (!on && at >= 0) removeLayer(data, at);
}

/** Adds a pesticide use layer of `entryType` with no filters (all pesticides). */
export function addPesticideLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	entryType: string
): void {
	addLayer(data, catalog, { dataset: PESTICIDES, entryType });
}

/** Removes the layer at `index` (the last one too: a widget may hold no layers). */
export function removeLayer(data: WidgetDataConfig, index: number): void {
	if (!data.layers[index]) return;
	data.layers.splice(index, 1);
}

/** Sets (or, with nothing in them, clears) the filters of the pesticide layer at `index`. */
export function setFilters(
	data: WidgetDataConfig,
	index: number,
	filters: PesticideFilters | undefined
): void {
	const layer = data.layers[index];
	if (!layer) return;
	const kept: PesticideFilters = {};
	for (const [key, value] of Object.entries(filters ?? {}) as [keyof PesticideFilters, unknown][]) {
		if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
		(kept as Record<string, unknown>)[key] = value;
	}
	if (Object.keys(kept).length > 0) layer.filters = kept;
	else delete layer.filters;
}

/** Sets the station of every weather layer; `undefined` (the default station) stores none. */
export function setStation(data: WidgetDataConfig, station: string | undefined): void {
	for (const layer of data.layers) {
		if (layer.dataset !== WEATHER) continue;
		if (station === undefined) delete layer.station;
		else layer.station = station;
	}
}

/** A station was chosen for the old places: a place change drops it. */
export function dropStationOnPlaceChange(data: WidgetDataConfig): void {
	setStation(data, undefined);
}

/**
 * Whether `data` has only level layers (burn status, smoke): nothing to chart. False while the
 * catalog isn't known, and for an entry type it doesn't know (that layer says so itself).
 */
export function levelOnly(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): boolean {
	if (!catalog) return false;
	const withEntry = data.layers.filter((l) => l.entryType);
	return withEntry.length > 0 && withEntry.every((l) => layerKind(l, catalog) === "level");
}
