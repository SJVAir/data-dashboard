import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { findExistingCopy } from "./copy";
import { MAX_DOCUMENT_CHARS, type Envelope } from "./envelope";
import { backupJson } from "./export";
import { rememberCopy } from "./fingerprints";
import { makeDoc } from "./fixtures.test-util";
import { parseIncoming } from "./incoming";
import { restoreFromEnvelope } from "./restore";

const now = new Date("2026-10-25T12:00:00Z");

async function setup() {
	const platform = createMemoryPlatform();
	const hub = createMemoryTabHub();
	const app = await initApp(platform, { channel: hub.channel(), tabId: "t1", debounceMs: 0 });
	return { platform, app };
}

/** A stored dashboard: `makeDoc`, live, with its own id and the given overrides. */
function stored(id: string, extra: Record<string, unknown> = {}): Dashboard {
	const doc: Record<string, unknown> = { ...makeDoc(1) };
	delete doc.deletedAt;
	return { ...doc, id, name: `Dashboard ${id}`, copiedFrom: "origin", ...extra } as Dashboard;
}

function backupOf(documents: unknown[], fingerprints?: Record<string, string>): Envelope {
	return {
		format: "sjvair-workspace",
		type: "backup",
		formatVersion: 1,
		exportedAt: now.toISOString(),
		documents,
		...(fingerprints ? { fingerprints } : {})
	};
}

async function store(
	app: Awaited<ReturnType<typeof setup>>["app"],
	doc: unknown,
	id: string
): Promise<void> {
	await app.platform.documents.commit(app.space, {
		docId: id,
		baseVersion: null,
		doc,
		entries: []
	});
}

