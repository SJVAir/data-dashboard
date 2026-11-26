import { describe, expect, it } from "vitest";
import { mapDatasetCatalog, type CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import {
	chartInput,
	drawnMonitors,
	hasPlaces,
	idleTypes,
	mainLayer,
	queryLayer,
	singleMonitor,
	wherePurpose,
	widgetEffective,
	widgetInputs,
	widgetMonitors,
	widgetPlaceKind,
	widgetWhere
} from "./input";

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

type Where = Pick<WidgetDataConfig, "place" | "selection">;

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
	const kind = (where: Where) => widgetPlaceKind({ ...where, layers: [PM] });
	it("monitor-types for ticked types; monitors for searched monitors alone", () => {
		expect(widgetPlaceKind({ layers: [{ ...PM, monitors: ["m1"] }] })).toBe("monitors");
		expect(widgetPlaceKind({ place: FRESNO, layers: [{ ...PM, monitorTypes: ["airnow"] }] })).toBe(
			"monitor-types"
		);
		expect(
			widgetPlaceKind({
				place: FRESNO,
				layers: [{ ...PM, monitors: ["m1"], monitorTypes: ["airnow"] }]
			})
		).toBe("monitor-types");
		expect(widgetPlaceKind({ place: FRESNO, layers: [PM] })).toBe("regions");
		expect(widgetPlaceKind({ layers: [PM] })).toBe("none");
		// Empty lists are none; with None chosen (no entry type) they fetch nothing.
		expect(widgetPlaceKind({ place: FRESNO, layers: [{ ...PM, monitors: [] }] })).toBe("regions");
		expect(widgetPlaceKind({ layers: [{ dataset: "air-quality", monitors: ["m1"] }] })).toBe(
			"none"
		);
	});
	it("regions for regions, and for points and schools (which resolve to regions)", () => {
		expect(kind({ place: FRESNO })).toBe("regions");
		expect(kind({ selection: { kind: "regions", ids: ["county:06019"] } })).toBe("regions");
		expect(kind({ place: { kind: "point", lat: 36.7, lon: -119.8 } })).toBe("regions");
		expect(kind({ place: { kind: "location", source: "cde-public", code: "1" } })).toBe("regions");
	});
	it("ticked types with no Where don't count: monitors with searched ones, else none", () => {
		expect(
			widgetPlaceKind({ layers: [{ ...PM, monitors: ["m1"], monitorTypes: ["airnow"] }] })
		).toBe("monitors");
		expect(widgetPlaceKind({ layers: [{ ...PM, monitorTypes: ["airnow"] }] })).toBe("none");
	});
	it("none with no Where (or the starter's unresolved one)", () => {
		expect(kind({})).toBe("none");
		expect(kind({ place: { kind: "default-place" } })).toBe("none");
		expect(widgetPlaceKind({ layers: [] })).toBe("none");
	});
	it("reads the widget's Where whatever its layers (a Forecast strip's, weather alone)", () => {
		expect(widgetPlaceKind({ place: FRESNO, layers: [{ dataset: "forecasts" }] })).toBe("regions");
		expect(widgetPlaceKind({ place: FRESNO, layers: [TEMP] })).toBe("regions");
	});
});

describe("widgetInputs", () => {
	const pm25: Layer = { dataset: "air-quality", entryType: "pm25" };
	const smoke: Layer = { dataset: "hms-smoke", entryType: "smoke-density" };
	const use: Layer = { dataset: "pesticide-use", entryType: "pounds-applied" };
	/** A Chart of `data` in Fresno County. */
	const chart = (data: WidgetDataConfig) => ({ type: "chart", data: { place: FRESNO, ...data } });

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
		expect(got.main?.layer).toEqual({ ...pm25, place: FRESNO });
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
		const got = widgetInputs(chart(data), RULES_CATALOG, "regions", undefined, figure);
		expect(got.figureFor).toEqual({ entryType: "pm25", resolution: "month" });
		expect(got.main?.figure).toBe("daily_statistic_mean");
		// The figure is the main's: an overlay never carries it.
		expect(got.overlays[0]).not.toHaveProperty("figure");
		const none = widgetInputs(chart(data), RULES_CATALOG, "regions", undefined, null);
		expect(none.main).not.toHaveProperty("figure");
	});

	it("a weather main needs no figure (the plain mean at every level)", () => {
		const weather: Layer = { dataset: "weather", entryType: "temperature" };
		const got = widgetInputs(chart({ layers: [weather] }), RULES_CATALOG, "regions");
		expect(got.figureFor).toBeNull();
		expect(got.main).not.toHaveProperty("figure");
	});

	it("no input for a widget with no Where", () => {
		const got = widgetInputs(
			{ type: "chart", data: { layers: [pm25, smoke] } },
			RULES_CATALOG,
			"none"
		);
		expect(got.main).toBeNull();
		expect(got.overlays).toEqual([]);
	});
});

