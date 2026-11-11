import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getDatasetCatalog: vi.fn(),
	getWeatherStationsForPlace: vi.fn(),
	getMonitorSummariesHourly: vi.fn(),
	getMonitorSummariesDaily: vi.fn(),
	getMonitorSummariesMonthly: vi.fn(),
	getMonitorSummariesQuarterly: vi.fn(),
	getMonitorSummariesSeasonal: vi.fn(),
	getMonitorSummariesYearly: vi.fn(),
	getMonitorEntries: vi.fn()
}));

import {
	getDatasetCatalog,
	getMonitorSummariesDaily,
	getMonitorSummariesHourly,
	getMonitorSummariesMonthly,
	getWeatherStationsForPlace
} from "@sjvair/sdk";
import { resolveRange } from "$lib/format/range";
import { offeredDatasets } from "$lib/get-data/offer";
import { createWebMetadata, type CatalogEntry } from "../metadata";
import type { DateRangeSpec, Layer, Resolution } from "../schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "../testing/dataset-catalog";
import { fixtureMetadata } from "../testing/fixtures";
import type { Target } from "../types";
import type { AdapterContext, AdapterRequest, RegionResolver } from "./registry";
import { resetStationCache, stationChoice, stationsFor, weatherAdapter } from "./weather";

const NOW = new Date("2026-10-22T19:00:00Z");
const LEVELS: Resolution[] = ["hour", "day", "month", "quarter", "season", "year"];

const regions: RegionResolver = {
	resolve: async (type, code) => {
		if (type === "county" && code === "06019") return { id: "sq1", name: "Fresno County" };
		if (type === "county" && code === "06039") return { id: "sq2", name: "Madera County" };
		if (type === "zipcode" && code === "93721") return { id: "sqz", name: "ZIP 93721" };
		if (type === "city" && code === "0627000") return { id: "sqc", name: "Fresno" };
		return null;
	}
};

const ctxOf = (metadata = fixtureMetadata()): AdapterContext => ({
	metadata,
	regions,
	locations: {
		resolve: async (source, code) =>
			source === "cde-public" && code === "1"
				? { name: "Roosevelt High School", keys: ["zipcode:93721", "city:0627000", "county:06019"] }
				: null
	},
	points: { keys: async () => [] }
});

/** A station as `getWeatherStationsForPlace` returns it (a monitor row plus distance, inside). */
function station(id: string, name: string, distance: number, inside: boolean, active = true) {
	return {
		id,
		name,
		type: "cimis",
		is_active: active,
		position: { type: "Point", coordinates: [-119.74, 36.82] },
		distance,
		inside
	};
}

const FRESNO = [
	station("s80", "CIMIS #80 - Fresno State", 0, true),
	station("s39", "CIMIS #39 - Parlier", 0, true),
	station("s15", "CIMIS #15 - Stratford", 6.2, false, false)
];
const response = (stations: unknown[]) => ({ place: {}, stations }) as never;

function request(
	target: Target,
	opts: {
		entryType?: string;
		resolution?: Resolution;
		spec?: DateRangeSpec;
		station?: string;
	} = {}
): AdapterRequest {
	return {
		entryType: opts.entryType ?? "temperature",
		target,
		resolution: opts.resolution ?? "day",
		downsampleFromRaw: false,
		range: resolveRange(
			opts.spec ?? { kind: "custom", start: "2026-09-10", end: "2026-09-12" },
			NOW
		),
		offered: LEVELS,
		worstHour: false,
		now: NOW,
		...(opts.station && { station: opts.station })
	};
}

/** A summary row; `sum` is the day's total for the sum types. */
function row(timestamp: string, mean: number, sum?: number, extra: object = {}) {
	return {
		timestamp,
		mean,
		minimum: mean,
		maximum: mean,
		count: 24,
		...(sum !== undefined && { sum }),
		is_complete: true,
		...extra
	};
}

const county: Target = { kind: "regions", keys: ["county:06019"] };
let signal: AbortSignal;
let ctx: AdapterContext;

beforeEach(async () => {
	vi.resetAllMocks();
	resetStationCache();
	signal = new AbortController().signal;
	vi.mocked(getDatasetCatalog).mockResolvedValue({
		...SDK_DATASET_CATALOG,
		datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
	});
	vi.mocked(getWeatherStationsForPlace).mockResolvedValue(response(FRESNO));
	vi.mocked(getMonitorSummariesDaily).mockResolvedValue([] as never);
	vi.mocked(getMonitorSummariesHourly).mockResolvedValue([] as never);
	vi.mocked(getMonitorSummariesMonthly).mockResolvedValue([] as never);
	const catalog = createWebMetadata().catalog;
	ctx = ctxOf(fixtureMetadata({ catalog }));
});

