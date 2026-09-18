import { SvelteMap } from "svelte/reactivity";
import { describe, expect, it } from "vitest";
import { monitorsTabManager } from "./monitors-tab.svelte";

// This repo's vitest config runs .test.ts files through Vite's SSR transform
// (import.meta.env.SSR is true here), which compiles Svelte's $effect as a
// no-op, so there's no way to drive a real $effect.root()/flushSync()
// reactivity check without adding a DOM test environment (jsdom/happy-dom)
// as a new dependency. Instead, this pins the specific fix directly:
// regionSelections must stay a SvelteMap (not a plain Map) for
// toggleRegion()'s mutations to be reactive at all once the app runs in a
// browser, where $state does not deep-proxy plain Map/Set mutations.
describe("MonitorsTabManager selection state", () => {
	it("keeps regionSelections as a reactive SvelteMap", () => {
		expect(monitorsTabManager.regionSelections).toBeInstanceOf(SvelteMap);
	});

	it("toggleRegion adds and removes a region from the active type's selection", () => {
		monitorsTabManager.toggleRegion("region-reactivity-test");
		expect(monitorsTabManager.selectedRegionIds.has("region-reactivity-test")).toBe(true);

		monitorsTabManager.toggleRegion("region-reactivity-test");
		expect(monitorsTabManager.selectedRegionIds.has("region-reactivity-test")).toBe(false);
	});
});
