import type { Feature, Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { Layer } from "$lib/data/schema";
import { fitTarget, frameOf, type Frame, type Where } from "./framing";

// The root entry loads MapLibre; the bbox helper is all framing needs.
vi.mock("@sjvair/map-sdk", () => ({
	geometryBbox: (g: Polygon) => {
		const xs = g.coordinates[0].map((p) => p[0]);
		const ys = g.coordinates[0].map((p) => p[1]);
		return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
	}
}));

const base: Layer = { dataset: "air-quality", entryType: "pm25" };

function square(w: number, s: number, e: number, n: number): Feature {
	return {
		type: "Feature",
		properties: {},
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[w, s],
					[e, s],
					[e, n],
					[w, n],
					[w, s]
				]
			]
		}
	};
}

function frame(over: Partial<Frame>): Frame {
	return { monitors: [], regions: [], pin: null, focus: "none", ...over };
}

const none = new Map<string, Feature>();
const noPositions = new Map<string, [number, number]>();

describe("frameOf and fitTarget", () => {
	it("one searched monitor, with no Where", () => {
		expect(frameOf({ ...base, monitors: ["m1"] }, {})).toEqual({
			monitors: ["m1"],
			focus: "monitor",
			needs: []
		});
		const target = fitTarget(
			frame({ monitors: ["m1"], focus: "monitor" }),
			none,
			new Map([["m1", [-119.8, 36.7]]])
		);
		expect(target).toEqual({ center: [-119.8, 36.7], minZoom: 12 });
	});

	it("one region", () => {
		const where: Where = { place: { kind: "region", type: "county", code: "06019" } };
		expect(frameOf(base, where)).toEqual({
			monitors: [],
			focus: "regions",
			needs: [{ kind: "regions", refs: [{ type: "county", code: "06019" }] }]
		});
		const shapes = new Map([["county:06019", square(-121, 35, -118, 37)]]);
		const target = fitTarget(
			frame({ regions: [{ type: "county", code: "06019" }], focus: "regions" }),
			shapes,
			noPositions
		);
		expect(target).toEqual({ bbox: [-121, 35, -118, 37] });
	});

	it("one location", () => {
		const where: Where = { place: { kind: "location", source: "cde", code: "123" } };
		expect(frameOf(base, where)).toEqual({
			monitors: [],
			focus: "pin",
			needs: [{ kind: "location", source: "cde", code: "123" }]
		});
		const target = fitTarget(
			frame({
				pin: { kind: "location", name: "A School", lat: 36.7, lon: -119.8 },
				focus: "pin"
			}),
			none,
			noPositions
		);
		expect(target).toEqual({ center: [-119.8, 36.7], minZoom: 13 });
	});

	it("one point frames its region not the point", () => {
		const where: Where = { place: { kind: "point", lat: 36.7, lon: -119.8 } };
		expect(frameOf(base, where)).toEqual({
			monitors: [],
			focus: "regions",
			needs: [{ kind: "point-region", layer: base, point: { lat: 36.7, lon: -119.8 } }]
		});
		const shapes = new Map([["zipcode:93721", square(-120, 36.5, -119.5, 36.9)]]);
		const target = fitTarget(
			frame({
				regions: [{ type: "zipcode", code: "93721" }],
				pin: { kind: "point", lat: 36.7, lon: -119.8 },
				focus: "regions"
			}),
			shapes,
			noPositions
		);
		expect(target).toEqual({ bbox: [-120, 36.5, -119.5, 36.9] });
		expect(JSON.stringify(target)).not.toContain("36.7");
		expect(JSON.stringify(target)).not.toContain("-119.8");
	});

	it("several searched monitors, with no Where", () => {
		expect(frameOf({ ...base, monitors: ["a", "b", "c"] }, {})).toEqual({
			monitors: ["a", "b", "c"],
			focus: "monitor",
			needs: []
		});
		const target = fitTarget(
			frame({ monitors: ["a", "b", "c"], focus: "monitor" }),
			none,
			new Map<string, [number, number]>([
				["a", [-120, 36]],
				["b", [-119, 37]],
				["z", [-100, 40]]
			])
		);
		expect(target).toEqual({ bbox: [-120, 36, -119, 37] });
	});

	it("region selection", () => {
		const where: Where = { selection: { kind: "regions", ids: ["county:06019", "city:fresno"] } };
		expect(frameOf(base, where)).toEqual({
			monitors: [],
			focus: "regions",
			needs: [
				{
					kind: "regions",
					refs: [
						{ type: "county", code: "06019" },
						{ type: "city", code: "fresno" }
					]
				}
			]
		});
		const shapes = new Map([
			["county:06019", square(-121, 35, -118, 37)],
			["city:fresno", square(-120, 36, -117, 38)]
		]);
		const target = fitTarget(
			frame({
				regions: [
					{ type: "county", code: "06019" },
					{ type: "city", code: "fresno" }
				],
				focus: "regions"
			}),
			shapes,
			noPositions
		);
		expect(target).toEqual({ bbox: [-121, 35, -117, 38] });
	});

	it("default-place is none", () => {
		const none = { monitors: [], focus: "none", needs: [] };
		expect(frameOf(base, { place: { kind: "default-place" } })).toEqual(none);
		expect(frameOf(base, {})).toEqual(none);
		// No layer (no pollutant) frames nothing, whatever the Where.
		expect(frameOf(undefined, { place: { kind: "region", type: "county", code: "1" } })).toEqual(
			none
		);
		// Searched monitors with no pollutant (None) aren't drawn, so aren't framed.
		expect(frameOf({ dataset: "air-quality", monitors: ["m1"] }, {})).toEqual(none);
		expect(fitTarget(frame({}), new Map(), noPositions)).toBeNull();
	});

	it("fitTarget with no known monitors is null", () => {
		const target = fitTarget(frame({ monitors: ["a", "b"], focus: "monitor" }), none, noPositions);
		expect(target).toBeNull();
	});

	it("fitTarget for a point with no region is null", () => {
		const target = fitTarget(
			frame({ pin: { kind: "point", lat: 36.7, lon: -119.8 }, focus: "regions" }),
			none,
			noPositions
		);
		expect(target).toBeNull();
	});
});
