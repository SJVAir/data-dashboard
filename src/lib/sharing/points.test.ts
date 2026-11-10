import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { registerWidgetType } from "$lib/widgets/registry";
import { CURRENT_TYPE, currentType } from "$lib/widgets/current";
import { FORECAST_TYPE, forecastType } from "$lib/widgets/forecast";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/input";
import { makeDoc } from "./fixtures.test-util";
import {
	hasPoints,
	pointSwaps,
	pointsCovered,
	swapNotice,
	summarizeSwaps,
	withSwaps
} from "./points";

const mocked = vi.hoisted(() => ({
	placeRegion:
		vi.fn<
			(input: QueryInput, signal?: AbortSignal) => Promise<{ type: string; code: string } | null>
		>(),
	resolve: vi.fn()
}));
vi.mock("$lib/data", () => ({
	placeRegion: mocked.placeRegion,
	getResolvers: () => ({ regions: { resolve: mocked.resolve } })
}));

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;
const RANGE = { kind: "trailing", amount: 30, unit: "day" } as const;

function dataWidget(id: string, layers: Layer[]): WidgetInstance {
	return {
		id,
		type: "chart",
		title: null,
		rect: { x: 0, y: 0, w: 3, h: 6 },
		data: { dateRange: RANGE, layers }
	};
}

function docWith(...widgets: WidgetInstance[]): Dashboard {
	const doc = makeDoc(1);
	return { ...doc, body: { widgets: [...doc.body.widgets, ...widgets] } };
}

const pm25 = (place: Layer["place"]): Layer => ({
	dataset: "air-quality",
	entryType: "pm25",
	place
});

beforeEach(() => {
	registerWidgetType(currentType);
	registerWidgetType(forecastType);
	mocked.placeRegion.mockReset();
	mocked.resolve.mockReset();
	mocked.placeRegion.mockResolvedValue({ type: "zipcode", code: "93721" });
	mocked.resolve.mockResolvedValue({ id: "z1", name: "ZIP 93721" });
});

describe("hasPoints and pointSwaps", () => {
	it("a dashboard without points has none and looks nothing up", async () => {
		const doc = docWith(
			dataWidget("c", [pm25({ kind: "region", type: "county", code: "019" })]),
			dataWidget("s", [pm25({ kind: "location", source: "cde", code: "1062166" })])
		);
		expect(hasPoints(doc)).toBe(false);
		expect(await pointSwaps(doc)).toEqual([]);
		expect(mocked.placeRegion).not.toHaveBeenCalled();
	});

	it("looks a point layer's region up with the widget's own query", async () => {
		const doc = docWith(dataWidget("p", [pm25(POINT)]));
		expect(hasPoints(doc)).toBe(true);
		const swaps = await pointSwaps(doc);
		expect(swaps).toEqual([
			{
				widgetId: "p",
				layerIndex: 0,
				point: { lat: POINT.lat, lon: POINT.lon },
				region: { type: "zipcode", code: "93721" }
			}
		]);
		const [input, signal] = mocked.placeRegion.mock.calls[0];
		expect(input).toEqual({ layer: pm25(POINT), dateRange: RANGE, worstHour: true });
		// Always bounded: a lookup can't wait forever.
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it("looks a calendar's point up one row per day", async () => {
		const calendar: WidgetInstance = {
			id: "k",
			type: MONTH_CALENDAR_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 4, h: 6 },
			data: { timeSubRange: { start: "2026-01-05", end: "2026-01-12" }, layers: [pm25(POINT)] }
		};
		await pointSwaps(docWith(calendar));
		const [input] = mocked.placeRegion.mock.calls[0];
		expect(input.pin).toBe("day");
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
			data: { layers: [pm25(POINT)] }
		};
		const swaps = await pointSwaps(docWith(tile));
		expect(swaps[0].region).toEqual({ type: "zipcode", code: "93721" });
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			pin: "hour"
		});
	});

	it("keeps a Forecast strip's place: its point is looked up as a PM2.5 one", async () => {
		const strip: WidgetInstance = {
			id: "f",
			type: FORECAST_TYPE,
			title: null,
			rect: { x: 0, y: 0, w: 3, h: 4 },
			data: { layers: [{ dataset: "forecasts", place: POINT }] }
		};
		const doc = docWith(strip);
		const swaps = await pointSwaps(doc);
		expect(mocked.placeRegion.mock.calls[0][0]).toEqual({
			layer: pm25(POINT),
			dateRange: { kind: "trailing", amount: 6, unit: "hour" },
			pin: "hour"
		});
		const swapped = withSwaps(doc, swaps);
		expect(swapped.body.widgets[1].data.layers).toEqual([
			{ dataset: "forecasts", place: { kind: "region", type: "zipcode", code: "93721" } }
		]);
		expect(hasPoints(swapped)).toBe(false);
	});

	it("rejects when a lookup fails", async () => {
		mocked.placeRegion.mockRejectedValue(new Error("offline"));
		await expect(pointSwaps(docWith(dataWidget("p", [pm25(POINT)])))).rejects.toThrow();
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
			const swaps = pointSwaps(docWith(dataWidget("p", [pm25(POINT)])));
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
		const swaps = pointSwaps(docWith(dataWidget("p", [pm25(POINT)])), caller.signal);
		caller.abort();
		await expect(swaps).rejects.toBeDefined();
	});
});

