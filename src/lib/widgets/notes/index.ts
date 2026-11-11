import SquarePen from "@lucide/svelte/icons/square-pen";
import StickyNote from "@lucide/svelte/icons/sticky-note";
import type { MenuItem } from "$lib/actions/types";
import { openNoteEditor } from "$lib/components/dialogs/lazy.svelte";
import { afterMenuClose } from "$lib/components/menu/menu-state.svelte";
import { NOTE_TYPE } from "$lib/notes/options";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { WidgetMenuEnv, WidgetType } from "../registry";

/** Whether the Note can be edited now: it's in the current, editable dashboard. */
export function noteEditable(app: AppContext | undefined, widgetId: string): boolean {
	const session = app?.current.session;
	return !!session && !session.readOnly && session.doc.body.widgets.some((w) => w.id === widgetId);
}

/** "Edit note", for a Note that can be edited now (none otherwise). */
function editNoteItems(env: WidgetMenuEnv): MenuItem[] {
	const widget = env.widget();
	if (!widget || !noteEditable(env.app, widget.id)) return [];
	const widgetId = widget.id;
	return [
		{
			id: "edit-note",
			label: m.widget_edit_note(),
			icon: SquarePen,
			group: "data",
			run: (ctx) =>
				afterMenuClose(() => {
					// Focus goes back to what opened the menu first, so the editor returns it there.
					(ctx.target as Partial<HTMLElement>).focus?.();
					openNoteEditor({ widgetId });
				})
		}
	];
}

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
	menu: (_ctx, env) => editNoteItems(env),
	load: () => import("./module"),
	addable: () => ({ data: { layers: [] }, options: { text: "" } }),
	// A new Note opens straight into its editor.
	onAdded: (_app, widgetId) => openNoteEditor({ widgetId })
};
