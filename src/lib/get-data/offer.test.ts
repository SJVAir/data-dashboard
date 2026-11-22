import { describe, expect, it } from "vitest";
import type { Component } from "svelte";
import { pesticidesAdapter } from "$lib/data/adapters/pesticides";
import { smokeAdapter } from "$lib/data/adapters/smoke";
import { weatherAdapter } from "$lib/data/adapters/weather";
import { mapDatasetCatalog, type CatalogEntry, type EntryTypeMeta } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import type { WidgetType } from "$lib/widgets/registry";
import { chartType } from "$lib/widgets/chart";
import { contributionCalendarType } from "$lib/widgets/calendars/contribution";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { dataTableType } from "$lib/widgets/table";
import { mapType } from "$lib/widgets/map";
import { currentType } from "$lib/widgets/current";
import { offeredDatasets, resolutionBlock, typeBlock } from "./offer";

const NOW = new Date("2026-11-05T20:00:00Z");

function entryType(id: string, extra: Partial<EntryTypeMeta> = {}): EntryTypeMeta {
	return {
		id,
		label: id,
		units: "",
		kind: "pollutant",
		resolutions: ["hour"],
		precision: null,
		yMin: null,
		chart: null,
		aggregate: null,
		...extra
	};
}

function dataset(id: string, entryTypes: EntryTypeMeta[]): CatalogEntry {
	return { id, label: id, entryTypes, geographies: [] };
}

const CATALOG: CatalogEntry[] = [
	dataset("air-quality", [
		entryType("pm25"),
		entryType("o3"),
		entryType("temp", { kind: "meteorological" })
	]),
	dataset("forecasts", [entryType("pm25")]),
	dataset("census", [entryType("people")])
];

function type(extra: Partial<WidgetType> = {}): WidgetType {
	return {
		type: "t",
		label: () => "t",
		icon: (() => {}) as unknown as Component,
		minSize: { w: 1, h: 1 },
		defaultSize: { w: 1, h: 1 },
		time: "range",
		thresholds: false,
		analyzable: false,
		downloadable: false,
		menu: () => [],
		load: async () => ({ component: (() => {}) as never }),
		...extra
	};
}

/** A selection of `n` areas (counties). */
const areas = (n: number) => ({
	kind: "regions" as const,
	ids: Array.from({ length: n }, (_, i) => `county:m${i}`)
});

/** Adapters with only an id: none of them offers overlays. */
const adapters = (list: string[]) => list.map((id) => ({ id }));

describe("offeredDatasets", () => {
	it("forecasts appears only once an adapter exists", () => {
		const types = [chartType, dataTableType];
		const without = offeredDatasets(CATALOG, adapters(["air-quality"]), types).map(
			(o) => o.dataset.id
		);
		expect(without).toEqual(["air-quality"]);
		const withIt = offeredDatasets(CATALOG, adapters(["air-quality", "forecasts"]), types).map(
			(o) => o.dataset.id
		);
		expect(withIt).toEqual(["air-quality", "forecasts"]);
	});

	it("a dataset the types do not accept is not offered", () => {
		const ids = offeredDatasets(CATALOG, adapters(["air-quality", "forecasts", "census"]), [
			chartType
		]).map((o) => o.dataset.id);
		expect(ids).not.toContain("census");
	});

	it("an unavailable entry type is left out", () => {
		const catalog = [
			dataset("air-quality", [
				entryType("pm25"),
				entryType("pm10", { available: false }),
				entryType("pm1", { retired: { since: "2025-01-01" } })
			])
		];
		const [offer] = offeredDatasets(catalog, adapters(["air-quality"]), [chartType]);
		expect(offer.entryTypes.map((e) => e.id)).toEqual(["pm25"]);
	});

	it("a type with no accepts.datasets accepts nothing", () => {
		expect(offeredDatasets(CATALOG, adapters(["air-quality"]), [type()])).toEqual([]);
	});

	it("overlays are only the entry types their adapter says fit", () => {
		const catalog = [
			dataset("air-quality", [
				entryType("pm25"),
				entryType("humidity", { kind: "meteorological", resolutions: ["raw"] })
			]),
			dataset("forecasts", [
				entryType("burn-status", { kind: "other" }),
				entryType("aqi", { kind: "other" })
			])
		];
		const offers = [{ id: "air-quality" }, { id: "forecasts", overlays: () => true }];
		const [air, forecasts] = offeredDatasets(catalog, offers, [chartType]);
		expect(air.entryTypes.map((e) => e.id)).toEqual(["pm25", "humidity"]);
		expect(air.overlayTypes).toEqual([]);
		expect(forecasts.overlayTypes.map((e) => e.id)).toEqual(["burn-status", "aqi"]);
	});
});

