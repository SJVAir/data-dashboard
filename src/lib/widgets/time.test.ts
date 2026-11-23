import { describe, expect, test } from "vitest";
import { chartType } from "./chart";
import { currentType } from "./current";
import { mapType } from "./map";
import { offersNow, showsNow } from "./time";

const LAYERS = [{ dataset: "air-quality", entryType: "pm25" }];
const RANGE = { kind: "trailing", amount: 7, unit: "day" } as const;

describe("showsNow", () => {
	test("a now type always shows now", () => {
		expect(showsNow(currentType, { layers: LAYERS })).toBe(true);
	});

	test("the Map shows now with no date range, and its range with one", () => {
		expect(showsNow(mapType, { layers: LAYERS })).toBe(true);
		expect(showsNow(mapType, { layers: LAYERS, dateRange: RANGE })).toBe(false);
	});

	test("a range type without `now` never shows now", () => {
		expect(showsNow(chartType, { layers: LAYERS })).toBe(false);
	});
});

describe("offersNow", () => {
	test("Current conditions and the Map offer now; the Chart doesn't", () => {
		expect(offersNow(currentType)).toBe(true);
		expect(offersNow(mapType)).toBe(true);
		expect(offersNow(chartType)).toBe(false);
	});
});
