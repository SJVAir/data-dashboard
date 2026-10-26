import { toast } from "svelte-sonner";
import { openShare } from "$lib/components/dialogs/ShareDialog.svelte";
import type { Dashboard } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { platform } from "$lib/platform";
import { updateReminderPrefs } from "$lib/safety/reminder";
import { starterDashboard } from "$lib/starter/starter";
import { currentDashboardName, type AppContext } from "$lib/store/app.svelte";
import { navigate } from "../../router";
import { MAX_BACKUP_BYTES } from "./envelope";
import {
	backupJson,
	documentFileJson,
	rawDocumentFileJson,
	shareUrl,
	unsavedDocuments
} from "./export";
import { backupFileName, dashboardFileName } from "./file-names";
import { parseIncoming } from "./incoming";
import { restoreFromEnvelope, type RestoreSummary } from "./restore";
import { settleDocument } from "./settle";

type Target = { doc: Dashboard; name: string; readOnly: boolean };

/**
 * What to share or export: the dashboard `id`'s stored document, or the current one (the
 * starter's built-in document, or the open session's after storing this tab's edits).
 */
async function targetOf(app: AppContext, id?: string): Promise<Target | null> {
	if (id === undefined) {
		const { session, isStarter } = app.current;
		if (!session) return null;
		if (isStarter)
			return { doc: starterDashboard(), name: currentDashboardName(app) ?? "", readOnly: false };
		await session.flush();
		return {
			doc: session.doc,
			name: currentDashboardName(app) ?? "",
			readOnly: !!session.readOnly
		};
	}
	const session = await app.sessions.get(id, { remember: false });
	if (!session) return null;
	await session.flush();
	return { doc: session.doc, name: app.index.names.get(id) ?? "", readOnly: !!session.readOnly };
}

export async function exportDashboard(app: AppContext, id?: string): Promise<void> {
	const target = await targetOf(app, id);
	if (!target) return;
	downloadDocument(target);
}

function downloadDocument({ doc, name, readOnly }: Target): void {
	const now = new Date();
	platform().files.save(
		dashboardFileName(name, todayPacific(now)),
		readOnly ? rawDocumentFileJson(doc, now) : documentFileJson(doc, now),
		"application/json"
	);
}

export async function shareDashboard(app: AppContext, id?: string): Promise<void> {
	const target = await targetOf(app, id);
	if (!target) return;
	// A newer or invalid document can't be turned into a link; the file is still offered.
	const result = target.readOnly
		? null
		: await shareUrl(`${location.origin}/workspace/`, target.doc, new Date());
	openShare({
		url: result && "url" in result ? result.url : null,
		onDownload: () => downloadDocument(target)
	});
}

/** One toast whose description lists the non-zero outcomes, a whole sentence on each line. */
function toastRestoreSummary({ restored, kept, readOnly, skipped }: RestoreSummary): void {
	const lines: string[] = [];
	if (restored > 0) lines.push(m.restore_restored({ count: restored }));
	if (kept > 0) lines.push(m.restore_kept({ count: kept }));
	if (readOnly > 0) lines.push(m.restore_read_only({ count: readOnly }));
	if (skipped > 0) lines.push(m.restore_skipped({ count: skipped }));
	toast(m.restore_title(), {
		description: (lines.length > 0 ? lines : [m.restore_restored({ count: 0 })]).join("\n"),
		classes: { description: "whitespace-pre-line" }
	});
}

/**
 * Picks a file and imports it: a dashboard becomes a copy (asking about an existing one); a
 * backup is restored without overwriting anything.
 */
export async function importFromFile(app: AppContext): Promise<void> {
	const file = await platform().files.open(".json,application/json");
	if (!file) return;
	if (file.size > MAX_BACKUP_BYTES) {
		toast.error(m.import_file_invalid());
		return;
	}
	let text: string;
	try {
		text = await file.text();
	} catch {
		toast.error(m.import_file_invalid());
		return;
	}
	const incoming = await parseIncoming(text, new Date());
	if (incoming.kind === "error") {
		toast.error(incoming.reason === "newer" ? m.import_newer() : m.import_file_invalid());
		return;
	}
	try {
		if (incoming.kind === "backup") {
			toastRestoreSummary(await restoreFromEnvelope(app, incoming.envelope));
			await navigate("/dashboards");
			return;
		}
		const settled = await settleDocument(app, incoming);
		if (!settled) return;
		await navigate("/dashboards/:id", { params: { id: settled.id } });
		if (settled.saved) toast(m.import_saved());
	} catch {
		toast.error(m.import_file_invalid());
	}
}

/**
 * Saves a backup file of every dashboard (with this tab's edits that couldn't be stored) and
 * notes when, for the backup reminder.
 */
export async function downloadBackup(app: AppContext): Promise<void> {
	const unsaved = await unsavedDocuments(app.openSessions());
	const now = new Date();
	const { platform: storage, space } = app;
	storage.files.save(
		backupFileName(todayPacific(now)),
		await backupJson(storage, space, now, unsaved),
		"application/json"
	);
	await updateReminderPrefs(storage, space, { lastBackupAt: now.toISOString() });
}
