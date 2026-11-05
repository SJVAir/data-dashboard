import { describe, expect, it, vi } from "vitest";
import type { WidgetDataConfig } from "$lib/data/schema";
import { pickedData, RegionLookupFailed } from "./apply";
import type { Picks } from "./selection";

const RANGE = { kind: "trailing", amount: 30, unit: "day" } as const;

function data(layer: Partial<WidgetDataConfig["layers"][number]>): WidgetDataConfig {
	return {
		dateRange: RANGE,
		layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }]
	};
}

const off = { liveLink: false, regionOf: vi.fn(async () => null) };
const point = { kind: "point" as const, lat: 36.75, lon: -119.79 };

describe("pickedData", () => {
	it("is null when the picks are the layer's current places", async () => {
		const county = data({ place: { kind: "region", type: "county", code: "06019" } });
		expect(
			await pickedData(county, [{ kind: "region", type: "county", code: "06019" }], off)
		).toBeNull();
		const monitors = data({ selection: { kind: "monitors", ids: ["a", "b"] } });
		expect(
			await pickedData(
				monitors,
				[
					{ kind: "monitor", id: "a" },
					{ kind: "monitor", id: "b" }
				],
				off
			)
		).toBeNull();
	});

	it("one region becomes the layer's place, dropping any selection", async () => {
		const result = await pickedData(
			data({ selection: { kind: "monitors", ids: ["a", "b"] } }),
			[{ kind: "region", type: "city", code: "0627000" }],
			off
		);
		expect(result).toEqual({
			data: data({ place: { kind: "region", type: "city", code: "0627000" } }),
			savedAsRegion: null
		});
		expect(result!.data.layers[0]).not.toHaveProperty("selection");
	});

	it("three monitors become a selection, dropping the place", async () => {
		const picks: Picks = ["a", "b", "c"].map((id) => ({ kind: "monitor", id }));
		const result = await pickedData(
			data({ place: { kind: "region", type: "county", code: "06019" } }),
			picks,
			off
		);
		expect(result!.data.layers[0]).toEqual({
			dataset: "air-quality",
			entryType: "pm25",
			selection: { kind: "monitors", ids: ["a", "b", "c"] }
		});
	});

	it("keeps the other layers and fields as they are", async () => {
		const start: WidgetDataConfig = {
			dateRange: RANGE,
			layers: [
				{ dataset: "air-quality", place: { kind: "monitor", id: "x" } },
				{ dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "y" } }
			]
		};
		const result = await pickedData(start, [{ kind: "monitor", id: "z" }], off);
		expect(result!.data.layers[0]).toBe(start.layers[0]);
		expect(result!.data.layers[1].place).toEqual({ kind: "monitor", id: "z" });
		expect(result!.data.dateRange).toEqual(RANGE);
	});

	it("a point stays a point without a live link", async () => {
		const regionOf = vi.fn(async () => ({ type: "zipcode", code: "93721" }));
		const result = await pickedData(data({}), [point], { liveLink: false, regionOf });
		expect(result).toEqual({ data: data({ place: point }), savedAsRegion: null });
		expect(regionOf).not.toHaveBeenCalled();
	});

	it("with a live link, a point is saved as its region", async () => {
		const regionOf = vi.fn(async () => ({ type: "zipcode", code: "93721" }));
		const result = await pickedData(data({}), [point], { liveLink: true, regionOf });
		expect(regionOf).toHaveBeenCalledWith(point);
		expect(result).toEqual({
			data: data({ place: { kind: "region", type: "zipcode", code: "93721" } }),
			savedAsRegion: { type: "zipcode", code: "93721" }
		});
	});

	it("with a live link, no region (or a failed lookup) rejects and keeps nothing", async () => {
		const none = pickedData(data({}), [point], { liveLink: true, regionOf: async () => null });
		await expect(none).rejects.toBeInstanceOf(RegionLookupFailed);
		const failed = pickedData(data({}), [point], {
			liveLink: true,
			regionOf: async () => {
				throw new Error("offline");
			}
		});
		await expect(failed).rejects.toBeInstanceOf(RegionLookupFailed);
	});

	it("an aborted lookup rejects with the abort, not a lookup failure", async () => {
		const abort = new DOMException("The operation was aborted.", "AbortError");
		const result = pickedData(data({}), [point], {
			liveLink: true,
			regionOf: async () => {
				throw abort;
			}
		});
		await expect(result).rejects.toBe(abort);
	});

	it("is null for data with no layer to change", async () => {
		expect(await pickedData({ layers: [] }, [{ kind: "monitor", id: "a" }], off)).toBeNull();
	});
});
