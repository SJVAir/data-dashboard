import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getDatasetCatalog: vi.fn(),
	getMonitorsMeta: vi.fn(),
	getMonitorsList: vi.fn()
}));

import { getDatasetCatalog, getMonitorsList, getMonitorsMeta } from "@sjvair/sdk";
import {
	createWebMetadata,
	levelFor,
	withCatalog,
	type CatalogEntry,
	type Level
} from "./metadata";
import { SDK_DATASET_CATALOG } from "./testing/dataset-catalog";

function lvl(
	key: string,
	label: string,
	color: string,
	tier: number,
	min: number | null,
	max: number | null
) {
	return {
		key,
		label,
		color,
		opacity: 0.8,
		tier,
		description: "",
		guidance: "",
		min,
		max,
		value: null
	};
}

const META = {
	monitors: {
		purpleair: {
			label: "PurpleAir",
			entries: { pm25: { default_calibration: "PM25_EPA_Calibration" } }
		},
		bam1022: { label: "BAM 1022", entries: { pm25: { default_calibration: "" } } }
	},
	entries: {
		pm25: {
			scale: {
				levels: [
					lvl("moderate", "Moderate", "#ffff00", 1, 9, 35.4),
					lvl("good", "Good", "#00e400", 0, null, 9),
					lvl("unhealthy", "Unhealthy", "#ff0000", 3, 35.4, null)
				]
			}
		},
		humidity: { scale: null }
	}
};

const LIST = [
	{
		id: "m-pa",
		name: "PA One",
		type: "purpleair",
		device: "PA-II",
		county: "Fresno",
		is_active: true
	},
	{ id: "m-bam", name: "BAM One", type: "bam1022", county: "", is_active: false }
];

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(getMonitorsMeta).mockResolvedValue(META as never);
	vi.mocked(getMonitorsList).mockResolvedValue(LIST as never);
	vi.mocked(getDatasetCatalog).mockResolvedValue(SDK_DATASET_CATALOG);
});

/** An error like the SDK's for a failed response. */
function httpError(status: number): Error {
	return Object.assign(new Error(`Request failed (${status})`), { status });
}

