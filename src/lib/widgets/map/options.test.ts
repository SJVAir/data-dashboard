import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import {
	MapOptionsSchema,
	mapOptions,
	drawableShowing,
	pollutantLayers,
	showingOf
} from "./options";

const FRESNO = { kind: "region", type: "city", code: "fresno" } as never;
const entry = (id: string) => ({ id, kind: "pollutant" });
const CATALOG = [
	{ id: "air-quality", entryTypes: [entry("pm25"), entry("pm10"), entry("o3")] }
] as unknown as CatalogEntry[];
const twoLayers = (a: string, b: string): WidgetDataConfig => ({
	layers: [
		{ dataset: "air-quality", entryType: a, place: FRESNO },
		{ dataset: "air-quality", entryType: b }
	]
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe("Map options", () => {
	it("reads a spec 1 tile (no options) as nothing marked, showing its one pollutant", () => {
		expect(mapOptions({})).toEqual({});
		expect(
			showingOf(
				{ layers: [{ dataset: "air-quality", entryType: "o3", place: FRESNO }] },
				{},
				CATALOG
			)
		).toBe("o3");
	});

	it("reads invalid options as none", () => {
		expect(mapOptions({ options: { marks: "x" } })).toEqual({});
		expect(mapOptions({ options: { showing: "pm10", marks: ["a"] } })).toEqual({
			showing: "pm10",
			marks: ["a"]
		});
	});

	it("shows the saved pollutant when a layer has it", () => {
		expect(showingOf(twoLayers("pm25", "o3"), { showing: "o3" }, CATALOG)).toBe("o3");
	});

	it("falls back to the first pollutant when the one showing was removed", () => {
		expect(showingOf(twoLayers("pm25", "o3"), { showing: "pm10" }, CATALOG)).toBe("pm25");
	});

	it("lists only the air-quality layers", () => {
		const data: WidgetDataConfig = {
			layers: [{ dataset: "weather", entryType: "temp" }, ...twoLayers("pm25", "o3").layers]
		};
		expect(pollutantLayers(data, CATALOG).map((l) => l.entryType)).toEqual(["pm25", "o3"]);
	});

	it("keeps a layer whose kind the catalog doesn't know, and drops a non-pollutant kind", () => {
		const catalog = [
			{
				id: "air-quality",
				entryTypes: [entry("pm25"), { id: "temp", kind: "weather" }]
			}
		] as unknown as CatalogEntry[];
		const data: WidgetDataConfig = {
			layers: [
				{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
				{ dataset: "air-quality", entryType: "mystery" },
				{ dataset: "air-quality", entryType: "temp" }
			]
		};
		expect(pollutantLayers(data, catalog).map((l) => l.entryType)).toEqual(["pm25", "mystery"]);
	});

	it("rejects 26 marks, duplicate marks, and unsafe ids", () => {
		expect(MapOptionsSchema.safeParse({ marks: ids(25) }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ marks: ids(26) }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ marks: ["a", "a"] }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ marks: ["a b"] }).success).toBe(false);
	});
});

describe("drawableShowing", () => {
	const three: WidgetDataConfig = {
		layers: [
			{ dataset: "air-quality", entryType: "pm25", place: FRESNO },
			{ dataset: "air-quality", entryType: "pm10" },
			{ dataset: "air-quality", entryType: "o3" }
		]
	};

	it("is the saved pollutant when the server draws it", () => {
		expect(drawableShowing(three, { showing: "o3" }, CATALOG, ["pm25", "o3"])).toBe("o3");
	});

	it("falls back to the first drawable layer, in layer order", () => {
		expect(drawableShowing(three, { showing: "pm25" }, CATALOG, ["o3", "pm10"])).toBe("pm10");
		expect(drawableShowing(three, {}, CATALOG, ["o3"])).toBe("o3");
	});

	it("is the saved showing when none is drawable, so the tile reads unavailable", () => {
		expect(drawableShowing(three, { showing: "o3" }, CATALOG, ["no2"])).toBe("o3");
	});

	it("is the plain showing while the drawable list isn't known", () => {
		expect(drawableShowing(three, { showing: "o3" }, CATALOG, undefined)).toBe("o3");
	});

	it("accepts the toolbar fields and rejects bad hiddenTypes or unknown keys", () => {
		expect(
			MapOptionsSchema.safeParse({
				basemap: "satellite",
				clustered: false,
				fireAndSmoke: true,
				inactive: true,
				inside: true,
				hiddenTypes: ["purpleair"]
			}).success
		).toBe(true);
		expect(MapOptionsSchema.safeParse({ hiddenTypes: ["a", "a"] }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ hiddenTypes: ids(33) }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ hiddenTypes: ids(32) }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ nope: 1 }).success).toBe(false);
	});
});
