/**
 * Settling a hold the person answers: a device conflict (Keep mine / Use the other version /
 * Save mine as a copy), a delete elsewhere (Restore / Discard my changes), or a purge (Keep as
 * a new dashboard / Discard). "Keep mine" and "Use the other version" both keep the version
 * they replace as a server snapshot. Any refusal on the way leaves the hold and throws.
 */
import { applyForced, keepMineRestores } from "$lib/changes/rebase";
import type { Change } from "$lib/changes/types";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { forgetDocument } from "$lib/sharing/fingerprints";
import type { ConflictChoice } from "$lib/store/document-session.svelte";
import { docLock, type SyncContext } from "./context";
import {
	currentChanges,
	postSync,
	readLocal,
	withShareToken,
	writeLocal,
	type LocalState
} from "./local";
import { fromRemote, saveFields, theirChanges } from "./merge";
import { finishMoveLocked, moveLocked } from "./move";
import { guardsPoints, mentionsPoint, PointsHeld, pointsHeld } from "./points";
import { pullIntoLocked, type ServerState } from "./pull";
import { RemoteRefusal, type SaveInput } from "./remote";
import { SYNC_TAB, type SyncHold, type SyncRecord } from "./types";
import { oversized, remoteCall, replacing } from "./upload";

export type RemoteChoice = ConflictChoice | "restore" | "discard" | "keep-as-new";

/** The choices each hold offers. */
const CHOICES: Partial<Record<SyncHold["kind"], RemoteChoice[]>> = {
	conflict: ["keep-mine", "use-other", "save-copy"],
	"deleted-elsewhere": ["restore", "discard"],
	gone: ["keep-as-new", "discard"]
};

/** Tabs committing while a choice is written make it read again; this many times at most. */
const MAX_ATTEMPTS = 5;

/**
 * Settles `docId`'s hold with `choice`. Resolves the new dashboard's id for "save-copy" and
 * "keep-as-new", else `null`. If the server moved since the hold was set, it is merged as any
 * newer version (and, still overlapping, held again to ask again).
 */
export function resolveHold(
	ctx: SyncContext,
	docId: string,
	choice: RemoteChoice
): Promise<string | null> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		const local = await readLocal(ctx, docId);
		if (typeof local === "string") throw new Error(`Dashboard ${docId} can't be read`);
		const kind = local.record.hold?.kind;
		if (!kind || !CHOICES[kind]?.includes(choice)) {
			throw new Error(`"${choice}" doesn't settle this dashboard's hold`);
		}
		const result =
			kind === "gone" ? await settleGone(ctx, local, choice) : await settle(ctx, local, choice);
		postSync(ctx, docId);
		return result;
	});
}

/** Purged on the server: kept under a new id (never the purged one), or removed here. */
async function settleGone(
	ctx: SyncContext,
	local: LocalState,
	choice: RemoteChoice
): Promise<string | null> {
	const { platform, space } = ctx;
	const id = local.doc.id;
	let to: string | null = null;
	if (choice === "keep-as-new") {
		// Open tabs follow the `moved` message; edits they make meanwhile are carried over.
		to = await moveLocked(ctx, local);
		await finishMoveLocked(ctx, id);
	} else {
		await platform.documents.remove(space, id);
	}
	for (const entry of platform.journal.list(space)) {
		if (entry.docId === id) platform.journal.clear(space, id, entry.tabId);
	}
	await forgetDocument(platform, space, id);
	return to;
}

async function settle(
	ctx: SyncContext,
	local: LocalState,
	choice: RemoteChoice
): Promise<string | null> {
	const docId = local.doc.id;
	const base = local.record.serverVersion;
	const server = await fetchServer(ctx, docId, base);
	const remote = fromRemote(server.document, local.doc.version);
	if (remote.status === "newer") {
		// A newer build saved it: no choice can apply here. Held as newer instead, so the page
		// shows it read-only until a reload brings that build.
		await ctx.platform.sync.put(ctx.space, {
			...local.record,
			inFlight: null,
			hold: { kind: "newer", schemaVersion: server.document.schemaVersion }
		});
		postSync(ctx, docId);
		throw new Error(`Dashboard ${docId} is in a newer format on the server`);
	}
	if (remote.status !== "ok") throw new Error(`Dashboard ${docId} from the server can't be loaded`);
	const theirs = remote.doc;
	const shared = withShareToken(local.record, server.document.shareToken);
	const mine = currentChanges(local.unsynced);
	try {
		switch (choice) {
			case "keep-mine": {
				// Their deletes of widgets I changed are undone, so my changes to them stand.
				const restores = keepMineRestores(theirChanges(server.changes).changes ?? [], mine);
				const { doc, applied } = applyForced(theirs, [...restores, ...mine]);
				const saved = await saveOver(ctx, shared, server, doc, applied, "conflict");
				await commitSettled(ctx, local, doc, saved, server.document.shareToken);
				return null;
			}
			case "restore": {
				const restore: Change = {
					op: "setField",
					target: { path: "deletedAt" },
					from: theirs.deletedAt ?? null,
					to: null
				};
				const { doc, applied } = applyForced(theirs, [restore, ...mine]);
				const saved = await saveOver(ctx, shared, server, doc, applied, null);
				await commitSettled(ctx, local, doc, saved, server.document.shareToken);
				return null;
			}
			case "use-other":
			case "discard": {
				await remoteCall(() =>
					ctx.remote.keepSnapshot(docId, {
						baseVersion: server.version,
						schemaVersion: local.doc.schemaVersion,
						name: local.doc.name,
						body: local.doc.body,
						accountId: ctx.accountId,
						buildId: ctx.buildId
					})
				);
				await commitSettled(ctx, local, theirs, server.version, server.document.shareToken);
				return null;
			}
			case "save-copy": {
				const copyId = await createCopy(ctx, local.doc);
				await commitSettled(ctx, local, theirs, server.version, server.document.shareToken);
				return copyId;
			}
			default:
				throw new Error(`"${choice}" doesn't settle this dashboard's hold`);
		}
	} catch (error) {
		if (!(error instanceof RemoteRefusal && error.code === "stale_base")) throw error;
		// The server moved after the choice was shown: merged like any newer version.
		await pullIntoLocked(ctx, docId, await fetchServer(ctx, docId, base), null);
		return null;
	}
}

