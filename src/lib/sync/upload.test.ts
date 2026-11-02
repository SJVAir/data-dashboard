import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "$lib/zod";
import type { Change } from "$lib/changes/types";
import { migrations } from "$lib/documents/load";
import type { RefusalCode } from "./remote";
import { RemoteRefusal, RemoteUnavailable } from "./remote";
import { SYNC_TAB, type SyncHold } from "./types";
import { MAX_SAVE_CHANGES_CHARS } from "./local";
import { uploadDocument } from "./upload";
import {
	NOW,
	SPACE,
	edit,
	makeDoc,
	move,
	otherDevice,
	setupSync,
	storeDoc,
	stored,
	title,
	titles,
	user,
	widget
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

/** A created dashboard, synced at server version 1. */
async function synced() {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	setup.fake.requests.length = 0;
	return setup;
}

describe("uploadDocument", () => {
	it("a new dashboard is created with its body", async () => {
		const { platform, fake, ctx, posted } = await setupSync();
		await storeDoc(platform);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["save d1"]);
		const server = await fake.get("d1");
		expect(server.version).toBe(1);
		expect(server.body).toEqual(makeDoc().body);
		expect(await platform.sync.get(SPACE, "d1")).toEqual({
			docId: "d1",
			serverVersion: 1,
			syncedThrough: 0,
			confirmedAt: NOW.toISOString(),
			inFlight: null,
			hold: null
		});
		expect(posted).toContainEqual({ type: "sync", space: SPACE, docId: "d1", tabId: ctx.tabId });
	});

	it("unsynced changes upload on the server base", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One"), title("b", "Two")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["save d1"]);
		const answer = await fake.changes("d1", 1);
		expect(answer).toMatchObject({
			version: 2,
			changes: [
				{ version: 2, schemaVersion: 1, change: title("a", "One") },
				{ version: 2, schemaVersion: 1, change: title("b", "Two") }
			]
		});
		const record = await platform.sync.get(SPACE, "d1");
		expect(record).toMatchObject({ serverVersion: 2, syncedThrough: 2, inFlight: null });
	});

	it("nothing unsynced makes no request", async () => {
		const { fake, ctx } = await synced();
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
		expect(fake.requests).toEqual([]);
	});

	it("a save whose answer was lost counts as saved", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		let lose = true;
		ctx.remote = {
			...fake,
			async save(id, input) {
				const answer = await fake.save(id, input);
				if (!lose) return answer;
				lose = false;
				throw new RemoteUnavailable();
			}
		};
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		expect((await platform.sync.get(SPACE, "d1"))?.inFlight).not.toBeNull();
		fake.requests.length = 0;

		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests.length).toBeLessThanOrEqual(1);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: 1,
			inFlight: null,
			hold: null
		});
		const answer = await fake.changes("d1", 0);
		expect(answer).toMatchObject({ version: 2 });
		const changes = "changes" in answer ? answer.changes : null;
		expect(changes?.map((c) => c.change)).toEqual([title("a", "One")]);
	});

	it("a lost save's edits made afterwards still upload", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		let lose = true;
		ctx.remote = {
			...fake,
			async save(id, input) {
				const answer = await fake.save(id, input);
				if (!lose) return answer;
				lose = false;
				throw new RemoteUnavailable();
			}
		};
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		await edit(platform, [title("b", "Two")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		const server = await fake.get("d1");
		expect(server.version).toBe(3);
		expect(titles({ ...makeDoc(), body: server.body as never })).toEqual(["One", "Two"]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 3,
			syncedThrough: 2,
			hold: null
		});
	});

	it("a create whose answer was lost counts as saved", async () => {
		const { platform, fake, ctx } = await setupSync();
		await storeDoc(platform);
		let lose = true;
		ctx.remote = {
			...fake,
			async save(id, input) {
				const answer = await fake.save(id, input);
				if (!lose) return answer;
				lose = false;
				throw new RemoteUnavailable();
			}
		};
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		fake.requests.length = 0;
		// A second create by the same owner is a stale base whose document matches ours.
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["save d1"]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 1,
			syncedThrough: 0,
			inFlight: null,
			hold: null
		});

		// Edits made after a lost create follow it.
		lose = true;
		await storeDoc(platform, makeDoc("d2"));
		expect(await uploadDocument(ctx, "d2")).toBe("retry");
		await edit(platform, [title("a", "Later")], "d2");
		expect(await uploadDocument(ctx, "d2")).toBe("saved");
		const server = await fake.get("d2");
		expect(server.version).toBe(2);
		expect(titles({ ...makeDoc(), body: server.body as never })).toEqual(["Later", null]);
		expect(await platform.sync.get(SPACE, "d2")).toMatchObject({
			serverVersion: 2,
			syncedThrough: 1,
			hold: null
		});
	});

	it("a lost create counts as saved when the server returns its keys in another order", async () => {
		const { platform, fake, ctx } = await setupSync();
		// Widget options keep the order their keys came in (the rest is rebuilt by the schema).
		const options = { first: 1, second: 2 };
		await storeDoc(platform, { ...makeDoc(), body: { widgets: [{ ...widget("a"), options }] } });
		let lose = true;
		ctx.remote = {
			...fake,
			async save(id, input) {
				let answer;
				try {
					answer = await fake.save(id, input);
				} catch (error) {
					// The stale base's document as the server's JSON might hold it.
					if (error instanceof RemoteRefusal && error.staleBase) {
						const { document } = error.staleBase;
						error.staleBase = {
							...error.staleBase,
							document: { ...document, body: reverseKeys(document.body) }
						};
					}
					throw error;
				}
				if (!lose) return answer;
				lose = false;
				throw new RemoteUnavailable();
			}
		};
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		// An edit after the lost create: recognized as ours, the create isn't held as a conflict.
		await edit(platform, [title("a", "Later")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: 1,
			hold: null
		});
	});

	it("a stale base merges and saves on top", async () => {
		const { platform, fake, ctx } = await synced();
		await otherDevice(fake, [title("a", "Theirs")]);
		await edit(platform, [title("b", "Mine")]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["save d1", "save d1"]);
		const server = await fake.get("d1");
		expect(server.version).toBe(3);
		expect(titles({ ...makeDoc(), body: server.body as never })).toEqual(["Theirs", "Mine"]);
		const local = await stored(platform);
		expect(titles(local)).toEqual(["Theirs", "Mine"]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 3,
			syncedThrough: local.version,
			hold: null,
			inFlight: null
		});
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.map((e) => e.tabId)).toEqual(["tab-1", SYNC_TAB]);
	});

	it("a stale base that overlaps holds a conflict and saves nothing", async () => {
		const { platform, fake, ctx } = await synced();
		await otherDevice(fake, [title("a", "Theirs")]);
		await edit(platform, [title("a", "Mine")]);
		expect(await uploadDocument(ctx, "d1")).toBe("held");
		expect(fake.requests).toEqual(["save d1"]);
		expect((await fake.get("d1")).version).toBe(2);
		expect(titles(await stored(platform))).toEqual(["Mine", null]);
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toEqual({
			kind: "conflict",
			serverVersion: 2,
			reason: "overlap"
		});
		// Held: nothing more is sent until it's settled.
		fake.requests.length = 0;
		expect(await uploadDocument(ctx, "d1")).toBe("held");
		expect(fake.requests).toEqual([]);
	});

	it("layout-only edits on two devices never hold", async () => {
		const { platform, fake, ctx } = await synced();
		const a = { x: 0, y: 0, w: 6, h: 4 };
		await otherDevice(fake, [move("a", a, { x: 0, y: 4, w: 6, h: 4 })]);
		await edit(platform, [move("a", a, { x: 0, y: 8, w: 6, h: 4 })]);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		const record = await platform.sync.get(SPACE, "d1");
		expect(record?.hold).toBeNull();
		expect(record?.serverVersion).toBe(3);
		expect((await stored(platform)).body.widgets[0].rect.y).toBe(8);
	});

	const refusals: Array<[RefusalCode, number, string, SyncHold["kind"] | null]> = [
		["account_mismatch", 403, "signed-out", null],
		["unauthorized", 401, "signed-out", null],
		["gone", 410, "held", "gone"],
		["schema_downgrade", 409, "held", "newer"],
		["build_blocked", 409, "blocked", null],
		["too_large", 413, "held", "refused"],
		["limit_documents", 403, "held", "refused"],
		["limit_storage", 403, "held", "refused"],
		["invalid", 400, "held", "refused"],
		["rate_limited", 429, "retry", null],
		["forbidden", 403, "retry", null],
		["unknown", 503, "retry", null]
	];

	it("each refusal sets its hold or result", async () => {
		for (const [code, status, result, hold] of refusals) {
			const { platform, fake, ctx, identity } = await synced();
			await edit(platform, [title("a", "One")]);
			const checks = identity.requests;
			fake.refuseNext.push({ code, status });
			expect(await uploadDocument(ctx, "d1"), code).toBe(result);
			const record = await platform.sync.get(SPACE, "d1");
			expect(record?.hold?.kind ?? null, code).toBe(hold);
			if (hold === "refused") expect(record?.hold, code).toEqual({ kind: "refused", code });
			if (hold === "newer") expect(record?.hold, code).toEqual({ kind: "newer", schemaVersion: 1 });
			if (result === "retry") expect(record?.inFlight, code).not.toBeNull();
			if (result === "signed-out") expect(identity.requests, code).toBe(checks + 2);
			// Nothing local is lost, and the server is untouched.
			expect(record?.syncedThrough, code).toBe(0);
			expect((await fake.get("d1")).version, code).toBe(1);
		}
	});

	it("an unknown server error (503) retries and never holds", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		fake.refuseNext.push({ code: "unknown", status: 503 });
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toBeNull();
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
	});

	it("a refused hold is retried, and clears once saved", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		fake.refuseNext.push({ code: "limit_documents", status: 403 });
		expect(await uploadDocument(ctx, "d1")).toBe("held");
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toBeNull();
	});

	it("offline keeps everything and returns retry", async () => {
		const { platform, fake, ctx } = await synced();
		await edit(platform, [title("a", "One")]);
		fake.offline = true;
		expect(await uploadDocument(ctx, "d1")).toBe("retry");
		const record = await platform.sync.get(SPACE, "d1");
		expect(record).toMatchObject({ serverVersion: 1, syncedThrough: 0, hold: null });
		expect(record?.inFlight).toMatchObject({ baseVersion: 1, throughVersion: 1 });
		expect(titles(await stored(platform))).toEqual(["One", null]);
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log !== "trimmed" && log.length).toBe(1);
		fake.offline = false;
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
	});

	it("an oversized queue sends one replaceDocument", async () => {
		const { platform, fake, ctx } = await synced();
		const changes: Change[] = [];
		let previous: string | null = null;
		for (let i = 0, size = 0; size <= MAX_SAVE_CHANGES_CHARS; i++) {
			const next = (i % 2 ? "x" : "y").repeat(100);
			changes.push(title("a", next, previous));
			size += JSON.stringify(changes[i]).length + 1;
			previous = next;
		}
		await edit(platform, changes);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(fake.requests).toEqual(["get d1", "save d1"]);
		const answer = await fake.changes("d1", 1);
		const sent = "changes" in answer ? answer.changes : null;
		expect(sent?.map((c) => (c.change as Change).op)).toEqual(["replaceDocument"]);
		const server = await fake.get("d1");
		expect(server.body).toEqual((await stored(platform)).body);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({
			serverVersion: 2,
			syncedThrough: changes.length
		});
	});

	it("an account change before the batch stops it", async () => {
		const { platform, fake, ctx, identity } = await synced();
		await edit(platform, [title("a", "One")]);
		identity.setServer({ state: "signed-in", user: user("u2") });
		expect(await uploadDocument(ctx, "d1")).toBe("signed-out");
		expect(fake.requests).toEqual([]);
		identity.setServer({ state: "signed-out" });
		expect(await uploadDocument(ctx, "d1")).toBe("signed-out");
		expect(fake.requests).toEqual([]);
		expect((await platform.sync.get(SPACE, "d1"))?.inFlight).toBeNull();
	});

	describe("format upgrades", () => {
		afterEach(() => {
			migrations.length = 0;
		});

		it("an upgraded but unedited document isn't pushed", async () => {
			const { platform, fake, ctx } = await setupSync();
			migrations.push({
				from: 0,
				to: 1,
				schema: z.unknown(),
				migrate: (raw) => ({ ...(raw as object), schemaVersion: 1 }),
				migrateChange: (change) => change
			});
			await storeDoc(platform, { ...makeDoc(), schemaVersion: 0 as 1 });
			await platform.sync.put(SPACE, {
				docId: "d1",
				serverVersion: 1,
				syncedThrough: 0,
				confirmedAt: NOW.toISOString(),
				inFlight: null,
				hold: null
			});
			expect(await uploadDocument(ctx, "d1")).toBe("nothing");
			expect(fake.requests).toEqual([]);
		});
	});
});

/** `value` with every object's keys in reverse order, as a server's JSON might hold them. */
function reverseKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reverseKeys);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.reverse()
			.map(([k, v]) => [k, reverseKeys(v)])
	);
}
