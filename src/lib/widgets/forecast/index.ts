import CalendarDays from "@lucide/svelte/icons/calendar-days";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

export const FORECAST_TYPE = "forecast-strip";

/** Today's and tomorrow's AQI forecast and burn status for one place. */
export const forecastType: WidgetType = {
	type: FORECAST_TYPE,
	label: () => m.widget_forecast_title(),
	icon: CalendarDays,
	minSize: { w: 3, h: 3 },
	defaultSize: { w: 3, h: 4 },
	time: "now",
	placePicker: true,
	thresholds: false,
	analyzable: true,
	downloadable: false,
	accepts: { datasets: ["forecasts"], maxPlaces: 1 },
	menu: () => [],
	load: () => import("./module")
};
