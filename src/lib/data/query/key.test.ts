import { describe, expect, it } from "vitest";
import { resolveRange } from "$lib/format/range";
import type { DateRangeSpec } from "../schema";
import type { Target } from "../types";
import { keyRange, queryKey } from "./key";

function keyFor(spec: DateRangeSpec, now: Date, target: Target = { kind: "all" }): string {
	return queryKey({
		dataset: "air-quality",
		entryType: "pm25",
		target,
		resolution: "hour",
		downsampleFromRaw: false,
		range: keyRange(spec, resolveRange(spec, now))
	});
}

describe("queryKey", () => {
	it("rolling inputs share a key as time moves; fixed inputs key by dates", () => {
		const monday = new Date("2026-10-19T19:00:00Z");
		const thursday = new Date("2026-10-22T19:00:00Z");

		const trailing: DateRangeSpec = { kind: "trailing", amount: 7, unit: "day" };
		expect(keyFor(trailing, monday)).toBe(keyFor(trailing, thursday));

		const toDate: DateRangeSpec = { kind: "to-date", unit: "month" };
		expect(keyFor(toDate, monday)).toBe(keyFor(toDate, thursday));
		expect(keyFor(toDate, monday)).not.toBe(keyFor(trailing, monday));

		const month: DateRangeSpec = { kind: "set", unit: "month", start: "2026-10-01" };
		const custom: DateRangeSpec = { kind: "custom", start: "2026-10-01", end: "2026-10-31" };
		expect(keyFor(month, monday)).toBe(keyFor(custom, thursday));
		expect(keyFor(month, monday)).not.toBe(
			keyFor({ kind: "custom", start: "2026-10-01", end: "2026-10-30" }, monday)
		);
	});

	it("sorts target ids and ignores object key order", () => {
		const now = new Date("2026-10-22T19:00:00Z");
		const spec: DateRangeSpec = { kind: "trailing", amount: 7, unit: "day" };
		expect(keyFor(spec, now, { kind: "monitors", ids: ["b", "a"] })).toBe(
			keyFor(spec, now, { ids: ["a", "b"], kind: "monitors" } as Target)
		);
		expect(keyFor(spec, now, { kind: "regions", keys: ["county:2", "county:1"] })).toBe(
			keyFor(spec, now, { kind: "regions", keys: ["county:1", "county:2"] })
		);
		expect(keyFor(spec, now, { kind: "monitors", ids: ["a"] })).not.toBe(
			keyFor(spec, now, { kind: "monitors", ids: ["a", "b"] })
		);
	});

	it("does not sort the caller's target ids in place", () => {
		const ids = ["b", "a"];
		keyFor({ kind: "trailing", amount: 1, unit: "day" }, new Date(), { kind: "monitors", ids });
		expect(ids).toEqual(["b", "a"]);
	});
});
