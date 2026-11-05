/**
 * "Add to dashboard": the Get data draft as a new widget on a dashboard (one undo step there),
 * and which dashboards the button offers.
 */
import type { WidgetInstance } from "$lib/documents/schema";
import { placeNewWidget } from "$lib/layout/items";
import { m } from "$lib/paraglide/messages.js";
import { STARTER_ID } from "$lib/starter/starter";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { getWidgetType } from "$lib/widgets/registry";
import type { Draft } from "./draft.svelte";

/** A dashboard the draft can be added to, by its display name. */
export type AddTarget = { id: string; name: string };

/** `addFromDraft`'s target for a new blank dashboard. */
export const NEW_DASHBOARD = "new";

/**
 * Adds `draft` as a widget below everything on dashboard `targetId` (`STARTER_ID` makes the
 * starter's copy, as any first edit does; `NEW_DASHBOARD` creates a blank one), at its type's
 * default size: one `addWidget` change, so one undo step. Resolves where it landed. Throws for a
 * dashboard that can't be opened or edited (never offered) or an unknown type.
 */
export async function addFromDraft(
	app: AppContext,
	targetId: string,
	draft: Draft
): Promise<{ dashboardId: string; widgetId: string }> {
	const type = getWidgetType(draft.type);
	if (!type) throw new Error(`Unknown widget type ${draft.type}`);
	const id = targetId === NEW_DASHBOARD ? await app.index.createBlank() : targetId;
	const session = await app.sessions.get(id);
	if (!session || session.readOnly) throw new Error(`Dashboard ${id} can't be edited`);
	const widgets = session.editTarget.doc.body.widgets;
	const widget: WidgetInstance = {
		id: crypto.randomUUID(),
		type: draft.type,
		title: null,
		rect: placeNewWidget(widgets, type.defaultSize),
		data: structuredClone(draft.data),
		...(draft.options ? { options: structuredClone(draft.options) } : {})
	};
	session.apply({
		op: "addWidget",
		target: { widgetId: widget.id },
		widget,
		index: widgets.length
	});
	const target = await landedIn(session);
	return { dashboardId: target.doc.id, widgetId: widget.id };
}

/** The session the edit landed in: the starter's copy once the hand-off is done. */
async function landedIn(session: DocumentSession): Promise<DocumentSession> {
	const handoff = session.handoff;
	if (!handoff) return session.editTarget;
	const copy = await handoff;
	if (!copy) throw new Error("The starter's copy couldn't be stored");
	return copy.editTarget;
}

/**
 * The button's target: the dashboard Get data was opened from (`routeId`), else the last-opened
 * one, else the starter (named as it reads in the nav). `others` are the rest of this space's
 * dashboards, newest change first.
 */
export function addTargets(
	app: AppContext,
	routeId: string | undefined,
	lastOpened: string | undefined
): { selected: AddTarget; others: AddTarget[] } {
	const listed = app.index.items.map((d) => ({
		id: d.id,
		name: app.index.names.get(d.id) ?? m.dashboard_untitled()
	}));
	const find = (id: string | undefined) => listed.find((t) => t.id === id);
	const selected = (routeId === STARTER_ID ? undefined : (find(routeId) ?? find(lastOpened))) ?? {
		id: STARTER_ID,
		name: m.dashboard_starter()
	};
	return { selected, others: listed.filter((t) => t.id !== selected.id) };
}
