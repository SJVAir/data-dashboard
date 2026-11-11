// The schemas' explicit interface types are kept as copied from sdk-js (JSR needs explicit
// types on exports); they extend their zod type without adding members.
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { z } from "$lib/zod";

/**
 * Any JSON value except a missing one. A document `body` and a change's
 * `change` are the dashboard's own data: the SDK checks only that they are
 * there, and the dashboard validates their contents.
 */
const jsonValueSchema: z.ZodUnknown = z
	.unknown()
	.refine((value) => value !== undefined, { message: "Required" });

/** Who can open a document through a share link */
export type DocumentVisibilitySchema = z.ZodEnum<{
	private: "private";
	link: "link";
	public: "public";
}>;
export const documentVisibilitySchema: DocumentVisibilitySchema = z.enum([
	"private",
	"link",
	"public"
] as const);

type DocumentFieldsShape = {
	/** The document's id, chosen by the client */
	id: z.ZodString;

	/** The document kind; the server accepts only `"dashboard"` */
	kind: z.ZodString;

	/** The document's name, or `null` when it has none */
	name: z.ZodNullable<z.ZodString>;

	/** The version of the dashboard's document format the body is in */
	schema_version: z.ZodNumber;

	/** The server version, increased by every accepted save */
	version: z.ZodNumber;

	/** The id of the document this one was copied from, if any */
	copied_from: z.ZodNullable<z.ZodString>;

	/** When the document was moved to the trash, or `null` */
	deleted_at: z.ZodNullable<z.ZodString>;

	/** When the document was first saved (ISO 8601) */
	created_at: z.ZodString;

	/**
	 * When the document was last saved, shared, or unshared (ISO 8601). Sharing
	 * changes this without changing `version`.
	 */
	updated_at: z.ZodString;

	/** Who can open the document through a share link */
	visibility: DocumentVisibilitySchema;

	/** The current share token, or `null` when there is no share link */
	share_token: z.ZodNullable<z.ZodString>;
};

const documentFields: DocumentFieldsShape = {
	id: z.string(),
	kind: z.string(),
	name: z.string().nullable(),
	schema_version: z.number().int(),
	version: z.number().int(),
	copied_from: z.string().nullable(),
	deleted_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string(),
	visibility: documentVisibilitySchema,
	share_token: z.string().nullable()
};

export interface SavedDocumentSchema extends z.ZodObject<
	DocumentFieldsShape & {
		/** The document's contents (validated by the dashboard, not the SDK) */
		body: z.ZodUnknown;
	}
> {}
/** A saved document, with its body */
export const savedDocumentSchema: SavedDocumentSchema = z.object({
	...documentFields,
	body: jsonValueSchema
});

export interface DocumentMetaSchema extends z.ZodObject<
	DocumentFieldsShape & {
		/** The body's size, in characters of compact JSON */
		size: z.ZodNumber;
	}
> {}
/** A saved document without its body, plus its size */
export const documentMetaSchema: DocumentMetaSchema = z.object({
	...documentFields,
	size: z.number().int()
});

export interface DocumentListSchema extends z.ZodObject<{
	/**
	 * The documents (all of them, or those updated since `since`). Sharing
	 * and revoking update `updated_at` but not `version`, so a listed document
	 * may have the same version with a new `visibility` or `share_token`.
	 */
	documents: z.ZodArray<DocumentMetaSchema>;

	/** The ids of documents permanently deleted since `since` */
	purged: z.ZodArray<z.ZodString>;

	/** An ISO 8601 time to pass back as `since` on the next list */
	cursor: z.ZodString;
}> {}
/** The response from listing documents */
export const documentListSchema: DocumentListSchema = z.object({
	documents: z.array(documentMetaSchema),
	purged: z.array(z.string()),
	cursor: z.string()
});

export interface ChangeEntrySchema extends z.ZodObject<{
	/** The server version whose save carried this change */
	version: z.ZodNumber;

	/** The document format version the change is in */
	schema_version: z.ZodNumber;

	/** The change itself (validated by the dashboard, not the SDK) */
	change: z.ZodUnknown;
}> {}
/** One change from the server's change log */
export const changeEntrySchema: ChangeEntrySchema = z.object({
	version: z.number().int(),
	schema_version: z.number().int(),
	change: jsonValueSchema
});

export interface DocumentVersionSchema extends z.ZodObject<
	{
		/** The current server version */
		version: z.ZodNumber;
	},
	z.core.$strict
> {}
/** An unchanged answer: only the current version */
export const documentVersionSchema: DocumentVersionSchema = z.strictObject({
	version: z.number().int()
});

export interface ChangedDocumentSchema extends z.ZodObject<{
	/** The current server version */
	version: z.ZodNumber;

	/**
	 * The changes after `since`, in order, or `null` when the server can't
	 * give them (they were trimmed, or `since` is ahead of the server): then
	 * use `document`.
	 */
	changes: z.ZodNullable<z.ZodArray<ChangeEntrySchema>>;

	/** The whole current document */
	document: SavedDocumentSchema;
}> {}
/** A changed answer: the changes since the asked-for version, and the document */
export const changedDocumentSchema: ChangedDocumentSchema = z.object({
	version: z.number().int(),
	changes: z.array(changeEntrySchema).nullable(),
	document: savedDocumentSchema
});

