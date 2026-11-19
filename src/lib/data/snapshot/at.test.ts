import { describe, expect, it } from "vitest";
import { atKey, atOfKey, isPeriodAt, periodSnapshotSource } from "./at";

describe("snapshot times", () => {
	it("round-trips now, a day, a month and a year through their keys", () => {
		const times = [
			"now",
			{ day: "2026-11-10" },
			{ start: "2026-11-01", resolution: "month" },
			{ start: "2026-01-01", resolution: "year" }
		] as const;
		expect(times.map(atKey)).toEqual(["now", "2026-11-10", "month:2026-11-01", "year:2026-01-01"]);
		for (const at of times) expect(atOfKey(atKey(at))).toEqual(at);
	});

	it("tells a month or year stop from now and a day", () => {
		expect(isPeriodAt("now")).toBe(false);
		expect(isPeriodAt({ day: "2026-11-10" })).toBe(false);
		expect(isPeriodAt({ start: "2026-11-01", resolution: "month" })).toBe(true);
	});

	it("gives a period no figures, final, never polling", async () => {
		const source = periodSnapshotSource("k");
		const value = await source.fetch(new AbortController().signal);
		expect(value).toEqual({ figures: new Map(), final: true, unrated: false });
		expect(source.poll(value)).toBe(false);
	});
});
