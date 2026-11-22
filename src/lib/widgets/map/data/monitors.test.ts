import type { MonitorLatest } from "@sjvair/sdk";
import type { NowSource } from "$lib/data/now/client";
type Src = NowSource<MonitorLatest[]>;
import {
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkMonthly,
	getMonitors
} from "@sjvair/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@sjvair/sdk", () => ({
	getMonitors: vi.fn(),
	getMonitorSummariesBulkDaily: vi.fn(),
	getMonitorSummariesBulkMonthly: vi.fn()
}));
vi.mock("$lib/data", () => ({
	getResolvers: () => ({ regions: { resolve: async () => null } }),
	placeRegion: async () => null
}));

import type { Snapshot, SnapshotFigure } from "$lib/data/snapshot";
import {
	createMonitorsEntry,
	isThin,
	snapshotScope,
	thinDays,
	toDayFeatures,
	toMonitorFeatures
} from "./monitors";

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

/** A Map's data: `where` on the data, `layer` on its PM2.5 layer (PurpleAir ticked by default). */
const data = (where: object, layer: object = { monitorTypes: ["purpleair"] }) => ({
	data: {
		...where,
		layers: [{ dataset: "air-quality", entryType: "pm25", ...layer }]
	} as never,
	entryType: "pm25",
	at: "now" as const
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
	it("fetches a region's monitors of the ticked types from the at endpoint", async () => {
		get.mockResolvedValue([monitor("a"), monitor("b", { type: "airnow" })]);
		const source = await entry().source(
			data({ place: { kind: "region", type: "county", code: "06019" } })
		);
		expect(source).toMatchObject({
			key: "map-monitors:pm25:monitor-set:purpleair|r1|",
			cadence: "raw"
		});
		const found = await (source as Src).fetch(new AbortController().signal);
		expect(get).toHaveBeenCalledWith("pm25", { timestamp: now, region: ["r1"] }, expect.anything());
		// Kept by type here: the readings endpoints have no type filter.
		expect(found.map((m) => m.id)).toEqual(["a"]);
	});

	it("ticked types with no Where read every current monitor of them", async () => {
		get.mockResolvedValue([monitor("a"), monitor("b", { type: "airnow" })]);
		const source = await entry().source(data({}));
		const found = await (source as Src).fetch(new AbortController().signal);
		expect(get).toHaveBeenCalledExactlyOnceWith("pm25", undefined, expect.anything());
		expect(found.map((m) => m.id)).toEqual(["a"]);
	});

	it("adds searched monitors from outside the areas", async () => {
		get.mockImplementation((async (_type: string, config?: object) =>
			config
				? [monitor("a")]
				: [monitor("a"), monitor("far", { type: "airnow" }), monitor("c")]) as never);
		const source = await entry().source(
			data(
				{ place: { kind: "region", type: "county", code: "06019" } },
				{ monitorTypes: ["purpleair"], monitors: ["far"] }
			)
		);
		const found = await (source as Src).fetch(new AbortController().signal);
		expect(found.map((m) => m.id)).toEqual(["a", "far"]);
	});

	it("filters searched monitors alone to their ids", async () => {
		get.mockResolvedValue([monitor("a"), monitor("b"), monitor("c")]);
		const source = await entry().source(data({}, { monitors: ["c", "a"] }));
		const found = await (source as Src).fetch(new AbortController().signal);
		expect(found.map((m) => m.id)).toEqual(["a", "c"]);
		expect(get).toHaveBeenCalledWith("pm25", undefined, expect.anything());
	});

	it("draws no monitors with no ticked types and no searched monitors", async () => {
		const where = { place: { kind: "region", type: "county", code: "06019" } };
		expect(await entry().source(data(where, {}))).toBeNull();
		expect(get).not.toHaveBeenCalled();
	});

	it("says why when the scope is unavailable", async () => {
		const source = await entry(null).source(
			data({ place: { kind: "region", type: "county", code: "x" } })
		);
		expect(source).toEqual({ unavailable: "region-unresolved" });
	});

	it("has no source when there is no pollutant layer", async () => {
		const source = await entry().source({ data: { layers: [] }, entryType: "pm25", at: "now" });
		expect(source).toBeNull();
	});

	it("gives a monitors data source with the pollutant's scale", () => {
		const out = entry().toDataSources([monitor("a")], { messages: noMessages, entryType: "pm25" });
		expect(out.monitors.scale).toEqual({ dataset: "air-quality", entryType: "pm25" });
		expect(out.monitors.features?.features).toHaveLength(1);
	});
});

/** PurpleAir monitors in the region `r1`. */
const SET = {
	kind: "monitor-set" as const,
	types: ["purpleair"],
	regionIds: ["r1"],
	ids: [],
	key: "purpleair|r1|"
};

