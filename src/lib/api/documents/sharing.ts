/**
 * Utilities for document share links: turn a link on or off, read a shared
 * document (signed in or not), and read a copy's credit.
 *
 * @example Usage
 * ```ts
 * import { createShareLink, getSharedDocument } from "$lib/api/documents/sharing";
 *
 * const { share_token } = await createShareLink("abc");
 * const shared = await getSharedDocument(share_token);
 * console.log(shared.name, shared.display_name);
 * ```
 *
 * @module
 */
import type { RequestOptions } from "@sjvair/sdk/http";
import { ACCEPT_HEADERS, documentsCall, documentsPath, documentsVoidCall } from "./call";
import {
	documentCreditSchema,
	sharedDocumentChangesSchema,
	sharedDocumentSchema,
	shareLinkSchema
} from "./schema";
import type { DocumentCredit, SharedDocument, SharedDocumentChanges, ShareLink } from "./types";

/**
 * Turns a document's share link on. Calling it again keeps the same token.
 *
 * @param id The document id.
 * @param options Request options.
 * @returns The share token
 */
export async function createShareLink(id: string, options?: RequestOptions): Promise<ShareLink> {
	return await documentsCall(
		{
			url: documentsPath(id, "share"),
			init: { method: "POST", headers: ACCEPT_HEADERS },
			options
		},
		shareLinkSchema
	);
}

/**
 * Turns a document's share link off. The old token stops working for good;
 * sharing again makes a new one.
 *
 * @param id The document id.
 * @param options Request options.
 */
export async function revokeShareLink(id: string, options?: RequestOptions): Promise<void> {
	await documentsVoidCall({
		url: documentsPath(id, "share"),
		init: { method: "DELETE", headers: ACCEPT_HEADERS },
		options
	});
}

/**
 * Reads a shared document by its share token. Needs no sign-in. A link that
 * doesn't open, for any reason, is refused as `not_found`.
 *
 * @param token The share token.
 * @param options Request options.
 * @returns The shared document
 */
export async function getSharedDocument(
	token: string,
	options?: RequestOptions
): Promise<SharedDocument> {
	return await documentsCall(
		{
			url: documentsPath("shared", token),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		sharedDocumentSchema
	);
}

/**
 * Polls a shared document for a newer version than `since`.
 *
 * @param token The share token.
 * @param since The version the caller has.
 * @param options Request options.
 * @returns `{ version }` when nothing changed, otherwise the whole shared
 *   document
 */
export async function getSharedDocumentChanges(
	token: string,
	since: number,
	options?: RequestOptions
): Promise<SharedDocumentChanges> {
	return await documentsCall(
		{
			url: documentsPath("shared", token, "changes"),
			searchParams: { since: String(since) },
			init: { headers: ACCEPT_HEADERS },
			options
		},
		sharedDocumentChangesSchema
	);
}

/**
 * Reads the "Based on…" credit for a document a copy was made from: its name
 * and its owner's public display name. Open to the owner, or to anyone while
 * the document is shared; otherwise refused as `not_found`.
 *
 * @param id The id of the original document (a copy's `copied_from`).
 * @param options Request options.
 * @returns The credit
 */
export async function getDocumentCredit(
	id: string,
	options?: RequestOptions
): Promise<DocumentCredit> {
	return await documentsCall(
		{
			url: documentsPath(id, "credit"),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		documentCreditSchema
	);
}
