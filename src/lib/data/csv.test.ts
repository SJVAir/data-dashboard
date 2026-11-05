import { describe, expect, it, vi } from "vitest";
import { fakeAdapter } from "$lib/widgets/shared/test-harness/fake-data";
import { chartWidget } from "$lib/widgets/shared/test-harness/fake-data";
import type { AdapterRequest, DatasetAdapter } from "./adapters/registry";
import { CSV_COLUMNS, downloadWidgetCsv, toCsv } from "./csv";
import type { MetadataSource } from "./metadata";
import { createQueryClient, type QueryClient } from "./query/client";
import { fixtureMetadata } from "./testing/fixtures";
import type { PlaceInfo, QueryData, SeriesPoint } from "./types";

const fake = vi.hoisted(() => ({
	client: undefined as QueryClient | undefined,
	metadata: undefined as MetadataSource | undefined
}));
vi.mock("$lib/data", () => ({
	getQueryClient: () => fake.client!,
	getMetadata: () => fake.metadata!
}));

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
		expect(nameOf(toCsv(build({ kind: "location", name: "Roosevelt High School" }), META))).toBe(
			"ZIP 93721 (Roosevelt High School)"
		);
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
