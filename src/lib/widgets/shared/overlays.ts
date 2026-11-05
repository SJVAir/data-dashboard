import type { CatalogEntry } from "$lib/data/metadata";
import { PlaceRefSchema, type Layer, type WidgetDataConfig } from "$lib/data/schema";
import type { PlaceInfo, QueryInput, Series } from "$lib/data/types";
import type { Picks } from "$lib/places/selection";
import { sameRef } from "$lib/places/types";
import { z } from "$lib/zod";
import { pollutantLayer } from "./input";

/** A Chart or Data table shows at most this many overlays (for readability). */
export const MAX_OVERLAYS = 2;

/** The widget's overlays: its layers with an entry type other than the main one, in order. */
export function overlayLayers(
	data: WidgetDataConfig,
	catalog: CatalogEntry[] | undefined
): Layer[] {
	const main = pollutantLayer(data, catalog);
	return data.layers.filter((l) => l !== main && l.entryType).slice(0, MAX_OVERLAYS);
}

/**
 * What an overlay asks for: its own dataset and entry type at the main layer's places (overlays
 * store none), over the main's date range and sub-range. No worst hour or pin: those are about
 * the main layer's values.
 */
export function overlayInput(main: QueryInput, overlay: Layer): QueryInput {
	const layer: Layer = { dataset: overlay.dataset, entryType: overlay.entryType };
	if (overlay.resolution) layer.resolution = overlay.resolution;
	if (main.layer.place) layer.place = main.layer.place;
	if (main.layer.selection) layer.selection = main.layer.selection;
	const input: QueryInput = { layer, dateRange: main.dateRange };
	if (main.timeSubRange) input.timeSubRange = main.timeSubRange;
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
