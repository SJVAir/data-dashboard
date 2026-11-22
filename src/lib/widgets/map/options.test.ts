import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import {
	MapOptionsSchema,
	mapOptions,
	pollutantLayer,
	useFigureOf,
	MAP_TOOLBAR_KEYS
} from "./options";

const FRESNO = { kind: "region", type: "city", code: "fresno" } as never;
const entry = (id: string) => ({ id, kind: "pollutant" });
const CATALOG = [
	{ id: "air-quality", entryTypes: [entry("pm25"), entry("pm10"), entry("o3")] }
] as unknown as CatalogEntry[];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe("Map options", () => {
	it("reads a spec 1 tile (no options) as nothing marked", () => {
		expect(mapOptions({})).toEqual({});
	});

	it("reads invalid options as none", () => {
		expect(mapOptions({ options: { marks: "x" } })).toEqual({});
		expect(mapOptions({ options: { marks: ["a"] } })).toEqual({ marks: ["a"] });
	});

	it("pollutantLayer is the air-quality layer, or none", () => {
		const data: WidgetDataConfig = {
			place: FRESNO,
			layers: [
				{ dataset: "weather", entryType: "temp" },
				{ dataset: "air-quality", entryType: "o3" }
			]
		};
		expect(pollutantLayer(data, CATALOG)).toEqual({ dataset: "air-quality", entryType: "o3" });
		expect(pollutantLayer({ place: FRESNO, layers: [] }, CATALOG)).toBeUndefined();
	});

	it("keeps a layer whose kind the catalog doesn't know, and drops a non-pollutant kind", () => {
		const catalog = [
			{
				id: "air-quality",
				entryTypes: [entry("pm25"), { id: "temp", kind: "weather" }]
			}
		] as unknown as CatalogEntry[];
		const data: WidgetDataConfig = {
			place: FRESNO,
			layers: [
				{ dataset: "air-quality", entryType: "pm25" },
				{ dataset: "air-quality", entryType: "mystery" },
				{ dataset: "air-quality", entryType: "temp" }
			]
		};
		expect(pollutantLayer(data, catalog)?.entryType).toBe("pm25");
		data.layers.shift();
		expect(pollutantLayer(data, catalog)?.entryType).toBe("mystery");
		data.layers.shift();
		expect(pollutantLayer(data, catalog)).toBeUndefined();
	});

	it("rejects 26 marks, duplicate marks, and unsafe ids", () => {
		expect(MapOptionsSchema.safeParse({ marks: ids(25) }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ marks: ids(26) }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ marks: ["a", "a"] }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ marks: ["a b"] }).success).toBe(false);
	});

	it("accepts a stop's at, a fill and fillShown false; rejects a bad at and fillShown true", () => {
		expect(
			MapOptionsSchema.safeParse({ at: "2026-11-14", fill: "city", fillShown: false }).success
		).toBe(true);
		expect(MapOptionsSchema.safeParse({ at: "2026-03-01" }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ at: "2026-1-14" }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ at: "yesterday" }).success).toBe(false);
		// The earlier `day` key is gone: a strict object refuses it.
		expect(MapOptionsSchema.safeParse({ day: "2026-11-14" }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ fill: "a b" }).success).toBe(false);
		expect(MapOptionsSchema.safeParse({ fillShown: true }).success).toBe(false);
	});
});

describe("toolbar options", () => {
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

describe("notices option", () => {
	it("noticesShown accepts only false", () => {
		expect(MapOptionsSchema.safeParse({ noticesShown: false }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ noticesShown: true }).success).toBe(false);
	});
});

describe("pesticide use options", () => {
	const USE_CATALOG = [
		{
			id: "pesticide-use",
			entryTypes: ["pounds-applied", "acres-treated", "applications", "other"].map((id) => ({ id }))
		}
	] as unknown as CatalogEntry[];
	it("there is no use period option: use follows the Map's stops", () => {
		expect(MapOptionsSchema.safeParse({ ["use" + "Period"]: "2023" }).success).toBe(false);
	});
	it("useShown accepts only false", () => {
		expect(MapOptionsSchema.safeParse({ useShown: false }).success).toBe(true);
		expect(MapOptionsSchema.safeParse({ useShown: true }).success).toBe(false);
	});
	it("useFigureOf falls back to the catalog's first and never writes", () => {
		const options = { useFigure: "nonsense" };
		expect(useFigureOf(options, USE_CATALOG)).toBe("pounds-applied");
		expect(options).toEqual({ useFigure: "nonsense" });
		expect(useFigureOf({ useFigure: "acres-treated" }, USE_CATALOG)).toBe("acres-treated");
		expect(useFigureOf({ useFigure: "other" }, USE_CATALOG)).toBe("pounds-applied");
		expect(useFigureOf({}, undefined)).toBeUndefined();
	});
	it("useFigureOf never takes an object prototype key for a figure", () => {
		const catalog = [
			{ id: "pesticide-use", entryTypes: ["toString", "acres-treated"].map((id) => ({ id })) }
		] as unknown as CatalogEntry[];
		expect(useFigureOf({ useFigure: "toString" }, catalog)).toBe("acres-treated");
		expect(useFigureOf({}, catalog)).toBe("acres-treated");
	});
	it("the toolbar keys include the figure and shown", () => {
		expect(MAP_TOOLBAR_KEYS).toContain("useFigure");
		expect(MAP_TOOLBAR_KEYS).toContain("useShown");
	});
	it("no source file names the removed use period option", () => {
		const name = "use" + "Period";
		const walk = (dir: string): string[] =>
			readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
				const p = join(dir, e.name);
				return e.isDirectory() ? walk(p) : [p];
			});
		const hits = walk(join(process.cwd(), "src")).filter((p) =>
			readFileSync(p, "utf8").includes(name)
		);
		expect(hits).toEqual([]);
	});
});
