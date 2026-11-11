import { describe, expect, it } from "vitest";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { contributionCalendarType } from "$lib/widgets/calendars/contribution";
import { monthCalendarType } from "$lib/widgets/calendars/month";
import { currentType } from "$lib/widgets/current";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { dataTableType } from "$lib/widgets/table";
import { forecastType } from "$lib/widgets/forecast";
import { mapType } from "$lib/widgets/map";
import { outsideType } from "$lib/widgets/outside";
import { FORECASTS_ENTRY, PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import type { Draft } from "./draft.svelte";
import {
	fromNowDraft,
	isNowShaped,
	nowPollutant,
	nowPollutants,
	selectionFits,
	switchRange,
	toNowDraft
} from "./now";

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
			dropped: ["pollutant"],
			pollutant: { from: { dataset: "air-quality", entryType: "o3" }, to: "pm25" }
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
		expect(
			toNowDraft(now, outsideType, CATALOG, PM25_LEVELS, currentType).draft.thresholds
		).toEqual([{ level: "unhealthy" }]);
		const missing = { ...now, thresholds: [{ level: "gone" }] };
		expect(
			toNowDraft(missing, outsideType, CATALOG, PM25_LEVELS, currentType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive" }]);
	});

	it("an Off alert level stays Off between threshold types; from other types it's the default", () => {
		const outside: Draft = {
			type: "outside",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] }
		};
		const current = toNowDraft(outside, currentType, CATALOG, PM25_LEVELS, outsideType);
		expect("thresholds" in current.draft).toBe(false);
		expect(current.dropped).toEqual([]);
		const strip = { ...outside, type: "forecast-strip" };
		expect(
			toNowDraft(strip, currentType, CATALOG, PM25_LEVELS, forecastType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive" }]);
		expect(
			toNowDraft(chart, currentType, CATALOG, PM25_LEVELS, chartType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive" }]);
	});

	it("a scale that can't load keeps the alert level as it is, and owes a default where one's due", () => {
		const saved: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
			thresholds: [{ level: "unhealthy" }]
		};
		const kept = toNowDraft(saved, outsideType, CATALOG, "unavailable", currentType);
		expect(kept.draft.thresholds).toEqual([{ level: "unhealthy" }]);
		expect(kept.defaultOwed).toBeUndefined();
		const owed = toNowDraft(chart, currentType, CATALOG, "unavailable", chartType);
		expect("thresholds" in owed.draft).toBe(false);
		expect(owed.defaultOwed).toBe(true);
		const off = toNowDraft(
			{ ...saved, thresholds: undefined },
			outsideType,
			CATALOG,
			"unavailable",
			currentType
		);
		expect(off.defaultOwed).toBeUndefined();
	});

	it("to the Forecast strip, a saved alert level is left out, and says so", () => {
		const saved: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
			thresholds: [{ level: "unhealthy" }]
		};
		const strip = toNowDraft(saved, forecastType, CATALOG, [], currentType);
		expect("thresholds" in strip.draft).toBe(false);
		expect(strip.dropped).toEqual(["alert"]);
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
		const back = toNowDraft(draft, currentType, CATALOG, PM25_LEVELS, forecastType);
		expect(back.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO }
		]);
		expect(back.draft.thresholds).toEqual([{ level: "unhealthy_sensitive" }]);
		expect(back.dropped).toEqual([]);
	});

	it("a draft with no number pollutant (weather) gets the catalog's first pollutant", () => {
		const weather: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ dataset: "weather", entryType: "temperature", place: FRESNO }] }
		};
		expect(nowPollutant(weather, currentType, CATALOG)).toBe("pm25");
		const converted = toNowDraft(weather, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.dropped).toEqual(["pollutant"]);
		expect(converted.pollutant).toEqual({
			from: { dataset: "weather", entryType: "temperature" },
			to: "pm25"
		});
	});
});

