import { describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { Draft } from "$lib/get-data/draft.svelte";
import {
	fromMapDraft,
	setMapPesticideFilters,
	setNotices,
	setSmokeAndFire,
	setUse
} from "$lib/get-data/map";
import type { AppContext } from "$lib/store/app.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { CHART_TYPE, chartType } from "$lib/widgets/chart";
import { DEFAULT_RANGE } from "$lib/widgets/defaults";
import { MAP_TYPE } from "$lib/widgets/map";
import { PESTICIDE_USE } from "$lib/widgets/map/options";
import { DATA_TABLE_TYPE, dataTableType } from "$lib/widgets/table";
import { hasPoints, pointSwaps } from "$lib/sharing/points";
import { navigate } from "../../../router";
import { setMapSend } from "./send-registry";
import {
	HandOffSchema,
	sendPlaces,
	showIn,
	showInDraft,
	showInTarget,
	type MapSend
} from "./show-in";

vi.mock("../../../router", () => ({ navigate: vi.fn(async () => {}) }));
vi.mock("$lib/data", async (original) => ({
	...(await original<typeof import("$lib/data")>()),
	getMetadata: () => ({
		catalog: async () => CATALOG,
		mapPollutants: async () => DRAWABLE
	})
}));

const FRESNO = { kind: "region", type: "city", code: "fresno" } as never;
const IDS = ["pm25", "pm10", "o3"];
const CATALOG = [
	{
		id: "air-quality",
		entryTypes: IDS.map((id) => ({
			id,
			kind: "pollutant",
			resolutions: ["raw", "hour", "day", "month", "year"]
		}))
	},
	{
		id: "pesticide-use",
		entryTypes: ["pounds-applied", "acres-treated", "applications"].map((id) => ({
			id,
			kind: "number",
			resolutions: ["month", "year"]
		}))
	}
] as unknown as CatalogEntry[];
const DRAWABLE = ["pm25", "o3"];
/** Mid-morning, Pacific, on 2026-11-15. */
const NOW = new Date("2026-11-15T18:00:00Z");
const monitors = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const send = (ids: string[], leftOut = 0): MapSend => ({ kind: "monitors", ids, leftOut });

/** A Map of `pollutants` (the first holding Fresno) over September 2026, with `options`. */
const mapDraft = (pollutants: string[], options?: Draft["options"]): Draft => {
	const data: WidgetDataConfig = {
		dateRange: { kind: "set", unit: "month", start: "2026-09-01" },
		layers: [
			{ dataset: "air-quality", entryType: pollutants[0], place: FRESNO },
			...pollutants.slice(1).map((entryType) => ({ dataset: "air-quality", entryType }))
		]
	};
	return { type: MAP_TYPE, data, ...(options ? { options } : {}) };
};

/** A Map with every overlay: smoke and fire, notices, use (filtered), a fill and marks. */
const fullMap = (): Draft => {
	const d = mapDraft(["pm25", "o3"], {
		showing: "o3",
		fill: "zipcode",
		marks: ["m1", "m2"],
		useFigure: "acres-treated"
	});
	setSmokeAndFire(d.data, true);
	setNotices(d.data, true);
	setUse(d, true);
	setMapPesticideFilters(d.data, { chemical: "c1", category: ["A"] });
	return d;
};

describe("showInDraft: monitors", () => {
	it("is fromMapDraft's Chart with the main layer's places swapped for the ids, in order", () => {
		const map = mapDraft(["pm25"]);
		const shown = fromMapDraft(map, chartType, CATALOG, "unavailable", DRAWABLE, NOW).draft;
		const h = showInDraft(map, send(["m3", "m1"]), chartType, CATALOG, DRAWABLE, NOW);
		const [main, ...rest] = shown.data.layers;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- swapped below
		const { place, ...bare } = main;
		expect(h.draft).toEqual({
			...shown,
			data: {
				...shown.data,
				layers: [{ ...bare, selection: { kind: "monitors", ids: ["m3", "m1"] } }, ...rest]
			}
		});
		expect(h.draft.type).toBe(CHART_TYPE);
	});

	it("one id gives a place, several a monitors selection", () => {
		const one = showInDraft(mapDraft(["pm25"]), send(["m7"]), chartType, CATALOG, DRAWABLE, NOW);
		expect(one.draft.data.layers[0].place).toEqual({ kind: "monitor", id: "m7" });
		expect(one.draft.data.layers[0].selection).toBeUndefined();
		const two = showInDraft(mapDraft(["pm25"]), send(["a", "b"]), chartType, CATALOG, [], NOW);
		expect(two.draft.data.layers[0].place).toBeUndefined();
		expect(two.draft.data.layers[0].selection).toEqual({ kind: "monitors", ids: ["a", "b"] });
	});

	it("is over the cap past 5 for a Chart and 10 for a Table, keeping every id", () => {
		const at = (n: number, type = chartType) =>
			showInDraft(mapDraft(["pm25"]), send(monitors(n)), type, CATALOG, DRAWABLE, NOW);
		expect(at(5).overCap).toBe(false);
		expect(at(6).overCap).toBe(true);
		expect(at(6).draft.data.layers[0].selection).toEqual({ kind: "monitors", ids: monitors(6) });
		expect(at(10, dataTableType).overCap).toBe(false);
		expect(at(11, dataTableType).overCap).toBe(true);
	});

	it("carries the left-out count and no skip", () => {
		const h = showInDraft(mapDraft(["pm25"]), send(["m1"], 3), chartType, CATALOG, [], NOW);
		expect(h.leftOut).toBe(3);
		expect(h.skip).toBeUndefined();
	});

	it("an Automatic Map gives no resolution; a Now Map gives the Chart's default range", () => {
		const auto = showInDraft(mapDraft(["pm25"]), send(["m1"]), chartType, CATALOG, [], NOW);
		expect(auto.draft.data.resolution).toBeUndefined();
		expect(auto.draft.data.dateRange).toEqual({ kind: "set", unit: "month", start: "2026-09-01" });
		const onNow = mapDraft(["pm25"]);
		delete onNow.data.dateRange;
		const now = showInDraft(onNow, send(["m1"]), dataTableType, CATALOG, [], NOW);
		expect(now.draft.data.dateRange).toEqual(DEFAULT_RANGE);
	});

	it("a Monthly Map gives a Monthly Chart and Table, as Show as does (fromMapDraft)", () => {
		const monthly = mapDraft(["pm25"]);
		monthly.data.resolution = "month";
		const shown = fromMapDraft(monthly, chartType, CATALOG, "unavailable", [], NOW).draft;
		const h = showInDraft(monthly, send(["m1"]), chartType, CATALOG, [], NOW);
		expect(h.draft.data.resolution).toEqual(shown.data.resolution);
		expect(h.draft.data.resolution).toBe("month");
		const table = showInDraft(monthly, send(["m1"]), dataTableType, CATALOG, [], NOW);
		expect(table.draft.data.resolution).toBe("month");
	});

	it("leaves out smoke and fire, notices, fill and marks; use reaches a Chart, not a Table", () => {
		const chart = showInDraft(fullMap(), send(["m1", "m2"]), chartType, CATALOG, DRAWABLE, NOW);
		expect(chart.draft.data.layers.map((l) => l.dataset)).toEqual(["air-quality", PESTICIDE_USE]);
		expect(chart.draft.data.layers[1]).toEqual({
			dataset: PESTICIDE_USE,
			entryType: "acres-treated",
			filters: { chemical: "c1", category: ["A"] }
		});
		expect(chart.draft.options).toBeUndefined();
		const table = showInDraft(fullMap(), send(["m1", "m2"]), dataTableType, CATALOG, DRAWABLE, NOW);
		expect(table.draft.data.layers.map((l) => l.dataset)).toEqual(["air-quality"]);
		expect(table.draft.options).toBeUndefined();
	});

	it("the pollutant is the passed draft's showing (a viewer's held one), as the Map draws it", () => {
		const saved = mapDraft(["pm25", "o3"]);
		const held = mapDraft(["pm25", "o3"], { showing: "o3" });
		const at = (d: Draft) =>
			showInDraft(d, send(["m1"]), chartType, CATALOG, DRAWABLE, NOW).draft.data.layers[0]
				.entryType;
		expect(at(saved)).toBe("pm25");
		expect(at(held)).toBe("o3");
		// A showing the Map can't draw falls back to the pollutant it draws.
		expect(at(mapDraft(["pm25", "pm10"], { showing: "pm10" }))).toBe("pm25");
	});

	it("carries the conversion's notes, less the marks and places ones", () => {
		const map = fullMap();
		const converted = fromMapDraft(map, chartType, CATALOG, "unavailable", DRAWABLE, NOW);
		expect(converted.dropped).toEqual(expect.arrayContaining(["marks", "fill"]));
		const h = showInDraft(map, send(monitors(6)), chartType, CATALOG, DRAWABLE, NOW);
		expect(h.notes?.dropped).toEqual(
			converted.dropped.filter((d) => d !== "marks" && d !== "places")
		);
		expect(h.notes?.dropped).toContain("fill");
		// A plain Map's conversion leaves nothing out.
		const plain = showInDraft(mapDraft(["pm25"]), send(["m1"]), chartType, CATALOG, [], NOW);
		expect(plain.notes).toEqual({ dropped: [] });
	});

	it("never changes the passed draft", () => {
		const map = fullMap();
		const before = structuredClone(map);
		showInDraft(map, send(["m1", "m2"]), chartType, CATALOG, DRAWABLE, NOW);
		expect(map).toEqual(before);
	});
});

describe("showInDraft: a section", () => {
	it("is a Chart of the figure drawn at the section, over the Map's range and resolution", () => {
		const map = fullMap();
		map.data.resolution = "month";
		const h = showInDraft(map, { kind: "section", code: "M15S20E07" }, chartType, CATALOG, [], NOW);
		expect(h).toEqual({
			draft: {
				type: CHART_TYPE,
				data: {
					dateRange: { kind: "set", unit: "month", start: "2026-09-01" },
					resolution: "month",
					layers: [
						{
							dataset: PESTICIDE_USE,
							entryType: "acres-treated",
							place: { kind: "region", type: "mtrs", code: "M15S20E07" },
							filters: { chemical: "c1", category: ["A"] }
						}
					]
				}
			},
			leftOut: 0,
			overCap: false
		});
	});

	it("an Automatic Map stays Automatic; no filters, none copied", () => {
		const map = mapDraft(["pm25"]);
		setUse(map, true);
		const h = showInDraft(map, { kind: "section", code: "X" }, chartType, CATALOG, [], NOW);
		expect(h.draft.data.resolution).toBeUndefined();
		expect(h.draft.data.layers[0]).toEqual({
			dataset: PESTICIDE_USE,
			entryType: "pounds-applied",
			place: { kind: "region", type: "mtrs", code: "X" }
		});
	});

	it("a Map with no range gives a Chart (whatever the type) over its default range, at Automatic", () => {
		const map = mapDraft(["pm25"]);
		delete map.data.dateRange;
		map.data.resolution = "year";
		const h = showInDraft(map, { kind: "section", code: "X" }, dataTableType, CATALOG, [], NOW);
		expect(h.draft.type).toBe(CHART_TYPE);
		expect(h.draft.data.dateRange).toEqual(DEFAULT_RANGE);
		expect(h.draft.data).not.toHaveProperty("resolution");
	});

	it("copies the filters, so editing the Chart leaves the Map's alone", () => {
		const map = fullMap();
		const h = showInDraft(map, { kind: "section", code: "X" }, chartType, CATALOG, [], NOW);
		h.draft.data.layers[0].filters!.category!.push("B");
		expect(map.data.layers.at(-1)!.filters).toEqual({ chemical: "c1", category: ["A"] });
	});
});

describe("showInDraft: the new widget type checklist", () => {
	const chartDoc = (draft: Draft) => ({
		id: "chart1",
		type: CHART_TYPE,
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 8 },
		data: draft.data
	});
	const docOf = (draft: Draft) =>
		({ id: "d", version: 1, title: "D", body: { widgets: [chartDoc(draft)] } }) as never;

	it("a Chart made from the monitors needs no point swap on share", async () => {
		const h = showInDraft(fullMap(), send(["m1", "m2"]), chartType, CATALOG, DRAWABLE, NOW);
		expect(hasPoints(docOf(h.draft))).toBe(false);
		expect(await pointSwaps(docOf(h.draft))).toEqual([]);
	});

	it("a Chart made from a section needs no point swap on share", async () => {
		const h = showInDraft(
			fullMap(),
			{ kind: "section", code: "M12S01E01" },
			chartType,
			CATALOG,
			DRAWABLE,
			NOW
		);
		expect(h.draft.data.layers[0].place).toEqual({
			kind: "region",
			type: "mtrs",
			code: "M12S01E01"
		});
		expect(hasPoints(docOf(h.draft))).toBe(false);
		expect(await pointSwaps(docOf(h.draft))).toEqual([]);
	});

	/**
	 * Each way a Map can frame its dates, with what the Data Portal then shows (a Map holding two
	 * pollutants, smoke and fire, notices, use and a fill, showing a drawable pollutant: no
	 * pollutant change, no cut, no selection).
	 */
	const framings: [string, (d: Draft) => void][] = [
		[
			"Daily",
			(d) => {
				d.data.dateRange = { kind: "set", unit: "week", start: "2026-09-06" };
				d.data.resolution = "day";
			}
		],
		[
			"Monthly",
			(d) => {
				d.data.dateRange = { kind: "set", unit: "year", start: "2026-01-01" };
				d.data.resolution = "month";
			}
		],
		[
			"Yearly",
			(d) => {
				d.data.dateRange = { kind: "trailing", amount: 36, unit: "month" };
				d.data.resolution = "year";
			}
		],
		["Now", (d) => void delete d.data.dateRange]
	];

	// The notes are the same at every framing, by design: Chart and Table have no span limit, so a
	// Map's range always carries over, and no framing-specific note (cutAt, pollutant, selection)
	// can arise from a Map. The loop pins that.
	for (const [name, frame] of framings) {
		it(`${name}: the hand-off's notes are exactly overlays and fill`, () => {
			const map = fullMap();
			frame(map);
			const h = showInDraft(map, send(monitors(6)), chartType, CATALOG, DRAWABLE, NOW);
			expect(h.notes).toEqual({ dropped: ["overlays", "fill"] });
			const r = HandOffSchema.safeParse(h);
			expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
		});
	}

	it("a Chart from a Map with smoke and fire, notices, use and a fill keeps the use layer only", () => {
		const map = fullMap();
		expect(map.data.layers.map((l) => l.dataset)).toEqual(
			expect.arrayContaining(["hms-smoke", "hms-fire", PESTICIDE_USE])
		);
		const h = showInDraft(map, send(["m1"]), chartType, CATALOG, DRAWABLE, NOW);
		// Smoke and fire and notices are left out (the "overlays" note); use reaches the Chart.
		expect(h.draft.data.layers.map((l) => l.dataset)).toEqual(["air-quality", PESTICIDE_USE]);
		expect(h.draft.options).toBeUndefined();
		expect(h.notes!.dropped).toEqual(["overlays", "fill"]);
	});

	it("fullMap gives a fresh draft each call", () => {
		const a = fullMap();
		a.data.layers.pop();
		expect(fullMap().data.layers.length).toBeGreaterThan(a.data.layers.length);
	});
});

