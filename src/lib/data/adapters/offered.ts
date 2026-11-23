import type { Resolution } from "../schema";

/**
 * The levels of an entry type's catalog `base` that a dataset's adapter can fetch, for the
 * places it fetches most for (air quality narrows this further by place: regions have no raw
 * rows). Each adapter's `offered` is built on it, so Get data's "Data resolution" choices and
 * the query client agree. Kept free of imports, like `drawsAsBands`, so Get data's layer edits can
 * use it without pulling in the SDK.
 *
 * - Weather has no "Every measurement": CIMIS readings are hourly, so Hourly shows the same
 *   values (and raw rows carry no `value`).
 * - Pesticide use is reported by month: Monthly and Yearly only.
 * - Forecasts, smoke, fire and pesticide notices are one value a day.
 */
export function offeredLevels(dataset: string, base: readonly Resolution[]): Resolution[] {
	switch (dataset) {
		case "weather":
			return base.filter((r) => r !== "raw");
		case "pesticide-use":
			return base.filter((r) => r === "month" || r === "year");
		case "forecasts":
		case "hms-smoke":
		case "hms-fire":
		case "pesticide-notices":
			return ["day"];
		default:
			return [...base];
	}
}

/**
 * Whether a Chart's or Table's main layer of `dataset` is drawn with no Where and no monitors:
 * weather draws every station, pesticide use the valley-wide total. An air-quality layer asks for
 * a Where or monitors instead (every monitor of every type isn't offered).
 */
export function drawnWithNoWhere(dataset: string): boolean {
	return dataset === "weather" || dataset === "pesticide-use";
}
