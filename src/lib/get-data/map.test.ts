import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { Layer, WidgetDataConfig } from "$lib/data/schema";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { contributionCalendarType } from "$lib/widgets/calendars/contribution";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { currentType } from "$lib/widgets/current";
import { MAP_TYPE } from "$lib/widgets/map";
import { mapOptions, PESTICIDE_NOTICES, PESTICIDE_USE } from "$lib/widgets/map/options";
import { registerWidgetType } from "$lib/widgets/registry";
import type { Draft } from "./draft.svelte";
import {
	fromMapDraft,
	hasSmokeAndFire,
	HMS_FIRE,
	HMS_SMOKE,
	isMapShaped,
	hasNotices,
	hasUse,
	mapLevelOf,
	mapPesticideFilters,
	mapShowingOnly,
	MAP_POLLUTANTS_MAX,
	setMapFill,
	setMapPesticideFilters,
	setMapPollutant,
	setNotices,
	setSmokeAndFire,
	setUse,
	toMapDraft
} from "./map";

const FRESNO = { kind: "region", type: "city", code: "fresno" } as never;
const IDS = ["pm25", "pm10", "o3", "no2", "so2", "co", "x1"];
const CATALOG = [
	{ id: "air-quality", entryTypes: IDS.map((id) => ({ id, kind: "pollutant", resolutions: [] })) }
] as unknown as CatalogEntry[];
const tile = (entryType: string): WidgetDataConfig => ({
	place: FRESNO,
	layers: [{ dataset: "air-quality", entryType }]
});
/** Mid-morning, Pacific, on 2026-11-15. */
const NOW = new Date("2026-11-15T18:00:00Z");
/** The pollutants, in order, and the Where (which no layer edit moves). */
const shape = (d: WidgetDataConfig) => [d.layers.map((l) => l.entryType), d.place];