describe("sendPlaces", () => {
	it("gives monitor refs or one mtrs region, never a point", () => {
		const cases = [
			sendPlaces(send(["m1"])),
			sendPlaces(send(["m1", "m2"])),
			sendPlaces({ kind: "section", code: "S" })
		];
		expect(cases).toEqual([
			{ place: { kind: "monitor", id: "m1" } },
			{ selection: { kind: "monitors", ids: ["m1", "m2"] } },
			{ place: { kind: "region", type: "mtrs", code: "S" } }
		]);
		for (const c of cases) expect(c.place?.kind).not.toBe("point");
	});
});

describe("showInTarget", () => {
	const appWith = (
		session: { id: string; widgets: string[]; readOnly?: unknown } | null,
		isStarter = false
	) =>
		({
			current: {
				session: session && {
					doc: { id: session.id, body: { widgets: session.widgets.map((id) => ({ id })) } },
					readOnly: session.readOnly ?? false
				},
				isStarter
			}
		}) as unknown as AppContext;

	it("opens the current editable dashboard's new widget when it holds the Map", () => {
		expect(showInTarget(appWith({ id: "d1", widgets: ["w1"] }), "w1")).toEqual({
			target: { path: "/dashboards/:id/widgets/new", id: "d1" }
		});
	});

	it("gives the starter as STARTER_ID", () => {
		expect(showInTarget(appWith({ id: "copy", widgets: ["w1"] }, true), "w1")).toEqual({
			target: { path: "/dashboards/:id/widgets/new", id: STARTER_ID }
		});
	});

	it("opens /data with the dashboard to skip when it's read-only", () => {
		for (const readOnly of ["newer", "invalid", "unkept"]) {
			expect(showInTarget(appWith({ id: "d1", widgets: ["w1"], readOnly }), "w1")).toEqual({
				target: { path: "/data" },
				skip: "d1"
			});
		}
	});

	it("opens /data with no session (a share link) or a session without the Map", () => {
		expect(showInTarget(appWith(null), "w1")).toEqual({ target: { path: "/data" } });
		expect(showInTarget(appWith({ id: "d1", widgets: ["w2"] }), "w1")).toEqual({
			target: { path: "/data" }
		});
	});
});

