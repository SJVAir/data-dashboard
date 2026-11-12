import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import { HMS_FIRE, HMS_SMOKE, MAP_POLLUTANTS_MAX, setMapPollutant, setSmokeAndFire } from "./map";

const FRESNO = { kind: "region", type: "city", code: "fresno" } as never;
const IDS = ["pm25", "pm10", "o3", "no2", "so2", "co", "x1"];
const CATALOG = [
	{ id: "air-quality", entryTypes: IDS.map((id) => ({ id, kind: "pollutant", resolutions: [] })) }
] as unknown as CatalogEntry[];
const tile = (entryType: string): WidgetDataConfig => ({
	layers: [{ dataset: "air-quality", entryType, place: FRESNO }]
});
const shape = (d: WidgetDataConfig) => d.layers.map((l) => [l.entryType, !!l.place]);

describe("setMapPollutant", () => {
	it("adds ozone after PM2.5 without moving the places", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "o3", true);
		expect(shape(d)).toEqual([
			["pm25", true],
			["o3", false]
		]);
	});

	it("moves the places to the next pollutant when the first is removed", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "o3", true);
		setMapPollutant(d, CATALOG, "pm25", false);
		expect(shape(d)).toEqual([["o3", true]]);
	});

	it("never removes the last pollutant", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "pm25", false);
		expect(shape(d)).toEqual([["pm25", true]]);
	});

	it("stops at 6 pollutants", () => {
		const d = tile("pm25");
		for (const id of IDS.slice(1)) setMapPollutant(d, CATALOG, id, true);
		expect(MAP_POLLUTANTS_MAX).toBe(6);
		expect(d.layers).toHaveLength(6);
		expect(d.layers.some((l) => l.entryType === "x1")).toBe(false);
	});

	it("adds a pollutant ahead of smoke and fire, and ignores a repeat", () => {
		const d = tile("pm25");
		setSmokeAndFire(d, true);
		setMapPollutant(d, CATALOG, "o3", true);
		setMapPollutant(d, CATALOG, "o3", true);
		expect(d.layers.map((l) => l.entryType ?? l.dataset)).toEqual([
			"pm25",
			"o3",
			HMS_SMOKE,
			HMS_FIRE
		]);
	});
});

describe("setSmokeAndFire", () => {
	it("adds and removes smoke and fire together, with no place", () => {
		const d = tile("pm25");
		setSmokeAndFire(d, true);
		expect(d.layers.slice(1)).toEqual([{ dataset: HMS_SMOKE }, { dataset: HMS_FIRE }]);
		setSmokeAndFire(d, true);
		expect(d.layers).toHaveLength(3);
		setSmokeAndFire(d, false);
		expect(d.layers).toHaveLength(1);
	});
});
