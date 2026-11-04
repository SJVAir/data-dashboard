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
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkHourly
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
	resolve: async (type, code) => {
		if (type !== "county") return null;
		if (code === "06019") return { id: "sq1", name: "Fresno County" };
		if (code === "06039") {
			return {
				id: "sq2",
				name: "Madera County",
				retired: { since: "2026-01-01", replacedBy: { type: "county", code: "06019" } }
			};
		}
		return null;
	}
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
		worstHour?: boolean;
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
		worstHour: opts.worstHour ?? false,
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

describe("airQualityAdapter.fetch calendar-aligned requests", () => {
	const LAST_30: DateRangeSpec = { kind: "trailing", amount: 30, unit: "day" };
	const COUNTY = { kind: "regions", keys: ["county:06019"] } as Target;
	const bulkCalls = () =>
		vi.mocked(getRegionSummariesBulkDaily).mock.calls.map(([config]) => config);

	it("asks for the same whole-October URL on consecutive days", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([] as never);
		const runAt = async (iso: string) => {
			vi.mocked(getRegionSummariesBulkDaily).mockClear();
			const now = new Date(iso);
			await airQualityAdapter.fetch(
				request(COUNTY, "day", LAST_30, { now, offered: ["day"] }),
				ctx,
				signal
			);
			return bulkCalls();
		};
		const first = await runAt("2026-11-04T20:00:00Z");
		const second = await runAt("2026-11-05T20:00:00Z");
		const october = { entryType: "pm25", start: "2026-10-01", end: "2026-10-31", region: ["sq1"] };
		expect(first[0]).toEqual(october);
		expect(second[0]).toEqual(october);
	});

	it("asks for November whole and December on 1 December", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(
			request(COUNTY, "day", LAST_30, { now: new Date("2026-12-01T17:00:00Z"), offered: ["day"] }),
			ctx,
			signal
		);
		expect(bulkCalls().map((c) => [c.start, c.end])).toEqual([
			["2026-11-01", "2026-11-30"],
			["2026-12-01", "2026-12-31"]
		]);
	});

	it("a single monitor's daily query goes per month, never per year", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "day", LAST_30, {
				now: new Date("2026-11-04T20:00:00Z"),
				offered: ["day"]
			}),
			ctx,
			signal
		);
		const configs = vi.mocked(getMonitorSummariesDaily).mock.calls.map(([c]) => c);
		expect(configs).toEqual([
			{ monitorId: "m-bam", entryType: "pm25", year: 2026, month: 10 },
			{ monitorId: "m-bam", entryType: "pm25", year: 2026, month: 11 }
		]);
	});

	it("drops rows outside the clipped range", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{
				id: "sq1",
				summaries: [
					row("2026-10-01T00:00:00-07:00", 1),
					row("2026-10-20T00:00:00-07:00", 2),
					row("2026-11-20T00:00:00-08:00", 3)
				]
			}
		] as never);
		const data = await airQualityAdapter.fetch(
			request(COUNTY, "day", LAST_30, { now: new Date("2026-11-04T20:00:00Z"), offered: ["day"] }),
			ctx,
			signal
		);
		expect(data.series[0].points.map((p) => p.mean)).toEqual([2]);
	});
});

