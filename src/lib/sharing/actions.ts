import { toast } from "svelte-sonner";
import { openShare, type ShareCopy, type SharePoints } from "$lib/components/dialogs/lazy.svelte";
import type { Dashboard } from "$lib/documents/schema";
import { todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { platform } from "$lib/platform";
import { updateReminderPrefs } from "$lib/safety/reminder";
import { starterDashboard } from "$lib/starter/starter";
import { currentDashboardName, type AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
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
import {
	hasPoints,
	pointSwaps,
	pointsCovered,
	summarizeSwaps,
	swapChange,
	swapNotice,
	withSwaps,
	type PointSwap,
	type SwapSummary
} from "./points";
import { restoreFromEnvelope, type RestoreSummary } from "./restore";
import { settleDocument } from "./settle";

type Target = {
	doc: Dashboard;
	name: string;
	readOnly: boolean;
	isStarter: boolean;
	/** The dashboard's session (not the starter's built-in document). */
	session: DocumentSession | null;
};

/**
 * What to share or export: the dashboard `id`'s stored document, or the current one (the
 * starter's built-in document, for Export only, or the open session's after storing this tab's
 * edits).
 */
async function targetOf(app: AppContext, id?: string): Promise<Target | null> {
	if (id === undefined) {
		const { session, isStarter } = app.current;
		if (!session) return null;
		if (isStarter)
			return {
				doc: starterDashboard(app.starterPlace),
				name: currentDashboardName(app) ?? "",
				readOnly: false,
				isStarter: true,
				session: null
			};
		await session.flush();
		return {
			doc: session.doc,
			name: currentDashboardName(app) ?? "",
			readOnly: !!session.readOnly,
			isStarter: false,
			session
		};
	}
	const session = await app.sessions.get(id, { remember: false });
	if (!session) return null;
	await session.flush();
	return {
		doc: session.doc,
		name: app.index.names.get(id) ?? "",
		readOnly: !!session.readOnly,
		isStarter: false,
		session
	};
}

/** The target with each point swapped for its region, and how to say so; rejects when a lookup fails. */
async function swappedTarget(target: Target): Promise<{ target: Target; summary: SwapSummary }> {
	const swaps = await pointSwaps(target.doc);
	const summary = await summarizeSwaps(swaps);
	return { target: { ...target, doc: withSwaps(target.doc, swaps) }, summary };
}

/**
 * Saves the dashboard's file. An exact location is always exported as its region, and a toast
 * says so (sharing it exactly is a choice in the Share dialog); when a region can't be looked up,
 * no file is saved and the toast offers Retry.
 */
export async function exportDashboard(app: AppContext, id?: string): Promise<void> {
	const target = await targetOf(app, id);
	if (!target) return;
	if (!hasPoints(target.doc)) {
		downloadDocument(target);
		return;
	}
	let swapped: Awaited<ReturnType<typeof swappedTarget>>;
	try {
		swapped = await swappedTarget(target);
	} catch {
		toast.error(m.share_points_failed(), {
			action: {
				label: m.share_points_retry(),
				onClick: () => void exportDashboard(app, id).catch(() => toast.error(m.share_failed()))
			}
		});
		return;
	}
	downloadDocument(swapped.target);
	toast(swapNotice(swapped.summary));
}

function downloadDocument({ doc, name, readOnly }: Target): void {
	const now = new Date();
	platform().files.save(
		dashboardFileName(name, todayPacific(now)),
		readOnly ? rawDocumentFileJson(doc, now) : documentFileJson(doc, now),
		"application/json"
	);
}

/** The copy link and file of `target`. */
async function copyOf(target: Target): Promise<ShareCopy> {
	// A newer or invalid document can't be turned into a link; the file is still offered.
	const result = target.readOnly
		? null
		: await shareUrl(`${location.origin}/workspace/`, target.doc, new Date());
	const url = result && "url" in result ? result.url : null;
	return {
		url,
		linkUnavailable: url ? null : target.readOnly ? "read-only" : "too-big",
		onDownload: () => downloadDocument(target)
	};
}

/**
 * Swaps the points of `session`'s dashboard as it is now for their regions, as one undoable
 * change (`swapChange`). Resolves once the change is stored (so an upload carries it), or
 * `"stale"`, changing nothing, when the dashboard holds a point `swaps` doesn't cover (added or
 * re-picked since).
 */
async function useRegions(
	session: DocumentSession,
	swaps: PointSwap[]
): Promise<"applied" | "stale"> {
	const editing = session.editTarget;
	const doc = editing.doc;
	if (!pointsCovered(doc, swaps)) return "stale";
	const change = swapChange(doc, swaps);
	if (change) editing.apply(change);
	await editing.flush();
	return "applied";
}

/**
 * Opens the Share dialog for the dashboard. The starter is never shared itself: it becomes this
 * person's own copy first (as its first edit would make it), and that copy is shared, so a live
 * link is offered too.
 */
export async function shareDashboard(app: AppContext, id?: string): Promise<void> {
	if (id === undefined && app.current.isStarter) {
		const copy = await app.copyStarter();
		if (!copy) {
			toast.error(m.share_failed());
			return;
		}
		// The person moved on meanwhile: the copy is kept, but not shared.
		if (app.current.session !== copy) return;
	}
	const target = await targetOf(app, id);
	if (!target) return;
	// A live link needs the account's sync and a dashboard it can read and upload.
	const live = app.sync && !target.isStarter && !target.readOnly ? { docId: target.doc.id } : null;
	if (!hasPoints(target.doc)) {
		openShare({ ...(await copyOf(target)), live });
		return;
	}
	const { session } = target;
	// Looked up each time the dialog asks (a Retry asks again), on the dashboard as it is then.
	const points = async (signal: AbortSignal): Promise<SharePoints> => {
		const current =
			session && !target.readOnly ? { ...target, doc: session.editTarget.doc } : target;
		const swaps = await pointSwaps(current.doc, signal);
		const summary = await summarizeSwaps(swaps, signal);
		const [swapped, exact] = await Promise.all([
			copyOf({ ...current, doc: withSwaps(current.doc, swaps) }),
			copyOf(current)
		]);
		return {
			swapped,
			exact,
			summary,
			useRegion: async () => (session ? useRegions(session, swaps) : "stale")
		};
	};
	openShare({ live, points });
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
