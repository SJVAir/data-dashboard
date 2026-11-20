import ChartLine from "@lucide/svelte/icons/chart-line";
import Table from "@lucide/svelte/icons/table";
import type { MenuItem } from "$lib/actions/types";
import { m } from "$lib/paraglide/messages.js";
import { loadLazy } from "$lib/safety/lazy";
import { report } from "$lib/safety/report";
import type { AppContext } from "$lib/store/app.svelte";
import type { WidgetMenuEnv } from "../registry";
import { mapSend } from "./send-registry";
import type { MapSend } from "./show-in";

/** A Show in is opening: a second click (an item or a section's button) waits for it. */
let running = false;

/**
 * Opens the Data Portal with `send` (the Map's items and a section card's button). Ignored while
 * another is still opening, so a double click pushes one history entry.
 */
export function runShowIn(
	app: AppContext,
	widgetId: string,
	send: MapSend,
	type: "chart" | "table" = "chart"
): void {
	if (running) return;
	running = true;
	// A gone chunk (an older deploy) offers a reload; the failure is reported, not swallowed.
	loadLazy(() => import("./show-in"))
		.then((mod) => mod.showIn(app, widgetId, send, type))
		.catch((error) => report(error))
		.finally(() => (running = false));
}

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
			// Read at the click: the widget and its marks may have changed since the menu opened.
			const clicked = env.widget();
			const entry = clicked && mapSend(clicked.id);
			if (!clicked || !entry?.marks.length) return;
			const send = { kind: "monitors" as const, ids: [...entry.marks], leftOut: entry.leftOut };
			runShowIn(env.app, clicked.id, send, type);
		}
	});
	return [
		item("map_show_in_chart", m.map_show_in_chart(), ChartLine, "chart"),
		item("map_show_in_table", m.map_show_in_table(), Table, "table")
	];
}
