/**
 * Utilities for the signed-in user's documents profile: the public display
 * name shown on their shared dashboards.
 *
 * @example Usage
 * ```ts
 * import { updateDocumentProfile } from "$lib/api/documents/profile";
 *
 * const profile = await updateDocumentProfile({ display_name: "Ana" });
 * console.log(profile.display_name);
 * // Prints: Ana
 * ```
 *
 * @module
 */
import type { RequestOptions } from "@sjvair/sdk/http";
import { ACCEPT_HEADERS, documentsCall, documentsPath, JSON_HEADERS } from "./call";
import { documentProfileSchema } from "./schema";
import type { DocumentProfile } from "./types";

/**
 * Gets the signed-in user's documents profile.
 *
 * @param options Request options.
 * @returns The profile
 */
export async function getDocumentProfile(options?: RequestOptions): Promise<DocumentProfile> {
	return await documentsCall(
		{
			url: documentsPath("profile"),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		documentProfileSchema
	);
}

/**
 * Sets the signed-in user's public display name. The server trims it; an
 * empty name or `null` clears it.
 *
 * @param profile The new display name.
 * @param options Request options.
 * @returns The saved profile
 */
export async function updateDocumentProfile(
	profile: DocumentProfile,
	options?: RequestOptions
): Promise<DocumentProfile> {
	return await documentsCall(
		{
			url: documentsPath("profile"),
			init: {
				method: "PUT",
				headers: JSON_HEADERS,
				body: JSON.stringify({ display_name: profile.display_name })
			},
			options
		},
		documentProfileSchema
	);
}
