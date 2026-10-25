import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Platform, SpaceId } from "$lib/platform/types";
import { COPY_FINGERPRINTS_KEY, rememberCopy } from "$lib/sharing/fingerprints";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { blankDashboard } from "$lib/starter/starter";
import { RETENTION_MS, purgeExpired } from "./purge";

const SPACE: SpaceId = "anonymous";
const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

async function store(platform: Platform, id: string, extra: Record<string, unknown> = {}) {
	const doc = { ...blankDashboard(NOW), id, ...extra };
	await platform.documents.commit(SPACE, { docId: id, baseVersion: null, doc, entries: [] });
}

const record = (writtenAt: string) => ({
	baseVersion: 1,
	changes: [{ op: "setField", target: { path: "name" }, from: null, to: "x" }],
	schemaVersion: 1,
	writtenAt
});

describe("purgeExpired", () => {
	it("retains for 30 days", () => {
		expect(RETENTION_MS).toBe(30 * DAY);
	});

	it("removes a dashboard deleted 31 days ago with everything of its own", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "old", { deletedAt: ago(31) });
		await platform.originals.put(SPACE, {
			id: "old",
			raw: {},
			keptAt: ago(1),
			fromSchemaVersion: 1
		});
		platform.journal.write(SPACE, "old", "t1", record(ago(1)));
		await rememberCopy(platform, SPACE, "fp", "old");

		await purgeExpired(platform, SPACE, NOW);

		expect(await platform.documents.get(SPACE, "old")).toBeUndefined();
		expect(await platform.originals.get(SPACE, "old")).toBeUndefined();
		expect(platform.journal.list(SPACE)).toEqual([]);
		expect(await platform.preferences.get(SPACE, COPY_FINGERPRINTS_KEY)).toEqual({});
	});

	it("keeps a dashboard deleted 29 days ago", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "recent", { deletedAt: ago(29) });
		await purgeExpired(platform, SPACE, NOW);
		expect(await platform.documents.get(SPACE, "recent")).toBeDefined();
	});

	it("removes originals kept 31 days ago only", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "a");
		await platform.originals.put(SPACE, {
			id: "a",
			raw: {},
			keptAt: ago(31),
			fromSchemaVersion: 1
		});
		await platform.originals.put(SPACE, {
			id: "b",
			raw: {},
			keptAt: ago(29),
			fromSchemaVersion: 1
		});
		await purgeExpired(platform, SPACE, NOW);
		expect((await platform.originals.list(SPACE)).map((o) => o.id)).toEqual(["b"]);
	});

	it("clears journal records for a missing dashboard or older than 30 days", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "here");
		platform.journal.write(SPACE, "missing", "t1", record(ago(1)));
		platform.journal.write(SPACE, "here", "old", record(ago(31)));
		platform.journal.write(SPACE, "here", "new", record(ago(1)));
		await purgeExpired(platform, SPACE, NOW);
		expect(platform.journal.list(SPACE).map((r) => [r.docId, r.tabId])).toEqual([["here", "new"]]);
	});

	it("keeps a starter hand-off record until it is that old", async () => {
		const platform = createMemoryPlatform();
		platform.journal.write(SPACE, "starter", "t1", record(ago(1)));
		platform.journal.write(SPACE, "starter", "t2", record(ago(31)));
		await purgeExpired(platform, SPACE, NOW);
		expect(platform.journal.list(SPACE).map((r) => r.tabId)).toEqual(["t1"]);
	});

	it("runs when the app opens, before the list is read", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "old", { deletedAt: ago(31) });
		const app = await initApp(platform, {
			channel: createMemoryTabHub().channel(),
			now: () => NOW
		});
		expect(await platform.documents.get(SPACE, "old")).toBeUndefined();
		expect(app.index.deleted).toEqual([]);
	});

	it("leaves a dashboard another tab restored since it was listed", async () => {
		const platform = createMemoryPlatform();
		await store(platform, "back", { deletedAt: ago(31) });
		const get = platform.documents.get.bind(platform.documents);
		platform.documents.get = async (space, id) => {
			const found = (await get(space, id)) as Record<string, unknown> | undefined;
			if (!found) return found;
			const { deletedAt: _, ...live } = found;
			void _;
			return live;
		};
		await purgeExpired(platform, SPACE, NOW);
		expect(await get(SPACE, "back")).toBeDefined();
	});
});
