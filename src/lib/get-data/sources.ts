import { getMetadata, getResolvers } from "$lib/data";
import { layerStations, type WeatherStation } from "$lib/data/adapters/weather";
import type { Layer } from "$lib/data/schema";

/**
 * What Get data's weather and pesticide controls read from the server, in one module so tests can
 * stand them in. Lazy-only, like the rest of Get data: it pulls in the SDK.
 */
export { searchPesticides } from "@sjvair/sdk";
export { filterLabels, filterSummary, FilterGone, pesticideMeta } from "$lib/data/pesticide-meta";

/** The weather stations a layer's one place can use, in the server's order (see `layerStations`). */
export function stationsForLayer(
	layer: Pick<Layer, "dataset" | "place" | "selection">,
	signal: AbortSignal
): Promise<WeatherStation[]> {
	return layerStations(layer, { metadata: getMetadata(), ...getResolvers() }, signal);
}
