import { describe, expect, it, vi } from "vitest";
import { fakeAdapter, fakeNumberAdapter } from "$lib/widgets/shared/test-harness/fake-data";
import { chartWidget } from "$lib/widgets/shared/test-harness/fake-data";
import type { AdapterRequest, DatasetAdapter } from "./adapters/registry";
import { CSV_COLUMNS, downloadDataCsv, downloadWidgetCsv, toCsv } from "./csv";
import { mapDatasetCatalog, type CatalogEntry, type Level, type MetadataSource } from "./metadata";
import { createQueryClient, type QueryClient } from "./query/client";
import { PESTICIDE_USE_DATASET } from "./testing/dataset-catalog";
import { FIXTURE_CATALOG, fixtureMetadata } from "./testing/fixtures";
import type { PlaceInfo, QueryData, SeriesPoint } from "./types";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

const reported = vi.hoisted(() => vi.fn());
vi.mock("$lib/safety/report", () => ({ report: reported }));

const META = { entryType: "pm25", entryLabel: "PM2.5", unit: "µg/m³" };
const HOUR = 3_600_000;

function point(t: string, extra: Partial<SeriesPoint> = {}): SeriesPoint {
	return { t: Date.parse(t), mean: 8.5, min: 2, max: 20, count: 24, partial: false, ...extra };
}

function data(parts: Partial<QueryData> & Pick<QueryData, "series" | "places">): QueryData {
	return { resolution: "day", fromRaw: false, processor: null, fetchedAt: 0, ...parts };
}

/** Parses simple CSV text (quotes allowed) into rows. */
function parse(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(cell);
			cell = "";
		} else if (c === "\r") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			i++;
		} else cell += c;
	}
	return rows;
}

const region = (points: SeriesPoint[], name = "Fresno County") =>
	data({
		series: [{ place: "region:county:06019", points }],
		places: [{ place: "region:county:06019", name }]
	});

