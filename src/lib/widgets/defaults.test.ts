import { expect, test } from "vitest";
import { DateRangeSpecSchema, LayerSchema } from "$lib/data/schema";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "./defaults";

test("the defaults are PM2.5 in Fresno County over the last 30 days, and valid", () => {
	expect(DEFAULT_LAYER).toEqual({
		dataset: "air-quality",
		entryType: "pm25",
		place: { kind: "region", type: "county", code: "06019" }
	});
	expect(DEFAULT_RANGE).toEqual({ kind: "trailing", amount: 30, unit: "day" });
	expect(LayerSchema.parse(DEFAULT_LAYER)).toEqual(DEFAULT_LAYER);
	expect(DateRangeSpecSchema.parse(DEFAULT_RANGE)).toEqual(DEFAULT_RANGE);
});

test("the shared defaults can't be changed in place", () => {
	expect(Object.isFrozen(DEFAULT_LAYER)).toBe(true);
	expect(Object.isFrozen(DEFAULT_LAYER.place)).toBe(true);
	expect(Object.isFrozen(DEFAULT_RANGE)).toBe(true);
});
