import { describe, expect, it } from "vitest";
import { countyMatches, normalizeCountyName } from "./county-match";

describe("normalizeCountyName", () => {
	it("strips a trailing County suffix case-insensitively", () => {
		expect(normalizeCountyName("Fresno County")).toBe("fresno");
	});

	it("lowercases and trims whitespace", () => {
		expect(normalizeCountyName("  Fresno  ")).toBe("fresno");
	});

	it("leaves a bare county name unchanged aside from casing", () => {
		expect(normalizeCountyName("Fresno")).toBe("fresno");
	});
});

describe("countyMatches", () => {
	it("matches a bare monitor county against a region's full name", () => {
		expect(countyMatches("Fresno", "Fresno County")).toBe(true);
	});

	it("does not match different counties", () => {
		expect(countyMatches("Fresno", "Kern County")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(countyMatches("fresno", "FRESNO COUNTY")).toBe(true);
	});
});
