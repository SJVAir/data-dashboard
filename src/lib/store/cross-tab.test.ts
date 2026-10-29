import { afterEach, describe, expect, it, vi } from "vitest";
import type { Change } from "$lib/changes/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import { LOG_LIMIT, type Platform, type SpaceId } from "$lib/platform/types";
import { rectsOverlap } from "$lib/layout/engine";
import { DocumentSession } from "./document-session.svelte";
import { createMemoryTabHub } from "./tab-channel";

const SPACE: SpaceId = "anonymous";

function widget(id: string, x: number, y = 0): WidgetInstance {
	return { id, type: "placeholder", title: null, rect: { x, y, w: 6, h: 4 }, data: { layers: [] } };
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
		body: { widgets: [widget("a", 0), widget("b", 6)] }
	};
}

const rename = (to: string | null): Change => ({
	op: "setField",
	target: { path: "name" },
	from: null,
	to
});

const title = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});

const add = (w: WidgetInstance): Change => ({
	op: "addWidget",
	target: { widgetId: w.id },
	widget: w,
	index: 99
});

/** Let broadcasts and the catch-ups they start finish (memory storage is all microtasks). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const sessions: DocumentSession[] = [];
afterEach(() => {
	for (const s of sessions.splice(0)) s.dispose();
	vi.unstubAllGlobals();
});

async function twoTabs() {
	const platform = createMemoryPlatform();
	const hub = createMemoryTabHub();
	await platform.documents.commit(SPACE, {
		docId: "d1",
		baseVersion: null,
		doc: makeDoc(),
		entries: []
	});
	const open = async (tabId: string) => {
		const s = await DocumentSession.open(platform, SPACE, "d1", tabId, {
			channel: hub.channel(),
			debounceMs: 60_000
		});
		sessions.push(s!);
		return s!;
	};
	return { platform, open, a: await open("tab-a"), b: await open("tab-b") };
}

const removeA = (): Change => ({
	op: "removeWidget",
	target: { widgetId: "a" },
	widget: widget("a", 0),
	index: 0
});

/** A record a closed tab left in the journal, on top of version `baseVersion`. */
const record = (changes: Change[], baseVersion = 0) => ({
	baseVersion,
	changes,
	schemaVersion: 1,
	writtenAt: "2026-10-20T12:00:00.000Z"
});

async function stored(platform: Platform, id = "d1"): Promise<Dashboard> {
	return (await platform.documents.get(SPACE, id)) as Dashboard;
}

/** Both tabs edit, then A saves first; B's save is refused and B catches up. */
async function concurrent(
	a: DocumentSession,
	b: DocumentSession,
	mine: Change[],
	theirs: Change[]
) {
	for (const c of theirs) a.apply(c);
	for (const c of mine) b.apply(c);
	await a.flush();
	await b.flush();
	await settle();
}

