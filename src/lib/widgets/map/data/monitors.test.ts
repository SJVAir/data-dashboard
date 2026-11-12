import type { MonitorLatest } from "@sjvair/sdk";
import type { NowSource } from "$lib/data/now/client";
type Src = NowSource<MonitorLatest[]>;
import { getMonitors } from "@sjvair/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getMonitors: vi.fn() }));
vi.mock("$lib/data", () => ({
	getResolvers: () => ({ regions: { resolve: async () => null } }),
	placeRegion: async () => null
}));

import { createMonitorsEntry, toMonitorFeatures } from "./monitors";

const get = vi.mocked(getMonitors);

function monitor(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		name: id.toUpperCase(),
		type: "purpleair",
		is_active: true,
		is_sjvair: true,
		location: "outside",
		position: { type: "Point", coordinates: [-119.7, 36.7] },
		latest: { value: "12.5", timestamp: "2026-11-12T10:00:00-08:00" },
		...extra
	} as never;
}

const now = new Date("2026-11-12T18:00:00Z");
const noMessages = (() => "") as never;

function entry(region: string | null = "r1") {
	return createMonitorsEntry({
		now: () => now,
		regions: { resolve: async () => (region ? { id: region, name: "x" } : null) } as never,
		placeRegion: async () => null
	});
}

const data = (layer: object) => ({
	data: { layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }] } as never,
	entryType: "pm25"
});

beforeEach(() => get.mockReset());

describe("toMonitorFeatures", () => {
	it("builds monitor features in map-sdk's shape, skipping monitors with no position", () => {
		const noPos = monitor("b", { position: null });
		expect(toMonitorFeatures([monitor("a"), noPos]).features).toHaveLength(1);
		expect(toMonitorFeatures([monitor("a")]).features[0].properties).toEqual({
			refKey: "monitor:a",
			name: "A",
			value: 12.5,
			type: "purpleair",
			isActive: true,
			isSjvair: true,
			location: "outside",
			timestamp: "2026-11-12T10:00:00-08:00"
		});
	});

	it("gives a missing or non-numeric value as null", () => {
		const f = toMonitorFeatures([monitor("a", { latest: { value: "", timestamp: "t" } })]);
		expect(f.features[0].properties.value).toBeNull();
	});
});

describe("monitorsEntry", () => {
	it("fetches a region's monitors from the at endpoint, keyed by server id", async () => {
		get.mockResolvedValue([monitor("a")]);
		const source = await entry().source(
			data({ place: { kind: "region", type: "county", code: "06019" } })
		);
		expect(source).toMatchObject({ key: "map-monitors:pm25:r1", cadence: "raw" });
		await (source as Src).fetch(new AbortController().signal);
		expect(get).toHaveBeenCalledWith("pm25", { timestamp: now, region: ["r1"] }, expect.anything());
	});

	it("filters a monitors scope to its ids", async () => {
		get.mockResolvedValue([monitor("a"), monitor("b"), monitor("c")]);
		const source = await entry().source(data({ selection: { kind: "monitors", ids: ["c", "a"] } }));
		const found = await (source as Src).fetch(new AbortController().signal);
		expect(found.map((m) => m.id)).toEqual(["a", "c"]);
		expect(get).toHaveBeenCalledWith("pm25", undefined, expect.anything());
	});

	it("says why when the scope is unavailable", async () => {
		const source = await entry(null).source(
			data({ place: { kind: "region", type: "county", code: "x" } })
		);
		expect(source).toEqual({ unavailable: "region-unresolved" });
	});

	it("has no source when there is no pollutant layer", async () => {
		const source = await entry().source({ data: { layers: [] }, entryType: "pm25" });
		expect(source).toBeNull();
	});

	it("gives a monitors data source with the pollutant's scale", () => {
		const out = entry().toDataSources([monitor("a")], { messages: noMessages, entryType: "pm25" });
		expect(out.monitors.scale).toEqual({ dataset: "air-quality", entryType: "pm25" });
		expect(out.monitors.features?.features).toHaveLength(1);
	});
});
