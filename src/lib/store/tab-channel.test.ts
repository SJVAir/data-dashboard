import { describe, expect, it } from "vitest";
import { createMemoryTabHub, isTabMessage, withLocalEcho } from "./tab-channel";

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

	it("accepts sync and moved messages", () => {
		expect(isTabMessage({ type: "sync", space: "account:u1", docId: "d", tabId: "t" })).toBe(true);
		expect(isTabMessage({ type: "sync", space: "account:u1", docId: null, tabId: "t" })).toBe(true);
		expect(
			isTabMessage({ type: "moved", space: "account:u1", from: "a", to: "b", tabId: "t" })
		).toBe(true);
	});

	it("rejects malformed sync and moved messages", () => {
		expect(isTabMessage({ type: "sync", docId: "d", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "sync", space: "account:u1", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "sync", space: "account:u1", docId: 3, tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "moved", space: "account:u1", from: "a", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "moved", space: "account:u1", to: "b", tabId: "t" })).toBe(false);
		expect(isTabMessage({ type: "moved", from: "a", to: "b", tabId: "t" })).toBe(false);
	});
});

describe("withLocalEcho", () => {
	it("delivers a tab's own posts to its subscribers as well as other tabs", async () => {
		const hub = createMemoryTabHub();
		const mine = withLocalEcho(hub.channel());
		const other = hub.channel();
		const heardHere: string[] = [];
		const heardThere: string[] = [];
		mine.subscribe((msg) => heardHere.push(msg.tabId));
		other.subscribe((msg) => heardThere.push(msg.tabId));
		mine.post({ type: "sync", space: "anonymous", docId: null, tabId: "t1" });
		await Promise.resolve();
		expect(heardHere).toEqual(["t1"]);
		expect(heardThere).toEqual(["t1"]);
	});
});
