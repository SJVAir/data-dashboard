import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Dashboard } from "$lib/documents/schema";
import { pullInto } from "./pull";
import { RemoteRefusal, RemoteUnavailable } from "./remote";
import { resolveHold } from "./resolve";
import { uploadDocument } from "./upload";
import {
	SPACE,
	edit,
	makeDoc,
	otherDevice,
	serverSince,
	setupSync,
	storeDoc,
	stored,
	title,
	titles,
	widget
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const DELETED_AT = "2026-11-02T11:00:00.000Z";

const removeB: Change = {
	op: "removeWidget",
	target: { widgetId: "b" },
	widget: widget("b", { x: 6, y: 0, w: 6, h: 4 }),
	index: 1
};

const deleteDoc: Change = {
	op: "setField",
	target: { path: "deletedAt" },
	from: null,
	to: DELETED_AT
};

/** A synced dashboard with `mine` here and `theirs` on the server, pulled into a hold. */
async function held(mine: Change[], theirs: Change[]) {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	await edit(setup.platform, mine);
	await otherDevice(setup.fake, theirs);
	expect(await pullInto(setup.ctx, "d1", await serverSince(setup.fake, 1))).toBe("held");
	setup.fake.requests.length = 0;
	return setup;
}

/** A synced dashboard with unsynced `mine`, purged on the server and held as gone. */
async function purged(mine: Change[]) {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	await edit(setup.platform, mine);
	setup.fake.purge("d1");
	expect(await uploadDocument(setup.ctx, "d1")).toBe("held");
	expect((await setup.platform.sync.get(SPACE, "d1"))?.hold).toEqual({ kind: "gone" });
	setup.fake.requests.length = 0;
	return setup;
}

const serverTitles = async (setup: Awaited<ReturnType<typeof setupSync>>, id = "d1") =>
	titles({ ...makeDoc(), body: (await setup.fake.get(id)).body as Dashboard["body"] });

describe("resolveHold", () => {
	it("keep mine saves over theirs and keeps theirs as a snapshot", async () => {
		const setup = await held(
			[title("a", "Mine"), title("b", "Mine too")],
			[title("a", "Theirs"), removeB]
		);
		const { platform, fake, ctx } = setup;
		expect(await resolveHold(ctx, "d1", "keep-mine")).toBeNull();

		// Their delete of the widget I changed is undone, so my change to it stands.
		expect(await serverTitles(setup)).toEqual(["Mine", "Mine too"]);
		expect((await fake.get("d1")).version).toBe(3);
		const snapshots = fake.snapshots("d1").filter((s) => s.reason === "conflict");
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({ version: 2, reason: "conflict" });
		expect((snapshots[0].body as Dashboard["body"]).widgets.map((w) => w.title)).toEqual([
			"Theirs"
		]);
		expect(titles(await stored(platform))).toEqual(["Mine", "Mine too"]);
		const record = await platform.sync.get(SPACE, "d1");
		expect(record).toMatchObject({ serverVersion: 3, hold: null, inFlight: null });
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
	});

	it.each(["keep-mine", "use-other", "save-copy"] as const)(
		"%s fails for a server version in a newer format, and holds it as newer",
		async (choice) => {
			const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
			const { platform, fake, ctx, posted } = setup;
			// A newer build saved it after the conflict was held.
			await otherDevice(fake, [title("b", "Newer")], "d1", { schemaVersion: 2 });

			await expect(resolveHold(ctx, "d1", choice)).rejects.toThrow(/newer format/);
			expect(fake.requests.filter((r) => !r.startsWith("changes") && !r.startsWith("get"))).toEqual(
				[]
			);
			expect(await platform.documents.list(SPACE)).toHaveLength(1);
			const record = await platform.sync.get(SPACE, "d1");
			expect(record?.hold).toEqual({ kind: "newer", schemaVersion: 2 });
			// Still unsynced: the queue stays.
			expect(titles(await stored(platform))).toEqual(["Mine", null]);
			expect(posted).toContainEqual(expect.objectContaining({ type: "sync", docId: "d1" }));
		}
	);

	it("use the other keeps mine as a snapshot", async () => {
		const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
		const { platform, fake, ctx } = setup;
		expect(await resolveHold(ctx, "d1", "use-other")).toBeNull();

		expect(fake.requests).toContain("keepSnapshot d1");
		expect(fake.requests.filter((r) => r === "save d1")).toHaveLength(0);
		const snapshots = fake.snapshots("d1").filter((s) => s.reason === "conflict");
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({ version: 2, reason: "conflict" });
		expect((snapshots[0].body as Dashboard["body"]).widgets.map((w) => w.title)).toEqual([
			"Mine",
			null
		]);
		expect(titles(await stored(platform))).toEqual(["Theirs", null]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ serverVersion: 2, hold: null });
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
	});

	it("use the other merges again when the server moved meanwhile", async () => {
		const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
		const { platform, fake, ctx } = setup;
		// Another device saves after this one fetched the server's changes.
		const keepSnapshot = fake.keepSnapshot.bind(fake);
		fake.keepSnapshot = async (id, input) => {
			fake.keepSnapshot = keepSnapshot;
			await otherDevice(fake, [title("a", "Theirs again")]);
			return keepSnapshot(id, input);
		};
		expect(await resolveHold(ctx, "d1", "use-other")).toBeNull();
		// Still an overlap: asked again, on the newer version.
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toMatchObject({
			kind: "conflict",
			serverVersion: 3
		});
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(0);
		expect(titles(await stored(platform))).toEqual(["Mine", null]);
	});

	it("edits a tab commits while a choice is settled stay unsynced on top", async () => {
		const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
		const { platform, fake, ctx } = setup;
		const keepSnapshot = fake.keepSnapshot.bind(fake);
		fake.keepSnapshot = async (id, input) => {
			await edit(platform, [title("b", "Late")]);
			return keepSnapshot(id, input);
		};
		expect(await resolveHold(ctx, "d1", "use-other")).toBeNull();
		expect(titles(await stored(platform))).toEqual(["Theirs", "Late"]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ serverVersion: 2, hold: null });
		expect(await uploadDocument(ctx, "d1")).toBe("saved");
		expect(await serverTitles(setup)).toEqual(["Theirs", "Late"]);
	});

	it("save as a copy uploads a new dashboard and takes theirs here", async () => {
		const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
		const { platform, fake, ctx } = setup;
		const copyId = await resolveHold(ctx, "d1", "save-copy");
		expect(copyId).toEqual(expect.any(String));
		expect(copyId).not.toBe("d1");

		const copy = await stored(platform, copyId!);
		expect(copy).toMatchObject({ id: copyId, copiedFrom: "d1", version: 0 });
		expect(titles(copy)).toEqual(["Mine", null]);
		expect(await platform.sync.get(SPACE, copyId!)).toBeUndefined();
		expect(titles(await stored(platform))).toEqual(["Theirs", null]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ serverVersion: 2, hold: null });
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(0);

		expect(await uploadDocument(ctx, copyId!)).toBe("saved");
		expect((await fake.get(copyId!)).copiedFrom).toBe("d1");
		expect(await serverTitles(setup, copyId!)).toEqual(["Mine", null]);
		expect(await uploadDocument(ctx, "d1")).toBe("nothing");
	});

	it("restore after a delete elsewhere", async () => {
		const setup = await held([title("a", "Mine")], [deleteDoc]);
		const { platform, fake, ctx } = setup;
		expect((await platform.sync.get(SPACE, "d1"))?.hold?.kind).toBe("deleted-elsewhere");
		expect(await resolveHold(ctx, "d1", "restore")).toBeNull();

		const server = await fake.get("d1");
		expect(server).toMatchObject({ version: 3, deletedAt: null });
		expect(await serverTitles(setup)).toEqual(["Mine", null]);
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(0);
		const local = await stored(platform);
		expect(local.deletedAt).toBeUndefined();
		expect(titles(local)).toEqual(["Mine", null]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ serverVersion: 3, hold: null });
	});

	it("discard after a delete elsewhere takes the deleted version", async () => {
		const setup = await held([title("a", "Mine")], [deleteDoc]);
		const { platform, fake, ctx } = setup;
		expect(await resolveHold(ctx, "d1", "discard")).toBeNull();
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(1);
		const local = await stored(platform);
		expect(local.deletedAt).toBe(DELETED_AT);
		expect(titles(local)).toEqual([null, null]);
		expect(await platform.sync.get(SPACE, "d1")).toMatchObject({ serverVersion: 2, hold: null });
	});

	it("discard after a purge removes it", async () => {
		const { platform, fake, ctx } = await purged([title("a", "Mine")]);
		expect(await resolveHold(ctx, "d1", "discard")).toBeNull();
		expect(await platform.documents.get(SPACE, "d1")).toBeUndefined();
		expect(await platform.sync.get(SPACE, "d1")).toBeUndefined();
		expect(fake.requests).toEqual([]);
	});

	it("keep as new never reuses the purged id", async () => {
		const setup = await purged([title("a", "Mine")]);
		const { platform, fake, ctx, posted } = setup;
		const newId = await resolveHold(ctx, "d1", "keep-as-new");
		expect(newId).toEqual(expect.any(String));
		expect(newId).not.toBe("d1");
		expect(await platform.documents.get(SPACE, "d1")).toBeUndefined();
		expect(posted).toContainEqual(
			expect.objectContaining({ type: "moved", from: "d1", to: newId })
		);

		const copy = await stored(platform, newId!);
		expect(copy).toMatchObject({ copiedFrom: "d1" });
		expect(titles(copy)).toEqual(["Mine", null]);
		expect(await uploadDocument(ctx, newId!)).toBe("saved");
		expect(await serverTitles(setup, newId!)).toEqual(["Mine", null]);
		expect(fake.requests.filter((r) => r === "save d1")).toHaveLength(0);
	});

	it("a refusal mid-choice keeps the hold", async () => {
		const setup = await held([title("a", "Mine")], [title("a", "Theirs")]);
		const { platform, fake, ctx } = setup;
		const hold = (await platform.sync.get(SPACE, "d1"))?.hold;
		const before = await stored(platform);

		fake.refuseNext.push({ code: "limit_storage", status: 403 });
		await expect(resolveHold(ctx, "d1", "use-other")).rejects.toThrow();
		fake.offline = true;
		await expect(resolveHold(ctx, "d1", "keep-mine")).rejects.toBeInstanceOf(RemoteUnavailable);
		fake.offline = false;
		// The save itself is refused, after the server's changes were fetched.
		const save = fake.save.bind(fake);
		fake.save = () => Promise.reject(new RemoteRefusal("too_large", 413));
		await expect(resolveHold(ctx, "d1", "keep-mine")).rejects.toBeInstanceOf(RemoteRefusal);
		expect(fake.requests).toContain("changes d1 1");
		fake.save = save;

		expect((await platform.sync.get(SPACE, "d1"))?.hold).toEqual(hold);
		expect(await stored(platform)).toEqual(before);
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toHaveLength(0);
		// A choice that doesn't fit the hold is refused too.
		await expect(resolveHold(ctx, "d1", "keep-as-new")).rejects.toThrow();
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toEqual(hold);
	});
});
