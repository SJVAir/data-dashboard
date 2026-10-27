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

	it("accepts identity messages that are signed out, or signed in with a valid user", () => {
		const user = {
			id: "u1",
			full_name: "Maria Lopez",
			email: null,
			phone: null,
			phone_verified: false,
			language: "en"
		};
		expect(isTabMessage({ type: "identity", identity: { state: "signed-out" }, tabId: "t" })).toBe(
			true
		);
		expect(
			isTabMessage({ type: "identity", identity: { state: "signed-in", user }, tabId: "t" })
		).toBe(true);
		const noId: Partial<typeof user> = { ...user };
		delete noId.id;
		expect(
			isTabMessage({ type: "identity", identity: { state: "signed-in", user: noId }, tabId: "t" })
		).toBe(false);
		expect(isTabMessage({ type: "identity", identity: { state: "unknown" }, tabId: "t" })).toBe(
			false
		);
		expect(isTabMessage({ type: "identity", tabId: "t" })).toBe(false);
	});
});
