import { describe, expect, it } from "vitest";
import { MAX_LINK_URL } from "./envelope";
import { documentFileJson, shareUrl, sharedDocumentOf } from "./export";
import { makeDoc } from "./fixtures.test-util";
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
});
