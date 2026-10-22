import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../schema";
import { createWebRegionResolver, type RegionResolver } from "./registry";
import { layerTarget, regionPlace, splitRegionKey } from "./targets";

/** A stand-in resolver: only Fresno County (`county:06019`) has a server id. */
const regions: RegionResolver = {
	resolve: vi.fn(async (type: string, code: string) =>
		type === "county" && code === "06019" ? "sq1" : null
	)
};

const base: Layer = { dataset: "air-quality", entryType: "pm25" };

describe("layerTarget", () => {
	it("maps a monitor place to its id", async () => {
		const layer: Layer = { ...base, place: { kind: "monitor", id: "m-pa" } };
		expect(await layerTarget(layer, regions)).toEqual({ kind: "monitors", ids: ["m-pa"] });
	});

	it("keys a resolvable region place by type and code, not sqid", async () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06019" } };
		expect(await layerTarget(layer, regions)).toEqual({
			kind: "regions",
			keys: ["county:06019"]
		});
	});

	it("reports a region the resolver doesn't know as region-unresolved", async () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06039" } };
		expect(await layerTarget(layer, regions)).toEqual({ unavailable: "region-unresolved" });
	});

	it("reports every region as region-unresolved with the web resolver", async () => {
		const layer: Layer = { ...base, place: { kind: "region", type: "county", code: "06019" } };
		expect(await layerTarget(layer, createWebRegionResolver())).toEqual({
			unavailable: "region-unresolved"
		});
	});

	it.each([
		{ kind: "point", lat: 36.7, lon: -119.8 },
		{ kind: "location", source: "schools", code: "123" },
		{ kind: "default-place" }
	] as const)("reports a $kind place as place-unsupported", async (place) => {
		expect(await layerTarget({ ...base, place }, regions)).toEqual({
			unavailable: "place-unsupported"
		});
	});

	it("maps a monitor selection to its ids", async () => {
		const layer: Layer = { ...base, selection: { kind: "monitors", ids: ["m-pa", "m-bam"] } };
		expect(await layerTarget(layer, regions)).toEqual({
			kind: "monitors",
			ids: ["m-pa", "m-bam"]
		});
	});

	it("maps a region selection when every region resolves", async () => {
		const both: RegionResolver = { resolve: async (_t, code) => `sq-${code}` };
		const layer: Layer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, both)).toEqual({
			kind: "regions",
			keys: ["county:06019", "county:06039"]
		});
	});

	it("reports a region selection with any unresolved region as region-unresolved", async () => {
		const layer: Layer = {
			...base,
			selection: { kind: "regions", ids: ["county:06019", "county:06039"] }
		};
		expect(await layerTarget(layer, regions)).toEqual({ unavailable: "region-unresolved" });
	});

	it("targets the whole layer with neither a place nor a selection", async () => {
		expect(await layerTarget(base, regions)).toEqual({ kind: "all" });
	});
});

describe("region keys", () => {
	it("split into type and code and name the series place", () => {
		expect(splitRegionKey("county:06019")).toEqual({ type: "county", code: "06019" });
		expect(regionPlace("county:06019")).toBe("region:county:06019");
	});
});
