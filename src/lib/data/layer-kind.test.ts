import { describe, expect, it } from "vitest";
import { layerKind } from "./layer-kind";
import { mapDatasetCatalog, type CatalogEntry } from "./metadata";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "./testing/dataset-catalog";

const entry = (id: string) => ({
	id,
	label: id,
	units: "",
	kind: "other" as const,
	resolutions: ["day" as const],
	precision: null,
	yMin: null,
	chart: null,
	aggregate: null
});

const CATALOG: CatalogEntry[] = [
	...mapDatasetCatalog({
		...SDK_DATASET_CATALOG,
		datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
	}),
	{
		id: "forecasts",
		label: "Forecasts",
		entryTypes: [entry("burn-status"), entry("aqi-forecast")],
		geographies: []
	}
];

describe("layerKind", () => {
	it("pollutants, levels and numbers", () => {
		const kind = (dataset: string, entryType: string) => layerKind({ dataset, entryType }, CATALOG);
		expect(kind("air-quality", "pm25")).toBe("pollutant");
		expect(kind("forecasts", "burn-status")).toBe("level");
		expect(kind("forecasts", "aqi-forecast")).toBe("level");
		expect(kind("hms-smoke", "smoke-density")).toBe("level");
		expect(kind("weather", "temperature")).toBe("number");
		expect(kind("pesticide-use", "pounds-applied")).toBe("number");
	});

	it("an unknown entry type has no kind", () => {
		expect(layerKind({ dataset: "air-quality", entryType: "nope" }, CATALOG)).toBeUndefined();
		expect(layerKind({ dataset: "air-quality" }, CATALOG)).toBeUndefined();
		expect(layerKind({ dataset: "air-quality", entryType: "pm25" }, undefined)).toBeUndefined();
	});
});
