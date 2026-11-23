import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticideTownships: vi.fn(),
	getPesticideSections: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getChemicalDetails: vi.fn(),
	getCommodityDetails: vi.fn(),
	getProductDetails: vi.fn()
}));

import {
	getChemicalDetails,
	getPesticideSections,
	getPesticideTownships,
	getPesticidesMeta
} from "@sjvair/sdk";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import {
	resetUseCaches,
	sectionsFor,
	TooLarge,
	townshipsFor,
	useFiltersGone,
	useQueryKey,
	type UseQuery
} from "./use";

const INFO = { label: "Pounds Applied", units: "lbs", precision: 0 };
const CLASS = { breaks: [10, 100], min: 1, colors: ["#111111", "#222222"] };
const CLASSES = { lbs_chemical: CLASS, acres_treated: CLASS, applications: CLASS };
const META = {
	categories: [{ key: "carcinogen", label: "Carcinogen", description: "", in_use: true }],
	iarc_groups: [],
	methods: [{ key: "A", label: "Aerial" }],
	narrows: [],
	placeholder_chemicals: [],
	notice_filters: [],
	years: [2023],
	scales: {}
};

/** A synthetic square at (x, y), 1 by 1. */
const square = (x: number, y: number) => ({
	type: "Polygon" as const,
	coordinates: [
		[
			[x, y],
			[x + 1, y],
			[x + 1, y + 1],
			[x, y + 1],
			[x, y]
		]
	]
});

const totals = (n: number) => ({
	lbs_chemical: n,
	lbs_product: n * 2,
	acres_treated: n * 3,
	applications: n * 4
});

function township(id: string, n: number, geometry: boolean) {
	return {
		type: "Feature",
		id,
		geometry: geometry ? square(n, 0) : null,
		properties: { id, name: id, sections: 36, ...totals(n) }
	};
}

function townships(geometry: boolean) {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: CLASSES,
		features: [township("T-A", 1, geometry), township("T-B", 2, geometry)]
	};
}

function sections() {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: CLASSES,
		features: [
			{
				type: "Feature",
				id: "s1",
				geometry: square(1, 1),
				properties: { id: "s1", mtrs: "T-A-01", county: "Somewhere", ...totals(5) }
			}
		]
	};
}

const query = (filters: UseQuery["filters"] = {}, month: number | null = null): UseQuery => ({
	figure: "pounds-applied",
	period: { year: 2023, month },
	filters,
	info: INFO
});

const BOX = { west: 1, south: 2, east: 3, north: 4 };

function badRequest(): Error {
	return new Error("Request failed", {
		cause: { result: { status: 400, body: { error: "bbox too large; zoom in" } } }
	});
}

beforeEach(() => {
	resetUseCaches();
	resetPesticideMeta();
	vi.mocked(getPesticideTownships).mockReset();
	vi.mocked(getPesticideSections).mockReset();
	vi.mocked(getPesticidesMeta).mockReset();
	vi.mocked(getPesticidesMeta).mockResolvedValue(META as never);
	vi.mocked(getChemicalDetails).mockReset();
	vi.mocked(getPesticideTownships).mockImplementation(
		async (params) => townships(params?.geometry !== false) as never
	);
	vi.mocked(getPesticideSections).mockImplementation(async () => sections() as never);
});
afterEach(() => vi.restoreAllMocks());