describe("widgetEffective", () => {
	const pm25: Layer = { dataset: "air-quality", entryType: "pm25", monitors: ["m"] };
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

describe("queryLayer", () => {
	it("copies the layer's fields at the widget's Where", () => {
		const layer: Layer = { dataset: "air-quality", entryType: "pm25" };
		const data: WidgetDataConfig = { place: FRESNO, layers: [layer] };
		const result = queryLayer(data, layer);
		expect(result).toEqual({ ...layer, place: FRESNO });
		expect(result).not.toBe(layer);
		// A copy: editing the query layer's place doesn't touch the saved data.
		expect(result.place).not.toBe(data.place);
	});

	it("copies a selection and filters", () => {
		const layer: Layer = { dataset: "pesticide-use", filters: { chemical: "a" } };
		const selection = { kind: "regions" as const, ids: ["county:06019", "county:06029"] };
		const result = queryLayer({ selection, layers: [layer] }, layer);
		expect(result).toEqual({ ...layer, selection });
		expect(result.selection).not.toBe(selection);
	});

	it("with no Where, the layer carries its searched monitors but not its ticked types", () => {
		const layer: Layer = { ...PM, monitors: ["m1"], monitorTypes: ["airnow"] };
		expect(queryLayer({ layers: [layer] }, layer)).toEqual({ ...PM, monitors: ["m1"] });
	});

	it("a widget with no Where gives the layer none", () => {
		const result = queryLayer({ layers: [PM] }, PM);
		expect(result).toEqual(PM);
		expect(result).not.toHaveProperty("place");
		expect(result).not.toHaveProperty("selection");
	});

	it("the air-quality layer carries its monitors and ticked types", () => {
		const layer: Layer = { ...PM, monitors: ["m1"], monitorTypes: ["purpleair"] };
		const result = queryLayer({ place: FRESNO, layers: [layer] }, layer);
		expect(result).toEqual({ ...layer, place: FRESNO });
		expect(result.monitors).not.toBe(layer.monitors);
	});

	it("an air-quality layer with no entry type (None) passes no monitors", () => {
		const layer: Layer = { dataset: "air-quality", monitors: ["m1"], monitorTypes: ["airnow"] };
		expect(queryLayer({ layers: [layer] }, layer)).toEqual({ dataset: "air-quality" });
	});

	it("empty lists and other datasets' monitors aren't passed", () => {
		const empty: Layer = { ...PM, monitors: [], monitorTypes: [] };
		expect(queryLayer({ layers: [empty] }, empty)).toEqual(PM);
		const weather: Layer = { ...TEMP, monitors: ["m1"] };
		expect(queryLayer({ layers: [weather] }, weather)).toEqual(TEMP);
	});
});

describe("a humidity air-quality overlay never takes the monitors", () => {
	const WITH_HUMIDITY: CatalogEntry[] = [
		{
			...CATALOG[0],
			entryTypes: [entry("pm25", "pollutant"), entry("humidity", "other")]
		},
		...CATALOG.slice(1)
	];
	const HUMIDITY: Layer = { dataset: "air-quality", entryType: "humidity" };
	// The overlay first, as an untrusted or converted document may order them.
	const data: WidgetDataConfig = {
		dateRange: { kind: "trailing", amount: 7, unit: "day" },
		layers: [HUMIDITY, { ...PM, monitors: ["m1", "m2"], monitorTypes: ["airnow"] }]
	};

	it("the monitors are the pollutant's, wherever the overlay sits", () => {
		expect(widgetMonitors(data, WITH_HUMIDITY)).toEqual({
			monitors: ["m1", "m2"],
			types: ["airnow"]
		});
		// No catalog: the layer holding monitors is the pollutant.
		expect(widgetMonitors(data)).toEqual({ monitors: ["m1", "m2"], types: ["airnow"] });
	});

	it("a Chart's main query asks for them on the pollutant, the overlay at its places", () => {
		// Inside a Where, where ticked types draw.
		const inputs = widgetInputs(
			{ type: "chart", data: { ...data, place: FRESNO } },
			WITH_HUMIDITY,
			"monitor-types"
		);
		expect(inputs.main?.layer).toMatchObject({
			entryType: "pm25",
			monitors: ["m1", "m2"],
			monitorTypes: ["airnow"]
		});
		expect(inputs.overlays[0]?.layer.entryType).toBe("humidity");
		// The humidity layer itself passes no monitors of its own.
		const saved: Layer = { ...HUMIDITY, monitors: ["m9"] };
		expect(queryLayer({ layers: [saved] }, saved, WITH_HUMIDITY)).toEqual(HUMIDITY);
	});
});

describe("a Forecast strip's monitor", () => {
	const strip: Layer = { dataset: "forecasts", monitors: ["m1"] };

	it("its one forecasts layer carries its monitor", () => {
		expect(queryLayer({ layers: [strip] }, strip)).toEqual(strip);
		expect(singleMonitor({ layers: [strip] })).toBe("m1");
		expect(hasPlaces({ layers: [strip] })).toBe(true);
	});

	it("a copy of the strip's layer carries it too; a forecasts layer with an entry type doesn't", () => {
		expect(queryLayer({ layers: [strip] }, { ...strip })).toEqual(strip);
		const aqi: Layer = { dataset: "forecasts", entryType: "aqi-forecast", monitors: ["m1"] };
		expect(queryLayer({ layers: [aqi] }, aqi)).toEqual({
			dataset: "forecasts",
			entryType: "aqi-forecast"
		});
		expect(hasPlaces({ layers: [aqi] })).toBe(false);
	});

	it("a forecasts overlay beside other layers carries none", () => {
		const burn: Layer = { dataset: "forecasts", entryType: "burn-status", monitors: ["m1"] };
		const data = { layers: [PM, burn] };
		expect(queryLayer(data, burn)).toEqual({ dataset: "forecasts", entryType: "burn-status" });
		expect(hasPlaces(data)).toBe(false);
	});
});

describe("chartInput", () => {
	it("asks for searched monitors with no Where", () => {
		const layer: Layer = { ...PM, monitors: ["m1", "m2"] };
		const { input } = chartInput({ layers: [layer] }, CATALOG, "day");
		expect(input?.layer).toEqual(layer);
	});

	it("asks for nothing with no Where and no monitors", () => {
		expect(chartInput({ layers: [PM] }, CATALOG, "day").input).toBeNull();
	});

	it("a Chart with PM2.5, no Where and no monitors asks for nothing and says what to add", () => {
		const got = chartInput({ layers: [PM] }, CATALOG, "day");
		expect(got.input).toBeNull();
		expect(got.empty).toBe("add-where-or-monitors");
		expect(chartInput({ layers: [] }, CATALOG, "day").empty).toBe("add-layers");
		expect(chartInput({ layers: [PM], place: FRESNO }, CATALOG, "day").empty).toBe(undefined);
	});

	it("weather or pesticide use with no Where asks for nothing and says what to add", () => {
		const weather = chartInput({ layers: [TEMP] }, CATALOG, "day");
		expect(weather.input).toBeNull();
		expect(weather.empty).toBe("add-where-or-monitors");
		const use = { dataset: "pesticide-use", entryType: "pounds-applied" };
		expect(chartInput({ layers: [use] }, CATALOG, "month").empty).toBe("add-where-or-monitors");
		expect(chartInput({ layers: [PM, TEMP] }, CATALOG, "day").empty).toBe("add-where-or-monitors");
	});

	it("ticked types alone with no Where ask for nothing and say what to add", () => {
		const layer: Layer = { ...PM, monitorTypes: ["airnow"] };
		const { input, empty } = chartInput({ layers: [layer] }, CATALOG, "day");
		expect(input).toBeNull();
		expect(empty).toBe("add-where-or-monitors");
	});

	it("ticked types and searched monitors with no Where ask for the monitors only", () => {
		const layer: Layer = { ...PM, monitors: ["m1"], monitorTypes: ["airnow"] };
		const { input } = chartInput({ layers: [layer] }, CATALOG, "day");
		expect(input?.layer).toEqual({ ...PM, monitors: ["m1"] });
	});
});

describe("drawnMonitors and idleTypes", () => {
	const ticked: Layer = { ...PM, monitors: ["m1"], monitorTypes: ["airnow"] };
	it("ticked types draw only inside a Where", () => {
		expect(drawnMonitors({ layers: [ticked] })).toEqual({ monitors: ["m1"], types: [] });
		expect(drawnMonitors({ place: FRESNO, layers: [ticked] })).toEqual({
			monitors: ["m1"],
			types: ["airnow"]
		});
	});
	it("idle types are the ticked ones with no Where", () => {
		expect(idleTypes({ layers: [ticked] })).toEqual(["airnow"]);
		expect(idleTypes({ place: FRESNO, layers: [ticked] })).toEqual([]);
		// With the pollutant on None the ticks fetch nothing anyway: not idle for want of a Where.
		expect(idleTypes({ layers: [{ dataset: "air-quality", monitorTypes: ["airnow"] }] })).toEqual(
			[]
		);
	});
});

describe("singleMonitor", () => {
	it("is the one searched monitor with no ticked types", () => {
		expect(singleMonitor({ layers: [{ ...PM, monitors: ["m1"] }] })).toBe("m1");
		expect(singleMonitor({ layers: [{ ...PM, monitors: ["m1", "m2"] }] })).toBeUndefined();
		expect(
			singleMonitor({ layers: [{ ...PM, monitors: ["m1"], monitorTypes: ["airnow"] }] })
		).toBeUndefined();
		expect(singleMonitor({ place: FRESNO, layers: [PM] })).toBeUndefined();
	});
});

describe("widgetWhere", () => {
	it("is the place, else the selection, else nothing (everywhere)", () => {
		expect(widgetWhere({ place: FRESNO, layers: [] })).toEqual({ place: FRESNO });
		const selection = { kind: "regions" as const, ids: ["county:06019"] };
		expect(widgetWhere({ selection, layers: [] })).toEqual({ selection });
		expect(widgetWhere({ layers: [PM] })).toEqual({});
	});
});

describe("wherePurpose", () => {
	it("is the pollutant layer's entry type, else PM2.5", () => {
		const O3 = { dataset: "air-quality", entryType: "o3" };
		const catalog: CatalogEntry[] = [
			{ ...CATALOG[0], entryTypes: [entry("pm25", "pollutant"), entry("o3", "pollutant")] },
			...CATALOG.slice(1)
		];
		expect(wherePurpose({ layers: [TEMP, O3] }, catalog)).toEqual(O3);
		expect(wherePurpose({ layers: [{ dataset: "forecasts" }] }, catalog)).toEqual(PM);
		expect(wherePurpose({ layers: [TEMP] }, catalog)).toEqual(PM);
		// None with monitors kept (an air-quality layer with no entry type): Where's areas as PM2.5's.
		const kept = { dataset: "air-quality", monitors: ["m1"], monitorTypes: ["airnow"] };
		expect(wherePurpose({ layers: [kept, TEMP] }, catalog)).toEqual(PM);
	});

	it("with no catalog, is the first air-quality layer's entry type", () => {
		const O3 = { dataset: "air-quality", entryType: "o3" };
		expect(wherePurpose({ layers: [TEMP, O3] }, undefined)).toEqual(O3);
		expect(wherePurpose({ layers: [TEMP] }, undefined)).toEqual(PM);
	});
});
