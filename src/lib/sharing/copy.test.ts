import { describe, expect, it } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { findExistingCopy, saveCopy } from "./copy";
import { fingerprintOf, forgetDocument, rememberCopy, copiesOf } from "./fingerprints";
import { documentFileJson } from "./export";
import { makeDoc } from "./fixtures.test-util";
import { parseIncoming } from "./incoming";

const now = new Date("2026-10-25T12:00:00Z");

async function incomingOf(doc: Dashboard) {
	const result = await parseIncoming(documentFileJson(doc, now), now);
	if (result.kind !== "document") throw new Error("expected a document");
	return result;
}

async function setup() {
	const platform = createMemoryPlatform();
	const hub = createMemoryTabHub();
	const app = await initApp(platform, { channel: hub.channel(), tabId: "t1" });
	return { platform, hub, app };
}

async function markDeleted(app: AppContext, id: string, at: string) {
	const doc = (await app.platform.documents.get(app.space, id)) as Dashboard;
	await app.platform.documents.commit(app.space, {
		docId: id,
		baseVersion: doc.version,
		doc: { ...doc, version: doc.version + 1, deletedAt: at, updatedAt: at },
		entries: []
	});
}

describe("copies", () => {
	it("saveCopy stores a new dashboard that findExistingCopy then finds", async () => {
		const { app } = await setup();
		const incoming = await incomingOf(makeDoc());
		expect(await findExistingCopy(app, incoming.fingerprint)).toBeNull();

		const id = await saveCopy(app, incoming);
		expect(id).not.toBe(incoming.sourceId);
		const stored = (await app.platform.documents.get(app.space, id)) as Dashboard;
		expect(stored).toMatchObject({
			id,
			copiedFrom: "src-1",
			version: 0,
			name: "Fresno schools"
		});
		expect(stored.deletedAt).toBeUndefined();
		expect(stored.body).toEqual(incoming.doc.body);
		expect((await findExistingCopy(app, incoming.fingerprint))?.id).toBe(id);
	});

	it("doesn't find a deleted copy", async () => {
		const { app } = await setup();
		const incoming = await incomingOf(makeDoc());
		const id = await saveCopy(app, incoming);
		await markDeleted(app, id, "2026-10-26T00:00:00.000Z");
		await app.index.refresh();
		expect(await findExistingCopy(app, incoming.fingerprint)).toBeNull();
	});

	it("finds the most recently updated of several live copies", async () => {
		const { app } = await setup();
		const incoming = await incomingOf(makeDoc());
		const first = await saveCopy(app, incoming);
		const second = await saveCopy(app, incoming);
		const stored = (await app.platform.documents.get(app.space, first)) as Dashboard;
		await app.platform.documents.commit(app.space, {
			docId: first,
			baseVersion: stored.version,
			doc: { ...stored, version: 1, updatedAt: "2099-01-01T00:00:00.000Z" },
			entries: []
		});
		expect((await findExistingCopy(app, incoming.fingerprint))?.id).toBe(first);
		expect(second).not.toBe(first);
	});

	it("doesn't match different content", async () => {
		const { app } = await setup();
		await saveCopy(app, await incomingOf(makeDoc(2)));
		const other = await incomingOf(makeDoc(3));
		expect(await findExistingCopy(app, other.fingerprint)).toBeNull();
	});

	it("shows the copy in another app on the same storage without a manual refresh", async () => {
		const { platform, hub, app } = await setup();
		const other = await initApp(platform, { channel: hub.channel(), tabId: "t2" });
		const id = await saveCopy(app, await incomingOf(makeDoc()));
		await expect.poll(() => other.index.items.map((d) => d.id)).toContain(id);
	});
});

describe("copy fingerprints", () => {
	it("remembers, looks up, and forgets", async () => {
		const { app } = await setup();
		const { platform, space } = app;
		await rememberCopy(platform, space, "fp", "a");
		await rememberCopy(platform, space, "fp", "a");
		await rememberCopy(platform, space, "fp", "b");
		await rememberCopy(platform, space, "other", "c");
		expect(await copiesOf(platform, space, "fp")).toEqual(["a", "b"]);
		expect(await fingerprintOf(platform, space, "c")).toBe("other");
		expect(await fingerprintOf(platform, space, "zzz")).toBeUndefined();
		await forgetDocument(platform, space, "a");
		await forgetDocument(platform, space, "c");
		expect(await copiesOf(platform, space, "fp")).toEqual(["b"]);
		expect(await copiesOf(platform, space, "other")).toEqual([]);
	});

	it("tolerates a damaged preference value", async () => {
		const { app } = await setup();
		await app.platform.preferences.set(app.space, "copyFingerprints", "junk");
		expect(await copiesOf(app.platform, app.space, "fp")).toEqual([]);
		await rememberCopy(app.platform, app.space, "fp", "a");
		expect(await copiesOf(app.platform, app.space, "fp")).toEqual(["a"]);
	});
});
