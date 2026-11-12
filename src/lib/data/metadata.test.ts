import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getDatasetCatalog: vi.fn(),
	getMonitorsMeta: vi.fn(),
	getMonitorsList: vi.fn(),
	getHMSMeta: vi.fn(),
	getForecastsMeta: vi.fn(),
	getCalHeatScoreMeta: vi.fn()
}));

import {
	getCalHeatScoreMeta,
	getDatasetCatalog,
	getForecastsMeta,
	getHMSMeta,
	getMonitorsList,
	getMonitorsMeta
} from "@sjvair/sdk";
import {
	createWebMetadata,
	levelFor,
	mapScaleLevels,
	type CatalogEntry,
	type Level
} from "./metadata";
import { fixtureMetadata } from "./testing/fixtures";
import {
	SDK_DATASET_CATALOG,
	WEATHER_DATASET,
	PESTICIDE_USE_DATASET
} from "./testing/dataset-catalog";

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
			expected_interval: "2 min",
			entries: {
				pm25: {
					default_calibration: "PM25_EPA_Calibration",
					alerts: {
						window: "60 min",
						min_coverage: 0.5,
						stage: "calibrated",
						processor: null,
						expected_interval: null
					}
				}
			}
		},
		bam1022: {
			label: "BAM 1022",
			expected_interval: "1 hour",
			entries: {
				pm25: {
					default_calibration: "",
					alerts: {
						window: "60 min",
						min_coverage: 0.5,
						stage: "cleaned",
						processor: null,
						expected_interval: null
					}
				},
				o3: {
					default_calibration: "",
					alerts: {
						window: "1h",
						min_coverage: 0.5,
						stage: "raw",
						processor: null,
						expected_interval: "30 min"
					}
				},
				pm10: { default_calibration: "", alerts: null }
			}
		}
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
					yMin: null,
					chart: null,
					aggregate: "mean"
				},
				{
					id: "particulates",
					label: "Particulates",
					units: "",
					kind: "other",
					resolutions: ["raw"],
					precision: null,
					yMin: null,
					chart: null,
					aggregate: "mean"
				},
				{
					id: "pm100",
					label: "PM10.0",
					units: "µg/m³",
					kind: "pollutant",
					resolutions: ["raw"],
					precision: null,
					yMin: null,
					chart: null,
					aggregate: "mean",
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
					chart: null,
					aggregate: "mean",
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
							aggregate: null,
							display: { precision: 1, chart: "line", y_min: 0 },
							retired: { since: "2026-01-01T00:00:00Z", replaced_by: "pm25" }
						},
						{
							id: "gone",
							label: "Gone",
							kind: "pollutant",
							units: "",
							resolutions: [],
							aggregate: null,
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

describe("catalog entry types", () => {
	beforeEach(() => {
		vi.mocked(getDatasetCatalog).mockResolvedValue({
			...SDK_DATASET_CATALOG,
			datasets: [...SDK_DATASET_CATALOG.datasets, WEATHER_DATASET, PESTICIDE_USE_DATASET]
		});
	});

	async function entryType(id: string) {
		const catalog = (await createWebMetadata().catalog()) as CatalogEntry[];
		return catalog.flatMap((d) => d.entryTypes).find((e) => e.id === id);
	}

	it("maps display.chart onto entry types", async () => {
		expect((await entryType("precipitation"))?.chart).toBe("bar");
		expect((await entryType("temperature"))?.chart).toBe("line");
		expect((await entryType("humidity"))?.chart).toBeNull();
	});

	it("maps an unknown display.chart to null", async () => {
		const catalog = structuredClone(SDK_DATASET_CATALOG);
		catalog.datasets[0].entry_types[0].display.chart = "pie" as never;
		vi.mocked(getDatasetCatalog).mockResolvedValue(catalog);
		expect((await entryType("humidity"))?.chart).toBeNull();
	});

	it("maps the applications entry type and pesticide meta urls", async () => {
		const catalog = (await createWebMetadata().catalog()) as CatalogEntry[];
		const pesticide = catalog.find((d) => d.id === "pesticide-use");
		expect(pesticide?.metaUrl).toBe("/api/2.0/pesticides/meta/");
		expect(pesticide?.entryTypes.find((e) => e.id === "applications")).toMatchObject({
			units: "applications",
			chart: "bar",
			yMin: 0,
			precision: 0,
			aggregate: "sum"
		});
		expect(await entryType("eto")).toMatchObject({ chart: "bar", yMin: 0, precision: 2 });
	});

	it("maps aggregate onto entry types", async () => {
		expect((await entryType("precipitation"))?.aggregate).toBe("sum");
		expect((await entryType("temperature"))?.aggregate).toBe("mean");
		expect((await entryType("winddirection"))?.aggregate).toBeNull();
	});
});

describe("hms-smoke levels", () => {
	it("hms-smoke levels come from hms meta", async () => {
		vi.mocked(getHMSMeta).mockResolvedValue({
			scales: {
				"smoke-density": {
					levels: [
						lvl("heavy", "Heavy", "#aa0000", 2, 27, null),
						lvl("light", "Light", "#cccccc", 0, null, 10),
						lvl("medium", "Medium", "#888888", 1, 10, 27)
					]
				}
			}
		} as never);
		const md = createWebMetadata();
		const levels = await md.datasetLevels("hms-smoke", "smoke-density");
		expect(levels.map((l) => l.key)).toEqual(["light", "medium", "heavy"]);
		await md.datasetLevels("hms-smoke", "smoke-density");
		expect(getHMSMeta).toHaveBeenCalledTimes(1);
		expect(await md.datasetLevels("hms-smoke", "nope")).toEqual([]);
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
			guidance: "",
			description: "",
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

	it("reads how the server evaluates alerts, null when it doesn't", async () => {
		const md = createWebMetadata();
		expect(await md.alertConfig("purpleair", "pm25")).toEqual({
			windowMinutes: 60,
			expectedIntervalMinutes: 2
		});
		// The monitor type's interval stands in for the entry's missing one.
		expect(await md.alertConfig("bam1022", "pm25")).toEqual({
			windowMinutes: 60,
			expectedIntervalMinutes: 60
		});
		expect(await md.alertConfig("bam1022", "o3")).toEqual({
			windowMinutes: 60,
			expectedIntervalMinutes: 30
		});
		expect(await md.alertConfig("bam1022", "pm10")).toBeNull();
		expect(await md.alertConfig("purpleair", "o3")).toBeNull();
		expect(await md.alertConfig("nope", "pm25")).toBeNull();
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
			{ type: "bam1022", label: "BAM 1022", entryTypes: ["pm25", "o3", "pm10"] }
		]);
		expect(getMonitorsList).toHaveBeenCalledTimes(1);
	});

	it("mapPollutants returns available_pollutants", async () => {
		vi.mocked(getMonitorsMeta).mockResolvedValue({
			...META,
			available_pollutants: ["o3", "pm25"]
		} as never);
		expect(await createWebMetadata().mapPollutants()).toEqual(["o3", "pm25"]);
	});

	it("mapPollutants is [] when the meta lists none", async () => {
		vi.mocked(getMonitorsMeta).mockResolvedValue({ ...META, available_pollutants: [] } as never);
		expect(await createWebMetadata().mapPollutants()).toEqual([]);
	});

	it('mapPollutants is "unavailable" when the meta fails', async () => {
		vi.mocked(getMonitorsMeta).mockRejectedValue(new Error("boom"));
		expect(await createWebMetadata().mapPollutants()).toBe("unavailable");
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

describe("dailyFigure", () => {
	it("the memory source names the figure for an entry type that has one", async () => {
		const md = fixtureMetadata();
		expect(await md.dailyFigure("o3")).toEqual({
			field: "max_1h",
			label: "Highest 1-hour average"
		});
		expect(await md.dailyFigure("pm25")).toBeNull();
	});

	it("the web source reads the scale's daily_statistic and its label", async () => {
		const scale = (daily_statistic: string | null, daily_statistic_label: string | null) => ({
			levels: [],
			averaging_hours: null,
			daily_statistic,
			daily_statistic_label
		});
		vi.mocked(getMonitorsMeta).mockResolvedValue({
			...META,
			entries: {
				o3: { scale: scale("max_1h", "Highest 1-hour average") },
				pm25: { scale: scale(null, null) },
				co: { scale: scale("max_8h", null) },
				humidity: { scale: null }
			}
		} as never);
		const md = createWebMetadata();
		expect(await md.dailyFigure("o3")).toEqual({
			field: "max_1h",
			label: "Highest 1-hour average"
		});
		expect(await md.dailyFigure("pm25")).toBeNull();
		expect(await md.dailyFigure("co")).toEqual({ field: "max_8h", label: null });
		expect(await md.dailyFigure("humidity")).toBeNull();
		expect(await md.dailyFigure("nope")).toBeNull();
	});
});

describe("levelFor", () => {
	const levels: Level[] = [
		{
			key: "a",
			label: "A",
			color: null,
			opacity: null,
			tier: 0,
			guidance: "",
			description: "",
			min: 0,
			max: 9
		},
		{
			key: "b",
			label: "B",
			color: null,
			opacity: null,
			tier: 1,
			guidance: "",
			description: "",
			min: 9,
			max: 35.4
		},
		{
			key: "c",
			label: "C",
			color: null,
			opacity: null,
			tier: 2,
			guidance: "",
			description: "",
			min: 35.4,
			max: null
		}
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

describe("now-widget metadata", () => {
	it("mapScaleLevels keeps guidance and description", () => {
		const levels = mapScaleLevels([
			lvl("good", "Good", "#00e400", 0, null, 9),
			{
				...lvl("moderate", "Moderate", "#ffff00", 1, 9, 35.4),
				description: "Okay.",
				guidance: "Sensitive people take care."
			}
		]);
		expect(levels[0]).toMatchObject({ guidance: "", description: "" });
		expect(levels[1]).toMatchObject({
			guidance: "Sensitive people take care.",
			description: "Okay."
		});
	});

	it("schoolGuidelines returns pm25's set and null for o3", async () => {
		const guidelines = {
			source: { name: "AirNow", url: "https://example.org" },
			activities: []
		};
		vi.mocked(getMonitorsMeta).mockResolvedValue({
			monitors: {},
			entries: { pm25: { school_guidelines: guidelines }, o3: { school_guidelines: null } }
		} as never);
		const md = createWebMetadata();
		expect(await md.schoolGuidelines("pm25")).toEqual(guidelines);
		expect(await md.schoolGuidelines("o3")).toBeNull();
		expect(await md.schoolGuidelines("nope")).toBeNull();
	});

	it("datasetLevels reads calheatscore scales", async () => {
		const keys = ["low", "moderate", "high", "very-high", "severe"];
		vi.mocked(getCalHeatScoreMeta).mockResolvedValue({
			scales: {
				"heat-score": {
					levels: keys.map((k, i) => lvl(k, k, "#aaaaaa", i, i * 10, i < 4 ? i * 10 + 10 : null))
				}
			}
		} as never);
		const md = createWebMetadata();
		const levels = await md.datasetLevels("calheatscore", "heat-score");
		expect(levels.map((l) => l.key)).toEqual(keys);
		expect(levels.map((l) => l.tier)).toEqual([0, 1, 2, 3, 4]);
		await md.datasetLevels("calheatscore", "heat-score");
		expect(getCalHeatScoreMeta).toHaveBeenCalledTimes(1);
	});

	it("scaleSource returns the burn-status source", async () => {
		const source = { name: "Air District", url: "https://example.org/burn" };
		vi.mocked(getForecastsMeta).mockResolvedValue({
			scales: {
				"burn-status": { levels: [], source },
				"aqi-forecast": { levels: [], source: null }
			}
		} as never);
		const md = createWebMetadata();
		expect(await md.scaleSource("forecasts", "burn-status")).toEqual(source);
		expect(await md.scaleSource("forecasts", "aqi-forecast")).toBeNull();
		expect(await md.scaleSource("forecasts", "nope")).toBeNull();
	});
});

describe("serverScale and monitorTypeInterval", () => {
	it("routes the raw scale like datasetLevels, with hms-fire on the HMS meta", async () => {
		const smoke = { levels: [lvl("light", "Light", "#ccc", 0, null, 10)] };
		const fire = { levels: [lvl("fire", "Fire", "#f00", 0, null, null)] };
		vi.mocked(getHMSMeta).mockResolvedValue({
			scales: { "smoke-density": smoke, "fire-radiative-power": fire }
		} as never);
		const md = createWebMetadata();
		expect(await md.serverScale("air-quality", "pm25")).toBe(META.entries.pm25.scale);
		expect(await md.serverScale("air-quality", "humidity")).toBeNull();
		expect(await md.serverScale("hms-smoke", "smoke-density")).toBe(smoke);
		expect(await md.serverScale("hms-fire", "fire-radiative-power")).toBe(fire);
		expect(await md.serverScale("hms-fire", "nope")).toBeNull();
		expect(getHMSMeta).toHaveBeenCalledTimes(1);
	});

	it("reads a monitor type's reporting interval", async () => {
		const md = createWebMetadata();
		expect(await md.monitorTypeInterval("purpleair")).toBe("2 min");
		expect(await md.monitorTypeInterval("nope")).toBeNull();
	});
});
