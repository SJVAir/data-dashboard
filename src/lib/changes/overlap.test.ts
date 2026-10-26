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
