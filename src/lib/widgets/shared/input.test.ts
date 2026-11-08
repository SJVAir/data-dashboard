import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import { mainLayer } from "./input";

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