describe("a day's monitors", () => {
	const snapshot = (entries: [string, SnapshotFigure][]): Snapshot => ({
		figures: new Map(entries),
		final: true,
		unrated: false
	});

	it("draws the listed monitors with a figure that day, at the list's positions", () => {
		const list = [monitor("a", { is_active: false }), monitor("b"), monitor("c")];
		const out = toDayFeatures(
			list,
			snapshot([
				["a", { value: 20, level: null, kind: "rated" }],
				["b", { value: null, level: null, kind: "thin" }],
				["z", { value: 5, level: null, kind: "rated" }]
			])
		);
		expect(out.features.map((f) => f.properties.refKey)).toEqual(["monitor:a", "monitor:b"]);
		// The day's figure, active that day (it was reporting), no reading time.
		expect(out.features[0].properties).toEqual({
			refKey: "monitor:a",
			name: "A",
			value: 20,
			type: "purpleair",
			isActive: true,
			isSjvair: true,
			location: "outside",
			timestamp: null
		});
		expect(out.features[0].geometry.coordinates).toEqual([-119.7, 36.7]);
		// Not enough data: drawn with no value (no level), marked thin for the plugin's detail.
		expect(out.features[1].properties.value).toBeNull();
		expect(isThin(out.features[1].properties)).toBe(true);
		expect(isThin(out.features[0].properties)).toBe(false);
		expect(thinDays(out.features[1].properties)).toBeUndefined();
	});

	it("a thin month keeps its day counts for the plugin's detail", () => {
		const out = toDayFeatures(
			[monitor("a")],
			snapshot([
				["a", { value: null, level: null, kind: "thin", days: { days: 20, expected: 31 } }]
			])
		);
		expect(isThin(out.features[0].properties)).toBe(true);
		expect(thinDays(out.features[0].properties)).toEqual({ days: 20, expected: 31 });
	});

	it("a month with none of its days' figures keeps the 0-of-N counts, said plainly", () => {
		const out = toDayFeatures(
			[monitor("a")],
			snapshot([["a", { value: null, level: null, kind: "thin", days: { days: 0, expected: 30 } }]])
		);
		expect(thinDays(out.features[0].properties)).toEqual({ days: 0, expected: 30 });
		expect(m.map_period_days_with_figure({ days: "0", expected: "30", expectedValue: 30 })).toBe(
			"Only 0 of 30 days had a figure"
		);
		// Never "of 1 days".
		expect(m.map_period_days_with_figure({ days: "0", expected: "1", expectedValue: 1 })).toBe(
			"Only 0 of 1 day had a figure"
		);
	});

	it("maps the places' scope onto the snapshot's, with a stable key", () => {
		const set = {
			kind: "monitor-set" as const,
			types: ["purpleair"],
			regionIds: ["r1", "r2"],
			ids: [],
			key: "purpleair|r1,r2|"
		};
		expect(snapshotScope(set)).toEqual({
			scope: { kind: "monitor-set", types: ["purpleair"], regionIds: ["r1", "r2"], ids: [] },
			scopeKey: "monitor-set:purpleair|r1,r2|"
		});
		expect(snapshotScope({ kind: "monitors", ids: ["a"], key: "a" })).toEqual({
			scope: { kind: "monitors", ids: ["a"] },
			scopeKey: "monitors:a"
		});
	});

	it("gives the resolved scope with the list source", async () => {
		const source = await entry().source(
			data({ place: { kind: "region", type: "county", code: "06019" } })
		);
		expect(source).toMatchObject({ scope: { kind: "monitor-set", regionIds: ["r1"] } });
	});

	it("a day's source keys by pollutant, scope and day, and reads the pollutant's figure", async () => {
		const bulk = vi.mocked(getMonitorSummariesBulkDaily);
		bulk.mockResolvedValue([
			{ id: "a", summaries: [{ timestamp: "2026-09-09T07:00:00Z", is_final: true, max_1h: 61 }] }
		] as never);
		const rating = {
			figure: vi.fn(async () => ({ field: "max_1h", label: null })),
			levels: vi.fn(async () => [])
		};
		const source = entry().stopSource({
			scope: SET,
			entryType: "o3",
			at: { day: "2026-09-09" },
			rating,
			today: () => "2026-11-15"
		});
		expect(source.key).toBe("snapshot:monitors:o3:monitor-set:purpleair|r1|:2026-09-09");
		expect(source.cadence).toBe("hour");
		const snap = await source.fetch(new AbortController().signal);
		expect(rating.figure).toHaveBeenCalledWith("o3", "day", expect.anything());
		expect(bulk.mock.calls[0][0]).toEqual({
			entryType: "o3",
			start: "2026-09-09",
			end: "2026-09-09",
			region: ["r1"],
			type: ["purpleair"]
		});
		expect(snap.figures.get("a")).toMatchObject({ value: 61, kind: "rated" });
		expect(source.poll(snap)).toBe(false);
	});

	it("a month's source reads the bulk monthly summaries and the month's figure", async () => {
		const bulk = vi.mocked(getMonitorSummariesBulkMonthly);
		bulk.mockResolvedValue([
			{
				id: "a",
				summaries: [{ timestamp: "2026-09-01T07:00:00Z", is_final: true, daily_statistic_mean: 14 }]
			}
		] as never);
		const rating = {
			figure: vi.fn(async () => ({ field: "daily_statistic_mean", label: "Average" })),
			levels: vi.fn(async () => [])
		};
		const source = entry().stopSource({
			scope: SET,
			entryType: "pm25",
			at: { start: "2026-09-01", resolution: "month" },
			rating,
			today: () => "2026-11-15"
		});
		expect(source.key).toBe("snapshot:monitors:pm25:monitor-set:purpleair|r1|:month:2026-09-01");
		const snap = await source.fetch(new AbortController().signal);
		expect(rating.figure).toHaveBeenCalledWith("pm25", "month", expect.anything());
		expect(vi.mocked(getMonitorSummariesBulkDaily)).not.toHaveBeenCalled();
		expect(bulk.mock.calls[0][0]).toEqual({
			entryType: "pm25",
			start: "2026-09-01",
			end: "2026-09-30",
			region: ["r1"],
			type: ["purpleair"]
		});
		expect(snap.figures.get("a")).toMatchObject({ value: 14, kind: "rated" });
		expect(source.poll(snap)).toBe(false);
	});
});
