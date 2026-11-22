import { expect, test } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { PlaceInfo, QueryInput, Series, SeriesPoint } from "$lib/data/types";
import type { Picks } from "$lib/places/selection";
import {
	ChartOptionsSchema,
	MAX_OVERLAYS,
	overlayInput,
	overlayInputsFor,
	overlayLayers,
	overlayMonitor,
	overlayPlaceFor,
	overlayRefOf,
	pairsByKey,
	sharedSource
} from "./overlays";

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
	{
		id: "air-quality",
		label: "Air quality",
		entryTypes: [entry("pm25", "pollutant")],
		geographies: []
	},
	{
		id: "weather",
		label: "Weather",
		entryTypes: [entry("temperature", "other")],
		geographies: []
	},
	{
		id: "pesticide-use",
		label: "Pesticide use",
		entryTypes: [entry("pounds-applied", "other")],
		geographies: []
	},
	{
		id: "forecasts",
		label: "Forecasts",
		entryTypes: [entry("burn-status", "other"), entry("aqi-forecast", "other")],
		geographies: []
	}
];

const FRESNO = { kind: "region" as const, type: "county", code: "06019" };
const KERN = { kind: "region" as const, type: "county", code: "06029" };

test("overlay borrows the main layer's selection", () => {
	const main: QueryInput = {
		layer: {
			dataset: "air-quality",
			entryType: "pm25",
			selection: { kind: "regions", ids: ["county:06019", "county:06029"] }
		},
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		timeSubRange: { start: "2026-10-01", end: "2026-10-10" },
		resolution: "day",
		worstHour: true
	};
	const input = overlayInput(main, { dataset: "forecasts", entryType: "burn-status" });
	expect(input).toEqual({
		layer: {
			dataset: "forecasts",
			entryType: "burn-status",
			selection: { kind: "regions", ids: ["county:06019", "county:06029"] }
		},
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		timeSubRange: { start: "2026-10-01", end: "2026-10-10" },
		resolution: "day"
	});
	// A single place travels too.
	const one = overlayInput(
		{ ...main, layer: { dataset: "air-quality", entryType: "pm25", place: FRESNO } },
		{ dataset: "forecasts", entryType: "aqi-forecast" }
	);
	expect(one.layer).toEqual({ dataset: "forecasts", entryType: "aqi-forecast", place: FRESNO });
});

const MAIN: QueryInput = {
	layer: { dataset: "air-quality", entryType: "pm25", place: FRESNO },
	dateRange: { kind: "trailing", amount: 30, unit: "day" },
	resolution: "day"
};

test("every overlay, number or level, is fetched at the main's (the dataset's) resolution", () => {
	expect(overlayInput(MAIN, { dataset: "weather", entryType: "temperature" }).resolution).toBe(
		"day"
	);
	expect(overlayInput(MAIN, { dataset: "forecasts", entryType: "burn-status" }).resolution).toBe(
		"day"
	);
	const monthly = overlayInput(
		{ ...MAIN, resolution: "month" },
		{
			dataset: "pesticide-use",
			entryType: "pounds-applied"
		}
	);
	expect(monthly.resolution).toBe("month");
});

test("an overlay carries its station and filters, never places of its own", () => {
	const input = overlayInput(MAIN, {
		dataset: "pesticide-use",
		entryType: "pounds-applied",
		place: KERN,
		station: "80",
		filters: { chemical: "7" }
	});
	expect(input.layer).toEqual({
		dataset: "pesticide-use",
		entryType: "pounds-applied",
		place: FRESNO,
		station: "80",
		filters: { chemical: "7" }
	});
});

test("a third overlay is ignored", () => {
	const data: WidgetDataConfig = {
		place: FRESNO,
		layers: [
			{ dataset: "air-quality", entryType: "pm25" },
			{ dataset: "forecasts", entryType: "burn-status" },
			{ dataset: "forecasts", entryType: "aqi-forecast" },
			{ dataset: "forecasts", entryType: "burn-status" }
		]
	};
	const overlays = overlayLayers(data, CATALOG);
	expect(MAX_OVERLAYS).toBe(2);
	expect(overlays).toEqual([data.layers[1], data.layers[2]]);
	// The main layer is never its own overlay, and a layer with no entry type isn't one.
	expect(overlayLayers({ layers: [data.layers[0], { dataset: "forecasts" }] }, CATALOG)).toEqual(
		[]
	);
});

const places: PlaceInfo[] = [
	{ place: "region:county:06019", name: "Fresno County" },
	{ place: "region:county:06029", name: "Kern County" }
];
const picks: Picks = [FRESNO, KERN];

test("overlayFor not among places falls back to the first", () => {
	expect(overlayPlaceFor({ overlayFor: KERN }, places, picks)).toBe("region:county:06029");
	const tulare = { kind: "region", type: "county", code: "06107" };
	expect(overlayPlaceFor({ overlayFor: tulare }, places, picks)).toBe("region:county:06019");
	expect(overlayPlaceFor(undefined, places, picks)).toBe("region:county:06019");
});

