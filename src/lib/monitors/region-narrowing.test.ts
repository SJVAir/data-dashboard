import { describe, expect, it } from "vitest";
import { shouldNarrow, unionOfOtherTypeSelections } from "./region-narrowing";

describe("unionOfOtherTypeSelections", () => {
	it("unions every other type's selected ids", () => {
		const selections = new Map([
			["county", new Set(["c1", "c2"])],
			["city", new Set(["ct1"])],
			["tract", new Set(["t1"])]
		]);
		expect(unionOfOtherTypeSelections(selections, "tract")).toEqual(new Set(["c1", "c2", "ct1"]));
	});

	it("excludes the active type's own selection", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		expect(unionOfOtherTypeSelections(selections, "county")).toEqual(new Set());
	});

	it("returns an empty set when no other type has a selection", () => {
		const selections = new Map([
			["county", new Set<string>()],
			["tract", new Set(["t1"])]
		]);
		expect(unionOfOtherTypeSelections(selections, "tract")).toEqual(new Set());
	});
});

describe("shouldNarrow", () => {
	it("is true when another type has a selection and narrowing isn't disabled", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		expect(shouldNarrow(selections, "tract", new Map())).toBe(true);
	});

	it("is false when no other type has a selection", () => {
		const selections = new Map([["county", new Set<string>()]]);
		expect(shouldNarrow(selections, "tract", new Map())).toBe(false);
	});

	it("is false when the user explicitly disabled narrowing for the active type", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		const narrowingEnabled = new Map([["tract", false]]);
		expect(shouldNarrow(selections, "tract", narrowingEnabled)).toBe(false);
	});

	it("disabling narrowing for one type doesn't affect another", () => {
		const selections = new Map([["county", new Set(["c1"])]]);
		const narrowingEnabled = new Map([["city", false]]);
		expect(shouldNarrow(selections, "tract", narrowingEnabled)).toBe(true);
	});
});
