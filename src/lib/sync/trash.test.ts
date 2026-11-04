import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { report } from "$lib/safety/report";
import { pollList } from "./pull";
import { RemoteUnavailable } from "./remote";
import { deletePermanently } from "./trash";
import { uploadDocument } from "./upload";
import {
	ACCOUNT,
	SPACE,
	edit,
	otherDevice,
	setupSync,
	storeDoc,
	stored,
	user
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const trash: Change = {
	op: "setField",
	target: { path: "deletedAt" },
	from: null,
	to: "2026-11-02T11:00:00.000Z"
};
const restore: Change = { ...trash, from: "2026-11-02T11:00:00.000Z", to: null };

/** A dashboard synced at server version 1, then trashed and synced at version 2. */
async function trashed() {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	await edit(setup.platform, [trash]);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	setup.fake.requests.length = 0;
	return setup;
}

describe("deletePermanently", () => {
	it("a trashed dashboard is purged on the server", async () => {
		const { ctx, fake } = await trashed();
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
		expect(fake.requests).toContain("delete d1");
		await expect(fake.get("d1")).rejects.toMatchObject({ code: "gone" });
	});

	it("a dashboard never uploaded is deleted with no request", async () => {
		const { ctx, fake, platform } = await setupSync();
		await storeDoc(platform);
		await edit(platform, [trash]);
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
		expect(fake.requests).toEqual([]);
	});

	it("a first create whose answer was lost is still purged on the server", async () => {
		const { ctx, fake, platform } = await setupSync();
		await storeDoc(platform);
		await edit(platform, [trash]);
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
		const record = (await platform.sync.get(SPACE, "d1"))!;
		expect(record.serverVersion).toBeNull();
		expect(record.inFlight).not.toBeNull();
		fake.requests.length = 0;
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
		expect(fake.requests).toContain("delete d1");
		await expect(fake.get("d1")).rejects.toMatchObject({ code: "gone" });
	});

	it("a failed pull after a not_deleted answer is reported when it isn't a remote failure", async () => {
		const { ctx, fake } = await trashed();
		fake.refuseNext.push({ code: "not_deleted", status: 409 });
		const boom = new Error("boom");
		ctx.remote = {
			...fake,
			async changes() {
				throw boom;
			}
		};
		expect(await deletePermanently(ctx, "d1")).toBe("restored-elsewhere");
		expect(report).toHaveBeenCalledWith(boom, { operation: "sync-delete" });
	});

	it("an unsynced delete uploads, then purges", async () => {
		const { ctx, fake, platform } = await setupSync();
		await storeDoc(platform);
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		fake.offline = true;
		await edit(platform, [trash]);
		fake.offline = false;
		fake.requests.length = 0;
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
		expect(fake.requests).toEqual(["save d1", "delete d1"]);
		await expect(fake.get("d1")).rejects.toMatchObject({ code: "gone" });
	});

	it("a dashboard restored elsewhere is not deleted", async () => {
		const { ctx, fake, platform } = await trashed();
		await otherDevice(fake, [restore]);
		expect(await deletePermanently(ctx, "d1")).toBe("restored-elsewhere");
		expect((await fake.get("d1")).deletedAt).toBeNull();
		expect((await stored(platform)).deletedAt).toBeUndefined();
	});

	it("a restore between the upload and the delete is not deleted", async () => {
		const { ctx, fake, platform } = await trashed();
		// The first request after the upload's nothing-to-save is the DELETE.
		fake.refuseNext.push({ code: "not_deleted", status: 409 });
		expect(await deletePermanently(ctx, "d1")).toBe("restored-elsewhere");
		expect((await stored(platform)).deletedAt).toBeDefined();
		expect((await fake.get("d1")).deletedAt).not.toBeNull();
	});

	it("a held dashboard is not saved and not deleted", async () => {
		const { ctx, fake, platform } = await trashed();
		const record = (await platform.sync.get(SPACE, "d1"))!;
		await platform.sync.put(SPACE, {
			...record,
			hold: { kind: "conflict", serverVersion: 3, reason: "overlap" }
		});
		expect(await deletePermanently(ctx, "d1")).toBe("not-saved");
		expect(fake.requests).not.toContain("delete d1");
	});

	it("already purged counts as deleted", async () => {
		const { ctx, fake } = await trashed();
		fake.purge("d1");
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
	});

	/** Replaces the stored copy with one `mangle` changes, as a newer or damaged one would be. */
	async function mangled(mangle: (doc: Record<string, unknown>) => void) {
		const setup = await trashed();
		const doc = { ...(await stored(setup.platform)) } as Record<string, unknown>;
		mangle(doc);
		await setup.platform.documents.commit(SPACE, {
			docId: "d1",
			baseVersion: doc.version as number,
			doc: { ...doc, version: (doc.version as number) + 1 } as never,
			entries: []
		});
		return setup;
	}

	it("a copy this device can't read is unreadable, not unreachable", async () => {
		const { ctx, fake } = await mangled((doc) => delete doc.schemaVersion);
		expect(await deletePermanently(ctx, "d1")).toBe("unreadable");
		expect(fake.requests).not.toContain("delete d1");
	});

	it("a copy from a newer version of the app is newer, not unreachable", async () => {
		const { ctx } = await mangled((doc) => (doc.schemaVersion = 999));
		expect(await deletePermanently(ctx, "d1")).toBe("newer");
	});

	it("offline is unreachable and changes nothing", async () => {
		const { ctx, fake, platform } = await trashed();
		fake.offline = true;
		expect(await deletePermanently(ctx, "d1")).toBe("unreachable");
		fake.offline = false;
		expect((await stored(platform)).deletedAt).toBeDefined();
		expect((await fake.get("d1")).deletedAt).not.toBeNull();
	});

	it("an unknown refusal is unreachable", async () => {
		const { ctx, fake } = await trashed();
		fake.refuseNext.push({ code: "rate_limited", status: 429 });
		expect(await deletePermanently(ctx, "d1")).toBe("unreachable");
	});

	it("another device drops a purged dashboard quietly", async () => {
		const { ctx } = await trashed();
		const second = createMemoryPlatform({
			identity: createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) })
		});
		const ctx2 = { ...ctx, platform: second, tabId: "second" };
		await pollList(ctx2);
		expect(await second.documents.get(SPACE, "d1")).toBeDefined();
		expect(await deletePermanently(ctx, "d1")).toBe("deleted");
		await pollList(ctx2);
		expect(await second.documents.get(SPACE, "d1")).toBeUndefined();
	});
});
