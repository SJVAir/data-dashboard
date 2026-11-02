import { afterEach, describe, expect, test } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Dashboard } from "$lib/documents/schema";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import type { Platform } from "$lib/platform/types";
import { COPY_FINGERPRINTS_KEY, copiesOf, rememberCopy } from "$lib/sharing/fingerprints";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub, type TabMessage } from "$lib/store/tab-channel";
import type { SyncContext } from "./context";
import { MOVE_OFFER_KEY, answerMoveOffer, moveOffer } from "./move-to-account";
import { createFakeRemote, type FakeRemote } from "./remote-fake";
import { ACCOUNT, SPACE, makeDoc, user } from "./test-support";
import { SyncWorker } from "./worker.svelte";

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
});

const deleted = (doc: Dashboard): Dashboard => ({ ...doc, deletedAt: "2026-11-01T12:00:00.000Z" });

const deleteDoc: Change = {
	op: "setField",
	target: { path: "deletedAt" },
	from: null,
	to: "2026-11-02T11:00:00.000Z"
};

async function storeAnonymous(platform: Platform, doc: Dashboard): Promise<void> {
	await platform.documents.commit("anonymous", {
		docId: doc.id,
		baseVersion: null,
		doc,
		entries: []
	});
}

/** A signed-in app in the account space, with a sync worker on a fake server. */
async function signedIn(
	platform: Platform,
	fake: FakeRemote = createFakeRemote({ accountId: ACCOUNT })
) {
	const app = await initApp(platform, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	expect(app.space).toBe(SPACE);
	const ctx: SyncContext = {
		platform,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => new Date()
	};
	const worker = new SyncWorker(ctx);
	workers.push(worker);
	app.sync = worker;
	worker.start();
	return { app, fake, worker };
}

function platformSignedIn(): Platform {
	return createMemoryPlatform({
		identity: createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) })
	});
}

const ids = (docs: unknown[]) => docs.map((d) => (d as Dashboard).id).sort();

