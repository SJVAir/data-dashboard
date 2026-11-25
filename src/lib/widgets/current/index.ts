import Gauge from "@lucide/svelte/icons/gauge";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const CURRENT_TYPE = "current-conditions";

/**
 * Current values of one or more pollutants at one place, with their levels, trends and guidance.
 */
export const currentType: WidgetType = {
	type: CURRENT_TYPE,
	label: () => m.widget_current_title(),
	icon: Gauge,
	minSize: { w: 3, h: 3 },
	defaultSize: { w: 3, h: 4 },
	time: "now",
	placePicker: true,
	thresholds: true,
	optionsLabel: () => m.get_data_options_outside(),
	analyzable: true,
	downloadable: false,
	accepts: { datasets: ["air-quality"], maxPlaces: 1 },
	menu: () => [],
	load: () => import("./module")
};
