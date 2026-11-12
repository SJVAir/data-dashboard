import Map from "@lucide/svelte/icons/map";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";
import { MAP_TYPE } from "./options";
import { mapStartData } from "./start";

export { MAP_TYPE } from "./options";

/** A map of the air quality monitors, with one pollutant's layer at a time. */
export const mapType: WidgetType = {
	type: MAP_TYPE,
	label: () => m.widget_map_title(),
	icon: Map,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 6, h: 6 },
	time: "now",
	thresholds: false,
	analyzable: false,
	downloadable: false,
	accepts: { datasets: ["air-quality"], maxPollutantLayers: 1, maxPlaces: 25, onlyPollutant: true },
	menu: () => [],
	addable: (doc) => ({ data: mapStartData(doc) }),
	load: () => import("./module")
};
