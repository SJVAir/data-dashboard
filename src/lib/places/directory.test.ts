import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMonitorsList, getRegionsList, getRegionsMeta } from "@sjvair/sdk";
import { fixtureMetadata } from "$lib/data/testing/fixtures";
import type { RegionResolver } from "$lib/data/adapters/registry";
import { createPlaceDirectory } from "./directory";
import { refOf, sameRef, type PlaceOption } from "./types";

vi.mock("@sjvair/sdk");

const META = {
	types: {
		county: {
			type: "county",
			label: "County",
			label_plural: "Counties",
			count: 8,
			parents: [],
			browsable: true
		},
		zipcode: {
			type: "zipcode",
			label: "ZIP code",
			label_plural: "ZIP Codes",
			count: 300,
			parents: ["county"],
			browsable: true
		},
		tract: { type: "tract", label: "Tract", count: 900, parents: [], browsable: false },
		empty: { type: "empty", label: "Empty", count: 0, parents: [], browsable: true }
	},
	location_types: {
		school: { type: "school", label: "School", source: "cde" }
	}
};

const regions: RegionResolver = {
	resolve: vi.fn(async (type, code) =>
		type === "county" && code === "06107" ? { id: "sq1", name: "Tulare County" } : null
	)
};

function directory() {
	const metadata = fixtureMetadata({
		monitors: async () => [
			{ id: "a", name: "Zed", type: "purpleair", county: "Fresno", active: true },
			{ id: "b", name: "Amy", type: "purpleair", county: "", active: false },
			{ id: "c", name: "Bob", type: "airnow", county: "Kern", active: true },
			{ id: "d", name: "Cat", type: "purpleair", county: "Kern", active: true }
		],
		monitorTypes: async () => [
			{ type: "purpleair", label: "PurpleAir", entryTypes: ["pm25"] },
			{ type: "airnow", label: "AirNow", entryTypes: ["pm25", "o3"] }
		]
	});
	return createPlaceDirectory({ metadata, regions });
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(regions.resolve).mockImplementation(async (type, code) =>
		type === "county" && code === "06107" ? { id: "sq1", name: "Tulare County" } : null
	);
	vi.mocked(getRegionsMeta).mockResolvedValue(META as never);
});

describe("regionTypes and locationTypes", () => {
	it("drops unbrowsable and empty types, keeps order, plural is label_plural", async () => {
		const types = await directory().regionTypes();
		expect(types.map((t) => t.type)).toEqual(["county", "zipcode"]);
		expect(types[1]).toEqual({
			type: "zipcode",
			label: "ZIP code",
			plural: "ZIP Codes",
			count: 300,
			parents: ["county"]
		});
	});

	it("labels every region type, browsable or not", async () => {
		const labels = await directory().regionTypeLabels();
		expect(labels.get("tract")).toBe("Tract");
		expect(labels.get("empty")).toBe("Empty");
		expect(labels.get("county")).toBe("County");
	});

	it("lists location types and fetches the meta once", async () => {
		const d = directory();
		expect(await d.locationTypes()).toEqual([{ type: "school", label: "School", source: "cde" }]);
		await d.regionTypes();
		expect(getRegionsMeta).toHaveBeenCalledTimes(1);
	});
});

describe("monitors", () => {
	it("hides monitors whose type cannot supply the entry type", async () => {
		const ids = (await directory().monitors("o3", { activeOnly: false })).map((m) => m.id);
		expect(ids).toEqual(["c"]);
	});

	it("sorts active first then by name, with the network label", async () => {
		const list = await directory().monitors("pm25", { activeOnly: false });
		expect(list.map((m) => m.name)).toEqual(["Bob", "Cat", "Zed", "Amy"]);
		expect(list[0]).toEqual({
			kind: "monitor",
			id: "c",
			name: "Bob",
			network: "AirNow",
			county: "Kern",
			active: true
		});
	});

	it("drops inactive monitors with activeOnly", async () => {
		const list = await directory().monitors("pm25", { activeOnly: true });
		expect(list.map((m) => m.id)).toEqual(["c", "d", "a"]);
	});
});

describe("monitorsIn", () => {
	it("resolves the parent and keeps the monitors the server lists inside it", async () => {
		vi.mocked(getMonitorsList).mockResolvedValue([{ id: "d" }, { id: "a" }, { id: "x" }] as never);
		const list = await directory().monitorsIn(
			"pm25",
			{ type: "county", code: "06107" },
			{ activeOnly: false }
		);
		expect(getMonitorsList).toHaveBeenCalledWith({ region: "sq1" });
		expect(list.map((m) => m.id)).toEqual(["d", "a"]);
	});

	it("is empty when the parent does not resolve", async () => {
		const list = await directory().monitorsIn(
			"pm25",
			{ type: "county", code: "nope" },
			{ activeOnly: false }
		);
		expect(list).toEqual([]);
		expect(getMonitorsList).not.toHaveBeenCalled();
	});
});

describe("regionsIn", () => {
	const rows = [
		{ id: "r1", name: "93201", type: "zipcode", external_id: "93201", retired: null },
		{
			id: "r2",
			name: "93202",
			type: "zipcode",
			external_id: "93202",
			retired: { since: "2024-01-01", replaced_by: null }
		}
	];

	it("resolves the parent and lists within its sqid, leaving retired rows out", async () => {
		vi.mocked(getRegionsList).mockResolvedValue(rows as never);
		const list = await directory().regionsIn("zipcode", { type: "county", code: "06107" });
		expect(getRegionsList).toHaveBeenCalledWith({ type: "zipcode", within: "sq1" });
		expect(list).toEqual([
			{
				kind: "region",
				type: "zipcode",
				code: "93201",
				name: "93201",
				typeLabel: "ZIP code",
				county: null
			}
		]);
	});

	it("lists a whole type without a parent and fetches each key once", async () => {
		vi.mocked(getRegionsList).mockResolvedValue(rows as never);
		const d = directory();
		await d.regionsIn("zipcode", null);
		await d.regionsIn("zipcode", null);
		expect(getRegionsList).toHaveBeenCalledTimes(1);
		expect(getRegionsList).toHaveBeenCalledWith({ type: "zipcode" });
	});

	it("is empty when the parent does not resolve", async () => {
		const list = await directory().regionsIn("zipcode", { type: "county", code: "nope" });
		expect(list).toEqual([]);
		expect(getRegionsList).not.toHaveBeenCalled();
	});
});

describe("refOf and sameRef", () => {
	const options: PlaceOption[] = [
		{ kind: "monitor", id: "a", name: "A", network: "N", county: "", active: true },
		{ kind: "region", type: "county", code: "06107", name: "T", typeLabel: "County", county: null },
		{
			kind: "location",
			source: "cde",
			code: "1",
			name: "S",
			typeLabel: "School",
			city: "",
			zip: "",
			address: ""
		}
	];

	it("round-trips each kind", () => {
		expect(options.map(refOf)).toEqual([
			{ kind: "monitor", id: "a" },
			{ kind: "region", type: "county", code: "06107" },
			{ kind: "location", source: "cde", code: "1" }
		]);
		for (const o of options) expect(sameRef(refOf(o), refOf(o))).toBe(true);
	});

	it("tells different places apart", () => {
		expect(sameRef(refOf(options[0]), refOf(options[1]))).toBe(false);
		expect(
			sameRef(
				{ kind: "region", type: "county", code: "1" },
				{ kind: "region", type: "county", code: "2" }
			)
		).toBe(false);
		expect(sameRef({ kind: "point", lat: 1, lon: 2 }, { kind: "point", lat: 1, lon: 2 })).toBe(
			true
		);
	});
});
