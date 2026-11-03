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
	/** The share link's token while the document is shared (`link` or `public`), else `null`. */
	shareToken: string | null;
};

export type RemoteMeta = Omit<RemoteDocument, "body">;

export type RemoteChange = { version: number; schemaVersion: number; change: unknown };

export type RemoteChanges =
	| { version: number }
	| { version: number; changes: RemoteChange[] | null; document: RemoteDocument };

/** What a share link shows: nothing about the owner but their optional display name. */
export type SharedRemoteDocument = {
	id: string;
	kind: string;
	name: string | null;
	schemaVersion: number;
	version: number;
	body: unknown;
	updatedAt: string;
	displayName: string | null;
};

/** `{ version }` when `since` is current; else the whole shared document. */
export type SharedChanges =
	{ version: number } | { version: number; document: SharedRemoteDocument };

/** A copy's "Based on…" credit: the original's name and its owner's display name. */
export type Credit = { name: string | null; displayName: string | null };

/** The signed-in account's public display name for shared dashboards. */
export type Profile = { displayName: string | null };

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
	/** Turns the share link on; the token (the same one while it stays shared). */
	share(id: string): Promise<string>;
	/** Turns the share link off for good; sharing again makes a new token. */
	unshare(id: string): Promise<void>;
	/** The shared document behind a token; no sign-in needed. Any dead link is `not_found`. */
	shared(token: string): Promise<SharedRemoteDocument>;
	/** `{ version }` when `since` is current, else the shared document; no sign-in needed. */
	sharedChanges(token: string, since: number): Promise<SharedChanges>;
	/** The credit for a copy's original: open to its owner, or to anyone while it's shared. */
	credit(id: string): Promise<Credit>;
	getProfile(): Promise<Profile>;
	/** Sets the display name (the server trims it; `""` or `null` clears it). */
	setProfile(displayName: string | null): Promise<Profile>;
}
