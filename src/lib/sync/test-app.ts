/** Browser-test setup: an app in an account space over the fake server, with its sync worker. */
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import type { SyncContext } from "./context";
import { createFakeRemote, type FakeRemote } from "./remote-fake";
import { ACCOUNT, NOW, SPACE, makeDoc, storeDoc, user } from "./test-support";
import { SyncWorker } from "./worker.svelte";

/**
 * Stores `ids` as dashboards (none uploaded yet), opens the app in the account space, and gives
 * it a sync worker the test starts (`worker.start()`) and stops. `refuseSaves` queues refusals
 * for the next saves.
 */
export async function accountApp(ids: string[] = ["d1"]) {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	identity.currentSpace = async () => SPACE;
	const platform = createMemoryPlatform({ identity });
	for (const id of ids) await storeDoc(platform, makeDoc(id));
	const fake = createFakeRemote({ accountId: ACCOUNT, now: () => NOW });
	// Refusals for the next saves only (a `refuseNext` would also catch the worker's first poll).
	const refuseSaves: FakeRemote["refuseNext"] = [];
	const save = fake.save;
	fake.save = (id, input) => {
		const refusal = refuseSaves.shift();
		if (refusal) fake.refuseNext.unshift(refusal);
		return save(id, input);
	};
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	const ctx: SyncContext = {
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => NOW
	};
	const worker = new SyncWorker(ctx);
	app.sync = worker;
	return { app, fake, platform, worker, identity, refuseSaves };
}
