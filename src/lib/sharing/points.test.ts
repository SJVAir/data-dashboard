import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChosenPlace, Layer, PlaceRef } from "$lib/data/schema";
import type { CatalogEntry } from "$lib/data/metadata";
import { FIXTURE_CATALOG } from "$lib/data/testing/fixtures";
import type { QueryInput } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { registerWidgetType } from "$lib/widgets/registry";
import { CURRENT_TYPE, currentType } from "$lib/widgets/current";
import { FORECAST_TYPE, forecastType } from "$lib/widgets/forecast";
import { MAP_TYPE, mapType } from "$lib/widgets/map";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/input";
import { makeDoc } from "./fixtures.test-util";
import {
	hasPoints,
	pointSwaps,
	pointsCovered,
	swapNotice,
	summarizeSwaps,
	swapChange,
	withSwaps
} from "./points";

const mocked = vi.hoisted(() => ({
	placeRegion:
		vi.fn<
			(input: QueryInput, signal?: AbortSignal) => Promise<{ type: string; code: string } | null>
		>(),
	resolve: vi.fn(),
	catalog: vi.fn<() => Promise<CatalogEntry[] | "unavailable">>()
}));
vi.mock("$lib/data", () => ({
	placeRegion: mocked.placeRegion,
	getMetadata: () => ({ catalog: mocked.catalog }),
	getResolvers: () => ({ regions: { resolve: mocked.resolve } })
}));

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;
const RANGE = { kind: "trailing", amount: 30, unit: "day" } as const;

/** A Chart of `layers` (PM2.5) at `place`. */
function dataWidget(id: string, place?: PlaceRef, layers: Layer[] = [PM25]): WidgetInstance {
	return {
		id,
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 6 },
		data: { dateRange: RANGE, ...(place ? { place } : {}), layers: structuredClone(layers) }
	};
}

function docWith(...widgets: WidgetInstance[]): Dashboard {
	const doc = makeDoc(1);
	return { ...doc, body: { widgets: [...doc.body.widgets, ...widgets] } };
}

const PM25: Layer = { dataset: "air-quality", entryType: "pm25" };
/** The query layer the lookup asks with: PM2.5 at `place`. */
const pm25 = (place: PlaceRef) => ({ ...PM25, place });

beforeEach(() => {
	registerWidgetType(currentType);
	registerWidgetType(forecastType);
	registerWidgetType(mapType);
	mocked.placeRegion.mockReset();
	mocked.resolve.mockReset();
	mocked.catalog.mockReset();
	mocked.catalog.mockResolvedValue(FIXTURE_CATALOG);
	mocked.placeRegion.mockResolvedValue({ type: "zipcode", code: "93721" });
	mocked.resolve.mockResolvedValue({ id: "z1", name: "ZIP 93721" });
});

