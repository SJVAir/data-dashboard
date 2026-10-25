import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { CURRENT_SCHEMA_VERSION } from "../../documents/schema";
import type { KeptOriginal, LogEntry, SpaceId } from "../types";

export const DB_NAME = "sjvair-workspace";

/** Bumped when the stores or indexes change shape. */
export const DB_LAYOUT_VERSION = 1;
/** Every document-format (`schemaVersion`) bump also bumps this, so old tabs stop saving. */
export const DB_VERSION = DB_LAYOUT_VERSION + CURRENT_SCHEMA_VERSION - 1;

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
	/** Another connection wants a newer layout; called just before this connection closes. */
	onVersionChange?: () => void;
};

/** Creates each store that's missing, so it is safe to run on a database from any older layout. */
export function createStores(db: IDBPDatabase<WorkspaceDB>): void {
	const stores = [
		["documents", ["space", "id"]],
		["changeLog", ["space", "docId", "version"]],
		["preferences", ["space", "key"]],
		["originals", ["space", "id"]],
		["syncQueue", ["space", "id"]]
	] as const;
	for (const [name, keyPath] of stores) {
		if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: [...keyPath] });
	}
}

export async function openWorkspaceDB(
	options: OpenOptions = {}
): Promise<IDBPDatabase<WorkspaceDB>> {
	const db = await openDB<WorkspaceDB>(DB_NAME, DB_VERSION, {
		blocked() {
			options.onBlocked?.();
		},
		blocking() {
			// Another connection wants to delete or upgrade the database; let it.
			options.onVersionChange?.();
			db.close();
		},
		upgrade: createStores
	});
	return db;
}

export function deleteDatabase(): Promise<void> {
	return deleteDB(DB_NAME);
}
