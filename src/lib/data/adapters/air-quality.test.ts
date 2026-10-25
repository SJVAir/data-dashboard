import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getMonitorEntries: vi.fn(),
	getMonitorSummariesHourly: vi.fn(),
	getMonitorSummariesDaily: vi.fn(),
	getMonitorSummariesMonthly: vi.fn(),
	getMonitorSummariesQuarterly: vi.fn(),
	getMonitorSummariesSeasonal: vi.fn(),
	getMonitorSummariesYearly: vi.fn(),
	getMonitorSummariesBulkHourly: vi.fn(),
	getMonitorSummariesBulkDaily: vi.fn(),
	getMonitorSummariesBulkMonthly: vi.fn(),
	getMonitorSummariesBulkQuarterly: vi.fn(),
	getMonitorSummariesBulkSeasonal: vi.fn(),
	getMonitorSummariesBulkYearly: vi.fn(),
	getRegionSummariesBulkHourly: vi.fn(),
	getRegionSummariesBulkDaily: vi.fn(),
	getRegionSummariesBulkMonthly: vi.fn(),
	getRegionSummariesBulkQuarterly: vi.fn(),
	getRegionSummariesBulkSeasonal: vi.fn(),
	getRegionSummariesBulkYearly: vi.fn()
}));

import {
	getMonitorEntries,
	getMonitorSummariesBulkDaily,
	getMonitorSummariesDaily,
	getMonitorSummariesHourly,
	getMonitorSummariesMonthly,
	getRegionSummariesBulkDaily
} from "@sjvair/sdk";
import { getValidDateRange } from "@sjvair/sdk/datetime";
import { resolveRange } from "$lib/format/range";
import type { DateRangeSpec, Resolution } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import type { Target } from "../types";
import { airQualityAdapter } from "./air-quality";
import type { AdapterContext, AdapterRequest, RegionResolver } from "./registry";

const NOW = new Date("2026-10-22T19:00:00Z");
const ALL: Resolution[] = ["raw", "hour", "day", "month", "quarter", "season", "year"];

/** A stand-in resolver for two California counties. */
const regions: RegionResolver = {
	resolve: async (type, code) =>
		type === "county" ? ({ "06019": "sq1", "06039": "sq2" } as Record<string, string>)[code] : null
};

const ctx: AdapterContext = { metadata: fixtureMetadata(), regions };

function request(
	target: Target,
	resolution: Resolution,
	spec: DateRangeSpec,
	opts: {
		entryType?: string;
		downsampleFromRaw?: boolean;
		offered?: Resolution[];
		now?: Date;
	} = {}
): AdapterRequest {
	const now = opts.now ?? NOW;
	return {
		entryType: opts.entryType ?? "pm25",
		target,
		resolution,
		downsampleFromRaw: opts.downsampleFromRaw ?? false,
		range: resolveRange(spec, now),
		offered: opts.offered ?? ALL,
		now
	};
}

/** A summary row as the server returns it; only the fields the adapter reads matter. */
function row(timestamp: string, mean: number, count = 1) {
	return { timestamp, mean, minimum: mean, maximum: mean, count };
}

const SEPTEMBER: DateRangeSpec = { kind: "custom", start: "2026-09-01", end: "2026-09-30" };

let signal: AbortSignal;

beforeEach(() => {
	vi.resetAllMocks();
	signal = new AbortController().signal;
});

describe("airQualityAdapter.offered", () => {
	it("offers raw only for monitors", () => {
		const base: Resolution[] = ["raw", "hour", "day"];
		expect(airQualityAdapter.offered(base, { kind: "monitors", ids: ["m-pa"] })).toEqual(base);
		expect(airQualityAdapter.offered(base, { kind: "regions", keys: ["county:06019"] })).toEqual([
			"hour",
			"day"
		]);
		expect(airQualityAdapter.offered(base, { kind: "all" })).toEqual(["hour", "day"]);
	});
});

