import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { RETENTION_MS } from "$lib/safety/purge";
import { saveFields } from "./merge";
import { SYNC_CURSOR_KEY, canonicalJson, fetchMissing, pollList, pullInto } from "./pull";
import type { FakeRemote } from "./remote-fake";
import { SYNC_TAB } from "./types";
import { uploadDocument } from "./upload";
import {
	SPACE,
	ACCOUNT,
	NOW,
	edit,
	makeDoc,
	otherDevice,
	serverSince,
	setupSync,
	storeDoc,
	stored,
	title,
	titles
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

async function synced() {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	setup.fake.requests.length = 0;
	return setup;
}

/** Another device creates a dashboard on the server. */
async function createdElsewhere(fake: FakeRemote, id: string, deletedAt: string | null = null) {
	await fake.save(id, {
		...saveFields({ ...makeDoc(id), name: `Made elsewhere ${id}` }),
		deletedAt,
		baseVersion: null,
		changes: [],
		accountId: ACCOUNT,
		buildId: "other-build",
		snapshot: null
	});
	fake.requests.length = 0;
}

describe("pullInto", () => {
	const sessions: DocumentSession[] = [];
	afterEach(() => {
		for (const s of sessions.splice(0)) s.dispose();
	});

	it("a newer server version fast-forwards and open tabs catch up", async () => {
		const { platform, fake, ctx, hub, posted } = await synced();
		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-1", {
			channel: hub.channel()
		});
		sessions.push(session!);
		await otherDevice(fake, [title("a", "Theirs")]);

		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("merged");
		const local = await stored(platform);
		expect(titles(local)).toEqual(["Theirs", null]);
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.map((e) => [e.tabId, e.change])).toEqual([
			[SYNC_TAB, title("a", "Theirs")]
		]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: local.version,
			hold: null
		});
		expect(posted).toContainEqual(
			expect.objectContaining({ type: "committed", docId: "d1", version: local.version })
		);
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d1", tabId: ctx.tabId });
		await vi.waitFor(() => expect(titles(session!.doc)).toEqual(["Theirs", null]));
		// Nothing of the server's is uploaded back.
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
	});

	it("server changes rebase under unsynced edits, which then upload", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("b", "Mine")]);
		await otherDevice(fake, [title("a", "Theirs")]);

		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("merged");
		expect(titles(await stored(platform))).toEqual(["Theirs", "Mine"]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: 0,
			hold: null
		});

		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["save d1"]);
		const answer = await fake.changes("d1", 2);
		expect("changes" in answer && answer.changes?.map((c) => c.change)).toEqual([
			title("b", "Mine")
		]);
	});

	it("an overlap holds and writes nothing locally", async () => {
		const { platform, fake, ctx } = await synced();
		const mine = await edit(platform, [title("a", "Mine")]);
		await otherDevice(fake, [title("a", "Theirs")]);

		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("held");
		expect(await stored(platform)).toEqual(mine);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 1,
			syncedThrough: 0,
			hold: { kind: "conflict", serverVersion: 2, reason: "overlap" }
		});
	});

	it("a log gap with no unsynced edits writes a replaceDocument entry", async () => {
		const { platform, fake, ctx } = await synced();
		await otherDevice(fake, [title("a", "Theirs")]);
		fake.trimLog("d1");
		const server = await serverSince(fake, 1);
		expect(server.changes).toBeNull();

		expect(await pullInto(ctx, "d1", server)).toBe("merged");
		const local = await stored(platform);
		expect(titles(local)).toEqual(["Theirs", null]);
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.map((e) => [e.tabId, e.change.op])).toEqual([
			[SYNC_TAB, "replaceDocument"]
		]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: local.version
		});
	});

	it("server changes that don't explain its version are written as a replaceDocument", async () => {
		const { platform, fake, ctx } = await synced();
		await otherDevice(fake, [title("a", "Theirs")]);
		const server = { ...(await serverSince(fake, 1)), changes: [] };

		expect(await pullInto(ctx, "d1", server)).toBe("merged");
		const local = await stored(platform);
		expect(titles(local)).toEqual(["Theirs", null]);
		expect(local.version).toBe(1);
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.map((e) => e.change.op)).toEqual(["replaceDocument"]);
	});

	it("a newer-format server version holds newer and keeps the queue", async () => {
		const { platform, fake, ctx } = await synced();
		const mine = await edit(platform, [title("a", "Mine")]);
		await otherDevice(fake, [title("b", "Theirs")], "d1", { schemaVersion: 2 });

		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("held");
		expect(await stored(platform)).toEqual(mine);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 1,
			syncedThrough: 0,
			hold: { kind: "newer", schemaVersion: 2 }
		});
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.map((e) => e.change)).toEqual([title("a", "Mine")]);
	});

	it("an older server version leaves everything unchanged", async () => {
		const { platform, fake, ctx } = await synced();
		await otherDevice(fake, [title("a", "Theirs")]);
		const server = await serverSince(fake, 1);
		expect(await pullInto(ctx, "d1", server)).toBe("merged");
		const before = await stored(platform);
		expect(await pullInto(ctx, "d1", server)).toBe("unchanged");
		expect(await stored(platform)).toEqual(before);
	});

	it("a pull recognizes a save whose answer was lost", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		fake.offline = true;
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		fake.offline = false;
		// The save reached the server after all (its answer was what got lost).
		const inFlight = (await platform.sync.get(SPACE, "d1"))!.inFlight!;
		await fake.save("d1", {
			name: null,
			deletedAt: null,
			copiedFrom: null,
			schemaVersion: 1,
			body: (await stored(platform)).body,
			baseVersion: 1,
			changes: JSON.parse(inFlight.changes),
			accountId: ctx.accountId,
			buildId: ctx.buildId,
			snapshot: null
		});

		expect(await pullInto(ctx, "d1", await serverSince(fake, 1))).toBe("merged");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: 1,
			inFlight: null,
			hold: null
		});
		expect(titles(await stored(platform))).toEqual(["One", null]);
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
	});

	it("compares sent changes whatever order the server keeps their keys in", () => {
		const sent = [{ schemaVersion: 1, change: { op: "setField", target: { path: "name" } } }];
		const back = [{ change: { target: { path: "name" }, op: "setField" }, schemaVersion: 1 }];
		expect(canonicalJson(back)).toBe(canonicalJson(sent));
	});
});

