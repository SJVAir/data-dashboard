import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { KeptOriginal, LogEntry, SpaceId } from "../types";

export const DB_NAME = "sjvair-workspace";

export interface WorkspaceDB extends DBSchema {
	documents: { key: [SpaceId, string]; value: { space: SpaceId; id: string; doc: unknown } };
	changeLog: { key: [SpaceId, string, number]; value: LogEntry & { space: SpaceId } };
	preferences: { key: [SpaceId, string]; value: { space: SpaceId; key: string; value: unknown } };
	/** Documents as they were before an upgrade or repair. */
	originals: { key: [SpaceId, string]; value: { space: SpaceId } & KeptOriginal };
	/** Reserved (unsynced server changes, server-sync track). */
	syncQueue: { key: [SpaceId, string]; value: { space: SpaceId; id: string } };
}

export type OpenOptions = {
	/** The open is waiting for another tab's older connection to close. */
	onBlocked?: () => void;
};

export async function openWorkspaceDB(
	options: OpenOptions = {}
): Promise<IDBPDatabase<WorkspaceDB>> {
	const db = await openDB<WorkspaceDB>(DB_NAME, 1, {
		blocked() {
			options.onBlocked?.();
		},
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
