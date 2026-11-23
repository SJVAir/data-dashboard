import type { Feature, MultiPolygon, Point, Polygon, Position } from "geojson";
import type { Frame } from "./framing";
import { regionKey } from "./regions";

/**
 * The focus geometry: the pin as a Point (a school or an exact point), else the regions' shapes
 * as one Polygon (one) or MultiPolygon (several), else null (monitor places, nothing known).
 */
export function focusGeometry(
	frame: Frame,
	shapes: Map<string, Feature>
): Polygon | MultiPolygon | Point | null {
	if (frame.pin) return { type: "Point", coordinates: [frame.pin.lon, frame.pin.lat] };
	const polygons: Position[][][] = [];
	for (const ref of frame.regions) {
		const geometry = shapes.get(regionKey(ref))?.geometry;
		if (geometry?.type === "Polygon") polygons.push(geometry.coordinates);
		else if (geometry?.type === "MultiPolygon") polygons.push(...geometry.coordinates);
	}
	if (polygons.length === 0) return null;
	if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
	return { type: "MultiPolygon", coordinates: polygons };
}