describe("airQualityAdapter.fetch", () => {
	it("lists each requested place with its name and a region's retirement", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([] as never);
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
		const byRegion = await airQualityAdapter.fetch(
			request({ kind: "regions", keys: ["county:06039", "county:06019"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(byRegion.places).toEqual([
			{
				place: "region:county:06039",
				name: "Madera County",
				retired: { since: "2026-01-01", replacedBy: { type: "county", code: "06019" } }
			},
			{ place: "region:county:06019", name: "Fresno County" }
		]);
		const byMonitor = await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa", "m-unknown"] }, "day", SEPTEMBER),
			ctx,
			signal
		);
		expect(byMonitor.places).toEqual([
			{ place: "monitor:m-pa", name: "Purple Air" },
			{ place: "monitor:m-unknown", name: "m-unknown" }
		]);
	});

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
		// The response has the last completed hour (11:00), so it isn't backfilled.
		expect(getMonitorEntries).toHaveBeenCalledTimes(1);
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
		// October's days fill the open month; September's monthly row exists, so no backfill.
		expect(vi.mocked(getMonitorSummariesDaily).mock.calls).toEqual([
			[{ ...base, year: 2026, month: 10 }, { signal }]
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

describe("airQualityAdapter.fetch rollup-lag backfill", () => {
	// 12:00 PDT on the 22nd: yesterday is the last completed day.
	const now = new Date("2026-10-22T19:00:00Z");
	const LAST_5: DateRangeSpec = { kind: "trailing", amount: 5, unit: "day" };
	const DAILY = [row("2026-10-20T00:00:00-07:00", 7, 24), row("2026-10-21T00:00:00-07:00", 8, 24)];
	const MON = { kind: "monitors", ids: ["m-bam"] } as Target;
	const hoursOfYesterday = (call: [{ day?: number }, unknown]) => call[0].day === 21;

	it("makes no hourly backfill call once the daily rollup has yesterday", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue(DAILY as never);
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(request(MON, "day", LAST_5, { now }), ctx, signal);
		const calls = vi.mocked(getMonitorSummariesHourly).mock.calls as never as Array<
			[{ day?: number }, unknown]
		>;
		expect(calls.some(hoursOfYesterday)).toBe(false);
	});

	it("backfills yesterday's 23:00 hour from raw entries and counts it", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([DAILY[0]] as never);
		vi.mocked(getMonitorSummariesHourly).mockImplementation((async (config: { day: number }) =>
			config.day === 21 ? [row("2026-10-21T22:00:00-07:00", 10, 10)] : []) as never);
		vi.mocked(getMonitorEntries).mockImplementation((async (config: { timestampGte: Date }) =>
			config.timestampGte.toISOString() === "2026-10-22T06:00:00.000Z"
				? [
						{ timestamp: "2026-10-21T23:10:00-07:00", value: "20" },
						{ timestamp: "2026-10-21T23:40:00-07:00", value: "40" }
					]
				: []) as never);
		const data = await airQualityAdapter.fetch(request(MON, "day", LAST_5, { now }), ctx, signal);
		const yesterday = data.series[0].points.find((p) => p.t === Date.parse("2026-10-21T07:00:00Z"));
		expect(yesterday).toMatchObject({ count: 12, partial: false });
		expect(yesterday!.mean).toBeCloseTo((10 * 10 + 30 * 2) / 12);
	});

	it("skips the raw fetch when the hourly backfill already has the last hour", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([DAILY[0]] as never);
		vi.mocked(getMonitorSummariesHourly).mockImplementation((async (config: { day: number }) =>
			config.day === 21 ? [row("2026-10-21T23:00:00-07:00", 10, 10)] : []) as never);
		vi.mocked(getMonitorEntries).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(request(MON, "day", LAST_5, { now }), ctx, signal);
		const starts = vi
			.mocked(getMonitorEntries)
			.mock.calls.map(([c]) => (c.timestampGte as Date).toISOString());
		expect(starts).not.toContain("2026-10-22T06:00:00.000Z");
	});

	it("builds a region's backfilled day from the hours there are", async () => {
		const REGION = { kind: "regions", keys: ["county:06019"] } as Target;
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{ id: "sq1", summaries: [DAILY[0]] }
		] as never);
		const hourly = vi.mocked(getRegionSummariesBulkHourly);
		hourly.mockResolvedValue([
			{
				id: "sq1",
				summaries: [
					row("2026-10-21T10:00:00-07:00", 10, 4),
					row("2026-10-21T11:00:00-07:00", 20, 4)
				]
			}
		] as never);
		const offered: Resolution[] = ["hour", "day"];
		const data = await airQualityAdapter.fetch(
			request(REGION, "day", LAST_5, { now, offered }),
			ctx,
			signal
		);
		const yesterday = data.series[0].points.find((p) => p.t === Date.parse("2026-10-21T07:00:00Z"));
		expect(yesterday).toMatchObject({ count: 8, mean: 15, partial: false });
		expect(getMonitorEntries).not.toHaveBeenCalled();
	});

	it("bulk backfill uses rows only for the regions that lack the day", async () => {
		const BOTH = { kind: "regions", keys: ["county:06019", "county:06039"] } as Target;
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{ id: "sq1", summaries: [DAILY[1]] },
			{ id: "sq2", summaries: [] }
		] as never);
		vi.mocked(getRegionSummariesBulkHourly).mockResolvedValue([
			{ id: "sq1", summaries: [row("2026-10-21T10:00:00-07:00", 99, 4)] },
			{ id: "sq2", summaries: [row("2026-10-21T10:00:00-07:00", 5, 4)] }
		] as never);
		const data = await airQualityAdapter.fetch(
			request(BOTH, "day", LAST_5, { now, offered: ["hour", "day"] }),
			ctx,
			signal
		);
		const yesterdayCalls = vi
			.mocked(getRegionSummariesBulkHourly)
			.mock.calls.filter(([c]) => c.end === "2026-10-21");
		expect(yesterdayCalls).toHaveLength(1);
		const day = (i: number) =>
			data.series[i].points.find((p) => p.t === Date.parse("2026-10-21T07:00:00Z"));
		expect(day(0)).toMatchObject({ mean: 8, count: 24 });
		expect(day(1)).toMatchObject({ mean: 5, count: 4 });
	});
});

