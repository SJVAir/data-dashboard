import { describe, expect, it } from "vitest";
import type { Level } from "$lib/data/metadata";
import type { NowAlert } from "./NowControls.svelte";
import { hasAlertLevels, hasLevelLine } from "./type-options";

const level = { key: "good" } as Level;
const alert = (levels: NowAlert["levels"]): NowAlert => ({
	entryType: "pm25",
	label: "PM2.5",
	levels,
	threshold: undefined
});

describe("hasLevelLine", () => {
	it("is false without levels", () => {
		expect(hasLevelLine([])).toBe(false);
		expect(hasLevelLine(undefined)).toBe(false);
	});
	it("is true for levels or the retry", () => {
		expect(hasLevelLine("unavailable")).toBe(true);
		expect(hasLevelLine([level])).toBe(true);
	});
});

describe("hasAlertLevels", () => {
	it("is false with nothing to show", () => {
		expect(hasAlertLevels([])).toBe(false);
		expect(hasAlertLevels([alert(null)])).toBe(false);
	});
	it("is true when some pollutant has levels or the retry", () => {
		expect(hasAlertLevels([alert("unavailable")])).toBe(true);
		expect(hasAlertLevels([alert([level])])).toBe(true);
	});
});
