import type { Dashboard } from "$lib/documents/schema";
import { z } from "zod";

export const FORMAT = "sjvair-workspace";
export const FORMAT_VERSION = 1;
/** One document's JSON, in characters. */
export const MAX_DOCUMENT_CHARS = 1_000_000;
/** A backup file, in bytes. */
export const MAX_BACKUP_BYTES = 50_000_000;
/** The whole share URL, in characters. */
export const MAX_LINK_URL = 8_000;
/** An incoming link fragment, before decompressing. */
export const MAX_INCOMING_FRAGMENT = 64_000;
/** The format prefix on a link payload, so a later encoding can coexist. */
export const LINK_PREFIX = "1.";

export const EnvelopeSchema = z
	.object({
		format: z.literal(FORMAT),
		type: z.enum(["document", "backup"]),
		formatVersion: z.literal(FORMAT_VERSION),
		exportedAt: z.iso.datetime(),
		documents: z.array(z.unknown()),
		fingerprints: z.record(z.string(), z.string()).optional()
	})
	.refine(
		(e) => e.type !== "document" || (e.documents.length === 1 && e.fingerprints === undefined),
		{ message: "A document envelope holds exactly one document and no fingerprints" }
	);
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** What a link or an Export file carries: no local-only fields. */
export type SharedDocument = Pick<Dashboard, "kind" | "schemaVersion" | "id" | "name" | "body">;
