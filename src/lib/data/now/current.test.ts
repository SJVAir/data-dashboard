import { describe, expect, it } from "vitest";
import type { Level } from "../metadata";
import type { PlaceInfo, QueryData, SeriesPoint } from "../types";
import { CURRENT_RANGE, STALE_MS, currentInput, hourlyReading, trend } from "./current";

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 8, 12);

const levels: Level[] = [
	{
		key: "good",
		label: "Good",
		color: null,
		opacity: null,
		tier: 0,
		guidance: "",
		description: "",
		min: 0,
		max: 12
	},
	{
		key: "mod",
		label: "Moderate",
		color: null,
		opacity: null,
		tier: 1,
		guidance: "",
		description: "",
		min: 12,
		max: null
	}
];

function point(hours: number, mean: number, partial = false): SeriesPoint {
	return { t: T0 + hours * HOUR, mean, min: mean, max: mean, count: 1, partial };
}

function data(points: SeriesPoint[], places?: PlaceInfo[]): QueryData {
	return {
		series: [{ place: "region:county:fresno", points }],
		places: places ?? [{ place: "region:county:fresno", name: "Fresno" }],
		resolution: "hour",
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
}

describe("currentInput", () => {
	it("pins the hour over the current range", () => {
		const layer = { dataset: "monitors", entryType: "pm25", place: { source: "x", code: "y" } };
		const input = currentInput(layer as never);
		expect(input.pin).toBe("hour");
		expect(input.dateRange).toEqual(CURRENT_RANGE);
		expect(input.layer).toBe(layer);
	});
});

describe("hourlyReading", () => {
	it("reads the latest complete hour with the hour before it as previous", () => {
		const d = data([point(0, 5), point(1, 8), point(2, 14)]);
		const now = new Date(T0 + 3 * HOUR + 5 * 60 * 1000);
		const r = hourlyReading(d, levels, now, 1);
		expect(r).toMatchObject({
			status: "ok",
			value: 14,
			at: T0 + 3 * HOUR,
			trend: "rising",
			source: "hourly"
		});
		if (r.status === "ok") expect(r.level?.key).toBe("mod");
	});

	it("skips a partial hour", () => {
		const d = data([point(0, 5), point(1, 8), point(2, 30, true)]);
		const r = hourlyReading(d, levels, new Date(T0 + 2.5 * HOUR), 1);
		expect(r).toMatchObject({ status: "ok", value: 8, at: T0 + 2 * HOUR, trend: "rising" });
	});

	it("has no trend with one point, or when the hour before is missing", () => {
		const now = new Date(T0 + 2 * HOUR);
		expect(hourlyReading(data([point(1, 8)]), levels, now, 1)).toMatchObject({ trend: null });
		expect(hourlyReading(data([point(-3, 8), point(1, 8)]), levels, now, 1)).toMatchObject({
			trend: null
		});
	});

	it("is no-recent when the latest hour ended over STALE_MS ago", () => {
		const d = data([point(0, 5)]);
		const end = T0 + HOUR;
		expect(hourlyReading(d, levels, new Date(end + STALE_MS), 1).status).toBe("ok");
		expect(hourlyReading(d, levels, new Date(end + STALE_MS + 1), 1)).toMatchObject({
			status: "no-recent",
			place: { name: "Fresno" }
		});
	});

	it("is no-data without a complete point", () => {
		const now = new Date(T0);
		expect(hourlyReading(data([]), levels, now, 1).status).toBe("no-data");
		expect(hourlyReading(data([point(0, 5, true)]), levels, now, 1).status).toBe("no-data");
		expect(hourlyReading({ ...data([]), series: [] }, levels, now, 1).status).toBe("no-data");
	});

	it("keeps a school's fallback via in place", () => {
		const place: PlaceInfo = {
			place: "region:zip:93721",
			name: "93721",
			via: { kind: "location", source: "s", code: "c", name: "Roosevelt High" }
		};
		const r = hourlyReading(data([point(0, 5)], [place]), levels, new Date(T0 + 2 * HOUR), 1);
		expect(r).toMatchObject({ status: "ok", place: { via: { name: "Roosevelt High" } } });
	});
});

describe("trend", () => {
	it("is null without a previous value", () => {
		expect(trend(5, null, 1)).toBeNull();
	});
	it("is steady when equal at the precision", () => {
		expect(trend(28.44, 28.41, 1)).toBe("steady");
		expect(trend(5.4, 5.2, null)).toBe("steady");
	});
	it("rises and falls", () => {
		expect(trend(28.6, 28.4, 1)).toBe("rising");
		expect(trend(28.4, 28.6, 1)).toBe("falling");
	});
});