describe("hasPoints and pointSwaps", () => {
	it("a dashboard without points has none and looks nothing up", async () => {
		const doc = docWith(
			dataWidget("c", { kind: "region", type: "county", code: "019" }),
			dataWidget("s", { kind: "location", source: "cde", code: "1062166" })
		);
		expect(hasPoints(doc)).toBe(false);
		expect(await pointSwaps(doc)).toEqual([]);
		expect(mocked.placeRegion).not.toHaveBeenCalled();
	});

	it("a Note has no places layer, so nothing is looked up for it", async () => {
		const note: WidgetInstance = {
			id: "n",
			type: "note",
			title: null,
			rect: { x: 0, y: 0, w: 4, h: 3 },
			data: { layers: [] },
			options: { text: "hi" }
		};
		const doc = docWith(note);
		expect(hasPoints(doc)).toBe(false);
		expect(await pointSwaps(doc)).toEqual([]);
		expect(mocked.placeRegion).not.toHaveBeenCalled();
	});

	it("looks a point's region up with the widget's own query", async () => {
		const doc = docWith(dataWidget("p", POINT));
		expect(hasPoints(doc)).toBe(true);
		const swaps = await pointSwaps(doc);
		expect(swaps).toEqual([
			{
				widgetId: "p",
				point: { lat: POINT.lat, lon: POINT.lon },
				region: { type: "zipcode", code: "93721" }
			}
		]);
		const [input, signal] = mocked.placeRegion.mock.calls[0];
		expect(input).toEqual({
			layer: pm25(POINT),
			dateRange: RANGE,
			resolution: "day",
			worstHour: true
		});
		// Always bounded: a lookup can't wait forever.
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it("looks up at the widget's dataset resolution: a point is a region, so no raw", async () => {
		const short = { kind: "trailing", amount: 2, unit: "day" } as const;
		const doc = docWith({
			...dataWidget("p", POINT),
			data: { dateRange: short, place: POINT, layers: [PM25] }
		});
		await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[0][0].resolution).toBe("hour");
		// Without the catalog, Automatic is the range's level.
		mocked.catalog.mockResolvedValue("unavailable");
		await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[1][0].resolution).toBe("raw");
	});

	it("looks a calendar's point up one row per day", async () => {
		const calendar: WidgetInstance = {
			id: "k",
			type: MONTH_CALENDAR_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 4, h: 6 },
			data: {
				timeSubRange: { start: "2026-01-05", end: "2026-01-12" },
				place: POINT,
				layers: [PM25]
			}
		};
		await pointSwaps(docWith(calendar));
		const [input] = mocked.placeRegion.mock.calls[0];
		expect(input.resolution).toBe("day");
		expect(input.dateRange).toEqual({ kind: "to-date", unit: "month" });
		expect(input.worstHour).toBeUndefined();
		expect(input.timeSubRange).toBeUndefined();
	});

	it("looks a now tile's point up over the trailing hours the tile reads", async () => {
		const tile: WidgetInstance = {
			id: "n",
			type: CURRENT_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 3, h: 4 },
			data: { place: POINT, layers: [PM25] }
		};
		const swaps = await pointSwaps(docWith(tile));
		expect(swaps[0].region).toEqual({ type: "zipcode", code: "93721" });
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			resolution: "hour"
		});
	});

	it("a Map holding a point shares as the region the now lookup gives", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: { place: POINT, layers: [PM25] }
		};
		const doc = docWith(map);
		const swaps = await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			resolution: "hour"
		});
		const swapped = withSwaps(doc, swaps);
		expect(swapped.body.widgets[1].data.place).toEqual({
			kind: "region",
			type: "zipcode",
			code: "93721"
		});
		expect(hasPoints(swapped)).toBe(false);
	});

	it("a Map with a date range holding a point shares the same way, by the now lookup", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				dateRange: { kind: "trailing", amount: 7, unit: "day" },
				place: POINT,
				layers: [PM25]
			}
		};
		const doc = docWith(map);
		const swaps = await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			resolution: "hour"
		});
		const swapped = withSwaps(doc, swaps);
		expect(swapped.body.widgets[1].data.place).toEqual({
			kind: "region",
			type: "zipcode",
			code: "93721"
		});
		expect(swapped.body.widgets[1].data.dateRange).toEqual({
			kind: "trailing",
			amount: 7,
			unit: "day"
		});
	});

	it("shares a Map holding a point with PM2.5 and ozone as one region swap of its Where", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				place: POINT,
				layers: [
					PM25,
					{ dataset: "air-quality", entryType: "o3" },
					{ dataset: "hms-smoke" },
					{ dataset: "hms-fire" }
				]
			}
		};
		const doc = docWith(map);
		expect(hasPoints(doc)).toBe(true);
		const swaps = await pointSwaps(doc);
		expect(swaps).toEqual([
			{
				widgetId: "m",
				point: { lat: POINT.lat, lon: POINT.lon },
				region: { type: "zipcode", code: "93721" }
			}
		]);
		expect(mocked.placeRegion).toHaveBeenCalledTimes(1);
		const swapped = withSwaps(doc, swaps);
		const data = swapped.body.widgets[1].data;
		expect(data.place).toEqual({ kind: "region", type: "zipcode", code: "93721" });
		expect(data.layers).toEqual(map.data.layers);
		expect(hasPoints(swapped)).toBe(false);
	});

	it("a Map selection is left alone", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				selection: { kind: "monitors", ids: ["a", "b"] },
				layers: [PM25]
			}
		};
		const doc = docWith(map);
		expect(hasPoints(doc)).toBe(false);
		expect(await pointSwaps(doc)).toEqual([]);
		expect(mocked.placeRegion).not.toHaveBeenCalled();
	});

	it("a place-less notices layer passes the point swap unchanged", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			data: {
				place: { kind: "region", type: "zipcode", code: "93721" },
				layers: [PM25, { dataset: "pesticide-notices", filters: { chemical: "c1" } }]
			}
		};
		const doc = docWith(map);
		expect(hasPoints(doc)).toBe(false);
		const swaps = await pointSwaps(doc);
		expect(swaps).toEqual([]);
		expect(withSwaps(doc, swaps).body.widgets[1].data.layers).toEqual(map.data.layers);
		expect(mocked.placeRegion).not.toHaveBeenCalled();
	});

	it("a place-less use layer passes the point swap unchanged", async () => {
		const map: WidgetInstance = {
			id: "m",
			type: MAP_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 6, h: 6 },
			options: { useFigure: "acres-treated" },
			data: {
				place: POINT,
				layers: [
					PM25,
					{ dataset: "pesticide-notices", filters: { chemical: "c1" } },
					{ dataset: "pesticide-use", filters: { chemical: "c1" } }
				]
			}
		};
		const doc = docWith(map);
		expect(hasPoints(doc)).toBe(true);
		const swaps = await pointSwaps(doc);
		expect(mocked.placeRegion).toHaveBeenCalledTimes(1);
		const swapped = withSwaps(doc, swaps).body.widgets[1];
		expect(swapped.data.place).toEqual({
			kind: "region",
			type: "zipcode",
			code: "93721"
		});
		expect(swapped.data.layers).toEqual(map.data.layers);
		expect(swapped.options).toEqual({ useFigure: "acres-treated" });
	});

	it("keeps a Forecast strip's place: its point is looked up as a PM2.5 one", async () => {
		const strip: WidgetInstance = {
			id: "f",
			type: FORECAST_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 3, h: 4 },
			data: { place: POINT, layers: [{ dataset: "forecasts" }] }
		};
		const doc = docWith(strip);
		const swaps = await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			resolution: "hour"
		});
		const swapped = withSwaps(doc, swaps);
		expect(swapped.body.widgets[1].data).toEqual({
			place: { kind: "region", type: "zipcode", code: "93721" },
			layers: [{ dataset: "forecasts" }]
		});
		expect(hasPoints(swapped)).toBe(false);
	});

	it("rejects when a lookup fails", async () => {
		mocked.placeRegion.mockRejectedValue(new Error("offline"));
		await expect(pointSwaps(docWith(dataWidget("p", POINT)))).rejects.toThrow();
	});

	it("gives up after 20 seconds", async () => {
		vi.useFakeTimers();
		try {
			mocked.placeRegion.mockImplementation(
				(_input, signal) =>
					new Promise((_resolve, reject) =>
						signal?.addEventListener("abort", () => reject(signal.reason))
					)
			);
			const swaps = pointSwaps(docWith(dataWidget("p", POINT)));
			const settled = expect(swaps).rejects.toBeDefined();
			await vi.advanceTimersByTimeAsync(20_000);
			await settled;
		} finally {
			vi.useRealTimers();
		}
	});

	it("an aborted caller's signal aborts the lookup", async () => {
		mocked.placeRegion.mockImplementation(
			(_input, signal) =>
				new Promise((_resolve, reject) =>
					signal?.addEventListener("abort", () => reject(signal.reason))
				)
		);
		const caller = new AbortController();
		const swaps = pointSwaps(docWith(dataWidget("p", POINT)), caller.signal);
		caller.abort();
		await expect(swaps).rejects.toBeDefined();
	});
});

