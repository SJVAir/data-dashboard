import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getDatasetCatalog: vi.fn(),
	getPesticidesForPlace: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getChemicalDetails: vi.fn(),
	getCommodityDetails: vi.fn(),
	getProductDetails: vi.fn(),
	getCoverage: vi.fn()
}));

import {
	getChemicalDetails,
	getCommodityDetails,
	getCoverage,
	getDatasetCatalog,
	getPesticidesForPlace,
	getPesticidesMeta,
	getProductDetails
} from "@sjvair/sdk";
import { resolveRange } from "$lib/format/range";
import { createWebMetadata } from "../metadata";
import { createQueryClient } from "../query/client";
import type { DateRangeSpec, Layer, PesticideFilters, Resolution } from "../schema";
import { PESTICIDE_USE_DATASET, SDK_DATASET_CATALOG } from "../testing/dataset-catalog";
import { fixtureMetadata } from "../testing/fixtures";
import type { QueryState, Target } from "../types";
import {
	FilterGone,
	filterLabels,
	pesticideMeta,
	resetPesticideCaches,
	toWire,
	pesticidesAdapter
} from "./pesticides";
import type { AdapterContext, AdapterRequest, RegionResolver } from "./registry";

const NOW = new Date("2026-11-05T19:00:00Z");

const regions: RegionResolver = {
	resolve: async (type, code) => {
		if (type === "county" && code === "06019") return { id: "sq1", name: "Fresno County" };
		if (type === "zipcode" && code === "93721") return { id: "sqz", name: "ZIP 93721" };
		return null;
	}
};

const ctxOf = (metadata = fixtureMetadata()): AdapterContext => ({
	metadata,
	regions,
	locations: {
		resolve: async () => ({
			name: "Roosevelt High School",
			keys: ["zipcode:93721", "county:06019"]
		})
	},
	points: { keys: async () => [] }
});

const META = {
	categories: [
		{ key: "carcinogen", label: "Carcinogen", description: "", in_use: true },
		{
			key: "toxic_air_contaminant",
			label: "Toxic Air Contaminant",
			description: "",
			in_use: true
		}
	],
	iarc_groups: [{ key: "1", label: "Group 1", description: "" }],
	methods: [{ key: "none", label: "Not reported" }],
	narrows: [{ key: "concern", label: "Chemicals of concern", description: "" }],
	placeholder_chemicals: []
};

function notFound(): Error {
	return new Error("Not found", { cause: { result: { status: 404 } } });
}

function badRequest(details: object): Error {
	return new Error("Bad request", { cause: { result: { status: 400 }, details } });
}

const month = (year: number, m: number, pounds: number) => ({
	year,
	month: m,
	pounds,
	acres: pounds / 10,
	applications: pounds / 100
});
const yearRow = (year: number, pounds: number, undated = 0) => ({
	year,
	pounds: pounds + undated,
	acres: (pounds + undated) / 10,
	applications: (pounds + undated) / 100,
	undated: { pounds: undated, acres: undated / 10, applications: undated / 100 }
});
const response = (months: object[], years: object[]) => ({ place: {}, months, years }) as never;

function request(
	target: Target,
	opts: {
		entryType?: string;
		resolution?: Resolution;
		spec?: DateRangeSpec;
		filters?: PesticideFilters;
	} = {}
): AdapterRequest {
	return {
		entryType: opts.entryType ?? "pounds-applied",
		target,
		resolution: opts.resolution ?? "month",
		downsampleFromRaw: false,
		range: resolveRange(
			opts.spec ?? { kind: "custom", start: "2023-11-01", end: "2024-02-29" },
			NOW
		),
		offered: ["month", "year"],
		worstHour: false,
		now: NOW,
		...(opts.filters && { filters: opts.filters })
	};
}

const county: Target = { kind: "regions", keys: ["county:06019"] };
let signal: AbortSignal;
let ctx: AdapterContext;

beforeEach(() => {
	vi.resetAllMocks();
	resetPesticideCaches();
	signal = new AbortController().signal;
	vi.mocked(getDatasetCatalog).mockResolvedValue({
		...SDK_DATASET_CATALOG,
		datasets: [...SDK_DATASET_CATALOG.datasets, PESTICIDE_USE_DATASET]
	});
	vi.mocked(getCoverage).mockResolvedValue({
		dataset: "pesticide-use",
		entry_type: null,
		first: "2018-01-01",
		last: "2023-12-31"
	});
	vi.mocked(getPesticidesMeta).mockResolvedValue(META as never);
	vi.mocked(getPesticidesForPlace).mockResolvedValue(response([], []));
	ctx = ctxOf(fixtureMetadata({ catalog: createWebMetadata().catalog }));
});

