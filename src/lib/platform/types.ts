import type { Change } from "$lib/changes/types";
import type { Identity } from "$lib/account/identity";
import type { SyncRecord } from "$lib/sync/types";

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
	/** Written in the same transaction as the document; only if the commit succeeds. */
	sync?: SyncRecord;
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
	/**
	 * A document's log keeps its last `LOG_LIMIT` entries, and never trims an entry after its sync
	 * record's `syncedThrough` (unconfirmed by the server).
	 */
	readLog(space: SpaceId, docId: string, afterVersion: number): Promise<LogEntry[] | "trimmed">;
	/** Deletes the document, its change log, its kept original, and its sync record. */
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

/** Each document's standing with the server, one record per space and document. */
export interface SyncStateStorage {
	get(space: SpaceId, docId: string): Promise<SyncRecord | undefined>;
	list(space: SpaceId): Promise<SyncRecord[]>;
	put(space: SpaceId, record: SyncRecord): Promise<void>;
}

export interface SpaceStorage {
	/** Every space with anything stored (documents, preferences, records, or journal). */
	list(): Promise<SpaceId[]>;
	/** Everything in the space: documents, logs, originals, preferences, records, journal. */
	remove(space: SpaceId): Promise<void>;
	/**
	 * Documents with their logs, originals, records, and journal records; ids unchanged. Whatever
	 * `to` held under those ids is replaced.
	 */
	move(from: SpaceId, to: SpaceId, ids: string[]): Promise<void>;
}

/**
 * The oldest log version a commit must keep: entries after `syncedThrough` wait for the server.
 * `undefined` (no record) keeps only the last `LOG_LIMIT`.
 */
export function trimFloor(record: SyncRecord | undefined): number {
	return record === undefined ? Number.MAX_SAFE_INTEGER : record.syncedThrough;
}

/** What told the identity source about a change. */
export type IdentityCause = "load" | "recheck" | "tab" | "sign-out";

/** Who is signed in. Starts "unknown" until `start()` reads the page or the server answers. */
export interface IdentitySource {
	/**
	 * The space for whoever is signed in (`account:<id>`, else "anonymous"). After `start()` it
	 * waits for the first known identity (the page's block answers at once; otherwise the first
	 * request, up to its timeout); still unknown gives "anonymous".
	 */
	currentSpace(): Promise<SpaceId>;
	readonly authMode: "cookie";
	current(): Identity;
	/** Called only when the identity actually changes (`!sameIdentity`). */
	onChange(cb: (identity: Identity, cause: IdentityCause) => void): () => void;
	/** Reads the block (or asks the server once) and starts focus/online re-checks. Idempotent. */
	start(): void;
	/** Asks the server; `force` skips the 30 s throttle. One request in flight at a time. */
	recheck(opts?: { force?: boolean }): Promise<void>;
	/** An identity another tab learned; applies it with cause "tab", no request. */
	accept(identity: Identity): void;
	/** POSTs the site's logout; true on success (then signed out, cause "sign-out"). */
	signOut(): Promise<boolean>;
	/** The account id the page says was just deleted in this browser (call 6), else null. */
	deletedAccount(): string | null;
	/** `/account/login/?next=` plus the encoded path. */
	signInUrl(returnPath: string): string;
	accountUrl(): string;
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

/** Whether the network is reachable, as far as the platform can tell. */
export interface OnlineSource {
	online(): boolean;
	/** Called on every change; returns a function that stops listening. */
	onChange(cb: (online: boolean) => void): () => void;
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

/** Non-identifying details sent with an error report; unlisted keys are dropped when sent. */
export type ReportContext = Record<string, string | number | boolean | null | undefined>;

export interface ErrorReporter {
	/** Never throws; drops the report if it can't be sent. */
	report(error: unknown, context?: ReportContext): void;
}

export interface LockAccess {
	/** Runs `fn` holding `name` (one holder per browser profile), waiting its turn. */
	run<T>(name: string, fn: () => Promise<T>): Promise<T>;
	/**
	 * Runs `fn` holding `name` only if nobody holds or waits for it; resolves whether it ran.
	 */
	tryRun(name: string, fn: () => Promise<void>): Promise<boolean>;
	/**
	 * Waits for `name`, calls `onGranted`, and holds it until `signal` aborts. `shared` holders
	 * hold it together (still excluding `run` and `tryRun`).
	 */
	hold(
		name: string,
		signal: AbortSignal,
		onGranted: () => void,
		opts?: { shared?: boolean }
	): Promise<void>;
	/** Whether anyone in this browser profile holds `name` or is waiting for it. */
	held(name: string): Promise<boolean>;
}

export type Platform = {
	documents: DocumentStorage;
	preferences: PreferenceStorage;
	journal: JournalStorage;
	originals: OriginalStorage;
	sync: SyncStateStorage;
	spaces: SpaceStorage;
	identity: IdentitySource;
	activity: ActivitySource;
	online: OnlineSource;
	locks: LockAccess;
	clipboard: ClipboardAccess;
	files: FileAccess;
	persistence: PersistenceAccess;
	reset: ResetAccess;
	errors: ErrorReporter;
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
