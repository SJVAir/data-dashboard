import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { LogEntry, SpaceId } from "../types";

export const DB_NAME = "sjvair-workspace";

export interface WorkspaceDB extends DBSchema {
	documents: { key: [SpaceId, string]; value: { space: SpaceId; id: string; doc: unknown } };
	changeLog: { key: [SpaceId, string, number]; value: LogEntry & { space: SpaceId } };
	preferences: { key: [SpaceId, string]; value: { space: SpaceId; key: string; value: unknown } };
	/** Reserved (upgrade originals, spec 3). */
	originals: { key: [SpaceId, string]; value: { space: SpaceId; id: string } };
	/** Reserved (unsynced server changes, server-sync track). */
	syncQueue: { key: [SpaceId, string]; value: { space: SpaceId; id: string } };
}

export async function openWorkspaceDB(): Promise<IDBPDatabase<WorkspaceDB>> {
	const db = await openDB<WorkspaceDB>(DB_NAME, 1, {
		blocking() {
			// Another connection wants to delete or upgrade the database; let it.
			db.close();
		},
		upgrade(db) {
			db.createObjectStore("documents", { keyPath: ["space", "id"] });
			db.createObjectStore("changeLog", { keyPath: ["space", "docId", "version"] });
			db.createObjectStore("preferences", { keyPath: ["space", "key"] });
			db.createObjectStore("originals", { keyPath: ["space", "id"] });
			db.createObjectStore("syncQueue", { keyPath: ["space", "id"] });
		}
	});
	return db;
}

export function deleteDatabase(): Promise<void> {
	return deleteDB(DB_NAME);
}
