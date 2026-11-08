import type { Resolution } from "$lib/data/schema";
import { m } from "$lib/paraglide/messages.js";

/** How a layer's values combine over time (the catalog's `aggregate`). */
export type Aggregate = "sum" | "mean" | null;

const AVERAGE = {
	hour: m.chart_series_hour,
	day: m.chart_series_day,
	month: m.chart_series_month,
	quarter: m.chart_series_quarter,
	season: m.chart_series_season,
	year: m.chart_series_year
} as const;

const TOTAL = {
	hour: m.chart_series_hour_total,
	day: m.chart_series_day_total,
	month: m.chart_series_month_total,
	quarter: m.chart_series_quarter_total,
	season: m.chart_series_season_total,
	year: m.chart_series_year_total
} as const;

/**
 * What one period's value is: "Daily total" for a summed layer, "Daily average" for an averaged
 * one, and null for a layer whose values never roll up over time (the caller names it by its
 * entry type instead). Raw rows are always "Measurements". Used by the Chart's legend and strip
 * tags and by the Data table's caption and cells, so they always agree.
 */
export function periodLabel(resolution: Resolution, aggregate: Aggregate): string | null {
	if (resolution === "raw") return m.chart_series_raw();
	if (aggregate === "sum") return TOTAL[resolution]();
	if (aggregate === "mean") return AVERAGE[resolution]();
	return null;
}

/** `periodLabel`, or the entry type's label when the values never roll up. */
export function seriesLabel(resolution: Resolution, aggregate: Aggregate, label: string): string {
	return periodLabel(resolution, aggregate) ?? label;
}
