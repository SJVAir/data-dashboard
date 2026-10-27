import { describe, expect, it, vi } from "vitest";
import type { AccountUser, Identity } from "$lib/account/identity";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { changeMessage } from "./account.svelte";
import { initApp } from "./app.svelte";
import { createMemoryTabHub, type TabChannel, type TabMessage } from "./tab-channel";

function user(id: string, fullName: string): AccountUser {
	return {
		id,
		full_name: fullName,
		email: null,
		phone: null,
		phone_verified: false,
		language: "en"
	};
}

const signedIn = (u: AccountUser): Identity => ({ state: "signed-in", user: u });
const SIGNED_OUT: Identity = { state: "signed-out" };
const UNKNOWN: Identity = { state: "unknown" };
const maria = user("u1", "Maria Lopez");
const jordan = user("u2", "Jordan Lee");

/** A channel that also records what it posts. */
function recording(channel: TabChannel): TabChannel & { posted: TabMessage[] } {
	const posted: TabMessage[] = [];
	return {
		posted,
		post(msg) {
			posted.push(msg);
			channel.post(msg);
		},
		subscribe: (fn) => channel.subscribe(fn)
	};
}

async function openTab(
	hub: ReturnType<typeof createMemoryTabHub>,
	tabId: string,
	initial: Identity
) {
	const identity = createMemoryIdentity(initial);
	const platform = createMemoryPlatform({ identity });
	const channel = recording(hub.channel());
	const toasts: { info: string[]; error: string[] } = { info: [], error: [] };
	const notify = {
		info: (message: string) => toasts.info.push(message),
		error: (message: string) => toasts.error.push(message)
	};
	const app = await initApp(platform, { channel, tabId, notify });
	return { app, identity, channel, toasts };
}

/** Let the channel's microtasks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AccountState", () => {
	it("load sets the identity without a toast", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		expect(a.app.account.identity).toEqual(signedIn(maria));
		await settle();
		expect(a.toasts).toEqual({ info: [], error: [] });
		expect(a.channel.posted.filter((m) => m.type === "identity")).toEqual([]);
	});

	it("tab A's sign-out reaches tab B", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		const b = await openTab(hub, "b", signedIn(maria));
		await a.app.account.signOut();
		expect(a.app.account.identity).toEqual(SIGNED_OUT);
		await vi.waitFor(() => expect(b.app.account.identity).toEqual(SIGNED_OUT));
		await settle();
		expect(a.toasts.info).toEqual(["Signed out."]);
		expect(b.toasts.info).toEqual(["You've been signed out."]);
	});

	it("a re-check that finds a sign-out tells every tab", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		const b = await openTab(hub, "b", signedIn(maria));
		a.identity.setServer(SIGNED_OUT);
		a.app.account.recheck();
		await vi.waitFor(() => expect(b.app.account.identity).toEqual(SIGNED_OUT));
		expect(a.app.account.identity).toEqual(SIGNED_OUT);
		await settle();
		expect(a.toasts.info).toEqual(["You've been signed out."]);
		expect(b.toasts.info).toEqual(["You've been signed out."]);
		expect(b.identity.requests).toBe(0);
	});

	it("an equal identity from another tab is ignored", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", SIGNED_OUT);
		const b = await openTab(hub, "b", SIGNED_OUT);
		a.channel.post({ type: "identity", identity: SIGNED_OUT, tabId: "a" });
		await settle();
		expect(b.app.account.identity).toEqual(SIGNED_OUT);
		expect(b.toasts).toEqual({ info: [], error: [] });
		expect(b.channel.posted).toEqual([]);
	});

	it("switching accounts says the new name", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		const b = await openTab(hub, "b", signedIn(maria));
		a.identity.setServer(signedIn(jordan));
		a.app.account.recheck();
		await vi.waitFor(() => expect(b.app.account.identity).toEqual(signedIn(jordan)));
		await settle();
		expect(a.toasts.info).toEqual(["Now signed in as Jordan Lee."]);
		expect(b.toasts.info).toEqual(["Now signed in as Jordan Lee."]);
	});

	it("a name change for the same account is silent", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		const b = await openTab(hub, "b", signedIn(maria));
		const renamed = signedIn({ ...maria, full_name: "Maria L." });
		a.identity.setServer(renamed);
		a.app.account.recheck();
		await vi.waitFor(() => expect(b.app.account.identity).toEqual(renamed));
		expect(a.app.account.identity).toEqual(renamed);
		await settle();
		expect(a.toasts.info).toEqual([]);
		expect(b.toasts.info).toEqual([]);
	});

	it("failed sign-out shows the error toast", async () => {
		const hub = createMemoryTabHub();
		const a = await openTab(hub, "a", signedIn(maria));
		a.identity.setSignOutResult(false);
		await a.app.account.signOut();
		expect(a.toasts.error).toEqual(["Couldn't sign out. Check your connection and try again."]);
		expect(a.app.account.identity).toEqual(signedIn(maria));
	});
});

describe("changeMessage", () => {
	it("says nothing when the previous identity is unknown or the account is the same", () => {
		expect(changeMessage(UNKNOWN, SIGNED_OUT)).toBeNull();
		expect(changeMessage(UNKNOWN, signedIn(maria))).toBeNull();
		expect(changeMessage(SIGNED_OUT, SIGNED_OUT)).toBeNull();
		expect(changeMessage(signedIn(maria), signedIn({ ...maria, full_name: "M" }))).toBeNull();
	});

	it("names the account, or not when it has no name", () => {
		expect(changeMessage(signedIn(maria), SIGNED_OUT)).toBe("You've been signed out.");
		expect(changeMessage(SIGNED_OUT, signedIn(maria))).toBe("Signed in as Maria Lopez.");
		expect(changeMessage(SIGNED_OUT, signedIn(user("u3", "  ")))).toBe("You're signed in.");
		expect(changeMessage(signedIn(maria), signedIn(jordan))).toBe("Now signed in as Jordan Lee.");
		expect(changeMessage(signedIn(maria), signedIn(user("u3", "")))).toBe(
			"You're now signed in to a different account."
		);
	});
});
