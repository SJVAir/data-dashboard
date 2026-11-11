import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import { DEFAULT_LAYER } from "$lib/widgets/defaults";
import { STARTER_PLACE_KEY, readStarterPlace, saveStarterPlace } from "./place.svelte";

const SPACE: SpaceId = "anonymous";
const SCHOOL = { kind: "location", source: "schools", code: "123" } as const;

describe("the starter's chosen place", () => {
	it("unset reads as Fresno County", async () => {
		const platform = createMemoryPlatform();
		expect(await readStarterPlace(platform, SPACE)).toEqual(DEFAULT_LAYER.place);
	});

	it("reads back what was saved, per space", async () => {
		const platform = createMemoryPlatform();
		await saveStarterPlace(platform, SPACE, SCHOOL);
		expect(await platform.preferences.get(SPACE, STARTER_PLACE_KEY)).toEqual(SCHOOL);
		expect(await readStarterPlace(platform, SPACE)).toEqual(SCHOOL);
		expect(await readStarterPlace(platform, "account:7")).toEqual(DEFAULT_LAYER.place);
	});

	it("a stored default-place or junk reads as Fresno County", async () => {
		const platform = createMemoryPlatform();
		for (const junk of [{ kind: "default-place" }, { kind: "monitor", id: "a/b" }, 7, "x"]) {
			await platform.preferences.set(SPACE, STARTER_PLACE_KEY, junk);
			expect(await readStarterPlace(platform, SPACE)).toEqual(DEFAULT_LAYER.place);
		}
	});

	it("an unreadable preference reads as Fresno County", async () => {
		const platform = createMemoryPlatform();
		platform.preferences.get = () => Promise.reject(new Error("blocked"));
		expect(await readStarterPlace(platform, SPACE)).toEqual(DEFAULT_LAYER.place);
	});

	it("returns a fresh object, not the frozen default", async () => {
		const place = await readStarterPlace(createMemoryPlatform(), SPACE);
		expect(Object.isFrozen(place)).toBe(false);
	});
});
