import StickyNote from "@lucide/svelte/icons/sticky-note";
import { NOTE_TYPE } from "$lib/notes/options";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "../registry";

/** Free text with a little Markdown. Its code (and the Markdown parser) loads with the widget. */
export const noteType: WidgetType = {
	type: NOTE_TYPE,
	label: () => m.widget_note_title(),
	icon: StickyNote,
	minSize: { w: 3, h: 2 },
	defaultSize: { w: 4, h: 3 },
	time: "none",
	thresholds: false,
	analyzable: false,
	downloadable: false,
	menu: () => [],
	load: () => import("./module"),
	addable: () => ({ data: { layers: [] }, options: { text: "" } }),
	// Task 3 opens the editor here.
	onAdded: () => {}
};