describe("createWebMetadata().catalog", () => {
	it("maps the server's dataset catalog", async () => {
		const catalog = await createWebMetadata().catalog();
		expect(catalog).not.toBe("unavailable");
		const [air, smoke] = catalog as CatalogEntry[];
		expect(air).toEqual({
			id: "air-quality",
			label: "Air Quality",
			description: "Air quality measurements from SJVAir sensors and partner monitoring networks.",
			source: "SJVAir sensors, AirNow, AQview, AQLite",
			geographies: ["monitor", "region"],
			metaUrl: "/api/2.0/monitors/meta/",
			entryTypes: [
				{
					id: "humidity",
					label: "Humidity",
					units: "%",
					kind: "meteorological",
					resolutions: ["raw"],
					precision: null,
					yMin: null
				},
				{
					id: "particulates",
					label: "Particulates",
					units: "",
					kind: "other",
					resolutions: ["raw"],
					precision: null,
					yMin: null
				},
				{
					id: "pm100",
					label: "PM10.0",
					units: "µg/m³",
					kind: "pollutant",
					resolutions: ["raw"],
					precision: null,
					yMin: null,
					available: false
				},
				{
					id: "pm25",
					label: "PM2.5",
					units: "µg/m³",
					kind: "pollutant",
					resolutions: ["raw", "hour", "day", "month", "quarter", "season", "year"],
					precision: null,
					yMin: null,
					available: true
				}
			]
		});
		expect(smoke).toMatchObject({
			id: "hms-smoke",
			license: "Public domain",
			geographies: ["polygon"]
		});
		expect("metaUrl" in smoke).toBe(false);
	});

	it("keeps unknown geographies, maps unknown kinds to other, and carries retirement", async () => {
		vi.mocked(getDatasetCatalog).mockResolvedValue({
			datasets: [
				{
					id: "old-sensors",
					label: "Old sensors",
					description: "",
					source: "",
					license: "",
					geographies: ["monitor", "watershed"],
					meta_url: "",
					places_url: "",
					entry_types: [
						{
							id: "pm25-old",
							label: "PM2.5 (old)",
							kind: "particle-count",
							units: "",
							resolutions: ["raw", "decade" as never, "day"],
							display: { precision: 1, chart: "line", y_min: 0 },
							retired: { since: "2026-01-01T00:00:00Z", replaced_by: "pm25" }
						},
						{
							id: "gone",
							label: "Gone",
							kind: "pollutant",
							units: "",
							resolutions: [],
							display: { precision: null, chart: null, y_min: null },
							retired: { since: "2026-02-01T00:00:00Z", replaced_by: null }
						}
					],
					retired: { since: "2026-03-01T00:00:00Z" }
				}
			],
			summary_rules: { complete_after_period_end: [] }
		});
		const [dataset] = (await createWebMetadata().catalog()) as CatalogEntry[];
		expect(dataset.geographies).toEqual(["monitor", "watershed"]);
		expect(dataset.retired).toEqual({ since: "2026-03-01T00:00:00Z" });
		expect(dataset.entryTypes[0]).toMatchObject({
			kind: "other",
			resolutions: ["raw", "day"],
			precision: 1,
			yMin: 0,
			retired: { since: "2026-01-01T00:00:00Z", replacedBy: "pm25" }
		});
		expect(dataset.entryTypes[1]).toMatchObject({ precision: null, yMin: null });
		expect(dataset.entryTypes[1].retired).toEqual({ since: "2026-02-01T00:00:00Z" });
		expect(dataset.description).toBeUndefined();
	});

	it("fetches the catalog once across several calls", async () => {
		const md = createWebMetadata();
		await md.catalog();
		await md.catalog();
		expect(getDatasetCatalog).toHaveBeenCalledTimes(1);
	});

	it("is unavailable when the server has no catalog endpoint (404)", async () => {
		vi.mocked(getDatasetCatalog).mockRejectedValue(httpError(404));
		expect(await createWebMetadata().catalog()).toBe("unavailable");
	});

	it("is unavailable for a response it can't read", async () => {
		vi.mocked(getDatasetCatalog).mockResolvedValue({ nope: true } as never);
		expect(await createWebMetadata().catalog()).toBe("unavailable");
	});

	it("retries after a failure", async () => {
		vi.mocked(getDatasetCatalog).mockRejectedValueOnce(httpError(503));
		const md = createWebMetadata();
		expect(await md.catalog()).toBe("unavailable");
		expect(await md.catalog()).toHaveLength(2);
		expect(getDatasetCatalog).toHaveBeenCalledTimes(2);
	});

	it("rejects only an aborted caller", async () => {
		let release!: () => void;
		vi.mocked(getDatasetCatalog).mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(SDK_DATASET_CATALOG)))
		);
		const md = createWebMetadata();
		const ctrl = new AbortController();
		const aborted = md.catalog(ctrl.signal);
		const other = md.catalog();
		ctrl.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		release();
		expect(await other).toHaveLength(2);
		expect(getDatasetCatalog).toHaveBeenCalledTimes(1);
	});
});

