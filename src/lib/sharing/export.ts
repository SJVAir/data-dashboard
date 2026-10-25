import type { Dashboard } from "$lib/documents/schema";
import { encodePayload } from "./codec";
import {
	FORMAT,
	FORMAT_VERSION,
	MAX_LINK_URL,
	type Envelope,
	type SharedDocument
} from "./envelope";

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