describe("pesticidesAdapter", () => {
	it("offers months and years, as overlays too", () => {
		expect(pesticidesAdapter.offered(["month", "year"], county)).toEqual(["month", "year"]);
		expect(pesticidesAdapter.offered(["day", "month", "quarter"], county)).toEqual(["month"]);
		expect(pesticidesAdapter.overlays?.({} as never)).toBe(true);
	});

	it("months fill zeros inside coverage only", async () => {
		vi.mocked(getPesticidesForPlace).mockResolvedValue(
			response([month(2023, 11, 500)], [yearRow(2023, 500)])
		);
		const data = await pesticidesAdapter.fetch(request(county), ctx, signal);
		const points = data.series[0].points;
		expect(points.map((p) => [new Date(p.t).toISOString(), p.mean])).toEqual([
			["2023-11-01T07:00:00.000Z", 500],
			["2023-12-01T08:00:00.000Z", 0]
		]);
		expect(points[0]).toMatchObject({ min: 500, max: 500, count: 1, partial: false });
		expect(data.resolution).toBe("month");
		expect(data.places).toEqual([{ place: "region:county:06019", name: "Fresno County" }]);
	});

	it("reads the field of each entry type", async () => {
		vi.mocked(getPesticidesForPlace).mockResolvedValue(
			response([month(2023, 11, 500)], [yearRow(2023, 500)])
		);
		const read = async (entryType: string) =>
			(await pesticidesAdapter.fetch(request(county, { entryType }), ctx, signal)).series[0]
				.points[0].mean;
		expect(await read("pounds-applied")).toBe(500);
		expect(await read("acres-treated")).toBe(50);
		expect(await read("applications")).toBe(5);
	});

	it("yearly totals include undated use", async () => {
		vi.mocked(getPesticidesForPlace).mockResolvedValue(
			response(
				[month(2022, 1, 100), month(2022, 2, 100)],
				[yearRow(2022, 200, 50), yearRow(2023, 10)]
			)
		);
		const data = await pesticidesAdapter.fetch(
			request(county, {
				resolution: "year",
				spec: { kind: "custom", start: "2022-01-01", end: "2023-12-31" }
			}),
			ctx,
			signal
		);
		expect(data.resolution).toBe("year");
		expect(data.series[0].points.map((p) => p.mean)).toEqual([250, 10]);
		expect(data.series[0].points.every((p) => !p.partial)).toBe(true);
	});

	it("filters go out on the wire", async () => {
		const filters: PesticideFilters = {
			chemical: "hp8nm",
			category: ["carcinogen", "toxic_air_contaminant"],
			method: "none",
			narrow: "concern"
		};
		vi.mocked(getChemicalDetails).mockResolvedValue({
			id: "hp8nm",
			display_name: "Glyphosate"
		} as never);
		await pesticidesAdapter.fetch(request(county, { filters }), ctx, signal);
		expect(vi.mocked(getPesticidesForPlace).mock.calls[0][0]).toEqual({
			region: { type: "county", external_id: "06019" }
		});
		expect(vi.mocked(getPesticidesForPlace).mock.calls[0][1]).toEqual({
			chemical: "hp8nm",
			category: ["carcinogen", "toxic_air_contaminant"],
			aerial_ground: "none",
			narrow: "concern",
			year__gte: 2023,
			year__lte: 2024
		});
	});

	it("toWire renames the fields and leaves unset ones out", () => {
		const range = resolveRange({ kind: "custom", start: "2022-05-01", end: "2022-06-01" }, NOW);
		expect(toWire({ iarcGroup: "1", method: "A" }, range)).toEqual({
			iarc_group: "1",
			aerial_ground: "A",
			year__gte: 2022,
			year__lte: 2022
		});
	});

	it("a monitor goes as { monitor } and a school by its first key", async () => {
		const monitors = ctxOf(
			fixtureMetadata({
				catalog: createWebMetadata().catalog,
				monitors: async () => [{ id: "m-1", name: "Fresno", type: "purpleair" }] as never
			})
		);
		await pesticidesAdapter.fetch(request({ kind: "monitors", ids: ["m-1"] }), monitors, signal);
		expect(vi.mocked(getPesticidesForPlace).mock.calls[0][0]).toEqual({ monitor: "m-1" });
		const via = { kind: "location", source: "cde-public", code: "1", name: "Roosevelt" } as const;
		const data = await pesticidesAdapter.fetch(
			request({ kind: "fallback", via, keys: ["zipcode:93721", "county:06019"] }),
			ctx,
			signal
		);
		expect(vi.mocked(getPesticidesForPlace).mock.calls[1][0]).toEqual({
			region: { type: "zipcode", external_id: "93721" }
		});
		expect(data.places[0]).toMatchObject({ name: "ZIP 93721", via });
	});

	it("a fallback tries its next key when the first is not found", async () => {
		vi.mocked(getPesticidesForPlace)
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce(response([month(2023, 11, 5)], []));
		const via = { kind: "point" } as const;
		const data = await pesticidesAdapter.fetch(
			request({ kind: "fallback", via, keys: ["zipcode:93721", "county:06019"] }),
			ctx,
			signal
		);
		expect(data.places[0].name).toBe("Fresno County");
		expect(data.series[0].points[0].mean).toBe(5);
	});

	it("names the active filters on the place", async () => {
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Glyphosate" } as never);
		vi.mocked(getCommodityDetails).mockResolvedValue({ display_name: "Grapes" } as never);
		const data = await pesticidesAdapter.fetch(
			request(county, {
				filters: {
					chemical: "c1",
					commodity: "g1",
					category: ["carcinogen"],
					method: "none",
					narrow: "concern"
				}
			}),
			ctx,
			signal
		);
		expect(data.places[0].filters).toEqual([
			"Glyphosate",
			"Grapes",
			"Carcinogen",
			"Not reported",
			"Chemicals of concern"
		]);
	});

	it("a layer without filters has none on its place", async () => {
		const data = await pesticidesAdapter.fetch(request(county), ctx, signal);
		expect(data.places[0]).not.toHaveProperty("filters");
	});

	it("a range outside coverage gives an empty series, not an error", async () => {
		const spec: DateRangeSpec = { kind: "custom", start: "2026-10-06", end: "2026-11-05" };
		const monthly = await pesticidesAdapter.fetch(request(county, { spec }), ctx, signal);
		expect(monthly.series).toEqual([{ place: "region:county:06019", points: [] }]);
		const yearly = await pesticidesAdapter.fetch(
			request(county, { spec, resolution: "year" }),
			ctx,
			signal
		);
		expect(yearly.series[0].points).toEqual([]);
	});

	it("unknown coverage (no data at all) gives an empty series", async () => {
		vi.mocked(getCoverage).mockResolvedValue({
			dataset: "pesticide-use",
			entry_type: null,
			first: null,
			last: null
		});
		const data = await pesticidesAdapter.fetch(request(county), ctx, signal);
		expect(data.series[0].points).toEqual([]);
	});

	it("an unknown place gives an empty series", async () => {
		vi.mocked(getPesticidesForPlace).mockRejectedValue(notFound());
		const data = await pesticidesAdapter.fetch(request(county), ctx, signal);
		expect(data.series[0].points).toEqual([]);
	});

	it("a not_found filter during the fetch is an error", async () => {
		vi.mocked(getPesticidesForPlace).mockRejectedValue(
			badRequest({ chemical: [{ code: "not_found" }] })
		);
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Glyphosate" } as never);
		await expect(
			pesticidesAdapter.fetch(request(county, { filters: { chemical: "c1" } }), ctx, signal)
		).rejects.toBeInstanceOf(FilterGone);
	});

	it("any other failure is rethrown", async () => {
		const boom = new Error("boom");
		vi.mocked(getPesticidesForPlace).mockRejectedValue(boom);
		await expect(pesticidesAdapter.fetch(request(county), ctx, signal)).rejects.toBe(boom);
	});

	it("whole-layer and unsupported places are unavailable", async () => {
		expect(await pesticidesAdapter.target({ dataset: "pesticide-use" } as Layer, ctx)).toEqual({
			unavailable: "place-unsupported"
		});
	});
});

