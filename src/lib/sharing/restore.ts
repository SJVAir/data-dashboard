import { loadDashboard } from "$lib/documents/load";
import { docVersion } from "$lib/platform/types";
import type { AppContext } from "$lib/store/app.svelte";
import { MAX_DOCUMENT_CHARS, type Envelope } from "./envelope";
import { rememberCopy } from "./fingerprints";

export type RestoreSummary = { restored: number; kept: number; readOnly: number; skipped: number };

type Stored = Record<string, unknown>;

const isRecord = (value: unknown): value is Stored =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A usable id, or `null` when the document can't be told apart from the others. */
function idOf(raw: unknown): string | null {
	return isRecord(raw) && typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
}

/** Whether the document is small enough to store (a document that can't be measured isn't). */
function withinLimit(raw: unknown): boolean {
	try {
		return JSON.stringify(raw).length <= MAX_DOCUMENT_CHARS;
	} catch {
		return false;
	}
}

/** Brings a dashboard out of Recently deleted as an ordinary change; `false` if it can't be edited. */
async function undelete(app: AppContext, id: string, deletedAt: string): Promise<boolean> {
	const session = await app.sessions.get(id, { remember: false });
	if (!session || session.readOnly) return false;
	session.apply({ op: "setField", target: { path: "deletedAt" }, from: deletedAt, to: null });
	await session.flush();
	return true;
}

/**
 * Restores a backup's dashboards without overwriting anything: one that isn't here comes back
 * with its own id, exactly as stored; one that is here is left alone; one in Recently deleted
 * is undeleted, keeping this browser's version.
 */
export async function restoreFromEnvelope(
	app: AppContext,
	envelope: Envelope
): Promise<RestoreSummary> {
	const { platform, space } = app;
	const summary: RestoreSummary = { restored: 0, kept: 0, readOnly: 0, skipped: 0 };
	const fingerprints = envelope.fingerprints ?? {};

	for (const raw of envelope.documents) {
		const id = idOf(raw);
		if (id === null || !withinLimit(raw)) {
			summary.skipped++;
			continue;
		}
		const stored = await platform.documents.get(space, id);
		let restored = false;
		if (stored === undefined) {
			const result = await platform.documents.commit(space, {
				docId: id,
				baseVersion: null,
				doc: raw,
				entries: []
			});
			if (result.ok) {
				app.channel.post({
					type: "committed",
					space,
					docId: id,
					version: docVersion(raw),
					tabId: app.tabId
				});
				if (loadDashboard(raw).status === "ok") summary.restored++;
				else summary.readOnly++;
				restored = true;
			} else {
				// Stored by another tab meanwhile.
				summary.kept++;
			}
		} else if (isRecord(stored) && typeof stored.deletedAt === "string") {
			if (await undelete(app, id, stored.deletedAt)) {
				summary.restored++;
				restored = true;
			} else summary.kept++;
		} else {
			summary.kept++;
		}
		if (restored && Object.hasOwn(fingerprints, id)) {
			await rememberCopy(platform, space, fingerprints[id], id);
		}
	}

	await app.index.refresh();
	return summary;
}
