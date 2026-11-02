import { describe, expect, it } from "vitest";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Change } from "$lib/changes/types";
import { applyChange } from "$lib/changes/apply";
import { fromRemote, mergeRemote, sameContent, saveFields, theirChanges } from "./merge";
import type { RemoteDocument } from "./remote";

function widget(id: string, rect: Rect = { x: 0, y: 0, w: 6, h: 4 }): WidgetInstance {
	return { id, type: "placeholder", title: null, rect, data: { layers: [] } };
}

function makeDoc(widgets = [widget("a"), widget("b", { x: 6, y: 0, w: 6, h: 4 })]): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 1,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets }
	};
}

function applyAll(doc: Dashboard, changes: Change[]): Dashboard {
	return changes.reduce((d, c) => applyChange(d, c).doc, doc);
}

const title = (widgetId: string, to: string, from: string | null = null): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from,
	to
});
const deleted = (to: string | null): Change => ({
	op: "setField",
	target: { path: "deletedAt" },
	from: null,
	to
});
const rename = (to: string): Change => ({
	op: "setField",
	target: { path: "name" },
	from: null,
	to
});

function remoteDoc(overrides: Partial<RemoteDocument> = {}): RemoteDocument {
	return {
		id: "d1",
		kind: "dashboard",
		name: null,
		schemaVersion: 1,
		version: 3,
		body: { widgets: [widget("a")] },
		deletedAt: null,
		copiedFrom: null,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-21T00:00:00.000Z",
		...overrides
	};
}

describe("mergeRemote", () => {
	it("no unsynced changes takes the server's version", () => {
		const out = mergeRemote({ server: makeDoc(), theirs: [title("a", "T")], dropped: 0, mine: [] });
		expect(out).toEqual({ kind: "take-server" });
	});

	it("different widgets merge silently", () => {
		const theirs = [title("a", "Theirs")];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({ server, theirs, dropped: 0, mine: [title("b", "Mine")] });
		expect(out.kind).toBe("rebased");
		if (out.kind !== "rebased") return;
		expect(out.doc.body.widgets.map((w) => w.title)).toEqual(["Theirs", "Mine"]);
	});

	it("the same title, different values, conflicts", () => {
		const theirs = [title("a", "Theirs")];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({ server, theirs, dropped: 0, mine: [title("a", "Mine")] });
		expect(out).toEqual({ kind: "conflict", reason: "overlap" });
	});

	it("layout moves on both sides merge, mine last", () => {
		const home = { x: 0, y: 0, w: 6, h: 4 };
		const move = (id: string, x: number): Change => ({
			op: "setLayout",
			target: { widgetIds: [id] },
			from: { [id]: { rect: home, minimized: null } },
			to: { [id]: { rect: { x, y: 4, w: 6, h: 4 }, minimized: null } }
		});
		const theirs = [move("a", 0)];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({ server, theirs, dropped: 0, mine: [move("a", 3)] });
		expect(out.kind).toBe("rebased");
		if (out.kind !== "rebased") return;
		expect(out.doc.body.widgets[0].rect).toEqual({ x: 3, y: 4, w: 6, h: 4 });
	});

	it("a log gap with unsynced changes always conflicts", () => {
		const out = mergeRemote({
			server: makeDoc(),
			theirs: null,
			dropped: 0,
			mine: [title("a", "M")]
		});
		expect(out).toEqual({ kind: "conflict", reason: "log-gap" });
	});

	it("a change that can't be upgraded conflicts", () => {
		const out = mergeRemote({
			server: makeDoc(),
			theirs: [],
			dropped: 1,
			mine: [title("a", "M")]
		});
		expect(out).toEqual({ kind: "conflict", reason: "overlap" });
	});

	it("deleted elsewhere with my edits asks", () => {
		const theirs = [deleted("2026-10-22T00:00:00.000Z")];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({ server, theirs, dropped: 0, mine: [title("a", "M")] });
		expect(out).toEqual({ kind: "deleted-elsewhere" });
	});

	it("deleted on both devices merges without asking", () => {
		const theirs = [deleted("2026-10-22T00:00:00.000Z")];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({
			server,
			theirs,
			dropped: 0,
			mine: [deleted("2026-10-23T00:00:00.000Z")]
		});
		expect(out.kind).toBe("rebased");
		if (out.kind === "rebased") expect(out.doc.deletedAt).toBe("2026-10-23T00:00:00.000Z");
	});

	it("deleted and restored elsewhere, my edit merges", () => {
		const theirs: Change[] = [
			deleted("2026-10-22T00:00:00.000Z"),
			{
				op: "setField",
				target: { path: "deletedAt" },
				from: "2026-10-22T00:00:00.000Z",
				to: null
			}
		];
		const server = applyAll(makeDoc(), theirs);
		const out = mergeRemote({ server, theirs, dropped: 0, mine: [title("a", "M")] });
		expect(out.kind).toBe("rebased");
	});

	it("a restore here against a delete elsewhere asks", () => {
		const theirs = [deleted("2026-10-22T00:00:00.000Z")];
		const server = applyAll(makeDoc(), theirs);
		const mine: Change[] = [
			{
				op: "setField",
				target: { path: "deletedAt" },
				from: "2026-10-22T00:00:00.000Z",
				to: null
			}
		];
		expect(mergeRemote({ server, theirs, dropped: 0, mine })).toEqual({
			kind: "deleted-elsewhere"
		});
	});
});

