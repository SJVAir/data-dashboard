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
});
