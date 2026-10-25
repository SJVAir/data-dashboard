import { loadDashboard } from "$lib/documents/load";
import type { Dashboard } from "$lib/documents/schema";
import { decodePayload } from "./codec";
import {
	EnvelopeSchema,
	MAX_DOCUMENT_CHARS,
	MAX_INCOMING_FRAGMENT,
	type Envelope
} from "./envelope";
import { sharedDocumentOf } from "./export";
import { fingerprint } from "./fingerprint";

export type IncomingError = "too-large" | "invalid" | "newer";
export type Incoming =
	| { kind: "document"; doc: Dashboard; sourceId: string; fingerprint: string }
	| { kind: "backup"; envelope: Envelope }
	| { kind: "error"; reason: IncomingError };

const invalid: Incoming = { kind: "error", reason: "invalid" };
const tooLarge: Incoming = { kind: "error", reason: "too-large" };

/** The one import path: size, JSON, envelope, then the load pipeline. Writes nothing. */
export async function parseIncoming(text: string, now: Date): Promise<Incoming> {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return invalid;
	}
	const parsed = EnvelopeSchema.safeParse(json);
	if (!parsed.success) return invalid;
	const envelope = parsed.data;
	if (envelope.type === "backup") return { kind: "backup", envelope };

	if (text.length > MAX_DOCUMENT_CHARS) return tooLarge;
	const raw = envelope.documents[0];
	if (JSON.stringify(raw).length > MAX_DOCUMENT_CHARS) return tooLarge;
	if (typeof raw !== "object" || raw === null) return invalid;

	const { kind, schemaVersion, id, name, body } = raw as Record<string, unknown>;
	const time = now.toISOString();
	const loaded = loadDashboard({
		kind,
		schemaVersion,
		id,
		name,
		body,
		version: 0,
		createdAt: time,
		updatedAt: time
	});
	if (loaded.status === "read-only") {
		return { kind: "error", reason: loaded.reason };
	}
	return {
		kind: "document",
		doc: loaded.doc,
		sourceId: loaded.doc.id,
		fingerprint: await fingerprint(sharedDocumentOf(loaded.doc))
	};
}

/** Decode a link fragment and run it through `parseIncoming`; backups aren't allowed in links. */
export async function parseLinkFragment(fragment: string, now: Date): Promise<Incoming> {
	if (fragment.length > MAX_INCOMING_FRAGMENT) return tooLarge;
	const text = decodePayload(fragment);
	if (text === null) return invalid;
	if (text.length > MAX_DOCUMENT_CHARS) return tooLarge;
	const result = await parseIncoming(text, now);
	return result.kind === "backup" ? invalid : result;
}
