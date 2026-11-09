import ChartLine from "@lucide/svelte/icons/chart-line";
import type { MenuItem } from "$lib/actions/types";
import { report } from "$lib/safety/report";
import { loadLazy } from "$lib/safety/lazy";
import { m } from "$lib/paraglide/messages.js";
import { showsSelection } from "$lib/calendars/shown-registry";
import type { WidgetMenuEnv } from "../../registry";

/**
 * The calendars' "Open these days in a chart" item: listed only while the widget shows some of
 * its saved selection of days (not once its range has moved past them). Its code loads when the
 * item runs.
 */
export function openInChartItems(env: WidgetMenuEnv): MenuItem[] {
	const widget = env.widget();
	if (!widget || !showsSelection(widget.id)) return [];
	return [
		{
			id: "calendar_open_in_chart",
			label: m.calendar_open_in_chart(),
			icon: ChartLine,
			group: "widget",
			run: () => {
				const widget = env.widget();
				if (!widget) return;
				// A gone chunk (an older deploy) offers a reload; the failure is reported, not swallowed.
				loadLazy(() => import("./open-in-chart"))
					.then((mod) => mod.openDaysInChart(env.app, widget.id))
					.catch((error) => report(error));
			}
		}
	];
}
