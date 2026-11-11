import { getRegionsGeoJSON } from "@sjvair/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getRegionsGeoJSON: vi.fn() }));

const geojson = vi.mocked(getRegionsGeoJSON);

function feature(type: string, code: string) {
	return {
		type: "Feature" as const,
		id: `${type}-${code}`,
		geometry: {
			type: "Polygon" as const,
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 0]
				]
			]
		},
		properties: { id: code, name: code, slug: code, type, external_id: code, retired: null }
	};
}

function answer() {
	geojson.mockImplementation(async (query) => {
		const codes = ([] as string[]).concat(query.external_id ?? []);
		return {
			type: "FeatureCollection" as const,
			features: codes.filter((c) => c !== "gone").map((c) => feature(query.type, c))
		} as never;
	});
}

// A fresh module per test, so its page-wide cache starts empty.
async function load() {
	vi.resetModules();
	return (await import("./regions")).regionShapes;
}

beforeEach(() => {
	geojson.mockReset();
	answer();
});

describe("regionShapes", () => {
	it("groups codes by type, one request each", async () => {
		const regionShapes = await load();
		const shapes = await regionShapes([
			{ type: "county", code: "06019" },
			{ type: "city", code: "fresno" },
			{ type: "county", code: "06107" }
		]);
		expect(geojson).toHaveBeenCalledTimes(2);
		expect(geojson).toHaveBeenCalledWith(
			{ type: "county", external_id: ["06019", "06107"], simplify: true },
			expect.anything()
		);
		expect(geojson).toHaveBeenCalledWith(
			{ type: "city", external_id: ["fresno"], simplify: true },
			expect.anything()
		);
		expect([...shapes.keys()].sort()).toEqual(["city:fresno", "county:06019", "county:06107"]);
	});

	it("caches by type:code", async () => {
		const regionShapes = await load();
		await regionShapes([{ type: "county", code: "06019" }]);
		const shapes = await regionShapes([
			{ type: "county", code: "06019" },
			{ type: "county", code: "06107" }
		]);
		expect(geojson).toHaveBeenCalledTimes(2);
		expect(geojson).toHaveBeenLastCalledWith(
			{ type: "county", external_id: ["06107"], simplify: true },
			expect.anything()
		);
		expect(shapes.size).toBe(2);
		await regionShapes([{ type: "county", code: "06107" }]);
		expect(geojson).toHaveBeenCalledTimes(2);
	});

	it("leaves out a region the server doesn't return", async () => {
		const regionShapes = await load();
		const shapes = await regionShapes([
			{ type: "county", code: "06019" },
			{ type: "county", code: "gone" }
		]);
		expect([...shapes.keys()]).toEqual(["county:06019"]);
	});

	it("passes the signal on", async () => {
		const regionShapes = await load();
		const controller = new AbortController();
		await regionShapes([{ type: "county", code: "06019" }], controller.signal);
		expect(geojson).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal });
	});
});