/** The server's document and its changes after `base` (`null` changes: unknown). */
async function fetchServer(
	ctx: SyncContext,
	docId: string,
	base: number | null
): Promise<ServerState> {
	if (base !== null) {
		const answer = await remoteCall(() => ctx.remote.changes(docId, base));
		if ("document" in answer) return answer;
	}
	const document = await remoteCall(() => ctx.remote.get(docId));
	return { version: document.version, changes: document.version === base ? [] : null, document };
}

/**
 * Saves `doc` (the server's version with `applied` on top) on the server's version. Like every
 * upload, refused (`PointsHeld`, nothing sent) while `doc` holds a point its live link mustn't
 * show; `record` is the document's (with the server's token).
 */
async function saveOver(
	ctx: SyncContext,
	record: SyncRecord,
	server: ServerState,
	doc: Dashboard,
	applied: Change[],
	snapshot: SaveInput["snapshot"]
): Promise<number> {
	if (pointsHeld(record, doc)) throw new PointsHeld();
	let changes: SaveInput["changes"] = applied.map((change) => ({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		change
	}));
	if (oversized(changes) || (guardsPoints(record) && mentionsPoint(changes))) {
		changes = replacing(server.document, doc);
	}
	const answer = await remoteCall(() =>
		ctx.remote.save(doc.id, {
			...saveFields(doc),
			baseVersion: server.version,
			changes,
			accountId: ctx.accountId,
			buildId: ctx.buildId,
			snapshot
		})
	);
	return answer.version;
}

/** Stores `doc` as a new dashboard (new id, never uploaded); resolves its id. */
async function createCopy(ctx: SyncContext, doc: Dashboard): Promise<string> {
	const { platform, space } = ctx;
	const at = ctx.now().toISOString();
	const copy: Dashboard = {
		...doc,
		id: crypto.randomUUID(),
		copiedFrom: doc.id,
		version: 0,
		createdAt: at,
		updatedAt: at
	};
	const created = await platform.documents.commit(space, {
		docId: copy.id,
		baseVersion: null,
		doc: copy,
		entries: []
	});
	if (!created.ok) throw new Error(`Dashboard ${copy.id} already exists`);
	// So the list shows it; the sync worker uploads it as a create.
	ctx.channel.post({ type: "committed", space, docId: copy.id, version: 0, tabId: SYNC_TAB });
	return copy.id;
}

/**
 * Writes `doc` (the server's `serverVersion`, shared as `shareToken`) here, synced, with the hold
 * cleared. Edits a tab committed after `read` stay unsynced, on top of it.
 */
async function commitSettled(
	ctx: SyncContext,
	read: LocalState,
	doc: Dashboard,
	serverVersion: number,
	shareToken: string | null
): Promise<void> {
	const confirmedAt = ctx.now().toISOString();
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const local = attempt === 0 ? read : await readLocal(ctx, read.doc.id);
		if (typeof local === "string") throw new Error(`Dashboard ${read.doc.id} can't be read`);
		const later = local.unsynced.filter((e) => e.version > read.doc.version);
		const target = later.length === 0 ? doc : applyForced(doc, currentChanges(later)).doc;
		const written = await writeLocal(ctx, local, target, null, (version) => ({
			...withShareToken(read.record, shareToken),
			serverVersion,
			// With later edits, only the ones settled here count as synced.
			syncedThrough: later.length === 0 ? version : read.doc.version,
			confirmedAt,
			inFlight: null,
			hold: null
		}));
		if (written) return;
	}
	throw new Error(`Dashboard ${read.doc.id} kept changing`);
}
