import Table from "@lucide/svelte/icons/table";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const DATA_TABLE_TYPE = "data-table";

/** One pollutant for up to ten places over the widget's date range, as exact numbers. */
export const dataTableType: WidgetType = {
	type: DATA_TABLE_TYPE,
	label: () => m.widget_data_table_title(),
	icon: Table,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 3, h: 6 },
	time: "range",
	thresholds: false,
	analyzable: true,
	downloadable: true,
	accepts: {
		datasets: ["air-quality", "forecasts", "weather", "hms-smoke", "pesticide-use"],
		maxPollutantLayers: 1,
		maxPlaces: 10
	},
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: () => [],
	load: () => import("./module")
};
