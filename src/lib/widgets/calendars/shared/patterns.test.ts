import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { inkOf, tierPattern } from "./patterns";
import { loadPatterns, PATTERNS_KEY, patternsOn, setPatternsOn } from "./patterns-pref.svelte";

describe("tierPattern", () => {
	it("draws nothing for the lowest tier or none", () => {
		expect(tierPattern(0, "0,0,0")).toBeNull();
		expect(tierPattern(null, "0,0,0")).toBeNull();
	});
	it("tier 1: dots on a 5 px grid, in the ink", () => {
		const p = tierPattern(1, "0,0,0")!;
		expect(p).toContain("radial-gradient");
		expect(p).toContain("5px 5px");
		expect(p).toContain("rgb(0,0,0)");
	});
	it("tier 2: diagonal stripes; 3: cross-hatch; 4 and above: horizontal lines", () => {
		expect(tierPattern(2, "1,2,3")).toMatch(/^repeating-linear-gradient\(45deg, rgb\(1,2,3\)/);
		const hatch = tierPattern(3, "1,2,3")!;
		expect(hatch).toContain("45deg");
		expect(hatch).toContain("-45deg");
		expect(tierPattern(4, "1,2,3")).toMatch(/^repeating-linear-gradient\(0deg/);
		expect(tierPattern(5, "1,2,3")).toBe(tierPattern(4, "1,2,3"));
	});
	it("inkOf gives the readable ink on a color as an rgb triplet", () => {
		expect(inkOf("#ffff00")).toBe("0,0,0");
		expect(inkOf("#7e0023")).toBe("255,255,255");
	});
});

describe("the Show patterns preference", () => {
	it("is on by default, stored per space, and one state for every calendar", async () => {
		const p = createMemoryPlatform();
		loadPatterns(p, "anonymous");
		expect(patternsOn()).toBe(true);
		await setPatternsOn(false);
		expect(patternsOn()).toBe(false);
		expect(await p.preferences.get("anonymous", PATTERNS_KEY)).toBe(false);

		// Another space starts on, then reads its own stored value.
		loadPatterns(p, "account:2");
		expect(patternsOn()).toBe(true);
		loadPatterns(p, "anonymous");
		await expect.poll(() => patternsOn()).toBe(false);
	});
	it("a fresh platform reads on", () => {
		loadPatterns(createMemoryPlatform(), "anonymous");
		expect(patternsOn()).toBe(true);
	});
});
