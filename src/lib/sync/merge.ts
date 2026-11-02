/**
 * The pure rules for combining the server's newer version of a dashboard with this device's
 * unsynced changes ("mine"), and for converting between the server's shape and the local one.
 */
import type { Change } from "$lib/changes/types";
import { rebase } from "$lib/changes/rebase";
import { loadDashboard } from "$lib/documents/load";
import { upgradeChanges } from "$lib/documents/migrate-changes";
import type { Dashboard } from "$lib/documents/schema";
import type { RemoteChange, RemoteDocument, SaveInput } from "./remote";

/** The server's document as a local one at `localVersion`, upgraded; or why it can't be. */
export function fromRemote(
	doc: RemoteDocument,
	localVersion: number
): { status: "ok"; doc: Dashboard } | { status: "newer" | "invalid" } {
	const raw: Record<string, unknown> = {
		kind: doc.kind,
		id: doc.id,
		schemaVersion: doc.schemaVersion,
		name: doc.name,
		body: doc.body,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
		version: localVersion
	};
	if (doc.deletedAt !== null) raw.deletedAt = doc.deletedAt;
	if (doc.copiedFrom !== null) raw.copiedFrom = doc.copiedFrom;
	const loaded = loadDashboard(raw);
	if (loaded.status === "ok") return { status: "ok", doc: loaded.doc };
	return { status: loaded.reason };
}

/** The fields of a save taken from a local document. */
export function saveFields(
	doc: Dashboard
): Pick<SaveInput, "schemaVersion" | "name" | "body" | "deletedAt" | "copiedFrom"> {
	return {
		schemaVersion: doc.schemaVersion,
		name: doc.name,
		body: doc.body,
		deletedAt: doc.deletedAt ?? null,
		copiedFrom: doc.copiedFrom ?? null
	};
}

/** Their changes, upgraded and validated; `dropped` counts ones that couldn't be. */
export function theirChanges(changes: RemoteChange[] | null): {
	changes: Change[] | null;
	dropped: number;
} {
	if (changes === null) return { changes: null, dropped: 0 };
	const kept: Change[] = [];
	let dropped = 0;
	for (const entry of changes) {
		const result = upgradeChanges([entry.change], entry.schemaVersion);
		kept.push(...result.changes);
		dropped += result.dropped;
	}
	return { changes: kept, dropped };
}

/** Whether two documents hold the same content (name, body, deletedAt, copiedFrom). */
export function sameContent(a: Dashboard, b: Dashboard): boolean {
	return (
		a.name === b.name &&
		(a.deletedAt ?? null) === (b.deletedAt ?? null) &&
		(a.copiedFrom ?? null) === (b.copiedFrom ?? null) &&
		JSON.stringify(a.body) === JSON.stringify(b.body)
	);
}

export type MergeOutcome =
	| { kind: "take-server" }
	| { kind: "rebased"; doc: Dashboard }
	| { kind: "conflict"; reason: "overlap" | "log-gap" }
	| { kind: "deleted-elsewhere" };

function isDelete(change: Change): boolean {
	return change.op === "setField" && change.target.path === "deletedAt" && change.to !== null;
}

export function mergeRemote(input: {
	server: Dashboard;
	theirs: Change[] | null;
	dropped: number;
	mine: Change[];
}): MergeOutcome {
	const { server, theirs, dropped, mine } = input;
	if (mine.length === 0) return { kind: "take-server" };
	// Never replay over a gap in the server's log.
	if (theirs === null) return { kind: "conflict", reason: "log-gap" };
	if (dropped > 0) return { kind: "conflict", reason: "overlap" };
	if (server.deletedAt && mine.some((c) => !isDelete(c))) return { kind: "deleted-elsewhere" };
	const result = rebase(server, theirs, mine);
	if (result.kind === "conflict") return { kind: "conflict", reason: "overlap" };
	return { kind: "rebased", doc: result.doc };
}
