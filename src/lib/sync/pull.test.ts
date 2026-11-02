import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { canonicalJson, pullInto } from "./pull";
import { SYNC_TAB } from "./types";
import { uploadDocument } from "./upload";
import {
	SPACE,
	edit,
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