describe("HandOffSchema", () => {
	const handOff = () =>
		showInDraft(fullMap(), send(monitors(6), 2), chartType, CATALOG, DRAWABLE, NOW);

	it("accepts showInDraft's output, a section's, and one with skip", () => {
		expect(HandOffSchema.safeParse(handOff()).success).toBe(true);
		const section = showInDraft(fullMap(), { kind: "section", code: "S" }, chartType, CATALOG, []);
		expect(HandOffSchema.safeParse(section).success).toBe(true);
		expect(HandOffSchema.safeParse({ ...handOff(), skip: "d1" }).success).toBe(true);
	});

	it("rejects a draft DraftSchema rejects, a negative left-out count, and missing fields", () => {
		const bad = handOff();
		bad.draft.data.layers[0] = { dataset: "air-quality", place: { kind: "nowhere" } } as never;
		expect(HandOffSchema.safeParse(bad).success).toBe(false);
		expect(HandOffSchema.safeParse({ ...handOff(), leftOut: -1 }).success).toBe(false);
		expect(HandOffSchema.safeParse({ ...handOff(), leftOut: 1.5 }).success).toBe(false);
		expect(HandOffSchema.safeParse({ draft: handOff().draft }).success).toBe(false);
		expect(HandOffSchema.safeParse(null).success).toBe(false);
	});

	it("rejects notes it doesn't know or too many of them, and a bad selection", () => {
		const notes = (n: unknown) => HandOffSchema.safeParse({ ...handOff(), notes: n }).success;
		expect(notes({ dropped: ["overlays", "fill"] })).toBe(true);
		expect(notes({ dropped: ["marks"] })).toBe(false);
		expect(notes({ dropped: ["places"] })).toBe(false);
		expect(notes({ dropped: ["nope"] })).toBe(false);
		expect(notes({ dropped: Array(11).fill("fill") })).toBe(false);
		expect(notes({ dropped: [], cutAt: "hour" })).toBe(false);
		expect(notes({ dropped: [], selection: { start: "2026-09-05", end: "2026-09-01" } })).toBe(
			false
		);
		expect(
			notes({
				dropped: ["pollutant"],
				pollutant: { from: { dataset: "air-quality", entryType: "pm10" }, to: "pm25" }
			})
		).toBe(true);
	});
});

