import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk/http", () => ({ paginatedApiCall: vi.fn() }));
vi.mock("@sjvair/sdk", () => ({
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
	getMonitorSummariesBulkDaily,
	getMonitorSummariesDaily,
	getMonitorSummariesHourly,
	getMonitorSummariesMonthly,
	getRegionSummariesBulkDaily
} from "@sjvair/sdk";
import { paginatedApiCall } from "@sjvair/sdk/http";
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

	it("raw window is UTC instants, for the published series, filtered by entry timestamps", async () => {
		vi.mocked(paginatedApiCall).mockResolvedValue([
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
		expect(paginatedApiCall).toHaveBeenCalledExactlyOnceWith({
			url: "monitors/m-pa/entries/pm25",
			searchParams: {
				page: "1",
				timestamp__gte: "2026-10-21T19:00:00.000Z",
				timestamp__lt: "2026-10-22T19:00:00.000Z",
				processor: "PM25_EPA_Calibration"
			},
			options: { signal }
		});
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
		vi.mocked(paginatedApiCall).mockResolvedValue([] as never);
		await airQualityAdapter.fetch(
			request({ kind: "monitors", ids: ["m-bam"] }, "raw", {
				kind: "trailing",
				amount: 24,
				unit: "hour"
			}),
			ctx,
			signal
		);
		const [config] = vi.mocked(paginatedApiCall).mock.calls[0] as [
			{ searchParams: Record<string, string> }
		];
		expect(config.searchParams).toEqual({
			page: "1",
			timestamp__gte: "2026-10-21T19:00:00.000Z",
			timestamp__lt: "2026-10-22T19:00:00.000Z"
		});
	});

	it("downsamples raw entries to Pacific hours, marking the open hour partial", async () => {
		vi.mocked(paginatedApiCall).mockResolvedValue([
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
		vi.mocked(paginatedApiCall).mockResolvedValue([
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
		expect(paginatedApiCall).toHaveBeenCalledExactlyOnceWith({
			url: "monitors/m-bam/entries/pm25",
			searchParams: {
				page: "1",
				timestamp__gte: "2026-10-22T19:00:00.000Z",
				timestamp__lt: "2026-10-22T19:30:00.000Z"
			},
			options: { signal }
		});
		expect(data.fromRaw).toBe(false);
		expect(data.series[0].points).toEqual([
			{ t: Date.parse("2026-10-22T18:00:00Z"), mean: 5, min: 5, max: 5, count: 1, partial: false },
			{ t: Date.parse("2026-10-22T19:00:00Z"), mean: 6, min: 4, max: 8, count: 2, partial: true }
		]);
	});

	it("fills the second 1 AM on fall-back night with unambiguous UTC bounds", async () => {
		// 01:30 PST, the repeated hour: a zone-less 01:00 bound would be ambiguous.
		const now = new Date("2026-11-01T09:30:00Z");
		vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
		vi.mocked(paginatedApiCall).mockResolvedValue([
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
		const [config] = vi.mocked(paginatedApiCall).mock.calls[0] as [
			{ searchParams: Record<string, string> }
		];
		expect(config.searchParams).toEqual({
			page: "1",
			timestamp__gte: "2026-11-01T09:00:00.000Z",
			timestamp__lt: "2026-11-01T09:30:00.000Z"
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
		expect(getMonitorSummariesDaily).toHaveBeenCalledExactlyOnceWith(
			{ ...base, year: 2026, month: 10 },
			{ signal }
		);
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
});