describe("withSwaps", () => {
	it("a point in Where is swapped for its region on share; everything else is left alone", async () => {
		const school = { kind: "location", source: "cde", code: "1062166" } as const;
		const doc = docWith(dataWidget("p", POINT), dataWidget("s", school));
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.widgets.find((w) => w.id === "p")!.data).toEqual({
			dateRange: RANGE,
			place: { kind: "region", type: "zipcode", code: "93721" },
			layers: [PM25]
		});
		// Schools need none of this.
		expect(swapped.body.widgets.find((w) => w.id === "s")).toEqual(doc.body.widgets[2]);
		expect(swapped.body.widgets[0]).toBe(doc.body.widgets[0]);
		expect(hasPoints(swapped)).toBe(false);
		// The original is untouched.
		expect(doc.body.widgets[1].data.place).toEqual(POINT);
	});

	it("removes a point with no region (the widget shows its idle state)", async () => {
		mocked.placeRegion.mockResolvedValue(null);
		const doc = docWith(dataWidget("p", POINT));
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.widgets[1].data).toEqual({ dateRange: RANGE, layers: [PM25] });
	});

	it("leaves a widget that is no longer at that point alone", () => {
		const swap = {
			widgetId: "p",
			point: { lat: POINT.lat, lon: POINT.lon },
			region: { type: "zipcode", code: "93721" }
		};
		for (const place of [{ kind: "monitor", id: "m1" } as const, { ...POINT, lat: 36.8 }]) {
			const doc = docWith(dataWidget("p", place));
			expect(withSwaps(doc, [swap]).body.widgets[1]).toEqual(doc.body.widgets[1]);
		}
	});
});

describe("pointsCovered", () => {
	it("is true only when every point now in the dashboard has its swap", async () => {
		const doc = docWith(dataWidget("p", POINT));
		const swaps = await pointSwaps(doc);
		expect(pointsCovered(doc, swaps)).toBe(true);
		expect(pointsCovered(docWith(), swaps)).toBe(true);
		// Re-picked, added elsewhere, or replaced meanwhile.
		expect(pointsCovered(docWith(dataWidget("p", { ...POINT, lat: 36.8 })), swaps)).toBe(false);
		expect(pointsCovered(docWith(dataWidget("p", POINT), dataWidget("q", POINT)), swaps)).toBe(
			false
		);
	});
});

