import { describe, expect, it } from "vitest";
import type { SJVAirEntryLevel } from "@sjvair/sdk";
import { buildCalendarDays, getCurrentLevel, groupDaysByMonth } from "./calendar";

const levels: Array<SJVAirEntryLevel> = [
	{ name: "good", label: "Good", color: "#00e400", range: [0, 9], guidance: null },
	{ name: "moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4], guidance: null }
];

describe("getCurrentLevel", () => {
	it("finds the level whose range contains the value", () => {
		expect(getCurrentLevel(5, levels)?.name).toBe("good");
		expect(getCurrentLevel(20, levels)?.name).toBe("moderate");
	});

	it("returns undefined when no level matches", () => {
		expect(getCurrentLevel(1000, levels)).toBeUndefined();
	});
});

describe("buildCalendarDays", () => {
	it("builds one entry per day in the range, colored by level", () => {
		const valuesByDate = new Map([["2026-01-01", 5]]);
		const days = buildCalendarDays("2026-01-01", "2026-01-02", valuesByDate, levels);
		expect(days).toEqual([
			{ date: "2026-01-01", value: 5, color: "#00e400" },
			{ date: "2026-01-02", value: null, color: null }
		]);
	});

	it("leaves color null when levels are unavailable", () => {
		const valuesByDate = new Map([["2026-01-01", 5]]);
		const days = buildCalendarDays("2026-01-01", "2026-01-01", valuesByDate, null);
		expect(days).toEqual([{ date: "2026-01-01", value: 5, color: null }]);
	});
});

describe("groupDaysByMonth", () => {
	it("groups days by their yyyy-MM prefix", () => {
		const days = buildCalendarDays("2026-01-30", "2026-02-01", new Map(), null);
		const groups = groupDaysByMonth(days);
		expect(groups.map((g) => g.month)).toEqual(["2026-01", "2026-02"]);
		expect(groups[0].days).toHaveLength(2);
		expect(groups[1].days).toHaveLength(1);
	});
});
