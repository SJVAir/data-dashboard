import { SvelteMap } from "svelte/reactivity";
import { describe, expect, it } from "vitest";
import { monitorsTabManager } from "./monitors-tab.svelte";

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
