import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { fromWhere, toWhere, type Picks } from "./selection";
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

/** `layers` with no searched monitors or ticked types; `layers` itself when none has any. */
function withoutMonitors(layers: Layer[]): Layer[] {
	if (!layers.some((l) => l.monitors || l.monitorTypes)) return layers;
	return layers.map((l) => {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
		const { monitors, monitorTypes, ...rest } = l;
		return rest;
	});
}

/**
 * The widget's new data for `picks`, or null when unchanged. Points become their region when the
 * dashboard has a live link (`regionOf` finds it; none, or a failed lookup, rejects with
 * `RegionLookupFailed`, and an abort rejects with the abort). Only the widget's Where changes
 * (with `onePlace`, its monitors also go); data with no layers (a Note) has no Where to change.
 */
export async function pickedData(
	data: WidgetDataConfig,
	picks: Picks,
	opts: {
		liveLink: boolean;
		regionOf: (point: PointPlace) => Promise<{ type: string; code: string } | null>;
		/**
		 * A single-place widget (`placeLimit` 1): it holds one place or one monitor, so a picked
		 * place replaces its monitor.
		 */
		onePlace?: boolean;
	}
): Promise<{
	data: WidgetDataConfig;
	savedAsRegion: { type: string; code: string } | null;
} | null> {
	if (data.layers.length === 0 || picks.length === 0) return null;
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
	if (same(fromWhere(data), next)) return null;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
	const { place, selection, ...rest } = data;
	const layers = opts.onePlace ? withoutMonitors(data.layers) : data.layers;
	return { data: { ...rest, layers, ...toWhere(next) }, savedAsRegion };
}