describe("toCsv", () => {
	it("starts with the header and uses CRLF line ends", () => {
		const text = toCsv(region([point("2026-11-01T07:00:00Z")]), META);
		expect(text.split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
		expect(text.endsWith("\r\n")).toBe(true);
		expect(text).not.toMatch(/(?<!\r)\n/);
	});

	it("writes a daily region row with Pacific offsets across the end of daylight time", () => {
		const [, row] = parse(toCsv(region([point("2026-11-01T07:00:00Z")]), META));
		const get = (c: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(c)];
		expect(get("period_start")).toBe("2026-11-01T00:00:00-07:00");
		expect(get("period_end")).toBe("2026-11-02T00:00:00-08:00");
		expect(get("place_kind")).toBe("region");
		expect(get("place_id")).toBe("county:06019");
		expect(get("place_name")).toBe("Fresno County");
		expect(get("entry_type")).toBe("pm25");
		expect(get("entry_type_label")).toBe("PM2.5");
		expect(get("unit")).toBe("µg/m³");
		expect(get("mean")).toBe("8.5");
		expect(get("count")).toBe("24");
		expect(get("resolution")).toBe("day");
		expect(get("partial")).toBe("false");
		expect(get("computed_from_raw")).toBe("false");
		expect(get("worst_hour_mean")).toBe("");
		expect(get("worst_hour_start")).toBe("");
	});

	it("fills the worst-hour columns when a point carries them", () => {
		const t = Date.parse("2026-10-25T07:00:00Z");
		const one = data({
			series: [
				{
					place: "monitor:m1",
					points: [point("2026-10-25T07:00:00Z", { worstHour: { t: t + 15 * HOUR, value: 31.25 } })]
				}
			],
			places: [{ place: "monitor:m1", name: "Monitor 1" }]
		});
		const [, row] = parse(toCsv(one, META));
		expect(row[CSV_COLUMNS.indexOf("place_kind")]).toBe("monitor");
		expect(row[CSV_COLUMNS.indexOf("place_id")]).toBe("m1");
		expect(row[CSV_COLUMNS.indexOf("worst_hour_mean")]).toBe("31.25");
		expect(row[CSV_COLUMNS.indexOf("worst_hour_start")]).toBe("2026-10-25T15:00:00-07:00");
		const two = data({
			series: [
				{ place: "monitor:m1", points: [point("2026-10-25T07:00:00Z")] },
				{ place: "monitor:m2", points: [point("2026-10-25T07:00:00Z")] }
			],
			places: [
				{ place: "monitor:m1", name: "Monitor 1" },
				{ place: "monitor:m2", name: "Monitor 2" }
			]
		});
		for (const r of parse(toCsv(two, META)).slice(1)) {
			expect(r[CSV_COLUMNS.indexOf("worst_hour_mean")]).toBe("");
			expect(r[CSV_COLUMNS.indexOf("worst_hour_start")]).toBe("");
		}
	});

	it("quotes a name with a comma or quote", () => {
		const text = toCsv(region([point("2026-11-01T07:00:00Z")], 'Clovis, "East"'), META);
		expect(text).toContain('"Clovis, ""East"""');
		expect(parse(text)[1][CSV_COLUMNS.indexOf("place_name")]).toBe('Clovis, "East"');
	});

	it("marks a partial period true and computed-from-raw true", () => {
		const d = region([point("2026-11-04T08:00:00Z", { partial: true })]);
		const [, row] = parse(toCsv({ ...d, fromRaw: true }, META));
		expect(row[CSV_COLUMNS.indexOf("partial")]).toBe("true");
		expect(row[CSV_COLUMNS.indexOf("computed_from_raw")]).toBe("true");
	});

	it("writes monthly periods to the next month and raw periods as instants", () => {
		const month = parse(
			toCsv({ ...region([point("2026-10-01T07:00:00Z")]), resolution: "month" }, META)
		);
		expect(month[1][0]).toBe("2026-10-01T00:00:00-07:00");
		expect(month[1][1]).toBe("2026-11-01T00:00:00-07:00");
		const raw = parse(
			toCsv({ ...region([point("2026-10-01T07:00:00Z")]), resolution: "raw" }, META)
		);
		expect(raw[1][1]).toBe(raw[1][0]);
	});

	it("writes plain numbers", () => {
		const d = region([point("2026-11-01T07:00:00Z", { mean: 12345.678, min: 0.5, max: 1e21 })]);
		const [, row] = parse(toCsv(d, META));
		expect(row[CSV_COLUMNS.indexOf("mean")]).toBe("12345.678");
		expect(row[CSV_COLUMNS.indexOf("min")]).toBe("0.5");
		expect(row[CSV_COLUMNS.indexOf("max")]).toBe("1000000000000000000000");
	});

	it("puts places the request doesn't list last, in a stable order", () => {
		const text = toCsv(
			data({
				series: [
					{ place: "monitor:x", points: [point("2026-11-01T07:00:00Z")] },
					{ place: "monitor:y", points: [point("2026-11-01T07:00:00Z")] },
					{ place: "monitor:a", points: [point("2026-11-01T07:00:00Z")] }
				],
				places: [{ place: "monitor:a", name: "A" }]
			}),
			META
		);
		expect(
			parse(text)
				.slice(1)
				.map((r) => r[3])
		).toEqual(["a", "x", "y"]);
	});

	it("orders rows by place (request order) then time", () => {
		const d = data({
			series: [
				{
					place: "monitor:b",
					points: [point("2026-11-02T07:00:00Z"), point("2026-11-01T07:00:00Z")]
				},
				{ place: "monitor:a", points: [point("2026-11-01T07:00:00Z")] }
			],
			places: [
				{ place: "monitor:a", name: "A" },
				{ place: "monitor:b", name: "B" }
			]
		});
		const rows = parse(toCsv(d, META)).slice(1);
		expect(rows.map((r) => r[CSV_COLUMNS.indexOf("place_name")])).toEqual(["A", "B", "B"]);
		expect(rows[1][0] < rows[2][0]).toBe(true);
	});
});

describe("toCsv place labels", () => {
	const build = (via: PlaceInfo["via"]) =>
		data({
			series: [{ place: "region:zipcode:93721", points: [point("2026-10-25T07:00:00Z")] }],
			places: [{ place: "region:zipcode:93721", name: "ZIP 93721", via }]
		});
	const nameOf = (csv: string) => parse(csv)[1][CSV_COLUMNS.indexOf("place_name")];

	it("uses the same label as the title", () => {
		expect(nameOf(toCsv(build({ kind: "point" }), META))).toBe("ZIP 93721 (your location)");
		expect(nameOf(toCsv(build({ kind: "point" }), META, "shared"))).toBe(
			"ZIP 93721 (shared location)"
		);
		expect(
			nameOf(
				toCsv(
					build({
						kind: "location",
						source: "cde-public",
						code: "1",
						name: "Roosevelt High School"
					}),
					META
				)
			)
		).toBe("ZIP 93721 (Roosevelt High School)");
		expect(nameOf(toCsv(build(undefined), META))).toBe("ZIP 93721");
	});
});

describe("downloadWidgetCsv for a point", () => {
	it("never carries the point's coordinates", async () => {
		const requests: AdapterRequest[] = [];
		const base = fakeAdapter(requests);
		const adapter: DatasetAdapter = {
			...base,
			async target(layer) {
				if (layer.place?.kind === "point") {
					return { kind: "fallback", via: { kind: "point" }, keys: ["zipcode:93721"] };
				}
				return base.target(layer, undefined as never);
			},
			async fetch() {
				return {
					series: [{ place: "region:zipcode:93721", points: [point("2026-10-25T07:00:00Z")] }],
					places: [{ place: "region:zipcode:93721", name: "ZIP 93721", via: { kind: "point" } }],
					resolution: "day",
					fromRaw: false,
					processor: null,
					fetchedAt: Date.parse("2026-10-26T00:00:00Z")
				};
			}
		};
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.layers[0] = {
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "point", lat: 36.7468, lon: -119.7726 }
		};
		const saved: Array<{ name: string; contents: string }> = [];
		await downloadWidgetCsv(widget, (name, contents) => {
			saved.push({ name, contents });
		});
		expect(saved).toHaveLength(1);
		const { name, contents } = saved[0];
		for (const text of [contents, name]) {
			expect(text).not.toMatch(/36\.7468|119\.7726|36\.747|119\.773/);
		}
		expect(parse(contents)[1][CSV_COLUMNS.indexOf("place_name")]).toBe("ZIP 93721 (your location)");
	});
});

