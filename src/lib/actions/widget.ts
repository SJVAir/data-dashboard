import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
import ArrowUpToLine from "@lucide/svelte/icons/arrow-up-to-line";
import Copy from "@lucide/svelte/icons/copy";
import FoldHorizontal from "@lucide/svelte/icons/fold-horizontal";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import Minus from "@lucide/svelte/icons/minus";
import Maximize2 from "@lucide/svelte/icons/maximize-2";
import Move from "@lucide/svelte/icons/move";
import Pencil from "@lucide/svelte/icons/pencil";
import Scaling from "@lucide/svelte/icons/scaling";
import Trash2 from "@lucide/svelte/icons/trash-2";
import UnfoldHorizontal from "@lucide/svelte/icons/unfold-horizontal";
import UnfoldVertical from "@lucide/svelte/icons/unfold-vertical";
import type { Component } from "svelte";
import { toast } from "svelte-sonner";
import { announce } from "$lib/a11y/announcer.svelte";
import { ChangeTargetMissing } from "$lib/changes/apply";
import { replaceIfOverlapping } from "$lib/changes/rebase";
import type { Change } from "$lib/changes/types";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import { afterMenuClose } from "$lib/components/menu/menu-state.svelte";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { movedText, resizedText } from "$lib/layout/announcements";
import type { Arrangement } from "$lib/layout/arrangement.svelte";
import { GRID_COLUMNS } from "$lib/layout/config";
import type { Layout } from "$lib/layout/engine";
import { requestFocus } from "$lib/layout/focus-request.svelte";
import { shownLayout } from "$lib/layout/items";
import { actionLayout, dropChange, sameRect, type LayoutAction } from "$lib/layout/steps";
import { copyPlacement, minimizeChange, restoreChange } from "$lib/layout/windowing";
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
	const copy: WidgetInstance = { ...structuredClone(widget), id: crypto.randomUUID() };
	delete copy.minimized;
	Object.assign(copy, copyPlacement(widgets, widget));
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

/** A Move or Size submenu item's result: the change to apply and the layout it gives. */
function arranged(
	app: AppContext,
	widgetId: string,
	action: LayoutAction,
	columns: number
): { session: DocumentSession; change: Change; before: Layout; after: Layout } | null {
	const found = find(app, widgetId);
	if (!found) return null;
	// Built against the document edits land in, as a keyboard drop is.
	const widgets = found.session.editTarget.doc.body.widgets;
	if (!widgets.some((w) => w.id === widgetId && !w.minimized)) return null;
	const before = shownLayout(widgets, GRID_COLUMNS);
	const after = actionLayout(before, widgetId, action, columns);
	const change = after && dropChange(widgets, before, after, widgetId);
	return change && after ? { session: found.session, change, before, after } : null;
}

/** Apply a Move or Size submenu item (one `setLayout`, one undo step) and announce it. */
function arrangeBy(app: AppContext, widgetId: string, action: LayoutAction, columns: number) {
	const result = arranged(app, widgetId, action, columns);
	if (!result) return;
	const { session, change, before, after } = result;
	const title = widgetTitle(find(app, widgetId)!.widget);
	const pushed = after.filter((item) => {
		if (item.id === widgetId) return false;
		const was = before.find((b) => b.id === item.id);
		return !was || !sameRect(was.rect, item.rect);
	}).length;
	const phone = columns === 1;
	// On the starter this first edit makes the person's copy, and the page's grid swap to it
	// may close the menu; later clicks act on the copy.
	session.apply(change);
	announce(
		action.kind === "grow"
			? resizedText(after, widgetId, phone, title)
			: movedText(after, widgetId, phone, title, pushed)
	);
}

/**
 * The Move and Size submenus: one click per step, as one arrow or Shift+arrow press and a drop
 * would give (WCAG 2.5.7's single-pointer alternative to dragging). They stay open after a
 * click, and an item that would change nothing is disabled (read while the menu is open).
 */
function layoutSubmenus(app: AppContext, widgetId: string, arrangement: Arrangement): MenuItem[] {
	const columns = arrangement.columns;
	const phone = columns === 1;
	const item = (id: string, label: string, icon: Component, action: LayoutAction): MenuItem => ({
		id,
		label,
		icon,
		group: "layout",
		keepOpen: true,
		disabled: () => arranged(app, widgetId, action, columns) === null,
		run: () => arrangeBy(app, widgetId, action, columns)
	});
	const step = (dir: "up" | "down" | "left" | "right") => ({ kind: "step", dir }) as const;
	const grow = (dir: "up" | "down" | "left" | "right") => ({ kind: "grow", dir }) as const;
	const moves = [
		item("move-up", m.widget_move_up(), ArrowUp, step("up")),
		item("move-down", m.widget_move_down(), ArrowDown, step("down")),
		...(phone
			? []
			: [
					item("move-left", m.widget_move_left(), ArrowLeft, step("left")),
					item("move-right", m.widget_move_right(), ArrowRight, step("right"))
				]),
		item("move-top", m.widget_move_top(), ArrowUpToLine, { kind: "end", end: "top" }),
		item("move-bottom", m.widget_move_bottom(), ArrowDownToLine, { kind: "end", end: "bottom" })
	];
	const sizes = [
		...(phone
			? []
			: [
					item("size-wider", m.widget_size_wider(), UnfoldHorizontal, grow("right")),
					item("size-narrower", m.widget_size_narrower(), FoldHorizontal, grow("left"))
				]),
		item("size-taller", m.widget_size_taller(), UnfoldVertical, grow("down")),
		item("size-shorter", m.widget_size_shorter(), FoldVertical, grow("up"))
	];
	const locked = find(app, widgetId) === null;
	return [
		{
			id: "move-widget",
			label: m.widget_move(),
			icon: Move,
			group: "layout",
			disabled: locked,
			children: moves,
			run: () => {}
		},
		{
			id: "size-widget",
			label: m.widget_size(),
			icon: Scaling,
			group: "layout",
			disabled: locked,
			children: sizes,
			run: () => {}
		}
	];
}

