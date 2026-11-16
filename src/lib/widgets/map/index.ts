import Map from "@lucide/svelte/icons/map";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";
import { HMS_FIRE, HMS_SMOKE, MAP_POLLUTANTS_MAX, MAP_TYPE } from "./options";
import { mapStartData } from "./start";

export { MAP_TYPE } from "./options";

/**
 * A map of the air quality monitors, with one or more pollutants, and smoke and fire: now, or
 * the days of a date range (no `dateRange` is Now, so a new Map shows now).
 */
export const mapType: WidgetType = {
	type: MAP_TYPE,
	label: () => m.widget_map_title(),
	icon: Map,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 6, h: 6 },
	time: "range",
	now: true,
	resolution: "day",
	span: { minDays: 1, maxDays: 366 },
	thresholds: false,
	analyzable: false,
	downloadable: false,
	accepts: {
		datasets: ["air-quality", HMS_SMOKE, HMS_FIRE],
		maxPollutantLayers: MAP_POLLUTANTS_MAX,
		maxPlaces: 25
	},
	menu: () => [],
	addable: (doc) => ({ data: mapStartData(doc) }),
	load: () => import("./module")
};
