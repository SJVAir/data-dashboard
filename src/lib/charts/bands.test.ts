import { describe, expect, it } from "vitest";
import type { Level } from "$lib/data/metadata";
import { layoutBands, valueAxisMax } from "./bands";

const level = (key: string, label: string, min: number, max: number | null): Level => ({
	key,
	label,
	color: "level-color",
	opacity: null,
	tier: null,
	min,
	max
});

const LEVELS: Level[] = [
	level("good", "Good", 0, 9),
	level("moderate", "Moderate", 9, 35.4),
	level("usg", "Unhealthy for Sensitive Groups", 35.4, 55.4),
	level("unhealthy", "Unhealthy", 55.4, null)
];

/** 5 px per character. */
const measure = (text: string) => text.length * 5;
const LINE = 12;

describe("layoutBands", () => {
	it("leaves a band too thin for its label unlabeled", () => {
		const boxes = layoutBands(LEVELS, { min: 0, max: 100, height: 190 }, measure, 200, LINE);
		const good = boxes.find((b) => b.level.key === "good")!;
		expect(good.bottom).toBeCloseTo(190);
		expect(good.top).toBeCloseTo(190 - 17.1);
		expect(good.label).toBeNull();
	});

	it("wraps a long label onto two lines that fit the width", () => {
		// The USG band is 30 px tall: 0–100 → 0–150 px gives 20 units × 1.5 px.
		const boxes = layoutBands(LEVELS, { min: 0, max: 100, height: 150 }, measure, 80, LINE);
		const usg = boxes.find((b) => b.level.key === "usg")!;
		expect(usg.bottom - usg.top).toBeCloseTo(30);
		expect(usg.label).toEqual(["Unhealthy for", "Sensitive Groups"]);
		for (const line of usg.label!) expect(measure(line)).toBeLessThanOrEqual(80);
	});

	it("keeps a label on one line when it fits", () => {
		const boxes = layoutBands(LEVELS, { min: 0, max: 100, height: 400 }, measure, 200, LINE);
		expect(boxes.find((b) => b.level.key === "moderate")!.label).toEqual(["Moderate"]);
	});

	it("extends an open top level to the scale's max", () => {
		const boxes = layoutBands(LEVELS, { min: 0, max: 100, height: 200 }, measure, 200, LINE);
		const top = boxes.find((b) => b.level.key === "unhealthy")!;
		expect(top.top).toBeCloseTo(0);
		expect(top.bottom).toBeCloseTo(200 - 55.4 * 2);
	});

	it("clips bands to the scale and drops those above it", () => {
		const boxes = layoutBands(LEVELS, { min: 0, max: 30, height: 300 }, measure, 200, LINE);
		expect(boxes.map((b) => b.level.key)).toEqual(["good", "moderate"]);
		expect(boxes[1].top).toBeCloseTo(0);
	});

	it("never abbreviates: a label is the full name or nothing", () => {
		for (const width of [20, 40, 60, 80, 120, 200, 400]) {
			for (const height of [50, 150, 300, 1000]) {
				const boxes = layoutBands(LEVELS, { min: 0, max: 100, height }, measure, width, LINE);
				for (const box of boxes) {
					if (box.label === null) continue;
					expect(box.label.length).toBeLessThanOrEqual(2);
					expect(box.label.join(" ")).toBe(box.level.label);
					for (const line of box.label) expect(measure(line)).toBeLessThanOrEqual(width);
				}
			}
		}
	});
});

describe("valueAxisMax", () => {
	it("is the top of the level that holds the data max", () => {
		expect(valueAxisMax(LEVELS, 20)).toBe(35.4);
	});
	it("is the data max when it sits in the open top level", () => {
		expect(valueAxisMax(LEVELS, 140)).toBe(140);
	});
	it("falls back to the data max without levels, and to the first level with no data", () => {
		expect(valueAxisMax([], 12)).toBe(12);
		expect(valueAxisMax(LEVELS, null)).toBe(9);
	});
});