describe("Chart threshold lines in conversions", () => {
	it("a Chart with its line Off still gets the default level as a tile", () => {
		const converted = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([{ level: "unhealthy_sensitive" }]);
	});

	it("a Chart's line level carries to a tile as its alert level", () => {
		const withLine: Draft = { ...chart, thresholds: [{ level: "unhealthy" }] };
		const converted = toNowDraft(withLine, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([{ level: "unhealthy" }]);
	});

	it("a line below tier 2 carried over is named, so a low alert level isn't a surprise", () => {
		const withLine: Draft = { ...chart, thresholds: [{ level: "moderate" }] };
		const converted = toNowDraft(withLine, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([{ level: "moderate" }]);
		expect(converted.fromLine).toEqual(PM25_LEVELS[1]);
		// At tier 2 or above, or the default (no line), nothing is said.
		const usg: Draft = { ...chart, thresholds: [{ level: "unhealthy_sensitive" }] };
		expect(toNowDraft(usg, currentType, CATALOG, PM25_LEVELS, chartType)).not.toHaveProperty(
			"fromLine"
		);
		expect(toNowDraft(chart, currentType, CATALOG, PM25_LEVELS, chartType)).not.toHaveProperty(
			"fromLine"
		);
		// A tile's own low alert level, between now types, isn't a line.
		const tile: Draft = { ...withLine, type: "current-conditions" };
		expect(toNowDraft(tile, outsideType, CATALOG, PM25_LEVELS, currentType)).not.toHaveProperty(
			"fromLine"
		);
	});

	it("a tile's alert level isn't carried to a Chart as a line", () => {
		const tile = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS).draft;
		expect(fromNowDraft(tile, chartType).draft).not.toHaveProperty("thresholds");
	});
});

describe("fromNowDraft", () => {
	it("back to a Chart gets the default range, nothing else changes", () => {
		const now = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS).draft;
		expect(fromNowDraft({ ...now, thresholds: undefined }, chartType)).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: DEFAULT_RANGE,
					layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
				}
			},
			dropped: []
		});
		// The Chart has no alert level: it's left out, and says so.
		const withAlert = fromNowDraft(now, chartType);
		expect("thresholds" in withAlert.draft).toBe(false);
		expect(withAlert.dropped).toEqual(["alert"]);
	});

	it("a Forecast strip's place goes on a PM2.5 layer", () => {
		const strip: Draft = {
			type: "forecast-strip",
			data: { layers: [{ dataset: "forecasts", place: FRESNO }] }
		};
		expect(fromNowDraft(strip, chartType).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO }
		]);
	});

	it("fromNowDraft from a 25-place Map to Chart keeps 5 with a places note", () => {
		const ids = Array.from({ length: 25 }, (_, i) => `m${i + 1}`);
		const map: Draft = {
			type: "map",
			data: {
				layers: [{ dataset: "air-quality", entryType: "o3", selection: { kind: "monitors", ids } }]
			}
		};
		expect(fromNowDraft(map, chartType)).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: DEFAULT_RANGE,
					layers: [
						{
							dataset: "air-quality",
							entryType: "o3",
							selection: { kind: "monitors", ids: ids.slice(0, 5) }
						}
					]
				}
			},
			dropped: ["places"]
		});
		// A one-place target gets the first as its `place`.
		const one = { ...chartType, accepts: { ...chartType.accepts, maxPlaces: 1 } };
		expect(fromNowDraft(map, one).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3", place: { kind: "monitor", id: "m1" } }
		]);
		// Data table's cap is 10.
		const table = fromNowDraft(map, dataTableType);
		expect(table.draft.data.layers[0].selection?.ids).toEqual(ids.slice(0, 10));
		expect(table.dropped).toEqual(["places"]);
	});

	it("fromNowDraft from a one-place now tile is unchanged", () => {
		const tile: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] }
		};
		expect(fromNowDraft(tile, chartType)).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: DEFAULT_RANGE,
					layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
				}
			},
			dropped: []
		});
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

