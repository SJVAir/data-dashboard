import { geometryBbox, type Bbox } from "@sjvair/map-sdk";
import type { Feature } from "geojson";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { fromWhere } from "$lib/places/selection";
import { regionKey, type RegionRef } from "./regions";

export type { RegionRef };

/** What a map highlights, outlines, pins, and fits its camera to. */
export type Frame = {
	/** Monitor ids to highlight (map-sdk's `setSelection`). */
	monitors: string[];
	/** Regions to outline and highlight. */
	regions: RegionRef[];
	pin:
		| { kind: "location"; name: string; lat: number; lon: number }
		| { kind: "point"; lat: number; lon: number }
		| null;
	/** What the camera fits. */
	focus: "monitor" | "regions" | "pin" | "none";
};

/** A lookup a frame waits on before it's complete. */
export type Need =
	| { kind: "regions"; refs: RegionRef[] }
	| { kind: "location"; source: string; code: string }
	| { kind: "point-region"; layer: Layer; point: { lat: number; lon: number } };

/** A widget's Where, as a frame reads it. */
export type Where = Pick<WidgetDataConfig, "place" | "selection">;

export type FitTarget = { bbox: Bbox } | { center: [number, number]; minZoom: number } | null;

/** One monitor's least zoom when the camera centers on it. */
const MONITOR_MIN_ZOOM = 12;
/** A school's least zoom when the camera centers on its pin. */
const LOCATION_MIN_ZOOM = 13;

/**
 * What a map's Where frames for its `layer` (its main one; none frames nothing), before any
 * lookups: the monitors to highlight, what the camera fits, and the lookups (`needs`) that fill in
 * the regions and the pin. A point frames its region (looked up for `layer`), never itself. With
 * no Where, the layer's searched monitors are framed (when it has a pollutant to draw them).
 */
export function frameOf(
	layer: Layer | undefined,
	where: Where
): Omit<Frame, "pin" | "regions"> & { needs: Need[] } {
	const { place, selection } = where;
	if (layer && place) {
		switch (place.kind) {
			case "region":
				return {
					monitors: [],
					focus: "regions",
					needs: [{ kind: "regions", refs: [{ type: place.type, code: place.code }] }]
				};
			case "location":
				return {
					monitors: [],
					focus: "pin",
					needs: [{ kind: "location", source: place.source, code: place.code }]
				};
			case "point":
				return {
					monitors: [],
					focus: "regions",
					needs: [{ kind: "point-region", layer, point: { lat: place.lat, lon: place.lon } }]
				};
		}
	}
	if (layer && selection) {
		const picks = fromWhere(where);
		const refs = picks.flatMap((p) =>
			p.kind === "region" ? [{ type: p.type, code: p.code }] : []
		);
		return { monitors: [], focus: "regions", needs: [{ kind: "regions", refs }] };
	}
	const searched = layer?.entryType ? (layer.monitors ?? []) : [];
	if (searched.length > 0) return { monitors: [...searched], focus: "monitor", needs: [] };
	return { monitors: [], focus: "none", needs: [] };
}

function union(boxes: Bbox[]): Bbox | null {
	if (boxes.length === 0) return null;
	return boxes.reduce((a, b) => [
		Math.min(a[0], b[0]),
		Math.min(a[1], b[1]),
		Math.max(a[2], b[2]),
		Math.max(a[3], b[3])
	]);
}

/**
 * Where the camera goes for a frame: one monitor or a school's pin centered with a least zoom;
 * monitors or regions fitted to their bounds; null when nothing known to fit. A point's frame
 * fits its region's bounds and never the point (privacy: the tiles asked for are the region's),
 * so a point whose region has no shape gives null.
 */
export function fitTarget(
	frame: Frame,
	shapes: Map<string, Feature>,
	monitorPositions: Map<string, [number, number]>
): FitTarget {
	switch (frame.focus) {
		case "monitor": {
			const known = frame.monitors.flatMap((id) => {
				const p = monitorPositions.get(id);
				return p ? [p] : [];
			});
			if (known.length === 0) return null;
			if (frame.monitors.length === 1 || known.length === 1) {
				return { center: [known[0][0], known[0][1]], minZoom: MONITOR_MIN_ZOOM };
			}
			const bbox = union(known.map(([lon, lat]) => [lon, lat, lon, lat]));
			return bbox && { bbox };
		}
		case "regions": {
			const boxes = frame.regions.flatMap((ref) => {
				const shape = shapes.get(regionKey(ref));
				const box = shape?.geometry ? geometryBbox(shape.geometry) : null;
				return box ? [box] : [];
			});
			const bbox = union(boxes);
			return bbox && { bbox };
		}
		case "pin":
			// Only a school centers on its pin; an exact point never does.
			return frame.pin?.kind === "location"
				? { center: [frame.pin.lon, frame.pin.lat], minZoom: LOCATION_MIN_ZOOM }
				: null;
		case "none":
			return null;
	}
}