test("invalid options are ignored", () => {
	expect(overlayPlaceFor({ overlayFor: { kind: "region", type: "BAD TYPE" } }, places, picks)).toBe(
		"region:county:06019"
	);
	expect(overlayPlaceFor("nonsense", places, picks)).toBe("region:county:06019");
	expect(overlayPlaceFor({ overlayFor: KERN, extra: 1 }, places, picks)).toBe(
		"region:county:06029"
	);
});

const day = (t: number, level: string): SeriesPoint => ({
	t,
	mean: NaN,
	min: NaN,
	max: NaN,
	count: 1,
	partial: false,
	level
});

test("sharedSource true for identical zone series", () => {
	const a: Series = { place: "region:county:06019", points: [day(1, "a"), day(2, "b")] };
	const b: Series = { place: "region:city:clovis", points: [day(1, "a"), day(2, "b")] };
	expect(sharedSource([a, b])).toBe(true);
	expect(sharedSource([a])).toBe(true);
	expect(sharedSource([a, { ...b, points: [day(1, "a"), day(2, "a")] }])).toBe(false);
	expect(sharedSource([a, { ...b, points: [day(1, "a")] }])).toBe(false);
	expect(sharedSource([a, { ...b, points: [] }])).toBe(false);
});

const MONITORS: PlaceInfo[] = [
	{ place: "monitor:p1", name: "P1" },
	{ place: "monitor:p2", name: "P2" },
	{ place: "monitor:p3", name: "P3" }
];
const SET: QueryInput = {
	layer: { dataset: "air-quality", entryType: "pm25", place: FRESNO, monitorTypes: ["purpleair"] },
	dateRange: { kind: "trailing", amount: 30, unit: "day" },
	resolution: "day"
};

test("overlayFor names a monitor (decision 37): a monitor-only shape", () => {
	expect(ChartOptionsSchema.parse({ overlayFor: { kind: "monitor", id: "p2" } })).toEqual({
		overlayFor: { kind: "monitor", id: "p2" }
	});
	expect(ChartOptionsSchema.safeParse({ overlayFor: { kind: "monitor" } }).success).toBe(false);
});

test("a monitor set's overlay monitor is Overlay for's once loaded, else the first", () => {
	const p2 = { overlayFor: { kind: "monitor", id: "p2" } };
	// The set's monitors aren't known before it loads.
	expect(overlayMonitor(p2)).toBeNull();
	expect(overlayMonitor(p2, MONITORS)).toBe("p2");
	expect(overlayMonitor({ overlayFor: { kind: "monitor", id: "gone" } }, MONITORS)).toBe("p1");
	expect(overlayMonitor({ overlayFor: FRESNO }, MONITORS)).toBe("p1");
	expect(overlayMonitor(undefined, [])).toBeNull();
});

test("a monitor set's overlays are fetched for one monitor; others are unchanged", () => {
	const base = [overlayInput(SET, { dataset: "forecasts", entryType: "burn-status" }), null];
	const options = { overlayFor: { kind: "monitor", id: "p3" } };
	expect(overlayInputsFor(SET, base, options)).toEqual([null, null]);
	const [forP3, misfit] = overlayInputsFor(SET, base, options, MONITORS);
	expect(forP3?.layer).toEqual({
		dataset: "forecasts",
		entryType: "burn-status",
		monitors: ["p3"]
	});
	expect(misfit).toBeNull();
	// Areas, and searched monitors alone, keep one overlay per line.
	const area = [overlayInput(MAIN, { dataset: "forecasts", entryType: "burn-status" })];
	expect(overlayInputsFor(MAIN, area, options, places)).toBe(area);
	const searched = { ...MAIN, layer: { ...MAIN.layer, monitors: ["p1", "p2"] } };
	expect(overlayInputsFor(searched, area, options, MONITORS)).toBe(area);
});

test("an overlay of the main's own keys pairs by key, any other by index", () => {
	expect(pairsByKey(MONITORS, [MONITORS[1]])).toBe(true);
	expect(pairsByKey(places, [{ place: "region:city:clovis", name: "Clovis" }])).toBe(false);
	expect(pairsByKey(MONITORS, [])).toBe(false);
});

test("Overlay for finds a saved monitor among a monitor set's lines, and saves one", () => {
	expect(overlayPlaceFor({ overlayFor: { kind: "monitor", id: "p3" } }, MONITORS, picks)).toBe(
		"monitor:p3"
	);
	expect(overlayRefOf(MONITORS[1], 1, picks)).toEqual({ kind: "monitor", id: "p2" });
	expect(overlayRefOf(places[1], 1, picks)).toEqual(KERN);
});
