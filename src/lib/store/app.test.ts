import { afterEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { getWidgetType } from "$lib/widgets/registry";
import { LAST_OPENED_KEY, homeTarget, initApp } from "./app.svelte";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { ACCOUNT, SPACE, user } from "$lib/sync/test-support";
import { loadSyncWorker } from "$lib/sync/load";
import { HIDDEN_KEY, spaceLock } from "./spaces";
import { createMemoryTabHub } from "./tab-channel";

// The real loader would load the SDK remote; this one gives a worker on the fake server.
const server = vi.hoisted(() => ({ fake: null as FakeRemote | null }));
vi.mock("$lib/sync/load", async () => {
	const { SyncWorker } = await import("$lib/sync/worker.svelte");
	return {
		loadSyncWorker: vi.fn(
			async (ctx: ConstructorParameters<typeof SyncWorker>[0]) =>
				new SyncWorker({ ...ctx, remote: server.fake! })
		)
	};
});

afterEach(() => {
	vi.mocked(loadSyncWorker).mockClear();
	updateNotice.reason = null;
});

async function signedInApp() {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	const platform = createMemoryPlatform({ identity });
	server.fake = createFakeRemote({ accountId: ACCOUNT });
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { platform, app, fake: server.fake };
}

const rename: Change = { op: "setField", target: { path: "name" }, from: null, to: "Home" };

async function setup() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	return { platform, app };
}

