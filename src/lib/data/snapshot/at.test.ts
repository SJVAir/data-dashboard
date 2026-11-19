import { describe, expect, it } from "vitest";
import { atKey, atOfKey, isPeriodAt } from "./at";
import { periodEnd, periodHolds } from "./period";

describe("snapshot times", () => {
	it("round-trips now, a day, a month and a year through their keys", () => {
		const times = [
			"now",
			{ day: "2026-11-10" },
			{ start: "2026-11-01", resolution: "month" },
			{ start: "2026-01-01", resolution: "year" }
		] as const;
		expect(times.map(atKey)).toEqual(["now", "2026-11-10", "month:2026-11-01", "year:2026-01-01"]);
		for (const at of times) expect(atOfKey(atKey(at))).toEqual(at);
	});

	it("tells a month or year stop from now and a day", () => {
		expect(isPeriodAt("now")).toBe(false);
		expect(isPeriodAt({ day: "2026-11-10" })).toBe(false);
		expect(isPeriodAt({ start: "2026-11-01", resolution: "month" })).toBe(true);
	});

	it("ends a month on its last day and a year on December 31st", () => {
		expect(periodEnd({ start: "2026-02-01", resolution: "month" })).toBe("2026-02-28");
		expect(periodEnd({ start: "2024-02-01", resolution: "month" })).toBe("2024-02-29");
		expect(periodEnd({ start: "2026-10-01", resolution: "month" })).toBe("2026-10-31");
		expect(periodEnd({ start: "2026-01-01", resolution: "year" })).toBe("2026-12-31");
	});

	it("knows the current month or year (it holds today)", () => {
		const nov = { start: "2026-11-01", resolution: "month" } as const;
		expect(periodHolds(nov, "2026-11-01")).toBe(true);
		expect(periodHolds(nov, "2026-11-30")).toBe(true);
		expect(periodHolds(nov, "2026-12-01")).toBe(false);
		expect(periodHolds({ start: "2026-01-01", resolution: "year" }, "2026-11-19")).toBe(true);
	});
});
