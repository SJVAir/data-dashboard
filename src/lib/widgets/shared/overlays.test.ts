import { expect, test } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { PlaceInfo, QueryInput, Series, SeriesPoint } from "$lib/data/types";
import type { Picks } from "$lib/places/selection";
import {
	MAX_OVERLAYS,
	overlayInput,
	overlayLayers,
	overlayPlaceFor,
	sharedSource
} from "./overlays";

const entry = (id: string, kind: "pollutant" | "other") => ({
	id,
	label: id,
	units: "",
	kind,
	resolutions: ["day" as const],
	precision: null,
	yMin: null
});

const CATALOG: CatalogEntry[] = [
	{
		id: "air-quality",
		label: "Air quality",
		entryTypes: [entry("pm25", "pollutant")],
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
		timeSubRange: { start: "2026-10-01", end: "2026-10-10" }
	});
	// A single place travels too.
	const one = overlayInput(
		{ ...main, layer: { dataset: "air-quality", entryType: "pm25", place: FRESNO } },
		{ dataset: "forecasts", entryType: "aqi-forecast" }
	);
	expect(one.layer).toEqual({ dataset: "forecasts", entryType: "aqi-forecast", place: FRESNO });
});

test("a third overlay is ignored", () => {
	const data: WidgetDataConfig = {
		layers: [
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
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