describe("initApp", () => {
	it("registers the placeholder type and opens the starter when nothing is stored", async () => {
		const { app } = await setup();
		expect(getWidgetType("placeholder")).toBeDefined();
		expect(app.space).toBe("anonymous");
		expect(await homeTarget(app)).toEqual({ kind: "starter" });
		const starter = await app.sessions.get(STARTER_ID);
		expect(starter?.doc.id).toBe(STARTER_ID);
		expect(await app.sessions.get(STARTER_ID)).toBe(starter);
	});

	it("the starter's first edit replaces the current session with the stored copy", async () => {
		const { platform, app } = await setup();
		const starter = (await app.sessions.get(STARTER_ID))!;
		app.current = { session: starter, isStarter: true };
		starter.apply(rename);
		await vi.waitFor(() => expect(app.current.isStarter).toBe(false));

		const copy = app.current.session!;
		expect(copy.doc.name).toBe("Home");
		expect(await app.sessions.get(copy.doc.id)).toBe(copy);
		expect(await platform.preferences.get(app.space, LAST_OPENED_KEY)).toBe(copy.doc.id);
		await vi.waitFor(() => expect(app.index.names.get(copy.doc.id)).toBe("Home"));
		expect(await homeTarget(app)).toEqual({ kind: "dashboard", id: copy.doc.id });
		// The next visit to the starter gets a fresh one.
		expect((await app.sessions.get(STARTER_ID))?.doc.name).toBeNull();
	});

	it("opening a dashboard records it as last opened; unknown ids give null", async () => {
		const { platform, app } = await setup();
		const a = await app.index.createBlank();
		const b = await app.index.createBlank();
		expect(await app.sessions.get("missing")).toBeNull();
		await app.sessions.get(a);
		expect(await homeTarget(app)).toEqual({ kind: "dashboard", id: a });
		await app.sessions.get(b);
		expect(await platform.preferences.get(app.space, LAST_OPENED_KEY)).toBe(b);
	});

	it("the index picks up this tab's own saves", async () => {
		const { app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		session.apply(rename);
		await session.flush();
		await vi.waitFor(() => expect(app.index.names.get(id)).toBe("Home"));
	});

	it("resetAfterClear discards sessions and empties the index", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		app.current = { session, isStarter: false };
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename);
		await platform.reset.clearAll();
		const before = app.resetCount;

		await app.resetAfterClear();
		expect(app.resetCount).toBe(before + 1);
		expect(app.current).toEqual({ session: null, isStarter: false });
		expect(app.index.items).toEqual([]);
		// The discarded session saves and journals nothing.
		await session.flush();
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.list(app.space)).toEqual([]);
		// Opening again starts fresh.
		expect(await app.sessions.get(id)).toBeNull();
		expect(await homeTarget(app)).toEqual({ kind: "starter" });
	});

	it("suspendAll journals every open session and stops their saves", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename);
		app.suspendAll();
		expect(platform.journal.readAll(app.space, id)).toHaveLength(1);
		await session.flush();
		expect(commit).not.toHaveBeenCalled();
	});

	it("a session that finds data cleared elsewhere resets the app", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		app.current = { session, isStarter: false };
		const before = app.resetCount;
		await platform.reset.clearAll();
		session.apply(rename);
		await session.flush();
		await vi.waitFor(() => expect(app.resetCount).toBe(before + 1));
		expect(app.current).toEqual({ session: null, isStarter: false });
	});

	it("a session that finds newer data shows the reload notice and suspends every session", async () => {
		const { platform, app } = await setup();
		const [a, b] = [await app.index.createBlank(), await app.index.createBlank()];
		const first = (await app.sessions.get(a))!;
		const second = (await app.sessions.get(b))!;
		// A newer version of the app saved the first one.
		const doc = { ...first.doc, schemaVersion: first.doc.schemaVersion + 1, version: 1 };
		await platform.documents.commit(app.space, { docId: a, baseVersion: 0, doc, entries: [] });
		const commit = vi.spyOn(platform.documents, "commit");
		second.apply(rename);
		first.apply(rename);
		await first.flush();
		expect(updateNotice.reason).toBe("newer-data");
		await second.flush();
		// Only the first session's refused commit got through.
		expect(commit).toHaveBeenCalledTimes(1);
		expect(platform.journal.readAll(app.space, b)).toHaveLength(1);
	});

	it("the anonymous space never loads the sync code", async () => {
		const { app } = await setup();
		expect(app.space).toBe("anonymous");
		expect(app.sync).toBeNull();
		expect(loadSyncWorker).not.toHaveBeenCalled();
	});

	it("an account space opens its own space and starts syncing", async () => {
		const { app, fake } = await signedInApp();
		expect(app.space).toBe(SPACE);
		expect(loadSyncWorker).toHaveBeenCalledTimes(1);
		expect(vi.mocked(loadSyncWorker).mock.calls[0][0]).toMatchObject({
			space: SPACE,
			accountId: ACCOUNT,
			tabId: "t1",
			channel: app.channel
		});
		const id = await app.index.createBlank();
		await vi.waitFor(() => expect(fake.requests).toContain(`save ${id}`));
		await app.close();
	});

	it("a blocked build shows the update notice", async () => {
		const { app, fake } = await signedInApp();
		fake.blockedBuilds.add(vi.mocked(loadSyncWorker).mock.calls[0][0].buildId);
		await app.index.createBlank();
		await vi.waitFor(() => expect(updateNotice.reason).toBe("build-blocked"));
		expect(app.sync?.blocked).toBe(true);
		await app.close();
	});

	it("an open app holds its space's lock until it closes", async () => {
		const { platform, app } = await setup();
		expect(await platform.locks.held(spaceLock("anonymous"))).toBe(true);
		await app.close();
		expect(await platform.locks.held(spaceLock("anonymous"))).toBe(false);
	});

	it("two tabs of one space both open (the space's lock is shared)", async () => {
		const platform = createMemoryPlatform();
		const hub = createMemoryTabHub();
		const one = await initApp(platform, { channel: hub.channel(), tabId: "t1" });
		const two = await initApp(platform, { channel: hub.channel(), tabId: "t2" });
		expect(two.space).toBe("anonymous");
		await one.close();
		await two.close();
	});

	it("opening waits for a tidy removing its space before storing anything", async () => {
		const platform = createMemoryPlatform();
		const log: string[] = [];
		let release = () => {};
		// Another tab's tidy is removing this space right now.
		const tidy = platform.locks.tryRun(spaceLock("anonymous"), async () => {
			log.push("tidy");
			await new Promise<void>((resolve) => (release = resolve));
			log.push("tidied");
		});
		const opening = initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
		void opening.then(() => log.push("opened"));
		await new Promise((r) => setTimeout(r, 20));
		expect(log).toEqual(["tidy"]);
		release();
		expect(await tidy).toBe(true);
		await (await opening).close();
		expect(log).toEqual(["tidy", "tidied", "opened"]);
	});

	it("only an identity that matches the opened space hides other spaces", async () => {
		// The identity changed to another account after the space was chosen.
		const identity = createMemoryIdentity({ state: "signed-in", user: user("other") });
		identity.currentSpace = async () => SPACE;
		const platform = createMemoryPlatform({ identity });
		const orphan = "account:c" as const;
		await platform.documents.commit(orphan, {
			docId: "d3",
			baseVersion: null,
			doc: { id: "d3" },
			entries: []
		});
		const app = await initApp(platform, {
			channel: createMemoryTabHub().channel(),
			tabId: "t1",
			loadSync: null
		});
		expect(app.space).toBe(SPACE);
		expect(await platform.preferences.get(orphan, HIDDEN_KEY)).toBeUndefined();
		await app.close();
	});

	it("close still flushes the others when one dashboard fails to open", async () => {
		const { platform, app } = await setup();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		const get = platform.documents.get.bind(platform.documents);
		platform.documents.get = (space, docId) =>
			docId === "broken" ? Promise.reject(new Error("unreadable")) : get(space, docId);
		await expect(app.sessions.get("broken")).rejects.toThrow("unreadable");
		session.apply(rename);

		await app.close();
		expect(((await platform.documents.get("anonymous", id)) as { name: string }).name).toBe("Home");
		expect(app.openSessions()).toEqual([]);
	});

	it("close stores every open session's edits, then stops listening and syncing", async () => {
		const { platform, app, fake } = await signedInApp();
		const id = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		await vi.waitFor(() => expect(fake.requests).toContain(`save ${id}`));
		const worker = app.sync!;
		const stop = vi.spyOn(worker, "stop");
		session.apply(rename);

		await app.close();
		expect(stop).toHaveBeenCalled();
		expect(((await platform.documents.get(SPACE, id)) as { name: string }).name).toBe("Home");
		expect(app.openSessions()).toEqual([]);
		// The closed app no longer follows other tabs.
		const before = app.index.items.length;
		const doc = (await platform.documents.get(SPACE, id)) as Record<string, unknown>;
		await platform.documents.commit(SPACE, {
			docId: "elsewhere",
			baseVersion: null,
			doc: { ...doc, id: "elsewhere", version: 0 },
			entries: []
		});
		app.channel.post({
			type: "committed",
			space: SPACE,
			docId: "elsewhere",
			version: 0,
			tabId: "x"
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(app.index.items.length).toBe(before);
	});
});
