/** Deleting a dashboard from Recently deleted for good, on the server and then locally. */
import { report } from "$lib/safety/report";
import { docLock, type SyncContext } from "./context";
import { postSync, readLocal } from "./local";
import { pullIntoLocked } from "./pull";
import { RemoteRefusal, RemoteUnavailable } from "./remote";
import { remoteCall, uploadDocument } from "./upload";

export type DeleteResult = "deleted" | "restored-elsewhere" | "unreachable" | "not-saved";

/**
 * Permanently deletes a dashboard in Recently deleted from the account (call 4), then the
 * caller removes it locally. Never uploaded: "deleted" with no request.
 */
export async function deletePermanently(ctx: SyncContext, docId: string): Promise<DeleteResult> {
	const first = await ctx.platform.sync.get(ctx.space, docId);
	if (!first) return "deleted";
	// Never uploaded: nothing on the server. With a first create sent and unanswered, it may be.
	if (first.serverVersion === null && first.inFlight === null) return "deleted";
	// The trashing itself may not be on the server yet: the server refuses to purge a live one.
	const uploaded = await uploadDocument(ctx, docId);
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		const local = await readLocal(ctx, docId);
		if (typeof local === "string") return "unreachable";
		if (local.doc.deletedAt === undefined) return "restored-elsewhere";
		if (local.record.hold || local.unsynced.length > 0) {
			return uploaded === "retry" || uploaded === "signed-out" ? "unreachable" : "not-saved";
		}
		try {
			await remoteCall(() => ctx.remote.deletePermanently(docId), "sync-delete");
			return "deleted";
		} catch (error) {
			if (error instanceof RemoteUnavailable) return "unreachable";
			if (error instanceof RemoteRefusal) {
				if (error.code === "gone" || error.code === "not_found") return "deleted";
				if (error.code === "not_deleted") {
					await pullRestored(ctx, docId, local.record.serverVersion);
					return "restored-elsewhere";
				}
				return "unreachable";
			}
			throw error;
		}
	});
}

/** Brings in the restored document now, under the doc lock; if that fails the poll will. */
async function pullRestored(ctx: SyncContext, docId: string, base: number | null): Promise<void> {
	if (base === null) return;
	try {
		const answer = await remoteCall(() => ctx.remote.changes(docId, base), "sync-delete");
		if ("document" in answer) await pullIntoLocked(ctx, docId, answer);
		postSync(ctx, docId);
	} catch (error) {
		// Offline or refused: the next poll brings it back. Anything else is a bug: report it.
		if (error instanceof RemoteUnavailable || error instanceof RemoteRefusal) return;
		report(error, { operation: "sync-delete" });
	}
}
