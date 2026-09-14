import { describe, expect, it } from "vitest";
import { decodeDateRange, decodeViews, encodeDateRange, encodeViews } from "./url-state";

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

	it("decodes null as all views disabled", () => {
		expect(decodeViews(null, allViews)).toEqual({ map: false, chart: false, spreadsheet: false });
	});

	it("encodes no enabled views as an empty string", () => {
		expect(encodeViews({ map: false, chart: false, spreadsheet: false })).toBe("");
	});

	it("ignores unknown keys when decoding", () => {
		expect(decodeViews("map,unknown", allViews)).toEqual({
			map: true,
			chart: false,
			spreadsheet: false
		});
	});
});
