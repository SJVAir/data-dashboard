import { describe, expect, it } from "vitest";
import {
	freezeRange,
	nextPeriodStart,
	periodStart,
	calendarSpanDays,
	rangeSpanDays,
	resolveRange,
	rangeWidened,
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

describe("calendarSpanDays", () => {
	const NOW = new Date("2026-10-22T19:00:00Z");
	const days = (spec: Parameters<typeof resolveRange>[0], now = NOW) =>
		calendarSpanDays(spec, resolveRange(spec, now));

	it("counts Pacific calendar days across both DST changes", () => {
		expect(days({ kind: "custom", start: "2026-03-07", end: "2026-03-09" })).toBe(3);
		expect(days({ kind: "custom", start: "2026-10-31", end: "2026-11-02" })).toBe(3);
		expect(days({ kind: "custom", start: "2026-10-27", end: "2026-11-02" })).toBe(7);
		expect(days({ kind: "set", unit: "day", start: "2026-11-01" })).toBe(1);
	});

	it("counts trailing days as calendar days", () => {
		expect(days({ kind: "trailing", amount: 3, unit: "day" })).toBe(3);
		const fall = new Date("2026-11-05T20:00:00Z");
		expect(days({ kind: "trailing", amount: 7, unit: "day" }, fall)).toBe(7);
		expect(days({ kind: "trailing", amount: 92, unit: "day" }, fall)).toBe(92);
	});

	it("uses elapsed hours over 24 for trailing hours", () => {
		expect(days({ kind: "trailing", amount: 24, unit: "hour" })).toBe(1);
		expect(days({ kind: "trailing", amount: 36, unit: "hour" })).toBe(1.5);
	});
});

describe("resolveRange: whole periods", () => {
	const at = new Date("2026-11-18T20:00:00Z");
	const d = (spec: DateRangeSpec, res: Parameters<typeof resolveRange>[2], t = at) => {
		const r = resolveRange(spec, t, res);
		return [r.firstDate, r.lastDate];
	};

	it("widens a custom range to whole months", () => {
		const spec: DateRangeSpec = { kind: "custom", start: "2026-03-15", end: "2026-06-10" };
		expect(d(spec, "month")).toEqual(["2026-03-01", "2026-06-30"]);
		expect(rangeWidened(spec, at, "month")).toBe(true);
		expect(rangeWidened(spec, at, "day")).toBe(false);
	});

	it("makes a trailing 12 months the last 12 calendar months including this one", () => {
		const spec: DateRangeSpec = { kind: "trailing", amount: 12, unit: "month" };
		expect(d(spec, "month")).toEqual(["2025-12-01", "2026-11-30"]);
		expect(rangeWidened(spec, at, "month")).toBe(false);
		expect(resolveRange(spec, at, "month").rolling).toBe(true);
	});

	it("includes December on 2026-12-01 at 01:00 Pacific", () => {
		const t = new Date("2026-12-01T09:00:00Z");
		const spec: DateRangeSpec = { kind: "trailing", amount: 12, unit: "month" };
		expect(d(spec, "month", t)).toEqual(["2026-01-01", "2026-12-31"]);
	});

	it("widens a trailing 30 days to whole months", () => {
		const spec: DateRangeSpec = { kind: "trailing", amount: 30, unit: "day" };
		expect(d(spec, "month")).toEqual(["2026-10-01", "2026-11-30"]);
		expect(rangeWidened(spec, at, "month")).toBe(true);
	});

	it("widens to whole years at yearly", () => {
		const spec: DateRangeSpec = { kind: "custom", start: "2025-06-01", end: "2026-02-01" };
		expect(d(spec, "year")).toEqual(["2025-01-01", "2026-12-31"]);
	});

	it("leaves day and no resolution unchanged", () => {
		const spec: DateRangeSpec = { kind: "custom", start: "2026-03-15", end: "2026-06-10" };
		expect(d(spec, "day")).toEqual(["2026-03-15", "2026-06-10"]);
		expect(d(spec, undefined)).toEqual(["2026-03-15", "2026-06-10"]);
	});

	it("handles the New Year and DST boundaries", () => {
		expect(d({ kind: "custom", start: "2025-12-31", end: "2026-01-01" }, "month")).toEqual([
			"2025-12-01",
			"2026-01-31"
		]);
		const r = resolveRange({ kind: "custom", start: "2026-03-10", end: "2026-03-20" }, at, "month");
		expect([r.firstDate, r.lastDate]).toEqual(["2026-03-01", "2026-03-31"]);
		expect(r.start.toISOString()).toBe("2026-03-01T08:00:00.000Z");
		expect(r.end.toISOString()).toBe("2026-04-01T07:00:00.000Z");
	});
});
