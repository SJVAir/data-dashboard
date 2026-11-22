import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetType } from "$lib/widgets/registry";
import type { OfferedDataset } from "./offer";
import { FILL, sectionTypes, whatSections } from "./what-sections";

const entry = (id: string): CatalogEntry => ({ id, label: id, entryTypes: [], geographies: [] });
const offer = (id: string): OfferedDataset => ({
	dataset: entry(id),
	entryTypes: [],
	layerTypes: [],
	overlayTypes: []
});
const type = (id: string, datasets: string[]): WidgetType =>
	({ type: id, label: () => id, accepts: { datasets } }) as unknown as WidgetType;

const CATALOG = [
	"air-quality",
	"weather",
	"hms-smoke",
	"hms-fire",
	"pesticide-use",
	"pesticide-notices",
	"forecasts",
	"emissions"
].map(entry);
const OFFERED = ["air-quality", "weather", "hms-smoke", "pesticide-use", "forecasts"].map(offer);

const MAP = type("map", ["air-quality", "hms-smoke", "hms-fire"]);
const CHART = type("chart", ["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"]);
const CURRENT = type("current-conditions", ["air-quality"]);
const STRIP = type("forecast-strip", ["forecasts"]);
const TYPES = [CHART, MAP, CURRENT, STRIP];

describe("whatSections", () => {
	it("lists the offered datasets and the Map's own in catalog order, fire with smoke, fill last", () => {
		expect(whatSections(CATALOG, OFFERED, []).map((s) => s.key)).toEqual([
			"air-quality",
			"weather",
			"hms-smoke",
			"pesticide-use",
			"pesticide-notices",
			"forecasts",
			FILL
		]);
	});

	it("never lists a dataset no type shows (emissions has no adapter and no section)", () => {
		expect(whatSections(CATALOG, OFFERED, []).map((s) => s.key)).not.toContain("emissions");
	});

	it("keeps Air quality and Smoke and fire without a catalog entry; notices and use only when on", () => {
		const bare = [entry("weather")];
		expect(whatSections(bare, [offer("weather")], []).map((s) => s.key)).toEqual([
			"air-quality",
			"weather",
			"hms-smoke",
			FILL
		]);
		const on = [{ dataset: "pesticide-notices" }, { dataset: "pesticide-use" }];
		expect(whatSections(bare, [offer("weather")], on).map((s) => s.key)).toEqual([
			"air-quality",
			"weather",
			"hms-smoke",
			"pesticide-use",
			"pesticide-notices",
			FILL
		]);
	});
});

describe("sectionTypes", () => {
	it("is the types that accept the dataset, plus the Map for its own sections", () => {
		expect(sectionTypes("weather", TYPES)).toEqual([CHART]);
		expect(sectionTypes("hms-smoke", TYPES)).toEqual([CHART, MAP]);
		expect(sectionTypes("pesticide-use", TYPES)).toEqual([CHART, MAP]);
		expect(sectionTypes("pesticide-notices", TYPES)).toEqual([MAP]);
		expect(sectionTypes(FILL, TYPES)).toEqual([MAP]);
		expect(sectionTypes("forecasts", TYPES)).toEqual([CHART, STRIP]);
	});

	it("gives the Forecast strip Air quality: its one monitor is searched there (decision 11)", () => {
		expect(sectionTypes("air-quality", TYPES)).toEqual([CHART, MAP, CURRENT, STRIP]);
	});
});
