import { MAX_DOCUMENT_CHARS } from "$lib/sharing/envelope";
import { loadDashboard, migrations, type Migration } from "$lib/documents/load";
import type { Dashboard } from "$lib/documents/schema";
import type { AppContext } from "$lib/store/app.svelte";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import type { SnapshotReason } from "$lib/sync/remote";

/** An earlier version of the open dashboard: the kept original, or one of the account's snapshots. */
export type EarlierVersion =
	| { source: "local"; at: string }
	| { source: "server"; at: string; id: number; reason: SnapshotReason };

export type EarlierVersions = { versions: EarlierVersion[]; accountUnreachable: boolean };

/** Newest first. `accountUnreachable` when the server list couldn't be loaded. */
export async function listEarlierVersions(
	app: AppContext,
	session: DocumentSession
): Promise<EarlierVersions> {
	const id = session.doc.id;
	const versions: EarlierVersion[] = [];
	const original = await app.platform.originals.get(app.space, id);
	if (original) versions.push({ source: "local", at: original.keptAt });
	let accountUnreachable = false;
	if (app.sync) {
		try {
			for (const s of await app.sync.versions(id)) {
				versions.push({ source: "server", at: s.createdAt, id: s.id, reason: s.reason });
			}
		} catch {
			accountUnreachable = true;
		}
	}
	versions.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	return { versions, accountUnreachable };
}

export type RestoreResult = "restored" | "unreadable" | "newer" | "unreachable" | "read-only";

type Content = { name: string | null; body: Dashboard["body"] };

/** Same limit as an imported document: serialized size over MAX_DOCUMENT_CHARS (or unserializable). */
function tooLarge(raw: unknown): boolean {
	try {
		return JSON.stringify(raw).length > MAX_DOCUMENT_CHARS;
	} catch {
		return true;
	}
}

/** The chosen version's name and body, upgraded to the current format; or why it can't be. */
async function loadContent(
	app: AppContext,
	session: DocumentSession,
	version: EarlierVersion,
	chain: Migration[]
): Promise<Content | "unreadable" | "newer" | "unreachable"> {
	let raw: unknown;
	if (version.source === "local") {
		const original = await app.platform.originals.get(app.space, session.doc.id);
		if (!original) return "unreadable";
		raw = original.raw;
	} else {
		if (!app.sync) return "unreachable";
		try {
			const snapshot = await app.sync.version(session.doc.id, version.id);
			const { doc } = session;
			// Built like the server's document; only the content comes from the snapshot.
			raw = {
				kind: doc.kind,
				id: doc.id,
				schemaVersion: snapshot.schemaVersion,
				name: snapshot.name,
				body: snapshot.body,
				createdAt: doc.createdAt,
				updatedAt: doc.updatedAt,
				version: doc.version,
				...(doc.copiedFrom ? { copiedFrom: doc.copiedFrom } : {})
			};
		} catch {
			return "unreachable";
		}
	}
	if (tooLarge(raw)) return "unreadable";
	const loaded = loadDashboard(raw, chain);
	if (loaded.status === "ok") return { name: loaded.doc.name, body: loaded.doc.body };
	return loaded.reason === "newer" ? "newer" : "unreadable";
}

/**
 * Loads the version, keeps the current one on the server (account spaces), then applies one
 * `replaceDocument` change (undoable; it syncs like any edit).
 */
export async function restoreEarlierVersion(
	app: AppContext,
	session: DocumentSession,
	version: EarlierVersion,
	chain: Migration[] = migrations
): Promise<RestoreResult> {
	if (session.readOnly) return "read-only";
	await session.flush();
	const content = await loadContent(app, session, version, chain);
	if (typeof content === "string") return content;
	if (app.sync) {
		try {
			await app.sync.keepBeforeRestore(session.doc.id);
		} catch {
			return "unreachable";
		}
	}
	session.apply({
		op: "replaceDocument",
		target: {},
		from: { name: session.doc.name, body: session.doc.body },
		to: { name: content.name, body: content.body }
	});
	return "restored";
}
