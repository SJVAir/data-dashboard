import { describe, expect, it } from "vitest";
import { periodKey, periodLabel, periodListed, periodOfStop } from "./use-period";

describe("use period", () => {
	it("periodKey names a year or a month of it", () => {
		expect(periodKey({ year: 2023, month: null })).toBe("2023");
		expect(periodKey({ year: 2023, month: 7 })).toBe("2023-07");
	});
	it("periodOfStop reads a month or year stop's start; a day or Now has none", () => {
		expect(periodOfStop({ start: "2023-07-01", resolution: "month" })).toEqual({
			year: 2023,
			month: 7
		});
		expect(periodOfStop({ start: "2023-01-01", resolution: "year" })).toEqual({
			year: 2023,
			month: null
		});
		expect(periodOfStop({ day: "2023-07-04" })).toBeNull();
		expect(periodOfStop("now")).toBeNull();
	});
	it("periodListed is false for a year not in years", () => {
		expect(periodListed({ year: 2023, month: null }, [2022, 2023])).toBe(true);
		expect(periodListed({ year: 2021, month: 3 }, [2022, 2023])).toBe(false);
	});
	it("labels a year and a month", () => {
		expect(periodLabel({ year: 2023, month: null })).toBe("2023");
		expect(periodLabel({ year: 2023, month: 7 })).toBe("July 2023");
	});
});
