import { describe, expect, it } from "vitest";
import {
	formatDateTime,
	formatNumber,
	needsZoneLabel,
	pacificHoursOfDay,
	startOfPacificWeek,
	todayPacific
} from "./index";

describe("format", () => {
	it("todayPacific uses Pacific, not UTC", () => {
		expect(todayPacific(new Date("2026-10-21T06:30:00Z"))).toBe("2026-10-20");
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
});
