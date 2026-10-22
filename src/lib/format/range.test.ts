import { describe, expect, it } from "vitest";
import {
	freezeRange,
	nextPeriodStart,
	periodStart,
	rangeSpanDays,
	resolveRange,
	type DateRangeSpec
} from "./range";

const now = new Date("2026-10-22T19:00:00Z");
const iso = (d: Date) => d.toISOString();

function dates(spec: DateRangeSpec, at = now) {
	const r = resolveRange(spec, at);
	return [r.firstDate, r.lastDate];
}

describe("resolveRange: set", () => {
	it("resolves a day, with a 23-hour span on spring-forward", () => {
		const r = resolveRange({ kind: "set", unit: "day", start: "2026-03-08" }, now);
		expect([r.firstDate, r.lastDate]).toEqual(["2026-03-08", "2026-03-08"]);
		expect(r.end.getTime() - r.start.getTime()).toBe(23 * 3_600_000);
		expect(rangeSpanDays(r)).toBeCloseTo(23 / 24);
	});

	it("resolves a Sunday-start week", () => {
		expect(dates({ kind: "set", unit: "week", start: "2026-10-22" })).toEqual([
			"2026-10-18",
			"2026-10-24"
		]);
	});

	it("resolves a leap-year month", () => {
		expect(dates({ kind: "set", unit: "month", start: "2024-02-10" })).toEqual([
			"2024-02-01",
			"2024-02-29"
		]);
	});

	it("resolves a year containing now as not rolling", () => {
		const r = resolveRange({ kind: "set", unit: "year", start: "2026-05-01" }, now);
		expect([r.firstDate, r.lastDate]).toEqual(["2026-01-01", "2026-12-31"]);
		expect(r.includesNow).toBe(true);
		expect(r.rolling).toBe(false);
	});

	it("does not include now for a past range", () => {
		expect(resolveRange({ kind: "set", unit: "year", start: "2025-05-01" }, now).includesNow).toBe(
			false
		);
	});
});

describe("resolveRange: to-date", () => {
	it.each([
		["week", "2026-10-18"],
		["month", "2026-10-01"],
		["year", "2026-01-01"]
	] as const)("%s runs to today", (unit, first) => {
		const r = resolveRange({ kind: "to-date", unit }, now);
		expect([r.firstDate, r.lastDate]).toEqual([first, "2026-10-22"]);
		expect(r.rolling).toBe(true);
		expect(r.includesNow).toBe(true);
	});
});

describe("resolveRange: trailing", () => {
	it("trailing days include today", () => {
		expect(dates({ kind: "trailing", amount: 30, unit: "day" })).toEqual([
			"2026-09-23",
			"2026-10-22"
		]);
	});

	it("trailing months count calendar days back", () => {
		expect(dates({ kind: "trailing", amount: 12, unit: "month" })).toEqual([
			"2025-10-23",
			"2026-10-22"
		]);
		expect(
			dates({ kind: "trailing", amount: 1, unit: "month" }, new Date("2026-03-31T19:00:00Z"))
		).toEqual(["2026-03-01", "2026-03-31"]);
	});

	it("trailing hours are exact", () => {
		const r = resolveRange({ kind: "trailing", amount: 24, unit: "hour" }, now);
		expect(iso(r.start)).toBe("2026-10-21T19:00:00.000Z");
		expect(r.end.getTime()).toBe(now.getTime());
		expect([r.firstDate, r.lastDate]).toEqual(["2026-10-21", "2026-10-22"]);
		expect(r.rolling).toBe(true);
		expect(r.includesNow).toBe(true);
	});
});

describe("resolveRange: custom", () => {
	it("uses the given dates", () => {
		const r = resolveRange({ kind: "custom", start: "2025-12-30", end: "2026-01-02" }, now);
		expect([r.firstDate, r.lastDate]).toEqual(["2025-12-30", "2026-01-02"]);
		expect(r.includesNow).toBe(false);
		expect(iso(r.start)).toBe("2025-12-30T08:00:00.000Z");
		expect(iso(r.end)).toBe("2026-01-03T08:00:00.000Z");
	});

	it("includes now when it ends today", () => {
		expect(
			resolveRange({ kind: "custom", start: "2026-10-01", end: "2026-10-22" }, now).includesNow
		).toBe(true);
	});

	it("throws RangeError for bad dates or reversed ranges", () => {
		expect(() =>
			resolveRange({ kind: "custom", start: "2026-02-30", end: "2026-03-01" }, now)
		).toThrow(RangeError);
		expect(() =>
			resolveRange({ kind: "custom", start: "2026-03-02", end: "2026-03-01" }, now)
		).toThrow(RangeError);
	});
});

describe("freezeRange", () => {
	it("freezes rolling and set specs to custom dates", () => {
		expect(freezeRange({ kind: "trailing", amount: 24, unit: "hour" }, now)).toEqual({
			kind: "custom",
			start: "2026-10-21",
			end: "2026-10-22"
		});
		expect(freezeRange({ kind: "to-date", unit: "month" }, now)).toEqual({
			kind: "custom",
			start: "2026-10-01",
			end: "2026-10-22"
		});
		expect(freezeRange({ kind: "set", unit: "month", start: "2024-02-10" }, now)).toEqual({
			kind: "custom",
			start: "2024-02-01",
			end: "2024-02-29"
		});
	});
});

describe("periodStart / nextPeriodStart", () => {
	it("handles hours across the fall-back DST hour", () => {
		expect(iso(periodStart(new Date("2026-11-01T09:30:00Z"), "hour"))).toBe(
			"2026-11-01T09:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2026-11-01T08:00:00Z"), "hour"))).toBe(
			"2026-11-01T09:00:00.000Z"
		);
	});

	it("handles days across DST", () => {
		expect(iso(periodStart(new Date("2026-03-08T12:00:00Z"), "day"))).toBe(
			"2026-03-08T08:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2026-03-08T08:00:00Z"), "day"))).toBe(
			"2026-03-09T07:00:00.000Z"
		);
	});

	it("handles months, quarters, years", () => {
		expect(iso(periodStart(new Date("2026-05-15T19:00:00Z"), "month"))).toBe(
			"2026-05-01T07:00:00.000Z"
		);
		expect(iso(periodStart(new Date("2026-05-15T19:00:00Z"), "quarter"))).toBe(
			"2026-04-01T07:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2026-10-01T07:00:00Z"), "quarter"))).toBe(
			"2027-01-01T08:00:00.000Z"
		);
		expect(iso(periodStart(new Date("2026-05-15T19:00:00Z"), "year"))).toBe(
			"2026-01-01T08:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2026-01-01T08:00:00Z"), "year"))).toBe(
			"2027-01-01T08:00:00.000Z"
		);
	});

	it("handles seasons (Dec, Mar, Jun, Sep starts)", () => {
		expect(iso(periodStart(new Date("2026-01-15T20:00:00Z"), "season"))).toBe(
			"2025-12-01T08:00:00.000Z"
		);
		expect(iso(periodStart(new Date("2026-12-15T20:00:00Z"), "season"))).toBe(
			"2026-12-01T08:00:00.000Z"
		);
		expect(iso(periodStart(new Date("2026-10-22T19:00:00Z"), "season"))).toBe(
			"2026-09-01T07:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2026-09-01T07:00:00Z"), "season"))).toBe(
			"2026-12-01T08:00:00.000Z"
		);
		expect(iso(nextPeriodStart(new Date("2025-12-01T08:00:00Z"), "season"))).toBe(
			"2026-03-01T08:00:00.000Z"
		);
	});
});
