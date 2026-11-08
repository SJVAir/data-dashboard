import { describe, expect, it } from "vitest";
import { periodLabel, seriesLabel } from "./period-label";

describe("periodLabel", () => {
	it("a summed layer's period is a total at every level", () => {
		expect(
			(["hour", "day", "month", "quarter", "season", "year"] as const).map((r) =>
				periodLabel(r, "sum")
			)
		).toEqual([
			"Hourly total",
			"Daily total",
			"Monthly total",
			"Quarterly total",
			"Seasonal total",
			"Yearly total"
		]);
	});

	it("an averaged layer's period is an average, never a total", () => {
		expect(periodLabel("day", "mean")).toBe("Daily average");
		expect(periodLabel("year", "mean")).toBe("Yearly average");
	});

	it("values that never roll up have no period word; the entry type names them", () => {
		expect(periodLabel("day", null)).toBeNull();
		expect(seriesLabel("day", null, "Wind direction")).toBe("Wind direction");
		expect(seriesLabel("day", "sum", "Precipitation")).toBe("Daily total");
	});

	it("raw rows are measurements", () => {
		expect(periodLabel("raw", "sum")).toBe("Measurements");
		expect(periodLabel("raw", null)).toBe("Measurements");
	});
});
