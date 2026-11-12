import type { Feature } from "geojson";
import { describe, expect, it } from "vitest";
import { focusGeometry } from "./focus";
import type { Frame } from "./framing";

const ring = (x: number) => [
	[x, 0],
	[x + 1, 0],
	[x + 1, 1],
	[x, 0]
];
const polygon = (x: number): Feature => ({
	type: "Feature",
	properties: {},
	geometry: { type: "Polygon", coordinates: [ring(x)] }
});
const base: Frame = { monitors: [], regions: [], pin: null, focus: "none" };

describe("focusGeometry", () => {
	it("is one Polygon for one region", () => {
		const frame = { ...base, regions: [{ type: "county", code: "019" }] };
		expect(focusGeometry(frame, new Map([["county:019", polygon(0)]]))).toEqual({
			type: "Polygon",
			coordinates: [ring(0)]
		});
	});

	it("joins several regions into one MultiPolygon", () => {
		const frame = {
			...base,
			regions: [
				{ type: "county", code: "019" },
				{ type: "county", code: "029" },
				{ type: "county", code: "gone" }
			]
		};
		const shapes = new Map([
			["county:019", polygon(0)],
			["county:029", polygon(5)]
		]);
		expect(focusGeometry(frame, shapes)).toEqual({
			type: "MultiPolygon",
			coordinates: [[ring(0)], [ring(5)]]
		});
	});

	it("gives the pin for a school or point, and null for monitor places", () => {
		const shapes = new Map([["zipcode:93721", polygon(2)]]);
		const regions = [{ type: "zipcode", code: "93721" }];
		expect(
			focusGeometry({ ...base, regions, pin: { kind: "point", lat: 1, lon: 2 } }, shapes)
		).toEqual({ type: "Point", coordinates: [2, 1] });
		expect(
			focusGeometry({ ...base, pin: { kind: "location", name: "S", lat: 3, lon: 4 } }, new Map())
		).toEqual({ type: "Point", coordinates: [4, 3] });
		expect(focusGeometry({ ...base, monitors: ["a"], focus: "monitor" }, new Map())).toBeNull();
		expect(focusGeometry(base, new Map())).toBeNull();
	});
});
