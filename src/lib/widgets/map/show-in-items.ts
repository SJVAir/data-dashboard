import ChartLine from "@lucide/svelte/icons/chart-line";
import Table from "@lucide/svelte/icons/table";
import type { MenuItem } from "$lib/actions/types";
import { m } from "$lib/paraglide/messages.js";
import { loadLazy } from "$lib/safety/lazy";
import { report } from "$lib/safety/report";
import type { WidgetMenuEnv } from "../registry";
import { mapSend } from "./send-registry";

/**
 * The Map's "Show in a chart" and "Show in a table" (D13, D15): listed only while the mounted Map
 * has a mark to send, for viewers too (D6, D20). Their code loads when one runs.
 */
export function showInItems(env: WidgetMenuEnv): MenuItem[] {
	const widget = env.widget();
	if (!widget || !mapSend(widget.id)?.marks.length) return [];
	const item = (id: string, label: string, icon: MenuItem["icon"], type: "chart" | "table") => ({
		id,
		label,
		icon,
		group: "data",
		forViewers: true,
		run: () => {
			const widget = env.widget();
			// Read at the click: the marks may have changed since the menu opened.
			const entry = widget && mapSend(widget.id);
			if (!widget || !entry?.marks.length) return;
			const send = { kind: "monitors" as const, ids: [...entry.marks], leftOut: entry.leftOut };
			// A gone chunk (an older deploy) offers a reload; the failure is reported, not swallowed.
			loadLazy(() => import("./show-in"))
				.then((mod) => mod.showIn(env.app, widget.id, send, type))
				.catch((error) => report(error));
		}
	});
	return [
		item("map_show_in_chart", m.map_show_in_chart(), ChartLine, "chart"),
		item("map_show_in_table", m.map_show_in_table(), Table, "table")
	];
}
