import { describe, expect, test } from "vitest";
import type { EntryTypeMeta } from "$lib/data/metadata";
import type { DateRangeSpec } from "$lib/data/schema";
import { detailChoices } from "./resolution-offer";

const NOW = new Date("2026-11-05T20:00:00Z");

function entry(resolutions: EntryTypeMeta["resolutions"]): EntryTypeMeta {
	return {
		id: "pm25",
		label: "PM2.5",
		units: "µg/m³",
		kind: "pollutant",
		resolutions,
		precision: null,
		yMin: null
	};
}

const ALL = entry(["raw", "hour", "day", "month", "quarter", "year"]);

/** A custom range of `days` whole Pacific days, ending 2026-11-01. */
function days(n: number): DateRangeSpec {
	const start = new Date(Date.UTC(2026, 10, 1) - (n - 1) * 86_400_000).toISOString().slice(0, 10);
	return { kind: "custom", start, end: "2026-11-01" };
}

const blocked = (choices: ReturnType<typeof detailChoices>, level: string) =>
	choices?.find((c) => c.level === level)?.blocked;

describe("detailChoices", () => {
	test("a pinned type hides the control", () => {
		expect(detailChoices(ALL, days(30), 1, "day", NOW)).toBeNull();
	});

	test("Automatic first, then the offered levels among raw, hourly, daily and monthly", () => {
		expect(detailChoices(ALL, days(7), 1, undefined, NOW)?.map((c) => c.level)).toEqual([
			"auto",
			"raw",
			"hour",
			"day",
			"month"
		]);
		expect(
			detailChoices(entry(["hour", "day"]), days(7), 1, undefined, NOW)?.map((c) => c.level)
		).toEqual(["auto", "hour", "day"]);
	});

	test("raw and hourly are served up to 31 days", () => {
		const ok = detailChoices(ALL, days(31), 1, undefined, NOW);
		expect(blocked(ok, "raw")).toBeNull();
		expect(blocked(ok, "hour")).toBeNull();
		const over = detailChoices(ALL, days(32), 1, undefined, NOW);
		expect(blocked(over, "raw")).toBe("server-limit");
		expect(blocked(over, "hour")).toBe("server-limit");
		expect(blocked(over, "auto")).toBeNull();
	});

	test("daily and monthly are never over the server limit (requests are chunked)", () => {
		const long = detailChoices(ALL, days(3650), 1, undefined, NOW);
		expect(blocked(long, "day")).toBeNull();
		expect(blocked(long, "month")).toBeNull();
	});

	test("more than 50 000 points (places × periods) is too many", () => {
		// 31 days of hours is 744 periods: 67 places is 49 848 points, 68 is 50 592.
		expect(blocked(detailChoices(ALL, days(31), 67, undefined, NOW), "hour")).toBeNull();
		expect(blocked(detailChoices(ALL, days(31), 68, undefined, NOW), "hour")).toBe(
			"too-many-points"
		);
		// Raw counts a reading every two minutes: a month at three places is too many.
		expect(blocked(detailChoices(ALL, days(31), 1, undefined, NOW), "raw")).toBeNull();
		expect(blocked(detailChoices(ALL, days(31), 3, undefined, NOW), "raw")).toBe("too-many-points");
		// Ten years of days at ten places is fine.
		expect(blocked(detailChoices(ALL, days(3650), 10, undefined, NOW), "day")).toBeNull();
	});

	test("rolling ranges are measured as they resolve now", () => {
		const last90: DateRangeSpec = { kind: "trailing", amount: 90, unit: "day" };
		expect(blocked(detailChoices(ALL, last90, 1, undefined, NOW), "raw")).toBe("server-limit");
		const last24: DateRangeSpec = { kind: "trailing", amount: 24, unit: "hour" };
		expect(blocked(detailChoices(ALL, last24, 1, undefined, NOW), "raw")).toBeNull();
	});
});
