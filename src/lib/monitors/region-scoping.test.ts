import { describe, expect, it } from "vitest";
import { monitorInRegions } from "./region-scoping";
import type { MonitorData, RegionData } from "@sjvair/sdk";

function makeRegion(id: string, coords: Array<[number, number]>): RegionData {
	return {
		id,
		name: id,
		slug: id,
		type: "county",
		boundary: {
			id: `${id}-boundary`,
			version: "1",
			geometry: { type: "MultiPolygon", coordinates: [[coords]] },
			bbox: [-120, 35, -119, 36]
		}
	} as RegionData;
}

// MonitorData.position is a GeoJSON Point (`{ type: "Point", coordinates: [lng, lat] }`),
// confirmed against @sjvair/sdk's monitor_data schema — not a bare tuple.
function makeMonitor(coordinates: [number, number] | null): MonitorData {
	return { position: coordinates ? { type: "Point", coordinates } : null } as MonitorData;
}

const SQUARE = [
	[-120, 35],
	[-120, 36],
	[-119, 36],
	[-119, 35],
	[-120, 35]
] as Array<[number, number]>;

describe("monitorInRegions", () => {
	it("returns true when the monitor's position is inside a region's polygon", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [region])).toBe(true);
	});

	it("returns false when the monitor's position is outside every region", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor([-100, 40]), [region])).toBe(false);
	});

	it("returns false when the monitor has no position", () => {
		const region = makeRegion("a", SQUARE);
		expect(monitorInRegions(makeMonitor(null), [region])).toBe(false);
	});

	it("skips a region with no boundary geometry rather than throwing", () => {
		const region = { id: "b", name: "b", slug: "b", type: "county", boundary: null } as RegionData;
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [region])).toBe(false);
	});

	it("returns true if the monitor is inside any of several regions", () => {
		const inside = makeRegion("a", SQUARE);
		const elsewhere = makeRegion("b", [
			[10, 10],
			[10, 11],
			[11, 11],
			[11, 10],
			[10, 10]
		]);
		expect(monitorInRegions(makeMonitor([-119.5, 35.5]), [elsewhere, inside])).toBe(true);
	});
});