describe("stationChoice", () => {
	const list = FRESNO.map((s) => ({
		id: s.id,
		name: s.name,
		distance: s.distance,
		inside: s.inside,
		active: s.is_active
	}));

	it("the first station is the default", () => {
		expect(stationChoice(list, undefined)?.name).toBe("CIMIS #80 - Fresno State");
	});

	it("a saved station in the list wins; one not listed falls back to the first", () => {
		expect(stationChoice(list, "s39")?.id).toBe("s39");
		expect(stationChoice(list, "gone")?.id).toBe("s80");
	});

	it("an empty list has no station", () => {
		expect(stationChoice([], "s39")).toBeUndefined();
	});
});

describe("stationsFor", () => {
	it("maps the server's stations, in server order, and asks once per place", async () => {
		const ref = { region: { type: "county", external_id: "06019" } } as never;
		const first = await stationsFor(ref, signal);
		await stationsFor(ref, signal);
		expect(first.map((s) => s.id)).toEqual(["s80", "s39", "s15"]);
		expect(first[2]).toEqual({
			id: "s15",
			name: "CIMIS #15 - Stratford",
			distance: 6.2,
			inside: false,
			active: false
		});
		expect(getWeatherStationsForPlace).toHaveBeenCalledTimes(1);
	});
});

