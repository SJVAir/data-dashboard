import { describe, expect, it } from "vitest";
import type { ChosenPlace } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { DEFAULT_LAYER } from "../defaults";
import { mapStartData } from "./start";

const TULARE: ChosenPlace = { kind: "region", type: "county", code: "06107" };
const KERN: ChosenPlace = { kind: "region", type: "county", code: "06029" };

function widget(id: string, place: ChosenPlace): WidgetInstance {
	return {
		id,
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 4 },
		data: { layers: [{ dataset: "air-quality", entryType: "pm25", place }] }
	} as unknown as WidgetInstance;
}

function doc(widgets: WidgetInstance[], bar?: ChosenPlace): Dashboard {
	return {
		id: "d",
		name: "D",
		body: { widgets, ...(bar ? { placeBar: { place: bar } } : {}) }
	} as unknown as Dashboard;
}

describe("mapStartData", () => {
	it("starts at the bar's place when the bar shows", () => {
		const data = mapStartData(doc([widget("a", TULARE)], TULARE));
		expect(data.layers).toEqual([
			{ dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType, place: TULARE }
		]);
	});

	it("ignores a bar no widget shows", () => {
		const data = mapStartData(doc([widget("a", KERN)], TULARE));
		expect(data.layers?.[0].place).toEqual(KERN);
	});

	it("falls back to the most common place, then Fresno County", () => {
		const common = mapStartData(doc([widget("a", KERN), widget("b", KERN), widget("c", TULARE)]));
		expect(common.layers?.[0].place).toEqual(KERN);
		const empty = mapStartData(doc([]));
		expect(empty.layers?.[0].place).toEqual(DEFAULT_LAYER.place);
	});
});
