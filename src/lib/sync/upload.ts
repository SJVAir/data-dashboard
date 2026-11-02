/**
 * Uploading one document's unsynced changes. A change leaves the queue only once the server
 * confirms the save that holds it (`syncedThrough` moves then); every refusal ends in a result
 * or a hold, and none of them throws (only a local storage failure may).
 */
import { CURRENT_SCHEMA_VERSION, type Dashboard, type DashboardBody } from "$lib/documents/schema";
import { report } from "$lib/safety/report";
import { docLock, type SyncContext } from "./context";
import { MAX_SAVE_CHANGES_CHARS, postSync, readLocal, type LocalState } from "./local";
import { saveFields } from "./merge";
import { moveLocked } from "./move";
import { canonicalJson, pullIntoLocked } from "./pull";
import { RemoteRefusal, RemoteUnavailable, type RemoteDocument, type SaveInput } from "./remote";
import type { SyncHold, SyncRecord } from "./types";

export type UploadResult = "saved" | "nothing" | "held" | "retry" | "signed-out" | "blocked";

/** Merges after stale bases before giving up until the next try. */
const MAX_MERGES = 3;

export function uploadDocument(ctx: SyncContext, docId: string): Promise<UploadResult> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), () => uploadLocked(ctx, docId));
}

async function uploadLocked(ctx: SyncContext, docId: string): Promise<UploadResult> {
	let checked = false;
	let merges = 0;
	// The server took our changes (a recognized lost answer) without a save answering here.
	let confirmed = false;
	for (;;) {
		const local = await readLocal(ctx, docId);
		if (typeof local === "string") return confirmed ? "saved" : "nothing";
		const { record } = local;
		// Refused documents are retried on each new try; the others wait to be settled.
		if (record.hold && record.hold.kind !== "refused") return "held";
		if (record.serverVersion !== null && local.unsynced.length === 0) {
			return confirmed ? "saved" : "nothing";
		}
		if (!checked) {
			if (!(await stillSignedIn(ctx))) return "signed-out";
			checked = true;
		}

		// The earlier unanswered save, which the server may have stored after all.
		const previous = record.inFlight;
		let changes: SaveInput["changes"];
		try {
			changes = await batchChanges(ctx, local);
		} catch (error) {
			return refused(ctx, local, record, error);
		}
		const inFlight = {
			baseVersion: record.serverVersion,
			throughVersion: local.doc.version,
			changes: canonicalJson(changes)
		};
		const sent: SyncRecord = { ...record, inFlight };
		await ctx.platform.sync.put(ctx.space, sent);
		let answer: { version: number };
		try {
			answer = await remoteCall(() =>
				ctx.remote.save(docId, {
					...saveFields(local.doc),
					baseVersion: record.serverVersion,
					changes,
					accountId: ctx.accountId,
					buildId: ctx.buildId,
					snapshot: null
				})
			);
		} catch (error) {
			if (!(error instanceof RemoteRefusal && error.code === "stale_base" && error.staleBase)) {
				return refused(ctx, local, sent, error);
			}
			if (merges >= MAX_MERGES) return "retry";
			merges++;
			const pulled = await pullIntoLocked(ctx, docId, error.staleBase, previous);
			if (pulled === "held") return "held";
			if (pulled === "unchanged") return "retry";
			confirmed = true;
			continue;
		}
		await ctx.platform.sync.put(ctx.space, {
			...record,
			serverVersion: answer.version,
			syncedThrough: inFlight.throughVersion,
			confirmedAt: ctx.now().toISOString(),
			inFlight: null,
			hold: null
		});
		postSync(ctx, docId);
		return "saved";
	}
}

/** Re-checks who is signed in (throttled); false unless it's still the space's account. */
async function stillSignedIn(ctx: SyncContext): Promise<boolean> {
	const { identity } = ctx.platform;
	try {
		await identity.recheck();
	} catch {
		// The current identity stands.
	}
	const current = identity.current();
	return current.state === "signed-in" && current.user.id === ctx.accountId;
}

/**
 * The save's changes: none on create (the body is everything), else the unsynced ones, or (past
 * `MAX_SAVE_CHANGES_CHARS`) one `replaceDocument` from the server's copy.
 */
async function batchChanges(ctx: SyncContext, local: LocalState): Promise<SaveInput["changes"]> {
	if (local.record.serverVersion === null) return [];
	const changes = local.unsynced.map((e) => ({ schemaVersion: e.schemaVersion, change: e.change }));
	if (!oversized(changes)) return changes;
	return replacing(await remoteCall(() => ctx.remote.get(local.doc.id)), local.doc);
}

/** Whether a save's changes are past `MAX_SAVE_CHANGES_CHARS`. */
export function oversized(changes: SaveInput["changes"]): boolean {
	return JSON.stringify(changes).length > MAX_SAVE_CHANGES_CHARS;
}

/** A save's changes as one `replaceDocument` from the server's content to `doc`'s. */
export function replacing(
	server: Pick<RemoteDocument, "name" | "body">,
	doc: Dashboard
): SaveInput["changes"] {
	const from = { name: server.name, body: server.body as DashboardBody };
	return [
		{
			schemaVersion: CURRENT_SCHEMA_VERSION,
			change: { op: "replaceDocument", target: {}, from, to: { name: doc.name, body: doc.body } }
		}
	];
}

/** Runs a remote call; anything it throws that isn't a remote failure is reported, then retried. */
export async function remoteCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (error instanceof RemoteRefusal || error instanceof RemoteUnavailable) throw error;
		report(error, { operation: "sync-upload" });
		throw new RemoteUnavailable("The remote call failed", { cause: error });
	}
}

async function setHold(ctx: SyncContext, record: SyncRecord, hold: SyncHold): Promise<"held"> {
	await ctx.platform.sync.put(ctx.space, { ...record, inFlight: null, hold });
	postSync(ctx, record.docId);
	return "held";
}

/** What a failed save (or the call before it) means for this document. */
async function refused(
	ctx: SyncContext,
	local: LocalState,
	record: SyncRecord,
	error: unknown
): Promise<UploadResult> {
	// Offline, a server error, or a rate limit: everything stays, `inFlight` included.
	if (!(error instanceof RemoteRefusal)) return "retry";
	switch (error.code) {
		case "account_mismatch":
		case "unauthorized":
			// Task 9 hides the space once the identity says who is signed in now.
			await ctx.platform.identity.recheck({ force: true }).catch(() => {});
			return "signed-out";
		case "id_taken":
			await moveLocked(ctx, { ...local, record });
			return "held";
		// `not_found`: the record says the server has it, but it doesn't; as if deleted for good.
		case "gone":
		case "not_found":
			return setHold(ctx, record, { kind: "gone" });
		case "schema_downgrade": {
			let schemaVersion: number;
			try {
				schemaVersion = (await remoteCall(() => ctx.remote.get(local.doc.id))).schemaVersion;
			} catch {
				return "retry";
			}
			return setHold(ctx, record, { kind: "newer", schemaVersion });
		}
		case "build_blocked":
			return "blocked";
		case "too_large":
		case "limit_documents":
		case "limit_storage":
		case "invalid":
			return setHold(ctx, record, { kind: "refused", code: error.code });
		default:
			return "retry";
	}
}
