import { describe, expect, it, vi } from "vitest";
import type { QueryLayer } from "../types";
import { fixtureMetadata } from "../testing/fixtures";
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

const ctx = { regions, locations, points, metadata: fixtureMetadata() };

const base: QueryLayer = { dataset: "air-quality", entryType: "pm25" };

describe("layerTarget", () => {
	it("maps one searched monitor to its id", async () => {
		const layer: QueryLayer = { ...base, monitors: ["m-pa"] };
		expect(await layerTarget(layer, ctx)).toEqual({ kind: "monitors", ids: ["m-pa"] });
	});

	it("reports a monitor absent from a loaded monitors list as monitor-unlisted", async () => {
		const layer: QueryLayer = { ...base, monitors: ["m-gone"] };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "monitor-unlisted" });
	});

	it("reports searched monitors with any absent id as monitor-unlisted", async () => {
		const layer: QueryLayer = { ...base, monitors: ["m-pa", "m-gone"] };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "monitor-unlisted" });
	});

	it("keeps searched monitors whose ids are all listed", async () => {
		const layer: QueryLayer = { ...base, monitors: ["m-pa", "m-bam"] };
		expect(await layerTarget(layer, ctx)).toEqual({ kind: "monitors", ids: ["m-pa", "m-bam"] });
	});

	it("takes searched monitors wherever they are: the Where doesn't narrow them", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "region", type: "county", code: "06019" },
			monitors: ["m-pa"]
		};
		expect(await layerTarget(layer, ctx)).toEqual({ kind: "monitors", ids: ["m-pa"] });
	});

	it("ticked types in a county give a monitor-set with its region key", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "region", type: "county", code: "06019" },
			monitorTypes: ["purpleair"],
			monitors: ["m-bam"]
		};
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "monitor-set",
			ids: ["m-bam"],
			types: ["purpleair"],
			regionKeys: ["county:06019"]
		});
	});

	it("types with an empty area list have no place either (never every monitor of them)", async () => {
		const layer = {
			...base,
			selection: { kind: "regions", ids: [] },
			monitorTypes: ["purpleair"]
		} as unknown as QueryLayer;
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "place-unsupported" });
	});

	it("types with no Where have no place to count them in", async () => {
		const layer: QueryLayer = { ...base, monitorTypes: ["purpleair", "airnow"] };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "place-unsupported" });
	});

	it("ticked types and searched monitors that don't measure the pollutant aren't fetched", async () => {
		// PurpleAir and the BAM measure PM2.5, not ozone; AirNow isn't in the meta (unknown: kept).
		const ozone: QueryLayer = {
			...base,
			place: { kind: "region", type: "county", code: "06019" },
			entryType: "o3",
			monitorTypes: ["purpleair", "airnow"],
			monitors: ["m-bam"]
		};
		expect(await layerTarget(ozone, ctx)).toEqual({
			kind: "monitor-set",
			ids: [],
			types: ["airnow"],
			regionKeys: ["county:06019"]
		});
		// Every ticked type dropped: never an empty type list (the bulk endpoint would send every type),
		// and nothing fetched: the widget says none of them measure it.
		expect(
			await layerTarget({ ...ozone, monitorTypes: ["purpleair"], monitors: ["m-bam"] }, ctx)
		).toEqual({ unavailable: "none-measure" });
		expect(
			await layerTarget({ ...ozone, monitorTypes: ["bam1022"], monitors: ["m-bam", "m-x"] }, ctx)
		).toEqual({ unavailable: "monitor-unlisted" });
		const pm25: QueryLayer = {
			...base,
			place: { kind: "region", type: "county", code: "06019" },
			monitorTypes: ["purpleair"],
			monitors: ["m-bam"]
		};
		expect(await layerTarget(pm25, ctx)).toMatchObject({ types: ["purpleair"], ids: ["m-bam"] });
	});

	it("another dataset's layer at the monitors takes them as places, whatever they measure", async () => {
		// A weather overlay at a Chart's searched monitors: the monitors are where, not what.
		const weather: QueryLayer = {
			dataset: "weather",
			entryType: "temperature",
			monitors: ["m-bam"]
		};
		expect(await layerTarget(weather, ctx)).toEqual({ kind: "monitors", ids: ["m-bam"] });
	});

	it("scopes ticked types by a school's first region", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "10621661035023" },
			monitorTypes: ["purpleair"]
		};
		expect(await layerTarget(layer, ctx)).toMatchObject({
			kind: "monitor-set",
			regionKeys: ["zipcode:93702"]
		});
	});

	it("reports ticked types in an unknown region as region-unresolved", async () => {
		const layer: QueryLayer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] },
			monitorTypes: ["purpleair"]
		};
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "region-unresolved" });
	});

	it("runs the query as before when the monitors list fails to load", async () => {
		const failing = {
			...ctx,
			metadata: fixtureMetadata({
				monitors: async () => {
					throw new Error("down");
				}
			})
		};
		const layer: QueryLayer = { ...base, monitors: ["m-gone"] };
		expect(await layerTarget(layer, failing)).toEqual({ kind: "monitors", ids: ["m-gone"] });
	});

	it("keys a resolvable region place by type and code, not sqid", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "region", type: "county", code: "06019" } };
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "regions",
			keys: ["county:06019"]
		});
	});

	it("reports a region the resolver doesn't know as region-unresolved", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "region", type: "county", code: "06039" } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "region-unresolved" });
	});

	it("reports a default place as place-unsupported", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "default-place" } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "place-unsupported" });
	});

	it("tries a school's own regions in order, named by the school", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "10621661035023" }
		};
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "fallback",
			via: {
				kind: "location",
				source: "cde-public",
				code: "10621661035023",
				name: "Roosevelt High School"
			},
			keys: ["zipcode:93702", "city:0627000", "county:06019"]
		});
	});

	it("keeps a retired school's retirement on its fallback", async () => {
		const retired = {
			since: "2026-06-30",
			replacedBy: { source: "cde-public", code: "10621661035024" }
		};
		const layer: QueryLayer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "1" }
		};
		const target = await layerTarget(layer, {
			...ctx,
			locations: { resolve: async () => ({ name: "Old School", keys: ["county:06019"], retired }) }
		});
		expect(target).toEqual({
			kind: "fallback",
			via: { kind: "location", source: "cde-public", code: "1", name: "Old School", retired },
			keys: ["county:06019"]
		});
	});

	it("reports a school that doesn't resolve as location-unresolved", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "0" }
		};
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "location-unresolved" });
	});

	it("reports a school in no region as location-unresolved", async () => {
		const layer: QueryLayer = {
			...base,
			place: { kind: "location", source: "cde-public", code: "1" }
		};
		const target = await layerTarget(layer, {
			...ctx,
			locations: { resolve: async () => ({ name: "Nowhere School", keys: [] }) }
		});
		expect(target).toEqual({ unavailable: "location-unresolved" });
	});

	it("tries a point's containing regions in order", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "point", lat: 36.737, lon: -119.787 } };
		expect(await layerTarget(layer, ctx)).toEqual({
			kind: "fallback",
			via: { kind: "point" },
			keys: ["zipcode:93721", "county:06019"]
		});
	});

	it("leaves out candidates the region resolver doesn't know", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "point", lat: 36.737, lon: -119.787 } };
		const target = await layerTarget(layer, {
			...ctx,
			points: { keys: async () => ["zipcode:99999", "county:06019"] }
		});
		expect(target).toEqual({ kind: "fallback", via: { kind: "point" }, keys: ["county:06019"] });
	});

	it("reports a point in no region as point-outside", async () => {
		const layer: QueryLayer = { ...base, place: { kind: "point", lat: 45, lon: -119.787 } };
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "point-outside" });
	});

	it("maps a region selection when every region resolves", async () => {
		const both: RegionResolver = {
			resolve: async (_t, code) => ({ id: `sq-${code}`, name: code })
		};
		const layer: QueryLayer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, { ...ctx, regions: both })).toEqual({
			kind: "regions",
			keys: ["county:06019", "county:06039"]
		});
	});

	it("reports a region selection with any unresolved region as region-unresolved", async () => {
		const layer: QueryLayer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, ctx)).toEqual({ unavailable: "region-unresolved" });
	});

	it("has nothing to target with neither a place nor a selection", async () => {
		expect(await layerTarget(base, ctx)).toEqual({ unavailable: "place-unsupported" });
	});
});

describe("region keys", () => {
	it("split into type and code and name the series place", () => {
		expect(splitRegionKey("county:06019")).toEqual({ type: "county", code: "06019" });
		expect(regionPlace("county:06019")).toBe("region:county:06019");
	});
});
