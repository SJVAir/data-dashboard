import { describe, expect, it } from "vitest";
import { mapDatasetCatalog, type CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import {
	addPesticideLayer,
	dropStationOnPlaceChange,
	levelOnly,
	removeLayer,
	setFilters,
	setPollutant,
	setStation,
	toggleLayer
} from "./layers";

const CATALOG: CatalogEntry[] = [
	...mapDatasetCatalog({
		...SDK_DATASET_CATALOG,
		datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
	}),
	{
		id: "hms-smoke",
		label: "Wildfire Smoke",
		entryTypes: [
			{
				id: "smoke-density",
				label: "Smoke density",
				units: "",
				kind: "other",
				resolutions: ["day"],
				precision: null,
				yMin: null,
				chart: null,
				aggregate: null
			}
		],
		geographies: ["region"]
	}
];

const FRESNO = { kind: "region" as const, type: "county", code: "06019" };

function pm25With(...rest: WidgetDataConfig["layers"]): WidgetDataConfig {
	return {
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		place: FRESNO,
		layers: [{ dataset: "air-quality", entryType: "pm25" }, ...rest]
	};
}

const temperature = { dataset: "weather", entryType: "temperature" };
const precipitation = { dataset: "weather", entryType: "precipitation" };
const smoke = { dataset: "hms-smoke", entryType: "smoke-density" };

describe("draft layers", () => {
	it("removing the pollutant keeps Where", () => {
		const data = pm25With({ ...smoke }, { ...temperature });
		data.resolution = "day";
		setPollutant(data, CATALOG, null);
		expect(data.layers).toEqual([{ ...smoke }, { ...temperature }]);
		expect(data.place).toEqual(FRESNO);
		expect(data.resolution).toBe("day");
	});

	it("a specific level never changes by itself: raw stays on a weather main (shown blocked)", () => {
		const data = pm25With({ ...temperature });
		data.resolution = "raw";
		setPollutant(data, CATALOG, null);
		expect(data.layers).toEqual([{ ...temperature }]);
		expect(data.resolution).toBe("raw");
	});

	it("switching the pollutant keeps a level the new one doesn't offer", () => {
		const data = pm25With();
		data.resolution = "raw";
		setPollutant(data, CATALOG, { dataset: "weather", entryType: "temperature" });
		expect(data.resolution).toBe("raw");
	});

	it("the last number layer can't be removed", () => {
		const data = pm25With({ ...smoke });
		const before = structuredClone(data);
		setPollutant(data, CATALOG, null);
		expect(data).toEqual(before);
		removeLayer(data, CATALOG, 0);
		expect(data).toEqual(before);

		// Temperature alone (after the pollutant went): it stays.
		const alone: WidgetDataConfig = { place: FRESNO, layers: [{ ...temperature }, { ...smoke }] };
		removeLayer(alone, CATALOG, 0);
		expect(alone.layers).toHaveLength(2);
		// A level layer can go.
		removeLayer(alone, CATALOG, 1);
		expect(alone.layers).toEqual([{ ...temperature }]);
	});

	it("a pollutant chosen again becomes the main layer; Where stays", () => {
		const data: WidgetDataConfig = { place: FRESNO, layers: [{ ...temperature }] };
		setPollutant(data, CATALOG, { dataset: "air-quality", entryType: "pm25" });
		expect(data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" },
			{ ...temperature }
		]);
		expect(data.place).toEqual(FRESNO);
	});

	it("a number layer added to a level-only widget becomes the main", () => {
		const data: WidgetDataConfig = { place: FRESNO, layers: [{ ...smoke }] };
		toggleLayer(data, CATALOG, temperature, true);
		expect(data.layers).toEqual([{ ...smoke }, { ...temperature }]);
		expect(data.place).toEqual(FRESNO);
	});

	it("a pesticide layer can be added twice with different filters", () => {
		const data = pm25With();
		addPesticideLayer(data, CATALOG, "pounds-applied");
		addPesticideLayer(data, CATALOG, "pounds-applied");
		setFilters(data, 2, { iarcGroup: "1", category: [] });
		expect(data.layers.slice(1)).toEqual([
			{ dataset: "pesticide-use", entryType: "pounds-applied" },
			{ dataset: "pesticide-use", entryType: "pounds-applied", filters: { iarcGroup: "1" } }
		]);
		setFilters(data, 2, {});
		expect(data.layers[2]).toEqual({ dataset: "pesticide-use", entryType: "pounds-applied" });
	});

	it("setStation sets every weather layer", () => {
		const data = pm25With({ ...temperature }, { ...precipitation });
		setStation(data, "st2");
		expect(data.layers.map((l) => l.station)).toEqual([undefined, "st2", "st2"]);
		setStation(data, undefined);
		expect(data.layers.some((l) => "station" in l)).toBe(false);

		// A weather layer added later uses the same station.
		const one = pm25With({ ...temperature });
		setStation(one, "st2");
		toggleLayer(one, CATALOG, precipitation, true);
		expect(one.layers[2].station).toBe("st2");
	});

	it("changing places drops the station", () => {
		const data = pm25With({ ...temperature, station: "st2" });
		dropStationOnPlaceChange(data);
		expect(data.layers[1]).toEqual({ ...temperature });
	});

	it("levelOnly is true for smoke alone", () => {
		expect(levelOnly({ place: FRESNO, layers: [{ ...smoke }] }, CATALOG)).toBe(true);
		expect(levelOnly(pm25With({ ...smoke }), CATALOG)).toBe(false);
		expect(levelOnly({ place: FRESNO, layers: [{ ...temperature }] }, CATALOG)).toBe(false);
		// Not known yet: nothing is blocked.
		expect(levelOnly({ layers: [{ ...smoke }] }, undefined)).toBe(false);
	});

	it("MAX_OVERLAYS counts pesticide layers", () => {
		const data = pm25With();
		addPesticideLayer(data, CATALOG, "pounds-applied");
		addPesticideLayer(data, CATALOG, "acres-treated");
		addPesticideLayer(data, CATALOG, "applications");
		expect(data.layers).toHaveLength(3);
		toggleLayer(data, CATALOG, temperature, true);
		expect(data.layers).toHaveLength(3);
		// Bringing a pollutant back would make three overlays.
		const noPollutant: WidgetDataConfig = {
			place: FRESNO,
			layers: [{ ...temperature }, { ...precipitation }, { ...smoke }]
		};
		setPollutant(noPollutant, CATALOG, { dataset: "air-quality", entryType: "pm25" });
		expect(noPollutant.layers).toHaveLength(3);
	});

	it("unchecking a layer removes it; Where stays", () => {
		const data: WidgetDataConfig = {
			place: FRESNO,
			layers: [{ ...temperature }, { ...precipitation }]
		};
		toggleLayer(data, CATALOG, temperature, false);
		expect(data.layers).toEqual([{ ...precipitation }]);
		expect(data.place).toEqual(FRESNO);
	});
});
