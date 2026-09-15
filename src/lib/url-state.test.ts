import { describe, expect, it } from "vitest";
import {
	decodeDateRange,
	decodeViews,
	encodeDateRange,
	encodeViews,
	decodePollutant,
	encodePollutant,
	decodeCounty,
	encodeCounty
} from "./url-state";

describe("date range codec", () => {
	it("round-trips a date range through encode and decode", () => {
		const range = { start: "2026-01-01", end: "2026-01-31" };
		expect(decodeDateRange(encodeDateRange(range))).toEqual(range);
	});

	it("decodes null as no date range", () => {
		expect(decodeDateRange(null)).toBeNull();
	});

	it("decodes undefined as no date range", () => {
		expect(decodeDateRange(undefined)).toBeNull();
	});

	it("decodes an empty string as no date range", () => {
		expect(decodeDateRange("")).toBeNull();
	});

	it("decodes a malformed value (missing separator) as no date range", () => {
		expect(decodeDateRange("2026-01-01")).toBeNull();
	});
});

describe("views codec", () => {
	const allViews = ["map", "chart", "spreadsheet"] as const;

	it("round-trips enabled views through encode and decode", () => {
		const views = { map: true, chart: false, spreadsheet: true };
		expect(decodeViews(encodeViews(views), allViews)).toEqual(views);
	});

	it("decodes null as no views param", () => {
		expect(decodeViews(null, allViews)).toBeNull();
	});

	it("decodes undefined as no views param", () => {
		expect(decodeViews(undefined, allViews)).toBeNull();
	});

	it("encodes no enabled views as an empty string", () => {
		expect(encodeViews({ map: false, chart: false, spreadsheet: false })).toBe("");
	});

	it("decodes an empty string as all views disabled", () => {
		expect(decodeViews("", allViews)).toEqual({ map: false, chart: false, spreadsheet: false });
	});

	it("ignores unknown keys when decoding", () => {
		expect(decodeViews("map,unknown", allViews)).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
	});
});

describe("pollutant codec", () => {
	it("decodes pm25 and o3 as valid pollutants", () => {
		expect(decodePollutant("pm25")).toBe("pm25");
		expect(decodePollutant("o3")).toBe("o3");
	});

	it("decodes an unsupported value as null", () => {
		expect(decodePollutant("pm10")).toBeNull();
	});

	it("decodes null and undefined as null", () => {
		expect(decodePollutant(null)).toBeNull();
		expect(decodePollutant(undefined)).toBeNull();
	});

	it("round-trips a valid pollutant through encode", () => {
		expect(decodePollutant(encodePollutant("pm25"))).toBe("pm25");
	});
});

describe("county codec", () => {
	it("decodes a non-empty string as the region id", () => {
		expect(decodeCounty("abc123")).toBe("abc123");
	});

	it("decodes an empty string as no county selected", () => {
		expect(decodeCounty("")).toBeNull();
	});

	it("decodes null and undefined as no county selected", () => {
		expect(decodeCounty(null)).toBeNull();
		expect(decodeCounty(undefined)).toBeNull();
	});

	it("round-trips a region id through encode", () => {
		expect(decodeCounty(encodeCounty("abc123"))).toBe("abc123");
	});
});
