import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (original) => ({
	...(await original<typeof import("@sjvair/sdk")>()),
	getRegionSummariesBulkDaily: vi.fn(),
	getRegionSummariesBulkDailyOpen: vi.fn(),
	getRegionSummariesBulkMonthly: vi.fn(),
	getRegionSummariesBulkYearly: vi.fn()
}));

import {
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkDailyOpen,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkYearly,
	type RegionFeature
} from "@sjvair/sdk";
import type { Figure, Level } from "$lib/data/metadata";
import { pacificDay } from "$lib/format";
import { createFillEntry, fillEntry, fillRegionType, fillScale, type FillContext } from "./fill";

const level = (key: string, min: number, max: number | null, tier: number): Level => ({
	key,
	label: key,
	color: null,
	opacity: null,
	tier,
	guidance: "",
	description: "",
	min,
	max
});
const levels = [level("good", 0, 9.1, 0), level("moderate", 9.1, null, 1)];
const figure: Figure = { field: "mean_24h", label: "24-hour average" };
const DAY = "2026-11-09";
const TODAY = "2026-11-12";

const daily = vi.mocked(getRegionSummariesBulkDaily) as unknown as ReturnType<typeof vi.fn>;
const open = vi.mocked(getRegionSummariesBulkDailyOpen) as unknown as ReturnType<typeof vi.fn>;
const monthly = vi.mocked(getRegionSummariesBulkMonthly) as unknown as ReturnType<typeof vi.fn>;
const yearly = vi.mocked(getRegionSummariesBulkYearly) as unknown as ReturnType<typeof vi.fn>;
const signal = new AbortController().signal;

const row = (day: string, mean: number | null, is_final = true) => ({
	timestamp: pacificDay(day).toISOString(),
	is_final,
	mean_24h: mean
});

/** A ZIP code's shape: server id `z<code>`. */
function shape(code: string | null, name = `${code}`): RegionFeature {
	return {
		type: "Feature",
		id: `z${code}`,
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 0]
				]
			]
		},
		properties: {
			id: `z${code}`,
			name,
			slug: name,
			type: "zipcode",
			external_id: code,
			retired: null
		}
	} as RegionFeature;
}

let ctx: FillContext;

beforeEach(() => {
	daily.mockReset();
	open.mockReset();
	monthly.mockReset();
	yearly.mockReset();
	ctx = {
		shapes: vi.fn(async () => [shape("93721"), shape("93722"), shape(null, "No code")]),
		names: async () => (r) => `ZIP ${r.name}`,
		rating: { figure: async () => figure, levels: async () => levels },
		today: () => TODAY
	};
	daily.mockResolvedValue([{ id: "z93721", summaries: [row(DAY, 5)] }]);
	open.mockResolvedValue([{ id: "z93722", summaries: [row(TODAY, 12, false)] }]);
});

describe("fillRegionType", () => {
	const types = [{ type: "zipcode" }, { type: "county" }, { type: "land_use" }];
	it("is the saved type when the directory lists it and the summaries take it", () => {
		expect(fillRegionType("zipcode", types)).toBe("zipcode");
	});
	it("is none for a type the directory doesn't list, land use, none saved, or not loaded", () => {
		expect(fillRegionType("tract", types)).toBeNull();
		expect(fillRegionType("land_use", types)).toBeNull();
		expect(fillRegionType(undefined, types)).toBeNull();
		expect(fillRegionType("zipcode", undefined)).toBeNull();
	});
});