describe("cross-tab sync", () => {
	it("a change in tab A appears in tab B", async () => {
		const { a, b } = await twoTabs();
		a.apply(rename("Home"));
		await a.flush();
		await settle();
		expect(b.doc.name).toBe("Home");
		expect(b.doc.version).toBe(1);
		expect(b.status).toBe("saved");
	});

	it("edits to different widgets in both tabs merge with no prompt", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [title("b", "Mine")], [title("a", "Theirs")]);
		await settle();

		const saved = await stored(platform);
		expect(saved.body.widgets.map((w) => w.title)).toEqual(["Theirs", "Mine"]);
		expect(saved.version).toBe(2);
		for (const s of [a, b]) {
			expect(s.conflict).toBeNull();
			expect(s.status).toBe("saved");
			expect(s.doc).toEqual(saved);
		}
	});

	it("same-field edits in both tabs raise a conflict in the later tab", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [rename("Mine")], [rename("Theirs")]);

		expect(a.conflict).toBeNull();
		expect(b.conflict?.pairs).toEqual([[rename("Mine"), rename("Theirs")]]);
		expect(b.doc.name).toBe("Mine");
		expect((await stored(platform)).name).toBe("Theirs");
	});

	it("keep-mine keeps my title and their other edits", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [title("a", "Mine")], [title("a", "Theirs"), title("b", "Other")]);
		expect(b.conflict).not.toBeNull();

		expect(await b.resolveConflict("keep-mine")).toBeNull();
		await settle();
		const saved = await stored(platform);
		expect(saved.body.widgets.map((w) => w.title)).toEqual(["Mine", "Other"]);
		expect(b.conflict).toBeNull();
		expect(b.status).toBe("saved");
		expect(b.doc).toEqual(saved);
		expect(a.doc).toEqual(saved);
	});

	it("keep-mine keeps a widget I changed that the other tab deleted", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [title("a", "Mine")], [removeA(), title("b", "Other")]);
		expect(b.conflict).not.toBeNull();

		await b.resolveConflict("keep-mine");
		await settle();
		const saved = await stored(platform);
		expect(saved.body.widgets.map((w) => [w.id, w.title])).toEqual([
			["a", "Mine"],
			["b", "Other"]
		]);
		expect(a.doc).toEqual(saved);
	});

	it("edits during a conflict wait for it and are kept by keep-mine", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [rename("Mine")], [rename("Theirs")]);
		const commit = vi.spyOn(platform.documents, "commit");
		b.apply(title("b", "Later"));
		await b.flush();
		expect(commit).not.toHaveBeenCalled();
		expect(b.status).toBe("error");

		await b.resolveConflict("keep-mine");
		const saved = await stored(platform);
		expect(saved.name).toBe("Mine");
		expect(saved.body.widgets[1].title).toBe("Later");
		expect(b.status).toBe("saved");
	});

	it("use-other drops my pending change", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [rename("Mine")], [rename("Theirs")]);

		expect(await b.resolveConflict("use-other")).toBeNull();
		const saved = await stored(platform);
		expect(saved.name).toBe("Theirs");
		expect(saved.version).toBe(1);
		expect(b.doc).toEqual(saved);
		expect(b.conflict).toBeNull();
		expect(b.status).toBe("saved");
		await b.flush();
		expect((await stored(platform)).version).toBe(1);
	});

	it("save-copy creates a copy with copiedFrom and leaves the original as stored", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [rename("Mine")], [rename("Theirs")]);

		const copyId = await b.resolveConflict("save-copy");
		expect(copyId).toEqual(expect.any(String));
		expect(copyId).not.toBe("d1");
		const copy = await stored(platform, copyId!);
		expect(copy).toMatchObject({ id: copyId, copiedFrom: "d1", version: 0, name: "Mine" });

		const original = await stored(platform);
		expect(original.name).toBe("Theirs");
		expect(original.copiedFrom).toBeUndefined();
		expect(b.doc).toEqual(original);
		expect(b.conflict).toBeNull();
		expect(b.status).toBe("saved");
	});

	it("two tabs adding widgets never overlap", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [add(widget("mine", 0, 4))], [add(widget("theirs", 0, 4))]);
		await settle();

		const { widgets } = (await stored(platform)).body;
		expect(widgets.map((w) => w.id).sort()).toEqual(["a", "b", "mine", "theirs"]);
		for (const x of widgets) {
			for (const y of widgets) if (x !== y) expect(rectsOverlap(x.rect, y.rect)).toBe(false);
		}
		expect(a.doc).toEqual(b.doc);
	});

	it("a tab behind a trimmed log reloads and replays its own pending changes", async () => {
		const { platform, a, b } = await twoTabs();
		b.apply(title("b", "Mine"));
		// Tab A writes more changes than the log keeps, so B's base version is trimmed away.
		for (let i = 0; i <= LOG_LIMIT; i++) a.apply(rename(`Name ${i}`));
		await a.flush();
		expect(await platform.documents.readLog(SPACE, "d1", 0)).toBe("trimmed");

		await b.flush();
		await settle();
		const saved = await stored(platform);
		expect(saved.version).toBe(LOG_LIMIT + 2);
		expect(saved.name).toBe(`Name ${LOG_LIMIT}`);
		expect(saved.body.widgets[1].title).toBe("Mine");
		expect(b.doc).toEqual(saved);
		expect(b.status).toBe("saved");
	});

	it("a trimmed catch-up during a conflict clears the conflict and replays mine", async () => {
		const { platform, a, b } = await twoTabs();
		await concurrent(a, b, [rename("Mine")], [rename("Theirs")]);
		expect(b.conflict).not.toBeNull();

		// Tab A saves more than the log keeps, so B's base version is trimmed away.
		for (let i = 0; i <= LOG_LIMIT; i++) a.apply(title("a", `Title ${i}`));
		await a.flush();
		await settle();
		const saved = await stored(platform);
		expect(b.conflict).toBeNull();
		expect(saved.name).toBe("Mine");
		expect(saved.body.widgets[0].title).toBe(`Title ${LOG_LIMIT}`);
		expect(b.doc).toEqual(saved);
		expect(b.status).toBe("saved");
	});

	it("keep mine after a journal-replay conflict keeps edits to widgets the other side deleted", async () => {
		const { platform, open, a } = await twoTabs();
		a.apply(removeA());
		await a.flush();
		await settle();
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Mine")]));

		const c = await open("tab-c");
		expect(c.conflict).not.toBeNull();
		await c.resolveConflict("keep-mine");
		await settle();
		const saved = await stored(platform);
		expect(saved.body.widgets.map((w) => [w.id, w.title])).toEqual([
			["a", "Mine"],
			["b", null]
		]);
		expect(c.doc).toEqual(saved);
		expect(a.doc).toEqual(saved);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("keep mine after a journal-replay conflict survives another save meanwhile", async () => {
		const { platform, open, a } = await twoTabs();
		a.apply(removeA());
		await a.flush();
		await settle();
		platform.journal.write(SPACE, "d1", "gone", record([title("a", "Mine")]));

		const c = await open("tab-c");
		expect(c.conflict).not.toBeNull();
		// Tab A saves again while the prompt is up; C catches up and the conflict stands.
		a.apply(title("b", "X"));
		await a.flush();
		await settle();
		expect(c.conflict).not.toBeNull();
		expect(platform.journal.readAll(SPACE, "d1")).toHaveLength(1);

		await c.resolveConflict("keep-mine");
		await settle();
		const saved = await stored(platform);
		expect(saved.body.widgets.map((w) => [w.id, w.title])).toEqual([
			["a", "Mine"],
			["b", "X"]
		]);
		expect(c.doc).toEqual(saved);
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("save mine as a copy after a journal replay", async () => {
		const { platform, open, a } = await twoTabs();
		a.apply(rename("Theirs"));
		await a.flush();
		await settle();
		platform.journal.write(SPACE, "d1", "gone", record([rename("Mine")]));

		const c = await open("tab-c");
		expect(c.conflict).not.toBeNull();
		const copyId = await c.resolveConflict("save-copy");
		expect(await stored(platform, copyId!)).toMatchObject({ copiedFrom: "d1", name: "Mine" });
		const original = await stored(platform);
		expect(original.name).toBe("Theirs");
		expect(c.doc).toEqual(original);
		expect(c.conflict).toBeNull();
		expect(c.status).toBe("saved");
		expect(platform.journal.readAll(SPACE, "d1")).toEqual([]);
	});

	it("a catch-up during an in-flight commit", async () => {
		const { platform, a, b } = await twoTabs();
		const commit = platform.documents.commit.bind(platform.documents);
		// Tab A saves (and broadcasts) while B's commit is in flight.
		vi.spyOn(platform.documents, "commit").mockImplementationOnce(async (space, input) => {
			a.apply(rename("Theirs"));
			await a.flush();
			return commit(space, input);
		});
		b.apply(title("b", "Mine"));
		await b.flush();
		await settle();

		const saved = await stored(platform);
		expect(saved.version).toBe(2);
		expect(saved.name).toBe("Theirs");
		expect(saved.body.widgets[1].title).toBe("Mine");
		for (const s of [a, b]) {
			expect(s.doc).toEqual(saved);
			expect(s.status).toBe("saved");
			expect(s.conflict).toBeNull();
		}
	});

	it("pageshow from the back/forward cache flushes and catches up", async () => {
		const win = new EventTarget();
		vi.stubGlobal("window", win);
		const platform = createMemoryPlatform();
		await platform.documents.commit(SPACE, {
			docId: "d1",
			baseVersion: null,
			doc: makeDoc(),
			entries: []
		});
		// No channel: the tab was frozen in the cache and heard nothing.
		const b = (await DocumentSession.open(platform, SPACE, "d1", "tab-b", {
			debounceMs: 60_000
		}))!;
		sessions.push(b);
		const a = (await DocumentSession.open(platform, SPACE, "d1", "tab-a"))!;
		sessions.push(a);
		b.apply(title("b", "Mine"));
		a.apply(rename("Theirs"));
		await a.flush();

		win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
		await settle();
		const saved = await stored(platform);
		expect(saved.name).toBe("Theirs");
		expect(saved.body.widgets[1].title).toBe("Mine");
		expect(b.doc).toEqual(saved);
		expect(b.status).toBe("saved");
	});

	it("catches up when the app becomes visible again", async () => {
		const platform = createMemoryPlatform();
		await platform.documents.commit(SPACE, {
			docId: "d1",
			baseVersion: null,
			doc: makeDoc(),
			entries: []
		});
		// No channel: the broadcast was missed (the tab was frozen).
		const b = (await DocumentSession.open(platform, SPACE, "d1", "tab-b"))!;
		sessions.push(b);
		const a = (await DocumentSession.open(platform, SPACE, "d1", "tab-a"))!;
		sessions.push(a);
		platform.activity.setVisible(false);
		a.apply(rename("Home"));
		await a.flush();
		expect(b.doc.name).toBeNull();

		platform.activity.setVisible(true);
		await settle();
		expect(b.doc.name).toBe("Home");
	});
});
