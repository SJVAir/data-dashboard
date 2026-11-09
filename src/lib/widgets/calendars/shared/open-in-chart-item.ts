import ChartLine from "@lucide/svelte/icons/chart-line";
import type { MenuItem } from "$lib/actions/types";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetMenuEnv } from "../../registry";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendars' "Open these days in a chart" item: listed only while the widget holds a saved
 * selection of days. Its code loads when the item runs.
 */
export function openInChartItems(env: WidgetMenuEnv): MenuItem[] {
	const sub = env.widget()?.data.timeSubRange;
	if (!sub || !DATE_KEY.test(sub.start) || !DATE_KEY.test(sub.end)) return [];
	return [
		{
			id: "calendar_open_in_chart",
			label: m.calendar_open_in_chart(),
			icon: ChartLine,
			group: "widget",
			run: () => {
				const widget = env.widget();
				if (!widget) return;
				void import("./open-in-chart").then((mod) => mod.openDaysInChart(env.app, widget.id));
			}
		}
	];
}
