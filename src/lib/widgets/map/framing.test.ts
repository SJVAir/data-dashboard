import type { Feature, Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { Layer } from "$lib/data/schema";
import { fitTarget, frameOf, type Frame } from "./framing";

// The root entry loads MapLibre; the bbox helper is all framing needs.
vi.mock("@sjvair/map-sdk", () => ({
	geometryBbox: (g: Polygon) => {
		const xs = g.coordinates[0].map((p) => p[0]);
		const ys = g.coordinates[0].map((p) => p[1]);
		return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
	}
}));

const base = { dataset: "air-quality", entryType: "pm25" };

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
	it("one monitor", () => {
		const layer: Layer = { ...base, place: { kind: "monitor", id: "m1" } };
		expect(frameOf(layer)).toEqual({ monitors: ["m1"], focus: "monitor", needs: [] });
		const target = fitTarget(
			frame({ monitors: ["m1"], focus: "monitor" }),
			none,
			new Map([["m1", [-119.8, 36.7]]])
		);
		expect(target).toEqual({ center: [-119.8, 36.7], minZoom: 12 });
	});

	it("one region", () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06019" } };
		expect(frameOf(layer)).toEqual({
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
		const layer: Layer = { ...base, place: { kind: "location", source: "cde", code: "123" } };
		expect(frameOf(layer)).toEqual({
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
		const layer: Layer = { ...base, place: { kind: "point", lat: 36.7, lon: -119.8 } };
		expect(frameOf(layer)).toEqual({
			monitors: [],
			focus: "regions",
			needs: [{ kind: "point-region", layer }]
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

	it("monitor selection", () => {
		const layer: Layer = { ...base, selection: { kind: "monitors", ids: ["a", "b", "c"] } };
		expect(frameOf(layer)).toEqual({ monitors: ["a", "b", "c"], focus: "monitor", needs: [] });
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
		const layer: Layer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "city:fresno"] }
		};
		expect(frameOf(layer)).toEqual({
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
		expect(frameOf({ ...base, place: { kind: "default-place" } })).toEqual(none);
		expect(frameOf({ ...base })).toEqual(none);
		expect(frameOf(undefined)).toEqual(none);
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
