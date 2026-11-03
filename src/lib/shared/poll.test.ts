import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "$lib/documents/schema";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { MAX_DOCUMENT_CHARS } from "$lib/sharing/envelope";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { saveFields } from "$lib/sync/merge";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { makeDoc, widget } from "$lib/sync/test-support";
import { SharedDocumentView } from "./poll.svelte";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const OWNER = "owner";
const NOW = new Date("2026-11-02T12:00:00.000Z");

let platform: MemoryPlatform;
let fake: FakeRemote;
const views: SharedDocumentView[] = [];

beforeEach(() => {
	vi.useFakeTimers();
	platform = createMemoryPlatform();
	setPlatform(platform);
	fake = createFakeRemote({ accountId: OWNER, now: () => NOW });
	fake.signedInAs = null;
	updateNotice.reason = null;
});

afterEach(() => {
	for (const v of views.splice(0)) v.stop();
	vi.useRealTimers();
});

/** Runs `fn` as the owner, then signs out again (the viewer is signed out). */
async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
	fake.signedInAs = OWNER;
	try {
		return await fn();
	} finally {
		fake.signedInAs = null;
	}
}

async function save(doc: Dashboard, overrides: Record<string, unknown> = {}): Promise<void> {
	await asOwner(async () => {
		let baseVersion: number | null = null;
		try {
			baseVersion = (await fake.get(doc.id)).version;
		} catch {
			// New.
		}
		await fake.save(doc.id, {
			...saveFields(doc),
			baseVersion,
			changes: [],
			accountId: OWNER,
			buildId: "owner-build",
			snapshot: null,
			...overrides
		});
	});
}

async function publish(doc: Dashboard = { ...makeDoc("s1"), name: "Class" }): Promise<string> {
	await save(doc);
	return asOwner(() => fake.share(doc.id));
}

function open(token: string): SharedDocumentView {
	const view = new SharedDocumentView(fake, token, () => NOW);
	views.push(view);
	view.start();
	return view;
}

