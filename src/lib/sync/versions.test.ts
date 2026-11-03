import { describe, expect, it, vi } from "vitest";
import { RemoteRefusal, RemoteUnavailable } from "./remote";
import { uploadDocument } from "./upload";
import { keepBeforeRestore, serverVersion, serverVersions } from "./versions";
import {
	SPACE,
	edit,
	otherDevice,
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
	return setup;
}

describe("serverVersions", () => {
	it("lists the server's snapshots newest first", async () => {
		const { ctx, fake } = await synced();
		await keepBeforeRestore(ctx, "d1");
		await keepBeforeRestore(ctx, "d1");
		const list = await serverVersions(ctx, "d1");
		expect(list.length).toBeGreaterThanOrEqual(2);
		const ids = list.map((s) => s.id);
		expect(ids).toEqual([...ids].sort((a, b) => b - a));
		const one = await serverVersion(ctx, "d1", ids[0]);
		expect(one.id).toBe(ids[0]);
		expect(fake.snapshots("d1").length).toBe(list.length);
	});

	it("a dashboard never uploaded has none and makes no request", async () => {
		const { ctx, fake, platform } = await setupSync();
		await storeDoc(platform);
		expect(await serverVersions(ctx, "d1")).toEqual([]);
		expect(fake.requests).toEqual([]);
	});
});

describe("keepBeforeRestore", () => {
	it("keeps the current local content, unsynced edits included", async () => {
		const { ctx, fake, platform } = await synced();
		await edit(platform, [title("a", "Mine")]);
		fake.requests.length = 0;
		expect(await keepBeforeRestore(ctx, "d1")).toBe("kept");
		const last = fake.snapshots("d1").at(-1)!;
		expect(last.reason).toBe("conflict");
		expect(last.version).toBe(1);
		expect(JSON.stringify(last.body)).toContain("Mine");
		expect((await fake.get("d1")).version).toBe(1);
	});

	it("is not-on-server for a dashboard never uploaded", async () => {
		const { ctx, fake, platform } = await setupSync();
		await storeDoc(platform);
		expect(await keepBeforeRestore(ctx, "d1")).toBe("not-on-server");
		expect(fake.requests).toEqual([]);
	});

	it("a stale base pulls, then keeps the merged content", async () => {
		const { ctx, fake, platform } = await synced();
		await edit(platform, [title("a", "Mine")]);
		await otherDevice(fake, [title("b", "Theirs")]);
		expect(await keepBeforeRestore(ctx, "d1")).toBe("kept");
		const last = fake.snapshots("d1").at(-1)!;
		const body = JSON.stringify(last.body);
		expect(body).toContain("Mine");
		expect(body).toContain("Theirs");
		expect(titles(await stored(platform))).toEqual(["Mine", "Theirs"]);
	});

	it("a stale base that conflicts holds and keeps nothing", async () => {
		const { ctx, fake, platform } = await synced();
		await edit(platform, [title("a", "Mine")]);
		await otherDevice(fake, [title("a", "Theirs")]);
		await expect(keepBeforeRestore(ctx, "d1")).rejects.toMatchObject({ code: "stale_base" });
		expect((await platform.sync.get(SPACE, "d1"))?.hold?.kind).toBe("conflict");
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toEqual([]);
	});

	it("offline throws RemoteUnavailable and keeps nothing", async () => {
		const { ctx, fake, platform } = await synced();
		await edit(platform, [title("a", "Mine")]);
		fake.offline = true;
		await expect(keepBeforeRestore(ctx, "d1")).rejects.toBeInstanceOf(RemoteUnavailable);
		fake.offline = false;
		expect(fake.snapshots("d1").filter((s) => s.reason === "conflict")).toEqual([]);
	});

	it("a purged document holds as gone", async () => {
		const { ctx, fake, platform } = await synced();
		fake.purge("d1");
		await expect(keepBeforeRestore(ctx, "d1")).rejects.toBeInstanceOf(RemoteRefusal);
		expect((await platform.sync.get(SPACE, "d1"))?.hold).toEqual({ kind: "gone" });
	});
});
