import ChartLine from "@lucide/svelte/icons/chart-line";
import { FALLBACK_MIN_SIZE } from "$lib/layout/items";
import { m } from "$lib/paraglide/messages.js";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "../defaults";
import type { WidgetType } from "../registry";

export const CHART_TYPE = "chart";

/** One pollutant for up to five places over the widget's date range. */
export const chartType: WidgetType = {
	type: CHART_TYPE,
	label: () => m.widget_chart_title(),
	icon: ChartLine,
	minSize: FALLBACK_MIN_SIZE,
	defaultSize: { w: 3, h: 4 },
	time: "range",
	thresholds: false,
	analyzable: true,
	downloadable: true,
	accepts: { maxPollutantLayers: 1, maxPlaces: 5 },
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	load: () => import("./module"),
	addable: () => ({
		dateRange: structuredClone(DEFAULT_RANGE),
		layers: [structuredClone(DEFAULT_LAYER)]
	})
};
