import { describe, expect, it } from "vitest";
import type { DateRangeSpec } from "$lib/data/schema";
import type { PlaceInfo } from "$lib/data/types";
import { m } from "$lib/paraglide/messages.js";
import { dataTitle, rangeLabel } from "./title";

describe("rangeLabel", () => {
	const cases: [DateRangeSpec, string][] = [
		[{ kind: "set", unit: "year", start: "2026-01-01" }, "2026"],
		[{ kind: "set", unit: "month", start: "2026-10-01" }, "October 2026"],
		// A week is named by its first day (Sunday), whatever day the spec stores.
		[{ kind: "set", unit: "week", start: "2026-10-07" }, "Week of Oct 4, 2026"],
		[{ kind: "set", unit: "day", start: "2026-10-04" }, "Oct 4, 2026"],
		// January 1 is a Pacific date, not shifted to December 31 by UTC.
		[{ kind: "set", unit: "day", start: "2026-01-01" }, "Jan 1, 2026"],
		[{ kind: "set", unit: "month", start: "2026-01-01" }, "January 2026"],
		[{ kind: "to-date", unit: "year" }, "This year so far"],
		[{ kind: "to-date", unit: "month" }, "This month so far"],
		[{ kind: "to-date", unit: "week" }, "This week so far"],
		[{ kind: "trailing", amount: 24, unit: "hour" }, "Last 24 hours"],
		[{ kind: "trailing", amount: 1, unit: "hour" }, "Last hour"],
		[{ kind: "trailing", amount: 3, unit: "day" }, "Last 3 days"],
		[{ kind: "trailing", amount: 7, unit: "day" }, "Last 7 days"],
		[{ kind: "trailing", amount: 30, unit: "day" }, "Last 30 days"],
		[{ kind: "trailing", amount: 90, unit: "day" }, "Last 90 days"],
		[{ kind: "trailing", amount: 1, unit: "day" }, "Today"],
		[{ kind: "trailing", amount: 12, unit: "month" }, "Last 12 months"],
		[{ kind: "trailing", amount: 1, unit: "month" }, "Past month"],
		[{ kind: "trailing", amount: 1500, unit: "day" }, "Last 1,500 days"],
		[{ kind: "custom", start: "2026-10-01", end: "2026-10-14" }, "Oct 1\u2009–\u200914, 2026"],
		[
			{ kind: "custom", start: "2025-12-20", end: "2026-01-03" },
			"Dec 20, 2025\u2009–\u2009Jan 3, 2026"
		],
		[{ kind: "custom", start: "2026-10-01", end: "2026-10-01" }, "Oct 1, 2026"]
	];
	// Intl puts thin spaces around a range's dash.
	it.each(cases)("%j → %s", (spec, label) => {
		expect(rangeLabel(spec)).toBe(label);
	});

	it("words each shape with one message", () => {
		expect(rangeLabel({ kind: "trailing", amount: 30, unit: "day" })).toBe(
			m.range_trailing_day({ count: "30", countValue: 30 })
		);
		expect(rangeLabel({ kind: "set", unit: "week", start: "2026-10-04" })).toBe(
			m.range_set_week({ date: "Oct 4, 2026" })
		);
	});
});

describe("dataTitle", () => {
	const fresno: PlaceInfo = { place: "region:county:06019", name: "Fresno County" };
	const range: DateRangeSpec = { kind: "trailing", amount: 30, unit: "day" };

	it("names one place", () => {
		expect(dataTitle({ entryLabel: "PM2.5", places: [fresno], range })).toBe(
			"PM2.5 · Fresno County · Last 30 days"
		);
	});

	it("counts several places", () => {
		const places: PlaceInfo[] = [
			fresno,
			{ place: "region:county:06029", name: "Kern County" },
			{ place: "region:county:06107", name: "Tulare County" }
		];
		expect(dataTitle({ entryLabel: "PM2.5", places, range })).toBe(
			"PM2.5 · 3 places · Last 30 days"
		);
		expect(dataTitle({ entryLabel: "PM2.5", places, range })).toBe(
			m.widget_title_places({
				entry: "PM2.5",
				count: "3",
				countValue: 3,
				range: "Last 30 days"
			})
		);
	});

	it("leaves the place out when there is none", () => {
		expect(
			dataTitle({ entryLabel: "Ozone", places: [], range: { kind: "to-date", unit: "month" } })
		).toBe("Ozone · This month so far");
	});
});
