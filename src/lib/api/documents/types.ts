/**
 * Types for saved documents (the data dashboard's dashboards), in the wire
 * contract's `snake_case`.
 *
 * @module
 */
import type { z } from "$lib/zod";
import type {
	changedDocumentSchema,
	changeEntrySchema,
	documentChangesSchema,
	documentCreditSchema,
	documentListSchema,
	documentMetaSchema,
	documentProfileSchema,
	documentVersionSchema,
	documentVisibilitySchema,
	savedDocumentSchema,
	saveResultSchema,
	sharedDocumentChangesSchema,
	sharedDocumentSchema,
	shareLinkSchema,
	snapshotMetaSchema,
	snapshotReasonSchema,
	snapshotSchema,
	staleBaseDataSchema
} from "./schema";

/** Who can open a document through a share link */
export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

/** A saved document, with its body */
export type SavedDocument = z.infer<typeof savedDocumentSchema>;

/** A saved document without its body, plus its size */
export type DocumentMeta = z.infer<typeof documentMetaSchema>;

/** The response from listing documents */
export type DocumentList = z.infer<typeof documentListSchema>;

/** One change from the server's change log */
export type ChangeEntry = z.infer<typeof changeEntrySchema>;

/** An unchanged answer: only the current version */
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

/** A changed answer: the changes since the asked-for version, and the document */
export type ChangedDocument = z.infer<typeof changedDocumentSchema>;

/**
 * The response from polling a document's changes: `{ version }` when nothing
 * changed, otherwise a {@link ChangedDocument} (check `"document" in result`).
 */
export type DocumentChanges = z.infer<typeof documentChangesSchema>;

/** The response from an accepted save */
export type SaveResult = z.infer<typeof saveResultSchema>;

/** The response from turning a share link on */
export type ShareLink = z.infer<typeof shareLinkSchema>;

/** A document as a share link shows it */
export type SharedDocument = z.infer<typeof sharedDocumentSchema>;

/**
 * The response from polling a shared document: `{ version }` when nothing
 * changed, otherwise the whole {@link SharedDocument} (check `"body" in result`).
 */
export type SharedDocumentChanges = z.infer<typeof sharedDocumentChangesSchema>;

/** What a copy's "Based on…" credit shows */
export type DocumentCredit = z.infer<typeof documentCreditSchema>;

/** Why a snapshot was taken */
export type SnapshotReason = z.infer<typeof snapshotReasonSchema>;

/** A snapshot without its body */
export type SnapshotMeta = z.infer<typeof snapshotMetaSchema>;

/** A snapshot, with its body */
export type Snapshot = z.infer<typeof snapshotSchema>;

/** The signed-in user's documents profile */
export type DocumentProfile = z.infer<typeof documentProfileSchema>;

/** The `data` of a `stale_base` refusal */
export type StaleBaseData = z.infer<typeof staleBaseDataSchema>;

/** One change sent with a save */
export interface SaveChange {
	/** The document format version the change is in */
	schema_version: number;

	/** The change itself, as the dashboard records it */
	change: unknown;
}

/** The request body of a save (`PUT documents/<id>/`). Every field is required. */
export interface SaveDocumentForm {
	/** The document kind; only `"dashboard"` is accepted */
	kind: "dashboard";

	/** The document format version of `body` */
	schema_version: number;

	/** The document's name, or `null` */
	name: string | null;

	/** The whole document body (a JSON object) */
	body: unknown;

	/** When the document was moved to the trash (ISO 8601), or `null` */
	deleted_at: string | null;

	/** The id of the document this one was copied from, or `null` */
	copied_from: string | null;

	/** The server version this save is based on, or `null` to create */
	base_version: number | null;

	/** The changes made since `base_version`, in order */
	changes: Array<SaveChange>;

	/** The id of the account the client believes is signed in */
	account_id: string;

	/** The client build's id (its git sha) */
	build_id: string;

	/** `"conflict"` to keep a snapshot of the version this save replaces */
	snapshot: null | "conflict";
}

/**
 * The request body for keeping given content as a snapshot
 * (`POST documents/<id>/snapshots/`). Every field is required.
 */
export interface CreateSnapshotForm {
	/**
	 * The server version the content was set aside against; it must be the
	 * document's current version (otherwise refused as `stale_base`). The
	 * snapshot records it as its `version`.
	 */
	base_version: number;

	/** The document format version of `body`; may be older than the document's */
	schema_version: number;

	/** The content's name, or `null` */
	name: string | null;

	/** The content to keep (a JSON object) */
	body: unknown;

	/** The id of the account the client believes is signed in */
	account_id: string;

	/** The client build's id (its git sha) */
	build_id: string;
}

/** Parameters for listing documents */
export interface DocumentListParams {
	/**
	 * Only documents updated (saved, shared, or unshared), and ids purged, at
	 * or after this ISO 8601 time; pass the previous list's `cursor`. A listed
	 * document may have the same `version` as before (sharing doesn't bump it).
	 */
	since?: string;
}
