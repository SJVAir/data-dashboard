/**
 * The dashboard's view of the server's saved documents (sjvair.com `documents/`), in camelCase.
 * `createSdkRemote` (remote-sdk.ts) talks to the server through `@sjvair/sdk/documents`;
 * `createFakeRemote` (remote-fake.ts) behaves like it in memory, for tests.
 *
 * Imports nothing from `$lib` at runtime, so Playwright can load the fake.
 */
import type { RefusalCode } from "@sjvair/sdk/documents";

export type { RefusalCode };

export type RemoteDocument = {
	id: string;
	kind: string;
	name: string | null;
	schemaVersion: number;
	version: number;
	body: unknown;
	deletedAt: string | null;
	copiedFrom: string | null;
	createdAt: string;
	updatedAt: string;
};

export type RemoteMeta = Omit<RemoteDocument, "body">;

export type RemoteChange = { version: number; schemaVersion: number; change: unknown };

export type RemoteChanges =
	| { version: number }
	| { version: number; changes: RemoteChange[] | null; document: RemoteDocument };

export type SaveInput = {
	schemaVersion: number;
	name: string | null;
	body: unknown;
	deletedAt: string | null;
	copiedFrom: string | null;
	baseVersion: number | null;
	changes: Array<{ schemaVersion: number; change: unknown }>;
	accountId: string;
	buildId: string;
	snapshot: "conflict" | null;
};

/** Content to keep as a `conflict` snapshot (call 5); the document is untouched. */
export type SnapshotInput = {
	baseVersion: number;
	schemaVersion: number;
	name: string | null;
	body: unknown;
	accountId: string;
	buildId: string;
};

export type StaleBase = {
	version: number;
	changes: RemoteChange[] | null;
	document: RemoteDocument;
};

/** A refusal (`code` from the SDK's `RefusalCode`); `staleBase` set for `stale_base`. */
export class RemoteRefusal extends Error {
	code: RefusalCode;
	status: number;
	staleBase?: StaleBase;

	constructor(code: RefusalCode, status: number, staleBase?: StaleBase, options?: ErrorOptions) {
		// The message is the code only: never the server's text, a name, or a body.
		super(`Refused: ${code}`, options);
		this.name = "RemoteRefusal";
		this.code = code;
		this.status = status;
		if (staleBase) this.staleBase = staleBase;
	}
}

/** The server couldn't be reached, or answered with something unusable. */
export class RemoteUnavailable extends Error {
	constructor(message = "The server is unavailable", options?: ErrorOptions) {
		super(message, options);
		this.name = "RemoteUnavailable";
	}
}

export interface RemoteDocuments {
	/** Every document's metadata (trashed included), or those updated since `since`. */
	list(since?: string): Promise<{ documents: RemoteMeta[]; purged: string[]; cursor: string }>;
	get(id: string): Promise<RemoteDocument>;
	/** `{ version }` when `since` is current; else the changes after it (or `null`) and the document. */
	changes(id: string, since: number): Promise<RemoteChanges>;
	/** Creates (`baseVersion: null`) or saves on `baseVersion`. */
	save(id: string, input: SaveInput): Promise<{ version: number; updatedAt: string }>;
	/** Keeps the given content as a `conflict` snapshot (call 5); the document is untouched. */
	keepSnapshot(id: string, input: SnapshotInput): Promise<void>;
}
