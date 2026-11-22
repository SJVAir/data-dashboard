import { describe, expect, it, vi } from "vitest";

const types = vi.hoisted(() => ({ list: async () => [{ type: "airnow" }, { type: "purpleair" }] }));
vi.mock("$lib/data", () => ({ getMetadata: () => ({ monitorTypes: () => types.list() }) }));
vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));
import type { ChosenPlace } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { DEFAULT_LAYER, DEFAULT_PLACE } from "../defaults";
import { mapStartData, mapStartDataWithTypes } from "./start";

const TULARE: ChosenPlace = { kind: "region", type: "county", code: "06107" };
const KERN: ChosenPlace = { kind: "region", type: "county", code: "06029" };

function widget(id: string, place: ChosenPlace): WidgetInstance {
	return {
		id,
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 4, h: 4 },
		data: { place, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
	} as unknown as WidgetInstance;
}

function doc(widgets: WidgetInstance[], bar?: ChosenPlace): Dashboard {
	return {
		id: "d",
		name: "D",
		body: { widgets, ...(bar ? { placeBar: { place: bar } } : {}) }
	} as unknown as Dashboard;
}

describe("mapStartDataWithTypes", () => {
	it("new Map: every monitor type is ticked, from the monitors meta", async () => {
		const data = await mapStartDataWithTypes(doc([]));
		expect(data.layers[0].monitorTypes).toEqual(["airnow", "purpleair"]);
	});

	it("ticks none when the meta can't be read", async () => {
		types.list = async () => {
			throw new Error("down");
		};
		const data = await mapStartDataWithTypes(doc([]));
		expect(data.layers[0]).not.toHaveProperty("monitorTypes");
	});
});

describe("mapStartData", () => {
	it("starts at the bar's place when the bar shows", () => {
		const data = mapStartData(doc([widget("a", TULARE)], TULARE));
		expect(data).toEqual({
			place: TULARE,
			layers: [{ dataset: DEFAULT_LAYER.dataset, entryType: DEFAULT_LAYER.entryType }]
		});
	});

	it("starts as PM2.5 only, with no smoke and fire and no options", () => {
		const data = mapStartData(doc([]));
		expect(data.layers).toHaveLength(1);
		expect(data.layers[0].entryType).toBe("pm25");
		expect(data.layers.some((l) => l.dataset.startsWith("hms-"))).toBe(false);
		expect(data).not.toHaveProperty("options");
	});

	it("ignores a bar no widget shows", () => {
		const data = mapStartData(doc([widget("a", KERN)], TULARE));
		expect(data.place).toEqual(KERN);
	});

	it("falls back to the most common place, then Fresno County", () => {
		const common = mapStartData(doc([widget("a", KERN), widget("b", KERN), widget("c", TULARE)]));
		expect(common.place).toEqual(KERN);
		const empty = mapStartData(doc([]));
		expect(empty.place).toEqual(DEFAULT_PLACE);
		expect(empty.place).not.toBe(DEFAULT_PLACE);
	});
});
