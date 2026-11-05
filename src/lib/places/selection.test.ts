import { describe, expect, it } from "vitest";
import type { PlaceRef } from "$lib/data/schema";
import { blockReason, fromLayer, toggle, toLayerPlaces, type PickerMode } from "./selection";

const single: PickerMode = { kind: "single" };
const multi = (max = 3): PickerMode => ({ kind: "multiple", max });

const fresno: PlaceRef = { kind: "region", type: "county", code: "06019" };
const kern: PlaceRef = { kind: "region", type: "county", code: "06107" };
const mon1: PlaceRef = { kind: "monitor", id: "m1" };
const mon2: PlaceRef = { kind: "monitor", id: "m2" };
const school: PlaceRef = { kind: "location", source: "schools", code: "s1" };
const point: PlaceRef = { kind: "point", lat: 36.7, lon: -119.8 };

describe("blockReason", () => {
	it("never blocks in single mode", () => {
		expect(blockReason([fresno], mon1, single)).toBeNull();
		expect(blockReason([school], point, single)).toBeNull();
	});
	it("does not block with nothing picked", () => {
		for (const c of [fresno, mon1, school, point]) expect(blockReason([], c, multi())).toBeNull();
	});
	it("blocks the other kind", () => {
		expect(blockReason([fresno], mon1, multi())).toBe("other-kind-regions");
		expect(blockReason([mon1], fresno, multi())).toBe("other-kind-monitors");
	});
	it("allows the same kind", () => {
		expect(blockReason([fresno], kern, multi())).toBeNull();
		expect(blockReason([mon1], mon2, multi())).toBeNull();
	});
	it("blocks locations and points after anything", () => {
		expect(blockReason([fresno], school, multi())).toBe("single-only");
		expect(blockReason([mon1], point, multi())).toBe("single-only");
	});
	it("blocks everything after a location or point", () => {
		for (const c of [fresno, mon1, school, point, kern]) {
			expect(blockReason([school], c, multi())).toBe(c === school ? null : "alone-picked");
		}
		expect(blockReason([point], fresno, multi())).toBe("alone-picked");
	});
	it("blocks a new candidate at the cap but lets a picked one go", () => {
		const picks = [mon1, mon2];
		expect(blockReason(picks, { kind: "monitor", id: "m3" }, multi(2))).toBe("at-cap");
		expect(blockReason(picks, mon1, multi(2))).toBeNull();
	});
	it("never allows a default place", () => {
		expect(blockReason([], { kind: "default-place" }, multi())).toBe("single-only");
	});
});

describe("toggle", () => {
	it("replaces in single mode", () => {
		expect(toggle([fresno], kern, single)).toEqual([kern]);
	});
	it("adds, removes, and ignores blocked candidates", () => {
		expect(toggle([fresno], kern, multi())).toEqual([fresno, kern]);
		expect(toggle([fresno, kern], fresno, multi())).toEqual([kern]);
		expect(toggle([fresno], mon1, multi())).toEqual([fresno]);
		expect(toggle([fresno, kern], { kind: "region", type: "county", code: "x" }, multi(2))).toEqual(
			[fresno, kern]
		);
	});
});

describe("toLayerPlaces", () => {
	it("maps picks to layer fields", () => {
		expect(toLayerPlaces([])).toEqual({});
		expect(toLayerPlaces([fresno])).toEqual({ place: fresno });
		expect(toLayerPlaces([fresno, kern])).toEqual({
			selection: { kind: "regions", ids: ["county:06019", "county:06107"] }
		});
		expect(toLayerPlaces([mon1, mon2])).toEqual({
			selection: { kind: "monitors", ids: ["m1", "m2"] }
		});
	});
});

describe("fromLayer", () => {
	it("round-trips", () => {
		for (const picks of [[], [school], [fresno, kern], [mon1, mon2]]) {
			expect(fromLayer(toLayerPlaces(picks))).toEqual(picks);
		}
	});
	it("drops invalid region ids and default-place", () => {
		expect(
			fromLayer({ selection: { kind: "regions", ids: ["county:06019", "bad", ":x", "y:"] } })
		).toEqual([fresno]);
		expect(fromLayer({ place: { kind: "default-place" } })).toEqual([]);
	});
	it("loads a selection larger than the cap", () => {
		const ids = ["a", "b", "c", "d", "e", "f"];
		expect(fromLayer({ selection: { kind: "monitors", ids } })).toHaveLength(6);
		expect(blockReason(fromLayer({ selection: { kind: "monitors", ids } }), mon1, multi(5))).toBe(
			"at-cap"
		);
	});
});
