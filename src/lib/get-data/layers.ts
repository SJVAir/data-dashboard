import { offeredLevels } from "$lib/data/adapters/offered";
import type { CatalogEntry } from "$lib/data/metadata";
import { layerKind } from "$lib/data/layer-kind";
import type { Layer, PesticideFilters, Resolution, WidgetDataConfig } from "$lib/data/schema";
import { entryMeta, mainLayer } from "$lib/widgets/shared/input";
import { MAX_OVERLAYS } from "$lib/widgets/shared/overlays";

/**
 * Get data's edits to a draft's layers, each mutating `data` in place (the view's draft). The
 * places, and the main layer's "Show values" level, live on the main layer (`mainLayer`): when an
 * edit changes which layer is main, they move to the new one, so the widget never ends up with no
 * places. An edit that would break a rule (no number layer left, too many overlays) changes
 * nothing.
 *
 * Kept free of the SDK and adapters, so it can be unit-tested and stays out of the initial bundle.
 */

/** A catalog entry type, by its dataset. */
export type EntryPick = { dataset: string; entryType: string };

/** The weather dataset, whose layers share one station. */
export const WEATHER = "weather";
/** The pesticide use dataset, whose layers each carry their own filters. */
export const PESTICIDES = "pesticide-use";

const isNumber = (layer: Layer, catalog: CatalogEntry[] | undefined) => {
	const kind = layerKind(layer, catalog);
	return kind === "pollutant" || kind === "number";
};

/** How many number layers (a pollutant, a weather reading, a pesticide measure) `data` has. */
export function numberLayers(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined): number {
	return data.layers.filter((l) => isNumber(l, catalog)).length;
}

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

/** The levels `layer`'s entry type offers that its adapter can fetch ("Show values"' choices). */
function offeredFor(catalog: CatalogEntry[] | undefined, layer: Layer): Resolution[] {
	const meta = entryMeta(catalog, layer);
	return meta ? offeredLevels(layer.dataset, meta.entryType.resolutions) : [];
}

/**
 * Runs `change`, then moves the places and the "Show values" level from the old main layer to
 * the new one when the main changed. A level the new main doesn't offer (`offeredFor`: weather
 * has no "Every measurement") is dropped.
 */
function keepingPlaces(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	change: () => void
): void {
	const before = mainLayer(data, catalog);
	const carried = before && {
		place: before.place,
		selection: before.selection,
		resolution: before.resolution
	};
	change();
	const after = mainLayer(data, catalog);
	if (!before || !after || after === before || !carried) return;
	delete before.place;
	delete before.selection;
	delete before.resolution;
	delete after.place;
	delete after.selection;
	if (carried.place) after.place = carried.place;
	if (carried.selection) after.selection = carried.selection;
	const level = carried.resolution;
	const offered = offeredFor(catalog, after);
	if (level && (level === "auto" || offered.includes(level))) after.resolution = level;
	else delete after.resolution;
}

/**
 * Chooses the widget's pollutant, or (`null`) removes it. A pollutant chosen where there was
 * none becomes the main layer, taking the places, unless the old main would then be one overlay
 * too many. Removing it hands the places to the next number layer, and is refused when there is
 * none.
 */
export function setPollutant(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	pick: EntryPick | null
): void {
	const at = data.layers.findIndex((l) => layerKind(l, catalog) === "pollutant");
	if (pick === null) {
		if (at >= 0) removeLayer(data, catalog, at);
		return;
	}
	if (at >= 0) {
		const layer = data.layers[at];
		layer.dataset = pick.dataset;
		layer.entryType = pick.entryType;
		// A level the new entry type doesn't offer goes back to Automatic.
		const offered = offeredFor(catalog, layer);
		if (layer.resolution && layer.resolution !== "auto" && !offered.includes(layer.resolution)) {
			delete layer.resolution;
		}
		return;
	}
	if (!canAddLayer(data, catalog)) return;
	keepingPlaces(data, catalog, () =>
		data.layers.unshift({ dataset: pick.dataset, entryType: pick.entryType })
	);
}

function addLayer(data: WidgetDataConfig, catalog: CatalogEntry[] | undefined, layer: Layer) {
	if (!canAddLayer(data, catalog)) return;
	// Weather layers share one station.
	const station = data.layers.find((l) => l.dataset === WEATHER && l.station)?.station;
	if (layer.dataset === WEATHER && station) layer.station = station;
	keepingPlaces(data, catalog, () => data.layers.push(layer));
}

/**
 * Turns a weather, smoke or forecast layer on or off (one layer per entry type). A number layer
 * added where there's no number layer becomes the main, with the places.
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
	else if (!on && at >= 0) removeLayer(data, catalog, at);
}

/** Adds a pesticide use layer of `entryType` with no filters (all pesticides). */
export function addPesticideLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	entryType: string
): void {
	addLayer(data, catalog, { dataset: PESTICIDES, entryType });
}

/** Whether the layer at `index` can be removed: not when it's the last number layer. */
export function canRemoveLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	index: number
): boolean {
	const layer = data.layers[index];
	if (!layer) return false;
	return !isNumber(layer, catalog) || numberLayers(data, catalog) > 1;
}

/** Removes the layer at `index`; the main one hands its places on. Refuses the last number layer. */
export function removeLayer(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined,
	index: number
): void {
	if (!canRemoveLayer(data, catalog, index)) return;
	keepingPlaces(data, catalog, () => data.layers.splice(index, 1));
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