describe("pollList", () => {
	it("a poll pulls only the dashboards that moved and saves the cursor", async () => {
		const { platform, fake, ctx } = await synced();
		await storeDoc(platform, makeDoc("d2"));
		expect(await uploadDocument(ctx, "d2")).toBe("saved");
		await otherDevice(fake, [title("a", "Theirs")]);

		await pollList(ctx);
		expect(fake.requests).toEqual(["list", "changes d1 1"]);
		expect(titles(await stored(platform))).toEqual(["Theirs", null]);
		const cursor = await platform.preferences.get<string>(SPACE, SYNC_CURSOR_KEY);
		expect(cursor).toEqual(expect.any(String));

		fake.requests.length = 0;
		await pollList(ctx);
		expect(fake.requests).toEqual([`list ${cursor}`]);
	});

	it("a dashboard made on another device appears", async () => {
		const { platform, fake, ctx, posted } = await setupSync();
		await createdElsewhere(fake, "d2");
		const longAgo = new Date(NOW.getTime() - RETENTION_MS - 1000).toISOString();
		await createdElsewhere(fake, "d3", longAgo);

		await pollList(ctx);
		const doc = await stored(platform, "d2");
		expect(doc).toMatchObject({ id: "d2", name: "Made elsewhere d2", version: 0 });
		expect(await platform.sync.get(SPACE, "d2")).toEqual({
			docId: "d2",
			serverVersion: 1,
			syncedThrough: 0,
			confirmedAt: NOW.toISOString(),
			inFlight: null,
			hold: null
		});
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d2", tabId: ctx.tabId });
		// Deleted more than 30 days ago: purged here, so not brought back.
		expect(await platform.documents.get(SPACE, "d3")).toBeUndefined();
		// Nothing of it is uploaded back.
		expect(await uploadDocument(ctx, "d2")).toBe("nothing");
	});

	it("a purged dashboard with no unsynced changes is removed quietly", async () => {
		const { platform, fake, ctx, posted } = await synced();
		await pollList(ctx);
		fake.purge("d1");

		await pollList(ctx);
		expect(await platform.documents.get(SPACE, "d1")).toBeUndefined();
		expect(await platform.sync.get(SPACE, "d1")).toBeUndefined();
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d1", tabId: ctx.tabId });
	});

	it("a purged dashboard with unsynced changes holds gone", async () => {
		const { platform, fake, ctx } = await synced();
		await pollList(ctx);
		const mine = await edit(platform, [title("a", "Mine")]);
		fake.purge("d1");

		await pollList(ctx);
		expect(await stored(platform)).toEqual(mine);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ hold: { kind: "gone" } });
	});

	it("fetchMissing creates it, or answers false", async () => {
		const { platform, fake, ctx } = await setupSync();
		await createdElsewhere(fake, "d2");

		expect(await fetchMissing(ctx, "d2")).toBe(true);
		expect(await stored(platform, "d2")).toMatchObject({ id: "d2", version: 0 });
		expect(await platform.sync.get(SPACE, "d2")).toMatchObject({ serverVersion: 1, hold: null });
		expect(await fetchMissing(ctx, "nope")).toBe(false);
		fake.purge("d2");
		await platform.documents.remove(SPACE, "d2");
		expect(await fetchMissing(ctx, "d2")).toBe(false);
	});
});