describe("setMapPollutant", () => {
	it("adds ozone after PM2.5; Where stays", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "o3", true);
		expect(shape(d)).toEqual([["pm25", "o3"], FRESNO]);
	});

	it("removing the first pollutant keeps Where", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "o3", true);
		setMapPollutant(d, CATALOG, "pm25", false);
		expect(shape(d)).toEqual([["o3"], FRESNO]);
	});

	it("never removes the last pollutant", () => {
		const d = tile("pm25");
		setMapPollutant(d, CATALOG, "pm25", false);
		expect(shape(d)).toEqual([["pm25"], FRESNO]);
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

describe("setNotices", () => {
	it("adds one place-less notices layer after smoke and fire, and removes it", () => {
		const d = tile("pm25");
		setSmokeAndFire(d, true);
		expect(hasNotices(d)).toBe(false);
		setNotices(d, true);
		setNotices(d, true);
		expect(d.layers.slice(1)).toEqual([
			{ dataset: HMS_SMOKE },
			{ dataset: HMS_FIRE },
			{ dataset: PESTICIDE_NOTICES }
		]);
		expect(hasNotices(d)).toBe(true);
		setNotices(d, false);
		expect(d.layers.map((l) => l.dataset)).toEqual(["air-quality", HMS_SMOKE, HMS_FIRE]);
	});
});

describe("setMapPesticideFilters", () => {
	it("keeps every pesticide layer in step", () => {
		const d = tile("pm25");
		setNotices(d, true);
		d.layers.push({ dataset: "pesticide-use" });
		expect(mapPesticideFilters(d)).toBeUndefined();
		setMapPesticideFilters(d, { chemical: "c1" });
		expect(d.layers.slice(1).map((l) => l.filters)).toEqual([
			{ chemical: "c1" },
			{ chemical: "c1" }
		]);
		expect(mapPesticideFilters(d)).toEqual({ chemical: "c1" });
		d.layers[1].filters = { chemical: "c1" };
		setMapPesticideFilters(d, {});
		expect(d.layers.some((l) => "filters" in l)).toBe(false);
		expect(mapPesticideFilters(d)).toBeUndefined();
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

describe("a Map with notices", () => {
	const noticesDraft = (): Draft => {
		const data = tile("pm25");
		setSmokeAndFire(data, true);
		setNotices(data, true);
		setMapPesticideFilters(data, { chemical: "c1" });
		return { type: MAP_TYPE, data };
	};

	it("isMapShaped accepts a notices layer", () => {
		expect(isMapShaped(noticesDraft(), NOW)).toBe(true);
		const alone = noticesDraft();
		alone.data.layers = alone.data.layers.filter((l) => l.dataset !== HMS_SMOKE);
		expect(isMapShaped(alone, NOW)).toBe(true);
		const typed = noticesDraft();
		typed.data.layers[3].entryType = "spray-notice";
		expect(isMapShaped(typed, NOW)).toBe(false);
		const twice = noticesDraft();
		twice.data.layers.push({ dataset: PESTICIDE_NOTICES });
		expect(isMapShaped(twice, NOW)).toBe(false);
	});

	it("toMapDraft keeps a Map's notices and filters", () => {
		const c = toMapDraft(noticesDraft(), CATALOG, ["o3", "pm25"], NOW);
		expect(c.draft.data.layers.slice(1)).toEqual([
			{ dataset: HMS_SMOKE },
			{ dataset: HMS_FIRE },
			{ dataset: PESTICIDE_NOTICES, filters: { chemical: "c1" } }
		]);
		expect(c.dropped).toEqual([]);
	});

	it("a Map with notices shown as a chart drops them with the overlays note", () => {
		const c = fromMapDraft(noticesDraft(), chartType, CATALOG);
		expect(c.dropped).toContain("overlays");
		expect(c.draft.data.layers.some((l) => l.dataset === PESTICIDE_NOTICES)).toBe(false);
	});
});

describe("converting to and from the Map", () => {
	const ALLOWED = ["o3", "pm25"];
	const monitors = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
	/** A Chart of `layers` in Fresno (or at `where`) over the default 30 days. */
	const chartOf = (
		layers: Layer[],
		where: Pick<WidgetDataConfig, "place" | "selection"> = { place: FRESNO }
	): Draft => ({
		type: CHART_TYPE,
		data: { dateRange: { kind: "trailing", amount: 30, unit: "day" }, ...where, layers }
	});
	const mapDraft = (pollutants: string[], options: Draft["options"], smoke: boolean): Draft => {
		const data: WidgetDataConfig = {
			place: FRESNO,
			layers: [
				{ dataset: "air-quality", entryType: pollutants[0] },
				...pollutants.slice(1).map((entryType) => ({ dataset: "air-quality", entryType }))
			]
		};
		if (smoke) setSmokeAndFire(data, true);
		return { type: MAP_TYPE, data, ...(options ? { options } : {}) };
	};

	it("converting a Map with a fill to a Chart drops the fill and day with a note; back never invents one", () => {
		const withFill = mapDraft(["pm25"], { fill: "zipcode", at: "2026-11-10" }, false);
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
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: HMS_SMOKE, entryType: "smoke-density" }
			]),
			CATALOG,
			ALLOWED
		);
		expect(c.draft).toEqual({
			type: MAP_TYPE,
			data: {
				place: FRESNO,
				layers: [
					{ dataset: "air-quality", entryType: "pm25" },
					{ dataset: HMS_SMOKE },
					{ dataset: HMS_FIRE }
				]
			}
		});
		// An untouched default range isn't a choice, so nothing is noted as left out.
		expect(c.dropped).toEqual([]);
	});

	it("a range the person chose is kept into the Map; a day selection is dropped with a note", () => {
		const draft = chartOf([{ dataset: "air-quality", entryType: "pm25" }]);
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
				place: FRESNO,
				layers: [{ dataset: "air-quality", entryType: "pm25" }]
			}
		};
		registerWidgetType(monthCalendarType);
		expect(toMapDraft(draft, CATALOG, ALLOWED, NOW).draft.data.dateRange).toBeUndefined();
	});

	/** The catalog with every pollutant offering `levels` only. */
	const offering = (levels: string[]) =>
		[
			{
				id: "air-quality",
				entryTypes: IDS.map((id) => ({ id, kind: "pollutant", resolutions: levels }))
			}
		] as unknown as typeof CATALOG;

	it("a range over 366 days is cut to its last 366 days at Daily, with a note", () => {
		const DAILY = offering(["day"]);
		const fixed = chartOf([{ dataset: "air-quality", entryType: "pm25" }]);
		fixed.data.dateRange = { kind: "custom", start: "2025-01-01", end: "2026-02-04" };
		const c = toMapDraft(fixed, DAILY, ALLOWED, NOW);
		expect(c.draft.data.dateRange).toEqual({
			kind: "custom",
			start: "2025-02-04",
			end: "2026-02-04"
		});
		expect(c.dropped).toEqual(["range-cut"]);
		expect(c.cutAt).toBe("day");
		expect(isMapShaped(fixed, NOW, DAILY)).toBe(false);
		expect(isMapShaped(c.draft, NOW, DAILY)).toBe(true);
		// A rolling range keeps rolling: its last 366 days, up to today.
		const rolling = chartOf([{ dataset: "air-quality", entryType: "pm25" }]);
		rolling.data.dateRange = { kind: "trailing", amount: 400, unit: "day" };
		const r = toMapDraft(rolling, DAILY, ALLOWED, NOW);
		expect(r.draft.data.dateRange).toEqual({ kind: "trailing", amount: 366, unit: "day" });
		expect(r.dropped).toEqual(["range-cut"]);
	});

	it("counts stops, not days: a 30-month range at Monthly is kept whole", () => {
		const MONTHLY = offering(["day", "month", "year"]);
		const chart = chartOf([{ dataset: "air-quality", entryType: "pm25" }]);
		chart.data.dateRange = { kind: "custom", start: "2024-01-01", end: "2026-06-30" };
		const c = toMapDraft(chart, MONTHLY, ALLOWED, NOW);
		expect(c.draft.data.dateRange).toEqual(chart.data.dateRange);
		expect(c.dropped).not.toContain("range-cut");
		expect(isMapShaped(c.draft, NOW, MONTHLY)).toBe(true);
	});

	it("cuts a range over 366 months to its last 366 months at Monthly", () => {
		const MONTHLY = offering(["month"]);
		const chart = chartOf([{ dataset: "air-quality", entryType: "pm25" }]);
		chart.data.dateRange = { kind: "custom", start: "1990-01-01", end: "2026-06-30" };
		const c = toMapDraft(chart, MONTHLY, ALLOWED, NOW);
		expect(c.draft.data.dateRange).toEqual({
			kind: "custom",
			start: "1996-01-01",
			end: "2026-06-30"
		});
		expect(c.dropped).toEqual(["range-cut"]);
		expect(c.cutAt).toBe("month");
	});

	it("keeps a Map's saved resolution for a range type that doesn't pin one; Automatic stays absent", () => {
		const monthly = mapDraft(["pm25"], undefined, false);
		monthly.data.dateRange = { kind: "set", unit: "year", start: "2025-01-01" };
		monthly.data.resolution = "month";
		expect(fromMapDraft(monthly, chartType, CATALOG).draft.data.resolution).toBe("month");
		const auto = mapDraft(["pm25"], undefined, false);
		auto.data.dateRange = { kind: "set", unit: "year", start: "2025-01-01" };
		expect(fromMapDraft(auto, chartType, CATALOG).draft.data).not.toHaveProperty("resolution");
		// A calendar pins Daily, and a now type has no resolution.
		const calendar = fromMapDraft(monthly, monthCalendarType, CATALOG, "unavailable", [], NOW);
		expect(calendar.draft.data).not.toHaveProperty("resolution");
		expect(fromMapDraft(monthly, currentType, CATALOG).draft.data).not.toHaveProperty("resolution");
		// A Map on Now has no resolution: a stale one gives the Chart none.
		const onNow = mapDraft(["pm25"], undefined, false);
		onNow.data.resolution = "year";
		expect(fromMapDraft(onNow, chartType, CATALOG).draft.data).not.toHaveProperty("resolution");
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
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: HMS_SMOKE, entryType: "smoke-density" },
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
			chartOf([{ dataset: "air-quality", entryType: "pm25" }], {
				selection: { kind: "monitors", ids: monitors(30) }
			}),
			CATALOG,
			ALLOWED
		);
		expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "pm25" }]);
		expect(c.draft.data.selection).toEqual({ kind: "monitors", ids: monitors(25) });
		expect(c.dropped).toContain("places");
		expect(hasSmokeAndFire(c.draft.data)).toBe(false);
	});

	it("a Map over its place cap keeps its pollutants, smoke and fire, and options", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3", marks: ["a"] }, true);
		delete draft.data.place;
		draft.data.selection = { kind: "monitors", ids: monitors(30) };
		const c = toMapDraft(draft, CATALOG, ALLOWED);
		expect(c.draft.data.layers.map((l) => l.entryType ?? l.dataset)).toEqual([
			"pm25",
			"o3",
			HMS_SMOKE,
			HMS_FIRE
		]);
		expect(c.draft.data.selection).toEqual({ kind: "monitors", ids: monitors(25) });
		expect(c.draft.options).toEqual({ showing: "o3", marks: ["a"] });
		expect(c.dropped).toEqual(["places"]);
		expect(isMapShaped(c.draft)).toBe(true);
		expect(isMapShaped(draft)).toBe(false);
	});

	it("Map → Chart → Map keeps the place", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3" }, true);
		const there = fromMapDraft(draft, chartType, CATALOG);
		expect(there.draft.data.layers).toHaveLength(1);
		const back = toMapDraft(there.draft, CATALOG, ALLOWED);
		expect(back.draft.data.place).toEqual(FRESNO);
	});

	it("Map → Map keeps every layer and drops nothing", () => {
		const draft = mapDraft(["pm25", "o3"], { showing: "o3" }, true);
		const again = toMapDraft(draft, CATALOG, ALLOWED);
		expect(again.draft.data.layers.map((l) => l.entryType ?? l.dataset)).toEqual([
			"pm25",
			"o3",
			HMS_SMOKE,
			HMS_FIRE
		]);
		expect(again.draft.data.place).toEqual(FRESNO);
		expect(again.dropped).toEqual([]);
	});

	it("converts a Map with PM2.5, ozone (showing) and smoke and fire to a Chart with ozone only, noting what's left out", () => {
		const c = fromMapDraft(
			mapDraft(["pm25", "o3"], { showing: "o3", marks: ["a"] }, true),
			chartType,
			CATALOG
		);
		expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "o3" }]);
		expect(c.draft.data.place).toEqual(FRESNO);
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
		delete draft.data.place;
		draft.data.selection = { kind: "monitors", ids: ["m1", "m2"] };
		const c = fromMapDraft(draft, currentType, CATALOG);
		expect(c.draft.type).toBe("current-conditions");
		expect(c.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "o3" }]);
		expect(c.draft.data.place).toEqual({ kind: "monitor", id: "m1" });
		expect(c.dropped).toEqual(expect.arrayContaining(["overlays", "places"]));
		expect(c.dropped).not.toContain("marks");
		// The scale wasn't given, so the default alert level is still owed.
		expect(c.defaultOwed).toBe(true);
	});

	it("isMapShaped: pollutants first, then smoke and fire, a range up to 366 days, no day selection", () => {
		expect(isMapShaped(mapDraft(["pm25", "o3"], undefined, true))).toBe(true);
		const ranged = mapDraft(["pm25"], undefined, true);
		ranged.data.dateRange = { kind: "trailing", amount: 7, unit: "day" };
		expect(isMapShaped(ranged, NOW)).toBe(true);
		ranged.data.timeSubRange = { start: "2026-11-10", end: "2026-11-11" };
		expect(isMapShaped(ranged, NOW)).toBe(false);
		const chart = chartOf([
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: "forecasts", entryType: "burn-status" }
		]);
		expect(isMapShaped(chart)).toBe(false);
		// A Chart's smoke overlay (with an entry type) isn't the Map's smoke layer.
		const typed = mapDraft(["pm25"], undefined, false);
		typed.data.layers.push({ dataset: HMS_SMOKE, entryType: "smoke-density" });
		expect(isMapShaped(typed)).toBe(false);
	});
});

