import Download from "@lucide/svelte/icons/download";
import Copy from "@lucide/svelte/icons/copy";
import CopyPlus from "@lucide/svelte/icons/copy-plus";
import FilePlus from "@lucide/svelte/icons/file-plus";
import LayoutTemplate from "@lucide/svelte/icons/layout-template";
import Bell from "@lucide/svelte/icons/bell";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Share2 from "@lucide/svelte/icons/share-2";
import Upload from "@lucide/svelte/icons/upload";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { toast } from "svelte-sonner";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import {
	askWhichPlace,
	openNotifications,
	openPlacePicker,
	openRestoreVersion,
	whichPlace
} from "$lib/components/dialogs/lazy.svelte";
import { afterMenuClose } from "$lib/components/menu/menu-state.svelte";
import type { ChosenPlace } from "$lib/data/schema";
import { barVisible, mainPlaces } from "$lib/places/replace";
import { listEarlierVersions, restoreEarlierVersion } from "$lib/safety/restore-version";
import type { Change } from "$lib/changes/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { loadLazy } from "$lib/safety/lazy";
import { m } from "$lib/paraglide/messages.js";
import { STARTER_ID, type HomeTarget } from "$lib/starter/starter";
import { currentDashboardName, homeTarget, type AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import { placeNewWidget } from "$lib/layout/items";
import { addableWidgetTypes, dataTypes, getWidgetType } from "$lib/widgets/registry";
import { navigate } from "../../router";
import type { MenuContext, MenuProvider } from "./types";

/** The share, export, and import handlers load on first use, keeping `lz-string` out of the entry chunk. */
type Sharing = typeof import("$lib/sharing/actions");

/**
 * Runs a sharing handler; resolves whether it finished. A chunk that won't load is `loadLazy`'s
 * reload notice; any other failure is a toast, not an unhandled rejection.
 */
async function runSharing(
	work: (sharing: Sharing) => Promise<void>,
	failure: string
): Promise<boolean> {
	let sharing: Sharing;
	try {
		sharing = await loadLazy(() => import("$lib/sharing/actions"));
	} catch {
		return false;
	}
	try {
		await work(sharing);
		return true;
	} catch {
		toast.error(failure);
		return false;
	}
}

/** Picks a file to import (the "Import…" action and the list's button). */
export function importDashboardFile(app: AppContext): void {
	void runSharing((s) => s.importFromFile(app), m.import_file_invalid());
}

/**
 * Saves a backup of every dashboard; resolves once the file is handed over (`true`) or it
 * failed (`false`).
 */
export function downloadBackupFile(app: AppContext): Promise<boolean> {
	return runSharing((s) => s.downloadBackup(app), m.backup_failed());
}

/** Starts loading the sharing handlers ahead of use (a failure shows on use). */
export function prefetchSharing(): void {
	import("$lib/sharing/actions").catch(() => {});
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

/** Opens Get data to build a new widget of data type `type` for the current dashboard. */
export function startGetData(app: AppContext, type: string): void {
	const { session, isStarter } = app.current;
	// The menu disables Add widget there too; this guards any other caller.
	if (!session || session.readOnly) return;
	void navigate("/dashboards/:id/widgets/new", {
		params: { id: isStarter ? STARTER_ID : session.doc.id },
		search: { type }
	});
}

/**
 * Adds a widget of `type` below everything else on the current dashboard: at the type's default
 * size, with its `addable` data (one undo step).
 */
export function addWidget(app: AppContext, type: string): void {
	const session = editable(app);
	const widgetType = getWidgetType(type);
	if (!session || !widgetType) return;
	const widgets = session.doc.body.widgets;
	const added = widgetType.addable?.() ?? { data: { layers: [] } };
	const widget: WidgetInstance = {
		id: crypto.randomUUID(),
		type,
		title: null,
		rect: placeNewWidget(widgets, widgetType.defaultSize),
		data: added.data,
		...(added.options ? { options: added.options } : {})
	};
	session.apply({
		op: "addWidget",
		target: { widgetId: widget.id },
		widget,
		index: widgets.length
	});
	widgetType.onAdded?.(app, widget.id);
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
	const copyId = target.isStarter
		? await app.index.duplicate(STARTER_ID, { from: app.starterPlace, to: app.starterPlace })
		: await app.index.duplicate(target.session.doc.id);
	await openDashboard(copyId);
	await nameOpenedCopy(app, copyId);
}

/**
 * The places "Duplicate for another place" could replace: the bar's when it shows (that's what
 * the dashboard is about), else the main place, all of a tie (in reading order); empty when no
 * widget shows a single place.
 */
export function placesToReplace(doc: Dashboard): ChosenPlace[] {
	const bar = doc.body.placeBar;
	return bar && barVisible(doc) ? [bar.place] : mainPlaces(doc);
}

/**
 * "Duplicate for another place": which place to replace (asked on a tie), then the new place,
 * then a copy with that one place replaced, opened and named as Duplicate's is. The original
 * is untouched.
 */
async function duplicateForPlace(app: AppContext, id?: string): Promise<void> {
	const target = await resolveTarget(app, id);
	if (!target || target.session.readOnly) return;
	const candidates = placesToReplace(target.session.doc);
	if (candidates.length === 0) {
		// Only a list row gets here: the open dashboard's menu leaves the item out.
		toast.info(m.dashboard_duplicate_for_another_place_none());
		return;
	}
	const tie = candidates.length > 1;
	const from = tie ? await askWhichPlace(candidates) : candidates[0];
	if (!from) return;
	const pick = (to: ChosenPlace) => void copyWithPlace(app, target, from, to);
	// After the question, focus returns to what asked it, not to the question that's gone.
	openPlacePicker(tie ? { pick, opener: whichPlace.opener } : { pick });
}

async function copyWithPlace(
	app: AppContext,
	target: { session: DocumentSession; isStarter: boolean },
	from: ChosenPlace,
	to: ChosenPlace
): Promise<void> {
	const { session, isStarter } = target;
	if (session.readOnly) return;
	// The index copies the stored document, so store this tab's edits first.
	if (!isStarter) await session.flush();
	// The starter is built at its chosen place, the bar's place `from`.
	const copyId = await app.index.duplicate(isStarter ? STARTER_ID : session.doc.id, { from, to });
	await openDashboard(copyId);
	await nameOpenedCopy(app, copyId);
}

/** Asks what to call a copy that was just opened (Duplicate and "Save mine as a copy"). */
export async function nameOpenedCopy(app: AppContext, copyId: string): Promise<void> {
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
		const why = {
			newer: m.deleted_restore_read_only,
			invalid: m.deleted_restore_unreadable,
			unkept: m.deleted_restore_unkept
		}[session.readOnly];
		toast.info(why());
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

/** Opens the Restore dialog for the current dashboard's earlier versions. */
function restoreVersion(app: AppContext): void {
	const session = editable(app);
	if (!session) return;
	openRestoreVersion(
		() => listEarlierVersions(app, session),
		async (version) => {
			const result = await restoreEarlierVersion(app, session, version);
			if (result === "restored") toast(m.restore_version_done());
			return result;
		}
	);
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
		// Only the open dashboard has earlier versions to restore (a kept original, or the
		// account's snapshots once it has been uploaded), and only when it can be edited.
		const restorable =
			id === undefined &&
			session !== null &&
			!session.readOnly &&
			(session.hasOriginal || app.sync?.states[session.doc.id]?.onServer === true);
		// Data types open Get data; the others are added directly.
		const entries = [
			...dataTypes().map((t) => ({ type: t, run: () => startGetData(app, t.type) })),
			...addableWidgetTypes().map((t) => ({ type: t, run: () => addWidget(app, t.type) }))
		];
		return [
			{
				id: "add-widget",
				label: m.add_widget(),
				icon: Plus,
				group: "add",
				disabled: locked || entries.length === 0,
				children: entries.map(({ type: t, run }) => ({
					id: `add-widget-${t.type}`,
					label: t.label(),
					icon: t.icon,
					group: "add",
					run
				})),
				run: () => {}
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
				run: () =>
					void app.index.createFromStarter(app.starterPlace).then((id) => openDashboard(id))
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
			// A row's dashboard isn't open: it says when there's nothing to replace.
			...(id !== undefined || (session && placesToReplace(session.doc).length > 0)
				? [
						{
							id: "duplicate-for-another-place",
							label: m.dashboard_duplicate_for_another_place(),
							icon: CopyPlus,
							group: "manage" as const,
							disabled: locked,
							run: (ctx: MenuContext) =>
								afterMenuClose(() => {
									// Focus goes back to what opened the menu, so the dialogs return it there.
									(ctx.target as Partial<HTMLElement>).focus?.();
									void duplicateForPlace(app, id);
								})
						}
					]
				: []),
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
							run: () => restoreVersion(app)
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
				id: "notifications",
				label: m.dashboard_notifications_menu(),
				icon: Bell,
				group: "share",
				// Per viewer: any open dashboard (read-only and shared views too), not a row's.
				disabled: id !== undefined || !session,
				run: () => {
					const open = app.current.session;
					if (open) openNotifications(open.doc.id);
				}
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
