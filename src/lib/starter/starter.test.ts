import { describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { DashboardSummary } from "$lib/documents/names";
import { DashboardSchema, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { SpaceId } from "$lib/platform/types";
import type { DocumentSession } from "$lib/store/document-session.svelte";
import {
	STARTER_ID,
	blankDashboard,
	copyOfStarter,
	duplicateDashboard,
	resolveHome,
	starterDashboard,
	starterSession
} from "./starter";

const SPACE: SpaceId = "anonymous";
const NOW = new Date("2026-10-21T12:00:00.000Z");

function summary(overrides: Partial<DashboardSummary> & { id: string }): DashboardSummary {
	return {
		name: null,
		createdAt: "2026-10-20T00:00:00Z",
		updatedAt: "2026-10-20T00:00:00Z",
		...overrides
	};
}

const renameWidget = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

describe("starter dashboard", () => {
	it("starter is schema-valid and has three placeholders", () => {
		const starter = starterDashboard();
		expect(DashboardSchema.safeParse(starter).success).toBe(true);
		expect(starter.id).toBe(STARTER_ID);
		expect(starter.name).toBeNull();
		expect(starter.version).toBe(0);
		expect(starter.body.widgets.map((w) => [w.id, w.type, w.title, w.rect])).toEqual([
			["starter-1", "placeholder", null, { x: 0, y: 0, w: 6, h: 4 }],
			["starter-2", "placeholder", null, { x: 6, y: 0, w: 6, h: 4 }],
			["starter-3", "placeholder", null, { x: 0, y: 4, w: 12, h: 4 }]
		]);
	});

	it("returns a fresh object each time", () => {
		const a = starterDashboard();
		a.body.widgets.pop();
		expect(starterDashboard().body.widgets).toHaveLength(3);
	});

	it("copies, blanks, and duplicates are schema-valid new documents", () => {
		const copy = copyOfStarter(NOW);
		expect(copy.id).not.toBe(STARTER_ID);
		expect(copy).toMatchObject({
			copiedFrom: STARTER_ID,
			name: null,
			version: 0,
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString()
		});
		expect(copy.body.widgets).toHaveLength(3);

		const blank = blankDashboard(NOW);
		expect(blank.body.widgets).toEqual([]);
		expect(blank.copiedFrom).toBeUndefined();

		const source: Dashboard = { ...copy, name: "School", version: 7 };
		const dup = duplicateDashboard(source, NOW);
		expect(dup.id).not.toBe(source.id);
		expect(dup).toMatchObject({ name: "School", copiedFrom: source.id, version: 0 });
		expect(dup.deletedAt).toBeUndefined();

		for (const doc of [copy, blank, dup]) expect(DashboardSchema.safeParse(doc).success).toBe(true);
	});
});

describe("resolveHome", () => {
	it("no dashboards → starter", () => {
		expect(resolveHome([], undefined)).toEqual({ kind: "starter" });
		expect(resolveHome([], "gone")).toEqual({ kind: "starter" });
	});

	it("last-opened wins", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "a" });
	});

	it("deleted last-opened falls back to most recently updated", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T09:00:00Z", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" }),
			summary({ id: "c", updatedAt: "2026-10-20T01:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "dashboard", id: "b" });
	});

	it("missing last-opened falls back", () => {
		const summaries = [
			summary({ id: "a", updatedAt: "2026-10-20T01:00:00Z" }),
			summary({ id: "b", updatedAt: "2026-10-20T05:00:00Z" })
		];
		expect(resolveHome(summaries, "gone")).toEqual({ kind: "dashboard", id: "b" });
		expect(resolveHome(summaries, undefined)).toEqual({ kind: "dashboard", id: "b" });
	});

	it("all deleted → starter", () => {
		const summaries = [
			summary({ id: "a", deletedAt: "2026-10-20T09:00:00Z" }),
			summary({ id: "b", deletedAt: "2026-10-20T09:00:00Z" })
		];
		expect(resolveHome(summaries, "a")).toEqual({ kind: "starter" });
	});
});

