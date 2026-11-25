import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticideLocations: vi.fn()
}));

const fakes = vi.hoisted(() => ({
	regions: vi.fn<(type: string, code: string) => Promise<unknown>>(),
	locations: vi.fn<(source: string, code: string) => Promise<unknown>>(),
	placeRegion: vi.fn<(input: unknown) => Promise<{ type: string; code: string } | null>>()
}));

vi.mock("$lib/data", () => ({
	getResolvers: () => ({
		regions: { resolve: (type: string, code: string) => fakes.regions(type, code) },
		locations: { resolve: (source: string, code: string) => fakes.locations(source, code) }
	}),
	placeRegion: (input: unknown) => fakes.placeRegion(input)
}));

import { getPesticideLocations } from "@sjvair/sdk";
import type { NowSource } from "$lib/data/now/client";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { widgetEffective, widgetInputs } from "$lib/widgets/shared/input";
import { mapNotShown } from "../not-shown";
import {
	locationAreas,
	locationsEntry,
	resetLocationsCache,
	type LocationsData
} from "./locations";

type Src = NowSource<LocationsData>;

const get = vi.mocked(getPesticideLocations);

const LOCATIONS: Layer = { dataset: "locations", locationTypes: ["a"] };
const PM25: Layer = { dataset: "air-quality", entryType: "pm25" };

const site = (id: string) => ({
	type: "Feature" as const,
	id,
	geometry: { type: "Point" as const, coordinates: [0, 0] as [number, number] },
	properties: {
		id,
		source: "x",
		external_id: id,
		name: `Site ${id}`,
		type: "a",
		type_label: "A",
		address: "",
		city: null,
		school_district: null,
		school_district_id: null,
		school_district_url: null,
		grade_span: null,
		enrollment: null,
		capacity: null
	}
});

const collection = (...ids: string[]) =>
	({ type: "FeatureCollection", features: ids.map(site) }) as never;

const sqid = (type: string, code: string) => `sq-${type}-${code}`;

const withWhere = (where: Partial<WidgetDataConfig>, layers: Layer[] = [PM25, LOCATIONS]) =>
	({ ...where, layers }) as WidgetDataConfig;

const COUNTY = { place: { kind: "region", type: "county", code: "fresno" } } as const;

async function sourceOf(data: WidgetDataConfig) {
	return locationsEntry.source({ data, entryType: "", at: "now" });
}

async function load(data: WidgetDataConfig) {
	const source = (await sourceOf(data)) as Src;
	return source.fetch(new AbortController().signal);
}

const regionsAsked = () =>
	get.mock.calls.map((c) => (c[0] as unknown as { region?: string }).region).sort();

beforeEach(() => {
	resetLocationsCache();
	get.mockReset();
	get.mockImplementation(async (params) => {
		const region = (params as { region?: string } | undefined)?.region;
		if (region === undefined) return collection("v1", "v2", "v3");
		if (region === sqid("county", "fresno")) return collection("s1", "s2");
		if (region === sqid("city", "clovis")) return collection("s2", "s3");
		return collection("s9");
	});
	fakes.regions.mockReset();
	fakes.regions.mockImplementation(async (type, code) => ({ id: sqid(type, code), name: code }));
	fakes.locations.mockReset();
	fakes.placeRegion.mockReset();
});

