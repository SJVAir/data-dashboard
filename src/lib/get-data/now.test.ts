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
import { LIMITS } from "$lib/data/schema";
import { WidgetInstanceSchema } from "$lib/documents/schema";
import { withThreshold } from "$lib/thresholds/levels";
import type { Draft } from "./draft.svelte";
import {
	areaToLookUp,
	fromNowDraft,
	isNowShaped,
	keptThreshold,
	nowPollutant,
	nowPollutants,
	selectionFits,
	switchRange,
	toNowDraft,
	withArea
} from "./now";

const CATALOG = [FIXTURE_CATALOG[0], FORECASTS_ENTRY];
const FRESNO = { kind: "region", type: "county", code: "06019" } as const;
const CLOVIS = { kind: "region", type: "city", code: "0614218" } as const;

/** A Chart of three counties with a burn status overlay over the last 30 days. */
const chart: Draft = {
	type: CHART_TYPE,
	data: {
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		resolution: "day",
		selection: { kind: "regions", ids: ["county:06019", "county:06039", "county:06047"] },
		layers: [
			{
				dataset: "air-quality",
				entryType: "pm25"
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
				data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
				thresholds: [{ level: "unhealthy_sensitive", entryType: "pm25" }]
			},
			dropped: ["dates", "overlays", "places"]
		});
	});

	it("keeps an ozone pick for Current conditions; Outside forces PM2.5", () => {
		const ozone: Draft = {
			type: CHART_TYPE,
			data: { place: CLOVIS, layers: [{ dataset: "air-quality", entryType: "o3" }] }
		};
		expect(nowPollutant(ozone, currentType, CATALOG)).toBe("o3");
		expect(toNowDraft(ozone, currentType, CATALOG, []).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3" }
		]);
		expect(toNowDraft(ozone, currentType, CATALOG, []).draft.data.place).toEqual(CLOVIS);
		expect(nowPollutant(ozone, outsideType, CATALOG)).toBe("pm25");
		const outside = toNowDraft(ozone, outsideType, CATALOG, PM25_LEVELS);
		expect(outside).toEqual({
			draft: {
				type: "outside",
				data: { place: CLOVIS, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
				thresholds: [{ level: "unhealthy_sensitive" }]
			},
			dropped: ["pollutant"],
			pollutant: { from: { dataset: "air-quality", entryType: "o3" }, to: "pm25" }
		});
	});

	it("no levels (a scale without them) means no alert level", () => {
		const ozone: Draft = {
			type: CHART_TYPE,
			data: { place: CLOVIS, layers: [{ dataset: "air-quality", entryType: "o3" }] }
		};
		expect("thresholds" in toNowDraft(ozone, currentType, CATALOG, []).draft).toBe(false);
	});

	it("keeps a saved level the new scale has, else its default", () => {
		const now: Draft = {
			type: "current-conditions",
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
			thresholds: [{ level: "unhealthy", entryType: "pm25" }]
		};
		expect(
			toNowDraft(now, outsideType, CATALOG, PM25_LEVELS, currentType).draft.thresholds
		).toEqual([{ level: "unhealthy" }]);
		const missing = { ...now, thresholds: [{ level: "gone", entryType: "pm25" }] };
		expect(
			toNowDraft(missing, outsideType, CATALOG, PM25_LEVELS, currentType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive" }]);
	});

	it("an Off alert level stays Off between threshold types; from other types it's the default", () => {
		const outside: Draft = {
			type: "outside",
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
		};
		const current = toNowDraft(outside, currentType, CATALOG, PM25_LEVELS, outsideType);
		expect("thresholds" in current.draft).toBe(false);
		expect(current.dropped).toEqual([]);
		const strip = { ...outside, type: "forecast-strip" };
		expect(
			toNowDraft(strip, currentType, CATALOG, PM25_LEVELS, forecastType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive", entryType: "pm25" }]);
		expect(
			toNowDraft(chart, currentType, CATALOG, PM25_LEVELS, chartType).draft.thresholds
		).toEqual([{ level: "unhealthy_sensitive", entryType: "pm25" }]);
	});

	it("a scale that can't load keeps the alert level as it is, and owes a default where one's due", () => {
		const saved: Draft = {
			type: "current-conditions",
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
			thresholds: [{ level: "unhealthy", entryType: "pm25" }]
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
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
			thresholds: [{ level: "unhealthy", entryType: "pm25" }]
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
			data: { place: FRESNO, layers: [{ dataset: "forecasts" }] }
		});
		expect(dropped).toEqual(["dates", "overlays", "places"]);
		// And back to Current conditions: the catalog's first pollutant.
		const back = toNowDraft(draft, currentType, CATALOG, PM25_LEVELS, forecastType);
		expect(back.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "pm25" }]);
		expect(back.draft.data.place).toEqual(FRESNO);
		expect(back.draft.thresholds).toEqual([{ level: "unhealthy_sensitive", entryType: "pm25" }]);
		expect(back.dropped).toEqual([]);
	});

	it("a draft with no number pollutant (weather) gets the catalog's first pollutant", () => {
		const weather: Draft = {
			type: CHART_TYPE,
			data: { place: FRESNO, layers: [{ dataset: "weather", entryType: "temperature" }] }
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

describe("single-place types: one place or one monitor", () => {
	const PM25 = { dataset: "air-quality", entryType: "pm25" } as const;
	const types = ["sensor", "bam"];

	it("a default Map (every type ticked, no Where) as Current conditions drops the ticks with a note", () => {
		const map: Draft = { type: "map", data: { layers: [{ ...PM25, monitorTypes: types }] } };
		const out = toNowDraft(map, currentType, CATALOG, PM25_LEVELS, mapType);
		expect(out.draft.data).toEqual({ layers: [PM25] });
		expect(out.dropped).toContain("monitor-types");
	});

	it("one searched monitor and no Where is kept, with no note", () => {
		const chartOfOne: Draft = {
			type: CHART_TYPE,
			data: { dateRange: DEFAULT_RANGE, layers: [{ ...PM25, monitors: ["m1"] }] }
		};
		const out = toNowDraft(chartOfOne, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(out.draft.data).toEqual({ layers: [{ ...PM25, monitors: ["m1"] }] });
		expect(out.dropped).toEqual(["dates"]);
	});

	it("a Where and a monitor: the monitor is kept and the Where dropped with a places note", () => {
		const both: Draft = {
			type: CHART_TYPE,
			data: { place: FRESNO, layers: [{ ...PM25, monitors: ["m1"] }] }
		};
		const out = toNowDraft(both, outsideType, CATALOG, PM25_LEVELS, chartType);
		expect(out.draft.data).toEqual({ layers: [{ ...PM25, monitors: ["m1"] }] });
		expect(out.dropped).toEqual(["places"]);
	});

	it("several searched monitors keep the first, the rest noted as left out", () => {
		const many: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ ...PM25, monitors: ["m1", "m2", "m3"] }] }
		};
		const out = toNowDraft(many, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(out.draft.data.layers).toEqual([{ ...PM25, monitors: ["m1"] }]);
		expect(out.dropped).toContain("places");
	});

	it("the Forecast strip keeps its monitor on its forecasts layer, both ways", () => {
		const chartOfOne: Draft = {
			type: CHART_TYPE,
			data: { layers: [{ ...PM25, monitors: ["m1"] }] }
		};
		const strip = toNowDraft(chartOfOne, forecastType, CATALOG, PM25_LEVELS, chartType);
		expect(strip.draft.data).toEqual({ layers: [{ dataset: "forecasts", monitors: ["m1"] }] });
		expect(strip.dropped).toEqual([]);
		expect(isNowShaped(strip.draft, forecastType)).toBe(true);
		const back = toNowDraft(strip.draft, currentType, CATALOG, PM25_LEVELS, forecastType);
		expect(back.draft.data).toEqual({ layers: [{ ...PM25, monitors: ["m1"] }] });
		expect(fromNowDraft(strip.draft, chartType).draft.data.layers).toEqual([
			{ ...PM25, monitors: ["m1"] }
		]);
	});

	it("fromNowDraft to a one-place type: ticked types dropped, a monitor wins over the Where", () => {
		const map: Draft = {
			type: "map",
			data: { place: FRESNO, layers: [{ ...PM25, monitors: ["m1", "m2"], monitorTypes: types }] }
		};
		const out = fromNowDraft(map, monthCalendarType);
		expect(out.draft.data.place).toBeUndefined();
		expect(out.draft.data.layers).toEqual([{ ...PM25, monitors: ["m1"] }]);
		expect(out.dropped).toEqual(expect.arrayContaining(["places", "monitor-types"]));
		// A Chart takes them all.
		const chartOut = fromNowDraft(map, chartType);
		expect(chartOut.draft.data.place).toEqual(FRESNO);
		expect(chartOut.draft.data.layers).toEqual([
			{ ...PM25, monitors: ["m1", "m2"], monitorTypes: types }
		]);
		expect(chartOut.dropped).toEqual([]);
	});

	it("isNowShaped: a one-place type with ticks, two monitors, or a Where and a monitor isn't", () => {
		const tile = (data: Draft["data"]): Draft => ({ type: "current-conditions", data });
		expect(isNowShaped(tile({ layers: [{ ...PM25, monitors: ["m1"] }] }), currentType)).toBe(true);
		expect(isNowShaped(tile({ layers: [{ ...PM25, monitorTypes: types }] }), currentType)).toBe(
			false
		);
		expect(isNowShaped(tile({ layers: [{ ...PM25, monitors: ["m1", "m2"] }] }), currentType)).toBe(
			false
		);
		expect(
			isNowShaped(tile({ place: FRESNO, layers: [{ ...PM25, monitors: ["m1"] }] }), currentType)
		).toBe(false);
	});
});

describe("Chart threshold lines in conversions", () => {
	it("a Chart with its line Off still gets the default level as a tile", () => {
		const converted = toNowDraft(chart, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([
			{ level: "unhealthy_sensitive", entryType: "pm25" }
		]);
	});

	it("a Chart's line level carries to a tile as its alert level", () => {
		const withLine: Draft = { ...chart, thresholds: [{ level: "unhealthy" }] };
		const converted = toNowDraft(withLine, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([{ level: "unhealthy", entryType: "pm25" }]);
	});

	it("a line below tier 2 carried over is named, so a low alert level isn't a surprise", () => {
		const withLine: Draft = { ...chart, thresholds: [{ level: "moderate" }] };
		const converted = toNowDraft(withLine, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.thresholds).toEqual([{ level: "moderate", entryType: "pm25" }]);
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
		const tile: Draft = {
			...withLine,
			type: "current-conditions",
			thresholds: [{ level: "moderate", entryType: "pm25" }]
		};
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
					place: FRESNO,
					layers: [{ dataset: "air-quality", entryType: "pm25" }]
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
			data: { place: FRESNO, layers: [{ dataset: "forecasts" }] }
		};
		expect(fromNowDraft(strip, chartType).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" }
		]);
		expect(fromNowDraft(strip, chartType).draft.data.place).toEqual(FRESNO);
	});

	it("fromNowDraft from a 25-place Map to Chart keeps all 25; a one-place type keeps the first", () => {
		const ids = Array.from({ length: 25 }, (_, i) => `county:m${i + 1}`);
		const map: Draft = {
			type: "map",
			data: {
				selection: { kind: "regions", ids },
				layers: [{ dataset: "air-quality", entryType: "o3" }]
			}
		};
		expect(fromNowDraft(map, chartType)).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: DEFAULT_RANGE,
					selection: { kind: "regions", ids },
					layers: [
						{
							dataset: "air-quality",
							entryType: "o3"
						}
					]
				}
			},
			dropped: []
		});
		// A one-place target gets the first as its `place`.
		const one = { ...chartType, accepts: { ...chartType.accepts, maxPlaces: 1 } };
		expect(fromNowDraft(map, one).draft.data.layers).toEqual([
			{ dataset: "air-quality", entryType: "o3" }
		]);
		expect(fromNowDraft(map, one).draft.data.place).toEqual({
			kind: "region",
			type: "county",
			code: "m1"
		});
		expect(fromNowDraft(map, one).dropped).toEqual(["places"]);
		// A Data table takes every place too.
		const table = fromNowDraft(map, dataTableType);
		expect(table.draft.data.selection?.ids).toEqual(ids);
		expect(table.dropped).toEqual([]);
	});

	it("fromNowDraft from a one-place now tile is unchanged", () => {
		const tile: Draft = {
			type: "current-conditions",
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
		};
		expect(fromNowDraft(tile, chartType)).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: DEFAULT_RANGE,
					place: FRESNO,
					layers: [{ dataset: "air-quality", entryType: "pm25" }]
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
			data: { place: FRESNO, layers: [{ dataset: "air-quality", entryType: "pm25" }] },
			thresholds: [{ level: "unhealthy", entryType: "pm25" }]
		};
		expect(fromNowDraft(tile, contributionCalendarType)).toEqual({
			draft: {
				type: contributionCalendarType.type,
				data: {
					dateRange: { kind: "trailing", amount: 12, unit: "month" },
					place: FRESNO,
					layers: [{ dataset: "air-quality", entryType: "pm25" }]
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
	const monitors = (n: number) => Array.from({ length: n }, (_, i) => `county:m${i + 1}`);
	const chartOf = (ids: string[]): Draft => ({
		type: CHART_TYPE,
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			resolution: "day",
			selection: { kind: "regions", ids },
			layers: [
				{
					dataset: "air-quality",
					entryType: "pm25"
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
				selection: { kind: "regions", ids: ["county:m1", "county:m2", "county:m3"] },
				layers: [
					{
						dataset: "air-quality",
						entryType: "pm25"
					}
				]
			}
		});
		expect(out.dropped).not.toContain("places");
	});

	it("toNowDraft to Map cuts at 25 with a places note", () => {
		const out = toNowDraft(chartOf(monitors(30)), mapType, CATALOG, [], chartType, ALLOWED);
		expect(out.draft.data.selection).toEqual({ kind: "regions", ids: monitors(25) });
		expect(out.dropped).toContain("places");
	});

	it("toNowDraft to Current conditions still keeps one", () => {
		const out = toNowDraft(chartOf(monitors(3)), currentType, CATALOG, [], chartType);
		expect(out.draft.data.layers).toEqual([{ dataset: "air-quality", entryType: "pm25" }]);
		expect(out.draft.data.place).toEqual({ kind: "region", type: "county", code: "m1" });
		expect(out.dropped).toContain("places");
	});

	it('nowPollutant for Map with allowed ["o3","pm25"] turns co into the first allowed', () => {
		const co: Draft = {
			type: CHART_TYPE,
			data: { place: CLOVIS, layers: [{ dataset: "air-quality", entryType: "co" }] }
		};
		expect(nowPollutant(co, mapType, CATALOG, ALLOWED)).toBe("o3");
		expect(nowPollutant(chartOf(["county:m1"]), mapType, CATALOG, ALLOWED)).toBe("pm25");
		expect(nowPollutant(chartOf(["county:m1"]), mapType, CATALOG, ["o3"])).toBe("o3");
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

describe("a school or point Where shown as a Chart or Table (areas only)", () => {
	const SCHOOL = { kind: "location", source: "schools", code: "s1" } as const;
	const POINT = { kind: "point", lat: 36.7, lon: -119.8 } as const;
	const tile = (place: Draft["data"]["place"]): Draft => ({
		type: currentType.type,
		data: { place, layers: [{ dataset: "air-quality", entryType: "pm25" }] }
	});

	it("only a school or point, only for an areas-only type, is looked up", () => {
		expect(areaToLookUp(tile(SCHOOL), CHART_TYPE)).toEqual(SCHOOL);
		expect(areaToLookUp(tile(POINT), dataTableType.type)).toEqual(POINT);
		expect(areaToLookUp(tile(FRESNO), CHART_TYPE)).toBeNull();
		expect(areaToLookUp(tile(SCHOOL), monthCalendarType.type)).toBeNull();
	});

	it("the looked-up area takes the school's place", () => {
		const converted = withArea(fromNowDraft(tile(SCHOOL), chartType), FRESNO);
		expect(converted.draft.data.place).toEqual(FRESNO);
		expect(converted.dropped).not.toContain("area");
	});

	it("with no area, the point is left out with a note", () => {
		const converted = withArea(fromNowDraft(tile(POINT), dataTableType), null);
		expect(converted.draft.data.place).toBeUndefined();
		expect(converted.dropped).toContain("area");
	});

	it("a type that shows schools keeps it", () => {
		const converted = fromNowDraft(tile(SCHOOL), monthCalendarType);
		expect(withArea(converted, FRESNO)).toBe(converted);
	});
});

describe("alert levels per pollutant", () => {
	it("keptThreshold keeps one pollutant's entry with its entryType", () => {
		expect(
			keptThreshold(
				[{ level: "unhealthy_sensitive", entryType: "pm25" }],
				PM25_LEVELS,
				false,
				"pm25"
			)
		).toEqual([{ level: "unhealthy_sensitive", entryType: "pm25" }]);
	});
	it("keptThreshold reads only the entry for the entryType", () => {
		expect(
			keptThreshold([{ level: "usg", entryType: "o3" }], PM25_LEVELS, false, "pm25")
		).toBeUndefined();
	});
	const a = { level: "usg", entryType: "pm25" };
	const b = { level: "unhealthy", entryType: "o3" };
	it("withThreshold replaces, adds and removes one entry, keeping the others in order", () => {
		expect(withThreshold([a, b], "pm25", { level: "good", entryType: "pm25" })).toEqual([
			{ level: "good", entryType: "pm25" },
			b
		]);
		expect(withThreshold([a], "o3", b)).toEqual([a, b]);
		expect(withThreshold(undefined, "o3", b)).toEqual([b]);
		expect(withThreshold([a, b], "pm25", undefined)).toEqual([b]);
	});
	it("withThreshold gives undefined when the last entry goes", () => {
		expect(withThreshold([a], "pm25", undefined)).toBeUndefined();
		expect(withThreshold(undefined, "pm25", undefined)).toBeUndefined();
	});
	it("the widget schema rejects two entries with the same entryType", () => {
		const widget = {
			id: "w",
			type: "current",
			title: null,
			rect: { x: 0, y: 0, w: 4, h: 4 },
			data: { layers: [], dateRange: DEFAULT_RANGE }
		};
		const parse = (thresholds: unknown) =>
			WidgetInstanceSchema.safeParse({ ...widget, thresholds }).success;
		expect(parse([a, { level: "good", entryType: "pm25" }])).toBe(false);
		expect(parse([a, b])).toBe(true);
		expect(parse([{ level: "usg" }, { level: "good" }])).toBe(true);
		// One per pollutant layer at most (R6).
		const many = (n: number) =>
			Array.from({ length: n }, (_, i) => ({ level: "usg", entryType: `p${i}` }));
		expect(parse(many(LIMITS.LAYERS_MAX))).toBe(true);
		expect(parse(many(LIMITS.LAYERS_MAX + 1))).toBe(false);
	});
});

describe("Current conditions with several pollutants", () => {
	const AQ = "air-quality";
	const tile = (data: Draft["data"]): Draft => ({ type: "current-conditions", data });

	it("isNowShaped holds for two pollutants, the monitor on the first", () => {
		const two = tile({
			layers: [
				{ dataset: AQ, entryType: "pm25", monitors: ["m1"] },
				{ dataset: AQ, entryType: "o3" }
			]
		});
		expect(isNowShaped(two, currentType)).toBe(true);
	});

	it("isNowShaped fails for the same pollutant twice or a monitor on a later layer", () => {
		const twice = tile({
			place: FRESNO,
			layers: [
				{ dataset: AQ, entryType: "pm25" },
				{ dataset: AQ, entryType: "pm25" }
			]
		});
		expect(isNowShaped(twice, currentType)).toBe(false);
		const later = tile({
			layers: [
				{ dataset: AQ, entryType: "pm25" },
				{ dataset: AQ, entryType: "o3", monitors: ["m1"] }
			]
		});
		expect(isNowShaped(later, currentType)).toBe(false);
		const other = tile({
			place: FRESNO,
			layers: [
				{ dataset: AQ, entryType: "pm25" },
				{ dataset: "forecasts", entryType: "burn-status" }
			]
		});
		expect(isNowShaped(other, currentType)).toBe(false);
	});

	it("isNowShaped holds for no pollutant ticked, still holding the monitor (R4)", () => {
		const none = tile({ layers: [{ dataset: AQ, monitors: ["m1"] }] });
		expect(isNowShaped(none, currentType)).toBe(true);
		// Other now types still need a pollutant.
		expect(isNowShaped({ ...none, type: "outside" }, outsideType)).toBe(false);
	});

	it("toNowDraft from a Chart's PM2.5 gives the alert level PM2.5's entry type", () => {
		const withLine: Draft = { ...chart, thresholds: [{ level: "unhealthy_sensitive" }] };
		const converted = toNowDraft(withLine, currentType, CATALOG, PM25_LEVELS, chartType);
		expect(converted.draft.data.layers).toEqual([{ dataset: AQ, entryType: "pm25" }]);
		expect(converted.draft.thresholds).toEqual([
			{ level: "unhealthy_sensitive", entryType: "pm25" }
		]);
		// With the scale unavailable, the saved level is kept, for PM2.5.
		const kept = toNowDraft(withLine, currentType, CATALOG, "unavailable", chartType);
		expect(kept.draft.thresholds).toEqual([{ level: "unhealthy_sensitive", entryType: "pm25" }]);
	});

	it("from two pollutants to another now type: the first, its alert level, the rest left out", () => {
		const two: Draft = {
			...tile({
				place: FRESNO,
				layers: [
					{ dataset: AQ, entryType: "pm25" },
					{ dataset: AQ, entryType: "o3" }
				]
			}),
			thresholds: [
				{ level: "moderate", entryType: "o3" },
				{ level: "unhealthy", entryType: "pm25" }
			]
		};
		const outside = toNowDraft(two, outsideType, CATALOG, PM25_LEVELS, currentType);
		expect(outside.draft.data.layers).toEqual([{ dataset: AQ, entryType: "pm25" }]);
		expect(outside.draft.thresholds).toEqual([{ level: "unhealthy" }]);
		expect(outside.dropped).toEqual(["pollutants"]);
		expect(outside.leftOut).toEqual([{ dataset: AQ, entryType: "o3" }]);
		const month = fromNowDraft(two, monthCalendarType);
		expect(month.draft.data.layers).toEqual([{ dataset: AQ, entryType: "pm25" }]);
		expect(month.draft.thresholds).toEqual([{ level: "unhealthy" }]);
		expect(month.dropped).toEqual(["pollutants"]);
		expect(month.leftOut).toEqual([{ dataset: AQ, entryType: "o3" }]);
	});

	it("from one pollutant, nothing is noted and its alert level loses its entry type", () => {
		const one: Draft = {
			...tile({ place: FRESNO, layers: [{ dataset: AQ, entryType: "pm25" }] }),
			thresholds: [{ level: "unhealthy", entryType: "pm25" }]
		};
		const month = fromNowDraft(one, monthCalendarType);
		expect(month.dropped).toEqual([]);
		expect(month).not.toHaveProperty("leftOut");
		expect(month.draft.thresholds).toEqual([{ level: "unhealthy" }]);
	});
});
