import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import {
	formatDate,
	formatDateTime,
	formatNumber,
	needsZoneLabel,
	pacificHoursOfDay,
	pacificWallTime,
	parseDateKey,
	startOfPacificWeek,
	todayPacific
} from "./index";

describe("format", () => {
	it("todayPacific uses Pacific, not UTC", () => {
		expect(todayPacific(new Date("2026-10-21T06:30:00Z"))).toBe("2026-10-20");
	});
	it("pacificWallTime gives Pacific wall time without an offset", () => {
		expect(pacificWallTime(new Date("2026-10-22T19:00:05Z"))).toBe("2026-10-22 12:00:05");
		expect(pacificWallTime(new Date("2026-01-01T07:59:59Z"))).toBe("2025-12-31 23:59:59");
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
});
