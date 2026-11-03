import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryActivity, type MemoryActivity } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { withLocalEcho, type TabChannel } from "$lib/store/tab-channel";
import type { SyncContext } from "./context";
import { uploadDocument } from "./upload";
import { SyncWorker } from "./worker.svelte";
import {
	SPACE,
	edit,
	makeDoc,
	otherDevice,
	setupSync,
	storeDoc,
	stored,
	title,
	titles
} from "./test-support";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

type Setup = Awaited<ReturnType<typeof setupSync>>;
type Tab = { ctx: SyncContext; channel: TabChannel; activity: MemoryActivity; worker: SyncWorker };

const workers: SyncWorker[] = [];
const sessions: DocumentSession[] = [];

afterEach(() => {
	for (const w of workers.splice(0)) w.stop();
	for (const s of sessions.splice(0)) s.dispose();
	vi.useRealTimers();
});

/** A tab of the same browser: shared storage and locks, its own visibility and channel. */
function tab(setup: Setup, tabId: string, controller?: AbortController): Tab {
	const activity = createMemoryActivity();
	const channel = withLocalEcho(setup.hub.channel());
	const ctx: SyncContext = {
		...setup.ctx,
		platform: { ...setup.platform, activity },
		channel,
		tabId
	};
	const worker = new SyncWorker(ctx, controller);
	workers.push(worker);
	return { ctx, channel, activity, worker };
}

