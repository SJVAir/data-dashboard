import { describe, expect, it } from "vitest";
import type { Layer } from "./schema";
import { mapDatasetCatalog, type CatalogEntry } from "./metadata";
import {
	MAP_LEVELS,
	datasetOffers,
	effectiveResolution,
	layerOffers,
	offeredFrom,
	rawCause,
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
	it("has no raw at monitor-types (bulk summaries), and a raw-only type offers nothing there", () => {
		expect(layerOffers(pm25, catalog, "monitor-types")).toEqual(["hour", "day", "month", "year"]);
		expect(layerOffers(humidity, catalog, "monitor-types")).toEqual([]);
	});
	it("offers day for smoke and month, year for pesticide use", () => {
		expect(layerOffers(smoke, catalog, "none")).toEqual(["day"]);
		expect(layerOffers(use, catalog, "regions")).toEqual(["month", "year"]);
	});
	it("offers every level for a raw-only air-quality type", () => {
		expect(layerOffers(humidity, catalog, "monitors")).toEqual(ALL5);
	});
	it("offers nothing for a raw-only air-quality type at regions (no raw to downsample)", () => {
		expect(layerOffers(humidity, catalog, "regions")).toEqual([]);
		expect(layerOffers({ dataset: "air-quality", entryType: "pm100" }, catalog, "regions")).toEqual(
			[]
		);
	});
	it("has no raw for weather", () => {
		expect(layerOffers(temperature, catalog, "monitors")).toEqual(["hour", "day", "month", "year"]);
	});
	it("offers nothing for an unknown dataset or entry type", () => {
		expect(layerOffers({ dataset: "nope", entryType: "x" }, catalog, "none")).toEqual([]);
		expect(layerOffers({ dataset: "air-quality", entryType: "x" }, catalog, "none")).toEqual([]);
	});
	it("offers every level for a place-less layer whose dataset the catalog lacks", () => {
		expect(layerOffers({ dataset: "nope" }, catalog, "none")).toEqual(ALL5);
	});
	it("offers day for fire and notices when the catalog lists them", () => {
		const entry = (dataset: string, entryType: string): CatalogEntry => ({
			id: dataset,
			label: dataset,
			geographies: ["polygon"],
			entryTypes: [
				{
					id: entryType,
					label: entryType,
					units: "",
					kind: "other",
					resolutions: ["raw", "day"],
					precision: null,
					yMin: null,
					chart: null,
					aggregate: null,
					available: true
				}
			]
		});
		const withBoth = [
			...catalog,
			entry("hms-fire", "fire-radiative-power"),
			entry("pesticide-notices", "spray-notice")
		];
		expect(layerOffers({ dataset: "hms-fire" }, withBoth, "none")).toEqual(["day"]);
		expect(layerOffers({ dataset: "pesticide-notices" }, withBoth, "none")).toEqual(["day"]);
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

describe("effectiveResolution for a Map's place-less layers", () => {
	const map = {
		catalog,
		place: "monitors" as const,
		spanDays: 30,
		within: MAP_LEVELS,
		floor: "day" as const
	};
	const smokeLayer: Layer = { dataset: "hms-smoke" };
	const fireLayer: Layer = { dataset: "hms-fire" };
	const useLayer: Layer = { dataset: "pesticide-use" };
	const notices: Layer = { dataset: "pesticide-notices" };
	it("stays at day with smoke and fire", () => {
		const e = effectiveResolution({ ...map, data: { layers: [pm25, smokeLayer, fireLayer] } });
		expect(e).toMatchObject({ resolution: "day", misfits: [] });
	});
	it("moves to month with pesticide use", () => {
		const e = effectiveResolution({ ...map, data: { layers: [pm25, useLayer] } });
		expect(e.resolution).toBe("month");
		expect(e.movedBy).toBe(useLayer);
	});
	it("lets the pollutant decide when layers share nothing", () => {
		const e = effectiveResolution({ ...map, data: { layers: [pm25, smokeLayer, useLayer] } });
		expect(e.resolution).toBe("day");
		expect(e.misfits).toEqual([useLayer]);
	});
	it("lets the first layer decide when no layer has an entry type", () => {
		const e = effectiveResolution({ ...map, data: { layers: [smokeLayer, useLayer] } });
		expect(e).toMatchObject({ resolution: "day", automatic: true });
		expect(e.misfits).toEqual([useLayer]);
	});
	it("lists a misfit for an explicit level", () => {
		const e = effectiveResolution({
			...map,
			data: { layers: [pm25, notices], resolution: "month" }
		});
		expect(e.misfits).toEqual([notices]);
	});
	it("marks a stored quarter or season (no level offers them) unusable, never Automatic", () => {
		for (const resolution of ["quarter", "season"] as const) {
			const e = effectiveResolution({ ...map, data: { layers: [pm25], resolution } });
			expect(e).toMatchObject({ automatic: false, unusable: true, misfits: [] });
		}
	});
	it("marks a stored hour or raw unusable on a Map (outside its levels)", () => {
		for (const resolution of ["hour", "raw"] as const) {
			const e = effectiveResolution({ ...map, data: { layers: [pm25], resolution } });
			expect(e).toMatchObject({ automatic: false, unusable: true, misfits: [] });
		}
	});
	it("keeps a stored level the widget offers usable", () => {
		const e = effectiveResolution({ ...map, data: { layers: [pm25], resolution: "month" } });
		expect(e.unusable).toBeUndefined();
		const chart = effectiveResolution({
			catalog,
			place: "monitors",
			spanDays: 30,
			data: { layers: [pm25], resolution: "hour" }
		});
		expect(chart).toMatchObject({ resolution: "hour", automatic: false });
		expect(chart.unusable).toBeUndefined();
	});
	it("lets a pin win over a stored quarter", () => {
		const e = effectiveResolution({
			catalog,
			place: "monitors",
			spanDays: 30,
			pin: "day",
			data: { layers: [pm25], resolution: "quarter" }
		});
		expect(e).toMatchObject({ resolution: "day", automatic: false });
		expect(e.unusable).toBeUndefined();
	});
});

describe("offeredFrom", () => {
	it("is the finest offered level", () => {
		expect(offeredFrom(use, catalog, "regions")).toBe("month");
		expect(offeredFrom({ dataset: "nope", entryType: "x" }, catalog, "none")).toBeNull();
	});
});

describe("rawCause", () => {
	it("names the place when it, not the dataset, has no raw", () => {
		expect(rawCause(pm25, catalog, "regions")).toBe("area");
		expect(rawCause(pm25, catalog, "monitor-types")).toBe("monitor-types");
	});
	it("is null where raw is offered, or where the dataset itself has none", () => {
		expect(rawCause(pm25, catalog, "monitors")).toBeNull();
		expect(rawCause(temperature, catalog, "regions")).toBeNull();
	});
});
