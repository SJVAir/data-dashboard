import { describe, expect, it } from "vitest";
import type { Component } from "svelte";
import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { WidgetType } from "$lib/widgets/registry";
import { chartType } from "$lib/widgets/chart";
import { dataTableType } from "$lib/widgets/table";
import { offeredDatasets, typeBlock } from "./offer";

const NOW = new Date("2026-11-05T20:00:00Z");

function entryType(id: string, extra: Partial<EntryTypeMeta> = {}): EntryTypeMeta {
	return {
		id,
		label: id,
		units: "",
		kind: "pollutant",
		resolutions: ["hour"],
		precision: null,
		yMin: null,
		chart: null,
		aggregate: null,
		...extra
	};
}

function dataset(id: string, entryTypes: EntryTypeMeta[]): CatalogEntry {
	return { id, label: id, entryTypes, geographies: [] };
}

const CATALOG: CatalogEntry[] = [
	dataset("air-quality", [
		entryType("pm25"),
		entryType("o3"),
		entryType("temp", { kind: "meteorological" })
	]),
	dataset("forecasts", [entryType("pm25")]),
	dataset("census", [entryType("people")])
];

function type(extra: Partial<WidgetType> = {}): WidgetType {
	return {
		type: "t",
		label: () => "t",
		icon: (() => {}) as unknown as Component,
		minSize: { w: 1, h: 1 },
		defaultSize: { w: 1, h: 1 },
		time: "range",
		thresholds: false,
		analyzable: false,
		downloadable: false,
		menu: () => [],
		load: async () => ({ component: (() => {}) as never }),
		...extra
	};
}

const monitors = (n: number) => ({
	kind: "monitors" as const,
	ids: Array.from({ length: n }, (_, i) => `m${i}`)
});

/** Adapters with only an id: none of them offers overlays. */
const adapters = (list: string[]) => list.map((id) => ({ id }));

describe("offeredDatasets", () => {
	it("forecasts appears only once an adapter exists", () => {
		const types = [chartType, dataTableType];
		const without = offeredDatasets(CATALOG, adapters(["air-quality"]), types).map(
			(o) => o.dataset.id
		);
		expect(without).toEqual(["air-quality"]);
		const withIt = offeredDatasets(CATALOG, adapters(["air-quality", "forecasts"]), types).map(
			(o) => o.dataset.id
		);
		expect(withIt).toEqual(["air-quality", "forecasts"]);
	});

	it("a dataset the types do not accept is not offered", () => {
		const ids = offeredDatasets(CATALOG, adapters(["air-quality", "forecasts", "census"]), [
			chartType
		]).map((o) => o.dataset.id);
		expect(ids).not.toContain("census");
	});

	it("an unavailable entry type is left out", () => {
		const catalog = [
			dataset("air-quality", [
				entryType("pm25"),
				entryType("pm10", { available: false }),
				entryType("pm1", { retired: { since: "2025-01-01" } })
			])
		];
		const [offer] = offeredDatasets(catalog, adapters(["air-quality"]), [chartType]);
		expect(offer.entryTypes.map((e) => e.id)).toEqual(["pm25"]);
	});

	it("a type with no accepts.datasets accepts nothing", () => {
		expect(offeredDatasets(CATALOG, adapters(["air-quality"]), [type()])).toEqual([]);
	});

	it("overlays are only the entry types their adapter says fit", () => {
		const catalog = [
			dataset("air-quality", [
				entryType("pm25"),
				entryType("humidity", { kind: "meteorological", resolutions: ["raw"] })
			]),
			dataset("forecasts", [
				entryType("burn-status", { kind: "other" }),
				entryType("aqi", { kind: "other" })
			])
		];
		const offers = [{ id: "air-quality" }, { id: "forecasts", overlays: () => true }];
		const [air, forecasts] = offeredDatasets(catalog, offers, [chartType]);
		expect(air.entryTypes.map((e) => e.id)).toEqual(["pm25", "humidity"]);
		expect(air.overlayTypes).toEqual([]);
		expect(forecasts.overlayTypes.map((e) => e.id)).toEqual(["burn-status", "aqi"]);
	});
});

describe("typeBlock", () => {
	const data = (extra: Partial<WidgetDataConfig> = {}): WidgetDataConfig => ({
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		layers: [{ dataset: "air-quality", entryType: "pm25" }],
		...extra
	});

	it("is null when the data fits", () => {
		expect(typeBlock(chartType, data(), CATALOG, NOW)).toBeNull();
	});

	it("7 places blocks Chart (places), not Data table", () => {
		const d = data({
			layers: [{ dataset: "air-quality", entryType: "pm25", selection: monitors(7) }]
		});
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBe("places");
		expect(typeBlock(dataTableType, d, CATALOG, NOW)).toBeNull();
	});

	it("a dataset the type doesn't accept blocks it", () => {
		const d = data({ layers: [{ dataset: "census", entryType: "people" }] });
		expect(typeBlock(chartType, d, CATALOG, NOW)).toBe("dataset");
	});

	it("two pollutant layers block a one-pollutant type; a meteorological one doesn't count", () => {
		const two = data({
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "o3" }
			]
		});
		expect(typeBlock(chartType, two, CATALOG, NOW)).toBe("pollutants");
		const mixed = data({
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "temp" }
			]
		});
		expect(typeBlock(chartType, mixed, CATALOG, NOW)).toBeNull();
	});

	it("a range outside the type's span blocks it", () => {
		const short = type({
			accepts: { datasets: ["air-quality"] },
			span: { maxDays: 7 }
		});
		expect(typeBlock(short, data(), CATALOG, NOW)).toBe("span");
	});
});
