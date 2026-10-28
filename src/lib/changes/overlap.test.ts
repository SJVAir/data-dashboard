import { describe, expect, it } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import type { Change } from "./types";
import { changesOverlap } from "./overlap";

function widget(id: string): WidgetInstance {
	return {
		id,
		type: "placeholder",
		title: null,
		rect: { x: 0, y: 0, w: 6, h: 4 },
		data: { layers: [] }
	};
}

const title = (widgetId: string, to: string): Change => ({
	op: "setField",
	target: { widgetId, path: "title" },
	from: null,
	to
});
const name = (to: string): Change => ({ op: "setField", target: { path: "name" }, from: null, to });
const remove = (id: string): Change => ({
	op: "removeWidget",
	target: { widgetId: id },
	widget: widget(id),
	index: 0
});
const add = (id: string): Change => ({
	op: "addWidget",
	target: { widgetId: id },
	widget: widget(id),
	index: 0
});

describe("changesOverlap", () => {
	it("same widget same path overlaps", () => {
		expect(changesOverlap(title("a", "One"), title("a", "Two"))).toBe(true);
	});

	it("same widget different path does not", () => {
		// Only `title` is a widget path today; a widget field never overlaps a document field.
		expect(changesOverlap(title("a", "One"), name("Two"))).toBe(false);
		const deleted: Change = {
			op: "setField",
			target: { path: "deletedAt" },
			from: null,
			to: "2026-10-20T01:00:00.000Z"
		};
		expect(changesOverlap(name("One"), deleted)).toBe(false);
	});

	it("different widgets do not", () => {
		expect(changesOverlap(title("a", "One"), title("b", "Two"))).toBe(false);
		expect(changesOverlap(remove("a"), title("b", "Two"))).toBe(false);
		expect(changesOverlap(add("c"), add("d"))).toBe(false);
	});

	it("remove vs title edit of that widget overlaps", () => {
		expect(changesOverlap(remove("a"), title("a", "Two"))).toBe(true);
		expect(changesOverlap(title("a", "Two"), remove("a"))).toBe(true);
	});

	it("two name edits overlap", () => {
		expect(changesOverlap(name("One"), name("Two"))).toBe(true);
	});

	it("two edits setting the same field to the same value agree, so they do not overlap", () => {
		expect(changesOverlap(title("a", "One"), title("a", "One"))).toBe(false);
		expect(changesOverlap(name("One"), name("One"))).toBe(false);
	});

	it("both sides removing the same widget agree, so they do not overlap", () => {
		expect(changesOverlap(remove("a"), remove("a"))).toBe(false);
	});

	it("replaceDocument overlaps every change, on either side, and another replaceDocument", () => {
		const content = { name: null, body: { widgets: [] } };
		const replace: Change = { op: "replaceDocument", target: {}, from: content, to: content };
		for (const other of [add("a"), remove("a"), title("a", "T"), name("N"), replace]) {
			expect(changesOverlap(replace, other)).toBe(true);
			expect(changesOverlap(other, replace)).toBe(true);
		}
	});
});

describe("changesOverlap with setLayout", () => {
	const p = (y: number) => ({ rect: { x: 0, y, w: 6, h: 4 }, minimized: null });
	const layout = (ids: string[], y: number): Change => ({
		op: "setLayout",
		target: { widgetIds: ids },
		from: Object.fromEntries(ids.map((id) => [id, p(0)])),
		to: Object.fromEntries(ids.map((id) => [id, p(y)]))
	});

	it("setLayouts sharing an id with different to overlap", () => {
		expect(changesOverlap(layout(["a", "b"], 4), layout(["b", "c"], 8))).toBe(true);
	});
	it("same to doesn't", () => {
		expect(changesOverlap(layout(["a", "b"], 4), layout(["b", "c"], 4))).toBe(false);
	});
	it("disjoint ids don't", () => {
		expect(changesOverlap(layout(["a"], 4), layout(["b"], 8))).toBe(false);
	});
	it("setLayout overlaps removeWidget of a listed id", () => {
		expect(changesOverlap(layout(["a", "b"], 4), remove("b"))).toBe(true);
		expect(changesOverlap(remove("b"), layout(["a", "b"], 4))).toBe(true);
		expect(changesOverlap(layout(["a"], 4), remove("b"))).toBe(false);
	});
	it("an id only on the prototype of the other side's to doesn't overlap", () => {
		const a: Change = {
			op: "setLayout",
			target: { widgetIds: ["toString"] },
			from: { toString: p(0) },
			to: { toString: p(4) }
		};
		expect(changesOverlap(a, layout(["x"], 8))).toBe(false);
	});
	it("the same placement with keys in another order doesn't overlap", () => {
		const b: Change = {
			op: "setLayout",
			target: { widgetIds: ["a"] },
			from: { a: p(0) },
			to: { a: { minimized: null, rect: { h: 4, w: 6, y: 4, x: 0 } } }
		};
		expect(changesOverlap(layout(["a"], 4), b)).toBe(false);
	});
});
