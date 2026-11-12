/**
 * Utilities for the signed-in user's saved documents: list, read, poll for
 * changes, save, and permanently delete.
 *
 * Every call relies on the session cookie (or the caller's `options.init`)
 * and throws `DocumentRefusal` when the server refuses it.
 *
 * @example Usage
 * ```ts
 * import { getDocumentChanges, listDocuments } from "$lib/api/documents/documents";
 *
 * const { documents, cursor } = await listDocuments();
 * const changes = await getDocumentChanges(documents[0].id, documents[0].version);
 * if ("document" in changes) {
 *   // Apply changes.changes, or replace with changes.document when it is null.
 * }
 * ```
 *
 * @module
 */
import type { RequestOptions } from "@sjvair/sdk/http";
import {
	ACCEPT_HEADERS,
	documentsCall,
	documentsPath,
	documentsVoidCall,
	JSON_HEADERS
} from "./call";
import {
	documentChangesSchema,
	documentListSchema,
	savedDocumentSchema,
	saveResultSchema
} from "./schema";
import type {
	DocumentChanges,
	DocumentList,
	DocumentListParams,
	SavedDocument,
	SaveDocumentForm,
	SaveResult
} from "./types";

/**
 * Lists the signed-in user's documents, without their bodies, deleted ones
 * included. With `since`, a listed document is one updated since then, which
 * doesn't always mean a new version: sharing and revoking change `updated_at`,
 * `visibility`, and `share_token` but not `version`.
 *
 * @param params Optional. `since`: only documents updated, and ids purged, at
 *   or after this ISO 8601 time (pass the previous list's `cursor`).
 * @param options Request options.
 * @returns The documents, the ids purged since `since`, and the next `cursor`
 */
export async function listDocuments(
	params?: DocumentListParams,
	options?: RequestOptions
): Promise<DocumentList> {
	const searchParams: Record<string, string> = {};
	if (params?.since !== undefined) searchParams.since = params.since;

	return await documentsCall(
		{
			url: documentsPath(),
			searchParams,
			init: { headers: ACCEPT_HEADERS },
			options
		},
		documentListSchema
	);
}

/**
 * Gets one of the signed-in user's documents, with its body.
 *
 * @param id The document id.
 * @param options Request options.
 * @returns The document
 */
export async function getDocument(id: string, options?: RequestOptions): Promise<SavedDocument> {
	return await documentsCall(
		{
			url: documentsPath(id),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		savedDocumentSchema
	);
}

/**
 * Polls a document for changes after version `since`.
 *
 * @param id The document id.
 * @param since The version the caller has.
 * @param options Request options.
 * @returns `{ version }` when nothing changed; otherwise the version, the
 *   changes after `since` (or `null` when the server can't give them), and
 *   the whole document
 */
export async function getDocumentChanges(
	id: string,
	since: number,
	options?: RequestOptions
): Promise<DocumentChanges> {
	return await documentsCall(
		{
			url: documentsPath(id, "changes"),
			searchParams: { since: String(since) },
			init: { headers: ACCEPT_HEADERS },
			options
		},
		documentChangesSchema
	);
}

/**
 * Saves a document: creates it (`base_version: null`) or applies a save based
 * on version `base_version`. A save on an old base is refused as
 * `stale_base`, with the newer changes and document in the refusal's `data`
 * (see `staleBaseDataSchema`).
 *
 * @param id The document id.
 * @param form The save request.
 * @param options Request options.
 * @returns The new version and save time
 */
export async function saveDocument(
	id: string,
	form: SaveDocumentForm,
	options?: RequestOptions
): Promise<SaveResult> {
	return await documentsCall(
		{
			url: documentsPath(id),
			init: {
				method: "PUT",
				headers: JSON_HEADERS,
				body: JSON.stringify(form)
			},
			options
		},
		saveResultSchema
	);
}

/**
 * Permanently deletes a document that is already in the trash (soft-delete
 * it first with a save that sets `deleted_at`; otherwise this is refused as
 * `not_deleted`). Reading it afterwards is refused as `gone`.
 *
 * @param id The document id.
 * @param options Request options.
 */
export async function deleteDocument(id: string, options?: RequestOptions): Promise<void> {
	await documentsVoidCall({
		url: documentsPath(id),
		init: { method: "DELETE", headers: ACCEPT_HEADERS },
		options
	});
}