/** Lets promise chains (storage, locks, the fake server) run without moving the clock. */
async function settle() {
	for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

const saves = (setup: Setup, id = "d1") => setup.fake.requests.filter((r) => r === `save ${id}`);
const polls = (setup: Setup) => setup.fake.requests.filter((r) => r.startsWith("list"));

/** A tab's session committing an edit: stored, then `committed` on the tab's channel. */
async function commitIn(setup: Setup, t: Tab, label: string) {
	const doc = await edit(setup.platform, [title("a", label)], "d1", t.ctx.tabId);
	t.channel.post({
		type: "committed",
		space: SPACE,
		docId: "d1",
		version: doc.version,
		tabId: t.ctx.tabId
	});
}

/** A synced dashboard and one started tab, with fake timers. */
async function started() {
	const setup = await setupSync();
	await storeDoc(setup.platform);
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	vi.useFakeTimers({
		toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
	});
	const t = tab(setup, "tab-1");
	t.worker.start();
	await settle();
	setup.fake.requests.length = 0;
	return { setup, t };
}

describe("SyncWorker", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("edits upload at most every 2 seconds", async () => {
		const { setup, t } = await started();
		await commitIn(setup, t, "One");
		await settle();
		expect(saves(setup)).toHaveLength(1);

		for (const label of ["Two", "Three", "Four"]) {
			await vi.advanceTimersByTimeAsync(500);
			await commitIn(setup, t, label);
			await settle();
		}
		expect(saves(setup)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(500);
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect((await setup.fake.get("d1")).body).toEqual((await stored(setup.platform)).body);

		await vi.advanceTimersByTimeAsync(10_000);
		await settle();
		expect(saves(setup)).toHaveLength(2);
	});

	it("ignores commits from other tabs and from sync", async () => {
		const { setup, t } = await started();
		const doc = await edit(setup.platform, [title("a", "Elsewhere")], "d1", "tab-2");
		for (const tabId of ["tab-2", "sync"]) {
			t.channel.post({ type: "committed", space: SPACE, docId: "d1", version: doc.version, tabId });
		}
		await settle();
		await vi.advanceTimersByTimeAsync(5_000);
		await settle();
		expect(saves(setup)).toHaveLength(0);
	});

	it("hiding the tab uploads at once", async () => {
		const { setup, t } = await started();
		await commitIn(setup, t, "One");
		await settle();
		await commitIn(setup, t, "Two");
		await settle();
		expect(saves(setup)).toHaveLength(1);

		t.activity.setVisible(false);
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect(titles(await stored(setup.platform))).toEqual(["Two", null]);
		expect((await setup.fake.get("d1")).body).toEqual((await stored(setup.platform)).body);
	});

	it("in a hidden tab, a commit made during an upload uploads as soon as it ends", async () => {
		const { setup, t } = await started();
		t.activity.setVisible(false);
		await settle();
		let release = () => {};
		const save = setup.fake.save;
		setup.fake.save = async (id, input) => {
			await new Promise<void>((resolve) => (release = resolve));
			setup.fake.save = save;
			return save(id, input);
		};
		await commitIn(setup, t, "One");
		await settle();
		// Asked for while the first is running: it goes when that ends, not after the throttle.
		await commitIn(setup, t, "Two");
		await settle();
		release();
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect(titles({ ...makeDoc(), body: (await setup.fake.get("d1")).body as never })).toEqual([
			"Two",
			null
		]);
	});

	it("a dashboard moved to a new id uploads under it at once", async () => {
		const { setup, t } = await started();
		await storeDoc(setup.platform, makeDoc("d2"));
		setup.fake.ownerOf("d2", "someone-else");
		t.channel.post({ type: "committed", space: SPACE, docId: "d2", version: 0, tabId: "tab-1" });
		await settle();
		const record = await setup.platform.sync.get(SPACE, "d2");
		const to = record?.hold?.kind === "moved" ? record.hold.to : "";
		expect(to).not.toBe("");
		// Not at the next sweep or poll: now.
		expect(saves(setup, to)).toHaveLength(1);
		expect((await setup.fake.get(to)).copiedFrom).toBe("d2");
	});

	it("coming online retries", async () => {
		const { setup, t } = await started();
		setup.fake.offline = true;
		setup.platform.online.setOnline(false);
		await commitIn(setup, t, "One");
		await settle();
		expect(saves(setup)).toHaveLength(1);
		expect(t.worker.offline).toBe(true);
		expect(t.worker.states.d1?.state).toBe("pending");

		setup.fake.offline = false;
		setup.platform.online.setOnline(true);
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect(t.worker.offline).toBe(false);
		expect(await t.worker.unsyncedCount()).toBe(0);
		expect(t.worker.states.d1).toMatchObject({ state: "synced", onServer: true, hold: null });
	});

	it("a failed save retries on the backoff timer", async () => {
		const { setup, t } = await started();
		setup.fake.offline = true;
		await commitIn(setup, t, "One");
		await settle();
		expect(saves(setup)).toHaveLength(1);
		setup.fake.offline = false;
		await vi.advanceTimersByTimeAsync(999);
		await settle();
		expect(saves(setup)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect(await t.worker.unsyncedCount()).toBe(0);
	});

	it("a blocked build stops uploading", async () => {
		const { setup, t } = await started();
		setup.fake.blockedBuilds.add(setup.ctx.buildId);
		await commitIn(setup, t, "One");
		await settle();
		expect(t.worker.blocked).toBe(true);
		await commitIn(setup, t, "Two");
		await settle();
		await vi.advanceTimersByTimeAsync(120_000);
		await settle();
		expect(saves(setup)).toHaveLength(1);
	});

	it("a commit made after hiding uploads at once", async () => {
		const { setup, t } = await started();
		await commitIn(setup, t, "One");
		await settle();
		expect(saves(setup)).toHaveLength(1);

		t.activity.setVisible(false);
		await settle();
		// The session's commit as the tab hid, well within 2 s of the last save.
		await vi.advanceTimersByTimeAsync(100);
		await commitIn(setup, t, "Two");
		await settle();
		expect(saves(setup)).toHaveLength(2);
		expect((await setup.fake.get("d1")).body).toEqual((await stored(setup.platform)).body);
	});

	it("edits while offline don't shorten the backoff", async () => {
		const { setup, t } = await started();
		setup.fake.offline = true;
		// Fail three times: the next retry waits 15 s.
		await commitIn(setup, t, "One");
		await settle();
		await vi.advanceTimersByTimeAsync(1_000);
		await settle();
		await vi.advanceTimersByTimeAsync(2_000);
		await settle();
		await vi.advanceTimersByTimeAsync(5_000);
		await settle();
		expect(saves(setup)).toHaveLength(4);

		for (let i = 0; i < 5; i++) {
			await vi.advanceTimersByTimeAsync(2_000);
			await commitIn(setup, t, `Edit ${i}`);
			await settle();
		}
		expect(saves(setup)).toHaveLength(4);
		await vi.advanceTimersByTimeAsync(5_000);
		await settle();
		expect(saves(setup)).toHaveLength(5);

		// Hiding the tab still uploads at once.
		await commitIn(setup, t, "Hidden");
		t.activity.setVisible(false);
		await settle();
		expect(saves(setup)).toHaveLength(6);
	});

	it("after signed-out the worker makes no requests", async () => {
		const { setup, t } = await started();
		setup.fake.signedInAs = null;
		await commitIn(setup, t, "One");
		await settle();
		expect(t.worker.signedOut).toBe(true);

		setup.fake.requests.length = 0;
		await commitIn(setup, t, "Two");
		setup.platform.online.setOnline(false);
		setup.platform.online.setOnline(true);
		await settle();
		await vi.advanceTimersByTimeAsync(180_000);
		await settle();
		expect(setup.fake.requests).toEqual([]);
	});

	it("a hidden tab never polls", async () => {
		const setup = await setupSync();
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
		});
		const t = tab(setup, "tab-1");
		t.activity.setVisible(false);
		t.worker.start();
		await settle();
		await vi.advanceTimersByTimeAsync(180_000);
		await settle();
		expect(polls(setup)).toEqual([]);

		// Becoming visible polls at once.
		t.activity.setVisible(true);
		await settle();
		expect(polls(setup)).toHaveLength(1);
	});

	it("three tabs make one poll request per interval", async () => {
		const setup = await setupSync();
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
		});
		const tabs = ["tab-1", "tab-2", "tab-3"].map((id) => tab(setup, id));
		for (const t of tabs) t.worker.start();
		await settle();
		// Every tab polls once as it starts.
		expect(polls(setup)).toHaveLength(3);

		setup.fake.requests.length = 0;
		await vi.advanceTimersByTimeAsync(60_000);
		await settle();
		expect(polls(setup)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_000);
		await settle();
		expect(polls(setup)).toHaveLength(2);

		// The poller is hidden: another visible tab takes over at once.
		const leader = tabs.find((t) => t.worker.polling)!;
		expect(tabs.filter((t) => t.worker.polling)).toHaveLength(1);
		setup.fake.requests.length = 0;
		leader.activity.setVisible(false);
		await settle();
		expect(polls(setup)).toHaveLength(1);
		expect(leader.worker.polling).toBe(false);
		expect(tabs.filter((t) => t.worker.polling)).toHaveLength(1);
	});

	it("two tabs uploading the same document make one save", async () => {
		const setup = await setupSync();
		await storeDoc(setup.platform);
		const [one, two] = [tab(setup, "tab-1"), tab(setup, "tab-2")];
		one.worker.start();
		two.worker.start();
		await vi.waitFor(async () => expect(await one.worker.unsyncedCount()).toBe(0));
		await edit(setup.platform, [title("a", "Mine")]);
		setup.fake.requests.length = 0;

		const left = await Promise.all([one.worker.syncAll(), two.worker.syncAll()]);
		expect(left).toEqual([0, 0]);
		expect(saves(setup)).toHaveLength(1);
	});

	it("the poller pulls a newer version and uploads the backlog", async () => {
		const setup = await setupSync();
		await storeDoc(setup.platform);
		await storeDoc(setup.platform, makeDoc("d2"));
		expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
		await otherDevice(setup.fake, [title("a", "Theirs")]);
		const t = tab(setup, "tab-1");
		t.worker.start();
		await vi.waitFor(async () => expect(await t.worker.unsyncedCount()).toBe(0));
		expect(titles(await stored(setup.platform))).toEqual(["Theirs", null]);
		expect((await setup.fake.get("d2")).version).toBe(1);
		await vi.waitFor(() =>
			expect(t.worker.states).toEqual({
				d1: expect.objectContaining({ state: "synced", onServer: true }),
				d2: expect.objectContaining({ state: "synced", onServer: true })
			})
		);
	});

	it("states carry the share token", async () => {
		const setup = await setupSync();
		await storeDoc(setup.platform);
		await storeDoc(setup.platform, makeDoc("d2"));
		const t = tab(setup, "tab-1");
		t.worker.start();
		await vi.waitFor(async () => expect(await t.worker.unsyncedCount()).toBe(0));

		const result = await t.worker.share("d1");
		const token = result.kind === "shared" ? result.token : null;
		expect(token).toEqual(expect.any(String));
		await vi.waitFor(() =>
			expect(t.worker.states).toEqual({
				d1: expect.objectContaining({ state: "synced", shareToken: token }),
				d2: expect.objectContaining({ state: "synced", shareToken: null })
			})
		);

		await t.worker.unshare("d1");
		await vi.waitFor(() =>
			expect(t.worker.states.d1).toEqual(expect.objectContaining({ shareToken: null }))
		);
	});

	it("reads and sets the display name", async () => {
		const setup = await setupSync();
		const t = tab(setup, "tab-1");
		expect(await t.worker.displayName()).toBeNull();
		expect(await t.worker.setDisplayName("  Ms. Rivera's class ")).toBe("Ms. Rivera's class");
		expect(await t.worker.displayName()).toBe("Ms. Rivera's class");
		await expect(t.worker.setDisplayName("x".repeat(61))).rejects.toMatchObject({
			code: "invalid"
		});
		expect(await t.worker.setDisplayName(null)).toBeNull();
	});

	it("a session in the worker's own tab catches up after a pull", async () => {
		const setup = await setupSync();
		await storeDoc(setup.platform);
		expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
		const t = tab(setup, "tab-1");
		const session = await DocumentSession.open(setup.platform, SPACE, "d1", "tab-1", {
			channel: t.channel
		});
		sessions.push(session!);
		await otherDevice(setup.fake, [title("a", "Theirs")]);

		t.worker.start();
		await vi.waitFor(() => expect(titles(session!.doc)).toEqual(["Theirs", null]));
	});

	it("stop aborts and releases the poll lock", async () => {
		const setup = await setupSync();
		vi.useFakeTimers({
			toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
		});
		const controller = new AbortController();
		const first = tab(setup, "tab-1", controller);
		first.worker.start();
		await settle();
		expect(first.worker.polling).toBe(true);
		const second = tab(setup, "tab-2");
		second.worker.start();
		await settle();
		expect(second.worker.polling).toBe(false);

		setup.fake.requests.length = 0;
		first.worker.stop();
		expect(controller.signal.aborted).toBe(true);
		await settle();
		expect(second.worker.polling).toBe(true);
		expect(polls(setup)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_000);
		await settle();
		expect(polls(setup)).toHaveLength(2);
	});

	it("the worker's recovery calls run under the document lock", async () => {
		const setup = await setupSync();
		await storeDoc(setup.platform);
		expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
		await edit(setup.platform, [title("a", "Mine")]);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const remote = {
			...setup.fake,
			keepSnapshot: async (...args: Parameters<typeof setup.fake.keepSnapshot>) => {
				await gate;
				return setup.fake.keepSnapshot(...args);
			}
		};
		const t = tab({ ...setup, ctx: { ...setup.ctx, remote } }, "tab-1");
		setup.fake.requests.length = 0;
		const keeping = t.worker.keepBeforeRestore("d1");
		await settle();
		const uploading = uploadDocument(setup.ctx, "d1");
		await settle();
		expect(saves(setup)).toHaveLength(0);
		release();
		expect(await keeping).toBe("kept");
		expect(await uploading).toBe("saved");
		expect(saves(setup)).toHaveLength(1);
		expect((await t.worker.versions("d1")).filter((s) => s.reason === "conflict")).toHaveLength(1);
		const [meta] = await t.worker.versions("d1");
		expect((await t.worker.version("d1", meta.id)).id).toBe(meta.id);
	});
});
