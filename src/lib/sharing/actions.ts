import { toast } from "svelte-sonner";
import { openShare } from "$lib/components/dialogs/ShareDialog.svelte";
import type { Dashboard } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { platform } from "$lib/platform";
import { starterDashboard } from "$lib/starter/starter";
import { currentDashboardName, type AppContext } from "$lib/store/app.svelte";
import { navigate } from "../../router";
import { MAX_BACKUP_BYTES } from "./envelope";
import { documentFileJson, rawDocumentFileJson, shareUrl } from "./export";
import { dashboardFileName } from "./file-names";
import { parseIncoming } from "./incoming";
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
		: await shareUrl(location.origin + import.meta.env.BASE_URL, target.doc, new Date());
	openShare({
		url: result && "url" in result ? result.url : null,
		onDownload: () => downloadDocument(target)
	});
}

/** Picks a file and imports it: a dashboard becomes a copy (asking about an existing one). */
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
	// Restoring a backup arrives with the backup task.
	if (incoming.kind !== "document") {
		toast.error(m.import_file_invalid());
		return;
	}
	try {
		const settled = await settleDocument(app, incoming);
		if (!settled) return;
		await navigate("/dashboards/:id", { params: { id: settled.id } });
		if (settled.saved) toast(m.import_saved());
	} catch {
		toast.error(m.import_file_invalid());
	}
}
