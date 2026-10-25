import type { IDBPDatabase } from "idb";
import {
	LOG_LIMIT,
	assertCommitPrecondition,
	docVersion,
	logCovers,
	type CommitResult,
	type KeptOriginal,
	type LogEntry,
	type Platform,
	type ResetAccess,
	type SpaceId
} from "../types";
import { createWebActivity } from "./activity";
import { createWebClipboard } from "./clipboard";
import { createWebFiles } from "./files";
import { createWebPersistence } from "./persistence";
import { openWorkspaceDB, type OpenOptions, type WorkspaceDB } from "./db";
import { createWebJournal } from "./journal";

const logRange = (space: SpaceId, docId: string, from = 0) =>
	IDBKeyRange.bound([space, docId, from], [space, docId, Number.MAX_SAFE_INTEGER]);

function strip(row: LogEntry & { space: SpaceId }): LogEntry {
	const { docId, version, change, tabId, schemaVersion } = row;
	return { docId, version, change, tabId, schemaVersion };
}

function unwrap(row: { space: SpaceId } & KeptOriginal): KeptOriginal {
	const { id, raw, keptAt, fromSchemaVersion } = row;
	return { id, raw, keptAt, fromSchemaVersion };
}

const KEY_PREFIX = "sjvair-workspace:";
const GENERATION_KEY = `${KEY_PREFIX}generation`;

/**
 * The generation lives in `localStorage` so every tab sees a reset. `clearAll` writes the new one
 * first, synchronously, so other tabs stop saving before the slower erasing finishes.
 */
function createWebReset(db: IDBPDatabase<WorkspaceDB>): ResetAccess {
	let fallback: string | undefined;
	return {
		generation() {
			try {
				let value = localStorage.getItem(GENERATION_KEY);
				if (value === null) {
					value = crypto.randomUUID();
					localStorage.setItem(GENERATION_KEY, value);
				}
				return value;
			} catch {
				return (fallback ??= crypto.randomUUID());
			}
		},
		async clearAll() {
			const next = crypto.randomUUID();
			fallback = next;
			try {
				localStorage.setItem(GENERATION_KEY, next);
			} catch {
				// Blocked storage: this tab still knows the new generation.
			}
			const stores = ["documents", "changeLog", "preferences", "originals", "syncQueue"] as const;
			const tx = db.transaction([...stores], "readwrite");
			await Promise.all([...stores.map((name) => tx.objectStore(name).clear()), tx.done]);
			try {
				const doomed: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key !== null && key.startsWith(KEY_PREFIX) && key !== GENERATION_KEY) {
						doomed.push(key);
					}
				}
				for (const key of doomed) localStorage.removeItem(key);
			} catch {
				// Blocked storage: there is nothing to remove.
			}
		}
	};
}

export async function createWebPlatform(options: OpenOptions = {}): Promise<Platform> {
	const db: IDBPDatabase<WorkspaceDB> = await openWorkspaceDB(options);

	return {
		documents: {
			async list(space) {
				const rows = await db.getAll("documents", IDBKeyRange.bound([space, ""], [space, "￿"]));
				return rows.map((r) => r.doc);
			},
			async get(space, id) {
				return (await db.get("documents", [space, id]))?.doc;
			},
			async commit(space, input): Promise<CommitResult> {
				assertCommitPrecondition(input);
				const tx = db.transaction(["documents", "changeLog"], "readwrite");
				const docs = tx.objectStore("documents");
				const log = tx.objectStore("changeLog");
				const existing = await docs.get([space, input.docId]);
				const current = existing ? docVersion(existing.doc) : 0;
				if (input.baseVersion === null ? existing : !existing || current !== input.baseVersion) {
					await tx.done;
					return { ok: false, currentVersion: current };
				}
				await docs.put({ space, id: input.docId, doc: input.doc });
				for (const entry of input.entries) await log.put({ ...entry, space });
				const keys = await log.getAllKeys(logRange(space, input.docId));
				for (const k of keys.slice(0, Math.max(0, keys.length - LOG_LIMIT))) await log.delete(k);
				await tx.done;
				return { ok: true };
			},
			async readLog(space, docId, afterVersion) {
				const tx = db.transaction("changeLog", "readonly");
				const [first] = await tx.store.getAllKeys(logRange(space, docId), 1);
				if (!logCovers(first?.[2], afterVersion)) return "trimmed";
				const rows = await tx.store.getAll(logRange(space, docId, afterVersion + 1));
				return rows.map(strip);
			},
			async remove(space, id) {
				const tx = db.transaction(["documents", "changeLog", "originals"], "readwrite");
				await Promise.all([
					tx.objectStore("documents").delete([space, id]),
					tx.objectStore("changeLog").delete(logRange(space, id)),
					tx.objectStore("originals").delete([space, id]),
					tx.done
				]);
			}
		},
		originals: {
			async get(space, id) {
				const row = await db.get("originals", [space, id]);
				return row === undefined ? undefined : unwrap(row);
			},
			async put(space, original) {
				await db.put("originals", { ...original, space });
			},
			async list(space) {
				const rows = await db.getAll("originals", IDBKeyRange.bound([space, ""], [space, "￿"]));
				return rows.map(unwrap);
			},
			async remove(space, id) {
				await db.delete("originals", [space, id]);
			}
		},
		preferences: {
			async get<T>(space: SpaceId, key: string) {
				return (await db.get("preferences", [space, key]))?.value as T | undefined;
			},
			async set(space, key, value) {
				await db.put("preferences", { space, key, value });
			}
		},
		journal: createWebJournal(),
		identity: { currentSpace: async () => "anonymous" },
		activity: createWebActivity(),
		clipboard: createWebClipboard(),
		files: createWebFiles(),
		persistence: createWebPersistence(),
		reset: createWebReset(db)
	};
}