describe("createWebMetadata", () => {
	it("fetches the meta once across several calls", async () => {
		const md = createWebMetadata();
		await md.levels("pm25");
		await md.levels("pm25");
		await md.levels("humidity");
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
	});

	it("reads levels from the scale, ordered by min, a missing min as 0", async () => {
		const md = createWebMetadata();
		const levels = await md.levels("pm25");
		expect(levels.map((l) => l.key)).toEqual(["good", "moderate", "unhealthy"]);
		expect(levels[0]).toEqual({
			key: "good",
			label: "Good",
			color: "#00e400",
			opacity: 0.8,
			tier: 0,
			min: 0,
			max: 9
		});
		expect(levels[2].max).toBeNull();
		expect(await md.levels("humidity")).toEqual([]);
		expect(await md.levels("nope")).toEqual([]);
	});

	it("returns the default calibration, mapping empty and unknown to null", async () => {
		const md = createWebMetadata();
		expect(await md.defaultProcessor("purpleair", "pm25")).toBe("PM25_EPA_Calibration");
		expect(await md.defaultProcessor("bam1022", "pm25")).toBeNull();
		expect(await md.defaultProcessor("purpleair", "o3")).toBeNull();
		expect(await md.defaultProcessor("nope", "pm25")).toBeNull();
	});

	it("looks up monitor types and lists monitors from one fetch", async () => {
		const md = createWebMetadata();
		expect(await md.monitorType("m-pa")).toBe("purpleair");
		expect(await md.monitorType("unknown")).toBeNull();
		expect(await md.monitors()).toEqual([
			{ id: "m-pa", name: "PA One", type: "purpleair", county: "Fresno", active: true },
			{ id: "m-bam", name: "BAM One", type: "bam1022", county: "", active: false }
		]);
		expect(await md.monitorTypes()).toEqual([
			{ type: "purpleair", label: "PurpleAir", entryTypes: ["pm25"] },
			{ type: "bam1022", label: "BAM 1022", entryTypes: ["pm25"] }
		]);
		expect(getMonitorsList).toHaveBeenCalledTimes(1);
	});

	it("does not cache a failed fetch", async () => {
		vi.mocked(getMonitorsMeta).mockRejectedValueOnce(new Error("boom"));
		const md = createWebMetadata();
		await expect(md.levels("pm25")).rejects.toThrow("boom");
		expect((await md.levels("pm25")).length).toBe(3);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(2);
	});

	it("rejects an aborted caller without poisoning the memo for others", async () => {
		let release!: () => void;
		vi.mocked(getMonitorsMeta).mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(META as never)))
		);
		const md = createWebMetadata();
		const ctrl = new AbortController();
		const aborted = md.levels("pm25", ctrl.signal);
		const other = md.levels("pm25");
		ctrl.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		release();
		expect((await other).length).toBe(3);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
	});

	it("rejects immediately for an already-aborted signal", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		await expect(createWebMetadata().levels("pm25", ctrl.signal)).rejects.toMatchObject({
			name: "AbortError"
		});
	});
});

describe("withCatalog", () => {
	const catalog: CatalogEntry[] = [
		{ id: "air-quality", label: "Air quality", entryTypes: [], geographies: ["monitor"] }
	];

	it("returns the given catalog and delegates the rest", async () => {
		const md = withCatalog(createWebMetadata(), catalog);
		expect(await md.catalog()).toBe(catalog);
		expect((await md.levels("pm25")).length).toBe(3);
		expect(await md.defaultProcessor("purpleair", "pm25")).toBe("PM25_EPA_Calibration");
		expect(await md.monitorType("m-bam")).toBe("bam1022");
		expect((await md.monitors()).length).toBe(2);
	});
});

describe("levelFor", () => {
	const levels: Level[] = [
		{ key: "a", label: "A", color: null, opacity: null, tier: 0, min: 0, max: 9 },
		{ key: "b", label: "B", color: null, opacity: null, tier: 1, min: 9, max: 35.4 },
		{ key: "c", label: "C", color: null, opacity: null, tier: 2, min: 35.4, max: null }
	];

	it("finds the level holding the value in [min, max)", () => {
		expect(levelFor(levels, 0)?.key).toBe("a");
		expect(levelFor(levels, 8.9)?.key).toBe("a");
		expect(levelFor(levels, 9)?.key).toBe("b");
		expect(levelFor(levels, 35.4)?.key).toBe("c");
		expect(levelFor(levels, 9999)?.key).toBe("c");
	});

	it("is undefined below the first level", () => {
		expect(levelFor(levels, -1)).toBeUndefined();
		expect(levelFor([], 5)).toBeUndefined();
	});
});
