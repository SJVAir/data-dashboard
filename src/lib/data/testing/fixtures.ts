import type { CatalogEntry, EntryTypeMeta, Level, MetadataSource } from "../metadata";

const ALL = ["raw", "hour", "day", "month", "quarter", "season", "year"] as const;

function pollutant(
	id: string,
	label: string,
	resolutions: EntryTypeMeta["resolutions"],
	available: boolean
): EntryTypeMeta {
	return { id, label, units: "µg/m³", kind: "pollutant", resolutions, available };
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

const FIXTURE_LEVELS: Level[] = [
	{ name: "good", label: "Good", color: "#00e400", range: [0, 9] },
	{ name: "moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4] }
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
		monitors: async () => FIXTURE_MONITORS.map((m) => ({ ...m })),
		...overrides
	};
}
