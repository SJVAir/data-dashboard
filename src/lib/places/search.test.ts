import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchLocations, searchRegionPlaces } from "@sjvair/sdk";
import type { PlaceDirectory } from "./directory";
import { matchMonitors, searchPlaces, MONITOR_RESULTS } from "./search";
import type { MonitorOption } from "./types";

vi.mock("@sjvair/sdk");

function monitor(name: string, active = true): MonitorOption {
	return { kind: "monitor", id: name, name, network: "PurpleAir", county: "Fresno", active };
}

function directory(monitors: MonitorOption[] = []): PlaceDirectory {
	return {
		regionTypes: vi.fn(async () => []),
		regionTypeLabels: vi.fn(
			async () =>
				new Map([
					["zipcode", "ZIP code"],
					["tract", "Tract"]
				])
		),
		locationTypes: vi.fn(async () => [
			{ type: "public_school", label: "Public school", source: "cde-public" }
		]),
		monitors: vi.fn(async () => monitors),
		regionsIn: vi.fn(async () => [])
	};
}

const ctx = (d: PlaceDirectory) => ({ directory: d, entryType: "pm25", activeOnly: false });
const signal = () => new AbortController().signal;

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(searchLocations).mockResolvedValue({ results: [], more: false });
	vi.mocked(searchRegionPlaces).mockResolvedValue([]);
});

describe("searchPlaces", () => {
	it("makes no request under 2 trimmed characters", async () => {
		const d = directory([monitor("Fresno")]);
		const result = await searchPlaces("  f ", ctx(d), signal());
		expect(searchLocations).not.toHaveBeenCalled();
		expect(searchRegionPlaces).not.toHaveBeenCalled();
		expect(d.monitors).not.toHaveBeenCalled();
		for (const g of [result.locations, result.regions, result.monitors]) {
			expect(g).toEqual({ status: "ready", options: [], more: false });
		}
	});

	it("starts the three searches together with the signal", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		vi.mocked(searchLocations).mockImplementation(async () => {
			await gate;
			return { results: [], more: false };
		});
		const d = directory();
		const s = signal();
		const pending = searchPlaces(" fre ", ctx(d), s);
		await Promise.resolve();
		expect(searchLocations).toHaveBeenCalledWith({ q: "fre", signal: s });
		expect(searchRegionPlaces).toHaveBeenCalledWith("fre", undefined, { signal: s });
		expect(d.monitors).toHaveBeenCalledWith("pm25", { activeOnly: false }, s);
		release();
		expect((await pending).query).toBe("fre");
	});

	it("turns one rejected group into an error and keeps the others", async () => {
		const boom = new Error("boom");
		vi.mocked(searchRegionPlaces).mockRejectedValue(boom);
		const result = await searchPlaces("fre", ctx(directory([monitor("Fresno")])), signal());
		expect(result.regions).toEqual({ status: "error", error: boom });
		expect(result.locations.status).toBe("ready");
		expect(result.monitors.status).toBe("ready");
	});

	it("drops retired regions and labels rows from all metadata types, dropping unlabeled ones", async () => {
		vi.mocked(searchRegionPlaces).mockResolvedValue([
			{ id: "1", name: "93721", type: "zipcode", external_id: "93721", retired: null },
			{ id: "2", name: "93000", type: "zipcode", external_id: "93000", retired: { since: "x" } },
			{ id: "3", name: "Tract 1", type: "tract", external_id: "t1", retired: null },
			{ id: "5", name: "Ghost", type: "mystery", external_id: "g1", retired: null },
			{ id: "4", name: "NoCode", type: "zipcode", external_id: null, retired: null }
		] as never);
		const result = await searchPlaces("93", ctx(directory()), signal());
		expect(result.regions).toEqual({
			status: "ready",
			more: false,
			options: [
				{
					kind: "region",
					type: "zipcode",
					code: "93721",
					name: "93721",
					typeLabel: "ZIP code",
					county: null
				},
				{
					kind: "region",
					type: "tract",
					code: "t1",
					name: "Tract 1",
					typeLabel: "Tract",
					county: null
				}
			]
		});
	});

	it("maps locations, labels them, drops retired and passes more through", async () => {
		vi.mocked(searchLocations).mockResolvedValue({
			results: [
				{
					source: "cde-public",
					external_id: "1",
					type: "public_school",
					name: "Lincoln",
					address: "1 Main",
					city_name: "Visalia",
					zip: "93291",
					retired: null
				},
				{
					source: "cde-public",
					external_id: "2",
					type: "public_school",
					name: "Old",
					address: "",
					city_name: "",
					zip: "",
					retired: { since: "x", replaced_by: null }
				},
				{
					source: "cde-public",
					external_id: "3",
					type: "mystery",
					name: "Unlabeled",
					address: "",
					city_name: "",
					zip: "",
					retired: null
				}
			],
			more: true
		} as never);
		const result = await searchPlaces("lin", ctx(directory()), signal());
		expect(result.locations).toEqual({
			status: "ready",
			more: true,
			options: [
				{
					kind: "location",
					source: "cde-public",
					code: "1",
					name: "Lincoln",
					typeLabel: "Public school",
					city: "Visalia",
					zip: "93291",
					address: "1 Main"
				}
			]
		});
	});

	it("rejects when the signal is aborted and resolves no group after", async () => {
		const c = new AbortController();
		vi.mocked(searchLocations).mockImplementation(async () => {
			c.abort();
			return { results: [], more: false };
		});
		await expect(searchPlaces("fre", ctx(directory()), c.signal)).rejects.toMatchObject({
			name: "AbortError"
		});
	});
});

describe("matchMonitors", () => {
	it("ranks name-start, then word-start, then substring matches", () => {
		const { options } = matchMonitors(
			[
				monitor("Clovis Freeway"),
				monitor("Xfresno"),
				monitor("Fresno - Garland"),
				monitor("Other")
			],
			"fre"
		);
		expect(options.map((m) => m.name)).toEqual(["Fresno - Garland", "Clovis Freeway", "Xfresno"]);
	});

	it("puts active before not reporting, then name", () => {
		const { options } = matchMonitors(
			[monitor("Fresno B", false), monitor("Fresno C"), monitor("Fresno A")],
			"fre"
		);
		expect(options.map((m) => m.name)).toEqual(["Fresno A", "Fresno C", "Fresno B"]);
	});

	it("caps at 10 and says there are more", () => {
		const many = Array.from({ length: 12 }, (_, i) =>
			monitor(`Fresno ${String(i).padStart(2, "0")}`)
		);
		const { options, more } = matchMonitors(many, "fre");
		expect(options).toHaveLength(MONITOR_RESULTS);
		expect(more).toBe(true);
		expect(matchMonitors(many.slice(0, 10), "fre").more).toBe(false);
	});
});
