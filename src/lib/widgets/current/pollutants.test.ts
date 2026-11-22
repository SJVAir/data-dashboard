import { describe, expect, it } from "vitest";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { WidgetInstance } from "$lib/documents/schema";
import { CHART_TYPE } from "$lib/widgets/chart";
import { CURRENT_TYPE } from "./index";
import {
	currentPollutants,
	firstPollutantOnly,
	onePollutant,
	setCurrentPollutants
} from "./pollutants";

const COUNTY = { kind: "region", type: "county", code: "06019" } as const;
const AQ = "air-quality";

/** Current conditions' data with PM2.5 holding a searched monitor. */
const withMonitor = (): WidgetDataConfig => ({
	layers: [{ dataset: AQ, entryType: "pm25", monitors: ["m1"] }]
});

describe("setCurrentPollutants", () => {
	it("one pollutant: one layer that holds the monitor", () => {
		expect(setCurrentPollutants(withMonitor(), ["o3"])).toEqual({
			layers: [{ dataset: AQ, entryType: "o3", monitors: ["m1"] }]
		});
	});

	it("two pollutants: two layers, the monitor on the first only", () => {
		expect(setCurrentPollutants(withMonitor(), ["pm25", "o3"])).toEqual({
			layers: [
				{ dataset: AQ, entryType: "pm25", monitors: ["m1"] },
				{ dataset: AQ, entryType: "o3" }
			]
		});
	});

	it("none: one air-quality layer with no entry type that still holds the monitor", () => {
		expect(setCurrentPollutants(withMonitor(), [])).toEqual({
			layers: [{ dataset: AQ, monitors: ["m1"] }]
		});
	});

	it("keeps the Where and doesn't change its input", () => {
		const data: WidgetDataConfig = { place: COUNTY, layers: [{ dataset: AQ, entryType: "pm25" }] };
		const out = setCurrentPollutants(data, ["o3", "pm25"]);
		expect(out).toEqual({
			place: COUNTY,
			layers: [
				{ dataset: AQ, entryType: "o3" },
				{ dataset: AQ, entryType: "pm25" }
			]
		});
		expect(data.layers).toEqual([{ dataset: AQ, entryType: "pm25" }]);
	});
});

describe("currentPollutants", () => {
	it("the air-quality layers' entry types, in layer order", () => {
		expect(
			currentPollutants({
				layers: [
					{ dataset: AQ, entryType: "o3", monitors: ["m1"] },
					{ dataset: AQ, entryType: "pm25" }
				]
			})
		).toEqual(["o3", "pm25"]);
		expect(currentPollutants({ layers: [{ dataset: AQ, monitors: ["m1"] }] })).toEqual([]);
	});
});

describe("onePollutant", () => {
	const widget: WidgetInstance = {
		id: "w1",
		type: CURRENT_TYPE,
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 4 },
		data: {
			layers: [
				{ dataset: AQ, entryType: "pm25", monitors: ["m1"] },
				{ dataset: AQ, entryType: "o3" }
			]
		},
		thresholds: [
			{ level: "unhealthy_sensitive", entryType: "pm25" },
			{ level: "moderate", entryType: "o3" }
		]
	};

	it("keeps the Where and the monitor, with only that pollutant's alert level", () => {
		expect(onePollutant(widget, "o3")).toEqual({
			...widget,
			data: { layers: [{ dataset: AQ, entryType: "o3", monitors: ["m1"] }] },
			thresholds: [{ level: "moderate" }]
		});
		const placed = { ...widget, data: { ...widget.data, place: COUNTY } };
		expect(onePollutant(placed, "o3").data.place).toEqual(COUNTY);
	});

	it("a pollutant with its alert level Off has no thresholds", () => {
		const off = { ...widget, thresholds: [{ level: "moderate", entryType: "o3" }] };
		expect(onePollutant(off, "pm25")).not.toHaveProperty("thresholds");
	});
});

describe("firstPollutantOnly", () => {
	it("a Current conditions draft cut to its first pollutant and its alert level", () => {
		expect(
			firstPollutantOnly({
				type: CURRENT_TYPE,
				data: {
					place: COUNTY,
					layers: [
						{ dataset: AQ, entryType: "pm25" },
						{ dataset: AQ, entryType: "o3" }
					]
				},
				thresholds: [
					{ level: "moderate", entryType: "o3" },
					{ level: "unhealthy_sensitive", entryType: "pm25" }
				]
			})
		).toEqual({
			type: CURRENT_TYPE,
			data: { place: COUNTY, layers: [{ dataset: AQ, entryType: "pm25" }] },
			thresholds: [{ level: "unhealthy_sensitive" }]
		});
	});

	it("leaves another type's draft as it is", () => {
		const chart = {
			type: CHART_TYPE,
			data: {
				layers: [
					{ dataset: AQ, entryType: "pm25" },
					{ dataset: AQ, entryType: "o3" }
				]
			},
			thresholds: [{ level: "moderate" }]
		};
		expect(firstPollutantOnly(chart)).toBe(chart);
	});
});
