import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { contributionCalendarType } from "$lib/widgets/calendars/contribution";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { currentType } from "$lib/widgets/current";
import { MAP_TYPE } from "$lib/widgets/map";
import { mapOptions } from "$lib/widgets/map/options";
import { registerWidgetType } from "$lib/widgets/registry";
import type { Draft } from "./draft.svelte";
import {
	fromMapDraft,
	hasSmokeAndFire,
	HMS_FIRE,
	HMS_SMOKE,
	isMapShaped,
	mapShowingOnly,
	MAP_POLLUTANTS_MAX,
	setMapFill,
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
/** Mid-morning, Pacific, on 2026-11-15. */
const NOW = new Date("2026-11-15T18:00:00Z");
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

	it("stops at 4 pollutants", () => {
		const d = tile("pm25");
		for (const id of IDS.slice(1)) setMapPollutant(d, CATALOG, id, true);
		expect(MAP_POLLUTANTS_MAX).toBe(4);
		expect(d.layers).toHaveLength(4);
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

describe("setMapFill", () => {
	const draft = (options?: Draft["options"]): Draft => ({
		type: MAP_TYPE,
		data: tile("pm25"),
		...(options ? { options } : {})
	});

	it("writes the fill, keeping the other options", () => {
		const d = draft({ marks: ["a"] });
		setMapFill(d, "zipcode");
		expect(d.options).toEqual({ marks: ["a"], fill: "zipcode" });
	});

	it("removes the fill, and the options when nothing else is left", () => {
		const d = draft({ fill: "zipcode", basemap: "dark" });
		setMapFill(d, undefined);
		expect(d.options).toEqual({ basemap: "dark" });
		const only = draft({ fill: "zipcode" });
		setMapFill(only, undefined);
		expect(only.options).toBeUndefined();
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

	it("converting a Map with a fill to a Chart drops the fill and day with a note; back never invents one", () => {
		const withFill = mapDraft(["pm25"], { fill: "zipcode", day: "2026-11-10" }, false);
		const c = fromMapDraft(withFill, chartType, CATALOG);
		expect(c.dropped).toEqual(["fill"]);
		expect(c.draft.options).toBeUndefined();
		const back = toMapDraft(c.draft, CATALOG, ALLOWED, NOW);
		expect(mapOptions(back.draft).fill).toBeUndefined();
		expect(back.dropped).not.toContain("fill");
		// A Map with no fill adds no note.
		expect(fromMapDraft(mapDraft(["pm25"], undefined, false), chartType, CATALOG).dropped).toEqual(
			[]
		);
	});

	it("a Map to Map conversion keeps the fill", () => {
		const c = toMapDraft(mapDraft(["pm25"], { fill: "zipcode" }, false), CATALOG, ALLOWED, NOW);
		expect(mapOptions(c.draft).fill).toBe("zipcode");
		expect(c.dropped).toEqual([]);
	});

	it("converts a Chart with PM2.5 and smoke, on the default 30 days, to a Map on Now with PM2.5 and smoke and fire", () => {
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
		// An untouched default range isn't a choice, so nothing is noted as left out.
		expect(c.dropped).toEqual([]);
	});

	it("a range the person chose is kept into the Map; a day selection is dropped with a note", () => {
		const draft = chartOf([{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]);
		draft.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
		draft.data.timeSubRange = { start: "2026-11-10", end: "2026-11-11" };
		const c = toMapDraft(draft, CATALOG, ALLOWED, NOW);
		expect(c.draft.data.dateRange).toEqual({ kind: "trailing", amount: 7, unit: "day" });
		expect(c.draft.data.timeSubRange).toBeUndefined();
		expect(c.dropped).toEqual(["selection"]);
		expect(c.selection).toEqual({ start: "2026-11-10", end: "2026-11-11" });
	});

	it("a calendar still on its own default range converts to a Map on Now", () => {
		const draft: Draft = {
			type: monthCalendarType.type,
			data: {
				dateRange: { kind: "to-date", unit: "month" },
				layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
			}
		};
		registerWidgetType(monthCalendarType);
		expect(toMapDraft(draft, CATALOG, ALLOWED, NOW).draft.data.dateRange).toBeUndefined();
	});

	it("a range over 366 days is cut to its last 366 days, with a note", () => {
		const fixed = chartOf([{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]);
		fixed.data.dateRange = { kind: "custom", start: "2025-01-01", end: "2026-02-04" };
		const c = toMapDraft(fixed, CATALOG, ALLOWED, NOW);
		expect(c.draft.data.dateRange).toEqual({
			kind: "custom",
			start: "2025-02-04",
			end: "2026-02-04"
		});
		expect(c.dropped).toEqual(["range-cut"]);
		expect(isMapShaped(fixed, NOW)).toBe(false);
		expect(isMapShaped(c.draft, NOW)).toBe(true);
		// A rolling range keeps rolling: its last 366 days, up to today.
		const rolling = chartOf([{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]);
		rolling.data.dateRange = { kind: "trailing", amount: 400, unit: "day" };
		const r = toMapDraft(rolling, CATALOG, ALLOWED, NOW);
		expect(r.draft.data.dateRange).toEqual({ kind: "trailing", amount: 366, unit: "day" });
		expect(r.dropped).toEqual(["range-cut"]);
	});

	it("a ranged Map converts to a Chart with its range; a Map on Now takes the Chart's default", () => {
		const ranged = mapDraft(["pm25"], undefined, false);
		ranged.data.dateRange = { kind: "set", unit: "month", start: "2026-09-01" };
		const c = fromMapDraft(ranged, chartType, CATALOG);
		expect(c.draft.data.dateRange).toEqual({ kind: "set", unit: "month", start: "2026-09-01" });
		expect(c.dropped).toEqual([]);
		const onNow = fromMapDraft(mapDraft(["pm25"], undefined, false), chartType, CATALOG);
		expect(onNow.draft.data.dateRange).toEqual(DEFAULT_RANGE);
		// To a now type, the range is left out with a note.
		expect(fromMapDraft(ranged, currentType, CATALOG).dropped).toContain("dates");
		// A range the target can't show (one day, for the contribution calendar's 7 at least)
		// gives way to the target's default.
		const day = mapDraft(["pm25"], undefined, false);
		day.data.dateRange = { kind: "set", unit: "day", start: "2026-11-10" };
		const calendar = fromMapDraft(day, contributionCalendarType, CATALOG, "unavailable", [], NOW);
		expect(calendar.draft.data.dateRange).toEqual(contributionCalendarType.defaultRange);
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

	it("Map → Chart → Map keeps the place on the first pollutant layer", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3" }, true);
		const there = fromMapDraft(draft, chartType, CATALOG);
		expect(there.draft.data.layers).toHaveLength(1);
		const back = toMapDraft(there.draft, CATALOG, ALLOWED);
		expect(back.draft.data.layers[0].place).toEqual(FRESNO);
	});

	it("Map → Map keeps every layer and drops nothing", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3" }, true);
		// pm25 holds the place and the rest are place-less.
		const again = toMapDraft(draft, CATALOG, ALLOWED);
		expect(again.draft.data.layers.map((l) => [l.entryType ?? l.dataset, !!l.place])).toEqual([
			["pm25", true],
			["o3", false],
			[HMS_SMOKE, false],
			[HMS_FIRE, false]
		]);
		expect(again.dropped).toEqual([]);
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

	it("converts by the pollutant the Map draws when the saved showing isn't offered", () => {
		const draft = mapDraft(["pm25", "no2"], { showing: "no2" }, false);
		const one = mapShowingOnly(draft, CATALOG, ["pm25", "o3"]);
		expect(one.draft.data.layers.map((l) => l.entryType)).toEqual(["pm25"]);
		expect(mapShowingOnly(draft, CATALOG, undefined).draft.data.layers[0].entryType).toBe("no2");
		const c = fromMapDraft(draft, chartType, CATALOG, "unavailable", ["pm25", "o3"]);
		expect(c.draft.data.layers[0].entryType).toBe("pm25");
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

	it("isMapShaped: pollutants first, then place-less smoke and fire, a range up to 366 days, no day selection", () => {
		expect(isMapShaped(mapDraft(["pm25", "o3"], undefined, true))).toBe(true);
		const ranged = mapDraft(["pm25"], undefined, true);
		ranged.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
		expect(isMapShaped(ranged, NOW)).toBe(true);
		ranged.data.timeSubRange = { start: "2026-11-10", end: "2026-11-11" };
		expect(isMapShaped(ranged, NOW)).toBe(false);
		const chart = chartOf([
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
			{ dataset: "forecasts", entryType: "burn-status" }
		]);
		expect(isMapShaped(chart)).toBe(false);
		const placed = mapDraft(["pm25"], undefined, false);
		placed.data.layers.push({ dataset: HMS_SMOKE, entryType: "smoke-density", place: FRESNO });
		expect(isMapShaped(placed)).toBe(false);
	});
});
