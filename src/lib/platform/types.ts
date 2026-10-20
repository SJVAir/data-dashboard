import type { Change } from "$lib/changes/types";

export type SpaceId = "anonymous" | `account:${string}`;

export const LOG_LIMIT = 500;

export type LogEntry = {
	docId: string;
	version: number;
	change: Change;
	tabId: string;
	schemaVersion: number;
};

/** `baseVersion: null` means create. The stored doc's `version` must equal the last entry's. */
export type CommitInput = {
	docId: string;
	baseVersion: number | null;
	doc: unknown;
	entries: LogEntry[];
};

export type CommitResult = { ok: true } | { ok: false; currentVersion: number };

export interface DocumentStorage {
	list(space: SpaceId): Promise<unknown[]>;
	get(space: SpaceId, id: string): Promise<unknown | undefined>;
	commit(space: SpaceId, input: CommitInput): Promise<CommitResult>;
	readLog(space: SpaceId, docId: string, afterVersion: number): Promise<LogEntry[] | "trimmed">;
}

export interface PreferenceStorage {
	get<T>(space: SpaceId, key: string): Promise<T | undefined>;
	set(space: SpaceId, key: string, value: unknown): Promise<void>;
}

export interface IdentitySource {
	currentSpace(): Promise<SpaceId>;
}

export type Platform = {
	documents: DocumentStorage;
	preferences: PreferenceStorage;
	identity: IdentitySource;
};

export function docVersion(doc: unknown): number {
	const version = (doc as { version?: unknown } | null)?.version;
	return typeof version === "number" ? version : 0;
}

/** Whether a log whose oldest retained entry is `firstVersion` is complete after `afterVersion`. */
export function logCovers(firstVersion: number | undefined, afterVersion: number): boolean {
	return firstVersion === undefined || afterVersion >= firstVersion - 1;
}
