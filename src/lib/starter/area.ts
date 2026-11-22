/**
 * The region a starter's Chart shows for a school or point place (decision 2: a Chart's Where
 * holds areas only). Loaded lazily, so the query layer stays out of the initial bundle.
 */
import { getMetadata, placeRegion } from "$lib/data";
import type { ChosenPlace } from "$lib/data/schema";
import { CHART_TYPE } from "$lib/widgets/chart";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { widgetInputs, widgetPlaceKind } from "$lib/widgets/shared/input";

/**
 * The region the starter's Chart takes at `place` (a school or point): the one the Chart's own
 * query uses there (`placeRegion`, as sharing and the place picker look points up: ZIP, then
 * city, then county). Rejects when the lookup fails; `null` when the place has no region.
 */
export async function starterAreaOf(
	place: ChosenPlace,
	signal?: AbortSignal
): Promise<ChosenPlace | null> {
	const listed = await getMetadata().catalog(signal);
	const catalog = listed === "unavailable" ? undefined : listed;
	const data = {
		dateRange: structuredClone(DEFAULT_RANGE),
		place: structuredClone(place),
		layers: [structuredClone(DEFAULT_LAYER)]
	};
	const input = widgetInputs({ type: CHART_TYPE, data }, catalog, widgetPlaceKind(data), 1).main;
	const region = input ? await placeRegion(input, signal) : null;
	return region ? { kind: "region", ...region } : null;
}
