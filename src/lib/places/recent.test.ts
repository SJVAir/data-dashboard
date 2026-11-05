import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { RECENT_KEY, RECENT_MAX, addRecent, readRecent } from "./recent";

const space = "anonymous" as const;
const monitor = (id: string) => ({ kind: "monitor" as const, id });

describe("recent places", () => {
	it("reads an empty list when nothing is stored", async () => {
		expect(await readRecent(createMemoryPlatform(), space)).toEqual([]);
	});

	it("puts the newest first", async () => {
		const p = createMemoryPlatform();
		await addRecent(p, space, monitor("a"));
		await addRecent(p, space, { kind: "region", type: "city", code: "fresno" });
		expect(await readRecent(p, space)).toEqual([
			{ kind: "region", type: "city", code: "fresno" },
			monitor("a")
		]);
	});

	it("moves a re-pick to the top without duplicating", async () => {
		const p = createMemoryPlatform();
		await addRecent(p, space, monitor("a"));
		await addRecent(p, space, { kind: "location", source: "school", code: "x" });
		await addRecent(p, space, monitor("a"));
		expect(await readRecent(p, space)).toEqual([
			monitor("a"),
			{ kind: "location", source: "school", code: "x" }
		]);
	});

	it("treats different identity fields as different places", async () => {
		const p = createMemoryPlatform();
		await addRecent(p, space, { kind: "region", type: "city", code: "a" });
		await addRecent(p, space, { kind: "region", type: "county", code: "a" });
		expect(await readRecent(p, space)).toHaveLength(2);
	});

	it("never exceeds the maximum", async () => {
		const p = createMemoryPlatform();
		for (let i = 0; i < RECENT_MAX + 4; i++) await addRecent(p, space, monitor(`m${i}`));
		const list = await readRecent(p, space);
		expect(list).toHaveLength(RECENT_MAX);
		expect(list[0]).toEqual(monitor(`m${RECENT_MAX + 3}`));
	});

	it("ignores points and the default place", async () => {
		const p = createMemoryPlatform();
		await addRecent(p, space, { kind: "point", lat: 36, lon: -119 });
		await addRecent(p, space, { kind: "default-place" });
		expect(await readRecent(p, space)).toEqual([]);
	});

	it("reads back [] for a stored value that fails the schema", async () => {
		const p = createMemoryPlatform();
		await p.preferences.set(space, RECENT_KEY, [{ kind: "point", lat: 1, lon: 2 }]);
		expect(await readRecent(p, space)).toEqual([]);
		await p.preferences.set(space, RECENT_KEY, "nope");
		expect(await readRecent(p, space)).toEqual([]);
	});
});