describe("locationAreas", () => {
	it("a county is its sqid; a selection is each area's", async () => {
		expect(await locationAreas(withWhere(COUNTY))).toEqual([sqid("county", "fresno")]);
		const selection = withWhere({
			selection: { kind: "regions", ids: ["county:fresno", "city:clovis"] }
		});
		expect(await locationAreas(selection)).toEqual([
			sqid("city", "clovis"),
			sqid("county", "fresno")
		]);
	});

	it("a school is its first fallback key's region (the ZIP)", async () => {
		fakes.locations.mockResolvedValue({
			name: "A school",
			keys: ["zipcode:93721", "city:fresno", "county:fresno"]
		});
		const data = withWhere({ place: { kind: "location", source: "cde", code: "123" } });
		expect(await locationAreas(data)).toEqual([sqid("zipcode", "93721")]);
		expect(fakes.locations).toHaveBeenCalledWith("cde", "123");
	});

	it("a point is the region placeRegion gives, looked up for the Map's pollutant", async () => {
		fakes.placeRegion.mockResolvedValue({ type: "zipcode", code: "93650" });
		const data = withWhere({ place: { kind: "point", lat: 1, lon: 2 } });
		expect(await locationAreas(data)).toEqual([sqid("zipcode", "93650")]);
		const input = fakes.placeRegion.mock.calls[0][0] as { layer: Layer };
		expect(input.layer).toMatchObject({ dataset: "air-quality", entryType: "pm25" });
	});

	it("a point on a Map without a pollutant is looked up as PM2.5", async () => {
		fakes.placeRegion.mockResolvedValue({ type: "zipcode", code: "93650" });
		const data = withWhere({ place: { kind: "point", lat: 1, lon: 2 } }, [LOCATIONS]);
		expect(await locationAreas(data)).toEqual([sqid("zipcode", "93650")]);
		const input = fakes.placeRegion.mock.calls[0][0] as { layer: Layer };
		expect(input.layer).toMatchObject({ dataset: "air-quality", entryType: "pm25" });
	});

	it("a school falls back to the first of its keys that resolves (the city, without a ZIP)", async () => {
		fakes.locations.mockResolvedValue({
			name: "A school",
			keys: ["zipcode:93721", "city:fresno", "county:fresno"]
		});
		fakes.regions.mockImplementation(async (type, code) =>
			type === "zipcode" ? null : { id: sqid(type, code), name: code }
		);
		const data = withWhere({ place: { kind: "location", source: "cde", code: "123" } });
		expect(await locationAreas(data)).toEqual([sqid("city", "fresno")]);
		await load(data);
		expect(regionsAsked()).toEqual([sqid("city", "fresno")]);

		// None resolving: the place is gone.
		fakes.regions.mockResolvedValue(null);
		expect(await locationAreas(data)).toEqual({ unavailable: "region-unresolved" });
	});

	it("a key or selection id with no colon is no region", async () => {
		fakes.locations.mockResolvedValue({ name: "A school", keys: ["bad", "city:fresno"] });
		const school = withWhere({ place: { kind: "location", source: "cde", code: "123" } });
		expect(await locationAreas(school)).toEqual([sqid("city", "fresno")]);
		expect(fakes.regions).not.toHaveBeenCalledWith("", "bad");
		const selection = withWhere({ selection: { kind: "regions", ids: ["bad"] } });
		expect(await locationAreas(selection)).toEqual({ unavailable: "region-unresolved" });
	});

	it("a selection's regions are looked up together; the first gone one, in order, decides", async () => {
		const asked: string[] = [];
		const waiting: (() => void)[] = [];
		fakes.regions.mockImplementation(
			(type, code) =>
				new Promise((resolve) => {
					asked.push(`${type}:${code}`);
					waiting.push(() =>
						resolve(
							type === "city" ? null : type === "county" ? "unsupported" : { id: code, name: code }
						)
					);
				})
		);
		const data = withWhere({
			selection: { kind: "regions", ids: ["zipcode:1", "city:clovis", "county:fresno"] }
		});
		const found = locationAreas(data);
		await vi.waitFor(() => expect(asked).toHaveLength(3));
		for (const release of waiting) release();
		expect(await found).toEqual({ unavailable: "region-unresolved" });
	});

	it("a place with no region on the server is unavailable, each with its reason", async () => {
		fakes.regions.mockResolvedValue(null);
		expect(await locationAreas(withWhere(COUNTY))).toEqual({ unavailable: "region-unresolved" });
		fakes.regions.mockResolvedValue("unsupported");
		expect(await locationAreas(withWhere(COUNTY))).toEqual({ unavailable: "place-unsupported" });
		fakes.locations.mockResolvedValue(null);
		const school = withWhere({ place: { kind: "location", source: "cde", code: "1" } });
		expect(await locationAreas(school)).toEqual({ unavailable: "location-unresolved" });
		fakes.locations.mockResolvedValue({ name: "No keys", keys: [] });
		expect(await locationAreas(school)).toEqual({ unavailable: "location-unresolved" });
		fakes.placeRegion.mockResolvedValue(null);
		const point = withWhere({ place: { kind: "point", lat: 1, lon: 2 } });
		expect(await locationAreas(point)).toEqual({ unavailable: "point-outside" });
		const starter = withWhere({ place: { kind: "default-place" } });
		expect(await locationAreas(starter)).toEqual({ unavailable: "place-unsupported" });
	});

	it("no Where has no areas", async () => {
		expect(await locationAreas(withWhere({}))).toEqual([]);
	});
});

