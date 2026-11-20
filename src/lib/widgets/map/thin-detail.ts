import type { MapFeatureProperties } from "@sjvair/map-sdk/data";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { isThin, thinDays } from "./data/monitors";
import type { MapLevel } from "./days";

/**
 * Why a stop's monitor or region has no figure, when it had a row without enough data: a day had
 * too few readings ("Not enough data"); a month or year too few days with a figure ("Only 20 of 31
 * days had a figure", from the row's counts, else "Too few days had a figure"). Undefined
 * otherwise.
 */
export function thinDetail(props: MapFeatureProperties, resolution: MapLevel): string | undefined {
	if (!isThin(props)) return undefined;
	if (resolution === "day") return m.calendar_not_enough_data();
	const counts = thinDays(props);
	return counts
		? m.map_period_days_with_figure({
				days: formatNumber(counts.days),
				expected: formatNumber(counts.expected),
				expectedValue: counts.expected
			})
		: m.map_period_too_few_days();
}

/**
 * The legend's unit line on a Monthly or Yearly stop: the units and the figure's name ("µg/m³ ·
 * Average of 24-hour averages"), from the metadata. Undefined on a day or now (the legend shows
 * its "(units)" as before) or when the scale names no figure.
 */
export function periodLegendUnits(args: {
	onDay: boolean;
	resolution: MapLevel;
	figure: string | undefined;
	units: string | undefined;
}): string | undefined {
	const { onDay, resolution, figure, units } = args;
	if (!onDay || resolution === "day" || !figure) return undefined;
	return units ? m.map_legend_units_figure({ units, figure }) : figure;
}
