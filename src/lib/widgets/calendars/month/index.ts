import CalendarDays from "@lucide/svelte/icons/calendar-days";
import { MONTH_CALENDAR_TYPE } from "$lib/calendars/types";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../../registry";
import { openInChartItems } from "../shared/open-in-chart-item";

/** A month of days colored by their daily rating. */
export const monthCalendarType: WidgetType = {
	type: MONTH_CALENDAR_TYPE,
	label: () => m.widget_calendar_month_title(),
	icon: CalendarDays,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 4, h: 6 },
	time: "range",
	thresholds: true,
	analyzable: true,
	downloadable: true,
	accepts: {
		datasets: ["air-quality"],
		maxPollutantLayers: 1,
		maxPlaces: 1,
		onlyPollutant: true
	},
	resolution: "day",
	span: { minDays: 1, maxDays: 366 },
	defaultRange: { kind: "to-date", unit: "month" },
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: (_ctx, env) => openInChartItems(env),
	load: () => import("./module")
};
