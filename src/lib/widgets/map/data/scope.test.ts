import { describe, expect, it, vi } from "vitest";
import type { Layer } from "$lib/data/schema";
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
const layer = (extra: Partial<Layer>): Layer => ({
	dataset: "air-quality",
	entryType: "pm25",
	...extra
});

describe("monitorScope", () => {
	it("scopes a region to its server id", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "region", type: "county", code: "06019" } }),
			ctx(known)
		);
		expect(s).toEqual({ kind: "regions", ids: ["sq-county-06019"], key: "sq-county-06019" });
	});

	it("scopes several regions, sorted", async () => {
		const s = await monitorScope(
			layer({ selection: { kind: "regions", ids: ["county:b", "county:a"] } }),
			ctx(known)
		);
		expect(s).toMatchObject({ kind: "regions", ids: ["sq-county-a", "sq-county-b"] });
	});

	it("scopes a school or point to its region, and the key holds no coordinates", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "point", lat: 36.7, lon: -119.7 } }),
			ctx(known)
		);
		expect(s).toMatchObject({ kind: "regions", ids: ["sq-county-06019"] });
		expect(JSON.stringify(s)).not.toMatch(/36\.7|-119\.7/);
	});

	it("is unavailable when a point is outside every region", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "point", lat: 1, lon: 2 } }),
			ctx(known, null)
		);
		expect(s).toEqual({ unavailable: "point-outside" });
	});

	it("scopes monitors to exactly their ids", async () => {
		const s = await monitorScope(
			layer({ selection: { kind: "monitors", ids: ["b", "a"] } }),
			ctx(known)
		);
		expect(s).toEqual({ kind: "monitors", ids: ["a", "b"], key: "a,b" });
		const one = await monitorScope(layer({ place: { kind: "monitor", id: "m" } }), ctx(known));
		expect(one).toMatchObject({ kind: "monitors", ids: ["m"] });
	});

	it("is unavailable when a region can't be resolved", async () => {
		const s = await monitorScope(
			layer({ place: { kind: "region", type: "county", code: "x" } }),
			ctx(() => null)
		);
		expect(s).toEqual({ unavailable: "region-unresolved" });
	});

	it("is unavailable with no place", async () => {
		expect(await monitorScope(layer({}), ctx(known))).toEqual({ unavailable: "place-unsupported" });
	});
});
