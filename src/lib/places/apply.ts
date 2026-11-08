import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { mainLayer } from "$lib/widgets/shared/input";
import { fromLayer, toLayerPlaces, type Picks } from "./selection";
import { sameRef, type PointPlace } from "./types";

/** A point's region couldn't be looked up (none, or the lookup failed), so nothing is saved. */
export class RegionLookupFailed extends Error {
	constructor(options?: { cause?: unknown }) {
		super("The region couldn't be looked up.", options);
		this.name = "RegionLookupFailed";
	}
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function same(a: Picks, b: Picks): boolean {
	return a.length === b.length && a.every((ref, i) => sameRef(ref, b[i]));
}

/**
 * The widget's new data for `picks`, or null when unchanged. Points become their region when the
 * dashboard has a live link (`regionOf` finds it; none, or a failed lookup, rejects with
 * `RegionLookupFailed`, and an abort rejects with the abort). The layer changed is the widget's
 * main layer (`mainLayer`, read with `catalog` when given): its pollutant, else its first number
 * layer.
 */
export async function pickedData(
	data: WidgetDataConfig,
	picks: Picks,
	opts: {
		liveLink: boolean;
		regionOf: (point: PointPlace) => Promise<{ type: string; code: string } | null>;
		catalog?: CatalogEntry[];
	}
): Promise<{
	data: WidgetDataConfig;
	savedAsRegion: { type: string; code: string } | null;
} | null> {
	const layer = mainLayer(data, opts.catalog);
	if (!layer || picks.length === 0) return null;
	let next = picks;
	let savedAsRegion: { type: string; code: string } | null = null;
	const only = picks.length === 1 ? picks[0] : null;
	if (opts.liveLink && only?.kind === "point") {
		let region: { type: string; code: string } | null;
		try {
			region = await opts.regionOf(only);
		} catch (error) {
			if (isAbort(error)) throw error;
			throw new RegionLookupFailed({ cause: error });
		}
		if (!region) throw new RegionLookupFailed();
		savedAsRegion = { type: region.type, code: region.code };
		next = [{ kind: "region", ...savedAsRegion }];
	}
	if (same(fromLayer(layer), next)) return null;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
	const { place, selection, ...rest } = layer;
	const changed: Layer = { ...rest, ...toLayerPlaces(next) };
	return {
		data: { ...data, layers: data.layers.map((l) => (l === layer ? changed : l)) },
		savedAsRegion
	};
}
