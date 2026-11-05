import type { CatalogEntry, EntryTypeMeta, Level, MetadataSource } from "../metadata";

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
	return { key, label, color, opacity: 1, tier, min, max };
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

/** An in-memory `MetadataSource`; any method can be replaced through `overrides`. */
export function fixtureMetadata(overrides: Partial<MetadataSource> = {}): MetadataSource {
	return {
		catalog: async () => FIXTURE_CATALOG,
		levels: async (entryType) => (entryType === "pm25" ? FIXTURE_LEVELS : []),
		defaultProcessor: async (monitorType) => FIXTURE_PROCESSORS[monitorType] ?? null,
		monitorType: async (id) => FIXTURE_MONITORS.find((m) => m.id === id)?.type ?? null,
		monitors: async () => FIXTURE_MONITORS.map((m) => ({ ...m, county: "Fresno", active: true })),
		monitorTypes: async () => [
			{ type: "purpleair", label: "PurpleAir", entryTypes: ["pm25", "pm100"] },
			{ type: "bam1022", label: "BAM 1022", entryTypes: ["pm25"] }
		],
		...overrides
	};
}
