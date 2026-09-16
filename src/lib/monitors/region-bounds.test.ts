import { describe, expect, it } from "vitest";
import { unionBounds } from "./region-bounds";

describe("unionBounds", () => {
	it("returns null for an empty list", () => {
		expect(unionBounds([])).toBeNull();
	});

	it("returns the same bounds for a single entry", () => {
		expect(unionBounds([[-120, 35, -118, 37]])).toEqual([-120, 35, -118, 37]);
	});

	it("computes the union of multiple bounding boxes", () => {
		const bounds = unionBounds([
			[-120, 35, -118, 37],
			[-121, 34, -119, 36]
		]);
		expect(bounds).toEqual([-121, 34, -118, 37]);
	});

	it("handles bounds that don't overlap", () => {
		const bounds = unionBounds([
			[-125, 40, -124, 41],
			[-115, 32, -114, 33]
		]);
		expect(bounds).toEqual([-125, 32, -114, 41]);
	});
});
