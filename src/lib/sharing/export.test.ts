import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_CHARS, MAX_LINK_URL } from "./envelope";
import { documentFileJson, shareUrl, sharedDocumentOf } from "./export";
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
});
