import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Change } from "$lib/changes/types";
import type { Migration } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard, type WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { LogEntry, Platform, SpaceId } from "$lib/platform/types";
import { report } from "$lib/safety/report";
import { DocumentSession, RETRY_DELAYS_MS } from "./document-session.svelte";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const SPACE: SpaceId = "anonymous";
const NOW = new Date("2026-10-20T12:00:00.000Z");

function widget(id: string): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};
}

function makeDoc(): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 0,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets: [widget("a")] }
	};
}

const rename = (to: string | null, from: string | null = null): Change => ({
	op: "setField",
	target: { path: "name" },
	from,
	to
});

const title = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

async function stored(platform: Platform, id = "d1"): Promise<Dashboard> {
	return (await platform.documents.get(SPACE, id)) as Dashboard;
}

async function setup(overrides: Partial<ConstructorParameters<typeof DocumentSession>[0]> = {}) {
	const platform = createMemoryPlatform();
	const doc = makeDoc();
	await platform.documents.commit(SPACE, { docId: doc.id, baseVersion: null, doc, entries: [] });
	const session = new DocumentSession({
		platform,
		space: SPACE,
		doc,
		tabId: "tab-1",
		now: () => NOW,
		...overrides
	});
	return { platform, session };
}

describe("DocumentSession", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("apply updates doc immediately and saves after 500 ms", async () => {
		const { platform, session } = await setup();
		session.apply(rename("Home"));
		expect(session.doc.name).toBe("Home");
		expect(session.status).toBe("saving");
		expect(session.canUndo).toBe(true);

		await vi.advanceTimersByTimeAsync(499);
		expect((await stored(platform)).version).toBe(0);

		await vi.advanceTimersByTimeAsync(1);
		const saved = await stored(platform);
		expect(saved.version).toBe(1);
		expect(saved.name).toBe("Home");
		expect(saved.updatedAt).toBe(NOW.toISOString());
		expect(session.doc.version).toBe(1);
		expect(session.status).toBe("saved");
	});

	it("several quick edits commit once with consecutive versions", async () => {
		const { platform, session } = await setup();
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename("One"));
		await vi.advanceTimersByTimeAsync(300);
		session.apply(title("a", "Map"));
		await vi.advanceTimersByTimeAsync(300);
		session.apply(rename("Two", "One"));
		await vi.advanceTimersByTimeAsync(500);

		expect(commit).toHaveBeenCalledTimes(1);
		expect(commit.mock.calls[0][1].baseVersion).toBe(0);
		expect((await stored(platform)).version).toBe(3);
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log).not.toBe("trimmed");
		expect((log as { version: number }[]).map((e) => e.version)).toEqual([1, 2, 3]);
	});

	it("undo and redo are saved too", async () => {
		const { platform, session } = await setup();
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(500);

		session.undo();
		expect(session.doc.name).toBeNull();
		expect(session.canRedo).toBe(true);
		await vi.advanceTimersByTimeAsync(500);
		expect((await stored(platform)).name).toBeNull();
		expect((await stored(platform)).version).toBe(2);

		session.redo();
		expect(session.doc.name).toBe("Home");
		await vi.advanceTimersByTimeAsync(500);
		const saved = await stored(platform);
		expect(saved.name).toBe("Home");
		expect(saved.version).toBe(3);

		const log = (await platform.documents.readLog(SPACE, "d1", 0)) as { change: Change }[];
		expect(log.map((e) => e.change)).toEqual([
			rename("Home"),
			rename(null, "Home"),
			rename("Home")
		]);
	});

	it("flushes pending changes on pagehide", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const { platform, session } = await setup();
		session.apply(rename("Home"));

		win.dispatchEvent(new Event("pagehide"));
		await vi.advanceTimersByTimeAsync(0);
		expect((await stored(platform)).name).toBe("Home");
		expect(session.status).toBe("saved");
	});

	it("hidden activity journals and flushes; visible activity catches up", async () => {
		const { platform, session } = await setup();
		session.apply(rename("Home"));
		// Held, as when a mobile browser kills a hidden tab before the save finishes.
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		platform.documents.commit = async (...args) => {
			await held;
			return commit(...args);
		};

		platform.activity.setVisible(false);
		expect(platform.journal.readAll(SPACE, "d1")).toHaveLength(1);
		release();
		await vi.advanceTimersByTimeAsync(0);
		expect((await stored(platform)).name).toBe("Home");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);

		// Another tab saves while this one is hidden; coming back catches up.
		const other = await DocumentSession.open(platform, SPACE, "d1", "tab-2");
		other!.apply(title("a", "Map"));
		await other!.flush();
		platform.activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(session.doc.body.widgets[0].title).toBe("Map");
		expect(session.doc.version).toBe(2);
	});

	it("a failed save retries on the backoff timer", async () => {
		const { platform, session } = await setup();
		const commit = vi
			.spyOn(platform.documents, "commit")
			.mockRejectedValueOnce(new Error("disk"))
			.mockRejectedValueOnce(new Error("disk"));
		expect(RETRY_DELAYS_MS).toEqual([1_000, 2_000, 5_000, 15_000, 60_000]);
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(500);
		expect(commit).toHaveBeenCalledTimes(1);
		expect(session.status).toBe("error");
		expect(session.errorKind).toBe("unavailable");

		await vi.advanceTimersByTimeAsync(999);
		expect(commit).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(commit).toHaveBeenCalledTimes(2);
		expect(session.status).toBe("error");

		await vi.advanceTimersByTimeAsync(2_000);
		expect(commit).toHaveBeenCalledTimes(3);
		expect(session.status).toBe("saved");
		expect(session.errorKind).toBeNull();
		expect((await stored(platform)).name).toBe("Home");

		// After a success the delay starts over.
		commit.mockRejectedValueOnce(new Error("disk"));
		session.apply(title("a", "Map"));
		await vi.advanceTimersByTimeAsync(500);
		expect(commit).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(commit).toHaveBeenCalledTimes(5);
		expect(session.status).toBe("saved");
		expect((await stored(platform)).body.widgets[0].title).toBe("Map");
	});

	it("a failed save reports once, not on every retry", async () => {
		const { platform, session } = await setup();
		vi.mocked(report).mockClear();
		const failure = new Error("disk");
		vi.spyOn(platform.documents, "commit")
			.mockRejectedValueOnce(failure)
			.mockRejectedValueOnce(failure);
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(500);
		expect(session.status).toBe("error");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith(failure, { operation: "save" });
	});

	it("a quota failure sets errorKind to quota", async () => {
		const { platform, session } = await setup();
		vi.spyOn(platform.documents, "commit").mockRejectedValueOnce(
			new DOMException("full", "QuotaExceededError")
		);
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(500);
		expect(session.status).toBe("error");
		expect(session.errorKind).toBe("quota");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(session.status).toBe("saved");
		expect(session.errorKind).toBeNull();
	});

	it("suspend writes the journal and stops saving", async () => {
		const { platform, session } = await setup();
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename("Home"));
		session.suspend();
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([
			{
				tabId: "tab-1",
				record: {
					baseVersion: 0,
					changes: [rename("Home")],
					schemaVersion: 1,
					writtenAt: NOW.toISOString()
				}
			}
		]);

		session.apply(title("a", "Map"));
		await session.flush();
		platform.activity.setVisible(false);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(commit).not.toHaveBeenCalled();
		expect((await stored(platform)).name).toBeNull();
		// The journal still holds only what was pending when it was suspended.
		expect(platform.journal.readAll(SPACE, "d1")[0].record).toMatchObject({
			changes: [rename("Home")]
		});
	});

	it("discard drops pending changes without saving or journaling", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const { platform, session } = await setup();
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename("Home"));
		session.discard();
		win.dispatchEvent(new Event("pagehide"));
		platform.activity.setVisible(false);
		await session.flush();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
		expect((await stored(platform)).name).toBeNull();
	});

	it("dispose flushes and removes listeners", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const { platform, session } = await setup();
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename("Home"));
		session.dispose();
		await vi.advanceTimersByTimeAsync(0);
		expect((await stored(platform)).name).toBe("Home");

		win.dispatchEvent(new Event("pagehide"));
		await vi.advanceTimersByTimeAsync(1000);
		expect(commit).toHaveBeenCalledTimes(1);
	});

	it("failed commit keeps doc and sets status error", async () => {
		const { platform, session } = await setup();
		const commit = vi
			.spyOn(platform.documents, "commit")
			.mockRejectedValueOnce(new Error("QuotaExceededError"));
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(500);

		expect(session.status).toBe("error");
		expect(session.doc.name).toBe("Home");
		expect(session.doc.version).toBe(0);
		expect((await stored(platform)).name).toBeNull();

		// The pending change is kept and goes out with the next save.
		session.apply(title("a", "Map"));
		await vi.advanceTimersByTimeAsync(500);
		expect(commit).toHaveBeenCalledTimes(2);
		const saved = await stored(platform);
		expect(saved.name).toBe("Home");
		expect(saved.version).toBe(2);
		expect(session.status).toBe("saved");
	});

	it("a commit that throws outside storage leaves later saves working", async () => {
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			let calls = 0;
			const now = () => {
				if (calls++ === 0) throw new Error("clock failed");
				return NOW;
			};
			const { platform, session } = await setup({ now });
			session.apply(rename("Home"));
			await vi.advanceTimersByTimeAsync(500);
			expect(session.status).toBe("error");
			expect(session.doc.name).toBe("Home");

			session.apply(title("a", "Map"));
			await vi.advanceTimersByTimeAsync(500);
			const saved = await stored(platform);
			expect(saved.version).toBe(2);
			expect(saved.name).toBe("Home");
			expect(session.status).toBe("saved");
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});

	it("a refused commit calls catchUp, and its failure is an error", async () => {
		const { platform } = await setup();
		let calls = 0;
		class Failing extends DocumentSession {
			protected override async catchUp(): Promise<void> {
				calls++;
				throw new Error("catch-up failed");
			}
		}
		const other = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "t2" });
		other.apply(rename("Theirs"));
		await other.flush();

		const session = new Failing({ platform, space: SPACE, doc: makeDoc(), tabId: "tab-1" });
		session.apply(title("a", "Map"));
		await session.flush();
		expect(calls).toBe(1);
		expect(session.status).toBe("error");
		expect(session.doc.body.widgets[0].title).toBe("Map");
	});

	it("read-only session refuses apply", async () => {
		const { platform, session } = await setup({ readOnly: "newer" });
		const commit = vi.spyOn(platform.documents, "commit");
		const before = session.doc;
		session.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(1000);
		await session.flush();

		expect(session.doc).toBe(before);
		expect(session.canUndo).toBe(false);
		expect(commit).not.toHaveBeenCalled();
		expect((await stored(platform)).name).toBeNull();
	});

	it("stored log entries carry tabId and schemaVersion 1", async () => {
		const { platform, session } = await setup();
		session.apply(rename("Home"));
		await session.flush();
		const log = await platform.documents.readLog(SPACE, "d1", 0);
		expect(log).toEqual([
			{ docId: "d1", version: 1, change: rename("Home"), tabId: "tab-1", schemaVersion: 1 }
		]);
	});

	it("logs the change as applied, not as requested", async () => {
		const { platform, session } = await setup();
		session.apply(rename("Home", "stale"));
		await session.flush();
		const log = (await platform.documents.readLog(SPACE, "d1", 0)) as { change: Change }[];
		expect(log[0].change).toEqual(rename("Home", null));
	});

	it("edits made while a commit is in flight are saved next", async () => {
		const { platform, session } = await setup();
		const commit = platform.documents.commit.bind(platform.documents);
		vi.spyOn(platform.documents, "commit").mockImplementationOnce(async (space, input) => {
			session.apply(title("a", "Map"));
			return commit(space, input);
		});
		session.apply(rename("Home"));
		await session.flush();
		expect((await stored(platform)).version).toBe(1);
		expect(session.doc.version).toBe(1);
		expect(session.doc.body.widgets[0].title).toBe("Map");
		expect(session.status).toBe("saving");

		await vi.advanceTimersByTimeAsync(500);
		const saved = await stored(platform);
		expect(saved.version).toBe(2);
		expect(saved.body.widgets[0].title).toBe("Map");
		expect(session.status).toBe("saved");
	});

	it("hands the first edit to onBeforeFirstEdit instead of applying it", async () => {
		const { platform } = await setup();
		const successor = new DocumentSession({
			platform,
			space: SPACE,
			doc: makeDoc(),
			tabId: "tab-1"
		});
		const hook = vi.fn(async (change: Change) => {
			successor.apply(change);
			return successor;
		});
		const starter = new DocumentSession({
			platform,
			space: SPACE,
			doc: { ...makeDoc(), id: "starter" },
			tabId: "tab-1",
			onBeforeFirstEdit: hook
		});
		starter.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(0);

		expect(hook).toHaveBeenCalledWith(rename("Home"));
		expect(starter.doc.name).toBeNull();
		expect(successor.doc.name).toBe("Home");

		// Later edits on the old session go to its successor.
		starter.apply(title("a", "Map"));
		expect(hook).toHaveBeenCalledTimes(1);
		expect(successor.doc.body.widgets[0].title).toBe("Map");
		expect(await platform.documents.get(SPACE, "starter")).toBeUndefined();
	});

	it("a hand-off that succeeds after the starter was suspended suspends the copy", async () => {
		const { platform } = await setup();
		const successor = new DocumentSession({
			platform,
			space: SPACE,
			doc: makeDoc(),
			tabId: "tab-1",
			now: () => NOW
		});
		let finish!: () => void;
		const starter = new DocumentSession({
			platform,
			space: SPACE,
			doc: { ...makeDoc(), id: "starter" },
			tabId: "tab-1",
			now: () => NOW,
			onBeforeFirstEdit: (change) =>
				new Promise((resolve) => {
					finish = () => {
						successor.apply(change);
						resolve(successor);
					};
				})
		});
		starter.apply(rename("Home"));
		starter.apply(title("a", "Map"));
		starter.suspend();
		const commit = vi.spyOn(platform.documents, "commit");

		finish();
		await vi.advanceTimersByTimeAsync(0);
		await successor.flush();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([
			{
				tabId: "tab-1",
				record: {
					baseVersion: 0,
					changes: [rename("Home"), title("a", "Map")],
					schemaVersion: 1,
					writtenAt: NOW.toISOString()
				}
			}
		]);
	});

	it("replayPending does nothing once the hand-off has succeeded", async () => {
		const { platform } = await setup();
		const successor = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "t" });
		const hook = vi.fn(async (change: Change) => {
			successor.apply(change);
			return successor;
		});
		const starter = new DocumentSession({
			platform,
			space: SPACE,
			doc: { ...makeDoc(), id: "starter" },
			tabId: "tab-1",
			onBeforeFirstEdit: hook
		});
		starter.apply(rename("Home"));
		await vi.advanceTimersByTimeAsync(0);
		const left = {
			baseVersion: 0,
			changes: [title("a", "Other")],
			schemaVersion: 1,
			writtenAt: NOW.toISOString()
		};
		platform.journal.write(SPACE, "starter", "tab-2", left);

		await starter.replayPending();
		await vi.advanceTimersByTimeAsync(0);
		expect(hook).toHaveBeenCalledTimes(1);
		expect(successor.doc.body.widgets[0].title).toBeNull();
		// Left for the starter that owns it.
		expect(platform.journal.readAll(SPACE, "starter")).toEqual([{ tabId: "tab-2", record: left }]);
	});

	it("a refused commit whose catch-up can't read storage retries", async () => {
		const { platform } = await setup();
		const other = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "t2" });
		other.apply(rename("Theirs"));
		await other.flush();

		const session = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "tab-1" });
		vi.mocked(report).mockClear();
		vi.spyOn(platform.documents, "get").mockRejectedValueOnce(new Error("read failed"));
		session.apply(title("a", "Map"));
		await session.flush();
		expect(session.status).toBe("error");

		expect(report).toHaveBeenCalledWith(expect.any(Error), { operation: "catch-up" });
		await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
		const saved = await stored(platform);
		expect(saved.name).toBe("Theirs");
		expect(saved.body.widgets[0].title).toBe("Map");
		expect(session.status).toBe("saved");
	});

	it("repeated catch-up failures report once", async () => {
		const { platform } = await setup();
		const other = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "t2" });
		other.apply(rename("Theirs"));
		await other.flush();

		const session = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "tab-1" });
		vi.mocked(report).mockClear();
		vi.spyOn(platform.documents, "get")
			.mockRejectedValueOnce(new Error("read failed"))
			.mockRejectedValueOnce(new Error("read failed"));
		session.apply(title("a", "Map"));
		await session.flush();
		await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
		expect(session.status).toBe("error");
		await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1]);
		expect(session.status).toBe("saved");
		expect(report).toHaveBeenCalledTimes(1);
	});

	it("a failure on the commit chain reports and shows the error", async () => {
		const { platform, session } = await setup();
		vi.mocked(report).mockClear();
		const failure = new Error("resolve failed");
		vi.spyOn(platform.documents, "get").mockRejectedValueOnce(failure);
		platform.activity.setVisible(false);
		platform.activity.setVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(session.status).toBe("error");
		expect(session.errorKind).toBe("unavailable");
		expect(report).toHaveBeenCalledWith(failure, { operation: "commit-chain" });
	});

	it("open loads a stored dashboard, and returns null for an unknown id", async () => {
		const { platform } = await setup();
		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-2");
		expect(session?.doc.id).toBe("d1");
		expect(session?.readOnly).toBe(false);
		expect(await DocumentSession.open(platform, SPACE, "nope", "tab-2")).toBeNull();
	});

	it("open makes a newer-schema dashboard read-only", async () => {
		const platform = createMemoryPlatform();
		const doc = { ...makeDoc(), schemaVersion: 99 };
		await platform.documents.commit(SPACE, { docId: "d1", baseVersion: null, doc, entries: [] });
		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-2");
		expect(session?.readOnly).toBe("newer");
	});
});