describe("@sjvair/sdk date range", () => {
	it("accepts an upper bound later than now", () => {
		const gte = new Date(Date.now() - 60 * 60 * 1000);
		const lte = new Date(Date.now() + 60 * 60 * 1000);
		expect(getValidDateRange(gte, lte)).toEqual({ gte, lte });
	});
});

describe("airQualityAdapter.fetch worstHour", () => {
	const LAST_30: DateRangeSpec = { kind: "trailing", amount: 30, unit: "day" };
	const COUNTY = { kind: "regions", keys: ["county:06019"] } as Target;
	const HOUR = 3_600_000;

	it("attaches each day's worst hourly average; the mean stays the daily one", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([
			{ id: "sq1", summaries: [row("2026-10-05T00:00:00-07:00", 10, 24)] }
		] as never);
		vi.mocked(getRegionSummariesBulkHourly).mockResolvedValue([
			{
				id: "sq1",
				summaries: [
					row("2026-10-05T03:00:00-07:00", 8, 30),
					row("2026-10-05T14:00:00-07:00", 31, 30),
					row("2026-10-05T15:00:00-07:00", 12, 30)
				]
			}
		] as never);
		const data = await airQualityAdapter.fetch(
			request(COUNTY, "day", LAST_30, { worstHour: true, offered: ["hour", "day"] }),
			ctx,
			signal
		);
		const day = Date.parse("2026-10-05T07:00:00Z");
		const point = data.series[0].points.find((p) => p.t === day)!;
		expect(point.mean).toBe(10);
		expect(point.worstHour).toEqual({ t: day + 14 * HOUR, value: 31 });
		// Hourly calls are by whole month.
		const starts = vi
			.mocked(getRegionSummariesBulkHourly)
			.mock.calls.map(([config]) => config.start);
		// The open day's own fill adds single-day calls; the rest are whole months.
		expect(starts.filter((d) => String(d).endsWith("-01")).sort()).toEqual([
			"2026-09-01",
			"2026-10-01"
		]);
	});

	it("makes no hourly calls without worstHour", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([] as never);
		vi.mocked(getRegionSummariesBulkHourly).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(
			request(COUNTY, "day", LAST_30, { offered: ["hour", "day"] }),
			ctx,
			signal
		);
		// Only the open day's fill asks for hours; nothing covers September.
		const starts = vi
			.mocked(getRegionSummariesBulkHourly)
			.mock.calls.map(([config]) => config.start);
		expect(starts).not.toContain("2026-09-01");
	});

	it("fails the whole query when the hourly fetch fails", async () => {
		vi.mocked(getRegionSummariesBulkDaily).mockResolvedValue([] as never);
		vi.mocked(getRegionSummariesBulkHourly).mockRejectedValue(new Error("boom"));
		await expect(
			airQualityAdapter.fetch(
				request(COUNTY, "day", LAST_30, { worstHour: true, offered: ["hour", "day"] }),
				ctx,
				signal
			)
		).rejects.toThrow("boom");
	});
});