const NAN = Number.NaN;
const BURN: Level[] = [
	{
		key: "burn-day",
		label: "Burn day",
		color: null,
		opacity: null,
		tier: null,
		guidance: "",
		description: "",
		min: 0,
		max: null
	}
];
const OVERLAY_META = { entryType: "burn-status", entryLabel: "Burn status", unit: "" };

function burnPoint(t: string, level: string): SeriesPoint {
	return { t: Date.parse(t), mean: NAN, min: NAN, max: NAN, count: NAN, partial: false, level };
}

describe("toCsv overlay rows", () => {
	const main = data({
		series: [
			{ place: "monitor:a", points: [point("2026-11-01T07:00:00Z")] },
			{ place: "monitor:b", points: [point("2026-11-01T07:00:00Z")] }
		],
		places: [
			{ place: "monitor:a", name: "A" },
			{ place: "monitor:b", name: "B" }
		]
	});
	// Overlay places are regions, paired to the main places by request index.
	const overlay = {
		meta: OVERLAY_META,
		levels: BURN,
		data: data({
			series: [
				{ place: "region:county:1", points: [burnPoint("2026-11-01T07:00:00Z", "burn-day")] },
				{ place: "region:county:2", points: [burnPoint("2026-11-01T07:00:00Z", "burn-day")] }
			],
			places: [
				{ place: "region:county:1", name: "One" },
				{ place: "region:county:2", name: "Two" }
			]
		})
	};
	const get = (row: string[], c: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(c)];

	it("each row describes its own figure: an overlay read with none leaves the cells blank", () => {
		const withFigure = data({
			...main,
			series: main.series.map((x) => ({
				...x,
				points: x.points.map((p) => ({ ...p, figure: 9.5, final: true }))
			}))
		});
		const rows = parse(
			toCsv(withFigure, { ...META, figureLabel: "24-hour average" }, "owner", [overlay])
		);
		for (const row of rows) expect(row).toHaveLength(CSV_COLUMNS.length);
		const [, first] = rows;
		expect([get(first, "figure"), get(first, "figure_label"), get(first, "rated")]).toEqual([
			"9.5",
			"24-hour average",
			"Yes"
		]);
		const o = rows.at(-1)!;
		expect([get(o, "figure"), get(o, "figure_label"), get(o, "rated")]).toEqual(["", "", ""]);
	});

	it("an overlay read with its own figure carries its own label", () => {
		const o3 = {
			meta: {
				entryType: "o3",
				entryLabel: "Ozone",
				unit: "ppb",
				figureLabel: "Highest 1-hour average"
			},
			levels: [],
			data: data({
				series: [
					{
						place: "monitor:a",
						points: [point("2026-11-01T07:00:00Z", { figure: 41, final: true })]
					}
				],
				places: [{ place: "monitor:a", name: "A" }]
			})
		};
		const rows = parse(toCsv(main, META, "owner", [o3])).slice(1);
		const row = rows.find((r) => get(r, "entry_type") === "o3")!;
		expect([get(row, "figure"), get(row, "figure_label"), get(row, "rated")]).toEqual([
			"41",
			"Highest 1-hour average",
			"Yes"
		]);
	});

	it("overlay rows carry level_key and level_label", () => {
		const rows = parse(toCsv(main, META, "owner", [overlay])).slice(1);
		expect(get(rows[0], "level_key")).toBe("");
		expect(get(rows[0], "level_label")).toBe("");
		const o = rows[2];
		expect(get(o, "entry_type")).toBe("burn-status");
		expect(get(o, "level_key")).toBe("burn-day");
		expect(get(o, "level_label")).toBe("Burn day");
		for (const c of ["mean", "min", "max", "count"] as const) expect(get(o, c)).toBe("");
		expect(text(rows)).not.toContain("NaN");
	});

	it("every place's overlay rows are exported", () => {
		const rows = parse(toCsv(main, META, "owner", [overlay])).slice(1);
		const mine = rows.filter((r) => get(r, "entry_type") === "burn-status");
		expect(mine.map((r) => get(r, "place_id"))).toEqual(["a", "b"]);
		expect(mine.map((r) => get(r, "place_name"))).toEqual(["A", "B"]);
	});

	it("a point's overlay rows are named as its region for a shared viewer", () => {
		const zip = {
			place: "region:zipcode:93721",
			name: "ZIP 93721",
			via: { kind: "point" as const }
		};
		const pointMain = data({
			series: [{ place: zip.place, points: [point("2026-11-01T07:00:00Z")] }],
			places: [zip]
		});
		const pointOverlay = {
			...overlay,
			data: data({
				series: [
					{ place: "region:county:06019", points: [burnPoint("2026-11-01T07:00:00Z", "burn-day")] }
				],
				places: [{ place: "region:county:06019", name: "Fresno County", via: { kind: "point" } }]
			})
		};
		const rows = parse(toCsv(pointMain, META, "shared", [pointOverlay])).slice(1);
		const overlayRows = rows.filter((r) => get(r, "entry_type") === "burn-status");
		expect(overlayRows).toHaveLength(1);
		expect(get(overlayRows[0], "place_name")).toBe("ZIP 93721 (shared location)");
		expect(get(overlayRows[0], "place_id")).toBe("zipcode:93721");
		expect(text(rows)).not.toContain("your location");
	});

	function text(rows: string[][]): string {
		return rows.flat().join(",");
	}
});

