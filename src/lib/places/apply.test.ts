import { describe, expect, it, vi } from "vitest";
import type { WidgetDataConfig } from "$lib/data/schema";
import { pickedData, RegionLookupFailed, replacedMonitor } from "./apply";
import type { Picks } from "./selection";

const RANGE = { kind: "trailing", amount: 30, unit: "day" } as const;

function data(where: Pick<WidgetDataConfig, "place" | "selection">): WidgetDataConfig {
	return {
		dateRange: RANGE,
		...where,
		layers: [{ dataset: "air-quality", entryType: "pm25" }]
	};
}

const off = { liveLink: false, regionOf: vi.fn(async () => null) };
const point = { kind: "point" as const, lat: 36.75, lon: -119.79 };

describe("pickedData", () => {
	it("is null when the picks are the widget's current Where", async () => {
		const county = data({ place: { kind: "region", type: "county", code: "06019" } });
		expect(
			await pickedData(county, [{ kind: "region", type: "county", code: "06019" }], off)
		).toBeNull();
		const counties = data({ selection: { kind: "regions", ids: ["county:a", "county:b"] } });
		expect(
			await pickedData(
				counties,
				[
					{ kind: "region", type: "county", code: "a" },
					{ kind: "region", type: "county", code: "b" }
				],
				off
			)
		).toBeNull();
	});

	it("one region becomes the widget's place, dropping any selection", async () => {
		const result = await pickedData(
			data({ selection: { kind: "regions", ids: ["county:a", "county:b"] } }),
			[{ kind: "region", type: "city", code: "0627000" }],
			off
		);
		expect(result).toEqual({
			data: data({ place: { kind: "region", type: "city", code: "0627000" } }),
			savedAsRegion: null
		});
		expect(result!.data).not.toHaveProperty("selection");
	});

	it("three regions become a selection, dropping the place", async () => {
		const picks: Picks = ["a", "b", "c"].map((code) => ({ kind: "region", type: "county", code }));
		const result = await pickedData(
			data({ place: { kind: "region", type: "county", code: "06019" } }),
			picks,
			off
		);
		expect(result!.data).toEqual(
			data({ selection: { kind: "regions", ids: ["county:a", "county:b", "county:c"] } })
		);
		expect(result!.data).not.toHaveProperty("place");
	});

	it("keeps the layers and other fields as they are", async () => {
		const start: WidgetDataConfig = {
			dateRange: RANGE,
			place: { kind: "region", type: "county", code: "y" },
			layers: [
				{ dataset: "air-quality" },
				{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }
			]
		};
		const z = { kind: "region" as const, type: "county", code: "z" };
		const result = await pickedData(start, [z], off);
		expect(result!.data.layers).toBe(start.layers);
		expect(result!.data.place).toEqual(z);
		expect(result!.data.dateRange).toEqual(RANGE);
	});

	it("a single-place widget's picked place replaces its monitor; other widgets keep theirs", async () => {
		const tile: WidgetDataConfig = {
			layers: [{ dataset: "air-quality", entryType: "pm25", monitors: ["m1"] }]
		};
		const z = { kind: "region" as const, type: "county", code: "z" };
		const result = await pickedData(tile, [z], { ...off, onePlace: true });
		expect(result!.data).toEqual({
			place: z,
			layers: [{ dataset: "air-quality", entryType: "pm25" }]
		});
		const strip: WidgetDataConfig = { layers: [{ dataset: "forecasts", monitors: ["m1"] }] };
		expect((await pickedData(strip, [z], { ...off, onePlace: true }))!.data.layers).toEqual([
			{ dataset: "forecasts" }
		]);
		expect((await pickedData(tile, [z], off))!.data.layers).toBe(tile.layers);
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

describe("replacedMonitor", () => {
	const county = { kind: "region" as const, type: "county", code: "06019" };
	const chart = (): WidgetDataConfig => ({
		dateRange: RANGE,
		place: county,
		layers: [
			{ dataset: "air-quality", entryType: "pm25", monitors: ["a", "gone", "b"] },
			{ dataset: "weather", entryType: "temperature" }
		]
	});

	it("replaces the gone monitor in place; the Where and the other layers stay", () => {
		expect(replacedMonitor(chart(), ["gone"], "c", false)).toEqual({
			...chart(),
			layers: [
				{ dataset: "air-quality", entryType: "pm25", monitors: ["a", "c", "b"] },
				{ dataset: "weather", entryType: "temperature" }
			]
		});
		// A pick already listed isn't doubled.
		expect(replacedMonitor(chart(), ["gone"], "b", false)?.layers[0].monitors).toEqual(["a", "b"]);
	});

	it("a single-place widget holds just the pick, with no Where", () => {
		const tile: WidgetDataConfig = {
			place: county,
			layers: [{ dataset: "forecasts", monitors: ["gone"] }]
		};
		expect(replacedMonitor(tile, ["gone"], "c", true)).toEqual({
			layers: [{ dataset: "forecasts", monitors: ["c"] }]
		});
	});

	it("is null when no saved monitor is gone", () => {
		expect(replacedMonitor(chart(), [], "c", false)).toBeNull();
		expect(replacedMonitor(chart(), ["other"], "c", false)).toBeNull();
	});
});
