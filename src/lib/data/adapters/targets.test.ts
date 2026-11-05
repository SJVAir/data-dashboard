import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../schema";
import type { LocationResolver, PointResolver, RegionResolver } from "./registry";
import { layerTarget, regionPlace, splitRegionKey } from "./targets";

/** A stand-in resolver: Fresno County, the city of Fresno and two of its ZIPs have server ids. */
const KNOWN = new Set(["county:06019", "city:0627000", "zipcode:93702", "zipcode:93721"]);
const regions: RegionResolver = {
	resolve: vi.fn(async (type: string, code: string) =>
		KNOWN.has(`${type}:${code}`) ? { id: `sq-${code}`, name: code } : null
	)
};

/** A stand-in location resolver: only school `cde-public:10621661035023` exists. */
const locations: LocationResolver = {
	resolve: vi.fn(async (source: string, code: string) =>
		source === "cde-public" && code === "10621661035023"
			? { name: "Roosevelt High School", keys: ["zipcode:93702", "city:0627000", "county:06019"] }
			: null
	)
};

/** A stand-in point resolver: points north of 40° are outside every region. */
const points: PointResolver = {
	keys: vi.fn(async (lat: number) => (lat > 40 ? [] : ["zipcode:93721", "county:06019"]))
};

const ctx = { regions, locations, points };

const base: Layer = { dataset: "air-quality", entryType: "pm25" };

describe("layerTarget", () => {
	it("maps a monitor place to its id", async () => {
		const layer: Layer = { ...base, place: { kind: "monitor", id: "m-pa" } };
		expect(await layerTarget(layer, ctx)).toEqual({ kind: "monitors", ids: ["m-pa"] });
	});

	it("keys a resolvable region place by type and code, not sqid", async () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06019" } };
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "regions",
			keys: ["county:06019"]
		});
	});

	it("reports a region the resolver doesn't know as region-unresolved", async () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06039" } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "region-unresolved" });
	});

	it("reports a default place as place-unsupported", async () => {
		const layer: Layer = { ...base, place: { kind: "default-place" } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "place-unsupported" });
	});

	it("tries a school's own regions in order, named by the school", async () => {
		const layer: Layer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "10621661035023" }
		};
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "fallback",
			via: { kind: "location", name: "Roosevelt High School" },
			keys: ["zipcode:93702", "city:0627000", "county:06019"]
		});
	});

	it("keeps a retired school's retirement on its fallback", async () => {
		const retired = {
			since: "2026-06-30",
			replacedBy: { source: "cde-public", code: "10621661035024" }
		};
		const layer: Layer = { ...base, place: { kind: "location", source: "cde-public", code: "1" } };
		const target = await layerTarget(layer, {
			...ctx,
			locations: { resolve: async () => ({ name: "Old School", keys: ["county:06019"], retired }) }
		});
		expect(target).toEqual({
			kind: "fallback",
			via: { kind: "location", name: "Old School", retired },
			keys: ["county:06019"]
		});
	});

	it("reports a school that doesn't resolve as location-unresolved", async () => {
		const layer: Layer = { ...base, place: { kind: "location", source: "cde-public", code: "0" } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "location-unresolved" });
	});

	it("reports a school in no region as location-unresolved", async () => {
		const layer: Layer = { ...base, place: { kind: "location", source: "cde-public", code: "1" } };
		const target = await layerTarget(layer, {
			...ctx,
			locations: { resolve: async () => ({ name: "Nowhere School", keys: [] }) }
		});
		expect(target).toEqual({ unavailable: "location-unresolved" });
	});

	it("tries a point's containing regions in order", async () => {
		const layer: Layer = { ...base, place: { kind: "point", lat: 36.737, lon: -119.787 } };
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "fallback",
			via: { kind: "point" },
			keys: ["zipcode:93721", "county:06019"]
		});
	});

	it("leaves out candidates the region resolver doesn't know", async () => {
		const layer: Layer = { ...base, place: { kind: "point", lat: 36.737, lon: -119.787 } };
		const target = await layerTarget(layer, {
			...ctx,
			points: { keys: async () => ["zipcode:99999", "county:06019"] }
		});
		expect(target).toEqual({ kind: "fallback", via: { kind: "point" }, keys: ["county:06019"] });
	});

	it("reports a point in no region as point-outside", async () => {
		const layer: Layer = { ...base, place: { kind: "point", lat: 45, lon: -119.787 } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "point-outside" });
	});

	it("maps a monitor selection to its ids", async () => {
		const layer: Layer = { ...base, selection: { kind: "monitors", ids: ["m-pa", "m-bam"] } };
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "monitors",
			ids: ["m-pa", "m-bam"]
		});
	});

	it("maps a region selection when every region resolves", async () => {
		const both: RegionResolver = {
			resolve: async (_t, code) => ({ id: `sq-${code}`, name: code })
		};
		const layer: Layer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, { ...ctx, regions: both })).toEqual({
			kind: "regions",
			keys: ["county:06019", "county:06039"]
		});
	});

	it("reports a region selection with any unresolved region as region-unresolved", async () => {
		const layer: Layer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "region-unresolved" });
	});

	it("targets the whole layer with neither a place nor a selection", async () => {
		expect(await layerTarget(base, ctx)).toEqual({ kind: "all" });
	});
});

describe("region keys", () => {
	it("split into type and code and name the series place", () => {
		expect(splitRegionKey("county:06019")).toEqual({ type: "county", code: "06019" });
		expect(regionPlace("county:06019")).toBe("region:county:06019");
	});
});
