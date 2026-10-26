import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DB_NAME,
	DB_VERSION,
	createStores,
	deleteDatabase,
	openWorkspaceDB,
	type WorkspaceDB
} from "./db";

beforeEach(async () => {
	await deleteDatabase();
});

describe("openWorkspaceDB", () => {
	it("an upgrade from another connection calls onVersionChange and closes", async () => {
		const onVersionChange = vi.fn();
		const db = await openWorkspaceDB({ onVersionChange });
		const blocked = vi.fn();
		const upgraded = await openDB(DB_NAME, DB_VERSION + 1, { blocked });
		expect(blocked).not.toHaveBeenCalled();
		expect(onVersionChange).toHaveBeenCalledOnce();
		expect(() => db.transaction("documents")).toThrow();
		upgraded.close();
	});

	it("upgrade is idempotent", async () => {
		const first = await openDB(DB_NAME, 1, {
			upgrade(db) {
				db.createObjectStore("documents", { keyPath: ["space", "id"] });
			}
		});
		await first.put("documents", { space: "anonymous", id: "a", doc: { x: 1 } });
		first.close();
		// A later layout version runs the same upgrade over the older database.
		const db = await openDB<WorkspaceDB>(DB_NAME, 2, { upgrade: createStores });
		expect(db.objectStoreNames.contains("changeLog")).toBe(true);
		expect(await db.get("documents", ["anonymous", "a"])).toEqual({
			space: "anonymous",
			id: "a",
			doc: { x: 1 }
		});
		createStores(db);
		db.close();
	});
});
