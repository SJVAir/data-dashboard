import { CURRENT_SCHEMA_VERSION } from "$lib/documents/schema";
import { describe, expect, it, vi } from "vitest";
import { encodePayload } from "./codec";
import { FORMAT, FORMAT_VERSION, MAX_DOCUMENT_CHARS } from "./envelope";
import { documentFileJson, shareUrl } from "./export";
import { makeDoc, widget } from "./fixtures.test-util";
import { parseIncoming, parseLinkFragment } from "./incoming";

const now = new Date("2026-10-25T12:00:00Z");
const invalid = { kind: "error", reason: "invalid" };

function envelopeOf(doc: unknown, extra: Record<string, unknown> = {}) {
	return {
		format: FORMAT,
		type: "document",
		formatVersion: FORMAT_VERSION,
		exportedAt: now.toISOString(),
		documents: [doc],
		...extra
	};
}

function sharedOf(overrides: Record<string, unknown> = {}) {
	const { kind, schemaVersion, id, name, body } = makeDoc();
	return { kind, schemaVersion, id, name, body, ...overrides };
}

async function realFragment() {
	const out = await shareUrl("https://x.org/workspace/", makeDoc(), now);
	if (!("url" in out)) throw new Error("expected url");
	return out.url.slice(out.url.indexOf("#") + 1);
}

describe("parseLinkFragment: damaged fragments", () => {
	it("rejects a fragment with %0A inserted, truncated, padded with spaces, or empty", async () => {
		const f = await realFragment();
		expect(await parseLinkFragment(f.slice(0, 10) + "%0A" + f.slice(10), now)).toEqual(invalid);
		expect(await parseLinkFragment(f.slice(0, -20), now)).toEqual(invalid);
		expect(await parseLinkFragment(f + "   ", now)).toEqual(invalid);
		expect(await parseLinkFragment("", now)).toEqual(invalid);
	});

	it("rejects a link holding a backup", async () => {
		const backup = envelopeOf(sharedOf(), { type: "backup" });
		expect(await parseLinkFragment(encodePayload(JSON.stringify(backup)), now)).toEqual(invalid);
	});

	it("reports an oversized fragment as too-large", async () => {
		expect(await parseLinkFragment("1." + "a".repeat(64_000), now)).toEqual({
			kind: "error",
			reason: "too-large"
		});
	});

	it("reports a fragment that decompresses past the limit as too-large", async () => {
		const big = JSON.stringify(
			envelopeOf(
				sharedOf({ name: "x", body: { widgets: [] }, pad: "a".repeat(MAX_DOCUMENT_CHARS) })
			)
		);
		const fragment = encodePayload(big);
		expect(fragment.length).toBeLessThan(64_000);
		expect(await parseLinkFragment(fragment, now)).toEqual({ kind: "error", reason: "too-large" });
	});
});

describe("parseIncoming: not a workspace file", () => {
	it.each([
		["empty", ""],
		["csv", "a,b\n1,2"],
		["empty object", "{}"],
		["array", "[]"],
		["other format", JSON.stringify({ ...envelopeOf(sharedOf()), format: "other" })],
		["document with two documents", JSON.stringify(envelopeOf(sharedOf(), { documents: [1, 2] }))],
		["document with fingerprints", JSON.stringify(envelopeOf(sharedOf(), { fingerprints: {} }))],
		["a non-object document", JSON.stringify(envelopeOf("nope"))]
	])("%s is invalid", async (_name, text) => {
		expect(await parseIncoming(text, now)).toEqual(invalid);
	});
});

describe("parseIncoming: documents", () => {
	it("accepts a valid document and fills local fields", async () => {
		const result = await parseIncoming(JSON.stringify(envelopeOf(sharedOf())), now);
		if (result.kind !== "document") throw new Error("expected a document");
		expect(result.sourceId).toBe("src-1");
		expect(result.doc.version).toBe(0);
		expect(result.doc.createdAt).toBe(now.toISOString());
		expect(result.doc.updatedAt).toBe(now.toISOString());
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it("ignores local-only fields in the shared JSON", async () => {
		const text = JSON.stringify(
			envelopeOf(
				sharedOf({ copiedFrom: "x", deletedAt: "2026-01-01T00:00:00.000Z", version: 9, extra: 1 })
			)
		);
		const result = await parseIncoming(text, now);
		if (result.kind !== "document") throw new Error("expected a document");
		expect(result.doc.copiedFrom).toBeUndefined();
		expect(result.doc.deletedAt).toBeUndefined();
		expect(result.doc.version).toBe(0);
		expect("extra" in result.doc).toBe(false);
	});

	it("maps a newer schemaVersion to newer", async () => {
		const text = JSON.stringify(
			envelopeOf(sharedOf({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }))
		);
		expect(await parseIncoming(text, now)).toEqual({ kind: "error", reason: "newer" });
	});

	it("rejects default-place", async () => {
		const w = { ...widget(0), data: { layers: [{ place: { kind: "default-place" } }] } };
		const text = JSON.stringify(envelopeOf(sharedOf({ body: { widgets: [w] } })));
		expect(await parseIncoming(text, now)).toEqual(invalid);
	});

	it("returns a backup envelope as is", async () => {
		const text = JSON.stringify(envelopeOf(sharedOf(), { type: "backup", fingerprints: {} }));
		expect((await parseIncoming(text, now)).kind).toBe("backup");
	});
});

describe("parseIncoming: size limit", () => {
	function build(count: number, lastTitle: string): string {
		const widgets = Array.from({ length: count }, (_, i) => widget(i, "x".repeat(100)));
		widgets.push(widget(count, lastTitle));
		return JSON.stringify(envelopeOf(sharedOf({ body: { widgets } })));
	}

	// Pick the widget count whose JSON leaves a gap of 0-100 characters for the last title.
	function textOfLength(length: number): string {
		const perWidget = build(2, "").length - build(1, "").length;
		let count = Math.floor(length / perWidget);
		while (build(count, "").length > length) count--;
		while (length - build(count + 1, "").length >= 0) count++;
		const gap = length - build(count, "").length;
		expect(gap).toBeLessThanOrEqual(100);
		const text = build(count, "y".repeat(gap));
		expect(text.length).toBe(length);
		return text;
	}

	it("accepts exactly MAX_DOCUMENT_CHARS and refuses one more", async () => {
		expect((await parseIncoming(textOfLength(MAX_DOCUMENT_CHARS), now)).kind).toBe("document");
		expect(await parseIncoming(textOfLength(MAX_DOCUMENT_CHARS + 1), now)).toEqual({
			kind: "error",
			reason: "too-large"
		});
	});
});

describe("parseIncoming: unexpected failures", () => {
	it("maps any unexpected throw to invalid", async () => {
		const text = documentFileJson(makeDoc(), now);
		const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("no subtle"));
		try {
			expect(await parseIncoming(text, now)).toEqual({ kind: "error", reason: "invalid" });
			const fragment = encodePayload(text);
			expect(await parseLinkFragment(fragment, now)).toEqual({ kind: "error", reason: "invalid" });
		} finally {
			spy.mockRestore();
		}
	});
});
