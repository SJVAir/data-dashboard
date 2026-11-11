/**
 * Utilities for the SJVAir `/documents/` endpoints: the signed-in user's
 * saved dashboards, their change log, share links, snapshots (including
 * keeping given content as one), and public display name.
 *
 * The calls rely on the session cookie (pass extra headers through
 * `options.init` outside a browser) and throw `DocumentRefusal` with the
 * server's refusal code when the server refuses one.
 *
 * Copied on 2026-11-11 from sdk-js 819d152 (`lib/documents/`, the code in
 * `@sjvair/sdk` 5.0.0-beta.8), which this repo now owns; see ARCHITECTURE.md
 * ("The dashboard's own API code").
 *
 * @example Usage
 * ```ts
 * import { isDocumentRefusal, saveDocument } from "$lib/api/documents";
 *
 * try {
 *   const { version } = await saveDocument("abc", form);
 * } catch (error) {
 *   if (isDocumentRefusal(error, "stale_base")) {
 *     // Rebase on error.data.changes (or error.data.document) and save again.
 *   } else throw error;
 * }
 * ```
 *
 * @module
 */
export {
	deleteDocument,
	getDocument,
	getDocumentChanges,
	listDocuments,
	saveDocument
} from "./documents";
export {
	createShareLink,
	getDocumentCredit,
	getSharedDocument,
	getSharedDocumentChanges,
	revokeShareLink
} from "./sharing";
export { createSnapshot, getSnapshot, listSnapshots } from "./snapshots";
export { getDocumentProfile, updateDocumentProfile } from "./profile";
export {
	DocumentRefusal,
	DocumentResponseError,
	isDocumentRefusal,
	REFUSAL_CODES,
	type RefusalCode
} from "./refusal";
export { staleBaseDataSchema } from "./schema";
export * from "./types";