describe("locationsEntry", () => {
	it("a county is one call for its sqid, with no type (every type is fetched)", async () => {
		const loaded = await load(withWhere(COUNTY));
		expect(get).toHaveBeenCalledTimes(1);
		const params = get.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(params.region).toBe(sqid("county", "fresno"));
		expect(params).not.toHaveProperty("type");
		expect(loaded.features.map((f) => f.id)).toEqual(["s1", "s2"]);
	});

	it("a county and a city are two calls; a site in both is drawn once", async () => {
		const data = withWhere({
			selection: { kind: "regions", ids: ["county:fresno", "city:clovis"] }
		});
		const loaded = await load(data);
		expect(regionsAsked()).toEqual([sqid("city", "clovis"), sqid("county", "fresno")]);
		expect(loaded.features.map((f) => f.id).sort()).toEqual(["s1", "s2", "s3"]);
	});

	it("a school loads its ZIP's sites; a point the region placeRegion gives", async () => {
		fakes.locations.mockResolvedValue({ name: "A school", keys: ["zipcode:93721"] });
		await load(withWhere({ place: { kind: "location", source: "cde", code: "123" } }));
		fakes.placeRegion.mockResolvedValue({ type: "zipcode", code: "93650" });
		await load(withWhere({ place: { kind: "point", lat: 1, lon: 2 } }));
		expect(regionsAsked()).toEqual([sqid("zipcode", "93650"), sqid("zipcode", "93721")]);
	});

	it("a region the server doesn't have is unavailable, with no call", async () => {
		fakes.regions.mockResolvedValue(null);
		expect(await sourceOf(withWhere(COUNTY))).toEqual({ unavailable: "region-unresolved" });
		expect(get).not.toHaveBeenCalled();
	});

	it("no Where loads no sites and makes no request", async () => {
		expect(await sourceOf(withWhere({}))).toBeNull();
		expect(get).not.toHaveBeenCalled();
	});

	it("an area's sites are fetched once and shared, never copied; a failure is fetched again", async () => {
		const first = await load(withWhere(COUNTY));
		const other: Layer = { dataset: "locations", locationTypes: ["b"] };
		const second = await load(withWhere(COUNTY, [other]));
		expect(get).toHaveBeenCalledTimes(1);
		expect(second.features).toBe(first.features);

		resetLocationsCache();
		get.mockClear();
		get.mockRejectedValueOnce(new Error("offline"));
		await expect(load(withWhere(COUNTY))).rejects.toThrow("offline");
		expect((await load(withWhere(COUNTY))).features.map((f) => f.id)).toEqual(["s1", "s2"]);
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("loads nothing without the layer, or with no type ticked", async () => {
		expect(await sourceOf(withWhere(COUNTY, [PM25]))).toBeNull();
		expect(await sourceOf(withWhere(COUNTY, [PM25, { dataset: "locations" }]))).toBeNull();
		const none: Layer = { dataset: "locations", locationTypes: [] };
		expect(await sourceOf(withWhere(COUNTY, [PM25, none]))).toBeNull();
		expect(fakes.regions).not.toHaveBeenCalled();
	});

	it("one area failing fails the whole load, never a partial list", async () => {
		get.mockImplementation(async (params) => {
			if ((params as { region: string }).region === sqid("city", "clovis")) {
				throw new Error("offline");
			}
			return collection("s1");
		});
		const data = withWhere({
			selection: { kind: "regions", ids: ["county:fresno", "city:clovis"] }
		});
		await expect(load(data)).rejects.toThrow("offline");
	});

	it("isn't tied to the day or the ticked types, and isn't polled", async () => {
		const now = (await sourceOf(withWhere(COUNTY))) as Src;
		const day = (await locationsEntry.source({
			data: withWhere(COUNTY),
			entryType: "",
			at: { day: "2026-11-10" }
		})) as Src;
		const other: Layer = { dataset: "locations", locationTypes: ["a", "b"] };
		const ticked = (await sourceOf(withWhere(COUNTY, [PM25, other]))) as Src;
		expect(day.key).toBe(now.key);
		expect(ticked.key).toBe(now.key);
		expect(now.key).toBe(`map-locations:${sqid("county", "fresno")}`);
	});

	it("an area's sites are fetched once and shared; a failure is fetched again", async () => {
		await load(withWhere(COUNTY));
		const selection = withWhere({
			selection: { kind: "regions", ids: ["county:fresno", "city:clovis"] }
		});
		await load(selection);
		expect(regionsAsked()).toEqual([sqid("city", "clovis"), sqid("county", "fresno")]);

		get.mockClear();
		get.mockRejectedValueOnce(new Error("offline"));
		const kings = withWhere({ place: { kind: "region", type: "county", code: "kings" } });
		await expect(load(kings)).rejects.toThrow("offline");
		await load(kings);
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("an abort rejects only its own load, not the shared fetch", async () => {
		let release!: () => void;
		get.mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(collection("s1"))))
		);
		const source = (await sourceOf(withWhere(COUNTY))) as Src;
		const aborted = new AbortController();
		const first = source.fetch(aborted.signal);
		const second = source.fetch(new AbortController().signal);
		aborted.abort();
		release();
		await expect(first).rejects.toThrow();
		expect((await second).features.map((f) => f.id)).toEqual(["s1"]);
		expect(get).toHaveBeenCalledTimes(1);
	});

	it("draws the loaded sites as they came, as a ready source", () => {
		const features = [site("s1")] as LocationsData["features"];
		const { locations } = locationsEntry.toDataSources(
			{ features },
			{ messages: {} as never, entryType: "" }
		);
		expect(locations.status).toEqual({ state: "ready" });
		expect(locations.features?.features).toBe(features);
	});
});

describe("a locations layer is never fetched as a dataset", () => {
	const catalog = [
		{
			id: "air-quality",
			label: "Air quality",
			entryTypes: [{ id: "pm25", kind: "pollutant", resolutions: ["raw", "hour", "day"] }]
		}
	] as never;
	const data = (layers: Layer[]): WidgetDataConfig =>
		({
			...COUNTY,
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers
		}) as WidgetDataConfig;

	it("a Map's inputs ask for its pollutant alone, nothing for the locations", () => {
		const inputs = widgetInputs({ type: "map", data: data([PM25, LOCATIONS]) }, catalog, "regions");
		expect(inputs.layer).toBe(PM25);
		expect(inputs.main?.layer.dataset).toBe("air-quality");
		expect(inputs.overlays).toEqual([]);
		expect(inputs.effective.misfits).toEqual([]);
		expect(inputs.effective.unusable).toBeUndefined();
		expect(mapNotShown(data([PM25, LOCATIONS]), inputs.effective)).toEqual([]);
	});

	it("a Map with only the locations asks for nothing", () => {
		const inputs = widgetInputs({ type: "map", data: data([LOCATIONS]) }, catalog, "regions");
		expect(inputs.layer).toBeUndefined();
		expect(inputs.main).toBeNull();
		expect(inputs.overlays).toEqual([]);
		const effective = widgetEffective({ type: "map", data: data([LOCATIONS]) }, catalog, "regions");
		expect(effective.unusable).toBeUndefined();
	});
});
