import { describe, expect, it } from "vitest";
import catalog from "@sjvair/map-sdk/messages/en.json";
import { MAP_MESSAGES, mapMessages } from "./messages";

describe("map-sdk messages", () => {
	it("covers every map-sdk key", () => {
		const keys = Object.keys(catalog).filter((key) => key !== "$schema");
		const bases = keys.filter((key) => key.endsWith("_one")).map((key) => key.slice(0, -4));
		const expected = new Set([...keys, ...bases]);
		expect(new Set(Object.keys(MAP_MESSAGES))).toEqual(expected);
		for (const key of expected) {
			const text = mapMessages(key as never, { count: 2 });
			expect(text, key).not.toBe(key);
		}
	});

	it("picks the plural form by count", () => {
		expect(mapMessages("mapsdk_hms_fire_detections", { count: 1 })).toBe("1 fire detection");
		expect(mapMessages("mapsdk_hms_fire_detections", { count: 3 })).toBe("3 fire detections");
	});

	it("fills params", () => {
		expect(mapMessages("mapsdk_list_row_level", { name: "Fresno", level: "Good" })).toBe(
			"Fresno, Good"
		);
	});
});