describe("the Change place bar's point", () => {
	const ZIP = { kind: "region", type: "zipcode", code: "93721" } as const;
	const withBar = (doc: Dashboard, place: ChosenPlace): Dashboard => ({
		...doc,
		body: { ...doc.body, placeBar: { place } }
	});

	it("counts as a point, even with no point layer", () => {
		const doc = withBar(docWith(dataWidget("c", ZIP)), POINT);
		expect(hasPoints(doc)).toBe(true);
		expect(hasPoints(withBar(doc, ZIP))).toBe(false);
	});

	it("becomes the same region as a swapped layer holding the same point", async () => {
		const doc = withBar(docWith(dataWidget("p", POINT)), POINT);
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.placeBar).toEqual({ place: ZIP });
		expect(hasPoints(swapped)).toBe(false);
	});

	it("is dropped when no layer holds its point", async () => {
		const other = { ...POINT, lat: 36.8 };
		for (const doc of [
			withBar(docWith(dataWidget("p", other)), POINT),
			withBar(docWith(dataWidget("c", ZIP)), POINT)
		]) {
			const swapped = withSwaps(doc, await pointSwaps(doc));
			expect(swapped.body.placeBar).toBeUndefined();
			expect("placeBar" in swapped.body).toBe(false);
			expect(hasPoints(swapped)).toBe(false);
		}
	});

	it("is dropped when its layer's point has no region", async () => {
		mocked.placeRegion.mockResolvedValue(null);
		const doc = withBar(docWith(dataWidget("p", POINT)), POINT);
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect("placeBar" in swapped.body).toBe(false);
	});

	it("leaves a bar that isn't a point alone", async () => {
		const doc = withBar(docWith(dataWidget("p", POINT)), ZIP);
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.placeBar).toBe(doc.body.placeBar);
	});

	it("is covered by its layer's swap, or needs none", async () => {
		const doc = withBar(docWith(dataWidget("p", POINT)), POINT);
		expect(pointsCovered(doc, await pointSwaps(doc))).toBe(true);
		expect(pointsCovered(withBar(docWith(), POINT), [])).toBe(true);
	});

	it("a swap that moves the bar is one replaceDocument", async () => {
		const doc = withBar(docWith(dataWidget("p", POINT)), POINT);
		const change = swapChange(doc, await pointSwaps(doc));
		expect(change?.op).toBe("replaceDocument");
		const to = (change as Extract<typeof change, { op: "replaceDocument" }>)!.to;
		expect(to.body.placeBar).toEqual({ place: ZIP });
		expect(to.body.widgets[1].data.place).toEqual(ZIP);
		// A bar-only point: its removal alone.
		const barOnly = withBar(docWith(), POINT);
		const removal = swapChange(barOnly, []);
		expect(removal?.op).toBe("replaceDocument");
		expect(
			"placeBar" in (removal as Extract<typeof removal, { op: "replaceDocument" }>)!.to.body
		).toBe(false);
		// No bar point, nothing to change.
		expect(swapChange(withBar(docWith(), ZIP), [])).toBeNull();
	});
});

describe("summarizeSwaps and swapNotice", () => {
	const swap = (region: { type: string; code: string } | null, widgetId = "p") => ({
		widgetId,
		point: { lat: POINT.lat, lon: POINT.lon },
		region
	});
	const zip = { type: "zipcode", code: "93721" };

	it("names one region", async () => {
		const summary = await summarizeSwaps([swap(zip), swap(zip, "q")]);
		expect(summary).toEqual({ kind: "one", region: "ZIP 93721" });
		expect(mocked.resolve).toHaveBeenCalledWith("zipcode", "93721", expect.any(AbortSignal));
		expect(swapNotice(summary)).toBe(
			"Your location is shared as ZIP 93721, not your exact position."
		);
	});

	it("falls back to the code when the name can't be found", async () => {
		mocked.resolve.mockRejectedValue(new Error("offline"));
		expect(await summarizeSwaps([swap(zip)])).toEqual({ kind: "one", region: "93721" });
	});

	it("several regions, or a removed point among them, get the plural notice", async () => {
		for (const swaps of [
			[swap(zip), swap({ type: "county", code: "019" }, "q")],
			[swap(zip), swap(null, "q")]
		]) {
			const summary = await summarizeSwaps(swaps);
			expect(summary).toEqual({ kind: "several" });
			expect(swapNotice(summary)).toBe(
				"Your locations are shared as their areas, not your exact positions."
			);
		}
	});

	it("a point with no region says it's left out", async () => {
		const summary = await summarizeSwaps([swap(null)]);
		expect(summary).toEqual({ kind: "removed" });
		expect(swapNotice(summary)).toBe(
			"Your location is outside the area SJVAir covers, so it's left out."
		);
	});
});
