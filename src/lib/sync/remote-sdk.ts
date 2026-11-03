/**
 * `RemoteDocuments` over `@sjvair/sdk/documents`. The SDK's wire names (snake_case) stay in
 * this file; refusals become `RemoteRefusal`, and anything else that goes wrong (no network, an
 * abort, a response the SDK can't use) becomes `RemoteUnavailable`.
 */
import {
	createShareLink,
	createSnapshot,
	DocumentRefusal,
	DocumentResponseError,
	getDocument,
	getDocumentChanges,
	getDocumentCredit,
	getDocumentProfile,
	getSharedDocument,
	getSharedDocumentChanges,
	listDocuments,
	revokeShareLink,
	saveDocument,
	staleBaseDataSchema,
	updateDocumentProfile,
	type ChangeEntry,
	type DocumentProfile,
	type RefusalCode,
	type SavedDocument,
	type SharedDocument
} from "@sjvair/sdk/documents";
import type { RequestOptions } from "@sjvair/sdk/http";
import { report } from "$lib/safety/report";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteChange,
	type RemoteDocument,
	type RemoteDocuments,
	type RemoteMeta,
	type SharedRemoteDocument
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
		updatedAt: doc.updated_at,
		shareToken: doc.visibility === "private" ? null : doc.share_token
	};
}

function toDocument(doc: SavedDocument): RemoteDocument {
	return { ...toMeta(doc), body: doc.body };
}

function toShared(doc: SharedDocument): SharedRemoteDocument {
	return {
		id: doc.id,
		kind: doc.kind,
		name: doc.name,
		schemaVersion: doc.schema_version,
		version: doc.version,
		body: doc.body,
		updatedAt: doc.updated_at,
		displayName: doc.display_name
	};
}

function toProfile(profile: DocumentProfile) {
	return { displayName: profile.display_name };
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

		keepSnapshot: (id, input) =>
			call("documents.keepSnapshot", async () => {
				await createSnapshot(
					id,
					{
						base_version: input.baseVersion,
						schema_version: input.schemaVersion,
						name: input.name,
						body: input.body,
						account_id: input.accountId,
						build_id: input.buildId
					},
					options
				);
			}),

		share: (id) =>
			call("documents.share", async () => (await createShareLink(id, options)).share_token),

		unshare: (id) =>
			call("documents.unshare", async () => {
				await revokeShareLink(id, options);
			}),

		shared: (token) =>
			call("documents.shared", async () => toShared(await getSharedDocument(token, options))),

		sharedChanges: (token, since) =>
			call("documents.sharedChanges", async () => {
				// The SDK answers `{ version }` or the whole shared document, with no wrapper.
				const answer = await getSharedDocumentChanges(token, since, options);
				if (!("body" in answer)) return { version: answer.version };
				return { version: answer.version, document: toShared(answer) };
			}),

		credit: (id) =>
			call("documents.credit", async () => {
				const credit = await getDocumentCredit(id, options);
				return { name: credit.name, displayName: credit.display_name };
			}),

		getProfile: () =>
			call("documents.getProfile", async () => toProfile(await getDocumentProfile(options))),

		setProfile: (displayName) =>
			call("documents.setProfile", async () =>
				toProfile(await updateDocumentProfile({ display_name: displayName }, options))
			)
	};
}
