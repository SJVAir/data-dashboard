import ChartLine from "@lucide/svelte/icons/chart-line";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const CHART_TYPE = "chart";

/** One pollutant for its places over the widget's date range. */
export const chartType: WidgetType = {
	type: CHART_TYPE,
	label: () => m.widget_chart_title(),
	icon: ChartLine,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 3, h: 6 },
	time: "range",
	// A display-only line per Chart; the watcher watches only "now" types, so none are watched.
	thresholds: true,
	optionsLabel: () => m.get_data_options_chart(),
	analyzable: true,
	downloadable: true,
	accepts: {
		datasets: ["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"],
		maxPollutantLayers: 1
	},
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	load: () => import("./module")
};
