import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Platform, SpaceId } from "$lib/platform/types";
import { RETENTION_MS } from "$lib/safety/purge";
import { blankDashboard } from "$lib/starter/starter";
import {
	HIDDEN_KEY,
	hasUnsynced,
	hideSpace,
	spaceFor,
	spaceLock,
	tidySpaces,
	unhideSpace
} from "./spaces";

const A: SpaceId = "account:a";
const B: SpaceId = "account:b";
const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const user = (id: string) => ({
	id,
	full_name: "Test",
	email: null,
	phone: null,
	phone_verified: false,
	language: "en"
});

/** A dashboard in `space`, synced through its current version unless `synced` is false. */
async function store(platform: Platform, space: SpaceId, id: string, synced = true) {
	const doc = { ...blankDashboard(NOW), id };
	await platform.documents.commit(space, {
		docId: id,
		baseVersion: null,
		doc,
		entries: [],
		sync: synced
			? {
					docId: id,
					serverVersion: 1,
					syncedThrough: doc.version,
					confirmedAt: NOW.toISOString(),
					inFlight: null,
					hold: null,
					shareToken: null
				}
			: undefined
	});
}

describe("spaces", () => {
	it("spaceFor maps identities", () => {
		expect(spaceFor({ state: "unknown" })).toBe("anonymous");
		expect(spaceFor({ state: "signed-out" })).toBe("anonymous");
		expect(spaceFor({ state: "signed-in", user: user("42") })).toBe("account:42");
	});

	it("hiding keeps the first reason", async () => {
		const platform = createMemoryPlatform();
		await hideSpace(platform, A, "signed-out", daysAgo(2));
		await hideSpace(platform, A, "expired", NOW);
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toEqual({
			at: daysAgo(2).toISOString(),
			reason: "signed-out"
		});
		await unhideSpace(platform, A);
		await hideSpace(platform, A, "switched", NOW);
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toEqual({
			at: NOW.toISOString(),
			reason: "switched"
		});
	});

	it("hasUnsynced reads the records and the log", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		expect(await hasUnsynced(platform, A)).toBe(false);
		// Server changes stored here don't count; this tab's do.
		const doc = (await platform.documents.get(A, "d1")) as { version: number };
		const change = { op: "setField", target: { path: "name" }, from: null, to: "x" } as const;
		await platform.documents.commit(A, {
			docId: "d1",
			baseVersion: doc.version,
			doc: { ...doc, version: doc.version + 1 },
			entries: [{ docId: "d1", version: doc.version + 1, change, tabId: "sync", schemaVersion: 1 }]
		});
		expect(await hasUnsynced(platform, A)).toBe(false);
		await platform.documents.commit(A, {
			docId: "d1",
			baseVersion: doc.version + 1,
			doc: { ...doc, version: doc.version + 2 },
			entries: [{ docId: "d1", version: doc.version + 2, change, tabId: "t1", schemaVersion: 1 }]
		});
		expect(await hasUnsynced(platform, A)).toBe(true);

		await store(platform, B, "never", false);
		expect(await hasUnsynced(platform, B)).toBe(true);
	});

	it("tidy removes a signed-out space with nothing unsynced", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await hideSpace(platform, A, "signed-out", NOW);
		await tidySpaces(platform, "anonymous", NOW);
		expect(await platform.spaces.list()).not.toContain(A);
	});

	it("tidy keeps an unsynced signed-out space until 30 days", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1", false);
		await hideSpace(platform, A, "signed-out", new Date(NOW.getTime() - RETENTION_MS + DAY));
		await tidySpaces(platform, "anonymous", NOW);
		expect(await platform.documents.get(A, "d1")).toBeDefined();

		await tidySpaces(platform, "anonymous", new Date(NOW.getTime() + 2 * DAY));
		expect(await platform.spaces.list()).not.toContain(A);
	});

	it("tidy removes any hidden space after 30 days", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await store(platform, B, "d2", false);
		await hideSpace(platform, A, "expired", daysAgo(29));
		await hideSpace(platform, B, "switched", daysAgo(31));
		await tidySpaces(platform, "anonymous", NOW);
		// A synced, expired session is kept for its person to come back to.
		expect(await platform.documents.get(A, "d1")).toBeDefined();
		expect(await platform.spaces.list()).not.toContain(B);
	});

	it("tidy never touches the current space or anonymous", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await store(platform, "anonymous", "d2");
		await hideSpace(platform, A, "switched", daysAgo(40));
		await hideSpace(platform, "anonymous", "switched", daysAgo(40));
		await tidySpaces(platform, A, NOW);
		expect(await platform.documents.get(A, "d1")).toBeDefined();
		expect(await platform.documents.get("anonymous", "d2")).toBeDefined();
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toMatchObject({ reason: "switched" });
	});

	it("a space recreated by a late flush after sign-out is tidied, not orphaned", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await hideSpace(platform, A, "signed-out", NOW);
		await tidySpaces(platform, "anonymous", NOW);
		expect(await platform.spaces.list()).not.toContain(A);

		// Another tab stores its last edits just after: the space is back, with no hidden marker.
		await store(platform, A, "d1", false);
		await store(platform, B, "d2");
		await tidySpaces(platform, "anonymous", NOW, { identityKnown: true });
		// Unsynced: kept for 30 days, hidden, never left visible to the next person.
		expect(await platform.documents.get(A, "d1")).toBeDefined();
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toEqual({
			at: NOW.toISOString(),
			reason: "signed-out"
		});
		// Nothing unsynced: removed at once.
		expect(await platform.spaces.list()).not.toContain(B);

		await tidySpaces(platform, "anonymous", new Date(NOW.getTime() + RETENTION_MS + DAY));
		expect(await platform.spaces.list()).not.toContain(A);
	});

	it("an unknown identity never tidies an unhidden account space", async () => {
		const platform = createMemoryPlatform();
		// The person is signed in, but this tab's first identity request timed out.
		await store(platform, A, "d1");
		await tidySpaces(platform, "anonymous", NOW, { identityKnown: false });
		expect(await platform.documents.get(A, "d1")).toBeDefined();
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toBeUndefined();
		// The default is the safe one.
		await tidySpaces(platform, "anonymous", NOW);
		expect(await platform.preferences.get(A, HIDDEN_KEY)).toBeUndefined();
	});

	it("a tab opening a space while it's tidied waits until the removal is done", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await hideSpace(platform, A, "signed-out", NOW);
		const log: string[] = [];
		const tab = new AbortController();
		let holding: Promise<void> = Promise.resolve();
		// The tab asks for the space's lock just after the tidy checked it.
		const get = platform.preferences.get.bind(platform.preferences);
		platform.preferences.get = (async (space: SpaceId, key: string) => {
			if (space === A && key === HIDDEN_KEY && log.length === 0) {
				log.push("checked");
				holding = platform.locks.hold(spaceLock(A), tab.signal, () => log.push("held"), {
					shared: true
				});
			}
			return get(space, key);
		}) as typeof platform.preferences.get;
		const remove = platform.spaces.remove.bind(platform.spaces);
		platform.spaces.remove = async (space) => {
			await remove(space);
			log.push("removed");
		};
		await tidySpaces(platform, "anonymous", NOW);
		await new Promise((r) => setTimeout(r, 0));
		expect(log).toEqual(["checked", "removed", "held"]);
		tab.abort();
		await holding;
	});

	it("a space a live tab holds is never tidied", async () => {
		const platform = createMemoryPlatform();
		await store(platform, A, "d1");
		await store(platform, B, "d2");
		await store(platform, "account:c", "d3");
		await hideSpace(platform, A, "signed-out", NOW);
		await hideSpace(platform, B, "switched", daysAgo(40));
		const tab = new AbortController();
		const holds = [A, B, "account:c" as SpaceId].map((space) =>
			platform.locks.hold(spaceLock(space), tab.signal, () => {})
		);
		await tidySpaces(platform, "anonymous", NOW, { identityKnown: true });
		expect(await platform.documents.get(A, "d1")).toBeDefined();
		expect(await platform.documents.get(B, "d2")).toBeDefined();
		expect(await platform.documents.get("account:c", "d3")).toBeDefined();
		expect(await platform.preferences.get("account:c", HIDDEN_KEY)).toBeUndefined();

		tab.abort();
		await Promise.all(holds);
		await tidySpaces(platform, "anonymous", NOW, { identityKnown: true });
		expect(await platform.spaces.list()).toEqual([]);
	});
});
