import { describe, expect, it } from "vitest";
import { pacificDay } from "$lib/format";
import { resolveRange } from "$lib/format/range";
import {
	openStop,
	periodStops,
	stepKey,
	stopLabel,
	stopOption,
	stopsOverCap,
	type Stop
} from "./days";

const day = (d: string): Stop => ({ at: d });
const dayStops = (range: Parameters<typeof periodStops>[0], today: string) =>
	periodStops(range, "day", today);

describe("periodStops at Daily", () => {
	it("gives one stop per day of a past custom range, no now", () => {
		expect(
			dayStops({ kind: "custom", start: "2026-09-07", end: "2026-09-09" }, "2026-11-15")
		).toEqual([day("2026-09-07"), day("2026-09-08"), day("2026-09-09")]);
	});

	it("ends a trailing range with now", () => {
		const today = "2026-11-15";
		const spec = { kind: "trailing", amount: 7, unit: "day" } as const;
		const r = resolveRange(spec, pacificDay(today, 12));
		expect(r.lastDate).toBe(today);
		expect(r.firstDate).toBe("2026-11-09");
		expect(dayStops(spec, today)).toEqual([
			day("2026-11-09"),
			day("2026-11-10"),
			day("2026-11-11"),
			day("2026-11-12"),
			day("2026-11-13"),
			day("2026-11-14"),
			"now"
		]);
	});

	it("is just now for a to-date range on its first day", () => {
		expect(dayStops({ kind: "to-date", unit: "month" }, "2026-11-01")).toEqual(["now"]);
	});

	it("never includes days after today", () => {
		expect(
			dayStops({ kind: "custom", start: "2026-11-20", end: "2026-11-25" }, "2026-11-15")
		).toEqual([]);
		expect(
			dayStops({ kind: "custom", start: "2026-11-13", end: "2026-11-20" }, "2026-11-15")
		).toEqual([day("2026-11-13"), day("2026-11-14"), "now"]);
	});

	it("steps one calendar day across the November DST change", () => {
		expect(
			dayStops({ kind: "custom", start: "2026-10-30", end: "2026-11-03" }, "2026-11-15")
		).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map(day));
		expect(dayStops({ kind: "trailing", amount: 3, unit: "day" }, "2026-11-02")).toEqual([
			day("2026-10-31"),
			day("2026-11-01"),
			"now"
		]);
	});
});

describe("periodStops at Monthly and Yearly", () => {
	it("gives each month's first day for Mar-Jun 2026", () => {
		expect(
			periodStops({ kind: "custom", start: "2026-03-10", end: "2026-06-20" }, "month", "2026-11-18")
		).toEqual([
			{ at: "2026-03-01" },
			{ at: "2026-04-01" },
			{ at: "2026-05-01" },
			{ at: "2026-06-01" }
		]);
	});

	it("gives each year's first day for 2024-2026, the current year last and so far", () => {
		expect(
			periodStops({ kind: "custom", start: "2024-02-01", end: "2026-12-31" }, "year", "2026-11-18")
		).toEqual([{ at: "2024-01-01" }, { at: "2025-01-01" }, { at: "2026-01-01", soFar: true }]);
	});

	it("ends a range reaching today with the current month, so far, and no now", () => {
		expect(periodStops({ kind: "to-date", unit: "year" }, "month", "2026-03-05")).toEqual([
			{ at: "2026-01-01" },
			{ at: "2026-02-01" },
			{ at: "2026-03-01", soFar: true }
		]);
	});

	it("never includes months after today", () => {
		expect(
			periodStops({ kind: "custom", start: "2026-10-01", end: "2027-02-01" }, "month", "2026-11-18")
		).toEqual([{ at: "2026-10-01" }, { at: "2026-11-01", soFar: true }]);
	});

	it("steps by day below Daily", () => {
		const range = { kind: "custom", start: "2026-09-07", end: "2026-09-08" } as const;
		expect(periodStops(range, "hour", "2026-11-15")).toEqual(
			periodStops(range, "day", "2026-11-15")
		);
	});
});

describe("stopsOverCap", () => {
	it("counts stops, not days: 30 months at Monthly is allowed, 30 months at Daily is not", () => {
		const range = { kind: "custom", start: "2024-01-01", end: "2026-06-30" } as const;
		const now = pacificDay("2026-11-18", 12);
		expect(stopsOverCap(range, "month", now)).toBe(false);
		expect(stopsOverCap(range, "day", now)).toBe(true);
	});

	it("checks the widened range: 366 days at Daily, more is over", () => {
		const now = pacificDay("2026-11-18", 12);
		expect(
			stopsOverCap({ kind: "custom", start: "2024-01-01", end: "2024-12-31" }, "day", now)
		).toBe(false);
		expect(
			stopsOverCap({ kind: "custom", start: "2024-01-01", end: "2025-01-01" }, "day", now)
		).toBe(true);
	});
});

