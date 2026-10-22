import { describe, expect, it } from "vitest";
import { DashboardSchema, StarterDashboardSchema } from "$lib/documents/schema";
import { starterDashboard } from "$lib/starter/starter";
import {
	DateRangeSpecSchema,
	LIMITS,
	LayerSchema,
	TimeSubRangeSchema,
	WidgetDataConfigSchema
} from "./schema";

const mapConfig = {
	dateRange: { kind: "set", unit: "month", start: "2026-09-01" },
	layers: [
		{ dataset: "monitors", entryType: "pm25", resolution: "auto" },
		{
			dataset: "regions",
			entryType: "pm25",
			selection: { kind: "regions", ids: ["county:06019"] }
		}
	]
};

describe("WidgetDataConfigSchema", () => {
	it("accepts a map-like config with two layers", () => {
		expect(WidgetDataConfigSchema.safeParse(mapConfig).success).toBe(true);
	});

	it("accepts a chart config with a trailing range and a monitor place", () => {
		const r = WidgetDataConfigSchema.safeParse({
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [{ dataset: "monitors", place: { kind: "monitor", id: "abc" }, resolution: "day" }]
		});
		expect(r.success).toBe(true);
	});

	it("accepts the other place kinds", () => {
		for (const place of [
			{ kind: "region", type: "county", code: "06019" },
			{ kind: "location", source: "school", code: "x1" },
			{ kind: "point", lat: 36.7, lon: -119.8, label: "Home" }
		]) {
			expect(LayerSchema.safeParse({ dataset: "d", place }).success).toBe(true);
		}
	});

	it("rejects an out-of-range point and too many layers", () => {
		expect(
			LayerSchema.safeParse({ dataset: "d", place: { kind: "point", lat: 91, lon: 0 } }).success
		).toBe(false);
		const layers = Array.from({ length: LIMITS.LAYERS_MAX + 1 }, () => ({ dataset: "d" }));
		expect(WidgetDataConfigSchema.safeParse({ layers }).success).toBe(false);
	});

	it("rejects a layer with both a place and a selection", () => {
		const r = LayerSchema.safeParse({
			dataset: "d",
			place: { kind: "monitor", id: "a" },
			selection: { kind: "monitors", ids: ["a"] }
		});
		expect(r.success).toBe(false);
	});

	it("rejects bad selections", () => {
		const sel = (kind: string, ids: string[]) =>
			LayerSchema.safeParse({ dataset: "d", selection: { kind, ids } }).success;
		expect(sel("regions", ["06019"])).toBe(false);
		expect(sel("monitors", ["a", "a"])).toBe(false);
		expect(sel("monitors", [])).toBe(false);
		const many = Array.from({ length: LIMITS.SELECTION_MAX + 1 }, (_, i) => `m${i}`);
		expect(sel("monitors", many)).toBe(false);
		expect(sel("monitors", many.slice(0, LIMITS.SELECTION_MAX))).toBe(true);
	});

	it("accepts a drawn source geometry and rejects one without a type", () => {
		const base = { kind: "monitors", ids: ["a"] };
		const withSource = (source: unknown) =>
			LayerSchema.safeParse({ dataset: "d", selection: { ...base, source } }).success;
		expect(withSource({ type: "Polygon", coordinates: [] })).toBe(true);
		expect(withSource({ coordinates: [] })).toBe(false);
	});
});

describe("DateRangeSpecSchema", () => {
	it("rejects bad amounts and dates", () => {
		const ok = (v: unknown) => DateRangeSpecSchema.safeParse(v).success;
		expect(ok({ kind: "trailing", amount: 0, unit: "day" })).toBe(false);
		expect(ok({ kind: "trailing", amount: 1.5, unit: "day" })).toBe(false);
		expect(ok({ kind: "trailing", amount: 3651, unit: "day" })).toBe(false);
		expect(ok({ kind: "trailing", amount: 3650, unit: "day" })).toBe(true);
		expect(ok({ kind: "custom", start: "2026-02-02", end: "2026-02-01" })).toBe(false);
		expect(ok({ kind: "custom", start: "2026-02-01", end: "2026-02-01" })).toBe(true);
		expect(ok({ kind: "custom", start: "2026-02-30", end: "2026-03-01" })).toBe(false);
		expect(ok({ kind: "set", unit: "day", start: "2026-02-30" })).toBe(false);
		expect(ok({ kind: "to-date", unit: "week" })).toBe(true);
	});
});

describe("TimeSubRangeSchema", () => {
	const ok = (start: string, end: string) => TimeSubRangeSchema.safeParse({ start, end }).success;
	it("accepts matching forms in order", () => {
		expect(ok("2026-09-01", "2026-09-03")).toBe(true);
		expect(ok("2026-09-01T00:00:00-07:00", "2026-09-01T12:00:00Z")).toBe(true);
	});
	it("rejects mixed forms, reversed order, and unreal dates", () => {
		expect(ok("2026-09-01", "2026-09-03T00:00:00Z")).toBe(false);
		expect(ok("2026-09-03", "2026-09-01")).toBe(false);
		expect(ok("2026-09-01T12:00:00Z", "2026-09-01T00:00:00-07:00")).toBe(false);
		expect(ok("2026-02-30", "2026-03-01")).toBe(false);
	});
});

describe("default-place", () => {
	const withPlace = (place: unknown) => {
		const doc = starterDashboard();
		doc.body.widgets[0].data = { layers: [{ dataset: "monitors", place }] } as never;
		return doc;
	};

	it("is rejected by DashboardSchema and allowed by StarterDashboardSchema", () => {
		const doc = withPlace({ kind: "default-place" });
		expect(DashboardSchema.safeParse(doc).success).toBe(false);
		expect(StarterDashboardSchema.safeParse(doc).success).toBe(true);
	});

	it("leaves other places and the placeholder starter valid", () => {
		expect(DashboardSchema.safeParse(withPlace({ kind: "monitor", id: "a" })).success).toBe(true);
		expect(DashboardSchema.safeParse(starterDashboard()).success).toBe(true);
		expect(StarterDashboardSchema.safeParse(starterDashboard()).success).toBe(true);
	});
});
