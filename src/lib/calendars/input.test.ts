import { describe, expect, it } from "vitest";
import type { WidgetDataConfig } from "$lib/data/schema";
import { calendarInput, isCalendarType, MONTH_CALENDAR_TYPE } from "./input";

const data: WidgetDataConfig = {
	timeSubRange: { start: "06:00", end: "09:00" } as never,
	layers: [
		{
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "region", type: "city", code: "fresno" }
		}
	]
};

describe("calendarInput", () => {
	it("pins days, drops the sub-range and never asks for worst hours", () => {
		const input = calendarInput(data, undefined)!;
		expect(input.pin).toBe("day");
		expect(input.timeSubRange).toBeUndefined();
		expect(input.worstHour).toBeUndefined();
		expect(input.layer.entryType).toBe("pm25");
	});
	it("uses the widget's range, else the type's default", () => {
		const range = { kind: "to-date", unit: "year" } as const;
		expect(calendarInput({ ...data, dateRange: range }, undefined)!.dateRange).toEqual(range);
		expect(calendarInput(data, undefined)!.dateRange).toBeDefined();
	});
	it("is null without a place", () => {
		expect(
			calendarInput({ layers: [{ ...data.layers[0], place: undefined }] }, undefined)
		).toBeNull();
	});
	it("names the two types", () => {
		expect(isCalendarType(MONTH_CALENDAR_TYPE)).toBe(true);
		expect(isCalendarType("chart")).toBe(false);
	});
});
