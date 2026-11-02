/**
 * Bringing the server's newer versions into local storage: merging one document's newer server
 * version, the list-since poll that finds which documents moved, and fetching missing ones.
 */
import { applyChange } from "$lib/changes/apply";
import type { Dashboard } from "$lib/documents/schema";
import { RETENTION_MS } from "$lib/safety/purge";
import { report } from "$lib/safety/report";
import { forgetDocument } from "$lib/sharing/fingerprints";
import { docLock, type SyncContext } from "./context";
import {
	currentChanges,
	emptyRecord,
	postSync,
	readLocal,
	writeLocal,
	type LocalState
} from "./local";
import {
	canonicalJson,
	fromRemote,
	mergeRemote,
	remoteRaw,
	sameContent,
	theirChanges
} from "./merge";
import { RemoteRefusal, type RemoteChange, type RemoteDocument, type RemoteMeta } from "./remote";
import type { SyncHold, SyncRecord } from "./types";

export type ServerState = {
	version: number;
	/** The changes after the record's `serverVersion` (`null`: the log doesn't reach back). */
	changes: RemoteChange[] | null;
	document: RemoteDocument;
};

export type PullResult = "merged" | "held" | "unchanged";

type InFlight = SyncRecord["inFlight"];

/** Tabs committing during a merge make it read again; this many times at most. */
const MAX_ATTEMPTS = 5;

/** Merges a server state into local storage under the doc lock. */
export function pullInto(
	ctx: SyncContext,
	docId: string,
	server: ServerState
): Promise<PullResult> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), () =>
		pullIntoLocked(ctx, docId, server)
	);
}

/**
 * `pullInto` for a caller already holding the doc lock (Web Locks aren't re-entrant).
 * `inFlight` is the unanswered save to recognize (default: the record's; `null`: none).
 */
export async function pullIntoLocked(
	ctx: SyncContext,
	docId: string,
	server: ServerState,
	inFlight?: InFlight
): Promise<PullResult> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const local = await readLocal(ctx, docId);
		// A newer local format, or nothing stored: leave it (`pollList` fetches missing ones).
		if (typeof local === "string") return "unchanged";
		const unanswered = inFlight === undefined ? local.record.inFlight : inFlight;
		const result = await mergeOnce(ctx, local, server, unanswered);
		if (result !== "raced") return result;
	}
	return "unchanged";
}

/**
 * The server version that is the unanswered save `inFlight`, or null. A save on a base: the
 * server's next version carries exactly its changes. A create: the server's document is the
 * local one without the edits made since the create was sent.
 */
function answeredVersion(
	local: LocalState,
	server: ServerState,
	inFlight: InFlight
): number | null {
	if (!inFlight || inFlight.baseVersion !== local.record.serverVersion) return null;
	if (inFlight.baseVersion === null) {
		const remote = fromRemote(server.document, local.doc.version);
		if (remote.status !== "ok") return null;
		const later = local.unsynced.filter((e) => e.version > inFlight.throughVersion);
		let doc: Dashboard = remote.doc;
		try {
			for (const change of currentChanges(later)) doc = applyChange(doc, change).doc;
		} catch {
			return null;
		}
		return sameContent(doc, local.doc) ? server.version : null;
	}
	const next = inFlight.baseVersion + 1;
	if (server.changes === null || server.version < next) return null;
	const sent = server.changes
		.filter((c) => c.version === next)
		.map((c) => ({ schemaVersion: c.schemaVersion, change: c.change }));
	return canonicalJson(sent) === inFlight.changes ? next : null;
}

async function hold(ctx: SyncContext, record: SyncRecord, held: SyncHold): Promise<"held"> {
	await ctx.platform.sync.put(ctx.space, { ...record, inFlight: null, hold: held });
	postSync(ctx, record.docId);
	return "held";
}

async function mergeOnce(
	ctx: SyncContext,
	local: LocalState,
	server: ServerState,
	inFlight: InFlight
): Promise<PullResult | "raced"> {
	let record = local.record;
	if (record.hold?.kind === "moved") return "unchanged";
	if (record.serverVersion !== null && server.version <= record.serverVersion) return "unchanged";
	const confirmedAt = ctx.now().toISOString();
	let changes = record.serverVersion === null ? null : server.changes;

	const answered = answeredVersion(local, server, inFlight);
	if (answered !== null && inFlight) {
		record = {
			...record,
			serverVersion: answered,
			syncedThrough: inFlight.throughVersion,
			confirmedAt,
			inFlight: null
		};
		const unsynced = local.unsynced.filter((e) => e.version > inFlight.throughVersion);
		local = { ...local, record, unsynced };
		if (answered === server.version) {
			await ctx.platform.sync.put(ctx.space, record);
			postSync(ctx, record.docId);
			return "merged";
		}
		changes = changes?.filter((c) => c.version > answered) ?? null;
	}

	const remote = fromRemote(server.document, local.doc.version);
	if (remote.status === "newer") {
		return hold(ctx, record, { kind: "newer", schemaVersion: server.document.schemaVersion });
	}
	if (remote.status !== "ok") {
		report(new Error("A dashboard from the server couldn't be loaded"), {
			operation: "sync-pull"
		});
		return hold(ctx, record, { kind: "refused", code: "invalid" });
	}
	const theirs = theirChanges(changes);
	const out = mergeRemote({
		server: remote.doc,
		theirs: theirs.changes,
		dropped: theirs.dropped,
		mine: currentChanges(local.unsynced)
	});
	const pulled = {
		...record,
		serverVersion: server.version,
		confirmedAt,
		inFlight: null,
		hold: null
	};
	let written: boolean;
	switch (out.kind) {
		case "take-server":
			written = await writeLocal(
				ctx,
				local,
				remote.doc,
				theirs.dropped > 0 ? null : theirs.changes,
				(version) => ({ ...pulled, syncedThrough: version })
			);
			break;
		case "rebased":
			// Mine stay unsynced (after `syncedThrough`), on top of the server's version.
			written = await writeLocal(ctx, local, out.doc, theirs.changes, pulled);
			break;
		case "conflict":
			return hold(ctx, record, {
				kind: "conflict",
				serverVersion: server.version,
				reason: out.reason
			});
		case "deleted-elsewhere":
			return hold(ctx, record, { kind: "deleted-elsewhere", serverVersion: server.version });
	}
	if (!written) return "raced";
	postSync(ctx, record.docId);
	return "merged";
}

