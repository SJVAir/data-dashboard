import { describe, expect, it } from "vitest";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { widgetOptionsValid } from "$lib/documents/schema";
import { NOTE_TYPE } from "$lib/notes/options";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { MAP_TYPE } from "$lib/widgets/map/options";
import {
	changeTileOptions,
	tileOptions,
	ViewerChanges,
	viewerReset,
	type TileOptionsContext
} from "./tile-options.svelte";

const map = (options?: Record<string, unknown>): WidgetInstance => ({
	id: "m",
	type: MAP_TYPE,
	title: null,
	rect: { x: 0, y: 0, w: 6, h: 4 },
	data: { layers: [] },
	...(options ? { options } : {})
});
const note: WidgetInstance = {
	id: "n",
	type: NOTE_TYPE,
	title: null,
	rect: { x: 6, y: 0, w: 6, h: 4 },
	data: { layers: [] },
	options: { message: "welcome" }
};

function makeDoc(widgets: WidgetInstance[]): Dashboard {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 0,
		createdAt: "2026-11-13T00:00:00.000Z",
		updatedAt: "2026-11-13T00:00:00.000Z",
		body: { widgets }
	};
}

async function session(doc: Dashboard): Promise<DocumentSession> {
	const platform = createMemoryPlatform();
	await platform.documents.commit("anonymous", {
		docId: doc.id,
		baseVersion: null,
		doc,
		entries: []
	});
	return new DocumentSession({ platform, space: "anonymous", doc, tabId: "t1", debounceMs: 0 });
}

const view = (changes = new ViewerChanges()): TileOptionsContext => ({ mode: "view", changes });

describe("widgetOptionsValid", () => {
	it("runs the document's Note and Map checks", () => {
		expect(widgetOptionsValid(NOTE_TYPE, { text: "hi" })).toBe(true);
		expect(widgetOptionsValid(NOTE_TYPE, undefined)).toBe(false);
		expect(widgetOptionsValid(MAP_TYPE, undefined)).toBe(true);
		expect(widgetOptionsValid(MAP_TYPE, { hiddenTypes: ["a", "a"] })).toBe(false);
		expect(widgetOptionsValid("chart", { anything: 1 })).toBe(true);
	});
});

describe("edit mode", () => {
	it("applies exactly one change, and undo restores the options", async () => {
		const s = await session(makeDoc([map({ clustered: false })]));
		const ctx: TileOptionsContext = { mode: "edit", session: () => s };
		const before = s.doc;
		let applied = 0;
		const apply = s.apply.bind(s);
		s.apply = (change) => {
			applied++;
			apply(change);
		};
		changeTileOptions(ctx, map({ clustered: false }), { clustered: false, basemap: "x" }, [
			"basemap"
		]);
		expect(applied).toBe(1);
		expect(s.doc.body.widgets[0].options).toEqual({ clustered: false, basemap: "x" });
		s.undo();
		expect(s.doc.body.widgets[0].options).toEqual(before.body.widgets[0].options);
	});

	it("does nothing when equal, read-only, absent, or without a session", async () => {
		const s = await session(makeDoc([map({ clustered: false })]));
		let applied = 0;
		const apply = s.apply.bind(s);
		s.apply = (change) => {
			applied++;
			apply(change);
		};
		const ctx: TileOptionsContext = { mode: "edit", session: () => s };
		changeTileOptions(ctx, map(), { clustered: false }, ["clustered"]);
		changeTileOptions(ctx, { ...map(), id: "gone" }, { basemap: "x" }, ["basemap"]);
		changeTileOptions({ mode: "edit", session: () => null }, map(), { basemap: "x" }, ["basemap"]);
		expect(applied).toBe(0);
	});

	it("reads the session at write time, and no keys leaves no options", async () => {
		const first = await session(makeDoc([map({ basemap: "a" })]));
		const second = await session(makeDoc([map({ basemap: "b" })]));
		let current = first;
		const ctx: TileOptionsContext = { mode: "edit", session: () => current };
		current = second;
		changeTileOptions(ctx, map(), {}, ["basemap"]);
		expect(first.doc.body.widgets[0].options).toEqual({ basemap: "a" });
		expect("options" in second.doc.body.widgets[0]).toBe(false);
	});

	it("shows the saved options", () => {
		const ctx: TileOptionsContext = { mode: "edit", session: () => null };
		expect(tileOptions(ctx, map({ basemap: "a" }))).toEqual({ basemap: "a" });
	});
});

describe("view mode", () => {
	it("holds a change for the visit and leaves the document alone", async () => {
		const s = await session(makeDoc([map({ clustered: false })]));
		const ctx = view();
		const widget = s.doc.body.widgets[0];
		const before = s.doc;
		changeTileOptions(ctx, widget, { clustered: false, basemap: "x" }, ["basemap"]);
		expect(tileOptions(ctx, widget)).toEqual({ clustered: false, basemap: "x" });
		expect(s.doc).toBe(before);
		expect(widget.options).toEqual({ clustered: false });
	});

	it("a key the viewer changed to missing is held as missing", () => {
		const ctx = view();
		changeTileOptions(ctx, map({ clustered: false }), {}, ["clustered"]);
		expect(tileOptions(ctx, map({ clustered: false }))).toBeUndefined();
	});

	it("a live update keeps the viewer's keys and takes the owner's others", () => {
		const ctx = view();
		changeTileOptions(ctx, map(), { basemap: "x" }, ["basemap"]);
		const updated = map({ clustered: false, basemap: "owner" });
		expect(tileOptions(ctx, updated)).toEqual({ clustered: false, basemap: "x" });
	});

	it("prune forgets a widget the owner removed", () => {
		const changes = new ViewerChanges();
		changes.set("m", { basemap: "x" });
		changes.prune(makeDoc([note]));
		expect(changes.get("m")).toBeUndefined();
	});

	it("a held value that no longer validates falls back to the saved options", () => {
		const changes = new ViewerChanges();
		changes.set("m", { hiddenTypes: ["a", "a"] });
		const widget = map({ basemap: "a" });
		expect(tileOptions(view(changes), widget)).toEqual({ basemap: "a" });
		const doc = makeDoc([widget]);
		expect(changes.applyTo(doc).body.widgets[0].options).toEqual({ basemap: "a" });
	});

	it("applyTo puts the held keys on, keeping a Note", () => {
		const changes = new ViewerChanges();
		changes.set("m", { basemap: "x" });
		changes.set("gone", { basemap: "y" });
		const doc = makeDoc([map({ clustered: false }), note]);
		const out = changes.applyTo(doc);
		expect(out.body.widgets).toEqual([map({ clustered: false, basemap: "x" }), note]);
		expect(doc.body.widgets[0].options).toEqual({ clustered: false });
	});

	it("viewerReset drops the keys, back to the owner's values", () => {
		const changes = new ViewerChanges();
		const ctx = view(changes);
		changeTileOptions(ctx, map(), { basemap: "x", clustered: false }, ["basemap", "clustered"]);
		viewerReset(ctx, map(), ["basemap"]);
		expect(changes.get("m")).toEqual({ clustered: false });
		viewerReset(ctx, map(), ["clustered"]);
		expect(changes.get("m")).toBeUndefined();
	});
});
