import Copy from "@lucide/svelte/icons/copy";
import FilePlus from "@lucide/svelte/icons/file-plus";
import LayoutTemplate from "@lucide/svelte/icons/layout-template";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import type { Change } from "$lib/changes/types";
import { m } from "$lib/paraglide/messages.js";
import { STARTER_ID, type HomeTarget } from "$lib/starter/starter";
import { currentDashboardName, homeTarget, type AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { newPlaceholder } from "$lib/widgets/placeholder";
import { navigate } from "../../router";
import type { MenuProvider } from "./types";

/** The current dashboard's session when it can be edited. */
function editable(app: AppContext): DocumentSession | null {
	const session = app.current.session;
	return session && !session.readOnly ? session : null;
}

async function openDashboard(id: string, replace = false): Promise<void> {
	await navigate("/dashboards/:id", { params: { id }, replace });
}

async function goHome(target: HomeTarget): Promise<void> {
	if (target.kind === "dashboard") await openDashboard(target.id, true);
	else await navigate("/", { replace: true });
}

/** Adds a placeholder below everything else on the current dashboard. */
export function addWidget(app: AppContext): void {
	const session = editable(app);
	if (!session) return;
	const widgets = session.doc.body.widgets;
	const widget = newPlaceholder(widgets);
	session.apply({
		op: "addWidget",
		target: { widgetId: widget.id },
		widget,
		index: widgets.length
	});
}

/**
 * Opens the rename dialog for a dashboard. `session` is read when the name is saved, so the
 * starter's first edit lands on its copy.
 */
function renameDashboard(app: AppContext, session: () => DocumentSession | null): void {
	const target = session();
	if (!target) return;
	openRename({
		title: m.rename_dashboard_title(),
		initial: target.doc.name ?? "",
		placeholder: app.index.names.get(target.doc.id) ?? currentDashboardName(app) ?? undefined,
		onSave(value) {
			const current = session();
			if (!current || current.readOnly || current.doc.name === value) return;
			current.apply({
				op: "setField",
				target: { path: "name" },
				from: current.doc.name,
				to: value
			});
		}
	});
}

async function duplicateDashboard(app: AppContext): Promise<void> {
	const { session, isStarter } = app.current;
	if (!session || session.readOnly) return;
	// The index copies the stored document, so store this tab's edits first.
	if (!isStarter) await session.flush();
	const id = await app.index.duplicate(isStarter ? STARTER_ID : session.doc.id);
	await openDashboard(id);
	const copy = await app.sessions.get(id);
	if (copy) renameDashboard(app, () => copy);
}

async function deleteDashboard(app: AppContext): Promise<void> {
	const { session, isStarter } = app.current;
	if (!session || session.readOnly || isStarter) return;
	const id = session.doc.id;
	const deletedAt = new Date().toISOString();
	const restore: Change = {
		op: "setField",
		target: { path: "deletedAt" },
		from: deletedAt,
		to: null
	};
	session.apply({ ...restore, from: session.doc.deletedAt ?? null, to: deletedAt });
	await session.flush();
	await app.index.refresh();
	await goHome(await homeTarget(app));
	toast(m.dashboard_deleted(), {
		action: {
			label: m.undo(),
			onClick: () => {
				session.apply(restore);
				void session
					.flush()
					.then(() => app.index.refresh())
					.then(() => openDashboard(id));
			}
		}
	});
}

/** The dashboard's actions; provided on the dashboard and listed in the picker. */
export function dashboardActions(app: AppContext): MenuProvider {
	return () => {
		const { session, isStarter } = app.current;
		const locked = !session || session.readOnly !== false;
		return [
			{
				id: "add-widget",
				label: m.add_widget(),
				icon: Plus,
				group: "add",
				disabled: locked,
				run: () => addWidget(app)
			},
			{
				id: "new-blank-dashboard",
				label: m.dashboard_new_blank(),
				icon: FilePlus,
				group: "create",
				run: () => void app.index.createBlank().then((id) => openDashboard(id))
			},
			{
				id: "new-from-starter",
				label: m.dashboard_new_from_starter(),
				icon: LayoutTemplate,
				group: "create",
				run: () => void app.index.createFromStarter().then((id) => openDashboard(id))
			},
			{
				id: "duplicate-dashboard",
				label: m.dashboard_duplicate(),
				icon: Copy,
				group: "manage",
				disabled: locked,
				run: () => void duplicateDashboard(app)
			},
			{
				id: "rename-dashboard",
				label: m.dashboard_rename(),
				icon: Pencil,
				group: "manage",
				disabled: locked,
				run: () => renameDashboard(app, () => editable(app))
			},
			{
				id: "delete-dashboard",
				label: m.dashboard_delete(),
				icon: Trash2,
				group: "manage",
				// The starter is built in; it can't be deleted.
				disabled: locked || isStarter,
				run: () => void deleteDashboard(app)
			}
		];
	};
}