describe("moveOffer", () => {
	test("asks once per account", async () => {
		const platform = platformSignedIn();
		await storeAnonymous(platform, makeDoc("a1"));
		await storeAnonymous(platform, makeDoc("a2"));
		await storeAnonymous(platform, deleted(makeDoc("a3")));
		const { app } = await signedIn(platform);

		expect(await moveOffer(platform, SPACE)).toEqual({ ids: ["a1", "a2", "a3"], shown: 2 });
		// Asked again until answered (a dismissed question is asked next time).
		expect(await moveOffer(platform, SPACE)).not.toBeNull();
		await answerMoveOffer(app, "no");
		expect(await moveOffer(platform, SPACE)).toBeNull();
		// Another account on this browser is asked for itself.
		expect(await moveOffer(platform, "account:u2")).toEqual({
			ids: ["a1", "a2", "a3"],
			shown: 2
		});
	});

	test("never asks with no anonymous dashboards", async () => {
		const platform = platformSignedIn();
		await signedIn(platform);
		expect(await moveOffer(platform, SPACE)).toBeNull();
		// Only Recently deleted: nothing to count in the question.
		await storeAnonymous(platform, deleted(makeDoc("a1")));
		expect(await moveOffer(platform, SPACE)).toBeNull();
		// Nothing stored, so a dashboard made later is still offered.
		expect(await platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBeUndefined();
	});
});

describe("answerMoveOffer", () => {
	test("yes moves them with the same ids and uploads them", async () => {
		const platform = platformSignedIn();
		await storeAnonymous(platform, makeDoc("a1"));
		await storeAnonymous(platform, deleted(makeDoc("a2")));
		await rememberCopy(platform, "anonymous", "fp-a1", "a1");
		await rememberCopy(platform, "anonymous", "fp-other", "kept");
		// A pending change journaled as the anonymous tab went away moves with its dashboard.
		platform.journal.write("anonymous", "a1", "old-tab", { pending: true });
		const { app, fake, worker } = await signedIn(platform);

		await answerMoveOffer(app, "yes");

		expect(await platform.documents.list("anonymous")).toEqual([]);
		expect(ids(await platform.documents.list(SPACE))).toEqual(["a1", "a2"]);
		expect(platform.journal.list(SPACE)).toEqual([
			{ docId: "a1", tabId: "old-tab", record: { pending: true } }
		]);
		expect(await copiesOf(platform, SPACE, "fp-a1")).toEqual(["a1"]);
		expect(await platform.preferences.get("anonymous", COPY_FINGERPRINTS_KEY)).toEqual({
			"fp-other": ["kept"]
		});
		expect(app.index.items.map((d) => d.id)).toEqual(["a1"]);
		expect(app.index.deleted.map((d) => d.id)).toEqual(["a2"]);
		expect((await fake.get("a1")).deletedAt).toBeNull();
		expect((await fake.get("a2")).deletedAt).not.toBeNull();
		expect(await worker.unsyncedCount()).toBe(0);
		expect(await platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBe("yes");
		expect(await moveOffer(platform, SPACE)).toBeNull();
	});

	test("yes tells the other tabs in the account to refresh their lists", async () => {
		const platform = platformSignedIn();
		await storeAnonymous(platform, makeDoc("a1"));
		const { app } = await signedIn(platform);
		const seen: TabMessage[] = [];
		app.channel.subscribe((msg) => seen.push(msg));

		await answerMoveOffer(app, "yes");

		expect(seen).toContainEqual({ type: "sync", space: SPACE, docId: null, tabId: "t1" });
	});

	test("reports journal records the move left behind", async () => {
		const platform = platformSignedIn();
		await storeAnonymous(platform, makeDoc("a1"));
		platform.journal.write("anonymous", "a1", "old-tab", { pending: true });
		// As when the browser refuses the journal write (quota): the record stays where it was.
		const move = platform.spaces.move.bind(platform.spaces);
		platform.spaces.move = async (from, to, moved) => {
			await move(from, to, moved);
			platform.journal.write(from, "a1", "old-tab", { pending: true });
		};
		const reports: unknown[] = [];
		platform.errors.report = (_error, context) => void reports.push(context);
		const { app } = await signedIn(platform);

		await answerMoveOffer(app, "yes");

		expect(ids(await platform.documents.list(SPACE))).toEqual(["a1"]);
		expect(reports).toEqual([{ operation: "move-to-account", count: 1 }]);
	});

	test("no leaves them signed-out", async () => {
		const platform = platformSignedIn();
		await storeAnonymous(platform, makeDoc("a1"));
		await rememberCopy(platform, "anonymous", "fp-a1", "a1");
		const { app, fake } = await signedIn(platform);

		await answerMoveOffer(app, "no");

		expect(ids(await platform.documents.list("anonymous"))).toEqual(["a1"]);
		expect(await platform.documents.list(SPACE)).toEqual([]);
		expect(await copiesOf(platform, "anonymous", "fp-a1")).toEqual(["a1"]);
		expect(fake.requests.filter((r) => r.startsWith("save"))).toEqual([]);
		expect(await platform.preferences.get(SPACE, MOVE_OFFER_KEY)).toBe("no");
	});

	test("over the limit, the rest stay on this device", { timeout: 20_000 }, async () => {
		const platform = platformSignedIn();
		const all = Array.from({ length: 60 }, (_, i) => `a${String(i).padStart(2, "0")}`);
		for (const id of all) await storeAnonymous(platform, makeDoc(id));
		const fake = createFakeRemote({ accountId: ACCOUNT });
		fake.maxDocuments = 50;
		const { app, worker } = await signedIn(platform, fake);

		await answerMoveOffer(app, "yes");

		const onServer = async () => (await fake.list()).documents;
		expect(await onServer()).toHaveLength(50);
		await expect.poll(() => Object.keys(worker.states).length).toBe(60);
		const refused = () =>
			Object.entries(worker.states)
				.filter(([, s]) => s.hold?.kind === "refused")
				.map(([id, s]) => [id, s.hold]);
		expect(refused()).toHaveLength(10);
		for (const [, hold] of refused()) {
			expect(hold).toEqual({ kind: "refused", code: "limit_documents" });
		}
		// Every dashboard stays in the account space on this browser.
		expect(await platform.documents.list(SPACE)).toHaveLength(60);

		// Deleting one makes room; the next commit in the space retries the held ones.
		const first = (await app.sessions.get("a00"))!;
		first.apply(deleteDoc);
		await first.flush();
		await expect
			.poll(async () => (await fake.get("a00")).deletedAt, { timeout: 5_000 })
			.not.toBeNull();
		// The delete's own commit may have retried them before the server had it: commit again.
		const other = (await app.sessions.get("a01"))!;
		other.apply({
			op: "setField",
			target: { widgetId: "a", path: "title" },
			from: null,
			to: "Room made"
		});
		await other.flush();
		await expect.poll(() => refused().length, { timeout: 8_000 }).toBe(9);
		expect(await onServer()).toHaveLength(51);
		expect((await onServer()).filter((d) => d.deletedAt === null)).toHaveLength(50);
	});
});
