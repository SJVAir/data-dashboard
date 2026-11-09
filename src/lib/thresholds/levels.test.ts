import { describe, expect, it } from "vitest";
import type { Level } from "$lib/data/metadata";
import { defaultThresholdLevel, resolveThreshold } from "./levels";

function scale(rows: [string, number | null][]): Level[] {
	return rows.map(([key, tier], i) => ({
		key,
		label: key,
		color: null,
		opacity: null,
		tier,
		guidance: "",
		description: "",
		min: i * 10,
		max: i === rows.length - 1 ? null : i * 10 + 10
	}));
}

const pm25 = scale([
	["good", 0],
	["moderate", 1],
	["unhealthy_sensitive", 2],
	["unhealthy", 3],
	["very_unhealthy", 4],
	["hazardous", 5]
]);
const o3 = scale([
	["good", 0],
	["unhealthy_sensitive", 2],
	["unhealthy", 3]
]);

describe("defaultThresholdLevel", () => {
	it("is unhealthy_sensitive for the PM2.5 and O3 scales", () => {
		expect(defaultThresholdLevel(pm25)).toBe("unhealthy_sensitive");
		expect(defaultThresholdLevel(o3)).toBe("unhealthy_sensitive");
	});
	it("is null for no levels", () => {
		expect(defaultThresholdLevel([])).toBeNull();
	});
});

describe("resolveThreshold", () => {
	it("returns the saved level", () => {
		const r = resolveThreshold([{ level: "unhealthy" }], pm25);
		expect(r?.level.key).toBe("unhealthy");
		expect(r?.fellBack).toBe(false);
	});
	it("falls back when the scale lacks the saved key", () => {
		const r = resolveThreshold([{ level: "moderate" }], o3);
		expect(r?.level.key).toBe("unhealthy_sensitive");
		expect(r?.fellBack).toBe(true);
	});
	it("is null when Off or the scale is empty", () => {
		expect(resolveThreshold(undefined, pm25)).toBeNull();
		expect(resolveThreshold([], pm25)).toBeNull();
		expect(resolveThreshold([{ level: "good" }], [])).toBeNull();
	});
});
