import { describe, expect, it } from "vitest";
import type { DateRangeSpec } from "$lib/data/schema";
import { resolveRange } from "$lib/format/range";
import { blockedBySpan, presetIdFor, presetsFor } from "./date-presets";

const NOW = new Date("2026-11-05T20:00:00Z");
const ALL = ["trailing", "to-date", "set", "custom"] as const;

describe("date presets", () => {
	it("Last 30 days maps to trailing 30 day", () => {
		const p = presetsFor({ dateMethods: [...ALL] }, NOW).find((x) => x.id === "last-30-day");
		expect(p?.spec).toEqual({ kind: "trailing", amount: 30, unit: "day" });
		expect(p?.group).toBe("last");
		expect(p?.label()).toBe("Last 30 days");
	});

	it("presetIdFor round-trips every preset spec", () => {
		for (const p of presetsFor({ dateMethods: [...ALL] }, NOW)) {
			if (p.spec) expect(presetIdFor(p.spec)).toBe(p.id);
		}
		expect(presetIdFor({ kind: "set", unit: "month", start: "2026-03-01" })).toBe("set-month");
		expect(presetIdFor({ kind: "trailing", amount: 45, unit: "day" })).toBe("custom");
		expect(presetIdFor({ kind: "custom", start: "2026-01-01", end: "2026-01-02" })).toBe("custom");
	});

	it("a type without 'trailing' hides the Last group", () => {
		const list = presetsFor({ dateMethods: ["set", "custom"] }, NOW);
		expect(list.some((p) => p.group === "last")).toBe(false);
		expect(list.some((p) => p.group === "specific")).toBe(true);
	});

	it("no dateMethods offers every group", () => {
		const groups = new Set(presetsFor({}, NOW).map((p) => p.group));
		expect(groups).toEqual(new Set(["last", "to-date", "specific", "custom"]));
	});

	it("lists Last 3 days only when maxDays is 7 or less", () => {
		const has = (span: { maxDays?: number }) =>
			presetsFor({ span }, NOW).some((p) => p.id === "last-3-day");
		expect(has({ maxDays: 7 })).toBe(true);
		expect(has({ maxDays: 31 })).toBe(false);
		expect(has({})).toBe(false);
	});

	it("specific and custom presets carry needs and no spec", () => {
		const list = presetsFor({}, NOW);
		expect(list.find((p) => p.id === "set-month")).toMatchObject({ needs: "month" });
		expect(list.find((p) => p.id === "set-month")?.spec).toBeUndefined();
		expect(list.find((p) => p.id === "custom")).toMatchObject({ needs: "range" });
	});

	it("span maxDays 31 blocks last-90-day as too-long", () => {
		const spec: DateRangeSpec = { kind: "trailing", amount: 90, unit: "day" };
		expect(blockedBySpan(spec, { maxDays: 31 }, NOW)).toBe("too-long");
		expect(blockedBySpan(spec, { maxDays: 90 }, NOW)).toBeNull();
		expect(blockedBySpan(spec, undefined, NOW)).toBeNull();
	});

	it("span minDays blocks short ranges, and 24 hours counts as one day", () => {
		const day: DateRangeSpec = { kind: "set", unit: "day", start: "2026-11-01" };
		expect(blockedBySpan(day, { minDays: 7 }, NOW)).toBe("too-short");
		const hours: DateRangeSpec = { kind: "trailing", amount: 24, unit: "hour" };
		expect(blockedBySpan(hours, { minDays: 2 }, NOW)).toBe("too-short");
		expect(blockedBySpan(hours, { maxDays: 1 }, NOW)).toBeNull();
	});

	it("set-week starts on Sunday in Pacific time", () => {
		const r = resolveRange({ kind: "set", unit: "week", start: "2026-11-05" }, NOW);
		expect(r.firstDate).toBe("2026-11-01");
	});
});
