import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DocumentSession } from "./document-session.svelte";

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

	it("flushes pending changes when the page becomes hidden", async () => {
		const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
		vi.stubGlobal("document", doc);
		const { platform, session } = await setup();
		session.apply(rename("Home"));

		doc.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(0);
		expect((await stored(platform)).name).toBe("Home");
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

	it("a refused commit passes the stored version to catchUp, and its failure is an error", async () => {
		const { platform } = await setup();
		const seen: number[] = [];
		class Failing extends DocumentSession {
			protected override async catchUp(storedVersion: number): Promise<void> {
				seen.push(storedVersion);
				throw new Error("catch-up failed");
			}
		}
		const other = new DocumentSession({ platform, space: SPACE, doc: makeDoc(), tabId: "t2" });
		other.apply(rename("Theirs"));
		await other.flush();

		const session = new Failing({ platform, space: SPACE, doc: makeDoc(), tabId: "tab-1" });
		session.apply(title("a", "Map"));
		await session.flush();
		expect(seen).toEqual([1]);
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