describe("showIn", () => {
	const app = {
		current: {
			session: { doc: { id: "d1", body: { widgets: [{ id: "w1" }] } }, readOnly: false },
			isStarter: false
		}
	} as unknown as AppContext;

	it("builds from the registry's draft and navigates with the hand-off in history state", async () => {
		const owner = Symbol();
		const clear = setMapSend("w1", owner, {
			marks: ["m1", "m2"],
			leftOut: 1,
			draft: () => mapDraft(["pm25", "o3"], { showing: "o3" })
		});
		await showIn(app, "w1", send(["m1", "m2"], 1), "table");
		clear();
		const [path, opts] = vi.mocked(navigate).mock.calls.at(-1)!;
		expect(path).toBe("/dashboards/:id/widgets/new");
		const { state, params } = opts as { state: { getData: unknown }; params: unknown };
		expect(params).toEqual({ id: "d1" });
		const getData = HandOffSchema.parse(state.getData);
		expect(getData.draft.type).toBe(DATA_TABLE_TYPE);
		expect(getData.draft.data.layers[0].entryType).toBe("o3");
		expect(getData.leftOut).toBe(1);
	});

	it("opens /data with skip for a read-only dashboard", async () => {
		const owner = Symbol();
		const clear = setMapSend("w1", owner, {
			marks: ["m1"],
			leftOut: 0,
			draft: () => mapDraft(["pm25"])
		});
		const readOnly = {
			current: { ...app.current, session: { ...app.current.session, readOnly: "newer" } }
		} as unknown as AppContext;
		await showIn(readOnly, "w1", send(["m1"]), "chart");
		clear();
		const [path, opts] = vi.mocked(navigate).mock.calls.at(-1)!;
		expect(path).toBe("/data");
		const getData = HandOffSchema.parse((opts as { state: { getData: unknown } }).state.getData);
		expect(getData.skip).toBe("d1");
	});

	it("does nothing when the Map isn't mounted", async () => {
		vi.mocked(navigate).mockClear();
		await showIn(app, "gone", send(["m1"]), "chart");
		expect(navigate).not.toHaveBeenCalled();
	});
});
