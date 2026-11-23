import { describe, expect, it } from "vitest";
import { needsZoneLabel } from "$lib/format";
import { mapFormat } from "./format";

describe("map format", () => {
	it("shows dates in Pacific time and leaves the zone to zoneLabel", () => {
		expect(mapFormat.dateTime("2026-11-06T00:00:00Z")).toBe("Nov 5, 2026, 4:00 PM");
		expect(mapFormat.zoneLabel()).toBe(needsZoneLabel() ? "PT" : null);
	});

	it("formats numbers with map-sdk's options", () => {
		expect(mapFormat.number(12.345, { maximumFractionDigits: 1 })).toBe("12.3");
	});
});
