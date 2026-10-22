import type { DatasetCatalog } from "@sjvair/sdk";

const ALL = ["raw", "hour", "day", "month", "quarter", "season", "year"] as const;

/**
 * Part of `@sjvair/sdk`'s `meta/datasets` fixture (`lib/meta/fixtures/dataset_catalog.json` at
 * 4.8.0-beta.0), as `getDatasetCatalog` returns it: two datasets, a few entry types each.
 */
export const SDK_DATASET_CATALOG: DatasetCatalog = {
	datasets: [
		{
			id: "air-quality",
			label: "Air Quality",
			description: "Air quality measurements from SJVAir sensors and partner monitoring networks.",
			source: "SJVAir sensors, AirNow, AQview, AQLite",
			license: "",
			geographies: ["monitor", "region"],
			meta_url: "/api/2.0/monitors/meta/",
			entry_types: [
				{
					id: "humidity",
					label: "Humidity",
					kind: "meteorological",
					units: "%",
					resolutions: ["raw"],
					retired: null
				},
				{
					id: "particulates",
					label: "Particulates",
					kind: "other",
					units: "",
					resolutions: ["raw"],
					retired: null
				},
				{
					id: "pm100",
					label: "PM10.0",
					kind: "pollutant",
					units: "µg/m³",
					resolutions: ["raw"],
					retired: null,
					available: false
				},
				{
					id: "pm25",
					label: "PM2.5",
					kind: "pollutant",
					units: "µg/m³",
					resolutions: [...ALL],
					retired: null,
					available: true
				}
			],
			retired: null
		},
		{
			id: "hms-smoke",
			label: "Wildfire Smoke",
			description: "Daily smoke plume outlines and density from satellite imagery.",
			source: "NOAA Hazard Mapping System",
			license: "Public domain",
			geographies: ["polygon"],
			meta_url: "",
			entry_types: [
				{
					id: "smoke-density",
					label: "Smoke Density",
					kind: "other",
					units: "",
					resolutions: ["day"],
					retired: null
				}
			],
			retired: null
		}
	],
	summary_rules: { complete_after_period_end: ["month", "quarter", "season", "year"] }
};
