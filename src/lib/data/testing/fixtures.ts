import { mapScaleLevels } from "../metadata";
import type { CatalogEntry, DailyFigure, EntryTypeMeta, Level, MetadataSource } from "../metadata";
import { FORECASTS_META } from "./forecasts-fixtures";

const ALL = ["raw", "hour", "day", "month", "quarter", "season", "year"] as const;

function pollutant(
	id: string,
	label: string,
	resolutions: EntryTypeMeta["resolutions"],
	available: boolean
): EntryTypeMeta {
	return {
		id,
		label,
		units: "µg/m³",
		kind: "pollutant",
		resolutions,
		precision: null,
		yMin: null,
		chart: null,
		aggregate: "mean",
		available
	};
}

export const FIXTURE_CATALOG: CatalogEntry[] = [
	{
		id: "air-quality",
		label: "Air quality",
		entryTypes: [
			pollutant("pm25", "PM2.5", [...ALL], true),
			pollutant("o3", "Ozone", [...ALL], true),
			pollutant("pm100", "PM10", ["raw"], false)
		],
		geographies: ["monitor", "region"]
	}
];

function level(
	key: string,
	label: string,
	color: string,
	tier: number,
	min: number,
	max: number | null
): Level {
	return { key, label, color, opacity: 1, tier, guidance: "", description: "", min, max };
}

const FIXTURE_LEVELS: Level[] = [
	level("good", "Good", "#00e400", 0, 0, 9),
	level("moderate", "Moderate", "#ffff00", 1, 9, 35.4),
	level("unhealthy-sensitive", "Unhealthy for Sensitive Groups", "#ff7e00", 2, 35.4, 55.4),
	level("unhealthy", "Unhealthy", "#ff0000", 3, 55.4, null)
];

const FIXTURE_MONITORS = [
	{ id: "m-pa", name: "Purple Air", type: "purpleair" },
	{ id: "m-bam", name: "BAM", type: "bam1022" }
];

const FIXTURE_PROCESSORS: Record<string, string | null> = {
	purpleair: "PM25_EPA_Calibration",
	bam1022: null
};

const FIXTURE_DAILY_FIGURES: Record<string, DailyFigure> = {
	o3: { field: "max_1h", label: "Highest 1-hour average" }
};

/** An in-memory `MetadataSource`; any method can be replaced through `overrides`. */
export function fixtureMetadata(overrides: Partial<MetadataSource> = {}): MetadataSource {
	return {
		catalog: async () => FIXTURE_CATALOG,
		levels: async (entryType) => (entryType === "pm25" ? FIXTURE_LEVELS : []),
		datasetLevels: async (dataset, entryType) =>
			dataset === "forecasts"
				? mapScaleLevels(
						(
							FORECASTS_META.scales as Record<
								string,
								{ levels: Parameters<typeof mapScaleLevels>[0] }
							>
						)[entryType]?.levels
					)
				: entryType === "pm25"
					? FIXTURE_LEVELS
					: [],
		defaultProcessor: async (monitorType) => FIXTURE_PROCESSORS[monitorType] ?? null,
		alertConfig: async (monitorType, entryType) =>
			entryType !== "pm25"
				? null
				: monitorType === "purpleair"
					? { windowMinutes: 60, expectedIntervalMinutes: 2 }
					: monitorType === "bam1022"
						? { windowMinutes: 60, expectedIntervalMinutes: 60 }
						: null,
		dailyFigure: async (entryType) => FIXTURE_DAILY_FIGURES[entryType] ?? null,
		mapPollutants: async () => ["o3", "pm25"],
		serverScale: async () => null,
		monitorTypeInterval: async (type) => (type === "purpleair" ? "2 min" : null),
		schoolGuidelines: async () => null,
		scaleSource: async () => null,
		monitorType: async (id) => FIXTURE_MONITORS.find((m) => m.id === id)?.type ?? null,
		monitors: async () =>
			FIXTURE_MONITORS.map((m) => ({ ...m, county: "Fresno", active: true, inside: false })),
		monitorTypes: async () => [
			{
				type: "purpleair",
				label: "PurpleAir",
				entryTypes: ["pm25", "pm100"],
				group: "low-cost",
				published: ["pm25", "pm100"]
			},
			{
				type: "bam1022",
				label: "BAM 1022",
				entryTypes: ["pm25"],
				group: "reference",
				published: ["pm25"]
			}
		],
		monitorGroups: async () => [
			{ key: "reference", label: "Reference-grade", order: 0 },
			{ key: "low-cost", label: "Low-cost sensors", order: 1 }
		],
		entryTypeHelp: async (entryType) =>
			entryType === "pm25" ? "Fine particles from smoke, dust, and vehicle exhaust." : null,
		locationTypeLabel: async (type) => (type === "child_care" ? "Child care" : null),
		...overrides
	};
}
