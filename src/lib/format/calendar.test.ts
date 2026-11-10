import { describe, expect, it } from "vitest";
import {
	addDays,
	daysInMonth,
	dayOfWeek,
	daysInclusive,
	monthGrid,
	monthStarts,
	weekColumnMonthLabels,
	weekColumns
} from "./calendar";

describe("calendar date helpers", () => {
	it("adds days across the fall-back change", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
		expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
		expect(addDays("2026-11-02", -2)).toBe("2026-10-31");
	});
	it("counts days inclusive", () => {
		expect(daysInclusive("2026-11-01", "2026-11-30")).toBe(30);
		expect(daysInclusive("2026-11-09", "2026-11-09")).toBe(1);
		expect(daysInclusive("2026-10-31", "2026-11-02")).toBe(3);
	});
	it("gives the day of week, Sunday as 0", () => {
		expect(dayOfWeek("2026-11-01")).toBe(0);
		expect(dayOfWeek("2026-11-07")).toBe(6);
	});
	it("builds November 2026 with Sunday first", () => {
		const g = monthGrid("2026-11-01");
		expect(g[0]).toEqual([
			"2026-11-01",
			"2026-11-02",
			"2026-11-03",
			"2026-11-04",
			"2026-11-05",
			"2026-11-06",
			"2026-11-07"
		]);
		expect(g.at(-1)).toEqual(["2026-11-29", "2026-11-30", null, null, null, null, null]);
		expect(g.length).toBe(5);
	});
	it("pads October 2026 (starts on a Thursday)", () => {
		expect(monthGrid("2026-10-01")[0]).toEqual([
			null,
			null,
			null,
			null,
			"2026-10-01",
			"2026-10-02",
			"2026-10-03"
		]);
	});
	it("builds week columns across a year boundary", () => {
		const cols = weekColumns("2026-12-29", "2027-01-05");
		expect(cols[0]).toEqual([
			null,
			null,
			"2026-12-29",
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02"
		]);
		expect(cols[1][0]).toBe("2027-01-03");
		expect(cols[1][3]).toBe(null); // Jan 6 is after the end
		expect(weekColumnMonthLabels(cols)).toEqual(["2026-12-01", "2027-01-01"]);
	});
	it("labels a month on the column of its first in-range day", () => {
		const cols = weekColumns("2026-10-04", "2026-11-14");
		expect(weekColumnMonthLabels(cols)).toEqual([
			"2026-10-01",
			null,
			null,
			null,
			"2026-11-01",
			null
		]);
	});
	it("lists month starts", () => {
		expect(monthStarts("2026-10-15", "2026-12-02")).toEqual([
			"2026-10-01",
			"2026-11-01",
			"2026-12-01"
		]);
	});
});

describe("daysInMonth", () => {
	it("counts the days, leap years included", () => {
		expect(daysInMonth("2026-11-15")).toBe(30);
		expect(daysInMonth("2026-10-01")).toBe(31);
		expect(daysInMonth("2026-02-28")).toBe(28);
		expect(daysInMonth("2028-02-10")).toBe(29);
	});
});
