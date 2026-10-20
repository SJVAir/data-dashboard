import {
	LOG_LIMIT,
	docVersion,
	logCovers,
	type CommitInput,
	type CommitResult,
	type LogEntry,
	type Platform,
	type SpaceId
} from "./types";

const key = (...parts: (string | number)[]) => parts.join("\u0000");

/** In-memory twin of the web storage, for tests. Values are cloned like IndexedDB does. */
export function createMemoryPlatform(): Platform {
	const docs = new Map<string, { space: SpaceId; doc: unknown }>();
	const logs = new Map<string, LogEntry[]>();
	const prefs = new Map<string, unknown>();

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
				const log = [...(logs.get(k) ?? []), ...structuredClone(input.entries)];
				logs.set(k, log.slice(-LOG_LIMIT));
				return { ok: true };
			},
			async readLog(space, docId, afterVersion) {
				const log = logs.get(key(space, docId)) ?? [];
				if (!logCovers(log[0]?.version, afterVersion)) return "trimmed";
				return structuredClone(log.filter((e) => e.version > afterVersion));
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
		identity: { currentSpace: async () => "anonymous" }
	};
}
