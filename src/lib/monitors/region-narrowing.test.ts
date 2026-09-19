import { describe, expect, it } from "vitest";
import { pruneSelection } from "./region-narrowing";

describe("pruneSelection", () => {
	it("keeps only ids that are present in availableIds", () => {
		const selection = new Set(["a", "b", "c"]);
		const availableIds = new Set(["a", "c", "d"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set(["a", "c"]));
	});

	it("returns an empty set when nothing in the selection is available", () => {
		const selection = new Set(["a", "b"]);
		const availableIds = new Set(["x", "y"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set());
	});

	it("returns everything unchanged when all ids are available", () => {
		const selection = new Set(["a", "b"]);
		const availableIds = new Set(["a", "b", "c"]);
		expect(pruneSelection(selection, availableIds)).toEqual(new Set(["a", "b"]));
	});

	it("handles an empty selection", () => {
		expect(pruneSelection(new Set(), new Set(["a"]))).toEqual(new Set());
	});

	it("returns a new Set instance, not the same reference as the input", () => {
		const selection = new Set(["a"]);
		const result = pruneSelection(selection, new Set(["a"]));
		expect(result).not.toBe(selection);
	});
});
