import { drawsAsBands } from "./adapters/bands";
import type { CatalogEntry } from "./metadata";
import type { Layer } from "./schema";

export type LayerKind = "pollutant" | "number" | "level";

/**
 * What a layer draws: a `pollutant` (by the catalog's kind), a `level` (colored bands, by its
 * dataset's adapter), or a `number`. `undefined` when the catalog doesn't know its entry type.
 */
export function layerKind(
	layer: Layer,
	catalog: CatalogEntry[] | undefined
): LayerKind | undefined {
	const dataset = catalog?.find((d) => d.id === layer.dataset);
	const entryType = dataset?.entryTypes.find((e) => e.id === layer.entryType);
	if (!entryType) return undefined;
	if (entryType.kind === "pollutant") return "pollutant";
	return drawsAsBands(layer.dataset) ? "level" : "number";
}
