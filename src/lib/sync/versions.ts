/**
 * A document's server snapshots, and keeping the current local version as one before a restore
 * replaces it. Loaded only through the worker (kept out of the initial bundle).
 */
import { docLock, type SyncContext } from "./context";
import { postSync, readLocal } from "./local";
import { saveFields } from "./merge";
import { pullIntoLocked } from "./pull";
import { RemoteRefusal, type RemoteSnapshot, type RemoteSnapshotMeta } from "./remote";
import { remoteCall } from "./upload";

/** The server's snapshots of `docId`, newest first; [] when it was never uploaded. */
export async function serverVersions(
	ctx: SyncContext,
	docId: string
): Promise<RemoteSnapshotMeta[]> {
	const local = await readLocal(ctx, docId);
	if (typeof local !== "string" && local.record.serverVersion === null) return [];
	return remoteCall(() => ctx.remote.listSnapshots(docId), "sync-versions");
}

export function serverVersion(
	ctx: SyncContext,
	docId: string,
	snapshotId: number
): Promise<RemoteSnapshot> {
	return remoteCall(() => ctx.remote.getSnapshot(docId, snapshotId), "sync-versions");
}

/**
 * Keeps the document's current local content as a `conflict` snapshot, under the doc lock.
 * "not-on-server" when it was never uploaded. On `stale_base`, pulls the refusal's state in and
 * keeps the merged content once more; a pull that holds the document throws
 * `RemoteRefusal("stale_base")`.
 */
export function keepBeforeRestore(
	ctx: SyncContext,
	docId: string
): Promise<"kept" | "not-on-server"> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		for (let attempt = 0; ; attempt++) {
			const local = await readLocal(ctx, docId);
			if (typeof local === "string") throw new Error(`Dashboard ${docId} can't be read`);
			const { record, doc } = local;
			if (record.serverVersion === null) return "not-on-server";
			const { schemaVersion, name, body } = saveFields(doc);
			try {
				await remoteCall(
					() =>
						ctx.remote.keepSnapshot(docId, {
							baseVersion: record.serverVersion!,
							schemaVersion,
							name,
							body,
							accountId: ctx.accountId,
							buildId: ctx.buildId
						}),
					"sync-keep"
				);
				return "kept";
			} catch (error) {
				if (!(error instanceof RemoteRefusal)) throw error;
				if (error.code === "gone" || error.code === "not_found") {
					await ctx.platform.sync.put(ctx.space, {
						...record,
						inFlight: null,
						hold: { kind: "gone" }
					});
					postSync(ctx, docId);
					throw error;
				}
				if (error.code !== "stale_base" || !error.staleBase || attempt > 0) throw error;
				const pulled = await pullIntoLocked(ctx, docId, error.staleBase);
				if (pulled === "held") throw error;
				// Merged (or nothing to merge): keep what is now local.
			}
		}
	});
}
