import type { NowSource } from "$lib/data/now/client";
import type { HmsData } from "./hms";
type Src = NowSource<HmsData>;
import { getHMSFire, getHMSSmoke } from "@sjvair/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getHMSSmoke: vi.fn(), getHMSFire: vi.fn() }));

// map-sdk's root pulls in CSS Node can't load; its fire helpers are stubbed to what they return.
vi.mock("@sjvair/map-sdk", () => ({
	cleanFires: (d: { id: string; coordinates: [number, number]; frp: number }[]) => d,
	groupFires: (d: { id: string; coordinates: [number, number]; frp: number }[]) => [
		{ id: "g1", coordinates: d[0].coordinates, avgFrp: 15, count: d.length }
	]
}));

import { hmsEntry } from "./hms";

const messages = ((key: string, params?: { count?: number }) =>
	params?.count === undefined ? key : `${key}:${params.count}`) as never;

describe("hmsEntry", () => {
	it("keys on today's Pacific date, refreshed hourly", async () => {
		const source = await hmsEntry.source({ data: { layers: [] }, entryType: "pm25" });
		expect((source as Src | null)?.key).toMatch(/^map-hms:\d{4}-\d{2}-\d{2}$/);
		expect((source as Src | null)?.cadence).toBe("hour");
	});

	it("gives today's smoke and grouped fires", async () => {
		vi.mocked(getHMSSmoke).mockResolvedValue([
			{ id: "s1", density: "heavy", geometry: { type: "Polygon", coordinates: [] } }
		] as never);
		vi.mocked(getHMSFire).mockResolvedValue([
			{
				id: "f1",
				frp: 10,
				timestamp: "2026-11-12T10:00:00Z",
				geometry: { type: "Point", coordinates: [-119, 36] }
			},
			{
				id: "f2",
				frp: 20,
				timestamp: "2026-11-12T10:00:00Z",
				geometry: { type: "Point", coordinates: [-119.001, 36.001] }
			}
		] as never);
		const source = await hmsEntry.source({ data: { layers: [] }, entryType: "pm25" });
		const value = await (source as Src).fetch(new AbortController().signal);
		const out = hmsEntry.toDataSources(value, { messages, entryType: "pm25" });
		expect(Object.keys(out).sort()).toEqual(["fireGroups", "fireHotspots", "smoke"]);
		expect(out.smoke.scale).toEqual({ dataset: "hms-smoke", entryType: "smoke-density" });
		expect(out.smoke.features?.features[0].properties).toMatchObject({
			refKey: "feature:s1",
			name: "mapsdk_hms_smoke_name",
			value: "heavy"
		});
		expect(out.fireGroups.features?.features[0].properties).toEqual({
			refKey: "feature:g1",
			name: "mapsdk_hms_fire_detections:2",
			value: 15,
			count: 2
		});
		expect(out.fireGroups.scale).toEqual({ dataset: "hms-fire", entryType: "fire-frp" });
		expect(out.fireHotspots.features?.features).toHaveLength(2);
	});

	it("passes its abort signal to both fetches", async () => {
		vi.mocked(getHMSSmoke)
			.mockClear()
			.mockResolvedValue([] as never);
		vi.mocked(getHMSFire)
			.mockClear()
			.mockResolvedValue([] as never);
		const source = await hmsEntry.source({ data: { layers: [] }, entryType: "pm25" });
		const controller = new AbortController();
		await (source as Src).fetch(controller.signal);
		expect(vi.mocked(getHMSSmoke).mock.calls[0][1]).toEqual({ signal: controller.signal });
		expect(vi.mocked(getHMSFire).mock.calls[0][1]).toEqual({ signal: controller.signal });
	});

	it("honours its abort signal: aborting rejects the fetch", async () => {
		const controller = new AbortController();
		// Rejects only when the signal it receives aborts; with none it resolves, so a fetch that
		// ignored the signal would not reject.
		const honouring = (async (_q: unknown, o?: { signal?: AbortSignal }) => {
			const signal = o?.signal;
			if (!signal) return [];
			return new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			});
		}) as never;
		vi.mocked(getHMSSmoke).mockImplementation(honouring);
		vi.mocked(getHMSFire).mockImplementation(honouring);
		const source = await hmsEntry.source({ data: { layers: [] }, entryType: "pm25" });
		const pending = (source as Src).fetch(controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
});