describe("weatherAdapter", () => {
	it("offers the levels without raw, and nothing for the whole layer", async () => {
		expect(weatherAdapter.offered(["raw", "hour", "day"], county)).toEqual(["hour", "day"]);
		expect(await weatherAdapter.target({ dataset: "weather" } as Layer, ctx)).toEqual({
			unavailable: "place-unsupported"
		});
	});

	it("wind direction is not offered", async () => {
		const catalog = (await ctx.metadata.catalog()) as CatalogEntry[];
		const winds = catalog
			.find((d) => d.id === "weather")!
			.entryTypes.find((e) => e.id === "winddirection")!;
		expect(weatherAdapter.offered(winds.resolutions, county)).toEqual([]);
		const types = [{ accepts: { datasets: ["weather"] } }] as never;
		const [weather] = offeredDatasets(catalog, [weatherAdapter], types);
		expect(weather.entryTypes.map((e) => e.id)).not.toContain("winddirection");
		expect(weather.overlayTypes.map((e) => e.id)).not.toContain("winddirection");
		expect(weather.entryTypes.map((e) => e.id)).toContain("temperature");
	});

	it("the first station is the default, named on the place", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-09-10T07:00:00Z", 71.5)
		] as never);
		const data = await weatherAdapter.fetch(request(county), ctx, signal);
		expect(vi.mocked(getMonitorSummariesDaily).mock.calls[0][0]).toMatchObject({
			monitorId: "s80",
			entryType: "temperature"
		});
		expect(data.series).toEqual([
			{
				place: "region:county:06019",
				points: [expect.objectContaining({ mean: 71.5, partial: false })]
			}
		]);
		expect(data.places).toEqual([
			{
				place: "region:county:06019",
				name: "Fresno County",
				source: { id: "s80", name: "CIMIS #80 - Fresno State", distance: 0, inside: true }
			}
		]);
		expect(data.fromRaw).toBe(false);
	});

	it("a saved station in the list wins; one not listed falls back to the first", async () => {
		await weatherAdapter.fetch(request(county, { station: "s39" }), ctx, signal);
		expect(vi.mocked(getMonitorSummariesDaily).mock.calls[0][0]).toMatchObject({
			monitorId: "s39"
		});
		vi.mocked(getMonitorSummariesDaily).mockClear();
		const data = await weatherAdapter.fetch(request(county, { station: "hidden" }), ctx, signal);
		expect(vi.mocked(getMonitorSummariesDaily).mock.calls[0][0]).toMatchObject({
			monitorId: "s80"
		});
		expect(data.places[0].source?.id).toBe("s80");
	});

	it("the override is ignored with several places", async () => {
		vi.mocked(getWeatherStationsForPlace).mockImplementation((async (place: {
			region: { external_id: string };
		}) =>
			response(
				place.region.external_id === "06019"
					? FRESNO
					: [station("s70", "CIMIS #70 - Madera", 0, true)]
			)) as never);
		const two: Target = { kind: "regions", keys: ["county:06019", "county:06039"] };
		const data = await weatherAdapter.fetch(request(two, { station: "s39" }), ctx, signal);
		expect(data.places.map((p) => p.source?.id)).toEqual(["s80", "s70"]);
		expect(data.series.map((s) => s.place)).toEqual(["region:county:06019", "region:county:06039"]);
	});

	it("an empty station list gives an empty series, not an error", async () => {
		vi.mocked(getWeatherStationsForPlace).mockResolvedValue(response([]));
		const data = await weatherAdapter.fetch(request(county, { station: "s39" }), ctx, signal);
		expect(data.series).toEqual([{ place: "region:county:06019", points: [] }]);
		expect(data.places).toEqual([{ place: "region:county:06019", name: "Fresno County" }]);
		expect(getMonitorSummariesDaily).not.toHaveBeenCalled();
	});

	it("a monitor outside every radius gets an empty series", async () => {
		vi.mocked(getWeatherStationsForPlace).mockRejectedValue(
			new Error("not found", { cause: { result: { status: 404 } } })
		);
		const data = await weatherAdapter.fetch(
			request({ kind: "monitors", ids: ["m-pa"] }),
			ctx,
			signal
		);
		expect(data.series).toEqual([{ place: "monitor:m-pa", points: [] }]);
	});

	it("precipitation reads sum, temperature reads mean", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-09-10T07:00:00Z", 0.05, 1.25)
		] as never);
		const rain = await weatherAdapter.fetch(
			request(county, { entryType: "precipitation" }),
			ctx,
			signal
		);
		const temp = await weatherAdapter.fetch(
			request(county, { entryType: "temperature" }),
			ctx,
			signal
		);
		expect(rain.series[0].points[0].mean).toBe(1.25);
		expect(temp.series[0].points[0].mean).toBe(0.05);
	});

	it("an incomplete summary row is partial", async () => {
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-09-10T07:00:00Z", 70, undefined, { is_complete: false }),
			row("2026-09-11T07:00:00Z", 71)
		] as never);
		const data = await weatherAdapter.fetch(request(county), ctx, signal);
		expect(data.series[0].points.map((p) => p.partial)).toEqual([true, false]);
	});

	it("a school uses its ZIP's stations", async () => {
		const school = {
			dataset: "weather",
			entryType: "temperature",
			place: { kind: "location", source: "cde-public", code: "1" }
		} as Layer;
		const target = await weatherAdapter.target(school, ctx);
		expect(target).toMatchObject({ kind: "fallback" });
		const data = await weatherAdapter.fetch(request(target as Target), ctx, signal);
		expect(getWeatherStationsForPlace).toHaveBeenCalledTimes(1);
		expect(getWeatherStationsForPlace).toHaveBeenCalledWith({
			region: { type: "zipcode", external_id: "93721" }
		});
		expect(data.places[0]).toMatchObject({
			place: "region:zipcode:93721",
			via: { kind: "location" },
			source: { id: "s80" }
		});
	});

	it("the open month is built from daily rows and summed for totals", async () => {
		vi.mocked(getMonitorSummariesMonthly).mockResolvedValue([
			row("2026-09-01T07:00:00Z", 0.01, 0.5)
		] as never);
		vi.mocked(getMonitorSummariesDaily).mockResolvedValue([
			row("2026-10-03T07:00:00Z", 0.02, 0.1),
			row("2026-10-04T07:00:00Z", 0.02, 0.2),
			row("2026-10-05T07:00:00Z", 0.02, 0.4)
		] as never);
		const spec: DateRangeSpec = { kind: "custom", start: "2026-09-01", end: "2026-10-31" };
		const rain = await weatherAdapter.fetch(
			request(county, { entryType: "precipitation", resolution: "month", spec }),
			ctx,
			signal
		);
		const [sept, oct] = rain.series[0].points;
		expect(sept.mean).toBe(0.5);
		expect(oct.mean).toBeCloseTo(0.7);
		expect(oct.partial).toBe(true);
		const temp = await weatherAdapter.fetch(
			request(county, { entryType: "temperature", resolution: "month", spec }),
			ctx,
			signal
		);
		expect(temp.series[0].points[1].mean).toBeCloseTo(0.02);
	});
});
