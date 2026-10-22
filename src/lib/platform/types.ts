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

/**
 * Unsaved changes written synchronously as a page goes away, so they survive a reload or close
 * that cuts the asynchronous save short. One record per space, dashboard, and tab. Records are
 * stored as given and read back unvalidated (`record` may be anything); writes that the browser
 * refuses (quota, blocked storage) are dropped silently.
 */
export interface JournalStorage {
	write(space: SpaceId, docId: string, tabId: string, record: unknown): void;
	readAll(space: SpaceId, docId: string): Array<{ tabId: string; record: unknown }>;
	clear(space: SpaceId, docId: string, tabId: string): void;
}

export interface IdentitySource {
	currentSpace(): Promise<SpaceId>;
}

/**
 * Whether the app is in front of the person. On the web this is page visibility; a Tauri build
 * may report visible while the window is in the background, so polling keeps going there.
 */
export interface ActivitySource {
	visible(): boolean;
	/** Called on every change; returns a function that stops listening. */
	onChange(cb: (visible: boolean) => void): () => void;
}

export type Platform = {
	documents: DocumentStorage;
	preferences: PreferenceStorage;
	journal: JournalStorage;
	identity: IdentitySource;
	activity: ActivitySource;
};

export function docVersion(doc: unknown): number {
	const version = (doc as { version?: unknown } | null)?.version;
	return typeof version === "number" ? version : 0;
}

/** Whether a log whose oldest retained entry is `firstVersion` is complete after `afterVersion`. */
export function logCovers(firstVersion: number | undefined, afterVersion: number): boolean {
	return firstVersion === undefined || afterVersion >= firstVersion - 1;
}
