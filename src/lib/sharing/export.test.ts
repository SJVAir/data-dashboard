import { describe, expect, it, vi } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { MAX_DOCUMENT_CHARS, MAX_LINK_URL } from "./envelope";
import {
	backupJson,
	documentFileJson,
	rawDocumentFileJson,
	shareUrl,
	sharedDocumentOf,
	unsavedDocuments
} from "./export";
import { makeDoc, widget } from "./fixtures.test-util";
import { parseIncoming, parseLinkFragment } from "./incoming";

const now = new Date("2026-10-25T12:00:00Z");

describe("export", () => {
	it("sharedDocumentOf drops the local-only fields", () => {
		const shared = sharedDocumentOf(makeDoc());
		expect(Object.keys(shared).sort()).toEqual(["body", "id", "kind", "name", "schemaVersion"]);
	});

	it("documentFileJson is a document envelope that imports", async () => {
		const result = await parseIncoming(documentFileJson(makeDoc(), now), now);
		expect(result).toMatchObject({ kind: "document", sourceId: "src-1" });
	});

	it("shareUrl round-trips through parseLinkFragment", async () => {
		const doc = makeDoc();
		const out = await shareUrl("https://example.org/workspace/", doc, now);
		if (!("url" in out)) throw new Error("expected a url");
		expect(out.url.startsWith("https://example.org/workspace/import#")).toBe(true);
		const fragment = out.url.slice(out.url.indexOf("#") + 1);
		const result = await parseLinkFragment(fragment, now);
		if (result.kind !== "document") throw new Error("expected a document");
		expect(result.doc.name).toBe(doc.name);
		expect(result.doc.body).toEqual(doc.body);
		expect(result.sourceId).toBe(doc.id);
	});

	it("refuses a link over the cap", async () => {
		const doc = makeDoc(1);
		doc.body.widgets = Array.from({ length: 400 }, (_, i) => ({
			...makeDoc(1).body.widgets[0],
			id: `w${i}`,
			title: crypto.randomUUID()
		}));
		expect(await shareUrl("https://example.org/workspace/", doc, now)).toEqual({ tooLong: true });
		expect(MAX_LINK_URL).toBe(8000);
	});

	it("documentFileJson is compact, so a document near the limit re-imports", async () => {
		const title = "x".repeat(100);
		const sized = (count: number) => {
			const doc = makeDoc(0);
			doc.body.widgets = Array.from({ length: count }, (_, i) => widget(i, title));
			return doc;
		};
		const perWidget =
			documentFileJson(sized(2), now).length - documentFileJson(sized(1), now).length;
		const base = documentFileJson(sized(0), now).length;
		// Ids grow a digit now and then, so settle on the count by measuring.
		let count = Math.floor((MAX_DOCUMENT_CHARS - base) / perWidget);
		let json = documentFileJson(sized(count), now);
		while (json.length >= MAX_DOCUMENT_CHARS) {
			count -= Math.ceil((json.length - MAX_DOCUMENT_CHARS + 1) / (perWidget + 4));
			json = documentFileJson(sized(count), now);
		}
		expect(json.length).toBeLessThan(MAX_DOCUMENT_CHARS);
		expect(json.length).toBeGreaterThan(MAX_DOCUMENT_CHARS - 4 * perWidget);
		expect(json).not.toContain("\n");
		expect(await parseIncoming(json, now)).toMatchObject({ kind: "document", sourceId: "src-1" });
	});

	it("a link of exactly the cap is allowed; one character more is too long", async () => {
		const doc = makeDoc();
		const bare = await shareUrl("", doc, now);
		if (!("url" in bare)) throw new Error("expected a url");
		const pad = MAX_LINK_URL - bare.url.length;
		expect(await shareUrl("x".repeat(pad), doc, now)).toEqual({
			url: "x".repeat(pad) + bare.url
		});
		expect(await shareUrl("x".repeat(pad + 1), doc, now)).toEqual({ tooLong: true });
	});

	it("rawDocumentFileJson keeps unknown fields and drops only the local-only ones", () => {
		const raw = {
			kind: "dashboard",
			schemaVersion: 99,
			id: "d1",
			name: null,
			body: { future: true },
			extra: { keep: "me" },
			version: 4,
			createdAt: "a",
			updatedAt: "b",
			copiedFrom: "x",
			deletedAt: "c"
		};
		const envelope = JSON.parse(rawDocumentFileJson(raw, now));
		expect(envelope.type).toBe("document");
		expect(envelope.documents).toEqual([
			{
				kind: "dashboard",
				schemaVersion: 99,
				id: "d1",
				name: null,
				body: { future: true },
				extra: { keep: "me" }
			}
		]);
	});

	it("a backup carries an open dashboard's edits that couldn't be stored", async () => {
		const platform = createMemoryPlatform();
		const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
		const id = await app.index.createBlank();
		const saved = await app.index.createBlank();
		const session = (await app.sessions.get(id))!;
		vi.spyOn(platform.documents, "commit").mockRejectedValue(new Error("disk"));
		session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Unsaved" });

		const unsaved = await unsavedDocuments(app.openSessions());
		expect([...unsaved.keys()]).toEqual([id]);
		const backup = JSON.parse(await backupJson(platform, app.space, now, unsaved));
		const byId = new Map(backup.documents.map((d: { id: string }) => [d.id, d]));
		expect(byId.get(id)).toMatchObject({ name: "Unsaved" });
		expect(byId.get(saved)).toMatchObject({ name: null });
		// Without them, only the stored copy.
		const stored = JSON.parse(await backupJson(platform, app.space, now));
		expect(stored.documents.find((d: { id: string }) => d.id === id).name).toBeNull();
		session.discard();
	});
});
