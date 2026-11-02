/**
 * `RemoteDocuments` over `@sjvair/sdk/documents`. The SDK's wire names (snake_case) stay in
 * this file; refusals become `RemoteRefusal`, and anything else that goes wrong (no network, an
 * abort, a response the SDK can't use) becomes `RemoteUnavailable`.
 */
import {
	DocumentRefusal,
	DocumentResponseError,
	getDocument,
	getDocumentChanges,
	listDocuments,
	saveDocument,
	staleBaseDataSchema,
	type ChangeEntry,
	type RefusalCode,
	type SavedDocument
} from "@sjvair/sdk/documents";
import type { RequestOptions } from "@sjvair/sdk/http";
import { report } from "$lib/safety/report";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteChange,
	type RemoteDocument,
	type RemoteDocuments,
	type RemoteMeta
} from "./remote";

function toMeta(doc: Omit<SavedDocument, "body">): RemoteMeta {
	return {
		id: doc.id,
		kind: doc.kind,
		name: doc.name,
		schemaVersion: doc.schema_version,
		version: doc.version,
		deletedAt: doc.deleted_at,
		copiedFrom: doc.copied_from,
		createdAt: doc.created_at,
		updatedAt: doc.updated_at
	};
}

function toDocument(doc: SavedDocument): RemoteDocument {
	return { ...toMeta(doc), body: doc.body };
}

function toChanges(changes: ChangeEntry[] | null): RemoteChange[] | null {
	return (
		changes?.map((c) => ({
			version: c.version,
			schemaVersion: c.schema_version,
			change: c.change
		})) ?? null
	);
}

/** The error a failed call throws, reporting a response the SDK couldn't use. */
function toRemoteError(error: unknown, operation: string): Error {
	if (error instanceof DocumentRefusal) {
		const code = error.code as RefusalCode;
		if (code === "stale_base") {
			const parsed = staleBaseDataSchema.safeParse(error.data);
			if (!parsed.success) return unusable(operation);
			const { version, changes, document } = parsed.data;
			return new RemoteRefusal(code, error.status, {
				version,
				changes: toChanges(changes),
				document: toDocument(document)
			});
		}
		return new RemoteRefusal(code, error.status);
	}
	if (error instanceof DocumentResponseError) return unusable(operation);
	// A network error or an abort.
	return new RemoteUnavailable(undefined, { cause: error });
}

/**
 * Reports a response that didn't match the SDK's schema. The SDK's error is not sent: its
 * cause can hold the response, and a document's name or body must never reach a report.
 */
function unusable(operation: string): RemoteUnavailable {
	report(new Error("A documents response failed validation"), { operation });
	return new RemoteUnavailable("The server's answer was unusable");
}

export function createSdkRemote(
	opts: { init?: RequestInit; signal?: AbortSignal } = {}
): RemoteDocuments {
	const options: RequestOptions = { init: opts.init, signal: opts.signal };

	async function call<T>(operation: string, run: () => Promise<T>): Promise<T> {
		try {
			return await run();
		} catch (error) {
			throw toRemoteError(error, operation);
		}
	}

	return {
		list: (since) =>
			call("documents.list", async () => {
				const list = await listDocuments(since === undefined ? undefined : { since }, options);
				return { documents: list.documents.map(toMeta), purged: list.purged, cursor: list.cursor };
			}),

		get: (id) => call("documents.get", async () => toDocument(await getDocument(id, options))),

		changes: (id, since) =>
			call("documents.changes", async () => {
				const answer = await getDocumentChanges(id, since, options);
				if (!("document" in answer)) return { version: answer.version };
				return {
					version: answer.version,
					changes: toChanges(answer.changes),
					document: toDocument(answer.document)
				};
			}),

		save: (id, input) =>
			call("documents.save", async () => {
				const result = await saveDocument(
					id,
					{
						kind: "dashboard",
						schema_version: input.schemaVersion,
						name: input.name,
						body: input.body,
						deleted_at: input.deletedAt,
						copied_from: input.copiedFrom,
						base_version: input.baseVersion,
						changes: input.changes.map((c) => ({
							schema_version: c.schemaVersion,
							change: c.change
						})),
						account_id: input.accountId,
						build_id: input.buildId,
						snapshot: input.snapshot
					},
					options
				);
				return { version: result.version, updatedAt: result.updated_at };
			}),

		// `POST documents/<id>/snapshots/` arrives as the SDK's `createSnapshot(id, form)` in
		// @sjvair/sdk 4.8.0-beta.3 (not published yet); wire it up when the pin moves.
		keepSnapshot: async () => {
			throw new RemoteUnavailable("keepSnapshot needs @sjvair/sdk 4.8.0-beta.3");
		}
	};
}
