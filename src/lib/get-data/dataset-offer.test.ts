import { describe, expect, it } from "vitest";
import { MAP_LEVELS } from "$lib/data/dataset-rules";
import { mapDatasetCatalog } from "$lib/data/metadata";
import type { Layer } from "$lib/data/schema";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "$lib/data/testing/dataset-catalog";
import { datasetBlock, datasetBlockText, wholePeriodRange } from "./dataset-offer";

const catalog = mapDatasetCatalog({
	...SDK_DATASET_CATALOG,
	datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
});

const pm25: Layer = { dataset: "air-quality", entryType: "pm25" };
const smoke: Layer = { dataset: "hms-smoke", entryType: "smoke-density" };
const use: Layer = { dataset: "pesticide-use", entryType: "pounds-applied" };
const temperature: Layer = { dataset: "weather", entryType: "temperature" };
const base = { catalog, place: "monitors" as const };

describe("datasetBlock", () => {
	it("an explicit level a dataset doesn't offer names the nearest level it does", () => {
		expect(datasetBlock({ ...base, candidate: [use], chosen: [pm25], resolution: "day" })).toEqual({
			kind: "not-offered",
			at: "day",
			suggest: "month"
		});
		expect(
			datasetBlock({ ...base, candidate: [smoke], chosen: [pm25], resolution: "hour" })
		).toEqual({ kind: "not-offered", at: "hour", suggest: "day" });
		expect(
			datasetBlock({ ...base, candidate: [temperature], chosen: [pm25], resolution: "raw" })
		).toEqual({ kind: "not-offered", at: "raw", suggest: "hour" });
	});
	it("an explicit level the dataset offers blocks nothing", () => {
		expect(
			datasetBlock({ ...base, candidate: [use], chosen: [pm25], resolution: "month" })
		).toBeNull();
	});
	it("Automatic blocks only a dataset sharing no level with those chosen", () => {
		expect(datasetBlock({ ...base, candidate: [use], chosen: [pm25] })).toBeNull();
		expect(datasetBlock({ ...base, candidate: [smoke], chosen: [pm25] })).toBeNull();
		expect(datasetBlock({ ...base, candidate: [use], chosen: [pm25, smoke] })).toEqual({
			kind: "no-common",
			by: "month"
		});
		expect(datasetBlock({ ...base, candidate: [use], chosen: [] })).toBeNull();
	});
	it("keeps to the Map's levels", () => {
		const fire: Layer = { dataset: "hms-fire" };
		const placeLess: Layer = { dataset: "hms-smoke" };
		expect(
			datasetBlock({
				...base,
				candidate: [placeLess, fire],
				chosen: [pm25],
				resolution: "month",
				within: MAP_LEVELS
			})
		).toEqual({ kind: "not-offered", at: "month", suggest: "day" });
		expect(
			datasetBlock({
				...base,
				candidate: [{ dataset: "pesticide-use" }],
				chosen: [pm25, placeLess, fire],
				within: MAP_LEVELS
			})
		).toEqual({ kind: "no-common", by: "month" });
	});
});

describe("datasetBlockText", () => {
	it("says how the dataset is reported and what to set", () => {
		expect(datasetBlockText({ kind: "not-offered", at: "day", suggest: "month" })).toBe(
			"Reported by month. Set the data resolution to Monthly to add it."
		);
		expect(datasetBlockText({ kind: "not-offered", at: "hour", suggest: "day" })).toBe(
			"Reported by day. Set the data resolution to Daily to add it."
		);
		expect(datasetBlockText({ kind: "not-offered", at: "raw", suggest: "hour" })).toBe(
			"Has no individual measurements. Set the data resolution to Hourly to add it."
		);
		expect(datasetBlockText({ kind: "no-common", by: "month" })).toBe(
			"Can't line up with the datasets you chose: it's reported by month."
		);
	});
});

describe("datasetBlockText for a pinned type", () => {
	it("says the calendar sets the level", () => {
		expect(datasetBlockText({ kind: "not-offered", at: "day", suggest: "month" }, true)).toBe(
			"Reported by month, but this calendar shows daily data."
		);
	});
});

describe("wholePeriodRange", () => {
	it("stores a month range's first and last days", () => {
		expect(wholePeriodRange("2026-03", "2026-02", "month")).toEqual({
			kind: "custom",
			start: "2026-03-01",
			end: "2026-02-28"
		});
		expect(wholePeriodRange("2024-01", "2024-02", "month")).toEqual({
			kind: "custom",
			start: "2024-01-01",
			end: "2024-02-29"
		});
	});
	it("stores a year range's first and last days", () => {
		expect(wholePeriodRange("2021", "2023", "year")).toEqual({
			kind: "custom",
			start: "2021-01-01",
			end: "2023-12-31"
		});
	});
});

describe("a raw block caused by the place", () => {
	it("names the area, or the ticked types, and the level to set", () => {
		const block = datasetBlock({
			catalog,
			place: "regions",
			candidate: [pm25],
			chosen: [],
			resolution: "raw"
		});
		expect(block).toEqual({ kind: "not-offered", at: "raw", suggest: "hour", cause: "area" });
		expect(datasetBlockText(block!)).toBe(
			"Air quality for an area is summarized. Set the data resolution to Hourly to add it."
		);
		const types = datasetBlock({
			catalog,
			place: "monitor-types",
			candidate: [pm25],
			chosen: [],
			resolution: "raw"
		});
		expect(datasetBlockText(types!)).toBe(
			"Ticked monitor types are summarized. Set the data resolution to Hourly to add it."
		);
	});
	it("weather keeps its own reason", () => {
		const block = datasetBlock({
			catalog,
			place: "regions",
			candidate: [temperature],
			chosen: [],
			resolution: "raw"
		});
		expect(block).not.toHaveProperty("cause");
	});
});
