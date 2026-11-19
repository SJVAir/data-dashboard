import { describe, expect, it } from "vitest";
import type { Effective } from "$lib/data/dataset-rules";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { m } from "$lib/paraglide/messages.js";
import { mapNotShown, notShownNotes } from "./not-shown";

const pm25: Layer = {
	dataset: "air-quality",
	entryType: "pm25",
	place: { kind: "monitor", id: "a" }
};
const smoke: Layer = { dataset: "hms-smoke" };
const fire: Layer = { dataset: "hms-fire" };
const use: Layer = { dataset: "pesticide-use" };
const data = (...layers: Layer[]): WidgetDataConfig => ({ layers });
const at = (misfits: Layer[]): Effective => ({ resolution: "month", automatic: false, misfits });

describe("mapNotShown", () => {
	it("on Now (no effective resolution), only pesticide use isn't drawn", () => {
		expect(mapNotShown(data(pm25, smoke, fire, use), null)).toEqual(["pesticide-use"]);
		expect(mapNotShown(data(pm25, smoke), null)).toEqual([]);
	});
	it("with a range, the place-less misfits' datasets, once each; a pollutant never", () => {
		expect(mapNotShown(data(pm25, smoke, fire, use), at([smoke, fire]))).toEqual([
			"hms-smoke",
			"hms-fire"
		]);
		expect(mapNotShown(data(pm25, use), at([pm25, use, { ...use }]))).toEqual(["pesticide-use"]);
	});
});

describe("notShownNotes", () => {
	const catalog = [
		{ id: "hms-smoke", label: "Wildfire Smoke" },
		{ id: "pesticide-use", label: "Pesticide Use" }
	] as unknown as CatalogEntry[];
	it("names each dataset by the catalog's label, skipping ones it doesn't list", () => {
		expect(notShownNotes(["hms-smoke", "hms-fire", "pesticide-use"], catalog)).toEqual([
			{ id: "hms-smoke", message: m.map_layer_not_lined_up({ dataset: "Wildfire Smoke" }) },
			{ id: "pesticide-use", message: m.map_layer_not_lined_up({ dataset: "Pesticide Use" }) }
		]);
		expect(notShownNotes(["hms-smoke"], undefined)).toEqual([]);
	});
});