export type DocumentChangesSchema = z.ZodUnion<[ChangedDocumentSchema, DocumentVersionSchema]>;
/** The response from polling a document's changes */
export const documentChangesSchema: DocumentChangesSchema = z.union([
	changedDocumentSchema,
	documentVersionSchema
]);

export interface SaveResultSchema extends z.ZodObject<{
	/** The new server version */
	version: z.ZodNumber;

	/** When the save was accepted (ISO 8601) */
	updated_at: z.ZodString;
}> {}
/** The response from an accepted save */
export const saveResultSchema: SaveResultSchema = z.object({
	version: z.number().int(),
	updated_at: z.string()
});

export interface ShareLinkSchema extends z.ZodObject<{
	/** The token for the document's share link */
	share_token: z.ZodString;
}> {}
/** The response from turning a share link on */
export const shareLinkSchema: ShareLinkSchema = z.object({
	share_token: z.string()
});

export interface SharedDocumentSchema extends z.ZodObject<{
	/** The document id */
	id: z.ZodString;
	kind: z.ZodString;
	name: z.ZodNullable<z.ZodString>;
	schema_version: z.ZodNumber;
	version: z.ZodNumber;

	/** The document's contents (validated by the dashboard, not the SDK) */
	body: z.ZodUnknown;
	updated_at: z.ZodString;

	/** The owner's chosen public name, or `null`; never their real name */
	display_name: z.ZodNullable<z.ZodString>;
}> {}
/**
 * A document as a share link shows it, with its id. Nothing in it identifies
 * the owner.
 */
export const sharedDocumentSchema: SharedDocumentSchema = z.object({
	id: z.string(),
	kind: z.string(),
	name: z.string().nullable(),
	schema_version: z.number().int(),
	version: z.number().int(),
	body: jsonValueSchema,
	updated_at: z.string(),
	display_name: z.string().nullable()
});

export type SharedDocumentChangesSchema = z.ZodUnion<[SharedDocumentSchema, DocumentVersionSchema]>;
/** The response from polling a shared document */
export const sharedDocumentChangesSchema: SharedDocumentChangesSchema = z.union([
	sharedDocumentSchema,
	documentVersionSchema
]);

export interface DocumentCreditSchema extends z.ZodObject<{
	/** The original document's name */
	name: z.ZodNullable<z.ZodString>;

	/** The original owner's public display name, or `null` */
	display_name: z.ZodNullable<z.ZodString>;
}> {}
/** What a copy's "Based on…" credit shows */
export const documentCreditSchema: DocumentCreditSchema = z.object({
	name: z.string().nullable(),
	display_name: z.string().nullable()
});

/** Why a snapshot was taken */
export type SnapshotReasonSchema = z.ZodEnum<{
	schema: "schema";
	daily: "daily";
	conflict: "conflict";
}>;
export const snapshotReasonSchema: SnapshotReasonSchema = z.enum([
	"schema",
	"daily",
	"conflict"
] as const);

export interface SnapshotMetaSchema extends z.ZodObject<{
	id: z.ZodNumber;
	version: z.ZodNumber;
	schema_version: z.ZodNumber;
	reason: SnapshotReasonSchema;
	created_at: z.ZodString;
}> {}
/** A snapshot without its body */
export const snapshotMetaSchema: SnapshotMetaSchema = z.object({
	id: z.number().int(),
	version: z.number().int(),
	schema_version: z.number().int(),
	reason: snapshotReasonSchema,
	created_at: z.string()
});

export interface SnapshotSchema extends z.ZodObject<{
	id: z.ZodNumber;
	version: z.ZodNumber;
	schema_version: z.ZodNumber;
	name: z.ZodNullable<z.ZodString>;

	/** The document's contents at the snapshot (validated by the dashboard) */
	body: z.ZodUnknown;
	created_at: z.ZodString;
}> {}
/** A snapshot, with its body */
export const snapshotSchema: SnapshotSchema = z.object({
	id: z.number().int(),
	version: z.number().int(),
	schema_version: z.number().int(),
	name: z.string().nullable(),
	body: jsonValueSchema,
	created_at: z.string()
});

export interface DocumentProfileSchema extends z.ZodObject<{
	/** The public name shown on shared dashboards, or `null` for none */
	display_name: z.ZodNullable<z.ZodString>;
}> {}
/** The signed-in user's documents profile */
export const documentProfileSchema: DocumentProfileSchema = z.object({
	display_name: z.string().nullable()
});

export interface StaleBaseDataSchema extends z.ZodObject<{
	version: z.ZodNumber;
	schema_version: z.ZodNumber;
	changes: z.ZodNullable<z.ZodArray<ChangeEntrySchema>>;
	document: SavedDocumentSchema;
}> {}
/**
 * The `data` of a `stale_base` refusal: the server's version, and the changes
 * after the save's base (or `null`) with the current document.
 */
export const staleBaseDataSchema: StaleBaseDataSchema = z.object({
	version: z.number().int(),
	schema_version: z.number().int(),
	changes: z.array(changeEntrySchema).nullable(),
	document: savedDocumentSchema
});
