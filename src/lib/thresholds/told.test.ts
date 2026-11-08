import { expect, test } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { TOLD_KEY, readTold, writeTold } from "./told";

test("round trip, per dashboard and per space", async () => {
	const p = createMemoryPlatform();
	expect(TOLD_KEY).toBe("thresholdTold");
	expect(await readTold(p, "anonymous", "a")).toEqual({});
	const map = { w1: { level: "unhealthy", at: 5 }, w2: { level: null, at: 6 } };
	await writeTold(p, "anonymous", "a", map, ["w1", "w2"]);
	expect(await readTold(p, "anonymous", "a")).toEqual(map);
	expect(await readTold(p, "anonymous", "b")).toEqual({});
	expect(await readTold(p, "account:1", "a")).toEqual({});
});

test("an invalid stored value reads as {}", async () => {
	const p = createMemoryPlatform();
	for (const bad of ["x", 3, null, [1], { w1: { level: 3, at: 1 } }, { w1: { at: "1" } }]) {
		await p.preferences.set("anonymous", `${TOLD_KEY}:a`, bad);
		expect(await readTold(p, "anonymous", "a")).toEqual({});
	}
});

test("writing drops widget ids the dashboard no longer has", async () => {
	const p = createMemoryPlatform();
	const map = { w1: { level: "unhealthy", at: 5 }, gone: { level: null, at: 6 } };
	await writeTold(p, "anonymous", "a", map, ["w1", "w3"]);
	expect(await readTold(p, "anonymous", "a")).toEqual({ w1: { level: "unhealthy", at: 5 } });
});
