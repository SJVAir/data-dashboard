import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "./types";
import { worstHours } from "./worst-hour";

const HOUR = 3_600_000;

function hour(t: number, mean: number): SeriesPoint {
	return { t, mean, min: mean, max: mean, count: 1, partial: false };
}

describe("worstHours", () => {
	it("picks the highest hourly mean per Pacific day with its hour", () => {
		const day1 = Date.parse("2026-10-20T07:00:00Z");
		const day2 = day1 + 24 * HOUR;
		const result = worstHours([
			hour(day1, 5),
			hour(day1 + 3 * HOUR, 40),
			hour(day1 + 9 * HOUR, 12),
			hour(day2 + HOUR, 7)
		]);
		expect(result.get(day1)).toEqual({ t: day1 + 3 * HOUR, value: 40 });
		expect(result.get(day2)).toEqual({ t: day2 + HOUR, value: 7 });
		expect(result.size).toBe(2);
	});

	it("the earliest hour wins a tie", () => {
		const day = Date.parse("2026-10-20T07:00:00Z");
		const result = worstHours([hour(day + 5 * HOUR, 9), hour(day + 2 * HOUR, 9)]);
		expect(result.get(day)).toEqual({ t: day + 2 * HOUR, value: 9 });
	});

	it("groups the 23-hour day of 2026-03-08 by Pacific day", () => {
		const start = Date.parse("2026-03-08T08:00:00Z");
		const hours = Array.from({ length: 23 }, (_, i) => hour(start + i * HOUR, i === 22 ? 99 : 1));
		// The next Pacific day starts 23 hours later (PDT).
		const next = start + 23 * HOUR;
		const result = worstHours([...hours, hour(next, 3)]);
		expect([...result.keys()]).toEqual([start, next]);
		expect(result.get(start)).toEqual({ t: start + 22 * HOUR, value: 99 });
	});

	it("keeps both 1 AM hours of 2026-11-01 in that day", () => {
		const start = Date.parse("2026-11-01T07:00:00Z");
		const hours = Array.from({ length: 25 }, (_, i) => hour(start + i * HOUR, i === 2 ? 50 : 1));
		const next = start + 25 * HOUR;
		const result = worstHours([...hours, hour(next, 3)]);
		expect([...result.keys()]).toEqual([start, next]);
		expect(result.get(start)).toEqual({ t: start + 2 * HOUR, value: 50 });
	});

	it("has no entry for a day with no hours", () => {
		const day = Date.parse("2026-10-20T07:00:00Z");
		const result = worstHours([hour(day, 5), hour(day + 48 * HOUR, 6)]);
		expect(result.has(day + 24 * HOUR)).toBe(false);
		expect(worstHours([]).size).toBe(0);
	});
});
