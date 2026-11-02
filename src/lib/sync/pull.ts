/**
 * Bringing the server's newer versions into local storage. Task 7 adds polling here.
 */
import { applyChange } from "$lib/changes/apply";
import type { Dashboard } from "$lib/documents/schema";
import { report } from "$lib/safety/report";
import { docLock, type SyncContext } from "./context";
import { currentChanges, postSync, readLocal, writeLocal, type LocalState } from "./local";
import { fromRemote, mergeRemote, sameContent, theirChanges } from "./merge";
import type { RemoteChange, RemoteDocument } from "./remote";
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
		// A newer local format, or nothing stored: leave it (Task 7 fetches missing ones).
		if (typeof local === "string") return "unchanged";
		const unanswered = inFlight === undefined ? local.record.inFlight : inFlight;
		const result = await mergeOnce(ctx, local, server, unanswered);
		if (result !== "raced") return result;
	}
	return "unchanged";
}

/** JSON with object keys sorted, so a server that reorders keys still compares equal. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		v !== null && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: v
	);
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
