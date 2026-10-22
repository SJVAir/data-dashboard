/**
 * DEV ONLY. A stand-in air-quality catalog for the hidden dev data page, until the server's
 * `meta/datasets/` endpoint lands. Only the page at `/workspace/dev/data` imports this, and that
 * route is registered only in dev builds, so it never ships.
 *
 * Which entry types and resolutions are listed is the stand-in part; labels and units are read
 * from the server's `monitors/meta/` at runtime.
 */
import { getMonitorsMeta } from "@sjvair/sdk";
import type { CatalogEntry, EntryTypeMeta } from "$lib/data/metadata";

const ALL: EntryTypeMeta["resolutions"] = [
	"raw",
	"hour",
	"day",
	"month",
	"quarter",
	"season",
	"year"
];

/**
 * The server summarizes PM2.5 and ozone; PM10 (the server's `pm100`) and PM1.0 (its `pm10`)
 * have raw entries only.
 */
const DEV_ENTRY_TYPES: Array<{ id: string; resolutions: EntryTypeMeta["resolutions"] }> = [
	{ id: "pm25", resolutions: ALL },
	{ id: "o3", resolutions: ALL },
	{ id: "pm100", resolutions: ["raw"] },
	{ id: "pm10", resolutions: ["raw"] }
];

/** The dev catalog, with each entry type's label and units from `monitors/meta/`. */
export async function loadDevCatalog(): Promise<CatalogEntry[]> {
	const meta = await getMonitorsMeta();
	const entries = meta.entries as Record<string, { label?: string; units?: string } | undefined>;
	return [
		{
			id: "air-quality",
			label: "Air quality (dev stand-in)",
			entryTypes: DEV_ENTRY_TYPES.map(({ id, resolutions }) => ({
				id,
				label: entries[id]?.label ?? id,
				units: entries[id]?.units ?? "",
				kind: "pollutant",
				resolutions,
				available: true
			})),
			geographies: ["monitor", "region"]
		}
	];
}