describe("calendar conversions", () => {
	const NOW = new Date("2026-11-05T20:00:00Z");
	const MONTH = { kind: "to-date", unit: "month" } as const;

	it("a current-conditions tile becomes a contribution calendar over 12 months", () => {
		const tile: Draft = {
			type: "current-conditions",
			data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }] },
			thresholds: [{ level: "unhealthy" }]
		};
		expect(fromNowDraft(tile, contributionCalendarType)).toEqual({
			draft: {
				type: contributionCalendarType.type,
				data: {
					dateRange: { kind: "trailing", amount: 12, unit: "month" },
					layers: [{ dataset: "air-quality", entryType: "pm25", place: FRESNO }]
				},
				thresholds: [{ level: "unhealthy" }]
			},
			dropped: []
		});
	});

	it("Chart to month calendar: the default range changes, a chosen one stays", () => {
		const def = switchRange({ dateRange: DEFAULT_RANGE }, chartType, monthCalendarType, NOW);
		expect(def.dateRange).toEqual(MONTH);
		const own = { kind: "trailing", amount: 20, unit: "day" } as const;
		expect(switchRange({ dateRange: own }, chartType, monthCalendarType, NOW).dateRange).toEqual(
			own
		);
	});

	it("leaving a calendar drops the selection and reports it; calendar to calendar keeps it", () => {
		const data = { dateRange: MONTH, timeSubRange: { start: "2026-11-02", end: "2026-11-03" } };
		const out = switchRange(data, monthCalendarType, chartType, NOW);
		expect(out.timeSubRange).toBeUndefined();
		expect(out.left).toEqual(data.timeSubRange);
		const kept = switchRange(
			{ ...data, dateRange: { kind: "trailing", amount: 20, unit: "day" } as const },
			monthCalendarType,
			contributionCalendarType,
			NOW
		);
		expect(kept.timeSubRange).toEqual(data.timeSubRange);
	});

	it("a selection outside the new default range is dropped", () => {
		const out = switchRange(
			{ dateRange: MONTH, timeSubRange: { start: "2024-05-02", end: "2024-05-03" } },
			monthCalendarType,
			contributionCalendarType,
			NOW
		);
		expect(out.dateRange).toEqual({ kind: "trailing", amount: 12, unit: "month" });
		expect(out.timeSubRange).toBeUndefined();
	});

	it("calendar to Chart: the calendar's default range gives way to the Chart's, a chosen one stays", () => {
		const last12 = { kind: "trailing", amount: 12, unit: "month" } as const;
		expect(
			switchRange({ dateRange: last12 }, contributionCalendarType, chartType, NOW).dateRange
		).toEqual(DEFAULT_RANGE);
		const own = { kind: "trailing", amount: 20, unit: "day" } as const;
		expect(
			switchRange({ dateRange: own }, contributionCalendarType, chartType, NOW).dateRange
		).toEqual(own);
		// A Chart's own range isn't touched when the target has no default either.
		expect(switchRange({ dateRange: own }, chartType, dataTableType, NOW).dateRange).toEqual(own);
	});

	it("calendar to calendar drops a selection the new default range doesn't hold, and says outside", () => {
		const out = switchRange(
			{ dateRange: MONTH, timeSubRange: { start: "2024-05-02", end: "2024-05-03" } },
			monthCalendarType,
			contributionCalendarType,
			NOW
		);
		expect(out.outside).toEqual({ start: "2024-05-02", end: "2024-05-03" });
		expect(out.left).toBeUndefined();
	});

	it("selectionFits: inside the range or not", () => {
		const sel = { start: "2026-11-02", end: "2026-11-03" };
		expect(selectionFits(sel, MONTH, NOW)).toBe(true);
		expect(selectionFits(sel, { kind: "trailing", amount: 1, unit: "day" }, NOW)).toBe(false);
	});
});

describe("a Map: several places, the map's pollutants", () => {
	const monitors = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
	const chartOf = (ids: string[]): Draft => ({
		type: CHART_TYPE,
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				{
					dataset: "air-quality",
					entryType: "pm25",
					resolution: "day",
					selection: { kind: "monitors", ids }
				}
			]
		}
	});
	const ALLOWED = ["o3", "pm25"];

	it("toNowDraft to Map keeps three monitors as a selection", () => {
		const out = toNowDraft(chartOf(monitors(3)), mapType, CATALOG, [], chartType, ALLOWED);
		expect(out.draft).toEqual({
			type: "map",
			data: {
				layers: [
					{
						dataset: "air-quality",
						entryType: "pm25",
						selection: { kind: "monitors", ids: ["m1", "m2", "m3"] }
					}
				]
			}
		});
		expect(out.dropped).not.toContain("places");
	});

	it("toNowDraft to Map cuts at 25 with a places note", () => {
		const out = toNowDraft(chartOf(monitors(30)), mapType, CATALOG, [], chartType, ALLOWED);
		expect(out.draft.data.layers[0].selection).toEqual({ kind: "monitors", ids: monitors(25) });
		expect(out.dropped).toContain("places");
	});

	it("toNowDraft to Current conditions still keeps one", () => {
		const out = toNowDraft(chartOf(monitors(3)), currentType, CATALOG, [], chartType);
		expect(out.draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m1" } }
		]);
		expect(out.dropped).toContain("places");
	});

	it('nowPollutant for Map with allowed ["o3","pm25"] turns co into the first allowed', () => {
		const co: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ dataset: "air-quality", entryType: "co", place: CLOVIS }] }
		};
		expect(nowPollutant(co, mapType, CATALOG, ALLOWED)).toBe("o3");
		expect(nowPollutant(chartOf(["m1"]), mapType, CATALOG, ALLOWED)).toBe("pm25");
		expect(nowPollutant(chartOf(["m1"]), mapType, CATALOG, ["o3"])).toBe("o3");
		const out = toNowDraft(co, mapType, CATALOG, [], chartType, ALLOWED);
		expect(out.draft.data.layers[0].entryType).toBe("o3");
		expect(out.dropped).toContain("pollutant");
		expect(out.pollutant).toEqual({ from: { dataset: "air-quality", entryType: "co" }, to: "o3" });
	});

	it("isNowShaped accepts a Map selection of 3", () => {
		const map = toNowDraft(chartOf(monitors(3)), mapType, CATALOG, [], chartType, ALLOWED).draft;
		expect(isNowShaped(map, mapType)).toBe(true);
		expect(isNowShaped({ ...map, type: "current-conditions" }, currentType)).toBe(false);
	});
});