describe("target", () => {
	const layer = (filters?: PesticideFilters): Layer => ({
		dataset: "pesticide-use",
		entryType: "pounds-applied",
		place: { kind: "region", type: "county", code: "06019" },
		...(filters && { filters })
	});

	it("a removed chemical makes the layer filter-gone", async () => {
		vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
		expect(await pesticidesAdapter.target(layer({ chemical: "gone" }), ctx)).toEqual({
			unavailable: "filter-gone"
		});
		vi.mocked(getCommodityDetails).mockRejectedValue(notFound());
		expect(await pesticidesAdapter.target(layer({ commodity: "gone" }), ctx)).toEqual({
			unavailable: "filter-gone"
		});
		vi.mocked(getProductDetails).mockRejectedValue(notFound());
		expect(await pesticidesAdapter.target(layer({ product: "gone" }), ctx)).toEqual({
			unavailable: "filter-gone"
		});
	});

	it("present ids give the target, and each id is looked up once", async () => {
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Glyphosate" } as never);
		const filters = { chemical: "c1" };
		expect(await pesticidesAdapter.target(layer(filters), ctx)).toEqual({
			kind: "regions",
			keys: ["county:06019"]
		});
		await pesticidesAdapter.target(layer(filters), ctx);
		expect(getChemicalDetails).toHaveBeenCalledTimes(1);
	});

	it("a failed lookup does not block the layer and is retried", async () => {
		vi.mocked(getChemicalDetails)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ display_name: "Glyphosate" } as never);
		const first = await pesticidesAdapter.target(layer({ chemical: "c1" }), ctx);
		expect("unavailable" in first).toBe(false);
		await pesticidesAdapter.target(layer({ chemical: "c1" }), ctx);
		expect(getChemicalDetails).toHaveBeenCalledTimes(2);
	});

	it("a code the meta no longer lists makes the layer filter-gone", async () => {
		for (const filters of [
			{ category: ["carcinogen", "gone"] },
			{ iarcGroup: "9" },
			{ method: "gone" },
			{ narrow: "gone" }
		] satisfies PesticideFilters[]) {
			expect(await pesticidesAdapter.target(layer(filters), ctx)).toEqual({
				unavailable: "filter-gone"
			});
		}
		const known = { category: ["carcinogen"], iarcGroup: "1", method: "none", narrow: "concern" };
		expect(await pesticidesAdapter.target(layer(known), ctx)).toEqual({
			kind: "regions",
			keys: ["county:06019"]
		});
	});

	it("a failed meta lookup does not block the layer", async () => {
		vi.mocked(getPesticidesMeta).mockRejectedValueOnce(new Error("offline"));
		const target = await pesticidesAdapter.target(layer({ method: "none" }), ctx);
		expect("unavailable" in target).toBe(false);
	});

	it("filters without ids look nothing up", async () => {
		await pesticidesAdapter.target(layer({ category: ["carcinogen"] }), ctx);
		expect(getChemicalDetails).not.toHaveBeenCalled();
	});
});

