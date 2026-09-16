import { describe, expect, it } from "vitest";
import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { buildCountyFillColors } from "./county-fill";

const levels: Array<SJVAirEntryLevel> = [
	{ name: "good", label: "Good", color: "#00e400", range: [0, 9], guidance: null },
	{ name: "moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4], guidance: null }
];

describe("buildCountyFillColors", () => {
	it("buckets each region's mean into its level color", () => {
		const means = new Map([
			["fresno", 5],
			["kern", 20]
		]);
		const colors = buildCountyFillColors(means, levels);
		expect(colors.get("fresno")).toBe("#00e400");
		expect(colors.get("kern")).toBe("#ffff00");
	});

	it("omits regions whose mean doesn't match any level", () => {
		const means = new Map([["fresno", 1000]]);
		const colors = buildCountyFillColors(means, levels);
		expect(colors.has("fresno")).toBe(false);
	});

	it("returns an empty map when levels is null", () => {
		const means = new Map([["fresno", 5]]);
		expect(buildCountyFillColors(means, null).size).toBe(0);
	});

	it("returns an empty map for an empty input", () => {
		expect(buildCountyFillColors(new Map(), levels).size).toBe(0);
	});
});