describe("offeredDatasets: layers that stand alone", () => {
	const catalog: CatalogEntry[] = [
		...mapDatasetCatalog({
			...SDK_DATASET_CATALOG,
			datasets: [WEATHER_DATASET, PESTICIDE_USE_DATASET]
		}),
		dataset("hms-smoke", [entryType("smoke-density", { kind: "other", resolutions: ["day"] })])
	];
	const offers = [weatherAdapter, smokeAdapter, pesticidesAdapter];
	const byId = (id: string) =>
		offeredDatasets(catalog, offers, [chartType]).find((o) => o.dataset.id === id)!;
	const ids = (list: EntryTypeMeta[]) => list.map((e) => e.id);

	it("weather offers its summary types only", () => {
		const weather = byId("weather");
		expect(ids(weather.layerTypes)).toEqual(["eto", "precipitation", "temperature"]);
		expect(ids(weather.entryTypes)).not.toContain("winddirection");
		expect(weather.overlayTypes).toEqual([]);
	});

	it("pesticide use offers three layer types", () => {
		expect(ids(byId("pesticide-use").layerTypes)).toEqual([
			"pounds-applied",
			"acres-treated",
			"applications"
		]);
	});

	it("smoke is an overlay only", () => {
		const smoke = byId("hms-smoke");
		expect(smoke.layerTypes).toEqual([]);
		expect(ids(smoke.overlayTypes)).toEqual(["smoke-density"]);
	});

	it("a dataset with pollutants offers no stand-alone layers", () => {
		const [air] = offeredDatasets(CATALOG, adapters(["air-quality"]), [chartType]);
		expect(air.layerTypes).toEqual([]);
	});
});

describe("typeBlock for the calendars", () => {
	const data = (layers: WidgetDataConfig["layers"], range?: WidgetDataConfig["dateRange"]) => ({
		dateRange: range ?? ({ kind: "to-date", unit: "month" } as const),
		layers
	});
	const pm25 = { dataset: "air-quality", entryType: "pm25" };

	it("needs exactly one pollutant layer", () => {
		const humidity = { dataset: "air-quality", entryType: "temp" };
		expect(typeBlock(monthCalendarType, data([pm25, humidity]), CATALOG, NOW)).toBe("pollutant");
		expect(typeBlock(monthCalendarType, data([humidity]), CATALOG, NOW)).toBe("pollutant");
		expect(typeBlock(monthCalendarType, data([pm25]), CATALOG, NOW)).toBeNull();
	});

	it("two places block; another dataset blocks", () => {
		const two = { ...data([pm25]), selection: areas(2) };
		expect(typeBlock(monthCalendarType, two, CATALOG, NOW)).toBe("places");
		expect(
			typeBlock(monthCalendarType, data([{ dataset: "census", entryType: "people" }]), CATALOG, NOW)
		).toBe("dataset");
	});

	it("the Map's span counts stops at its resolution: 30 months fit at Monthly, not at Daily", () => {
		const offering = (levels: EntryTypeMeta["resolutions"]): CatalogEntry[] => [
			dataset("air-quality", [entryType("pm25", { resolutions: levels })])
		];
		const map = (resolution?: "day" | "month") => ({
			layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m"] }],
			dateRange: { kind: "custom" as const, start: "2024-01-01", end: "2026-06-30" },
			...(resolution ? { resolution } : {})
		});
		// Automatic: a range over a year is Monthly, so 30 stops.
		expect(typeBlock(mapType, map(), offering(["day", "month"]), NOW)).toBeNull();
		expect(typeBlock(mapType, map("month"), offering(["day", "month"]), NOW)).toBeNull();
		expect(typeBlock(mapType, map("day"), offering(["day", "month"]), NOW)).toBe("span");
	});

	it("a 400-day range blocks the month calendar but not the contribution calendar", () => {
		const long = data([pm25], { kind: "trailing", amount: 400, unit: "day" });
		expect(typeBlock(monthCalendarType, long, CATALOG, NOW)).toBe("span");
		expect(typeBlock(contributionCalendarType, long, CATALOG, NOW)).toBeNull();
	});
});

