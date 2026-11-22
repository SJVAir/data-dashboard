import { drawsAsBands } from "./adapters/bands";
import type { CatalogEntry } from "./metadata";
import type { Layer } from "./schema";

export type LayerKind = "pollutant" | "number" | "level";

/**
 * What a layer draws: a `pollutant` (by the catalog's kind), a `level` (colored bands, by its
 * dataset's adapter), or a `number`. `undefined` when the catalog doesn't know its entry type.
 */
export function layerKind(
	layer: Pick<Layer, "dataset" | "entryType">,
	catalog: CatalogEntry[] | undefined
): LayerKind | undefined {
	const dataset = catalog?.find((d) => d.id === layer.dataset);
	const entryType = dataset?.entryTypes.find((e) => e.id === layer.entryType);
	if (!entryType) return undefined;
	if (entryType.kind === "pollutant") return "pollutant";
	return drawsAsBands(layer.dataset) ? "level" : "number";
}

/** The air-quality dataset, whose layers are a widget's pollutant (and hold its monitors). */
export const AIR_QUALITY = "air-quality";

/**
 * Whether `layer` is a widget's pollutant: a pollutant by the catalog's kind, or an air-quality
 * layer whose entry type the catalog doesn't know (still the pollutant, so choosing another or
 * None replaces or removes it).
 */
export function isPollutantLayer(
	layer: Pick<Layer, "dataset" | "entryType">,
	catalog: CatalogEntry[] | undefined
): boolean {
	const kind = layerKind(layer, catalog);
	return kind === "pollutant" || (kind === undefined && layer.dataset === AIR_QUALITY);
}

/**
 * Every monitor type a new Map ticks (spec decision 8): the catalog's air-quality
 * `monitor_types`, the ids the bulk summaries' `type` takes. None when the catalog lacks them.
 */
export function everyMonitorType(catalog: CatalogEntry[] | undefined): string[] {
	return [...(catalog?.find((d) => d.id === AIR_QUALITY)?.monitorTypes ?? [])];
}