describe("stopLabel", () => {
	it("labels a day, a month, a year and now through format", () => {
		expect(stopLabel({ at: "2026-11-10" }, "day")).toBe("Tuesday, November 10, 2026");
		expect(stopLabel({ at: "2026-03-01" }, "month")).toBe("March 2026");
		expect(stopLabel({ at: "2025-01-01" }, "year")).toBe("2025");
		expect(stopLabel("now", "day")).toBe("Now");
	});

	it("labels the current period so far", () => {
		expect(stopLabel({ at: "2026-11-01", soFar: true }, "month")).toBe("November 2026 so far");
		expect(stopLabel({ at: "2026-01-01", soFar: true }, "year")).toBe("2026 so far");
	});
});

describe("openStop", () => {
	const stops = dayStops({ kind: "custom", start: "2026-09-07", end: "2026-09-09" }, "2026-11-15");
	it("opens the saved day when it is a stop", () => {
		expect(openStop("2026-09-08", stops)).toEqual(day("2026-09-08"));
	});
	it("opens the last stop otherwise", () => {
		expect(openStop("2026-08-01", stops)).toEqual(day("2026-09-09"));
		expect(openStop(undefined, stops)).toEqual(day("2026-09-09"));
		expect(openStop("2026-13-45", stops)).toEqual(day("2026-09-09"));
		expect(openStop("now", stops)).toEqual(day("2026-09-09"));
		expect(openStop("garbage", stops)).toEqual(day("2026-09-09"));
	});
	it("opens now as the last stop of a range reaching today", () => {
		const rolling = dayStops({ kind: "trailing", amount: 3, unit: "day" }, "2026-11-15");
		expect(openStop(undefined, rolling)).toBe("now");
	});
	it("is null with no stops", () => {
		expect(openStop(undefined, [])).toBeNull();
		expect(openStop("2026-09-08", [])).toBeNull();
	});
});

describe("stopOption", () => {
	const stops = dayStops({ kind: "custom", start: "2026-09-07", end: "2026-09-09" }, "2026-11-15");
	it("stores the last stop as missing", () => {
		expect(stopOption(stops[2], stops)).toBeUndefined();
	});
	it("stores another stop as its date", () => {
		expect(stopOption(stops[0], stops)).toBe("2026-09-07");
	});
	it("stores now as missing when it is the last stop", () => {
		const rolling = dayStops({ kind: "trailing", amount: 2, unit: "day" }, "2026-11-15");
		expect(stopOption("now", rolling)).toBeUndefined();
		expect(stopOption(rolling[0], rolling)).toBe("2026-11-14");
	});
});

describe("stepKey", () => {
	it("handles no key when there are no stops", () => {
		expect(stepKey("ArrowLeft", 0, 0)).toBeNull();
		expect(stepKey("End", 0, 0)).toBeNull();
	});
	it("moves by one", () => {
		expect(stepKey("ArrowLeft", 3, 10)).toBe(2);
		expect(stepKey("ArrowDown", 3, 10)).toBe(2);
		expect(stepKey("ArrowRight", 3, 10)).toBe(4);
		expect(stepKey("ArrowUp", 3, 10)).toBe(4);
	});
	it("moves by seven", () => {
		expect(stepKey("PageDown", 9, 20)).toBe(2);
		expect(stepKey("PageUp", 9, 20)).toBe(16);
	});
	it("moves a page of the given size", () => {
		expect(stepKey("PageDown", 20, 40, 12)).toBe(8);
		expect(stepKey("PageUp", 20, 40, 12)).toBe(32);
	});
	it("jumps to the ends", () => {
		expect(stepKey("Home", 5, 10)).toBe(0);
		expect(stepKey("End", 5, 10)).toBe(9);
	});
	it("clamps at both ends", () => {
		expect(stepKey("ArrowLeft", 0, 10)).toBe(0);
		expect(stepKey("ArrowDown", 0, 10)).toBe(0);
		expect(stepKey("PageDown", 3, 10)).toBe(0);
		expect(stepKey("ArrowRight", 9, 10)).toBe(9);
		expect(stepKey("ArrowUp", 9, 10)).toBe(9);
		expect(stepKey("PageUp", 5, 10)).toBe(9);
	});
	it("returns null for other keys", () => {
		expect(stepKey("a", 3, 10)).toBeNull();
		expect(stepKey("Enter", 3, 10)).toBeNull();
	});
});
