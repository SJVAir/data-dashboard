import { describe, expect, it } from "vitest";
import { parsePeriod, periodKey, periodLabel, periodListed } from "./use-period";

describe("use period", () => {
	it("parsePeriod and periodKey round-trip", () => {
		expect(parsePeriod("2023")).toEqual({ year: 2023, month: null });
		expect(parsePeriod("2023-07")).toEqual({ year: 2023, month: 7 });
		expect(periodKey({ year: 2023, month: null })).toBe("2023");
		expect(periodKey({ year: 2023, month: 7 })).toBe("2023-07");
		expect(parsePeriod("2023-13")).toBeNull();
		expect(parsePeriod(undefined)).toBeNull();
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