describe("the fill entry", () => {
	it("keys by entry type, region type and day (today on now), hourly", () => {
		const entry = createFillEntry(ctx);
		const day = entry.source({ regionType: "zipcode", entryType: "pm25", at: { day: DAY } });
		const now = entry.source({ regionType: "zipcode", entryType: "pm25", at: "now" });
		expect(day.key).toBe("map-fill:pm25:zipcode:2026-11-09");
		expect(now.key).toBe(`map-fill:pm25:zipcode:today:${TODAY}`);
		expect(day.cadence).toBe("hour");
		expect(now.cadence).toBe("hour");
	});

	it("draws a day's figure per region, ref region:<type>:<code>, named by the type's template", async () => {
		const entry = createFillEntry(ctx);
		const value = await entry
			.source({ regionType: "zipcode", entryType: "pm25", at: { day: DAY } })
			.fetch(signal);
		expect(daily).toHaveBeenCalledWith(
			{ entryType: "pm25", start: DAY, end: DAY, type: "zipcode" },
			{ signal }
		);
		expect(ctx.shapes).toHaveBeenCalledWith("zipcode", signal);
		// A shape with no code is left out: it has no ref.
		expect(value.features.features.map((f) => f.properties)).toEqual([
			{ refKey: "region:zipcode:93721", name: "ZIP 93721", value: 5 },
			// Missing from the summaries: no figure (drawn as no data), never an error.
			{ refKey: "region:zipcode:93722", name: "ZIP 93722", value: null }
		]);
		expect(value.final).toBe(true);
	});

	it("on now reads today's open-day figure so far, and keeps polling", async () => {
		const entry = createFillEntry(ctx);
		const source = entry.source({ regionType: "zipcode", entryType: "pm25", at: "now" });
		const value = await source.fetch(signal);
		expect(open).toHaveBeenCalledWith({ entryType: "pm25", type: "zipcode" }, { signal });
		expect(daily).not.toHaveBeenCalled();
		expect(value.features.features.map((f) => f.properties.value)).toEqual([null, 12]);
		expect(source.poll(value)).toBe(true);
	});

	it("polls a day only while its figures aren't all final", async () => {
		const entry = createFillEntry(ctx);
		const source = entry.source({ regionType: "zipcode", entryType: "pm25", at: { day: DAY } });
		expect(source.poll(undefined)).toBe(true);
		expect(source.poll(await source.fetch(signal))).toBe(false);
		daily.mockResolvedValue([{ id: "z93721", summaries: [row(DAY, 5, false)] }]);
		expect(source.poll(await source.fetch(signal))).toBe(true);
	});

	it("draws a month's figure (the scale's period figure) per region, from the bulk monthly rows", async () => {
		const periodFigure: Figure = { field: "daily_statistic_mean", label: "Average" };
		const resolutions: string[] = [];
		ctx.rating = {
			figure: async (_type, resolution) => {
				resolutions.push(resolution);
				return periodFigure;
			},
			levels: async () => levels
		};
		monthly.mockResolvedValue([
			{
				id: "z93721",
				summaries: [
					{
						timestamp: pacificDay("2026-10-01").toISOString(),
						is_final: true,
						daily_statistic_mean: 12
					}
				]
			}
		]);
		const entry = createFillEntry(ctx);
		const at = { start: "2026-10-01", resolution: "month" } as const;
		const source = entry.source({ regionType: "zipcode", entryType: "pm25", at });
		expect(source.key).toBe("map-fill:pm25:zipcode:month:2026-10-01");
		const value = await source.fetch(signal);
		expect(resolutions).toEqual(["month"]);
		expect(daily).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
		expect(monthly.mock.calls[0][0]).toEqual({
			entryType: "pm25",
			start: "2026-10-01",
			end: "2026-10-31",
			type: "zipcode"
		});
		expect(value.features.features.map((f) => f.properties.value)).toEqual([12, null]);
		expect(source.poll(value)).toBe(false);
	});

	it("marks a month's thin region (too few days had a figure), with its day counts when the row has them", async () => {
		ctx.rating = {
			figure: async () => ({ field: "daily_statistic_mean", label: "Average" }),
			levels: async () => levels
		};
		const start = pacificDay("2026-10-01").toISOString();
		monthly.mockResolvedValue([
			{
				id: "z93721",
				summaries: [
					{
						timestamp: start,
						is_final: true,
						daily_statistic_mean: null,
						daily_statistic_days: 3,
						daily_statistic_expected_days: 31
					}
				]
			},
			{
				id: "z93722",
				summaries: [{ timestamp: start, is_final: true, daily_statistic_mean: null }]
			}
		]);
		const at = { start: "2026-10-01", resolution: "month" } as const;
		const value = await createFillEntry(ctx)
			.source({ regionType: "zipcode", entryType: "pm25", at })
			.fetch(signal);
		const props = value.features.features.map(
			(f) => f.properties as unknown as Record<string, unknown>
		);
		expect(props[0]).toMatchObject({
			value: null,
			thin: true,
			thinDays: { days: 3, expected: 31 }
		});
		expect(props[1]).toMatchObject({ value: null, thin: true });
		expect(props[1].thinDays).toBeUndefined();
	});

	it("leaves a region with a figure, or with no row, unmarked", async () => {
		const value = await createFillEntry(ctx)
			.source({ regionType: "zipcode", entryType: "pm25", at: { day: DAY } })
			.fetch(signal);
		for (const f of value.features.features) expect(f.properties).not.toHaveProperty("thin");
	});

	it("keeps the current year polling while its nightly row isn't final", async () => {
		yearly.mockResolvedValue([
			{
				id: "z93721",
				summaries: [
					{
						timestamp: pacificDay("2026-01-01").toISOString(),
						is_final: false,
						daily_statistic_mean: 7
					}
				]
			}
		]);
		const at = { start: "2026-01-01", resolution: "year" } as const;
		const source = createFillEntry(ctx).source({ regionType: "zipcode", entryType: "pm25", at });
		const value = await source.fetch(signal);
		expect(yearly).toHaveBeenCalledTimes(1);
		expect(value.final).toBe(false);
		expect(source.poll(value)).toBe(true);
	});

	it("draws every region with no figure when the days can't be rated", async () => {
		ctx.rating = { figure: async () => null, levels: async () => levels };
		const value = await createFillEntry(ctx)
			.source({ regionType: "zipcode", entryType: "pm25", at: { day: DAY } })
			.fetch(signal);
		expect(value.features.features.map((f) => f.properties.value)).toEqual([null, null]);
	});

	it("has the pollutant's ScaleRef, as the monitors do (so the legend shares one section)", () => {
		expect(fillScale("pm25")).toEqual({ dataset: "air-quality", entryType: "pm25" });
	});
});

describe("the app's fill entry across Pacific midnight", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keys Now by the Pacific date, not the browser's", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const source = () => fillEntry.source({ regionType: "zipcode", entryType: "pm25", at: "now" });
		// 23:59 Pacific on November 14 (already November 15 in New York or UTC).
		vi.setSystemTime(new Date("2026-11-15T07:59:00Z"));
		expect(source().key).toBe("map-fill:pm25:zipcode:today:2026-11-14");
		// 00:01 Pacific on November 15.
		vi.setSystemTime(new Date("2026-11-15T08:01:00Z"));
		expect(source().key).toBe("map-fill:pm25:zipcode:today:2026-11-15");
	});
});
