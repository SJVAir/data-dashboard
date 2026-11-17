import { describe, expect, it } from "vitest";
import { buildUseScale } from "./data/use-scale";
import { classInWords, joinLabels, peakMonth, topChemicals } from "./use-card";

const INFO = { label: "Pounds applied", units: "lbs", precision: 0 };
const SCALE = buildUseScale(
	{ breaks: [10, 100, 1000], min: null, colors: ["#aaa", "#bbb", "#ccc"] },
	INFO
);

const months = (values: number[]) => values.map((value, i) => ({ month: i + 1, value }));

describe("use card helpers", () => {
	it("peakMonth picks the largest, the first on a tie, null when all zero", () => {
		expect(peakMonth(months([0, 3, 9, 2, 0, 0, 0, 0, 0, 0, 0, 1]))).toBe(3);
		expect(peakMonth(months([0, 9, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0]))).toBe(2);
		expect(peakMonth(months(Array(12).fill(0)))).toBeNull();
		expect(peakMonth([])).toBeNull();
	});

	it("classInWords names the tier and range, null for zero", () => {
		expect(classInWords(SCALE, 5)).toEqual({ tier: 1, count: 3, label: "Up to 10" });
		expect(classInWords(SCALE, 100)).toEqual({ tier: 2, count: 3, label: "10 to 100" });
		expect(classInWords(SCALE, 5000)).toEqual({ tier: 3, count: 3, label: "100 to 1,000" });
		expect(classInWords(SCALE, 0)).toBeNull();
		expect(classInWords(buildUseScale({ breaks: [], min: null, colors: [] }, INFO), 5)).toBeNull();
	});

	it("topChemicals takes the first three by pounds", () => {
		const chem = (id: string, lbs: number) => ({ id, lbs });
		const top = topChemicals([
			chem("a", 1),
			chem("b", 9),
			chem("c", 4),
			chem("d", 7),
			chem("e", 2)
		]);
		expect(top.map((c) => c.id)).toEqual(["b", "d", "c"]);
	});

	it("joinLabels joins the filters' names, null for none", () => {
		expect(joinLabels([])).toBeNull();
		expect(joinLabels(["Sulfur"])).toBe("Sulfur");
		expect(joinLabels(["Sulfur", "Grapes", "Ground"])).toBe("Sulfur · Grapes · Ground");
	});
});
