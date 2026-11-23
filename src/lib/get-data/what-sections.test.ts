import { describe, expect, it } from "vitest";
import type { CatalogEntry, LocationGroup } from "$lib/data/metadata";
import type { WidgetType } from "$lib/widgets/registry";
import type { OfferedDataset } from "./offer";
import {
	FILL,
	LOCATIONS_GONE,
	locationSectionKey,
	sectionTypes,
	toggledLocationTypes,
	whatSections
} from "./what-sections";

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

const GROUPS: LocationGroup[] = [
	{
		key: "school",
		label: "Schools",
		order: 0,
		types: [
			{ type: "public_school", label: "Public school", source: "cde-public" },
			{ type: "private_school", label: "Private school", source: "cde-private" }
		]
	},
	{
		key: "child_care",
		label: "Child care",
		order: 1,
		types: [{ type: "child_care", label: "Child care", source: "cdss-ccl" }]
	}
];

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

describe("whatSections: location groups", () => {
	it("lists a section per group, in order, after the pesticide sections and before the fill", () => {
		const keys = whatSections(CATALOG, OFFERED, [], GROUPS).map((s) => s.key);
		expect(keys.slice(-3)).toEqual(["locations:school", "locations:child_care", FILL]);
		expect(keys.indexOf("pesticide-notices")).toBeLessThan(keys.indexOf("locations:school"));
		const section = whatSections(CATALOG, OFFERED, [], GROUPS).find(
			(s) => s.key === "locations:school"
		);
		expect(section?.group).toBe(GROUPS[0]);
	});

	it("lists none with no groups, or while they load (undefined)", () => {
		const keys = (groups?: LocationGroup[]) =>
			whatSections(CATALOG, OFFERED, [], groups).map((s) => s.key);
		expect(keys([]).some((k) => k.startsWith("locations"))).toBe(false);
		expect(keys(undefined).some((k) => k.startsWith("locations"))).toBe(false);
	});

	it("lists the saved types no group offers in one block after the groups (once the groups are known)", () => {
		const layers = [{ dataset: "locations", locationTypes: ["public_school", "gone_type"] }];
		const sections = whatSections(CATALOG, OFFERED, layers, GROUPS);
		expect(sections.map((s) => s.key).slice(-4)).toEqual([
			"locations:school",
			"locations:child_care",
			LOCATIONS_GONE,
			FILL
		]);
		expect(sections.find((s) => s.key === LOCATIONS_GONE)?.gone).toEqual(["gone_type"]);
		expect(whatSections(CATALOG, OFFERED, layers, []).map((s) => s.key)).toContain(LOCATIONS_GONE);
		expect(whatSections(CATALOG, OFFERED, layers, undefined).map((s) => s.key)).not.toContain(
			LOCATIONS_GONE
		);
	});

	it("keys a group's section by its key", () => {
		expect(locationSectionKey("school")).toBe("locations:school");
	});
});

describe("toggledLocationTypes", () => {
	it("keeps the meta's order whatever the tick order", () => {
		expect(toggledLocationTypes(GROUPS, [], "child_care", true)).toEqual(["child_care"]);
		expect(toggledLocationTypes(GROUPS, ["child_care"], "public_school", true)).toEqual([
			"public_school",
			"child_care"
		]);
		expect(
			toggledLocationTypes(GROUPS, ["child_care", "public_school"], "private_school", true)
		).toEqual(["public_school", "private_school", "child_care"]);
	});

	it("unticks, keeping saved types no group offers after the offered ones, in saved order", () => {
		expect(
			toggledLocationTypes(GROUPS, ["zeta", "child_care", "alpha"], "child_care", false)
		).toEqual(["zeta", "alpha"]);
		expect(toggledLocationTypes(GROUPS, ["zeta", "alpha"], "public_school", true)).toEqual([
			"public_school",
			"zeta",
			"alpha"
		]);
		expect(toggledLocationTypes(GROUPS, ["gone_type"], "gone_type", false)).toEqual([]);
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

	it("offers the location sections to the Map only", () => {
		expect(sectionTypes(locationSectionKey("school"), TYPES)).toEqual([MAP]);
		expect(sectionTypes(LOCATIONS_GONE, TYPES)).toEqual([MAP]);
	});

	it("gives the Forecast strip Air quality: its one monitor is searched there (decision 11)", () => {
		expect(sectionTypes("air-quality", TYPES)).toEqual([CHART, MAP, CURRENT, STRIP]);
	});
});
