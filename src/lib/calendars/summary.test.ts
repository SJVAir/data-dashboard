import { describe, expect, it } from "vitest";
import type { Level } from "$lib/data/metadata";
import type { DayState } from "./day-state";
import { selectionSummary } from "./summary";

const level = (key: string, min: number, max: number | null, tier: number): Level => ({
	key,
	label: key,
	color: null,
	opacity: null,
	tier,
	guidance: "",
	description: "",
	min,
	max
});
const levels = [
	level("good", 0, 9.1, 0),
	level("moderate", 9.1, 35.5, 1),
	level("usg", 35.5, null, 2)
];
const rated = (date: string, value: number): DayState => ({
	date,
	kind: "rated",
	value,
	level: levels.find((l) => value >= l.min && (l.max === null || value < l.max)) ?? null
});
const days = [
	rated("2026-11-05", 21.7),
	rated("2026-11-06", 31.9),
	rated("2026-11-07", 28.8),
	rated("2026-11-08", 19.5)
];

describe("selectionSummary", () => {
	it("summarizes a fully rated selection", () => {
		const s = selectionSummary(days, levels[1]);
		expect(s).toMatchObject({
			start: "2026-11-05",
			end: "2026-11-08",
			days: 4,
			unrated: 0,
			atOrAbove: 4
		});
		expect(s.average).toBeCloseTo(25.475);
		expect(s.worst?.date).toBe("2026-11-06");
	});
	it("counts unrated days and averages the rest", () => {
		const s = selectionSummary(
			[days[0], { date: "2026-11-06", kind: "thin", value: null, level: null }, days[2]],
			null
		);
		expect(s.unrated).toBe(1);
		expect(s.average).toBeCloseTo(25.25);
	});
	it("picks the earlier date on a tie", () => {
		expect(
			selectionSummary([rated("2026-11-01", 30), rated("2026-11-02", 30)], null).worst?.date
		).toBe("2026-11-01");
	});
	it("has no atOrAbove without a threshold", () => {
		expect(selectionSummary(days, null).atOrAbove).toBeNull();
	});
	it("has no average or worst when nothing is rated", () => {
		const s = selectionSummary(
			[{ date: "2026-11-01", kind: "unrated", value: null, level: null }],
			null
		);
		expect(s).toMatchObject({ unrated: 1, average: null, worst: null });
	});
});
