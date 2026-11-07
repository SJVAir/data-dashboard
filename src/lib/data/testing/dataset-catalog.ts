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
			places_url: "/api/2.0/monitors/places/",
			entry_types: [
				{
					id: "humidity",
					label: "Humidity",
					kind: "meteorological",
					units: "%",
					resolutions: ["raw"],
					aggregate: "mean",
					display: { precision: null, chart: null, y_min: null },
					retired: null
				},
				{
					id: "particulates",
					label: "Particulates",
					kind: "other",
					units: "",
					resolutions: ["raw"],
					aggregate: "mean",
					display: { precision: null, chart: null, y_min: null },
					retired: null
				},
				{
					id: "pm100",
					label: "PM10.0",
					kind: "pollutant",
					units: "µg/m³",
					resolutions: ["raw"],
					aggregate: "mean",
					display: { precision: null, chart: null, y_min: null },
					retired: null,
					available: false
				},
				{
					id: "pm25",
					label: "PM2.5",
					kind: "pollutant",
					units: "µg/m³",
					resolutions: [...ALL],
					aggregate: "mean",
					display: { precision: null, chart: null, y_min: null },
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
			places_url: "",
			entry_types: [
				{
					id: "smoke-density",
					label: "Smoke Density",
					kind: "other",
					units: "",
					resolutions: ["day"],
					aggregate: null,
					display: { precision: null, chart: null, y_min: null },
					retired: null
				}
			],
			retired: null
		}
	],
	summary_rules: { complete_after_period_end: ["month", "quarter", "season", "year"] }
};

/** The live catalog's weather dataset (CIMIS), trimmed to sum, mean and no-rollup entry types. */
export const WEATHER_DATASET: DatasetCatalog["datasets"][number] = {
	id: "weather",
	label: "Weather",
	description: "Hourly weather observations from agricultural weather stations.",
	source: "California Irrigation Management Information System (CIMIS)",
	license: "",
	geographies: ["monitor"],
	meta_url: "/api/2.0/monitors/meta/",
	places_url: "/api/2.0/monitors/?dataset=weather",
	entry_types: [
		{
			id: "eto",
			label: "Reference Evapotranspiration",
			kind: "meteorological",
			units: "in",
			resolutions: ["raw", "hour", "day", "month", "quarter", "season", "year"],
			aggregate: "sum",
			display: { precision: 2, chart: "bar", y_min: 0 },
			retired: null
		},
		{
			id: "precipitation",
			label: "Precipitation",
			kind: "meteorological",
			units: "in",
			resolutions: ["raw", "hour", "day", "month", "quarter", "season", "year"],
			aggregate: "sum",
			display: { precision: 2, chart: "bar", y_min: 0 },
			retired: null
		},
		{
			id: "temperature",
			label: "Temperature",
			kind: "meteorological",
			units: "°F",
			resolutions: ["raw", "hour", "day", "month", "quarter", "season", "year"],
			aggregate: "mean",
			display: { precision: 1, chart: "line", y_min: null },
			retired: null
		},
		{
			id: "winddirection",
			label: "Wind Direction",
			kind: "meteorological",
			units: "°",
			resolutions: ["raw"],
			aggregate: null,
			display: { precision: 1, chart: "line", y_min: null },
			retired: null
		}
	],
	retired: null
};

/** The live catalog's pesticide-use dataset, trimmed to two entry types. */
export const PESTICIDE_USE_DATASET: DatasetCatalog["datasets"][number] = {
	id: "pesticide-use",
	label: "Pesticide Use",
	description: "Reported agricultural pesticide applications, summed by region.",
	source: "California DPR Pesticide Use Reporting (PUR)",
	license: "",
	geographies: ["region"],
	meta_url: "/api/2.0/pesticides/meta/",
	places_url: "",
	entry_types: [
		{
			id: "pounds-applied",
			label: "Pounds Applied",
			kind: "other",
			units: "lbs",
			resolutions: ["month", "year"],
			aggregate: "sum",
			display: { precision: 0, chart: "bar", y_min: 0 },
			retired: null
		},
		{
			id: "applications",
			label: "Applications",
			kind: "other",
			units: "applications",
			resolutions: ["month", "year"],
			aggregate: "sum",
			display: { precision: 0, chart: "bar", y_min: 0 },
			retired: null
		}
	],
	retired: null
};
