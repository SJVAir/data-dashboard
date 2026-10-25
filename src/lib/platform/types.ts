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

/**
 * `baseVersion: null` means create. A non-empty `entries` must run contiguously from
 * `baseVersion + 1` (from any version on create) to `doc.version`, or `commit` rejects with
 * `CommitPreconditionError` before writing anything.
 */
export type CommitInput = {
	docId: string;
	baseVersion: number | null;
	doc: unknown;
	entries: LogEntry[];
};

export type CommitResult = { ok: true } | { ok: false; currentVersion: number };

/** Thrown by `commit` when `entries` aren't contiguous or don't end at `doc.version`. */
export class CommitPreconditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CommitPreconditionError";
	}
}

/** The largest journal record, as characters of JSON (256 KB). */
export const JOURNAL_RECORD_MAX = 262_144;

export interface DocumentStorage {
	list(space: SpaceId): Promise<unknown[]>;
	get(space: SpaceId, id: string): Promise<unknown | undefined>;
	commit(space: SpaceId, input: CommitInput): Promise<CommitResult>;
	readLog(space: SpaceId, docId: string, afterVersion: number): Promise<LogEntry[] | "trimmed">;
	/** Deletes the document, its change log, and its kept original. */
	remove(space: SpaceId, id: string): Promise<void>;
}

/** A document as it was before an upgrade or repair, kept in case it's wanted back. */
export type KeptOriginal = { id: string; raw: unknown; keptAt: string; fromSchemaVersion: number };

export interface OriginalStorage {
	get(space: SpaceId, id: string): Promise<KeptOriginal | undefined>;
	put(space: SpaceId, original: KeptOriginal): Promise<void>;
	list(space: SpaceId): Promise<KeptOriginal[]>;
	remove(space: SpaceId, id: string): Promise<void>;
}

export interface PreferenceStorage {
	get<T>(space: SpaceId, key: string): Promise<T | undefined>;
	set(space: SpaceId, key: string, value: unknown): Promise<void>;
}

/**
 * Unsaved changes written synchronously as a page goes away, so they survive a reload or close
 * that cuts the asynchronous save short. One record per space, dashboard, and tab. Records are
 * stored as given and read back unvalidated (`record` may be anything); writes that the browser
 * refuses (quota, blocked storage) are dropped silently, as are records over `JOURNAL_RECORD_MAX`.
 */
export interface JournalStorage {
	write(space: SpaceId, docId: string, tabId: string, record: unknown): void;
	readAll(space: SpaceId, docId: string): Array<{ tabId: string; record: unknown }>;
	clear(space: SpaceId, docId: string, tabId: string): void;
	/** Every record in a space, across dashboards. */
	list(space: SpaceId): Array<{ docId: string; tabId: string; record: unknown }>;
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

/** The system clipboard. */
export interface ClipboardAccess {
	/** Resolves `false` instead of throwing when the browser refuses. */
	writeText(text: string): Promise<boolean>;
}

export type OpenedFile = { name: string; size: number; text(): Promise<string> };

export interface FileAccess {
	/** Hands the person a file to keep (a download on the web). */
	save(name: string, contents: string, type: string): void;
	/** Shows a file picker; resolves `null` when it's cancelled. */
	open(accept: string): Promise<OpenedFile | null>;
}

/** Whether the browser promises to keep stored data. */
export type Protection = "protected" | "unprotected" | "unknown";

export interface PersistenceAccess {
	persisted(): Promise<Protection>;
	request(): Promise<Protection>;
	/** Whether `request()` asks the person (so it should follow a deliberate action). */
	prompts(): boolean;
}

export interface ResetAccess {
	/** Identifies the current data; it changes whenever `clearAll` runs, in any tab. */
	generation(): string;
	/** Erases everything stored, in every space. */
	clearAll(): Promise<void>;
}

export type Platform = {
	documents: DocumentStorage;
	preferences: PreferenceStorage;
	journal: JournalStorage;
	originals: OriginalStorage;
	identity: IdentitySource;
	activity: ActivitySource;
	clipboard: ClipboardAccess;
	files: FileAccess;
	persistence: PersistenceAccess;
	reset: ResetAccess;
};

export function docVersion(doc: unknown): number {
	const version = (doc as { version?: unknown } | null)?.version;
	return typeof version === "number" ? version : 0;
}

/** Whether a log whose oldest retained entry is `firstVersion` is complete after `afterVersion`. */
export function logCovers(firstVersion: number | undefined, afterVersion: number): boolean {
	return firstVersion === undefined || afterVersion >= firstVersion - 1;
}

/** Throws `CommitPreconditionError` unless the entries are contiguous and end at `doc.version`. */
export function assertCommitPrecondition(input: CommitInput): void {
	const { entries, baseVersion, doc } = input;
	if (entries.length === 0) return;
	const start = baseVersion === null ? entries[0].version : baseVersion + 1;
	entries.forEach((e, i) => {
		if (e.version !== start + i) {
			throw new CommitPreconditionError(`Entry ${i} has version ${e.version}, wanted ${start + i}`);
		}
	});
	if (entries[entries.length - 1].version !== docVersion(doc)) {
		throw new CommitPreconditionError("The last entry's version isn't the document's version");
	}
}