describe("restoreFromEnvelope", () => {
	it("missing dashboards come back with the same id and fields", async () => {
		const { app } = await setup();
		const doc = stored("a1");
		const summary = await restoreFromEnvelope(app, backupOf([doc]));
		expect(summary).toEqual({ restored: 1, kept: 0, readOnly: 0, skipped: 0 });
		expect(await app.platform.documents.get(app.space, "a1")).toEqual(doc);
		expect(app.index.items.map((d) => d.id)).toEqual(["a1"]);
	});

	it("a dashboard already here is kept, changed or not", async () => {
		const { app } = await setup();
		const here = stored("a1", { name: "Mine now", version: 9 });
		await store(app, here, "a1");
		const summary = await restoreFromEnvelope(app, backupOf([stored("a1", { name: "Older" })]));
		expect(summary).toEqual({ restored: 0, kept: 1, readOnly: 0, skipped: 0 });
		expect(await app.platform.documents.get(app.space, "a1")).toEqual(here);
	});

	it("a dashboard in Recently deleted is undeleted, keeping the browser's version", async () => {
		const { app } = await setup();
		await store(
			app,
			stored("a1", { name: "Browser's", version: 4, deletedAt: "2026-10-20T00:00:00.000Z" }),
			"a1"
		);
		const summary = await restoreFromEnvelope(app, backupOf([stored("a1", { name: "Backup's" })]));
		expect(summary).toEqual({ restored: 1, kept: 0, readOnly: 0, skipped: 0 });
		const now = (await app.platform.documents.get(app.space, "a1")) as Dashboard;
		expect(now.name).toBe("Browser's");
		expect(now.deletedAt).toBeUndefined();
		expect(now.version).toBe(5);
		const log = await app.platform.documents.readLog(app.space, "a1", 4);
		expect(log).toHaveLength(1);
		expect(log).not.toBe("trimmed");
		expect(app.index.items.map((d) => d.id)).toEqual(["a1"]);
	});

	it("read-only documents are stored as-is", async () => {
		const { app } = await setup();
		const newer = { ...stored("n1"), schemaVersion: CURRENT_SCHEMA_VERSION + 1, extra: { a: 1 } };
		const invalid = { id: "bad1", kind: "dashboard", schemaVersion: 1, body: 5 };
		const noId = { name: "No id" };
		const huge = { ...stored("huge"), padding: "x".repeat(MAX_DOCUMENT_CHARS) };
		const summary = await restoreFromEnvelope(app, backupOf([newer, invalid, noId, huge]));
		expect(summary).toEqual({ restored: 0, kept: 0, readOnly: 2, skipped: 2 });
		expect(await app.platform.documents.get(app.space, "n1")).toEqual(newer);
		expect(await app.platform.documents.get(app.space, "bad1")).toEqual(invalid);
		expect(await app.platform.documents.get(app.space, "huge")).toBeUndefined();
	});

	it("a restored dashboard never lands in Recently deleted", async () => {
		const { app } = await setup();
		const doc = stored("a1", { deletedAt: "2026-10-20T00:00:00.000Z" });
		const summary = await restoreFromEnvelope(app, backupOf([doc]));
		expect(summary).toEqual({ restored: 1, kept: 0, readOnly: 0, skipped: 0 });
		const now = (await app.platform.documents.get(app.space, "a1")) as Dashboard;
		expect(now.deletedAt).toBeUndefined();
		expect(app.index.items.map((d) => d.id)).toEqual(["a1"]);
	});

	it("one storage error counts as skipped and the rest still restore", async () => {
		const { app } = await setup();
		const get = app.platform.documents.get.bind(app.platform.documents);
		app.platform.documents.get = async (space, id) => {
			if (id === "bad") throw new Error("storage");
			return get(space, id);
		};
		const summary = await restoreFromEnvelope(app, backupOf([stored("bad"), stored("ok")]));
		expect(summary).toEqual({ restored: 1, kept: 0, readOnly: 0, skipped: 1 });
		expect(app.index.items.map((d) => d.id)).toEqual(["ok"]);
	});

	it("refreshes the list even when the last restore fails", async () => {
		const { app } = await setup();
		const commit = app.platform.documents.commit.bind(app.platform.documents);
		app.platform.documents.commit = async (space, input) => {
			if (input.docId === "bad") throw new Error("storage");
			return commit(space, input);
		};
		await restoreFromEnvelope(app, backupOf([stored("ok"), stored("bad")]));
		expect(app.index.items.map((d) => d.id)).toEqual(["ok"]);
	});

	it("a dashboard stored by another tab meanwhile is kept, unchanged", async () => {
		const { app } = await setup();
		const theirs = stored("a1", { name: "Other tab's" });
		const get = app.platform.documents.get.bind(app.platform.documents);
		app.platform.documents.get = async (space, id) => {
			const found = await get(space, id);
			if (id === "a1" && found === undefined) await store(app, theirs, "a1");
			return found;
		};
		const summary = await restoreFromEnvelope(app, backupOf([stored("a1", { name: "Backup's" })]));
		expect(summary).toEqual({ restored: 0, kept: 1, readOnly: 0, skipped: 0 });
		expect(await app.platform.documents.get(app.space, "a1")).toEqual(theirs);
	});

	it("fingerprints are restored", async () => {
		const { app } = await setup();
		await restoreFromEnvelope(app, backupOf([stored("a1")], { a1: "fp-1", ghost: "fp-2" }));
		expect((await findExistingCopy(app, "fp-1"))?.id).toBe("a1");
	});
});

describe("backupJson", () => {
	it("leaves out deleted dashboards and includes read-only ones", async () => {
		const { app, platform } = await setup();
		const newer = { ...stored("n1"), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
		await store(app, stored("live"), "live");
		await store(app, stored("gone", { deletedAt: "2026-10-20T00:00:00.000Z" }), "gone");
		await store(app, newer, "n1");
		await rememberCopy(platform, app.space, "fp-live", "live");

		const text = await backupJson(platform, app.space, now);
		const incoming = await parseIncoming(text, now);
		if (incoming.kind !== "backup") throw new Error("expected a backup");
		const { envelope } = incoming;
		expect(envelope.exportedAt).toBe(now.toISOString());
		const ids = envelope.documents.map((d) => (d as { id: string }).id).sort();
		expect(ids).toEqual(["live", "n1"]);
		expect(envelope.documents.find((d) => (d as { id: string }).id === "n1")).toEqual(newer);
		expect(envelope.fingerprints).toEqual({ live: "fp-live" });
		expect(text).not.toContain("\n");
	});

	it("round-trips into an empty browser", async () => {
		const { app, platform } = await setup();
		await store(app, stored("live"), "live");
		const text = await backupJson(platform, app.space, now);
		const other = await setup();
		const incoming = await parseIncoming(text, now);
		if (incoming.kind !== "backup") throw new Error("expected a backup");
		expect(await restoreFromEnvelope(other.app, incoming.envelope)).toMatchObject({ restored: 1 });
	});
});
