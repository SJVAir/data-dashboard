import type { AdapterRequest, DatasetAdapter } from "$lib/data/adapters/registry";
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { QueryData } from "$lib/data/types";
import type { Rect, WidgetInstance } from "$lib/documents/schema";

const DAY = 86_400_000;

/**
 * A fake air-quality adapter for monitors: three daily points per requested monitor, named
 * "Monitor <id>". Each request is pushed onto `requests`.
 */
export function fakeAdapter(requests: AdapterRequest[]): DatasetAdapter {
	return {
		id: "air-quality",
		async target(layer) {
			if (layer.selection) return { kind: "monitors", ids: [...layer.selection.ids] };
			if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
			return { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		async fetch(req): Promise<QueryData> {
			requests.push(req);
			const ids = req.target.kind === "monitors" ? req.target.ids : [];
			const start = req.range.start.getTime();
			return {
				series: ids.map((id, n) => ({
					place: `monitor:${id}`,
					points: [0, 1, 2].map((i) => ({
						t: start + i * DAY,
						mean: 5 + i + n,
						min: 5 + i + n,
						max: 5 + i + n,
						count: 24,
						partial: false,
						...(ids.length === 1 && req.worstHour
							? { worstHour: { t: start + i * DAY + 15 * 3_600_000, value: 12 + i } }
							: {})
					}))
				})),
				places: ids.map((id) => ({ place: `monitor:${id}`, name: `Monitor ${id}` })),
				resolution: req.resolution,
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}

/** A Chart widget of PM2.5 at the monitors `ids` (a place for one, a selection for more). */
export function chartWidget(
	ids: string[],
	extra: Partial<WidgetInstance> = {},
	rect: Rect = { x: 0, y: 0, w: 3, h: 6 }
): WidgetInstance {
	return {
		id: crypto.randomUUID(),
		type: "chart",
		title: null,
		rect,
		data: {
			dateRange: { kind: "trailing", amount: 30, unit: "day" },
			layers: [
				ids.length === 1
					? { dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: ids[0] } }
					: { dataset: "air-quality", entryType: "pm25", selection: { kind: "monitors", ids } }
			]
		},
		...extra
	};
}

function level(
	key: string,
	label: string,
	color: string,
	tier: number,
	min: number,
	max: number | null
): Level {
	return { key, label, color, opacity: null, tier, min, max };
}

/** The six-level PM2.5 scale (the longest level names the key has to fit). */
export const PM25_LEVELS: Level[] = [
	level("good", "Good", "#00e400", 0, 0, 9.1),
	level("moderate", "Moderate", "#ffff00", 1, 9.1, 35.5),
	level("unhealthy_sensitive", "Unhealthy for Sensitive Groups", "#ff7e00", 2, 35.5, 55.5),
	level("unhealthy", "Unhealthy", "#ff0000", 3, 55.5, 125.5),
	level("very_unhealthy", "Very Unhealthy", "#8f3f97", 4, 125.5, 225.5),
	level("hazardous", "Hazardous", "#7e0023", 5, 225.5, null)
];

/** A catalog entry for the forecasts dataset (burn status and AQI forecast, daily only). */
export const FORECASTS_ENTRY: CatalogEntry = {
	id: "forecasts",
	label: "Air Quality Forecasts",
	entryTypes: [
		{
			id: "burn-status",
			label: "Burn status",
			units: "",
			kind: "other",
			resolutions: ["day"],
			precision: null,
			yMin: null
		},
		{
			id: "aqi-forecast",
			label: "AQI forecast",
			units: "AQI",
			kind: "other",
			resolutions: ["day"],
			precision: null,
			yMin: null
		}
	],
	geographies: ["monitor", "region"]
};

/**
 * A fake forecasts adapter for monitors: burn status "discouraged" on the first two days of the
 * range and "registered" on the third, per requested monitor. Monitors in `missing` get an empty
 * series, as the real adapter gives a place the server has no forecasts for.
 */
export function fakeForecastsAdapter(
	requests: AdapterRequest[],
	missing: string[] = []
): DatasetAdapter {
	return {
		id: "forecasts",
		target: fakeAdapter([]).target,
		offered: () => ["day"],
		async fetch(req): Promise<QueryData> {
			requests.push(req);
			const ids = req.target.kind === "monitors" ? req.target.ids : [];
			const start = req.range.start.getTime();
			const levels = ["discouraged", "discouraged", "registered"];
			return {
				series: ids.map((id) => ({
					place: `monitor:${id}`,
					points: missing.includes(id)
						? []
						: levels.map((level, i) => ({
								t: start + i * DAY,
								mean: NaN,
								min: NaN,
								max: NaN,
								count: 1,
								partial: false,
								level
							}))
				})),
				places: ids.map((id) => ({ place: `monitor:${id}`, name: `Monitor ${id}` })),
				resolution: "day",
				fromRaw: false,
				processor: null,
				fetchedAt: Date.now()
			};
		}
	};
}