describe("withSwaps", () => {
	it("swaps each point for its region and leaves everything else alone", async () => {
		const school = pm25({ kind: "location", source: "cde", code: "1062166" });
		const doc = docWith(
			dataWidget("p", [{ ...pm25(POINT), resolution: "auto" }]),
			dataWidget("s", [school])
		);
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.widgets.find((w) => w.id === "p")!.data.layers).toEqual([
			{
				dataset: "air-quality",
				entryType: "pm25",
				resolution: "auto",
				place: { kind: "region", type: "zipcode", code: "93721" }
			}
		]);
		// Schools need none of this.
		expect(swapped.body.widgets.find((w) => w.id === "s")).toEqual(doc.body.widgets[2]);
		expect(swapped.body.widgets[0]).toBe(doc.body.widgets[0]);
		expect(hasPoints(swapped)).toBe(false);
		// The original is untouched.
		expect(doc.body.widgets[1].data.layers[0].place).toEqual(POINT);
	});

	it("removes a point with no region (the widget shows its idle state)", async () => {
		mocked.placeRegion.mockResolvedValue(null);
		const doc = docWith(dataWidget("p", [pm25(POINT)]));
		const swapped = withSwaps(doc, await pointSwaps(doc));
		expect(swapped.body.widgets[1].data.layers).toEqual([
			{ dataset: "air-quality", entryType: "pm25" }
		]);
	});

	it("leaves a layer that is no longer that point alone", () => {
		const swap = {
			widgetId: "p",
			layerIndex: 0,
			point: { lat: POINT.lat, lon: POINT.lon },
			region: { type: "zipcode", code: "93721" }
		};
		for (const place of [{ kind: "monitor", id: "m1" } as const, { ...POINT, lat: 36.8 }]) {
			const doc = docWith(dataWidget("p", [pm25(place)]));
			expect(withSwaps(doc, [swap]).body.widgets[1]).toEqual(doc.body.widgets[1]);
		}
	});
});

describe("pointsCovered", () => {
	it("is true only when every point now in the dashboard has its swap", async () => {
		const doc = docWith(dataWidget("p", [pm25(POINT)]));
		const swaps = await pointSwaps(doc);
		expect(pointsCovered(doc, swaps)).toBe(true);
		expect(pointsCovered(docWith(), swaps)).toBe(true);
		// Re-picked, added elsewhere, or moved to another layer meanwhile.
		expect(pointsCovered(docWith(dataWidget("p", [pm25({ ...POINT, lat: 36.8 })])), swaps)).toBe(
			false
		);
		expect(
			pointsCovered(docWith(dataWidget("p", [pm25(POINT)]), dataWidget("q", [pm25(POINT)])), swaps)
		).toBe(false);
		expect(
			pointsCovered(
				docWith(dataWidget("p", [pm25({ kind: "monitor", id: "m1" }), pm25(POINT)])),
				swaps
			)
		).toBe(false);
	});
});

describe("summarizeSwaps and swapNotice", () => {
	const swap = (region: { type: string; code: string } | null, widgetId = "p") => ({
		widgetId,
		layerIndex: 0,
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
