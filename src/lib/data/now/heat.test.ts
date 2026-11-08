import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getHeatForPlace: vi.fn() }));

import { getHeatForPlace } from "@sjvair/sdk";
import type { AdapterContext } from "../adapters/registry";
import type { Level } from "../metadata";
import type { Layer } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import { heatSource, type HeatToday } from "./heat";

// 2026-11-08 10:00 Pacific; at 05:30Z on the 9th it is 21:30 Pacific on the 8th.
const NOW = new Date("2026-11-08T18:00:00Z");
const LATE = new Date("2026-11-09T05:30:00Z");

function heatLevel(value: string, label: string): Level {
	return {
		key: label.toLowerCase(),
		label,
		color: "#888888",
		opacity: null,
		tier: null,
		guidance: "",
		description: "",
		min: 0,
		max: null,
		value
	};
}
const LEVELS = [heatLevel("0", "Low"), heatLevel("1", "Moderate"), heatLevel("3", "Severe")];

const ctx: AdapterContext = {
	metadata: fixtureMetadata({
		datasetLevels: async (dataset) => (dataset === "calheatscore" ? LEVELS : [])
	}),
	regions: {
		resolve: async (type, code) =>
			type === "county" && code === "06019"
				? { id: "sq1", name: "Fresno County" }
				: type === "zipcode" && code === "93721"
					? { id: "sq2", name: "93721" }
					: null
	},
	locations: {
		resolve: async (source, code) =>
			source === "school" && code === "s1"
				? { name: "Roosevelt", keys: ["zipcode:93721", "city:fresno", "county:06019"] }
				: source === "school" && code === "nozip"
					? { name: "No zip", keys: ["county:06019"] }
					: null
	},
	points: { keys: async () => ["zipcode:93721", "county:06019"] }
};

const get = vi.mocked(getHeatForPlace);

function response(zipCount: number, days: Array<{ date: string; score: number; zipcode: string }>) {
	return {
		place: {},
		zip_count: zipCount,
		days: days.map((d) => ({ ...d, score_display: "x" }))
	} as never;
}

async function load(
	layer: Layer,
	now: Date = NOW
): Promise<{ heat: HeatToday; key: string } | { unavailable: string }> {
	const source = await heatSource(layer, ctx, () => now);
	if ("unavailable" in source) return source;
	return { heat: await source.fetch(new AbortController().signal), key: source.key };
}

const region = (type: string, code: string) =>
	({ dataset: "air-quality", entryType: "pm25", place: { kind: "region", type, code } }) as Layer;

beforeEach(() => get.mockReset());

describe("heatSource", () => {
	it("asks a school's ZIP for today's date and matches the level by value", async () => {
		get.mockResolvedValue(response(1, [{ date: "2026-11-08", score: 1, zipcode: "93721" }]));
		const layer = {
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "location", source: "school", code: "s1" }
		} as Layer;
		const r = (await load(layer)) as { heat: HeatToday; key: string };
		expect(get.mock.calls[0][0]).toEqual({ region: { type: "zipcode", external_id: "93721" } });
		expect(get.mock.calls[0][1]).toEqual({ date: "2026-11-08" });
		expect(r.heat?.level?.label).toBe("Moderate");
		expect(r.heat?.highest).toBeUndefined();
		expect(r.key).toContain("zipcode:93721");
	});

	it("asks a monitor by id", async () => {
		get.mockResolvedValue(response(1, [{ date: "2026-11-08", score: 0, zipcode: "93721" }]));
		const layer = {
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "monitor", id: "m-pa" }
		} as Layer;
		await load(layer);
		expect(get.mock.calls[0][0]).toEqual({ monitor: "m-pa" });
	});

	it("labels the highest ZIP when the place covers more than one", async () => {
		get.mockResolvedValue(response(58, [{ date: "2026-11-08", score: 3, zipcode: "93210" }]));
		const r = (await load(region("county", "06019"))) as { heat: HeatToday };
		expect(r.heat?.level?.label).toBe("Severe");
		expect(r.heat?.highest).toEqual({ zip: "93210", placeName: "Fresno County" });
	});

	it("keeps a score the heat scale has no level for", async () => {
		get.mockResolvedValue(response(1, [{ date: "2026-11-08", score: 2, zipcode: "93721" }]));
		const r = (await load(region("county", "06019"))) as { heat: HeatToday };
		expect(r.heat).toEqual({ level: undefined });
	});

	it("is null with no score today", async () => {
		get.mockResolvedValue(response(58, []));
		const r = (await load(region("county", "06019"))) as { heat: HeatToday };
		expect(r.heat).toBeNull();
		get.mockResolvedValue(response(1, [{ date: "2026-11-07", score: 1, zipcode: "93721" }]));
		expect(((await load(region("county", "06019"))) as { heat: HeatToday }).heat).toBeNull();
	});

	it("is null when the server does not know the place", async () => {
		const notFound = new Error("x", { cause: { result: { status: 404 } } });
		get.mockRejectedValueOnce(notFound);
		expect(((await load(region("county", "06019"))) as { heat: HeatToday }).heat).toBeNull();
	});

	it("has no heat for a school without a ZIP", async () => {
		const layer = {
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "location", source: "school", code: "nozip" }
		} as Layer;
		expect(await load(layer)).toEqual({ unavailable: "place-unsupported" });
	});

	it("uses the Pacific date, not the browser's", async () => {
		get.mockResolvedValue(response(1, []));
		await load(region("county", "06019"), LATE);
		expect(get.mock.calls[0][1]).toEqual({ date: "2026-11-08" });
	});

	it("never puts a point's coordinates in the key", async () => {
		const layer = {
			dataset: "air-quality",
			entryType: "pm25",
			place: { kind: "point", lat: 36.7, lon: -119.8 }
		} as Layer;
		get.mockResolvedValue(response(1, []));
		const r = (await load(layer)) as { key: string };
		expect(r.key).toContain("zipcode:93721");
		expect(r.key).not.toMatch(/36\.7|119\.8/);
	});
});
