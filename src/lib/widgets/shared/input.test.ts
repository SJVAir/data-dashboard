import { describe, expect, it } from "vitest";
import { mapDatasetCatalog, type CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import { mainLayer, widgetEffective, widgetInputs, widgetPlaceKind } from "./input";

const entry = (id: string, kind: "pollutant" | "other") => ({
	id,
	label: id,
	units: "",
	kind,
	resolutions: ["day" as const],
	precision: null,
	yMin: null,
	chart: null,
	aggregate: null
});

const CATALOG: CatalogEntry[] = [
	{ id: "air-quality", label: "Air", entryTypes: [entry("pm25", "pollutant")], geographies: [] },
	{ id: "weather", label: "Weather", entryTypes: [entry("temperature", "other")], geographies: [] },
	{
		id: "forecasts",
		label: "Forecasts",
		entryTypes: [entry("burn-status", "other")],
		geographies: []
	}
];

const PM = { dataset: "air-quality", entryType: "pm25" };
const TEMP = { dataset: "weather", entryType: "temperature" };
const BURN = { dataset: "forecasts", entryType: "burn-status" };

describe("mainLayer", () => {
	it("main is the pollutant even when listed second", () => {
		const data: WidgetDataConfig = { layers: [TEMP, PM] };
		expect(mainLayer(data, CATALOG)).toBe(data.layers[1]);
	});

	it("with no pollutant, main is the first number layer", () => {
		const data: WidgetDataConfig = { layers: [BURN, TEMP] };
		expect(mainLayer(data, CATALOG)).toBe(data.layers[1]);
	});

	it("a level layer is never main while a number layer exists", () => {
		const data: WidgetDataConfig = { layers: [BURN, TEMP, PM] };
		expect(mainLayer(data, CATALOG)).toBe(data.layers[2]);
		expect(mainLayer({ layers: [BURN, TEMP] }, CATALOG)).toBe(TEMP);
	});

	it("an unknown entry type is still the main layer when it is all there is", () => {
		const data: WidgetDataConfig = { layers: [{ dataset: "air-quality", entryType: "nope" }] };
		expect(mainLayer(data, CATALOG)).toBe(data.layers[0]);
	});
});

const RULES_CATALOG = mapDatasetCatalog({
	...SDK_DATASET_CATALOG,
	datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
});
const FRESNO = { kind: "region", type: "county", code: "06019" } as const;

describe("widgetPlaceKind", () => {
	const kind = (layer: Layer) => widgetPlaceKind({ layers: [layer] }, RULES_CATALOG);
	const pm = { dataset: "air-quality", entryType: "pm25" };
	it("monitors for a monitor place or selection", () => {
		expect(kind({ ...pm, place: { kind: "monitor", id: "m1" } })).toBe("monitors");
		expect(kind({ ...pm, selection: { kind: "monitors", ids: ["m1", "m2"] } })).toBe("monitors");
	});
	it("regions for regions, and for points and schools (which resolve to regions)", () => {
		expect(kind({ ...pm, place: FRESNO })).toBe("regions");
		expect(kind({ ...pm, selection: { kind: "regions", ids: ["county:06019"] } })).toBe("regions");
		expect(kind({ ...pm, place: { kind: "point", lat: 36.7, lon: -119.8 } })).toBe("regions");
		expect(kind({ ...pm, place: { kind: "location", source: "cde-public", code: "1" } })).toBe(
			"regions"
		);
	});
	it("none when the main layer has no place (or the starter's unresolved one)", () => {
		expect(kind(pm)).toBe("none");
		expect(kind({ ...pm, place: { kind: "default-place" } })).toBe("none");
		expect(widgetPlaceKind({ layers: [] }, RULES_CATALOG)).toBe("none");
	});
});

describe("widgetInputs", () => {
	const pm25: Layer = { dataset: "air-quality", entryType: "pm25", place: FRESNO };
	const smoke: Layer = { dataset: "hms-smoke", entryType: "smoke-density" };
	const use: Layer = { dataset: "pesticide-use", entryType: "pounds-applied" };
	const chart = (data: WidgetDataConfig) => ({ type: "chart", data });

	it("a shared link's mixed dataset: the main decides, misfits get no input (Review Focus 2)", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [pm25, smoke, use]
		};
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions");
		expect(got.effective.resolution).toBe("day");
		expect(got.effective.automatic).toBe(true);
		expect(got.effective.misfits).toEqual([use]);
		expect(got.main?.resolution).toBe("day");
		expect(got.main?.layer).toEqual(pm25);
		expect(got.overlays).toHaveLength(2);
		expect(got.overlays[0]).toEqual({
			layer: { dataset: "hms-smoke", entryType: "smoke-density", place: FRESNO },
			dateRange: data.dateRange,
			resolution: "day"
		});
		expect(got.overlays[1]).toBeNull();
	});

	it("every layer is fetched at the stored resolution", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			resolution: "month",
			layers: [pm25, use]
		};
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions");
		expect(got.effective).toEqual({ resolution: "month", automatic: false, misfits: [] });
		expect(got.main?.resolution).toBe("month");
		expect(got.overlays[0]?.resolution).toBe("month");
	});

	it("a stored level no widget offers (a quarter, from a link) asks for nothing", () => {
		const data = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			resolution: "quarter",
			layers: [pm25, smoke]
		} as WidgetDataConfig;
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions");
		expect(got.effective.unusable).toBe(true);
		expect(got.main).toBeNull();
		expect(got.overlays).toEqual([]);
		expect(got.figureFor).toBeNull();
	});

	it("Automatic rises to a level every layer offers", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [pm25, use]
		};
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions");
		expect(got.effective.resolution).toBe("month");
		expect(got.overlays[0]?.resolution).toBe("month");
	});

	it("a pollutant main names the figure it needs and carries the one passed", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			resolution: "month",
			layers: [pm25, use]
		};
		const figure = { field: "daily_statistic_mean", label: "Average of 24-hour averages" };
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions", undefined, undefined, figure);
		expect(got.figureFor).toEqual({ entryType: "pm25", resolution: "month" });
		expect(got.main?.figure).toBe("daily_statistic_mean");
		// The figure is the main's: an overlay never carries it.
		expect(got.overlays[0]).not.toHaveProperty("figure");
		const none = widgetInputs(chart(data), RULES_CATALOG, "regions", undefined, undefined, null);
		expect(none.main).not.toHaveProperty("figure");
	});

	it("a weather main needs no figure (the plain mean at every level)", () => {
		const weather: Layer = { dataset: "weather", entryType: "temperature", place: FRESNO };
		const got = widgetInputs(chart({ layers: [weather] }), RULES_CATALOG, "regions");
		expect(got.figureFor).toBeNull();
		expect(got.main).not.toHaveProperty("figure");
	});

	it("no input for a main layer with no place", () => {
		const got = widgetInputs(
			chart({ layers: [{ dataset: "air-quality", entryType: "pm25" }] }),
			RULES_CATALOG,
			"none"
		);
		expect(got.main).toBeNull();
		expect(got.overlays).toEqual([]);
	});
});

describe("widgetEffective", () => {
	const pm25: Layer = {
		dataset: "air-quality",
		entryType: "pm25",
		place: { kind: "monitor", id: "m" }
	};
	const chart = (data: WidgetDataConfig) => ({ type: "chart", data });

	it("counts Pacific calendar days: 7 days across the fall-back day are hourly", () => {
		const fall = new Date("2026-11-02T20:00:00Z");
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 7, unit: "day" },
			layers: [pm25]
		};
		expect(
			widgetEffective(chart(data), RULES_CATALOG, "monitors", undefined, fall).resolution
		).toBe("hour");
	});

	it("a Map's Automatic is at least daily, within its levels", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 2, unit: "day" },
			layers: [pm25]
		};
		expect(widgetEffective({ type: "map", data }, RULES_CATALOG, "monitors").resolution).toBe(
			"day"
		);
		expect(widgetEffective(chart(data), RULES_CATALOG, "monitors").resolution).toBe("raw");
	});

	it("an unknown catalog counts as empty: the range's level", () => {
		const data: WidgetDataConfig = {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [pm25]
		};
		expect(widgetEffective(chart(data), undefined, "monitors").resolution).toBe("day");
	});
});
