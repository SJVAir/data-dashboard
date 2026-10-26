import Download from "@lucide/svelte/icons/download";
import Copy from "@lucide/svelte/icons/copy";
import FilePlus from "@lucide/svelte/icons/file-plus";
import LayoutTemplate from "@lucide/svelte/icons/layout-template";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Share2 from "@lucide/svelte/icons/share-2";
import Upload from "@lucide/svelte/icons/upload";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import { openRestoreVersion } from "$lib/components/dialogs/RestoreVersionDialog.svelte";
import { restoreOriginal } from "$lib/safety/restore-version";
import type { Change } from "$lib/changes/types";
import { loadLazy } from "$lib/safety/lazy";
import { m } from "$lib/paraglide/messages.js";
import { STARTER_ID, type HomeTarget } from "$lib/starter/starter";
import { currentDashboardName, homeTarget, type AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { newPlaceholder } from "$lib/widgets/placeholder";
import { navigate } from "../../router";
import type { MenuProvider } from "./types";

/** The share, export, and import handlers load on first use, keeping `lz-string` out of the entry chunk. */
type Sharing = typeof import("$lib/sharing/actions");

/**
 * Runs a sharing handler. A chunk that won't load is `loadLazy`'s reload notice; any other
 * failure is a toast, not an unhandled rejection.
 */
async function runSharing(work: (sharing: Sharing) => Promise<void>, failure: string) {
	let sharing: Sharing;
	try {
		sharing = await loadLazy(() => import("$lib/sharing/actions"));
	} catch {
		return;
	}
	try {
		await work(sharing);
	} catch {
		toast.error(failure);
	}
}

/** Picks a file to import (the "Import…" action and the list's button). */
export function importDashboardFile(app: AppContext): void {
	void runSharing((s) => s.importFromFile(app), m.import_file_invalid());
}

/** Saves a backup of every dashboard (the list's button). */
export function downloadBackupFile(app: AppContext): void {
	void runSharing((s) => s.downloadBackup(app), m.backup_failed());
}

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

async function duplicateDashboard(app: AppContext, id?: string): Promise<void> {
	const target = await resolveTarget(app, id);
	if (!target || target.session.readOnly) return;
	// The index copies the stored document, so store this tab's edits first.
	if (!target.isStarter) await target.session.flush();
	const copyId = await app.index.duplicate(target.isStarter ? STARTER_ID : target.session.doc.id);
	await openDashboard(copyId);
	const copy = await app.sessions.get(copyId);
	if (copy) renameDashboard(app, () => copy);
}

/**
 * The dashboard an action works on: `id`'s (opened without recording it as last opened), or
 * the current one.
 */
async function resolveTarget(
	app: AppContext,
	id?: string
): Promise<{ session: DocumentSession; isStarter: boolean } | null> {
	if (id === undefined) {
		const { session, isStarter } = app.current;
		return session ? { session, isStarter } : null;
	}
	const session = await app.sessions.get(id, { remember: false });
	return session ? { session, isStarter: false } : null;
}

/**
 * Leaves `session`'s dashboard, which was just deleted (by Delete or by undoing its restore):
 * opens what `/workspace/` resolves to among the rest.
 */
export async function leaveDeletedDashboard(
	app: AppContext,
	session: DocumentSession
): Promise<void> {
	await session.flush();
	await app.index.refresh();
	// Restored meanwhile, or the person moved on.
	if (session.doc.deletedAt === undefined || app.current.session !== session) return;
	await goHome(await homeTarget(app));
}

/**
 * Soft-deletes `session`'s dashboard with an Undo toast. `onUndone` runs once the restore has
 * been stored and the index refreshed.
 */
function softDelete(
	app: AppContext,
	session: DocumentSession,
	onUndone: (id: string) => void | Promise<void>
): void {
	const id = session.doc.id;
	const deletedAt = new Date().toISOString();
	const restore: Change = {
		op: "setField",
		target: { path: "deletedAt" },
		from: deletedAt,
		to: null
	};
	session.apply({ ...restore, from: session.doc.deletedAt ?? null, to: deletedAt });
	toast(m.dashboard_deleted(), {
		action: {
			label: m.undo(),
			onClick: () => {
				session.apply(restore);
				void session
					.flush()
					.then(() => app.index.refresh())
					.then(() => onUndone(id));
			}
		}
	});
}

/**
 * Brings a dashboard out of Recently deleted (as an ordinary, undoable change that syncs to
 * other tabs) and opens it.
 */
export async function restoreDeleted(app: AppContext, id: string): Promise<void> {
	const session = await app.sessions.get(id, { remember: false });
	if (!session) return;
	if (session.readOnly) {
		toast.error(m.deleted_restore_read_only());
		return;
	}
	if (session.doc.deletedAt === undefined) return;
	session.apply({
		op: "setField",
		target: { path: "deletedAt" },
		from: session.doc.deletedAt,
		to: null
	});
	await session.flush();
	await app.index.refresh();
	await openDashboard(id);
}

/** Opens the Restore dialog for the current dashboard's kept original. */
async function restoreVersion(app: AppContext): Promise<void> {
	const session = editable(app);
	if (!session) return;
	const original = await app.platform.originals.get(app.space, session.doc.id);
	if (!original) return;
	openRestoreVersion(original, async () => {
		const restored = await restoreOriginal(app, session);
		if (restored) toast(m.restore_version_done());
		return restored;
	});
}

async function deleteDashboard(app: AppContext, id?: string): Promise<void> {
	const target = await resolveTarget(app, id);
	if (!target || target.session.readOnly || target.isStarter) return;
	const { session } = target;
	if (id === undefined) {
		// The page leaves a dashboard once it's deleted (`leaveDeletedDashboard`).
		softDelete(app, session, (restored) => openDashboard(restored));
		return;
	}
	softDelete(app, session, () => {});
	await session.flush();
	await app.index.refresh();
}

/**
 * The dashboard's actions; provided on the dashboard, listed in the picker, and on the list's
 * rows (with that row's dashboard `id`, which the manage actions then work on instead of the
 * current dashboard).
 */
export function dashboardActions(app: AppContext, id?: string): MenuProvider {
	return () => {
		const { session, isStarter } = app.current;
		// A row's dashboard isn't open; its actions check when they run.
		const locked = id === undefined && (!session || session.readOnly !== false);
		// Only the open dashboard has a kept original to restore, and only when it can be edited.
		const restorable = id === undefined && session?.hasOriginal === true && !session.readOnly;
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
				id: "import",
				label: m.import_action(),
				icon: Upload,
				group: "create",
				run: () => importDashboardFile(app)
			},
			{
				id: "duplicate-dashboard",
				label: m.dashboard_duplicate(),
				icon: Copy,
				group: "manage",
				disabled: locked,
				run: () => void duplicateDashboard(app, id)
			},
			{
				id: "rename-dashboard",
				label: m.dashboard_rename(),
				icon: Pencil,
				group: "manage",
				disabled: locked,
				run: () => {
					if (id === undefined) renameDashboard(app, () => editable(app));
					else void resolveTarget(app, id).then((t) => t && renameDashboard(app, () => t.session));
				}
			},
			...(restorable
				? [
						{
							id: "restore-version",
							label: m.restore_version_action(),
							icon: History,
							group: "manage" as const,
							run: () => void restoreVersion(app)
						}
					]
				: []),
			{
				id: "delete-dashboard",
				label: m.dashboard_delete(),
				icon: Trash2,
				group: "manage",
				// The starter is built in; it can't be deleted.
				disabled: locked || (id === undefined && isStarter),
				run: () => void deleteDashboard(app, id)
			},
			{
				id: "share-dashboard",
				label: m.share_action(),
				icon: Share2,
				group: "share",
				// The starter and a row's dashboard are shareable; a read-only one is checked when it runs.
				disabled: id === undefined && !session,
				run: () => void runSharing((s) => s.shareDashboard(app, id), m.share_failed())
			},
			{
				id: "export-dashboard",
				label: m.export_action(),
				icon: Download,
				group: "share",
				disabled: id === undefined && !session,
				run: () => void runSharing((s) => s.exportDashboard(app, id), m.share_failed())
			}
		];
	};
}
