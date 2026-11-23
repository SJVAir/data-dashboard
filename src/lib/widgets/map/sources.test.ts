import { describe, expect, it } from "vitest";
import { monitorPositions } from "./sources";

describe("map sources", () => {
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
});
