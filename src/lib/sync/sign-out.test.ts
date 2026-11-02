import { afterEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Identity } from "$lib/account/identity";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import { initApp, type AppContext } from "$lib/store/app.svelte";
import { keepInSpace } from "$lib/store/space-switch";
import { HIDDEN_KEY, hasUnsynced } from "$lib/store/spaces";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { createFakeRemote, type FakeRemote } from "./remote-fake";
import { beginSignOut, finishThenSignOut, signOutAnyway } from "./sign-out";
import { ACCOUNT, SPACE, user } from "./test-support";
import { SyncWorker } from "./worker.svelte";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const rename: Change = { op: "setField", target: { path: "name" }, from: null, to: "Home" };
const signedIn = (id: string): Identity => ({ state: "signed-in", user: user(id) });

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/** One signed-in tab, remounting as main.ts does, on a fake server. */
async function openTab() {
	const identity = createMemoryIdentity(signedIn(ACCOUNT));
	const platform = createMemoryPlatform({ identity });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const hub = createMemoryTabHub();
	const elsewhere = hub.channel();
	let tabs = 0;
	const open = () =>
		initApp(platform, {
			channel: hub.channel(),
			tabId: `t${++tabs}`,
			loadSync: async (ctx) => new SyncWorker({ ...ctx, remote: fake })
		});
	const kept = keepInSpace(await open(), { open, mount: () => {}, unmount: () => {} });
	stops.push(() => {
		kept.stop();
		void kept.app.close();
	});
	/** Another tab learned `next` (signed in there). */
	const learn = (next: Identity) => {
		identity.setServer(next);
		elsewhere.post({ type: "identity", identity: next, tabId: "elsewhere" });
	};
	const inSpace = (space: SpaceId) => vi.waitFor(() => expect(kept.app.space).toBe(space));
	return { identity, platform, fake, kept, learn, inSpace };
}

/** A dashboard on the server, open in this tab. */
async function synced(app: AppContext, fake: FakeRemote) {
	const id = await app.index.createBlank();
	await vi.waitFor(() => expect(fake.requests).toContain(`save ${id}`));
	await vi.waitFor(() => expect(app.sync?.states[id]?.state).toBe("synced"));
	return { id, session: (await app.sessions.get(id))! };
}

/** A synced dashboard renamed while the server can't be reached (the edit not yet stored). */
async function unsynced(tab: Awaited<ReturnType<typeof openTab>>) {
	const { id, session } = await synced(tab.kept.app, tab.fake);
	tab.fake.offline = true;
	session.apply(rename);
	return id;
}

describe("signing out", () => {
	it("fully synced: signs out and the space is removed", async () => {
		const tab = await openTab();
		await synced(tab.kept.app, tab.fake);

		expect(await beginSignOut(tab.kept.app)).toEqual({ done: true });
		await tab.inSpace("anonymous");
		expect(tab.identity.current().state).toBe("signed-out");
		await vi.waitFor(async () => expect(await tab.platform.spaces.list()).not.toContain(SPACE));
		expect(tab.kept.app.index.items).toEqual([]);
	});

	it("unsynced: the dialog shows the count", async () => {
		const tab = await openTab();
		await unsynced(tab);
		const app = tab.kept.app;
		await app.index.createBlank();

		// The pending edit is stored first, so it counts.
		expect(await beginSignOut(app)).toEqual({ unsynced: 2 });
		expect(tab.identity.current().state).toBe("signed-in");
		expect(app.space).toBe(SPACE);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeUndefined();
	});

	it("finish saving signs out once everything is up", async () => {
		const tab = await openTab();
		const id = await unsynced(tab);
		expect(await beginSignOut(tab.kept.app)).toEqual({ unsynced: 1 });

		tab.fake.offline = false;
		expect(await finishThenSignOut(tab.kept.app)).toBe(true);
		expect((await tab.fake.get(id)).name).toBe("Home");
		await tab.inSpace("anonymous");
		await vi.waitFor(async () => expect(await tab.platform.spaces.list()).not.toContain(SPACE));
	});

	it("finish saving offline stays signed in and says so", async () => {
		const tab = await openTab();
		const id = await unsynced(tab);
		expect(await beginSignOut(tab.kept.app)).toEqual({ unsynced: 1 });

		expect(await finishThenSignOut(tab.kept.app)).toBe(false);
		expect(tab.identity.current().state).toBe("signed-in");
		expect(tab.kept.app.space).toBe(SPACE);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeUndefined();
		expect(((await tab.platform.documents.get(SPACE, id)) as { name: string }).name).toBe("Home");
	});

	it("sign out anyway hides the space; the next person sees the anonymous space", async () => {
		const tab = await openTab();
		const id = await unsynced(tab);

		await signOutAnyway(tab.kept.app);
		await tab.inSpace("anonymous");
		expect(tab.identity.current().state).toBe("signed-out");
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
			reason: "signed-out"
		});
		expect(((await tab.platform.documents.get(SPACE, id)) as { name: string }).name).toBe("Home");
		expect(await hasUnsynced(tab.platform, SPACE)).toBe(true);
		expect(tab.kept.app.index.items).toEqual([]);
		expect(await tab.kept.app.sessions.get(id)).toBeNull();
	});

	it("signing back in finishes the upload", async () => {
		const tab = await openTab();
		const id = await unsynced(tab);
		await signOutAnyway(tab.kept.app);
		await tab.inSpace("anonymous");

		tab.fake.offline = false;
		tab.learn(signedIn(ACCOUNT));
		await tab.inSpace(SPACE);
		await vi.waitFor(async () => expect((await tab.fake.get(id)).name).toBe("Home"));
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeNull();
		expect(tab.kept.app.index.items.map((item) => item.id)).toEqual([id]);
		await vi.waitFor(async () => expect(await hasUnsynced(tab.platform, SPACE)).toBe(false));
	});

	it("a failed sign-out leaves the space in use", async () => {
		const tab = await openTab();
		await synced(tab.kept.app, tab.fake);
		tab.identity.setSignOutResult(false);

		await beginSignOut(tab.kept.app);
		expect(tab.identity.current().state).toBe("signed-in");
		expect(tab.kept.app.space).toBe(SPACE);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeNull();

		tab.identity.setSignOutResult(true);
		const id = await unsynced(tab);
		expect(await beginSignOut(tab.kept.app)).toEqual({ unsynced: 1 });
		tab.identity.setSignOutResult(false);
		await signOutAnyway(tab.kept.app);
		expect(tab.kept.app.space).toBe(SPACE);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeNull();
		expect(await tab.platform.documents.get(SPACE, id)).toBeDefined();
	});
});