describe("use requests", () => {
	it("townships ask with geometry once, then values only, joined by id", async () => {
		const first = await townshipsFor(query(), new AbortController().signal);
		const second = await townshipsFor(query({}, 7), new AbortController().signal);
		const calls = vi.mocked(getPesticideTownships).mock.calls.map((c) => c[0]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).not.toHaveProperty("geometry");
		expect(calls[1]).toMatchObject({ geometry: false, month: 7 });
		expect(calls.every((c) => c?.classes === true)).toBe(true);
		expect(second.features.map((f) => f.geometry)).toEqual(first.features.map((f) => f.geometry));
		const [a] = second.features;
		expect(a.properties).toMatchObject({
			id: "T-A",
			name: "T-A",
			level: "township",
			township: "T-A",
			county: null,
			sections: 36,
			value: 1,
			lbs_chemical: 1,
			acres_treated: 3,
			applications: 4
		});
		expect(a.properties.refKey).toContain("township:T-A");
		expect(second.classes).toEqual(CLASSES);
	});

	it("sections carry their MTRS name, township and county", async () => {
		const loaded = await sectionsFor(query(), BOX, new AbortController().signal);
		expect(loaded.features[0].properties).toMatchObject({
			id: "s1",
			name: "T-A-01",
			level: "section",
			township: "T-A",
			county: "Somewhere",
			value: 5
		});
		expect(loaded.features[0].properties.refKey).toContain("section:s1");
		expect(vi.mocked(getPesticideSections).mock.calls[0][0]).toMatchObject({
			bbox: [1, 2, 3, 4],
			classes: true,
			year: 2023
		});
	});

	it("no request ever carries county, lat, lng, radius or region", async () => {
		const filters = { chemical: "c1", category: ["carcinogen"], method: "A" };
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Chem" } as never);
		await townshipsFor(query(filters), new AbortController().signal);
		await townshipsFor(query(filters, 3), new AbortController().signal);
		await sectionsFor(query(filters), BOX, new AbortController().signal);
		const params = [
			...vi.mocked(getPesticideTownships).mock.calls,
			...vi.mocked(getPesticideSections).mock.calls
		].map((c) => c[0] as Record<string, unknown>);
		expect(params.length).toBe(3);
		for (const p of params) {
			for (const key of ["county", "lat", "lng", "radius", "region", "buffer"]) {
				expect(p).not.toHaveProperty(key);
			}
		}
	});

	it("the filters become the map params", async () => {
		await townshipsFor(
			query({
				chemical: "c1",
				commodity: "k1",
				product: "p1",
				method: "A",
				category: ["carcinogen", "fumigant"],
				iarcGroup: "1",
				narrow: "concern"
			}),
			new AbortController().signal
		);
		expect(vi.mocked(getPesticideTownships).mock.calls[0][0]).toMatchObject({
			chemical_id: "c1",
			commodity_id: "k1",
			product_id: "p1",
			aerial_ground: "A",
			category: ["carcinogen", "fumigant"],
			iarc_group: "1",
			narrow: "concern"
		});
	});

	it("one request in flight per key, shared, and dropped on failure", async () => {
		let fail!: (e: unknown) => void;
		vi.mocked(getPesticideTownships).mockImplementationOnce(
			() => new Promise((_, reject) => (fail = reject))
		);
		const aborted = new AbortController();
		const a = townshipsFor(query(), aborted.signal);
		const b = townshipsFor(query(), new AbortController().signal);
		aborted.abort();
		await expect(a).rejects.toThrow();
		expect(getPesticideTownships).toHaveBeenCalledTimes(1);
		fail(new Error("offline"));
		await expect(b).rejects.toThrow("offline");
		// Dropped on failure: the next call asks again.
		await townshipsFor(query(), new AbortController().signal);
		expect(getPesticideTownships).toHaveBeenCalledTimes(2);
		// The same key again is served from the first answer.
		await townshipsFor(query(), new AbortController().signal);
		expect(getPesticideTownships).toHaveBeenCalledTimes(2);
	});

	it("the key ignores the figure and the filters' order", () => {
		const a = useQueryKey(query({ category: ["b", "a"], chemical: "c" }));
		const b = useQueryKey({
			...query({ chemical: "c", category: ["a", "b"] }),
			figure: "applications"
		});
		expect(a).toBe(b);
		expect(useQueryKey(query({}, 2))).not.toBe(useQueryKey(query()));
	});

	it("a 400 rejects with TooLarge", async () => {
		vi.mocked(getPesticideSections).mockRejectedValueOnce(badRequest());
		await expect(sectionsFor(query(), BOX, new AbortController().signal)).rejects.toBeInstanceOf(
			TooLarge
		);
	});

	it("filter-gone for a chemical the meta can't resolve", async () => {
		vi.mocked(getChemicalDetails).mockRejectedValue(
			new Error("Not found", { cause: { result: { status: 404 } } })
		);
		expect(await useFiltersGone({ chemical: "gone" })).toBe(true);
		expect(await useFiltersGone({ category: ["unknown-code"] })).toBe(true);
		expect(await useFiltersGone({ category: ["carcinogen"] })).toBe(false);
		expect(await useFiltersGone({})).toBe(false);
	});
});