describe("downloadDataCsv", () => {
	const catalog: CatalogEntry[] = [
		...FIXTURE_CATALOG,
		{
			id: "forecasts",
			label: "Forecasts",
			geographies: ["region"],
			entryTypes: [
				{
					id: "burn-status",
					label: "Burn status",
					units: "",
					kind: "other",
					resolutions: ["day"],
					precision: null,
					yMin: null,
					chart: null,
					aggregate: null,
					available: true
				}
			]
		}
	];
	const config = {
		dateRange: { kind: "trailing", amount: 30, unit: "day" },
		layers: [
			{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m1" } },
			{ dataset: "forecasts", entryType: "burn-status" }
		]
	} as const;

	function setup(forecast: DatasetAdapter["fetch"]) {
		const base = fakeAdapter([]);
		const forecasts: DatasetAdapter = {
			id: "forecasts",
			async target() {
				return { kind: "regions", keys: ["county:06019"] } as never;
			},
			offered: (b) => b,
			fetch: forecast
		};
		fake.metadata = fixtureMetadata({
			catalog: async () => catalog,
			datasetLevels: async (dataset) => (dataset === "forecasts" ? BURN : [])
		});
		fake.client = createQueryClient({
			adapters: [base, forecasts],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
	}

	it("exports the overlay's rows after the main rows", async () => {
		setup(async () => ({
			series: [
				{ place: "region:county:06019", points: [burnPoint("2026-10-25T07:00:00Z", "burn-day")] }
			],
			places: [{ place: "region:county:06019", name: "Fresno County" }],
			resolution: "day",
			fromRaw: false,
			processor: null,
			fetchedAt: Date.now()
		}));
		const saved: string[] = [];
		await downloadDataCsv(structuredClone(config) as never, (_n, c) => void saved.push(c));
		const rows = parse(saved[0]).slice(1);
		const types = rows.map((r) => r[CSV_COLUMNS.indexOf("entry_type")]);
		expect(types).toContain("burn-status");
		expect(types.indexOf("pm25")).toBeLessThan(types.indexOf("burn-status"));
		expect(saved[0]).not.toContain("NaN");
	});

	it("reports a failed overlay and names it in skipped", async () => {
		reported.mockClear();
		setup(async () => {
			throw new Error("down");
		});
		const result = await downloadDataCsv(structuredClone(config) as never, () => {});
		expect(result.skipped).toEqual(["Burn status"]);
		expect(reported).toHaveBeenCalledTimes(1);
	});

	it("names an unavailable overlay in skipped", async () => {
		reported.mockClear();
		setup(async () => {
			throw new Error("unused");
		});
		fake.client = createQueryClient({
			adapters: [
				fakeAdapter([]),
				{
					id: "forecasts",
					target: async () => ({ unavailable: "place-unsupported" }),
					offered: (b) => b,
					fetch: async () => {
						throw new Error("unused");
					}
				}
			],
			metadata: fake.metadata!,
			regions: { resolve: async () => "unsupported" }
		});
		const result = await downloadDataCsv(structuredClone(config) as never, () => {});
		expect(result.skipped).toEqual(["Burn status"]);
	});

	it("does not call a ready but empty overlay skipped", async () => {
		reported.mockClear();
		setup(async () => ({
			series: [],
			places: [],
			resolution: "day",
			fromRaw: false,
			processor: null,
			fetchedAt: Date.now()
		}));
		const result = await downloadDataCsv(structuredClone(config) as never, () => {});
		expect(result.skipped).toEqual([]);
		expect(reported).not.toHaveBeenCalled();
	});

	it("still exports the main rows when an overlay fails", async () => {
		setup(async () => {
			throw new Error("down");
		});
		const saved: string[] = [];
		await downloadDataCsv(structuredClone(config) as never, (_n, c) => void saved.push(c));
		const types = new Set(
			parse(saved[0])
				.slice(1)
				.map((r) => r[CSV_COLUMNS.indexOf("entry_type")])
		);
		expect([...types]).toEqual(["pm25"]);
	});

	it("a point place exports as its region for shares", async () => {
		const base = fakeAdapter([]);
		const adapter: DatasetAdapter = {
			...base,
			async target() {
				return { kind: "fallback", via: { kind: "point" }, keys: ["zipcode:93721"] };
			},
			async fetch() {
				return {
					series: [{ place: "region:zipcode:93721", points: [point("2026-10-25T07:00:00Z")] }],
					places: [{ place: "region:zipcode:93721", name: "ZIP 93721", via: { kind: "point" } }],
					resolution: "day",
					fromRaw: false,
					processor: null,
					fetchedAt: Date.parse("2026-10-26T00:00:00Z")
				};
			}
		};
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const saved: Array<{ name: string; contents: string }> = [];
		await downloadDataCsv(
			{
				dateRange: { kind: "trailing", amount: 30, unit: "day" },
				layers: [
					{
						dataset: "air-quality",
						entryType: "pm25",
						place: { kind: "point", lat: 36.7468, lon: -119.7726 }
					}
				]
			},
			(name, contents) => void saved.push({ name, contents }),
			"shared"
		);
		const { name, contents } = saved[0];
		for (const t of [contents, name]) expect(t).not.toMatch(/36\.7468|119\.7726/);
		expect(parse(contents)[1][CSV_COLUMNS.indexOf("place_name")]).toBe(
			"ZIP 93721 (shared location)"
		);
	});
});

describe("toCsv for weather and pesticide layers", () => {
	const get = (row: string[], c: (typeof CSV_COLUMNS)[number]) => row[CSV_COLUMNS.indexOf(c)];
	const main = data({
		series: [{ place: "monitor:a", points: [point("2026-11-01T07:00:00Z")] }],
		places: [{ place: "monitor:a", name: "A" }]
	});
	const layer = (
		entryType: string,
		unit: string,
		place: Partial<PlaceInfo>,
		resolution: QueryData["resolution"] = "day",
		aggregate: "sum" | "mean" | null = "sum"
	) => ({
		meta: { entryType, entryLabel: entryType, unit, aggregate },
		levels: [],
		data: data({
			resolution,
			series: [{ place: "monitor:a", points: [point("2026-11-01T07:00:00Z", { mean: 0.4 })] }],
			places: [{ place: "monitor:a", name: "A", ...place }]
		})
	});

	it("the existing columns keep their order", () => {
		expect(toCsv(main, META).split("\r\n")[0]).toBe(
			"period_start,period_end,place_kind,place_id,place_name,entry_type,entry_type_label,unit," +
				"mean,min,max,worst_hour_mean,worst_hour_start,count,resolution,partial," +
				"computed_from_raw,level_key,level_label,source_id,source_name,filters,aggregate," +
				"figure,figure_label,rated"
		);
	});

	it("weather rows carry the station", () => {
		const weather = layer("precipitation", "in", {
			source: { id: "80", name: "Fresno State, CIMIS #80", distance: 4.2, inside: false }
		});
		const rows = parse(toCsv(main, META, "owner", [weather])).slice(1);
		expect(get(rows[0], "source_id")).toBe("");
		expect(get(rows[1], "entry_type")).toBe("precipitation");
		expect(get(rows[1], "source_id")).toBe("80");
		expect(get(rows[1], "source_name")).toBe("Fresno State, CIMIS #80");
		expect(get(rows[1], "mean")).toBe("0.4");
		expect(get(rows[1], "filters")).toBe("");
	});

	it("pesticide rows carry their filters", () => {
		const use = layer("pounds-applied", "lbs", { filters: ["Chlorpyrifos", "Grapes"] }, "month");
		const rows = parse(toCsv(main, META, "owner", [use])).slice(1);
		expect(get(rows[1], "filters")).toBe("Chlorpyrifos; Grapes");
		expect(get(rows[1], "resolution")).toBe("month");
		// A coarser overlay keeps its own period.
		expect(get(rows[1], "period_end")).toBe("2026-12-01T00:00:00-08:00");
		expect(get(rows[1], "source_id")).toBe("");
	});

	it("each row says whether its value is a total, an average, or neither", () => {
		const rain = layer("precipitation", "in", {});
		const temp = layer("air-temperature", "°F", {}, "day", "mean");
		const wind = layer("wind-direction", "°", {}, "day", null);
		const csv = toCsv(main, { ...META, aggregate: "mean" }, "owner", [rain, temp, wind]);
		const rows = parse(csv).slice(1);
		expect(rows.map((r) => get(r, "aggregate"))).toEqual(["mean", "sum", "mean", ""]);
		// Appended after the earlier columns; only the figure's three follow it.
		expect(CSV_COLUMNS.at(-4)).toBe("aggregate");
	});
});

describe("downloadDataCsv for a pesticide-only widget", () => {
	it("a pesticide-only CSV has no pollutant rows", async () => {
		const catalog = mapDatasetCatalog({
			datasets: [PESTICIDE_USE_DATASET]
		} as Parameters<typeof mapDatasetCatalog>[0]).map((d) => ({ ...d, geographies: ["monitor"] }));
		fake.metadata = fixtureMetadata({ catalog: async () => [...FIXTURE_CATALOG, ...catalog] });
		fake.client = createQueryClient({
			adapters: [
				fakeAdapter([]),
				fakeNumberAdapter("pesticide-use", [], {
					offered: ["month", "year"],
					values: [1200, 340],
					filters: ["Grapes"]
				})
			],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const saved: string[] = [];
		await downloadDataCsv(
			{
				dateRange: { kind: "trailing", amount: 90, unit: "day" },
				layers: [
					{
						dataset: "pesticide-use",
						entryType: "pounds-applied",
						place: { kind: "monitor", id: "m1" }
					}
				]
			},
			(_n, c) => void saved.push(c)
		);
		const rows = parse(saved[0]).slice(1);
		expect(rows.length).toBeGreaterThan(0);
		const types = new Set(rows.map((r) => r[CSV_COLUMNS.indexOf("entry_type")]));
		expect([...types]).toEqual(["pounds-applied"]);
		expect(rows[0][CSV_COLUMNS.indexOf("filters")]).toBe("Grapes");
	});
});

describe("a calendar's CSV", () => {
	const days = (extra: Partial<SeriesPoint>[]) =>
		data({
			series: [
				{
					place: "monitor:m1",
					points: extra.map((e, i) => point(`2026-10-2${i + 5}T07:00:00Z`, e))
				}
			],
			places: [{ place: "monitor:m1", name: "Monitor 1" }]
		});

	const tail = (r: string[]) => r.slice(-3);

	it("ends with figure, figure_label and rated, in machine names", () => {
		expect(CSV_COLUMNS.slice(-4)).toEqual(["aggregate", "figure", "figure_label", "rated"]);
	});

	it("writes each day's figure, its label and whether it was rated (a null figure blank)", () => {
		const d = days([
			{ figure: 31.9, final: true },
			{ figure: null, final: true },
			{ figure: 19.9, final: false }
		]);
		const rows = parse(toCsv(d, { ...META, figureLabel: "24-hour average" }));
		expect(rows[0]).toEqual([...CSV_COLUMNS]);
		expect(rows.slice(1).map(tail)).toEqual([
			["31.9", "24-hour average", "Yes"],
			["", "24-hour average", "Not enough data"],
			["19.9", "24-hour average", "Not final yet"]
		]);
	});

	it("leaves the cells blank on rows read as the plain mean", () => {
		const rows = parse(toCsv(days([{}]), META));
		expect(rows[0]).toEqual([...CSV_COLUMNS]);
		expect(tail(rows[1])).toEqual(["", "", ""]);
	});

	it("downloads with the calendar's own query and the server's label", async () => {
		const requests: AdapterRequest[] = [];
		const base = fakeAdapter(requests);
		const adapter: DatasetAdapter = {
			...base,
			async fetch() {
				return {
					...days([{ figure: 12.5, final: true }]),
					fetchedAt: Date.parse("2026-10-26T00:00:00Z")
				};
			}
		};
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.layers[0] = {
			dataset: "air-quality",
			entryType: "o3",
			place: { kind: "monitor", id: "m1" }
		};
		const seen: unknown[] = [];
		const spy = vi.spyOn(fake.client, "subscribe");
		const saved: string[] = [];
		await downloadWidgetCsv({ ...widget, type: "calendar-month" }, (_n, contents) => {
			saved.push(contents);
		});
		seen.push(spy.mock.calls[0][0]);
		expect(seen[0]).toMatchObject({ resolution: "day", figure: "max_1h" });
		const rows = parse(saved[0]);
		expect(rows[0]).toEqual([...CSV_COLUMNS]);
		expect(rows[1].slice(-3)).toEqual(["12.5", "Highest 1-hour average", "Yes"]);
	});

	async function download(figure: MetadataSource["figure"]): Promise<string[][]> {
		const adapter: DatasetAdapter = {
			...fakeAdapter([]),
			async fetch(req) {
				return { ...days([req.figure ? { figure: 12.5, final: true } : {}]), fetchedAt: 0 };
			}
		};
		fake.metadata = fixtureMetadata({ figure });
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.layers[0] = {
			dataset: "air-quality",
			entryType: "o3",
			place: { kind: "monitor", id: "m1" }
		};
		let out = "";
		await downloadWidgetCsv({ ...widget, type: "calendar-month" }, (_n, contents) => {
			out = contents;
		});
		return parse(out);
	}

	it("fails the download when the figure lookup fails, never writing rows without it", async () => {
		await expect(
			download(async () => {
				throw new Error("down");
			})
		).rejects.toThrow("down");
	});

	it("leaves the label blank when the entry type has no daily figure", async () => {
		const rows = await download(async () => null);
		expect(rows[0]).toEqual([...CSV_COLUMNS]);
		expect(rows[1].slice(-3)).toEqual(["", "", ""]);
	});

	it("a Chart's monthly CSV carries the figure, its column named by period_statistic_label", async () => {
		const requests: AdapterRequest[] = [];
		const months = data({
			series: [
				{
					place: "monitor:m1",
					points: [
						point("2026-01-01T08:00:00Z", { figure: 13.2, final: true }),
						point("2026-02-01T08:00:00Z", { figure: null, final: true })
					]
				}
			],
			places: [{ place: "monitor:m1", name: "Monitor 1" }],
			resolution: "month"
		});
		const adapter: DatasetAdapter = {
			...fakeAdapter(requests),
			async fetch(req) {
				requests.push(req);
				return { ...months, fetchedAt: Date.parse("2026-07-01T00:00:00Z") };
			}
		};
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.dateRange = { kind: "custom", start: "2026-01-01", end: "2026-06-30" };
		widget.data.resolution = "month";
		let out = "";
		await downloadWidgetCsv(widget, (_n, contents) => {
			out = contents;
		});
		expect(requests[0]).toMatchObject({ resolution: "month", figure: "daily_statistic_mean" });
		const rows = parse(out);
		expect(rows[0]).toEqual([...CSV_COLUMNS]);
		expect(rows.slice(1).map((r) => r.slice(-3))).toEqual([
			["13.2", "Average of 24-hour averages", "Yes"],
			["", "Average of 24-hour averages", "Not enough data"]
		]);
	});

	it("names a monthly file by the widened dates it holds", async () => {
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [fakeAdapter([])],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.dateRange = { kind: "custom", start: "2026-01-15", end: "2026-03-10" };
		widget.data.resolution = "month";
		let name = "";
		await downloadWidgetCsv(widget, (n) => {
			name = n;
		});
		expect(name).toMatch(/-2026-01-01-to-2026-03-31\.csv$/);
	});

	it("a pollutant overlay is read with its own figure and label", async () => {
		const requests: AdapterRequest[] = [];
		const base = fakeAdapter(requests);
		const adapter: DatasetAdapter = {
			...base,
			async fetch(req, ctx, signal) {
				const got = await base.fetch(req, ctx, signal);
				return {
					...got,
					series: got.series.map((x) => ({
						...x,
						points: x.points.map((p) => ({ ...p, figure: req.figure ? 30 : undefined }))
					}))
				};
			}
		};
		fake.metadata = fixtureMetadata();
		fake.client = createQueryClient({
			adapters: [adapter],
			metadata: fake.metadata,
			regions: { resolve: async () => "unsupported" }
		});
		const widget = chartWidget(["m1"]);
		widget.data.layers.push({ dataset: "air-quality", entryType: "o3" });
		let out = "";
		await downloadWidgetCsv(widget, (_n, contents) => {
			out = contents;
		});
		expect(requests.map((r) => [r.entryType, r.figure])).toEqual([
			["pm25", "mean_24h"],
			["o3", "max_1h"]
		]);
		const rows = parse(out).slice(1);
		const label = (type: string) =>
			rows.find((r) => r[CSV_COLUMNS.indexOf("entry_type")] === type)!.slice(-2);
		expect(label("pm25")).toEqual(["24-hour average", "Yes"]);
		expect(label("o3")).toEqual(["Highest 1-hour average", "Yes"]);
	});

	it("quotes a figure label with a comma", () => {
		const text = toCsv(days([{ figure: 1, final: true }]), { ...META, figureLabel: "Max, 1-hour" });
		expect(parse(text)[1].slice(-2)).toEqual(["Max, 1-hour", "Yes"]);
		expect(text).toContain('"Max, 1-hour"');
	});
});
