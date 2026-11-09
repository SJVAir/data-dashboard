import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import {
	formatDate,
	formatDateTime,
	formatHourRange,
	formatList,
	formatLongWeekdayDate,
	formatMonthName,
	formatMonthShort,
	formatNumber,
	formatPeriod,
	formatTick,
	formatValue,
	formatWeekday,
	needsZoneLabel,
	pacificHoursOfDay,
	parseDateKey,
	startOfPacificWeek,
	todayPacific
} from "./index";

describe("format", () => {
	it("todayPacific uses Pacific, not UTC", () => {
		expect(todayPacific(new Date("2026-10-21T06:30:00Z"))).toBe("2026-10-20");
	});
	it("formatMonthName names the Pacific month without its year", () => {
		expect(formatMonthName("2026-11-30")).toBe("November");
		expect(formatMonthName("2027-01-01")).toBe("January");
	});
	it("formatMonthShort names the Pacific month briefly", () => {
		expect(formatMonthShort("2026-11-01")).toBe("Nov");
		expect(formatMonthShort("2027-01-31")).toBe("Jan");
	});
	it("formatLongWeekdayDate spells out the weekday and month", () => {
		expect(formatLongWeekdayDate("2026-11-06")).toBe("Friday, November 6");
		expect(formatLongWeekdayDate("2026-03-08")).toBe("Sunday, March 8");
		expect(formatLongWeekdayDate("2026-12-31", { year: true })).toBe("Thursday, December 31, 2026");
	});
	it("formatWeekday names a date's Pacific weekday", () => {
		expect(formatWeekday("2026-11-08", "long")).toBe("Sunday");
		expect(formatWeekday("2026-11-08", "short")).toBe("Sun");
		expect(formatWeekday("2026-11-09", "narrow")).toBe("M");
	});
	it("weeks start on Sunday", () => {
		expect(startOfPacificWeek("2026-10-20")).toBe("2026-10-18");
		expect(startOfPacificWeek("2026-10-18")).toBe("2026-10-18");
	});
	it("spring-forward day has 23 hours", () => {
		expect(pacificHoursOfDay("2026-03-08")).toHaveLength(23);
	});
	it("fall-back day has 25 distinct hours", () => {
		const hours = pacificHoursOfDay("2026-11-01");
		expect(hours).toHaveLength(25);
		expect(new Set(hours.map((d) => d.getTime())).size).toBe(25);
	});
	it("ordinary day has 24 hours", () => {
		expect(pacificHoursOfDay("2026-10-20")).toHaveLength(24);
	});
	it("PT label only outside Pacific", () => {
		expect(needsZoneLabel("America/Los_Angeles")).toBe(false);
		expect(needsZoneLabel("America/New_York")).toBe(true);
		const t = new Date("2026-10-20T19:00:00Z");
		expect(formatDateTime(t, { deviceZone: "America/Los_Angeles" })).not.toContain("PT");
		expect(formatDateTime(t, { deviceZone: "America/New_York" })).toContain("PT");
		expect(formatDateTime(t, { deviceZone: "America/New_York" })).toContain("12:00");
	});
	it("formats numbers with the locale", () => {
		expect(formatNumber(12345.6, { maximumFractionDigits: 1 })).toBe("12,345.6");
	});
	it("formats a value with exactly the catalog's precision, or the default without one", () => {
		expect(formatValue(15.94, 1)).toBe("15.9");
		expect(formatValue(16, 1)).toBe("16.0");
		expect(formatValue(15.94, 0)).toBe("16");
		expect(formatValue(15.94, null)).toBe("15.94");
	});
	it("parseDateKey rejects malformed and impossible dates", () => {
		for (const bad of ["2026-1-05", "2026-02-30", "20261005", "2026-10-05T00:00", ""]) {
			expect(() => parseDateKey(bad)).toThrow(RangeError);
		}
		expect(parseDateKey("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
	});
	it("DST spring-forward day has the right hour starts", () => {
		const hours = pacificHoursOfDay("2026-03-08");
		expect(hours).toHaveLength(23);
		expect(hours.slice(0, 3).map((h) => h.toISOString())).toEqual([
			"2026-03-08T08:00:00.000Z",
			"2026-03-08T09:00:00.000Z",
			"2026-03-08T10:00:00.000Z"
		]);
	});
	it("DST fall-back day repeats 1 AM", () => {
		const hours = pacificHoursOfDay("2026-11-01");
		expect(hours).toHaveLength(25);
		expect(hours.slice(0, 3).map((h) => h.toISOString())).toEqual([
			"2026-11-01T07:00:00.000Z",
			"2026-11-01T08:00:00.000Z",
			"2026-11-01T09:00:00.000Z"
		]);
	});
	it("formatDate shows the Pacific calendar date in any device zone", () => {
		expect(formatDate("2026-10-22")).toBe("Oct 22, 2026");
		expect(formatDate(new Date("2026-10-22T05:00:00Z"))).toBe("Oct 21, 2026");
	});
	it("formatDateTime appends the PT label from messages", () => {
		const t = new Date("2026-10-20T19:00:00Z");
		const bare = formatDateTime(t, { deviceZone: "America/Los_Angeles" });
		const labelled = formatDateTime(t, { deviceZone: "America/New_York" });
		expect(labelled).toBe(m.time_zone_suffix({ time: bare }));
		expect(bare.endsWith(m.time_zone_suffix({ time: "" }).trim())).toBe(false);
	});
	it("formatHourRange shows a Pacific hour span", () => {
		const start = new Date("2026-10-20T22:00:00Z");
		const end = new Date("2026-10-20T23:00:00Z");
		expect(formatHourRange(start, end, { deviceZone: "America/Los_Angeles" })).toMatch(
			/^3\s*–\s*4\sPM$/
		);
		expect(formatHourRange(start, end, { deviceZone: "America/New_York" })).toMatch(/PM PT$/);
	});
	it("formatPeriod labels a period start by its resolution", () => {
		const t = new Date("2026-10-01T07:00:00Z");
		expect(formatPeriod(t, "day")).toBe("Oct 1, 2026");
		expect(formatPeriod(t, "month")).toBe("Oct 2026");
		expect(formatPeriod(new Date("2026-01-01T08:00:00Z"), "year")).toBe("2026");
		expect(formatPeriod(t, "hour", { deviceZone: "America/Los_Angeles" })).toBe(
			formatDateTime(t, { deviceZone: "America/Los_Angeles" })
		);
	});
	it("formatTick uses Pacific time at each tick unit", () => {
		const t = new Date("2026-10-01T07:00:00Z");
		expect(formatTick(t, "day")).toBe("Oct 1");
		expect(formatTick(t, "month")).toBe("Oct");
		expect(formatTick(t, "year")).toBe("2026");
		expect(formatTick(new Date("2026-10-01T22:00:00Z"), "hour")).toBe("3 PM");
		// An hourly tick on a Pacific midnight names the day instead of "12 AM".
		expect(formatTick(new Date("2026-10-02T07:00:00Z"), "hour")).toBe("Oct 2");
		// Midnight UTC isn't a Pacific midnight.
		expect(formatTick(new Date("2026-10-02T00:00:00Z"), "hour")).toBe("5 PM");
		// Fall-back day: midnight is still 07:00Z (PDT); the next midnight is 08:00Z (PST).
		expect(formatTick(new Date("2026-11-02T08:00:00Z"), "hour")).toBe("Nov 2");
	});
	it("formatList joins names as a sentence list", () => {
		expect(formatList(["A"])).toBe("A");
		expect(formatList(["A", "B", "C"])).toBe("A, B, and C");
	});
});
