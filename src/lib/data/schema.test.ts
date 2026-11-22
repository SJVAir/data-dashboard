import { describe, expect, it } from "vitest";
import { DashboardSchema, StarterDashboardSchema } from "$lib/documents/schema";
import { starterDashboard, starterTemplate } from "$lib/starter/starter";
import { defaultStarterPlace } from "$lib/starter/place.svelte";
import {
	DateRangeSpecSchema,
	LIMITS,
	LayerSchema,
	TimeSubRangeSchema,
	WidgetDataConfigSchema
} from "./schema";

const mapConfig = {
	dateRange: { kind: "set", unit: "month", start: "2026-09-01" },
	selection: { kind: "regions", ids: ["county:06019"] },
	layers: [
		{ dataset: "monitors", entryType: "pm25" },
		{ dataset: "regions", entryType: "pm25" }
	]
};

const county = { kind: "region", type: "county", code: "06019" };

/** Whether a widget's data with this Where (and one layer) parses. */
const where = (w: object) =>
	WidgetDataConfigSchema.safeParse({ ...w, layers: [{ dataset: "d" }] }).success;

describe("WidgetDataConfigSchema", () => {
	it("accepts a map-like config with two layers", () => {
		expect(WidgetDataConfigSchema.safeParse(mapConfig).success).toBe(true);
	});

	it("monitors and types on the air-quality layer", () => {
		const config = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			place: county,
			layers: [
				{
					dataset: "air-quality",
					entryType: "pm25",
					monitors: ["abc", "Ab_9-z"],
					monitorTypes: ["purpleair", "airnow"]
				}
			]
		};
		expect(WidgetDataConfigSchema.parse(config)).toEqual(config);
	});

	it("rejects repeated or unsafe monitors and types", () => {
		const layer = (l: object) => LayerSchema.safeParse({ dataset: "air-quality", ...l }).success;
		expect(layer({ monitors: ["a", "a"] })).toBe(false);
		expect(layer({ monitors: ["../x"] })).toBe(false);
		expect(layer({ monitorTypes: ["purpleair", "purpleair"] })).toBe(false);
		expect(layer({ monitorTypes: ["a b"] })).toBe(false);
		expect(layer({ monitors: [], monitorTypes: [] })).toBe(true);
	});

	it("a saved monitor place or monitors selection is dropped on read", () => {
		const place = WidgetDataConfigSchema.safeParse({
			place: { kind: "monitor", id: "abc" },
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
		expect(place.success).toBe(true);
		expect(place.data).toEqual({ layers: [{ dataset: "air-quality", entryType: "pm25" }] });
		const selection = WidgetDataConfigSchema.safeParse({
			selection: { kind: "monitors", ids: ["a", "b"] },
			layers: []
		});
		expect(selection.success).toBe(true);
		expect(selection.data).toEqual({ layers: [] });
	});

	it("Where is saved on the data, not the layer", () => {
		const r = WidgetDataConfigSchema.parse({
			place: county,
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
		expect(r.place).toEqual(county);
		expect(r.layers[0]).toEqual({ dataset: "air-quality", entryType: "pm25" });
	});

	it("an old layer place is dropped on read", () => {
		const r = WidgetDataConfigSchema.safeParse({
			layers: [
				{ dataset: "air-quality", entryType: "pm25", place: county },
				{ dataset: "air-quality", entryType: "o3", selection: { kind: "regions", ids: ["a:b"] } }
			]
		});
		expect(r.success).toBe(true);
		expect(r.data!.layers[0]).not.toHaveProperty("place");
		expect(r.data!.layers[1]).not.toHaveProperty("selection");
		expect(r.data!.place).toBeUndefined();
	});

	it("a selection has no 500 limit", () => {
		const ids = Array.from({ length: 600 }, (_, i) => `county:${i}`);
		const r = WidgetDataConfigSchema.safeParse({
			selection: { kind: "regions", ids },
			layers: []
		});
		expect(r.success).toBe(true);
		expect(LIMITS).not.toHaveProperty("SELECTION_MAX");
	});

	it("drops a layer's earlier per-layer resolution (it opens as Automatic)", () => {
		const r = WidgetDataConfigSchema.parse({
			layers: [{ dataset: "air-quality", entryType: "pm25", resolution: "day" }]
		});
		expect(r.layers[0]).toEqual({ dataset: "air-quality", entryType: "pm25" });
		expect(r.resolution).toBeUndefined();
	});

	it("round-trips one data resolution and rejects an unknown one", () => {
		const config = { resolution: "month", layers: [{ dataset: "air-quality", entryType: "pm25" }] };
		expect(WidgetDataConfigSchema.parse(config)).toEqual(config);
		expect(WidgetDataConfigSchema.safeParse({ ...config, resolution: "auto" }).success).toBe(false);
	});

	it("accepts the other place kinds", () => {
		for (const place of [
			{ kind: "region", type: "county", code: "06019" },
			{ kind: "location", source: "school", code: "x1" },
			{ kind: "point", lat: 36.7, lon: -119.8, label: "Home" }
		]) {
			expect(where({ place })).toBe(true);
		}
	});

	it("rejects an out-of-range point and too many layers", () => {
		expect(where({ place: { kind: "point", lat: 91, lon: 0 } })).toBe(false);
		const layers = Array.from({ length: LIMITS.LAYERS_MAX + 1 }, () => ({ dataset: "d" }));
		expect(WidgetDataConfigSchema.safeParse({ layers }).success).toBe(false);
	});

	it("rejects a Where with both a place and a selection", () => {
		expect(where({ place: county, selection: { kind: "regions", ids: ["county:06019"] } })).toBe(
			false
		);
	});

	it("rejects bad selections", () => {
		const sel = (kind: string, ids: string[]) => where({ selection: { kind, ids } });
		expect(sel("regions", ["06019"])).toBe(false);
		expect(sel("regions", ["county:1", "county:1"])).toBe(false);
		expect(sel("regions", [])).toBe(false);
	});

	it("rejects entry types outside a safe character set", () => {
		expect(where({ selection: { kind: "regions", ids: ["county:06019"] } })).toBe(true);
		const layer = (l: object) => LayerSchema.safeParse({ dataset: "d", ...l }).success;
		expect(layer({ entryType: "pm25/../x" })).toBe(false);
		expect(layer({ entryType: "pm25" })).toBe(true);
	});

	it("region place types follow the selection ids' type rule", () => {
		const region = (type: string) => where({ place: { kind: "region", type, code: "06019" } });
		expect(region("county")).toBe(true);
		expect(region("school_district")).toBe(true);
		expect(region("a:b")).toBe(false);
		expect(region("County")).toBe(false);
	});

	it("accepts a drawn source geometry and rejects one without a type", () => {
		const base = { kind: "regions", ids: ["county:06019"] };
		const withSource = (source: unknown) => where({ selection: { ...base, source } });
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
		const doc = starterDashboard(defaultStarterPlace());
		doc.body.widgets[0].data = { place, layers: [{ dataset: "monitors" }] } as never;
		return doc;
	};

	it("is rejected by DashboardSchema and allowed by StarterDashboardSchema", () => {
		const doc = withPlace({ kind: "default-place" });
		expect(DashboardSchema.safeParse(doc).success).toBe(false);
		expect(StarterDashboardSchema.safeParse(doc).success).toBe(true);
	});

	it("leaves other places and the resolved starter valid; only the template holds it", () => {
		expect(DashboardSchema.safeParse(withPlace(county)).success).toBe(true);
		// An earlier monitor place is dropped, and the dashboard still opens.
		expect(DashboardSchema.safeParse(withPlace({ kind: "monitor", id: "a" })).success).toBe(true);
		const starter = starterDashboard(defaultStarterPlace());
		expect(DashboardSchema.safeParse(starter).success).toBe(true);
		expect(StarterDashboardSchema.safeParse(starter).success).toBe(true);
		expect(DashboardSchema.safeParse(starterTemplate()).success).toBe(false);
		expect(StarterDashboardSchema.safeParse(starterTemplate()).success).toBe(true);
	});
});

describe("layer station and filters", () => {
	const base = { dataset: "pesticide-use", entryType: "pounds-applied" };

	it("a layer keeps station and filters", () => {
		const r = LayerSchema.parse({
			...base,
			station: "80",
			filters: { chemical: "123", category: ["fumigant", "herbicide"], narrow: "rodenticide" }
		});
		expect(r.station).toBe("80");
		expect(r.filters).toEqual({
			chemical: "123",
			category: ["fumigant", "herbicide"],
			narrow: "rodenticide"
		});
	});

	it("filters reject 11 categories", () => {
		const category = Array.from({ length: LIMITS.CATEGORIES_MAX + 1 }, (_, i) => `c${i}`);
		expect(LayerSchema.safeParse({ ...base, filters: { category } }).success).toBe(false);
		expect(LayerSchema.safeParse({ ...base, filters: { category: [] } }).success).toBe(false);
	});

	it("unknown filter keys are dropped", () => {
		const r = LayerSchema.parse({ ...base, filters: { method: "aerial", bogus: "x" } });
		expect(r.filters).toEqual({ method: "aerial" });
	});

	it("a 65-char chemical id is rejected", () => {
		const long = "x".repeat(65);
		expect(LayerSchema.safeParse({ ...base, filters: { chemical: long } }).success).toBe(false);
	});

	it("a station id keeps to the safe character set", () => {
		expect(LayerSchema.safeParse({ ...base, station: "../x" }).success).toBe(false);
	});
});
