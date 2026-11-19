import { describe, expect, it } from "vitest";
import type { Layer } from "./schema";
import { mapDatasetCatalog } from "./metadata";
import {
	MAP_LEVELS,
	datasetOffers,
	effectiveResolution,
	layerOffers,
	offeredFrom,
	rangeLevel
} from "./dataset-rules";
import {
	PESTICIDE_USE_DATASET,
	SDK_DATASET_CATALOG,
	WEATHER_DATASET
} from "./testing/dataset-catalog";

const catalog = mapDatasetCatalog({
	...SDK_DATASET_CATALOG,
	datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
});

const pm25: Layer = { dataset: "air-quality", entryType: "pm25" };
const humidity: Layer = { dataset: "air-quality", entryType: "humidity" };
const smoke: Layer = { dataset: "hms-smoke", entryType: "smoke-density" };
const use: Layer = { dataset: "pesticide-use", entryType: "pounds-applied" };
const temperature: Layer = { dataset: "weather", entryType: "temperature" };
const ALL5 = ["raw", "hour", "day", "month", "year"];

describe("layerOffers", () => {
	it("offers every level for pm25 at monitors", () => {
		expect(layerOffers(pm25, catalog, "monitors")).toEqual(ALL5);
	});
	it("has no raw at regions", () => {
		expect(layerOffers(pm25, catalog, "regions")).toEqual(["hour", "day", "month", "year"]);
	});
	it("offers day for smoke and month, year for pesticide use", () => {
		expect(layerOffers(smoke, catalog, "none")).toEqual(["day"]);
		expect(layerOffers(use, catalog, "regions")).toEqual(["month", "year"]);
	});
	it("offers every level for a raw-only air-quality type", () => {
		expect(layerOffers(humidity, catalog, "monitors")).toEqual(ALL5);
	});
	it("has no raw for weather", () => {
		expect(layerOffers(temperature, catalog, "monitors")).toEqual(["hour", "day", "month", "year"]);
	});
	it("offers nothing for an unknown dataset or entry type", () => {
		expect(layerOffers({ dataset: "nope", entryType: "x" }, catalog, "none")).toEqual([]);
		expect(layerOffers({ dataset: "air-quality", entryType: "x" }, catalog, "none")).toEqual([]);
	});
});

describe("datasetOffers", () => {
	it("intersects the layers' levels", () => {
		expect(datasetOffers([pm25, use], catalog, "regions")).toEqual(["month", "year"]);
		expect(datasetOffers([pm25, smoke], catalog, "monitors")).toEqual(["day"]);
		expect(datasetOffers([smoke, use], catalog, "regions")).toEqual([]);
	});
	it("limits to `within`", () => {
		expect(datasetOffers([pm25], catalog, "monitors", MAP_LEVELS)).toEqual([
			"day",
			"month",
			"year"
		]);
	});
});

describe("rangeLevel", () => {
	it("follows the ladder", () => {
		expect([2, 7, 30, 365, 366].map(rangeLevel)).toEqual(["raw", "hour", "day", "day", "month"]);
	});
});

describe("effectiveResolution", () => {
	const base = { catalog, place: "regions" as const, spanDays: 30 };
	it("is Automatic day for a 30-day pm25 range", () => {
		const e = effectiveResolution({ ...base, data: { layers: [pm25] } });
		expect(e).toMatchObject({ resolution: "day", automatic: true, misfits: [] });
		expect(e.movedBy).toBeUndefined();
	});
	it("moves to month with pesticide use and back when it is removed", () => {
		const e = effectiveResolution({ ...base, data: { layers: [pm25, use] } });
		expect(e.resolution).toBe("month");
		expect(e.movedBy).toBe(use);
		const back = effectiveResolution({ ...base, data: { layers: [pm25] } });
		expect(back.resolution).toBe("day");
		expect(back.movedBy).toBeUndefined();
	});
	it("keeps an explicit level and lists misfits", () => {
		const e = effectiveResolution({
			...base,
			place: "monitors",
			data: { layers: [pm25, smoke], resolution: "hour" }
		});
		expect(e).toMatchObject({ resolution: "hour", automatic: false, misfits: [smoke] });
	});
	it("uses a pin over the stored level", () => {
		const e = effectiveResolution({
			...base,
			data: { layers: [pm25], resolution: "month" },
			pin: "day"
		});
		expect(e).toMatchObject({ resolution: "day", automatic: false });
	});
	it("honours a floor", () => {
		const e = effectiveResolution({
			...base,
			place: "monitors",
			spanDays: 2,
			data: { layers: [pm25] },
			floor: "day"
		});
		expect(e.resolution).toBe("day");
	});
	it("lets the main layer decide when layers share nothing", () => {
		const e = effectiveResolution({ ...base, data: { layers: [smoke, use] } });
		// A number layer outranks an "other" layer as main (`mainLayer`): use decides, smoke misfits.
		expect(e.resolution).toBe("month");
		expect(e.misfits).toEqual([smoke]);
	});
});

describe("offeredFrom", () => {
	it("is the finest offered level", () => {
		expect(offeredFrom(use, catalog, "regions")).toBe("month");
		expect(offeredFrom({ dataset: "nope" }, catalog, "none")).toBeNull();
	});
});
