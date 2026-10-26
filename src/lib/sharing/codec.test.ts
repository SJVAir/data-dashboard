import { describe, expect, it } from "vitest";
import { decodePayload, encodePayload } from "./codec";
import { LINK_PREFIX, MAX_INCOMING_FRAGMENT } from "./envelope";

describe("codec", () => {
	it("round-trips text with the format prefix", () => {
		const json = JSON.stringify({ a: "héllo ✓", b: [1, 2, 3] });
		const payload = encodePayload(json);
		expect(payload.startsWith(LINK_PREFIX)).toBe(true);
		expect(decodePayload(payload)).toBe(json);
	});

	it("returns null for a wrong prefix, empty payload, oversized or garbage input", () => {
		const payload = encodePayload("{}");
		expect(decodePayload(payload.slice(2))).toBeNull();
		expect(decodePayload("2." + payload.slice(2))).toBeNull();
		expect(decodePayload(LINK_PREFIX)).toBeNull();
		expect(decodePayload("")).toBeNull();
		expect(decodePayload(LINK_PREFIX + "x".repeat(MAX_INCOMING_FRAGMENT))).toBeNull();
		expect(decodePayload(LINK_PREFIX + "%%%%")).toBeNull();
	});

	it("decodes a payload that was percent-encoded on the way, once", () => {
		const json = JSON.stringify({ a: "héllo ✓", b: "ñandú €" });
		const payload = encodePayload(json);
		// "+" (like "$", which the alphabet also allows) is what an app may percent-encode.
		expect(payload).toContain("+");
		const encoded = payload.replaceAll("+", "%2B");
		expect(decodePayload(encoded)).toBe(json);
		expect(decodePayload(encoded.replace("N4", "%4E%34"))).toBe(json);
		// Only once: encoded twice it's no longer a payload.
		expect(decodePayload(encoded.replaceAll("%", "%25"))).toBeNull();
		expect(decodePayload(LINK_PREFIX + "%E0%A4%A")).toBeNull();
	});
});
