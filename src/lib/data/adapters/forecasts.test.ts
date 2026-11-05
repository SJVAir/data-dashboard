import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getForecastForPlace: vi.fn(),
	getForecastsMeta: vi.fn()
}));

import { getForecastForPlace, getForecastsMeta } from "@sjvair/sdk";
import { resolveRange } from "$lib/format/range";
import { createWebMetadata } from "../metadata";
import type { DateRangeSpec } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import {
	FORECASTS_META,
	FRESNO_FORECASTS,
	forecastRow,
	placeResponse
} from "../testing/forecasts-fixtures";
import type { Target } from "../types";
import { forecastsAdapter } from "./forecasts";
import type { AdapterContext, AdapterRequest, RegionResolver } from "./registry";

const NOW = new Date("2026-11-05T19:00:00Z");

const regions: RegionResolver = {
	resolve: async (type, code) => {
		if (type === "zipcode" && code === "93721") return { id: "sqz", name: "93721" };
		if (type === "county" && code === "06019") return { id: "sq1", name: "Fresno County" };
		return null;
	}
};

const ctx: AdapterContext = {
	metadata: fixtureMetadata(),
	regions,
	locations: { resolve: async () => null },
	points: { keys: async () => [] }
};

function request(
	target: Target,
	entryType: string,
	spec: DateRangeSpec = { kind: "custom", start: "2026-11-02", end: "2026-11-05" }
): AdapterRequest {
	return {
		entryType,
		target,
		resolution: "day",
		downsampleFromRaw: false,
		range: resolveRange(spec, NOW),
		offered: ["day"],
		worstHour: false,
		now: NOW
	};
}

const county: Target = { kind: "regions", keys: ["county:06019"] };

let signal: AbortSignal;

beforeEach(() => {
	vi.resetAllMocks();
	signal = new AbortController().signal;
});