/** Lets pending remote answers settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);
const polls = (token: string) =>
	fake.requests.filter((r) => r.startsWith(`sharedChanges ${token}`)).length;

describe("SharedDocumentView", () => {
	it("opens the shared document", async () => {
		await asOwner(() => fake.setProfile("Ms. Ruiz"));
		const token = await publish();
		const view = open(token);
		expect(view.view.kind).toBe("loading");
		await settle();
		expect(view.view).toMatchObject({
			kind: "shown",
			version: 1,
			sourceId: "s1",
			displayName: "Ms. Ruiz",
			doc: { id: "s1", name: "Class", version: 0, body: makeDoc("s1").body }
		});
		expect(fake.requests).toContain(`shared ${token}`);
	});

	it("polls every 60 seconds while visible and never while hidden", async () => {
		const token = await publish();
		open(token);
		await settle();
		expect(polls(token)).toBe(0);
		await vi.advanceTimersByTimeAsync(59_000);
		expect(polls(token)).toBe(0);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(polls(token)).toBe(1);
		expect(fake.requests).toContain(`sharedChanges ${token} 1`);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(polls(token)).toBe(2);

		platform.activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(polls(token)).toBe(2);
	});

	it("polls at once on becoming visible and on coming online", async () => {
		const token = await publish();
		open(token);
		await settle();
		platform.activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(30_000);
		platform.activity.setVisible(true);
		await settle();
		expect(polls(token)).toBe(1);
		// And the minute starts over from there.
		await vi.advanceTimersByTimeAsync(59_000);
		expect(polls(token)).toBe(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(polls(token)).toBe(2);

		platform.online.setOnline(false);
		await vi.advanceTimersByTimeAsync(10_000);
		platform.online.setOnline(true);
		await settle();
		expect(polls(token)).toBe(3);
	});

	it("an unchanged poll keeps the view", async () => {
		const token = await publish();
		const view = open(token);
		await settle();
		const shown = view.view;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(polls(token)).toBe(1);
		expect(view.view).toBe(shown);
	});

	it("a newer version replaces the view", async () => {
		const token = await publish();
		const view = open(token);
		await settle();
		await save({
			...makeDoc("s1"),
			name: "Class, week 2",
			body: { widgets: [widget("c")] }
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(view.view).toMatchObject({
			kind: "shown",
			version: 2,
			doc: { name: "Class, week 2", body: { widgets: [{ id: "c" }] } }
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fake.requests).toContain(`sharedChanges ${token} 2`);
	});

	it("a link stopped while open shows no longer available", async () => {
		const stops: Array<(id: string) => Promise<void>> = [
			(id) => asOwner(() => fake.unshare(id)),
			(id) => save({ ...makeDoc(id), name: "Class" }, { deletedAt: NOW.toISOString() }),
			async (id) => fake.disableSharing(id)
		];
		for (const [i, stop] of stops.entries()) {
			const id = `s${i}`;
			const token = await publish({ ...makeDoc(id), name: "Class" });
			const view = open(token);
			await settle();
			expect(view.view.kind).toBe("shown");
			await stop(id);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(view.view).toEqual({ kind: "unavailable" });
			// Nothing more to ask.
			const asked = polls(token);
			await vi.advanceTimersByTimeAsync(5 * 60_000);
			expect(polls(token)).toBe(asked);
			view.stop();
		}
	});

	it("offline keeps the shown version", async () => {
		const token = await publish();
		const view = open(token);
		await settle();
		const shown = view.view;
		fake.offline = true;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(polls(token)).toBe(1);
		expect(view.view).toBe(shown);
		fake.refuseNext.push({ code: "rate_limited", status: 429 });
		fake.offline = false;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(view.view).toBe(shown);
		// It tries again next time.
		await save({ ...makeDoc("s1"), name: "Later" });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(view.view).toMatchObject({ kind: "shown", doc: { name: "Later" } });
	});

	it("a first load that can't reach the server is offline, and Try again opens it", async () => {
		const token = await publish();
		fake.offline = true;
		const view = open(token);
		await settle();
		expect(view.view).toEqual({ kind: "offline" });
		fake.offline = false;
		await view.retry();
		expect(view.view.kind).toBe("shown");
	});

	it("an invalid or oversized shared document never renders", async () => {
		const invalid = await publish({
			...makeDoc("bad"),
			body: { widgets: "nope" } as unknown as Dashboard["body"]
		});
		const a = open(invalid);
		await settle();
		expect(a.view).toEqual({ kind: "invalid" });

		// The body is within the server's limit, the whole document over the client's.
		const pad = "x".repeat(MAX_DOCUMENT_CHARS - 40);
		const big = await publish({
			...makeDoc("big"),
			name: "n".repeat(100),
			body: { widgets: [], pad } as unknown as Dashboard["body"]
		});
		const b = open(big);
		await settle();
		expect(b.view).toEqual({ kind: "invalid" });

		// A valid version that turns invalid while shown never renders either.
		const token = await publish();
		const c = open(token);
		await settle();
		await save({ ...makeDoc("s1"), body: { widgets: 1 } as unknown as Dashboard["body"] });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(c.view).toEqual({ kind: "invalid" });
	});

	it("a newer-format shared document asks for a reload", async () => {
		const token = await publish({ ...makeDoc("s1"), schemaVersion: 99 } as unknown as Dashboard);
		const view = open(token);
		await settle();
		expect(view.view).toEqual({ kind: "newer" });
		expect(updateNotice.reason).toBe("newer-data");
	});

	it("unknown, revoked, and private tokens give the same view", async () => {
		const revoked = await publish({ ...makeDoc("r"), name: "Revoked" });
		await asOwner(() => fake.unshare("r"));
		// A private dashboard: its id is no token.
		await save({ ...makeDoc("p"), name: "Private" });
		const results = [];
		for (const token of ["no-such-token", revoked, "p"]) {
			const view = open(token);
			await settle();
			results.push(view.view);
		}
		expect(results).toEqual([
			{ kind: "unavailable" },
			{ kind: "unavailable" },
			{ kind: "unavailable" }
		]);
	});

	it("stop ends polling", async () => {
		const token = await publish();
		const view = open(token);
		await settle();
		view.stop();
		platform.activity.setVisible(false);
		platform.activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(polls(token)).toBe(0);
	});
});
