import CalendarRange from "@lucide/svelte/icons/calendar-range";
import { CONTRIBUTION_CALENDAR_TYPE } from "$lib/calendars/types";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../../registry";
import { openInChartItems } from "../shared/open-in-chart-item";

/** A year of days as a contribution-style grid. */
export const contributionCalendarType: WidgetType = {
	type: CONTRIBUTION_CALENDAR_TYPE,
	label: () => m.widget_calendar_year_title(),
	icon: CalendarRange,
	minSize: { w: 3, h: 4 },
	defaultSize: { w: 12, h: 3 },
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
	span: { minDays: 7, maxDays: 731 },
	defaultRange: { kind: "trailing", amount: 12, unit: "month" },
	// Type-specific items only; the widget frame adds the common widget actions.
	menu: (_ctx, env) => openInChartItems(env),
	load: () => import("./module")
};