describe("starterSession", () => {
	async function setup() {
		const platform = createMemoryPlatform();
		const copies: string[] = [];
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => copies.push(session.doc.id)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copies).toHaveLength(1));
		return { platform, starter, copies };
	}

	it("first edit of the starter creates a stored copy with copiedFrom starter and the edit applied", async () => {
		const { platform, copies } = await setup();
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
			expect(stored.copiedFrom).toBe(STARTER_ID);
			expect(stored.name).toBeNull();
			expect(stored.body.widgets[0].title).toBe("Fresno");
		});
		expect(await platform.documents.list(SPACE)).toHaveLength(1);
	});

	it("a first edit after this browser's data was cleared stores no copy", async () => {
		const platform = createMemoryPlatform();
		const onCleared = vi.fn();
		const onCopied = vi.fn();
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCleared,
			onCopied
		});
		// Another tab cleared the data; this one missed the broadcast.
		await platform.reset.clearAll();
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(onCleared).toHaveBeenCalled());
		expect(onCopied).not.toHaveBeenCalled();
		expect(await platform.documents.list(SPACE)).toEqual([]);
	});

	it("the starter stays unchanged", async () => {
		const { platform, starter } = await setup();
		expect(starter.doc).toEqual(starterDashboard());
		expect(await platform.documents.get(SPACE, STARTER_ID)).toBeUndefined();
	});

	it("later edits go to the copy", async () => {
		const { platform, starter, copies } = await setup();
		starter.apply(renameWidget("starter-2", "Visalia"));
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copies[0])) as Dashboard;
			expect(stored.body.widgets[1].title).toBe("Visalia");
		});
		expect(copies).toHaveLength(1);
	});

	it("edits made on the starter during the hand-off apply before edits made on the copy", async () => {
		const platform = createMemoryPlatform();
		// The copy's creation is stored at once; its later saves wait until released.
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		platform.documents.commit = async (space, request) => {
			if (request.baseVersion !== null) await held;
			return commit(space, request);
		};
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => (copied.session = session)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		// Made while the copy is being stored, so it waits for the hand-off.
		starter.apply(renameWidget("starter-2", "Visalia"));
		await vi.waitFor(() => expect(copied.session).toBeDefined());
		// The copy is current now, so the next edit goes to it directly.
		const copy = copied.session!;
		copy.apply(renameWidget("starter-2", "Merced"));
		release();
		await vi.waitFor(async () => {
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.version).toBeGreaterThanOrEqual(3);
		});
		await copy.flush();
		expect(copy.doc.body.widgets[1].title).toBe("Merced");
		const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
		expect(stored.body.widgets[1].title).toBe("Merced");
	});

	it("undo after the copy reverts the edit but the copy remains", async () => {
		const platform = createMemoryPlatform();
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => (copied.session = session)
		});
		starter.apply(renameWidget("starter-1", "Fresno"));
		await vi.waitFor(() => expect(copied.session).toBeDefined());
		const session = copied.session!;
		expect(session.canUndo).toBe(true);
		session.undo();
		await session.flush();
		const stored = (await platform.documents.get(SPACE, session.doc.id)) as Dashboard;
		expect(stored.body.widgets[0].title).toBeNull();
		expect(stored.copiedFrom).toBe(STARTER_ID);
	});

	/** A starter whose hand-off hook fails (`null` or rejecting) on its first attempt. */
	function failingFirst(failure: "null" | "reject") {
		const platform = createMemoryPlatform();
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		let creations = 0;
		platform.documents.commit = async (space, request) => {
			if (request.baseVersion === null && creations++ === 0) {
				await held;
				if (failure === "reject") throw new Error("disk");
				return { ok: false, currentVersion: 0 };
			}
			return commit(space, request);
		};
		const copied: { session?: DocumentSession } = {};
		const starter = starterSession({
			platform,
			space: SPACE,
			tabId: "tab-1",
			now: () => NOW,
			onCopied: (session) => (copied.session = session)
		});
		return { platform, starter, copied, release };
	}

	for (const failure of ["null", "reject"] as const) {
		it(`edits made during the starter hand-off survive a ${failure} hand-off`, async () => {
			const { platform, starter, copied, release } = failingFirst(failure);
			starter.apply(renameWidget("starter-1", "Fresno"));
			starter.apply(renameWidget("starter-2", "Visalia"));
			release();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(copied.session).toBeUndefined();
			if (failure === "reject") {
				expect(starter.status).toBe("error");
				expect(starter.errorKind).toBe("unavailable");
			}

			starter.apply(renameWidget("starter-3", "Merced"));
			await vi.waitFor(() => expect(copied.session).toBeDefined());
			const copy = copied.session!;
			await copy.flush();
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.body.widgets.map((w) => w.title)).toEqual(["Fresno", "Visalia", "Merced"]);
			const log = (await platform.documents.readLog(SPACE, copy.doc.id, 0)) as { change: Change }[];
			expect(log.map((e) => e.change)).toEqual([
				renameWidget("starter-1", "Fresno"),
				renameWidget("starter-2", "Visalia"),
				renameWidget("starter-3", "Merced")
			]);
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([]);
		});
	}

	it("pagehide during the starter hand-off journals the queued edits", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		try {
			const platform = createMemoryPlatform();
			// The copy is never stored: the page goes away mid-hand-off.
			const commit = platform.documents.commit;
			platform.documents.commit = () => new Promise(() => {});
			const starter = starterSession({ platform, space: SPACE, tabId: "gone", now: () => NOW });
			starter.apply(renameWidget("starter-1", "Fresno"));
			starter.apply(renameWidget("starter-2", "Visalia"));
			win.dispatchEvent(new Event("pagehide"));
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([
				{
					tabId: "gone",
					record: {
						baseVersion: 0,
						changes: [renameWidget("starter-1", "Fresno"), renameWidget("starter-2", "Visalia")],
						schemaVersion: 1,
						writtenAt: NOW.toISOString()
					}
				}
			]);

			// The next page load's starter replays them through its own hand-off.
			platform.documents.commit = commit;
			const copied: { session?: DocumentSession } = {};
			const next = starterSession({
				platform,
				space: SPACE,
				tabId: "tab-2",
				now: () => NOW,
				onCopied: (session) => (copied.session = session)
			});
			await next.replayPending();
			expect(copied.session).toBeDefined();
			const copy = copied.session!;
			await copy.flush();
			const stored = (await platform.documents.get(SPACE, copy.doc.id)) as Dashboard;
			expect(stored.copiedFrom).toBe(STARTER_ID);
			expect(stored.body.widgets.map((w) => w.title)).toEqual(["Fresno", "Visalia", null]);
			expect(platform.journal.readAll(SPACE, STARTER_ID)).toEqual([]);
			// Replaying again finds nothing.
			await next.replayPending();
			expect(await platform.documents.list(SPACE)).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
