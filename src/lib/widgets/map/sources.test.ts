import type { Feature } from "geojson";
import { describe, expect, it } from "vitest";
import { monitorPositions, pinFeatures, pinIcon, PIN_REF, shapeFeatures } from "./sources";

const square: Feature = {
	type: "Feature",
	properties: { name: "Fresno County" },
	geometry: {
		type: "Polygon",
		coordinates: [
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 0]
			]
		]
	}
};

describe("map sources", () => {
	it("shapes carry map-sdk's region refs and names", () => {
		const fc = shapeFeatures(new Map([["county:019", square]]));
		expect(fc.features).toHaveLength(1);
		expect(fc.features[0].properties).toEqual({
			refKey: "region:county:019",
			name: "Fresno County",
			value: null
		});
	});

	it("a pin is one feature ref, named by its label", () => {
		expect(pinFeatures(null, "x").features).toEqual([]);
		const fc = pinFeatures({ kind: "point", lat: 1, lon: 2 }, "Your location");
		expect(fc.features[0].properties).toEqual({
			refKey: PIN_REF,
			name: "Your location",
			value: null
		});
		expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [2, 1] });
	});

	it("monitor positions come from the monitors' features", () => {
		const positions = monitorPositions(
			{
				type: "FeatureCollection",
				features: [
					{
						type: "Feature",
						geometry: { type: "Point", coordinates: [-119, 36] },
						properties: { refKey: "monitor:a", name: "A", value: 1 }
					},
					{
						type: "Feature",
						geometry: { type: "Point", coordinates: [-118, 35] },
						properties: { refKey: "monitor:b", name: "B", value: 1 }
					}
				]
			},
			["a", "missing"]
		);
		expect([...positions]).toEqual([["a", [-119, 36]]]);
		expect(monitorPositions(null, ["a"]).size).toBe(0);
	});

	it("the pin marker is drawn in theme colors", () => {
		const svg = pinIcon.draw("pin", "unused", {
			neutral: "n",
			highlight: "var-highlight",
			highlightForeground: "var-on-highlight",
			foreground: "var-foreground",
			mutedForeground: "m"
		});
		expect(svg).toContain('fill="var-highlight"');
		expect(svg).toContain('stroke="var-foreground"');
		expect(svg).toContain('fill="var-on-highlight"');
	});
});
