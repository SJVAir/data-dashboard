import { describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import { periodLegendUnits, thinDetail } from "./thin-detail";

const base = { refKey: "region:county:019", name: "Fresno", value: null };

describe("thinDetail", () => {
	it("says why a thin stop has no figure: a day, or a month's or year's day counts", () => {
		const thin = { ...base, thin: true as const };
		const counted = { ...thin, thinDays: { days: 3, expected: 31 } };
		expect(thinDetail(thin, "day")).toBe("Not enough data");
		expect(thinDetail(counted, "month")).toBe("Only 3 of 31 days had a figure");
		expect(thinDetail(thin, "year")).toBe(m.map_period_too_few_days());
	});

	it("gives none when the feature isn't thin", () => {
		expect(thinDetail(base, "month")).toBeUndefined();
		expect(thinDetail({ ...base, value: 5 }, "day")).toBeUndefined();
	});
});

describe("periodLegendUnits", () => {
	const figure = "Average of 24-hour averages";
	it("names the units and figure on a Monthly or Yearly stop", () => {
		expect(periodLegendUnits({ onDay: true, resolution: "month", figure, units: "µg/m³" })).toBe(
			"µg/m³ · Average of 24-hour averages"
		);
		expect(periodLegendUnits({ onDay: true, resolution: "year", figure, units: "" })).toBe(figure);
	});

	it("gives none on a day, on now, or with no figure named", () => {
		expect(
			periodLegendUnits({ onDay: true, resolution: "day", figure, units: "µg/m³" })
		).toBeUndefined();
		expect(
			periodLegendUnits({ onDay: false, resolution: "month", figure, units: "µg/m³" })
		).toBeUndefined();
		expect(
			periodLegendUnits({ onDay: true, resolution: "month", figure: undefined, units: "µg/m³" })
		).toBeUndefined();
	});
});
