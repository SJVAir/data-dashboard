import type { IDBPDatabase } from "idb";
import {
	LOG_LIMIT,
	docVersion,
	logCovers,
	type CommitResult,
	type LogEntry,
	type Platform,
	type SpaceId
} from "../types";
import { openWorkspaceDB, type OpenOptions, type WorkspaceDB } from "./db";

const logRange = (space: SpaceId, docId: string, from = 0) =>
	IDBKeyRange.bound([space, docId, from], [space, docId, Number.MAX_SAFE_INTEGER]);

function strip(row: LogEntry & { space: SpaceId }): LogEntry {
	const { docId, version, change, tabId, schemaVersion } = row;
	return { docId, version, change, tabId, schemaVersion };
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
		identity: { currentSpace: async () => "anonymous" }
	};
}
