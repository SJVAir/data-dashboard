import {
	JOURNAL_RECORD_MAX,
	LOG_LIMIT,
	assertCommitPrecondition,
	docVersion,
	logCovers,
	type CommitInput,
	type CommitResult,
	type KeptOriginal,
	type LogEntry,
	type ActivitySource,
	type ClipboardAccess,
	type ErrorReporter,
	type FileAccess,
	type OpenedFile,
	type PersistenceAccess,
	type Protection,
	type ReportContext,
	type Platform,
	type SpaceId
} from "./types";

const key = (...parts: (string | number)[]) => parts.join("\u0000");

export type MemoryActivity = ActivitySource & { setVisible(visible: boolean): void };

/** Visibility under test control; starts visible. Listeners hear only real changes. */
export function createMemoryActivity(): MemoryActivity {
	let visible = true;
	const listeners = new Set<(visible: boolean) => void>();
	return {
		visible: () => visible,
		onChange(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		setVisible(next) {
			if (next === visible) return;
			visible = next;
			for (const cb of [...listeners]) cb(visible);
		}
	};
}

export type MemoryClipboard = ClipboardAccess & { fail(on: boolean): void; last: string | null };
export type MemoryFiles = FileAccess & {
	queueOpen(file: OpenedFile | null): void;
	saved: Array<{ name: string; contents: string; type: string }>;
};
export type MemoryPersistence = PersistenceAccess & {
	set(state: Protection, prompts: boolean): void;
};

export type MemoryErrors = ErrorReporter & {
	reports: Array<{ error: unknown; context?: ReportContext }>;
};

export type MemoryPlatform = Platform & {
	activity: MemoryActivity;
	clipboard: MemoryClipboard;
	files: MemoryFiles;
	persistence: MemoryPersistence;
	errors: MemoryErrors;
};

/** In-memory twin of the web storage, for tests. Values are cloned like IndexedDB does. */
export function createMemoryPlatform(): MemoryPlatform {
	const docs = new Map<string, { space: SpaceId; doc: unknown }>();
	const logs = new Map<string, LogEntry[]>();
	const prefs = new Map<string, unknown>();
	const originals = new Map<string, { space: SpaceId; original: KeptOriginal }>();
	const journal = new Map<string, { space: SpaceId; docId: string; tabId: string; json: string }>();

	let generation = crypto.randomUUID();
	let failClipboard = false;
	const clipboard: MemoryClipboard = {
		last: null,
		fail(on) {
			failClipboard = on;
		},
		async writeText(text) {
			if (failClipboard) return false;
			clipboard.last = text;
			return true;
		}
	};
	const opens: Array<OpenedFile | null> = [];
	const files: MemoryFiles = {
		saved: [],
		queueOpen: (file) => void opens.push(file),
		save(name, contents, type) {
			files.saved.push({ name, contents, type });
		},
		async open() {
			return opens.shift() ?? null;
		}
	};
	let protection: Protection = "unknown";
	let asks = false;
	const persistence: MemoryPersistence = {
		set(state, prompts) {
			protection = state;
			asks = prompts;
		},
		persisted: async () => protection,
		request: async () => protection,
		prompts: () => asks
	};

	const errors: MemoryErrors = {
		reports: [],
		report(error, context) {
			errors.reports.push({ error, context });
		}
	};

	return {
		documents: {
			async list(space) {
				return [...docs.values()]
					.filter((d) => d.space === space)
					.map((d) => structuredClone(d.doc));
			},
			async get(space, id) {
				const found = docs.get(key(space, id));
				return found === undefined ? undefined : structuredClone(found.doc);
			},
			async commit(space, input: CommitInput): Promise<CommitResult> {
				assertCommitPrecondition(input);
				const k = key(space, input.docId);
				const existing = docs.get(k);
				if (
					input.baseVersion === null
						? existing
						: !existing || docVersion(existing.doc) !== input.baseVersion
				) {
					return { ok: false, currentVersion: existing ? docVersion(existing.doc) : 0 };
				}
				docs.set(k, { space, doc: structuredClone(input.doc) });
				// A later entry replaces an earlier one with the same version, as IndexedDB's put does.
				const byVersion = new Map((logs.get(k) ?? []).map((e) => [e.version, e]));
				for (const e of structuredClone(input.entries)) byVersion.set(e.version, e);
				const log = [...byVersion.values()].sort((a, b) => a.version - b.version);
				logs.set(k, log.slice(-LOG_LIMIT));
				return { ok: true };
			},
			async readLog(space, docId, afterVersion) {
				const log = logs.get(key(space, docId)) ?? [];
				if (!logCovers(log[0]?.version, afterVersion)) return "trimmed";
				return structuredClone(log.filter((e) => e.version > afterVersion));
			},
			async remove(space, id) {
				const k = key(space, id);
				docs.delete(k);
				logs.delete(k);
				originals.delete(k);
			}
		},
		originals: {
			async get(space, id) {
				const found = originals.get(key(space, id));
				return found === undefined ? undefined : structuredClone(found.original);
			},
			async put(space, original) {
				originals.set(key(space, original.id), { space, original: structuredClone(original) });
			},
			async list(space) {
				return [...originals.values()]
					.filter((o) => o.space === space)
					.map((o) => structuredClone(o.original));
			},
			async remove(space, id) {
				originals.delete(key(space, id));
			}
		},
		preferences: {
			async get<T>(space: SpaceId, k: string) {
				const v = prefs.get(key(space, k));
				return (v === undefined ? undefined : structuredClone(v)) as T | undefined;
			},
			async set(space, k, value) {
				prefs.set(key(space, k), structuredClone(value));
			}
		},
		journal: {
			// Stored as JSON, as the web journal does.
			write(space, docId, tabId, record) {
				const json = JSON.stringify(record);
				if (json.length > JOURNAL_RECORD_MAX) return;
				journal.set(key(space, docId, tabId), { space, docId, tabId, json });
			},
			readAll(space, docId) {
				return [...journal.values()]
					.filter((j) => j.space === space && j.docId === docId)
					.map((j) => ({ tabId: j.tabId, record: JSON.parse(j.json) as unknown }));
			},
			list(space) {
				return [...journal.values()]
					.filter((j) => j.space === space)
					.map((j) => ({ docId: j.docId, tabId: j.tabId, record: JSON.parse(j.json) as unknown }));
			},
			clear(space, docId, tabId) {
				journal.delete(key(space, docId, tabId));
			}
		},
		identity: { currentSpace: async () => "anonymous" },
		activity: createMemoryActivity(),
		clipboard,
		files,
		persistence,
		errors,
		reset: {
			generation: () => generation,
			async clearAll() {
				generation = crypto.randomUUID();
				docs.clear();
				logs.clear();
				prefs.clear();
				originals.clear();
				journal.clear();
			}
		}
	};
}
