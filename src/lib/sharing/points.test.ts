import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "$lib/data/schema";
import type { QueryInput } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { makeDoc } from "./fixtures.test-util";
import { hasPoints, pointSwaps, swapNotice, summarizeSwaps, withSwaps } from "./points";

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
			{ widgetId: "p", layerIndex: 0, region: { type: "zipcode", code: "93721" } }
		]);
		const [input, signal] = mocked.placeRegion.mock.calls[0];
		expect(input).toEqual({ layer: pm25(POINT), dateRange: RANGE, worstHour: true });
		// Always bounded: a lookup can't wait forever.
		expect(signal).toBeInstanceOf(AbortSignal);
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

	it("leaves a layer that is no longer a point alone", () => {
		const doc = docWith(dataWidget("p", [pm25({ kind: "monitor", id: "m1" })]));
		const swapped = withSwaps(doc, [
			{ widgetId: "p", layerIndex: 0, region: { type: "zipcode", code: "93721" } }
		]);
		expect(swapped.body.widgets[1]).toEqual(doc.body.widgets[1]);
	});
});

describe("summarizeSwaps and swapNotice", () => {
	const swap = (region: { type: string; code: string } | null, widgetId = "p") => ({
		widgetId,
		layerIndex: 0,
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
