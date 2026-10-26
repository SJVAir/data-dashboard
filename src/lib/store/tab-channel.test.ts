import { describe, expect, it } from "vitest";
import { isTabMessage } from "./tab-channel";

describe("isTabMessage", () => {
	it("accepts committed and cleared messages", () => {
		expect(
			isTabMessage({ type: "committed", space: "anonymous", docId: "d", version: 1, tabId: "t" })
		).toBe(true);
		expect(isTabMessage({ type: "cleared", generation: "g", tabId: "t" })).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isTabMessage(null)).toBe(false);
		expect(isTabMessage({ type: "cleared", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "committed", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "other", generation: "g", tabId: "t" })).toBe(false);
	});
});
