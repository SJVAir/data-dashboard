import { describe, expect, test } from "vitest";
import { shownRange } from "./shown-range";

// Noon Pacific, 2026-11-05.
const NOW = new Date("2026-11-05T20:00:00Z");

describe("shownRange", () => {
	test("a range at Daily shows as picked", () => {
		const r = shownRange({ kind: "custom", start: "2026-03-10", end: "2026-04-20" }, NOW, "day");
		expect(r).toMatchObject({ start: "2026-03-10", end: "2026-04-20", soFar: false });
		expect(r.widened).toBe(false);
	});

	test("Monthly widens a past custom range to whole months", () => {
		const r = shownRange({ kind: "custom", start: "2026-03-10", end: "2026-04-20" }, NOW, "month");
		expect(r).toMatchObject({
			start: "2026-03-01",
			end: "2026-04-30",
			soFar: false,
			widened: true
		});
	});

	test("a widened range through this month ends today, so far", () => {
		const r = shownRange({ kind: "custom", start: "2026-09-10", end: "2026-11-03" }, NOW, "month");
		expect(r).toMatchObject({ start: "2026-09-01", end: "2026-11-05", soFar: true, widened: true });
	});

	test("Yearly through this year ends today, so far", () => {
		const r = shownRange({ kind: "trailing", amount: 90, unit: "day" }, NOW, "year");
		expect(r).toMatchObject({ start: "2026-01-01", end: "2026-11-05", soFar: true, widened: true });
	});

	test("Last 12 months at Monthly isn't widened, but its current month is so far", () => {
		const r = shownRange({ kind: "trailing", amount: 12, unit: "month" }, NOW, "month");
		expect(r).toMatchObject({
			start: "2025-12-01",
			end: "2026-11-05",
			soFar: true,
			widened: false
		});
	});
});