describe("fromRemote", () => {
	it("builds a local document at the local version", () => {
		const out = fromRemote(remoteDoc({ name: "N", copiedFrom: "x" }), 7);
		expect(out.status).toBe("ok");
		if (out.status !== "ok") return;
		expect(out.doc).toMatchObject({ id: "d1", version: 7, name: "N", copiedFrom: "x" });
		expect("deletedAt" in out.doc).toBe(false);
	});

	it("an older-format server document is upgraded", async () => {
		const load = await import("$lib/documents/load");
		const { CURRENT_SCHEMA_VERSION } = await import("$lib/documents/schema");
		const step = {
			from: 0,
			to: CURRENT_SCHEMA_VERSION,
			schema: (await import("$lib/zod")).z
				.object({ schemaVersion: (await import("$lib/zod")).z.literal(0) })
				.loose(),
			migrate: (raw: unknown) => ({ ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION }),
			migrateChange: (c: unknown) => c
		};
		load.migrations.push(step);
		try {
			const out = fromRemote(remoteDoc({ schemaVersion: 0 }), 2);
			expect(out.status).toBe("ok");
			if (out.status === "ok") expect(out.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		} finally {
			load.migrations.splice(load.migrations.indexOf(step), 1);
		}
	});

	it("a newer-format server document is newer", () => {
		expect(fromRemote(remoteDoc({ schemaVersion: 99 }), 1)).toEqual({ status: "newer" });
	});

	it("an unreadable server document is invalid", () => {
		expect(fromRemote(remoteDoc({ body: { nope: true } }), 1)).toEqual({ status: "invalid" });
	});
});

describe("saveFields", () => {
	it("maps absent deletedAt and copiedFrom to null", () => {
		expect(saveFields(makeDoc())).toEqual({
			schemaVersion: 1,
			name: null,
			body: { widgets: [widget("a"), widget("b", { x: 6, y: 0, w: 6, h: 4 })] },
			deletedAt: null,
			copiedFrom: null
		});
	});
});

describe("theirChanges", () => {
	it("null stays null", () => {
		expect(theirChanges(null)).toEqual({ changes: null, dropped: 0 });
	});

	it("keeps valid entries and counts the rest", () => {
		const out = theirChanges([
			{ version: 2, schemaVersion: 1, change: rename("X") },
			{ version: 3, schemaVersion: 1, change: { op: "bogus" } },
			{ version: 4, schemaVersion: 0, change: rename("Y") }
		]);
		expect(out.changes).toEqual([rename("X")]);
		expect(out.dropped).toBe(2);
	});
});

describe("sameContent", () => {
	it("sameContent ignores version and timestamps", () => {
		const a = makeDoc();
		const b = { ...makeDoc(), version: 9, updatedAt: "2027-01-01T00:00:00.000Z" };
		expect(sameContent(a, b)).toBe(true);
		expect(sameContent(a, { ...b, name: "Other" })).toBe(false);
		expect(sameContent(a, { ...b, deletedAt: "2026-10-22T00:00:00.000Z" })).toBe(false);
		expect(sameContent(a, { ...b, copiedFrom: "z" })).toBe(false);
	});
});
