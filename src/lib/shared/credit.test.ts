import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { STARTER_ID } from "$lib/starter/starter";
import { initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { makeDoc } from "$lib/sync/test-support";
import { saveFields } from "$lib/sync/merge";
import { basedOn, resetBasedOn } from "./credit.svelte";

const OWNER = "owner";
let fake: FakeRemote;
let app: AppContext;

beforeEach(async () => {
	resetBasedOn();
	fake = createFakeRemote({ accountId: OWNER });
	fake.signedInAs = null;
	app = await initApp(createMemoryPlatform(), {
		channel: createMemoryTabHub().channel(),
		tabId: "t1"
	});
});

const remote = () => Promise.resolve(fake);

/** A dashboard on the server, shared by the owner. */
async function publish(id: string, name: string): Promise<void> {
	fake.signedInAs = OWNER;
	await fake.save(id, {
		...saveFields({ ...makeDoc(id), name }),
		baseVersion: null,
		changes: [],
		accountId: OWNER,
		buildId: "b",
		snapshot: null
	});
	await fake.share(id);
	fake.signedInAs = null;
}

describe("basedOn", () => {
	it("a duplicate of a stored dashboard uses its name with no request", async () => {
		const id = await app.index.createBlank();
		const credit = await basedOn(app, id, remote);
		expect(credit).toEqual({ name: app.index.names.get(id), displayName: null });
		expect(fake.requests).toEqual([]);
	});

	it("a copy of a shared dashboard shows its name and display name", async () => {
		await publish("s1", "Class");
		fake.signedInAs = OWNER;
		await fake.setProfile("Ms. Lee");
		fake.signedInAs = null;
		expect(await basedOn(app, "s1", remote)).toEqual({ name: "Class", displayName: "Ms. Lee" });
	});

	it("a source that's private again, gone, or unreachable shows nothing", async () => {
		await publish("s1", "Class");
		fake.signedInAs = OWNER;
		await fake.unshare("s1");
		fake.signedInAs = null;
		expect(await basedOn(app, "s1", remote)).toBeNull();
		expect(await basedOn(app, "unknown", remote)).toBeNull();
		await publish("s2", "Other");
		fake.offline = true;
		expect(await basedOn(app, "s2", remote)).toBeNull();
	});

	it("the starter is never looked up", async () => {
		expect(await basedOn(app, STARTER_ID, remote)).toBeNull();
		expect(await basedOn(app, undefined, remote)).toBeNull();
		expect(fake.requests).toEqual([]);
	});

	it("each id is asked once per page load", async () => {
		await publish("s1", "Class");
		fake.requests.length = 0;
		await basedOn(app, "s1", remote);
		await basedOn(app, "s1", remote);
		await basedOn(app, "gone", remote);
		await basedOn(app, "gone", remote);
		expect(fake.requests).toEqual(["credit s1", "credit gone"]);
	});
});
