import ChartLine from "@lucide/svelte/icons/chart-line";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const CHART_TYPE = "chart";

/** One pollutant for up to five places over the widget's date range. */
export const chartType: WidgetType = {
	type: CHART_TYPE,
	label: () => m.widget_chart_title(),
	icon: ChartLine,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 3, h: 6 },
	time: "range",
	thresholds: false,
	analyzable: true,
	downloadable: true,
	accepts: {
		datasets: ["air-quality", "forecasts"],
		maxPollutantLayers: 1,
		maxPlaces: 5
	},
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	load: () => import("./module")
};
