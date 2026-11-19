import type { Layer, Resolution } from "./schema";
import type { CatalogEntry } from "./metadata";
import { offeredLevels } from "./adapters/offered";
import { entryMeta, mainLayer } from "$lib/widgets/shared/input";

/** Every data level a widget offers, finest first. No quarter or season. */
export const LEVELS = ["raw", "hour", "day", "month", "year"] as const;
export type Level = (typeof LEVELS)[number];
/** The levels a Map offers. */
export const MAP_LEVELS: readonly Level[] = ["day", "month", "year"];
/** Where a layer is fetched for: monitors, regions, or none (place-less). */
export type PlaceKind = "monitors" | "regions" | "none";

const isLevel = (value: unknown): value is Level => LEVELS.includes(value as Level);
const rank = (level: Level): number => LEVELS.indexOf(level);

/**
 * The levels one layer offers (catalog `resolutions` ∩ `offeredLevels`, narrowed by place:
 * regions have no raw). An air-quality entry type listing only `raw` offers every level
 * (downsampled). Unknown dataset or entry type: [].
 */
export function layerOffers(layer: Layer, catalog: CatalogEntry[], place: PlaceKind): Level[] {
	let resolutions: readonly Resolution[];
	if (layer.entryType) {
		const meta = entryMeta(catalog, layer);
		if (!meta) return [];
		resolutions = meta.entryType.resolutions;
	} else {
		// A place-less layer (a Map's smoke, fire, notices or use) has no entry type: it offers what
		// its dataset's entry types do together, or every level when the catalog lacks the dataset.
		const dataset = catalog.find((d) => d.id === layer.dataset);
		resolutions = dataset ? dataset.entryTypes.flatMap((e) => e.resolutions) : LEVELS;
	}
	const downsampled =
		layer.dataset === "air-quality" && resolutions.length === 1 && resolutions[0] === "raw";
	const base = downsampled ? [...LEVELS] : offeredLevels(layer.dataset, resolutions);
	return LEVELS.filter(
		(level) =>
			base.includes(level) &&
			!(layer.dataset === "air-quality" && place === "regions" && level === "raw")
	);
}

/** Levels every layer offers, finest first, limited to `within` (default LEVELS). */
export function datasetOffers(
	layers: readonly Layer[],
	catalog: CatalogEntry[],
	place: PlaceKind,
	within: readonly Level[] = LEVELS
): Level[] {
	const each = layers.map((l) => layerOffers(l, catalog, place));
	return LEVELS.filter((level) => within.includes(level) && each.every((o) => o.includes(level)));
}

/** The range ladder: up to 3 days raw, up to 7 hour, up to 365 day, else month. */
export function rangeLevel(spanDays: number): Level {
	if (spanDays <= 3) return "raw";
	if (spanDays <= 7) return "hour";
	if (spanDays <= 365) return "day";
	return "month";
}

export type Effective = {
	resolution: Level;
	automatic: boolean;
	/** Set when Automatic moved above the range's level: the layer whose offer moved it. */
	movedBy?: Layer;
	/** Layers that don't offer `resolution` (only possible from untrusted input). */
	misfits: Layer[];
};

/**
 * The dataset's resolution. Pinned types (calendars `day`, Current `hour`) use the pin. Explicit
 * (`data.resolution`): as stored. Automatic: the finest level at or above max(range level, floor)
 * every layer offers. When layers share no such level, the main layer (`mainLayer`; a Map's first
 * pollutant) decides and the others are misfits.
 */
export function effectiveResolution(args: {
	data: { layers: readonly Layer[]; resolution?: string };
	catalog: CatalogEntry[];
	place: PlaceKind;
	spanDays: number;
	pin?: Level;
	within?: readonly Level[];
	floor?: Level;
}): Effective {
	const { data, catalog, place, spanDays, pin, within = LEVELS, floor } = args;
	const layers = data.layers;
	const misfitsAt = (level: Level) =>
		layers.filter((l) => !layerOffers(l, catalog, place).includes(level));

	if (pin) return { resolution: pin, automatic: false, misfits: misfitsAt(pin) };
	if (isLevel(data.resolution)) {
		return { resolution: data.resolution, automatic: false, misfits: misfitsAt(data.resolution) };
	}

	const range = rangeLevel(spanDays);
	const ideal = floor && rank(floor) > rank(range) ? floor : range;
	const common = datasetOffers(layers, catalog, place, within).filter(
		(level) => rank(level) >= rank(ideal)
	);
	if (common.length > 0) {
		const resolution = common[0];
		const effective: Effective = { resolution, automatic: true, misfits: [] };
		if (rank(resolution) > rank(ideal)) {
			effective.movedBy = layers.find(
				(l) =>
					layerOffers(l, catalog, place).find(
						(level) => within.includes(level) && rank(level) >= rank(ideal)
					) === resolution
			);
		}
		return effective;
	}

	// No shared level at or above the ideal: the main layer decides.
	const main = mainLayer({ layers: [...layers] }, catalog) ?? layers[0];
	const own = main ? layerOffers(main, catalog, place).filter((l) => within.includes(l)) : [];
	const resolution =
		own.find((level) => rank(level) >= rank(ideal)) ?? own[own.length - 1] ?? ideal;
	return { resolution, automatic: true, misfits: misfitsAt(resolution) };
}

/** Why `layer` can't join a level, for the greyed reason: its finest offered level, or null. */
export function offeredFrom(layer: Layer, catalog: CatalogEntry[], place: PlaceKind): Level | null {
	return layerOffers(layer, catalog, place)[0] ?? null;
}
