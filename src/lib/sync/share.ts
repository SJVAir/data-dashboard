/**
 * Turning a dashboard's live share link on and off. The token lives in the sync record (sharing
 * isn't an edit: no undo, no change log, no version), so every tab sees it through `sync`.
 */
import type { Dashboard } from "$lib/documents/schema";
import { docLock, type SyncContext } from "./context";
import { postSync, readLocal } from "./local";
import { RemoteRefusal, RemoteUnavailable } from "./remote";
import type { SyncHold } from "./types";
import { remoteCall, uploadDocument } from "./upload";

export type ShareResult =
	/** `unsynced`: the link shows the last synced version (edits here didn't upload). */
	| { kind: "shared"; token: string; unsynced: boolean }
	/** Never uploaded (or trashed on the server); `hold` says why, when one does. */
	| { kind: "not-on-server"; hold: SyncHold | null }
	/** The server refused (`sharing_blocked`). */
	| { kind: "blocked" }
	| { kind: "offline" }
	/** `onlyIf` refused the version the link would show, or it couldn't be checked (not uploaded). */
	| { kind: "check-failed" };

export type ShareOptions = {
	/**
	 * The link is turned on only if this accepts the version it would show. That must be this
	 * device's stored version: with an edit that didn't upload, the server's version is unchecked,
	 * so the share is refused.
	 */
	onlyIf?: (doc: Dashboard) => boolean;
};

/** Uploads what's pending, then turns the link on. Under the doc lock for the record write. */
export async function shareDocument(
	ctx: SyncContext,
	docId: string,
	opts: ShareOptions = {}
): Promise<ShareResult> {
	// Any result: a failed upload still shares the last synced version.
	await uploadDocument(ctx, docId);
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		const local = await readLocal(ctx, docId);
		if (typeof local === "string") throw new Error(`Dashboard ${docId} can't be read`);
		const { record } = local;
		if (record.serverVersion === null) return { kind: "not-on-server", hold: record.hold };
		if (opts.onlyIf && (local.unsynced.length > 0 || !opts.onlyIf(local.doc))) {
			return { kind: "check-failed" };
		}
		let token: string;
		try {
			token = await remoteCall(() => ctx.remote.share(docId), "sync-share");
		} catch (error) {
			if (error instanceof RemoteUnavailable) return { kind: "offline" };
			if (error instanceof RemoteRefusal) {
				if (error.code === "not_found") return { kind: "not-on-server", hold: record.hold };
				if (error.code === "sharing_blocked") return { kind: "blocked" };
			}
			throw error;
		}
		await ctx.platform.sync.put(ctx.space, { ...record, shareToken: token });
		postSync(ctx, docId);
		return { kind: "shared", token, unsynced: local.unsynced.length > 0 };
	});
}

/** Turns the link off; throws `RemoteUnavailable` / `RemoteRefusal` on failure. */
export function unshareDocument(ctx: SyncContext, docId: string): Promise<void> {
	return ctx.platform.locks.run(docLock(ctx.space, docId), async () => {
		await remoteCall(() => ctx.remote.unshare(docId), "sync-unshare");
		const record = await ctx.platform.sync.get(ctx.space, docId);
		if (record && record.shareToken !== null) {
			await ctx.platform.sync.put(ctx.space, { ...record, shareToken: null });
		}
		postSync(ctx, docId);
	});
}
