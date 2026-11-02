import { afterEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Identity } from "$lib/account/identity";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import type { RemoteDocuments } from "$lib/sync/remote";
import { ACCOUNT, SPACE, user } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { initApp, type AppContext } from "./app.svelte";
import { keepInSpace, watchSpace } from "./space-switch";
import { HIDDEN_KEY, hasUnsynced } from "./spaces";
import { createMemoryTabHub } from "./tab-channel";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const rename: Change = { op: "setField", target: { path: "name" }, from: null, to: "Home" };
const signedIn = (id: string): Identity => ({ state: "signed-in", user: user(id) });
const SIGNED_OUT: Identity = { state: "signed-out" };
const OTHER: SpaceId = "account:u2";

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

/**
 * One tab, remounting as main.ts does, on a fake server. `remote` lets a test hold requests up;
 * `elsewhere` is another tab's channel, which tells this one of identity changes.
 */
async function openTab(initial: Identity, remote?: (fake: FakeRemote) => RemoteDocuments) {
	const identity = createMemoryIdentity(initial);
	const platform = createMemoryPlatform({ identity });
	const fake = createFakeRemote({ accountId: ACCOUNT });
	if (initial.state !== "signed-in") fake.signedInAs = null;
	const hub = createMemoryTabHub();
	const elsewhere = hub.channel();
	let tabs = 0;
	const mounted: SpaceId[] = [];
	const open = () =>
		initApp(platform, {
			channel: hub.channel(),
			tabId: `t${++tabs}`,
			loadSync: async (ctx) => new SyncWorker({ ...ctx, remote: remote ? remote(fake) : fake })
		});
	const first = await open();
	const kept = keepInSpace(first, {
		open,
		mount: (app) => mounted.push(app.space),
		unmount: () => {}
	});
	stops.push(() => {
		kept.stop();
		void kept.app.close();
	});
	/** Another tab learned `next` (signed in or out there). */
	const learn = (next: Identity) => {
		identity.setServer(next);
		elsewhere.post({ type: "identity", identity: next, tabId: "elsewhere" });
	};
	const inSpace = (space: SpaceId) => vi.waitFor(() => expect(kept.app.space).toBe(space));
	return { identity, platform, fake, kept, mounted, learn, inSpace };
}

/** A dashboard on the server, open in this tab. */
async function synced(app: AppContext, fake: FakeRemote) {
	const id = await app.index.createBlank();
	await vi.waitFor(() => expect(fake.requests).toContain(`save ${id}`));
	await vi.waitFor(() => expect(app.sync?.states[id]?.state).toBe("synced"));
	return { id, session: (await app.sessions.get(id))! };
}

describe("account spaces", () => {
	it("signing in elsewhere switches to the account space", async () => {
		const tab = await openTab(SIGNED_OUT);
		expect(tab.kept.app.space).toBe("anonymous");
		expect(tab.kept.app.sync).toBeNull();
		tab.fake.signedInAs = ACCOUNT;

		tab.learn(signedIn(ACCOUNT));
		await tab.inSpace(SPACE);
		expect(tab.kept.app.sync).not.toBeNull();
		expect(tab.mounted).toEqual([SPACE]);
		// Nothing to hide when leaving the anonymous space.
		expect(await tab.platform.preferences.get("anonymous", HIDDEN_KEY)).toBeUndefined();
	});

	it("an expired session hides the space with its queue", async () => {
		const tab = await openTab(signedIn(ACCOUNT));
		const { id, session } = await synced(tab.kept.app, tab.fake);
		tab.fake.offline = true;
		session.apply(rename);
		await session.flush();

		tab.fake.signedInAs = null;
		tab.identity.setServer(SIGNED_OUT);
		tab.kept.app.account.recheck();
		await tab.inSpace("anonymous");

		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
			reason: "expired"
		});
		expect(await hasUnsynced(tab.platform, SPACE)).toBe(true);
		const stored = (await tab.platform.documents.get(SPACE, id)) as { name: string };
		expect(stored.name).toBe("Home");
		// The next person on this browser doesn't see it.
		expect(tab.kept.app.index.items).toEqual([]);
	});

	it("signing back in as the same person resumes and uploads", async () => {
		const tab = await openTab(signedIn(ACCOUNT));
		const { id, session } = await synced(tab.kept.app, tab.fake);
		tab.fake.offline = true;
		session.apply(rename);
		await session.flush();
		tab.fake.signedInAs = null;
		tab.learn(SIGNED_OUT);
		await tab.inSpace("anonymous");

		tab.fake.offline = false;
		tab.fake.signedInAs = ACCOUNT;
		tab.learn(signedIn(ACCOUNT));
		await tab.inSpace(SPACE);
		await vi.waitFor(async () => expect((await tab.fake.get(id)).name).toBe("Home"));
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toBeNull();
		expect(tab.kept.app.index.items.map((item) => item.id)).toEqual([id]);
		await vi.waitFor(async () => expect(await hasUnsynced(tab.platform, SPACE)).toBe(false));
	});

	it("a different account hides the first and opens its own", async () => {
		const tab = await openTab(signedIn(ACCOUNT));
		const { id } = await synced(tab.kept.app, tab.fake);
		tab.fake.signedInAs = "u2";

		tab.learn(signedIn("u2"));
		await tab.inSpace(OTHER);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
			reason: "switched"
		});
		expect(await tab.platform.documents.get(SPACE, id)).toBeDefined();
		expect(tab.kept.app.index.items).toEqual([]);
		expect(tab.mounted).toEqual([OTHER]);
	});

	it("sign-out elsewhere mid-upload keeps the queue", async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		let saving = false;
		const tab = await openTab(signedIn(ACCOUNT), (fake) => ({
			...fake,
			async save(id, input) {
				saving = true;
				await held;
				return fake.save(id, input);
			}
		}));
		const id = await tab.kept.app.index.createBlank();
		await vi.waitFor(() => expect(saving).toBe(true));

		tab.fake.signedInAs = null;
		tab.learn(SIGNED_OUT);
		await tab.inSpace("anonymous");
		release();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(await tab.platform.documents.get(SPACE, id)).toBeDefined();
		expect(await hasUnsynced(tab.platform, SPACE)).toBe(true);
		expect(await tab.platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
			reason: "expired"
		});
		expect(tab.fake.requests.filter((r) => r === `save ${id}`)).toHaveLength(1);
		await expect(tab.fake.get(id)).rejects.toThrow();
	});

	it("watchSpace hides once and stops on its own", async () => {
		const identity = createMemoryIdentity(signedIn(ACCOUNT));
		const platform = createMemoryPlatform({ identity });
		const app = await initApp(platform, {
			channel: createMemoryTabHub().channel(),
			tabId: "t1",
			loadSync: null
		});
		const onSwitch = vi.fn();
		stops.push(watchSpace(app, onSwitch));
		// The same account (a name change) isn't a switch.
		identity.accept({ state: "signed-in", user: { ...user(ACCOUNT), full_name: "New" } });
		identity.accept(SIGNED_OUT);
		identity.accept(signedIn("u2"));
		await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledTimes(1));
		expect(onSwitch).toHaveBeenCalledWith("anonymous");
		expect(await platform.preferences.get(SPACE, HIDDEN_KEY)).toMatchObject({
			reason: "expired"
		});
		await app.close();
	});
});
