import Copy from "@lucide/svelte/icons/copy";
import Move from "@lucide/svelte/icons/move";
import Pencil from "@lucide/svelte/icons/pencil";
import Scaling from "@lucide/svelte/icons/scaling";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import { ChangeTargetMissing } from "$lib/changes/apply";
import { replaceIfOverlapping } from "$lib/changes/rebase";
import type { Change } from "$lib/changes/types";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import { afterMenuClose } from "$lib/components/menu/menu-state.svelte";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import type { Arrangement, ArrangeMode } from "$lib/layout/arrangement.svelte";
import { placeNewWidget } from "$lib/layout/items";
import { getWidgetType } from "$lib/widgets/registry";
import type { MenuItem, MenuProvider } from "./types";

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
		rect: placeNewWidget(widgets, { w: widget.rect.w, h: widget.rect.h })
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
				// another dashboard is current now. Skipped if the widget is already back; moved
				// to the bottom if another widget took its place meanwhile.
				const target = session.editTarget;
				const change: Change = { op: "addWidget", target: { widgetId }, widget, index };
				try {
					target.apply(replaceIfOverlapping(target.doc, change));
				} catch (error) {
					if (!(error instanceof ChangeTargetMissing)) throw error;
				}
			}
		}
	});
}

/** The widget's own entry, read when the menu opens (null if it's not in the document). */
function currentWidget(app: AppContext, widgetId: string): WidgetInstance | null {
	return app.current.session?.doc.body.widgets.find((w) => w.id === widgetId) ?? null;
}

/** Move… / Resize…: once the menu has closed, the widget's frame focuses it and picks it up. */
function arrange(arrangement: Arrangement, widgetId: string, mode: ArrangeMode): void {
	afterMenuClose(() => arrangement.requestPickUp(widgetId, mode));
}

/**
 * One widget's actions; provided on its frame and opened by its ⋯ button. With the page's
 * `arrangement`, also Move… and Resize… (not offered while the widget is minimized).
 */
export function widgetActions(
	app: AppContext,
	widgetId: string,
	arrangement?: Arrangement
): MenuProvider {
	return () => {
		const locked = find(app, widgetId) === null;
		const layout: MenuItem[] =
			arrangement && !currentWidget(app, widgetId)?.minimized
				? [
						{
							id: "move-widget",
							label: m.widget_move(),
							icon: Move,
							group: "layout",
							disabled: locked,
							run: () => arrange(arrangement, widgetId, "move")
						},
						{
							id: "resize-widget",
							label: m.widget_resize(),
							icon: Scaling,
							group: "layout",
							disabled: locked,
							run: () => arrange(arrangement, widgetId, "resize")
						}
					]
				: [];
		return [
			...layout,
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