/** Preference key: the cursor the server gave with the last list, for the next poll. */
export const SYNC_CURSOR_KEY = "syncCursor";

/** A refusal meaning the server has no such document of this account. */
const absent = (error: unknown) =>
	error instanceof RemoteRefusal && (error.code === "gone" || error.code === "not_found");

/**
 * One list-since poll: new documents, moved ones, purged ids. Saves the new cursor only once
 * every document in the answer was handled, so a failed poll is repeated in full.
 */
export async function pollList(ctx: SyncContext): Promise<void> {
	const { platform, space } = ctx;
	const since = await platform.preferences.get<string>(space, SYNC_CURSOR_KEY);
	const list = await ctx.remote.list(since);
	for (const meta of list.documents) await pollOne(ctx, meta);
	for (const id of list.purged) await purgedOnServer(ctx, id);
	await platform.preferences.set(space, SYNC_CURSOR_KEY, list.cursor);
}

async function pollOne(ctx: SyncContext, meta: RemoteMeta): Promise<void> {
	const { platform, space } = ctx;
	try {
		if ((await platform.documents.get(space, meta.id)) === undefined) {
			// Deleted long enough ago that Recently deleted would have purged it here.
			if (
				meta.deletedAt !== null &&
				ctx.now().getTime() - Date.parse(meta.deletedAt) > RETENTION_MS
			) {
				return;
			}
			await storeFromServer(ctx, await ctx.remote.get(meta.id));
			return;
		}
		const record = await platform.sync.get(space, meta.id);
		// Never uploaded: its upload meets the server's copy (a stale base) and merges then.
		if (!record || record.serverVersion === null || meta.version <= record.serverVersion) return;
		const answer = await ctx.remote.changes(meta.id, record.serverVersion);
		if ("document" in answer) await pullInto(ctx, meta.id, answer);
	} catch (error) {
		// Purged since it was listed: the next poll's `purged` says so.
		if (!absent(error)) throw error;
	}
}

/** Fetches a document that isn't stored here; false when the server doesn't have it. */
export async function fetchMissing(ctx: SyncContext, docId: string): Promise<boolean> {
	let doc: RemoteDocument;
	try {
		doc = await ctx.remote.get(docId);
	} catch (error) {
		if (absent(error)) return false;
		throw error;
	}
	return storeFromServer(ctx, doc);
}

/**
 * Stores the server's document at local version 0, synced. A newer format is stored as it came
 * (the app shows it needs an update, as for one a newer build saved here); one that can't be
 * loaded is reported and left out.
 */
async function storeFromServer(ctx: SyncContext, remote: RemoteDocument): Promise<boolean> {
	const loaded = fromRemote(remote, 0);
	if (loaded.status === "invalid") {
		report(new Error("A dashboard from the server couldn't be loaded"), {
			operation: "sync-fetch"
		});
		return false;
	}
	const doc = loaded.status === "ok" ? loaded.doc : remoteRaw(remote, 0);
	const { platform, space } = ctx;
	await platform.locks.run(docLock(space, remote.id), async () => {
		// Already here (a tab or another poll stored it first): that copy stands.
		if ((await platform.documents.get(space, remote.id)) !== undefined) return;
		await platform.documents.commit(space, {
			docId: remote.id,
			baseVersion: null,
			doc,
			entries: [],
			sync: {
				docId: remote.id,
				serverVersion: remote.version,
				syncedThrough: 0,
				confirmedAt: ctx.now().toISOString(),
				inFlight: null,
				hold: null
			}
		});
		postSync(ctx, remote.id);
	});
	return true;
}

/** A document the server purged: removed here, unless it has changes the server never got. */
async function purgedOnServer(ctx: SyncContext, docId: string): Promise<void> {
	const { platform, space } = ctx;
	await platform.locks.run(docLock(space, docId), async () => {
		const local = await readLocal(ctx, docId);
		if (local === "missing") return;
		const record = typeof local === "string" ? await platform.sync.get(space, docId) : local.record;
		if (record?.hold?.kind === "moved") return;
		const synced =
			typeof local !== "string" && record?.serverVersion !== null && local.unsynced.length === 0;
		if (synced) {
			await platform.documents.remove(space, docId);
			await forgetDocument(platform, space, docId);
		} else if (record?.hold?.kind !== "gone") {
			await platform.sync.put(space, {
				...(record ?? emptyRecord(docId)),
				inFlight: null,
				hold: { kind: "gone" }
			});
		}
		postSync(ctx, docId);
	});
}
