import type { Feature } from "geojson";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResolvers, placeRegion } from "$lib/data";
import type { Layer } from "$lib/data/schema";
import { MapFrame } from "./frame.svelte";
import { regionShapes } from "./regions";

vi.mock("@sjvair/map-sdk", () => ({ geometryBbox: () => null }));
vi.mock("$lib/data", () => ({ placeRegion: vi.fn(), getResolvers: vi.fn() }));
vi.mock("./regions", async (original) => ({
	...(await original<typeof import("./regions")>()),
	regionShapes: vi.fn()
}));

const resolve = vi.fn();
const base = { dataset: "air-quality", entryType: "pm25" };
const flush = () => new Promise((r) => setTimeout(r, 0));
const shape: Feature = {
	type: "Feature",
	properties: {},
	geometry: { type: "Point", coordinates: [0, 0] }
};

let frames: MapFrame[] = [];

function track(layer: () => Layer | undefined) {
	const f = new MapFrame(layer);
	frames.push(f);
	return f;
}

beforeEach(() => {
	vi.mocked(getResolvers).mockReturnValue({ locations: { resolve } } as never);
	vi.mocked(regionShapes).mockImplementation(
		async (refs) => new Map(refs.map((r) => [`${r.type}:${r.code}`, shape]))
	);
});

afterEach(() => {
	for (const f of frames) f.destroy();
	frames = [];
	vi.resetAllMocks();
});

describe("MapFrame", () => {
	it("a newer frame aborts the older lookup", async () => {
		const signals: AbortSignal[] = [];
		const answers: Array<(r: { type: string; code: string } | null) => void> = [];
		vi.mocked(placeRegion).mockImplementation(
			(_input, signal) =>
				new Promise((r) => {
					signals.push(signal!);
					answers.push(r);
				})
		);
		let layer = $state<Layer>({ ...base, place: { kind: "point", lat: 36.7, lon: -119.8 } });
		const f = track(() => layer);
		flushSync();
		expect(f.state).toBe("loading");
		layer = { ...base, place: { kind: "point", lat: 36.8, lon: -119.7 } };
		flushSync();
		expect(signals).toHaveLength(2);
		expect(signals[0].aborted).toBe(true);
		expect(signals[1].aborted).toBe(false);
		answers[1]({ type: "zipcode", code: "93711" });
		answers[0]({ type: "zipcode", code: "93721" });
		await flush();
		expect(f.state).toBe("ready");
		expect(f.frame).toEqual({
			monitors: [],
			regions: [{ type: "zipcode", code: "93711" }],
			pin: { kind: "point", lat: 36.8, lon: -119.7 },
			focus: "regions"
		});
		expect([...f.shapes.keys()]).toEqual(["zipcode:93711"]);
	});

	it("an unknown school is location-unresolved", async () => {
		resolve.mockResolvedValue(null);
		const f = track(() => ({ ...base, place: { kind: "location", source: "cde", code: "1" } }));
		flushSync();
		await flush();
		expect(f.state).toEqual({ unavailable: "location-unresolved" });
	});

	it("a school with no point is location-unresolved", async () => {
		resolve.mockResolvedValue({ name: "A School", keys: [] });
		const f = track(() => ({ ...base, place: { kind: "location", source: "cde", code: "1" } }));
		flushSync();
		await flush();
		expect(f.state).toEqual({ unavailable: "location-unresolved" });
	});

	it("a school is pinned at its point", async () => {
		resolve.mockResolvedValue({ name: "A School", keys: [], point: { lat: 36.7, lon: -119.8 } });
		const f = track(() => ({ ...base, place: { kind: "location", source: "cde", code: "1" } }));
		flushSync();
		await flush();
		expect(f.state).toBe("ready");
		expect(f.frame).toEqual({
			monitors: [],
			regions: [],
			pin: { kind: "location", name: "A School", lat: 36.7, lon: -119.8 },
			focus: "pin"
		});
	});

	it("a point outside every region is point-outside", async () => {
		vi.mocked(placeRegion).mockResolvedValue(null);
		const f = track(() => ({ ...base, place: { kind: "point", lat: 36.7, lon: -119.8 } }));
		flushSync();
		await flush();
		expect(f.state).toEqual({ unavailable: "point-outside" });
		expect(f.frame?.regions).toEqual([]);
	});

	it("a region with no geometry is region-unresolved", async () => {
		vi.mocked(regionShapes).mockResolvedValue(new Map());
		const f = track(() => ({ ...base, place: { kind: "region", type: "county", code: "x" } }));
		flushSync();
		await flush();
		expect(f.state).toEqual({ unavailable: "region-unresolved" });
	});

	it("a monitor is ready at once; nothing is idle", () => {
		const f = track(() => ({ ...base, place: { kind: "monitor", id: "m1" } }));
		flushSync();
		expect(f.state).toBe("ready");
		expect(f.frame?.monitors).toEqual(["m1"]);
		const g = track(() => undefined);
		flushSync();
		expect(g.state).toBe("idle");
		expect(g.frame?.focus).toBe("none");
	});

	it("a failed lookup is an error", async () => {
		const boom = new Error("offline");
		vi.mocked(regionShapes).mockRejectedValue(boom);
		const f = track(() => ({ ...base, place: { kind: "region", type: "county", code: "x" } }));
		flushSync();
		await flush();
		expect(f.state).toEqual({ error: boom });
	});

	it("retry looks the layer up again", async () => {
		vi.mocked(regionShapes).mockRejectedValueOnce(new Error("offline"));
		vi.mocked(regionShapes).mockImplementation(
			async (refs) => new Map(refs.map((r) => [`${r.type}:${r.code}`, shape]))
		);
		const f = track(() => ({ ...base, place: { kind: "region", type: "county", code: "x" } }));
		flushSync();
		await flush();
		expect(f.state).toHaveProperty("error");
		f.retry();
		flushSync();
		await flush();
		expect(f.state).toBe("ready");
		expect([...f.shapes.keys()]).toEqual(["county:x"]);
	});
});
