import type { CatalogEntry } from "$lib/data/metadata";
import { layerKind } from "$lib/data/layer-kind";
import {
	PlaceRefSchema,
	type Layer,
	type Resolution,
	type WidgetDataConfig
} from "$lib/data/schema";
import type { PlaceInfo, QueryInput, Series } from "$lib/data/types";
import type { Picks } from "$lib/places/selection";
import { sameRef } from "$lib/places/types";
import { z } from "$lib/zod";
import { mainLayer } from "./input";

/** A Chart or Data table shows at most this many overlays (for readability). */
export const MAX_OVERLAYS = 2;

/** The widget's overlays: its layers with an entry type other than the main one, in order. */
export function overlayLayers(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer[] {
	const main = mainLayer(data, catalog);
	return data.layers.filter((l) => l !== main && l.entryType).slice(0, MAX_OVERLAYS);
}

/**
 * What an overlay asks for: its own dataset, entry type, station and filters at the main layer's
 * places (overlays store none), over the main's date range and sub-range. No worst hour: that is
 * about the main layer's values. A number overlay is pinned to `mainResolution` (the resolution
 * the main data came back at), so the two line up; the overlay's own `resolution` is dropped. A
 * level overlay is not pinned.
 */
export function overlayInput(
	main: QueryInput,
	overlay: Layer,
	mainResolution: Resolution | undefined,
	catalog: CatalogEntry[] | undefined
): QueryInput {
	const layer: Layer = { dataset: overlay.dataset, entryType: overlay.entryType };
	if (overlay.station) layer.station = overlay.station;
	if (overlay.filters) layer.filters = overlay.filters;
	if (main.layer.place) layer.place = main.layer.place;
	if (main.layer.selection) layer.selection = main.layer.selection;
	const input: QueryInput = { layer, dateRange: main.dateRange };
	if (main.timeSubRange) input.timeSubRange = main.timeSubRange;
	if (mainResolution && layerKind(overlay, catalog) === "number") input.pin = mainResolution;
	return input;
}

/** A Chart's own options (saved on the widget, not on a layer). */
export const ChartOptionsSchema = z.object({ overlayFor: PlaceRefSchema.optional() });

/**
 * The place whose overlay the Chart draws, as a `PlaceInfo.place` key of `places` (one per pick,
 * in pick order): the saved `overlayFor` when it's among `picks`, else the first place. Options
 * that don't parse are ignored. `""` when there are no places.
 */
export function overlayPlaceFor(options: unknown, places: PlaceInfo[], picks: Picks): string {
	const parsed = ChartOptionsSchema.safeParse(options);
	const saved = parsed.success ? parsed.data.overlayFor : undefined;
	const at = saved ? picks.findIndex((p) => sameRef(p, saved)) : -1;
	return (places[at] ?? places[0])?.place ?? "";
}

/**
 * Whether every place's overlay is the same day by day (places in one forecast zone), so the
 * Chart can show it once with no "Overlay for" choice.
 */
export function sharedSource(series: Series[]): boolean {
	const [first, ...rest] = series;
	return rest.every(
		(s) =>
			s.points.length === first.points.length &&
			s.points.every((p, i) => {
				const q = first.points[i];
				return p.t === q.t && p.level === q.level && Object.is(p.mean, q.mean);
			})
	);
}