describe("meta and labels", () => {
	it("pesticideMeta is fetched once", async () => {
		await pesticideMeta(signal);
		expect(await pesticideMeta(signal)).toBe(META);
		expect(getPesticidesMeta).toHaveBeenCalledTimes(1);
	});

	it("pesticideMeta retries after a failure", async () => {
		vi.mocked(getPesticidesMeta).mockRejectedValueOnce(new Error("offline"));
		await expect(pesticideMeta(signal)).rejects.toThrow("offline");
		expect(await pesticideMeta(signal)).toBe(META);
	});

	it("filterLabels gives display names and rejects with FilterGone on a 404", async () => {
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Glyphosate" } as never);
		vi.mocked(getProductDetails).mockRejectedValue(notFound());
		expect(await filterLabels({ chemical: "c1", category: ["carcinogen"] }, signal)).toEqual({
			chemical: "Glyphosate"
		});
		await expect(filterLabels({ product: "p1" }, signal)).rejects.toBeInstanceOf(FilterGone);
	});
});

describe("through the query client", () => {
	it("a daily request is served monthly", async () => {
		vi.mocked(getPesticidesForPlace).mockResolvedValue(response([month(2023, 11, 5)], []));
		const client = createQueryClient({
			adapters: [pesticidesAdapter],
			...ctx,
			metadata: createWebMetadata(),
			now: () => NOW
		});
		const states: QueryState[] = [];
		client.subscribe(
			{
				layer: {
					dataset: "pesticide-use",
					entryType: "pounds-applied",
					place: { kind: "region", type: "county", code: "06019" }
				},
				dateRange: { kind: "custom", start: "2023-11-01", end: "2023-11-30" },
				pin: "day"
			},
			(s) => states.push(s)
		);
		await vi.waitFor(() => expect(states.at(-1)?.status).toBe("ready"));
		const ready = states.at(-1);
		if (ready?.status !== "ready") throw new Error("not ready");
		expect(ready.data.resolution).toBe("month");
		expect(ready.data.series[0].points.map((p) => p.mean)).toEqual([5]);
	});
});
