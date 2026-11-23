import Map from "@lucide/svelte/icons/map";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";
import { HMS_FIRE, HMS_SMOKE, MAP_MAX_STOPS, MAP_TYPE } from "./options";
import { showInItems } from "./show-in-items";
import { mapStartDataWithTypes } from "./start";

export { MAP_TYPE } from "./options";

/**
 * A map of the air quality monitors, with one pollutant or none, and smoke and fire: now, or
 * the periods of a date range at its resolution (Daily, Monthly or Yearly; no `dateRange` is Now,
 * so a new Map shows now).
 */
export const mapType: WidgetType = {
	type: MAP_TYPE,
	label: () => m.widget_map_title(),
	icon: Map,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 6, h: 6 },
	time: "range",
	now: true,
	span: { minDays: 1, maxStops: MAP_MAX_STOPS },
	thresholds: false,
	analyzable: false,
	downloadable: false,
	accepts: {
		datasets: ["air-quality", HMS_SMOKE, HMS_FIRE],
		maxPollutantLayers: 1,
		maxPlaces: 25
	},
	menu: (_ctx, env) => showInItems(env),
	addable: async (doc) => ({ data: await mapStartDataWithTypes(doc) }),
	load: () => import("./module")
};
