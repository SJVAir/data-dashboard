import Copy from "@lucide/svelte/icons/copy";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import { ChangeTargetMissing } from "$lib/changes/apply";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { placeAtBottom } from "$lib/widgets/placement";
import { getWidgetType } from "$lib/widgets/registry";
import type { MenuProvider } from "./types";

/** A widget's display title: its own, else its type's generated one. */
export function widgetTitle(widget: WidgetInstance): string {
	return (
		widget.title ?? getWidgetType(widget.type)?.defaultTitle(widget) ?? m.widget_unknown_title()
	);
}

/** The editable current session and the widget in it, read when an action runs. */
function find(
	app: AppContext,
	widgetId: string
): { session: DocumentSession; widget: WidgetInstance; index: number } | null {
	const session = app.current.session;
	if (!session || session.readOnly) return null;
	const index = session.doc.body.widgets.findIndex((w) => w.id === widgetId);
	if (index === -1) return null;
	return { session, widget: session.doc.body.widgets[index], index };
}

function rename(app: AppContext, widgetId: string): void {
	const found = find(app, widgetId);
	if (!found) return;
	const { widget } = found;
	const generated = getWidgetType(widget.type)?.defaultTitle(widget) ?? m.widget_unknown_title();
	openRename({
		title: m.rename_widget_title(),
		initial: widget.title ?? "",
		placeholder: generated,
		onSave(value) {
			// Re-read: the starter may have handed off to its copy meanwhile.
			const current = find(app, widgetId);
			if (!current || current.widget.title === value) return;
			current.session.apply({
				op: "setField",
				target: { widgetId, path: "title" },
				from: current.widget.title,
				to: value
			});
		}
	});
}

function duplicate(app: AppContext, widgetId: string): void {
	const found = find(app, widgetId);
	if (!found) return;
	const { session, widget } = found;
	const widgets = session.doc.body.widgets;
	const copy: WidgetInstance = {
		...structuredClone(widget),
		id: crypto.randomUUID(),
		rect: placeAtBottom(widgets, { w: widget.rect.w, h: widget.rect.h })
	};
	session.apply({
		op: "addWidget",
		target: { widgetId: copy.id },
		widget: copy,
		index: widgets.length
	});
}

function remove(app: AppContext, widgetId: string): void {
	const found = find(app, widgetId);
	if (!found) return;
	const { session, widget, index } = found;
	session.apply({ op: "removeWidget", target: { widgetId }, widget, index });
	toast(m.widget_deleted(), {
		action: {
			label: m.undo(),
			onClick: () => {
				// The dashboard it was deleted from (a starter forwards to its copy), even if
				// another dashboard is current now. Skipped if the widget is already back.
				try {
					session.apply({ op: "addWidget", target: { widgetId }, widget, index });
				} catch (error) {
					if (!(error instanceof ChangeTargetMissing)) throw error;
				}
			}
		}
	});
}

/** One widget's actions; provided on its frame and opened by its ⋯ button. */
export function widgetActions(app: AppContext, widgetId: string): MenuProvider {
	return () => {
		const locked = find(app, widgetId) === null;
		return [
			{
				id: "rename-widget",
				label: m.widget_rename(),
				icon: Pencil,
				group: "widget",
				disabled: locked,
				run: () => rename(app, widgetId)
			},
			{
				id: "duplicate-widget",
				label: m.widget_duplicate(),
				icon: Copy,
				group: "widget",
				disabled: locked,
				run: () => duplicate(app, widgetId)
			},
			{
				id: "delete-widget",
				label: m.widget_delete(),
				icon: Trash2,
				group: "widget",
				disabled: locked,
				run: () => remove(app, widgetId)
			}
		];
	};
}