describe("pesticide use on a Map", () => {
	const ALLOWED = ["o3", "pm25"];
	const USE_CATALOG = [
		{
			id: "air-quality",
			entryTypes: IDS.map((id) => ({
				id,
				kind: "pollutant",
				resolutions: ["raw", "hour", "day", "month", "year"]
			}))
		},
		{
			id: "pesticide-use",
			entryTypes: ["pounds-applied", "acres-treated", "applications"].map((id) => ({
				id,
				kind: "number",
				resolutions: ["month", "year"]
			}))
		}
	] as unknown as CatalogEntry[];
	const mapOf = (options?: Draft["options"]): Draft => ({
		type: MAP_TYPE,
		data: tile("pm25"),
		...(options ? { options } : {})
	});
	const chartOver =
		(dateRange: Draft["data"]["dateRange"]) =>
		(layers: Layer[]): Draft => ({
			type: CHART_TYPE,
			data: { dateRange, place: FRESNO, layers }
		});

	it("setUse adds one place-less use layer with the Map's filters, and removes it with its options", () => {
		const d = mapOf({ basemap: "dark" });
		setNotices(d.data, true);
		setMapPesticideFilters(d.data, { chemical: "c1" });
		expect(hasUse(d.data)).toBe(false);
		setUse(d, true);
		setUse(d, true);
		expect(d.data.layers.slice(1)).toEqual([
			{ dataset: PESTICIDE_NOTICES, filters: { chemical: "c1" } },
			{ dataset: PESTICIDE_USE, filters: { chemical: "c1" } }
		]);
		expect(hasUse(d.data)).toBe(true);
		// The use reads its period from the Map's stops: switching it on writes no option.
		expect(d.options).toEqual({ basemap: "dark" });
		d.options = { ...mapOptions(d), useFigure: "acres-treated", useShown: false };
		// Smoke and fire go ahead of the notices and use.
		setSmokeAndFire(d.data, true);
		expect(d.data.layers.map((l) => l.dataset).slice(1)).toEqual([
			HMS_SMOKE,
			HMS_FIRE,
			PESTICIDE_NOTICES,
			PESTICIDE_USE
		]);
		setUse(d, false);
		expect(hasUse(d.data)).toBe(false);
		expect(d.options).toEqual({ basemap: "dark" });
	});

	it("filters survive turning notices off and on while use is on", () => {
		const d = mapOf();
		setUse(d, true);
		setNotices(d.data, true);
		setMapPesticideFilters(d.data, { chemical: "c1", category: ["insecticide"] });
		setNotices(d.data, false);
		expect(mapPesticideFilters(d.data)).toEqual({ chemical: "c1", category: ["insecticide"] });
		setNotices(d.data, true);
		// The notices go back ahead of the use, with the kept filters.
		expect(d.data.layers.slice(1)).toEqual([
			{ dataset: PESTICIDE_NOTICES, filters: { chemical: "c1", category: ["insecticide"] } },
			{ dataset: PESTICIDE_USE, filters: { chemical: "c1", category: ["insecticide"] } }
		]);
		// A chart's use layer (with an entry type) isn't the Map's.
		const placed: WidgetDataConfig = {
			place: FRESNO,
			layers: [
				{
					dataset: "pesticide-use",
					entryType: "pounds-applied",
					filters: { chemical: "c9" }
				}
			]
		};
		expect(mapPesticideFilters(placed)).toBeUndefined();
	});

	it("isMapShaped accepts notices then use, and refuses a chart's use layer (with an entry type)", () => {
		const d = mapOf();
		setSmokeAndFire(d.data, true);
		setNotices(d.data, true);
		setUse(d, true);
		setMapPesticideFilters(d.data, { chemical: "c1" });
		expect(isMapShaped(d, NOW)).toBe(true);
		const useOnly = mapOf();
		setUse(useOnly, true);
		expect(isMapShaped(useOnly, NOW)).toBe(true);
		const swapped = structuredClone(d);
		swapped.data.layers.splice(3, 2, swapped.data.layers[4], swapped.data.layers[3]);
		expect(isMapShaped(swapped, NOW)).toBe(false);
		const typed = structuredClone(d);
		typed.data.layers[4].entryType = "pounds-applied";
		expect(isMapShaped(typed, NOW)).toBe(false);
		const twice = structuredClone(d);
		twice.data.layers.push({ dataset: PESTICIDE_USE });
		expect(isMapShaped(twice, NOW)).toBe(false);
	});

	it("a chart's first pesticide layer becomes the Map's use, the others dropped with a note", () => {
		const chart = chartOver({ kind: "custom", start: "2022-01-01", end: "2022-12-31" })([
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: "pesticide-use", entryType: "acres-treated", filters: { chemical: "c1" } },
			{ dataset: "pesticide-use", entryType: "pounds-applied", filters: { chemical: "c2" } }
		]);
		const c = toMapDraft(chart, USE_CATALOG, ALLOWED, NOW);
		expect(c.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: PESTICIDE_USE, filters: { chemical: "c1" } }
		]);
		expect(c.draft.data.place).toEqual(FRESNO);
		expect(c.draft.options).toEqual({ useFigure: "acres-treated" });
		expect(c.dropped).toContain("overlays");
		expect(isMapShaped(c.draft, NOW, USE_CATALOG)).toBe(true);
		// The catalog's first figure is the default, so it isn't written; one use layer drops nothing.
		const one = toMapDraft(
			chartOver({ kind: "custom", start: "2022-01-01", end: "2022-12-31" })([
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "pesticide-use", entryType: "pounds-applied" }
			]),
			USE_CATALOG,
			ALLOWED,
			NOW
		);
		expect(one.draft.options).toBeUndefined();
		expect(one.dropped).toEqual([]);
		// A pesticides-only chart gets the first offered pollutant, at its Where.
		const only = toMapDraft(
			chartOver({ kind: "custom", start: "2022-01-01", end: "2022-12-31" })([
				{ dataset: "pesticide-use", entryType: "pounds-applied" }
			]),
			USE_CATALOG,
			ALLOWED,
			NOW
		);
		expect(only.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3" },
			{ dataset: PESTICIDE_USE }
		]);
		expect(only.draft.data.place).toEqual(FRESNO);
		expect(only.dropped).not.toContain("pollutant");
		expect(only.pollutant).toBeUndefined();
		// A Map keeps its use, its filters and its options.
		const map = mapOf({ useFigure: "applications", useShown: false });
		setNotices(map.data, true);
		setUse(map, true);
		setMapPesticideFilters(map.data, { chemical: "c1" });
		const again = toMapDraft(map, USE_CATALOG, ALLOWED, NOW);
		expect(again.draft.data.layers).toEqual(map.data.layers);
		expect(again.draft.options).toEqual(map.options);
		expect(again.dropped).toEqual([]);
	});

	it("a chart with pesticide use keeps its range as a Map, even its untouched default, so use shows", () => {
		const layers: Layer[] = [
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: "pesticide-use", entryType: "pounds-applied" }
		];
		const fixed = { kind: "custom", start: "2021-01-01", end: "2022-12-31" } as const;
		expect(
			toMapDraft(chartOver(fixed)(layers), USE_CATALOG, ALLOWED, NOW).draft.data.dateRange
		).toEqual(fixed);
		// The Chart's default isn't a choice, but Now would leave the use undrawn: it's kept.
		const untouched = toMapDraft(
			chartOver(structuredClone(DEFAULT_RANGE))(layers),
			USE_CATALOG,
			ALLOWED,
			NOW
		);
		expect(untouched.draft.data.dateRange).toEqual(DEFAULT_RANGE);
		expect(untouched.dropped).not.toContain("dates");
		// The use moves the Map's Automatic to Monthly, so the kept range steps by month.
		expect(mapLevelOf(untouched.draft.data, USE_CATALOG, DEFAULT_RANGE, NOW)).toBe("month");
		// Without use, the untouched default still makes a Map on Now.
		const plain = toMapDraft(
			chartOver(structuredClone(DEFAULT_RANGE))([layers[0]]),
			USE_CATALOG,
			ALLOWED,
			NOW
		);
		expect(plain.draft.data.dateRange).toBeUndefined();
	});

	it("a Map's use shown as a chart becomes a pesticide layer of the figure drawn, with the Map's filters", () => {
		const map = (dateRange?: Draft["data"]["dateRange"]): Draft => {
			const d = mapOf({ useFigure: "acres-treated" });
			if (dateRange) d.data.dateRange = dateRange;
			setUse(d, true);
			setMapPesticideFilters(d.data, { chemical: "c1" });
			return d;
		};
		const in2023 = map({ kind: "custom", start: "2023-01-01", end: "2023-12-31" });
		const c = fromMapDraft(in2023, chartType, USE_CATALOG, "unavailable", undefined, NOW);
		expect(c.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: "pesticide-use", entryType: "acres-treated", filters: { chemical: "c1" } }
		]);
		expect(c.dropped).toEqual([]);
		expect(c.draft.options).toBeUndefined();
		// A Map on Now (the use isn't drawn there) still hands its use to the chart.
		const onNow = fromMapDraft(map(), chartType, USE_CATALOG, "unavailable", undefined, NOW);
		expect(onNow.draft.data.layers.map((l) => l.dataset)).toEqual(["air-quality", "pesticide-use"]);
		expect(onNow.dropped).toEqual([]);
		// Any other type drops it with the overlays note.
		const calendar = fromMapDraft(
			in2023,
			monthCalendarType,
			USE_CATALOG,
			"unavailable",
			undefined,
			NOW
		);
		expect(calendar.dropped).toContain("overlays");
		expect(calendar.draft.data.layers.some((l) => l.dataset === "pesticide-use")).toBe(false);
	});
});
