import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { currentType } from "$lib/widgets/current";
import { MAP_TYPE } from "$lib/widgets/map";
import { mapOptions } from "$lib/widgets/map/options";
import type { Draft } from "./draft.svelte";
import {
	fromMapDraft,
	hasSmokeAndFire,
	HMS_FIRE,
	HMS_SMOKE,
	isMapShaped,
	MAP_POLLUTANTS_MAX,
	setMapPollutant,
	setSmokeAndFire,
	toMapDraft
} from "./map";

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

describe("setSmokeAndFire with one of the pair", () => {
	it("adds whichever is missing", () => {
		const d: WidgetDataConfig = { layers: [...tile("pm25").layers, { dataset: HMS_FIRE }] };
		setSmokeAndFire(d, true);
		expect(d.layers.slice(1)).toEqual([{ dataset: HMS_FIRE }, { dataset: HMS_SMOKE }]);
		const s: WidgetDataConfig = { layers: [...tile("pm25").layers, { dataset: HMS_SMOKE }] };
		setSmokeAndFire(s, true);
		expect(s.layers.slice(1)).toEqual([{ dataset: HMS_SMOKE }, { dataset: HMS_FIRE }]);
	});
});

describe("converting to and from the Map", () => {
	const ALLOWED = ["o3", "pm25"];
	const monitors = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
	const chartOf = (layers: Layer[]): Draft => ({
		type: CHART_TYPE,
		data: { dateRange: { kind: "trailing", amount: 30, unit: "day" }, layers }
	});
	const mapDraft = (pollutants: string[], options: Draft["options"], smoke: boolean): Draft => {
		const data: WidgetDataConfig = {
			layers: [
				{ dataset: "air-quality", entryType: pollutants[0], place: FRESNO },
				...pollutants.slice(1).map((entryType) => ({ dataset: "air-quality", entryType }))
			]
		};
		if (smoke) setSmokeAndFire(data, true);
		return { type: MAP_TYPE, data, ...(options ? { options } : {}) };
	};

	it("converts a Chart with PM2.5 and smoke to a Map with PM2.5 and smoke and fire", () => {
		const c = toMapDraft(
			chartOf([
				{ dataset: "air-quality", entryType: "pm25", resolution: "day", place: FRESNO },
				{ dataset: HMS_SMOKE, entryType: "smoke-density", place: FRESNO }
			]),
			CATALOG,
			ALLOWED
		);
		expect(c.draft).toEqual({
			type: MAP_TYPE,
			data: {
				layers: [
					{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
					{ dataset: HMS_SMOKE },
					{ dataset: HMS_FIRE }
				]
			}
		});
		expect(c.dropped).toEqual(["dates"]);
	});

	it("notes other overlays a Chart had alongside its smoke", () => {
		const c = toMapDraft(
			chartOf([
				{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
				{ dataset: HMS_SMOKE, entryType: "smoke-density", place: FRESNO },
				{ dataset: "forecasts", entryType: "burn-status" }
			]),
			CATALOG,
			ALLOWED
		);
		expect(hasSmokeAndFire(c.draft.data)).toBe(true);
		expect(c.dropped).toContain("overlays");
	});

	it("keeps up to 25 places converting to a Map", () => {
		const c = toMapDraft(
			chartOf([
				{
					dataset: "air-quality",
					entryType: "pm25",
					selection: { kind: "monitors", ids: monitors(30) }
				}
			]),
			CATALOG,
			ALLOWED
		);
		expect(c.draft.data.layers).toEqual([
			{
				dataset: "air-quality",
				entryType: "pm25",
				selection: { kind: "monitors", ids: monitors(25) }
			}
		]);
		expect(c.dropped).toContain("places");
		expect(hasSmokeAndFire(c.draft.data)).toBe(false);
	});

	it("a Map over its place cap keeps its pollutants, smoke and fire, and options", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3", marks: ["a"] }, true);
		draft.data.layers[0] = {
			dataset: "air-quality",
			entryType: "pm25",
			selection: { kind: "monitors", ids: monitors(30) }
		};
		const c = toMapDraft(draft, CATALOG, ALLOWED);
		expect(c.draft.data.layers.map((l) => l.entryType ?? l.dataset)).toEqual([
			"pm25",
			"o3",
			HMS_SMOKE,
			HMS_FIRE
		]);
		expect(c.draft.data.layers[0].selection).toEqual({ kind: "monitors", ids: monitors(25) });
		expect(c.draft.options).toEqual({ showing: "o3", marks: ["a"] });
		expect(c.dropped).toEqual(["places"]);
		expect(isMapShaped(c.draft)).toBe(true);
		expect(isMapShaped(draft)).toBe(false);
	});

	it("converts a Map with PM2.5, ozone (showing) and smoke and fire to a Chart with ozone only, noting what's left out", () => {
		const c = fromMapDraft(
			mapDraft(["pm25", "o3"], { showing: "o3", marks: ["a"] }, true),
			chartType,
			CATALOG
		);
		expect(c.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", place: FRESNO }
		]);
		expect(c.dropped).toEqual(expect.arrayContaining(["overlays", "marks"]));
		expect(mapOptions(c.draft).marks).toBeUndefined();
		expect(c.draft.options).toBeUndefined();
	});

	it("says nothing was left out from a Map of one pollutant with no marks", () => {
		const c = fromMapDraft(mapDraft(["pm25"], { marks: [] }, false), chartType, CATALOG);
		expect(c.dropped).toEqual([]);
	});

	it("converts a Map to Current conditions with the pollutant showing and the first place", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3" }, false);
		draft.data.layers[0] = {
			dataset: "air-quality",
			entryType: "pm25",
			selection: { kind: "monitors", ids: ["m1", "m2"] }
		};
		const c = fromMapDraft(draft, currentType, CATALOG);
		expect(c.draft.type).toBe("current-conditions");
		expect(c.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", place: { kind: "monitor", id: "m1" } }
		]);
		expect(c.dropped).toEqual(expect.arrayContaining(["overlays", "places"]));
		expect(c.dropped).not.toContain("marks");
		// The scale wasn't given, so the default alert level is still owed.
		expect(c.defaultOwed).toBe(true);
	});

	it("isMapShaped: pollutants first, then place-less smoke and fire, no dates", () => {
		expect(isMapShaped(mapDraft(["pm25", "o3"], undefined, true))).toBe(true);
		expect(
			isMapShaped(chartOf([{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]))
		).toBe(false);
		const placed = mapDraft(["pm25"], undefined, false);
		placed.data.layers.push({ dataset: HMS_SMOKE, entryType: "smoke-density", place: FRESNO });
		expect(isMapShaped(placed)).toBe(false);
	});
});
