import { describe, expect, it } from "vitest";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { currentType } from "$lib/widgets/current";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { forecastType } from "$lib/widgets/forecast";
import { outsideType } from "$lib/widgets/outside";
import { FORECASTS_ENTRY, PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import type { Draft } from "./draft.svelte";
import { fromNowDraft, isNowShaped, nowPollutant, nowPollutants, toNowDraft } from "./now";

const CATALOG = [FIXTURE_CATALOG[0], FORECASTS_ENTRY];
const FRESNO = { kind: "region", type: "county", code: "06019" } as const;
const CLOVIS = { kind: "region", type: "city", code: "0614218" } as const;

/** A Chart of three counties with a burn status overlay over the last 30 days. */
const chart: Draft = {
	type: CHART_TYPE,
	data: {
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		layers: [
			{
				dataset: "air-quality",
				entryType: "pm25",
				resolution: "day",
				selection: { kind: "regions", ids: ["county:06019", "county:06039", "county:06047"] }
			},
			{ dataset: "forecasts", entryType: "burn-status" }
		]
	},
	options: { overlayFor: FRESNO }
};

describe("toNowDraft", () => {
	it("Chart → Current conditions keeps place 1 and the pollutant, says what's dropped", () => {
		expect(toNowDraft(chart, currentType, CATALOG, PM25_LEVELS)).toEqual({
			draft: {
				type: "current-conditions",
				data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
				thresholds: [{ level: "unhealthy_sensitive" }]
			},
			dropped: ["dates", "overlays", "places"]
		});
	});

	it("keeps an ozone pick for Current conditions; Outside forces PM2.5", () => {
		const ozone: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ dataset: "air-quality", entryType: "o3", place: CLOVIS }] }
		};
		expect(nowPollutant(ozone, currentType, CATALOG)).toBe("o3");
		expect(toNowDraft(ozone, currentType, CATALOG, []).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", place: CLOVIS }
		]);
		expect(nowPollutant(ozone, outsideType, CATALOG)).toBe("pm25");
		const outside = toNowDraft(ozone, outsideType, CATALOG, PM25_LEVELS);
		expect(outside).toEqual({
			draft: {
				type: "outside",
				data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: CLOVIS }] },
				thresholds: [{ level: "unhealthy_sensitive" }]
			},
			dropped: []
		});
	});

	it("no levels (a scale without them) means no alert level", () => {
		const ozone: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ dataset: "air-quality", entryType: "o3", place: CLOVIS }] }
		};
		expect("thresholds" in toNowDraft(ozone, currentType, CATALOG, []).draft).toBe(false);
	});

	it("keeps a saved level the new scale has, else its default", () => {
		const now: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
			thresholds: [{ level: "unhealthy" }]
		};
		expect(toNowDraft(now, outsideType, CATALOG, PM25_LEVELS).draft.thresholds).toEqual([
			{ level: "unhealthy" }
		]);
		const missing = { ...now, thresholds: [{ level: "gone" }] };
		expect(toNowDraft(missing, outsideType, CATALOG, PM25_LEVELS).draft.thresholds).toEqual([
			{ level: "unhealthy_sensitive" }
		]);
	});

	it("Forecast strip keeps the place as a forecasts layer, with no alert level", () => {
		const { draft, dropped } = toNowDraft(chart, forecastType, CATALOG, PM25_LEVELS);
		expect(nowPollutant(chart, forecastType, CATALOG)).toBeUndefined();
		expect(draft).toEqual({
			type: "forecast-strip",
			data: { layers: [{ dataset: "forecasts", place: FRESNO }] }
		});
		expect(dropped).toEqual(["dates", "overlays", "places"]);
		// And back to Current conditions: the catalog's first pollutant.
		const back = toNowDraft(draft, currentType, CATALOG, PM25_LEVELS);
		expect(back.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO }
		]);
		expect(back.dropped).toEqual([]);
	});

	it("a draft with no number pollutant (weather) gets the catalog's first pollutant", () => {
		const weather: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ dataset: "weather", entryType: "temperature", place: FRESNO }] }
		};
		expect(nowPollutant(weather, currentType, CATALOG)).toBe("pm25");
	});
});

describe("fromNowDraft", () => {
	it("back to a Chart gets the default range, nothing else changes", () => {
		const now = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS).draft;
		expect(fromNowDraft(now, chartType)).toEqual({
			type: CHART_TYPE,
			data: {
				dateRange: DEFAULT_RANGE,
				layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
			}
		});
	});

	it("a Forecast strip's place goes on a PM2.5 layer", () => {
		const strip: Draft = {
			type: "forecast-strip",
			data: { layers: [{ dataset: "forecasts", place: FRESNO }] }
		};
		expect(fromNowDraft(strip, chartType).data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO }
		]);
	});
});

describe("isNowShaped", () => {
	it("a saved now widget is, a range draft isn't", () => {
		const now = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS).draft;
		expect(isNowShaped(now, currentType)).toBe(true);
		expect(isNowShaped({ ...now, thresholds: undefined }, currentType)).toBe(true);
		expect(isNowShaped(now, forecastType)).toBe(false);
		expect(isNowShaped({ ...chart, type: "current-conditions" }, currentType)).toBe(false);
	});
});

describe("nowPollutants", () => {
	it("lists the air-quality pollutants that are available", () => {
		expect(nowPollutants(CATALOG).map((e) => e.id)).toEqual(["pm25", "o3"]);
	});
});
