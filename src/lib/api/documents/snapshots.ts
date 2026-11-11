/**
 * Utilities for a document's snapshots (kept 30 days): list them, read one,
 * and keep given content as a new one.
 *
 * @example Usage
 * ```ts
 * import {
 *   createSnapshot,
 *   getSnapshot,
 *   listSnapshots,
 * } from "$lib/api/documents/snapshots";
 *
 * const [newest] = await listSnapshots("abc");
 * const snapshot = await getSnapshot("abc", newest.id);
 * console.log(snapshot.version, snapshot.body);
 *
 * // Keep this device's version before taking the server's.
 * await createSnapshot("abc", {
 *   base_version: 4,
 *   schema_version: 1,
 *   name: "Fresno",
 *   body: { widgets: [] },
 *   account_id: "u1",
 *   build_id: "deadbeef",
 * });
 * ```
 *
 * @module
 */
import { z } from "$lib/zod";
import type { RequestOptions } from "@sjvair/sdk/http";
import { ACCEPT_HEADERS, documentsCall, documentsPath, JSON_HEADERS } from "./call";
import { snapshotMetaSchema, snapshotSchema } from "./schema";
import type { CreateSnapshotForm, Snapshot, SnapshotMeta } from "./types";

/**
 * Lists a document's snapshots, newest first, without their bodies.
 *
 * @param id The document id.
 * @param options Request options.
 * @returns The snapshots
 */
export async function listSnapshots(
	id: string,
	options?: RequestOptions
): Promise<Array<SnapshotMeta>> {
	return await documentsCall(
		{
			url: documentsPath(id, "snapshots"),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		z.array(snapshotMetaSchema)
	);
}

/**
 * Gets one snapshot of a document, with its body.
 *
 * @param id The document id.
 * @param snapshotId The snapshot's id.
 * @param options Request options.
 * @returns The snapshot
 */
export async function getSnapshot(
	id: string,
	snapshotId: number,
	options?: RequestOptions
): Promise<Snapshot> {
	return await documentsCall(
		{
			url: documentsPath(id, "snapshots", snapshotId),
			init: { headers: ACCEPT_HEADERS },
			options
		},
		snapshotSchema
	);
}

/**
 * Keeps given content as a snapshot of a document, with reason `conflict`
 * and `version` = `form.base_version`; use it to keep a version that exists
 * only on this device (such as one set aside in a conflict). The document
 * itself doesn't change: no new version, no change-log entry, and the same
 * `updated_at`.
 *
 * The document must already exist (otherwise refused as `not_found`, or
 * `gone` once purged). A `base_version` that isn't the current version is
 * refused as `stale_base`, with the same `data` as a save's (see
 * `staleBaseDataSchema`). It counts toward the same rate limit as saves. A
 * trashed document, or a `schema_version` older than the document's, is
 * accepted. Snapshots never fail on storage: the owner's oldest are trimmed
 * instead.
 *
 * @param id The document id.
 * @param form The content to keep.
 * @param options Request options.
 * @returns The new snapshot, without its body
 */
export async function createSnapshot(
	id: string,
	form: CreateSnapshotForm,
	options?: RequestOptions
): Promise<SnapshotMeta> {
	return await documentsCall(
		{
			url: documentsPath(id, "snapshots"),
			init: {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify(form)
			},
			options
		},
		snapshotMetaSchema
	);
}
