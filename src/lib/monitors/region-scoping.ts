import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { MultiPolygon } from "geojson";
import type { MonitorData, RegionData } from "@sjvair/sdk";

export function monitorInRegions(monitor: MonitorData, regions: Array<RegionData>): boolean {
	if (!monitor.position) return false;

	for (const region of regions) {
		if (!region?.boundary?.geometry) continue;
		if (
			booleanPointInPolygon(
				monitor.position.coordinates as [number, number],
				region.boundary.geometry as MultiPolygon
			)
		) {
			return true;
		}
	}

	return false;
}