describe("forecastsAdapter", () => {
	it("offers only days", () => {
		expect(forecastsAdapter.offered(["day", "month"], county)).toEqual(["day"]);
	});

	it("burn status maps to the scale level by value", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse(FRESNO_FORECASTS) as never);
		const data = await forecastsAdapter.fetch(request(county, "burn-status"), ctx, signal);
		const points = data.series[0].points;
		expect(points.map((p) => p.level)).toEqual([
			"discouraged",
			"registered",
			"registered",
			"registered"
		]);
		expect(points.every((p) => Number.isNaN(p.mean) && Number.isNaN(p.min))).toBe(true);
		expect(points.every((p) => p.count === 1 && !p.partial)).toBe(true);
		expect(data.series[0].place).toBe("region:county:06019");
		expect(data.resolution).toBe("day");
	});

	it("an AQI forecast carries the value and its scale level", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse(FRESNO_FORECASTS) as never);
		const data = await forecastsAdapter.fetch(request(county, "aqi-forecast"), ctx, signal);
		const [first] = data.series[0].points;
		expect(first).toMatchObject({ mean: 53, min: 53, max: 53, level: "moderate" });
		// Pacific midnight of 2026-11-02 (PST).
		expect(first.t).toBe(Date.parse("2026-11-02T08:00:00Z"));
	});

	it("a burn status the scale doesn't list is left out", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(
			placeResponse([
				forecastRow("2026-11-02", "2026-11-02", 40, "Mandatory"),
				forecastRow("2026-11-03", "2026-11-03", 40, "Registered")
			]) as never
		);
		const data = await forecastsAdapter.fetch(request(county, "burn-status"), ctx, signal);
		expect(data.series[0].points.map((p) => p.level)).toEqual(["registered"]);
	});

	it("the latest issue per date wins", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(
			placeResponse([
				forecastRow("2026-11-04", "2026-11-03", 40, "Registered"),
				forecastRow("2026-11-04", "2026-11-04", 120, "Discouraged"),
				forecastRow("2026-11-05", "2026-11-04", 58, "Registered")
			]) as never
		);
		const data = await forecastsAdapter.fetch(request(county, "aqi-forecast"), ctx, signal);
		const points = data.series[0].points;
		expect(points).toHaveLength(2);
		expect(points[0]).toMatchObject({ mean: 120, level: "unhealthy_sensitive" });
	});

	it("keeps only dates inside the range, in time order", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse(FRESNO_FORECASTS) as never);
		const spec: DateRangeSpec = { kind: "custom", start: "2026-11-04", end: "2026-11-04" };
		const data = await forecastsAdapter.fetch(request(county, "aqi-forecast", spec), ctx, signal);
		expect(data.series[0].points.map((p) => p.mean)).toEqual([71]);
	});

	it("asks for each calendar month whole, with the abort signal", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse([]) as never);
		const spec: DateRangeSpec = { kind: "custom", start: "2026-10-20", end: "2026-11-05" };
		await forecastsAdapter.fetch(request(county, "aqi-forecast", spec), ctx, signal);
		const calls = vi.mocked(getForecastForPlace).mock.calls;
		expect(calls.map((c) => c[1])).toEqual([
			{ gte: "2026-10-01", lte: "2026-10-31" },
			{ gte: "2026-11-01", lte: "2026-11-30" }
		]);
		expect(calls[0][2]).toEqual({ signal });
	});

	it("a ZIP target asks for that region", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse(FRESNO_FORECASTS) as never);
		const target: Target = {
			kind: "fallback",
			via: { kind: "point" },
			keys: ["zipcode:93721", "county:06019"]
		};
		const data = await forecastsAdapter.fetch(request(target, "burn-status"), ctx, signal);
		expect(vi.mocked(getForecastForPlace).mock.calls[0][0]).toEqual({
			region: { type: "zipcode", external_id: "93721" }
		});
		expect(vi.mocked(getForecastForPlace)).toHaveBeenCalledTimes(1);
		expect(data.series.map((s) => s.place)).toEqual(["region:zipcode:93721"]);
		expect(data.places[0]).toMatchObject({ name: "93721", via: { kind: "point" } });
	});

	it("a monitor target asks by monitor id", async () => {
		vi.mocked(getForecastForPlace).mockResolvedValue(placeResponse(FRESNO_FORECASTS) as never);
		const target: Target = { kind: "monitors", ids: ["m-pa"] };
		const data = await forecastsAdapter.fetch(request(target, "burn-status"), ctx, signal);
		expect(vi.mocked(getForecastForPlace).mock.calls[0][0]).toEqual({ monitor: "m-pa" });
		expect(data.series[0].place).toBe("monitor:m-pa");
		expect(data.places[0].name).toBe("Purple Air");
	});

	it("404 is unavailable, not an error", async () => {
		vi.mocked(getForecastForPlace).mockRejectedValue(
			new Error("failed", { cause: { result: { status: 404 } } })
		);
		const data = await forecastsAdapter.fetch(request(county, "burn-status"), ctx, signal);
		expect(data.series).toEqual([{ place: "region:county:06019", points: [] }]);
	});

	it("a 404 on a fallback's first region moves to the next", async () => {
		vi.mocked(getForecastForPlace)
			.mockRejectedValueOnce(new Error("failed", { cause: { result: { status: 404 } } }))
			.mockResolvedValueOnce(placeResponse(FRESNO_FORECASTS) as never);
		const target: Target = {
			kind: "fallback",
			via: { kind: "point" },
			keys: ["zipcode:93721", "county:06019"]
		};
		const data = await forecastsAdapter.fetch(request(target, "burn-status"), ctx, signal);
		expect(data.series[0].place).toBe("region:county:06019");
		expect(data.series[0].points).toHaveLength(4);
	});

	it("other failures reject", async () => {
		vi.mocked(getForecastForPlace).mockRejectedValue(
			new Error("failed", { cause: { result: { status: 500 } } })
		);
		await expect(
			forecastsAdapter.fetch(request(county, "burn-status"), ctx, signal)
		).rejects.toThrow("failed");
	});

	it("doesn't support the whole layer", async () => {
		const layer = { dataset: "forecasts" } as never;
		expect(await forecastsAdapter.target(layer, ctx)).toEqual({ unavailable: "place-unsupported" });
	});
});

describe("datasetLevels", () => {
	it("reads forecasts scales", async () => {
		vi.mocked(getForecastsMeta).mockResolvedValue(FORECASTS_META as never);
		const meta = createWebMetadata();
		const burn = await meta.datasetLevels("forecasts", "burn-status");
		expect(burn.map((l) => [l.key, l.label, l.value, l.min])).toEqual([
			["discouraged", "Burning Discouraged", "Discouraged", 0],
			["registered", "No Burning Unless Registered", "Registered", 0]
		]);
		const aqi = await meta.datasetLevels("forecasts", "aqi-forecast");
		expect(aqi.map((l) => l.key)).toEqual([
			"good",
			"moderate",
			"unhealthy_sensitive",
			"unhealthy",
			"very_unhealthy",
			"hazardous"
		]);
		expect(aqi[5].max).toBeNull();
		expect(await meta.datasetLevels("forecasts", "nope")).toEqual([]);
		expect(vi.mocked(getForecastsMeta)).toHaveBeenCalledTimes(1);
	});
});