/**
 * One widget's actions; provided on its frame and opened by its ⋯ button. With the page's
 * `arrangement`, also the Move and Size submenus (not offered while the widget is minimized). With
 * `window.fullscreen`, also Fullscreen; `window.inFullscreen` (the frame is fullscreen) leaves
 * out Move, Size, Minimize, and Fullscreen, and Delete leaves fullscreen (`window.exit`)
 * before it deletes.
 */
export function widgetActions(
	app: AppContext,
	widgetId: string,
	arrangement?: Arrangement,
	window?: { fullscreen?: (id: string) => void; inFullscreen?: boolean; exit?: () => void }
): MenuProvider {
	return () => {
		const locked = find(app, widgetId) === null;
		const layout: MenuItem[] =
			arrangement && !currentWidget(app, widgetId)?.minimized && !window?.inFullscreen
				? layoutSubmenus(app, widgetId, arrangement)
				: [];
		const minimizable = !currentWidget(app, widgetId)?.minimized && !window?.inFullscreen;
		const windowing: MenuItem[] = minimizable
			? [
					{
						id: "minimize-widget",
						label: m.widget_minimize(),
						icon: Minus,
						group: "window",
						disabled: locked,
						// After the menu closes, so its own focus return can't undo the move.
						run: () => afterMenuClose(() => minimizeWidget(app, widgetId))
					}
				]
			: [];
		const fullscreen = window?.fullscreen;
		if (fullscreen && !window?.inFullscreen) {
			// A view, not an edit: never locked, and never makes a starter copy.
			windowing.push(fullscreenItem(widgetId, fullscreen));
		}
		return [
			...layout,
			...windowing,
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
				run: () => {
					// Leaving first means the page knows the widget's going (no missing-widget notice).
					if (window?.inFullscreen) window.exit?.();
					remove(app, widgetId);
				}
			}
		];
	};
}

/** Minimize to the taskbar; announces and moves focus to its taskbar item. */
export function minimizeWidget(app: AppContext, widgetId: string): void {
	const found = find(app, widgetId);
	if (!found) return;
	const change = minimizeChange(found.session.doc.body.widgets, widgetId);
	if (!change) return;
	const title = widgetTitle(found.widget);
	found.session.apply(change);
	announce(m.widget_minimized({ title }));
	requestFocus({ kind: "taskbar", id: widgetId });
}

/** Restore from the taskbar; announces and moves focus to its title bar. */
export function restoreWidget(app: AppContext, widgetId: string): void {
	const found = find(app, widgetId);
	if (!found) return;
	const change = restoreChange(found.session.doc.body.widgets, widgetId);
	if (!change) return;
	const title = widgetTitle(found.widget);
	found.session.apply(change);
	announce(m.widget_restored({ title }));
	requestFocus({ kind: "title", id: widgetId });
}

/** Fullscreen: opened once the menu has closed, so its focus return can't undo the move. */
function fullscreenItem(widgetId: string, fullscreen: (id: string) => void): MenuItem {
	return {
		id: "fullscreen-widget",
		label: m.widget_fullscreen(),
		icon: Maximize2,
		group: "window",
		run: () => afterMenuClose(() => fullscreen(widgetId))
	};
}

const NOT_IN_TASKBAR = new Set(["move-widget", "size-widget", "minimize-widget"]);

/** A taskbar item's actions: Restore, Fullscreen, then the common widget actions. */
export function taskbarActions(
	app: AppContext,
	widgetId: string,
	fullscreen: (id: string) => void
): MenuProvider {
	const common = widgetActions(app, widgetId);
	return (ctx) => [
		{
			id: "restore-widget",
			label: m.widget_restore(),
			icon: ArrowUpFromLine,
			group: "window",
			disabled: find(app, widgetId) === null,
			run: () => afterMenuClose(() => restoreWidget(app, widgetId))
		},
		fullscreenItem(widgetId, fullscreen),
		...common(ctx).filter((item) => !NOT_IN_TASKBAR.has(item.id))
	];
}
