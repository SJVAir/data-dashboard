import { SvelteMap } from "svelte/reactivity";
import { describe, expect, it } from "vitest";
import { RegionsMeta } from "@sjvair/sdk";
import type { RegionData } from "@sjvair/sdk";
import { monitorsTabManager } from "./monitors-tab.svelte";

function makeRegion(id: string): RegionData {
	return { id, name: id, slug: id, type: "county", boundary: null } as RegionData;
}

// This repo's vitest config runs .test.ts files through Vite's SSR transform
// (import.meta.env.SSR is true here), which compiles Svelte's $effect as a
// no-op, so there's no way to drive a real $effect.root()/flushSync()
// reactivity check without adding a DOM test environment (jsdom/happy-dom)
// as a new dependency. Instead, this pins the specific fix directly:
// childSelectionsByType must stay a SvelteMap (not a plain Map) for
// toggleChildRegion()'s mutations to be reactive at all once the app runs in
// a browser, where $state does not deep-proxy plain Map/Set mutations.
describe("MonitorsTabManager selection state", () => {
	it("keeps childSelectionsByType as a reactive SvelteMap", () => {
		expect(monitorsTabManager.childSelectionsByType).toBeInstanceOf(SvelteMap);
	});

	it("toggleChildRegion adds and removes a region from that type's selection", () => {
		monitorsTabManager.toggleChildRegion("city", "region-reactivity-test");
		expect(
			monitorsTabManager.childSelectionsByType.get("city")?.has("region-reactivity-test")
		).toBe(true);

		monitorsTabManager.toggleChildRegion("city", "region-reactivity-test");
		expect(
			monitorsTabManager.childSelectionsByType.get("city")?.has("region-reactivity-test")
		).toBe(false);
	});
});

describe("MonitorsTabManager.selectedRegions", () => {
	it("aggregates the parent selection and every child type's selection with no duplicates", () => {
		monitorsTabManager.regionTypes = new RegionsMeta({
			types: {
				county: { type: "county", label: "County", category: "administrative" },
				city: { type: "city", label: "City", category: "administrative" },
				zipcode: { type: "zipcode", label: "Zip Code", category: "census" }
			}
		});
		monitorsTabManager.parentType = "county";

		const parentA = makeRegion("parent-a");
		const parentB = makeRegion("parent-b");
		monitorsTabManager.parentRegions = [parentA, parentB];
		monitorsTabManager.parentSelection = new Set([parentA.id]);

		const cityC = makeRegion("city-c");
		const cityD = makeRegion("city-d");
		monitorsTabManager.childRegionsByType.set("city", [cityC, cityD]);
		monitorsTabManager.childSelectionsByType.set("city", new Set([cityC.id]));

		const zipE = makeRegion("zip-e");
		monitorsTabManager.childRegionsByType.set("zipcode", [zipE]);
		monitorsTabManager.childSelectionsByType.set("zipcode", new Set([zipE.id]));

		const selectedIds = monitorsTabManager.selectedRegions.map((region) => region.id).sort();
		expect(selectedIds).toEqual(["city-c", "parent-a", "zip-e"]);
	});

	// RegionList (what populates parentRegions/childRegionsByType) omits
	// boundary.geometry to keep large `within=` narrowing fast - full geometry
	// is fetched lazily per-region via getRegionDetails() once selected, and
	// cached in selectedRegionBoundaries. selectedRegions must overlay that
	// cached boundary onto the otherwise-geometry-less list result.
	it("overlays a cached full boundary onto a selected region that lacks one", () => {
		const bboxOnlyRegion = makeRegion("parent-a");
		monitorsTabManager.parentRegions = [bboxOnlyRegion];
		monitorsTabManager.parentSelection = new Set([bboxOnlyRegion.id]);
		monitorsTabManager.childRegionsByType.clear();
		monitorsTabManager.childSelectionsByType.clear();

		const fullBoundary = {
			id: "boundary-a",
			version: "2020",
			geometry: { type: "MultiPolygon", coordinates: [] },
			bbox: [0, 0, 1, 1]
		} as RegionData["boundary"];
		monitorsTabManager.selectedRegionBoundaries.set(bboxOnlyRegion.id, fullBoundary!);

		const [region] = monitorsTabManager.selectedRegions;
		expect(region.boundary).toEqual(fullBoundary);
	});

	it("falls back to the list-provided boundary before the cache is populated", () => {
		monitorsTabManager.selectedRegionBoundaries.clear();

		const bboxOnlyRegion = makeRegion("parent-a");
		monitorsTabManager.parentRegions = [bboxOnlyRegion];
		monitorsTabManager.parentSelection = new Set([bboxOnlyRegion.id]);
		monitorsTabManager.childRegionsByType.clear();
		monitorsTabManager.childSelectionsByType.clear();

		const [region] = monitorsTabManager.selectedRegions;
		expect(region.boundary).toBe(bboxOnlyRegion.boundary);
	});
});
