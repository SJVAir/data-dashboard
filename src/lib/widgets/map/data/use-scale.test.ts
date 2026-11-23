import { describe, expect, it } from "vitest";
import { levelFor, NO_LEVEL } from "@sjvair/map-sdk/data";
import {
	buildUseScale,
	formatUseValue,
	registerUseScale,
	useScaleFor,
	useScaleRef
} from "./use-scale";

const INFO = { label: "Pounds applied", units: "lbs", precision: 0 };
const CLASSES = { breaks: [10, 100, 1000], min: null, colors: ["#aaa", "#bbb", "#ccc"] };

describe("use scale", () => {
	it("one level per break, colours in order, zero is no level", () => {
		const scale = buildUseScale(CLASSES, INFO);
		expect(scale.levels.map((l) => l.color)).toEqual(["#aaa", "#bbb", "#ccc"]);
		expect(scale.levels.map((l) => l.key)).toEqual(["c1", "c2", "c3"]);
		expect(levelFor(0, scale)).toBe(NO_LEVEL);
		expect(levelFor(5, scale)).toMatchObject({ key: "c1" });
		expect(levelFor(5000, scale)).toMatchObject({ key: "c3" });
		expect(scale.levels[0].label).toBe("Up to 10");
		expect(scale.levels[1].label).toBe("10 to 100");
	});

	it("a value equal to a break is in that break's class", () => {
		const scale = buildUseScale(CLASSES, INFO);
		expect(levelFor(10, scale)).toMatchObject({ key: "c1" });
		expect(levelFor(10.5, scale)).toMatchObject({ key: "c2" });
		expect(levelFor(100, scale)).toMatchObject({ key: "c2" });
	});

	it("small breaks that round alike get the precision that tells them apart", () => {
		const breaks = [0.2, 0.4, 1];
		const scale = buildUseScale({ breaks, min: null, colors: ["#a", "#b", "#c"] }, INFO);
		const labels = scale.levels.map((l) => l.label);
		expect(labels).toEqual(["Up to 0.2", "0.2 to 0.4", "0.4 to 1.0"]);
		// The server's breaks, never invented ones.
		expect(scale.levels.map((l) => l.max)).toEqual([
			scale.levels[1].min,
			scale.levels[2].min,
			null
		]);
		expect(levelFor(0.4, scale)).toMatchObject({ key: "c2" });
	});

	it("equal neighbouring breaks, which no precision tells apart, keep the figure's precision", () => {
		const scale = buildUseScale(
			{ breaks: [0.2, 0.2, 1], min: null, colors: ["#a", "#b", "#c"] },
			INFO
		);
		expect(scale.levels.map((l) => l.label)).toEqual(["Up to 0", "0 to 0", "0 to 1"]);
	});

	it("a precision that already tells the breaks apart is kept", () => {
		const scale = buildUseScale(
			{ breaks: [1, 2.5, 4], min: null, colors: ["#a", "#b", "#c"] },
			INFO
		);
		// 2.5 rounds to 3 at precision 0, apart from 1 and 4, so the labels keep precision 0.
		expect(scale.levels.map((l) => l.label)).toEqual(["Up to 1", "1 to 3", "3 to 4"]);
	});

	it("fewer than 8 breaks give fewer levels, and empty classes give none", () => {
		expect(
			buildUseScale({ breaks: [1, 2], min: null, colors: ["#a", "#b"] }, INFO).levels
		).toHaveLength(2);
		expect(buildUseScale({ breaks: [], min: null, colors: [] }, INFO).levels).toHaveLength(0);
	});

	it("equal classes keep one ref and one scale, other classes make a new scale", () => {
		const ref = useScaleRef("pounds-applied", "section", "q1");
		expect(useScaleRef("pounds-applied", "section", "q1")).toBe(ref);
		expect(useScaleRef("pounds-applied", "township", "q1")).not.toBe(ref);
		registerUseScale(ref, CLASSES, INFO);
		const first = useScaleFor(ref);
		registerUseScale(ref, { ...CLASSES, breaks: [...CLASSES.breaks] }, INFO);
		expect(useScaleFor(ref)).toBe(first);
		registerUseScale(ref, { ...CLASSES, breaks: [20, 100, 1000] }, INFO);
		expect(useScaleFor(ref)).not.toBe(first);
	});

	it("changed scale info under one ref makes a new scale; equal info keeps it", () => {
		const ref = useScaleRef("pounds-applied", "section", "q-info");
		registerUseScale(ref, CLASSES, INFO);
		const first = useScaleFor(ref);
		registerUseScale(ref, CLASSES, { ...INFO });
		expect(useScaleFor(ref)).toBe(first);
		registerUseScale(ref, CLASSES, { ...INFO, label: "Pounds" });
		expect(useScaleFor(ref)?.label).toBe("Pounds");
		registerUseScale(ref, CLASSES, { ...INFO, label: "Pounds", precision: 1 });
		expect(useScaleFor(ref)?.levels[0].label).toBe("Up to 10.0");
	});
});

describe("formatUseValue", () => {
	const fractional = buildUseScale(
		{ breaks: [0.2, 0.4, 1], min: null, colors: ["#a", "#b", "#c"] },
		INFO
	);
	it("reads at the catalog's precision when that says what the value is", () => {
		expect(formatUseValue(4567, 0)).toBe("4,567");
		// A top-class value with fractional breaks needs no extra digits.
		expect(formatUseValue(4567, 0, fractional)).toBe("4,567");
		expect(formatUseValue(0, 0)).toBe("0");
	});
	it("a value above zero never reads 0, with no scale (a figure that isn't shown)", () => {
		expect(formatUseValue(0.3, 0)).toBe("0.3");
		expect(formatUseValue(0.004, 1)).toBe("0.004");
	});
	it("a value above zero never reads 0 in a whole-number class", () => {
		expect(formatUseValue(0.3, 0, buildUseScale(CLASSES, INFO))).toBe("0.3");
	});
	it("the shown figure gets digits until it reads inside its own class", () => {
		// 0.41 is in "0.4 to 1"; at one digit it would read 0.4, in "0.2 to 0.4".
		expect(formatUseValue(0.41, 0, fractional)).toBe("0.41");
		expect(formatUseValue(0.3, 0, fractional)).toBe("0.3");
	});
});

describe("use scale guards", () => {
	it("colours that don't match the breaks build an empty scale, never undefined colours", () => {
		const scale = buildUseScale({ breaks: [1, 2, 3], min: null, colors: ["#a", "#b"] }, INFO);
		expect(scale.levels).toHaveLength(0);
		expect(scale.source).toBeNull();
	});
});
