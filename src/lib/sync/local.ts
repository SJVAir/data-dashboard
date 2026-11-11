/**
 * Reading a document's local state for sync, and committing server changes into it. Server
 * changes are stored as log entries from `SYNC_TAB`, so open sessions catch up from the change
 * log when `committed` arrives, as they do for another tab's saves.
 */
import { applyChange } from "$lib/changes/apply";
import type { Change } from "$lib/changes/types";
import { loadDashboard } from "$lib/documents/load";
import { upgradeChanges } from "$lib/documents/migrate-changes";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import type { LogEntry } from "$lib/platform/types";
import type { SyncContext } from "./context";
import { canonicalJson, sameContent } from "./merge";
import { SYNC_TAB, type SyncRecord } from "./types";

/** The most a save's `changes` may hold, as characters of JSON (the server allows 2 MB). */
export const MAX_SAVE_CHANGES_CHARS = 1_500_000;

/**
 * A stored document (upgraded if it was in an older format), its sync record, and the local
 * changes the server doesn't have yet (log entries after `syncedThrough` not from `SYNC_TAB`).
 */
export type LocalState = { doc: Dashboard; raw: unknown; record: SyncRecord; unsynced: LogEntry[] };

/** The record of a document that was never uploaded. */
export function emptyRecord(docId: string): SyncRecord {
	return {
		docId,
		serverVersion: null,
		syncedThrough: 0,
		confirmedAt: null,
		inFlight: null,
		hold: null,
		shareToken: null,
		shareExact: false
	};
}

/**
 * `record` with the link's token as the server (or a share) says it is now. The exact choice
 * belongs to the link it was made for: a link turned off, or a different one, starts without it.
 */
export function withShareToken(record: SyncRecord, shareToken: string | null): SyncRecord {
	const shareExact = record.shareExact && shareToken !== null && shareToken === record.shareToken;
	return { ...record, shareToken, shareExact };
}

export async function readLocal(
	ctx: SyncContext,
	docId: string
): Promise<LocalState | "missing" | "newer" | "invalid"> {
	const { platform, space } = ctx;
	const raw = await platform.documents.get(space, docId);
	if (raw === undefined) return "missing";
	const loaded = loadDashboard(raw);
	if (loaded.status !== "ok") return loaded.reason;
	const doc = loaded.doc;
	const record = (await platform.sync.get(space, docId)) ?? emptyRecord(docId);
	const log = await platform.documents.readLog(space, docId, record.syncedThrough);
	if (log === "trimmed") {
		// Only possible before the first upload (a long local history); the create sends the body.
		if (record.serverVersion === null) return { doc, raw, record, unsynced: [] };
		throw new Error("Unsynced changes are missing from the change log");
	}
	// Entries past the document's version were committed after it was read.
	const entries = log.filter((e) => e.version <= doc.version);
	if (entries.some((e) => e.schemaVersion > CURRENT_SCHEMA_VERSION)) return "newer";
	return { doc, raw, record, unsynced: entries.filter((e) => e.tabId !== SYNC_TAB) };
}

/** The entries' changes in the current format (ones that can't be carried over are left out). */
export function currentChanges(entries: LogEntry[]): Change[] {
	return entries.flatMap((e) =>
		e.schemaVersion < CURRENT_SCHEMA_VERSION
			? upgradeChanges([e.change], e.schemaVersion).changes
			: [e.change]
	);
}

/** Whether `changes` turn `from` into `to`, so open tabs can replay them as stored. */
function reproduces(from: Dashboard, changes: Change[], to: Dashboard): boolean {
	try {
		return sameContent(
			changes.reduce((doc, change) => applyChange(doc, change).doc, from),
			to
		);
	} catch {
		return false;
	}
}

/** The changes that turn `from` into `to` when their history is unknown. */
function replacement(from: Dashboard, to: Dashboard): Change[] {
	const changes: Change[] = [];
	if (from.name !== to.name || canonicalJson(from.body) !== canonicalJson(to.body)) {
		changes.push({
			op: "replaceDocument",
			target: {},
			from: { name: from.name, body: from.body },
			to: { name: to.name, body: to.body }
		});
	}
	const deletedFrom = from.deletedAt ?? null;
	const deletedTo = to.deletedAt ?? null;
	if (deletedFrom !== deletedTo) {
		changes.push({
			op: "setField",
			target: { path: "deletedAt" },
			from: deletedFrom,
			to: deletedTo
		});
	}
	return changes;
}

/**
 * Commits `doc` with `theirs` (as SYNC_TAB entries) and `record`, then posts `committed`; false
 * if a tab committed first (read again and retry). `theirs: null` (their changes are unknown),
 * or changes that don't turn the local content into `doc`, write one `replaceDocument` entry
 * from the local content instead, so a tab with unsaved edits prompts rather than replaying
 * them blindly. `record` may be a function of the new local version, for a `syncedThrough`
 * that includes the entries written here.
 */
export async function writeLocal(
	ctx: SyncContext,
	from: LocalState,
	doc: Dashboard,
	theirs: Change[] | null,
	record: SyncRecord | ((version: number) => SyncRecord)
): Promise<boolean> {
	const { platform, space } = ctx;
	const base = from.doc.version;
	const changes =
		theirs !== null && reproduces(from.doc, theirs, doc) ? theirs : replacement(from.doc, doc);
	const entries: LogEntry[] = changes.map((change, i) => ({
		docId: doc.id,
		version: base + i + 1,
		change,
		tabId: SYNC_TAB,
		schemaVersion: CURRENT_SCHEMA_VERSION
	}));
	const version = base + entries.length;
	const result = await platform.documents.commit(space, {
		docId: doc.id,
		baseVersion: base,
		doc: { ...doc, version },
		entries,
		sync: typeof record === "function" ? record(version) : record
	});
	if (!result.ok) return false;
	if (entries.length > 0) {
		ctx.channel.post({ type: "committed", space, docId: doc.id, version, tabId: SYNC_TAB });
	}
	return true;
}

/** Tells every tab that sync records changed. */
export function postSync(ctx: SyncContext, docId: string | null): void {
	ctx.channel.post({ type: "sync", space: ctx.space, docId, tabId: ctx.tabId });
}
