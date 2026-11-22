import { describe, expect, it, vi } from "vitest";
import type { QueryLayer } from "$lib/data/types";
import { monitorScope, type ScopeContext } from "./scope";

function ctx(
	resolve: (type: string, code: string) => unknown,
	region: { type: string; code: string } | null = { type: "county", code: "06019" }
): ScopeContext {
	return {
		regions: { resolve: vi.fn(async (t: string, c: string) => resolve(t, c)) } as never,
		placeRegion: vi.fn(async () => region)
	};
}

const known = (type: string, code: string) => ({ id: `sq-${type}-${code}`, name: code });
/** The air-quality layer with ticked types (PurpleAir unless `extra` says otherwise). */
const layer = (extra: Partial<QueryLayer>): QueryLayer => ({
	dataset: "air-quality",
	entryType: "pm25",
	monitorTypes: ["purpleair"],
	...extra
});

describe("monitorScope", () => {
	it("scopes ticked types in a region to its server id", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "region", type: "county", code: "06019" } }),
			ctx(known)
		);
		expect(s).toEqual({
			kind: "monitor-set",
			types: ["purpleair"],
			regionIds: ["sq-county-06019"],
			ids: [],
			key: "purpleair|sq-county-06019|"
		});
	});

	it("scopes several regions, types and searched monitors, sorted", async () => {
		const s = await monitorScope(
			layer({
				selection: { kind: "regions", ids: ["county:b", "county:a"] },
				monitorTypes: ["purpleair", "airnow"],
				monitors: ["m2", "m1"]
			}),
			ctx(known)
		);
		expect(s).toMatchObject({
			kind: "monitor-set",
			types: ["airnow", "purpleair"],
			regionIds: ["sq-county-a", "sq-county-b"],
			ids: ["m1", "m2"]
		});
	});

	it("ticked types with no Where are everywhere", async () => {
		const s = await monitorScope(layer({}), ctx(known));
		expect(s).toEqual({
			kind: "monitor-set",
			types: ["purpleair"],
			regionIds: null,
			ids: [],
			key: "purpleair|*|"
		});
	});

	it("scopes a school or point to its region, and the key holds no coordinates", async () => {
		const c = ctx(known);
		const s = await monitorScope(layer({ place: { kind: "point", lat: 36.7, lon: -119.7 } }), c);
		expect(s).toMatchObject({ kind: "monitor-set", regionIds: ["sq-county-06019"] });
		expect(JSON.stringify(s)).not.toMatch(/36\.7|-119\.7/);
		expect(c.placeRegion).toHaveBeenCalledOnce();
	});

	it("is unavailable when a point is outside every region", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "point", lat: 1, lon: 2 } }),
			ctx(known, null)
		);
		expect(s).toEqual({ unavailable: "point-outside" });
	});

	it("scopes searched monitors alone to exactly their ids, wherever the Where is", async () => {
		const s = await monitorScope(
			layer({
				monitorTypes: undefined,
				monitors: ["b", "a"],
				place: { kind: "region", type: "county", code: "06019" }
			}),
			ctx(known)
		);
		expect(s).toEqual({ kind: "monitors", ids: ["a", "b"], key: "a,b" });
	});

	it("a Map with no types and no monitors draws no monitors", async () => {
		const where = { place: { kind: "region", type: "county", code: "06019" } } as const;
		expect(await monitorScope(layer({ ...where, monitorTypes: [] }), ctx(known))).toBeNull();
		expect(await monitorScope(layer({ monitorTypes: undefined }), ctx(known))).toBeNull();
	});

	it("is unavailable when a region can't be resolved", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "region", type: "county", code: "x" } }),
			ctx(() => null)
		);
		expect(s).toEqual({ unavailable: "region-unresolved" });
	});

	it("is unavailable when the region resolver doesn't support the region", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "region", type: "county", code: "x" } }),
			ctx(() => "unsupported")
		);
		expect(s).toEqual({ unavailable: "place-unsupported" });
		const several = await monitorScope(
			layer({ selection: { kind: "regions", ids: ["county:a", "city:b"] } }),
			ctx((type) => (type === "city" ? "unsupported" : known(type, "a")))
		);
		expect(several).toEqual({ unavailable: "place-unsupported" });
	});

	it("is unavailable at the starter's unresolved place", async () => {
		expect(await monitorScope(layer({ place: { kind: "default-place" } }), ctx(known))).toEqual({
			unavailable: "place-unsupported"
		});
	});
});