describe("DocumentSession journal", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const record = (changes: Change[], baseVersion = 0) => ({
		baseVersion,
		changes,
		schemaVersion: 1,
		writtenAt: NOW.toISOString()
	});

	/** Stores `changes` as `tabId`'s save on top of the stored version. */
	async function saveAs(platform: Platform, tabId: string, changes: Change[]) {
		const session = await DocumentSession.open(platform, SPACE, "d1", tabId);
		for (const change of changes) session!.apply(change);
		await session!.flush();
		session!.dispose();
	}

	it("pagehide writes the pending changes, and the save clears them", async () => {
		vi.useFakeTimers();
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const { platform, session } = await setup();
		session.apply(title("a", "Ozone"));
		// The commit is held, as when the page is torn down mid-save.
		const commit = platform.documents.commit;
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		platform.documents.commit = async (...args) => {
			await held;
			return commit(...args);
		};

		win.dispatchEvent(new Event("pagehide"));
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([
			{ tabId: "tab-1", record: record([title("a", "Ozone")]) }
		]);
		release();
		await vi.advanceTimersByTimeAsync(0);
		expect((await stored(platform)).body.widgets[0].title).toBe("Ozone");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("the app becoming hidden also writes the pending changes", async () => {
		const { platform, session } = await setup();
		session.apply(title("a", "Ozone"));
		// The commit is held: mobile browsers may kill a hidden tab before it finishes.
		platform.documents.commit = () => new Promise(() => {});

		platform.activity.setVisible(false);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([
			{ tabId: "tab-1", record: record([title("a", "Ozone")]) }
		]);
	});

	it("pagehide writes nothing when nothing is pending", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const { platform } = await setup();
		win.dispatchEvent(new Event("pagehide"));
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("open replays a record cleanly and clears it once stored", async () => {
		const { platform } = await setup();
		// Another tab saved an unrelated change after the record's base version.
		await saveAs(platform, "tab-2", [rename("Home")]);
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Ozone")]));

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.doc.body.widgets[0].title).toBe("Ozone");
		expect(session!.doc.name).toBe("Home");
		const saved = await stored(platform);
		expect(saved.version).toBe(2);
		expect(saved.body.widgets[0].title).toBe("Ozone");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
		expect(session!.canUndo).toBe(false);
	});

	it("open skips a record whose changes were stored after all", async () => {
		const { platform } = await setup();
		await saveAs(platform, "gone", [title("a", "Ozone")]);
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Ozone")]));

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.doc.body.widgets[0].title).toBe("Ozone");
		expect((await stored(platform)).version).toBe(1);
		expect(await platform.documents.readLog(SPACE, "d1", 0)).toHaveLength(1);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("open raises a conflict when a record overlaps a later save", async () => {
		const { platform } = await setup();
		await saveAs(platform, "tab-2", [title("a", "Theirs")]);
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Mine")]));

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.conflict).not.toBeNull();
		expect(session!.doc.body.widgets[0].title).toBe("Mine");
		expect((await stored(platform)).body.widgets[0].title).toBe("Theirs");
		// Kept until the conflict is settled.
		expect(platform.journal.readAll(SPACE, "d1")).toHaveLength(1);

		await session!.resolveConflict("keep-mine");
		expect((await stored(platform)).body.widgets[0].title).toBe("Mine");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("open replays only the part of a record that wasn't stored", async () => {
		const { platform } = await setup();
		// The tab's first edit was stored; the page went away before the second one was.
		await saveAs(platform, "gone", [title("a", "Ozone")]);
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Ozone"), rename("Home")]));

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.conflict).toBeNull();
		expect(session!.doc.body.widgets[0].title).toBe("Ozone");
		expect(session!.doc.name).toBe("Home");
		const saved = await stored(platform);
		expect(saved.version).toBe(2);
		expect(saved.name).toBe("Home");
		expect(await platform.documents.readLog(SPACE, "d1", 0)).toHaveLength(2);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("two tabs opening a dashboard with a record both replay it without a conflict", async () => {
		const { platform } = await setup();
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Ozone")]));

		const [one, two] = await Promise.all([
			DocumentSession.open(platform, SPACE, "d1", "tab-3"),
			DocumentSession.open(platform, SPACE, "d1", "tab-4")
		]);
		await Promise.all([one!.flush(), two!.flush()]);
		expect(one!.conflict).toBeNull();
		expect(two!.conflict).toBeNull();
		expect(one!.doc.body.widgets[0].title).toBe("Ozone");
		expect(two!.doc.body.widgets[0].title).toBe("Ozone");
		expect((await stored(platform)).body.widgets[0].title).toBe("Ozone");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("open keeps a record from a newer schema without replaying it", async () => {
		const { platform } = await setup();
		const newer = { ...record([title("a", "Ozone")]), schemaVersion: 2 };
		platform.journal.write(SPACE, "d1", "newer", newer);

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.doc).toEqual(makeDoc());
		expect((await stored(platform)).version).toBe(0);
		// A newer bundle replays it.
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([{ tabId: "newer", record: newer }]);
	});

	it("open discards a record the trimmed log no longer covers", async () => {
		const { platform } = await setup();
		await saveAs(platform, "tab-2", [rename("Home")]);
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Ozone")]));
		platform.documents.readLog = async () => "trimmed";

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.conflict).toBeNull();
		expect(session!.doc.body.widgets[0].title).toBeNull();
		expect((await stored(platform)).version).toBe(1);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("open discards a corrupt record", async () => {
		const { platform } = await setup();
		platform.journal.write(SPACE, "d1", "bad", { baseVersion: 0, changes: [{ op: "explode" }] });
		platform.journal.write(SPACE, "d1", "worse", "not a record");

		const session = await DocumentSession.open(platform, SPACE, "d1", "tab-3");
		expect(session!.conflict).toBeNull();
		expect(session!.doc).toEqual(makeDoc());
		expect((await stored(platform)).version).toBe(0);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});
});

const OLD_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION - 1;

/** A test-only step from the previous format: an old `rename` change becomes a `setField`. */
function testChain(migrate = (raw: object): unknown => raw): Migration[] {
	return [
		{
			from: OLD_SCHEMA_VERSION,
			to: CURRENT_SCHEMA_VERSION,
			schema: z.unknown(),
			migrate: (raw) => migrate({ ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION }),
			migrateChange(change) {
				const c = change as { op: string; to?: string };
				if (c.op !== "rename") return change;
				if (c.to === "drop") return null;
				return { op: "setField", target: { path: "name" }, from: null, to: c.to };
			}
		}
	];
}

const oldRename = (to: string) => ({ op: "rename", to });

describe("DocumentSession format changes", () => {
	const opened: DocumentSession[] = [];
	afterEach(() => {
		for (const s of opened.splice(0)) s.dispose();
		vi.mocked(report).mockClear();
	});

	async function withStored(doc: unknown) {
		const platform = createMemoryPlatform();
		await platform.documents.commit(SPACE, {
			docId: "d1",
			baseVersion: null,
			doc: doc as Dashboard,
			entries: []
		});
		return platform;
	}

	async function open(
		platform: Platform,
		options: Parameters<typeof DocumentSession.open>[4] = {},
		tabId = "tab-1"
	) {
		const session = await DocumentSession.open(platform, SPACE, "d1", tabId, {
			debounceMs: 60_000,
			now: () => NOW,
			...options
		});
		opened.push(session!);
		return session!;
	}

	/** Another tab's save, stored as written (any format). */
	async function storeRaw(
		platform: Platform,
		doc: Record<string, unknown>,
		changes: unknown[],
		schemaVersion: number
	) {
		const base = (await stored(platform)).version;
		const entries = changes.map((change, i) => ({
			docId: "d1",
			version: base + i + 1,
			change,
			tabId: "other",
			schemaVersion
		})) as LogEntry[];
		await platform.documents.commit(SPACE, {
			docId: "d1",
			baseVersion: base,
			doc: { ...(await stored(platform)), ...doc, version: base + changes.length } as Dashboard,
			entries
		});
	}

	it("opening an upgraded document keeps the original once", async () => {
		const old = { ...makeDoc(), schemaVersion: OLD_SCHEMA_VERSION };
		const platform = await withStored(old);
		const session = await open(platform, { chain: testChain() });
		expect(session.readOnly).toBe(false);
		expect(session.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(session.hasOriginal).toBe(true);
		const kept = {
			id: "d1",
			raw: old,
			keptAt: NOW.toISOString(),
			fromSchemaVersion: OLD_SCHEMA_VERSION
		};
		expect(await platform.originals.get(SPACE, "d1")).toEqual(kept);

		// Still stored in the old format: opening again keeps the first original.
		const later = new Date("2026-10-22T00:00:00.000Z");
		const again = await open(platform, { chain: testChain(), now: () => later }, "tab-2");
		expect(again.hasOriginal).toBe(true);
		expect(await platform.originals.get(SPACE, "d1")).toEqual(kept);
	});

	it("a current document has no original", async () => {
		const platform = await withStored(makeDoc());
		const session = await open(platform, { chain: testChain() });
		expect(session.hasOriginal).toBe(false);
		expect(await platform.originals.list(SPACE)).toEqual([]);
	});

	it("an upgrade that fails validation saves nothing and reports", async () => {
		const old = { ...makeDoc(), schemaVersion: OLD_SCHEMA_VERSION };
		const platform = await withStored(old);
		const broken = testChain((raw) => ({ ...raw, body: "broken" }));
		const session = await open(platform, { chain: broken });
		expect(session.readOnly).toBe("invalid");
		session.apply(rename("Home"));
		await session.flush();
		expect(await platform.documents.get(SPACE, "d1")).toEqual(old);
		expect(await platform.originals.get(SPACE, "d1")).toBeUndefined();
		expect(report).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ operation: "migrate", fromSchemaVersion: OLD_SCHEMA_VERSION })
		);
	});

	it("an original that can't be kept opens the upgrade read-only and reports", async () => {
		const old = { ...makeDoc(), schemaVersion: OLD_SCHEMA_VERSION };
		const platform = await withStored(old);
		const failure = new Error("originals unavailable");
		vi.spyOn(platform.originals, "put").mockRejectedValueOnce(failure);
		const session = await open(platform, { chain: testChain() });
		expect(session.readOnly).toBe("invalid");
		expect(session.hasOriginal).toBe(false);
		session.apply(rename("Home"));
		await session.flush();
		expect(await platform.documents.get(SPACE, "d1")).toEqual(old);
		expect(report).toHaveBeenCalledWith(
			failure,
			expect.objectContaining({ operation: "migrate", fromSchemaVersion: OLD_SCHEMA_VERSION })
		);
	});

	it("older journal records are upgraded before replay", async () => {
		const platform = await withStored(makeDoc());
		platform.journal.write(SPACE, "d1", "gone", {
			baseVersion: 0,
			changes: [oldRename("Mine"), oldRename("drop")],
			schemaVersion: OLD_SCHEMA_VERSION,
			writtenAt: NOW.toISOString()
		});
		const session = await open(platform, { chain: testChain() });
		expect(session.doc.name).toBe("Mine");
		expect(session.droppedEdits).toBe(1);
		expect((await stored(platform)).name).toBe("Mine");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("older log entries are upgraded during catch-up", async () => {
		const platform = await withStored(makeDoc());
		const session = await open(platform, { chain: testChain() });
		// An older tab saved after this one opened.
		await storeRaw(
			platform,
			{ schemaVersion: OLD_SCHEMA_VERSION, name: "Theirs" },
			[oldRename("Theirs"), oldRename("drop")],
			OLD_SCHEMA_VERSION
		);
		session.apply(rename("Mine"));
		await session.flush();
		expect(session.conflict?.pairs).toEqual([
			[rename("Mine"), { op: "setField", target: { path: "name" }, from: null, to: "Theirs" }]
		]);
	});

	it.each([
		["stored document", { schemaVersion: CURRENT_SCHEMA_VERSION + 1 }, CURRENT_SCHEMA_VERSION],
		["log entry", {}, CURRENT_SCHEMA_VERSION + 1]
	])("a %s from a newer format suspends and asks for a reload", async (_, doc, entryVersion) => {
		const platform = await withStored(makeDoc());
		const onNeedsReload = vi.fn();
		const session = await open(platform, { onNeedsReload });
		await storeRaw(platform, doc, [title("a", "Theirs")], entryVersion);
		const commit = vi.spyOn(platform.documents, "commit");
		session.apply(rename("Mine"));
		await session.flush();
		expect(onNeedsReload).toHaveBeenCalledTimes(1);
		expect(commit).toHaveBeenCalledTimes(1);

		session.apply(title("a", "Later"));
		await session.flush();
		platform.activity.setVisible(false);
		platform.activity.setVisible(true);
		await session.flush();
		expect(commit).toHaveBeenCalledTimes(1);
		expect(onNeedsReload).toHaveBeenCalledTimes(1);
		// Journaled for the newer version to replay.
		expect(platform.journal.readAll(SPACE, "d1")[0].record).toMatchObject({
			changes: [rename("Mine")]
		});
	});

	it("a changed generation stops saving and calls onCleared", async () => {
		const platform = await withStored(makeDoc());
		const onCleared = vi.fn();
		const session = await open(platform, { onCleared });
		await platform.reset.clearAll();
		const commit = vi.spyOn(platform.documents, "commit");

		session.apply(rename("Home"));
		platform.activity.setVisible(false);
		await session.flush();
		expect(commit).not.toHaveBeenCalled();
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
		expect(onCleared).toHaveBeenCalledTimes(1);
	});

	it("a tab with nothing to save that missed the clear finds out when it's shown again", async () => {
		for (const doc of [makeDoc(), { ...makeDoc(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }]) {
			const platform = await withStored(doc);
			const onCleared = vi.fn();
			const session = await open(platform, { onCleared });
			await platform.reset.clearAll();
			platform.activity.setVisible(false);
			platform.activity.setVisible(true);
			expect(onCleared).toHaveBeenCalledTimes(1);
			// Once only.
			platform.activity.setVisible(false);
			platform.activity.setVisible(true);
			expect(onCleared).toHaveBeenCalledTimes(1);
			session.dispose();
		}
	});
});