describe("typeBlock", () => {
	const data = (extra: Partial<WidgetDataConfig> = {}): WidgetDataConfig => ({
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		layers: [{ dataset: "air-quality", entryType: "pm25" }],
		...extra
	});

	it("is null when the data fits", () => {
		expect(typeBlock(chartType, data(), CATALOG, NOW)).toBeNull();
	});

	it("a Chart takes 40 areas", () => {
		const d = data({ selection: areas(40) });
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBeNull();
		expect(typeBlock(dataTableType, d, CATALOG, NOW)).toBeNull();
	});

	it('Current conditions with two areas is blocked "places"', () => {
		expect(typeBlock(currentType, data({ selection: areas(2) }), CATALOG, NOW)).toBe("places");
	});

	it("places never block Chart or Table", () => {
		const d = data({
			selection: areas(7),
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBeNull();
		expect(typeBlock(dataTableType, d, CATALOG, NOW)).toBeNull();
	});

	it("a 25-place Map's draft isn't blocked for Chart or Table; a one-place type still is", () => {
		const d = data({
			selection: areas(25),
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBeNull();
		expect(typeBlock(dataTableType, d, CATALOG, NOW)).toBeNull();
		expect(typeBlock(currentType, d, CATALOG, NOW)).toBe("places");
	});

	it("a dataset the type doesn't accept blocks it", () => {
		const d = data({ layers: [{ dataset: "census", entryType: "people" }] });
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBe("dataset");
	});

	it("two pollutant layers block a one-pollutant type; a meteorological one doesn't count", () => {
		const two = data({
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "o3" }
			]
		});
		expect(typeBlock(chartType, two, CATALOG, NOW)).toBe("pollutants");
		const mixed = data({
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "temp" }
			]
		});
		expect(typeBlock(chartType, mixed, CATALOG, NOW)).toBeNull();
	});

	it("a range outside the type's span blocks it", () => {
		const short = type({
			accepts: { datasets: ["air-quality"] },
			span: { maxDays: 7 }
		});
		expect(typeBlock(short, data(), CATALOG, NOW)).toBe("span");
	});
});

describe("resolutionBlock", () => {
	const data = (extra: Partial<WidgetDataConfig> = {}): WidgetDataConfig => ({
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		layers: [{ dataset: "air-quality", entryType: "pm25" }],
		...extra
	});

	it("greys the Map at hourly or every measurement, never on Automatic or Now", () => {
		expect(resolutionBlock(mapType, data({ resolution: "hour" }))).toBe("hour");
		expect(resolutionBlock(mapType, data({ resolution: "raw" }))).toBe("raw");
		expect(resolutionBlock(mapType, data({ resolution: "month" }))).toBeNull();
		expect(resolutionBlock(mapType, data())).toBeNull();
		expect(resolutionBlock(mapType, { layers: data().layers, resolution: "hour" })).toBeNull();
	});

	it("greys a calendar (pinned to day) at another chosen level", () => {
		expect(resolutionBlock(monthCalendarType, data({ resolution: "month" }))).toBe("month");
		expect(resolutionBlock(monthCalendarType, data({ resolution: "day" }))).toBeNull();
		expect(resolutionBlock(monthCalendarType, data())).toBeNull();
		expect(typeBlock(monthCalendarType, data({ resolution: "month" }), CATALOG, NOW)).toBe(
			"resolution"
		);
	});

	it("greys no type for a stored quarter or season (Save is blocked instead)", () => {
		for (const resolution of ["quarter", "season"] as const) {
			expect(resolutionBlock(mapType, data({ resolution }))).toBeNull();
			expect(resolutionBlock(monthCalendarType, data({ resolution }))).toBeNull();
		}
	});

	it("never greys a type with no pin", () => {
		expect(resolutionBlock(chartType, data({ resolution: "raw" }))).toBeNull();
		expect(typeBlock(chartType, data({ resolution: "year" }), CATALOG, NOW)).toBeNull();
	});
});
