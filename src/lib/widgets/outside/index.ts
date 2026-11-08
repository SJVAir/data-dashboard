import School from "@lucide/svelte/icons/school";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const OUTSIDE_TYPE = "outside";

/** The school outdoor-activity guidance for the air right now, with today's heat. Always PM2.5. */
export const outsideType: WidgetType = {
	type: OUTSIDE_TYPE,
	label: () => m.widget_outside_title(),
	icon: School,
	minSize: { w: 3, h: 5 },
	defaultSize: { w: 3, h: 7 },
	time: "now",
	placePicker: true,
	thresholds: true,
	analyzable: true,
	downloadable: false,
	accepts: { datasets: ["air-quality"], maxPlaces: 1 },
	menu: () => [],
	load: () => import("./module")
};