describe("airQualityAdapter.fetch", () => {
	it("a PurpleAir monitor's daily summaries ask for the published processor", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(getMonitorSummariesDaily).toHaveBeenCalledExactlyOnceWith(
			{
				monitorId: "m-pa",
				entryType: "pm25",
				year: 2026,
				month: 9,
				processor: "PM25_EPA_Calibration"
			},
			{ signal }
		);
		expect(data.processor).toBe("PM25_EPA_Calibration");
	});

	it("a BAM monitor's daily summaries pass no processor", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		const [config] = vi.mocked(getMonitorSummariesDaily).mock.calls[0];
		expect(config).toEqual({ monitorId: "m-bam", entryType: "pm25", year: 2026, month: 9 });
		expect("processor" in config).toBe(false);
		expect(data.processor).toBeNull();
	});

	it("raw window is Date bounds, for the published series, filtered by entry timestamps", async () => {
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-21T12:00:05-07:00", value: "7.25" },
			{ timestamp: "2026-10-21T12:00:00-07:00", value: "6.70" },
			{ timestamp: "2026-10-21T11:59:59-07:00", value: "5.00" },
			{ timestamp: "2026-10-21T13:00:00-07:00", value: "not a number" },
			{ timestamp: "garbage", value: "1.00" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa"] }, "raw", {
				kind: "trailing",
				amount: 24,
				unit: "hour"
			}),
			ctx,
			signal
		);
		// The SDK's upper bound is inclusive, so the exclusive end is sent less 1 ms.
		expect(getMonitorEntries).toHaveBeenCalledExactlyOnceWith(
			{
				monitorId: "m-pa",
				entryType: "pm25",
				processor: "PM25_EPA_Calibration",
				timestampGte: new Date("2026-10-21T19:00:00.000Z"),
				timestampLte: new Date("2026-10-22T18:59:59.999Z"),
				exact: true
			},
			{ signal }
		);
		expect(data.series).toEqual([
			{
				place: "monitor:m-pa",
				points: [
					{
						t: Date.parse("2026-10-21T19:00:00Z"),
						mean: 6.7,
						min: 6.7,
						max: 6.7,
						count: 1,
						partial: false
					},
					{
						t: Date.parse("2026-10-21T19:00:05Z"),
						mean: 7.25,
						min: 7.25,
						max: 7.25,
						count: 1,
						partial: false
					}
				]
			}
		]);
		expect(data).toMatchObject({ resolution: "raw", fromRaw: false, fetchedAt: NOW.getTime() });
	});

	it("a BAM monitor's raw request names no processor", async () => {
		vi.mocked(getMonitorEntries).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "raw", {
				kind: "trailing",
				amount: 24,
				unit: "hour"
			}),
			ctx,
			signal
		);
		const [config] = vi.mocked(getMonitorEntries).mock.calls[0];
		expect(config).toEqual({
			monitorId: "m-bam",
			entryType: "pm25",
			timestampGte: new Date("2026-10-21T19:00:00.000Z"),
			timestampLte: new Date("2026-10-22T18:59:59.999Z"),
			exact: true
		});
		expect("processor" in config).toBe(false);
	});

	it("downsamples raw entries to Pacific hours, marking the open hour partial", async () => {
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-22T10:10:00-07:00", value: "4" },
			{ timestamp: "2026-10-22T10:40:00-07:00", value: "8" },
			{ timestamp: "2026-10-22T11:30:00-07:00", value: "10" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{
					entryType: "pm100",
					downsampleFromRaw: true,
					offered: ["raw"],
					now: new Date("2026-10-22T18:45:00Z")
				}
			),
			ctx,
			signal
		);
		expect(data.fromRaw).toBe(true);
		expect(data.series[0].points).toEqual([
			{ t: Date.parse("2026-10-22T17:00:00Z"), mean: 6, min: 4, max: 8, count: 2, partial: false },
			{ t: Date.parse("2026-10-22T18:00:00Z"), mean: 10, min: 10, max: 10, count: 1, partial: true }
		]);
	});

	it("omitted places become empty series", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{ id: "sq1", summaries: [row("2026-09-02T00:00:00-07:00", 12, 24)] }
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "regions", keys: ["county:06019", "county:06039"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(getRegionSummariesBulkDaily).toHaveBeenCalledExactlyOnceWith(
			{ entryType: "pm25", start: "2026-09-01", end: "2026-09-30", region: ["sq1", "sq2"] },
			{ signal }
		);
		expect(data.series).toEqual([
			{
				place: "region:county:06019",
				points: [
					{
						t: Date.parse("2026-09-02T07:00:00Z"),
						mean: 12,
						min: 12,
						max: 12,
						count: 24,
						partial: false
					}
				]
			},
			{ place: "region:county:06039", points: [] }
		]);
		expect(data.processor).toBeNull();
	});

	it("region series are keyed by type and code, not sqid", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{ id: "sq2", summaries: [row("2026-09-05T00:00:00-07:00", 3)] }
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "regions", keys: ["county:06039"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(data.series.map((s) => s.place)).toEqual(["region:county:06039"]);
		expect(JSON.stringify(data)).not.toContain("sq2");
	});

	it("fetches a monitor selection per monitor, each with its published processor", async () => {
		vi.mocked(getMonitorSummariesDaily).mockImplementation((async (config: {
			monitorId: string;
		}) => (config.monitorId === "m-pa" ? [row("2026-09-02T00:00:00-07:00", 2)] : [])) as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa", "m-bam"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(getMonitorSummariesBulkDaily).not.toHaveBeenCalled();
		const configs = vi.mocked(getMonitorSummariesDaily).mock.calls.map(([config]) => config);
		expect(configs).toEqual([
			{
				monitorId: "m-pa",
				entryType: "pm25",
				year: 2026,
				month: 9,
				processor: "PM25_EPA_Calibration"
			},
			{ monitorId: "m-bam", entryType: "pm25", year: 2026, month: 9 }
		]);
		expect("processor" in configs[1]).toBe(false);
		expect(data.series.map((s) => [s.place, s.points.length])).toEqual([
			["monitor:m-pa", 1],
			["monitor:m-bam", 0]
		]);
		// The pair uses different series, so no single processor describes the result.
		expect(data.processor).toBeNull();
	});

	it("reports a selection's processor when every monitor shares it", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
		const metadata = fixtureMetadata({ monitorType: async () => "purpleair" });
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa", "m-pa2"] }, "day", SEPTEMBER),
			{ metadata, regions },
			signal
		);
		expect(data.processor).toBe("PM25_EPA_Calibration");
	});

	it("fills today's open hour from raw entries at hour resolution", async () => {
		const now = new Date("2026-10-22T19:30:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([
			row("2026-10-22T11:00:00-07:00", 5, 1)
		] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-22T12:10:00-07:00", value: "4" },
			{ timestamp: "2026-10-22T12:20:00-07:00", value: "8" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{ now }
			),
			ctx,
			signal
		);
		expect(getMonitorSummariesHourly).toHaveBeenCalledExactlyOnceWith(
			{ monitorId: "m-bam", entryType: "pm25", year: 2026, month: 10, day: 22 },
			{ signal }
		);
		expect(getMonitorEntries).toHaveBeenCalledWith(
			{
				monitorId: "m-bam",
				entryType: "pm25",
				timestampGte: new Date("2026-10-22T19:00:00.000Z"),
				timestampLte: new Date("2026-10-22T19:29:59.999Z"),
				exact: true
			},
			{ signal }
		);
		// The other call backfills the last completed hour (11:00), which the response has.
		expect(getMonitorEntries).toHaveBeenCalledTimes(2);
		expect(data.fromRaw).toBe(false);
		expect(data.series[0].points).toEqual([
			{ t: Date.parse("2026-10-22T18:00:00Z"), mean: 5, min: 5, max: 5, count: 1, partial: false },
			{ t: Date.parse("2026-10-22T19:00:00Z"), mean: 6, min: 4, max: 8, count: 2, partial: true }
		]);
	});

	it("fills the second 1 AM on fall-back night with unambiguous Date bounds", async () => {
		// 01:30 PST, the repeated hour: a zone-less 01:00 bound would be ambiguous.
		const now = new Date("2026-11-01T09:30:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-11-01T01:10:00-07:00", value: "1" },
			{ timestamp: "2026-11-01T01:10:00-08:00", value: "3" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{ now }
			),
			ctx,
			signal
		);
		const [config] = vi.mocked(getMonitorEntries).mock.calls[0];
		expect(config).toMatchObject({
			timestampGte: new Date("2026-11-01T09:00:00.000Z"),
			timestampLte: new Date("2026-11-01T09:29:59.999Z"),
			exact: true
		});
		// Only the entry in the second 1 AM (PST) fills the open hour.
		expect(data.series[0].points.at(-1)).toMatchObject({
			t: Date.parse("2026-11-01T09:00:00Z"),
			mean: 3,
			count: 1,
			partial: true
		});
	});

	it("fetches the whole layer from the bulk monitor endpoint with no region", async () => {
		vi.mocked(getMonitorSummariesBulkDaily).mockResolvedValue([
			{ id: "m-1", summaries: [row("2026-09-02T00:00:00-07:00", 1)] },
			{ id: "m-2", summaries: [row("2026-08-31T00:00:00-07:00", 9)] }
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "all" }, "day", SEPTEMBER),
			ctx,
			signal
		);
		const [config] = vi.mocked(getMonitorSummariesBulkDaily).mock.calls[0];
		expect("region" in config).toBe(false);
		// Rows outside the range are dropped.
		expect(data.series.map((s) => [s.place, s.points.length])).toEqual([
			["monitor:m-1", 1],
			["monitor:m-2", 0]
		]);
	});

	it("this year's monthly data fills October from daily and today from hourly", async () => {
		vi.mocked(getMonitorSummariesMonthly).mockResolvedValue([
			row("2026-01-01T00:00:00-08:00", 5, 700),
			row("2026-09-01T00:00:00-07:00", 8, 700)
		] as never);
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-10-01T00:00:00-07:00", 10, 24),
			row("2026-10-21T00:00:00-07:00", 20, 24),
			// Today's daily row (if any) is replaced by the hourly fill.
			row("2026-10-22T00:00:00-07:00", 99, 12)
		] as never);
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([
			row("2026-10-22T00:00:00-07:00", 30, 12),
			row("2026-10-22T11:00:00-07:00", 40, 12)
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "month", { kind: "to-date", unit: "year" }),
			ctx,
			signal
		);
		const base = { monitorId: "m-bam", entryType: "pm25" };
		expect(getMonitorSummariesMonthly).toHaveBeenCalledExactlyOnceWith(
			{ ...base, year: 2026 },
			{ signal }
		);
		// October's days fill the open month; September's back it up until its rollup exists.
		expect(vi.mocked(getMonitorSummariesDaily).mock.calls).toEqual([
			[{ ...base, year: 2026, month: 10 }, { signal }],
			[{ ...base, year: 2026, month: 9 }, { signal }]
		]);
		expect(getMonitorSummariesHourly).toHaveBeenCalledExactlyOnceWith(
			{ ...base, year: 2026, month: 10, day: 22 },
			{ signal }
		);
		const points = data.series[0].points;
		expect(points.map((p) => [p.t, p.partial])).toEqual([
			[Date.parse("2026-01-01T08:00:00Z"), false],
			[Date.parse("2026-09-01T07:00:00Z"), false],
			[Date.parse("2026-10-01T07:00:00Z"), true]
		]);
		expect(points[2].count).toBe(72);
		expect(points[2].mean).toBeCloseTo((10 * 24 + 20 * 24 + 30 * 12 + 40 * 12) / 72);
	});

	it("backfills a completed hour the hourly response lacks from raw entries", async () => {
		// 10:20 PDT: the 9:00 hour is over but its rollup runs at 10:45.
		const now = new Date("2026-10-22T17:20:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([
			row("2026-10-22T08:00:00-07:00", 5, 1)
		] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-22T09:10:00-07:00", value: "2" },
			{ timestamp: "2026-10-22T09:40:00-07:00", value: "4" },
			{ timestamp: "2026-10-22T10:05:00-07:00", value: "9" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{ now }
			),
			ctx,
			signal
		);
		const bounds = vi
			.mocked(getMonitorEntries)
			.mock.calls.map(([c]) => [
				(c.timestampGte as Date).toISOString(),
				(c.timestampLte as Date).toISOString()
			]);
		expect(bounds).toContainEqual(["2026-10-22T16:00:00.000Z", "2026-10-22T16:59:59.999Z"]);
		expect(data.series[0].points).toEqual([
			{ t: Date.parse("2026-10-22T15:00:00Z"), mean: 5, min: 5, max: 5, count: 1, partial: false },
			{ t: Date.parse("2026-10-22T16:00:00Z"), mean: 3, min: 2, max: 4, count: 2, partial: false },
			{ t: Date.parse("2026-10-22T17:00:00Z"), mean: 9, min: 9, max: 9, count: 1, partial: true }
		]);
	});

	it("a completed hour in the hourly response wins over its backfill", async () => {
		const now = new Date("2026-10-22T17:20:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([
			row("2026-10-22T09:00:00-07:00", 5, 30)
		] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-22T09:10:00-07:00", value: "100" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{ now }
			),
			ctx,
			signal
		);
		expect(data.series[0].points).toEqual([
			{ t: Date.parse("2026-10-22T16:00:00Z"), mean: 5, min: 5, max: 5, count: 30, partial: false }
		]);
	});

	it("day resolution just after midnight fills yesterday from hourly summaries", async () => {
		// 00:20 PDT on the 22nd: the daily rollup for the 21st runs around 01:00.
		const now = new Date("2026-10-22T07:20:00Z");
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-10-20T00:00:00-07:00", 7, 24)
		] as never);
		vi.mocked(getMonitorSummariesHourly).mockImplementation((async (config: { day: number }) =>
			config.day === 21
				? [row("2026-10-21T00:00:00-07:00", 10, 10), row("2026-10-21T23:00:00-07:00", 20, 30)]
				: []) as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"day",
				{ kind: "to-date", unit: "month" },
				{ now }
			),
			ctx,
			signal
		);
		const points = data.series[0].points;
		expect(points.map((p) => [p.t, p.partial])).toEqual([
			[Date.parse("2026-10-20T07:00:00Z"), false],
			[Date.parse("2026-10-21T07:00:00Z"), false]
		]);
		expect(points[1].count).toBe(40);
		expect(points[1].mean).toBeCloseTo((10 * 10 + 20 * 30) / 40);
	});

	it("month resolution on the 1st fills last month from daily summaries", async () => {
		const now = new Date("2026-11-01T07:30:00Z");
		vi.mocked(getMonitorSummariesMonthly).mockResolvedValue([
			row("2026-09-01T00:00:00-07:00", 8, 700)
		] as never);
		vi.mocked(getMonitorSummariesDaily).mockImplementation((async (config: { month: number }) =>
			config.month === 10
				? [row("2026-10-01T00:00:00-07:00", 10, 24), row("2026-10-31T00:00:00-07:00", 20, 24)]
				: []) as never);
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"month",
				{ kind: "to-date", unit: "year" },
				{ now }
			),
			ctx,
			signal
		);
		const points = data.series[0].points;
		expect(points.map((p) => [p.t, p.partial, p.count, p.mean])).toEqual([
			[Date.parse("2026-09-01T07:00:00Z"), false, 700, 8],
			[Date.parse("2026-10-01T07:00:00Z"), false, 48, 15]
		]);
	});

	it("a summary row without a minimum or maximum falls back to its mean", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			{ timestamp: "2026-09-02T00:00:00-07:00", mean: 4, minimum: null, maximum: null, count: 2 }
		] as never);
		const data = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(data.series[0].points[0]).toMatchObject({ mean: 4, min: 4, max: 4 });
	});

	it("sends a short raw window exactly as given, with `exact: true`", async () => {
		// Two minutes into the hour: the open hour's raw fill spans only 19:00 to 19:02.
		const now = new Date("2026-10-22T19:02:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([
			{ timestamp: "2026-10-22T12:01:00-07:00", value: "4" },
			{ timestamp: "2026-10-22T12:03:00-07:00", value: "99" }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(
				{ kind: "monitors", ids: ["m-bam"] },
				"hour",
				{ kind: "trailing", amount: 1, unit: "day" },
				{ now }
			),
			ctx,
			signal
		);
		const calls = vi.mocked(getMonitorEntries).mock.calls.map(([c]) => c);
		expect(calls.every((c) => c.exact === true)).toBe(true);
		const open = calls.find(
			(c) => (c.timestampGte as Date).toISOString() === "2026-10-22T19:00:00.000Z"
		);
		expect((open!.timestampLte as Date).toISOString()).toBe("2026-10-22T19:01:59.999Z");
		// The SDK's own range logic leaves an exact window alone (it widens it otherwise).
		const { gte, lte } = getValidDateRange(open!.timestampGte, open!.timestampLte, {
			exact: open!.exact
		});
		expect([gte.toISOString(), lte.toISOString()]).toEqual([
			"2026-10-22T19:00:00.000Z",
			"2026-10-22T19:01:59.999Z"
		]);
		// Entries past the window's end are still dropped.
		expect(data.series[0].points.at(-1)).toMatchObject({ mean: 4, count: 1, partial: true });
	});
});

describe("@sjvair/sdk date range", () => {
	it("accepts an upper bound later than now", () => {
		const gte = new Date(Date.now() - 60 * 60 * 1000);
		const lte = new Date(Date.now() + 60 * 60 * 1000);
		expect(getValidDateRange(gte, lte)).toEqual({ gte, lte });
	});
});
