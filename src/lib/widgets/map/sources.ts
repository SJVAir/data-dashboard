import { decodeRef, type MapFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Geometry } from "geojson";

/** The positions (`[lon, lat]`) of the monitors `ids` names that `features` has. */
export function monitorPositions(
	features: FeatureCollection<Geometry, MapFeatureProperties> | null,
	ids: readonly string[]
): Map<string, [number, number]> {
	const positions = new Map<string, [number, number]>();
	if (!features || ids.length === 0) return positions;
	const wanted = new Set(ids);
	for (const f of features.features) {
		if (f.geometry?.type !== "Point") continue;
		const ref = decodeRef(f.properties.refKey);
		if (ref?.kind !== "monitor" || !wanted.has(ref.id)) continue;
		const [lon, lat] = f.geometry.coordinates;
		positions.set(ref.id, [lon, lat]);
	}
	return positions;
}
