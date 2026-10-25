import type { Dashboard } from "$lib/documents/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { encodePayload } from "./codec";
import {
	FORMAT,
	FORMAT_VERSION,
	MAX_LINK_URL,
	type Envelope,
	type SharedDocument
} from "./envelope";
import { fingerprintOf } from "./fingerprints";

/** The shareable fields of a document; local-only fields are left out. */
export function sharedDocumentOf(doc: Dashboard): SharedDocument {
	return {
		kind: doc.kind,
		schemaVersion: doc.schemaVersion,
		id: doc.id,
		name: doc.name,
		body: doc.body
	};
}

function documentEnvelope(doc: Dashboard, now: Date): Envelope {
	return {
		format: FORMAT,
		type: "document",
		formatVersion: FORMAT_VERSION,
		exportedAt: now.toISOString(),
		documents: [sharedDocumentOf(doc)]
	};
}

/** The single-document export file's text, compact so a near-limit document still re-imports. */
export function documentFileJson(doc: Dashboard, now: Date): string {
	return JSON.stringify(documentEnvelope(doc, now));
}

/** `${base}import#${payload}`, or `{ tooLong: true }` over the link cap. */
export async function shareUrl(
	base: string,
	doc: Dashboard,
	now: Date
): Promise<{ url: string } | { tooLong: true }> {
	const url = `${base}import#${encodePayload(JSON.stringify(documentEnvelope(doc, now)))}`;
	return url.length > MAX_LINK_URL ? { tooLong: true } : { url };
}

/** Fields that belong to this browser's copy and never travel. */
const LOCAL_ONLY = ["version", "createdAt", "updatedAt", "copiedFrom", "deletedAt"];

/**
 * A read-only (newer or invalid) document's export file: the stored value as it is, unvalidated,
 * less the local-only fields, so a browser with a newer version can open it.
 */
export function rawDocumentFileJson(raw: unknown, now: Date): string {
	const stored =
		typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
	for (const key of LOCAL_ONLY) delete stored[key];
	return JSON.stringify({
		format: FORMAT,
		type: "document",
		formatVersion: FORMAT_VERSION,
		exportedAt: now.toISOString(),
		documents: [stored]
	});
}

/**
 * A backup file's text: every stored dashboard that isn't deleted, exactly as stored (read-only
 * ones too), plus the local fingerprint of each that has one so "You already have a copy" keeps
 * working after a restore.
 */
export async function backupJson(platform: Platform, space: SpaceId, now: Date): Promise<string> {
	const documents: unknown[] = [];
	const fingerprints: Record<string, string> = {};
	for (const raw of await platform.documents.list(space)) {
		const stored = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
		if (typeof stored.deletedAt === "string") continue;
		documents.push(raw);
		if (typeof stored.id !== "string") continue;
		const fingerprint = await fingerprintOf(platform, space, stored.id);
		if (fingerprint !== undefined) fingerprints[stored.id] = fingerprint;
	}
	const envelope: Envelope = {
		format: FORMAT,
		type: "backup",
		formatVersion: FORMAT_VERSION,
		exportedAt: now.toISOString(),
		documents,
		...(Object.keys(fingerprints).length > 0 ? { fingerprints } : {})
	};
	return JSON.stringify(envelope);
}
