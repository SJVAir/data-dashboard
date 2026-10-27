import { describe, expect, it } from "vitest";
import { unavailableMessage } from "./messages";
import { UNAVAILABLE_REASONS } from "./types";

describe("unavailableMessage", () => {
	it("has a distinct message for every unavailable reason", () => {
		const messages = UNAVAILABLE_REASONS.map(unavailableMessage);
		for (const message of messages) expect(message).toMatch(/\S/);
		expect(new Set(messages).size).toBe(UNAVAILABLE_REASONS.length);
	});
});
