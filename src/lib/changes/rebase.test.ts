import { describe, expect, it } from "vitest";
import type { Dashboard, Rect, WidgetInstance } from "$lib/documents/schema";
import type { Change } from "./types";
import { applyChange } from "./apply";
import { applyForced, rebase } from "./rebase";

function widget(id: string, rect: Rect = { x: 0, y: 0, w: 6, h: 4 }): WidgetInstance {
	return { id, type: "placeholder", title: null, rect, data: { layers: [] } };
}

function makeDoc(
	widgets: WidgetInstance[] = [widget("a"), widget("b", { x: 6, y: 0, w: 6, h: 4 })]
) {
	const doc: Dashboard = {
		kind: "dashboard",
		schemaVersion: 1,
		id: "d1",
		name: null,
		version: 1,
		createdAt: "2026-10-20T00:00:00.000Z",
		updatedAt: "2026-10-20T00:00:00.000Z",
		body: { widgets }
	};
	return doc;
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
const add = (w: WidgetInstance, index = 99): Change => ({
	op: "addWidget",
	target: { widgetId: w.id },
	widget: w,
	index
});
const remove = (w: WidgetInstance, index: number): Change => ({
	op: "removeWidget",
	target: { widgetId: w.id },
	widget: w,
	index
});

describe("rebase", () => {
	it("non-overlapping edits merge cleanly", () => {
		const theirs = [title("a", "Theirs")];
		const mine = [
			title("b", "Mine"),
			{ op: "setField", target: { path: "name" }, from: null, to: "Doc" } as Change
		];
		const current = applyAll(makeDoc(), theirs);
		const result = rebase(current, theirs, mine);
		expect(result.kind).toBe("clean");
		if (result.kind !== "clean") return;
		expect(result.doc.body.widgets.map((w) => w.title)).toEqual(["Theirs", "Mine"]);
		expect(result.doc.name).toBe("Doc");
		expect(result.changes).toEqual(mine);
	});

	it("overlapping title edits conflict with the pair", () => {
		const theirs = [title("b", "Other"), title("a", "Theirs")];
		const mine = [title("a", "Mine")];
		const current = applyAll(makeDoc(), theirs);
		expect(rebase(current, theirs, mine)).toEqual({
			kind: "conflict",
			pairs: [[mine[0], theirs[1]]]
		});
	});

	it("two adds at the bottom never overlap", () => {
		const theirs = [add(widget("t", { x: 0, y: 4, w: 6, h: 4 }))];
		const mine = [add(widget("m", { x: 0, y: 4, w: 6, h: 4 }))];
		const current = applyAll(makeDoc(), theirs);
		const result = rebase(current, theirs, mine);
		expect(result.kind).toBe("clean");
		if (result.kind !== "clean") return;
		const placed = result.doc.body.widgets.find((w) => w.id === "m");
		expect(placed?.rect).toEqual({ x: 0, y: 8, w: 6, h: 4 });
		expect(result.changes).toEqual([add(widget("m", { x: 0, y: 8, w: 6, h: 4 }), 3)]);
	});

	it("my edit to a widget they removed conflicts", () => {
		const theirs = [remove(widget("a"), 0)];
		const mine = [title("a", "Mine")];
		const current = applyAll(makeDoc(), theirs);
		expect(rebase(current, theirs, mine)).toEqual({
			kind: "conflict",
			pairs: [[mine[0], theirs[0]]]
		});
	});

	it("drops a change whose target is gone and records the actual prior value", () => {
		const theirs = [remove(widget("a"), 0)];
		const mine = [remove(widget("a"), 0), title("b", "Mine", "Stale")];
		const current = applyAll(makeDoc(), theirs);
		const result = rebase(current, theirs, mine);
		expect(result.kind).toBe("clean");
		if (result.kind !== "clean") return;
		expect(result.changes).toEqual([title("b", "Mine", null)]);
	});
});

describe("applyForced", () => {
	it("skips missing targets and re-places overlapping adds", () => {
		const changes = [title("zzz", "Gone"), add(widget("c")), title("a", "Kept")];
		const { doc, applied } = applyForced(makeDoc(), changes);
		expect(applied).toEqual([add(widget("c", { x: 0, y: 4, w: 6, h: 4 }), 2), title("a", "Kept")]);
		expect(doc.body.widgets.map((w) => w.id)).toEqual(["a", "b", "c"]);
		expect(doc.body.widgets[0].title).toBe("Kept");
	});

	it("keeps an add whose rect is free where it is", () => {
		const free = widget("c", { x: 0, y: 4, w: 6, h: 4 });
		const { applied } = applyForced(makeDoc(), [add(free, 2)]);
		expect(applied).toEqual([add(free, 2)]);
	});
});

describe("setLayout and placement in applyForced", () => {
	const p = (y: number) => ({ rect: { x: 0, y, w: 6, h: 4 }, minimized: null });

	it("applyForced drops gone ids from setLayout", () => {
		const doc = makeDoc([widget("a")]);
		const change: Change = {
			op: "setLayout",
			target: { widgetIds: ["a", "gone"] },
			from: { a: p(0), gone: p(0) },
			to: { a: p(4), gone: p(8) }
		};
		const { doc: next, applied } = applyForced(doc, [change]);
		expect(next.body.widgets[0].rect.y).toBe(4);
		expect(applied).toMatchObject([{ op: "setLayout", target: { widgetIds: ["a"] } }]);
	});

	it("an added widget overlapping a grid widget goes below the grid widgets only", () => {
		const hidden = { ...widget("m", { x: 0, y: 20, w: 6, h: 4 }), minimized: { order: 0 } };
		const doc = makeDoc([widget("a"), hidden]);
		const { doc: next } = applyForced(doc, [add(widget("c"))]);
		expect(next.body.widgets.find((w) => w.id === "c")?.rect).toEqual({ x: 0, y: 4, w: 6, h: 4 });
	});
});
