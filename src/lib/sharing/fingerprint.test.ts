import { describe, expect, it } from "vitest";
import { sharedDocumentOf } from "./export";
import { canonicalJson, fingerprint } from "./fingerprint";
import { makeDoc } from "./fixtures.test-util";

describe("fingerprint", () => {
	it("sorts keys and drops whitespace", () => {
		expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe(
			'{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}'
		);
	});

	it("is equal for the same document with keys in a different order", async () => {
		const doc = sharedDocumentOf(makeDoc());
		const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(doc).reverse())));
		expect(await fingerprint(reordered)).toBe(await fingerprint(doc));
		expect(await fingerprint(doc)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("differs when the name changes", async () => {
		const doc = sharedDocumentOf(makeDoc());
		expect(await fingerprint({ ...doc, name: "Other" })).not.toBe(await fingerprint(doc));
	});
});
