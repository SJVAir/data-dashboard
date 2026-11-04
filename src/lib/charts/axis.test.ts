import { describe, expect, it } from "vitest";
import { valueTickLabels } from "./axis";

describe("valueTickLabels", () => {
	it("shows no decimals for whole-number steps", () => {
		expect(valueTickLabels([0, 5, 10, 1000], 5)).toEqual(["0", "5", "10", "1,000"]);
	});

	it("shows as many decimals as the step needs, on every label", () => {
		expect(valueTickLabels([0, 0.5, 1], 0.5)).toEqual(["0.0", "0.5", "1.0"]);
		expect(valueTickLabels([0.1, 0.2, 0.30000000000000004], 0.1)).toEqual(["0.1", "0.2", "0.3"]);
		expect(valueTickLabels([0, 0.25], 0.25)).toEqual(["0.00", "0.25"]);
	});

	it("adds decimals until the labels are distinct", () => {
		expect(valueTickLabels([1, 1.2], 1)).toEqual(["1.0", "1.2"]);
		const labels = valueTickLabels([2.001, 2.002, 2.003], 1);
		expect(new Set(labels).size).toBe(3);
	});
});
